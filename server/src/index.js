import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { getProviderChain } from './providers/index.js';
import { openSource } from './documentSource.js';
import { runWithConcurrency } from './concurrency.js';
import { requireAuth } from './auth.js';
import { generationLimiter, chatLimiter, exemptCount, limitsSummary } from './rateLimit.js';
import { proGenerationLimiter, proChatLimiter } from './planLimit.js';
import { generateWithFallback, parseJsonArray, sanitizeCards } from './llm.js';
import { buildQuizPrompt, groupCardsByTopic, sanitizeQuestions } from './quiz.js';
import { buildChatPrompt, sanitizeHistory } from './chat.js';
import { stripe, billingConfigured } from './stripeClient.js';
import { adminConfigured } from './supabaseAdmin.js';
import { handleWebhookEvent, createCheckoutSession, createPortalSession, getBillingStatus } from './billing.js';

const app = express();
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

// Only the app's own front ends may call this API from a browser. Previously this was a
// bare cors() — i.e. Access-Control-Allow-Origin: *, letting any site on the internet
// script requests against it with a victim's token.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://med-flash-gamma.vercel.app,http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header = non-browser client (curl, server-to-server); nothing to protect there.
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
  })
);
app.disable('x-powered-by');
// Render terminates TLS at its proxy, so without this req.ip is the proxy's address and
// the rate limiter's IP fallback would lump every client into one bucket.
app.set('trust proxy', 1);

// Stripe's webhook signature covers the exact raw request bytes, so this route needs the
// unparsed body — it MUST be registered before the blanket express.json() below, since
// Express matches middleware/routes in registration order and json() would otherwise
// consume and parse the body first, leaving nothing raw to verify against.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!billingConfigured) return res.status(503).json({ error: 'Billing is not configured' });

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    await handleWebhookEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    // 500 so Stripe retries delivery — handlers upsert full state, so redelivery is safe.
    res.status(500).json({ error: 'Webhook handling failed' });
  }
});

app.use(express.json({ limit: '15mb' })); // deck JSON for quiz generation can carry a lot of card text

const SLIDE_CONCURRENCY = 2;
const TOPIC_CONCURRENCY = 3;
const HEARTBEAT_MS = 15000;

// Render sits behind Cloudflare, which kills a connection after too long with no new
// bytes. A slow slide/topic (working through several rate-limited models in the fallback
// chain) can easily go quiet for over a minute, so without this the whole SSE stream gets
// dropped mid-generation — surfacing to the browser as a bare "Failed to fetch". An SSE
// comment line (leading `:`) keeps the connection alive without being treated as an event
// by the client's parser, which only looks for `event:`/`data:` lines.
function startHeartbeat(res) {
  const timer = setInterval(() => res.write(': heartbeat\n\n'), HEARTBEAT_MS);
  return () => clearInterval(timer);
}

function buildSlidePrompt(text, pageIndex, totalPages, hasImage) {
  const slideText = text || '(no extractable text on this slide)';
  const imageNote = hasImage
    ? '\nAn image of the slide is also attached — use it to read any diagrams, charts, labeled figures, or text that the extracted text above missed. If the slide is primarily a diagram/figure, base the flashcard(s) on what the image shows.'
    : '';
  return `You are making Anki-style flashcards for a first-year medical student, from ONE section of their study material (section ${pageIndex + 1} of ${totalPages}).

Section text:
"""
${slideText}
"""
${imageNote}

Goal: cover every topic and term mentioned on this slide, but consolidate related material into well-organized cards rather than splintering every minor point into its own card. Group things that belong together (e.g. a list of items with their properties becomes one card with a table; a multi-step process becomes one card walking through the steps) so a dense slide gets 2-3 cards and a light slide gets exactly 1. Only return an empty array [] if the slide is truly blank or is nothing but a section-divider title with no real content.

For the "answer" of each card: it must explain the SAME material that's on the slide (don't invent new outside facts) — but written far more clearly than the slide's own wording, in plain approachable language a first-year med student can actually follow, as if a friend were explaining it well. Where it helps, use a short numbered/bulleted breakdown (plain text, one point per line, no markdown symbols like * or #).

For each card, also include:
- "table": if the slide content is naturally tabular (items mapped to properties/categories/destinations), fill this in as {"headers": [...], "rows": [[...], ...]}; otherwise set it to null. Don't force a table where a table isn't the natural shape of the content.
- "mnemonic": a short, punchy memory trick, analogy, or acronym that makes this stick (e.g. "Think: protein + address label = correct destination", or an acronym expansion) — ONLY include one if something natural fits well; otherwise use an empty string. Don't force a corny one.

Write question/answer/mnemonic as plain text only, no markdown formatting.

Return ONLY a JSON array (no markdown fences, no commentary) of objects shaped like:
{"question": "...", "answer": "...", "table": {"headers": [...], "rows": [[...]]} | null, "mnemonic": "...", "topic": "short topic tag"}`;
}

// rateLimit sits after requireAuth (so it can key on the verified user) but before
// multer, so a rejected request never buffers a 40MB upload into memory.
app.post('/api/generate-stream', requireAuth, generationLimiter.middleware, proGenerationLimiter, upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let providerChain;
  let source;
  try {
    providerChain = getProviderChain();
    source = await openSource(req.file);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to open file' });
  }
  const pageCount = source.pageCount;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const stopHeartbeat = startHeartbeat(res);

  send('start', { totalPages: pageCount, providers: providerChain.map((p) => p.name) });

  const pageIndexes = Array.from({ length: pageCount }, (_, i) => i);
  const anyVision = providerChain.some((p) => p.supportsVision());

  try {
    await runWithConcurrency(pageIndexes, SLIDE_CONCURRENCY, async (pageIndex) => {
      const { text, imageDataUrl } = source.getPage(pageIndex);
      if (!text && !anyVision) return { pageIndex, cards: [], imageDataUrl };

      const raw = await generateWithFallback(providerChain, {
        imageDataUrl,
        buildPrompt: (hasImage) => {
          if (!text && !hasImage) return null;
          return buildSlidePrompt(text, pageIndex, pageCount, hasImage);
        },
      });
      const cards = sanitizeCards(parseJsonArray(raw));
      return { pageIndex, cards, imageDataUrl };
    }, (index, result, err) => {
      if (err) {
        send('slide-error', { page: index + 1, totalPages: pageCount, error: err.message });
      } else {
        send('slide', { page: index + 1, totalPages: pageCount, cards: result.cards, image: result.imageDataUrl });
      }
    });

    send('done', { totalPages: pageCount });
  } catch (err) {
    send('fatal-error', { error: err.message || 'Generation failed' });
  } finally {
    stopHeartbeat();
    res.end();
  }
});

app.post('/api/generate-quiz', requireAuth, generationLimiter.middleware, proGenerationLimiter, async (req, res) => {
  const cards = req.body?.cards;
  const difficulty = req.body?.difficulty === 'easy' ? 'easy' : 'hard';
  if (!Array.isArray(cards) || cards.length === 0) {
    return res.status(400).json({ error: 'No deck cards provided' });
  }

  let providerChain;
  try {
    providerChain = getProviderChain();
  } catch (err) {
    return res.status(400).json({ error: err.message || 'No LLM provider configured' });
  }

  let topics;
  try {
    topics = groupCardsByTopic(cards);
  } catch (err) {
    return res.status(400).json({ error: 'Could not read the deck cards' });
  }
  if (topics.length === 0) {
    return res.status(400).json({ error: 'No topics found in this deck' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const stopHeartbeat = startHeartbeat(res);

  send('start', { totalTopics: topics.length, providers: providerChain.map((p) => p.name) });

  try {
    await runWithConcurrency(topics, TOPIC_CONCURRENCY, async (topic) => {
      const raw = await generateWithFallback(providerChain, {
        buildPrompt: () => buildQuizPrompt(topic.name, topic.cards, difficulty),
      });
      const questions = sanitizeQuestions(parseJsonArray(raw));
      if (questions.length === 0) throw new Error('Model returned no valid questions for this topic');
      return { topic: topic.name, questions };
    }, (index, result, err) => {
      const topicName = topics[index].name;
      if (err) {
        send('topic-error', { topic: topicName, error: err.message });
      } else {
        send('topic', { topic: topicName, questions: result.questions });
      }
    });

    send('done', { totalTopics: topics.length });
  } catch (err) {
    send('fatal-error', { error: err.message || 'Quiz generation failed' });
  } finally {
    stopHeartbeat();
    res.end();
  }
});

app.post('/api/chat', requireAuth, chatLimiter.middleware, proChatLimiter, async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'No message provided' });

  let providerChain;
  try {
    providerChain = getProviderChain();
  } catch (err) {
    return res.status(400).json({ error: err.message || 'No LLM provider configured' });
  }

  const history = sanitizeHistory(req.body?.history);

  try {
    const reply = await generateWithFallback(providerChain, {
      buildPrompt: () => buildChatPrompt(message, history),
    });
    res.json({ reply: reply.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Chat request failed' });
  }
});

app.post('/api/billing/checkout', requireAuth, async (req, res) => {
  if (!billingConfigured || !adminConfigured) return res.status(503).json({ error: 'Billing is not configured' });
  try {
    const url = await createCheckoutSession(req.user);
    res.json({ url });
  } catch (err) {
    console.error('Failed to create checkout session:', err);
    res.status(500).json({ error: 'Could not start checkout' });
  }
});

app.post('/api/billing/portal', requireAuth, async (req, res) => {
  if (!billingConfigured || !adminConfigured) return res.status(503).json({ error: 'Billing is not configured' });
  try {
    const url = await createPortalSession(req.user);
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not open the billing portal' });
  }
});

app.get('/api/billing/status', requireAuth, async (req, res) => {
  if (!adminConfigured) return res.status(503).json({ error: 'Billing is not configured' });
  try {
    const status = await getBillingStatus(req.user.id);
    res.json(status);
  } catch (err) {
    console.error('Failed to load billing status:', err);
    res.status(500).json({ error: 'Could not load billing status' });
  }
});

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, rateLimit: { ...limitsSummary(), exemptUsers: exemptCount() }, billingConfigured })
);

// Catch-all error handler. Without this, multer's LIMIT_FILE_SIZE (and anything else
// thrown in middleware) fell through to Express's default handler and returned a 500
// HTML page instead of a useful status.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)` });
  }
  console.error('Unhandled request error:', err);
  if (res.headersSent) return res.end();
  res.status(500).json({ error: 'Something went wrong handling that request' });
});

// Last-resort guards: a single malformed request must never be able to take the whole
// service down for everyone. Node's default behaviour on an unhandled rejection is to
// terminate the process, which is exactly the DoS we want to avoid here.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (kept process alive):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (kept process alive):', err);
});

const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`MedFlash server listening on http://localhost:${port}`));

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
import { buildQuizPrompt, groupCardsForQuiz, excludeTopics, generateTopicQuestions } from './quiz.js';
import { buildSlidePrompt } from './slides.js';
import { buildAnatomyLabelPrompt, extractAnatomyPage } from './anatomy.js';
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
const ANATOMY_CONCURRENCY = 2;
const QUIZ_MAX_OUTPUT_TOKENS = 8192;
// The quiz zooms into a crop of each page, so it needs more pixels than a whole-slide
// flashcard image does (see extractPage). Roughly 2.4x the bytes per page at this setting.
const ANATOMY_RENDER = { scale: 3, jpegQuality: 72, jpegOnly: true };
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
    topics = groupCardsForQuiz(cards);
  } catch (err) {
    return res.status(400).json({ error: 'Could not read the deck cards' });
  }
  if (topics.length === 0) {
    return res.status(400).json({ error: 'No topics found in this deck' });
  }
  // Topics the student has told the quiz to skip stay skipped when they generate another
  // difficulty. The grouping is deterministic for a given deck, so names match across sets.
  topics = excludeTopics(topics, req.body?.skipTopics);
  if (topics.length === 0) {
    return res.status(400).json({ error: 'Every topic in this deck has been skipped, so there is nothing to generate.' });
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
      const questions = await generateTopicQuestions(() =>
        generateWithFallback(providerChain, {
          purpose: 'quiz',
          // Room for 5 questions with explanations and memory aids, and for models that spend part
          // of their budget thinking before they answer.
          maxOutputTokens: QUIZ_MAX_OUTPUT_TOKENS,
          buildPrompt: () => buildQuizPrompt(topic.name, topic.cards, difficulty),
        })
      );
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

// Anatomy Quiz: labels on these diagrams are baked into the page's raster image (no
// separate PDF text layer for them — confirmed by inspecting real sample pages), so this
// needs a vision call per page rather than the text-first approach /api/generate-stream
// uses. Same SSE/concurrency shape as the two routes above; charges the same 'generation'
// usage unit via proGenerationLimiter (once per request, not per page — identical cost
// shape to a flashcard upload of the same page count).
app.post('/api/generate-anatomy-stream', requireAuth, generationLimiter.middleware, proGenerationLimiter, upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (!/\.pdf$/i.test(req.file.originalname || '')) {
    return res.status(400).json({ error: 'Anatomy Quiz only supports PDF files.' });
  }

  let providerChain;
  let source;
  try {
    providerChain = getProviderChain();
    if (!providerChain.some((p) => p.supportsVision())) {
      return res.status(400).json({ error: 'Anatomy Quiz needs a vision-capable AI provider (Gemini) configured on the server.' });
    }
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

  try {
    await runWithConcurrency(pageIndexes, ANATOMY_CONCURRENCY, async (pageIndex) => {
      const { imageDataUrl } = source.getPage(pageIndex, ANATOMY_RENDER);
      if (!imageDataUrl) return { pageIndex, labels: [], diagrams: [], imageDataUrl: null };

      const { labels, diagrams } = await extractAnatomyPage(() =>
        generateWithFallback(providerChain, {
          imageDataUrl,
          buildPrompt: (hasImage) => (hasImage ? buildAnatomyLabelPrompt(pageIndex, pageCount) : null),
        })
      );
      return { pageIndex, labels, diagrams, imageDataUrl };
    }, (index, result, err) => {
      if (err) {
        send('page-error', { page: index + 1, totalPages: pageCount, error: err.message });
      } else if (result.labels.length > 0) {
        send('page', {
          page: index + 1,
          totalPages: pageCount,
          labels: result.labels,
          diagrams: result.diagrams,
          image: result.imageDataUrl,
        });
      } else {
        send('page-skipped', { page: index + 1, totalPages: pageCount });
      }
    });

    send('done', { totalPages: pageCount });
  } catch (err) {
    send('fatal-error', { error: err.message || 'Anatomy label extraction failed' });
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

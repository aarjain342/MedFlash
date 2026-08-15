import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { getProviderChain } from './providers/index.js';
import { openPdf, extractPage } from './pdf.js';
import { runWithConcurrency } from './concurrency.js';
import { requireAuth } from './auth.js';
import { generateWithFallback, parseJsonArray } from './llm.js';
import { buildQuizPrompt, groupCardsByTopic } from './quiz.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '15mb' })); // deck JSON for quiz generation can carry a lot of card text

const SLIDE_CONCURRENCY = 2;
const TOPIC_CONCURRENCY = 3;

function buildSlidePrompt(text, pageIndex, totalPages, hasImage) {
  const slideText = text || '(no extractable text on this slide)';
  const imageNote = hasImage
    ? '\nAn image of the slide is also attached — use it to read any diagrams, charts, labeled figures, or text that the extracted text above missed. If the slide is primarily a diagram/figure, base the flashcard(s) on what the image shows.'
    : '';
  return `You are making Anki-style flashcards for a first-year medical student, from ONE slide of a lecture deck (slide ${pageIndex + 1} of ${totalPages}).

Slide text (extracted from the PDF):
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

app.post('/api/generate-stream', requireAuth, upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });

  let providerChain;
  let doc;
  let pageCount;
  try {
    providerChain = getProviderChain();
    ({ doc, pageCount } = openPdf(req.file.buffer));
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to open PDF' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  send('start', { totalPages: pageCount, providers: providerChain.map((p) => p.name) });

  const pageIndexes = Array.from({ length: pageCount }, (_, i) => i);
  const anyVision = providerChain.some((p) => p.supportsVision());

  try {
    await runWithConcurrency(pageIndexes, SLIDE_CONCURRENCY, async (pageIndex) => {
      const { text, imageDataUrl } = extractPage(doc, pageIndex);
      if (!text && !anyVision) return { pageIndex, cards: [], imageDataUrl };

      const raw = await generateWithFallback(providerChain, {
        imageDataUrl,
        buildPrompt: (hasImage) => {
          if (!text && !hasImage) return null;
          return buildSlidePrompt(text, pageIndex, pageCount, hasImage);
        },
      });
      const cards = parseJsonArray(raw);
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
    res.end();
  }
});

app.post('/api/generate-quiz', requireAuth, async (req, res) => {
  const cards = req.body?.cards;
  if (!Array.isArray(cards) || cards.length === 0) {
    return res.status(400).json({ error: 'No deck cards provided' });
  }

  let providerChain;
  try {
    providerChain = getProviderChain();
  } catch (err) {
    return res.status(400).json({ error: err.message || 'No LLM provider configured' });
  }

  const topics = groupCardsByTopic(cards);
  if (topics.length === 0) {
    return res.status(400).json({ error: 'No topics found in this deck' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  send('start', { totalTopics: topics.length, providers: providerChain.map((p) => p.name) });

  try {
    await runWithConcurrency(topics, TOPIC_CONCURRENCY, async (topic) => {
      const raw = await generateWithFallback(providerChain, {
        buildPrompt: () => buildQuizPrompt(topic.name, topic.cards),
      });
      const questions = parseJsonArray(raw);
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
    res.end();
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`MedFlash server listening on http://localhost:${port}`));

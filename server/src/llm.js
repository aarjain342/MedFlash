import { createRateLimiter } from './rateLimiter.js';

const RETRIES_PER_MODEL = 2;
const MIN_REQUEST_INTERVAL_MS = Number(process.env.LLM_MIN_INTERVAL_MS) || 2500;

// One shared limiter for the whole server: the API key's rate limit is global,
// not per-request, so every LLM call (slides, quiz questions, concurrent decks) queues here.
const acquireSlot = createRateLimiter(MIN_REQUEST_INTERVAL_MS);

function dataUrlToImagePart(imageDataUrl) {
  const match = imageDataUrl.match(/^data:([^;]+);base64,(.*)$/s);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

function parseSuggestedRetryMs(message) {
  const match = /retry in (\d+(?:\.\d+)?)s/i.exec(message || '');
  return match ? Math.ceil(parseFloat(match[1]) * 1000) + 750 : null;
}

// Walks the full provider chain (e.g. ~10 Gemini models, then Groq's models as a
// last-resort fallback from a completely separate vendor with its own quota). A
// quota/rate-limit error moves on immediately — retrying the same exhausted quota just
// wastes time. Only transient errors (overloaded/5xx) get a couple of retries first.
//
// `buildPrompt(hasImage)` returns the prompt string for a given provider, or null/falsy
// to skip that provider entirely (e.g. no text and no image to work with). `imageDataUrl`
// is optional — omit it for text-only generation (quiz questions), since vision support
// is only relevant when there's actually an image to attach (slide generation).
export async function generateWithFallback(providers, { imageDataUrl, buildPrompt }) {
  let lastErr;

  for (const provider of providers) {
    const image = imageDataUrl && provider.supportsVision() ? dataUrlToImagePart(imageDataUrl) : null;
    const prompt = buildPrompt(!!image);
    if (!prompt) continue;

    const models = provider.modelFallbackChain ? provider.modelFallbackChain() : [undefined];
    for (const model of models) {
      for (let attempt = 0; attempt < RETRIES_PER_MODEL; attempt++) {
        try {
          await acquireSlot();
          return await provider.generateText(prompt, { image, model });
        } catch (err) {
          lastErr = err;
          const isTransient = /overloaded|502|503|504/i.test(err.message || '');

          if (isTransient && attempt < RETRIES_PER_MODEL - 1) {
            const suggested = parseSuggestedRetryMs(err.message);
            await new Promise((r) => setTimeout(r, suggested ?? 1500 * 2 ** attempt));
            continue; // retry the same model
          }
          break; // give up on this model (quota exhausted, or out of retries) — try the next one
        }
      }
    }
  }
  throw lastErr;
}

export function parseJsonArray(raw) {
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Model did not return parseable JSON');
  return JSON.parse(jsonMatch[0]);
}

function asText(value, max = 3000) {
  if (typeof value === 'string') return value.slice(0, max).trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function sanitizeTable(table) {
  if (!table || typeof table !== 'object') return null;
  if (!Array.isArray(table.headers) || !Array.isArray(table.rows)) return null;
  const headers = table.headers.slice(0, 12).map((h) => asText(h, 120));
  const rows = table.rows.slice(0, 30).map((row) => (Array.isArray(row) ? row.slice(0, 12).map((cell) => asText(cell, 300)) : []));
  if (headers.length === 0 || rows.length === 0) return null;
  return { headers, rows };
}

// Caps every field's size and coerces types before a card ever reaches the client/deck
// JSONB — a verbose or malformed model response (more likely from weaker fallback models)
// used to flow straight into the saved deck uncapped, which was a real contributor to
// Supabase "statement timeout" errors on save for large decks. Mirrors the asText/
// sanitizeQuestions pattern in quiz.js, which exists for the same class of problem.
export function sanitizeCards(cards) {
  if (!Array.isArray(cards)) return [];
  return cards
    .filter((c) => c && typeof c === 'object')
    .map((c) => ({
      question: asText(c.question, 600),
      answer: asText(c.answer, 3000),
      table: sanitizeTable(c.table),
      mnemonic: asText(c.mnemonic, 400),
      topic: asText(c.topic, 120),
    }))
    .filter((c) => c.question && c.answer);
}

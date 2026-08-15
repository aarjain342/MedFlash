// Groq is a separate vendor from Gemini, so its rate limits are completely independent —
// used as a last-resort fallback when every Gemini model in the chain is exhausted.
// None of these models support vision, so image input is just dropped when this provider
// is used; cards for image-heavy slides will lean on whatever text was extracted.
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

const FALLBACK_MODELS = [
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant',
  'qwen/qwen3.6-27b',
  'groq/compound',
  'groq/compound-mini',
];

export function modelFallbackChain() {
  const configured = process.env.GROQ_MODEL || DEFAULT_MODEL;
  return [configured, ...FALLBACK_MODELS.filter((m) => m !== configured)];
}

export async function generateText(prompt, { model } = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('Server missing GROQ_API_KEY');

  const useModel = model || process.env.GROQ_MODEL || DEFAULT_MODEL;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: useModel,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Groq request failed with status ${res.status}`);
  }

  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('Groq returned an empty response');
  return text;
}

export function supportsVision() {
  return false;
}

const DEFAULT_MODEL = 'gemini-flash-lite-latest';

// Each Gemini model has its own free-tier quota pool, so when one gets rate-limited,
// switching to another lets generation keep going instead of stalling. Ordered roughly
// lite/fast-first (cheapest quota, best fit for this workload) with sturdier models later.
const FALLBACK_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-pro-latest',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
];

export function modelFallbackChain() {
  const configured = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  return [configured, ...FALLBACK_MODELS.filter((m) => m !== configured)];
}

export async function generateText(prompt, { image, model } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Server missing GEMINI_API_KEY');

  const useModel = model || process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${apiKey}`;

  const parts = [{ text: prompt }];
  if (image) {
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      // Without a cap, a rambling response (especially from weaker fallback models) can
      // run to tens of thousands of characters for a single slide — which then lands
      // straight in the deck's cards JSONB and was a real cause of Supabase statement
      // timeouts on save. This bounds each slide's response to comfortably more than the
      // 2-3 well-formed cards the prompt asks for.
      generationConfig: { maxOutputTokens: 4096 },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Gemini request failed with status ${res.status}`);
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  if (!text) throw new Error('Gemini returned an empty response');
  return text;
}

export function supportsVision() {
  return true;
}

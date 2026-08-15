const DEFAULT_MODEL = 'llama3.1';
const DEFAULT_BASE_URL = 'http://localhost:11434';

const VISION_MODEL_HINTS = ['vision', 'llava', 'bakllava', 'moondream'];

export function modelSupportsVision() {
  const model = (process.env.OLLAMA_MODEL || DEFAULT_MODEL).toLowerCase();
  return VISION_MODEL_HINTS.some((hint) => model.includes(hint));
}

export async function generateText(prompt, { image } = {}) {
  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL;
  const model = process.env.OLLAMA_MODEL || DEFAULT_MODEL;

  const body = { model, prompt, stream: false };
  if (image && modelSupportsVision()) body.images = [image.data];

  let res;
  try {
    res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `Could not reach Ollama at ${baseUrl}. Is it running? (ollama serve). Original error: ${err.message}`
    );
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Ollama request failed with status ${res.status}`);
  }

  const text = data?.response || '';
  if (!text) throw new Error('Ollama returned an empty response');
  return text;
}

export const supportsVision = modelSupportsVision;

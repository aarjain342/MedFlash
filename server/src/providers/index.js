import * as gemini from './gemini.js';
import * as ollama from './ollama.js';
import * as groq from './groq.js';

const providers = { gemini, ollama, groq };

export function getProvider() {
  const name = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
  const provider = providers[name];
  if (!provider) {
    throw new Error(`Unknown LLM_PROVIDER "${name}". Use "gemini", "groq", or "ollama".`);
  }
  return { name, ...provider };
}

const isConfigured = {
  gemini: () => Boolean(process.env.GEMINI_API_KEY),
  groq: () => Boolean(process.env.GROQ_API_KEY),
  ollama: () => false, // local-only; never a viable automatic fallback on a hosted backend
};

// Primary provider first, then any other configured hosted provider as a last-resort
// fallback — different vendors have independent quotas, so if the primary's entire
// model chain is exhausted, this gives generation somewhere else to go.
export function getProviderChain() {
  const primary = getProvider();
  const chain = [primary];
  for (const name of Object.keys(providers)) {
    if (name === primary.name) continue;
    if (!isConfigured[name]()) continue;
    chain.push({ name, ...providers[name] });
  }
  return chain;
}

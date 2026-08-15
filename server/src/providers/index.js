import * as gemini from './gemini.js';
import * as ollama from './ollama.js';

const providers = { gemini, ollama };

export function getProvider() {
  const name = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
  const provider = providers[name];
  if (!provider) {
    throw new Error(`Unknown LLM_PROVIDER "${name}". Use "gemini" or "ollama".`);
  }
  return { name, ...provider };
}

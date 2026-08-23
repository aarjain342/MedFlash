import { supabase, supabaseConfigured } from './supabaseClient';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8787';

// `history` is [{ role: 'user'|'assistant', content: string }, ...] — the last few turns,
// sent so the assistant has conversational context. Returns the reply text.
export async function sendChatMessage(message, history) {
  const headers = { 'Content-Type': 'application/json' };
  if (supabaseConfigured) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('You need to be signed in to use the assistant.');
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message, history }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed with status ${res.status}`);
  return body.reply;
}

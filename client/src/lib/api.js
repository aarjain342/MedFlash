import { supabase, supabaseConfigured } from './supabaseClient';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8787';

// Free-tier hosts (e.g. Render) spin the backend down after inactivity — the first
// request after a while can take 30-60s just to wake it up, and while the container is
// still binding its port the very first ping can flat-out fail (connection refused /
// Cloudflare 502) rather than just be slow. Ping /api/health first, retrying through that
// startup window, so the UI can show a "waking up" message instead of surfacing a bare
// "Failed to fetch" for what's really just a cold start.
const WAKE_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 8000, 8000]; // ~31s total budget

export async function waitForServer(onSlowStart) {
  const slowTimer = setTimeout(() => onSlowStart?.(), 1500);
  let lastErr;
  try {
    for (let attempt = 0; attempt <= WAKE_RETRY_DELAYS_MS.length; attempt++) {
      try {
        const res = await fetch(`${API_BASE}/api/health`);
        if (!res.ok) throw new Error(`Server responded with status ${res.status}`);
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < WAKE_RETRY_DELAYS_MS.length) {
          await new Promise((r) => setTimeout(r, WAKE_RETRY_DELAYS_MS[attempt]));
        }
      }
    }
    throw new Error(`Couldn't reach the flashcard server: ${lastErr.message}`);
  } finally {
    clearTimeout(slowTimer);
  }
}

// Streams flashcard generation progress from the server (one SSE "slide" event per PDF page).
// `onEvent` is called with { type, data } for each event: start | slide | slide-error | done | fatal-error.
export async function generateFlashcardsStream(file, onEvent, { signal } = {}) {
  const headers = {};
  if (supabaseConfigured) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('You need to be signed in to generate flashcards.');
    headers.Authorization = `Bearer ${token}`;
  }

  const formData = new FormData();
  formData.append('pdf', file);

  const res = await fetch(`${API_BASE}/api/generate-stream`, {
    method: 'POST',
    headers,
    body: formData,
    signal,
  });

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed with status ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIndex;
    while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);

      const lines = chunk.split('\n');
      const eventLine = lines.find((l) => l.startsWith('event:'));
      const dataLine = lines.find((l) => l.startsWith('data:'));
      if (!eventLine || !dataLine) continue;

      const type = eventLine.slice(6).trim();
      let data;
      try {
        data = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue;
      }
      onEvent({ type, data });
    }
  }
}

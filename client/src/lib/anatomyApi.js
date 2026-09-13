import { supabase, supabaseConfigured } from './supabaseClient';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8787';

// Streams Anatomy Quiz label extraction from the server (one SSE event per PDF page).
// Structural copy of generateFlashcardsStream in api.js — same auth/SSE-parsing shape,
// different endpoint and event set: start | page | page-skipped | page-error | done | fatal-error.
export async function generateAnatomyStream(file, onEvent, { signal } = {}) {
  const headers = {};
  if (supabaseConfigured) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('You need to be signed in to generate an anatomy quiz.');
    headers.Authorization = `Bearer ${token}`;
  }

  const formData = new FormData();
  formData.append('pdf', file);

  const res = await fetch(`${API_BASE}/api/generate-anatomy-stream`, {
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

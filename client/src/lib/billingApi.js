import { supabase, supabaseConfigured } from './supabaseClient';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8787';

async function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (supabaseConfigured) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('You need to be signed in to manage billing.');
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function postJson(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed with status ${res.status}`);
  return data;
}

export async function getBillingStatus() {
  const res = await fetch(`${API_BASE}/api/billing/status`, { headers: await authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed with status ${res.status}`);
  return data;
}

export async function startCheckout(interval) {
  const { url } = await postJson('/api/billing/checkout', { interval });
  return url;
}

export async function openBillingPortal() {
  const { url } = await postJson('/api/billing/portal');
  return url;
}

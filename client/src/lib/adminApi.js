import { supabase, supabaseConfigured } from './supabaseClient';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8787';

async function authHeaders() {
  const headers = {};
  if (supabaseConfigured) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Sign in again to view the admin dashboard.');
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function get(path, { fresh = false } = {}) {
  const url = `${API_BASE}${path}${fresh ? `${path.includes('?') ? '&' : '?'}fresh=1` : ''}`;
  const res = await fetch(url, { headers: await authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) throw new Error('This account is not an admin.');
  if (!res.ok) throw new Error(data.error || `Request failed with status ${res.status}`);
  return data;
}

// Asks the server whether the signed-in user is an admin. The answer is only used to decide
// whether to SHOW the Admin tab; every admin endpoint enforces it again on the server, so this
// can't be used to gain access. Any failure just means "not an admin" and the tab stays hidden.
export async function getAdminMe() {
  try {
    const data = await get('/api/admin/me');
    return Boolean(data.isAdmin);
  } catch {
    return false;
  }
}

export const getAdminOverview = (opts) => get('/api/admin/overview', opts);
export const getAdminUsers = (opts) => get('/api/admin/users', opts);
export const getAdminPayments = (opts) => get('/api/admin/payments', opts);
export const getAdminSystem = (opts) => get('/api/admin/system', opts);
export const getAdminUser = (id, opts) => get(`/api/admin/users/${encodeURIComponent(id)}`, opts);

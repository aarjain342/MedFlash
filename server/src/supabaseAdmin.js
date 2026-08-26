import { createClient } from '@supabase/supabase-js';

// Separate from auth.js's client on purpose: that one only ever verifies user JWTs
// (anon key, no write access). Billing needs to write subscriptions/usage_counters from
// contexts with no user request at all (the Stripe webhook), so it needs the service role
// key, which bypasses RLS. Never reuse this client for anything a user-scoped request
// could do instead.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const adminConfigured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

if (!adminConfigured) {
  console.warn('SUPABASE_SERVICE_ROLE_KEY not set — billing routes will respond 503.');
}

export const supabaseAdmin = adminConfigured
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

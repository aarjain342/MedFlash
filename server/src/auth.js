import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const authConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let supabase;
function getSupabase() {
  if (!supabase) supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return supabase;
}

if (!authConfigured) {
  console.warn(
    'SUPABASE_URL/SUPABASE_ANON_KEY not set — running with auth DISABLED, every request is treated as authorized. Set both to require sign-in.'
  );
}

export async function requireAuth(req, res, next) {
  if (!authConfigured) return next();

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in required' });

  try {
    const { data, error } = await getSupabase().auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ error: 'Invalid or expired session' });
    req.user = data.user;
    next();
  } catch (err) {
    res.status(500).json({ error: `Auth check failed: ${err.message}` });
  }
}

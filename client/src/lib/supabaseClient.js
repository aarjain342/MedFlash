import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

if (!supabaseConfigured) {
  console.warn('Supabase env vars missing — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in client/.env');
}

// Falls back to a syntactically-valid placeholder so createClient() doesn't throw at import time
// when env vars aren't set yet — auth calls will just fail with a clear error until they are.
export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder');

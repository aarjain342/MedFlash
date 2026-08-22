// Per-user rate limiting for the expensive LLM endpoints.
//
// Keyed on the authenticated Supabase user id (falling back to IP when auth is disabled
// for local dev), because that's the identity we can actually trust — IPs are shared
// behind NAT and trivially rotated. Two windows run together: a short one to stop bursts
// and a daily one to stop slow, sustained quota drain.
//
// State is in-memory. That's a deliberate fit for a single Render instance: it resets on
// restart/spin-down, which is acceptable here, but it would need Redis (or Postgres) if
// the backend is ever scaled to more than one instance, since each would count separately.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const HOURLY_LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR) || 12;
const DAILY_LIMIT = Number(process.env.RATE_LIMIT_PER_DAY) || 40;

// Emails that bypass limits entirely. Set via env (comma-separated) rather than hardcoded,
// because this repo is public and committing personal addresses invites scraping/spam.
const EXEMPT_EMAILS = new Set(
  (process.env.RATE_LIMIT_EXEMPT_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

// Exposed for the health check so a misconfigured allowlist is visible without having to
// sign in as an exempt user. Deliberately a count, never the addresses themselves.
export function exemptCount() {
  return EXEMPT_EMAILS.size;
}

export function limitsSummary() {
  return { perHour: HOURLY_LIMIT, perDay: DAILY_LIMIT };
}

/** @type {Map<string, number[]>} key -> ascending request timestamps */
const hits = new Map();

// Without this the map grows forever as new users appear — an unbounded-memory leak is
// its own denial-of-service vector.
const CLEANUP_INTERVAL_MS = HOUR_MS;
setInterval(() => {
  const cutoff = Date.now() - DAY_MS;
  for (const [key, times] of hits) {
    const kept = times.filter((t) => t > cutoff);
    if (kept.length === 0) hits.delete(key);
    else hits.set(key, kept);
  }
}, CLEANUP_INTERVAL_MS).unref?.();

function describeWindow(ms) {
  return ms >= DAY_MS ? 'today' : 'this hour';
}

export function rateLimit(req, res, next) {
  const email = (req.user?.email || '').toLowerCase();
  if (email && EXEMPT_EMAILS.has(email)) return next();

  const key = req.user?.id || `ip:${req.ip}`;
  const now = Date.now();
  const times = (hits.get(key) || []).filter((t) => t > now - DAY_MS);

  const inHour = times.filter((t) => t > now - HOUR_MS).length;
  const overDaily = times.length >= DAILY_LIMIT;
  const overHourly = inHour >= HOURLY_LIMIT;

  if (overDaily || overHourly) {
    const windowMs = overDaily ? DAY_MS : HOUR_MS;
    const relevant = overDaily ? times : times.filter((t) => t > now - HOUR_MS);
    const oldest = relevant[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    const limit = overDaily ? DAILY_LIMIT : HOURLY_LIMIT;

    hits.set(key, times); // persist the pruned list even when rejecting
    res.set('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      error: `You've hit the limit of ${limit} generations ${describeWindow(windowMs)}. Try again in about ${
        retryAfterSec >= 3600 ? `${Math.ceil(retryAfterSec / 3600)}h` : `${Math.ceil(retryAfterSec / 60)} min`
      }.`,
    });
  }

  times.push(now);
  hits.set(key, times);

  res.set('X-RateLimit-Limit-Hour', String(HOURLY_LIMIT));
  res.set('X-RateLimit-Remaining-Hour', String(Math.max(0, HOURLY_LIMIT - inHour - 1)));
  next();
}

// Owner-only admin dashboard API: every user, subscription, payment and usage counter.
//
// SECURITY MODEL — read before changing anything here.
//  * Authorization is decided here on the server and nowhere else. The client only learns
//    "am I an admin?" from /api/admin/me; no admin address is ever shipped in the bundle (this
//    repo is public, and HANDOFF.md already says never to hardcode emails).
//  * Admins are configured by env, never in code: ADMIN_EMAILS (comma-separated) and,
//    strongly recommended, ADMIN_USER_IDS. Email confirmation is currently OFF in Supabase
//    (mailer_autoconfirm), so an email alone is not proof of identity: if an admin account were
//    ever deleted, anyone could re-register that address and inherit admin. Pinning the user id
//    closes that. When ADMIN_USER_IDS is set, BOTH the email and the id must match.
//  * Fails closed: no ADMIN_EMAILS -> nobody is an admin. Auth disabled (local dev with no
//    Supabase) -> there is no req.user -> nobody is an admin.
//  * Read-only by design. Nothing in this file writes to Supabase or Stripe.
//  * Uses the service-role client (bypasses RLS), so it must only ever be reachable behind
//    requireAdmin. Responses are `Cache-Control: no-store` because they contain personal data.

import { supabaseAdmin, adminConfigured } from './supabaseAdmin.js';
import { stripe as stripeClient, billingConfigured } from './stripeClient.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 20_000;
const PAGE_SIZE = 1000;
const MAX_USERS = 20_000;
const MAX_STRIPE_ITEMS = 1000;
const PAYMENTS_SHOWN = 300;

// ---- Authorization ------------------------------------------------------------------------

function parseSet(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAdmin(user, env = process.env) {
  if (!user) return false;

  const emails = parseSet(env.ADMIN_EMAILS);
  if (emails.size === 0) return false; // not configured -> nobody

  const email = String(user.email || '').toLowerCase();
  if (!email || !emails.has(email)) return false;

  // Supabase only sets this once the address has been verified (or auto-confirmed).
  if (!(user.email_confirmed_at || user.confirmed_at)) return false;

  const ids = parseSet(env.ADMIN_USER_IDS);
  if (ids.size > 0 && !ids.has(String(user.id || '').toLowerCase())) return false;

  return true;
}

export function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Not authorized' });
  res.set('Cache-Control', 'no-store');
  next();
}

// ---- Small cache --------------------------------------------------------------------------
// The dashboard fires several requests at once and an admin will hit refresh a lot; each one
// would otherwise page through every user and every Stripe charge.

const cache = new Map();

export function clearAdminCache() {
  cache.clear();
}

async function cached(key, fn, ttl = CACHE_TTL_MS, now = Date.now()) {
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.promise;
  const promise = fn();
  cache.set(key, { promise, expires: now + ttl });
  promise.catch(() => cache.delete(key)); // never cache a failure
  return promise;
}

// ---- Loading from Supabase ----------------------------------------------------------------

// PostgREST silently caps a response at 1000 rows, so any "all rows" read has to page.
export async function fetchAllRows(buildQuery, { pageSize = PAGE_SIZE, cap = 100_000 } = {}) {
  const rows = [];
  for (let from = 0; from < cap; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

export async function listAllAuthUsers(supabase, { cap = MAX_USERS } = {}) {
  const users = [];
  for (let page = 1; users.length < cap; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw new Error(error.message);
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return users;
}

// Everything the dashboard needs from our own database, fetched once and reused by the overview
// and the user list. Deliberately selects only light columns: `decks.cards` and the anatomy
// `pages` hold megabytes of base64 images per row and must never be pulled for a listing.
export async function loadPlatformSnapshot(supabase) {
  const [authUsers, subscriptions, decks, anatomyDecks, quizzes, usage] = await Promise.all([
    listAllAuthUsers(supabase),
    fetchAllRows(() =>
      supabase
        .from('subscriptions')
        .select('user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end, updated_at')
        .order('user_id')
    ),
    fetchAllRows(() => supabase.from('decks').select('id, user_id, created_at').order('id')),
    fetchAllRows(() => supabase.from('anatomy_decks').select('id, user_id, created_at').order('id')),
    fetchAllRows(() => supabase.from('quizzes').select('deck_id, user_id, updated_at').order('deck_id')),
    fetchAllRows(() =>
      supabase
        .from('usage_counters')
        .select('user_id, month, generations_count, chat_count')
        .order('user_id')
        .order('month')
    ),
  ]);
  return { authUsers, subscriptions, decks, anatomyDecks, quizzes, usage };
}

// ---- Loading from Stripe ------------------------------------------------------------------

function stripeFailure(err) {
  console.error('Admin dashboard: Stripe request failed:', err?.type || '', err?.code || '', err?.message || err);
  // Stripe's own messages can embed a fragment of the API key, so never pass them through.
  if (err?.type === 'StripePermissionError') {
    return 'The Stripe key on the server is not allowed to read this (needs read access to charges and subscriptions).';
  }
  if (err?.code === 'resource_missing') {
    return "Stripe has no record of this customer in the account the server's key belongs to (a test-mode customer does not exist under a live key, and vice versa).";
  }
  return `Stripe request failed${err?.code ? ` (${err.code})` : ''}.`;
}

export async function loadStripeSnapshot(stripe) {
  if (!stripe) return { available: false, reason: 'Stripe is not configured on the server.', charges: [], subscriptions: [], errors: {} };

  const errors = {};
  const [charges, subscriptions] = await Promise.all([
    stripe.charges
      .list({ limit: 100 })
      .autoPagingToArray({ limit: MAX_STRIPE_ITEMS })
      .catch((err) => {
        errors.charges = stripeFailure(err);
        return [];
      }),
    stripe.subscriptions
      .list({ status: 'all', limit: 100 })
      .autoPagingToArray({ limit: MAX_STRIPE_ITEMS })
      .catch((err) => {
        errors.subscriptions = stripeFailure(err);
        return [];
      }),
  ]);

  return { available: true, charges, subscriptions, errors };
}

// Which Stripe account the server's key actually belongs to. Past incident (HANDOFF.md): the key,
// webhook and prices ended up in different Stripe accounts and checkout broke with a misleading
// "No such price". The account id is not a secret (it appears in dashboard URLs).
export async function loadStripeAccount(stripe) {
  if (!stripe) return { available: false, reason: 'Stripe is not configured on the server.' };
  try {
    const a = await stripe.accounts.retrieve();
    return { available: true, id: a.id, country: a.country || null, chargesEnabled: Boolean(a.charges_enabled), payoutsEnabled: Boolean(a.payouts_enabled) };
  } catch (err) {
    return { available: false, reason: stripeFailure(err) };
  }
}

// "test" / "live" — read off the objects themselves when there are any, else off the key prefix
// (the prefix only; the key is never exposed).
export function stripeMode(snapshot, env = process.env) {
  const livemode = snapshot.charges?.[0]?.livemode ?? snapshot.subscriptions?.[0]?.livemode;
  if (typeof livemode === 'boolean') return livemode ? 'live' : 'test';
  const key = String(env.STRIPE_SECRET_KEY || '');
  if (/^(sk|rk)_live_/.test(key)) return 'live';
  if (/^(sk|rk)_test_/.test(key)) return 'test';
  return 'unknown';
}

// ---- Pure aggregation (unit-tested; no I/O below this line) -------------------------------

const ACTIVE = new Set(['active', 'trialing']);

export function isProStatus(status) {
  return ACTIVE.has(status);
}

function addTo(map, key, amount) {
  map[key] = (map[key] || 0) + amount;
}

// Normalise a Stripe subscription's recurring price to a monthly amount in minor units.
export function monthlyAmount(subscription) {
  let total = 0;
  for (const item of subscription.items?.data || []) {
    const price = item.price;
    if (!price || typeof price.unit_amount !== 'number') continue;
    const interval = price.recurring?.interval;
    const count = price.recurring?.interval_count || 1;
    const perPeriod = price.unit_amount * (item.quantity || 1);
    const perMonth =
      interval === 'year' ? perPeriod / 12 / count
      : interval === 'week' ? (perPeriod * 52) / 12 / count
      : interval === 'day' ? (perPeriod * 365) / 12 / count
      : perPeriod / count; // month (and anything unexpected)
    total += perMonth;
  }
  return Math.round(total);
}

function customerEmailIndex(snapshot) {
  const emailById = new Map(snapshot.authUsers.map((u) => [u.id, u.email || null]));
  const byCustomer = new Map();
  for (const sub of snapshot.subscriptions) {
    if (sub.stripe_customer_id) {
      byCustomer.set(sub.stripe_customer_id, { userId: sub.user_id, email: emailById.get(sub.user_id) || null });
    }
  }
  return byCustomer;
}

export function mapCharge(charge, byCustomer) {
  const owner = byCustomer.get(typeof charge.customer === 'string' ? charge.customer : charge.customer?.id);
  return {
    id: charge.id,
    createdAt: new Date(charge.created * 1000).toISOString(),
    amount: charge.amount,
    amountRefunded: charge.amount_refunded || 0,
    currency: charge.currency,
    status: charge.status, // succeeded | pending | failed
    paid: Boolean(charge.paid),
    refunded: Boolean(charge.refunded),
    disputed: Boolean(charge.disputed),
    description: charge.description || null,
    failureMessage: charge.failure_message || null,
    email: owner?.email || charge.billing_details?.email || charge.receipt_email || null,
    userId: owner?.userId || null,
    customerId: typeof charge.customer === 'string' ? charge.customer : charge.customer?.id || null,
    receiptUrl: charge.receipt_url || null,
    livemode: Boolean(charge.livemode),
  };
}

export function mapSubscription(sub, byCustomer) {
  const owner = byCustomer.get(typeof sub.customer === 'string' ? sub.customer : sub.customer?.id);
  const price = sub.items?.data?.[0]?.price;
  const periodEnd = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end;
  return {
    id: sub.id,
    status: sub.status,
    email: owner?.email || sub.metadata?.email || null,
    userId: owner?.userId || sub.metadata?.user_id || null,
    amount: price?.unit_amount ?? null,
    currency: price?.currency || null,
    interval: price?.recurring?.interval || null,
    monthlyAmount: monthlyAmount(sub),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    createdAt: sub.created ? new Date(sub.created * 1000).toISOString() : null,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
    livemode: Boolean(sub.livemode),
  };
}

export function buildRevenue(stripeSnap, now = Date.now()) {
  if (!stripeSnap.available) {
    return { available: false, reason: stripeSnap.reason, errors: stripeSnap.errors || {} };
  }
  const gross = {};
  const refunded = {};
  const last30 = {};
  const mrr = {};
  let succeeded = 0;
  let failed = 0;
  let disputed = 0;

  for (const c of stripeSnap.charges) {
    if (c.status === 'failed') failed += 1;
    if (c.disputed) disputed += 1;
    if (c.paid && c.status === 'succeeded') {
      succeeded += 1;
      addTo(gross, c.currency, c.amount);
      addTo(refunded, c.currency, c.amount_refunded || 0);
      if (now - c.created * 1000 <= 30 * DAY_MS) addTo(last30, c.currency, c.amount - (c.amount_refunded || 0));
    }
  }

  let activeSubscribers = 0;
  let pastDue = 0;
  let canceling = 0;
  for (const s of stripeSnap.subscriptions) {
    const currency = s.items?.data?.[0]?.price?.currency;
    if (s.status === 'active') {
      activeSubscribers += 1;
      if (s.cancel_at_period_end) canceling += 1;
      if (currency) addTo(mrr, currency, monthlyAmount(s));
    } else if (s.status === 'past_due') {
      pastDue += 1;
    }
  }

  const net = {};
  for (const cur of Object.keys(gross)) net[cur] = gross[cur] - (refunded[cur] || 0);

  return {
    available: true,
    mode: stripeMode(stripeSnap),
    gross,
    refunded,
    net,
    last30Days: last30,
    mrr,
    activeSubscribers,
    pastDue,
    canceling,
    charges: { succeeded, failed, disputed, total: stripeSnap.charges.length },
    errors: stripeSnap.errors || {},
  };
}

function monthKey(now) {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// Our database grants Pro purely from subscriptions.status. That row is only ever written by the
// Stripe webhook, so two things can leave it lying:
//   - 'not_in_stripe': the row says active but the Stripe account the server is pointed at has no
//     such subscription (leftover test-mode rows under a live key, or a key/account mix-up). A live
//     webhook will never hear about a sandbox subscription ending, so these stay Pro indefinitely.
//   - 'period_expired': still active after its period ended, i.e. a renewal/cancel webhook was missed.
// Only judged when we really did list Stripe's subscriptions; an outage must not flag everyone.
export function billingIssueFor(sub, stripeSnap, now = Date.now()) {
  if (!sub || !isProStatus(sub.status)) return null;
  if (sub.current_period_end && Date.parse(sub.current_period_end) < now) return 'period_expired';
  const listed = stripeSnap?.available && !stripeSnap.errors?.subscriptions;
  if (listed && sub.stripe_subscription_id) {
    const known = new Set(stripeSnap.subscriptions.map((s) => s.id));
    if (!known.has(sub.stripe_subscription_id)) return 'not_in_stripe';
  }
  return null;
}

export function buildUsers(snapshot, stripeSnap, now = Date.now()) {
  const subByUser = new Map(snapshot.subscriptions.map((s) => [s.user_id, s]));
  const count = (rows) => {
    const m = new Map();
    for (const r of rows) m.set(r.user_id, (m.get(r.user_id) || 0) + 1);
    return m;
  };
  const decksBy = count(snapshot.decks);
  const anatomyBy = count(snapshot.anatomyDecks);
  const quizzesBy = count(snapshot.quizzes);

  const thisMonth = monthKey(now);
  const usageThisMonth = new Map();
  const usageLifetime = new Map();
  for (const u of snapshot.usage) {
    const life = usageLifetime.get(u.user_id) || { generations: 0, chat: 0 };
    life.generations += u.generations_count || 0;
    life.chat += u.chat_count || 0;
    usageLifetime.set(u.user_id, life);
    if (String(u.month).slice(0, 10) === thisMonth) {
      usageThisMonth.set(u.user_id, { generations: u.generations_count || 0, chat: u.chat_count || 0 });
    }
  }

  // Lifetime amount actually paid per customer (net of refunds), when Stripe is reachable.
  const byCustomer = customerEmailIndex(snapshot);
  const paidByUser = new Map();
  if (stripeSnap?.available) {
    for (const c of stripeSnap.charges) {
      if (!(c.paid && c.status === 'succeeded')) continue;
      const owner = byCustomer.get(typeof c.customer === 'string' ? c.customer : c.customer?.id);
      if (!owner) continue;
      const entry = paidByUser.get(owner.userId) || {};
      addTo(entry, c.currency, c.amount - (c.amount_refunded || 0));
      paidByUser.set(owner.userId, entry);
    }
  }

  return snapshot.authUsers.map((u) => {
    const sub = subByUser.get(u.id);
    const pro = isProStatus(sub?.status);
    return {
      id: u.id,
      email: u.email || null,
      createdAt: u.created_at || null,
      lastSignInAt: u.last_sign_in_at || null,
      confirmed: Boolean(u.email_confirmed_at || u.confirmed_at),
      provider: u.app_metadata?.provider || null,
      plan: pro ? 'pro' : 'free',
      billingIssue: billingIssueFor(sub, stripeSnap, now),
      subscriptionStatus: sub?.status || 'none',
      currentPeriodEnd: sub?.current_period_end || null,
      stripeCustomerId: sub?.stripe_customer_id || null,
      decks: decksBy.get(u.id) || 0,
      anatomyDecks: anatomyBy.get(u.id) || 0,
      quizzes: quizzesBy.get(u.id) || 0,
      usageThisMonth: usageThisMonth.get(u.id) || { generations: 0, chat: 0 },
      usageLifetime: usageLifetime.get(u.id) || { generations: 0, chat: 0 },
      paid: stripeSnap?.available ? paidByUser.get(u.id) || {} : null,
    };
  });
}

export function buildOverview(snapshot, stripeSnap, now = Date.now()) {
  const users = buildUsers(snapshot, stripeSnap, now);
  const within = (iso, days) => iso && now - Date.parse(iso) <= days * DAY_MS;

  // Signups per UTC day for the last 30 days, oldest first.
  const perDay = new Map();
  for (const u of users) if (u.createdAt) perDay.set(u.createdAt.slice(0, 10), (perDay.get(u.createdAt.slice(0, 10)) || 0) + 1);
  const signupsByDay = [];
  for (let i = 29; i >= 0; i -= 1) {
    const date = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
    signupsByDay.push({ date, count: perDay.get(date) || 0 });
  }

  const byStatus = {};
  for (const u of users) addTo(byStatus, u.subscriptionStatus, 1);

  const topUsage = [...users]
    .filter((u) => u.usageThisMonth.generations + u.usageThisMonth.chat > 0)
    .sort(
      (a, b) =>
        b.usageThisMonth.generations + b.usageThisMonth.chat - (a.usageThisMonth.generations + a.usageThisMonth.chat)
    )
    .slice(0, 8)
    .map((u) => ({ id: u.id, email: u.email, ...u.usageThisMonth }));

  const decksNew7d = snapshot.decks.filter((d) => now - Number(d.created_at) <= 7 * DAY_MS).length;

  return {
    generatedAt: new Date(now).toISOString(),
    users: {
      total: users.length,
      confirmed: users.filter((u) => u.confirmed).length,
      unconfirmed: users.filter((u) => !u.confirmed).length,
      new7d: users.filter((u) => within(u.createdAt, 7)).length,
      new30d: users.filter((u) => within(u.createdAt, 30)).length,
      active7d: users.filter((u) => within(u.lastSignInAt, 7)).length,
      active30d: users.filter((u) => within(u.lastSignInAt, 30)).length,
      neverSignedIn: users.filter((u) => !u.lastSignInAt).length,
      signupsByDay,
    },
    plans: {
      pro: users.filter((u) => u.plan === 'pro').length,
      free: users.filter((u) => u.plan === 'free').length,
      byStatus,
      billingIssues: {
        not_in_stripe: users.filter((u) => u.billingIssue === 'not_in_stripe').length,
        period_expired: users.filter((u) => u.billingIssue === 'period_expired').length,
      },
    },
    content: {
      decks: snapshot.decks.length,
      decksNew7d,
      anatomyDecks: snapshot.anatomyDecks.length,
      quizzes: snapshot.quizzes.length,
    },
    usage: {
      month: monthKey(now),
      generations: users.reduce((n, u) => n + u.usageThisMonth.generations, 0),
      chat: users.reduce((n, u) => n + u.usageThisMonth.chat, 0),
      lifetimeGenerations: users.reduce((n, u) => n + u.usageLifetime.generations, 0),
      lifetimeChat: users.reduce((n, u) => n + u.usageLifetime.chat, 0),
      top: topUsage,
    },
    revenue: buildRevenue(stripeSnap, now),
  };
}

export function buildPayments(snapshot, stripeSnap) {
  if (!stripeSnap.available) {
    return { available: false, reason: stripeSnap.reason, charges: [], subscriptions: [], errors: stripeSnap.errors || {} };
  }
  const byCustomer = customerEmailIndex(snapshot);
  const charges = [...stripeSnap.charges]
    .sort((a, b) => b.created - a.created)
    .slice(0, PAYMENTS_SHOWN)
    .map((c) => mapCharge(c, byCustomer));
  const subscriptions = [...stripeSnap.subscriptions]
    .sort((a, b) => (b.created || 0) - (a.created || 0))
    .map((s) => mapSubscription(s, byCustomer));
  return {
    available: true,
    mode: stripeMode(stripeSnap),
    charges,
    subscriptions,
    truncated: stripeSnap.charges.length > PAYMENTS_SHOWN,
    errors: stripeSnap.errors || {},
  };
}

export function buildSystem(env = process.env, now = Date.now()) {
  const mem = process.memoryUsage();
  return {
    generatedAt: new Date(now).toISOString(),
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    memoryMb: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576) },
    // Booleans only. Never echo a key, a URL with credentials, or an admin address.
    configured: {
      supabaseAdmin: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
      stripe: Boolean(env.STRIPE_SECRET_KEY),
      stripeWebhookSecret: Boolean(env.STRIPE_WEBHOOK_SECRET),
      stripePrice: Boolean(env.STRIPE_PRICE_MONTHLY),
      gemini: Boolean(env.GEMINI_API_KEY),
      groq: Boolean(env.GROQ_API_KEY),
      adminEmails: parseSet(env.ADMIN_EMAILS).size,
      adminUserIdsPinned: parseSet(env.ADMIN_USER_IDS).size,
    },
    llmProvider: env.LLM_PROVIDER || 'gemini',
    stripeMode: /^(sk|rk)_live_/.test(String(env.STRIPE_SECRET_KEY || '')) ? 'live' : /^(sk|rk)_test_/.test(String(env.STRIPE_SECRET_KEY || '')) ? 'test' : 'unknown',
    frontendUrl: env.FRONTEND_URL || null,
  };
}

export async function buildUserDetail({ supabase, stripe }, userId) {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data?.user) return null;
  const u = data.user;

  const [subRes, usageRes, decksRes, anatomyRes, quizzesRes] = await Promise.all([
    supabase.from('subscriptions').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('usage_counters').select('month, generations_count, chat_count').eq('user_id', userId).order('month', { ascending: false }),
    supabase.from('decks').select('id, name, source_file, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
    supabase.from('anatomy_decks').select('id, name, source_file, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
    supabase.from('quizzes').select('deck_id, updated_at').eq('user_id', userId).order('updated_at', { ascending: false }),
  ]);
  for (const r of [subRes, usageRes, decksRes, anatomyRes, quizzesRes]) if (r.error) throw new Error(r.error.message);

  const sub = subRes.data;
  let payments = { available: false, charges: [], subscriptions: [], errors: {} };
  // Same judgement the user list makes, but from this customer's own Stripe data.
  let billingIssue = billingIssueFor(sub, undefined);
  if (stripe && sub?.stripe_customer_id) {
    const errors = {};
    let subsOutcome = { ok: false, error: null };
    const [charges, subscriptions] = await Promise.all([
      stripe.charges.list({ customer: sub.stripe_customer_id, limit: 50 }).then((r) => r.data).catch((e) => { errors.charges = stripeFailure(e); return []; }),
      stripe.subscriptions.list({ customer: sub.stripe_customer_id, status: 'all', limit: 20 })
        .then((r) => { subsOutcome = { ok: true, error: null }; return r.data; })
        .catch((e) => { subsOutcome = { ok: false, error: e }; errors.subscriptions = stripeFailure(e); return []; }),
    ]);
    const byCustomer = new Map([[sub.stripe_customer_id, { userId, email: u.email || null }]]);
    payments = {
      available: true,
      charges: charges.map((c) => mapCharge(c, byCustomer)),
      subscriptions: subscriptions.map((s) => mapSubscription(s, byCustomer)),
      errors,
    };
    if (subsOutcome.ok) {
      billingIssue = billingIssueFor(sub, { available: true, errors: {}, subscriptions }, Date.now());
    } else if (subsOutcome.error?.code === 'resource_missing' && isProStatus(sub.status) && billingIssue === null) {
      // Stripe says the customer itself does not exist in this account.
      billingIssue = 'not_in_stripe';
    }
  }

  return {
    id: u.id,
    email: u.email || null,
    phone: u.phone || null,
    createdAt: u.created_at || null,
    lastSignInAt: u.last_sign_in_at || null,
    confirmed: Boolean(u.email_confirmed_at || u.confirmed_at),
    provider: u.app_metadata?.provider || null,
    bannedUntil: u.banned_until || null,
    billingIssue,
    subscription: sub
      ? {
          plan: sub.plan,
          status: sub.status,
          currentPeriodEnd: sub.current_period_end,
          stripeCustomerId: sub.stripe_customer_id,
          stripeSubscriptionId: sub.stripe_subscription_id,
          updatedAt: sub.updated_at,
        }
      : null,
    usage: (usageRes.data || []).map((r) => ({ month: r.month, generations: r.generations_count, chat: r.chat_count })),
    decks: (decksRes.data || []).map((d) => ({ id: d.id, name: d.name, sourceFile: d.source_file, createdAt: Number(d.created_at) })),
    anatomyDecks: (anatomyRes.data || []).map((d) => ({ id: d.id, name: d.name, sourceFile: d.source_file, createdAt: Number(d.created_at) })),
    quizzes: (quizzesRes.data || []).map((q) => ({ deckId: q.deck_id, updatedAt: q.updated_at })),
    payments,
  };
}

// ---- HTTP wiring --------------------------------------------------------------------------

export function registerAdminRoutes(app, requireAuth) {
  const deps = () => ({ supabase: supabaseAdmin, stripe: billingConfigured ? stripeClient : null });

  const guard = (req, res, next) => {
    if (!adminConfigured) return res.status(503).json({ error: 'Admin data is not configured (missing service role key).' });
    next();
  };

  const wrap = (label, handler) => async (req, res) => {
    try {
      // The dashboard's Refresh button asks for ?fresh=1 to skip the short-lived cache.
      if (req.query?.fresh === '1') clearAdminCache();
      res.json(await handler(req, res));
    } catch (err) {
      if (res.headersSent) return;
      console.error(`Admin ${label} failed:`, err?.message || err);
      res.status(500).json({ error: 'Could not load admin data' });
    }
  };

  // Reveals nothing but a boolean, so the client can decide whether to show the Admin tab.
  app.get('/api/admin/me', requireAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ isAdmin: isAdmin(req.user) });
  });

  app.get('/api/admin/overview', requireAuth, requireAdmin, guard, wrap('overview', async () => {
    const { supabase, stripe } = deps();
    const [snapshot, stripeSnap] = await Promise.all([
      cached('platform', () => loadPlatformSnapshot(supabase)),
      cached('stripe', () => loadStripeSnapshot(stripe)),
    ]);
    return buildOverview(snapshot, stripeSnap);
  }));

  app.get('/api/admin/users', requireAuth, requireAdmin, guard, wrap('users', async () => {
    const { supabase, stripe } = deps();
    const [snapshot, stripeSnap] = await Promise.all([
      cached('platform', () => loadPlatformSnapshot(supabase)),
      cached('stripe', () => loadStripeSnapshot(stripe)),
    ]);
    return { generatedAt: new Date().toISOString(), users: buildUsers(snapshot, stripeSnap) };
  }));

  app.get('/api/admin/payments', requireAuth, requireAdmin, guard, wrap('payments', async () => {
    const { supabase, stripe } = deps();
    const [snapshot, stripeSnap] = await Promise.all([
      cached('platform', () => loadPlatformSnapshot(supabase)),
      cached('stripe', () => loadStripeSnapshot(stripe)),
    ]);
    return { generatedAt: new Date().toISOString(), ...buildPayments(snapshot, stripeSnap) };
  }));

  app.get('/api/admin/system', requireAuth, requireAdmin, wrap('system', async () => {
    const { stripe } = deps();
    return { ...buildSystem(), stripeAccount: await cached('stripe-account', () => loadStripeAccount(stripe)) };
  }));

  app.get('/api/admin/users/:id', requireAuth, requireAdmin, guard, async (req, res) => {
    // Validate before it reaches a query — this id comes straight from the URL.
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid user id' });
    try {
      const detail = await buildUserDetail(deps(), req.params.id);
      if (!detail) return res.status(404).json({ error: 'User not found' });
      res.json(detail);
    } catch (err) {
      console.error('Admin user detail failed:', err?.message || err);
      res.status(500).json({ error: 'Could not load admin data' });
    }
  });
}

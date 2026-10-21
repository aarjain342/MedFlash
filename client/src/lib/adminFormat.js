// Formatting and list helpers for the admin dashboard. Pure, so they're unit-tested; the
// dashboard itself only renders what these return.

// Stripe amounts are integers in the currency's smallest unit. Most currencies have 2 decimals,
// a handful have none (a ¥1500 charge is 1500, not 150000).
const ZERO_DECIMAL = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

export function formatMoney(minorUnits, currency = 'usd') {
  if (typeof minorUnits !== 'number' || Number.isNaN(minorUnits)) return '—';
  const code = String(currency || 'usd').toLowerCase();
  const value = ZERO_DECIMAL.has(code) ? minorUnits : minorUnits / 100;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code.toUpperCase() }).format(value);
  } catch {
    return `${value.toFixed(ZERO_DECIMAL.has(code) ? 0 : 2)} ${code.toUpperCase()}`;
  }
}

// { usd: 1500, eur: 200 } -> "$15.00 · €2.00". An empty map is "—" (nothing), not "$0.00".
export function formatMoneyMap(map) {
  const entries = Object.entries(map || {}).filter(([, v]) => typeof v === 'number' && v !== 0);
  if (entries.length === 0) return '—';
  return entries.map(([currency, amount]) => formatMoney(amount, currency)).join(' · ');
}

// Total across currencies is meaningless, so sorting by money uses the largest single-currency amount.
export function moneySortValue(map) {
  const values = Object.values(map || {}).filter((v) => typeof v === 'number');
  return values.length ? Math.max(...values) : 0;
}

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function relativeTime(iso, now = Date.now()) {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// Only ever link to an https URL — receipt links come from a third party's API response.
export function safeHttpsUrl(url) {
  return typeof url === 'string' && url.startsWith('https://') ? url : null;
}

// Short badge text for a billing discrepancy (see billingIssueFor on the server).
export function billingIssueLabel(issue) {
  if (issue === 'not_in_stripe') return 'Not in Stripe';
  if (issue === 'period_expired') return 'Period ended';
  return null;
}

export function billingIssueExplanation(issue, mode) {
  if (issue === 'not_in_stripe') {
    return `The database says this user is subscribed, but Stripe (${mode || 'current'} mode) has no matching subscription. They have Pro access with no payment on record. This usually means a leftover test-mode subscription, or the server's Stripe key belongs to a different account than the one the customer was created in.`;
  }
  if (issue === 'period_expired') {
    return 'This subscription is still marked active but its billing period has ended, so a renewal or cancellation webhook was probably missed.';
  }
  return null;
}

export function filterUsers(users, { query = '', plan = 'all' } = {}) {
  const q = query.trim().toLowerCase();
  return users.filter((u) => {
    if (plan === 'issues') {
      if (!u.billingIssue) return false;
    } else if (plan !== 'all' && u.plan !== plan) return false;
    if (!q) return true;
    return (u.email || '').toLowerCase().includes(q) || u.id.toLowerCase().startsWith(q);
  });
}

const SORTERS = {
  email: (u) => (u.email || '').toLowerCase(),
  plan: (u) => (u.plan === 'pro' ? 1 : 0),
  createdAt: (u) => Date.parse(u.createdAt) || 0,
  lastSignInAt: (u) => Date.parse(u.lastSignInAt) || 0,
  decks: (u) => u.decks,
  anatomyDecks: (u) => u.anatomyDecks,
  quizzes: (u) => u.quizzes,
  generations: (u) => u.usageThisMonth?.generations || 0,
  chat: (u) => u.usageThisMonth?.chat || 0,
  paid: (u) => moneySortValue(u.paid),
};

export function sortUsers(users, key = 'createdAt', direction = 'desc') {
  const accessor = SORTERS[key] || SORTERS.createdAt;
  const sign = direction === 'asc' ? 1 : -1;
  // Copy first: callers pass React state, which must never be sorted in place.
  return [...users].sort((a, b) => {
    const x = accessor(a);
    const y = accessor(b);
    if (x < y) return -1 * sign;
    if (x > y) return 1 * sign;
    return (a.email || '').localeCompare(b.email || '');
  });
}

export const USER_SORT_KEYS = Object.keys(SORTERS);

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatMoney,
  formatMoneyMap,
  moneySortValue,
  relativeTime,
  safeHttpsUrl,
  filterUsers,
  sortUsers,
  billingIssueLabel,
  billingIssueExplanation,
} from './adminFormat.js';

describe('formatMoney', () => {
  test('converts minor units to a currency string', () => {
    assert.equal(formatMoney(1500, 'usd'), '$15.00');
    assert.equal(formatMoney(5, 'usd'), '$0.05');
    assert.equal(formatMoney(1500), '$15.00'); // defaults to USD
  });

  // A ¥1500 charge arrives as 1500, so dividing by 100 would show ¥15 — a 100x understatement
  // of revenue on the one screen that exists to report it accurately.
  test('does not divide zero-decimal currencies', () => {
    assert.equal(formatMoney(1500, 'jpy'), '¥1,500');
  });

  test('shows a dash for missing or invalid amounts', () => {
    assert.equal(formatMoney(undefined), '—');
    assert.equal(formatMoney(null), '—');
    assert.equal(formatMoney(NaN), '—');
  });

  test('falls back instead of throwing on an unknown currency code', () => {
    assert.doesNotThrow(() => formatMoney(1500, 'not-a-currency'));
  });
});

describe('formatMoneyMap', () => {
  test('joins multiple currencies', () => {
    assert.equal(formatMoneyMap({ usd: 1500, eur: 200 }), '$15.00 · €2.00');
  });

  test('empty, zero and missing maps read as "nothing" rather than $0.00', () => {
    assert.equal(formatMoneyMap({}), '—');
    assert.equal(formatMoneyMap({ usd: 0 }), '—');
    assert.equal(formatMoneyMap(null), '—');
  });
});

describe('moneySortValue', () => {
  test('uses the largest single-currency amount and treats nothing as zero', () => {
    assert.equal(moneySortValue({ usd: 1500, eur: 4000 }), 4000);
    assert.equal(moneySortValue({}), 0);
    assert.equal(moneySortValue(null), 0);
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const ago = (ms) => new Date(now - ms).toISOString();

  test('buckets by unit', () => {
    assert.equal(relativeTime(ago(30 * 1000), now), 'just now');
    assert.equal(relativeTime(ago(5 * 60 * 1000), now), '5m ago');
    assert.equal(relativeTime(ago(3 * 3600 * 1000), now), '3h ago');
    assert.equal(relativeTime(ago(4 * 86400 * 1000), now), '4d ago');
    assert.equal(relativeTime(ago(65 * 86400 * 1000), now), '2mo ago');
    assert.equal(relativeTime(ago(800 * 86400 * 1000), now), '2y ago');
  });

  test('missing or invalid timestamps read as "never"; clock skew never goes negative', () => {
    assert.equal(relativeTime(null, now), 'never');
    assert.equal(relativeTime('garbage', now), 'never');
    assert.equal(relativeTime(new Date(now + 5000).toISOString(), now), 'just now');
  });
});

describe('safeHttpsUrl', () => {
  test('only passes https URLs through', () => {
    assert.equal(safeHttpsUrl('https://pay.stripe.com/receipts/x'), 'https://pay.stripe.com/receipts/x');
    assert.equal(safeHttpsUrl('http://insecure.example'), null);
    assert.equal(safeHttpsUrl('javascript:alert(1)'), null);
    assert.equal(safeHttpsUrl(undefined), null);
  });
});

describe('filterUsers / sortUsers', () => {
  const users = [
    { id: 'aaa111', email: 'Zed@x.com', plan: 'free', createdAt: '2026-01-01T00:00:00Z', lastSignInAt: null, decks: 1, anatomyDecks: 0, quizzes: 0, usageThisMonth: { generations: 2, chat: 0 }, paid: {} },
    { id: 'bbb222', email: 'amy@x.com', plan: 'pro', createdAt: '2026-03-01T00:00:00Z', lastSignInAt: '2026-10-01T00:00:00Z', decks: 5, anatomyDecks: 1, quizzes: 2, usageThisMonth: { generations: 9, chat: 3 }, paid: { usd: 1500 } },
    { id: 'ccc333', email: 'bob@x.com', plan: 'free', createdAt: '2026-02-01T00:00:00Z', lastSignInAt: '2026-09-01T00:00:00Z', decks: 3, anatomyDecks: 0, quizzes: 1, usageThisMonth: { generations: 0, chat: 1 }, paid: null },
  ];

  test('filters by email substring (case-insensitive), id prefix, and plan', () => {
    assert.deepEqual(filterUsers(users, { query: 'ZED' }).map((u) => u.id), ['aaa111']);
    assert.deepEqual(filterUsers(users, { query: 'bbb' }).map((u) => u.id), ['bbb222']);
    assert.deepEqual(filterUsers(users, { plan: 'pro' }).map((u) => u.id), ['bbb222']);
    assert.equal(filterUsers(users, {}).length, 3);
    assert.equal(filterUsers(users, { query: 'nobody' }).length, 0);
  });

  test('sorts by each kind of column in both directions', () => {
    assert.deepEqual(sortUsers(users, 'email', 'asc').map((u) => u.id), ['bbb222', 'ccc333', 'aaa111']);
    assert.deepEqual(sortUsers(users, 'createdAt', 'desc').map((u) => u.id), ['bbb222', 'ccc333', 'aaa111']);
    assert.deepEqual(sortUsers(users, 'decks', 'desc').map((u) => u.id), ['bbb222', 'ccc333', 'aaa111']);
    assert.deepEqual(sortUsers(users, 'generations', 'desc').map((u) => u.id), ['bbb222', 'aaa111', 'ccc333']);
    assert.deepEqual(sortUsers(users, 'paid', 'desc')[0].id, 'bbb222');
    assert.deepEqual(sortUsers(users, 'plan', 'desc')[0].id, 'bbb222');
  });

  test('"never signed in" sorts as the oldest, not as an error', () => {
    assert.equal(sortUsers(users, 'lastSignInAt', 'asc')[0].id, 'aaa111');
  });

  test('does not mutate the array it is given (it is React state)', () => {
    const copy = [...users];
    sortUsers(users, 'email', 'asc');
    assert.deepEqual(users, copy);
  });

  test('an unknown sort key falls back to join date instead of throwing', () => {
    assert.doesNotThrow(() => sortUsers(users, 'bogus', 'asc'));
  });
});

describe('billing issues', () => {
  test('labels each discrepancy and ignores anything else', () => {
    assert.equal(billingIssueLabel('not_in_stripe'), 'Not in Stripe');
    assert.equal(billingIssueLabel('period_expired'), 'Period ended');
    assert.equal(billingIssueLabel(null), null);
    assert.equal(billingIssueLabel('something_new'), null);
  });

  test('explanations name the Stripe mode so a test/live mix-up is obvious', () => {
    assert.match(billingIssueExplanation('not_in_stripe', 'live'), /live mode/);
    assert.match(billingIssueExplanation('not_in_stripe', 'live'), /no payment on record/);
    assert.match(billingIssueExplanation('period_expired'), /webhook/);
    assert.equal(billingIssueExplanation(null), null);
  });

  test('the Needs review filter keeps exactly the users with an issue, whatever their plan', () => {
    const users = [
      { id: 'a', email: 'a@x.com', plan: 'pro', billingIssue: 'not_in_stripe' },
      { id: 'b', email: 'b@x.com', plan: 'pro', billingIssue: null },
      { id: 'c', email: 'c@x.com', plan: 'free', billingIssue: null },
      { id: 'd', email: 'd@x.com', plan: 'pro', billingIssue: 'period_expired' },
    ];
    assert.deepEqual(filterUsers(users, { plan: 'issues' }).map((u) => u.id), ['a', 'd']);
    // and it still combines with the search box
    assert.deepEqual(filterUsers(users, { plan: 'issues', query: 'd@' }).map((u) => u.id), ['d']);
    // the other filters are unchanged
    assert.deepEqual(filterUsers(users, { plan: 'pro' }).map((u) => u.id), ['a', 'b', 'd']);
  });
});

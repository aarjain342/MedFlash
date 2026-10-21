// The admin dashboard exposes every user's email and payment history through the service-role
// client, so the tests here lean on the two things that matter most: that authorization fails
// closed, and that nothing sensitive leaks into a response. The aggregation math is pure and
// covered with plain fixtures (no Supabase, no Stripe, no network).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAdmin,
  requireAdmin,
  registerAdminRoutes,
  monthlyAmount,
  buildRevenue,
  buildUsers,
  buildOverview,
  buildPayments,
  buildSystem,
  fetchAllRows,
  listAllAuthUsers,
  loadStripeSnapshot,
  stripeMode,
  billingIssueFor,
  loadStripeAccount,
} from './admin.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-10-20T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const confirmedAdmin = { id: ADMIN_ID, email: 'Owner@Example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };

describe('isAdmin', () => {
  test('fails closed when ADMIN_EMAILS is not configured', () => {
    assert.equal(isAdmin(confirmedAdmin, {}), false);
    assert.equal(isAdmin(confirmedAdmin, { ADMIN_EMAILS: '' }), false);
    assert.equal(isAdmin(confirmedAdmin, { ADMIN_EMAILS: ' , ,' }), false);
  });

  test('fails closed with no user (e.g. auth disabled for local dev)', () => {
    assert.equal(isAdmin(undefined, { ADMIN_EMAILS: 'owner@example.com' }), false);
    assert.equal(isAdmin(null, { ADMIN_EMAILS: 'owner@example.com' }), false);
    assert.equal(isAdmin({}, { ADMIN_EMAILS: 'owner@example.com' }), false);
  });

  test('matches the email case-insensitively and trims the list', () => {
    assert.equal(isAdmin(confirmedAdmin, { ADMIN_EMAILS: ' other@x.com , owner@example.com ' }), true);
  });

  test('rejects any other address', () => {
    assert.equal(isAdmin({ ...confirmedAdmin, email: 'someone@else.com' }, { ADMIN_EMAILS: 'owner@example.com' }), false);
    // substring / suffix tricks must not match
    assert.equal(isAdmin({ ...confirmedAdmin, email: 'xowner@example.com' }, { ADMIN_EMAILS: 'owner@example.com' }), false);
    assert.equal(isAdmin({ ...confirmedAdmin, email: 'owner@example.com.evil.io' }, { ADMIN_EMAILS: 'owner@example.com' }), false);
  });

  test('requires a confirmed email', () => {
    const unconfirmed = { id: ADMIN_ID, email: 'owner@example.com' };
    assert.equal(isAdmin(unconfirmed, { ADMIN_EMAILS: 'owner@example.com' }), false);
    assert.equal(isAdmin({ ...unconfirmed, confirmed_at: '2026-01-01T00:00:00Z' }, { ADMIN_EMAILS: 'owner@example.com' }), true);
  });

  // Email confirmation is OFF in production, so if the admin account were deleted anyone could
  // re-register that address. Pinning the user id is what stops that, so it must hold.
  test('when ADMIN_USER_IDS is set, the id must match as well as the email', () => {
    const env = { ADMIN_EMAILS: 'owner@example.com', ADMIN_USER_IDS: ADMIN_ID };
    assert.equal(isAdmin(confirmedAdmin, env), true);
    assert.equal(isAdmin({ ...confirmedAdmin, id: OTHER_ID }, env), false);
    assert.equal(isAdmin({ ...confirmedAdmin, id: ADMIN_ID.toUpperCase() }, env), true);
  });

  test('an id on its own is not enough', () => {
    assert.equal(isAdmin({ ...confirmedAdmin, email: 'x@y.com' }, { ADMIN_EMAILS: 'owner@example.com', ADMIN_USER_IDS: ADMIN_ID }), false);
  });
});

describe('requireAdmin', () => {
  function run(user) {
    const res = {
      statusCode: 200,
      headers: {},
      body: undefined,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
      set(k, v) { this.headers[k] = v; return this; },
    };
    let nextCalled = false;
    requireAdmin({ user }, res, () => { nextCalled = true; });
    return { res, nextCalled };
  }

  test('returns 403 and never calls next for a non-admin', (t) => {
    const prev = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = 'owner@example.com';
    t.after(() => { if (prev === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = prev; });
    const { res, nextCalled } = run({ id: OTHER_ID, email: 'a@b.com', email_confirmed_at: 'x' });
    assert.equal(res.statusCode, 403);
    assert.equal(nextCalled, false);
    assert.deepEqual(res.body, { error: 'Not authorized' });
  });

  test('passes an admin through and marks the response uncacheable', (t) => {
    const prevE = process.env.ADMIN_EMAILS;
    const prevI = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_EMAILS = 'owner@example.com';
    delete process.env.ADMIN_USER_IDS;
    t.after(() => {
      if (prevE === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = prevE;
      if (prevI !== undefined) process.env.ADMIN_USER_IDS = prevI;
    });
    const { res, nextCalled } = run(confirmedAdmin);
    assert.equal(nextCalled, true);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  });
});

describe('route registration', () => {
  function register() {
    const routes = {};
    const app = { get: (path, ...handlers) => { routes[path] = handlers; } };
    const requireAuth = () => {};
    registerAdminRoutes(app, requireAuth);
    return { routes, requireAuth };
  }

  // The structural guarantee: a new admin route can't be added without the guard.
  test('every admin route except /me is behind requireAuth then requireAdmin', () => {
    const { routes, requireAuth } = register();
    const paths = Object.keys(routes);
    assert.ok(paths.includes('/api/admin/overview') && paths.includes('/api/admin/users') && paths.includes('/api/admin/payments'));
    for (const path of paths) {
      assert.equal(routes[path][0], requireAuth, `${path} must start with requireAuth`);
      if (path !== '/api/admin/me') assert.equal(routes[path][1], requireAdmin, `${path} must be behind requireAdmin`);
    }
  });

  test('/api/admin/me reports only a boolean', (t) => {
    const prev = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = 'owner@example.com';
    t.after(() => { if (prev === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = prev; });
    const { routes } = register();
    const handler = routes['/api/admin/me'][1];
    const call = (user) => {
      let body;
      handler({ user }, { set() {}, json(b) { body = b; } });
      return body;
    };
    assert.deepEqual(call(confirmedAdmin), { isAdmin: true });
    assert.deepEqual(call({ id: OTHER_ID, email: 'a@b.com', email_confirmed_at: 'x' }), { isAdmin: false });
    assert.deepEqual(call(undefined), { isAdmin: false });
  });
});

describe('paging', () => {
  test('fetchAllRows keeps paging until a short page and stitches the rows together', async () => {
    const all = Array.from({ length: 2500 }, (_, i) => ({ i }));
    const ranges = [];
    const build = () => ({
      range(from, to) {
        ranges.push([from, to]);
        return Promise.resolve({ data: all.slice(from, to + 1), error: null });
      },
    });
    const rows = await fetchAllRows(build, { pageSize: 1000 });
    assert.equal(rows.length, 2500);
    assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
  });

  test('fetchAllRows surfaces a query error instead of returning partial data', async () => {
    const build = () => ({ range: () => Promise.resolve({ data: null, error: { message: 'boom' } }) });
    await assert.rejects(fetchAllRows(build), /boom/);
  });

  test('listAllAuthUsers pages through every auth user', async () => {
    const users = Array.from({ length: 1500 }, (_, i) => ({ id: `u${i}` }));
    const supabase = {
      auth: { admin: { listUsers: ({ page, perPage }) => Promise.resolve({ data: { users: users.slice((page - 1) * perPage, page * perPage) }, error: null }) } },
    };
    assert.equal((await listAllAuthUsers(supabase)).length, 1500);
  });
});

describe('money', () => {
  const sub = (unit_amount, interval, extra = {}) => ({
    items: { data: [{ quantity: 1, price: { unit_amount, currency: 'usd', recurring: { interval, interval_count: 1 } } }] },
    ...extra,
  });

  test('normalises each billing interval to a monthly amount', () => {
    assert.equal(monthlyAmount(sub(1500, 'month')), 1500);
    assert.equal(monthlyAmount(sub(7900, 'year')), 658); // 7900 / 12 rounded
    assert.equal(monthlyAmount({ items: { data: [] } }), 0);
  });

  test('buildRevenue sums succeeded charges, nets out refunds, and ignores failed ones', () => {
    const revenue = buildRevenue({
      available: true,
      errors: {},
      charges: [
        { paid: true, status: 'succeeded', amount: 1500, amount_refunded: 0, currency: 'usd', created: NOW / 1000 - DAY / 1000 },
        { paid: true, status: 'succeeded', amount: 1500, amount_refunded: 1500, currency: 'usd', created: NOW / 1000 - 60 * DAY / 1000 },
        { paid: false, status: 'failed', amount: 1500, currency: 'usd', created: NOW / 1000 },
      ],
      subscriptions: [
        { status: 'active', ...sub(1500, 'month') },
        { status: 'active', cancel_at_period_end: true, ...sub(7900, 'year') },
        { status: 'past_due', ...sub(1500, 'month') },
        { status: 'canceled', ...sub(1500, 'month') },
      ],
    }, NOW);
    assert.equal(revenue.gross.usd, 3000);
    assert.equal(revenue.refunded.usd, 1500);
    assert.equal(revenue.net.usd, 1500);
    assert.equal(revenue.last30Days.usd, 1500); // only the recent, unrefunded one
    assert.equal(revenue.mrr.usd, 1500 + 658); // active only, annual normalised
    assert.equal(revenue.activeSubscribers, 2);
    assert.equal(revenue.pastDue, 1);
    assert.equal(revenue.canceling, 1);
    assert.deepEqual(revenue.charges, { succeeded: 2, failed: 1, disputed: 0, total: 3 });
  });

  test('buildRevenue says so when Stripe is unavailable rather than reporting zeros', () => {
    const r = buildRevenue({ available: false, reason: 'not configured', errors: {} });
    assert.equal(r.available, false);
    assert.equal(r.reason, 'not configured');
    assert.equal('gross' in r, false);
  });

  test('stripeMode reads the objects first, then the key prefix', () => {
    assert.equal(stripeMode({ charges: [{ livemode: true }], subscriptions: [] }, {}), 'live');
    assert.equal(stripeMode({ charges: [], subscriptions: [{ livemode: false }] }, {}), 'test');
    assert.equal(stripeMode({ charges: [], subscriptions: [] }, { STRIPE_SECRET_KEY: 'rk_live_abc' }), 'live');
    assert.equal(stripeMode({ charges: [], subscriptions: [] }, { STRIPE_SECRET_KEY: 'sk_test_abc' }), 'test');
    assert.equal(stripeMode({ charges: [], subscriptions: [] }, {}), 'unknown');
  });
});

describe('users and overview', () => {
  const snapshot = {
    authUsers: [
      { id: 'u1', email: 'a@x.com', created_at: new Date(NOW - 2 * DAY).toISOString(), last_sign_in_at: new Date(NOW - DAY).toISOString(), email_confirmed_at: 'x', app_metadata: { provider: 'email' } },
      { id: 'u2', email: 'b@x.com', created_at: new Date(NOW - 20 * DAY).toISOString(), last_sign_in_at: null, email_confirmed_at: 'x' },
      { id: 'u3', email: 'c@x.com', created_at: new Date(NOW - 90 * DAY).toISOString(), last_sign_in_at: new Date(NOW - 80 * DAY).toISOString() },
    ],
    subscriptions: [
      { user_id: 'u1', stripe_customer_id: 'cus_1', status: 'active', plan: 'monthly', current_period_end: '2026-11-01T00:00:00Z' },
      { user_id: 'u3', stripe_customer_id: 'cus_3', status: 'canceled', plan: 'monthly' },
    ],
    decks: [
      { id: 'd1', user_id: 'u1', created_at: NOW - DAY },
      { id: 'd2', user_id: 'u1', created_at: NOW - 40 * DAY },
      { id: 'd3', user_id: 'u2', created_at: NOW - 3 * DAY },
    ],
    anatomyDecks: [{ id: 'a1', user_id: 'u1', created_at: NOW }],
    quizzes: [{ deck_id: 'd1', user_id: 'u1', updated_at: 'x' }],
    usage: [
      { user_id: 'u1', month: '2026-10-01', generations_count: 4, chat_count: 7 },
      { user_id: 'u1', month: '2026-09-01', generations_count: 10, chat_count: 1 },
      { user_id: 'u2', month: '2026-10-01', generations_count: 1, chat_count: 0 },
    ],
  };
  const stripeSnap = {
    available: true,
    errors: {},
    subscriptions: [],
    charges: [{ customer: 'cus_1', paid: true, status: 'succeeded', amount: 1500, amount_refunded: 500, currency: 'usd', created: NOW / 1000 }],
  };

  test('buildUsers joins plan, content counts, usage and lifetime paid per user', () => {
    const users = buildUsers(snapshot, stripeSnap, NOW);
    const u1 = users.find((u) => u.id === 'u1');
    assert.equal(u1.plan, 'pro');
    assert.equal(u1.decks, 2);
    assert.equal(u1.anatomyDecks, 1);
    assert.equal(u1.quizzes, 1);
    assert.deepEqual(u1.usageThisMonth, { generations: 4, chat: 7 });
    assert.deepEqual(u1.usageLifetime, { generations: 14, chat: 8 });
    assert.deepEqual(u1.paid, { usd: 1000 }); // 1500 charged - 500 refunded

    const u2 = users.find((u) => u.id === 'u2');
    assert.equal(u2.plan, 'free');
    assert.equal(u2.subscriptionStatus, 'none');
    assert.equal(u2.decks, 1);

    const u3 = users.find((u) => u.id === 'u3');
    assert.equal(u3.plan, 'free'); // canceled is not Pro
    assert.equal(u3.confirmed, false);
  });

  test('paid is null (unknown) rather than {} when Stripe is unavailable', () => {
    const users = buildUsers(snapshot, { available: false, charges: [], subscriptions: [] }, NOW);
    assert.equal(users[0].paid, null);
  });

  test('buildOverview totals, plan split and a 30-day signup series', () => {
    const o = buildOverview(snapshot, stripeSnap, NOW);
    assert.equal(o.users.total, 3);
    assert.equal(o.users.new7d, 1);
    assert.equal(o.users.new30d, 2);
    assert.equal(o.users.active7d, 1);
    assert.equal(o.users.neverSignedIn, 1);
    assert.equal(o.users.confirmed, 2);
    assert.equal(o.users.unconfirmed, 1);
    assert.deepEqual(o.plans, {
      pro: 1,
      free: 2,
      byStatus: { active: 1, none: 1, canceled: 1 },
      // This fixture's active row has a future period end and no Stripe subscription id to
      // contradict, so nothing is flagged. The flagging cases are under "billing reconciliation".
      billingIssues: { not_in_stripe: 0, period_expired: 0 },
    });
    assert.equal(o.content.decks, 3);
    assert.equal(o.content.decksNew7d, 2);
    assert.equal(o.usage.generations, 5);
    assert.equal(o.usage.lifetimeGenerations, 15);
    assert.equal(o.usage.top[0].id, 'u1');

    assert.equal(o.users.signupsByDay.length, 30);
    assert.equal(o.users.signupsByDay.at(-1).date, '2026-10-20');
    assert.equal(o.users.signupsByDay.reduce((n, d) => n + d.count, 0), 2); // the 90-day-old user is outside the window
  });

  test('buildPayments attaches the user email to a charge via the Stripe customer id', () => {
    const p = buildPayments(snapshot, stripeSnap);
    assert.equal(p.charges[0].email, 'a@x.com');
    assert.equal(p.charges[0].userId, 'u1');
    assert.equal(p.charges[0].amountRefunded, 500);
  });
});

describe('leak resistance', () => {
  // Stripe error messages can embed a fragment of the API key. It must never reach the client.
  test('a failing Stripe call returns a generic message, not Stripe\'s own text', async (t) => {
    t.mock.method(console, 'error', () => {});
    const failing = () => ({
      autoPagingToArray: () => Promise.reject(Object.assign(new Error('Invalid API Key provided: rk_test_SECRETVALUE123'), { type: 'StripeAuthenticationError', code: 'api_key_invalid' })),
    });
    const snap = await loadStripeSnapshot({ charges: { list: failing }, subscriptions: { list: failing } });
    const text = JSON.stringify(snap.errors);
    assert.ok(!text.includes('SECRETVALUE123'));
    assert.ok(!text.includes('rk_test'));
    assert.match(snap.errors.charges, /api_key_invalid/);
  });

  test('a permission error gets an actionable, key-free message', async (t) => {
    t.mock.method(console, 'error', () => {});
    const denied = () => ({
      autoPagingToArray: () => Promise.reject(Object.assign(new Error('key rk_live_ABC lacks permission'), { type: 'StripePermissionError' })),
    });
    const snap = await loadStripeSnapshot({ charges: { list: denied }, subscriptions: { list: denied } });
    assert.match(snap.errors.charges, /not allowed to read/);
    assert.ok(!JSON.stringify(snap.errors).includes('rk_live'));
  });

  test('buildSystem reports booleans and counts only, never keys or addresses', () => {
    const sys = buildSystem({
      STRIPE_SECRET_KEY: 'sk_test_TOPSECRET',
      STRIPE_WEBHOOK_SECRET: 'whsec_TOPSECRET',
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service_TOPSECRET',
      GEMINI_API_KEY: 'AIza_TOPSECRET',
      ADMIN_EMAILS: 'owner@example.com',
      ADMIN_USER_IDS: ADMIN_ID,
    }, NOW);
    const text = JSON.stringify(sys);
    assert.ok(!text.includes('TOPSECRET'));
    assert.ok(!text.includes('owner@example.com'));
    assert.ok(!text.includes(ADMIN_ID));
    assert.equal(sys.configured.adminEmails, 1);
    assert.equal(sys.configured.adminUserIdsPinned, 1);
    assert.equal(sys.configured.stripe, true);
    assert.equal(sys.stripeMode, 'test');
  });
});

describe('billing reconciliation', () => {
  const active = (over = {}) => ({
    user_id: 'u1', status: 'active', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1',
    current_period_end: new Date(NOW + 10 * DAY).toISOString(), ...over,
  });
  const stripeWith = (ids, errors = {}) => ({
    available: true, charges: [], errors, subscriptions: ids.map((id) => ({ id })),
  });

  // Found in the real data: 4 users were 'active' Pro in the database while the live Stripe
  // account had no such subscription — leftover test-mode rows. The app grants Pro from status
  // alone, so they keep unlimited access with no payment on record. The dashboard must say so.
  test('flags a Pro row that Stripe does not know about', () => {
    assert.equal(billingIssueFor(active(), stripeWith(['sub_other']), NOW), 'not_in_stripe');
    assert.equal(billingIssueFor(active(), stripeWith([]), NOW), 'not_in_stripe');
  });

  test('does not flag a row Stripe confirms', () => {
    assert.equal(billingIssueFor(active(), stripeWith(['sub_1', 'sub_2']), NOW), null);
  });

  // The false-positive that would be worst: a Stripe outage marking every paying customer as suspect.
  test('does not guess when Stripe could not be read', () => {
    assert.equal(billingIssueFor(active(), { available: false, charges: [], subscriptions: [], errors: {} }, NOW), null);
    assert.equal(billingIssueFor(active(), stripeWith([], { subscriptions: 'Stripe request failed.' }), NOW), null);
    assert.equal(billingIssueFor(active(), undefined, NOW), null);
  });

  test('flags a row that is still active after its period ended (a missed webhook)', () => {
    const expired = active({ current_period_end: new Date(NOW - DAY).toISOString() });
    assert.equal(billingIssueFor(expired, stripeWith(['sub_1']), NOW), 'period_expired');
  });

  test('ignores anything that is not Pro', () => {
    for (const status of ['none', 'canceled', 'past_due']) {
      assert.equal(billingIssueFor(active({ status }), stripeWith([]), NOW), null, status);
    }
    assert.equal(billingIssueFor(undefined, stripeWith([]), NOW), null);
  });

  test('a row with no subscription id cannot be matched, so it is not flagged on that basis', () => {
    assert.equal(billingIssueFor(active({ stripe_subscription_id: null }), stripeWith([]), NOW), null);
  });

  test('the overview counts each kind of issue and buildUsers carries it per user', () => {
    const snapshot = {
      authUsers: [{ id: 'a', email: 'a@x.com' }, { id: 'b', email: 'b@x.com' }, { id: 'c', email: 'c@x.com' }],
      subscriptions: [
        active({ user_id: 'a', stripe_subscription_id: 'sub_a' }),
        active({ user_id: 'b', stripe_subscription_id: 'sub_b', current_period_end: new Date(NOW - DAY).toISOString() }),
        active({ user_id: 'c', stripe_subscription_id: 'sub_c' }),
      ],
      decks: [], anatomyDecks: [], quizzes: [], usage: [],
    };
    const stripeSnap = stripeWith(['sub_b', 'sub_c']);
    const users = buildUsers(snapshot, stripeSnap, NOW);
    assert.deepEqual(Object.fromEntries(users.map((u) => [u.id, u.billingIssue])), { a: 'not_in_stripe', b: 'period_expired', c: null });
    const overview = buildOverview(snapshot, stripeSnap, NOW);
    assert.deepEqual(overview.plans.billingIssues, { not_in_stripe: 1, period_expired: 1 });
  });

  test('a missing Stripe customer gets an actionable message that does not echo the raw error', async (t) => {
    t.mock.method(console, 'error', () => {});
    const missing = () => ({
      autoPagingToArray: () => Promise.reject(Object.assign(new Error('No such customer: cus_SECRETISH'), { type: 'StripeInvalidRequestError', code: 'resource_missing' })),
    });
    const snap = await loadStripeSnapshot({ charges: { list: missing }, subscriptions: { list: missing } });
    assert.match(snap.errors.charges, /no record of this customer/);
    assert.ok(!JSON.stringify(snap.errors).includes('SECRETISH'));
  });
});

describe('loadStripeAccount', () => {
  test('reports the account id the key belongs to', async () => {
    const stripe = { accounts: { retrieve: async () => ({ id: 'acct_123', country: 'US', charges_enabled: true, payouts_enabled: false }) } };
    assert.deepEqual(await loadStripeAccount(stripe), { available: true, id: 'acct_123', country: 'US', chargesEnabled: true, payoutsEnabled: false });
  });

  test('degrades to unavailable (with a key-free reason) when the key cannot read it', async (t) => {
    t.mock.method(console, 'error', () => {});
    const stripe = { accounts: { retrieve: async () => { throw Object.assign(new Error('rk_live_LEAK lacks permission'), { type: 'StripePermissionError' }); } } };
    const r = await loadStripeAccount(stripe);
    assert.equal(r.available, false);
    assert.ok(!JSON.stringify(r).includes('rk_live'));
  });

  test('reports plainly when Stripe is not configured', async () => {
    assert.equal((await loadStripeAccount(null)).available, false);
  });
});

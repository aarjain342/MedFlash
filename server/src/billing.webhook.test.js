// Verifies handleWebhookEvent's write behavior for the subscription lifecycle events Stripe
// actually sends (renewal, a declined recurring charge, and final cancellation), using a
// fake Supabase client so this never touches real data. Complements the live end-to-end
// checkout/cancel verification done manually against the real Stripe sandbox + Supabase
// project — this file exists so that verification doesn't have to be repeated by hand
// (or, worse, by scripts that mutate real rows) every time this code changes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

function createFakeSupabaseAdmin(calls) {
  return {
    from(table) {
      return {
        upsert(row) {
          calls.push({ table, op: 'upsert', row });
          return Promise.resolve({ error: null });
        },
        update(patch) {
          return {
            eq(column, value) {
              calls.push({ table, op: 'update', patch, eq: { column, value } });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

// Scoped to the test's own `t.mock` (not the global `mock` tracker) so it auto-restores
// when that test finishes — a global mock.module() call can't be re-registered for the
// same specifier by a later test without restoring it first.
async function loadBillingWithFakeAdmin(t, calls) {
  t.mock.module('./supabaseAdmin.js', {
    namedExports: { supabaseAdmin: createFakeSupabaseAdmin(calls), adminConfigured: true },
  });
  // Re-import fresh each time (cache-busted) so each test's mock is the one actually used —
  // ESM module mocks only apply to imports that happen after mock.module() is called.
  return import(`./billing.js?t=${Date.now()}-${Math.random()}`);
}

const USER_ID = '11111111-1111-1111-1111-111111111111';

describe('handleWebhookEvent', () => {
  test('successful renewal (customer.subscription.updated, active) writes the rolled-forward period end and plan', async (t) => {
    const calls = [];
    const { handleWebhookEvent } = await loadBillingWithFakeAdmin(t, calls);
    process.env.STRIPE_PRICE_MONTHLY = 'price_monthly_test_renewal';

    const nextMonth = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    await handleWebhookEvent({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_renew',
          customer: 'cus_renew',
          status: 'active',
          metadata: { user_id: USER_ID },
          items: { data: [{ price: { id: 'price_monthly_test_renewal' }, current_period_end: nextMonth }] },
        },
      },
    });

    const write = calls.find((c) => c.table === 'subscriptions' && c.op === 'upsert');
    assert.ok(write, 'expected a subscriptions upsert');
    assert.equal(write.row.status, 'active');
    assert.equal(write.row.plan, 'monthly');
    assert.equal(write.row.current_period_end, new Date(nextMonth * 1000).toISOString());
  });

  test('a declined recurring charge (customer.subscription.updated, past_due) writes status past_due, not active', async (t) => {
    const calls = [];
    const { handleWebhookEvent } = await loadBillingWithFakeAdmin(t, calls);
    process.env.STRIPE_PRICE_MONTHLY = 'price_monthly_test';

    await handleWebhookEvent({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_pastdue',
          customer: 'cus_pastdue',
          status: 'past_due',
          metadata: { user_id: USER_ID },
          items: { data: [{ price: { id: 'price_monthly_test' }, current_period_end: Math.floor(Date.now() / 1000) }] },
        },
      },
    });

    const write = calls.find((c) => c.table === 'subscriptions' && c.op === 'upsert');
    assert.ok(write);
    assert.equal(write.row.status, 'past_due');
    // isUserPro/getBillingStatus both gate Pro access on status === 'active' || 'trialing'
    // — anything else (including this) correctly falls through to Free.
    assert.notEqual(write.row.status, 'active');
    assert.notEqual(write.row.status, 'trialing');
  });

  test('final expiry (customer.subscription.deleted) marks the row canceled for that user', async (t) => {
    const calls = [];
    const { handleWebhookEvent } = await loadBillingWithFakeAdmin(t, calls);

    await handleWebhookEvent({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_gone', metadata: { user_id: USER_ID } } },
    });

    const write = calls.find((c) => c.table === 'subscriptions' && c.op === 'update');
    assert.ok(write, 'expected a subscriptions update');
    assert.equal(write.patch.status, 'canceled');
    assert.deepEqual(write.eq, { column: 'user_id', value: USER_ID });
  });

  test('a subscription.deleted event missing user_id metadata is ignored, not written blindly', async (t) => {
    const calls = [];
    const { handleWebhookEvent } = await loadBillingWithFakeAdmin(t, calls);

    await handleWebhookEvent({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_no_meta', metadata: {} } },
    });

    assert.equal(calls.length, 0);
  });
});

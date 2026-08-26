import { stripe } from './stripeClient.js';
import { supabaseAdmin } from './supabaseAdmin.js';

const FREE_LIMITS = { decks: 3, generations: 10, chat: 20 };

function priceIdToPlan(priceId) {
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return 'monthly';
  if (priceId === process.env.STRIPE_PRICE_ANNUAL) return 'annual';
  return null;
}

export function planPriceId(interval) {
  return interval === 'annual' ? process.env.STRIPE_PRICE_ANNUAL : process.env.STRIPE_PRICE_MONTHLY;
}

// Reuses a Stripe customer already on file for this user (so repeat checkouts, or a
// resubscribe after canceling, don't create duplicate customers), creating one on first use.
export async function getOrCreateCustomerId(user) {
  const { data: existing } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const customer = await stripe.customers.create({
    email: user.email,
    metadata: { user_id: user.id },
  });

  await supabaseAdmin
    .from('subscriptions')
    .upsert({ user_id: user.id, stripe_customer_id: customer.id, status: 'none' });

  return customer.id;
}

// Shared by checkout.session.completed (client_reference_id) and
// customer.subscription.created/updated (subscription_data.metadata) — both were set when
// the Checkout Session was created, so user_id is always readable directly off the event
// payload without needing a prior row to already exist.
async function upsertFromSubscription(subscription, fallbackUserId) {
  const userId = subscription.metadata?.user_id || fallbackUserId;
  if (!userId) {
    console.error('Stripe subscription event with no user_id in metadata:', subscription.id);
    return;
  }

  const price = subscription.items?.data?.[0]?.price;
  const plan = price ? priceIdToPlan(price.id) : null;
  const periodEndSeconds = subscription.items?.data?.[0]?.current_period_end;

  const { error } = await supabaseAdmin.from('subscriptions').upsert({
    user_id: userId,
    stripe_customer_id: subscription.customer,
    stripe_subscription_id: subscription.id,
    plan,
    status: subscription.status,
    current_period_end: periodEndSeconds ? new Date(periodEndSeconds * 1000).toISOString() : null,
    // Portal cancellations default to "stays active until period end", not immediate —
    // status stays 'active' the whole time, so this is the only signal that tells the
    // client "won't renew" apart from "will renew" (see getBillingStatus below).
    cancel_at_period_end: !!subscription.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  });
  if (error) console.error('Failed to upsert subscription row:', error);
}

export async function handleWebhookEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      // Defense in depth only — customer.subscription.created carries the same
      // metadata.user_id and normally lands right alongside this event anyway.
      if (session.client_reference_id && session.customer) {
        const { error } = await supabaseAdmin.from('subscriptions').upsert({
          user_id: session.client_reference_id,
          stripe_customer_id: session.customer,
          status: 'active',
          updated_at: new Date().toISOString(),
        });
        if (error) console.error('Failed to backfill customer id from checkout session:', error);
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await upsertFromSubscription(event.data.object);
      break;
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const userId = subscription.metadata?.user_id;
      if (!userId) {
        console.error('subscription.deleted with no user_id in metadata:', subscription.id);
        break;
      }
      const { error } = await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      if (error) console.error('Failed to mark subscription canceled:', error);
      break;
    }
    default:
      break; // unhandled event types are expected and fine to ignore
  }
}

export async function getBillingStatus(userId) {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthKey = monthStart.toISOString().slice(0, 10);

  const [{ data: sub }, { data: usage }, { count: deckCount }] = await Promise.all([
    supabaseAdmin
      .from('subscriptions')
      .select('plan, status, current_period_end, cancel_at_period_end')
      .eq('user_id', userId)
      .maybeSingle(),
    supabaseAdmin
      .from('usage_counters')
      .select('generations_count, chat_count')
      .eq('user_id', userId)
      .eq('month', monthKey)
      .maybeSingle(),
    supabaseAdmin.from('decks').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ]);

  const isPro = sub?.status === 'active' || sub?.status === 'trialing';

  return {
    plan: isPro ? sub.plan : 'free',
    status: sub?.status || 'none',
    currentPeriodEnd: sub?.current_period_end || null,
    cancelAtPeriodEnd: !!sub?.cancel_at_period_end,
    usage: {
      decks: { used: deckCount || 0, limit: isPro ? null : FREE_LIMITS.decks },
      generations: { used: usage?.generations_count || 0, limit: isPro ? null : FREE_LIMITS.generations },
      chat: { used: usage?.chat_count || 0, limit: isPro ? null : FREE_LIMITS.chat },
    },
  };
}

export async function isUserPro(userId) {
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('status')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.status === 'active' || data?.status === 'trialing';
}

// Atomic increment-and-check via the increment_usage Postgres function (supabase/billing.sql)
// — a plain read-then-write from Node would race under concurrent requests.
export async function checkAndIncrementUsage(userId, kind, limit) {
  const { data, error } = await supabaseAdmin.rpc('increment_usage', {
    p_user_id: userId,
    p_kind: kind,
    p_limit: limit,
  });
  if (error) throw error;
  return data === true;
}

export async function createCheckoutSession(user, interval) {
  const priceId = planPriceId(interval);
  if (!priceId) throw new Error(`No price configured for interval "${interval}"`);

  const customerId = await getOrCreateCustomerId(user);
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { metadata: { user_id: user.id } },
    allow_promotion_codes: true,
    // Managed Payments is enabled by default on new Stripe accounts and requires a
    // product tax code we haven't set up (no Stripe Tax integration here) — opt out to
    // keep the standard Billing + webhook flow this app is built around.
    managed_payments: { enabled: false },
    success_url: `${frontendUrl}/dashboard?view=settings&checkout=success`,
    cancel_url: `${frontendUrl}/dashboard?view=settings&checkout=cancelled`,
  });

  return session.url;
}

export async function createPortalSession(user) {
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!data?.stripe_customer_id) {
    throw new Error('No billing account on file yet — subscribe to MedFlash Pro first.');
  }

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const session = await stripe.billingPortal.sessions.create({
    customer: data.stripe_customer_id,
    return_url: `${frontendUrl}/dashboard?view=settings`,
  });

  return session.url;
}

export const FREE_GENERATION_LIMIT = FREE_LIMITS.generations;
export const FREE_CHAT_LIMIT = FREE_LIMITS.chat;

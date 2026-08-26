import Stripe from 'stripe';

// Pinned so behavior doesn't drift underneath us on a Stripe-side default bump.
const STRIPE_API_VERSION = '2026-06-24.dahlia';

export const billingConfigured = Boolean(process.env.STRIPE_SECRET_KEY);

if (!billingConfigured) {
  console.warn('STRIPE_SECRET_KEY not set — billing routes will respond 503.');
}

export const stripe = billingConfigured
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION })
  : null;

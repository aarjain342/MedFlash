// Monthly free-plan quotas (separate from rateLimit.js's hourly/daily abuse-prevention
// limits — this is the Stripe-plan boundary, that's the anti-abuse net; both apply).
import { adminConfigured } from './supabaseAdmin.js';
import { isUserPro, checkAndIncrementUsage, FREE_GENERATION_LIMIT, FREE_CHAT_LIMIT } from './billing.js';

function createPlanLimiter({ kind, limit, label }) {
  return async function (req, res, next) {
    // No authenticated user (guest mode, or auth disabled for local dev) or billing not
    // configured at all — nothing to enforce, let the request through.
    if (!req.user || !adminConfigured) return next();

    try {
      if (await isUserPro(req.user.id)) return next();

      const allowed = await checkAndIncrementUsage(req.user.id, kind, limit);
      if (!allowed) {
        return res.status(402).json({
          error: `You've used all ${limit} free ${label} this month. Upgrade to MedFlash Pro in Settings for unlimited access.`,
        });
      }
      next();
    } catch (err) {
      // A billing-check hiccup shouldn't take down the core product — fail open, same
      // tolerance this app already has elsewhere (e.g. auth.js when Supabase is unset).
      console.error(`Plan limit check failed (${kind}):`, err);
      next();
    }
  };
}

export const proGenerationLimiter = createPlanLimiter({
  kind: 'generation',
  limit: FREE_GENERATION_LIMIT,
  label: 'AI generations',
});

export const proChatLimiter = createPlanLimiter({
  kind: 'chat',
  limit: FREE_CHAT_LIMIT,
  label: 'chat messages',
});

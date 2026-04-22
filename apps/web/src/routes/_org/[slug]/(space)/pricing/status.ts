/**
 * Pricing-page re-export shim.
 *
 * The effective-status helpers moved to `$lib/subscription/status.ts`
 * in Codex-g5vbp so non-pricing surfaces (content-detail gate,
 * SubscribeButton, org hero) can share the same pure resolver without
 * importing from a route directory.
 *
 * Kept as a re-export so the existing `./status` imports + co-located unit
 * tests in `__tests__/status.test.ts` continue to resolve.
 */
export {
  getCurrentTierCta,
  getEffectiveStatus,
  type SubscriptionStatus,
} from '$lib/subscription/status';

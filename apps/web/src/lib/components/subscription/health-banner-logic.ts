/**
 * HealthBanner pure-logic helpers
 *
 * Extracted from `HealthBanner.svelte` so the derivation rules are
 * unit-testable without a Svelte runtime. The component file imports
 * these and drives the UI around them.
 */
import type { SubscriptionItem } from '$lib/collections';

/**
 * Lifecycle states that warrant surfacing a banner. Must stay in sync
 * with the backend `SUBSCRIPTION_STATUS` enum (paused / past_due).
 *
 * `cancelling` is intentionally excluded — a user who cancelled on
 * purpose has already taken action; surfacing a banner would feel
 * alarming rather than helpful. `cancelled` and `incomplete` are
 * terminal states the user can't self-service from a banner.
 */
export const ATTENTION_STATUSES: ReadonlyArray<SubscriptionItem['status']> = [
  'past_due',
  'paused',
];

export function isAttentionStatus(status: SubscriptionItem['status']): boolean {
  return (ATTENTION_STATUSES as readonly string[]).includes(status);
}

export function filterAttentionSubs(
  subs: readonly SubscriptionItem[]
): SubscriptionItem[] {
  return subs.filter((s) => isAttentionStatus(s.status));
}

export type BannerVariant = 'error' | 'warning';

/**
 * Pick the banner's severity paint.
 *
 * `past_due` → error (access denial / dunning imminent)
 * `paused`   → warning (reversible, user-initiated pause)
 * Mixed      → error (floor to the more severe case)
 *
 * Callers pass the already-filtered attention list; calling with an
 * empty array returns 'warning' but the component should suppress the
 * banner entirely in that case.
 */
export function deriveBannerVariant(
  attentionSubs: readonly SubscriptionItem[]
): BannerVariant {
  if (attentionSubs.some((s) => s.status === 'past_due')) return 'error';
  return 'warning';
}

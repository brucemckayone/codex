/**
 * Subscription-status helpers (shared).
 *
 * Pure functions that map raw subscription fields
 * ({ tierId, status, cancelAtPeriodEnd, currentPeriodEnd, ... }) into an
 * effective UI status and a matching CTA descriptor.
 *
 * Used by:
 *   - Pricing page tier cards (apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte)
 *   - SubscribeButton (apps/web/src/lib/components/subscription/SubscribeButton.svelte)
 *   - Content-detail gate CTAs (apps/web/src/lib/components/content/ContentDetailView.svelte)
 *
 * Codex-g5vbp moved these out of the pricing route dir so non-pricing surfaces
 * (org hero, content detail, org-home sticky CTA) can share the same status
 * resolution without circular route imports.
 *
 *   cancelAtPeriodEnd=true  OR  status='cancelling' → 'cancelling'
 *   status='past_due'                               → 'past_due'
 *   status='paused'                                 → 'paused'
 *   user has a tier, otherwise                      → 'active'
 *   user has no current tier                        → null
 */

export type SubscriptionStatus =
  | 'active'
  | 'cancelling'
  | 'past_due'
  | 'paused';

export interface SubscriptionStatusInput {
  /** tierId present = user has a current subscription on this org */
  currentTierId: string | null;
  /** Raw lifecycle status from the API (may be unknown/future values) */
  status: SubscriptionStatus | string | null;
  cancelAtPeriodEnd: boolean;
}

/**
 * Resolve the effective per-org subscription status used for UI rendering.
 * Returns `null` when the user has no current subscription for this org.
 */
export function getEffectiveStatus(
  input: SubscriptionStatusInput
): SubscriptionStatus | null {
  if (!input.currentTierId) return null;
  if (input.cancelAtPeriodEnd || input.status === 'cancelling')
    return 'cancelling';
  if (input.status === 'past_due') return 'past_due';
  if (input.status === 'paused') return 'paused';
  return 'active';
}

/**
 * Map an effective status to the set of CTAs that should render on the
 * user's current-plan tier card. The mapping matches the UX matrix in
 * Codex-7b6tp:
 *
 *   active     → disabled "Current plan" label + "Manage plan" link
 *   cancelling → primary "Reactivate plan" + "Manage plan"
 *   past_due   → primary "Update payment" + "Manage plan"
 *   paused     → primary "Resume plan" + "Manage plan"
 *
 * Codex-7h4vo enabled the resume CTA end-to-end (backend endpoint +
 * service method + remote fn now shipped), so the placeholder disabled
 * state has been removed.
 */
export interface TierCtaDescriptor {
  primary:
    | { kind: 'current'; disabled: true }
    | { kind: 'reactivate'; disabled: false }
    | { kind: 'update-payment'; disabled: false }
    | { kind: 'resume'; disabled: false };
  showManageLink: true;
}

export function getCurrentTierCta(
  status: SubscriptionStatus
): TierCtaDescriptor {
  switch (status) {
    case 'active':
      return {
        primary: { kind: 'current', disabled: true },
        showManageLink: true,
      };
    case 'cancelling':
      return {
        primary: { kind: 'reactivate', disabled: false },
        showManageLink: true,
      };
    case 'past_due':
      return {
        primary: { kind: 'update-payment', disabled: false },
        showManageLink: true,
      };
    case 'paused':
      return {
        primary: { kind: 'resume', disabled: false },
        showManageLink: true,
      };
  }
}

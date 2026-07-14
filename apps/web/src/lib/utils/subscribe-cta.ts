/**
 * Visibility decision for the org-landing Subscribe CTA (inline banner +
 * bottom-of-viewport sticky bar).
 *
 * Bug Codex-eb00a.13: both surfaces were gated only on "does the visitor
 * already have access?" (accessChecked && !hasOrgAccess), so an org with zero
 * tiers and no Stripe account still rendered a "Become a member" CTA that sent
 * visitors to a dead /pricing page.
 *
 * The fix additionally requires there to actually be something to subscribe to:
 * the `enableSubscriptions` feature flag AND at least one active tier.
 * `hasActiveTiers` is the practical public-surface proxy for Connect readiness —
 * a tier can only be created after Connect onboarding, and the public org-info
 * endpoint deliberately does not expose Stripe account status.
 */
export interface SubscribeCtaVisibilityInput {
  /** The org resolved (`!!data.org?.id`). */
  hasOrgId: boolean;
  /** `enableSubscriptions` feature flag for the org. */
  subscriptionsEnabled: boolean;
  /** At least one active subscription tier exists. */
  hasActiveTiers: boolean;
  /** Access probes (membership + subscription) have settled. */
  accessChecked: boolean;
  /** The visitor already has access (owner/member/active subscriber). */
  hasOrgAccess: boolean;
}

export function shouldShowSubscribeCta(
  i: SubscribeCtaVisibilityInput
): boolean {
  return (
    i.hasOrgId &&
    i.subscriptionsEnabled &&
    i.hasActiveTiers &&
    i.accessChecked &&
    !i.hasOrgAccess
  );
}

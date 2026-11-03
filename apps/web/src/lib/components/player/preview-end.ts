/**
 * The preview's end screen (Codex-2hxff.99; owner-approved mockup
 * locked-with-preview.html): "Preview ended", the lock's own second line,
 * then the paywall's first action. The action is chosen in the order of the
 * content page's gate chain (ContentDetailView's purchase section), so the
 * end screen and the paywall under it can't drift. Manage plan and "or
 * purchase for" stay in the paywall (owner: "Plan button only").
 *
 * Until this, the player chose by an access reason it never received: the
 * page mounts it only while the state is `preview`, so every kind ended on
 * "Get full access to this content" with Buy or nothing.
 */

import * as m from '$paraglide/messages';

export type PreviewEndAction =
  /** The paywall offers nothing here (team, course, closed, no verdict). */
  | { kind: 'none' }
  /**
   * The paywall's own SubscribeButton: Subscribe, Change Plan or Upgrade to
   * Watch, or the member's own first step (Reactivate, Update payment,
   * Resume), which it reads itself.
   */
  | {
      kind: 'plan';
      organizationId: string;
      subscribeHref: string;
      upgradeRequired: boolean;
      changePlan: boolean;
    }
  | { kind: 'link'; href: string; label: string }
  /** The player's checkout form, with the price on the button. */
  | { kind: 'buy'; label: string }
  /** Follow, for an item free for followers. */
  | { kind: 'follow' };

export interface PreviewEnd {
  /** The lock's own second line; null while the plan names load. */
  line: string | null;
  action: PreviewEndAction;
  /** Sign in, beside Watch preview again, when a signed-out visitor is shown plans. */
  signIn: { href: string; label: string } | null;
}

/** The gate as the content page has worked it out. */
export interface PreviewEndGate {
  /** The lock's second line (`lockCtaSubtext`). */
  line: string | null;
  isAuthenticated: boolean;
  organizationId: string | null;
  /** The viewer has a plan in this org: the paywall's button asks them to change it. */
  hasSubscription: boolean;
  /** Every plan that includes the item is dearer: "Upgrade to Watch", not "Change Plan". */
  upgradeOnly: boolean;
  accessCheckFailed: boolean;
  isTeamOnly: boolean;
  isCourseOnly: boolean;
  isFollowersOnly: boolean;
  isClosed: boolean;
  needsSubscription: boolean;
  needsPurchase: boolean;
  isFree: boolean;
  /** Pricing with the item marked: `/pricing?for=…&returnTo=…` (U10). */
  pricingHref: string;
  /** `/login?redirect=…`, back to this item. */
  signInHref: string;
  /** "Purchase for £4.99". */
  purchaseLabel: string;
}

export function describePreviewEnd(gate: PreviewEndGate): PreviewEnd {
  const end = (
    action: PreviewEndAction,
    signIn: PreviewEnd['signIn'] = null
  ) => ({
    line: gate.line,
    action,
    signIn,
  });
  if (gate.accessCheckFailed || gate.isTeamOnly || gate.isCourseOnly) {
    return end({ kind: 'none' });
  }
  if (gate.isFollowersOnly) {
    return gate.isAuthenticated
      ? end({ kind: 'follow' })
      : end({
          kind: 'link',
          href: '/login',
          label: m.checkout_signin_to_purchase(),
        });
  }
  if (gate.isClosed) return end({ kind: 'none' });
  if (gate.needsSubscription) {
    if (gate.isAuthenticated) {
      return end(
        gate.organizationId
          ? {
              kind: 'plan',
              organizationId: gate.organizationId,
              subscribeHref: gate.pricingHref,
              upgradeRequired: gate.hasSubscription,
              changePlan: !gate.upgradeOnly,
            }
          : { kind: 'none' }
      );
    }
    return end(
      {
        kind: 'link',
        href: gate.pricingHref,
        label: m.subscribe_cta_see_plans(),
      },
      { href: gate.signInHref, label: m.auth_signin_link() }
    );
  }
  if (gate.needsPurchase) {
    return gate.isAuthenticated
      ? end({ kind: 'buy', label: gate.purchaseLabel })
      : end({
          kind: 'link',
          href: '/login',
          label: m.checkout_signin_to_purchase(),
        });
  }
  if (gate.isFree && !gate.isAuthenticated) {
    return end({
      kind: 'link',
      href: '/login',
      label: m.content_detail_signin_watch_cta(),
    });
  }
  return end({ kind: 'none' });
}

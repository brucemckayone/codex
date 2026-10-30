/**
 * Reactive access context for org pages.
 *
 * Resolves tiers from server + subscription status from client-side
 * subscriptionCollection, and provides helpers for badge personalization
 * (isIncluded, getTierName).
 *
 * Plan access (Codex-2hxff.91): an item stores the exact set of plans that
 * include it (`includedInTierIds`). "Included" is set membership and needs no
 * tier list; only the badge's plan NAMES wait for the streamed tiers.
 *
 * User subscription data comes from subscriptionCollection (localStorage-backed)
 * instead of a server stream, saving ~567ms on authenticated page loads.
 */
import { subscriptionStatusGrantsAccess } from '@codex/constants';
import { browser } from '$app/environment';
import {
  type SubscriptionItem,
  subscriptionCollection,
} from '$lib/collections';
import type { OrgTiersContext, SubscriptionTier } from '$lib/types';
import { planBadgeLabel } from './plan-label';

interface AccessContextInput {
  // Renamed from `SubscriptionContext` to `OrgTiersContext` (Codex-lqvw4.16)
  // — this is a tier list, not a full subscription context; the prior name
  // collided with the canonical 5-field `SubscriptionContext` declared in
  // `$lib/types`.
  subscriptionContext: Promise<OrgTiersContext> | OrgTiersContext | null;
  isFollowing: Promise<boolean> | boolean;
  orgId: string;
}

interface ContentAccessItem {
  // SPEC §6.1 policy flags (WP-1) — the successor of the former
  // `accessType`/`minimumTierId` conflation. Optional/nullable so both the
  // full content row and narrower landing-page item shapes satisfy it.
  isFollowerGated?: boolean | null;
  isPurchasable?: boolean | null;
  /** The subscribers-only switch (Codex-2hxff.91). */
  isTierGated?: boolean | null;
  /** The plans that include it. Absent or `[]`: in no plan (closed if gated). */
  includedInTierIds?: readonly string[] | null;
}

/**
 * Minimal subscription shape used by the pure decision helpers — accepts the
 * full SubscriptionItem from the collection but only reads the fields needed
 * for the badge decision so the helpers stay test-friendly.
 */
type AccessGrantingSubscription = Pick<SubscriptionItem, 'status' | 'tier'>;

/**
 * Whether a subscription is in an access-granting state. The backend's own
 * list (`ACCESS_GRANTING_SUBSCRIPTION_STATUSES`): `active`, `cancelling`, and
 * `past_due` while Stripe retries a failed renewal; `paused`, `cancelled` and
 * `incomplete` do NOT. Filtering here keeps the badge consistent with what
 * the streaming gate would actually allow.
 */
export function isAccessGrantingSubscription(
  sub: { status: string } | null | undefined
): sub is AccessGrantingSubscription {
  return !!sub && subscriptionStatusGrantsAccess(sub.status);
}

/**
 * Pure decision helper for the `included` badge variant.
 *
 * Encodes two rules (WP-1 policy flags):
 *   1. `subscribers ⊇ followers` (Codex-xybr3) — any access-granting
 *      subscription covers follower-gated content (`isFollowerGated`),
 *      regardless of tier.
 *   2. Tier-gated content (`isTierGated`) — covered only when the user's
 *      plan is one of the item's ticked plans (Codex-2hxff.91). A set, not a
 *      ladder: a dearer plan does not cover a film only a cheaper one has, and
 *      a gated item with no plan ticked is covered by none.
 *
 * Returns false for free / pure-paid / team content — those surfaces use
 * `purchased` or their own labels.
 */
export function decideIsIncluded(
  item: ContentAccessItem,
  sub: AccessGrantingSubscription | null
): boolean {
  if (!sub) return false;

  if (item.isFollowerGated) return true;

  if (item.isTierGated !== true) return false;
  return item.includedInTierIds?.includes(sub.tier.id) ?? false;
}

export function useAccessContext(getData: () => AccessContextInput) {
  let resolvedTiers = $state<SubscriptionTier[]>([]);
  let resolvedIsFollowing = $state(false);

  $effect(() => {
    const { subscriptionContext, isFollowing } = getData();

    if (subscriptionContext) {
      Promise.resolve(subscriptionContext)
        .then((ctx) => {
          resolvedTiers = ctx.tiers;
        })
        .catch(() => {
          resolvedTiers = [];
        });
    }

    Promise.resolve(isFollowing)
      .then((v) => {
        resolvedIsFollowing = v;
      })
      .catch(() => {
        resolvedIsFollowing = false;
      });
  });

  /**
   * Read the user's access-granting subscription from the client-side
   * subscriptionCollection. Returns null on the server, when no subscription
   * exists, or when the subscription is in a non-access-granting state
   * (past_due / paused / cancelled / incomplete).
   */
  function getActiveSubscription(): AccessGrantingSubscription | null {
    if (!browser || !subscriptionCollection) return null;
    const { orgId } = getData();
    const sub = subscriptionCollection.state.get(orgId);
    return isAccessGrantingSubscription(sub) ? sub : null;
  }

  /**
   * Whether the user's active subscription covers a specific content item.
   * Covers subscriber-gated content (tier-aware) and followers-only content
   * (Codex-xybr3 — subscribers ⊇ followers).
   */
  function isIncluded(item: ContentAccessItem): boolean {
    return decideIsIncluded(item, getActiveSubscription());
  }

  /**
   * The badge's plan label for a content item: "Basic and above", "Pro
   * only", "Basic, Premium" (owner decision U8, `planBadgeLabel`).
   *
   * Resolves for the tier-gated shapes (`isTierGated`): subscribers-only,
   * and purchasable + in plans (the hybrid, whose badge stacks the price over
   * this label). Returns null for free / follower / team / purchase-only
   * content, for a gated item no active plan includes (a priced one then
   * shows its price alone, U11), and while the tiers are loading or after
   * they failed (the badge falls back to "Subscription").
   */
  function getTierName(item: ContentAccessItem): string | null {
    if (item.isTierGated !== true) return null;
    if (!resolvedTiers?.length) return null;
    return planBadgeLabel(item.includedInTierIds, resolvedTiers);
  }

  return {
    get isFollowing() {
      return resolvedIsFollowing;
    },
    get tiers() {
      return resolvedTiers;
    },
    get hasSubscription() {
      return getActiveSubscription() !== null;
    },
    isIncluded,
    getTierName,
  };
}

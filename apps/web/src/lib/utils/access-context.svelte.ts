/**
 * Reactive access context for org pages.
 *
 * Resolves tiers from server + subscription status from client-side
 * subscriptionCollection, and provides helpers for badge personalization
 * (isIncluded, getTierName).
 *
 * User subscription data comes from subscriptionCollection (localStorage-backed)
 * instead of a server stream, saving ~567ms on authenticated page loads.
 */
import { browser } from '$app/environment';
import {
  type SubscriptionItem,
  subscriptionCollection,
} from '$lib/collections';
import type { SubscriptionTier } from '$lib/types';

interface SubscriptionContext {
  tiers: SubscriptionTier[];
}

interface AccessContextInput {
  subscriptionContext:
    | Promise<SubscriptionContext>
    | SubscriptionContext
    | null;
  isFollowing: Promise<boolean> | boolean;
  orgId: string;
}

interface ContentAccessItem {
  accessType: string;
  minimumTierId: string | null;
}

/**
 * Minimal subscription shape used by the pure decision helpers — accepts the
 * full SubscriptionItem from the collection but only reads the fields needed
 * for the badge decision so the helpers stay test-friendly.
 */
type AccessGrantingSubscription = Pick<SubscriptionItem, 'status' | 'tier'>;

/**
 * Whether a subscription is in an access-granting state. Mirrors the backend
 * rule in `@codex/access` ContentAccessService — only `active` and
 * `cancelling` count as access-granting; `past_due`, `paused`, `cancelled`,
 * and `incomplete` do NOT. Filtering here keeps the badge consistent with
 * what the streaming gate would actually allow.
 */
export function isAccessGrantingSubscription(
  sub: { status: string } | null | undefined
): sub is AccessGrantingSubscription {
  return !!sub && (sub.status === 'active' || sub.status === 'cancelling');
}

/**
 * Pure decision helper for the `included` badge variant.
 *
 * Encodes two rules:
 *   1. `subscribers ⊇ followers` (Codex-xybr3) — any access-granting
 *      subscription covers followers-only content, regardless of tier.
 *   2. Subscriber-gated content — covered only when the user's tier
 *      `sortOrder` meets the content's `minimumTierId`. No `minimumTierId`
 *      means any tier qualifies.
 *
 * Returns false for any other access type (free, paid, team) — those
 * surfaces use `purchased` or their own labels.
 */
export function decideIsIncluded(
  item: ContentAccessItem,
  sub: AccessGrantingSubscription | null,
  tiers: SubscriptionTier[]
): boolean {
  if (!sub) return false;

  if (item.accessType === 'followers') return true;

  if (item.accessType !== 'subscribers') return false;
  if (!item.minimumTierId) return true;
  const minTier = tiers.find((t) => t.id === item.minimumTierId);
  return minTier ? sub.tier.sortOrder >= minTier.sortOrder : false;
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
    return decideIsIncluded(item, getActiveSubscription(), resolvedTiers);
  }

  /**
   * Resolve the display name of the tier required for a content item.
   * Returns null for non-subscriber content or when tiers aren't loaded yet.
   */
  function getTierName(item: ContentAccessItem): string | null {
    if (item.accessType !== 'subscribers') return null;
    if (!resolvedTiers?.length) return null;
    if (!item.minimumTierId) {
      // No minimum tier — show the cheapest tier as the entry point
      const sorted = [...resolvedTiers].sort(
        (a, b) => a.sortOrder - b.sortOrder
      );
      return sorted[0]?.name ?? null;
    }
    const tier = resolvedTiers.find((t) => t.id === item.minimumTierId);
    return tier?.name ?? null;
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

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
import { subscriptionCollection } from '$lib/collections';
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
   * Read the user's tier sort order from the client-side subscriptionCollection.
   * Returns null when no subscription exists or on the server.
   */
  function getUserTierSortOrder(): number | null {
    if (!browser || !subscriptionCollection) return null;
    const { orgId } = getData();
    const sub = subscriptionCollection.state.get(orgId);
    return sub?.tier?.sortOrder ?? null;
  }

  /**
   * Whether the user's subscription tier covers a specific content item.
   * Only applies to subscriber-gated content (accessType === 'subscribers').
   */
  function isIncluded(item: ContentAccessItem): boolean {
    const userTierSortOrder = getUserTierSortOrder();
    if (!userTierSortOrder) return false;
    if (item.accessType !== 'subscribers') return false;
    if (!item.minimumTierId) return true; // Any tier covers it
    const minTier = resolvedTiers.find((t) => t.id === item.minimumTierId);
    return minTier ? userTierSortOrder >= minTier.sortOrder : false;
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
      return getUserTierSortOrder() !== null;
    },
    isIncluded,
    getTierName,
  };
}

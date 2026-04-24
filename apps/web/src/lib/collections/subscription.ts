/**
 * Subscription Collection
 *
 * TanStack DB collection for user's subscription status per org.
 * localStorage-backed for local-first persistence.
 *
 * Keyed by organizationId — a user visiting 3 orgs gets 3 entries.
 * Bounded naturally (users don't visit thousands of orgs).
 * clearClientState() on logout wipes everything.
 *
 * Cross-device sync via version manifest:
 *   Stripe webhook bumps version key → tab return detects stale →
 *   loadSubscriptionFromServer(orgId) → localStorage updated → badges re-render.
 */
import { createCollection, localStorageCollectionOptions } from '@tanstack/db';
import { browser } from '$app/environment';
import { logger } from '$lib/observability';

export interface SubscriptionItem {
  /** The org this subscription belongs to — collection key */
  organizationId: string;
  /**
   * Org slug for subscription-to-library joins.
   *
   * Library items only expose `organizationSlug` (not `organizationId`),
   * so slug is the join key used by library surfaces to resolve a card's
   * underlying subscription status. Optional for backwards-compatibility
   * with entries written before Codex-k7ppt landed — callers should treat
   * `undefined` as "slug unknown, skip this entry when joining by slug".
   */
  organizationSlug?: string;
  /** Tier details for badge computation */
  tier: {
    id: string;
    name: string;
    sortOrder: number;
  };
  /**
   * Subscription lifecycle state — full backend enum so access-gate logic
   * can match what the server actually stores. Collapsing this to just
   * active/cancelling silently dropped paused/cancelled/incomplete from
   * downstream consumers (previously identified as U1/U8 in the audit).
   */
  status:
    | 'active'
    | 'cancelling'
    | 'past_due'
    | 'paused'
    | 'cancelled'
    | 'incomplete';
  /** When the current billing period ends */
  currentPeriodEnd: string;
  /** Whether cancellation is scheduled */
  cancelAtPeriodEnd: boolean;
}

/**
 * Narrow the arbitrary server-side status string into the client enum.
 * Unknown values default to 'active' so we don't drop the entry entirely.
 * The `cancelAtPeriodEnd` flag shadows 'active' into 'cancelling' so the
 * collection matches backend semantics (Stripe reports 'active' for the
 * remainder of the paid period after cancellation).
 */
function normaliseSubscriptionStatus(
  status: string,
  cancelAtPeriodEnd: boolean
): SubscriptionItem['status'] {
  if (status === 'active') {
    return cancelAtPeriodEnd ? 'cancelling' : 'active';
  }
  if (
    status === 'cancelling' ||
    status === 'past_due' ||
    status === 'paused' ||
    status === 'cancelled' ||
    status === 'incomplete'
  ) {
    return status;
  }
  return 'active';
}

export const subscriptionCollection = browser
  ? createCollection<SubscriptionItem, string>(
      localStorageCollectionOptions({
        storageKey: 'codex-subscription',
        getKey: (item) => item.organizationId,
      })
    )
  : undefined;

/**
 * Fetch subscription from server and reconcile with localStorage.
 * Called on version staleness detection (cross-device sync)
 * and on first hydration from SSR data.
 *
 * @param orgId - Organisation ID (collection key)
 * @param orgSlug - Optional org slug; stored alongside so library surfaces
 *   can join by slug (library items only carry `organizationSlug`). Passing
 *   the slug preserves it across reconciliation. If omitted, any existing
 *   slug on the stored entry is preserved.
 */
export async function loadSubscriptionFromServer(
  orgId: string,
  orgSlug?: string
): Promise<void> {
  if (!subscriptionCollection) return;
  try {
    const { getCurrentSubscription } = await import(
      '$lib/remote/subscription.remote'
    );
    const sub = await getCurrentSubscription(orgId);

    if (sub && sub.tier) {
      const periodEnd = sub.currentPeriodEnd;
      // Preserve a previously-stored slug if this caller didn't supply one.
      const existingSlug =
        subscriptionCollection.state.get(orgId)?.organizationSlug;
      const item: SubscriptionItem = {
        organizationId: orgId,
        ...(orgSlug || existingSlug
          ? { organizationSlug: orgSlug ?? existingSlug }
          : {}),
        tier: sub.tier,
        // Pass server status through faithfully — the previous narrow
        // 'active'/'cancelling' collapse silently dropped paused, past_due,
        // cancelled, and incomplete, breaking consumers that need to
        // render the right UI branch for each state.
        status: normaliseSubscriptionStatus(sub.status, sub.cancelAtPeriodEnd),
        currentPeriodEnd:
          periodEnd instanceof Date
            ? periodEnd.toISOString()
            : String(periodEnd),
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      };
      if (subscriptionCollection.state.has(orgId)) {
        subscriptionCollection.update(orgId, () => item);
      } else {
        subscriptionCollection.insert(item);
      }
    } else {
      // No subscription — remove if it existed (cancelled, expired)
      if (subscriptionCollection.state.has(orgId)) {
        subscriptionCollection.delete(orgId);
      }
    }
  } catch (error) {
    logger.error('Failed to refresh subscription from server', {
      orgId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

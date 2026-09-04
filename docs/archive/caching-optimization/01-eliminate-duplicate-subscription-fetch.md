# Section 1: Eliminate Duplicate Subscription Fetch

> Parent: [caching-strategy.md](../caching-strategy.md)

## Problem

The org layout and content detail page both fetch subscription context independently, resulting in duplicate HTTP round-trips to Neon on every authenticated content detail page load.

**Org layout** (`_org/[slug]/+layout.server.ts`) streams `loadUserSubscriptionContext()`:
- `api.subscription.getCurrent(orgId)` → Neon ~100ms
- `api.tiers.list(orgId)` → Neon ~150ms

**Content detail page** (`content/[contentSlug]/+page.server.ts`) calls `loadSubscriptionContext()` from `$lib/server/content-detail.ts`:
- `api.subscription.getCurrent(orgId)` → Neon ~100ms (same call, again)
- `api.tiers.list(orgId)` → Neon ~150ms (same call, again)

**Cost: ~500ms wasted per authenticated content detail page load.**

## Root Cause

The content detail page predates the layout's subscription streaming. When `loadUserSubscriptionContext()` was added to the org layout, the page's own `loadSubscriptionContext()` call was not removed.

The data shapes differ, which is why the duplication wasn't obvious:

| Source | Returns |
|--------|---------|
| Layout (`loadUserSubscriptionContext`) | `{ userTierSortOrder: number \| null, tiers: SubscriptionTier[] }` |
| Page (`loadSubscriptionContext`) | `{ requiresSubscription, hasSubscription, subscriptionCoversContent, currentSubscription, tiers }` |

The page needs `subscriptionCoversContent` — whether the user's subscription tier is high enough for *this specific content item*. This requires the content's `minimumTierId` and `accessType`, which the layout doesn't have. So the page fetches everything again to compute this one derived boolean.

## Solution

Add a pure function `deriveContentSubscriptionContext()` that takes the layout's already-fetched data plus content-specific fields and computes the full `SubscriptionContext`. Zero HTTP calls.

The existing `loadSubscriptionContext()` stays intact — the `_creators` route has no parent layout subscription context and still needs it.

## Implementation

### `apps/web/src/lib/server/content-detail.ts`

Add new function (reuses existing tier comparison logic from lines 88-132):

```typescript
/**
 * Derive subscription context from layout's already-fetched data.
 * Pure computation — no HTTP calls. Used by org content detail page
 * to avoid re-fetching what the parent layout already streamed.
 */
export function deriveContentSubscriptionContext(
  layoutCtx: { userTierSortOrder: number | null; tiers: SubscriptionTier[] },
  contentMinimumTierId: string | null,
  contentAccessType?: string
): SubscriptionContext {
  const isSubscriberContent =
    contentAccessType === 'subscribers' || !!contentMinimumTierId;

  if (!isSubscriberContent) {
    return {
      requiresSubscription: false,
      hasSubscription: false,
      subscriptionCoversContent: false,
      currentSubscription: null,
      tiers: layoutCtx.tiers,
    };
  }

  const hasSubscription = layoutCtx.userTierSortOrder !== null;
  let subscriptionCoversContent = false;

  if (hasSubscription) {
    if (!contentMinimumTierId) {
      // No minimum tier — any subscription grants access
      subscriptionCoversContent = true;
    } else {
      const contentTier = layoutCtx.tiers.find(t => t.id === contentMinimumTierId);
      if (contentTier) {
        subscriptionCoversContent = layoutCtx.userTierSortOrder! >= contentTier.sortOrder;
      }
    }
  }

  return {
    requiresSubscription: true,
    hasSubscription,
    subscriptionCoversContent,
    currentSubscription: null, // Layout doesn't pass full subscription object — not needed for badges
    tiers: layoutCtx.tiers,
  };
}
```

**Note on `currentSubscription: null`:** The content detail page uses `subscriptionCoversContent` (boolean) for the access badge, and `tiers` for the subscribe modal. The full `currentSubscription` object is not used in the content detail UI. If a future feature needs it, the layout's data shape should be extended to include it.

### `apps/web/src/routes/_org/[slug]/(space)/content/[contentSlug]/+page.server.ts`

Replace both the authenticated and unauthenticated branches:

```typescript
// Before (both branches):
subscriptionContext: loadSubscriptionContext(
  org.id,
  content.minimumTierId ?? null,
  platform,
  cookies,
  content.accessType
)

// After:
const layoutSubCtx = await parentData.subscriptionContext;
const subscriptionContext = deriveContentSubscriptionContext(
  layoutSubCtx,
  content.minimumTierId ?? null,
  content.accessType
);
```

The `await` resolves the layout's streamed promise. This is safe — subscription context is non-critical data that was being streamed anyway. Awaiting it here means the content detail page waits for the layout's subscription fetch (one set of calls) instead of making its own parallel fetch (a second set of calls). Net result: one set of calls instead of two.

### Files NOT Changed

**`apps/web/src/routes/_creators/[username]/content/[contentSlug]/+page.server.ts`** — No parent layout subscription context. Continues to call `loadSubscriptionContext()` directly. Confirmed: the `_creators` layout at `_creators/[username]/+layout.server.ts` has no `loadUserSubscriptionContext()`.

## Estimated Impact

~500ms saved per authenticated content detail page load (2 HTTP round-trips to Neon eliminated).

## Verification

1. Load content detail as authenticated user → "Included" / "Subscribe" badges appear correctly
2. Load content detail as unauthenticated user → subscribe modal shows correct tiers
3. Check worker logs → only 1 set of `getCurrent` + `tiers.list` calls per page load, not 2
4. Load `_creators` content detail → still works (independent code path, unchanged)
5. Content with no subscription requirement → `requiresSubscription: false`, no subscribe modal
6. Content with minimum tier higher than user's subscription → shows "Upgrade" correctly

## Dependencies

None. This is a pure refactor with no new infrastructure. Can be implemented independently of all other sections.

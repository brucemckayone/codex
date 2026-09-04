# Section 3: Subscription Status localStorage Collection

> Parent: [caching-strategy.md](../caching-strategy.md)

## Problem

`api.subscription.getCurrent(orgId)` hits Neon on every authenticated org page load (~100-150ms). The org layout streams this so it doesn't block first paint, but it adds latency to subscription badge resolution and is redundant across client-side navigations within the same org.

**Current flow on every page:**
```
User navigates landing → explore → content → pricing
Layout server load runs once (SvelteKit dedup), fetches subscription from Neon
BUT: content detail page ALSO fetches subscription (Section 1 fixes this)
```

Even after Section 1 eliminates the duplicate, the layout still hits Neon on every fresh page load / tab return.

## Why localStorage

Subscription status is **user x org scoped**. Two caching options:

| Approach | Read latency on navigation | Server round-trip | Cross-device sync |
|----------|---------------------------|-------------------|-------------------|
| KV cache (server) | ~50-80ms (server load → KV → client) | Yes, every time | Immediate via KV |
| localStorage (client) | ~0ms (direct read) | No, after first visit | Via version manifest |

localStorage wins on the common case (navigating between pages) at the cost of slightly delayed cross-device sync. The version manifest pattern (already proven with `libraryCollection`) handles cross-device sync: Stripe webhook bumps version key → tab return detects stale → refetches → updates localStorage.

## Why a Full TanStack DB Collection

Alternatives considered:

| Approach | Reactivity | SSR safety | Reconciliation | Plumbing |
|----------|-----------|------------|----------------|----------|
| TanStack DB collection | `useLiveQuery` — automatic | `ssrData` option | Built-in upsert+remove | Standard (hydration.ts) |
| Simple localStorage + `$state` | Manual `$derived` wiring | Manual SSR guard | Manual | Custom |
| `$state` store (`.svelte.ts`) | Svelte runes | Manual SSR guard | Manual | Lightweight |

The TanStack DB collection approach wins because:
- Components already use `useLiveQuery` for library items — same pattern
- SSR hydration bridge is established (`hydrateIfNeeded`, `ssrData`)
- Reconciliation (upsert + remove) handles edge cases (subscription cancelled on server)
- The plumbing already exists in `hydration.ts` — just add branches

The `$state` store (Section 4's approach for following) is lighter but doesn't give us `useLiveQuery` reactivity. For subscription — which affects badges, access gates, and pricing UI across multiple components — reactive queries are worth the plumbing.

## Design Challenge: Org-Scoped Invalidation

The existing `invalidateCollection('library')` calls `loadLibraryFromServer()` which fetches ALL library items (no parameters needed).

For subscription, we need `loadSubscriptionFromServer(orgId)` — but `invalidateCollection()` doesn't accept parameters.

**Decision: Call `loadSubscriptionFromServer(orgId)` directly from the layout's staleness effect.**

The org layout already has `data.org.id` in scope when the `$effect` fires. Adding an orgId parameter to `invalidateCollection()` would complicate the generic API for a single consumer.

```typescript
// In _org/[slug]/+layout.svelte $effect
$effect(() => {
  if (!browser) return;
  void Promise.resolve(data.versions).then((versions) => {
    const staleKeys = getStaleKeys(versions ?? {});
    if (staleKeys.some((k) => k.includes(':content'))) {
      void invalidateCollection('content');
    }
    if (staleKeys.some((k) => k.includes(':library'))) {
      void invalidateCollection('library');
    }
    if (staleKeys.some((k) => k.includes(':subscription'))) {
      void loadSubscriptionFromServer(data.org.id);
    }
    updateStoredVersions(versions ?? {});
  });
});
```

## Data Shape

```typescript
export interface SubscriptionItem {
  /** The org this subscription belongs to — collection key */
  organizationId: string;
  /** Tier details for badge computation */
  tier: {
    id: string;
    name: string;
    sortOrder: number;
  };
  /** Subscription lifecycle state */
  status: 'active' | 'cancelling' | 'past_due';
  /** When the current billing period ends */
  currentPeriodEnd: string;
  /** Whether cancellation is scheduled */
  cancelAtPeriodEnd: boolean;
}
```

Keyed by `organizationId`. A user visiting 3 orgs gets 3 entries. This is bounded — users don't visit thousands of orgs. `clearClientState()` on logout wipes everything.

## Implementation

### New file: `apps/web/src/lib/collections/subscription.ts`

```typescript
import { createCollection, localStorageCollectionOptions } from '@tanstack/db';
import { browser } from '$app/environment';
import { logger } from '$lib/observability';

export interface SubscriptionItem {
  organizationId: string;
  tier: { id: string; name: string; sortOrder: number };
  status: 'active' | 'cancelling' | 'past_due';
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
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
 */
export async function loadSubscriptionFromServer(orgId: string): Promise<void> {
  if (!subscriptionCollection) return;
  try {
    // Import dynamically to avoid circular deps with remote functions
    const { getOrgSubscription } = await import('$lib/remote/subscription.remote');
    const sub = await getOrgSubscription(orgId);

    if (sub) {
      const item: SubscriptionItem = {
        organizationId: orgId,
        tier: sub.tier,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
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
```

### `apps/web/src/lib/collections/hydration.ts`

Add `'subscription'` to `CollectionKey` type and add branches:

```typescript
import { subscriptionCollection, type SubscriptionItem } from './subscription';

export const COLLECTION_KEYS = {
  content: ['content'] as const,
  library: ['library'] as const,
  subscription: ['subscription'] as const,
} as const;

export type CollectionKey = keyof typeof COLLECTION_KEYS;

// In hydrateCollection():
if (collection === 'subscription') {
  if (!subscriptionCollection) return;
  for (const item of data as SubscriptionItem[]) {
    const key = item.organizationId;
    if (subscriptionCollection.state.has(key)) {
      subscriptionCollection.update(key, () => item);
    } else {
      subscriptionCollection.insert(item);
    }
  }
  return;
}

// In isCollectionHydrated():
if (collection === 'subscription') {
  return (subscriptionCollection?.state.size ?? 0) > 0;
}
```

**Note:** `invalidateCollection('subscription')` is intentionally NOT added — org-scoped invalidation is called directly from the layout (see Design Challenge above).

### `apps/web/src/lib/collections/index.ts`

Add exports:

```typescript
export {
  subscriptionCollection,
  loadSubscriptionFromServer,
  type SubscriptionItem,
} from './subscription';
```

### `apps/web/src/lib/client/version-manifest.ts`

Add to `CODEX_STORAGE_KEYS`:

```typescript
const CODEX_STORAGE_KEYS = [
  MANIFEST_KEY,
  'codex-library',
  'codex-playback-progress',
  'codex-subscription',  // NEW
] as const;
```

### `packages/cache/src/cache-keys.ts`

Add version key for cross-device staleness:

```typescript
/**
 * Client manifest + server KV — user-scoped subscription per org.
 * Bumped when subscription changes (checkout, tier change, cancel, reactivate).
 * Tracked in client manifest for cross-device staleness detection.
 */
COLLECTION_USER_SUBSCRIPTION: (userId: string, orgId: string): string =>
  `user:${userId}:subscription:${orgId}`,
```

### `apps/web/src/routes/_org/[slug]/+layout.server.ts`

In `readOrgVersions()`, add subscription version key:

```typescript
const subscriptionKey = userId
  ? CacheType.COLLECTION_USER_SUBSCRIPTION(userId, orgId)
  : null;

const keys = [
  orgConfigKey,
  orgContentKey,
  ...(libraryKey ? [libraryKey] : []),
  ...(subscriptionKey ? [subscriptionKey] : []),  // NEW
];
```

### `apps/web/src/routes/_org/[slug]/+layout.svelte`

Two changes:

1. **Staleness effect** — add subscription check (shown above in Design Challenge)
2. **Hydration on mount** — hydrate collection from layout's streamed subscription context:

```typescript
onMount(() => {
  // Hydrate subscription collection from layout's SSR data
  if (data.subscriptionContext) {
    void Promise.resolve(data.subscriptionContext).then((ctx) => {
      if (ctx.userTierSortOrder !== null && ctx.tiers.length > 0) {
        // User has a subscription — find the matching tier
        const userTier = ctx.tiers.find(t => t.sortOrder === ctx.userTierSortOrder);
        if (userTier) {
          hydrateSubscription(data.org.id, {
            organizationId: data.org.id,
            tier: userTier,
            status: 'active', // Layout doesn't expose full status — assume active
            currentPeriodEnd: '',
            cancelAtPeriodEnd: false,
          });
        }
      }
    });
  }
  // ... existing visibilitychange + progress sync setup
});
```

**Limitation:** The layout's `loadUserSubscriptionContext` returns `{ userTierSortOrder, tiers }`, not the full subscription object. For the collection to store full subscription details, either:
- (a) Extend the layout's subscription fetch to return the full object, or
- (b) Do a full `loadSubscriptionFromServer(orgId)` on first mount to populate complete data

Option (b) is safer — it means the first visit does one full fetch that populates localStorage completely, and subsequent navigations use localStorage. The layout's SSR data provides enough for first-paint badges; the full collection data fills in on mount.

### Server-side: Version key bumping

**`workers/ecom-api/src/handlers/subscription-webhook.ts`**

Add alongside existing `invalidateUserLibraryCache()`:

```typescript
function invalidateSubscriptionCache(
  c: Context<StripeWebhookEnv>,
  stripeSubscription: Stripe.Subscription
): void {
  const userId = stripeSubscription.metadata?.codex_user_id;
  const orgId = stripeSubscription.metadata?.codex_organization_id;
  if (userId && orgId && c.env.CACHE_KV) {
    const cache = new VersionedCache({ kv: c.env.CACHE_KV });
    c.executionCtx.waitUntil(
      cache.invalidate(CacheType.COLLECTION_USER_SUBSCRIPTION(userId, orgId)).catch(() => {})
    );
  }
}
```

Call after each webhook handler:
- `handleSubscriptionCreated` (line ~106)
- `handleSubscriptionDeleted` (line ~133)
- `handleSubscriptionUpdated` (wherever it's handled)

**`workers/ecom-api/src/routes/subscriptions.ts`**

Add version bumps to user-initiated mutations:

```typescript
// POST /change-tier, /cancel, /reactivate — after service call:
if (ctx.env.CACHE_KV) {
  const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
  ctx.executionCtx.waitUntil(
    cache.invalidate(
      CacheType.COLLECTION_USER_SUBSCRIPTION(ctx.user.id, ctx.input.body.organizationId)
    ).catch(() => {})
  );
}
```

## Data Flow

### First visit (SSR):
```
Server load → Neon (~150ms) → SSR render with badges → client hydrates localStorage
```

### Subsequent navigation (client):
```
localStorage read (0ms) → badges render instantly → no server call
```

### Cross-device sync:
```
Subscribe on phone → webhook bumps version key in KV
Desktop tab return → visibilitychange → server reads version key (~10ms)
→ stale detected → loadSubscriptionFromServer(orgId) → Neon (~150ms)
→ localStorage updated → badges re-render
```

### Optimistic update (after checkout success):
```
Checkout success page → upsert subscription into localStorage (0ms)
→ navigate to content → "Included" badge appears instantly
→ version check on next cycle confirms server state matches
```

## Estimated Impact

~100-150ms saved on every authenticated org navigation after first visit. The first visit still fetches from Neon, but that cost is paid once and then amortised across all subsequent navigations.

## Verification

1. Browse org as authenticated user → subscription badges ("Included", tier name) appear correctly
2. Navigate landing → content → pricing → back → no subscription HTTP calls in Network tab after first page
3. Subscribe via Stripe checkout → return to org → "Included" badges appear
4. Cancel subscription → return to org → badges reflect cancellation (within version check cycle)
5. Subscribe on different device → return to first device's tab → version check detects stale → badges update
6. Log out → `clearClientState()` removes `codex-subscription` from localStorage
7. Visit different org → separate subscription entry in localStorage, correct badges per org
8. User with no subscription to any org → collection stays empty, no errors

## Dependencies

- Section 1 (eliminate duplicate fetch) should be done first — it establishes the pattern of consuming layout subscription data in child pages
- Section 2 (tiers write-through) is independent but shares `cache-keys.ts`
- Adds `COLLECTION_USER_SUBSCRIPTION` to `packages/cache/src/cache-keys.ts`

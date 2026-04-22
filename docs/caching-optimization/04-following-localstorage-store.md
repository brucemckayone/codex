# Section 4: Following Status in localStorage

> Parent: [caching-strategy.md](../caching-strategy.md)

## Problem

`api.org.isFollowing(orgId)` hits Neon on every authenticated org page load (~50-100ms). Returns a simple boolean. Called from the org layout's `loadUserSubscriptionContext` flow, streamed but still a Neon round-trip.

## Why This Data Is Different

Following status has unique characteristics that distinguish it from every other cached entity:

| Property | Following | Subscription | Library |
|----------|-----------|-------------|---------|
| Changed by | User click only | Stripe webhook | Stripe webhook |
| External triggers | None | Yes (webhook) | Yes (webhook) |
| Cross-device urgency | None | Medium | Medium |
| Data shape | Boolean per org | Object per org | Array of items |
| Staleness tolerance | Very high | Moderate | Moderate |

**Key insight:** The user who changes following status is always the one who needs to see it. There's no external system (webhook, admin, cron job) that changes it. This means:
- Optimistic updates are always correct (the client knows the true state)
- No version key is needed (the client that mutated is already up to date)
- Cross-device sync is low priority (different device gets the right state on its first full page load)

## Why Not a Full TanStack DB Collection

A TanStack DB collection requires:
- Type definition with keyed interface
- `createCollection()` with `localStorageCollectionOptions`
- Reconciliation function (`loadFromServer`)
- Hydration branches in `hydration.ts`
- `useLiveQuery` wrapper with `ssrData` option
- Collection key registration

This is heavy machinery for `{ [orgId]: boolean }`. The only component that reads this value is the Follow button — it doesn't need `useLiveQuery` cross-component reactivity.

## Why Not KV Cache

KV caching would mean:
- Server round-trip on every version check (~50ms)
- Version key management (bump on follow/unfollow)
- KV read + write operations (cost, though minimal)

All of this for data that the client already knows the true state of. KV adds latency and complexity for no benefit.

## Design

A lightweight Svelte 5 reactive store backed by localStorage. Follows the `brandEditor` store pattern at `apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts`.

**Critical:** Must use `.svelte.ts` extension. Svelte 5 only processes runes (`$state`, `$derived`) in `.svelte` and `.svelte.ts` files.

### Store implementation

```typescript
// apps/web/src/lib/client/following.svelte.ts
import { browser } from '$app/environment';

const STORAGE_KEY = 'codex-following';

function readStore(): Record<string, boolean> {
  if (!browser) return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeStore(data: Record<string, boolean>) {
  if (!browser) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage full or blocked — silent fail
  }
}

let data = $state<Record<string, boolean>>(readStore());

export const followingStore = {
  /** Read follow state — reactive when used in $derived */
  get: (orgId: string): boolean => data[orgId] ?? false,

  /** Set follow state (optimistic update + persist) */
  set: (orgId: string, following: boolean) => {
    data[orgId] = following;
    writeStore(data);
  },

  /**
   * Hydrate from server on first load.
   * No-op if org is already in the store (localStorage persists across refresh).
   * This prevents overwriting an optimistic update with stale server data.
   */
  hydrate: (orgId: string, following: boolean) => {
    if (data[orgId] === undefined) {
      data[orgId] = following;
      writeStore(data);
    }
  },
};
```

### Component usage pattern

```svelte
<script lang="ts">
  import { followingStore } from '$lib/client/following.svelte';

  interface Props { orgId: string }
  const { orgId }: Props = $props();

  const isFollowing = $derived(followingStore.get(orgId));

  async function toggleFollow() {
    const wasFollowing = followingStore.get(orgId);
    // Optimistic update — instant UI
    followingStore.set(orgId, !wasFollowing);
    try {
      if (wasFollowing) {
        await api.org.unfollow(orgId);
      } else {
        await api.org.follow(orgId);
      }
    } catch {
      // Rollback on error
      followingStore.set(orgId, wasFollowing);
    }
  }
</script>

<button onclick={toggleFollow}>
  {isFollowing ? 'Following' : 'Follow'}
</button>
```

### Hydration from server

The org layout already streams `isFollowing` from the server load. On mount, hydrate the store:

```typescript
// In _org/[slug]/+layout.svelte onMount
void Promise.resolve(data.isFollowing).then((following) => {
  followingStore.hydrate(data.org.id, following);
});
```

The `hydrate()` method is a no-op if the org is already in the store. This means:
- First visit: server data populates the store
- Return visit (localStorage has it): server data is ignored, localStorage wins
- After optimistic update: server data doesn't overwrite the optimistic state

## Implementation

### New file: `apps/web/src/lib/client/following.svelte.ts`

As shown above. Located alongside `version-manifest.ts` in the client utilities.

### `apps/web/src/lib/client/version-manifest.ts`

Add to `CODEX_STORAGE_KEYS` for logout cleanup:

```typescript
const CODEX_STORAGE_KEYS = [
  MANIFEST_KEY,
  'codex-library',
  'codex-playback-progress',
  'codex-following',  // NEW
] as const;
```

### `apps/web/src/routes/_org/[slug]/+layout.svelte`

Hydrate on mount after `data.isFollowing` resolves (shown above).

### `apps/web/src/routes/_org/[slug]/+layout.server.ts`

**No changes.** Keep `api.org.isFollowing(orgId)` for SSR on first visit. The server fetch provides the initial hydration value.

### Follow/unfollow button component

Wherever the follow button lives — use the optimistic pattern shown above. The server API calls (`POST/DELETE /api/organizations/:id/followers`) remain unchanged.

## Data Flow

### First visit:
```
Server load → Neon: isFollowing(orgId) (~50ms, streamed)
→ client resolves → followingStore.hydrate(orgId, true/false)
→ localStorage persisted
```

### Subsequent navigation (same session or refresh):
```
localStorage read (0ms) → button shows correct state → no server call
```

### User clicks Follow:
```
followingStore.set(orgId, true) (0ms) → button updates instantly
→ background: POST /followers → server updates DB
→ on error: followingStore.set(orgId, false) (rollback)
```

### Different device:
```
Server load on first visit → Neon: isFollowing(orgId) → hydrate
(No version key — different device gets truth from server on first load)
```

## Estimated Impact

~50-100ms saved per authenticated org page load after first visit. Zero KV cost (no version keys, no KV reads, no KV writes). Simplest implementation of all sections.

## Verification

1. Click Follow → button updates instantly (no loading spinner needed)
2. Click Unfollow → button updates instantly
3. Navigate to another page → Follow button still shows correct state
4. Hard refresh → localStorage persists, correct state shown immediately
5. Simulate server error → button rolls back to previous state
6. Log out → `clearClientState()` removes `codex-following` from localStorage
7. Log in as different user → different following state per user
8. Visit multiple orgs → each org has its own entry in localStorage

## Dependencies

None. Fully independent of all other sections. Can be implemented first.

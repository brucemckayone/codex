# Phase 1 + 2 — P0 (PR 1)

**Goal:** Fix the two user-visible symptoms and close the webhook/direct-mutation invalidation gaps.

## Scope

Phase 1 — webhook + direct mutation gaps:
- `customer.subscription.updated` → add `COLLECTION_USER_LIBRARY` invalidation
- `invoice.payment_succeeded` → add both cache invalidations
- `invoice.payment_failed` → add both cache invalidations
- `charge.refunded` → add `COLLECTION_USER_LIBRARY` invalidation
- `/subscriptions/cancel`, `/change-tier`, `/reactivate` → add `COLLECTION_USER_LIBRARY` invalidation
- Factor shared helpers into `packages/subscription/src/services/subscription-invalidation.ts`

Phase 2 — account page:
- `apps/web/src/routes/(platform)/account/subscriptions/+page.server.ts` — **new file** with `depends('account:subscriptions')`
- `apps/web/src/routes/(platform)/account/subscriptions/+page.svelte` — replace `invalidate('cache:versions')` with `invalidate('account:subscriptions')`, plus add optimistic update on cancel + invalidate `'library'`/`'subscription'` TanStack collections
- `apps/web/src/routes/(platform)/account/+layout.server.ts` (augment if exists) — read per-org subscription versions into the versions manifest

## Design — shared invalidation helper

New file `packages/subscription/src/services/subscription-invalidation.ts`:

```ts
import { VersionedCache, CacheType } from '@codex/cache';
import type { ExecutionContext } from 'hono';

export interface InvalidateForUserArgs {
  userId: string;
  orgId?: string;           // Optional: only relevant for org-scoped subscriptions
  reason: 'cancel' | 'reactivate' | 'change_tier' | 'payment_failed'
        | 'payment_succeeded' | 'refund' | 'subscription_deleted'
        | 'subscription_updated';
}

export async function invalidateForUser(
  cache: VersionedCache,
  waitUntil: (promise: Promise<unknown>) => void,
  args: InvalidateForUserArgs,
): Promise<void> {
  const { userId, orgId } = args;
  waitUntil(cache.invalidate(CacheType.COLLECTION_USER_LIBRARY, userId).catch(() => {}));
  if (orgId) {
    waitUntil(cache.invalidate(CacheType.COLLECTION_USER_SUBSCRIPTION, userId, orgId).catch(() => {}));
  }
}
```

### Why both caches on every event

The gap matrix shows every mutation affects **both** the library (what content can I see) and the subscription badge (what's my active tier on org X). Invalidating only one leads to split-brain UI.

## Design — account page refresh

**Root cause of hard-refresh bug:** `+page.svelte` line 73 calls `invalidate('cache:versions')`. Only the platform layout depends on that key, so the `+page.server.ts` load never re-runs and the cancelled subscription never re-fetches.

**Fix:** introduce a dedicated depends key on the page itself, and invalidate *that* key on cancel success.

```ts
// apps/web/src/routes/(platform)/account/subscriptions/+page.server.ts
import type { PageServerLoad } from './$types';
import { createServerApi } from '$lib/server/api';

export const load: PageServerLoad = async ({ platform, cookies, depends }) => {
  depends('account:subscriptions');
  const api = createServerApi(platform, cookies);
  const subscriptions = await api.subscription.getMine();
  return { subscriptions };
};
```

```svelte
<!-- apps/web/src/routes/(platform)/account/subscriptions/+page.svelte -->
<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { invalidateCollection } from '$lib/collections/invalidate';
  // ...
  async function handleCancel(organizationId: string, reason?: string) {
    // Optimistic: flip the local subscription state immediately
    const existing = data.subscriptions.find(s => s.organizationId === organizationId);
    if (existing && existing.status !== 'cancelling') {
      existing.status = 'cancelling';
      existing.cancelAtPeriodEnd = true;
    }
    try {
      await cancelSubscription({ organizationId, reason });
      await Promise.all([
        invalidate('account:subscriptions'),
        invalidateCollection('library'),
        invalidateCollection('subscription'),
      ]);
    } catch (err) {
      // Rollback optimistic state on failure
      if (existing) {
        existing.status = 'active';
        existing.cancelAtPeriodEnd = false;
      }
      throw err;
    }
  }
</script>
```

### Melt UI echo guard (per memory `feedback_melt_controlled_components`)

The optimistic update includes an early return (`if (existing && existing.status !== 'cancelling')`) so that if the server-reconciled state arrives with the same status, we don't re-trigger effect dependencies. Critical because this runs inside a Melt controlled dialog.

## Files touched

| File | Change |
|---|---|
| `packages/subscription/src/services/subscription-invalidation.ts` | **new** — shared helpers |
| `packages/subscription/src/services/index.ts` | export new helpers |
| `workers/ecom-api/src/handlers/subscription-webhook.ts` | use shared helpers; add library invalidate to 4 events |
| `workers/ecom-api/src/handlers/payment-webhook.ts` | add library invalidate on `charge.refunded` |
| `workers/ecom-api/src/routes/subscriptions.ts` | add library invalidate on 3 endpoints |
| `packages/subscription/src/services/subscription-service.ts` | return `userId` from `handleInvoicePayment{Succeeded,Failed}` |
| `apps/web/src/routes/(platform)/account/subscriptions/+page.server.ts` | **new** — `depends('account:subscriptions')` + `getMine()` |
| `apps/web/src/routes/(platform)/account/subscriptions/+page.svelte` | replace `invalidate('cache:versions')` → `invalidate('account:subscriptions')`; add optimistic + collection invalidations |

## Test coverage (required before close)

### Unit (`packages/subscription/src/services/__tests__/subscription-invalidation.test.ts`)

- `invalidateForUser({ userId })` → bumps library only
- `invalidateForUser({ userId, orgId })` → bumps both
- Errors in cache swallowed (fire-and-forget semantics preserved)
- `waitUntil` called synchronously (does not block return)

### Unit (`packages/subscription/src/services/__tests__/subscription-service.test.ts`)

- `cancelSubscription` returns `{ userId, orgId }` in result so route can invalidate
- `changeTier` returns same
- `reactivateSubscription` returns same
- `handleInvoicePaymentSucceeded` returns `{ userId, orgId }` on both renewal and initial invoice
- `handleInvoicePaymentFailed` returns `{ userId, orgId }`

### Integration (`workers/ecom-api/src/__tests__/subscription-webhook.test.ts`)

For each of `customer.subscription.updated`, `invoice.payment_succeeded`, `invoice.payment_failed`, `charge.refunded`:

- **Positive:** webhook fires → both KV version keys bump
- **Negative:** webhook without `userId` (malformed) → no cache writes, no crash, 200 still returned
- **Idempotency:** same webhook twice → both bumps fire (KV version increments monotonically)

### Integration (`workers/ecom-api/src/__tests__/subscriptions-route.test.ts`)

For each of `/cancel`, `/change-tier`, `/reactivate`:
- Authenticated call → both KV version keys bump
- Auth missing → 401, no cache writes
- Service throws → error propagates, no partial cache state

### E2E Playwright (`apps/web/e2e/account-subscription-cancel.spec.ts`)

1. Login as `creator@test.com`, confirm active subscription exists (fixture)
2. Open `/account/subscriptions`, click Cancel for a given org
3. Confirm `CANCELLING` badge appears **without page reload** within 1 render tick
4. Reload page — confirm badge persists (not just optimistic state)
5. Confirm `currentPeriodEnd` still visible (revocation is at period end, not immediate)

### Cross-device Playwright

1. Tab A: `/account/subscriptions` → Cancel
2. Tab B (same user): `/{org}/` → visibility change → confirm cancelling state surfaces in subscription collection (subscribeButton badge, etc.)

## Verification checklist (task is not done until all pass)

- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` green (all new unit + integration tests)
- [ ] `pnpm test:e2e` green on the two Playwright specs above
- [ ] Manual smoke: cancel → no hard refresh needed → `CANCELLING` visible
- [ ] `stripe trigger customer.subscription.updated` + `wrangler kv:key list` → version keys bumped
- [ ] `stripe trigger invoice.payment_failed` → both keys bumped
- [ ] `stripe trigger invoice.payment_succeeded` → both keys bumped
- [ ] `stripe trigger charge.refunded` → library key bumped
- [ ] No regression: org page library loads still work for active subscribers

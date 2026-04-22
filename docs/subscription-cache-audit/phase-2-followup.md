# Phase 3 + 4 + 5 — Defense-in-depth (PR 2)

**Goal:** Close the streaming exposure window, remove missing handlers, add a service-level orchestrator hook, and lock everything in with exhaustive test coverage.

## Phase 3 — Streaming revocation (Option B)

### Problem

Presigned R2 URLs are cryptographic: once issued, they work until their TTL expires. Today the default TTL is **3600s (1 hour)**. After `customer.subscription.deleted` fires (period end), a user can still stream for up to 60 more minutes using a URL issued before cancellation.

### Solution — two-layer mitigation

1. **Shorten TTL** → `600s` (10 min) default in `ContentAccessService.getStreamingUrl()`. Reduces max exposure to 10 min without deep rework. Keep the parameter overridable per-call (e.g. for long-form downloads if any exist — grep says none today).

2. **KV revocation list** — per-user KV key `revoked:user:{userId}:{orgId}` with value `{ revokedAt, reason }`. TTL = 1200s (2× max URL TTL, safety margin for in-flight signed URLs).

   - **Written by:** `customer.subscription.deleted` webhook, `invoice.payment_failed` webhook (transitions to PAST_DUE), `charge.refunded` webhook (subscription-linked invoice)
   - **Cleared by:** `customer.subscription.updated` → ACTIVE, `invoice.payment_succeeded` after PAST_DUE, explicit reactivation
   - **Checked by:** `ContentAccessService.getStreamingUrl()` before minting the URL — if present and current request maps to the revoked scope, throw `AccessDeniedError` immediately
   - **NOT written by:** `cancel_at_period_end=true` toggle. User still has paid access through `currentPeriodEnd` by product decision.

### New file: `packages/access/src/services/access-revocation.ts`

```ts
import type { KVNamespace } from '@cloudflare/workers-types';

export type RevocationReason =
  | 'subscription_deleted'
  | 'payment_failed'
  | 'refund'
  | 'admin_revoke';

export interface Revocation {
  revokedAt: string;
  reason: RevocationReason;
}

const TTL_SECONDS = 1200;

export class AccessRevocation {
  constructor(private readonly kv: KVNamespace) {}

  private key(userId: string, orgId: string): string {
    return `revoked:user:${userId}:${orgId}`;
  }

  async revoke(userId: string, orgId: string, reason: RevocationReason): Promise<void> {
    const value: Revocation = { revokedAt: new Date().toISOString(), reason };
    await this.kv.put(this.key(userId, orgId), JSON.stringify(value), {
      expirationTtl: TTL_SECONDS,
    });
  }

  async isRevoked(userId: string, orgId: string): Promise<Revocation | null> {
    const raw = await this.kv.get(this.key(userId, orgId));
    return raw ? (JSON.parse(raw) as Revocation) : null;
  }

  async clear(userId: string, orgId: string): Promise<void> {
    await this.kv.delete(this.key(userId, orgId));
  }
}
```

### Wire points

- `ContentAccessService.getStreamingUrl()`:
  ```ts
  const revocation = await this.revocation.isRevoked(userId, orgId);
  if (revocation) {
    throw new AccessDeniedError('Access revoked', { reason: revocation.reason });
  }
  ```
- Webhook handlers call `revocation.revoke(userId, orgId, reason)` alongside DB mutations
- Successful payment / reactivation calls `revocation.clear(userId, orgId)`

## Phase 4 — Defense-in-depth

### 4.1 `savePlaybackProgress` access check

File: `packages/access/src/services/ContentAccessService.ts` — `savePlaybackProgress()` currently assumes the caller has checked access. Add an explicit check:

```ts
const hasAccess = await this.hasContentAccess(userId, contentId);
if (!hasAccess) {
  throw new ForbiddenError('No active access for this content');
}
```

**Why:** prevents cancelled users from continuing to POST progress and accidentally restoring "continue watching" entries that create the impression of entitlement.

### 4.2 Missing Stripe event handlers

Add handlers (even as stubs) for:

- `customer.subscription.paused` → update `subscriptions.status` to new `PAUSED`; revoke (revocation list); invalidate both caches
- `customer.subscription.resumed` → transition back to `ACTIVE`; clear revocation; invalidate both caches
- `customer.subscription.trial_will_end` → notifications service email trigger only (no access change)
- `charge.dispute.created` → behaves like refund for access purposes; revoke + invalidate + mark purchase as disputed

### 4.3 Service orchestrator hook

Every public mutation in `SubscriptionService` ends with:

```ts
await invalidateForUser(this.cache, this.waitUntil, { userId, orgId, reason });
```

This replaces the current "remember to call invalidate in each route" pattern. Routes become thin pass-through calls.

## Files touched

| File | Change |
|---|---|
| `packages/access/src/services/access-revocation.ts` | **new** |
| `packages/access/src/services/ContentAccessService.ts` | revocation check in `getStreamingUrl`; access check in `savePlaybackProgress`; shorten default TTL to 600s |
| `packages/access/src/index.ts` | export `AccessRevocation` |
| `workers/ecom-api/src/handlers/subscription-webhook.ts` | revocation writes on deleted/paused; revocation clears on resumed/ACTIVE; add paused/resumed/trial_will_end/dispute_created handlers |
| `workers/ecom-api/src/handlers/payment-webhook.ts` | revocation writes on payment_failed, refunded, dispute_created |
| `packages/subscription/src/services/subscription-service.ts` | orchestrator hook at end of each mutation; accept `cache` + `waitUntil` in constructor |
| `packages/subscription/src/services/__tests__/*` | new test files |
| `packages/access/src/services/__tests__/*` | new test files |
| `workers/ecom-api/src/__tests__/*` | new integration tests |

## Phase 5 — Test matrix

Full coverage matrix in [testing-matrix.md](testing-matrix.md). Summary:

- **Unit** — revocation helper, orchestrator hook, new Stripe handlers, progress access check (positive + negative paths per `feedback_security_deep_test`)
- **Integration** — full Stripe CLI event flow for every lifecycle event, asserting KV writes + DB writes
- **E2E Playwright** — cross-device cancel visible within one visibility tick; cancelled user denied streaming URL; revoked user progress POST returns 403; paused/resumed roundtrip

## Verification checklist (PR 2 done criteria)

- [ ] `pnpm typecheck` clean across all packages
- [ ] `pnpm test` green — all new unit + integration tests
- [ ] `pnpm test:e2e` green on new Playwright specs
- [ ] Manual: active subscription, stream video, cancel on another device, `stripe trigger customer.subscription.deleted`, confirm next stream request returns 403 within 10 min
- [ ] Manual: active subscription, `stripe trigger customer.subscription.paused`, stream request → 403; `stripe trigger customer.subscription.resumed` → stream works
- [ ] Manual: active subscription, attempt `savePlaybackProgress` after cancellation → 403
- [ ] `wrangler kv:key list` shows revocation keys TTL-cleaning correctly
- [ ] No regression in PR 1 symptoms: cancel form still updates without hard refresh

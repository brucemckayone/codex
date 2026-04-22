# Testing Matrix

Every bd task in this epic MUST reference the relevant rows here before closing. No task closes without its associated tests landing green.

## Test categories

| Category | Location | Harness |
|---|---|---|
| **Unit (service)** | `packages/<pkg>/src/services/__tests__/*.test.ts` | Vitest + `setupTestDatabase()` / mocked KV |
| **Unit (worker util)** | `packages/worker-utils/src/__tests__/*.test.ts` | Vitest |
| **Integration (worker)** | `workers/<worker>/src/__tests__/*.test.ts` | Vitest + Miniflare + real `dbWs` transaction |
| **E2E (web)** | `apps/web/e2e/*.spec.ts` | Playwright |
| **Manual (Stripe CLI)** | `docs/subscription-cache-audit/manual-verification.md` | `stripe trigger` + `wrangler kv:key list` |

## Matrix — Phase 1 + 2 (PR 1)

| Scenario | Unit | Integration | E2E | Manual |
|---|:-:|:-:|:-:|:-:|
| `invalidateForUser` helper bumps correct keys | ✅ | ✅ | — | — |
| Error in cache swallowed (fire-and-forget) | ✅ | — | — | — |
| `customer.subscription.updated` → both caches bump | ✅ | ✅ | — | ✅ |
| `invoice.payment_succeeded` → both caches bump | ✅ | ✅ | — | ✅ |
| `invoice.payment_failed` → both caches bump | ✅ | ✅ | — | ✅ |
| `charge.refunded` → library cache bumps | ✅ | ✅ | — | ✅ |
| `/subscriptions/cancel` → both caches bump | ✅ | ✅ | ✅ | ✅ |
| `/subscriptions/change-tier` → both caches bump | ✅ | ✅ | — | ✅ |
| `/subscriptions/reactivate` → both caches bump | ✅ | ✅ | — | ✅ |
| Cancel updates form without hard refresh | — | — | ✅ | ✅ |
| Cancel triggers optimistic UI | — | — | ✅ | — |
| Cancel failure rolls back optimistic state | ✅ | — | ✅ | — |
| Cross-device: cancel A, state visible on B after visibility change | — | — | ✅ | ✅ |
| Auth missing on mutation → 401, no cache writes | — | ✅ | — | — |
| Idempotent webhook retries → no duplicate mutations, deterministic invalidate | — | ✅ | — | — |

## Matrix — Phase 3 + 4 (PR 2)

| Scenario | Unit | Integration | E2E | Manual |
|---|:-:|:-:|:-:|:-:|
| `AccessRevocation.revoke()` writes KV key with TTL | ✅ | — | — | — |
| `AccessRevocation.isRevoked()` reads JSON correctly | ✅ | — | — | — |
| `AccessRevocation.clear()` removes key | ✅ | — | — | — |
| `getStreamingUrl` denies revoked user | ✅ | ✅ | ✅ | ✅ |
| `getStreamingUrl` allows non-revoked user | ✅ | ✅ | — | — |
| Default presigned URL TTL is 600s | ✅ | — | — | — |
| `savePlaybackProgress` rejects user without access | ✅ | ✅ | ✅ | — |
| `savePlaybackProgress` accepts user with access | ✅ | ✅ | — | — |
| `subscription.deleted` writes revocation key | ✅ | ✅ | — | ✅ |
| `subscription.updated → ACTIVE` clears revocation key | ✅ | ✅ | — | ✅ |
| `subscription.paused` writes revocation + invalidates | ✅ | ✅ | — | ✅ |
| `subscription.resumed` clears revocation + invalidates | ✅ | ✅ | — | ✅ |
| `trial_will_end` triggers email only, no access change | ✅ | ✅ | — | — |
| `charge.dispute.created` behaves as refund for access | ✅ | ✅ | — | ✅ |
| `invoice.payment_failed` writes revocation | ✅ | ✅ | — | ✅ |
| `invoice.payment_succeeded` after `PAST_DUE` clears revocation | ✅ | ✅ | — | ✅ |
| `charge.refunded` writes revocation | ✅ | ✅ | — | ✅ |
| Orchestrator hook runs on every mutation | ✅ | — | — | — |
| Revoked user: streaming URL returns 403 within 10 min | — | — | ✅ | ✅ |
| Paused → resumed roundtrip | — | ✅ | ✅ | ✅ |

## Security-path negative-test requirements

Per memory `feedback_security_deep_test`, every change to HMAC, session, auth, rate-limit, cookie, or scoping requires positive AND negative paths. This applies to the following beads:

- PR 1: webhook signature verification unchanged but HMAC path exercised for each new invalidation (regression guard)
- PR 1: `/subscriptions/*` auth required — negative test that missing session returns 401
- PR 2: `AccessRevocation` — negative test that revoked user is denied even if DB says ACTIVE (race window coverage)
- PR 2: `savePlaybackProgress` — negative test that cancelled user cannot POST

## Test fixtures

New Stripe event fixtures required at `workers/ecom-api/src/__tests__/fixtures/stripe/`:

- `customer-subscription-updated.json` (cancel_at_period_end toggle)
- `customer-subscription-paused.json`
- `customer-subscription-resumed.json`
- `customer-subscription-trial-will-end.json`
- `invoice-payment-succeeded-renewal.json`
- `invoice-payment-failed.json`
- `charge-refunded.json`
- `charge-dispute-created.json`

Reuse existing `customer-subscription-deleted.json` and `checkout-session-completed.json` where present.

## Performance-sensitive paths (don't regress)

- `getStreamingUrl()` adds one KV read (`isRevoked`) — measure p50/p95 in dev; KV reads are ~2ms cold, ~0.5ms warm. Acceptable.
- Webhook handlers are already off-critical-path (fire-and-forget via `waitUntil`). No measurable impact.
- Account page load adds one new server load — negligible.

## Test harness notes

- `dbWs` required for any integration test that exercises a transaction (per `packages/database/CLAUDE.md`)
- Use `setupTestDatabase()` with creator/member factories from `@codex/test-utils`
- Playwright tests need the dev-cdn running on port 4100 (memory `feedback_local_r2_images`)
- Run workers via `pnpm dev` from monorepo root, never cd (`feedback_pnpm_dev_root`)

# Subscription Cache & Access Validation Audit

**Status:** Planning
**Started:** 2026-04-21
**Driver:** Two user-reported symptoms (cancel doesn't revoke cached access; cancel form requires hard refresh) → escalated to a full audit of cache + access validation across every subscription lifecycle event and every stream/access path.

## Why this exists

The audit found **7 distinct invalidation gaps** and an additional class of exposure (presigned R2 URLs outliving their access check). Those gaps span:

- 4 Stripe webhook handlers that mutate DB state but do not bump per-user cache versions
- 3 direct mutation endpoints that invalidate only one of the two per-user caches
- 3 unhandled Stripe events (`paused`, `resumed`, `trial_will_end`)
- 1 missing access check on `savePlaybackProgress`
- 1 account page that calls `invalidate()` with a key nothing is listening on

The fix is deliberately scoped so that the two **user-visible symptoms** ship first (PR 1) and defense-in-depth (PR 2) follows — both with strong test coverage.

## Product decisions

- **Revocation timing: at period end.** Current Stripe `cancel_at_period_end: true` behaviour is kept. Users retain access through `currentPeriodEnd` (they paid for the period). The fix is to make sure UI and cache correctly reflect `CANCELLING` during the paid tail and flip to `CANCELLED` at period end.
- **Streaming revocation: TTL + KV revocation list (Option B).** Presigned R2 URL TTL reduced from 3600s → 600s **and** a per-user KV revocation key checked before URL minting.
- **Packaging: two PRs.** PR 1 = P0 (user-visible symptom fixes + webhook invalidation gaps). PR 2 = defense-in-depth (streaming window + missing handlers + orchestrator + full test suite).

## Phases

| Phase | Scope | PR | Doc |
|---|---|---|---|
| 1 | Close webhook + direct mutation invalidation gaps | PR 1 | [phase-1-p0.md](phase-1-p0.md) |
| 2 | Wire `COLLECTION_USER_SUBSCRIPTION` into account layout; fix post-cancel refresh | PR 1 | [phase-1-p0.md](phase-1-p0.md) |
| 3 | Presigned URL TTL + KV revocation list (Option B) | PR 2 | [phase-2-followup.md](phase-2-followup.md) |
| 4 | Missing Stripe handlers, progress access check, service orchestrator | PR 2 | [phase-2-followup.md](phase-2-followup.md) |
| 5 | Full test coverage (unit + integration + Playwright E2E) | PR 2 | [testing-matrix.md](testing-matrix.md) |

## Beads

This work is tracked under a parent epic with one task per work package. See [Task Map](#task-map) below once beads are created. All tasks follow the pattern:

1. Implementation
2. Unit tests (including negative paths per `feedback_security_deep_test`)
3. Integration tests (positive + negative)
4. Verification (Playwright MCP or Stripe CLI, depending on scope)

No task closes without its verification step passing.

## Task Map

Populated once `bd create` runs — see the epic's children and `docs/subscription-cache-audit/` commit history.

## Related reference

- `docs/stripe-connect-subscription-reference.md` — upstream Stripe flow (pre-existing)
- `docs/caching-strategy.md` — overall caching architecture
- `packages/cache/CLAUDE.md` — cache package contract
- `packages/access/CLAUDE.md` — access control (if present)

## Cache layers touched

| Layer | Keys | Reconciliation trigger |
|---|---|---|
| KV VersionedCache | `CacheType.COLLECTION_USER_LIBRARY(userId)`, `CacheType.COLLECTION_USER_SUBSCRIPTION(userId, orgId)` | Server bumps; client re-reads via version manifest |
| localStorage TanStack | `codex-library`, `codex-subscription`, `codex-playback-progress` | `invalidateCollection(...)` triggered by `$effect` diffing manifest |
| Presigned R2 URL | Cryptographic signature, TTL-bound | TTL expiry only (no per-URL revocation) — Phase 3 introduces KV revocation list to gate URL mint |
| HTTP Cache-Control | `public, s-maxage` on unauth pages | CDN TTL (not in scope) |

## Non-goals

- Immediate mid-period revocation (product decision: no)
- Rewriting presigned URL auth to cookies/tokens (captured as long-term follow-up, not this epic)
- Following-collection server sync (out of scope)
- Dispute-handler implementation beyond logging (separate bead)

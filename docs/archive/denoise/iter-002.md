# Iteration 002 — security × workers

- **Cell**: security × workers
- **Date**: 2026-04-25
- **Mode**: delta
- **Since**: 14 days ago (`git log --since='14 days ago'`)
- **Files churned**: 31 (in-scope, non-test, in `workers/*/src/**`)
- **Agent**: agents/audit-workers.md
- **Fallow JSON**: `/tmp/denoise-iter-002-fallow.json` (inherited from iter-001 — same HEAD a7d3f27d)
- **Typecheck baseline**: `/tmp/denoise-iter-002-typecheck-baseline.log` (inherited from iter-001 — 3 pre-existing TS errors in `@codex/worker-utils` are baselined)

## Fabrication check

Cycle 0 protocol: grep every cited symbol from references 01-security-audit.md
and 06-domain-workers.md against current code. Results:

- **References scanned**: 01-security-audit.md (already covered in iter-001),
  06-domain-workers.md
- **iter-001 already filed F3-F6 doc-rot beads (Codex-ttavz.3-6)** for
  reference 01 + 07 drift (`assertNotFound`, `BusinessRuleError` /
  `RateLimitError` / `InternalError`, `obs.redact`, `workerAuth.sign`).
  These are NOT re-filed in iter-002.
- **NEW drift surfaced in reference 06**:

| Symbol cited | Where | Hits | Status |
|---|---|---|---|
| `procedure` | ref 06 §1, §2, §9 | many (proper) | live |
| `ctx.services` | ref 06 §2 | 143 hits | live |
| `createPerRequestDbClient` | ref 06 §2 | 5+ hits | live |
| `waitUntil` (`.catch` discipline) | ref 06 §3, §9 row 4 | 135 hits, mixed `.catch` adoption | live |
| `verifyStripeSignature` | ref 06 §7 | 4 hits | live |
| `verifyRunpodSignature` | ref 06 §7 | 4 hits | live |
| `WORKER_SHARED_SECRET` / `workerAuth` | ref 06 §7 | 34 hits | live |
| `securityHeaders` (auto-applied via `createWorker`) | ref 06 §1 | 23 hits | live |
| `constructEvent` | ref 06 §7 (line 188), §9 row 11 (line 224) | **0 hits in non-test source** | **STALE — F4** |
| `constructEventAsync` | (NOT cited; actual API) | 1 hit (`packages/purchase/src/stripe-client.ts:105`) | live |
| `ctx.storage.transaction` | ref 06 §4, §9 row 9 area | **0 hits in workers/ source** | **STALE — F5** |
| `alarmInFlight` | ref 06 §9 row 9 | **0 hits anywhere** | **STALE — F5** |

Reference 06 is mid-fidelity. Two of the three security-relevant rows
that are testable here are stale (the Stripe verifier symbol is wrong;
the DurableObject idempotency pattern cites symbols that no DO in the
codebase implements). Findings F4 and F5 are doc-rot; the fix is to
update the reference, not the code.

## Findings

### F1 — `security:auth-endpoint-no-ratelimit`

- **Severity**: blocker
- **File:Line**: `workers/auth/src/middleware/rate-limiter.ts:22-27`
- **Description**: `createAuthRateLimiter()` matches paths against a
  hard-coded `RATE_LIMITED_PATHS` Set whose entries have **stale path
  names**. The Set contains:
  - `/api/auth/email/login`
  - `/api/auth/email/register`
  - `/api/auth/email/send-reset-password-email`
  - `/api/auth/email/reset-password`

  But the actual BetterAuth POST endpoints used in production (verified
  via `apps/web/src/routes/(auth)/**` and `apps/web/src/lib/remote/auth.remote.ts`
  + documented in `workers/auth/CLAUDE.md`) are:
  - `/api/auth/sign-up/email` (register)
  - `/api/auth/sign-in/email` (login)
  - `/api/auth/forget-password` (password reset request)
  - `/api/auth/reset-password` (password reset apply)

  The Set check (`RATE_LIMITED_PATHS.has(c.req.path)`) therefore never
  fires for any live BetterAuth endpoint. **Every auth endpoint is
  currently unrate-limited in production**, allowing unbounded
  brute-force attempts on login, signup, and password reset against
  any account whose email has been enumerated (and BetterAuth's
  current behaviour confirms account existence on login attempts —
  see `auth-config.ts:139-144` comment, which accepts the trade-off
  pre-rate-limit).

  This is `security:auth-endpoint-no-ratelimit` — exact match for
  reference 01 §8 row 7 ("Auth route without `rateLimit: 'auth'` →
  Brute-force vulnerability"). It is the canonical fingerprint with
  the canonical mitigation.
- **Proof test form**: API-map snapshot (Catalogue row 11) — assert
  `RATE_LIMITED_PATHS` contains every live BetterAuth POST path and
  contains nothing else
- **Proof test path**: `workers/auth/src/__denoise_proofs__/iter-002/F1-auth-rate-limit-stale-paths.test.ts`
- **MCP evidence**: Vitest unit test (per §3 matrix for `security ×
  workers` — Vitest integration test). Future runtime verification
  via `playwright`/Hono test client posting 50× `POST /api/auth/sign-in/email`
  with the same IP and asserting 429 after 5 — but the structural
  fix lands first.
- **R7 single-hit security exception**: `severity=blocker` AND
  `phase=security` — this fingerprint should promote on first
  sighting per SKILL.md §1 R7 footnote, even though hits=1 in the
  recurrence ledger.
- **Bead**: _filed at step 7 by dispatching skill_

### F2 — `security:public-route-no-ratelimit` (NEW fingerprint)

- **Severity**: major
- **File:Line**:
  - `workers/notifications-api/src/routes/unsubscribe.ts:22-94`
  - `workers/notifications-api/src/index.ts` (no app-level rate-limit
    middleware on `/unsubscribe/*`; compare with `ecom-api/src/index.ts:99-104`
    which does apply `RATE_LIMIT_PRESETS.webhook` to `/webhooks/*`)
- **Description**: The public unsubscribe routes (`GET /unsubscribe/:token`
  and `POST /unsubscribe/:token`) bypass `procedure()` (documented —
  HMAC token verification, not session auth) AND have no rate-limit
  middleware at the worker level. `notifications-api/src/index.ts`
  imports nothing from `@codex/security`. Every other public-facing
  worker has rate limits: auth uses `RATE_LIMIT_PRESETS.auth`, ecom-api
  uses `webhook` (1000/min), content-api enforces `streaming` /
  `api` per-route via `procedure()`.

  Concrete impact:
  - DoS by replaying `POST /unsubscribe/<random>` — each request
    forces an HMAC verification (`verifyUnsubscribeToken`) with no
    early-out
  - DB write amplification on `notification_preferences` if a
    legitimate token is replayed (idempotent upsert, so no data
    integrity issue, but the table is hot enough that the write
    storm matters)
  - Token-format enumeration via timing on validity vs invalidity

  This is a NEW fingerprint — `security:public-route-no-ratelimit` —
  not in the existing reference 01 anti-pattern table. Suggest adding
  as row 13: "Public route mutating DB without rate limit". If it
  recurs in another cycle (e.g., ecom-api `/checkout/verify` or
  content-api public endpoints later), promote to a hard rule.
- **Proof test form**: API-map snapshot (Catalogue row 11) — read
  index.ts and unsubscribe.ts source, assert either the route uses
  `procedure({ rateLimit: ... })` or the index attaches
  `rateLimit(...)` middleware to `/unsubscribe/*`
- **Proof test path**: `workers/notifications-api/src/__denoise_proofs__/iter-002/F2-unsubscribe-no-ratelimit.test.ts`
- **MCP evidence**: Vitest unit test
- **Bead**: _filed at step 7 by dispatching skill_

### F3 — `workers:waituntil-no-catch`

- **Severity**: minor
- **File:Line**: `workers/ecom-api/src/handlers/checkout.ts:169-173`
- **Description**: `handleCheckoutCompleted` (the booking webhook
  handler) bumps the user-library cache version via:

  ```typescript
  c.executionCtx.waitUntil(
    cache.invalidate(
      CacheType.COLLECTION_USER_LIBRARY(validatedMetadata.customerId)
    )
  );
  ```

  No `.catch()` handler is chained. Compare with the surrounding
  `waitUntil` calls in this same worker:
  - `connect-webhook.ts:81-99` — proper `.catch(...)` + `.finally(...)`
  - `payment-webhook.ts:86-103` — proper `.catch(...)` with obs.warn
  - `subscription-webhook.ts:73-…`, `:128-…`, `:243-…`, `:285-…` — all `.catch(...)`
  - `subscriptions.ts:75-94` — proper `.catch(...)` with obs.warn

  This single line is the outlier. Reference 06 §3 ("waitUntil hygiene")
  + §9 row 4 (`workers:waituntil-no-catch`) name this exact fingerprint.
  Per project memory `feedback_dont_defer_cache_issues.md` the fix
  cannot be deferred ("never justify deferral with 'user hasn't
  complained'"). The Stripe webhook is one of the highest-traffic
  paths in the system; an unhandled rejection there wakes up the runtime
  uncaught-rejection logger and bypasses the structured `obs.warn`
  pattern that the subscription-cache-audit (Codex-v8bub) relies on
  for forensic visibility.

  Fix: chain
  `.catch((err) => obs?.warn('checkout: cache invalidation failed', { ... }))`
  on the inner `cache.invalidate(...)` promise.
- **Proof test form**: custom lint rule + test (Catalogue row 12) —
  static-analysis test reads `checkout.ts`, finds every
  `executionCtx.waitUntil(...)` call, asserts `.catch(` appears in
  the argument expression
- **Proof test path**: `workers/ecom-api/src/__denoise_proofs__/iter-002/F3-checkout-waituntil-no-catch.test.ts`
- **MCP evidence**: Vitest unit test (file-system regex assertion)
- **Bead**: _filed at step 7 by dispatching skill_

### F4 — `denoise:doc-rot:06-domain-workers:row11`

- **Severity**: minor (doc-rot)
- **File:Line**:
  - `.claude/skills/denoise/references/06-domain-workers.md:188`
  - `.claude/skills/denoise/references/06-domain-workers.md:224` (anti-pattern row 11)
- **Description**: §7 "Per-worker idiosyncrasies" cites
  `stripe.webhooks.constructEvent` as the Stripe webhook verifier,
  and §9 row 11 (`workers:stripe-webhook-no-signature-verify`) cites
  the same symbol in both the "Pattern" and "Fix" cells. Grep against
  workers/ + packages/ shows zero non-test hits for `constructEvent`.
  The actual API used is `stripe.webhooks.constructEventAsync`
  (verified at `packages/purchase/src/stripe-client.ts:105`). The
  workerd runtime has no synchronous SubtleCrypto path, so the sync
  variant cannot work in any deployed worker — only the async variant
  was ever a viable choice.

  Note: iter-001 F4 (`Codex-ttavz.4`) is doc-rot for reference 01 +
  reference 07 error-class drift (different file, different rows).
  Reference 01 §8 row 5 has the same `constructEvent` drift as ref 06
  row 11 — but iter-001 did not specifically file the verifier-symbol
  drift; F5/F6 in iter-001 were `obs.redact` and `workerAuth.sign`.
  This iter-002 F4 is therefore NOT a duplicate; it patches a
  separate row in a separate reference. The fix should also patch
  reference 01 §8 row 5 for symmetry (folded into the same
  bead/PR).
- **Proof test form**: custom lint rule + test (Catalogue row 12) —
  grep assertion against workers/ + packages/
- **Proof test path**: `packages/worker-utils/src/__denoise_proofs__/iter-002/F4-doc-rot-ref06-row11-constructEvent.test.ts`
- **MCP evidence**: Vitest unit test (filesystem grep via execSync `rg`)
- **Bead**: _filed at step 7 by dispatching skill_

### F5 — `denoise:doc-rot:06-domain-workers:row9`

- **Severity**: minor (doc-rot)
- **File:Line**:
  - `.claude/skills/denoise/references/06-domain-workers.md:131-141` (§4)
  - `.claude/skills/denoise/references/06-domain-workers.md:222` (anti-pattern row 9)
- **Description**: §4 "DurableObject lifecycle" cites
  `ctx.storage.transaction(...)` and `alarmInFlight` as the
  canonical idempotency / atomicity primitives, and §9 row 9
  (`workers:do-alarm-no-idempotency`) cites
  `ctx.storage.get('alarmInFlight')` as the fix. Grep against
  workers/*/src returns zero hits for either symbol.

  The codebase has exactly one DurableObject:
  `workers/media-api/src/durable-objects/orphaned-file-cleanup-do.ts`.
  Whatever idempotency pattern it implements (or fails to implement)
  is the live anchor. Today reference 06's anti-pattern row guards a
  pattern with no implementations to compare against — a trigger of
  the row would need a fix the reference can't actually point at.

  Fix: read `orphaned-file-cleanup-do.ts`, identify the actual
  idempotency mechanism it uses (or doesn't), rewrite ref 06 §4 + §9
  row 9 to cite the live pattern. If the DO has no idempotency guard,
  that itself becomes a finding to file under the next workers cycle.
- **Proof test form**: custom lint rule + test (Catalogue row 12)
- **Proof test path**: `packages/worker-utils/src/__denoise_proofs__/iter-002/F5-doc-rot-ref06-do-alarm.test.ts`
- **MCP evidence**: Vitest unit test (filesystem grep)
- **Bead**: _filed at step 7 by dispatching skill_

## Summary

| Metric | Value |
|---|---|
| Total findings | 5 |
| Blocker | 1 (F1) |
| Major | 1 (F2) |
| Minor | 3 (F3 code, F4-F5 doc-rot) |
| Testability-bugs | 0 |
| Testability-bug rate | 0% (R8 does NOT fire) |
| Beads filed | _0 — pending step 7 of dispatching skill_ |
| Recurrence promotions queued | 1 (F1 — single-hit security exception) |

R2 catalogue walk: NOT triggered — every finding mapped to a Catalogue
row directly.

| # | Finding | Catalogue row |
|---|---|---|
| F1 | code: stale rate-limit path Set | Row 11 — API-map snapshot |
| F2 | code: public route no rate limit | Row 11 — API-map snapshot |
| F3 | code: waitUntil missing .catch | Row 12 — custom lint + test |
| F4 | doc-rot: constructEvent (ref 06 row 11) | Row 12 — custom lint + test |
| F5 | doc-rot: ctx.storage.transaction / alarmInFlight (ref 06 row 9) | Row 12 — custom lint + test |

R8 does not fire (rate < 15%).

R7 promotions: F1 qualifies for the single-hit security exception
(`severity=blocker` AND `phase=security`). Mark `recurrence.json`
entry `security:auth-endpoint-no-ratelimit` as `promoted: true` and
add as a new R-rule in `SKILL.md` §1 in the next cycle's prep.
Suggested rule text:

> **R9** | Auth endpoints MUST be rate-limited via a path-prefix or
> path-set match against the canonical BetterAuth route names — never
> hard-coded literal paths that drift from the framework's routing.
> Verified by an integration test that posts 6× to each rate-limited
> path and asserts a 429 response. | Blocker

(citation: `<!-- R9 promoted from iter-002, fingerprint security:auth-endpoint-no-ratelimit -->`)

## Skill patches applied

(none) — the dispatching skill applies recurrence/promotion patches
at step 7 of the cycle, not the audit agent.

The two doc-rot findings (F4-F5) are themselves skill-content fixes
— their bead-fix PRs will edit references/06-domain-workers.md (and
references/01-security-audit.md row 5 piggybacking onto F4's fix).

## Next-cycle prep

- **Recurrence**: track 5 fingerprints in `recurrence.json`. Three
  new fingerprints this cycle:
  1. `security:auth-endpoint-no-ratelimit` — promoted on first sighting
     per single-hit security exception (R7 footnote). Schedule R9
     promotion in next cycle's prep.
  2. `security:public-route-no-ratelimit` (F2) — NEW row candidate for
     reference 01 §8 anti-pattern table. Promote to row 13 if it
     recurs.
  3. `denoise:doc-rot:06-domain-workers:row11` (F4)
  4. `denoise:doc-rot:06-domain-workers:row9` (F5)
  5. `workers:waituntil-no-catch` (F3) — already in reference 06 §9
     row 4; recurrence increment only.
- **Doc-rot fixes** (F4, F5): when these beads land, the same `cycle 0`
  fabrication-check protocol re-runs against reference 06 on the
  next workers cycle. Re-running today after any doc fix should
  produce zero stale citations.
- **Folded fix**: F4 should also patch reference 01 §8 row 5 (same
  `constructEvent` drift, different reference). Note in the bead
  body so the same PR catches both rows.
- **Companion finding to F5**: when ref 06 §4 + row 9 are rewritten
  against `orphaned-file-cleanup-do.ts`, audit that DO for actual
  idempotency. If it has none, file a NEW workers-security finding
  in iter-003 or whichever workers cycle picks it up. Cross-link to
  `feedback_serverless_context.md`.
- **Stop criterion (§4)**: this is the FIRST cycle for `security ×
  workers`. Three consecutive zero-finding cycles needed to declare
  fidelity — countdown is 3 → 3 (this cycle produced findings, no
  decrement).
- **Cell-due check next time**:
  `git log --since=iter-002 -- 'workers/*/src/**'`. Anything that
  lands afterwards is in scope.
- **Suggested next cell** (per dispatching `master.md` priority order):
  `types × workers` (same churn surface, complementary axis) OR
  `security × apps/web` (new phase, fresh signal). Tie-break: phase
  priority security > types, so `security × apps/web` if churn is
  comparable.

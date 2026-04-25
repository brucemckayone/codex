# Iteration 001 — security × packages

- **Cell**: security × packages
- **Date**: 2026-04-25
- **Mode**: delta
- **Since**: 14 days ago (`git log --since='14 days ago'`)
- **Files churned**: 92 (in-scope, non-test, non-migration)
- **Agent**: agents/audit-packages.md
- **Fallow JSON**: `/tmp/denoise-iter-001-fallow.json`
- **Typecheck baseline**: `/tmp/denoise-iter-001-typecheck-baseline.log`

## Fabrication check

The dispatching skill's references cite specific symbols that anchor each
anti-pattern row. Cycle 0 protocol grepps each cited symbol. Result:

- **References scanned**: 01-security-audit.md, 07-domain-packages.md
- **Symbols cited**: 12 (across the two anti-pattern tables and the recipe blocks)
- **Verified live in codebase**: 8
- **Stale (doc-rot)**: 4 — see findings F3–F6 below

Live grep counts:

| Symbol | Hits | Status |
|---|---|---|
| `sanitizeSvgContent` | 8 | live |
| `scopedNotDeleted` | 61 | live |
| `withCreatorScope` | 60 | live |
| `withOrgScope` | 54 | live |
| `workerAuth` (the middleware factory) | 34 | live |
| `securityHeaders` | 23 | live |
| `getCookieConfig` | 8 | live |
| `BaseService` | 101 | live |
| `handleError` | 36 | live |
| `mapErrorToResponse` | 70 | live |
| `assertNotFound` | **0** | **STALE — F3** |
| `obs.redact(` | **0** | **STALE — F5** |
| `BusinessRuleError` / `RateLimitError` / `InternalError` (cited classes) | **0 each** | **STALE — F4** |
| `workerAuth.sign(` | **0** | **STALE — F6** |

The references are mid-fidelity but four anti-pattern rows cite symbols that do
not exist. None of the false citations would let a real bug slip past — they
just misdirect future audits if a finding actually triggers them. The fix is
documentation-only.

## Findings

### F1 — `packages:throw-raw-error`

- **Severity**: minor
- **File:Line**: `packages/image-processing/src/orphaned-file-service.ts:79`
- **Description**: `OrphanedFileService.recordOrphanedFile` throws a raw
  `new Error('Failed to insert orphaned file record')` from a `BaseService`
  subclass. Per `packages/service-errors/CLAUDE.md` ("Strict Rules") and
  reference 07 §3 anti-pattern row 2, services must throw a typed
  `ServiceError` subclass so `mapErrorToResponse` produces a deterministic
  HTTP status + machine-readable code. A raw `Error` short-circuits to
  500 with a leaked stack message and no client `code`.
- **Proof test form**: contract test at boundary (Catalogue row 7)
- **Proof test path**: `packages/image-processing/src/__denoise_proofs__/iter-001/F1-orphaned-file-raw-error.test.ts`
- **MCP evidence**: Vitest unit test (per §3 matrix for `security × packages`)
- **Bead**: _filed at step 7 by dispatching skill_

### F2 — `packages:identifier-no-shape-validation`

- **Severity**: minor (defense-in-depth)
- **File:Line**: `packages/access/src/services/access-revocation.ts:60-91`
- **Description**: `AccessRevocation.{revoke,isRevoked,clear}` accept `userId`
  and `orgId` as raw strings, validated only by
  `assertNonEmptyIdentifier(value, field)` which checks `typeof string` +
  `length > 0`. The KV key is built as
  `${REVOCATION_KEY_PREFIX}:${userId}:${orgId}`. If either identifier itself
  contains `:`, two distinct (userId, orgId) pairs collide on the same key —
  e.g. `("abc:foo", "x")` and `("abc", "foo:x")` both produce
  `revoked:user:abc:foo:x`. Today every caller passes UUIDs (no colons), so
  the bug is latent. Defense-in-depth wants either shape validation
  (`uuidSchema.parse(value)`) at the boundary or a delimiter-safe key
  construction (URL-encoded, hash, length-prefixed).
- **Proof test form**: structural / parity test (Catalogue row 1)
- **Proof test path**: `packages/access/src/__denoise_proofs__/iter-001/F2-access-revocation-key-shape.test.ts`
- **MCP evidence**: Vitest unit test (in-memory KV stub; no external deps)
- **Bead**: _filed at step 7 by dispatching skill_
- **Note**: this is a NEW fingerprint — not yet in the anti-pattern tables of
  references 01 or 07. If the recurrence ledger sees it again in a later
  cycle it should be added to reference 07 §7 as a row.

### F3 — `denoise:doc-rot:07-domain-packages:row1`

- **Severity**: minor (doc-rot)
- **File:Line**: `.claude/skills/denoise/references/07-domain-packages.md:23-26`
- **Description**: §1 cites `BaseService.assertNotFound(value, message)` as a
  method on the abstract class. It does not exist. The actual `BaseService`
  exposes only `handleError(error, context?)`. Fix is to remove the
  `assertNotFound` row from §1 — `handleError` + `throw new NotFoundError(...)`
  is the documented idiom (`packages/service-errors/CLAUDE.md` ›
  `BaseService` block).
- **Proof test form**: custom lint rule + test (Catalogue row 12)
- **Proof test path**: `packages/worker-utils/src/__denoise_proofs__/iter-001/F3-doc-rot-assertNotFound.test.ts`
- **MCP evidence**: Vitest unit test (file-system grep assertion)
- **Bead**: _filed at step 7 by dispatching skill_

### F4 — `denoise:doc-rot:07-domain-packages:row3`

- **Severity**: minor (doc-rot)
- **File:Line**: `.claude/skills/denoise/references/07-domain-packages.md:80-104`
- **Description**: §3 "Error Hierarchy" cites three error classes that do
  not exist:
  - `BusinessRuleError` — actual class is `BusinessLogicError`
  - `RateLimitError` — no such class (`@codex/security` rate-limit middleware
    returns 429 directly, no typed throw)
  - `InternalError` — actual class is `InternalServiceError`
  The §3 code example also uses `new InternalError('message', { cause: e })`
  which won't compile. Fix is to align the citations with the live exports
  in `packages/service-errors/src/index.ts` (and either delete the rate-limit
  row or add a class to back it).
- **Proof test form**: custom lint rule + test (Catalogue row 12)
- **Proof test path**: `packages/worker-utils/src/__denoise_proofs__/iter-001/F4-doc-rot-error-classes.test.ts`
- **MCP evidence**: Vitest unit test (barrel-export grep assertion)
- **Bead**: _filed at step 7 by dispatching skill_

### F5 — `denoise:doc-rot:01-security-audit:row9`

- **Severity**: minor (doc-rot)
- **File:Line**: `.claude/skills/denoise/references/01-security-audit.md:198,221`
- **Description**: §7 "Secret Hygiene" cites `obs.redact(secret)` as the
  way to wrap sensitive values in structured logs. `ObservabilityClient` has
  no `redact` method. The actual API is the standalone
  `redactSensitiveData(metadata)` helper, plus auto-redaction inside every
  `obs.{info,warn,error,debug}` call (per `packages/observability/CLAUDE.md`
  "PII Redaction"). Anti-pattern row 9 (`security:secret-in-log`) carries
  the same drift. Fix is to update the recipe to cite the real API surface
  (or to lean on auto-redaction and stop suggesting a manual wrap).
- **Proof test form**: custom lint rule + test (Catalogue row 12)
- **Proof test path**: `packages/worker-utils/src/__denoise_proofs__/iter-001/F5-doc-rot-obs-redact.test.ts`
- **MCP evidence**: Vitest unit test
- **Bead**: _filed at step 7 by dispatching skill_

### F6 — `denoise:doc-rot:01-security-audit:row6`

- **Severity**: minor (doc-rot)
- **File:Line**: `.claude/skills/denoise/references/01-security-audit.md:99-105,218`
- **Description**: §3b and anti-pattern row 6 (`security:worker-call-no-hmac`)
  cite `workerAuth.sign()` as the caller-side HMAC API. `workerAuth` is the
  receiver-side Hono middleware factory; its return value (a middleware
  function) has no `.sign()` method. The actual caller-side API is
  `workerFetch(url, init, secret, options?)` (high-level) or
  `generateWorkerSignature(payload, secret, timestamp)` (low-level), both
  exported from `@codex/security`. Fix is to update the citation.
- **Proof test form**: structural assertion / route-map snapshot (Catalogue row 11)
- **Proof test path**: `packages/worker-utils/src/__denoise_proofs__/iter-001/F6-doc-rot-workerAuth-sign.test.ts`
- **MCP evidence**: Vitest unit test
- **Bead**: _filed at step 7 by dispatching skill_

## Summary

| Metric | Value |
|---|---|
| Total findings | 6 |
| Blocker | 0 |
| Major | 0 |
| Minor | 6 (2 code, 4 doc-rot) |
| Testability-bugs | 0 |
| Testability-bug rate | 0% (R8 does NOT fire) |
| Beads filed | _0 — pending step 7 of dispatching skill_ |
| Recurrence promotions queued | 0 (every fingerprint hits == 1 in cycle 0) |

R2 catalogue walk: NOT triggered — no testability-bugs were filed. Every
finding mapped to a Catalogue row directly:

| # | Finding | Catalogue row |
|---|---|---|
| F1 | code: raw error throw | Row 7 — contract test at boundary |
| F2 | code: identifier shape | Row 1 — parity test |
| F3 | doc-rot: assertNotFound | Row 12 — custom lint + test |
| F4 | doc-rot: error class names | Row 12 — custom lint + test |
| F5 | doc-rot: obs.redact | Row 12 — custom lint + test |
| F6 | doc-rot: workerAuth.sign | Row 11 — structural / API map snapshot |

R8 does not fire (rate < 15%).

R7 promotions: cycle 0; recurrence ledger is empty so every fingerprint
registers as `hits: 1`. No promotions queued. None of the findings are
`severity=blocker security:` so the single-hit security exception also does
not fire.

## Skill patches applied

(none) — cycle 0. The dispatching skill applies recurrence/promotion patches
at step 7 of the cycle, not the audit agent.

The four doc-rot findings (F3–F6) **are themselves skill-content fixes** —
once their beads close, references 01 and 07 will need targeted edits. Those
edits should happen via the bead-fix PRs, not silently in this report.

## Next-cycle prep

- **Recurrence**: track all six fingerprints in `recurrence.json`. F2 is a
  new fingerprint (`packages:identifier-no-shape-validation`); add it to
  reference 07 §7 if it recurs.
- **Doc-rot fixes** (F3–F6): when these beads land, the same `cycle 0`
  fabrication-check protocol re-runs against the references on the next
  cycle for this cell. Re-running today after any doc fix should produce
  zero stale citations (proof tests un-skip and pass green).
- **Stop criterion (§4)**: this is one of three consecutive cycles needed
  for `security × packages` to declare fidelity. Track in `master.md`
  Table A — countdown is `3 → 2` if F1, F2 are fixed and the next cycle
  produces zero new findings + zero recurrence increments.
- **Cell-due check next time**: `git log --since=iter-001 -- 'packages/*/src/**'`.
  Anything that lands afterwards is in scope; everything before iter-001
  was covered here.
- **Suggested next cell** (per dispatching `master.md` priority order):
  `types × packages` (Phase B, also implemented; same churn surface, fresh
  perspective on the same files).

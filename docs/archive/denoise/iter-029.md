# Iteration 029 — security × apps/web

- **Cell**: security × apps/web (Round 2 second-pass cycle 5 / drift-detection)
- **Date**: 2026-04-26
- **Mode**: delta
- **Since**: `7345a106` (iter-024 batch baseline; security × apps/web last clean run was iter-015 with the same baseline — this captures iter-024 + Round 3 + iter-026..028 churn)
- **Files churned**: 16 (`apps/web/src/**` excluding `__denoise_proofs__`)
- **Agent**: agents/audit-web.md
- **Fallow JSON**: `/tmp/denoise-iter-029-fallow.json` (reused; not the limiter today)
- **Typecheck baseline**: `/tmp/denoise-iter-026-typecheck-baseline.log` (reused — clean 53/53 pass)

---

## Strategic context — Round 3 R10 effectiveness audit

This cycle was scheduled as the security × apps/web Round 3 effectiveness check. Round 3 commit `253ffab4` (Tier 7.A) closed Codex-ttavz.13 (P0 BLOCKER — apps/web shipped without `Content-Security-Policy`) — the finding that motivated the **R10 hard rule promotion** at iter-003. The strategic question was whether the fix actually landed and whether the proof test that fixed it can now go un-skipped.

The answer to both: **yes, R10 is fully effective**.

The cycle also re-checked five recurrence-watched fingerprints carried over from iter-003:
- `web:auth-remote-broken-endpoint` (Codex-ttavz.12) — STILL OPEN. F1.
- `security:missing-csp` (R10) — CLOSED.
- `security:missing-hsts` — CLOSED.
- `web:auth-form-orphan-rpc-surface` (Codex-ttavz.15) — STILL OPEN. F2.
- `workers:waituntil-no-catch` apps/web instance (Codex-ttavz.16) — STILL OPEN. F3.

One previously-undetected adjacent finding emerged from auditing churn outside the carry-over list (F4).

---

## Fabrication check (cycle 0 protocol — security × apps/web has had 6+ cycles since iter-003)

Walked every anti-pattern row in `references/01-security-audit.md` §8 + `references/05-domain-web.md` §9:

| Reference / row | Cited symbol / file | Live in HEAD? |
|---|---|---|
| 01 §1 | `procedure({...})` from `@codex/worker-utils` | ✓ — used across all workers |
| 01 §2 | `scopedNotDeleted`, `withCreatorScope`, `withOrgScope` | ✓ — `packages/database/src/scoping.ts` |
| 01 §3a | `stripe.webhooks.constructEvent` | ✓ — `workers/ecom-api/src/webhooks/stripe-webhooks.ts` |
| 01 §3b | `workerAuth.sign()`, `policy.auth: 'worker'` | ✓ — `packages/security/src/middleware/worker-auth.ts` |
| 01 §4 | `rateLimit: 'auth'` | ✓ — `packages/security/src/middleware/rate-limit.ts` `RATE_LIMIT_PRESETS.auth` |
| 01 §5a | `sanitizeSvgContent` | ✓ — `packages/validation/src/svg-sanitizer.ts` |
| 01 §5b | `{@html ...}` sinks audit | ✓ — grepped, none in churned files |
| 01 §5c | path-traversal in R2 keys | ✓ — `packages/transcoding/src/r2-keys.ts` builders |
| 01 §6 | CSP via `kit.csp.directives` OR `hooks.server.ts` | ✓ — both populated since `253ffab4` |
| 01 §7 | `obs.redact()`, `env.X` bindings | ✓ — `packages/observability/src/redaction.ts` |
| 05 §1 | `+page.ts` server-only import detection | ✓ |
| 05 §2 | streamed promise `.catch()` rule | ✓ — but F4 found a violation |
| 05 §3 | `*.remote.ts` framework registration | ✓ |
| 05 §4 | TanStack DB `localStorageCollectionOptions` + `browser` guard | ✓ — `subscription.ts:83` |
| 05 §6 | studio `ssr = false` | ✓ |
| 05 §7 | paraglide message generation | ✓ |
| 05 §9 row 1-12 | all live, no symbol drift | ✓ |

**Result**: 17/17 reference rows live. **0 fabrications.** Cycle 0 fabrication budget: clean.

The previously-skipped iter-003 proof test (`apps/web/src/__denoise_proofs__/iter-003/F2-missing-csp-and-hsts-headers.test.ts`) is now an active suite (3 specs: positive CSP-or-HSTS detector + 2 negative-path XSS containment specs added by Round 3 Tier 7.A). It serves as an in-tree contract test for R10 going forward — no further action required.

---

## Findings

### F1 — `web:auth-remote-broken-endpoint` (Codex-ttavz.12 RECURRENCE)

- **Severity**: blocker
- **File:Line**: `apps/web/src/lib/remote/auth.remote.ts:146`
- **Description**: `forgotPasswordForm` POSTs to `${authUrl}/api/auth/forgot-password` (with the "forgot" typo). BetterAuth canonical name is `/api/auth/forget-password` per `packages/constants/src/security.ts:79-84` (`BETTERAUTH_RATE_LIMITED_PATHS`) and the live `routes/(auth)/forgot-password/+page.server.ts:29` already uses the correct path. The remote function endpoint silently 404s — and because the function pattern returns `{ success: true }` unconditionally to prevent enumeration, the failure is invisible at the UI layer. Today the blast radius is contained by F2 (zero consumers); the moment anyone wires `forgotPasswordForm` up, password reset breaks platform-wide.
- **Proof test form**: Catalogue row 11 (API-map snapshot) — structural grep on the literal fetch URL.
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-029/F1-auth-remote-forgot-password-typo.test.ts`
- **MCP evidence**: deferred — Playwright would reach the form action codepath, not the remote function. Static structural test is the right shape.
- **Bead**: Codex-ttavz.12 (already filed; this iteration adds a recurrence increment + iter-029 to its `iters` list)

### F2 — `web:auth-form-orphan-rpc-surface` (Codex-ttavz.15 RECURRENCE)

- **Severity**: major
- **File:Line**: `apps/web/src/lib/remote/auth.remote.ts:100,140,175`
- **Description**: Three exported `form()` remote functions — `registerForm`, `forgotPasswordForm`, `resetPasswordForm` — have ZERO consumers in `apps/web/src/routes/**/*.{ts,svelte}`. Only `auth.remote.test.ts` references them. SvelteKit compiler-registered remote functions become public-facing RPC endpoints, so the orphans accept POSTs, validate input, call the auth worker, and set session cookies — but no UI surface uses them. The live auth flow uses traditional form actions in `routes/(auth)/*/+page.server.ts`. Decision is "wire OR delete" (per `/fallow-audit` escalation). Deletion is the safer default; if wiring is preferred, F1's typo MUST be fixed first.
  - Note: the `/fallow-audit` False-Positive Taxonomy row #1 protects `.remote.ts` exports from blanket "unused" deletion — that protection applies when the surface is genuinely live (reachable from a UI submission or programmatic caller). These three exports meet none of those criteria.
- **Proof test form**: Catalogue row 11 (API-map snapshot) — `git grep` over `apps/web/src/routes/**` excluding test files; assert ≥1 hit per export.
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-029/F2-auth-form-orphan-rpc-surface.test.ts`
- **MCP evidence**: n/a (static structural finding).
- **Bead**: Codex-ttavz.15 (already filed; this iteration adds a recurrence increment)

### F3 — `workers:waituntil-no-catch` apps/web instance (Codex-ttavz.16 RECURRENCE / R13 violation)

- **Severity**: major (R13 hard-rule violation — the rule's grep guard is currently scoped to `workers/*/src/**` but the same hazard reaches `apps/web/src/lib/server/**` via `platform.context.waitUntil`)
- **File:Line**: `apps/web/src/lib/server/brand-cache.ts:75,90`
- **Description**: Both `setBrandConfig` (line 75) and `deleteBrandConfig` (line 90) call `platform.context.waitUntil(promise)` where `promise` is a raw `BRAND_KV.put(...)` / `BRAND_KV.delete(...)` Promise without a `.catch(...)`. If the KV write fails (transient outage, eventual-consistency race, account-level throttle), the rejection propagates as an unhandled promise rejection inside the SvelteKit worker. R13 (promoted iter-008) requires every `executionCtx.waitUntil(...)` to chain `.catch(...)` on the inner promise expression.
- **Proof test form**: Catalogue row 11 (static analysis — scan source for `waitUntil(...)`, assert each argument expression contains `.catch(` either inline or in the 5-line lookback window).
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-029/F3-brand-cache-waituntil-no-catch.test.ts`
- **MCP evidence**: n/a (static structural finding).
- **Bead**: Codex-ttavz.16 (already filed; this iteration adds a recurrence increment)
- **Skill patch follow-up queued**: R13's grep guard description should be widened beyond `workers/*/src/**` to cover `apps/web/src/lib/server/**` and any other call site where `platform.context.waitUntil` or `executionCtx.waitUntil` reaches. Not a rule change — just a clarification to the verification recipe in §1's R13 row. (Logged in "Next-cycle prep" rather than auto-applied per R5.)

### F4 — `web:streamed-promise-no-catch` (NEW occurrence, pre-existing fingerprint in ref 05 §9 row 2)

- **Severity**: minor (client-side unhandled rejection — observability gap, not a server crash)
- **File:Line**: `apps/web/src/lib/utils/subscription-context.svelte.ts:104`
- **Description**: `promise.then((ctx) => { ... })` is called on the SSR-streamed `subscriptionContext` promise inside a `$effect` block, but does NOT chain a `.catch(...)`. If the streamed promise rejects, the `.then` callback never fires AND the rejection becomes an unhandled promise rejection on the client. The producer (`apps/web/src/routes/_org/[slug]/+layout.server.ts:113`) currently catches inside `loadOrgTiers`, so today this is defence-in-depth — but project CLAUDE.md's streaming rule is unconditional ("MUST `.catch()` on every returned promise"), and the sibling file `access-context.svelte.ts` (same author, same pattern) DOES `.catch()` on every promise it threads through (lines 93, 102). The drift between siblings is a maintenance hazard.
- **Proof test form**: Catalogue row 11 (static analysis — every `promise.then(` in the file must have a `.catch(` within a 15-line forward window).
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-029/F4-subscription-context-promise-no-catch.test.ts`
- **MCP evidence**: n/a (static structural finding).
- **Bead**: New (to be filed under Codex-ttavz). Recurrence ledger: `web:streamed-promise-no-catch` is pre-existing in ref 05 §9 row 2 but had no recorded hits — this is the first hit for the fingerprint.

---

## Effectiveness verdicts (Round 3 cell)

| Carry-over fingerprint | Round 3 commit | Status before | Status after iter-029 |
|---|---|---|---|
| `security:missing-csp` (R10) | `253ffab4` Tier 7.A | OPEN (P0 BLOCKER) | **CLOSED — fully effective.** `svelte.config.js:44-74` defines `kit.csp.directives` with mode='auto'. `script-src` is strict (no `unsafe-inline`, only `'self'`), `frame-ancestors: 'none'`, `connect-src: 'self'`. Manual `<script>` blocks in `app.html:12,22` carry `nonce="%sveltekit.nonce%"`. iter-003 proof now PASSES (3 specs active). |
| `security:missing-hsts` | `253ffab4` Tier 7.A | OPEN (major) | **CLOSED.** `hooks.server.ts:79-84` sets `Strict-Transport-Security: max-age=63072000; includeSubDomains` in production (`!dev` gated to allow local HTTP dev on lvh.me). |
| `web:auth-remote-broken-endpoint` (Codex-ttavz.12) | (no commit) | OPEN (P0 BLOCKER) | **STILL OPEN.** Recurrence increment. |
| `web:auth-form-orphan-rpc-surface` (Codex-ttavz.15) | (no commit) | OPEN (major) | **STILL OPEN.** Recurrence increment. Entangled with .12 — fix together. |
| `workers:waituntil-no-catch` (Codex-ttavz.16, apps/web instance) | (no commit) | OPEN (major) | **STILL OPEN.** Recurrence increment. |

Tier 7.A landed both R10 (CSP) and HSTS in a single commit. The CSP work is exemplary — it includes negative-path tests (the 2 added specs verify `script-src` lacks `unsafe-inline` and `frame-ancestors === 'none'`, per the security-deep-test feedback). No CSP follow-up needed this cycle.

---

## Summary

| Metric | Value |
|---|---|
| Total findings | 4 |
| Blocker | 1 (F1) |
| Major | 2 (F2, F3) |
| Minor | 1 (F4) |
| Testability-bugs | 0 |
| Testability-bug rate | 0% (R8 NOT fired — well below 15%) |
| New beads to file | 1 (F4) — F1, F2, F3 increment existing beads |
| Recurrence increments | 3 (Codex-ttavz.12, .15, .16) |
| Recurrence patterns CLOSED | 2 (`security:missing-csp`, `security:missing-hsts`) |
| Recurrence patterns STILL OPEN | 3 (auth-remote-broken-endpoint, auth-form-orphan-rpc-surface, workers:waituntil-no-catch in apps/web) |
| Recurrence promotions queued | 0 (no fingerprint hit 3+ times in trailing 6 cycles) |
| Fabrication check | 17/17 rows live |

---

## Skill patches applied

- **None this cycle.** R5 forbids auto-applying CLAUDE.md regenerations.

Suggested for next cycle (deferred to dispatcher per R5):

1. `recurrence.json`: mark `security:missing-csp` and `security:missing-hsts` with `closed_via: "Round 3 Tier 7.A (commit 253ffab4)"` and a `last_seen_open: iter-003` field. Both patterns no longer recur — keep entries for historical traceability but remove from the "active recurrence watch" set in `master.md`.
2. `references/06-domain-workers.md` R13 row description (and the R13 line in §1): widen "every `executionCtx.waitUntil(...)` (or `ctx.waitUntil(...)` in scheduled handlers)" to also include "and `platform.context.waitUntil(...)` in SvelteKit `apps/web/src/lib/server/**` modules". The hazard and fix shape are identical; the grep guard recipe should walk both directories. Not a rule change, just a verification-recipe clarification.
3. Consider promoting `web:auth-remote-broken-endpoint` to a hard rule on its 3rd hit (currently 2 hits at iter-003 + iter-029). The pattern is "remote function literal endpoint paths must be matched against canonical framework constants" — a sibling to R9's "auth endpoints rate-limit path-set must come from canonical framework names". Both share the same root cause (drift between hand-typed strings and the framework's actual routing). Defer until 3rd hit OR until the dispatcher explicitly opts in to early promotion under the security-blocker carve-out.

---

## Next-cycle prep

- **R10 effectiveness verdict**: PASS. CSP is correctly configured in `apps/web/svelte.config.js:44-74` via `kit.csp.directives` with mode='auto'; `script-src` is strict (no `unsafe-inline`); the iter-003 F2 proof test runs un-skipped and asserts both positive (CSP present) and negative (no `unsafe-inline`, `frame-ancestors: 'none'`) paths. **No next-cycle action required for R10.**
- **HSTS verdict**: PASS. `hooks.server.ts:79-84` sets `Strict-Transport-Security: max-age=63072000; includeSubDomains` in production. **No next-cycle action required.**
- **Open ttavz beads still affecting apps/web**: Codex-ttavz.12 (P0 BLOCKER — `forgot-password` typo), Codex-ttavz.15 (major — orphan RPC surface, entangled with .12), Codex-ttavz.16 (major — `waitUntil` no-catch in `brand-cache.ts`). All three are recurrence-incremented this cycle. Suggested fix order: .12 → .15 in same PR (decide wire-or-delete; if wire, fix typo first); .16 in standalone PR (one-line `.catch` per call site).
- **New finding to file**: F4 (`web:streamed-promise-no-catch` in `subscription-context.svelte.ts:104`). One-line fix; sibling file `access-context.svelte.ts` is the canonical good pattern.
- **Stop-criterion countdown**: this cycle produced 4 findings (1 new, 3 recurrence increments) — under the §4 rule, the security × apps/web cell **resets to 0/3** (any non-zero finding count resets the countdown).
- **Suggested next cell** by master.md `(open_findings DESC, last_run ASC)`: the next-most-due cell after this cycle commits will likely be `types × workers` (last_run iter-017, 5 open findings) or `simplification × packages` (last_run iter-022, 6 open findings). Phase priority breaks the tie toward `types × workers`.

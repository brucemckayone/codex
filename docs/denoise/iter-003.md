# Iteration 003 — security × apps/web

- **Cell**: security × apps/web
- **Date**: 2026-04-25
- **Mode**: delta
- **Since**: 14 days ago (`git log --since='14 days ago'`)
- **Files churned**: 38 (security-relevant subset; full apps/web/src churn is 465)
- **Agent**: agents/audit-web.md
- **Fallow JSON**: `/tmp/denoise-iter-003-fallow.json` (inherited from iter-001 — same HEAD ab06f9ba; iter-002 added only test files)
- **Typecheck baseline**: `/tmp/denoise-iter-003-typecheck-baseline.log` (3 pre-existing TS errors in `@codex/worker-utils`, baseline preserved)

## Fabrication check

Cycle 0 protocol: grep every cited symbol from references 01-security-audit.md
and 05-domain-web.md against current code. Reference 01's drift was already
covered by iter-001 F5/F6 (Codex-ttavz.5, .6) and iter-002 F4 (Codex-ttavz.10).
This cycle scans **reference 05's** anti-pattern table and recipe blocks.

| Symbol cited | Where | Hits | Status |
|---|---|---|---|
| `+page.server.ts` / `+layout.server.ts` (route guards) | ref 05 §1, §6, §9 | 50+ | live |
| `import * as m from '$paraglide/messages'` (paraglide shape) | ref 05 §7 | 100+ | live |
| `messages/en.json` | ref 05 §7 row 9 | exists | live |
| `localStorageCollectionOptions` | ref 05 §4, §9 row 4 | 2 hits in collections/library.ts, collections/progress.ts | live |
| `initProgressSync` | ref 05 §4 | live in `collections/progress-sync.ts:118` | live |
| `invalidateCollection` | ref 05 §4 | live in `collections/hydration.ts:118` | live |
| `depends('cache:versions')` | ref 05 §4 row 5 | hit in `(platform)/+layout.server.ts:12` | live |
| `depends('cache:org-versions')` | ref 05 §4 (referenced inline) | hit in `_org/[slug]/+layout.server.ts:28` | live |
| `buildContentUrl` | ref 05 §5 row 6 | live in `lib/utils/subdomain.ts:160` | live |
| `buildOrgUrl` | ref 05 §5 | live in `lib/utils/subdomain.ts` | live |
| `hooks.ts` reroute() | ref 05 §5 | exists | live |
| `sanitizeSvgContent` (cited via cross-ref to ref 01 §5a) | (ref 01) | 8 hits (covered iter-001) | live |
| `loadFromServer()` (generic name in §4 checklist) | ref 05 §4 | **0 hits — actual symbol is `loadLibraryFromServer`** | **mid-fidelity (description, not symbol)** |

**Result**: 12 of 13 cited rows live in code; the 13th (`loadFromServer`) is
a description rather than a hard symbol citation, so it doesn't qualify as
doc-rot. Reference 05 has reached fidelity for this cycle. **No new doc-rot
findings filed in iter-003.** (The doc-rot beads from iter-001 F3-F6 and
iter-002 F4-F5 remain open and pertain to references 01, 06, 07.)

## Findings

### F1 — `web:auth-remote-broken-endpoint`

- **Severity**: blocker
- **File:Line**: `apps/web/src/lib/remote/auth.remote.ts:146`
- **Description**: `forgotPasswordForm` posts to
  `${authUrl}/api/auth/forgot-password` (natural-English "forgot" spelling),
  but BetterAuth's actual endpoint is `/api/auth/forget-password`
  (no "o", per BetterAuth's `internal_endpoints` map and verified live
  in `routes/(auth)/forgot-password/+page.server.ts:29`, which uses the
  correct path). Every call from the remote function lands on a 404 at
  the auth worker. The form short-circuits to its hard-coded
  "If an account exists, a reset email has been sent." response
  regardless of the worker's reply, so the bug is **invisible to the
  user — no email is ever sent**. Forensic visibility is lost: the
  forgotten-password feature is silently broken via this codepath.

  Note: the remote function is publicly exposed as a SvelteKit RPC
  endpoint by the compiler (per `/fallow-audit` False-Positive Taxonomy
  #1) even though no Svelte component currently consumes it. Combined
  with F4 (orphan RPC surface), this means anyone hitting the RPC URL
  triggers a permanent failure. The page-action route (used by the
  actual `forgot-password` UI) is unaffected.
- **Proof test form**: API-map snapshot (Catalogue row 11)
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-003/F1-auth-remote-forgot-password-typo.test.ts`
- **MCP evidence**: Vitest unit test (file-content regex assertion).
  Future runtime verification via Playwright posting directly to the
  RPC endpoint and the page action — both should reach the same auth
  worker route.
- **Recurrence (R7)**: NEW fingerprint `web:auth-remote-broken-endpoint`.
  Single-hit security exception does NOT fire — the bug surfaces a
  silent feature failure but doesn't expose data. Severity blocker on
  feature-availability grounds, not classical security exception.
- **Bead**: _filed at step 7 by dispatching skill_

### F2 — `security:missing-csp`

- **Severity**: blocker
- **File:Line**:
  - `apps/web/svelte.config.js:1-34` (no `kit.csp.directives` block)
  - `apps/web/src/hooks.server.ts:66-76` (`securityHook` does not set CSP)
- **Description**: The web app ships to production with **no
  Content-Security-Policy header at all**. SvelteKit's `kit.csp`
  framework support is not configured; the `securityHook` in
  `hooks.server.ts` only sets `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, and `X-Request-Id`.

  Reference 01 §6 names the canonical default headers and §8 anti-pattern
  row 8 fingerprints `security:csp-unsafe-inline` ("CSP `script-src`
  allows `'unsafe-inline'` without nonce"). The current apps/web posture
  is **one step worse** than that row: no CSP at all means no
  unsafe-inline restriction, no script-src origin-list, no nonce-able
  XSS containment. Any reflected-XSS surface (search inputs rendered
  via `{#if}`-conditional templates, paraglide message interpolation,
  etc.) loses the second-line-of-defence that CSP provides.

  Combined with F3 (HSTS missing), apps/web is missing two of the
  five default headers reference 01 §6 enumerates.

  Fix: add `kit.csp.directives` to `svelte.config.js` with at minimum
  `script-src` (nonce-based), `connect-src` (worker origins), `img-src`
  (R2 / dev-cdn). SvelteKit auto-applies the directives as response
  headers and rewrites inline-script callsites to use the nonce.
- **Proof test form**: API-map snapshot (Catalogue row 11) — assert
  EITHER `svelte.config.js` exposes `kit.csp.directives` OR
  `hooks.server.ts:securityHook` sets a `Content-Security-Policy`
  response header
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-003/F2-missing-csp-and-hsts-headers.test.ts`
- **MCP evidence**: Vitest unit test (file-content assertion). Future
  runtime verification via `mcp__chrome-devtools__list_network_requests`
  on the dev server — assert the response `content-security-policy`
  header is present.
- **Recurrence (R7)**: NEW fingerprint `security:missing-csp`. The
  closely related `security:csp-unsafe-inline` (ref 01 §8 row 8) is
  the milder variant; this one (no CSP at all) is strictly worse.
  Single-hit security exception applies (severity=blocker AND
  fingerprint starts with `security:`) — promote to a hard rule on
  first sighting per R7 footnote.

  Suggested promotion (queued for iter-004's prep):

  > **R10** | apps/web (and any SvelteKit-on-Cloudflare deployment)
  > MUST set `Content-Security-Policy` either via `kit.csp.directives`
  > in `svelte.config.js` or via response headers in
  > `hooks.server.ts`. Verified by an integration test that requests
  > `/` and asserts `Content-Security-Policy` is present in the
  > response headers. | Blocker
- **Bead**: _filed at step 7 by dispatching skill_

### F3 — `security:missing-hsts`

- **Severity**: major
- **File:Line**: `apps/web/src/hooks.server.ts:66-76`
- **Description**: `securityHook` does not set `Strict-Transport-Security`.
  Reference 01 §6 names HSTS as part of the default `securityHeaders`
  middleware (alongside CSP, X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy). HSTS is the only header that prevents downgrade
  attacks on first-time visitors who land on `http://lvh.me` (or the
  prod equivalent) before the auth cookie's `Secure` attribute can
  protect it.

  In production, Cloudflare's edge typically sets HSTS via the zone-level
  setting — but that's a deployment-time configuration, not a code-level
  guarantee. App-level HSTS is the defensive belt-and-braces: any
  preview / staging / branch deploy that doesn't carry the zone setting
  loses protection silently.

  Fix: add `response.headers.set('Strict-Transport-Security',
  'max-age=63072000; includeSubDomains')` inside `securityHook`,
  optionally gated on `!dev` so local-dev (HTTP) doesn't pin the
  attribute on the developer's browser.
- **Proof test form**: API-map snapshot (Catalogue row 11) — assert
  `hooks.server.ts` source contains the literal `Strict-Transport-Security`
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-003/F2-missing-csp-and-hsts-headers.test.ts`
  (folded into the same proof file as F2 — both are header omissions
  with the same test shape)
- **MCP evidence**: Vitest unit test (file-content assertion). Future
  runtime verification via chrome-devtools network-request inspection.
- **Recurrence (R7)**: NEW fingerprint `security:missing-hsts`. Severity
  major (not blocker), so does not qualify for the single-hit security
  exception. Track for recurrence.
- **Bead**: _filed at step 7 by dispatching skill_

### F4 — `web:auth-form-orphan-rpc-surface`

- **Severity**: major
- **File:Line**:
  - `apps/web/src/lib/remote/auth.remote.ts:100` (`registerForm`)
  - `apps/web/src/lib/remote/auth.remote.ts:140` (`forgotPasswordForm`)
  - `apps/web/src/lib/remote/auth.remote.ts:175` (`resetPasswordForm`)
- **Description**: Three remote forms are exported from `auth.remote.ts`
  but **no Svelte component consumes them**. The actual auth UI uses
  native `<form method="POST">` against `+page.server.ts` actions
  (`(auth)/login`, `(auth)/register`, `(auth)/forgot-password`,
  `(auth)/reset-password`).

  Per `/fallow-audit` False-Positive Taxonomy #1, every `.remote.ts`
  export is **publicly callable as an HTTP RPC endpoint at compile
  time**, regardless of whether any client-side code references it.
  So the codebase is shipping three additional, unmonitored
  auth-related RPC endpoints that:

  1. **Bypass open-redirect protection.** `(auth)/login/+page.server.ts:111`
     validates `redirectTo.startsWith('/') && !redirectTo.startsWith('//')`.
     The orphan `registerForm` accepts no `redirectTo` and hard-codes
     `redirect(303, '/library')` — but ANY future drift from the
     page-action surface to the orphan RPC surface would lose this
     protection silently.
  2. **Bypass structured error mapping.** Page actions use SvelteKit's
     `fail(401, { ... })` with field-level errors so the UI surfaces
     "Invalid email or password" alongside the email field. The orphan
     forms return a single `{ success: false, error: <message> }` —
     unstructured, not E2E-tested.
  3. **NOT covered by iter-002 F1's BetterAuth path-set rate-limit
     fix.** The fix targets `/api/auth/sign-in/email`,
     `/api/auth/sign-up/email`, `/api/auth/forget-password`,
     `/api/auth/reset-password` at the auth worker. The remote-function
     wrappers ALSO call those paths, so abuse via the RPC endpoint
     gets the SAME backend rate-limit. BUT each remote function's own
     RPC endpoint has no separate per-IP throttle — so `forgotPasswordForm`
     is doubly-broken (F1 typo + no per-IP throttle layered on top of
     the broken backend pathway).

  Decision-quality note: orphan exports either need to be DELETED
  (preferred — page actions are the canonical surface) OR wired into
  the Svelte components (so they get progressive enhancement and
  become the single source of truth). Leaving them as orphan exports
  is the worst-of-both: dead-but-callable code.
- **Proof test form**: Consumer-count assertion (Catalogue row 2) —
  for each of `registerForm`, `forgotPasswordForm`, `resetPasswordForm`,
  assert `consumersOf(symbol).length > 0`. Today: each returns 0.
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-003/F4-auth-remote-orphan-rpc-surface.test.ts`
- **MCP evidence**: Vitest unit test (`rg`-based consumer count).
  Future runtime verification via Playwright posting directly to each
  RPC endpoint with no UI involvement and asserting either deletion
  (404 on the RPC URL) or active wire-up (form-behaviour parity with
  page action).
- **Recurrence (R7)**: NEW fingerprint `web:auth-form-orphan-rpc-surface`.
  Severity major; does not qualify for single-hit promotion. Track for
  recurrence — if any other `.remote.ts` file ships orphan auth-shaped
  exports, promote.
- **Bead**: _filed at step 7 by dispatching skill_

### F5 — `workers:waituntil-no-catch`

- **Severity**: minor
- **File:Line**:
  - `apps/web/src/lib/server/brand-cache.ts:75` (`setBrandConfig`)
  - `apps/web/src/lib/server/brand-cache.ts:90` (`deleteBrandConfig`)
- **Description**: Two `platform.context.waitUntil(promise)` calls
  for KV writes/deletes have no `.catch()` chained on the inner
  promise. Same fingerprint as iter-002 F3
  (`workers/ecom-api/src/handlers/checkout.ts:169-173`), but in
  apps/web rather than workers/. Reference 06 §3 + §9 row 4 own this
  fingerprint at the cross-cutting level — file-system location
  (`workers/` vs `apps/web/`) doesn't change the fingerprint, both
  are server-side waitUntil usage on Cloudflare Workers / Pages.

  Why it matters in apps/web specifically:
  - The web app runs on Cloudflare Pages workers; waitUntil forwards
    to the runtime. An unhandled rejection surfaces as
    `uncaughtException` in the runtime logger, BYPASSING the structured
    `obs.error/warn` channel that ops dashboards consume.
  - The two waitUntil calls fire on every brand-cache refresh — hot
    path code on every org-subdomain visit. A KV outage surfaces as
    runtime noise instead of structured "brand cache write failed"
    warnings.

  Fix: chain `.catch((err) => logger.warn('brand cache <op> failed',
  { slug, error: err instanceof Error ? err.message : String(err) }))`
  on each inner promise.
- **Proof test form**: Custom lint rule + test (Catalogue row 12) —
  parse `brand-cache.ts`, find every `waitUntil(...)` call, assert
  `.catch(` appears in the argument expression
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-003/F5-brand-cache-waituntil-no-catch.test.ts`
- **MCP evidence**: Vitest unit test (file-system regex assertion).
  No runtime MCP needed — static lint is the canonical proof shape
  for waitUntil hygiene.
- **Recurrence (R7)**: SECOND sighting of `workers:waituntil-no-catch`
  in the trailing 6 cycles (iter-002 F3 was the first). Per R7,
  promotion to hard rule fires at 3 hits in trailing 6 cycles. Track
  for the third hit; one more sighting in iter-004 through iter-006
  triggers promotion.

  Suggested promoted rule text (NOT promoted yet — only on third hit):

  > **R<N>** | Every `executionCtx.waitUntil(promise)` /
  > `platform.context.waitUntil(promise)` call MUST chain `.catch()`
  > on the inner promise. Unhandled rejections in the Cloudflare
  > runtime bypass the structured `obs.warn/error` channel that ops
  > dashboards consume. Verified by a custom lint rule + test that
  > parses every `*.ts` file under `workers/` and `apps/web/src/lib/server/`,
  > finds every `waitUntil(...)` call, and asserts `.catch(` appears
  > in the argument expression. | Major
- **Bead**: _filed at step 7 by dispatching skill_

## Summary

| Metric | Value |
|---|---|
| Total findings | 5 |
| Blocker | 2 (F1 silent feature failure, F2 CSP missing entirely) |
| Major | 2 (F3 HSTS missing, F4 orphan auth RPC surface) |
| Minor | 1 (F5 brand-cache waitUntil — recurrence #2) |
| Testability-bugs | 0 |
| Testability-bug rate | 0% (R8 does NOT fire) |
| Beads filed | _0 — pending step 7 of dispatching skill_ |
| Recurrence promotions queued | 1 (F2 — single-hit security exception fires for blocker `security:` fingerprint) |

R2 catalogue walk: NOT triggered — every finding mapped to a Catalogue row directly.

| # | Finding | Catalogue row |
|---|---|---|
| F1 | code: auth.remote.ts forget/forgot-password typo | Row 11 — API-map snapshot |
| F2 | code: missing CSP entirely | Row 11 — API-map snapshot |
| F3 | code: missing HSTS | Row 11 — API-map snapshot (folded with F2) |
| F4 | code: orphan auth RPC surface | Row 2 — consumer-count assertion |
| F5 | code: brand-cache waitUntil missing .catch | Row 12 — custom lint + test |

R8 does not fire (rate < 15%).

R7 promotions:
- **F2 single-hit security exception** fires (`severity=blocker` AND
  fingerprint starts with `security:`). Mark `recurrence.json` entry
  `security:missing-csp` as `promoted: true`. Suggested R10 rule text
  in F2 above. Queue for iter-004 prep.
- **F5 recurrence (#2 in trailing 6)** for `workers:waituntil-no-catch`.
  One more sighting in iter-004 through iter-006 triggers promotion to
  a hard rule (per R7 standard 3-hit threshold).
- **F1, F3, F4** — new fingerprints, single-hit; track for recurrence.

## MCP evidence summary

Per §3 matrix, security × apps/web's required MCPs are `playwright` AND
`chrome-devtools`. This audit produced 5 static findings backed by
Vitest unit tests; runtime MCP evidence is the dispatching skill's job
at step 6 of the cycle. Suggested runtime probes:

- **F1 + F4**: Playwright `browser_navigate` to `/forgot-password`,
  submit form, capture network traffic — assert request hits
  `/api/auth/forget-password` (correct path); also direct POST to the
  RPC endpoint URL — assert it 4xxs (deleted) or matches page-action
  shape (wired up).
- **F2 + F3**: chrome-devtools `navigate_page` to `/`,
  `list_network_requests`, capture response headers screenshot —
  assert `content-security-policy` and `strict-transport-security`
  headers are present.

## Skill patches applied

(none) — the dispatching skill applies recurrence/promotion patches at
step 7 of the cycle, not the audit agent.

The reference 05 fabrication check found mid-fidelity description-vs-
symbol drift only (`loadFromServer` is a generic checklist name, not a
hard symbol citation). No doc-rot beads filed in iter-003.

## Next-cycle prep

- **PROMOTION (highest priority)**: iter-004's first action is to add
  R10 to SKILL.md §1 Hard Rules table for `security:missing-csp`
  (single-hit security exception fired in iter-003 F2). Suggested rule
  text in F2 above. Citation comment:
  `<!-- R10 promoted from iter-003, fingerprint security:missing-csp -->`.

- **Recurrence**: track 5 fingerprints in `recurrence.json`. Three new
  fingerprints this cycle:
  1. `web:auth-remote-broken-endpoint` (F1) — NEW. Add as ref 05 §9
     row 13 if it recurs.
  2. `security:missing-csp` (F2) — NEW. Promoted to R10 on first sighting
     per single-hit security exception. Add to ref 01 §8 table at the
     same edit (more severe variant of row 8 `security:csp-unsafe-inline`).
  3. `security:missing-hsts` (F3) — NEW. Add to ref 01 §6 / §8 if it
     recurs.
  4. `web:auth-form-orphan-rpc-surface` (F4) — NEW. Add to ref 05 §9 if
     recurs.
  5. `workers:waituntil-no-catch` (F5) — already in ref 06 §9 row 4;
     **second hit** in trailing 6 cycles; recurrence increment only,
     promotion deferred to third hit.

- **F1 + F4 entanglement**: F1 (the `forgot-password` typo) and F4
  (orphan auth RPC surface) fix in the same PR. The minimal-correctness
  decision is: (a) DELETE the orphan exports if the page-action
  surface is canonical, OR (b) WIRE the page actions to call the
  remote functions and fix the typo. Decision should match project
  memory `feedback_minimal_ux_change.md` — prefer (a) deletion over
  (b) re-wiring, since the page actions are already the established
  surface.

- **F2 + F3 entanglement**: same hooks.server.ts edit. Add CSP via
  `kit.csp.directives` in `svelte.config.js` (preferred — SvelteKit's
  framework support handles nonce injection) AND add HSTS in
  `securityHook`.

- **F5 fix**: add `.catch()` to both `setBrandConfig:75` and
  `deleteBrandConfig:90`. Trivial 2-line diff. Track for the third
  recurrence; if one more file in iter-004 through iter-006 has a
  bare waitUntil, promote.

- **Stop criterion (§4)**: this is the FIRST cycle for `security ×
  apps/web`. Three consecutive zero-finding cycles needed to declare
  fidelity — countdown is 3 → 3 (this cycle produced findings, no
  decrement).

- **Cell-due check next time**:
  `git log --since=iter-003 -- 'apps/web/src/**'`. Anything that lands
  afterwards is in scope.

- **Suggested next cell** (per dispatching `master.md` priority order):
  Security row is now COMPLETE for cycle 0 (packages → workers →
  apps/web all audited). Next phase: **types**. Tie-break per phase
  priority: `types × apps/web` (heaviest churn surface, fresh axis on
  apps/web's recent ShaderHero / AudioPlayer / branding work).

---
name: denoise
description: >
  Iterative quality-loop skill for the Codex monorepo. Runs scoped, falsifiability-gated audits
  across security/types/simplification/performance × apps-web/workers/packages, with a strict
  proof-test gate (every finding requires a test that proves it). Self-improves via recurrence
  promotion (3+ hits → hard rule). Use for continuous quality regression control as code lands —
  one cell per cycle, never sweeping. Fires manually today; designed for /schedule graduation.
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

# Denoise — Iterative Quality Loop

This skill runs **one audit cell** per cycle across a 4×3 matrix (audit type × scope) and produces:

1. A per-cycle audit report at `docs/denoise/iter-NNN.md`
2. Beads (under one of 4 audit-type epics) — but **only after a proof test reproduces the finding**
3. Recurrence-counter increments in `docs/denoise/recurrence.json`
4. A status update in `docs/denoise/master.md`
5. Optional CLAUDE.md regeneration diffs at `docs/denoise/claude-md-diffs/`

The skill self-improves the same way `/design-system` does: patterns recurring 3+ times across iterations get promoted from anti-pattern rows in references → hard rules in §1 of this file.

---

## §0 — When To Invoke vs Defer

```
Use /denoise when ALL of:
  - You want a small, scoped audit slice (1 cell of the 12-cell matrix)
  - The cell has churn since its last run (or you're in --mode=full)
  - You have time to run the proof-test gate (it is mandatory)

Defer to:
  - /fallow-audit   — finding is "this export is dead" (no behaviour change)
  - /codebase-audit — you want a synthesis across all domains in one report
  - /design-system  — finding is a token / motion / a11y violation in apps/web
  - /backend-dev    — you're implementing a fix, not auditing
  - /caching        — finding is purely about cache-layer correctness
```

If after reading the references you decide a finding belongs to another skill, file the bead with `closed_via: <skill-name>` and a link to the destination work — don't double-file.

---

## §1 — Hard Rules

These rules are mandatory. Violations halt the cycle.

| ID | Rule | Severity |
|----|------|----------|
| **R1** | Every finding MUST have a test that proves it before becoming a bead — natural failing test preferred, structural / parity / snapshot / contract tests acceptable (see §6 Catalogue) | Blocker |
| **R2** | `denoise:testability-bug` is a **last resort**, only after every Catalogue row in §6 has been ruled out. The bead body MUST enumerate why each row was inapplicable. Routine fallback is forbidden. | Blocker |
| **R3** | One cycle = one cell = one `(phase, scope)` pair. Never sweep multiple cells in one invocation | Blocker |
| **R4** | Max 1 audit agent per cycle (memory: max 2 agents at a time, prefer main chat) | Blocker |
| **R5** | CLAUDE.md regeneration always emits a `.diff` at `docs/denoise/claude-md-diffs/`, NEVER auto-applies | Blocker |
| **R6** | A finding closes only after MCP-gate evidence is attached to the bead (matrix in §3) | Blocker |
| **R7** | A pattern recurring 3+ times in trailing 6 cycles gets promoted to a hard rule (R9+) in the next cycle's prep. Exception: severity=blocker security findings may promote on first sighting | Major |
| **R8** | If `testability-bug` rate exceeds 15% of findings in a cycle, the cycle's report includes a meta-warning. Subsequent cycles must justify each testability-bug against the §6 Catalogue | Major |
| **R9** | Auth endpoints MUST be rate-limited via a path-prefix or path-set match against the canonical framework route names (e.g. BetterAuth's `sign-up/email`, `sign-in/email`, `forget-password`, `reset-password`) — never hard-coded literal paths that drift from the framework's routing. Verified by an integration test that posts ≥6× to each rate-limited path and asserts a 429 response. | Blocker |
| **R10** | apps/web (and any SvelteKit-on-Cloudflare deployment) MUST set `Content-Security-Policy` either via `kit.csp.directives` in `svelte.config.js` or via response headers in `hooks.server.ts`. Verified by an integration test that requests `/` and asserts `Content-Security-Policy` is present in the response headers. | Blocker |
| **R11** | Type names declared in 2+ packages MUST resolve to a single canonical declaration site (in `@codex/shared-types` for cross-cutting wire shapes, or in the foundation package that owns the runtime shape). Worker route files MUST NOT inline structural shapes that exist as canonical exports (e.g. `WaitUntilFn`, `InvalidationLogger`, `Logger`). Verified by `expectTypeOf<A>().toEqualTypeOf<B>()` tests that fail to compile when shapes drift, plus a grep guard that asserts no duplicate `interface Logger` / `interface WaitUntilFn` declarations exist outside the canonical site. | Major |
| **R12** | Service methods MUST launch independent DB/API awaits via `Promise.all`. Sequential `await` is permitted only when a later query consumes a prior query's value (guard-then-fetch, transaction step ordering, foreign-key resolution). Verified by an in-flight counter test (mock client tracks concurrent calls; assert peak overlap >= 2 for the public method) OR a `bench()` test asserting parallel runtime is < 1.5× single-query latency. | Major |
| **R13** | Every `executionCtx.waitUntil(...)` (or `ctx.waitUntil(...)` in scheduled handlers) MUST chain `.catch(...)` on the inner promise expression, or pass a function whose internal try/catch is documented to never throw (in which case the `.catch()` is recommended defensively). Verified by a static-analysis test per worker that scans every `waitUntil(<expr>);` call and asserts `<expr>` contains `.catch(`. | Major |
| **R14** | Cache-fanout helpers (per-user library invalidation, slug-keyed cache invalidation, content-version bumps) MUST live in `@codex/cache` or `@codex/worker-utils`, not as inline route helpers. Verified by a grep guard over `workers/*/src/routes/**` asserting no `cache.invalidate(CacheType.COLLECTION_*)` literal appears outside the canonical helper sites. | Major |
| **R15** | Type assertions of the form `value as Foo` where `Foo` is **more specific** than the source type MUST be guarded by a runtime check (Zod schema parse, type-guard predicate, `instanceof`) OR widened away by adjusting the source type. Permitted exceptions, each with an inline `// reason: <code>` comment: (a) **Drizzle infinite-recursion bridges** — `as DatabaseTransaction`, `as Pick<DatabaseClient, '$client'>` to break circular Drizzle row inference (`reason: drizzle-infinite-recursion`); (b) **framework defaults at first use** — `{} as TPolicy`, `[] as ParamSchema[]` when initialising a generic-typed config object before fields are populated (`reason: framework-default-init`); (c) **Proxy-target placeholders** — `{} as T` passed as the target of `new Proxy(target, handler)` where the handler routes all access (`reason: proxy-target`); (d) **Type-test scaffolding** in `*.test.ts` only (`reason: type-test`). (e) **Stripe event discriminated unions** — `event.data.object as Stripe.X` inside `switch (event.type)` arms (`reason: stripe-event-discriminated-union`). Verified by a structural test asserting each cast site sits inside a `switch (event.type)` block whose case literal maps to the cast target. Required because Stripe's TypeScript SDK does not expose `event.type ↔ event.data.object` discrimination at the type level. `as unknown as Foo` is a separate fingerprint (`types:as-unknown-as`) and is NOT covered by this rule's exceptions — it requires its own justification. Verified by a per-package grep that lists every `as <TypeName>` cast NOT matching one of the four reason codes, with manual review per cycle. | Major |

Promoted rules appear below this table with a citation comment (`<!-- promoted from iter-NNN, fingerprint <fp> -->`).

<!-- R9 promoted from iter-002, fingerprint security:auth-endpoint-no-ratelimit -->
<!-- R10 promoted from iter-003, fingerprint security:missing-csp -->
<!-- R11 promoted from iter-005, fingerprint types:type-duplicate-cross-package (endemic 2-hit early promotion) -->
<!-- R12 promoted from iter-007, fingerprint performance:sequential-await-independent-queries (endemic single-cycle 5-hit) -->
<!-- R13 promoted from iter-008, fingerprint workers:waituntil-no-catch (R7 standard 3-hit threshold; cumulative cycle_density 7 across iter-002 + iter-003 + iter-008) -->
<!-- R14 promoted from iter-011, fingerprint simplification:duplicate-utility-helper (endemic 2-hit early promotion; cumulative cycle_density 7 across iter-009 + iter-011) -->
<!-- R15 promoted from iter-028, fingerprint types:as-cast-without-guard (R7 standard 3-hit threshold; cumulative cycle_density 7 across iter-005 + iter-006 + iter-028; non-trivial exception list — 5 reason codes covering Drizzle bridges, framework defaults, Proxy targets, type-test scaffolding, Stripe event discriminated unions) -->
<!-- Promoted rules go here as the recurrence ledger fires R7 -->

---

## §2 — Decision Tree (Phase × Scope Routing)

Every cycle is one cell. Pick the cell, then load the routed references.

```
What are you auditing?
│
├─ --phase=security
│   ├─ --scope=apps/web      → references/01-security-audit.md + references/05-domain-web.md      (agent: audit-web.md)
│   ├─ --scope=workers       → references/01-security-audit.md + references/06-domain-workers.md  (agent: audit-workers.md)
│   └─ --scope=packages      → references/01-security-audit.md + references/07-domain-packages.md (agent: audit-packages.md)
│
├─ --phase=types
│   ├─ --scope=apps/web      → references/02-type-audit.md + references/05-domain-web.md
│   ├─ --scope=workers       → references/02-type-audit.md + references/06-domain-workers.md
│   └─ --scope=packages      → references/02-type-audit.md + references/07-domain-packages.md
│
├─ --phase=simplification
│   ├─ --scope=apps/web      → references/03-simplification.md + references/05-domain-web.md
│   ├─ --scope=workers       → references/03-simplification.md + references/06-domain-workers.md
│   └─ --scope=packages      → references/03-simplification.md + references/07-domain-packages.md
│
└─ --phase=performance
    ├─ --scope=apps/web      → references/04-performance.md + references/05-domain-web.md
    ├─ --scope=workers       → references/04-performance.md + references/06-domain-workers.md
    └─ --scope=packages      → references/04-performance.md + references/07-domain-packages.md

Always also: references/08-self-improvement-loop.md (recurrence + master.md update).
```

**CLI shapes:**

```bash
/denoise                                             # no args → auto-pick the most-due cell from master.md (see §5.0)
/denoise --phase=security --scope=packages           # single cell, manual
/denoise --mode=delta --since=24h                    # all churn-eligible cells since timestamp (Phase D)
/denoise --mode=full                                 # all 12 cells (one cycle each, sequential, Phase D)
/denoise --regen-claude=workers --phase=types --scope=packages   # opt in to broader CLAUDE.md regen
```

**Continuous-operation wrappers** (see §12 Loop Mode):

```bash
/loop /denoise                                       # active-session, model self-paced
/loop 30m /denoise                                   # active-session, every 30 minutes
/schedule /denoise --cron='0 0 * * *'                # nightly cron (autonomous)
```

---

## §3 — Phase × Scope Matrix Card

|  | apps/web | workers | packages |
|---|---|---|---|
| **security**       | CSP, route auth, XSS, SVG sanitisation, cookie hygiene | HMAC, rate-limit, tenant scoping, webhook signature verify | input validation, BaseService scope, secret hygiene |
| **types**          | `any` in loaders, props drift, paraglide message shapes | `any` in ctx, narrow generics, env binding types | shared-types coupling, generic abuse, exported `any` |
| **simplification** | dup components, lonely abstractions, premature config-objects | dup procedure factories, dead branches, deprecated routes | dup utility helpers, layer leaks, single-use generics |
| **performance**    | bundle bloat, render-thrash, payload size, N+1 in loaders | KV miss rate, waitUntil leaks, N+1 queries, subrequest cap | query plans, hot-path allocation, sync I/O in async path |

### MCP gate per cell (R6)

| Cell | Required MCPs | Optional |
|---|---|---|
| security × apps/web | `playwright`, `chrome-devtools` | `context7` |
| security × workers | (Vitest integration tests) | observability MCP |
| security × packages | (Vitest unit) | `context7` |
| types × apps/web | `mcp__ide__getDiagnostics` | `svelte-autofixer` |
| types × workers | `mcp__ide__getDiagnostics` | — |
| types × packages | `mcp__ide__getDiagnostics` | — |
| simplification × all | (static; no MCPs required) | — |
| performance × apps/web | `chrome-devtools` (lighthouse + perf trace), `playwright` | — |
| performance × workers | `playwright` (Hono test client latency) | observability MCP |
| performance × packages | (Vitest `bench()`) | — |

**No MCP evidence = bead does not close (R6).**

---

## §4 — Reference Index

| File | Owns | Lines |
|------|------|-------|
| `references/01-security-audit.md` | Auth, scoping, HMAC, sanitisation, CSP/headers + anti-patterns | ~280 |
| `references/02-type-audit.md` | `any`/`unknown`, narrowing, shared-types contract | ~240 |
| `references/03-simplification.md` | Duplication, dead patterns, lonely abstractions, naming | ~260 |
| `references/04-performance.md` | N+1, bundle, render-thrash, KV/CDN, payload | ~270 |
| `references/05-domain-web.md` | apps/web specifics: SvelteKit loads, SSR/CSR, TanStack DB, remote functions | ~220 |
| `references/06-domain-workers.md` | workers/ specifics: Hono, procedure(), ctx.services, waitUntil | ~210 |
| `references/07-domain-packages.md` | packages/ specifics: BaseService, scoping, error hierarchy | ~200 |
| `references/08-self-improvement-loop.md` | Recurrence counting, rule promotion, master.md schema | ~180 |

References are loaded on demand by the routing in §2. Don't load all of them.

---

## §5 — Audit Cycle Workflow (7 steps)

This is the canonical cycle. Every invocation follows this sequence.

### Step 0 — Resolve `--phase` and `--scope` (no-args dispatch)

If the invocation supplied `--phase` AND `--scope`, skip this step and proceed to step 1 with the supplied values.

If EITHER is missing (`/denoise` with no args, or `/loop /denoise`, or `/schedule /denoise`):

1. Read `docs/denoise/master.md` Table A — the 12-cell board
2. **Filter to implemented cells.** All 12 cells are now implemented across Phases A–D. A cell is "implemented" iff its phase reference (01–04) AND domain reference (05–07) AND agent brief (audit-{web,workers,packages}.md) all exist.
3. **Pick the most-due cell** from the implemented set:
   - Compute churn for each implemented cell (step 1 algorithm below)
   - Sort by `(open_findings DESC, last_run ASC)`
   - Phase priority tie-break: security > types > performance > simplification
4. **If no cells are due** (no churn AND no open findings across the implemented set):
   - In `/loop` context: log "no churn, sleeping" and exit the cycle (the loop driver decides next interval)
   - In one-shot context: report "no work — all implemented cells clean since last run" and exit cleanly
5. **Otherwise**: set `--phase` and `--scope` from the picked cell and proceed to step 1

This is the resolution that makes `/denoise` (no args) the canonical "do the next thing" call. See §12 for the operational shapes built on top of it.

### Step 1 — Confirm cell choice + reserve iter ID

Read `docs/denoise/master.md` Table A.

**Cell-due algorithm (delta mode, default):**
1. Compute the cell's source paths (e.g., `packages/*/src/**` for `--scope=packages` cells)
2. `git log --since=<last_run> --name-only -- <paths>` → direct churn list
3. For `--scope=packages` cells, ALSO walk consumer graph via `consumerGraph()` from `scripts/denoise/index.ts` — packages with no source churn but with workers/apps consumer churn since `<last_run>` are still due (consumers may be calling them in new ways)
4. Cell is **due** if ANY direct churn OR consumer churn detected
5. Cell is **skipped** if NO churn (direct or consumer) AND zero open findings AND zero open testability-bugs

In `--mode=full`, every cell is due regardless of churn (no consumer-graph walk needed).

**Mode resolution:**
- `--mode=delta` (default): cells with churn since `--since` (default: most recent iter commit)
- `--mode=full`: every implemented cell, ignoring churn — useful for periodic full sweeps (weekly/monthly)
- `--since=<ref>` overrides the default ("most recent iter commit") with an explicit git ref or timestamp (e.g., `24h`, `2026-04-20`, `iter-024`)

**Tie-break** when multiple cells are due: `(open_findings DESC, last_run ASC)`. Security and types cells take precedence over simplification and performance.

### Step 2 — Read the cell's references

Per §2 routing, load:
- The phase reference (one of 01–04)
- The domain reference (one of 05–07)
- Always also `references/08-self-improvement-loop.md` (for the recurrence-counting protocol)

If the cell is `apps/web`, also note relevant cross-loaded skills: `/design-system` references for visual concerns, `/caching` if perf finding involves cache layers.

### Step 3 — Gather signal + dispatch the audit agent

a. **Run fallow** to gather dead-code signal:
   ```bash
   pnpm dlx fallow@2.44.2 dead-code --format json > /tmp/denoise-{{ITER_ID}}-fallow.json 2>/tmp/denoise-{{ITER_ID}}-fallow.err
   # Exit code 1 is expected when issues are found
   ```

b. **Capture typecheck baseline:**
   ```bash
   pnpm typecheck 2>&1 | tee /tmp/denoise-{{ITER_ID}}-typecheck-baseline.log
   ```

c. **Read fallow-audit's False-Positive Taxonomy** to inherit FP-detection logic before flagging anything that grepps as low-consumer:
   ```
   .claude/skills/fallow-audit/SKILL.md (§"False-Positive Taxonomy" — 11 rows)
   ```

d. **Reserve the iter ID** by counting existing iter files:
   ```bash
   ITER_NUM=$(ls docs/denoise/iter-*.md 2>/dev/null | wc -l)
   ITER_ID="iter-$(printf '%03d' $((ITER_NUM + 1)))"
   ```

e. **Dispatch the audit agent** by reading `agents/audit-<scope>.md` and substituting:
   - `{{ITER_ID}}` — e.g., `iter-027`
   - `{{PHASE}}` — security|types|simplification|performance
   - `{{SCOPE}}` — apps-web|workers|packages
   - `{{SINCE_REF}}` — git ref of last cell run (default: previous iter's commit)
   - `{{REPORT_PATH}}` — `docs/denoise/iter-NNN.md`
   - `{{FALLOW_JSON}}` — `/tmp/denoise-iter-NNN-fallow.json`
   - `{{TYPECHECK_BASELINE}}` — `/tmp/denoise-iter-NNN-typecheck-baseline.log`

The agent is **read-only by default** and receives `Write` permission ONLY for
`{{REPORT_PATH}}`.

**The `__denoise_proofs__/` artefact is RETIRED** (user decision, 2026-05-17).
Audit agents must NOT write proof-test files. The lifecycle it assumed —
`.skip` now, unflip when the fix lands — never happened in practice, so the
directories filled with permanently-skipped tests that asserted nothing and
competed with real test debt during baselining. Because this instruction was
never changed, 43 such files (3,722 lines) were still on `dev` long after the
decision, and new ones kept appearing.

The falsifiability GATE is unchanged and still mandatory — it is the half that
carries the value. It is now discharged in the report row (§4) rather than as a
file: state the assertion that would fail today, the file:line it targets, and
the command that demonstrates it. The executable test lands in the FIX's commit,
in the package's normal test directory, where it runs.

### Step 4 — Receive the findings report

Agent emits `docs/denoise/{{ITER_ID}}.md` with structured findings. Each finding has:
- `id` (e.g., `F1`, `F2`)
- `severity` (blocker | major | minor)
- `file:line`
- `fingerprint` (e.g., `security:unsanitised-svg`)
- `description` (1-2 lines)
- `proof_test_form` (one of the §6 Catalogue rows OR `testability-bug`)
- `proposed_proof_path` (where the proof test will land)
- `mcp_evidence_required` (per §3 matrix)

Cap the report at 600 lines. If the agent has more findings, it MUST split into iter-NNN-part2.md, but that's a signal the cycle scope was too broad — likely the cell needs a smaller sub-scope.

### Step 5 — Run the proof-test gate (the blocking step)

For each finding:

1. **Match a §6 Catalogue row** to the finding shape. The agent has already proposed one in `proof_test_form` — verify it's appropriate.
2. **If a Catalogue row applies**: record the proof IN THE REPORT ROW — name the Catalogue row, the assertion that would fail today, and its target file:line. Do NOT write a `.skip`ped test file (the `__denoise_proofs__/` artefact is retired; see Step 3).
3. **If NO Catalogue row applies**: the finding may file as `denoise:testability-bug` — but ONLY after the bead body enumerates each Catalogue row with one-line justification for why it was ruled out (R2 enforcement).
4. **Verify red on main** (manual step in Phase A; CI replay in later phases): checkout the parent commit, remove `.skip()`, run the proof test, capture failure output as evidence in the bead body.

**Cycle halts here if any finding lacks an evidence trail.** Do not proceed to step 6 with un-proven findings.

### Step 6 — Run MCP verification

Per §3 matrix, gather the required MCPs' output for each finding:
- security × apps/web: Playwright flow + chrome-devtools headers screenshot
- types × any: `mcp__ide__getDiagnostics` output diff
- performance × apps/web: chrome-devtools lighthouse + Playwright network log
- (etc.)

Attach evidence path/snippet to each bead. R6: no evidence = no close.

### Step 7 — File beads + update state

For each verified finding, file a bead under one of 4 epics:

```bash
bd create \
  --epic=<denoise-{phase}-epic-id> \
  --type=bug \
  --priority=<0|1|2 based on severity> \
  --label="denoise,denoise:{phase},denoise:{scope},denoise:{iter-id},denoise:{fingerprint},denoise:test-shape:{form}"
```

Then update state:

1. **Increment recurrence**: read `docs/denoise/recurrence.json`, find the fingerprint entry (or create), append `{{ITER_ID}}` to `iters[]`, increment `hits`, update `last_seen`. If `hits` reaches 3 in trailing 6 cycles → flag for promotion in next cycle's prep.

2. **Update master.md**:
   - Table A: cell row gets `last_run = {{ITER_ID}}`, `open_findings += <new findings count>`, `last_checked = today`
   - Table B: any new fingerprints added; promotions noted
   - Table C: append iter row with `(total findings, testability-bugs, rate)`
   - If R8 fires (rate > 15%): append meta-warning to top of master.md

3. **Emit CLAUDE.md diffs** if `--regen-claude` flag was set: run `scripts/denoise/extract-api.ts <package>` per touched package, write diff to `docs/denoise/claude-md-diffs/<pkg>-{{ITER_ID}}.diff`. Do NOT auto-apply (R5).

4. **Close the cycle**: commit the iter file and state updates (NOT the diffs — those wait for human review).

---

## §6 — Proof-Test Gate

This section is the load-bearing part of the skill. **R1 + R2 enforce it.**

### Where proof tests live

**There is no `__denoise_proofs__/` staging directory any more.** A proof test
is written ONCE, in its final home, by whoever lands the fix:

- `apps/web/src/**/__tests__/regression/<descriptive-name>.test.ts` (Vitest)
- `apps/web/e2e/<area>/<descriptive-name>.spec.ts` (Playwright when a route flow is needed)
- `workers/<worker>/src/__tests__/regression/<descriptive-name>.test.ts` (Vitest, with `@cloudflare/vitest-pool-workers` where configured)
- `packages/<pkg>/src/__tests__/regression/<descriptive-name>.test.ts` (Vitest)

It is never `.skip`ped. It must FAIL against the unfixed code and PASS after —
demonstrate both, in that order, and say so in the PR. A test that passes both
ways is not a proof of anything.

**Why the staging directory is gone.** The old flow wrote the test `.skip`ped
under `__denoise_proofs__/{{ITER_ID}}/` at AUDIT time, to be unflipped and
relocated when the fix landed. The unflip step was the part that never
happened: the user retired the pattern on 2026-05-17, and 43 permanently-skipped
files (3,722 lines) were nonetheless still on `dev` because this section kept
telling agents to create them. The 11 that HAD been unflipped were never
relocated either, so they sat in a directory the repo had disowned.

The audit phase now carries the proof as PROSE in its report row (the assertion
that would fail, its file:line, the command). Writing the executable test at fix
time, in its real home, removes both the staging directory and the relocation
step that nobody performed.

### PR shape (1-PR with `.skip()` removal)

- Test lands as `it.skip(...)` in the same PR as the fix
- The `.skip()` is removed in the same diff
- Reviewer sees: `+` test (skipped), `+` fix, `-` `.skip()` modifier, `+` test (active) — all in one diff
- CI captures "red on main" snapshot via `pnpm denoise:proofs` against the parent commit; the snippet attaches to the bead body

### Testability Creativity Catalogue

Before filing anything as `denoise:testability-bug`, walk this catalogue. Each row converts a non-obvious "untestable" shape into a testable one.

| If the bug is... | A test you can still write |
|---|---|
| A behaviour-equivalent refactor with no observable diff | **Parity test** — capture corpus inputs, snapshot outputs of original, assert refactor matches |
| A "lonely abstraction" with one consumer | **Consumer-count assertion** — `expect(consumersOf('Name').length).toBe(1)` — fails (vindicating) if a future consumer appears |
| A type duplication | **Type-equality test** — `expectTypeOf<X>().toEqualTypeOf<Y>()`; fails to compile if shapes drift |
| A layer leak (apps/web imports private package) | **Dependency-graph assertion** — programmatic AST walk + assert no forbidden edges |
| A "should be deleted" but the deletion IS the fix | Defer to `/fallow-audit` (cross-skill hand-off) — denoise doesn't file |
| A perf regression visible only at scale | **Synthetic load harness** — generate N rows via `@codex/test-utils` factories, bench at p95 |
| A hard-to-mock side effect (file I/O, network) | **Contract test at the boundary** — assert the public function calls a known interface; mock the interface |
| Behaviour observable only in production (real Stripe webhook) | **Replay-test** — capture a real webhook payload, assert the handler's effect; OR contract test against Stripe SDK types |
| Distributed/eventual state (KV propagation, DO consistency) | **Local emulator test** — Miniflare gives real KV semantics; assert convergence with `vi.waitFor()` |
| Behaviour gated by feature flag | **Toggle-matrix test** — run under flag-on AND flag-off; assert correct branch each time |
| API regression with no test infra | **Snapshot the route map** — `JSON.stringify(app.routes)` against stored snapshot; any drift fails |
| Naming/style consistency | **Custom lint rule + test the rule** — write the eslint/biome rule, assert it flags the regression and passes after fix |

### Phase-specific conventions

| Phase | Default proof shape |
|---|---|
| security | Integration test exercising the vulnerability + asserting fix; OR contract test on the public boundary |
| types | `expectTypeOf<A>().toEqualTypeOf<B>()` via `vitest expect-type`, OR `tsc --noEmit` failure captured as evidence, OR a typed-assertion test that fails to compile pre-fix |
| simplification | Per Catalogue: parity test (refactor), clone-count assertion (duplication), consumer-count assertion (lonely abstraction), import-graph assertion (layer leak), grep assertion (dead pattern) |
| performance | `bench()` with explicit threshold; Lighthouse score floor in Playwright; bundle-size snapshot (`stats.json` diff) |

### `denoise:testability-bug` — last resort

A finding may file as `denoise:testability-bug` ONLY if ALL:
- Every Catalogue row above has been considered AND ruled out
- Each ruling-out is enumerated in the bead body with one-line justification
- The proof would require >200 lines of harness setup
- The behaviour requires a future runtime condition that's structurally impossible to simulate today

The bead body MUST contain:
1. Original finding
2. **Catalogue walk** (all 12 rows, each with one-line justification — no exceptions)
3. Why proof would require infeasible harness investment
4. **Proposed refactor** that creates a test seam (interface extraction, DI, observable side-effect)
5. Risk-if-shipped-as-is

A testability-bug bead missing the Catalogue walk is rejected at gate step 5.

---

## §7 — Recurrence-Promotion Loop

Mirrors `/design-system` §7. The skill self-improves by promoting recurring patterns from anti-pattern rows in references → hard rules in §1 of this file.

### How it works

1. **Fingerprint every finding** as `<phase>:<anti-pattern-id>` (e.g., `security:unsanitised-svg`, `types:any-in-procedure-input`). Each anti-pattern row in references 01–04 has a stable kebab-case ID.
2. **Step 7 of the cycle increments** the corresponding `recurrence.json` entry.
3. **On hit 3** in trailing 6 cycles, the cycle's report flags the pattern for promotion.
4. **The next cycle's prep** opens `SKILL.md`, adds a new R-rule (R9, R10, ...) below the §1 table, with a `<!-- promoted from iter-NNN, fingerprint <fp> -->` citation comment.
5. **Single-hit security exception**: if `severity=blocker` AND `phase=security`, the pattern may promote on first sighting (precedent: `/design-system` R15 SVG sanitisation).

### Stop criterion (cell-level)

Three consecutive cycles for the same cell producing zero new findings AND zero recurrence increments → the cell has reached fidelity. `master.md` flags it; subsequent cycles for that cell drop to a longer cadence (e.g., monthly full-mode only) until churn brings it back.

### Fabrication check

Mirroring `/design-system` iter-05's discovery: every reference's anti-pattern table cites `file:line`. Cycle 0 of every cell starts with a 30-second grep verification that the references' own claims still hold against current code. Drift between references and code = a `denoise:doc-rot` testability-bug (the docs themselves need fixing).

---

## §8 — Cross-Skill Integration

Two relationships exist between denoise and other skills.

### A. Hand-off (action belongs elsewhere)

| Finding shape | Hand off to |
|---|---|
| Action is "delete this export, no behaviour change" | `/fallow-audit` |
| Token / motion / a11y violation in apps/web | `/design-system` |
| Cache-layer correctness specifically | `/caching` |
| Implementation pattern question (not audit) | `/backend-dev` |
| Cross-domain synthesis needed | `/codebase-audit` |

When a finding routes elsewhere, file a denoise bead with `closed_via: <skill-name>` linking to the destination work — don't double-file.

### B. Input signals (denoise consults during a cycle)

Denoise pulls signal from these tools/skills *during* the audit pass — they're sensors, not destinations.

| Source | Signal | When |
|---|---|---|
| `fallow dead-code --format json` | Unused exports/types/class members | Every cycle, step 3a |
| `/fallow-audit` False-Positive Taxonomy (11 rows) | Framework-dispatch FP patterns | Every cycle, step 3c — agent reads BEFORE flagging |
| `pnpm typecheck` baseline | Pre-existing TS errors | Every cycle, step 3b — assert no NEW errors after fix |
| `/design-system` R1–R15 (when scope=apps/web) | Visual/UI rules | apps/web cycles only — avoid double-flagging |
| `/caching` decision framework (when finding involves cache) | Layer taxonomy + anti-patterns | Performance phase, when cache concern surfaces |

**Boundary rule**: denoise consumes fallow output but does NOT compete with `/fallow-audit`. Findings whose ONLY action is "delete this export" stay routed to `/fallow-audit`. Denoise uses fallow's output to enrich its own audit — e.g., "this code path is flagged by fallow as unused AND has a security issue" → combined finding routed differently.

---

## §9 — Anti-Patterns (skill-level, not finding-level)

These are mistakes the operator (you, future Claude) can make running this skill. Distinct from findings.

| Anti-Pattern | Why it's bad | Do instead |
|---|---|---|
| Sweeping all 12 cells in one invocation | Violates R3; produces a 600+ line report no one reads | One cell per cycle; if you really need broad coverage, run `--mode=full` which serialises 12 cycles |
| Filing findings without proof tests "to save time" | Violates R1; speculative findings clog the bead queue | Halt at gate step 5 if proof can't be written; either find a Catalogue row or file as testability-bug with the walk |
| Auto-applying CLAUDE.md diffs because "they look right" | Violates R5; clobbers hand-curated content | Always emit `.diff`, always require human `git apply` |
| Re-flagging findings already filed by `/fallow-audit` | Wastes cycle time; creates duplicate beads | Read fallow JSON first (step 3a), filter against `/fallow-audit` FP taxonomy (step 3c) |
| Using `denoise:testability-bug` as a default escape | Violates R2 + R8; gate becomes bureaucratic funnel | Walk all 12 Catalogue rows; testability-bug is genuinely a last resort |
| Skipping the MCP gate "because the proof test passed" | Violates R6; runtime evidence is separate from test evidence | Both are required; both attach to the bead |

---

## §10 — When NOT to Invoke

- **Right after `/codebase-audit`**: it just covered cross-domain synthesis; let its beads land before adding more
- **Tech-debt epic at WIP cap**: don't generate findings that can't be acted on
- **Mid-incident or hot-fix**: denoise is a posture activity, not an emergency response
- **No churn since last run for any cell** AND no `--mode=full` flag: there's literally nothing to do; the cycle should skip
- **Phase A skill-build still in progress**: only `--phase=security --scope=packages` is supported until other references land

---

## §11 — Related

- `/fallow-audit` — dead-code detection, source of FP taxonomy
- `/design-system` — recursive-review precedent, R12/R14/R15 promotion mechanic
- `/codebase-audit` — broader, less-frequent multi-domain sweep
- `/backend-dev`, `/caching` — implementation-pattern documentation that denoise routes to
- Bead epics (filed against these in step 7 of the cycle):
  - `Codex-ttavz` — Denoise — Security audits
  - `Codex-lqvw4` — Denoise — Type audits
  - `Codex-mqyql` — Denoise — Simplification audits
  - `Codex-y63gl` — Denoise — Performance audits
- State files:
  - `docs/denoise/master.md` — status board
  - `docs/denoise/recurrence.json` — pattern fingerprint ledger
  - `docs/denoise/iter-NNN.md` — per-cycle reports
  - `docs/denoise/claude-md-diffs/` — pending CLAUDE.md regenerations

---

## §12 — Loop Mode & Continuous Operation

The skill supports three operational shapes, all of them built on top of the no-args dispatch in §5.0.

### A. One-shot manual

```bash
/denoise                                     # auto-pick most-due implemented cell
/denoise --phase=security --scope=packages   # explicit cell
```

Use when: you want to run a single cycle and review its findings before deciding what's next.

### B. `/loop` (active session, you're watching)

```bash
/loop /denoise                               # model self-paces; runs the next cell each tick, sleeps when idle
/loop 30m /denoise                           # fixed 30-min interval (good for a focused cleanup sprint)
/loop 2h /denoise                            # slower cadence (good for a working day in the background)
```

Behavior:
- Each tick fires `/denoise` (no args) → resolves to the most-due implemented cell via §5.0
- If no cells are due (no churn, all clean): the cycle exits with "no work" and the loop sleeps until the next interval
- Self-paced (no interval) means the model decides the next sleep based on what just happened — typically 20-30 min when idle, shorter when findings were just produced and need follow-through

**Use when**: you want a continuous quality posture during your active session — code lands, /loop /denoise picks it up on the next tick.

**Caveats**:
- Only works while the harness session is alive — closes when you close the terminal
- Phase A means most ticks will resolve to "no work" since only one cell is implemented. The loop becomes meaningful in Phase B+ when more cells are eligible

### C. `/schedule` (autonomous cron, fires when you're away)

```bash
/schedule /denoise --cron='0 0 * * *'              # nightly at midnight (delta against the day's churn)
/schedule /denoise --cron='0 0 * * 0' --mode=full  # weekly Sunday full sweep (Phase D)
/schedule /denoise --cron='0 9 * * 1-5'            # weekday mornings at 9 (delta against last 24h)
```

Behavior:
- Cron fires `/denoise` (no args) at the scheduled time
- A remote agent runs the cycle — no local session required
- Findings file as beads under the four epics; you review them in the morning
- Master.md and recurrence.json get committed by the cron agent

**Use when**: you want denoise running as a background quality regime — code accumulates during the day, cron audits it overnight, you triage findings in the morning.

**Caveats**:
- Requires the bd hooks and `pnpm denoise:proofs` to be CI-runnable (Phase D wiring)
- The cron agent commits state files but defers fix work to humans (denoise audits, never auto-fixes)
- Don't schedule autonomous denoise until the recurrence-promotion mechanism has produced at least one round of stable rules — otherwise the bead queue can balloon

### Recommended progression

1. **Today (Phase A)**: run `/denoise` manually a few times to validate the workflow on `security × packages`. Get comfortable with the proof-test gate, the catalogue walk, the bead-filing flow.
2. **After Phase B/C land**: switch to `/loop /denoise` during active sessions for hot-cell coverage.
3. **After Phase D lands** (consumer-graph + dual-mode): graduate to `/schedule /denoise --cron='0 0 * * *'` for autonomous nightly delta runs. Add a weekly `--mode=full` if cells start drifting.
4. **After 3 consecutive zero-finding cycles per cell**: the cell has reached fidelity (§7 stop criterion). Consider reducing its cadence in master.md.

### What a `/loop /denoise` tick looks like in Phase A

```
Tick 1:
  /denoise (no args)
  → §5.0 resolves to security × packages (only implemented cell)
  → §5 step 1: check churn since last iter
  → If churn: run cycle, emit iter-001.md, file beads, update master.md
  → If no churn: log "no work" and exit cleanly

Tick 2 (after sleep):
  Same flow.
  Most ticks during low activity = "no work" exits. That's correct.
  When you push code touching packages/, the next tick produces findings.
```

The "no work" path is intentionally cheap — no fallow run, no agent dispatch. The skill's §5.0 churn check is fast (`git log --since=...`).

---

## §13 — Phase status

**All phases (A–D) implemented.** Full 12-cell matrix is eligible.

| Cell | Status |
|------|--------|
| security × packages | ✅ (Phase A) |
| types × packages | ✅ (Phase B) |
| simplification × packages | ✅ (Phase B) |
| performance × packages | ✅ (Phase B) |
| security × apps/web | ✅ (Phase C) |
| types × apps/web | ✅ (Phase C) |
| simplification × apps/web | ✅ (Phase C) |
| performance × apps/web | ✅ (Phase C) |
| security × workers | ✅ (Phase C) |
| types × workers | ✅ (Phase C) |
| simplification × workers | ✅ (Phase C) |
| performance × workers | ✅ (Phase C) |
| `--mode=delta` / `--mode=full` (dual-mode cadence) | ✅ (Phase D) |
| Consumer-graph cell selection | ✅ (Phase D) |
| `--regen-claude` (per-package CLAUDE.md regen) | ✅ (Phase D) |

**What `/denoise` (no args) does:**

1. §5.0 reads `master.md`, all 12 cells eligible
2. Computes direct churn per cell via `git log --since=<last_run>`
3. For `--scope=packages` cells: also computes consumer churn via `consumerGraph()` — packages whose workers/apps consumers changed are also due
4. Picks most-due cell with phase priority: security > types > performance > simplification
5. Runs the cycle, files findings under the appropriate epic

**`/loop /denoise`** rotates through 12 eligible cells based on churn. With consumer-graph awareness, packages with no source diff still get audited when their consumers change.

**`/schedule /denoise --cron='0 0 * * *'`** runs nightly. For full coverage, use a weekly `--mode=full`:

```bash
/schedule /denoise --cron='0 0 * * *'                  # nightly delta
/schedule /denoise --cron='0 0 * * 0' --mode=full      # weekly Sunday full sweep
```

**Helper scripts** (in `scripts/denoise/`):
- `jscpd-budget.ts` — programmatic clone-count assertion (simplification proofs)
- `find-consumers.ts` — consumer-count assertion (lonely-abstraction proofs)
- `consumer-graph.ts` — cycle workflow's consumer-churn analysis (§5 step 1)
- `extract-api.ts` — TS compiler API CLAUDE.md regeneration (§5 step 7)
- `index.ts` — barrel re-export

**Bead epics** (filed against in step 7):
- `Codex-ttavz` — Denoise — Security audits
- `Codex-lqvw4` — Denoise — Type audits
- `Codex-mqyql` — Denoise — Simplification audits
- `Codex-y63gl` — Denoise — Performance audits

**State files**:
- `docs/denoise/master.md` — 12-cell status board
- `docs/denoise/recurrence.json` — pattern fingerprint ledger
- `docs/denoise/iter-NNN.md` — per-cycle reports
- `docs/denoise/claude-md-diffs/` — pending CLAUDE.md regenerations

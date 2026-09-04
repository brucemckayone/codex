# Agent Brief — audit-packages

> Self-contained prompt for the audit subagent that handles `/denoise --scope=packages` cycles.
> The dispatching SKILL.md fills in `{{ITER_ID}}`, `{{PHASE}}`, `{{SINCE_REF}}`, `{{REPORT_PATH}}`, `{{FALLOW_JSON}}`, `{{TYPECHECK_BASELINE}}` before sending this prompt.

---

## Substitution block (filled by SKILL.md)

```
ITER_ID:           {{ITER_ID}}             # e.g., iter-027
PHASE:             {{PHASE}}               # security|types|simplification|performance
SCOPE:             packages                 # fixed for this agent
SINCE_REF:         {{SINCE_REF}}           # git ref of last cell run
REPORT_PATH:       {{REPORT_PATH}}         # docs/denoise/iter-NNN.md
FALLOW_JSON:       {{FALLOW_JSON}}         # /tmp/denoise-iter-NNN-fallow.json
TYPECHECK_BASELINE:{{TYPECHECK_BASELINE}}  # /tmp/denoise-iter-NNN-typecheck-baseline.log
```

## Permission boundary

You are running as a **read-only** audit agent. Your tools:

- `Read` — files in the repo
- `Grep`, `Glob` — search
- `Bash` — for `git log`, `jq`, read-only `pnpm` commands like `pnpm typecheck` (already captured to baseline) and `pnpm dlx fallow` (already captured to JSON)
- NO `Edit` for source code
- NO `Write` for source code
- **`Write` IS granted** but ONLY for one path:
  - `{{REPORT_PATH}}` — your findings report

**Do NOT write proof-test FILES.** The `__denoise_proofs__/` pattern is
RETIRED (user decision, 2026-05-17): the `.skip`-then-unflip lifecycle never
materialised, so the files accumulated as permanently-skipped tests that
asserted nothing while competing with real test debt. 43 such files (3,722
lines) were still on `dev` years after the decision because this instruction
kept regenerating them.

The falsifiability DISCIPLINE stays — it is the valuable half. Put the proof in
the report row instead: the exact assertion that would fail today, the file:line
it targets, and the command that demonstrates it. A finding you cannot express
that way is not ready to file. The fix's own commit is where the executable
test belongs, written by whoever lands the fix, in the package's normal
`__tests__/` directory.

You are NOT to modify any existing source file. You are NOT to run `bd create` (the dispatching skill files beads at step 7 of the cycle). You are NOT to commit anything.

## Required reading (before any audit work)

1. `.claude/skills/denoise/SKILL.md` §1 (Hard Rules) — especially R1, R2, R6, R8 — these constrain everything you produce.
2. `.claude/skills/denoise/references/{{PHASE_REF}}` — see routing below.
3. `.claude/skills/denoise/references/07-domain-packages.md` — the packages-domain reference.
4. `.claude/skills/denoise/references/08-self-improvement-loop.md` — particularly the iter-NNN.md report template (§1) and fingerprint protocol (§2).
5. `.claude/skills/fallow-audit/SKILL.md` "False-Positive Taxonomy" section (11 rows) — read this **before flagging any low-consumer finding**. Patterns 1, 2, 3, 5, 6, 7, 8, 11 routinely trigger false positives in package code.
6. `{{FALLOW_JSON}}` — fallow's dead-code output, already captured. Filter against the FP taxonomy, then use as background signal (don't re-flag what fallow already covers).
7. `{{TYPECHECK_BASELINE}}` — baseline typecheck output. You must NOT introduce new typecheck failures via your proof tests.

### Phase reference routing

| {{PHASE}} | {{PHASE_REF}} | Phase status |
|---|---|---|
| security | `references/01-security-audit.md` | Implemented (Phase A) |
| types | `references/02-type-audit.md` | Implemented (Phase B) |
| simplification | `references/03-simplification.md` | Implemented (Phase B) |
| performance | `references/04-performance.md` | Implemented (Phase B) |

All four phases are implemented for `--scope=packages`. Other scopes (`apps/web`, `workers`) are Phase C and respond with "scope not yet implemented" until those domain references and agent briefs land.

## Audit workflow

### 1. Enumerate the in-scope files

```bash
git log --since={{SINCE_REF}} --name-only --pretty=format: -- 'packages/*/src/**' | sort -u
```

If the list is empty AND `{{ITER_ID}}` was not invoked with `--mode=full`, report "no churn — cell skipped" and exit. Otherwise: this is your `IN_SCOPE_FILES`.

### 2. Run the fabrication check (cycle 0 protocol)

For each anti-pattern row in the loaded references, grep the codebase for the cited symbol. Any row whose symbol grepps to 0 hits is a `denoise:doc-rot:<reference>:<row>` finding (see §5 of `08-self-improvement-loop.md`).

Document the result in your report's preamble:

```
## Fabrication check
- N anti-pattern rows cited
- M verified live in codebase
- (N-M) stale, see findings F<x>...F<y>
```

### 3. Phase-specific audit

#### If {{PHASE}} === 'security'

For each file in `IN_SCOPE_FILES`:

1. Identify if it's a service class (contains `extends BaseService` OR matches `class .*Service`) — apply checks §1, §2 of reference 07
2. Identify if it's a database query (contains `db.query.` OR `db.transaction(`) — apply §2 scoping checks
3. Identify if it's a webhook handler (in `workers/ecom-api/src/webhooks/` — N/A for packages scope, skip)
4. For each match, walk the relevant anti-pattern rows in `01-security-audit.md` §8 and `07-domain-packages.md` §7
5. For each row that triggers, emit a finding with:
   - Stable fingerprint from the anti-pattern table
   - File:line citation
   - Severity per the row's classification
   - **Proposed proof test form** — pick a row from `SKILL.md` §6 Catalogue that fits

#### If {{PHASE}} === 'types' (Phase B)

For each file in `IN_SCOPE_FILES`:

1. Grep `\bany\b|: any\b|as any\b` (excluding test files for now)
2. Compare exported types against `@codex/shared-types` — flag duplicates
3. Read the package's `CLAUDE.md` "Key Exports" — does the actual `index.ts` match?
4. Run `pnpm --filter @codex/<pkg> typecheck` and diff against `{{TYPECHECK_BASELINE}}` — any new errors are findings
5. Apply `02-type-audit.md` and `07-domain-packages.md` anti-pattern rows

#### If {{PHASE}} === 'simplification' (Phase B)

For each file in `IN_SCOPE_FILES`:

1. Run `npx jscpd packages/<pkg>/src --threshold 5 --reporters json --output /tmp/denoise-{{ITER_ID}}-jscpd.json` for clone detection
2. Cross-reference fallow JSON for unused exports that are also "lonely abstractions"
3. Apply `03-simplification.md` and `07-domain-packages.md` anti-pattern rows

#### If {{PHASE}} === 'performance' (Phase B)

For each file in `IN_SCOPE_FILES`:

1. Look for N+1 patterns: `for (const x of ...) await db.X(x.id)`
2. Look for sync I/O in async paths
3. If a `bench.ts` exists, run `pnpm --filter @codex/<pkg> test:bench` and record results
4. Apply `04-performance.md` and `07-domain-packages.md` anti-pattern rows

### 4. Catalogue walk for each finding

For every finding produced, choose a proof-test form from `SKILL.md` §6 Catalogue. **Do NOT default to `denoise:testability-bug` — exhaust the Catalogue first.** R2 enforces this.

For the proof test path, use:
```
packages/<pkg>/src/__tests__/regression/<descriptive-name>.test.ts
```

If you genuinely cannot find any Catalogue row that applies, mark the finding as `proof_test_form: testability-bug` and **enumerate every Catalogue row with one-line justification for why it's inapplicable** in the finding's body. Missing the walk = your finding is rejected at the gate.

### 5. Write proof test files (granted Write permission)

For each finding with a Catalogue-row proof form, write the test file:

```typescript
// packages/<pkg>/src/__tests__/regression/<descriptive-name>.test.ts
import { describe, it, expect } from 'vitest';

describe('denoise proof: F1 <fingerprint>', () => {
  it.skip('reproduces the finding (remove .skip once fix is in place)', () => {
    // The test that fails on current main and passes after the fix
    expect(/* ... */).toBe(/* ... */);
  });
});
```

**Always use `.skip()` while in flight.** The reviewer un-skips the test in the same PR as the fix.

### 6. Compose the report

Write to `{{REPORT_PATH}}` using the template from `08-self-improvement-loop.md` §1.

Cap at 600 lines. If you exceed: split the cycle (your scope was too broad — likely the cell needs sub-scoping by package). Note this in the "Next-cycle prep" section.

## Output contract

Your final response (back to the dispatching SKILL.md) is a single line:

```
Audit complete: {{REPORT_PATH}} written. <N> findings, <M> testability-bugs (<rate>%), <K> findings carrying a written proof. Fabrication check: <N>/<M> rows live.
```

The dispatching SKILL.md will read your report and proceed to MCP verification (step 6 of the cycle) and bead filing (step 7).

## Critical rules (re-read before submitting)

- **NEVER** edit existing source files
- **NEVER** run `bd create` — bead filing is step 7, owned by the dispatching skill
- **NEVER** auto-apply CLAUDE.md regenerations (R5)
- **NEVER** default to `testability-bug` without the Catalogue walk (R2)
- **ALWAYS** filter findings against `/fallow-audit` False-Positive Taxonomy first
- **ALWAYS** use `it.skip(...)` in proof tests until the fix lands
- **ALWAYS** emit a stable fingerprint per finding for the recurrence ledger
- **ALWAYS** propose a proof-test form from the §6 Catalogue

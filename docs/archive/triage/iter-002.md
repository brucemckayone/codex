# Triage iter-002 — 2026-04-27

> Auto-loop iteration. Policy override: prefer rung 0/1 only; skip rung 2+ (defer to human).

## Cycle context

- **Open backlog at cycle start**: 50 beads (`bd list --status=open --json`).
- **Eligibility filter** (per §0 + cycle policy):
  - Excludes any label starting with `denoise`, `ds-review`, or equal to `fallow-followup` → 22 beads removed (owned by sibling skills).
  - Excludes 4 in-progress beads (R5): Codex-2rol, Codex-shea, Codex-illw, Codex-bxb8.
  - Excludes Codex-ttavz.12 (already routed iter-001).
  - **Eligible: 28 beads**.

## Step 1 — Classify (full pass)

Heuristic walk per `references/01-complexity-ladder.md` ordering:

| Rung | Count | Notable |
|------|-------|---------|
| 0 | 0 | — |
| 1 | 1 | Codex-fcdkk |
| 2 | 1 | Codex-v5bzy (description self-flags "needs user input") |
| 3 | 21 | most lack a `file:line` locator, or are audit/review/feature-shaped |
| 4 | 6 | 4 epics + 1 high-impact path (`.env`-touching cache invalidation re-route) + 1 data repair |

Ladder snapshot written back to `docs/triage/master.md`.

## Step 2 — Pick

**Codex-fcdkk** (P2, task, `simplification`-shape, no `denoise:*` label).

Title: `denoise(round-3): fix off-by-one path in 4 remaining iter-012 proof tests (F1, F2, F5, F7, F8)`

The bead title contains the word "denoise" but it has NO `denoise:*` label — it's a follow-up scaffold-fix task created during round-3 work, not a denoise finding. Ownership stays with /triage.

## Step 3 — Pre-flight gate

`bd show Codex-fcdkk --json` re-read. Description unchanged since classification. Title and body match: `repoRoot = resolve(__dirname, '../../../../../..')` should be 5 dotdots not 6 in F1, F2, F5, F7, F8. F3, F4, F6 already correct.

`grep -n "repoRoot.*resolve" apps/web/src/__denoise_proofs__/iter-012/F*.test.ts` confirms the pre-fix state exactly matches the bead description.

## Step 4 — Resolve (rung 1)

Edit shape: pure string replacement in 5 files.

```diff
- const repoRoot = resolve(__dirname, '../../../../../..');
+ const repoRoot = resolve(__dirname, '../../../../..');
```

Files edited (absolute paths):

- `/Users/brucemckay/development/Codex/apps/web/src/__denoise_proofs__/iter-012/F1-dup-content-item-shape.test.ts:42`
- `/Users/brucemckay/development/Codex/apps/web/src/__denoise_proofs__/iter-012/F2-dup-sidebar-rail-item.test.ts:44`
- `/Users/brucemckay/development/Codex/apps/web/src/__denoise_proofs__/iter-012/F5-dup-success-page-loader.test.ts:41`
- `/Users/brucemckay/development/Codex/apps/web/src/__denoise_proofs__/iter-012/F7-lonely-creators-header.test.ts:45`
- `/Users/brucemckay/development/Codex/apps/web/src/__denoise_proofs__/iter-012/F8-doc-rot-loadFromServer.test.ts:33`

## Proof

Two-part proof (the bead waived a runtime test because all five files are `it.skip`'d / `describe.skip`'d, but per skill R2 we still run a proof shape):

1. **Filesystem existence check** (string-equality / locator-correctness shape):
   - For each test file, simulate `resolve(__dirname, '../../../../..')` from its real path.
   - Confirm the result contains `package.json` and `apps/web` (proves it lands at repo root).
   - Result: PASS — all 5 resolve to `/Users/brucemckay/development/Codex`.

2. **Vitest collection / parse**:
   - `pnpm exec vitest run` on the 5 edited files.
   - Result: 5 test files collected, 16 tests skipped, 0 errors. No syntax/parse drift introduced by the edit.

## Step 5 — MCP gate

Bead carries no denoise label and no security/perf signal. Per §3 cycle action matrix, simplification-shaped fixes get a **static-only** verification (covered by the two proof parts above). MCP not required.

## Step 6 — Bead labels

```
bd label add Codex-fcdkk triage          ✓
bd label add Codex-fcdkk triage:rung-1   ✓
bd label add Codex-fcdkk triage:iter-002 ✓
bd close Codex-fcdkk                     ✓
```

## Step 7 — Recurrence increments

Two new pattern entries in `docs/triage/recurrence.json`:

- `route:self:proof-test-path-mechanical-fix` (hits=1) — fingerprint for rung-1 mechanical fixes that touch denoise scaffolding. Watch: 3+ similar hits → rule candidate that beads of this shape stay rung-1 regardless of the `denoise(...)` title prefix.
- `signal:auto-loop-skip-rung-2-plus` (hits=1) — meta-signal recording that the auto-loop /triage policy ran a full classify and produced exactly one rung-1 candidate from 28 eligible beads. If rung-1 famine recurs, /loop /triage becomes low-yield and the parent should surface a "switch to manual /triage" prompt.

No promotion threshold reached (need 3+ hits in 6-cycle window).

## Step 8 — Skipped higher-rung beads (auto-loop policy)

Per the cycle policy override, any rung 2+ classification was deferred (not routed via `AskUserQuestion`). Cycle agent recorded but did not act on:

- Rung 2 (1 bead): Codex-v5bzy — Spotlight.svelte creator-name; bead self-flags "needs user input" between two reconciliation paths. Classification surfaced in master.md; no labels applied this cycle (it has no triage labels yet — the user can `/triage --bead=Codex-v5bzy` to pick it up).
- Rung 4 epics / design (6 beads): Codex-ev3k, Codex-y6x9j, Codex-cbbet, Codex-zp30d, Codex-r4woq, Codex-84b53 — listed in master.md ladder snapshot.
- Rung 3 large slice (21 beads): mostly missing `file:line` locators or describing audits/reviews/features. Need human framing to break apart.

The /loop will re-fire in 15 minutes; on the next iteration the only rung-1 candidate is gone, so the next cycle is expected to return `{ok: false, reason: "no rung 0/1 beads available; would require human input"}`.

## Outcome

`{ok: true, autoResolved: true, beadId: "Codex-fcdkk", rung: 1}` — committed locally as a single triage commit (no `git push`).

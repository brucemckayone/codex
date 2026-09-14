---
name: fallow-audit
description: >
  Iterative dead-code reduction for the Codex monorepo using fallow 3.x. Runs
  ONE narrow cell per cycle — pick, prove, act, verify, commit — instead of
  collecting a whole-repo report before touching anything. Every deletion
  requires a `fallow --trace` proof, and every false positive becomes a
  `.fallowrc.json` entry so the next cycle is quieter. Use when reducing unused
  exports/types/files/members, or to gate a branch with `fallow audit --base`.
---

# Fallow Audit — One Cell Per Cycle

**Requires fallow >= 3.x** (`fallow --version`). The 2.x workflow this replaced
collected all ~300 findings, fanned out two agents to verify everything, then
landed five batched PRs. That shape was a 2.x limitation — batch
`dead-code --format json` was the only verb. 3.x has per-item proof commands
(`--trace`, `--symbol-impact`, `audit --base`, `--changed-workspaces`), so the
loop below verifies one item at a time and lands continuously.

## The loop

```
pick a cell  ->  prove each item  ->  act  ->  verify  ->  commit  ->  re-run  ->  repeat
```

One cell per cycle. A cell is **one finding category × one scope**, small enough
to finish and commit in a single pass. Stop after the cycle and report; the user
decides whether to run another.

## Usage

```bash
/fallow-audit                       # pick the next cell, run one cycle, report
/fallow-audit --cell=unused_files   # run one cycle on a named category
/fallow-audit --scope=packages      # restrict the cell to packages/ + workers/
/fallow-audit --gate                # gate mode: `fallow audit --base` on this branch only
/fallow-audit --survey              # counts per category only; pick nothing, change nothing
```

## Step 1 — Survey (cheap, no findings in context)

```bash
fallow dead-code --format json > /tmp/fallow.json 2>/tmp/fallow.err   # exit 1 = findings, not failure
jq '{version, schema_version, total_issues, entry_points, summary}' /tmp/fallow.json
jq '.workspace_diagnostics' /tmp/fallow.json
```

**Read `entry_points.total` first.** It is an object (`{total, sources}`), not an
array — `length` on it returns 2 and looks catastrophic. If `total` is implausibly
low for this repo (expect ~1000+), the reachability graph is misconfigured and
every `unused_*` count is inflated. Fix `.fallowrc.json` before believing anything.

**Read `workspace_diagnostics` second.** fallow states outright when a count is
zero *because nothing was measured* — `boundaries-not-configured` and
`rule-packs-not-configured` mean `boundary_violations: 0` and
`policy_violations: 0` are non-measurements, not clean bills of health. Never
report those zeros as passes.

Do NOT dump finding arrays at this step. Counts only.

## Step 2 — Pick ONE cell

Order by *proof cost*, cheapest first — not by count:

| Priority | Category | Why it is first |
|---|---|---|
| 1 | `unresolved_imports` | A correctness bug, not cleanliness. An import that does not resolve. |
| 2 | `unlisted_dependencies` | Imported but undeclared — works only by hoisting, breaks on clean install. |
| 3 | `unused_load_data_keys` | A SvelteKit load returning data no page reads: a real round-trip paid for nothing. |
| 4 | `unused_files` | Whole-file, single proof each, no partial states. |
| 5 | `unused_component_props` / `unrendered_components` | Svelte-specific; check dynamic dispatch first. |
| 6 | `unused_types` | Usually "drop `export`, keep the type" — structurally safe. |
| 7 | `unused_exports` | Barrel and `export *` chains live here; highest FP rate. |
| 8 | `unused_class_members` | Worst FP rate — `ctx.services.*` dispatch is invisible to static analysis. |

Cap a cell at **~10 items**. If a category has more, narrow by scope
(`--scope=packages`) or by the single highest-count path.

```bash
jq -r '.<category>[] | "\(.path):\(.line // 0)\t\(.export_name // .key_name // .component_name // .package_name // "")"' \
  /tmp/fallow.json | sort | head -20
```

## Step 3 — Prove each item (MANDATORY)

**No deletion without a proof command whose output you paste into the cycle
report.** This is the gate the old workflow spent two agents approximating.

```bash
# An export: does anything reach it?
fallow dead-code --trace <file>:<export>

# Exact TypeScript consumers, including a class method reached via a registry
fallow dead-code --type-aware --symbol-impact <file>:<export-or-Class.method>

# A dependency you believe is dead
fallow dead-code --trace-dependency <name>

# How one module reaches another (barrel / export-star chains)
fallow trace --path <from> <to>

# What a category means, if unsure
fallow explain <issue-type>
```

Then the repo-specific checks fallow cannot do — see
`references/false-positives.md` for the full 11-row taxonomy. The three that
catch the most:

- **Exclude worktrees.** `--glob '!.claude/worktrees/**'` on every grep, or a
  dozen stale copies bury the signal.
- **Grep the filename stem for any `.svelte` or barrel hit.** Deep imports
  bypass barrels — a dead `index.ts` does NOT mean the sibling component is dead.
- **`export *` is fallow's biggest blind spot.** Any star hop between the barrel
  and the declaration invalidates the finding; grep the symbol directly.

If a proof surfaces a consumer, the item is a FALSE POSITIVE — go to Step 4b.

## Step 4a — Act: fix or delete

Per item, in descending preference:

1. **Fix it** — an unresolved import is a wrong path, not dead code. Repair it,
   then check whether the test it lives in was passing *vacuously* (a broken
   `import type` erases at runtime, so `expectTypeOf` assertions against it
   succeed against an error type while proving nothing).
2. **Declare it** — an unlisted dependency belongs in that package's
   `package.json`, not deleted from the importer.
3. **Consume or stop returning it** — an unused load key is either wired up or
   removed from the load's return, whichever the page actually wants.
4. **Drop `export`, keep the declaration** — for a type used only inside its own
   file. Preserves the structure, removes the finding.
5. **Delete** — only with a pasted proof and no taxonomy row matching.

## Step 4b — Act: configure, don't suppress-and-forget

A false positive is a **`.fallowrc.json` edit**, and it is the highest-value
action in the cycle because it permanently quietens every future run:

| Cause | Config key |
|---|---|
| Framework-dispatched module (`.remote.ts`, `+page.server.ts`, renderers) | `dynamicallyLoaded` |
| Intentionally-unreferenced file (`*.type-check.ts` type-level assertions) | `ignorePatterns` |
| Public API of a package, documented in its CLAUDE.md | `ignoreExports` |
| Registry-dispatched method (`ctx.services.*`) | `usedClassMembers` |
| Tool-consumed dependency (bundler plugin, CLI) | `ignoreDependencies` |

`*.type-check.ts` files exist ONLY to be type-checked — they assert that an
illegal call fails to compile. fallow reports them as `unused_files`, and
deleting one silently removes a type-level guard. Config, never delete.

## Step 5 — Verify, then commit

```bash
pnpm --filter <touched-package> typecheck     # targeted; cheap
pnpm --filter <touched-package> test          # if runtime code changed
pnpm check:ci                                 # errors on ANY biome diagnostic
```

Package tests are a **known blind spot** (Codex-629bw): 23 of 24 packages
exclude `**/*.test.ts` from their tsconfig, so `pnpm typecheck` does not see
them. If the cell touched a package test, run its suite — tsc will not save you.

One commit per cycle, naming the cell and the proof:

```
chore(<scope>): <action> — fallow <category> (<n> items)

<which cell, and the proof command used>
<per item: path:line — verdict — evidence>

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

## Step 6 — Re-run and report the delta

```bash
fallow dead-code --format json | jq '{total_issues, summary}'
```

Report: cell, items fixed / deleted / configured, `total_issues` before -> after,
and the next cell you would pick. Then **stop**. If the delta is 0 after a
non-empty cell, the cycle failed — say so rather than moving on.

## Gate mode (`--gate`) — the ratchet

Reducing the backlog is pointless if new dead code lands freely. This is the
counterpart to `check:ci`'s `--error-on-warnings`:

```bash
fallow audit --base origin/dev      # only files this branch changed
fallow dead-code --changed-workspaces origin/dev
fallow guard <changed-files>        # architecture rules, if `boundaries` configured
```

Use before opening a PR. Unlike a whole-repo run this is scoped to the diff, so
it is fast and its findings are all yours.

## Scale

Never spawn more than **2** sub-agents, and only to hold a cell's proof output
out of the parent context — never to divide up verification of a whole-repo
report. One agent per cell is the norm; the parent keeps only verdicts and
evidence lines.

## When NOT to invoke

- Mid-cycle on another epic — cycles land commits; keep them off a branch with
  in-flight review.
- `entry_points.total` implausibly low, or `workspace_diagnostics` non-empty in
  a way that affects the target cell — fix `.fallowrc.json` first; the findings
  are not trustworthy yet.
- A category with fewer than 3 items and no correctness flavour — not worth a
  cycle; fold it into the next relevant one.

## Related

- `references/false-positives.md` — the 11-row taxonomy and per-item checklist
- `/denoise`, `/triage` — same one-cell-per-cycle shape for quality and backlog
- Codex-629bw — package tests are outside typecheck, which is what lets broken
  test imports survive

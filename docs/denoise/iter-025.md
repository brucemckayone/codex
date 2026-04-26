# iter-025 — types × apps/web (Round 2 second pass)

> **Cycle**: types × apps/web, Round 2 cycle 13 (second-pass cycle 1)
> **Date**: 2026-04-26
> **HEAD before audit**: 7345a106 (iter-024 batch-sweep commit)
> **Mode**: delta (since iter-018 commit 91f1a0d3)

## §5 step 1 — Cell-due algorithm

```bash
git log 91f1a0d3..HEAD --name-only --pretty=format: -- 'apps/web/src/**' \
  | grep -v '__denoise_proofs__' | grep -v '\.test\.ts$' | grep -v '/paraglide/' | sort -u
```

**Result: empty.** Only commit since iter-018 is `7345a106` (the iter-019..024 batch sweep — docs-only). Zero production code modified in `apps/web/src/**`.

## Cycle exit per §5.0

`types × apps/web`: zero churn. 8 open findings (Codex-lqvw4.12-19) carry forward. Stop-criterion countdown: **2 of 3** (advanced from 1/3 — first cell to reach 2/3).

R11 (cross-package type duplication) effectiveness check: not applicable for a no-churn cycle.

## Round 2 second pass — begins

iter-025 is cycle 1 of Round 2's second pass. Schema:
- **First pass** (iter-013 → iter-024): each of 12 cells gets one cycle in defined rotation order
- **Second pass** (iter-025 → iter-036, projected): each cell gets its second cycle, advancing countdown 1/3 → 2/3
- **Third pass** (iter-037 → iter-048, projected): each cell gets its third cycle; cells with 3 consecutive zero-finding cycles reach fidelity (3/3) and drop to longer cadence per §7

| Pass | Status |
|------|--------|
| First (iter-013 → iter-024) | ✓ complete |
| Second (iter-025 → iter-036) | 1 of 12 (types × apps/web) |
| Third (iter-037 → iter-048) | 0 of 12 |

## Skill patches applied

- (none).

## Next-cycle prep

§5.0 sort `(open_findings DESC, last_run ASC)` for next-due cell:

Top tier (8 open findings):
- `performance × packages` — last_run iter-019, countdown 1/3
- `simplification × apps/web` — last_run iter-024, countdown 1/3
- `types × apps/web` — last_run iter-025 (just ran), countdown 2/3

`last_run ASC`: iter-019 < iter-024 < iter-025. **Next cell: `performance × packages` (iter-026)** — second-pass cycle 2, advances countdown 1/3 → 2/3.

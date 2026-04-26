# iter-017 — types × workers (Round 2, drift-detection)

> **Cycle**: types × workers, Round 2 cycle 5
> **Date**: 2026-04-26
> **HEAD before audit**: 7b48d399 (iter-016 commit)
> **Mode**: delta (since iter-005 commit 361bdc78)

## §5 step 1 — Cell-due algorithm

```bash
git log 361bdc78..HEAD --name-only --pretty=format: -- 'workers/*/src/**' \
  | grep -v '__denoise_proofs__' | grep -v '\.test\.ts$' | sort -u
```

**Result: empty.** Zero production code modified since iter-005 baseline.

## Cycle exit per §5.0

`types × workers`: zero churn. 5 open findings (Codex-lqvw4.7-11) carry forward. Stop-criterion countdown: **1 of 3**.

## Round 2 status (after iter-017)

5 of 12 cells visited. Types row at 2/3 cells (packages + workers).

## Skill patches applied

- (none).

## Next-cycle prep

Next cron fire: `types × apps/web` (iter-006 baseline `a79bbcc3`) — completes types row first pass.

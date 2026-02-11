# SKILL: Pipeline Preparation (Branch Readiness)

Verify the current branch is fully compliant with the Codex Platform CI/CD pipeline before pushing. All gates must pass for the pipeline to succeed.

## Pipeline Gates (All Required)

| # | Gate | Command | Parallel Group |
|---|------|---------|---------------|
| 1 | Lint & Format | `pnpm check:ci` | A |
| 2 | Type Check | `pnpm typecheck` | A |
| 3 | Build | `pnpm build` | - |
| 4 | Unit Tests (packages + apps) | `pnpm test` | B |
| 5 | Worker Tests | `pnpm test:workers` | B |
| 6 | Web E2E Tests | `pnpm test:e2e` | C |
| 7 | API E2E Tests | `pnpm test:e2e:api` | C |

## Execution Strategy

### Phase 1: Static Analysis (Parallel Group A)
Run lint/format and typecheck simultaneously. These have no interdependencies.

```bash
# Run in parallel (two terminals / background jobs)
pnpm check:ci &
pnpm typecheck &
wait
```

If typecheck fails on SvelteKit types, run first:
```bash
pnpm --filter web sync
```

### Phase 2: Build (Sequential - blocks all tests)
Build must succeed before any tests can run. Turborepo handles internal parallelization.

```bash
pnpm build
```

### Phase 3: Tests (Parallel Group B)
Unit tests and worker tests can run simultaneously after build.

```bash
# Run in parallel
pnpm test &
pnpm test:workers &
wait
```

### Phase 4: E2E Tests (Parallel Group C)
E2E tests run after unit/worker tests pass. Web and API E2E can run simultaneously.

```bash
# Run in parallel
pnpm test:e2e &
pnpm test:e2e:api &
wait
```

## Remediation Guide

### Lint/Format Failures
```bash
pnpm check          # Auto-fix formatting and linting
pnpm check:ci       # Re-verify (read-only check)
```

### Type Check Failures
- Analyze the `tsc` output for type mismatches, missing imports, or incorrect interfaces.
- If SvelteKit types are stale: `pnpm --filter web sync`
- If paraglide i18n types are stale: `pnpm --filter web exec paraglide-js compile --project ./project.inlang --outdir ./src/paraglide`

### Build Failures
- Check for missing dependencies or circular references.
- Verify `turbo.json` task dependencies are correct.
- Clear cache if necessary: `pnpm dev:clean`

### Unit Test Failures (packages + apps)
- Debug failing test files with vitest: `pnpm --filter <package> test`
- Ensure database migrations are current: `pnpm --filter @codex/database db:migrate`
- Check `.dev.vars.example` for required environment variables.

### Worker Test Failures
- Run individual worker tests: `cd workers/<name> && pnpm test`
- Ensure `.dev.vars.test` files exist for workers that need them.
- Worker tests use `vitest-pool-workers` which requires wrangler dev vars.

### Web E2E Failures
- Install browsers if needed: `pnpm exec playwright install --with-deps`
- Run with UI for debugging: `pnpm test:e2e:ui`
- Check that auth worker and web app can start locally.

### API E2E Failures
- Run with UI for debugging: `pnpm test:e2e:api:ui`
- Ensure all workers can start (E2E spins up the full stack).
- Check database connectivity and migration status.

## Agent Team Assignment

When running as an agent team, assign gates to specialized agents for maximum parallelism:

| Agent | Responsibility | Commands |
|-------|---------------|----------|
| **Lead** | Orchestrates sequence, handles final push | Coordinates phases, runs `bd sync`, `git push` |
| **Lint Agent** | Static analysis | `pnpm check:ci`, `pnpm check` (fix) |
| **Type Agent** | Type safety | `pnpm typecheck`, fix type errors |
| **Build Agent** | Build integrity | `pnpm build`, `pnpm dev:clean` |
| **Unit Test Agent** | Package/app tests | `pnpm test`, `pnpm --filter <pkg> test` |
| **Worker Test Agent** | Worker tests | `pnpm test:workers`, `cd workers/<name> && pnpm test` |
| **E2E Agent** | End-to-end tests | `pnpm test:e2e`, `pnpm test:e2e:api` |

### Agent Workflow
1. **Lead** dispatches Phase 1 to Lint Agent + Type Agent (parallel).
2. On Phase 1 success, **Lead** dispatches Phase 2 to Build Agent.
3. On Phase 2 success, **Lead** dispatches Phase 3 to Unit Test Agent + Worker Test Agent (parallel).
4. On Phase 3 success, **Lead** dispatches Phase 4 to E2E Agent.
5. On all gates passing, **Lead** executes the Landing Protocol.

## Landing Protocol (Final Push)

Once all gates pass:

```bash
# 1. Stage and commit any fixes made during remediation
git add <fixed-files>
git commit -m "fix: pipeline remediation for <branch>"

# 2. Rebase on latest main
git pull --rebase origin main

# 3. Sync issue tracker
bd sync

# 4. Push
git push

# 5. Verify
git status  # MUST show "up to date with origin"
```

## Success Criteria

- [ ] `pnpm check:ci` exits 0
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm build` exits 0
- [ ] `pnpm test` exits 0
- [ ] `pnpm test:workers` exits 0
- [ ] `pnpm test:e2e` exits 0
- [ ] `pnpm test:e2e:api` exits 0
- [ ] All changes committed and pushed to remote origin

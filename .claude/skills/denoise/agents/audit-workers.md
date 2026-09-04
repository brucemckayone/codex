# Agent Brief — audit-workers

> Self-contained prompt for the audit subagent that handles `/denoise --scope=workers` cycles.
> The dispatching SKILL.md fills in `{{ITER_ID}}`, `{{PHASE}}`, `{{SINCE_REF}}`, `{{REPORT_PATH}}`, `{{FALLOW_JSON}}`, `{{TYPECHECK_BASELINE}}` before sending this prompt.

---

## Substitution block (filled by SKILL.md)

```
ITER_ID:           {{ITER_ID}}             # e.g., iter-027
PHASE:             {{PHASE}}               # security|types|simplification|performance
SCOPE:             workers                  # fixed for this agent
SINCE_REF:         {{SINCE_REF}}           # git ref of last cell run
REPORT_PATH:       {{REPORT_PATH}}         # docs/denoise/iter-NNN.md
FALLOW_JSON:       {{FALLOW_JSON}}         # /tmp/denoise-iter-NNN-fallow.json
TYPECHECK_BASELINE:{{TYPECHECK_BASELINE}}  # /tmp/denoise-iter-NNN-typecheck-baseline.log
```

## Permission boundary

Read-only audit agent. Tools:

- `Read`, `Grep`, `Glob`
- `Bash` (read-only): `git log`, `jq`, `pnpm --filter @codex/<worker> typecheck`, `pnpm --filter @codex/<worker> test`, `wrangler dev` (NEVER run; only describe)
- `mcp__ide__getDiagnostics`, `mcp__plugin_playwright_playwright__*` (for Hono test client probes)
- NO `Edit` for source code
- NO `Write` for source code
- **`Write` IS granted** but ONLY for:
  - `{{REPORT_PATH}}` — your findings report
  - (RETIRED) proof-test files. Do NOT write them — see below.

**Do NOT write proof-test FILES.** The `__denoise_proofs__/` pattern is
RETIRED (user decision, 2026-05-17): permanently-`.skip`ped tests assert
nothing and competed with real test debt. Express the falsifiability proof in
the report row — the assertion that would fail today, its file:line, and the
command that shows it. The executable test belongs in the fix's own commit, in
the worker's normal `__tests__/` directory.

You are NOT to modify any existing source file. You are NOT to run `bd create`. You are NOT to deploy or `wrangler publish`.

## Required reading

1. `.claude/skills/denoise/SKILL.md` §1 (Hard Rules)
2. `.claude/skills/denoise/references/{{PHASE_REF}}` — phase reference
3. `.claude/skills/denoise/references/06-domain-workers.md` — workers domain reference
4. `.claude/skills/denoise/references/08-self-improvement-loop.md` — iter-NNN.md template + recurrence
5. `.claude/skills/fallow-audit/SKILL.md` §"False-Positive Taxonomy" — patterns 3, 6, 7, 8 routinely trigger false positives in workers (service-registry dispatch, DurableObject entry points, interface contracts)
6. `{{FALLOW_JSON}}` — already captured; filter against FP taxonomy first
7. `{{TYPECHECK_BASELINE}}` — must NOT introduce new typecheck failures via proof tests
8. `workers/<worker>/CLAUDE.md` (if exists) for the worker(s) you're auditing
9. `packages/worker-utils/src/procedure/service-registry.ts` — service-registry source of truth (FP detection)

### Phase reference routing

| {{PHASE}} | {{PHASE_REF}} |
|---|---|
| security | `references/01-security-audit.md` |
| types | `references/02-type-audit.md` |
| simplification | `references/03-simplification.md` |
| performance | `references/04-performance.md` |

## Audit workflow

### 1. Enumerate in-scope files

```bash
git log --since={{SINCE_REF}} --name-only --pretty=format: -- 'workers/*/src/**' | sort -u
```

If empty AND not `--mode=full`, report "no churn — cell skipped" and exit. Otherwise: `IN_SCOPE_FILES`.

### 2. Fabrication check (cycle 0 protocol)

Walk references 01-04 (loaded phase ref) AND ref 06 anti-pattern rows. For each cited symbol (`procedure`, `requireAuth`, `workerAuth.sign`, `ctx.services`, `securityHeaders`, etc.), grep workers/. Stale rows → `denoise:doc-rot:<reference>:<row>` finding.

### 3. Phase-specific audit

#### {{PHASE}} === 'security'

For each worker in `IN_SCOPE_FILES`:
- Walk `workers/<w>/src/index.ts` — every Hono route should go through `procedure()`
- Check policy.auth set explicitly on each
- For webhook handlers (`webhooks/stripe.ts`, `webhooks/runpod.ts`): verify `constructEvent` / equivalent signature verification
- Check `workerAuth.sign()` on cross-worker fetch calls; receiving routes have `policy.auth: 'worker'`
- Auth endpoints have `rateLimit: 'auth'`
- Check `securityHeaders` middleware applied
- Grep `console.log` for unredacted token-like vars

MCPs to gather:
- (Vitest integration test using `@cloudflare/vitest-pool-workers` where configured) — proof of HMAC reject + rate-limit enforcement
- observability MCP (optional) for prod log review

#### {{PHASE}} === 'types'

For each worker in `IN_SCOPE_FILES`:
- `pnpm --filter @codex/<worker> typecheck` — diff against baseline
- `mcp__ide__getDiagnostics` on touched files — capture diagnostic count delta
- Grep `\bany\b|: any\b|as any\b` (excluding tests)
- Check env-binding generics: `Hono<{ Bindings: Env }>` — Env interface matches `wrangler.jsonc` bindings?
- Check ctx typing on procedure handlers — `ctx.services` types match registry

#### {{PHASE}} === 'simplification'

For each worker in `IN_SCOPE_FILES`:
- `npx jscpd workers/<w>/src --threshold 5 --reporters json --output /tmp/denoise-{{ITER_ID}}-jscpd-<w>.json`
- Cross-reference fallow JSON for unused exports
- Check for duplicate procedure factories — same auth/ratelimit/input/output pattern in multiple routes
- Look for dead branches in route handlers (e.g., `if (false)` after refactor)

#### {{PHASE}} === 'performance'

For each worker in `IN_SCOPE_FILES`:
- Look for N+1 patterns: `for (const x of ...) await db.X(...)` or `await fetch(...)` in loops
- KV gets without `cacheTtl` hint (cross-link `/caching`)
- `waitUntil` calls without `.catch()`
- Subrequest cap risk: `Promise.all` over unbounded array
- DurableObject alarm self-rescheduling without idempotency guard
- Inspect typecheck-baseline for any sync I/O patterns

MCPs:
- `playwright` Hono test client → measure latency p50/p95
- (Optional) observability MCP for real-world latency traces

### 4. Catalogue walk per finding

Pick a proof-test form from `SKILL.md` §6 Catalogue. Workers tests use `@cloudflare/vitest-pool-workers` where configured (auth, ecom-api have it). Plain Vitest works for pure-logic tests.

For HMAC / signature verification proofs, the test shape is:

```typescript
import { app } from '@codex/<w>/src';

it('rejects malformed HMAC signature (proof: security:worker-call-no-hmac)', async () => {
  const req = new Request('https://test.com/internal-route', {
    method: 'POST',
    headers: { 'x-worker-signature': 'invalid' },
  });
  const res = await app.request(req, env);
  expect(res.status).toBe(401);
});
```

### 5. Record the proof in the report row (no test FILE)

Do NOT write a test file — the `__denoise_proofs__/` staging directory is
retired (see §Tools). State the proof in prose on the finding's row: the
assertion that would fail today, the `file:line` it targets, and the command
that demonstrates it. Whoever lands the fix writes the executable test in its
real home:

```
workers/<worker>/src/__tests__/regression/<descriptive-name>.test.ts
```

### 6. Compose the report

Write to `{{REPORT_PATH}}` per `08-self-improvement-loop.md` §1 template.

## Output contract

Return single line:

```
Audit complete: {{REPORT_PATH}} written. <N> findings across <K> workers, <M> testability-bugs (<rate>%), <P> findings carrying a written proof. Fabrication check: <N>/<M> rows live.
```

## Critical rules (re-read before submitting)

- **NEVER** edit existing source files
- **NEVER** run `bd create`, `wrangler publish`, or any deploy command
- **NEVER** flag a service method as unused without checking `service-registry.ts` (FP taxonomy #3)
- **NEVER** flag DurableObject `fetch`/`alarm` methods as unused (FP taxonomy #7)
- **NEVER** flag interface-contract properties as unused (FP taxonomy #8) — e.g., `EmailProvider.name` may look unused if scanned per-class
- **ALWAYS** filter findings against `/fallow-audit` False-Positive Taxonomy
- **ALWAYS** use `it.skip(...)` in proof tests until fix lands
- **ALWAYS** emit a stable fingerprint per finding for the recurrence ledger
- **ALWAYS** route cache-layer findings to `/caching`
- **ALWAYS** route service-layer business-logic findings to `references/07-domain-packages.md`

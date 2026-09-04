# Reference 04 — Performance Audit

> Loaded by `/denoise --phase=performance` regardless of scope. Pair with the relevant domain reference (05/06/07).
> Owned MCPs: `chrome-devtools` (lighthouse + perf trace) for apps/web; `playwright` (network + Hono test client latency) for routes; Vitest `bench()` for packages.

---

## §0 — When this reference applies

Every cell where `--phase=performance`. The phase covers:
- Database: N+1 queries, hot-path allocation, query plan smells
- Network: KV/CDN cache misses, payload bloat, subrequest cap risk
- Compute: render thrash (apps/web), `waitUntil` budget overruns, sync I/O in async paths
- Bundle: per-route bloat in apps/web

If the finding is **purely about cache layers** (e.g., "this cache key is wrong", "TTL is too short"), prefer routing to `/caching` — denoise consumes its anti-pattern catalogue rather than re-implementing it.

---

## §1 — N+1 query detection

Single biggest source of latency regressions. Pattern signature:

```typescript
// BAD: N+1 — one query per item
for (const item of items) {
  const detail = await db.query.details.findFirst({ where: eq(details.itemId, item.id) });
  // ...
}

// GOOD: batched with inArray
const itemIds = items.map(i => i.id);
const detailsByItem = await db.query.details.findMany({ where: inArray(details.itemId, itemIds) });
const detailsMap = new Map(detailsByItem.map(d => [d.itemId, d]));
```

**Audit recipe:**

```bash
# Find candidate hot loops with awaits inside
grep -rnE '(for|while)\s*\(.*\)\s*\{' packages/*/src workers/*/src --include='*.ts' \
  | head -200
# For each match, look 1-10 lines down for `await db.` or `await fetch(`
```

**Findings to flag:**

- `performance:n-plus-1-await-in-loop` — `await db.X(...)` inside `for/while/forEach` loop
- `performance:n-plus-1-promise-all-large` — `Promise.all(items.map(i => db.X(i.id)))` with unbounded item count (subrequest cap risk in workers)
- `performance:n-plus-1-fetch-loop` — `await fetch(...)` inside loop (can hit Cloudflare's 50 subrequest cap)

### Proof shape

`bench()` with explicit threshold OR a load harness:

```typescript
import { bench, describe, expect } from 'vitest';
import { setupTestDatabase, factories } from '@codex/test-utils';

describe('content listing perf (proof: performance:n-plus-1-await-in-loop)', () => {
  bench('100 items resolves in < 50ms p50', async () => {
    const items = await Promise.all(Array.from({ length: 100 }, () => factories.content()));
    const result = await contentService.listWithDetails(items.map(i => i.id));
    expect(result.length).toBe(100);
  }, { iterations: 50, time: 5000 });
  // Vitest bench produces p50/p95/p99; assert against threshold in afterAll
});
```

---

## §2 — Bundle bloat (apps/web)

When apps/web routes import from heavy packages, the public bundle grows. Two checks:

### 2a. Per-route bundle size

```bash
cd apps/web
pnpm build  # produces .svelte-kit/output with route bundles
# Inspect chunk sizes
find .svelte-kit/output/client/_app -name '*.js' -exec wc -c {} \; | sort -rn | head
```

Pin a baseline and assert no regression in proof tests:

```typescript
// __tests__/regression/bundle-bloat.test.ts (written WITH the fix)
import statsBefore from './stats-before.json';
import statsAfter from './stats-after.json';

it('public route bundle stays under baseline (proof: performance:bundle-admin-import-in-public)', () => {
  const beforeRoute = statsBefore.routes['/'].clientBundleBytes;
  const afterRoute = statsAfter.routes['/'].clientBundleBytes;
  expect(afterRoute).toBeLessThanOrEqual(beforeRoute * 1.02); // 2% tolerance
});
```

### 2b. Forbidden-import detection

Public-facing routes MUST NOT import admin-only modules. Static check:

```bash
# Find admin imports in public routes
grep -rn "from '@codex/admin\|from '\$lib/admin" apps/web/src/routes/(public|_org)/ --include='*.ts' --include='*.svelte'
# Each match is a bundle-leak finding
```

**Findings to flag:**

- `performance:bundle-admin-import-in-public` — `@codex/admin` imported by a public route group
- `performance:bundle-large-tree-shake-fail` — Tree-shake-resistant import (e.g., `import * as X` from a barrel that exports 100+ symbols)
- `performance:bundle-icon-fontset-shipped` — Full icon font set bundled when only ~10 glyphs used

---

## §3 — Render thrash (apps/web)

Svelte 5 runes can produce reactive loops or excessive re-renders when state is read AND written in the same `$effect`. Static patterns:

```svelte
<!-- BAD -->
let value = $state(0);
$effect(() => {
  value = computeFrom(otherState); // writes value...
  console.log(value); // ... and reads it — cycle risk
});

<!-- GOOD -->
let value = $derived(computeFrom(otherState));
```

**Audit recipe:**

```bash
grep -rn '\$effect' apps/web/src --include='*.svelte' --include='*.ts' \
  > /tmp/denoise-{{ITER_ID}}-effect-hits.txt
# Manual review: each $effect's body should not write state it also reads
```

**Findings to flag:**

- `performance:render-thrash-effect-loop` — `$effect` writes to state read in same effect
- `performance:render-thrash-derived-with-side-effect` — `$derived` value with side effect (logging, fetch) — should be `$effect`
- `performance:render-thrash-list-no-key` — `{#each items as item}` without `(item.id)` key — full re-render on append

### Proof shape

`chrome-devtools` performance trace + assertion:

```typescript
// e2e/<area>/render-thrash.spec.ts (Playwright, written WITH the fix)
it('typing in search field renders < 5 times for 10 keystrokes', async ({ page }) => {
  await page.goto('/search');
  // ... start trace, type 10 chars, stop trace, count component re-renders
  // Use chrome-devtools MCP via Playwright connection or vitest-browser instrumentation
});
```

---

## §4 — KV / CDN cache miss audit (cross-link to /caching)

Workers + apps/web rely heavily on KV-backed caches. Common smells:

- `env.KV.get(key)` without `cacheTtl` hint (cold every request)
- Cache key includes a value that changes per-request when it shouldn't (e.g., timestamp)
- Cache TTL too short for the data's update frequency
- No `version` bump on mutation (cache stays stale)

**Audit recipe:**

```bash
# Find KV gets without cacheTtl
grep -rnE '\.KV\.get\(' workers/*/src --include='*.ts' \
  | grep -v 'cacheTtl'
# Each match is a candidate finding
```

**Findings to flag:**

- `performance:kv-get-no-cache-ttl` — `KV.get(key)` without options object specifying `cacheTtl`
- `performance:cache-key-includes-mutable` — Cache key contains a value that changes per-request unnecessarily
- `performance:cache-no-version-bump-on-mutation` — Service mutates data but doesn't increment version key
- `performance:cache-ttl-mismatch-update-frequency` — TTL of 1h on data that updates every minute (excessive miss rate)

### Proof shape

When the finding is in workers, prefer Hono test client + `playwright` to measure latency:

```typescript
import { app } from '@codex/<worker>/src';
import { bench } from 'vitest';

bench('hot path with cache hit < 10ms p50', async () => {
  const res = await app.request(new Request('https://test.com/endpoint'), { /* env with KV */ });
  expect(res.status).toBe(200);
}, { iterations: 100 });
```

For deep cache concerns, defer to `/caching` SKILL.md §6 anti-pattern catalogue.

---

## §5 — Payload size

Two flavours:

- API responses including more than the consumer needs
- Server-side rendered pages embedding entire DB rows

**Audit recipe:**

```bash
# Find select * usage (Drizzle returns full row)
grep -rn 'db\.query\.[A-Za-z]*\.findMany\(' packages/ --include='*.ts' \
  | grep -v 'columns:'
# Each match returns full row — check if all fields are actually used downstream
```

**Findings to flag:**

- `performance:payload-includes-entire-row` — `findMany` without `columns: {...}` projection when only 2-3 columns used
- `performance:payload-nested-relations-eager` — Eagerly-loaded relation that consumers don't use
- `performance:payload-stringified-json-nested` — JSON column re-stringified on every read

---

## §6 — Worker subrequest budget

Cloudflare workers have a 50 subrequest cap per request. Patterns that risk it:

- Loop with `await fetch(...)` over user-supplied list
- `Promise.all(...)` over unbounded array
- Recursive worker-to-worker calls

**Findings to flag:**

- `performance:subrequest-cap-loop-fetch` — Loop calling `fetch` with no upper bound
- `performance:subrequest-cap-promise-all-unbounded` — `Promise.all` over array whose length depends on input
- `performance:waituntil-no-catch` — `ctx.waitUntil(promise)` without `.catch(...)` handler — silent failures

### Proof shape

```typescript
it('user-supplied list capped at 50 items (proof: performance:subrequest-cap-loop-fetch)', async () => {
  const list = Array.from({ length: 100 }, (_, i) => `item-${i}`);
  const result = await app.request(new Request('https://test.com/batch', {
    method: 'POST',
    body: JSON.stringify({ items: list }),
  }));
  expect(result.status).toBe(400); // server rejects beyond cap
  expect(await result.json()).toMatchObject({ error: { code: 'TOO_MANY_ITEMS' } });
});
```

---

## §7 — Hot-path allocation

Patterns that allocate unnecessarily on hot paths:

- String concatenation in loops (vs `parts.push(...); parts.join('')`)
- `JSON.parse(JSON.stringify(...))` for deep clone (vs `structuredClone()`)
- New Date() / new Map() / new Set() inside `$derived` or hot-loop body
- Regex compiled inside function body instead of at module level

**Findings to flag:**

- `performance:string-concat-in-hotpath` — `+=` string concat inside loop
- `performance:json-parse-stringify-clone` — `JSON.parse(JSON.stringify(x))` (use `structuredClone`)
- `performance:regex-recompiled-per-call` — `new RegExp(...)` or `/.../` literal inside function body
- `performance:date-new-in-hotpath` — `new Date()` inside `$derived` or render path

---

## §8 — Anti-Pattern Table

| # | Fingerprint | Pattern | Why bad | Fix |
|---|---|---|---|---|
| 1 | `performance:n-plus-1-await-in-loop` | `await db.X(...)` inside loop | Latency multiplied by item count | Batch with `inArray()` |
| 2 | `performance:kv-get-no-cache-ttl` | `KV.get(key)` without `cacheTtl` | Cold KV read every request | Add `{ cacheTtl: 60 }` or similar |
| 3 | `performance:bundle-admin-import-in-public` | `@codex/admin` imported by public route | Leaks admin code to public bundle | Restrict to admin route group |
| 4 | `performance:render-thrash-effect-loop` | `$effect` writes state it also reads | Reactive loop | Use `$derived` |
| 5 | `performance:payload-includes-entire-row` | `findMany` without column projection | Unused fields cross network | Add `columns: { id: true, name: true }` |
| 6 | `performance:waituntil-no-catch` | `waitUntil(promise)` no `.catch` | Silent failure on background job | `.catch(obs.error)` |
| 7 | `performance:sync-io-in-async-path` | Sync file-read or sync hash inside async handler | Blocks event loop | Use async equivalents |
| 8 | `performance:unbounded-pagination` | List endpoint with no `limit`/`offset` enforcement | Worst-case unbounded scan | `withPagination()` helper, max 100 |
| 9 | `performance:string-concat-in-hotpath` | `+=` string concat in loop | Quadratic memory under N | `parts.push(); join('')` |
| 10 | `performance:cache-busting-cookie-vary` | Public cache with cookie-dependent Vary | Caches per cookie variant → effectively no cache | Strip cookie before caching |
| 11 | `performance:json-parse-stringify-clone` | `JSON.parse(JSON.stringify(x))` deep clone | Slower than native + drops Date/Map | `structuredClone(x)` |
| 12 | `performance:subrequest-cap-loop-fetch` | Loop calling `fetch` no upper bound | Hits 50-subrequest cap | Cap input list; batch upstream |

Add new rows here as cycles surface new patterns.

---

## §9 — MCP Verification Matrix (performance cells)

| Scope | Required MCP | What it proves |
|---|---|---|
| `apps/web` | `chrome-devtools` (`performance_start_trace` + `performance_stop_trace` + `performance_analyze_insight`) | Measured render time, scripting time, layout shift before/after |
| `apps/web` | `chrome-devtools` (`lighthouse_audit`) | Score baseline + delta |
| `apps/web` | `playwright` (`browser_network_requests`) | Payload sizes, request count |
| `workers` | `playwright` (Hono test client) | End-to-end latency p50/p95 |
| `workers` (cache concerns) | observability MCP (optional) | Real-world miss rate from production traces |
| `packages` | (Vitest `bench()` only) | Microbenchmark p50 against threshold |

Performance findings ALWAYS need numeric evidence — a measurement before AND after the fix. The bead body carries both numbers.

---

## §10 — Cross-links

- `references/01-security-audit.md` — overlap when a "missing rate limit" is also a perf concern
- `references/02-type-audit.md` — overlap when a typed-`any` enables a perf-pessimistic shape (e.g., `db.query<any>` defeats query optimisation)
- `references/03-simplification.md` — overlap when "wrapper-no-behaviour-change" is also a perf concern
- `/caching` SKILL.md — single source of truth for cache-layer anti-patterns; denoise routes here for cache findings
- `/backend-dev` reference 11 (workers-runtime) — implementation-time guidance for fixing subrequest cap and waitUntil findings

# Reference 06 — Domain: workers/

> Loaded by `/denoise --scope=workers` regardless of phase. Pair with the relevant phase reference (01–04).
> Owns the patterns specific to Cloudflare Workers: Hono routing via procedure(), service-registry dispatch, waitUntil hygiene, DurableObject lifecycle, runtime constraints.

---

## §0 — Scope of this reference

The `workers/` directory holds 9 Hono-based Cloudflare Workers (per project CLAUDE.md):

| Worker | Port | Purpose |
|---|---|---|
| auth | 42069 | BetterAuth, sessions |
| content-api | 4001 | Content CRUD, streaming |
| organization-api | 42071 | Org CRUD, membership |
| ecom-api | 42072 | Stripe checkout, webhooks |
| admin-api | 42073 | Analytics, content/customer mgmt |
| identity-api | 42074 | User profiles, platform settings |
| notifications-api | 42075 | Email templates, sending |
| media-api | 4002 | Transcoding pipeline, HLS |
| dev-cdn | 4100 | Local R2 proxy (dev only) |

Each worker has structure:

```
workers/<name>/
├── src/
│   ├── index.ts              # Hono app + procedure() routes
│   ├── routes/               # Route handlers organized by domain
│   ├── webhooks/             # Stripe / RunPod webhook handlers (bypass procedure())
│   ├── middleware/           # Custom Hono middleware
│   └── do/                   # DurableObjects (where used)
├── wrangler.jsonc            # CF Workers configuration + bindings
├── vitest.config.<name>.ts   # Per-worker test config
└── package.json
```

Cross-loaded references for findings: `/backend-dev` for implementation patterns; `/caching` when cache-layer concerns; `references/01` for security; `references/04` for perf.

---

## §1 — `procedure()` factory

Every API endpoint goes through `procedure()` from `@codex/worker-utils`. The factory enforces:
- Auth policy (`required` / `optional` / `none` / `worker` / `platform_owner`)
- Input validation (Zod schema via `.input(schema)`)
- Rate limiting (`rateLimit: 'auth' | 'standard' | custom`)
- Service registry injection (`ctx.services.X`)
- Error mapping (typed `ServiceError` → HTTP status)
- Response envelope (`{ data: T }` / `{ items: T[], pagination: ... }` / `{ error: ... }`)

**Audit recipe:**

```bash
# Every endpoint should go through procedure()
grep -rn 'app\.\(get\|post\|put\|patch\|delete\)' workers/*/src --include='*.ts' \
  | grep -v 'procedure'
# Each match is a candidate finding (acceptable exceptions: webhook handlers, dev-only routes)
```

**Findings to flag:**

- `workers:route-bypassing-procedure` — Hono `app.METHOD(...)` not wrapped in `procedure()` (excluding documented exceptions: webhook handlers in `webhooks/`, BetterAuth in auth worker, dev-cdn proxy)
- `workers:procedure-no-input-schema` — `procedure()` without `.input(schema)` on a method that takes a body (POST/PUT/PATCH)
- `workers:procedure-output-not-typed` — Handler returns `unknown` / `any` (cross-link to `02-type-audit.md`)

---

## §2 — Service registry dispatch (`ctx.services.X`)

Per project CLAUDE.md hard rule: **MUST use `ctx.services.*` from the service registry for all services in `procedure()` handlers — NEVER create ad-hoc service instances**.

Registry lives at `packages/worker-utils/src/procedure/service-registry.ts`. Every service has a lazy getter:

```typescript
get content() {
  return this._content ??= new ContentService(this.db, this.env);
}
```

**Audit recipe:**

```bash
# Find direct instantiation (anti-pattern)
grep -rn 'new [A-Z][a-zA-Z]*Service(' workers/*/src --include='*.ts' \
  | grep -v '\.test\.ts\|service-registry'
# Each match is a candidate finding
```

Webhook handlers (Stripe, RunPod) are the documented exception — they manage their own DB lifecycle with `createPerRequestDbClient` + `waitUntil(cleanup())`.

**Findings to flag:**

- `workers:service-instantiated-directly` — `new XxxService(env)` outside service-registry
- `workers:service-not-in-registry` — Service class used in route but missing from `service-registry.ts`
- `workers:webhook-no-db-cleanup` — Webhook handler creating per-request DB client without `waitUntil(cleanup())`

---

## §3 — `waitUntil` hygiene

`ctx.waitUntil(promise)` extends a worker's lifetime to allow background work to complete after the response is sent. Critical rules:

- Every `waitUntil` MUST `.catch(...)` — unhandled rejections silently disappear
- Total `waitUntil` budget is 30 seconds (per project memory `feedback_workerd_localhost.md`)
- Long-running tasks should be queued (CF Queues), not deferred via `waitUntil`

**Audit recipe:**

```bash
# Find waitUntil without catch
grep -rnA 1 'waitUntil(' workers/*/src --include='*.ts' \
  | grep -B 1 'waitUntil(' \
  | grep -v '\.catch'
# Manual review of each match
```

**Findings to flag:**

- `workers:waituntil-no-catch` — `waitUntil(promise)` not `.catch()`-ed (also in `04-performance.md`)
- `workers:waituntil-long-running` — `waitUntil(longJob())` where longJob is known to exceed 30s
- `workers:waituntil-not-instrumented` — Background work without observability logging (silent on failure)

---

## §4 — DurableObject lifecycle

DurableObjects (DOs) are runtime-dispatched by Cloudflare via `fetch(request)` and `alarm()` methods. Based on `OrphanedFileCleanupDO` (the only DO in the repo, in `workers/media-api/src/durable-objects/`):

- `fetch` and `alarm` are **never imported statically** — they're class methods called by the runtime. Do NOT flag them as unused (FP pattern #7 from `/fallow-audit`).
- **Constructor** uses `this.state.blockConcurrencyWhile(async () => { ... })` to schedule the first alarm if none is set — this is the correct initialization pattern (replaces any need for `storage.transaction()` at init time).
- **Alarm self-rescheduling** happens in the `finally` block of `alarm()` — `this.state.storage.setAlarm(Date.now() + INTERVAL)` — ensuring the alarm is always rescheduled even if the handler throws.
- **State persistence** uses `this.state.storage.put('lastRunResult', ...)` / `put('lastRunAt', ...)` — individual key-value writes, NOT wrapped in `storage.transaction()`. This is acceptable because CF's single-writer guarantee means no concurrent writers exist inside a DO.
- **Per-request service creation**: The DO creates its own `createDbClient(...)` and service instances (`OrphanedFileService`, `R2Service`) inside each `alarm()` / `fetch()` invocation rather than storing them — correct, since bindings/env are stable but service state should not persist across invocations.
- **`fetch()` routing** dispatches by `request.method` + `url.pathname` (`/status`, `/trigger`, `/schedule`) — standard Hono-style routing inside the DO.

**Idempotency note:** The current DO has **no explicit idempotency guard** (e.g., no `alarmInFlight` storage key). It relies entirely on Cloudflare's single-writer guarantee (only one `alarm()` handler runs at a time per DO instance). This is safe for the current cleanup workload but should be flagged for future DOs that may have overlapping `fetch()` + `alarm()` mutations on shared storage keys.

**Findings to flag:**

- `workers:do-alarm-no-idempotency` — `alarm()` writes to shared storage keys that `fetch()` also mutates, without an idempotency guard (currently a **low-risk** finding: `OrphanedFileCleanupDO` writes distinct keys from `alarm()` vs `fetch()`, but future DOs may not)
- `workers:do-state-no-transaction` — Multi-step state update that requires atomicity across keys, done outside `storage.transaction(...)` (acceptable for independent keys; flag only when keys are read-then-written across steps)
- `workers:do-fetch-no-routing` — `fetch(request)` handler that doesn't route by URL path (catches all requests in one branch)
- `workers:do-alarm-not-in-finally` — `alarm()` reschedules outside a `finally` block, meaning a thrown error prevents rescheduling and the DO goes silent

---

## §5 — wrangler.jsonc bindings

Worker config defines bindings (KV, R2, DO, secrets, services). Findings here are usually about drift between code and config.

**Audit recipe:**

```bash
# For each worker, find bindings declared in wrangler vs used in code
for w in workers/*/; do
  echo "=== $w ==="
  cat "$w/wrangler.jsonc" | grep -E '"binding":'  # bindings declared
  grep -rn 'env\.[A-Z_]*' "$w/src" --include='*.ts' | grep -v 'process\.env'  # bindings used
done
```

**Findings to flag:**

- `workers:binding-declared-not-used` — Binding in `wrangler.jsonc` with no `env.X` reference in source
- `workers:binding-used-not-declared` — `env.X` reference with no binding (will be `undefined` at runtime)
- `workers:secret-binding-no-rotation` — Secret binding (`SECRET_*`) with no rotation strategy documented

---

## §6 — Cloudflare runtime constraints

The workerd runtime imposes:
- **CPU**: 30s per request (Bundled plan; 50ms on Free)
- **Memory**: 128 MB
- **Subrequest cap**: 50 outbound `fetch`/`KV` calls per request
- **waitUntil budget**: 30s after response
- **Localhost blocked**: workerd blocks `fetch` to `localhost`/`127.0.0.1` (per project memory `feedback_workerd_localhost.md`) — use LAN IP for local dev

**Findings to flag:**

- `workers:fetch-localhost-blocked` — `fetch('http://localhost:...')` from worker code (works in tests, blocks at runtime)
- `workers:cpu-bound-loop` — Loop iterating > 100k items synchronously
- `workers:memory-bloat-large-array` — Array allocation > 10MB without streaming

---

## §7 — Per-worker idiosyncrasies

Workers with non-default patterns:

- **auth (42069)**: Uses BetterAuth, NOT `procedure()`. Audit BetterAuth handlers separately.
- **ecom-api (42072)**: Stripe webhook handler at `webhooks/stripe.ts` bypasses `procedure()`. Must verify with `stripe.webhooks.constructEventAsync`.
- **media-api (4002)**: RunPod webhook handler at `webhooks/runpod.ts` similar pattern.
- **dev-cdn (4100)**: Local-only proxy; minimal auth; not deployed to prod.

**Findings to flag:**

- `workers:auth-route-using-procedure` — auth worker route incorrectly using `procedure()` instead of BetterAuth handler
- `workers:webhook-not-in-webhooks-dir` — Webhook handler outside `webhooks/` subdir (loses convention)

---

## §8 — Cross-skill coordination

| Finding shape | Hand off to |
|---|---|
| Cache layer concern (KV, version key) | `/caching` |
| Service-layer business logic bug (in `@codex/<service>`) | `references/07-domain-packages.md` |
| Stripe-specific concern | `/backend-dev` reference 06 |
| Dead route handler | `/fallow-audit` |

---

## §9 — Anti-Pattern Table (workers domain)

| # | Fingerprint | Pattern | Why bad | Fix |
|---|---|---|---|---|
| 1 | `workers:route-bypassing-procedure` | Hono `app.METHOD(...)` not in `procedure()` | Skips auth/validation/error mapping | Wrap in `procedure({ ... })` |
| 2 | `workers:procedure-no-input-schema` | `procedure()` POST/PUT without `.input(schema)` | Untyped body reaches handler | Add Zod schema |
| 3 | `workers:service-instantiated-directly` | `new XxxService(env)` in route | Bypasses lazy lifecycle, request scoping | Use `ctx.services.xxx` |
| 4 | `workers:waituntil-no-catch` | `ctx.waitUntil(p)` without `.catch` | Silent failure on background job | Add `.catch(obs.error)` |
| 5 | `workers:webhook-no-db-cleanup` | Webhook with per-request DB but no cleanup | Connection leak | Wrap cleanup in `waitUntil` |
| 6 | `workers:binding-declared-not-used` | `wrangler.jsonc` binding with zero references | Stale config | Remove from `wrangler.jsonc` |
| 7 | `workers:binding-used-not-declared` | `env.X` with no binding | Runtime undefined | Declare in `wrangler.jsonc` |
| 8 | `workers:fetch-localhost-blocked` | `fetch('http://localhost:...')` in worker | workerd blocks localhost | Use LAN IP or service binding |
| 9 | `workers:do-alarm-no-idempotency` | `alarm()` writes shared storage keys without dedup guard | Data race if `fetch()` mutates same keys | Low risk for current `OrphanedFileCleanupDO` (keys are disjoint); add `alarmInFlight` guard for future DOs with overlapping `fetch`/`alarm` writes |
| 10 | `workers:cpu-bound-loop` | Synchronous loop > 100k iterations | Hits 30s CPU cap | Batch + yield |
| 11 | `workers:stripe-webhook-no-signature-verify` | Webhook reads body without `constructEventAsync` | Forged webhook accepted (cross-link `01-security`) | Call `stripe.webhooks.constructEventAsync` |
| 12 | `workers:console-log-not-redacted` | `console.log(token)` or similar | Token in tail logs | Use `obs.redact()` from observability |

---

## §10 — Cross-links

- `references/01-security-audit.md` — many security findings overlap with workers (HMAC, rate-limit, auth)
- `references/02-type-audit.md` — `any` in `ctx`, env-binding generics
- `references/03-simplification.md` — duplicate procedure factories, dead route branches
- `references/04-performance.md` — `workers:waituntil-no-catch` and N+1 patterns
- `/backend-dev` references 01 (procedure) + 11 (workers-runtime) — implementation-time guidance
- `/caching` — for KV/CDN cache concerns
- `/fallow-audit` FP taxonomy #7 (DurableObject entry points) — `fetch`/`alarm` are runtime-dispatched, never flag as unused
- `packages/worker-utils/src/procedure/service-registry.ts` — service-registry source of truth

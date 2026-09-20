---
name: workers-runtime
description: >
  Cloudflare Workers runtime characteristics that affect backend code — waitUntil
  semantics, KV eventual consistency, workerd body caching, CPU/memory/subrequest
  limits, and the rules that emerge from them.
type: reference
---

# Workers Runtime Characteristics

Everything in Codex runs on Cloudflare Workers (workerd). The platform's behavior
imposes rules that aren't obvious from reading Node.js-like code — this reference
documents the runtime truths that backend code has to respect.

Many rules scattered across other references trace back to a runtime fact. This
doc is the single place where those facts live.

---

## 1. `waitUntil` — what it actually does

`ctx.executionCtx.waitUntil(promise)` tells workerd to keep the request alive
until `promise` settles, even after the response is sent to the client.

**Contract:**
- Extends request lifetime (up to CPU/wall-time budget)
- Does NOT delay the response — response flushes on `return`
- Rejected promises inside waitUntil become **unhandled rejections** → workerd
  logs a warning and may kill the isolate early
- Multiple `waitUntil` calls per request are fine — they run concurrently

**Rules that emerge:**

1. **Every `waitUntil(promise)` must have `.catch()`.** Without it, one flaky KV
   write terminates the isolate prematurely and your other deferred work dies
   with it.
2. **Don't `await cleanup()` in a `finally` block — use `waitUntil(cleanup())`.**
   Awaiting blocks the response. For webhook handlers this costs 50–200ms of
   user-visible latency for zero benefit.
3. **Budget is finite.** Long-running `waitUntil` operations (multi-minute jobs)
   should queue to Durable Objects or a scheduled worker, not run inline.

See: `01-procedure-patterns.md`, `06-stripe-integration.md` §7/§13 anti-patterns,
`04-security-patterns.md` session auth.

---

## 2. KV eventual consistency

Cloudflare KV is replicated globally. Writes take **up to 60 seconds** to
propagate everywhere. Reads within a region usually see their own writes
immediately, but not always.

**Consequences:**

- Write-read from the same worker: usually fine, not guaranteed
- Write in one region, read in another within 60s: may see stale value
- TTL expiry is best-effort, not exact

**Rules that emerge:**

- Don't use KV as a source of truth for authoritative data — it's a cache layer.
  DB is always authoritative.
- The session TTL cap rule (`Math.min(300, ttl)` in ref 04) is bounded by KV's
  propagation characteristics: even a 60s TTL can't revoke faster than KV
  propagation.
- The version-manifest cache invalidation (`caching` skill) is designed around
  this — versions bump, downstream reads detect the bump and refetch. It does
  NOT rely on deletes propagating instantly.

---

## 3. Body caching in Hono/workerd

Hono wraps `Request` such that `c.req.text()` and `c.req.json()` cache the body
internally. First call reads the raw stream; subsequent calls return the cached
value.

**Rules that emerge:**

- Signature-verifying middleware (`workerAuth`, Stripe `verifyWebhookSignature`)
  MUST read `c.req.text()` before any downstream code parses JSON — otherwise
  the signature can't be computed.
- After `workerAuth` reads the raw text, a later `c.req.json()` in `procedure`'s
  Zod validation re-parses the cached text. This works today but is fragile:
  any middleware that introduces body streaming / transformation between the
  two breaks the chain silently.
- Don't introduce body-transforming middleware. If you need to intercept the
  body (logging, size limits), do it in the signature-verifier's own path so
  the cache contract is visible in one place.

See: `04-security-patterns.md` "Body-ordering contract" section.

---

## 4. CPU time and memory limits

Workers have hard CPU and memory budgets per request:

| Limit | Value (Workers Paid) | Effect on Codex |
|-------|----------------------|-----------------|
| CPU time | 30s wall + 50ms/request CPU accounting on free, much higher on paid | Long RunPod dispatch must fire-and-forget via `waitUntil` |
| Memory | 128 MB | Don't read 5GB video into memory — presigned R2 URL pattern (ref 07) |
| Subrequests | 50 per request (1000 on enterprise) | Worker-to-worker fanout is bounded — cap parallelism |
| Response size | No hard limit but streams above ~100MB degrade | Paginate large lists |

**Rules that emerge:**

- Large file uploads → presigned R2 URL, not multipart (ref 07 decision tree)
- Heavy transcoding → RunPod worker-to-worker trigger, not inline
- Fanout operations → batch or paginate; don't fire 100 parallel `workerFetch`
  calls from one request

---

## 5. Request isolates and state

Each request gets its own isolate-like context. Module-level state persists
across requests on the same isolate, but:

- Isolates are ephemeral — Cloudflare can kill and recreate at any time
- No guarantee the same isolate handles two sequential requests
- No shared memory across isolates

**Rules that emerge:**

- Don't use module-level variables for cross-request state — use KV / DO / DB
- Module-level DB clients (like `dbHttp` singleton) work because they're
  stateless HTTP clients, not connection pools. `dbWs` (WebSocket) singletons
  would fail — hence the per-request `createPerRequestDbClient()` pattern for
  transactions (ref 03).
- Service registry in `procedure()` is per-request — cleanup via `waitUntil`
  closes WebSocket connections after the response flushes.

See: `03-database-patterns.md`, `02-service-layer.md`.

---

## 6. `fetch` inside workers

Worker-to-worker `fetch` has specific quirks:

- **`localhost:PORT` is blocked** in production workerd. Inter-worker calls
  use `getServiceUrl(service, env)` which resolves to service-appropriate URLs.
- **Dev mode** uses LAN IPs (or `lvh.me` subdomains) because workerd dev
  also blocks `localhost` for cross-worker calls.
- **Subrequest counting** — each `fetch` from a worker to any URL (including
  another worker on same account) counts against the 50 / 1000 budget.

**Rules that emerge:**

- `getServiceUrl(service, env)` — never `*_API_URL` per-target env vars (ref 04
  anti-pattern)
- `workerFetch()` from `@codex/security` wraps `fetch` with HMAC headers;
  receiver validates via `policy: { auth: 'worker' }` (ref 04)

---

## 7. Timers and clocks

`Date.now()` and `performance.now()` are **rounded/mocked** in Workers to
prevent Spectre-class timing attacks. Inside a single request, all calls to
`Date.now()` return the same value (frozen at request start) unless a
network I/O boundary has happened.

**Rules that emerge:**

- Performance measurements are coarse — use `createRequestTimer()` from
  `@codex/observability` which adjusts for the freezing.
- HMAC timestamp skew checks (ref 04 worker-auth) must allow ±60s; the
  receiver's clock freezes per-request, sender's freezes per-request, clocks
  can drift genuinely between nodes.
- Don't rely on `Date.now()` for rate-limit bucket keys — use KV's own TTL
  semantics.

---

## 8. Logs, errors, observability

`console.log` output goes to `wrangler tail` and the Cloudflare dashboard.
Errors in a request return from the main handler; errors inside `waitUntil`
callbacks are logged but don't affect the response.

**Rules that emerge:**

- Use `@codex/observability` `ObservabilityClient`, not `console.log` (ref 08)
- Unhandled rejections in `waitUntil` = warnings + possible isolate kill
- `trackError(err, context)` for caught-then-rethrown errors; don't log the
  same error twice (once on catch, once via `mapErrorToResponse`)

See: `08-observability-patterns.md`.

---

## 9. What Workers DON'T have (compared to Node.js)

- No filesystem (`fs.readFile` doesn't exist)
- No Node streams (use Web Streams API instead)
- No child processes
- Limited `Buffer` support (use `Uint8Array` / `ArrayBuffer`)
- No TCP/UDP sockets (except via Tail Workers or WebSocket APIs)
- `crypto` is `globalThis.crypto` (Web Crypto API), not Node's `crypto` module

Rules: when porting or writing Worker code, reach for Web Platform APIs first,
not Node.js conventions. Most library compatibility issues trace back to this.

---

## 10. Debugging checklist

When a bug smells like runtime behavior rather than logic:

1. Is `waitUntil` missing `.catch()`? → isolate may die before deferred work
2. Is response returning before `waitUntil` side-effects settle? → expected,
   but confirm the side-effect is logged when it eventually runs
3. Is cross-worker `fetch` hitting `localhost`? → use `getServiceUrl()`
4. Is the signature failing despite correct secret? → body may have been
   read/transformed before the verifier (see §3)
5. Is a "module-level cache" inconsistent across requests? → isolates, not
   processes — don't rely on cross-request memory
6. Is a KV read returning stale? → eventual consistency, up to 60s. Use
   version manifests or per-key TTLs that tolerate staleness.
7. Is a subrequest budget hit? → fewer parallel fetches, or move work to
   Durable Objects / Queues

---

## When to Re-Verify This Reference

Re-read this doc against current code if you see changes in:

- Cloudflare Workers / workerd runtime specs (subrequest caps, CPU limits)
- `packages/worker-utils/src/procedure/procedure.ts` (executionCtx usage)
- `packages/security/src/worker-auth.ts` (body-read ordering)
- `packages/database/src/client.ts` (HTTP vs WS client selection)

The runtime characteristics change rarely. If you see drift in this doc vs
actual behavior, the doc is almost certainly stale — Cloudflare updates
workerd frequently.

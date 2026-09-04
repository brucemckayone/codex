# @codex/observability

Structured logging for Cloudflare Workers. PII redaction, request tracking, performance timing.

## `ObservabilityClient`

```ts
const obs = new ObservabilityClient(serviceName, environment?, redactionOptions?);
// environment defaults to 'development'
// redactionOptions defaults based on environment
```

Services extending `BaseService` get `this.obs` automatically (scoped to class name) — no manual instantiation needed in services.

### Logging Methods

```ts
obs.info('Content published', { contentId, creatorId });   // business events
obs.warn('Cache miss, falling back to DB', { key });        // recoverable issues
obs.error('Stripe webhook failed', { eventId });            // failures
obs.debug('Query executed', { table, duration });           // dev only (no-op in prod)
```

### Tracking Methods

```ts
obs.trackRequest({ url, method, duration, status, userAgent? });
obs.trackError(error, { url, method, userId, contentId });  // logs at 'error' level with stack
obs.setRequestId(id);  // set correlation ID — all subsequent logs include it
```

### Performance Methods

```ts
// perf() — warn if over threshold, debug otherwise
obs.perf('session-validation', durationMs, { threshold: 2000, metadata: { userId } });

// startTimer() — convenience wrapper
const timer = obs.startTimer('org-layout', { threshold: 3000 });
const org = await api.getOrg(slug);
const ms = timer.end({ slug }); // logs via perf(), returns ms
```

### Generic Event

```ts
obs.log({ level: 'info', message: 'Event', timestamp: new Date(), metadata?: {} });
```

## Request Timing (Hono Middleware)

```ts
import { createRequestTimer } from '@codex/observability';

app.use('*', async (c, next) => {
  const requestId = c.req.header('cf-ray') ?? crypto.randomUUID();
  obs.setRequestId(requestId);
  const timer = createRequestTimer(obs, c.req);
  await next();
  timer.end(c.res.status);
});
```

`trackRequestError(obs, error, request)` is a convenience wrapper for error handling in `app.onError`.

## Output Format

- **Development**: colorized human-readable lines to console (with ANSI colors, inline fields)
- **Production/test**: structured JSON to console (captured by `wrangler tail` / log aggregators)

```json
{
  "level": "info",
  "message": "Content published",
  "timestamp": "2026-02-14T12:00:00.000Z",
  "service": "ContentService",
  "environment": "production",
  "requestId": "abc123",
  "metadata": { "contentId": "uuid" }
}
```

## PII Redaction

Automatic on all logs — metadata is passed through `redactSensitiveData()` before output.

```ts
import { redactSensitiveData, redactSensitiveDataAsync, REDACTION_PRESETS } from '@codex/observability';

// Standalone use (when not using ObservabilityClient)
const safe = redactSensitiveData({ password: 'secret', email: 'user@example.com' });
// → { password: '[REDACTED]', email: 'user@example.com' } (standalone defaults: redactEmails=false, so emails pass through)
```

**Redaction config**:
- Dev: `mode: 'mask'` (`[REDACTED]`, or `first4...last4` when keepChars is set), emails NOT masked (`redactEmails: false` — emails stay visible in dev)
- Prod: `mode: 'hash'` (FNV-1a `hash:xxxxxxxx` in the sync path `ObservabilityClient` uses; SHA-256 `sha256:...` only via `redactSensitiveDataAsync`), emails redacted

`REDACTION_PRESETS` — predefined field patterns (credentials, contact, financial).

**Safe to log**: IDs (UUIDs), request metadata (method, URL path), status codes, timing
**Never log**: passwords, tokens, API keys, session IDs, full emails, payment data, full request/response bodies

## When to Use Which Method

| Situation | Method |
|---|---|
| HTTP request start/end | `createRequestTimer()` |
| Caught error (before re-throw) | `trackError(error, context)` |
| Business event (purchase, publish) | `info()` |
| Recoverable issue (retry, fallback) | `warn()` |
| Failure (external API down) | `error()` |
| Dev debugging (cache hit, query timing) | `debug()` (no-op in prod) |
| Performance measurement | `perf()` / `startTimer()` |

**Don't use `trackError()`** for expected business logic errors (not-found, forbidden) — those are normal flow, use `info()` or `warn()`.

## KV Operation Budget

A Worker cannot read its own account-wide KV quota counters, so `kv-budget.ts`
counts what the code path itself does and recognises a quota-shaped rejection
when KV returns one. It issues **zero** KV, DO or subrequest operations of its
own — counters are integers in a module-scope map keyed by binding name.

Already adopted once, in `packages/worker-utils/src/worker-factory.ts`, which
covers every worker built with `createWorker` (8 of the 9 in `workers/` — dev-cdn is a plain proxy) and every swallowing KV path (`VersionedCache`,
`createKVSecondaryStorage`, `cacheSessionInKV`, the rate limiter):

```typescript
app.use('*', createKvBudgetMiddleware({ obs }));
```

`withKvBudget(kv, { obs, binding })` wraps a single namespace in a transparent
`Proxy` (same type in, same type out); `instrumentKvBindings(env, { obs })`
returns a shallow copy of `env` with every KV-like `*_KV` value wrapped.

Two `signal` values to alert on:

| Signal | Level | Meaning |
|---|---|---|
| `kv_quota_exhausted` | `error` | A KV op was rejected 429/limit-shaped. Fires once per binding per isolate, at the moment exhaustion starts, even though the caller swallows the failure. The error is re-thrown unchanged. |
| `kv_write_budget` | `info` → `warn` → `error` | Rollup every N writes (default 25) with reads, writes, quotaFailures, otherFailures and `projectedDailyWrites`. |

**`projectedDailyWrites` is ONE isolate's rate extrapolated to a day, not the
account total** — the account total is the sum across every isolate of every
worker. It is therefore a LOWER BOUND: over the cap on one isolate means
definitely over the cap on the account, but under it proves nothing. Never
relabel it as an account-level figure.

`isKvQuotaError(error)` is exported so a fail-open path can distinguish quota
exhaustion (an account-wide capacity event) from a transient KV error. Both
fail open; they should not look identical in the logs.

## Strict Rules

- **MUST** use `ObservabilityClient` for ALL logging — NEVER use `console.log` directly
- **MUST** call `obs.setRequestId()` early in middleware for log correlation
- **NEVER** log PII — the client auto-redacts metadata but don't log raw request bodies
- **NEVER** duplicate error logging — `mapErrorToResponse()` already logs via `obs` if provided

## Reference Files

- `packages/observability/src/index.ts` — `ObservabilityClient`, `createRequestTimer`, `trackRequestError`, redaction exports
- `packages/observability/src/redact.ts` — `redactSensitiveData`, `REDACTION_PRESETS`
- `packages/observability/src/kv-budget.ts` — `createKvBudgetMiddleware`, `withKvBudget`, `instrumentKvBindings`, `isKvQuotaError`, `kvBudgetSnapshot`

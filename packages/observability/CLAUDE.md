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
// → { password: '***REDACTED***', email: 'u***@***.***' } (dev masking)
```

**Redaction config**:
- Dev: `mode: 'mask'` (asterisks, keep 4 chars), emails masked
- Prod: `mode: 'hash'` (SHA-256), emails redacted

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

## Strict Rules

- **MUST** use `ObservabilityClient` for ALL logging — NEVER use `console.log` directly
- **MUST** call `obs.setRequestId()` early in middleware for log correlation
- **NEVER** log PII — the client auto-redacts metadata but don't log raw request bodies
- **NEVER** duplicate error logging — `mapErrorToResponse()` already logs via `obs` if provided

## Reference Files

- `packages/observability/src/index.ts` — `ObservabilityClient`, `createRequestTimer`, `trackRequestError`, redaction exports
- `packages/observability/src/redact.ts` — `redactSensitiveData`, `REDACTION_PRESETS`

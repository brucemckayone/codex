---
name: observability-patterns
description: >
  Deep reference for structured logging in Codex — ObservabilityClient, log levels,
  PII redaction, request tracking, performance timing, and when to use which method.
type: reference
---

# Observability Patterns

Observability in Codex is enforced — `console.log` is forbidden by convention and
by lint. Every log goes through `ObservabilityClient` with structured fields,
automatic PII redaction, and correlation IDs.

Reference implementations:
- `packages/observability/CLAUDE.md` — authoritative rules
- `packages/observability/src/index.ts` — `ObservabilityClient`, timing helpers
- `packages/observability/src/redact.ts` — PII redaction
- `packages/service-errors/src/base-service.ts` — auto-initialized `this.obs`

---

## Why Structured Logging

Three things `console.log` can't do:

1. **Searchability** — "give me all logs for `userId: xxx` in the last hour" only works on structured JSON
2. **PII protection** — unstructured logs leak emails, tokens, session IDs to log aggregators
3. **Correlation** — tracing a single request across 3 workers needs shared `requestId` fields

`ObservabilityClient` emits JSON in production (captured by `wrangler tail` and
log aggregators) and human-readable colorized lines in development. Same API, two
outputs.

---

## Getting an ObservabilityClient

### In services (the common case)

`BaseService` creates one automatically in its constructor:

```typescript
export class ContentService extends BaseService {
  constructor(config: ServiceConfig) {
    super(config);
    // this.obs is already initialized, scoped to "ContentService"
  }

  async publish(id: string, userId: string) {
    this.obs.info('Content published', { contentId: id, userId });
  }
}
```

The `obs` is scoped to `this.constructor.name` — logs include `service:
"ContentService"` automatically.

### In workers (middleware)

```typescript
// Inside createWorker(), middleware sets obs on context:
app.use('*', async (c, next) => {
  const obs = new ObservabilityClient(workerName, c.env.ENVIRONMENT);
  const requestId = c.req.header('cf-ray') ?? crypto.randomUUID();
  obs.setRequestId(requestId);
  c.set('obs', obs);
  c.set('requestId', requestId);
  await next();
});
```

Inside a `procedure()` handler, `ctx.obs` is the same instance.

### In webhook handlers (bypass `procedure`)

Create manually:

```typescript
export async function handleCheckoutCompleted(event, stripe, c) {
  const obs = c.get('obs') as ObservabilityClient | undefined;
  obs?.info('Processing checkout completion', { sessionId: event.id });
  // ...
}
```

Use the optional chaining pattern (`obs?.`) — webhook paths can be called without
middleware in tests.

---

## Log Levels

```typescript
obs.debug('Cache lookup', { key, duration });     // dev only — no-op in prod
obs.info('Content published', { contentId });     // business events
obs.warn('Cache miss, falling back to DB', ...);  // recoverable issues
obs.error('Stripe webhook failed', { eventId });  // failures
```

**Decision tree:**

| Situation | Level | Why |
|-----------|-------|-----|
| Developer trace (cache hit/miss, query timing) | `debug` | High volume, only useful locally |
| Business event (user registered, content published, purchase completed) | `info` | Audit trail, dashboards, analytics |
| Recoverable issue (retry triggered, cache miss, fallback path) | `warn` | Signal but not alarming |
| External service failure, uncaught error, data corruption | `error` | Alert-worthy |

**Not** a level: user errors (404, 403). Those are normal business flow —
`mapErrorToResponse` handles them. Logging them as `error` drowns real alerts.

---

## Tracking Methods (Specialised Wrappers)

These produce structured events that downstream tools can aggregate.

### `trackRequest`

Emitted by `createRequestTimer` at request end — you usually don't call directly.

```typescript
const timer = createRequestTimer(obs, c.req);
await next();
timer.end(c.res.status);
// → emits { url, method, duration, status, userAgent }
```

### `trackError`

For caught errors (before re-throw or service recovery):

```typescript
try {
  await externalApi.call();
} catch (err) {
  obs.trackError(err, { url: c.req.url, userId, contentId });
  throw err;  // still re-throw — logging is not recovery
}
```

**Don't use `trackError`** for expected business errors (`NotFoundError`,
`ForbiddenError`). Those are normal — they get `info` at most, or no log at all.

### `perf` and `startTimer`

For performance measurement:

```typescript
const timer = obs.startTimer('org-layout-load', { threshold: 3000 });
const org = await api.getOrg(slug);
timer.end({ slug });
// → logs via perf(): warn if over threshold, debug otherwise
```

---

## Correlation IDs (requestId)

Every worker request has a `requestId` (from `cf-ray` or generated UUID). Set it
early via middleware:

```typescript
obs.setRequestId(requestId);
```

All subsequent logs include `requestId` in their output. This lets you trace one
request across services — including worker-to-worker calls, as long as you
propagate the header.

### Propagation across workers

```typescript
// In workerFetch caller:
await workerFetch(url, {
  method: 'POST',
  body: JSON.stringify(payload),
  headers: { 'X-Request-Id': requestId },
}, secret);

// In receiver middleware:
const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
obs.setRequestId(requestId);
```

This is worth it for any flow that spans multiple workers (content → media →
transcoding, for example).

---

## PII Redaction

Metadata is auto-redacted before output:

| Environment | Mode | Example |
|-------------|------|---------|
| Dev | `mask` — keep 4 chars, asterisks | `user@example.com` → `u***@***.***` |
| Prod | `hash` — SHA-256 | `user@example.com` → `sha256(...)` |

**The client redacts automatically if you log fields through `metadata`.** But
it can't save you from logging a raw request body with PII inside it.

### Safe to log

- IDs: `userId`, `contentId`, `organizationId`, `purchaseId`, `subscriptionId`
- Stripe IDs: `pi_*`, `cus_*`, `sub_*`, `evt_*`
- HTTP: method, URL path (not query if it has PII), status code
- Timing: duration, threshold
- Counts: items processed, cache hit rate

### Never log

- Passwords (plaintext OR hashed — hashes can be brute-forced)
- Session tokens, CSRF tokens, cookies
- API keys (Stripe, worker shared secret, external service keys)
- Email addresses (use `userId`)
- Full names, phone numbers, physical addresses
- Payment card data (PCI scope — don't even go near)
- Full request/response bodies (may contain above)

### Explicit redaction

For one-off cases where the client can't help:

```typescript
import { redactSensitiveData } from '@codex/observability';

const safe = redactSensitiveData({
  password: 'secret',
  email: 'user@example.com',
});
// → { password: '***REDACTED***', email: 'u***@***.***' } (dev)
```

---

## Output Formats

### Development

```
[2026-04-18T12:34:56.789Z] INFO  ContentService  Content published
  service=ContentService  requestId=abc123  contentId=uuid-here  userId=uuid-here
```

Colorized in terminal. Metadata inline, one log per line.

### Production / test

```json
{
  "level": "info",
  "message": "Content published",
  "timestamp": "2026-04-18T12:34:56.789Z",
  "service": "ContentService",
  "environment": "production",
  "requestId": "abc123",
  "metadata": { "contentId": "uuid", "userId": "uuid" }
}
```

Ingested by `wrangler tail`, Cloudflare dashboards, and external aggregators.

---

## Common Patterns

### Service method with logging

```typescript
async createContent(input: CreateContentInput, userId: string) {
  try {
    const content = await this.db.transaction(async (tx) => {
      const [c] = await tx.insert(schema.content).values({ ... }).returning();
      await tx.insert(schema.mediaItems).values({ contentId: c.id, ... });
      return c;
    });
    this.obs.info('Content created', { contentId: content.id, userId });
    return content;
  } catch (err) {
    this.handleError(err, 'createContent');  // re-throws
  }
}
```

Log on success (`info`). The error path uses `handleError` which will log via
`mapErrorToResponse` if unhandled.

### Fallback / retry

```typescript
try {
  return await this.fetchFromCache(key);
} catch (err) {
  this.obs.warn('Cache miss, falling back to DB', { key });
  return await this.fetchFromDB(key);
}
```

`warn` — not an error, just a non-happy path.

### External service call

```typescript
const timer = this.obs.startTimer('stripe-transfer', { threshold: 5000 });
try {
  const transfer = await this.stripe.transfers.create({ ... });
  this.obs.info('Transfer succeeded', {
    transferId: transfer.id,
    amount: transfer.amount,
  });
  return transfer;
} catch (err) {
  this.obs.trackError(err, { chargeId, destination });
  throw err;
} finally {
  timer.end({ destination });
}
```

---

## Anti-Patterns

| Anti-pattern | Why it breaks | Fix |
|--------------|---------------|-----|
| `console.log(...)` | No redaction, no correlation, caught by lint rule | `this.obs.info(...)` |
| `obs.info('User registered', { email })` | PII in logs (email) | Use `userId` |
| `obs.info('Request body', { body })` | Unredacted body possibly has password | Log specific fields only |
| `obs.error('Failed', err)` | Second arg should be metadata object, not raw error | `obs.trackError(err, context)` or `obs.error('Failed', { error: err.message })` |
| Logging caught-then-rethrown error twice | Double-noise in log aggregator | Log once at the point of catch OR rely on `mapErrorToResponse` |
| `obs.error('Not found', { id })` for 404 | Normal business flow, not alert-worthy | No log, or `info` |
| Missing `requestId` in middleware | Can't trace requests | Always call `obs.setRequestId()` early |
| Not propagating `X-Request-Id` in worker-to-worker | Loses correlation | Include header in `workerFetch` |
| Hand-rolling JSON.stringify for logs | Breaks structured fields | Pass metadata object, let client format |
| Over-logging in hot paths (loops, per-request trivia) | Log volume / cost | Use `debug` (no-op in prod) |
| Logging Stripe event at `info` level on every webhook | High-volume noise | `info` on first-processing, `debug` on duplicate |

---

## Debugging Observability

1. **Logs not appearing in prod** — `debug` is a no-op in prod. Check level. Also check `ENVIRONMENT` binding is set.
2. **Logs appearing but no `requestId`** — middleware not calling `setRequestId`. Order matters — set before your first log.
3. **Redacted fields showing raw value** — logged as `message`, not `metadata`. Redaction only touches the metadata object.
4. **Correlation broken across workers** — `X-Request-Id` not propagating. Check `workerFetch` call site.
5. **Log level inconsistent (some `info`, some `warn`)** — team norms drift. Use this doc's decision tree.
6. **Performance logs spamming warn** — threshold too low, or there's a real regression. Check `startTimer` threshold.
7. **Can't find errors in aggregator** — probably logged via `console.error`. Find and replace with `obs.error`.

---

## When to Re-Verify This Reference

Re-read this doc against current code if you see changes in:

- `packages/observability/src/index.ts` (the client)
- `packages/observability/src/redact.ts` (redaction config, presets)
- `packages/observability/CLAUDE.md` (rules)
- `packages/service-errors/src/base-service.ts` (auto-initialization)

Redaction config changes have security implications — review carefully if you see
new fields added/removed.

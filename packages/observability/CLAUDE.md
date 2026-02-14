# @codex/observability

Structured logging & metrics for Cloudflare Workers. PII redaction, request tracking, error correlation.

## API

### `ObservabilityClient`
Constructor: `new ObservabilityClient(serviceName, environment?, redactionOptions?)`

**Logging Methods**
- `info(message, metadata?)`: Info-level log.
- `warn(message, metadata?)`: Warning-level log.
- `error(message, metadata?)`: Error-level log.
- `debug(message, metadata?)`: Debug-level (dev only).
- `log(event: LogEvent)`: Generic event log (all levels route here).

**Tracking Methods**
- `trackRequest(metrics: RequestMetrics)`: Log HTTP request (url, method, duration, status, userAgent).
- `trackError(error: Error, context?: ErrorContext)`: Log error with stack/context.
- `setRequestId(id: string)`: Set correlation ID for log grouping.

### Helpers
- `createRequestTimer(obs, request)`: Returns timer with `.end(status)` method for request tracking.
- `trackRequestError(obs, error, request)`: Convenience wrapper for error tracking.

### Redaction
- `redactSensitiveData(data, options?)`: Sync PII redaction (passwords, tokens, emails, etc.).
- `redactSensitiveDataAsync(data, options?)`: Async variant.
- `REDACTION_PRESETS`: Predefined field patterns (credentials, contact, financial).

## Config
**Environment Modes**
- `development`: Mask PII (keep 4 chars), debug logs enabled, console output.
- `production`: Hash PII, debug logs disabled, structured JSON to stdout.

**Redaction Options**
- `mode`: `'mask'` (asterisks) or `'hash'` (SHA-256).
- `redactEmails`: Boolean (default: true in prod).
- `keepChars`: Number of chars to keep when masking (default: 4 in dev).

## Usage
```ts
// Service initialization
const obs = new ObservabilityClient('content-api', 'production');

// Request timing (Hono middleware)
app.use('*', async (c, next) => {
  const timer = createRequestTimer(obs, c.req);
  await next();
  timer.end(c.res.status);
});

// Error tracking
try {
  await service.createContent(input);
} catch (error) {
  obs.trackError(error, {
    url: c.req.url,
    method: c.req.method,
    userId: session.userId
  });
  throw error;
}

// Manual logging
obs.info('Content published', { contentId: '123', creatorId: 'abc' });
obs.debug('Cache hit', { key: 'org:slug' }); // Dev only
```

## Integration with BaseService
Services extending `BaseService` automatically get an `obs` instance (scoped to service name).

```ts
export class ContentService extends BaseService {
  async createContent(input: ContentInput) {
    this.obs.info('Creating content', { creatorId: input.creatorId });
    // ...
  }
}
```

## Output Format
All logs output as JSON to console (Cloudflare captures via `wrangler tail`):
```json
{
  "level": "info",
  "message": "Content published",
  "timestamp": "2026-02-14T12:00:00.000Z",
  "service": "content-api",
  "environment": "production",
  "requestId": "req-123",
  "metadata": { "contentId": "123" }
}
```

## Logging Patterns

### When to Log
**Request Tracking**
- Use `createRequestTimer()` in Hono middleware for automatic HTTP request logging.
- Tracks: URL, method, duration, status, user-agent.

**Error Logging**
- Use `trackError(error, context)` for all caught errors before re-throwing.
- Always include context: `{ url, method, userId, contentId }` etc.
- Never use `trackError()` for expected business logic errors (use `info()` or `warn()` instead).

**Business Events**
- Use `info()` for significant business events: content published, purchase completed, user registered.
- Use `warn()` for recoverable issues: retry succeeded, fallback used, deprecated API called.
- Use `debug()` for development troubleshooting: cache hits, query timing, state transitions.

**Avoid Logging**
- Don't log every database query (too noisy, use debug only if investigating).
- Don't log successful validation (only log failures).
- Don't duplicate error logs (worker already logs via `mapErrorToResponse`).

### PII Safety Rules
**Always Redact**
- Passwords, tokens, API keys, session IDs: Auto-redacted by `redactSensitiveData()`.
- Email addresses: Redacted in production (configurable via `redactEmails`).
- Credit card numbers, SSNs: Auto-detected and redacted.

**Safe to Log**
- User/content/organization IDs (UUIDs, not emails).
- Request metadata: method, URL path (not query params with tokens).
- Status codes, timing metrics, feature flags.

**Context Guidelines**
- Include IDs for correlation: `{ userId, contentId, orgId }`.
- Avoid including full request/response bodies (use sample or summary instead).
- When in doubt, redact. PII exposure is worse than missing context.

### Request Correlation
Set request ID early in middleware for log grouping:
```ts
app.use('*', async (c, next) => {
  const requestId = c.req.header('cf-ray') || crypto.randomUUID();
  obs.setRequestId(requestId);
  await next();
});
```

All subsequent logs in the request lifecycle will include this `requestId` for tracing.
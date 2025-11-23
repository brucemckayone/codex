# Observability Package

## Overview

The observability package provides cost-effective structured logging, request metrics, and error tracking for Codex workers and services. It enables consistent observability across the platform through the `ObservabilityClient` class while preventing credential leaks and PII exposure through built-in data redaction. The package logs to console (for Cloudflare Workers runtime) and is designed to integrate with external logging services (Axiom, Baselime, or custom solutions) via console interception.

## Public API

| Export | Type | Purpose |
|--------|------|---------|
| `ObservabilityClient` | Class | Core logging and metrics client for services and workers |
| `LogEvent` | Interface | Structured log event with level, message, timestamp, metadata |
| `RequestMetrics` | Interface | HTTP request metrics: URL, method, duration, status, user agent |
| `ErrorContext` | Interface | Context metadata for error tracking: stack, URL, method, user agent |
| `createRequestTimer` | Function | Middleware helper for measuring request duration |
| `trackRequestError` | Function | Helper for logging errors with request context |
| `redactSensitiveData` | Function | Sync data redaction (mask, remove modes) |
| `redactSensitiveDataAsync` | Function | Async data redaction (supports hash mode) |
| `RedactionOptions` | Interface | Configuration for data redaction behavior |
| `RedactionMode` | Type | Redaction mode: `'mask' \| 'hash' \| 'remove'` |
| `REDACTION_PRESETS` | Object | Predefined redaction configurations for common scenarios |

## Core Services/Utilities

### ObservabilityClient Class

Instantiates per service/worker. Provides logging, metrics, and error tracking with automatic PII redaction.

#### Constructor

```typescript
constructor(
  serviceName: string,
  environment?: string,
  redactionOptions?: RedactionOptions
): ObservabilityClient
```

**Parameters**:
- `serviceName` (string, required): Name identifying this service in logs (e.g., "content-service", "api-worker")
- `environment` (string, optional): Environment name ('development' or 'production', defaults to 'development'). Controls default redaction settings and debug logging
- `redactionOptions` (RedactionOptions, optional): Custom redaction behavior. Defaults based on environment

**Purpose**: Creates a client instance that logs structured events with automatic PII redaction. Development environment enables debug logging and shows partial secrets; production applies strict masking.

#### Public Methods

##### log(event: LogEvent): void

Logs a structured event after redacting sensitive metadata.

**Parameters**:
- `event`: LogEvent with `level`, `message`, `timestamp`, optional `metadata`

**Behavior**: Redacts sensitive fields in metadata, adds service name and environment, outputs JSON to appropriate console method (debug/info/warn/error)

**When to use**: For custom structured logging beyond standard methods (info, warn, error, debug)

**Example**:
```typescript
obs.log({
  level: 'warn',
  message: 'User login attempt with invalid credentials',
  timestamp: new Date(),
  metadata: {
    userId: '123',
    attempt: 3,
    ipAddress: '192.168.1.1'
  }
});
```

##### info(message: string, metadata?: Record<string, unknown>): void

Logs informational message.

**Parameters**:
- `message` (string, required): Log message
- `metadata` (object, optional): Structured data (automatically redacted)

**When to use**: Important application events (user login, resource created, operation completed)

**Example**:
```typescript
obs.info('User created successfully', { userId: '123', email: 'user@example.com' });
```

##### warn(message: string, metadata?: Record<string, unknown>): void

Logs warning message.

**When to use**: Potentially problematic situations (deprecated API usage, approaching rate limits, missing optional data)

**Example**:
```typescript
obs.warn('Rate limit approaching', { remaining: 10, limit: 100 });
```

##### error(message: string, metadata?: Record<string, unknown>): void

Logs error message.

**When to use**: Error conditions and exceptions

**Example**:
```typescript
obs.error('Database connection failed', { error: 'timeout' });
```

##### debug(message: string, metadata?: Record<string, unknown>): void

Logs debug message (development environment only).

**When to use**: Diagnostic information during development. Suppressed in production.

**Behavior**: Only logs when environment is 'development'

**Example**:
```typescript
obs.debug('User data loaded', { userId: '123', cacheHit: true });
```

##### trackRequest(metrics: RequestMetrics): void

Logs HTTP request metrics.

**Parameters**:
- `metrics`: Object containing `url`, `method`, `duration` (ms), optional `status`, optional `userAgent`

**Purpose**: Records request metrics for monitoring and debugging. Log level: info

**Example**:
```typescript
obs.trackRequest({
  url: '/api/users/123',
  method: 'GET',
  duration: 145,
  status: 200,
  userAgent: 'Mozilla/5.0...'
});
```

##### trackError(error: Error, context?: ErrorContext): void

Logs error with context metadata.

**Parameters**:
- `error` (Error, required): Error object with message and stack
- `context` (ErrorContext, optional): Additional context (url, method, user agent, custom fields)

**Purpose**: Records errors with request context for debugging and monitoring. Log level: error

**Behavior**: Extracts error.name, error.message, error.stack; merges with context metadata

**Example**:
```typescript
try {
  await someOperation();
} catch (error) {
  obs.trackError(error as Error, {
    url: c.req.url,
    method: c.req.method,
    userId: userId
  });
}
```

### Utility Functions

#### createRequestTimer(obs: ObservabilityClient, request: {...}): { end: (status?: number) => void }

Middleware helper for measuring request duration.

**Parameters**:
- `obs`: ObservabilityClient instance
- `request`: Object with `url`, `method`, optional `headers` with `get(key)` method

**Returns**: Timer object with `end(status?)` method

**Purpose**: Records precise request duration including all async operations. Call `end()` after request completes.

**Example (Hono middleware)**:
```typescript
app.use('*', async (c, next) => {
  const timer = createRequestTimer(obs, c.req);
  await next();
  timer.end(c.res.status);
});
```

#### trackRequestError(obs: ObservabilityClient, error: Error, request: {...}): void

Convenience wrapper for tracking errors with request context.

**Parameters**:
- `obs`: ObservabilityClient instance
- `error`: Error to log
- `request`: Object with `url`, `method`

**Purpose**: Shorter syntax for common error tracking pattern in request handlers

**Example (Hono error handler)**:
```typescript
app.onError((err, c) => {
  trackRequestError(obs, err, {
    url: c.req.url,
    method: c.req.method
  });
  return c.text('Internal Server Error', 500);
});
```

### Data Redaction Functions

#### redactSensitiveData(data: unknown, options?: RedactionOptions): unknown

Synchronously redacts sensitive data (PII, credentials, API keys) from objects and arrays.

**Parameters**:
- `data`: Any value (object, array, primitive)
- `options`: RedactionOptions with mode, customKeys, redactEmails, redactIPs, keepChars

**Returns**: Deep copy with sensitive values redacted

**Behavior**:
- Detects sensitive keys (password, token, apiKey, etc.) case-insensitively
- Detects sensitive patterns (Stripe keys, DB connection strings, Bearer tokens)
- Recursively processes nested objects and arrays
- Supports three redaction modes: 'mask' ([REDACTED]), 'remove' (omit field), 'hash' (SHA256, async only)
- Optionally redacts emails and IP addresses
- Can preserve first/last N characters for debugging

**When to use**: Sanitizing log metadata in workers/services. Use async version if hash mode needed.

**Example**:
```typescript
const data = {
  username: 'john',
  password: 'secret123',
  apiKey: 'sk_test_abc123',
  email: 'user@example.com'
};

const redacted = redactSensitiveData(data, {
  mode: 'mask',
  redactEmails: true,
  keepChars: 4
});
// Result: {username: 'john', password: 'sec...123', apiKey: 'sk_...c123', email: '[REDACTED]'}
```

#### redactSensitiveDataAsync(data: unknown, options?: RedactionOptions): Promise<unknown>

Asynchronously redacts sensitive data with support for hash mode.

**Parameters**: Same as sync version

**Returns**: Promise resolving to redacted copy

**Behavior**: For non-hash modes, delegates to sync function. For hash mode, generates SHA256 hashes of sensitive values.

**When to use**: When you need hash mode for PII correlation without storing actual values. Hash enables correlation across logs while remaining non-reversible.

**Example**:
```typescript
const redacted = await redactSensitiveDataAsync(logData, {
  mode: 'hash',
  redactEmails: true
});
// Sensitive values replaced with sha256:abc123def456...
```

## Usage Examples

### Basic Service Logging

```typescript
import { ObservabilityClient } from '@codex/observability';

class UserService {
  private obs: ObservabilityClient;

  constructor() {
    this.obs = new ObservabilityClient('user-service', 'production');
  }

  async createUser(email: string, name: string): Promise<void> {
    this.obs.info('Creating new user', { email });

    try {
      // Create user logic
      this.obs.info('User created successfully', {
        userId: '123',
        email // Will be automatically redacted in logs
      });
    } catch (error) {
      this.obs.trackError(error as Error, {
        email,
        operation: 'createUser'
      });
      throw error;
    }
  }
}
```

### Worker with Request Tracking

```typescript
import { Hono } from 'hono';
import { ObservabilityClient, createRequestTimer } from '@codex/observability';

const app = new Hono();
const obs = new ObservabilityClient('api-worker', 'production');

// Request timing middleware
app.use('*', async (c, next) => {
  const timer = createRequestTimer(obs, c.req);
  await next();
  timer.end(c.res.status);
});

// Error handler
app.onError((err, c) => {
  obs.trackError(err, {
    url: c.req.url,
    method: c.req.method
  });
  return c.text('Internal Server Error', 500);
});

// Route handler
app.post('/api/users', async (c) => {
  const body = await c.req.json();

  obs.info('User creation request received', {
    email: body.email,
    source: c.req.header('user-agent')
  });

  try {
    // Create user
    obs.info('User created', { userId: '123', email: body.email });
    return c.json({ id: '123' }, 201);
  } catch (error) {
    obs.trackError(error as Error, { email: body.email });
    return c.text('Failed to create user', 400);
  }
});
```

### Data Redaction in Logs

```typescript
import { redactSensitiveData, REDACTION_PRESETS } from '@codex/observability';

const logData = {
  userId: 'user-456',
  email: 'john@example.com',
  password: 'secret123',
  creditCard: '4111-1111-1111-1111',
  apiKey: 'sk_live_xyz789',
  normalField: 'visible'
};

// Development: mask with partial reveal
const devRedacted = redactSensitiveData(logData, REDACTION_PRESETS.development);
// {userId: 'user-456', email: 'john@example.com', password: 'secr...3', creditCard: '4111...1111', apiKey: 'sk_l...z789', normalField: 'visible'}

// Production: strict masking
const prodRedacted = redactSensitiveData(logData, REDACTION_PRESETS.production);
// {userId: 'user-456', email: '[REDACTED]', password: '[REDACTED]', creditCard: '[REDACTED]', apiKey: '[REDACTED]', normalField: 'visible'}

// GDPR: remove all PII
const gdprRedacted = redactSensitiveData(logData, REDACTION_PRESETS.gdpr);
// {userId: 'user-456', normalField: 'visible'}
```

### Error Handling with Context

```typescript
import { ObservabilityClient } from '@codex/observability';

const obs = new ObservabilityClient('payment-service', 'production');

async function processPayment(userId: string, amount: number): Promise<void> {
  try {
    // Payment processing logic
    obs.info('Payment processed', { userId, amount });
  } catch (error) {
    if (error instanceof Error && error.message.includes('insufficient')) {
      obs.warn('Payment failed: insufficient funds', { userId, amount });
    } else {
      obs.trackError(error as Error, {
        userId,
        amount,
        operation: 'processPayment',
        timestamp: new Date().toISOString()
      });
    }
    throw error;
  }
}
```

## Integration Points

### Dependencies

This package has **zero dependencies** (other than Node.js/Cloudflare Workers runtime).

### Used By

| Package/Worker | How It's Used | Purpose |
|----------------|--------------|---------|
| `@codex/access` | Content access service instantiates ObservabilityClient | Logging access operations, tracking errors |
| `@codex/worker-utils` | Middleware chain creates client | Request timing, error tracking in all workers |
| `stripe-webhook-handler` | Worker imports ObservabilityClient type | Typing webhook handlers for observability |
| All workers/services | Direct instantiation | Logging, metrics, error tracking |

### Data Flow

```
Application Code
      │
      ├─→ obs.info(message, metadata)
      │    └─→ metadata redacted with RedactionOptions
      │         └─→ JSON logged to console
      │
      ├─→ obs.trackRequest(metrics)
      │    └─→ Logged as info-level event
      │
      ├─→ createRequestTimer(obs, request)
      │    └─→ timer.end(status)
      │         └─→ Request metrics logged
      │
      └─→ obs.trackError(error, context)
           └─→ Error logged as error-level event
```

## Log Levels

| Level | Use Case | Development | Production |
|-------|----------|-------------|-----------|
| **debug** | Diagnostic information, function entry/exit | Logged | Suppressed |
| **info** | Normal application events (user login, operation completed) | Logged | Logged |
| **warn** | Potential issues (deprecated usage, rate limit approach) | Logged | Logged |
| **error** | Error conditions, exceptions, failures | Logged | Logged |

## Structured Data

All logging methods accept optional `metadata` object containing structured data relevant to the event.

**Automatic Redaction**: Sensitive fields in metadata are automatically redacted based on:

1. **Sensitive Keys** (case-insensitive): password, token, apiKey, api_key, secret, authorization, cookie, session, csrf, stripe_*, database_url, databaseUrl, etc.

2. **Sensitive Patterns**:
   - Stripe keys: `sk_live_*`, `sk_test_*`, `pk_live_*`, `pk_test_*`
   - Database URLs: `postgres://user:pass@...`, `mysql://user:pass@...`
   - Bearer tokens: `Bearer [token]`
   - Random long strings (likely secrets)

3. **Optional Email Redaction**: When `redactEmails: true`, replaces all email addresses

**Example**:
```typescript
obs.info('User authenticated', {
  userId: '123',        // preserved
  email: 'john@ex.com', // redacted if redactEmails enabled
  password: 'secret',   // always redacted
  country: 'US'         // preserved
});
```

## Redaction Modes

| Mode | Behavior | Use Case | Supports Async |
|------|----------|----------|---|
| **mask** | Replace with `[REDACTED]` or `prefix...suffix` if keepChars set | Quick redaction, visible secrets in dev | Yes (sync) |
| **remove** | Omit field entirely from object | GDPR compliance, strict privacy | Yes (sync) |
| **hash** | Replace with `sha256:abc123...` | PII correlation without storing values | Yes (async only) |

### Redaction Presets

```typescript
REDACTION_PRESETS.development
// { mode: 'mask', redactEmails: false, redactIPs: false, keepChars: 4 }

REDACTION_PRESETS.production
// { mode: 'hash', redactEmails: true, redactIPs: false }

REDACTION_PRESETS.gdpr
// { mode: 'remove', redactEmails: true, redactIPs: true }
```

## Development vs Production

| Aspect | Development | Production |
|--------|-------------|-----------|
| Debug logging | Enabled (logs debug messages) | Disabled (debug calls ignored) |
| Default redaction mode | `mask` with `keepChars: 4` | `hash` (async) |
| Email redaction | Disabled (emails visible) | Enabled |
| Output | JSON to console | JSON to console (intercepted by Cloudflare) |

**Configuration**:
```typescript
// Development
const obs = new ObservabilityClient('service', 'development');
obs.debug('detailed info'); // Logs

// Production
const obs = new ObservabilityClient('service', 'production');
obs.debug('detailed info'); // Ignored
```

## Performance Notes

### Logging Overhead
- Synchronous for all log levels except async redaction
- Minimal allocation: single JSON.stringify per log call
- No background threads or async processing in critical path

### Redaction Performance
- **Sync redaction**: O(n) traversal of data structure
- **Async redaction (hash mode)**: Uses crypto.subtle.digest (browser/worker native, optimized)
- **Recommended**: Use sync redaction in hot paths, async for batch/background jobs

### Optimization Strategies

**Avoid Redacting Large Objects**:
```typescript
// Bad: redacting large nested object
obs.info('Processing', { largeData: hugeObject });

// Good: redact only relevant fields
obs.info('Processing', { dataId: hugeObject.id });
```

**Use Conditional Debug Logging**:
```typescript
// Only construct debug message if debug enabled
if (obs.environment === 'development') {
  obs.debug('Detailed info', { data });
}
```

**Batch Redaction**:
```typescript
// Redact once, use multiple times
const safe = redactSensitiveData(rawData, REDACTION_PRESETS.production);
obs.info('Step 1', safe);
obs.info('Step 2', safe);
```

## Testing

### Unit Testing Logging Behavior

**Using Vitest**:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { ObservabilityClient } from '@codex/observability';

describe('MyService', () => {
  it('should log user creation', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const obs = new ObservabilityClient('test-service', 'test');
    obs.info('User created', { userId: '123' });

    expect(consoleSpy).toHaveBeenCalled();
    const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(logged.message).toBe('User created');
    expect(logged.metadata.userId).toBe('123');

    vi.restoreAllMocks();
  });

  it('should redact sensitive data', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const obs = new ObservabilityClient('test-service', 'production');
    obs.info('Login', { email: 'user@ex.com', password: 'secret' });

    const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(logged.metadata.password).toBe('[REDACTED]');
    expect(logged.metadata.email).toBe('[REDACTED]');
  });
});
```

### Testing Request Timing

```typescript
it('should track request duration', () => {
  const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

  const obs = new ObservabilityClient('test-service');
  const timer = createRequestTimer(obs, {
    url: '/api/test',
    method: 'GET',
    headers: { get: () => null }
  });

  timer.end(200);

  const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
  expect(logged.metadata.duration).toBeGreaterThanOrEqual(0);
  expect(logged.metadata.status).toBe(200);
});
```

### Testing Error Tracking

```typescript
it('should track errors with context', () => {
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  const obs = new ObservabilityClient('test-service');
  const error = new Error('Something failed');

  obs.trackError(error, { userId: '123' });

  const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
  expect(logged.message).toBe('Something failed');
  expect(logged.metadata.name).toBe('Error');
  expect(logged.metadata.stack).toBeDefined();
  expect(logged.metadata.userId).toBe('123');
});
```

### Testing Redaction

```typescript
it('should redact sensitive data', () => {
  const data = {
    username: 'john',
    password: 'secret123',
    email: 'john@example.com'
  };

  const redacted = redactSensitiveData(data, {
    mode: 'mask',
    redactEmails: true
  });

  expect(redacted.username).toBe('john');
  expect(redacted.password).toBe('[REDACTED]');
  expect(redacted.email).toBe('[REDACTED]');
});

it('should support remove mode', () => {
  const data = {
    username: 'john',
    password: 'secret'
  };

  const redacted = redactSensitiveData(data, { mode: 'remove' });

  expect(redacted).toEqual({ username: 'john' });
  expect(redacted).not.toHaveProperty('password');
});
```

### Mocking Observability in Tests

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ObservabilityClient } from '@codex/observability';

describe('MyService with mocked observability', () => {
  let mockObs: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockObs = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trackRequest: vi.fn(),
      trackError: vi.fn()
    } as unknown as ObservabilityClient;
  });

  it('should call observability on important events', async () => {
    const service = new MyService(mockObs as ObservabilityClient);
    await service.doSomething();

    expect(mockObs.info).toHaveBeenCalledWith(
      'Operation completed',
      expect.any(Object)
    );
  });
});
```

## OpenTelemetry Integration (Future)

This package is designed for future OpenTelemetry integration:

1. **Console interception**: Cloudflare Workers and SvelteKit can intercept console output to send to OTEL exporters
2. **Structured JSON**: Log format is JSON-friendly for parsing by tracing systems
3. **Request correlation**: Middleware helpers support adding trace/span IDs to metadata
4. **Service identification**: Service name enables filtering by service in distributed tracing

**Future enhancement pattern**:
```typescript
// Would support automatic span creation and correlation
const obs = new ObservabilityClient('service', 'production', {
  otelExporter: axiomExporter,
  traceIdField: 'traceId'
});
```

## Error Handling

This package does **not throw custom errors**. It handles all errors gracefully:

- **Null/undefined values**: Passed through unchanged
- **Serialization errors**: Caught and logged without throwing
- **Redaction errors**: Falls back to [REDACTED] marker

If redaction or logging itself fails, the underlying error is suppressed to prevent cascading failures.

---

**File Location**: `/Users/brucemckay/development/Codex/packages/observability/`

**Key Files**:
- `src/index.ts` - ObservabilityClient, LogEvent, RequestMetrics, ErrorContext, createRequestTimer, trackRequestError
- `src/redact.ts` - Data redaction functions and presets
- `src/__tests__/observability-client.test.ts` - Client usage examples
- `src/__tests__/redact.test.ts` - Redaction behavior tests

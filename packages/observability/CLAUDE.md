# @codex/observability Package

**Status**: Complete - Observability and structured logging for Codex platform
**Version**: 0.1.0
**Last Updated**: 2025-12-14

## Overview

@codex/observability provides cost-effective structured logging, request metrics, and error tracking for Cloudflare Workers and services across the Codex platform. The package's core value is preventing credential leaks through built-in PII/secret redaction while maintaining observability. All logs output structured JSON to console (intercepted by Cloudflare for aggregation), making it compatible with external logging services (Axiom, Baselime, datadog, etc.). The package is self-contained with zero dependencies and designed to be extended as the platform grows.

**Key responsibilities**:
- Structured logging with log levels (debug, info, warn, error)
- HTTP request metrics tracking (duration, status, user agent)
- Error tracking with contextual information
- Automatic sensitive data redaction (credentials, PII, API keys)
- Request timing helpers for middleware integration
- Multiple redaction modes and presets (development, production, GDPR)

**Why it exists**: Prevent credential/PII leaks in logs while enabling effective debugging and monitoring across all workers and services.

---

## Public API

| Export | Type | Purpose |
|--------|------|---------|
| `ObservabilityClient` | Class | Core logging and metrics client, instantiated per service/worker |
| `LogEvent` | Interface | Structured log event with level, message, timestamp, metadata |
| `RequestMetrics` | Interface | HTTP request metrics: url, method, duration, status, userAgent |
| `ErrorContext` | Interface | Additional context for error logging: stack, url, method, userAgent, custom fields |
| `createRequestTimer` | Function | Middleware helper measuring request duration from start to end |
| `trackRequestError` | Function | Convenience wrapper for logging errors with request context |
| `redactSensitiveData` | Function | Synchronous data redaction (mask, remove modes only) |
| `redactSensitiveDataAsync` | Function | Asynchronous data redaction with hash mode support |
| `RedactionOptions` | Interface | Configuration for redaction behavior: mode, customKeys, redactEmails, redactIPs, keepChars |
| `RedactionMode` | Type | Redaction mode union: `'mask' \| 'hash' \| 'remove'` |
| `REDACTION_PRESETS` | Object | Three predefined configurations: development, production, gdpr |

---

## Core Services/Utilities

### ObservabilityClient Class

Main logging client. Instantiate once per service/worker. Automatically applies configured redaction to all metadata.

#### Constructor

```typescript
constructor(
  serviceName: string,
  environment?: string,
  redactionOptions?: RedactionOptions
): ObservabilityClient
```

**Parameters**:
- `serviceName` (string, required): Service identifier in all logs (e.g., "content-service", "api-worker", "payment-worker"). Used for filtering logs by service.
- `environment` (string, optional): Environment name. Either `'development'` or `'production'` (defaults to `'development'`). Controls default redaction strictness and enables/disables debug logging.
- `redactionOptions` (RedactionOptions, optional): Custom redaction settings. If not provided, defaults are applied based on environment: dev uses mask mode with partial reveal, prod uses strict masking.

**Purpose**: Creates logger instance with consistent behavior across service lifetime. All subsequent logging calls apply configured redaction automatically.

**Example**:
```typescript
// Service logger
const obs = new ObservabilityClient('content-service', 'production');

// Worker logger
const obs = new ObservabilityClient('api-worker', process.env.ENVIRONMENT);

// Custom redaction config
const obs = new ObservabilityClient('auth-service', 'production', {
  mode: 'mask',
  redactEmails: true,
  customKeys: ['internalSessionId'],
  keepChars: 2 // Only show first/last 2 chars
});
```

#### Instance Methods

##### log(event: LogEvent): void

Logs a structured event after redacting sensitive metadata.

**Signature**:
```typescript
log(event: LogEvent): void
```

**Parameters**:
- `event` (LogEvent): Object with `level`, `message`, `timestamp`, optional `metadata`

**Behavior**:
1. Redacts sensitive fields in metadata using configured RedactionOptions
2. Adds service name and environment to log entry
3. Outputs JSON string to console method matching log level (console.debug, console.info, console.warn, console.error)

**When to use**: When you need custom structured logging beyond the standard convenience methods (info, warn, error, debug). Rarely used directly; use convenience methods instead.

**Returns**: void (synchronous)

**Example**:
```typescript
obs.log({
  level: 'warn',
  message: 'User login failed after 3 attempts',
  timestamp: new Date(),
  metadata: {
    userId: 'user-123',
    email: 'john@example.com',  // Will be redacted in production
    attempt: 3,
    ipAddress: '192.168.1.100'
  }
});
// Logs: {"level":"warn","message":"User login failed after 3 attempts","timestamp":"2025-12-14T...","service":"auth-service","environment":"production","metadata":{"userId":"user-123","email":"[REDACTED]","attempt":3,"ipAddress":"192.168.1.100"}}
```

##### info(message: string, metadata?: Record<string, unknown>): void

Logs informational message at info level.

**Signature**:
```typescript
info(message: string, metadata?: Record<string, unknown>): void
```

**Parameters**:
- `message` (string, required): Log message describing the event
- `metadata` (object, optional): Structured data accompanying the message. All sensitive fields automatically redacted.

**When to use**: Important application events that indicate successful operations or state changes (user created, content published, payment processed, session established).

**Returns**: void (synchronous)

**Example**:
```typescript
obs.info('User created successfully', {
  userId: 'user-456',
  email: 'newuser@example.com'  // Redacted automatically
});

obs.info('Content published', {
  contentId: 'content-789',
  title: 'My First Video',
  status: 'published'
});

obs.info('Purchase recorded', {
  purchaseId: 'purch-123',
  amount: 9999,
  stripePaymentId: 'pi_abc123def456'  // Redacted
});
```

##### warn(message: string, metadata?: Record<string, unknown>): void

Logs warning message at warn level.

**Signature**:
```typescript
warn(message: string, metadata?: Record<string, unknown>): void
```

**Parameters**:
- `message` (string, required): Warning description
- `metadata` (object, optional): Context data (automatically redacted)

**When to use**: Potentially problematic situations that don't prevent operation completion (deprecated API usage, approaching rate limits, retry attempts, missing optional data, unusual patterns).

**Returns**: void (synchronous)

**Example**:
```typescript
obs.warn('Rate limit approaching', {
  endpoint: '/api/content',
  remaining: 5,
  limit: 100
});

obs.warn('Retry attempt', {
  operation: 'database-query',
  attempt: 2,
  maxAttempts: 3
});

obs.warn('Missing optional field', {
  contentId: 'content-123',
  missingField: 'description'
});
```

##### error(message: string, metadata?: Record<string, unknown>): void

Logs error message at error level.

**Signature**:
```typescript
error(message: string, metadata?: Record<string, unknown>): void
```

**Parameters**:
- `message` (string, required): Error description
- `metadata` (object, optional): Context data (automatically redacted)

**When to use**: Application errors and exceptional conditions (operation failed, validation error, external service unavailable).

**Returns**: void (synchronous)

**Example**:
```typescript
obs.error('Database connection failed', {
  error: 'connection timeout',
  database: 'neon-prod',
  duration: 5000
});

obs.error('Content upload failed', {
  contentId: 'content-123',
  reason: 'file too large',
  fileSize: 2147483648
});
```

##### debug(message: string, metadata?: Record<string, unknown>): void

Logs debug message at debug level (development environment only).

**Signature**:
```typescript
debug(message: string, metadata?: Record<string, unknown>): void
```

**Parameters**:
- `message` (string, required): Debug message
- `metadata` (object, optional): Detailed debugging data (automatically redacted)

**Behavior**: Logs are only emitted when environment is `'development'`. Calls in production are silently ignored (no-op).

**When to use**: Detailed diagnostic information for debugging during development (function entry/exit, variable values, state transitions, cache hits).

**Returns**: void (synchronous)

**Example**:
```typescript
// Development: logged and visible
obs.debug('Loading user from cache', { userId: 'user-123', cacheHit: true });

// Production: ignored silently
obs.debug('Processing video chunk', { chunkIndex: 5, totalChunks: 100 });
```

##### trackRequest(metrics: RequestMetrics): void

Logs HTTP request metrics.

**Signature**:
```typescript
trackRequest(metrics: RequestMetrics): void
```

**Parameters**:
- `metrics` (RequestMetrics): Object containing:
  - `url` (string, required): Request URL/path (e.g., '/api/content')
  - `method` (string, required): HTTP method (GET, POST, PUT, DELETE, etc.)
  - `duration` (number, required): Request duration in milliseconds
  - `status` (number, optional): HTTP response status code
  - `userAgent` (string, optional): User-Agent header value

**Log Level**: info

**Purpose**: Records HTTP request metrics for monitoring request patterns, latency, and error rates.

**Returns**: void (synchronous)

**Example**:
```typescript
obs.trackRequest({
  url: '/api/content',
  method: 'POST',
  duration: 145,
  status: 201,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
});

obs.trackRequest({
  url: '/api/content/123',
  method: 'GET',
  duration: 47,
  status: 200
});

// Error case
obs.trackRequest({
  url: '/api/content',
  method: 'POST',
  duration: 250,
  status: 500
});
```

##### trackError(error: Error, context?: ErrorContext): void

Logs error with additional context metadata.

**Signature**:
```typescript
trackError(error: Error, context?: ErrorContext): void
```

**Parameters**:
- `error` (Error, required): Error object with `name` and `message` properties. Stack trace extracted if available.
- `context` (ErrorContext, optional): Additional context metadata (automatically redacted):
  - `stack` (string): Error stack trace
  - `url` (string): Request URL where error occurred
  - `method` (string): HTTP method
  - `userAgent` (string): Client user agent
  - `[key: string]` (unknown): Custom context fields

**Log Level**: error

**Purpose**: Records errors with full context for debugging and monitoring. Extracts error.name, error.message, error.stack; merges with context.

**Returns**: void (synchronous)

**Example**:
```typescript
try {
  await contentService.create(input);
} catch (error) {
  obs.trackError(error as Error, {
    url: c.req.url,
    method: c.req.method,
    operation: 'createContent',
    userId: userId
  });
  throw error;
}

// In middleware error handler
app.onError((err, c) => {
  obs.trackError(err as Error, {
    url: c.req.url,
    method: c.req.method,
    status: 500
  });
  return c.text('Internal Server Error', 500);
});
```

### Utility Functions

#### createRequestTimer(obs: ObservabilityClient, request: {...}): { end: (status?: number) => void }

Middleware helper for measuring request duration from start to completion.

**Signature**:
```typescript
createRequestTimer(
  obs: ObservabilityClient,
  request: {
    url: string;
    method: string;
    headers?: { get: (key: string) => string | null };
  }
): {
  end: (status?: number) => void;
}
```

**Parameters**:
- `obs` (ObservabilityClient): Logger instance
- `request`: Object with:
  - `url` (string, required): Request URL
  - `method` (string, required): HTTP method
  - `headers` (optional): Object with `get(key)` method to retrieve header values (used to extract user-agent)

**Returns**: Object with `end(status?)` method to record completion

**Purpose**: Creates a timer that measures elapsed time from instantiation to `end()` call. Records precise request duration including all async operations.

**When to use**: In middleware that wraps request handlers to track overall request time.

**Example (Hono middleware)**:
```typescript
app.use('*', async (c, next) => {
  const timer = createRequestTimer(obs, c.req);

  await next();

  timer.end(c.res.status);
});
```

**Detailed example**:
```typescript
const timer = createRequestTimer(obs, {
  url: c.req.url,
  method: c.req.method,
  headers: {
    get: (key: string) => c.req.header(key) || null
  }
});

// ... async work happens ...

timer.end(200); // Records: duration=XX, url=/api/..., method=POST, status=200
```

#### trackRequestError(obs: ObservabilityClient, error: Error, request: {...}): void

Convenience wrapper for tracking errors with request context.

**Signature**:
```typescript
trackRequestError(
  obs: ObservabilityClient,
  error: Error,
  request: { url: string; method: string }
): void
```

**Parameters**:
- `obs` (ObservabilityClient): Logger instance
- `error` (Error): Error to log
- `request`: Object with `url` and `method`

**Returns**: void (synchronous)

**Purpose**: Shorter syntax for common error logging pattern in request error handlers. Equivalent to calling `obs.trackError(error, { url, method })`.

**When to use**: In request error handlers to log errors with request context.

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

**Signature**:
```typescript
redactSensitiveData(
  data: unknown,
  options?: RedactionOptions
): unknown
```

**Parameters**:
- `data`: Any value (object, array, primitive). Processed recursively.
- `options` (RedactionOptions, optional): Configuration:
  - `mode` ('mask' | 'hash' | 'remove'): Redaction strategy (default: 'mask')
  - `customKeys` (string[]): Additional field names to redact
  - `redactEmails` (boolean): Whether to redact email addresses (default: false)
  - `redactIPs` (boolean): Whether to redact IP addresses (default: false)
  - `keepChars` (number): Show first/last N characters instead of full redaction

**Returns**: Deep copy with sensitive values redacted

**Behavior**:

1. **Detects sensitive keys** (case-insensitive): password, token, apiKey, api_key, secret, authorization, cookie, session, sessionId, session_id, csrf, csrfToken, stripe_*, database_url, databaseUrl, etc.

2. **Detects sensitive patterns** in values:
   - Stripe keys: `sk_live_*`, `sk_test_*`, `pk_live_*`, `pk_test_*`, `rk_live_*`
   - Database URLs: `postgres://user:pass@...`, `mysql://user:pass@...`
   - Bearer tokens: `Bearer [token]`
   - Long random strings (32+ chars, likely secrets)

3. **Redaction modes**:
   - `'mask'`: Replace with `[REDACTED]` or `prefix...suffix` if keepChars set
   - `'remove'`: Omit field entirely from objects
   - `'hash'`: (Not supported in sync - use async version)

4. **Recursively processes** nested objects and arrays

5. **Optional email redaction**: Detects and redacts email addresses if `redactEmails: true`

**When to use**: Sanitizing log metadata in workers/services. Synchronous, no await needed.

**Returns immediately** (synchronous, no async I/O)

**Example**:
```typescript
const logData = {
  username: 'john',
  password: 'secret123',
  apiKey: 'sk_test_abc123',
  email: 'user@example.com',
  country: 'US'
};

// Development: mask with partial reveal
const dev = redactSensitiveData(logData, {
  mode: 'mask',
  redactEmails: false,
  keepChars: 4
});
// Result: {username: 'john', password: 'secr...3', apiKey: 'sk_t...c123', email: 'user@example.com', country: 'US'}

// Production: strict masking
const prod = redactSensitiveData(logData, {
  mode: 'mask',
  redactEmails: true
});
// Result: {username: 'john', password: '[REDACTED]', apiKey: '[REDACTED]', email: '[REDACTED]', country: 'US'}

// GDPR: remove PII entirely
const gdpr = redactSensitiveData(logData, {
  mode: 'remove',
  redactEmails: true
});
// Result: {username: 'john', country: 'US'}
```

**Advanced example with custom keys**:
```typescript
const data = {
  userId: 'user-123',
  internalSessionId: 'sess_abc123',
  publicField: 'visible'
};

const redacted = redactSensitiveData(data, {
  mode: 'mask',
  customKeys: ['internalSessionId']
});
// Result: {userId: 'user-123', internalSessionId: '[REDACTED]', publicField: 'visible'}
```

#### redactSensitiveDataAsync(data: unknown, options?: RedactionOptions): Promise<unknown>

Asynchronously redacts sensitive data with support for hash mode.

**Signature**:
```typescript
async redactSensitiveDataAsync(
  data: unknown,
  options?: RedactionOptions
): Promise<unknown>
```

**Parameters**: Same as sync version

**Returns**: Promise resolving to redacted copy

**Behavior**:
- For non-hash modes, delegates to sync `redactSensitiveData()`
- For hash mode, generates SHA256 hashes of sensitive values using Web Crypto API
- Returns hashes in format: `sha256:abc123def456...` (first 16 chars of hex)

**When to use**: When you need hash mode for non-reversible PII correlation. Hash enables finding related entries across logs without storing actual PII values.

**Example**:
```typescript
const logData = {
  userId: 'user-456',
  email: 'john@example.com',
  password: 'secret123'
};

// Hash mode: non-reversible but correlatable
const hashed = await redactSensitiveDataAsync(logData, {
  mode: 'hash',
  redactEmails: true
});
// Result: {userId: 'user-456', email: 'sha256:a1b2c3d4e5f6...', password: 'sha256:f9e8d7c6b5a4...'}

// Same email always hashes to same value
const hashed2 = await redactSensitiveDataAsync(
  { email: 'john@example.com' },
  { mode: 'hash', redactEmails: true }
);
// Same hash as before, enabling correlation
```

### Redaction Presets

#### REDACTION_PRESETS

Pre-configured redaction option sets for common scenarios.

**Value**:
```typescript
{
  development: {
    mode: 'mask',
    redactEmails: false,
    redactIPs: false,
    keepChars: 4
  },

  production: {
    mode: 'hash',
    redactEmails: true,
    redactIPs: false
  },

  gdpr: {
    mode: 'remove',
    redactEmails: true,
    redactIPs: true
  }
}
```

**Use**:
```typescript
import { REDACTION_PRESETS, redactSensitiveData } from '@codex/observability';

const dev = redactSensitiveData(data, REDACTION_PRESETS.development);
const prod = redactSensitiveData(data, REDACTION_PRESETS.production);
const gdpr = redactSensitiveData(data, REDACTION_PRESETS.gdpr);
```

**Preset descriptions**:

| Preset | Mode | Emails | IPs | Purpose |
|--------|------|--------|-----|---------|
| `development` | mask with keepChars:4 | Visible | Visible | Local development - partial reveal for debugging |
| `production` | hash | Redacted | Visible | Production - non-reversible PII, traceable correlation |
| `gdpr` | remove | Removed | Removed | GDPR compliance - no PII in logs |

---

## Usage Examples

### Basic Service Logging

```typescript
import { ObservabilityClient } from '@codex/observability';

class UserService {
  private obs: ObservabilityClient;

  constructor() {
    this.obs = new ObservabilityClient(
      'user-service',
      process.env.ENVIRONMENT || 'development'
    );
  }

  async createUser(email: string, password: string, name: string): Promise<User> {
    this.obs.info('Creating new user', { email, name });

    try {
      // Create user in database
      const user = await this.db.users.create({ email, password, name });

      this.obs.info('User created successfully', {
        userId: user.id,
        email: user.email  // Automatically redacted in logs
      });

      return user;
    } catch (error) {
      this.obs.trackError(error as Error, {
        email,
        operation: 'createUser'
      });
      throw error;
    }
  }

  async authenticateUser(email: string, password: string): Promise<Session> {
    try {
      const user = await this.db.users.findByEmail(email);
      if (!user) {
        this.obs.warn('Login attempt with non-existent email', { email });
        throw new Error('Invalid credentials');
      }

      const isValid = await this.verifyPassword(password, user.passwordHash);
      if (!isValid) {
        this.obs.warn('Login attempt with wrong password', {
          email,
          userId: user.id
        });
        throw new Error('Invalid credentials');
      }

      const session = await this.createSession(user.id);
      this.obs.info('User authenticated', {
        userId: user.id,
        email: user.email
      });

      return session;
    } catch (error) {
      this.obs.trackError(error as Error, { email });
      throw error;
    }
  }
}
```

### Worker with Request Tracking Middleware

```typescript
import { Hono } from 'hono';
import {
  ObservabilityClient,
  createRequestTimer,
  trackRequestError
} from '@codex/observability';

const app = new Hono();
const obs = new ObservabilityClient('content-api', process.env.ENVIRONMENT);

// Request timing middleware
app.use('*', async (c, next) => {
  const timer = createRequestTimer(obs, c.req);

  try {
    await next();
  } finally {
    timer.end(c.res.status);
  }
});

// Error handler
app.onError((err, c) => {
  trackRequestError(obs, err, {
    url: c.req.url,
    method: c.req.method
  });

  return c.json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred'
  }, 500);
});

// Example routes
app.post('/api/content', async (c) => {
  const body = await c.req.json();

  obs.info('Content creation request received', {
    contentType: body.type,
    title: body.title,
    creatorId: c.var.user?.id
  });

  try {
    const service = new ContentService(c.env.DB);
    const content = await service.create(body, c.var.user.id);

    obs.info('Content created successfully', {
      contentId: content.id,
      title: content.title,
      creatorId: c.var.user.id
    });

    return c.json({ data: content }, 201);
  } catch (error) {
    obs.trackError(error as Error, {
      userId: c.var.user?.id,
      operation: 'createContent'
    });
    throw error;
  }
});

app.get('/api/content/:id', async (c) => {
  const contentId = c.req.param('id');

  obs.debug('Fetching content', { contentId });

  try {
    const service = new ContentService(c.env.DB);
    const content = await service.get(contentId, c.var.user?.id);

    obs.debug('Content fetched', { contentId, cached: false });

    return c.json({ data: content });
  } catch (error) {
    obs.trackError(error as Error, {
      contentId,
      userId: c.var.user?.id
    });
    throw error;
  }
});

export default app;
```

### Data Redaction in Logs

```typescript
import {
  redactSensitiveData,
  redactSensitiveDataAsync,
  REDACTION_PRESETS
} from '@codex/observability';

// Synchronous redaction with different modes
const rawData = {
  username: 'john',
  email: 'john@example.com',
  password: 'mySecretPassword',
  creditCard: '4111-1111-1111-1111',
  apiKey: 'sk_live_xyz789abc123',
  normalField: 'This is public data'
};

// Development mode: mask with partial reveal
const devMode = redactSensitiveData(rawData, REDACTION_PRESETS.development);
console.log(devMode);
// {
//   username: 'john',
//   email: 'john@example.com',  // Not redacted in dev
//   password: 'myS...word',      // First/last 4 chars visible
//   creditCard: '411...1111',
//   apiKey: 'sk_l...c123',
//   normalField: 'This is public data'
// }

// Production mode: hash
const prodMode = await redactSensitiveDataAsync(rawData, REDACTION_PRESETS.production);
console.log(prodMode);
// {
//   username: 'john',
//   email: 'sha256:abc123def456...',
//   password: 'sha256:f9e8d7c6b5a4...',
//   creditCard: 'sha256:d1c2b3a4e5f6...',
//   apiKey: 'sha256:123abc456def...',
//   normalField: 'This is public data'
// }

// GDPR compliance: remove all PII
const gdprMode = redactSensitiveData(rawData, REDACTION_PRESETS.gdpr);
console.log(gdprMode);
// {
//   username: 'john',
//   normalField: 'This is public data'
// }
```

### Error Handling with Context

```typescript
import { ObservabilityClient } from '@codex/observability';

const obs = new ObservabilityClient('payment-service', 'production');

async function processPayment(
  userId: string,
  contentId: string,
  amount: number
): Promise<void> {
  obs.info('Processing payment', {
    userId,
    contentId,
    amount
  });

  try {
    // Stripe charge creation
    const result = await stripe.charges.create({
      amount,
      currency: 'usd',
      customer: userId,
      description: `Purchase of content ${contentId}`
    });

    obs.info('Payment successful', {
      userId,
      contentId,
      amount,
      stripeChargeId: result.id  // Will be redacted
    });

  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('insufficient')) {
        obs.warn('Payment failed: insufficient funds', {
          userId,
          contentId,
          amount
        });
      } else if (error.message.includes('declined')) {
        obs.warn('Payment failed: card declined', {
          userId,
          contentId
        });
      } else {
        obs.trackError(error, {
          userId,
          contentId,
          amount,
          operation: 'processPayment'
        });
      }
    }
    throw error;
  }
}
```

### Nested Object Redaction

```typescript
import { redactSensitiveData } from '@codex/observability';

const webhookPayload = {
  type: 'charge.succeeded',
  data: {
    object: {
      id: 'ch_1234567890',
      customer: 'cus_abc123',
      amount: 9999,
      currency: 'usd',
      status: 'succeeded'
    }
  },
  account: 'acct_stripe_account_id'  // API key pattern
};

const redacted = redactSensitiveData(webhookPayload);
// Redacts: account (sensitive pattern), nested Stripe IDs are preserved as they're not credentials
```

---

## Integration Points

### Dependencies

**Zero external dependencies**. Package only depends on:
- JavaScript/TypeScript runtime (Node.js 18+, Cloudflare Workers)
- Web Crypto API (for hash mode in redaction)
- Native console object

### Used By

| Package/Worker | How It's Used | Purpose |
|---|---|---|
| `@codex/worker-utils` | Imported in middleware | Creating logger instance for workers |
| `@codex/access` | Direct instantiation | Logging access control operations |
| `ecom-api` worker | Direct instantiation | Logging webhook events and payment processing |
| All workers | Direct instantiation | Request timing, error tracking |
| All services (optional) | Direct instantiation | Operation logging within services |

### Data Flow

```
┌─────────────────────────────┐
│ Service/Worker Code         │
│  obs.info(msg, metadata)    │
│  obs.trackError(err, ctx)   │
└────────────┬────────────────┘
             │
             ├──→ redactSensitiveData(metadata)
             │       └──→ Detect sensitive keys/patterns
             │       └──→ Apply redaction mode
             │       └──→ Recursively process nested objects
             │
             └──→ JSON.stringify(logEntry)
                  └──→ console[level]()
                       └──→ Cloudflare Workers runtime intercepts
                            └──→ Aggregated to external logging service
```

### Middleware Integration Pattern

```typescript
// In worker setup
const obs = new ObservabilityClient('my-worker', env.ENVIRONMENT);

// Request timing middleware
app.use('*', async (c, next) => {
  const timer = createRequestTimer(obs, c.req);
  await next();
  timer.end(c.res.status);
});

// Error handler
app.onError((err, c) => {
  trackRequestError(obs, err, {
    url: c.req.url,
    method: c.req.method
  });
  return c.text('Error', 500);
});
```

---

## Log Levels and Behavior

| Level | Use Case | Dev | Prod | Severity |
|-------|----------|-----|------|----------|
| **debug** | Diagnostic info, function entry/exit, variable values, cache hits | Logged | Ignored | Low |
| **info** | Normal operations, user actions, successful completions | Logged | Logged | Medium |
| **warn** | Unusual but handled situations, deprecated usage, approaching limits | Logged | Logged | Medium-High |
| **error** | Failures, exceptions, unrecoverable errors | Logged | Logged | High |

**Output format**: All logs are JSON strings, one per line, suitable for streaming to log aggregation services.

---

## Redaction Security Model

### Sensitive Keys (Detected)

**Authentication & Secrets**: password, secret, token, apiKey, api_key, authorization, auth, cookie, session, sessionId, session_id, csrf, csrfToken

**Database**: database_url, databaseUrl, DATABASE_URL, db_url, connectionString, connection_string

**Payment**: stripe_signature, stripeSignature, stripe_key, stripeKey, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, card_number, cardNumber, cvv, cvc, card_cvc

**Personal**: ssn, social_security, socialSecurity, passport, driverLicense, driver_license, creditCard, credit_card

**Infrastructure**: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, NEON_API_KEY

### Sensitive Patterns (Detected in Values)

- Stripe keys: `sk_live_*`, `sk_test_*`, `pk_live_*`, `pk_test_*`, `rk_live_*`
- Database URLs: `postgres://user:pass@...`, `mysql://user:pass@...`
- Bearer tokens: `Bearer [token]`
- Random long strings (32+ chars)
- Emails (if `redactEmails: true`)

### Custom Sensitive Keys

Pass additional keys to redact:
```typescript
const redacted = redactSensitiveData(data, {
  customKeys: ['internalSessionId', 'legacyApiKey']
});
```

---

## Performance Notes

### Logging Overhead

- **All log methods**: Synchronous (no blocking async I/O)
- **Memory allocation**: Single JSON.stringify per log call
- **CPU cost**: Low - simple key iteration and string replacement
- **No background processing**: All operations inline in request handler

### Redaction Performance

| Operation | Complexity | Speed |
|-----------|-----------|-------|
| Sync redaction (mask/remove) | O(n) depth-first traversal | < 1ms for typical objects |
| Async redaction (hash) | O(n) + crypto operations | 10-50ms depending on data size |
| Pattern matching | O(n keys * m patterns) | < 1ms for typical objects |

### Optimization Strategies

**1. Avoid redacting large objects**:
```typescript
// Bad
obs.info('Large data', { largeObject: huge });

// Good
obs.info('Large data', { objectId: huge.id, size: huge.length });
```

**2. Conditional debug logging**:
```typescript
// Bad: constructs message even if not logged
obs.debug('State:', { allState: stateObject });

// Good: only in development
if (process.env.ENVIRONMENT === 'development') {
  obs.debug('State:', { allState: stateObject });
}
```

**3. Batch redaction**:
```typescript
// Redact once, reuse
const safe = redactSensitiveData(data, REDACTION_PRESETS.production);
obs.info('Step 1', safe);
obs.info('Step 2', safe);
```

**4. Use appropriate redaction mode**:
```typescript
// Mask mode: faster, good for development
const dev = redactSensitiveData(data, { mode: 'mask' });

// Hash mode: slower but better for production, use async
const prod = await redactSensitiveDataAsync(data, { mode: 'hash' });
```

---

## Testing

### Unit Testing Logging

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObservabilityClient, redactSensitiveData } from '@codex/observability';

describe('MyService with ObservabilityClient', () => {
  let consoleSpy: {
    info: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {})
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should log user creation', () => {
    const obs = new ObservabilityClient('test-service');
    obs.info('User created', { userId: '123', email: 'user@ex.com' });

    expect(consoleSpy.info).toHaveBeenCalledOnce();

    const logged = JSON.parse(consoleSpy.info.mock.calls[0][0] as string);
    expect(logged.message).toBe('User created');
    expect(logged.metadata.userId).toBe('123');
    expect(logged.level).toBe('info');
  });

  it('should redact sensitive fields', () => {
    const obs = new ObservabilityClient('test-service', 'production');
    obs.info('Login', {
      email: 'user@ex.com',
      password: 'secret',
      userId: '123'
    });

    const logged = JSON.parse(consoleSpy.info.mock.calls[0][0] as string);
    expect(logged.metadata.password).toBe('[REDACTED]');
    expect(logged.metadata.email).toBe('[REDACTED]');
    expect(logged.metadata.userId).toBe('123');
  });

  it('should only log debug in development', () => {
    const dev = new ObservabilityClient('dev-service', 'development');
    const prod = new ObservabilityClient('prod-service', 'production');

    dev.debug('dev message');
    prod.debug('prod message');

    // Only dev debug should be logged
    expect(consoleSpy.debug).toHaveBeenCalledOnce();
  });
});
```

### Testing Redaction

```typescript
import { describe, it, expect } from 'vitest';
import {
  redactSensitiveData,
  REDACTION_PRESETS
} from '@codex/observability';

describe('Data Redaction', () => {
  it('should redact sensitive keys', () => {
    const data = {
      username: 'john',
      password: 'secret123',
      apiKey: 'sk_test_abc123'
    };

    const redacted = redactSensitiveData(data);

    expect(redacted.username).toBe('john');
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.apiKey).toBe('[REDACTED]');
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

  it('should redact nested objects', () => {
    const data = {
      user: {
        name: 'John',
        credentials: {
          password: 'secret',
          apiKey: 'key123'
        }
      }
    };

    const redacted = redactSensitiveData(data);

    expect(redacted.user.name).toBe('John');
    expect(redacted.user.credentials.password).toBe('[REDACTED]');
    expect(redacted.user.credentials.apiKey).toBe('[REDACTED]');
  });

  it('should redact arrays', () => {
    const data = [
      { id: 1, password: 'pass1' },
      { id: 2, password: 'pass2' }
    ];

    const redacted = redactSensitiveData(data);

    expect(redacted[0].id).toBe(1);
    expect(redacted[0].password).toBe('[REDACTED]');
    expect(redacted[1].password).toBe('[REDACTED]');
  });

  it('should support keepChars option', () => {
    const data = { apiKey: 'sk_test_1234567890' };

    const redacted = redactSensitiveData(data, {
      mode: 'mask',
      keepChars: 4
    });

    expect(redacted.apiKey).toBe('sk_t...7890');
  });

  it('should support custom sensitive keys', () => {
    const data = {
      internalId: '123',
      customSecret: 'secret'
    };

    const redacted = redactSensitiveData(data, {
      customKeys: ['customSecret', 'internalId']
    });

    expect(redacted).toEqual({
      internalId: '[REDACTED]',
      customSecret: '[REDACTED]'
    });
  });

  it('should use presets', () => {
    const data = {
      username: 'john',
      email: 'john@ex.com',
      password: 'secret'
    };

    const dev = redactSensitiveData(data, REDACTION_PRESETS.development);
    const prod = redactSensitiveData(data, REDACTION_PRESETS.production);
    const gdpr = redactSensitiveData(data, REDACTION_PRESETS.gdpr);

    // Dev: mask with keepChars, visible emails
    expect(dev.password).toMatch(/\.\.\./);
    expect(dev.email).toBe('john@ex.com');

    // Prod: mask emails
    expect(prod.password).toBe('[REDACTED]');
    expect(prod.email).toBe('[REDACTED]');

    // GDPR: remove PII fields
    expect(gdpr).toEqual({ username: 'john' });
  });
});
```

### Testing Request Timing

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequestTimer, ObservabilityClient } from '@codex/observability';

describe('Request Timing', () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should measure request duration', () => {
    const obs = new ObservabilityClient('timer-service');
    const timer = createRequestTimer(obs, {
      url: '/api/test',
      method: 'GET',
      headers: { get: () => null }
    });

    // Simulate work
    const start = Date.now();
    while (Date.now() - start < 10) {} // Busy wait ~10ms

    timer.end(200);

    const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(logged.metadata.duration).toBeGreaterThanOrEqual(10);
    expect(logged.metadata.url).toBe('/api/test');
    expect(logged.metadata.method).toBe('GET');
    expect(logged.metadata.status).toBe(200);
  });

  it('should capture user agent from headers', () => {
    const obs = new ObservabilityClient('timer-service');
    const timer = createRequestTimer(obs, {
      url: '/api/test',
      method: 'POST',
      headers: {
        get: (key: string) =>
          key === 'user-agent' ? 'Mozilla/5.0...' : null
      }
    });

    timer.end(201);

    const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(logged.metadata.userAgent).toBe('Mozilla/5.0...');
  });
});
```

### Mocking Observability in Tests

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ObservabilityClient } from '@codex/observability';

describe('MyService with mocked observability', () => {
  let mockObs: Partial<ObservabilityClient>;

  beforeEach(() => {
    mockObs = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trackRequest: vi.fn(),
      trackError: vi.fn(),
      log: vi.fn()
    };
  });

  it('should call info on successful operation', async () => {
    const service = new MyService(mockObs as ObservabilityClient);
    await service.doSomething();

    expect(mockObs.info).toHaveBeenCalledWith(
      expect.stringContaining('success'),
      expect.any(Object)
    );
  });

  it('should track errors with context', async () => {
    const service = new MyService(mockObs as ObservabilityClient);

    try {
      await service.failingOperation();
    } catch (e) {
      // Expected
    }

    expect(mockObs.trackError).toHaveBeenCalled();
    const [error, context] = mockObs.trackError.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(context).toHaveProperty('operation');
  });
});
```

---

## Development vs Production Behavior

| Aspect | Development | Production |
|--------|-------------|-----------|
| **Debug logging** | Enabled - all debug() calls logged | Disabled - debug() calls ignored (no-op) |
| **Default redaction** | mask with keepChars:4 - partial reveal | strict masking - full redaction |
| **Email redaction** | Disabled - emails visible | Enabled - all emails redacted |
| **Output destination** | console (visible in terminal) | console (intercepted by Cloudflare) |
| **Log volume** | High - debug logs included | Medium - only info/warn/error |

**Configuration**:
```typescript
// Development: verbose, partial redaction
const devObs = new ObservabilityClient(
  'my-service',
  'development'
  // Uses default: mask mode, keepChars:4, emails visible
);

// Production: strict redaction, no debug logs
const prodObs = new ObservabilityClient(
  'my-service',
  'production'
  // Uses default: hash mode, emails redacted
);

// Custom configuration
const customObs = new ObservabilityClient('my-service', 'production', {
  mode: 'mask',
  redactEmails: false,
  keepChars: 2
});
```

---

## Future Enhancements

### OpenTelemetry Integration (Planned)

Current design supports future OTEL integration:

1. **Console interception**: Cloudflare Workers can intercept console output
2. **Structured JSON**: Log format is parser-friendly
3. **Service identification**: Service name enables tracing by service
4. **Request correlation**: Metadata supports trace IDs and span IDs

**Future API (example)**:
```typescript
const obs = new ObservabilityClient('service', 'production', {
  otelExporter: axiomExporter,
  traceIdHeader: 'x-trace-id'
});
```

### External Service Integration (Planned)

Support for sending logs directly to:
- Axiom (current Codex choice)
- Baselime
- Datadog
- Custom endpoints

---

## Error Handling

This package **does not throw custom errors**. All errors are handled gracefully:

- **Null/undefined values**: Passed through unchanged
- **Serialization errors**: Caught and logged without throwing
- **Redaction errors**: Falls back to [REDACTED] marker
- **Crypto errors**: Fallback to mask mode if hash fails

If logging itself fails, the underlying error is suppressed to prevent cascading failures in application code.

---

## Key Files

| File | Purpose |
|------|---------|
| `/src/index.ts` | ObservabilityClient, LogEvent, RequestMetrics, ErrorContext, createRequestTimer, trackRequestError exports |
| `/src/redact.ts` | Redaction functions, SENSITIVE_KEYS, SENSITIVE_PATTERNS, REDACTION_PRESETS |
| `/src/__tests__/observability-client.test.ts` | Client logging behavior tests |
| `/src/__tests__/redact.test.ts` | Redaction function tests with various modes and edge cases |

---

## Summary

@codex/observability is the observability layer for Codex. It provides:

- **Simple API**: Single `ObservabilityClient` class with straightforward methods
- **Automatic security**: Sensitive data redacted from all logs by default
- **Flexible redaction**: Multiple modes (mask, hash, remove) and presets (dev, prod, GDPR)
- **Zero overhead**: Synchronous, minimal allocation, no background processing
- **Middleware friendly**: Helper functions integrate easily with Hono and other frameworks
- **Extensible**: Console-based output can be intercepted by Cloudflare for external services

Use it in every worker and service to maintain consistent, secure, observable logging across the platform.

---

**Location**: `/Users/brucemckay/development/Codex/packages/observability/`

**Package**: @codex/observability
**Version**: 0.1.0
**Environment**: Cloudflare Workers + Node.js 18+
**Dependencies**: None (self-contained)

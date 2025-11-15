# @codex/observability

Simple, cost-effective observability for Cloudflare Workers and SvelteKit applications with built-in PII redaction and privacy compliance.

## Overview

This package provides structured logging, request metrics, error tracking, and sensitive data redaction for the Codex platform. It's designed to work seamlessly with Cloudflare Workers and can be extended with external observability services like Axiom or Baselime.

## Features

### 🔍 Observability
- **Structured Logging** - JSON logs with levels (debug, info, warn, error)
- **Request Metrics** - Track duration, status codes, user agents
- **Error Tracking** - Capture errors with context and stack traces
- **Request Timing** - Middleware helpers for automatic timing

### 🔒 Privacy & Security
- **Automatic PII Redaction** - Strip sensitive data from logs
- **GDPR Compliance** - Built-in presets for privacy regulations
- **Configurable Redaction** - Multiple modes (mask, hash, remove)
- **Pattern Detection** - Automatically detect secrets, tokens, API keys

### 🎯 Developer Experience
- **Environment-Aware** - Different behavior for dev/staging/production
- **Zero Dependencies** - No external packages required
- **Hono Middleware** - First-class support for Hono framework
- **Type-Safe** - Full TypeScript support

## Installation

This package is available in the monorepo workspace:

```json
{
  "dependencies": {
    "@codex/observability": "workspace:*"
  }
}
```

## Quick Start

### Basic Logging

```typescript
import { ObservabilityClient } from '@codex/observability';

const obs = new ObservabilityClient('my-service', 'production');

// Simple logging
obs.info('Service started', { version: '1.0.0' });
obs.warn('Cache miss', { key: 'user:123' });
obs.error('Database connection failed', { host: 'db.example.com' });

// Debug logging (only in development)
obs.debug('Processing request', { userId: '123' });
```

### Request Tracking in Hono

```typescript
import { Hono } from 'hono';
import { ObservabilityClient, createRequestTimer } from '@codex/observability';

const app = new Hono();
const obs = new ObservabilityClient('my-api', 'production');

// Track request timing
app.use('*', async (c, next) => {
  const timer = createRequestTimer(obs, c.req);
  await next();
  timer.end(c.res.status);
});

// Error tracking
app.onError((err, c) => {
  obs.trackError(err, {
    url: c.req.url,
    method: c.req.method,
    userAgent: c.req.header('user-agent'),
  });
  return c.text('Internal Server Error', 500);
});
```

### Using with Worker Utils

```typescript
import { createWorker } from '@codex/worker-utils';

// Worker factory automatically sets up observability
const app = createWorker({
  serviceName: 'my-api',
  enableLogging: true,
});

// Observability client available in all handlers
app.get('/api/data', (c) => {
  const obs = c.get('obs');
  obs.info('Fetching data', { userId: c.get('user')?.id });
  return c.json({ data: [] });
});
```

## API Reference

### `ObservabilityClient`

Creates an observability client for logging and tracking.

```typescript
constructor(
  serviceName: string,
  environment?: 'development' | 'staging' | 'production',
  redactionOptions?: RedactionOptions
)
```

**Parameters:**
- `serviceName` - Service identifier (e.g., 'content-api', 'auth-worker')
- `environment` - Runtime environment (default: 'development')
- `redactionOptions` - Custom redaction configuration (optional)

**Methods:**

#### `log(event: LogEvent): void`

Low-level logging method.

```typescript
obs.log({
  level: 'info',
  message: 'User logged in',
  timestamp: new Date(),
  metadata: { userId: '123', method: 'email' },
});
```

#### `info(message: string, metadata?: Record<string, unknown>): void`

Info-level logging.

```typescript
obs.info('Payment processed', {
  amount: 9.99,
  currency: 'USD',
  customerId: 'cus_123',
});
```

#### `warn(message: string, metadata?: Record<string, unknown>): void`

Warning-level logging.

```typescript
obs.warn('Rate limit approaching', {
  current: 90,
  limit: 100,
  endpoint: '/api/data',
});
```

#### `error(message: string, metadata?: Record<string, unknown>): void`

Error-level logging.

```typescript
obs.error('Failed to process webhook', {
  webhookId: 'wh_123',
  error: 'Invalid signature',
});
```

#### `debug(message: string, metadata?: Record<string, unknown>): void`

Debug-level logging (only in development).

```typescript
obs.debug('Cache lookup', {
  key: 'user:123',
  hit: true,
  ttl: 3600,
});
```

#### `trackRequest(metrics: RequestMetrics): void`

Track HTTP request metrics.

```typescript
obs.trackRequest({
  url: '/api/content',
  method: 'POST',
  duration: 145, // milliseconds
  status: 201,
  userAgent: 'Mozilla/5.0...',
});
```

#### `trackError(error: Error, context?: ErrorContext): void`

Track errors with additional context.

```typescript
try {
  await processPayment(data);
} catch (error) {
  obs.trackError(error as Error, {
    userId: data.userId,
    amount: data.amount,
    url: c.req.url,
    method: c.req.method,
  });
  throw error;
}
```

### Helper Functions

#### `createRequestTimer(obs: ObservabilityClient, request: Request)`

Creates a timer for tracking request duration.

```typescript
const timer = createRequestTimer(obs, c.req);
await processRequest();
timer.end(200); // Logs request metrics
```

#### `trackRequestError(obs: ObservabilityClient, error: Error, request: Request)`

Helper for tracking request errors.

```typescript
app.onError((err, c) => {
  trackRequestError(obs, err, c.req);
  return c.text('Error', 500);
});
```

## Sensitive Data Redaction

### Overview

The observability client automatically redacts sensitive data from logs to prevent credential leaks and ensure privacy compliance.

### What Gets Redacted

**Sensitive Keys:**
- Passwords, secrets, tokens, API keys
- Database URLs and connection strings
- Stripe keys and webhook signatures
- Session IDs, CSRF tokens, cookies
- Personal information (SSN, passport, credit cards)

**Sensitive Patterns:**
- Stripe API keys (`sk_live_*`, `pk_test_*`, etc.)
- Database connection strings with credentials
- Bearer tokens
- Long random strings (likely secrets)
- Email addresses (optional)

### Redaction Modes

```typescript
import { ObservabilityClient, REDACTION_PRESETS } from '@codex/observability';

// Production: Hash sensitive data (allows correlation)
const obs = new ObservabilityClient('my-service', 'production', {
  mode: 'hash',
  redactEmails: true,
});

// Development: Mask secrets but show partial values
const obs = new ObservabilityClient('my-service', 'development', {
  mode: 'mask',
  keepChars: 4, // Show first/last 4 chars
  redactEmails: false,
});

// GDPR: Remove all PII
const obs = new ObservabilityClient('my-service', 'production', {
  mode: 'remove',
  redactEmails: true,
  redactIPs: true,
});
```

### Redaction Presets

```typescript
import { REDACTION_PRESETS } from '@codex/observability';

// Production logging
REDACTION_PRESETS.production
// { mode: 'hash', redactEmails: true, redactIPs: false }

// Development logging
REDACTION_PRESETS.development
// { mode: 'mask', redactEmails: false, keepChars: 4 }

// GDPR compliant
REDACTION_PRESETS.gdpr
// { mode: 'remove', redactEmails: true, redactIPs: true }
```

### Manual Redaction

```typescript
import { redactSensitiveData, redactSensitiveDataAsync } from '@codex/observability';

// Synchronous redaction (mask/remove only)
const safeData = redactSensitiveData(
  {
    user: 'john@example.com',
    password: 'secret123',
    apiKey: 'sk_live_abc123',
  },
  {
    mode: 'mask',
    keepChars: 4,
  }
);
// {
//   user: 'john...com',
//   password: '[REDACTED]',
//   apiKey: 'sk_l...c123'
// }

// Async redaction (supports hash mode)
const hashedData = await redactSensitiveDataAsync(
  { apiKey: 'sk_live_abc123' },
  { mode: 'hash' }
);
// { apiKey: 'sha256:a1b2c3d4e5f6...' }
```

### Custom Sensitive Keys

```typescript
const obs = new ObservabilityClient('my-service', 'production', {
  customKeys: ['internalId', 'companySecret', 'apiToken'],
  mode: 'mask',
});

obs.info('Processing', {
  internalId: 'secret123', // Will be redacted
  publicId: 'abc',        // Not redacted
});
```

## Examples

### Complete Worker Setup

```typescript
import { Hono } from 'hono';
import { ObservabilityClient, createRequestTimer } from '@codex/observability';
import { ContentService } from './services/content-service';

type Bindings = {
  ENVIRONMENT: string;
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

// Initialize observability
app.use('*', async (c, next) => {
  const obs = new ObservabilityClient(
    'content-api',
    c.env.ENVIRONMENT as 'development' | 'production'
  );

  // Make available in context
  c.set('obs', obs);

  // Track request timing
  const timer = createRequestTimer(obs, c.req);
  await next();
  timer.end(c.res.status);
});

// Business logic
app.post('/api/content', async (c) => {
  const obs = c.get('obs');
  const body = await c.req.json();

  obs.info('Creating content', {
    type: body.type,
    userId: c.get('user')?.id,
  });

  try {
    const service = new ContentService(c.env.DB);
    const result = await service.create(body, c.get('user').id);

    obs.info('Content created', {
      contentId: result.id,
      type: result.type,
    });

    return c.json({ data: result }, 201);
  } catch (error) {
    obs.trackError(error as Error, {
      url: c.req.url,
      method: c.req.method,
      userId: c.get('user')?.id,
    });

    return c.json({ error: 'Failed to create content' }, 500);
  }
});

export default app;
```

### Stripe Webhook Handler

```typescript
import { ObservabilityClient } from '@codex/observability';
import Stripe from 'stripe';

const obs = new ObservabilityClient('stripe-webhook', 'production', {
  mode: 'hash',
  redactEmails: true,
  customKeys: ['stripe_signature'], // Additional sensitive keys
});

app.post('/webhook', async (c) => {
  const signature = c.req.header('stripe-signature');
  const body = await c.req.text();

  try {
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      c.env.STRIPE_WEBHOOK_SECRET
    );

    obs.info('Webhook received', {
      type: event.type,
      id: event.id,
      livemode: event.livemode,
    });

    await handleWebhook(event);

    return c.json({ received: true });
  } catch (error) {
    obs.trackError(error as Error, {
      url: c.req.url,
      hasSignature: !!signature,
      // Stripe signature is automatically redacted
    });

    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});
```

### Service Layer Integration

```typescript
import { ObservabilityClient } from '@codex/observability';

export class ContentService {
  private obs: ObservabilityClient;

  constructor(private db: D1Database, environment: string = 'development') {
    this.obs = new ObservabilityClient('content-service', environment);
  }

  async create(data: CreateContentInput, userId: string) {
    this.obs.debug('Creating content', { userId, type: data.type });

    try {
      const result = await this.db
        .insert(content)
        .values({ ...data, userId })
        .returning();

      this.obs.info('Content created successfully', {
        contentId: result.id,
        type: result.type,
      });

      return result;
    } catch (error) {
      this.obs.trackError(error as Error, {
        operation: 'content.create',
        userId,
        type: data.type,
      });
      throw error;
    }
  }

  async get(id: string, userId: string) {
    this.obs.debug('Fetching content', { id, userId });

    const result = await this.db
      .select()
      .from(content)
      .where(eq(content.id, id));

    if (!result) {
      this.obs.warn('Content not found', { id, userId });
      throw new NotFoundError('Content not found');
    }

    return result;
  }
}
```

## Log Output Format

All logs are structured JSON with consistent fields:

```json
{
  "level": "info",
  "message": "Request processed",
  "timestamp": "2024-11-15T12:00:00.000Z",
  "service": "content-api",
  "environment": "production",
  "metadata": {
    "url": "/api/content",
    "method": "POST",
    "duration": 145,
    "status": 201,
    "userAgent": "Mozilla/5.0..."
  }
}
```

## Environment-Specific Behavior

### Development
- Debug logs enabled
- Secrets masked with partial visibility (keepChars: 4)
- Emails not redacted
- Console output for easy debugging

### Production
- Debug logs disabled
- Secrets hashed for correlation
- Emails redacted
- Structured JSON for external services

## Future Integrations

This package is designed to be extended with external observability services:

### Axiom (Recommended)
- **Free tier**: 500GB/month
- **Perfect for**: Structured logging and metrics
- **Integration**: Add Axiom client in `log()` method

```typescript
// Future implementation
export class ObservabilityClient {
  private axiom?: AxiomClient;

  log(event: LogEvent) {
    // Current console logging
    console.log(JSON.stringify(event));

    // Future: Send to Axiom
    if (this.axiom && this.environment === 'production') {
      this.axiom.ingest('logs', [event]);
    }
  }
}
```

### Baselime
- **Serverless-first** observability
- **Perfect for**: Cloudflare Workers monitoring
- **Integration**: Use Baselime SDK alongside this package

### Cloudflare Analytics Engine
- **Native** Cloudflare integration
- **Perfect for**: Request metrics and KPIs
- **Integration**: Use alongside this package for metrics

```typescript
// Future implementation
trackRequest(metrics: RequestMetrics) {
  this.log({ ... });

  // Send to Analytics Engine
  if (this.analyticsEngine) {
    this.analyticsEngine.writeDataPoint({
      blobs: [metrics.url, metrics.method],
      doubles: [metrics.duration],
      indexes: [metrics.status?.toString()],
    });
  }
}
```

## TypeScript Types

```typescript
interface LogEvent {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

interface RequestMetrics {
  url: string;
  method: string;
  duration: number;
  status?: number;
  userAgent?: string;
}

interface ErrorContext {
  stack?: string;
  url?: string;
  method?: string;
  userAgent?: string;
  [key: string]: unknown;
}

type RedactionMode = 'mask' | 'hash' | 'remove';

interface RedactionOptions {
  mode?: RedactionMode;
  customKeys?: string[];
  redactEmails?: boolean;
  redactIPs?: boolean;
  keepChars?: number;
}
```

## Testing

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage
```

### Testing with Observability

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ObservabilityClient } from '@codex/observability';

describe('My Service', () => {
  it('should log errors', () => {
    const consoleSpy = vi.spyOn(console, 'error');
    const obs = new ObservabilityClient('test-service', 'development');

    obs.trackError(new Error('Test error'), { userId: '123' });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Test error')
    );
  });

  it('should redact sensitive data', () => {
    const consoleSpy = vi.spyOn(console, 'info');
    const obs = new ObservabilityClient('test-service', 'production');

    obs.info('User action', {
      password: 'secret123',
      apiKey: 'sk_live_abc',
    });

    const logOutput = consoleSpy.mock.calls[0][0];
    expect(logOutput).not.toContain('secret123');
    expect(logOutput).not.toContain('sk_live_abc');
  });
});
```

## Best Practices

1. **Always use environment-aware config** - Let the client handle redaction based on environment
2. **Log structured data** - Use metadata objects instead of string concatenation
3. **Track all errors** - Use `trackError()` for consistent error tracking
4. **Use request timing** - Track performance with `createRequestTimer()`
5. **Don't log sensitive data** - Redaction is a safety net, avoid logging secrets when possible
6. **Use appropriate log levels** - debug → info → warn → error
7. **Include context** - Add userId, requestId, or other correlation IDs

## Troubleshooting

### Logs Not Appearing in Production

The observability client currently logs to console. In Cloudflare Workers:
- View logs in Cloudflare Dashboard → Workers → Logs
- Use `wrangler tail` for real-time log streaming
- Consider integrating external service (Axiom, Baselime) for persistence

### Sensitive Data Not Redacted

Check your redaction configuration:

```typescript
// Ensure production mode enables redaction
const obs = new ObservabilityClient('my-service', 'production');

// Or manually configure
const obs = new ObservabilityClient('my-service', 'development', {
  mode: 'mask',
  redactEmails: true,
});

// Add custom sensitive keys
const obs = new ObservabilityClient('my-service', 'production', {
  customKeys: ['myCustomSecret', 'internalToken'],
});
```

### Debug Logs Not Showing

Debug logs only appear in development:

```typescript
const obs = new ObservabilityClient('my-service', 'development');
obs.debug('This will show');

const prodObs = new ObservabilityClient('my-service', 'production');
prodObs.debug('This will NOT show');
```

## Related Packages

- `@codex/worker-utils` - Worker factory with built-in observability
- `@codex/security` - Security middleware and headers
- `@codex/shared-types` - TypeScript types for workers

## License

Proprietary - Internal use only

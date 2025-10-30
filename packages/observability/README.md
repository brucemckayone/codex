# @codex/observability

Simple, cost-effective observability for Cloudflare Workers and SvelteKit applications.

## Features

- **Structured logging** with log levels (debug, info, warn, error)
- **Request metrics tracking** (duration, status, user agent)
- **Error tracking** with context and stack traces
- **Middleware helpers** for Hono and SvelteKit
- **Environment-aware** (production vs development)

## Usage

### Basic Logging

```typescript
import { ObservabilityClient } from '@codex/observability';

const obs = new ObservabilityClient('my-service', 'production');

obs.info('Service started', { version: '1.0.0' });
obs.warn('Rate limit approaching', { current: 90, max: 100 });
obs.error('Failed to process request', { userId: '123' });
```

### Request Tracking in Hono

```typescript
import { Hono } from 'hono';
import { ObservabilityClient, createRequestTimer } from '@codex/observability';

const app = new Hono();
const obs = new ObservabilityClient('stripe-webhook-handler', 'production');

app.use('*', async (c, next) => {
  const timer = createRequestTimer(obs, c.req);
  await next();
  timer.end(c.res.status);
});

app.onError((err, c) => {
  obs.trackError(err, { url: c.req.url, method: c.req.method });
  return c.text('Error', 500);
});
```

### Error Tracking

```typescript
try {
  await processPayment(paymentData);
} catch (error) {
  obs.trackError(error as Error, {
    userId: paymentData.userId,
    amount: paymentData.amount,
    currency: paymentData.currency,
  });
  throw error;
}
```

## Future Integrations

This package is designed to be extended with external observability services:

### Axiom (Recommended)
- **Free tier**: 500GB/month
- **Perfect for**: Structured logging and metrics
- **Integration**: Add Axiom client in `log()` method

### Baselime
- **Serverless-first** observability
- **Perfect for**: Cloudflare Workers monitoring
- **Integration**: Use Baselime SDK alongside this package

### Cloudflare Analytics Engine
- **Native** Cloudflare integration
- **Perfect for**: Request metrics and KPIs
- **Integration**: Use alongside this package for metrics

## Development

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage
```

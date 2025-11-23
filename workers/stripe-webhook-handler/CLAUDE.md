# Stripe Webhook Handler Worker

## Overview

The stripe-webhook-handler worker is a Cloudflare Workers-based service that processes Stripe webhook events with cryptographic signature verification, comprehensive observability, and rate limiting. This worker acts as the entry point for all Stripe events in the Codex platform, handling payment, subscription, customer, Connect account, booking, and dispute events. No user authentication is required; Stripe signature verification serves as the only authentication mechanism. The worker validates webhook signatures using HMAC-SHA256 to prevent spoofing, logs all webhook activity for debugging and compliance, and provides a foundation for event-specific business logic handlers.

## Architecture

### Deployment Target

- **Service**: stripe-webhook-handler
- **Runtime**: Cloudflare Workers (wrangler)
- **Development Port**: 42072
- **Compatibility Date**: 2025-01-01
- **Compatibility Flags**: nodejs_compat

### Route Structure

The worker defines six separate webhook endpoints, each handling a distinct category of Stripe events:

| Endpoint | Purpose | Event Categories |
|----------|---------|------------------|
| `POST /webhooks/stripe/payment` | Payment processing events | payment_intent.*, charge.* |
| `POST /webhooks/stripe/subscription` | Subscription lifecycle events | customer.subscription.*, invoice.* |
| `POST /webhooks/stripe/customer` | Customer account events | customer.created, customer.updated, customer.deleted |
| `POST /webhooks/stripe/connect` | Connect account events | account.*, capability.*, person.* |
| `POST /webhooks/stripe/booking` | Checkout session events | checkout.session.* |
| `POST /webhooks/stripe/dispute` | Dispute and fraud warning events | charge.dispute.*, radar.early_fraud_warning.* |

Health check endpoints provide status monitoring:

| Endpoint | Purpose |
|----------|---------|
| `GET /` | Simple status check |
| `GET /health` | Detailed health check with database and KV status |

### Middleware Chain

All requests flow through a standardized middleware chain applied globally:

```
Request
  ↓
Request Tracking Middleware (generates UUID request ID, captures IP, user agent)
  ↓
Observability Middleware (logs request, tags with request ID)
  ↓
Security Headers Middleware (applies CSP and other security headers)
  ↓
Not Found Handler (catches unmapped routes)
  ↓
Error Handler (catches exceptions, logs errors, returns appropriate responses)
```

For webhook endpoints specifically, an additional middleware is applied:

```
Webhook Request
  ↓
Rate Limiting Middleware (1000 req/min via KV store)
  ↓
Stripe Signature Verification Middleware (verifies HMAC-SHA256 signature)
  ↓
Webhook Handler (logs event, executes optional event-specific handler, returns response)
```

### Middleware Details

**Global Middleware Chain** (`createStandardMiddlewareChain`)
- Service name: stripe-webhook-handler
- Enables observability: true
- Applied to: all routes (*)
- Behavior: Adds request tracking (UUID), logging, security headers

**Rate Limiting** (`RATE_LIMIT_PRESETS.webhook`)
- Applied to: /webhooks/* routes only
- Limit: 1000 requests per minute
- Storage: RATE_LIMIT_KV (Cloudflare KV namespace)
- Response headers: x-ratelimit-limit, x-ratelimit-remaining
- Enforcement: Returns 429 if exceeded

**Stripe Signature Verification** (`verifyStripeSignature`)
- Applied to: Each webhook endpoint
- Algorithm: HMAC-SHA256
- Header: stripe-signature
- Behavior: Constructs and verifies event, sets stripeEvent and stripe in context
- Errors: Returns 400 if signature header missing, 401 if verification fails, 500 if webhook secret not configured

**Observability Error Handler** (`createObservabilityErrorHandler`)
- Applied to: Application error handler
- Behavior: Logs errors with full context, includes error stack traces (in development)
- Response: JSON error response with safe error message

**Not Found Handler** (`createNotFoundHandler`)
- Applied to: Unmapped routes
- Response: 404 JSON response

## Public Endpoints

### POST /webhooks/stripe/payment

**Purpose**: Handle payment-related webhook events from Stripe (payment intent and charge events)

**Authentication**: None (Stripe signature verification in verifyStripeSignature middleware)

**Rate Limit**: 1000 requests per minute

**Request Format**:
Stripe webhook request with raw body (not parsed) and stripe-signature header

```
POST /webhooks/stripe/payment HTTP/1.1
Host: stripe-webhook-handler.example.com
stripe-signature: t=1614556800,v1=abc123...
Content-Type: application/json

{
  "id": "evt_1IjA...",
  "object": "event",
  "api_version": "2025-10-29.clover",
  "created": 1614556800,
  "data": {
    "object": {
      "id": "pi_1IjA...",
      "object": "payment_intent",
      ...
    }
  },
  "type": "payment_intent.succeeded"
}
```

**Request Parameters**:
- Raw body must be the exact JSON string from Stripe (no parsing before signature verification)
- stripe-signature header (required): Stripe signature for verification

**Response** (200):
```json
{
  "received": true
}
```

The response always returns 200 OK if the signature is valid, even if event processing fails. This prevents Stripe from retrying the webhook.

**Response** (200 with Handler Error):
```json
{
  "received": true,
  "error": "Handler error"
}
```

If a custom webhook handler throws an error, the response still returns 200 OK with an error note. The error is logged for debugging.

**Possible Errors**:
- 400 Bad Request: Missing stripe-signature header
- 401 Unauthorized: Invalid Stripe signature (tampering detected)
- 429 Too Many Requests: Rate limit exceeded (1000 req/min)
- 500 Internal Server Error: STRIPE_SECRET_KEY or webhook secret not configured

**Example**:
```bash
# Using Stripe CLI to send test webhook
stripe listen --forward-to localhost:42072/webhooks/stripe/payment
stripe trigger payment_intent.succeeded

# Or using curl (requires valid Stripe signature)
curl -X POST http://localhost:42072/webhooks/stripe/payment \
  -H "stripe-signature: $(stripe-signature-header)" \
  -H "Content-Type: application/json" \
  -d '{"id":"evt_test","type":"payment_intent.succeeded",...}'
```

### POST /webhooks/stripe/subscription

**Purpose**: Handle subscription and invoice webhook events from Stripe

**Authentication**: None (Stripe signature verification)

**Rate Limit**: 1000 requests per minute

**Request Parameters**:
- Raw body with Stripe event JSON
- stripe-signature header (required)

**Response** (200):
```json
{
  "received": true
}
```

**Possible Errors**:
- 400 Bad Request: Missing stripe-signature header
- 401 Unauthorized: Invalid Stripe signature
- 429 Too Many Requests: Rate limit exceeded
- 500 Internal Server Error: Configuration error

**Supported Event Types**:
- customer.subscription.created
- customer.subscription.updated
- customer.subscription.deleted
- invoice.created
- invoice.updated
- invoice.paid
- invoice.payment_failed
- invoice.payment_succeeded

### POST /webhooks/stripe/customer

**Purpose**: Handle customer account webhook events from Stripe

**Authentication**: None (Stripe signature verification)

**Rate Limit**: 1000 requests per minute

**Response** (200):
```json
{
  "received": true
}
```

**Supported Event Types**:
- customer.created
- customer.updated
- customer.deleted

### POST /webhooks/stripe/connect

**Purpose**: Handle Stripe Connect account webhook events

**Authentication**: None (Stripe signature verification)

**Rate Limit**: 1000 requests per minute

**Response** (200):
```json
{
  "received": true
}
```

**Supported Event Types**:
- account.created
- account.updated
- account.external_account.created
- account.external_account.updated
- account.external_account.deleted
- capability.updated
- person.created
- person.updated

### POST /webhooks/stripe/booking

**Purpose**: Handle Stripe Checkout session webhook events for booking transactions

**Authentication**: None (Stripe signature verification)

**Rate Limit**: 1000 requests per minute

**Response** (200):
```json
{
  "received": true
}
```

**Supported Event Types**:
- checkout.session.completed
- checkout.session.async_payment_failed
- checkout.session.async_payment_succeeded

### POST /webhooks/stripe/dispute

**Purpose**: Handle payment dispute and fraud warning webhook events from Stripe

**Authentication**: None (Stripe signature verification)

**Rate Limit**: 1000 requests per minute

**Response** (200):
```json
{
  "received": true
}
```

**Supported Event Types**:
- charge.dispute.created
- charge.dispute.updated
- charge.dispute.closed
- radar.early_fraud_warning.created
- radar.early_fraud_warning.updated

### GET /health

**Purpose**: Return detailed health status of the worker and dependencies

**Authentication**: None

**Rate Limit**: None

**Response** (200):
```json
{
  "status": "healthy",
  "worker": "stripe-webhook-handler",
  "version": "1.0.0",
  "checks": {
    "database": {
      "status": "healthy",
      "latency": 5
    },
    "rate-limit-kv": {
      "status": "healthy",
      "latency": 2
    }
  },
  "timestamp": "2025-11-23T10:30:00.000Z"
}
```

**Response** (503):
```json
{
  "status": "unhealthy",
  "worker": "stripe-webhook-handler",
  "version": "1.0.0",
  "checks": {
    "database": {
      "status": "unhealthy",
      "error": "Connection timeout"
    }
  },
  "timestamp": "2025-11-23T10:30:00.000Z"
}
```

**Possible Errors**:
- 503 Service Unavailable: Database unreachable or KV unavailable

## Security Model

### Stripe Signature Verification

The worker implements Stripe's HMAC-SHA256 webhook signature verification to prevent spoofing:

**How It Works**:
1. Extract stripe-signature header from request
2. Get raw request body (before JSON parsing)
3. Retrieve webhook secret for the specific endpoint type
4. Use Stripe SDK's `constructEvent()` to verify signature:
   - Stripe SDK verifies HMAC-SHA256 using webhook secret
   - Computes expected signature from raw body and secret
   - Compares with received signature
5. If valid, event object is constructed and stored in context
6. If invalid, 401 Unauthorized response returned

**Why Raw Body is Required**:
The signature verification must use the exact raw bytes from Stripe. If the body is JSON-parsed and re-stringified, the bytes change and signature verification fails. This is why this worker uses custom Hono setup instead of standard request parsing.

### Request Tracking & Logging

All requests are tracked with:
- **UUID Request ID**: Unique identifier assigned to each request, included in all logs
- **IP Address**: Client IP extracted from request headers
- **User Agent**: User agent string from request
- **Request Method & Path**: HTTP method and path for routing
- **Timestamp**: ISO 8601 timestamp of request

Tracking is performed by `createStandardMiddlewareChain` middleware. All observability logs include the request ID for tracing.

### Security Headers

Security headers are applied to all responses via `createStandardMiddlewareChain`:

| Header | Value |
|--------|-------|
| X-Frame-Options | DENY (prevents clickjacking) |
| X-Content-Type-Options | nosniff (prevents MIME sniffing) |
| Content-Security-Policy | (API preset: strict, no external scripts) |
| Strict-Transport-Security | max-age=31536000; includeSubDomains (HTTPS only) |

### Rate Limiting Strategy

Webhook endpoints are rate limited to 1000 requests per minute using Cloudflare KV:

- **Key**: IP-based key (from rate limiter configuration)
- **Storage**: RATE_LIMIT_KV namespace
- **Window**: 60 seconds (1 minute)
- **Limit**: 1000 requests per window
- **Response**: 429 Too Many Requests when exceeded
- **Headers**: x-ratelimit-limit and x-ratelimit-remaining included in responses

This rate limit accommodates high-volume webhook delivery from Stripe while preventing abuse.

### Input Validation

The worker validates Stripe signatures at the middleware level. No additional input validation is required because:
1. Signature verification ensures authenticity
2. Stripe API guarantees event structure compliance
3. Event type is read from Stripe event object

Custom handlers can apply additional validation using Zod schemas in `src/schemas/` directory for metadata validation.

### No User Authentication

The worker requires no user authentication because:
1. Webhook endpoints are not user-initiated
2. Stripe signature serves as cryptographic proof of authenticity
3. Events are scoped to Stripe account, not individual users
4. Health endpoints are unauthenticated for monitoring

## Event Processing

### Event Types & Handling

The worker defines six webhook endpoint categories, each processing a specific set of Stripe event types. Each endpoint:

1. Verifies Stripe signature (middleware)
2. Logs event receipt with type and ID
3. Optionally executes a custom handler (if provided)
4. Returns 200 OK response (regardless of handler success or failure)

### Default Behavior

If no custom handler is provided, the worker:
- Verifies signature
- Logs "Webhook received" message with event type and ID
- Returns 200 OK
- Does not process the event further

This allows gradual implementation of event handlers without breaking webhook delivery.

### Custom Handler Implementation

To add event-specific processing, provide a handler function to `createWebhookHandler()`:

```typescript
// Example: Add custom payment handler
app.post(
  '/webhooks/stripe/payment',
  verifyStripeSignature(),
  createWebhookHandler('Payment', async (event, stripe, c) => {
    // event is the verified Stripe event
    // stripe is the Stripe API client
    // c is the Hono context (includes observability client via c.get('obs'))

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;

      // Process payment
      const obs = c.get('obs');
      obs.info('Processing payment', { id: paymentIntent.id });

      // Save to database, trigger business logic, etc.
      await someService.recordPayment(paymentIntent);
    }
  })
);
```

### Event Metadata Access

Stripe event structure:

```typescript
event: Stripe.Event = {
  id: string;                           // Unique event ID
  type: string;                         // Event type (e.g., "payment_intent.succeeded")
  created: number;                      // Unix timestamp
  data: {
    object: Record<string, unknown>;    // The Stripe object (PaymentIntent, Subscription, etc.)
    previous_attributes?: Record<string, unknown>;  // Previous values for .updated events
  };
  api_version: string;                  // Stripe API version
  livemode: boolean;                    // Live vs test mode
  pending_webhooks: number;             // How many webhooks pending for this event
  request: {
    id: string | null;
    idempotency_key: string | null;
  };
  account: string;                      // Stripe account ID
}
```

### Metadata Validation Schemas

Event metadata can be validated using Zod schemas defined in `src/schemas/`:

- **src/schemas/payment.ts**: Schema for payment event metadata
- **src/schemas/subscription.ts**: Schema for subscription event metadata
- **src/schemas/customer.ts**: Schema for customer event metadata
- **src/schemas/connect.ts**: Schema for Connect account metadata
- **src/schemas/booking.ts**: Schema for booking/checkout metadata
- **src/schemas/dispute.ts**: Schema for dispute event metadata

Example using metadata utilities:

```typescript
import { validateMetadata, extractField } from './utils/metadata';
import { PaymentMetadataSchema } from './schemas/payment';

const handler: WebhookHandler = async (event, stripe, c) => {
  const paymentIntent = event.data.object as Stripe.PaymentIntent;

  // Validate metadata
  const metadataResult = validateMetadata(
    paymentIntent.metadata,
    PaymentMetadataSchema
  );

  if (!metadataResult.success) {
    c.get('obs').warn('Invalid payment metadata', {
      errors: formatValidationErrors(metadataResult.error)
    });
    return;
  }

  const metadata = metadataResult.data;
  // Use validated metadata...
};
```

### Metadata Validation Utilities

Available in `src/utils/metadata.ts`:

| Function | Purpose | Returns |
|----------|---------|---------|
| `validateMetadata(metadata, schema)` | Validate with result object | { success: boolean; data?: T; error?: ZodError } |
| `validateMetadataStrict(metadata, schema)` | Validate and throw on error | T or throws ZodError |
| `validateMetadataWithDefault(metadata, schema, default)` | Validate with fallback | T |
| `extractField(metadata, field, validator)` | Extract and validate single field | T or null |
| `hasRequiredFields(metadata, fields)` | Check for required fields | boolean |
| `formatValidationErrors(error)` | Format validation errors for logging | string[] |
| `safeExtractMetadata(metadata)` | Type-safe metadata extraction | T or null |

## Error Handling

### Signature Verification Errors

| Status | Condition | Cause | Action |
|--------|-----------|-------|--------|
| 400 | Missing stripe-signature header | Client error: header not sent | Verify Stripe is properly configured to send webhooks |
| 401 | Invalid signature | Security: tampering detected or wrong secret | Verify webhook secret is correct for the environment |
| 500 | STRIPE_SECRET_KEY not configured | Configuration error | Set STRIPE_SECRET_KEY environment variable |
| 500 | Webhook secret not configured | Configuration error | Set STRIPE_WEBHOOK_SECRET_* for endpoint |

### Request Processing Errors

| Status | Condition | Cause | Action |
|--------|-----------|-------|--------|
| 429 | Rate limit exceeded | Too many webhooks in time window | Implement exponential backoff; contact Stripe if legitimate spike |
| 500 | Observability service unavailable | Internal infrastructure issue | Worker continues to process, logs to fallback |
| 404 | Unmapped endpoint | Invalid webhook path | Verify webhook URL in Stripe dashboard |

### Handler Errors

If a custom webhook handler throws an error:
1. Error is caught by try/catch in `createWebhookHandler`
2. Error is logged to observability with full context
3. Response still returns 200 OK to Stripe (prevents retries)
4. Event is not retried by Stripe

This behavior is intentional: Stripe retries webhook delivery on non-2xx responses. Returning 200 OK tells Stripe the webhook was received, even if internal processing failed. The error is logged for manual investigation.

### Logging & Observability

All webhook activity is logged via the observability client:

```typescript
// Signature verification success
obs.info('Webhook signature verified', {
  type: event.type,
  id: event.id,
  path: c.req.path
});

// Webhook received
obs.info('Payment webhook received', {
  type: event.type,
  id: event.id
});

// Handler error
obs.error('Payment webhook handler error', {
  error: err.message,
  eventType: event.type,
  eventId: event.id
});
```

## Retry Strategy

### Stripe Retry Behavior

Stripe automatically retries webhook delivery based on the HTTP response status:

- **2xx responses**: Considered delivered; no retry
- **Non-2xx responses**: Triggers retry with exponential backoff
  - First retry: ~5 minutes
  - Second retry: ~30 minutes
  - Third retry: ~2 hours
  - Fourth retry: ~5 hours
  - Fifth retry: ~10 hours
  - Stops after 5 attempts

### Worker Behavior

The worker always returns 200 OK after signature verification, even if:
- Custom handler throws an error
- Database write fails
- External service is unavailable

This prevents Stripe from retrying the webhook delivery. Instead:
1. Errors are logged to observability
2. Manual investigation and retry is required
3. Error handling code should implement compensation logic (e.g., query Stripe API for missing data)

### Idempotency

Webhook events can be retried, so handlers must be idempotent:

```typescript
// BAD: Not idempotent (may create duplicate record)
const handler = async (event, stripe, c) => {
  await db.payments.create({
    stripeId: event.data.object.id,
    amount: event.data.object.amount
  });
};

// GOOD: Idempotent (uses upsert)
const handler = async (event, stripe, c) => {
  await db.payments.upsert(
    { stripeId: event.data.object.id },
    {
      stripeId: event.data.object.id,
      amount: event.data.object.amount
    }
  );
};
```

## Integration Points

### Service Integration

The worker integrates with these service packages:

| Package | Purpose | Used For |
|---------|---------|----------|
| @codex/security | Rate limiting, security headers | Webhook rate limiting (1000 req/min), CSP headers |
| @codex/worker-utils | Worker utilities | Health checks, middleware chains, error handling |
| @codex/observability | Logging and metrics | Request tracking, event logging, error reporting |
| @codex/database | Database access | Future: storing webhook events and processing results |
| @codex/validation | Validation schemas | Metadata validation for Stripe events |
| @codex/shared-types | Type definitions | Environment bindings, Stripe types |

### Data Flow

```
Stripe Event
  ↓
[Verify Signature Middleware]
  ↓
Context: { stripeEvent, stripe, obs }
  ↓
[Custom Handler (if provided)]
  ↓
Save to Database / Update Services
  ↓
Return 200 OK to Stripe
```

### Webhook Integration Patterns

**Pattern 1: Simple Logging**
```typescript
app.post('/webhooks/stripe/payment', verifyStripeSignature(),
  createWebhookHandler('Payment', async (event, stripe, c) => {
    c.get('obs').info('Payment event received', {
      id: event.data.object.id,
      amount: event.data.object.amount
    });
  })
);
```

**Pattern 2: Database Update**
```typescript
app.post('/webhooks/stripe/payment', verifyStripeSignature(),
  createWebhookHandler('Payment', async (event, stripe, c) => {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    await db.query(
      'UPDATE payments SET status = $1 WHERE stripe_id = $2',
      [event.type, paymentIntent.id]
    );
  })
);
```

**Pattern 3: Service Integration**
```typescript
app.post('/webhooks/stripe/subscription', verifyStripeSignature(),
  createWebhookHandler('Subscription', async (event, stripe, c) => {
    const subscription = event.data.object as Stripe.Subscription;
    const service = new SubscriptionService(c.env.DATABASE_URL);

    if (event.type === 'customer.subscription.deleted') {
      await service.cancelSubscription(subscription.id);
    }
  })
);
```

## Dependencies

### Core Packages

| Package | Version | Purpose | Why Used |
|---------|---------|---------|----------|
| stripe | ^19.2.0 | Stripe SDK | Signature verification, event type definitions |
| hono | ^4.6.20 | Web framework | HTTP routing, middleware, context |
| zod | ^3.24.1 | Validation | Metadata schema validation |
| @codex/security | workspace:* | Security middleware | Rate limiting, security headers |
| @codex/worker-utils | workspace:* | Worker utilities | Health checks, standard middleware |
| @codex/observability | workspace:* | Observability | Logging, request tracking |
| @codex/database | workspace:* | Database access | Future: webhook event storage |
| @codex/validation | workspace:* | Validation utilities | Shared validation patterns |
| @codex/shared-types | workspace:* | Type definitions | Stripe/Cloudflare type definitions |

### Cloudflare Bindings

| Binding | Type | Purpose |
|---------|------|---------|
| RATE_LIMIT_KV | Cloudflare KV | Rate limit counter storage (webhook endpoint traffic) |
| DATABASE_URL | Secret | PostgreSQL connection string |
| STRIPE_SECRET_KEY | Secret | Stripe API secret key for client initialization |
| STRIPE_WEBHOOK_SECRET_PAYMENT | Secret | HMAC secret for payment webhook endpoint |
| STRIPE_WEBHOOK_SECRET_SUBSCRIPTION | Secret | HMAC secret for subscription webhook endpoint |
| STRIPE_WEBHOOK_SECRET_CONNECT | Secret | HMAC secret for Connect webhook endpoint |
| STRIPE_WEBHOOK_SECRET_CUSTOMER | Secret | HMAC secret for customer webhook endpoint |
| STRIPE_WEBHOOK_SECRET_BOOKING | Secret | HMAC secret for booking webhook endpoint |
| STRIPE_WEBHOOK_SECRET_DISPUTE | Secret | HMAC secret for dispute webhook endpoint |

## Development & Deployment

### Local Development

**Prerequisites**:
- Node.js 20+ (compatible with Cloudflare Workers)
- wrangler CLI: `npm install -g wrangler`
- Stripe CLI: https://stripe.com/docs/stripe-cli

**Setup**:
```bash
cd workers/stripe-webhook-handler

# Install dependencies
pnpm install

# Create local environment file (copy from .env.example or setup manually)
# Required: DATABASE_URL, STRIPE_SECRET_KEY, all STRIPE_WEBHOOK_SECRET_* vars
```

**Running Locally**:
```bash
# Start worker on port 42072
pnpm dev

# In another terminal, forward Stripe webhooks to local worker
stripe listen --forward-to localhost:42072/webhooks/stripe/payment \
  --forward-to localhost:42072/webhooks/stripe/subscription \
  --forward-to localhost:42072/webhooks/stripe/connect \
  --forward-to localhost:42072/webhooks/stripe/customer \
  --forward-to localhost:42072/webhooks/stripe/booking \
  --forward-to localhost:42072/webhooks/stripe/dispute

# Trigger test events
stripe trigger payment_intent.succeeded
stripe trigger customer.subscription.created
# etc.
```

**Building**:
```bash
# Build for deployment
pnpm build

# Output: dist/index.js
```

### Testing

**Unit Tests**:
```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage report
pnpm test:coverage
```

**Test Environment**:
- Tests run in Cloudflare Workers runtime (workerd) via @cloudflare/vitest-pool-workers
- Access to environment bindings via cloudflare:test module
- Database available in test environment (if configured)

**Writing Tests**:
```typescript
import { env, SELF } from 'cloudflare:test';

describe('Webhook', () => {
  it('should reject missing signature', async () => {
    const response = await SELF.fetch('http://localhost/webhooks/stripe/payment', {
      method: 'POST',
      body: JSON.stringify({ type: 'payment_intent.succeeded' })
    });
    expect(response.status).toBe(400);
  });
});
```

### Environment Variables

**Development (.env or wrangler dev)**:
```
ENVIRONMENT=development
DATABASE_URL=postgresql://user:pass@localhost:5432/codex_dev
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET_PAYMENT=whsec_test_...
STRIPE_WEBHOOK_SECRET_SUBSCRIPTION=whsec_test_...
STRIPE_WEBHOOK_SECRET_CONNECT=whsec_test_...
STRIPE_WEBHOOK_SECRET_CUSTOMER=whsec_test_...
STRIPE_WEBHOOK_SECRET_BOOKING=whsec_test_...
STRIPE_WEBHOOK_SECRET_DISPUTE=whsec_test_...
```

**Staging (wrangler.jsonc)**:
```
ENVIRONMENT=staging
DB_METHOD=STAGING
WEB_APP_URL=https://codex-staging.revelations.studio
AUTH_WORKER_URL=https://auth-staging.revelations.studio
```

**Production (wrangler.jsonc)**:
```
ENVIRONMENT=production
DB_METHOD=PRODUCTION
WEB_APP_URL=https://codex.revelations.studio
AUTH_WORKER_URL=https://auth.revelations.studio
```

**Setting Secrets**:
```bash
# Set Stripe secret (shared across environments)
wrangler secret put STRIPE_SECRET_KEY --env staging
wrangler secret put STRIPE_SECRET_KEY --env production

# Set webhook secrets
wrangler secret put STRIPE_WEBHOOK_SECRET_PAYMENT --env staging
wrangler secret put STRIPE_WEBHOOK_SECRET_PAYMENT --env production

# Set database URL
wrangler secret put DATABASE_URL --env staging
wrangler secret put DATABASE_URL --env production
```

### Deployment

**To Staging**:
```bash
pnpm deploy --env staging
```

**To Production**:
```bash
pnpm deploy --env production
```

The deploy script runs `pnpm build` then `wrangler deploy`.

**Webhook URL Configuration in Stripe Dashboard**:

1. Login to https://dashboard.stripe.com
2. Navigate to Settings → Webhooks
3. Add new endpoint for each webhook type:
   - **Payment**: https://api.revelations.studio/webhooks/stripe/payment
   - **Subscription**: https://api.revelations.studio/webhooks/stripe/subscription
   - **Connect**: https://api.revelations.studio/webhooks/stripe/connect
   - **Customer**: https://api.revelations.studio/webhooks/stripe/customer
   - **Booking**: https://api.revelations.studio/webhooks/stripe/booking
   - **Dispute**: https://api.revelations.studio/webhooks/stripe/dispute
4. Copy webhook signing secrets to environment variables (STRIPE_WEBHOOK_SECRET_*)
5. Select which events each endpoint should receive
6. Test webhook delivery using Stripe's test button

**Webhook Configuration Notes**:
- Each endpoint has a separate signing secret in Stripe dashboard
- Store secrets as wrangler secrets (never in source code)
- Verify webhook URLs are accessible and return 200 OK responses
- Monitor webhook delivery logs in Stripe dashboard for failures
- Set up alerting for failed webhook deliveries in observability

## Webhook Integration Checklist

When adding a new webhook handler:

1. [ ] Define Zod schema in `src/schemas/[event-type].ts`
2. [ ] Implement handler function with proper error handling
3. [ ] Add handler to endpoint via `createWebhookHandler('Type', handler)`
4. [ ] Validate metadata using `validateMetadata()` or similar
5. [ ] Log all operations via observability client
6. [ ] Implement idempotent database operations (use upsert)
7. [ ] Test with Stripe CLI: `stripe trigger [event-type]`
8. [ ] Add unit tests for handler logic
9. [ ] Configure webhook in Stripe dashboard
10. [ ] Monitor webhook delivery logs post-deployment

## Performance Notes

### Rate Limiting

Webhook endpoints are rate limited to 1000 requests per minute. For legitimate Stripe webhooks:
- Stripe typically sends webhooks at low frequency (< 100/min for normal volume)
- Rate limit can be adjusted in wrangler.jsonc if needed
- Rate limit is per IP address by default

### Response Time

- Signature verification: ~5-10ms (HMAC-SHA256)
- No handler (default): ~15-20ms (with observability logging)
- With custom handler: depends on handler complexity

To optimize performance:
- Keep handlers simple and async where possible
- Defer heavy operations to background jobs
- Batch database writes if processing multiple events
- Use database connection pooling

### Observability Overhead

Request tracking and logging adds ~5-10ms per request. This is acceptable for webhook processing where latency is not critical.

### Caching

No caching is implemented in the webhook handler because:
- Each Stripe event should be processed once
- Signatures change for each request
- Event data often has time-sensitive information

## Error Handling Patterns

### Pattern 1: Graceful Degradation
```typescript
const handler: WebhookHandler = async (event, stripe, c) => {
  const obs = c.get('obs');

  try {
    // Try to process
    await processEvent(event);
  } catch (error) {
    // Log but don't throw (prevents Stripe retry)
    obs.error('Failed to process event', { error: (error as Error).message });
    // Return 200 anyway - event is acknowledged
  }
};
```

### Pattern 2: Validation with Fallback
```typescript
const handler: WebhookHandler = async (event, stripe, c) => {
  const obs = c.get('obs');

  const metadata = validateMetadataWithDefault(
    (event.data.object as any).metadata,
    PaymentMetadataSchema,
    {}
  );

  // Use metadata or fallback to defaults
  await processPayment(event, metadata);
};
```

### Pattern 3: Retry with Exponential Backoff (Client-Side)
```typescript
async function processWithRetry(event: Stripe.Event) {
  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    try {
      await processEvent(event);
      return;
    } catch (error) {
      attempt++;
      if (attempt >= maxAttempts) throw error;
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
}
```

## Security Considerations

### Why Stripe Signature Verification is Critical

Stripe webhooks are delivered over the public internet. Without signature verification:
1. Attackers could forge fake events
2. Payment could be credited without actual charge
3. Subscription could be cancelled without user action
4. Customer data could be leaked

**Always verify signatures** before processing any webhook event.

### Preventing Replay Attacks

The worker does not implement replay attack prevention because:
- Each webhook from Stripe has unique ID and timestamp
- Database upserts prevent duplicate event processing
- Stripe rate-limits webhook delivery to prevent accidental duplicates

### Securing Webhook Secrets

Webhook secrets must be:
- Never committed to source code
- Stored as wrangler secrets (encrypted by Cloudflare)
- Rotated in Stripe dashboard if compromised
- Set separately per environment (staging vs production)
- Accessed only in this worker (not shared with other services)

### Metadata Validation

Always validate Stripe metadata because:
- Client-side code could manipulate metadata
- Metadata is not cryptographically signed (event is signed, but object fields are not)
- Validation prevents injection attacks

```typescript
// BAD: Trust metadata without validation
const userId = paymentIntent.metadata?.userId;
await db.users.findById(userId);

// GOOD: Validate before use
const metadata = validateMetadataStrict(
  paymentIntent.metadata,
  z.object({ userId: z.string().uuid() })
);
await db.users.findById(metadata.userId);
```

## Monitoring & Alerts

### Key Metrics to Monitor

1. **Webhook Delivery Rate**: Webhooks received per minute
2. **Signature Verification Failure Rate**: Failed signature verifications per minute
3. **Handler Error Rate**: Handler exceptions per minute
4. **Response Time**: P50, P95, P99 latency
5. **Rate Limit Hit Rate**: 429 responses per minute

### Alerts to Configure

1. **Signature Verification Failures**: Indicates compromised webhook secrets or tampering
2. **Handler Errors**: Logic errors in webhook processing
3. **High Error Rate**: Broader system issues
4. **Deployment Issues**: Failed webhook delivery after deploy

These are monitored via observability client and available in Cloudflare dashboard.

## File Structure

```
workers/stripe-webhook-handler/
├── src/
│   ├── index.ts                    # Main worker entry point
│   ├── types.ts                    # TypeScript type definitions
│   ├── index.test.ts              # Worker integration tests
│   ├── security.test.ts           # Security middleware tests
│   ├── middleware/
│   │   └── verify-signature.ts    # Stripe signature verification
│   ├── utils/
│   │   ├── webhook-handler.ts     # Webhook handler factory
│   │   └── metadata.ts            # Metadata validation utilities
│   └── schemas/
│       ├── payment.ts              # Payment event metadata schema
│       ├── subscription.ts         # Subscription event metadata schema
│       ├── customer.ts             # Customer event metadata schema
│       ├── connect.ts              # Connect account metadata schema
│       ├── booking.ts              # Booking event metadata schema
│       └── dispute.ts              # Dispute event metadata schema
├── dist/                           # Build output (generated)
├── package.json                    # Dependencies and scripts
├── wrangler.jsonc                 # Cloudflare Workers configuration
├── tsconfig.json                  # TypeScript configuration
├── vitest.config.ts               # Vitest configuration
├── vite.config.ts                 # Vite build configuration
└── README.clog                    # This documentation
```

## Common Tasks

### Task: Add Payment Processing Handler

1. Open `src/index.ts`
2. Replace the payment handler placeholder:
   ```typescript
   app.post(
     '/webhooks/stripe/payment',
     verifyStripeSignature(),
     createWebhookHandler('Payment', async (event, stripe, c) => {
       const pi = event.data.object as Stripe.PaymentIntent;
       const obs = c.get('obs');

       if (event.type === 'payment_intent.succeeded') {
         obs.info('Recording payment', { id: pi.id });
         // Implement payment recording logic
       }
     })
   );
   ```
3. Add metadata schema in `src/schemas/payment.ts`
4. Add tests in `src/index.test.ts`
5. Deploy and test with Stripe CLI

### Task: Validate Event Metadata

1. Define schema in `src/schemas/[event-type].ts`
2. In handler, validate using `validateMetadata()`:
   ```typescript
   const result = validateMetadata(metadata, MySchema);
   if (!result.success) {
     obs.warn('Invalid metadata', {
       errors: formatValidationErrors(result.error)
     });
     return;
   }
   const validated = result.data;
   ```

### Task: Debug Webhook Failures

1. Check observability logs: look for signature verification errors
2. Verify webhook secret is correct for the environment
3. Use Stripe CLI to trigger test events: `stripe trigger event.type`
4. Check if handler is throwing exceptions (look for "handler error" logs)
5. Verify database/service connections if doing downstream updates

### Task: Increase Rate Limit

1. Open `src/index.ts`
2. Find rate limiting middleware
3. Create custom rate limit preset or modify:
   ```typescript
   app.use('/webhooks/*', (c, next) => {
     return rateLimit({
       kv: c.env.RATE_LIMIT_KV,
       maxRequests: 5000,  // Increase from 1000
       windowMs: 60 * 1000
     })(c, next);
   });
   ```

## References

- [Stripe Webhooks Documentation](https://stripe.com/docs/webhooks)
- [Stripe Webhook Signatures](https://stripe.com/docs/webhooks/signatures)
- [Stripe API Reference](https://stripe.com/docs/api)
- [Stripe CLI Documentation](https://stripe.com/docs/stripe-cli)
- [Hono Documentation](https://hono.dev/)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [@codex/worker-utils Documentation](../worker-utils/README.clog)
- [@codex/security Documentation](../security/README.clog)
- [@codex/observability Documentation](../observability/README.clog)

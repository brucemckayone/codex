# Ecom-API Worker

## Overview

The ecom-api worker provides e-commerce and payment processing capabilities for the Codex platform. It handles two primary workflows: (1) authenticated checkout session creation for purchasing content via Stripe, and (2) webhook event processing with cryptographic signature verification for purchase completion. The worker acts as the bridge between Stripe payment system and Codex purchase records, coordinating with PurchaseService to create purchases, calculate revenue splits, and grant content access.

**Business Purpose**: Enable creators to monetize content through one-time purchases with secure payment processing and immutable revenue splits.

**Key Characteristics**:
- Authenticated checkout endpoints require user session validation
- Webhook endpoints require only Stripe HMAC-SHA256 signature verification (no session)
- All operations are idempotent (safe to retry)
- Always returns 200 OK to Stripe (prevents webhook retries on handler errors)
- Comprehensive observability logging for debugging and auditing

## Architecture

### Deployment Target

- **Service Name**: ecom-api
- **Runtime**: Cloudflare Workers
- **Compatibility Date**: 2025-01-01
- **Compatibility Flags**: nodejs_compat
- **Development Port**: 42072
- **Production URL**: https://ecom-api.revelations.studio
- **Build Tool**: Vite + wrangler
- **Test Runner**: Vitest (workerd runtime)

### Route Organization

The worker defines two main route files with distinct purposes:

| Route File | Endpoints | Purpose | Authentication |
|---|---|---|---|
| `src/routes/checkout.ts` | POST /checkout/create | Stripe Checkout session creation | Session required |
| `src/routes/purchases.ts` | GET /purchases, GET /purchases/:id | Purchase history/details retrieval | Session required |

### Middleware Chain (Execution Order)

**1. Environment Validation** (first request only):
```typescript
app.use('*', createEnvValidationMiddleware());
```
- Runs once per worker instance
- Validates required environment variables: DATABASE_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET_BOOKING, RATE_LIMIT_KV
- Fails fast with clear error message if any required vars missing
- Subsequent requests bypass this check

**2. Global Middleware Stack** (all requests):
```typescript
const globalMiddleware = createStandardMiddlewareChain({
  serviceName: 'ecom-api',
  enableObservability: true,
});
```
Applied via: `app.use('*', middleware)` for each

Middleware in order:
- **Request Tracking**: Generates UUID request ID, captures client IP address
- **Observability**: Logs request/response with context (service name, method, path, status)
- **Security Headers**: Applies CSP, X-Frame-Options, HSTS, X-Content-Type-Options
- **Error Handler**: Catches unhandled exceptions, maps service errors to HTTP responses
- **Not Found Handler**: Returns 404 for unmapped routes

**3. Health Check Routes**:
```typescript
app.get('/', (c) => c.json({ status: 'ok', service: 'ecom-api' }))
app.get('/health', createHealthCheckHandler(...))
```

**4. Checkout Routes** (POST /checkout/create):
```typescript
app.route('/checkout', checkout);
```
Applied in checkout.ts:
```typescript
checkout.post('/create',
  withPolicy({ auth: 'required', rateLimit: 'auth' }),  // 10 req/min
  createAuthenticatedHandler({
    schema: { body: createCheckoutSchema },
    handler: async (_c, ctx) => { /* ... */ }
  })
);
```

Middleware order:
- Rate Limiting (10 req/min per user via KV)
- Session Validation (extract codex-session cookie, validate via Auth Worker)
- Request Body Validation (Zod schema: contentId, successUrl, cancelUrl)
- Authenticated Handler (executes with ctx.user and ctx.validated)

**5. Purchase Routes** (GET /purchases, GET /purchases/:id):
```typescript
app.route('/purchases', purchases);
```
Applied in purchases.ts:
```typescript
purchases.get('/',
  withPolicy({ auth: 'required', rateLimit: 'api' }),  // 100 req/min
  createAuthenticatedHandler({
    schema: { query: purchaseQuerySchema },
    handler: async (_c, ctx) => { /* ... */ }
  })
);
```

Middleware order:
- Rate Limiting (100 req/min per user via KV)
- Session Validation
- Query Parameter Validation (Zod schema)
- Authenticated Handler

**6. Webhook Routes** (POST /webhooks/stripe/*):
```typescript
app.use('/webhooks/*', (c, next) =>
  rateLimit({ kv: c.env.RATE_LIMIT_KV, ...RATE_LIMIT_PRESETS.webhook })(c, next)
);
app.post('/webhooks/stripe/booking', verifyStripeSignature(), createWebhookHandler(...));
```

Middleware order:
- Rate Limiting (1000 req/min via KV, IP-based)
- Stripe Signature Verification (HMAC-SHA256, extracts event into context)
- Webhook Handler (routing to custom handler if provided)

## Public API

### POST /checkout/create

Create a Stripe Checkout session for purchasing content.

**Authentication**: Session required (validated via Auth Worker)

**Rate Limiting**: 10 requests/minute per authenticated user

**Path**: POST `/checkout/create`

**Request Headers**:
```
Cookie: codex-session=<session-token>
Content-Type: application/json
```

**Request Body**:
```typescript
{
  contentId: string;       // UUID of content to purchase (must exist, published, have price)
  successUrl: string;      // Absolute URL for redirect after payment success
  cancelUrl: string;       // Absolute URL for redirect if user cancels payment
}
```

**Response (200 OK)**:
```typescript
{
  data: {
    sessionUrl: string;    // Stripe-hosted checkout page URL (e.g., https://checkout.stripe.com/...)
    sessionId: string;     // Stripe session ID for reference/tracking
  }
}
```

**Error Responses**:

| Status | Code | Condition | Cause | Recovery |
|---|---|---|---|---|
| 400 | VALIDATION_ERROR | Missing/invalid contentId, cancelUrl, successUrl | Client request malformed | Check field types and formats |
| 401 | UNAUTHORIZED | Missing or expired session | User not authenticated | Login via Auth Worker, retry |
| 404 | NOT_FOUND | Content doesn't exist, not published, or soft-deleted | Invalid contentId or content state | Verify content exists and is published |
| 409 | CONFLICT | User already purchased this content | AlreadyPurchasedError from service | Direct user to view content instead |
| 429 | TOO_MANY_REQUESTS | Rate limit exceeded (>10 req/min) | Too many checkout attempts | Wait 1 minute, retry |
| 500 | PAYMENT_PROCESSING_ERROR | Stripe API failure, STRIPE_SECRET_KEY not configured | External service or config issue | Check Stripe status, verify secrets |
| 503 | SERVICE_UNAVAILABLE | Database unavailable | PostgreSQL connection failure | Retry after database recovers |

**Example Request**:
```bash
curl -X POST http://localhost:42072/checkout/create \
  -H "Cookie: codex-session=sess_abc123xyz789" \
  -H "Content-Type: application/json" \
  -d '{
    "contentId": "550e8400-e29b-41d4-a716-446655440000",
    "successUrl": "https://app.example.com/purchase/success?contentId=550e8400-e29b-41d4-a716-446655440000",
    "cancelUrl": "https://app.example.com/purchase/cancel"
  }'
```

**Example Response (200)**:
```json
{
  "data": {
    "sessionUrl": "https://checkout.stripe.com/pay/cs_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z?",
    "sessionId": "cs_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z"
  }
}
```

**What Happens**:
1. Middleware validates session cookie (delegates to Auth Worker)
2. Request body validated against createCheckoutSchema (Zod)
3. PurchaseService initialized with Stripe client
4. Content lookup (verify exists, published, not deleted)
5. Price validation (must have price > 0 for paid purchase)
6. Duplicate purchase check (user can't purchase same content twice)
7. Stripe Checkout session created with:
   - Content price (in cents, USD)
   - Metadata: userId, contentId, organizationId (optional)
   - Success/cancel URLs for redirects
   - Stripe customer email
8. Session URL returned to frontend
9. Frontend redirects user to Stripe Checkout page
10. User completes payment on Stripe
11. Stripe sends webhook to /webhooks/stripe/booking

---

### GET /purchases

List authenticated user's purchases with pagination and filtering.

**Authentication**: Session required

**Rate Limiting**: 100 requests/minute per user

**Path**: GET `/purchases`

**Request Headers**:
```
Cookie: codex-session=<session-token>
```

**Query Parameters**:

| Parameter | Type | Default | Max | Description |
|---|---|---|---|---|
| page | integer | 1 | N/A | Page number (1-indexed) |
| limit | integer | 20 | 100 | Items per page |
| status | string | (all) | N/A | Filter: completed, refunded, failed |
| contentId | string | (none) | N/A | Filter by specific content UUID |

**Response (200 OK)**:
```typescript
{
  items: Array<{
    id: string;                      // Purchase UUID
    stripePaymentIntentId: string;   // Stripe Payment Intent ID
    customerId: string;              // Codex user ID
    contentId: string;               // Content UUID
    organizationId: string | null;   // Organization UUID if org-owned content
    amountPaidCents: number;         // Amount paid in cents (e.g., 4999 = $49.99)
    currency: string;                // Currency code (e.g., "usd")
    status: "completed" | "refunded" | "failed"; // Purchase status
    purchasedAt: string;             // ISO 8601 timestamp
    content: {
      id: string;
      title: string;
      slug: string;
      contentType: "video" | "audio" | "document";
      creatorId: string;
      organizationId: string | null;
    };
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;                   // Total purchases (all filters applied)
    totalPages: number;              // Math.ceil(total / limit)
  };
}
```

**Error Responses**:

| Status | Code | Condition |
|---|---|---|
| 400 | VALIDATION_ERROR | Invalid page/limit (non-integer, page < 1, limit > 100) |
| 401 | UNAUTHORIZED | Missing or expired session |
| 429 | TOO_MANY_REQUESTS | Rate limit exceeded (>100 req/min) |

**Example Request**:
```bash
curl "http://localhost:42072/purchases?page=1&limit=20&status=completed" \
  -H "Cookie: codex-session=sess_abc123xyz789"
```

**Example Response (200)**:
```json
{
  "items": [
    {
      "id": "purchase-uuid-1",
      "stripePaymentIntentId": "pi_1234567890",
      "customerId": "user-uuid-1",
      "contentId": "content-uuid-1",
      "organizationId": null,
      "amountPaidCents": 4999,
      "currency": "usd",
      "status": "completed",
      "purchasedAt": "2025-12-10T14:30:00Z",
      "content": {
        "id": "content-uuid-1",
        "title": "Advanced TypeScript Patterns",
        "slug": "advanced-typescript-patterns",
        "contentType": "video",
        "creatorId": "creator-uuid-1",
        "organizationId": null
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3
  }
}
```

---

### GET /purchases/:id

Get single purchase details by ID.

**Authentication**: Session required (returns 403 if purchase belongs to different user)

**Rate Limiting**: 100 requests/minute per user

**Path**: GET `/purchases/:id`

**Path Parameters**:

| Parameter | Type | Description |
|---|---|---|
| id | string (UUID) | Purchase UUID |

**Response (200 OK)**:
```typescript
{
  data: {
    id: string;
    stripePaymentIntentId: string;
    customerId: string;
    contentId: string;
    organizationId: string | null;
    amountPaidCents: number;
    currency: string;
    status: "completed" | "refunded" | "failed";
    purchasedAt: string;
    // ... additional fields
  }
}
```

**Error Responses**:

| Status | Code | Condition |
|---|---|---|
| 401 | UNAUTHORIZED | Missing or expired session |
| 403 | FORBIDDEN | Purchase belongs to different user |
| 404 | NOT_FOUND | Purchase doesn't exist |
| 429 | TOO_MANY_REQUESTS | Rate limit exceeded |

**Example Request**:
```bash
curl "http://localhost:42072/purchases/550e8400-e29b-41d4-a716-446655440000" \
  -H "Cookie: codex-session=sess_abc123xyz789"
```

---

### POST /webhooks/stripe/booking

Process `checkout.session.completed` Stripe webhook events. Records purchases and grants content access. This is the only currently implemented webhook handler.

**Authentication**: Stripe HMAC-SHA256 signature verification (no session)

**Rate Limiting**: 1000 requests/minute

**Path**: POST `/webhooks/stripe/booking`

**Request Headers** (from Stripe):
```
stripe-signature: t=<timestamp>,v1=<signature>
Content-Type: application/json
```

**Request Body** (raw JSON from Stripe, not parsed):
```typescript
{
  id: string;                          // Event ID (e.g., "evt_1IjA...")
  object: "event";
  api_version: string;                 // Stripe API version
  created: number;                     // Unix timestamp
  type: "checkout.session.completed";
  data: {
    object: {
      id: string;                      // Stripe session ID
      payment_intent: string;          // Stripe Payment Intent ID
      customer_email: string;
      amount_total: number;            // Amount in cents
      currency: string;
      metadata: {
        customerId: string;            // Codex user ID
        contentId: string;             // Content UUID
        organizationId?: string;       // Optional: org UUID
      };
      status: "complete";
    };
  };
}
```

**Response (200 OK)** (always, even on error):
```json
{ "received": true }
```

**What Happens**:
1. Middleware verifies Stripe signature (HMAC-SHA256)
   - Returns 400 if missing signature header
   - Returns 401 if signature invalid (tampering detected)
2. Extracts checkout.session.completed event from verified data
3. Calls handleCheckoutCompleted() with Stripe event
4. Handler extracts payment metadata (userId, contentId, price)
5. Validates metadata against checkoutSessionMetadataSchema (Zod)
6. Creates per-request database client with transaction support
7. Calls PurchaseService.completePurchase() in transaction:
   - Inserts purchase record (idempotent via paymentIntentId)
   - Calculates revenue split (default 10% platform / 90% creator)
   - Inserts contentAccess record (grants user access)
8. Logs success with purchase details
9. Returns 200 OK to Stripe

**Error Handling**:
- All errors are caught and logged to observability
- No errors are returned to Stripe (always 200 OK)
- This prevents Stripe from retrying the webhook
- Manual investigation required for failed purchases

**Idempotency**:
- Duplicate webhooks use paymentIntentId as unique constraint
- Second webhook returns existing purchase (no duplicates created)
- Safe to receive same event multiple times

**Testing Locally**:
```bash
# Terminal 1: Start worker
pnpm dev

# Terminal 2: Start Stripe listener and forward webhooks
stripe listen --forward-to http://localhost:42072/webhooks/stripe/booking

# Terminal 3: Trigger test event
stripe trigger checkout.session.completed

# Check logs for success
# Expected: "Purchase completed successfully" in observability logs
```

---

### POST /webhooks/stripe/payment (Future Phase)

Handle payment-related Stripe webhook events (payment intent and charge events).

**Status**: Not yet implemented (defined but no handler)

**Supported Event Types**:
- payment_intent.created
- payment_intent.updated
- payment_intent.succeeded
- payment_intent.payment_failed
- charge.created
- charge.updated
- charge.succeeded
- charge.failed
- charge.refunded

**To Implement**:
1. Define Zod schema in `src/schemas/payment.ts`
2. Create handler function: `async (event, stripe, c) => { ... }`
3. Pass handler to `createWebhookHandler('Payment', handler)`
4. Configure webhook in Stripe dashboard
5. Test with `stripe trigger payment_intent.succeeded`

---

### POST /webhooks/stripe/subscription (Future Phase)

Handle subscription lifecycle and invoice Stripe webhook events.

**Status**: Not yet implemented

**Supported Event Types**:
- customer.subscription.created
- customer.subscription.updated
- customer.subscription.deleted
- invoice.created
- invoice.updated
- invoice.paid
- invoice.payment_failed
- invoice.payment_succeeded

---

### POST /webhooks/stripe/customer (Future Phase)

Handle customer account Stripe webhook events.

**Status**: Not yet implemented

**Supported Event Types**:
- customer.created
- customer.updated
- customer.deleted

---

### POST /webhooks/stripe/connect (Future Phase)

Handle Stripe Connect account events.

**Status**: Not yet implemented

**Supported Event Types**:
- account.created
- account.updated
- account.external_account.created
- account.external_account.updated
- capability.updated
- person.created
- person.updated

---

### POST /webhooks/stripe/dispute (Future Phase)

Handle payment dispute and fraud warning events.

**Status**: Not yet implemented

**Supported Event Types**:
- charge.dispute.created
- charge.dispute.updated
- charge.dispute.closed
- radar.early_fraud_warning.created
- radar.early_fraud_warning.updated

---

### GET /health

Detailed health check endpoint for monitoring.

**Authentication**: None

**Rate Limiting**: None

**Path**: GET `/health`

**Response (200 OK)** (all dependencies healthy):
```json
{
  "status": "healthy",
  "worker": "ecom-api",
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
  "timestamp": "2025-12-14T10:30:00.000Z"
}
```

**Response (503 Service Unavailable)** (one or more dependencies unhealthy):
```json
{
  "status": "unhealthy",
  "worker": "ecom-api",
  "version": "1.0.0",
  "checks": {
    "database": {
      "status": "unhealthy",
      "error": "Connection timeout"
    },
    "rate-limit-kv": {
      "status": "healthy",
      "latency": 2
    }
  },
  "timestamp": "2025-12-14T10:30:00.000Z"
}
```

**Checks Performed**:
- **database**: Executes test query on PostgreSQL
- **rate-limit-kv**: Writes test key to Cloudflare KV

---

### GET /

Simple health check endpoint (no detailed checks).

**Response (200 OK)**:
```json
{
  "status": "ok",
  "service": "ecom-api"
}
```

---

## Core Services

### PurchaseService

Main service for purchase operations. Provided by `@codex/purchase` package.

**Location**: `packages/purchase/src/services/purchase.ts`

**Initialization**:
```typescript
import { createStripeClient, PurchaseService } from '@codex/purchase';
import { dbHttp } from '@codex/database';

const stripe = createStripeClient(env.STRIPE_SECRET_KEY);
const purchaseService = new PurchaseService(
  {
    db: dbHttp,  // or transaction-capable db from createPerRequestDbClient()
    environment: env.ENVIRONMENT || 'development'
  },
  stripe
);
```

**Key Methods**:

#### createCheckoutSession(input, customerId): Promise<CheckoutSession>

Create Stripe Checkout session for content purchase.

**Parameters**:
```typescript
{
  contentId: string;
  successUrl: string;
  cancelUrl: string;
}
```

**Returns**:
```typescript
{
  sessionUrl: string;
  sessionId: string;
}
```

**Validates**:
- Content exists and is published
- Content has price > 0
- User hasn't already purchased content
- URLs are valid absolute URLs

**Throws**:
- `NotFoundError` - Content doesn't exist or not published
- `ContentNotPurchasableError` - Content has no price or already purchased
- `PaymentProcessingError` - Stripe API failure

---

#### completePurchase(paymentIntentId, metadata): Promise<Purchase>

Record completed purchase atomically (creates purchase + grants access in transaction).

**Parameters**:
```typescript
paymentIntentId: string;  // Stripe Payment Intent ID
{
  customerId: string;
  contentId: string;
  organizationId?: string | null;
  amountPaidCents: number;
  currency: string;
}
```

**Returns**:
```typescript
{
  id: string;
  stripePaymentIntentId: string;
  customerId: string;
  contentId: string;
  organizationId: string | null;
  amountPaidCents: number;
  currency: string;
  status: "completed" | "refunded" | "failed";
  purchasedAt: string;
  // ... additional fields
}
```

**Behavior**:
- Idempotent: duplicate calls with same paymentIntentId return existing purchase
- Atomic: purchase and access grant happen in single transaction
- Calculates revenue split (configurable in service)
- Inserts access record to contentAccess table
- Soft-deletes duplicate access records if exists

**Throws**:
- `NotFoundError` - Content doesn't exist
- `PaymentProcessingError` - Transaction failure

---

#### getPurchaseHistory(userId, options): Promise<PaginatedResult<PurchaseWithContent>>

Get paginated list of user's purchases.

**Parameters**:
```typescript
userId: string;
{
  page?: number;
  limit?: number;
  status?: "completed" | "refunded" | "failed";
  contentId?: string;
}
```

**Returns**:
```typescript
{
  items: PurchaseWithContent[];
  page: number;
  limit: number;
  total: number;
}
```

---

#### getPurchase(purchaseId, userId): Promise<Purchase>

Get single purchase (scoped to userId).

**Throws**:
- `NotFoundError` - Purchase doesn't exist
- `ForbiddenError` - Purchase belongs to different user

---

## Integration Points

### Service Dependencies

The ecom-api worker depends on these service packages:

| Package | Module | Purpose | Used For |
|---------|--------|---------|----------|
| @codex/purchase | PurchaseService, createStripeClient, verifyWebhookSignature | Purchase management, Stripe integration | Checkout, webhook processing |
| @codex/database | dbHttp, createPerRequestDbClient | Database access | Querying/inserting purchases, content, access records |
| @codex/security | rateLimit, securityHeaders | Rate limiting, security middleware | Webhook rate limiting (1000 req/min), security headers |
| @codex/worker-utils | createAuthenticatedHandler, withPolicy, createHealthCheckHandler | Worker utilities | Route handlers, health checks, error handling |
| @codex/observability | ObservabilityClient | Logging and metrics | Request tracking, error logging, event logging |
| @codex/validation | createCheckoutSchema, purchaseQuerySchema, checkoutSessionMetadataSchema | Input validation | Request body/query validation, metadata validation |
| @codex/shared-types | HonoEnv, SingleItemResponse, PaginatedListResponse, Bindings | Type definitions | Environment types, response types |
| stripe | Stripe SDK | Payment processing | Checkout sessions, signature verification, event types |
| hono | Hono framework | Web framework | HTTP routing, middleware, context |

### External Service Dependencies

| Service | Binding | Purpose | Used For |
|---------|---------|---------|----------|
| Stripe API | STRIPE_SECRET_KEY | Payment processing | Creating checkout sessions |
| Stripe API | STRIPE_WEBHOOK_SECRET_BOOKING (+ others) | Webhook security | Verifying webhook signatures |
| Neon PostgreSQL | DATABASE_URL | Data persistence | Storing purchases, access records, webhook logs |
| Cloudflare KV | RATE_LIMIT_KV | Rate limiting storage | Tracking request counts per IP/user |

### Data Flow (Checkout)

```
Frontend
  ↓
POST /checkout/create (authenticated)
  ├─ Validate session (Auth Worker)
  ├─ Validate input (Zod schema)
  └─ PurchaseService.createCheckoutSession()
       ├─ Load content from PostgreSQL
       ├─ Validate: exists, published, has price
       ├─ Check: user hasn't purchased before
       └─ Stripe.checkout.sessions.create()
           └─ Returns session URL + ID
       ↓
  Response: { sessionUrl, sessionId }
  ↓
Frontend: Redirect to Stripe Checkout (sessionUrl)
  ↓
User: Complete payment on Stripe
```

### Data Flow (Webhook)

```
Stripe Servers
  ↓
POST /webhooks/stripe/booking (webhook)
  ├─ Verify Stripe signature (HMAC-SHA256)
  ├─ Extract event: checkout.session.completed
  └─ handleCheckoutCompleted()
       ├─ Extract metadata: customerId, contentId, amount
       ├─ Validate metadata (Zod)
       ├─ PurchaseService.completePurchase()
       │   ├─ Create purchase record (idempotent)
       │   ├─ Calculate revenue split
       │   └─ Grant access via contentAccess table
       └─ Log success
       ↓
  Response: 200 OK (always)
  ↓
PostgreSQL
  ├─ purchases table: new row
  ├─ contentAccess table: new row
  └─ observability logs
```

### Session Validation Flow

For authenticated endpoints (POST /checkout/create, GET /purchases):

```
Request with Cookie: codex-session=...
  ↓
withPolicy({ auth: 'required' })
  └─ Extracts session cookie
  └─ Calls Auth Worker: GET /api/auth/session
       └─ Auth Worker validates session in PostgreSQL
       └─ Checks AUTH_SESSION_KV cache (5min TTL)
  ├─ 401: Session invalid/expired → Return 401
  └─ 200: Session valid → Continues
       └─ Sets c.set('user', userData)
       └─ Sets c.set('session', sessionData)
       ↓
createAuthenticatedHandler()
  └─ ctx.user.id available in handler
```

---

## Data Models

### Purchases Table

Stores all purchase records. Used by PurchaseService.

**Schema**:
```typescript
{
  id: string;                    // UUID, primary key
  stripePaymentIntentId: string; // Stripe Payment Intent ID, unique constraint
  customerId: string;            // Codex user ID, foreign key to users.id
  contentId: string;             // Content UUID, foreign key to content.id
  organizationId: string | null; // Optional: organization UUID for org-owned content
  amountPaidCents: number;       // Amount in cents (e.g., 4999 = $49.99)
  currency: string;              // Currency code (e.g., "usd")
  platformFeesCents: number;     // Platform fee portion (configurable, default 10%)
  creatorEarningsCents: number;  // Creator earnings (100% - platform fee)
  status: "completed" | "refunded" | "failed"; // Purchase status
  purchasedAt: Date;             // ISO 8601 timestamp
  refundedAt: Date | null;       // ISO 8601 timestamp if refunded
  createdAt: Date;               // Created timestamp
  updatedAt: Date;               // Last updated timestamp
  deletedAt: Date | null;        // Soft delete timestamp
}
```

**Indexes**:
- PRIMARY KEY (id)
- UNIQUE (stripePaymentIntentId) - ensures idempotency
- FOREIGN KEY (customerId) → users.id
- FOREIGN KEY (contentId) → content.id
- FOREIGN KEY (organizationId) → organizations.id
- INDEX (customerId, purchasedAt DESC) - for purchase history queries

**Constraints**:
- amountPaidCents > 0
- platformFeesCents + creatorEarningsCents = amountPaidCents
- status IN ('completed', 'refunded', 'failed')
- currency IN ('usd') [additional currencies future]

---

### ContentAccess Table

Tracks which users have access to which content (via purchase or membership).

**Schema** (subset relevant to purchases):
```typescript
{
  id: string;                    // UUID, primary key
  userId: string;                // User ID, foreign key to users.id
  contentId: string;             // Content UUID, foreign key to content.id
  accessType: "free" | "purchased" | "members_only"; // How user got access
  purchaseId: string | null;     // Purchase UUID if accessType="purchased"
  grantedAt: Date;               // ISO 8601 timestamp
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
```

**Constraints**:
- UNIQUE (userId, contentId) - one access record per user per content
- If accessType="purchased": purchaseId must be non-null and valid
- If accessType="free" or "members_only": purchaseId must be null

**Created By**:
- PurchaseService.completePurchase() - inserts with accessType="purchased"

---

### Webhook Events Table (Future)

For audit trail and idempotency:

**Planned Schema**:
```typescript
{
  id: string;                    // UUID, primary key
  stripeEventId: string;         // Stripe Event ID, unique constraint
  eventType: string;             // Event type (e.g., "checkout.session.completed")
  status: "received" | "processing" | "completed" | "failed";
  metadata: JSONB;               // Full event data
  processedAt: Date | null;      // When handler completed
  errorMessage: string | null;   // Error details if failed
  createdAt: Date;
}
```

---

## Error Handling

### Error Classes

Errors thrown by services and caught by worker middleware:

| Error Class | Status | Cause | Returned Message |
|---|---|---|---|
| ValidationError | 400 | Input validation failed | "Invalid input: {details}" |
| NotFoundError | 404 | Resource doesn't exist | "Not found" |
| ForbiddenError | 403 | User lacks permission | "Access denied" |
| ConflictError | 409 | Duplicate/conflict | "Conflict" |
| AlreadyPurchasedError | 409 | User already purchased | "Already purchased" |
| ContentNotPurchasableError | 400 | Content not for sale | "Not purchasable" |
| PaymentProcessingError | 502 | Stripe API failure | "Payment processing failed" |
| InternalServiceError | 500 | Unexpected error | "Internal server error" |

All errors are caught by the error handler middleware and mapped to standardized HTTP responses via `mapErrorToResponse()`.

### Error Response Format

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  },
  "requestId": "uuid",
  "timestamp": "2025-12-14T10:30:00Z"
}
```

### Webhook Error Handling

Webhook handlers catch errors and return 200 OK (prevents Stripe retries):

```typescript
try {
  await handler(event, stripe, c);
  return c.json({ received: true });
} catch (error) {
  obs.error('Handler error', { error: error.message });
  return c.json({ received: true, error: 'Handler error' });  // Still 200!
}
```

Errors are logged to observability for manual investigation.

### Signature Verification Errors

| Status | Cause | Resolution |
|---|---|---|
| 400 | Missing stripe-signature header | Verify Stripe is configured to send webhooks |
| 401 | Invalid signature (tampering) | Verify webhook secret is correct |
| 500 | STRIPE_SECRET_KEY or webhook secret not configured | Set environment variables |

---

## Security Model

### Authentication

**Authenticated Endpoints** (POST /checkout/create, GET /purchases):
- Requires `codex-session` cookie
- Validates session via Auth Worker
- Auth Worker checks:
  - Session exists in PostgreSQL
  - Session not expired
  - User ID extracted from session
- Cached in AUTH_SESSION_KV (5 minute TTL)

**Webhook Endpoints**:
- No session required
- Stripe HMAC-SHA256 signature verification required
- Signature algorithm: HMAC-SHA256(raw_body, webhook_secret)
- Stripe SDK handles verification via `constructEvent()`

### Authorization

**Scoping** (authenticated endpoints):
- User can only operate on their own resources
- `createCheckoutSession()` uses authenticated user ID
- `getPurchaseHistory()` filters to authenticated user ID only
- `getPurchase()` verifies purchase belongs to authenticated user

**Webhook Authorization**:
- No per-user authorization (Stripe signature is authorization)
- completePurchase() writes purchase for user from webhook metadata
- Trusted because Stripe signature is verified

### Rate Limiting

| Endpoint | Limit | Key | Window | Exceeded Response |
|---|---|---|---|---|
| POST /checkout/create | 10 | User ID | 60s | 429 Too Many Requests |
| GET /purchases | 100 | User ID | 60s | 429 Too Many Requests |
| POST /webhooks/stripe/* | 1000 | IP address | 60s | 429 Too Many Requests |

Implemented via `rateLimit()` middleware using Cloudflare KV store.

### Input Validation

All inputs validated via Zod schemas before reaching handlers:

**Checkout Request Body**:
```typescript
createCheckoutSchema = z.object({
  contentId: z.string().uuid(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url()
});
```

**Purchase Query Parameters**:
```typescript
purchaseQuerySchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  status: z.enum(['completed', 'refunded', 'failed']).optional(),
  contentId: z.string().uuid().optional()
});
```

**Checkout Session Metadata**:
```typescript
checkoutSessionMetadataSchema = z.object({
  customerId: z.string().uuid(),
  contentId: z.string().uuid(),
  organizationId: z.string().uuid().nullable().optional()
});
```

Schema validation failures return 400 Bad Request with field-level error details.

### Security Headers

Applied by `createStandardMiddlewareChain()` to all responses:

| Header | Value | Purpose |
|---|---|---|
| X-Content-Type-Options | nosniff | Prevent MIME sniffing attacks |
| X-Frame-Options | DENY | Prevent clickjacking |
| Referrer-Policy | strict-origin-when-cross-origin | Limit referrer leakage |
| Content-Security-Policy | (API preset) | Restrict resource loading |
| Strict-Transport-Security | max-age=31536000; includeSubDomains | Force HTTPS (production) |

### Stripe Signature Verification (Critical)

Located in `src/middleware/verify-signature.ts`:

**Process**:
1. Extract `stripe-signature` header from request
2. Get raw request body (CRITICAL: before JSON parsing)
3. Call `verifyWebhookSignature()` from Stripe SDK:
   - Extracts timestamp and signature from header
   - Computes expected HMAC-SHA256 signature
   - Compares with received signature
4. On success: event object set in context
5. On failure: return 401 Unauthorized

**Why Raw Body Required**:
Signature is computed over exact raw bytes from Stripe. If body is JSON-parsed and re-stringified, bytes change and signature verification fails.

**Secret Management**:
- Per-endpoint secrets: STRIPE_WEBHOOK_SECRET_PAYMENT, STRIPE_WEBHOOK_SECRET_BOOKING, etc.
- Extracted at middleware based on request path
- Never logged (sensitive)
- Stored as wrangler secrets (encrypted by Cloudflare)

### PII Handling

**What's Logged**:
- Request metadata (method, path, status, duration)
- Error types and messages (without sensitive details)
- Purchase metadata (amounts, statuses)
- Event types and IDs

**What's NOT Logged**:
- Request bodies (passwords, tokens, emails)
- Response bodies with user data
- Stripe raw event data (unless explicitly needed for debugging)
- Full error stack traces in production

**User Data Exposure**:
- Purchase email only returned to authenticated user for their own purchase
- User IDs scoped to authenticated context
- No cross-user data visible

---

## Performance Notes

### Rate Limiting

- Webhook limit (1000 req/min): Accommodates normal Stripe webhook volume while preventing abuse
- Checkout limit (10 req/min): Low limit prevents session spam
- Purchase query limit (100 req/min): Standard API limit

Limits enforced via KV store with atomic increment/expire operations.

### Database Query Performance

**Optimized Queries**:
- Purchase history: Indexed by (customerId, purchasedAt DESC)
- Purchase lookup: Indexed by stripePaymentIntentId (unique)
- Content validation: Indexed by (id, deletedAt) and published status

**Connection Pooling**:
- dbHttp uses HTTP connection pooling (production)
- Per-request db client uses direct connection (webhooks with transactions)
- Connection reuse reduces latency per query

### Signature Verification Latency

- HMAC-SHA256 verification: ~5-10ms
- No database access during verification
- Parallel processing of multiple webhooks

### Caching Strategy

- Auth session cached in AUTH_SESSION_KV (5 minute TTL)
- Reduces load on Auth Worker and PostgreSQL
- Stale session possible but expires on next login

### Webhook Processing

- No blocking operations (all async)
- Database transaction is atomic but may block briefly
- Stripe timeout: ~5 seconds (should complete well before)

To optimize:
- Keep webhook handlers simple
- Defer heavy computation to background jobs
- Batch multiple updates if processing multiple events

---

## Testing

### Unit Tests

Located in `src/index.test.ts` and `src/security.test.ts`.

**Running Tests**:
```bash
pnpm test              # Run once
pnpm test:watch       # Watch mode
pnpm test:coverage    # Coverage report
```

**Test Environment**:
- Runs in Cloudflare Workers runtime (workerd) via `@cloudflare/vitest-pool-workers`
- Access to environment bindings via `cloudflare:test` module
- Isolated from production

**Example Test**:
```typescript
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('Health Check', () => {
  it('should return health status', async () => {
    const response = await SELF.fetch('http://localhost/health');
    expect([200, 503]).toContain(response.status);
    const json = await response.json();
    expect(json.status).toBeDefined();
  });
});
```

### Integration Testing

**Local Testing** (manual):

**1. Checkout Flow**:
```bash
# Start worker
pnpm dev

# Create test user via Auth Worker
curl -X POST http://localhost:42069/api/auth/email/register \
  -H "Content-Type: application/json" \
  -d '{
    "email":"test@example.com",
    "password":"Test123!@#",
    "name":"Test User"
  }' \
  -c cookies.txt

# Login (if needed)
curl -X POST http://localhost:42069/api/auth/email/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!@#"}' \
  -c cookies.txt

# Create test content (via Content-API Worker)
# Then create checkout session
curl -X POST http://localhost:42072/checkout/create \
  -H "Cookie: codex-session=$(cat cookies.txt | grep codex-session | awk '{print $NF}')" \
  -H "Content-Type: application/json" \
  -d '{
    "contentId":"550e8400-e29b-41d4-a716-446655440000",
    "successUrl":"https://example.com/success",
    "cancelUrl":"https://example.com/cancel"
  }'

# Expected: { "data": { "sessionUrl": "...", "sessionId": "..." } }
```

**2. Webhook Testing**:
```bash
# Terminal 1: Start worker
pnpm dev

# Terminal 2: Start Stripe listener
stripe listen --forward-to http://localhost:42072/webhooks/stripe/booking

# Note: Copy the signing secret output by stripe listen
# Export it for use in trigger commands

# Terminal 3: Trigger test event
stripe trigger checkout.session.completed

# Check worker logs for:
# - "Webhook signature verified"
# - "Processing checkout.session.completed"
# - "Purchase completed successfully"
```

**3. Rate Limiting Test**:
```bash
# Exceed rate limit on checkout endpoint
for i in {1..15}; do
  curl -X POST http://localhost:42072/checkout/create \
    -H "Cookie: codex-session=test" \
    -d '{}' \
  -H "Content-Type: application/json"
done

# 11th+ requests should return 429 Too Many Requests
```

### Security Testing

**Stripe Signature Verification**:
```bash
# Test missing signature
curl -X POST http://localhost:42072/webhooks/stripe/booking \
  -H "Content-Type: application/json" \
  -d '{}'
# Expected: 400 Bad Request: Missing signature

# Test invalid signature
curl -X POST http://localhost:42072/webhooks/stripe/booking \
  -H "stripe-signature: t=1234567890,v1=invalid" \
  -H "Content-Type: application/json" \
  -d '{}'
# Expected: 401 Unauthorized
```

**Session Validation**:
```bash
# Test missing session
curl -X POST http://localhost:42072/checkout/create \
  -H "Content-Type: application/json" \
  -d '{ "contentId": "...", "successUrl": "...", "cancelUrl": "..." }'
# Expected: 401 Unauthorized

# Test invalid session
curl -X POST http://localhost:42072/checkout/create \
  -H "Cookie: codex-session=invalid" \
  -H "Content-Type: application/json" \
  -d '{ "contentId": "...", "successUrl": "...", "cancelUrl": "..." }'
# Expected: 401 Unauthorized
```

### Test Utilities

From `@codex/test-utils`:
- `setupTestDatabase()` - Provision test database
- `teardownTestDatabase()` - Clean up test database
- `seedTestUsers()` - Create test user fixtures
- `withNeonTestBranch()` - Ephemeral test database branches

Example:
```typescript
import { setupTestDatabase, seedTestUsers } from '@codex/test-utils';

describe('Purchase', () => {
  beforeEach(async () => {
    await setupTestDatabase();
    const users = await seedTestUsers(1);
    testUserId = users[0].id;
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it('creates purchase', async () => {
    // Test implementation
  });
});
```

---

## Development & Deployment

### Local Development

**Prerequisites**:
```bash
# Node.js 20+ (Cloudflare Workers compatible)
node --version  # >= 20.0.0

# pnpm package manager
npm install -g pnpm

# Stripe CLI (for webhook testing)
brew install stripe/stripe-cli/stripe  # macOS
# or: https://stripe.com/docs/stripe-cli
```

**Setup**:
```bash
cd workers/ecom-api

# Install dependencies
pnpm install

# Create .dev.vars file with local environment
cat > .dev.vars << 'EOF'
ENVIRONMENT=development
DATABASE_URL=postgresql://user:pass@localhost:5432/codex_dev
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET_BOOKING=whsec_test_...
RATE_LIMIT_KV=test-kv
EOF
```

**Running Locally**:
```bash
# Start worker on port 42072
pnpm dev

# In another terminal: forward Stripe webhooks
stripe listen --forward-to http://localhost:42072/webhooks/stripe/booking

# In another terminal: trigger test events
stripe trigger checkout.session.completed
stripe trigger payment_intent.succeeded
```

### Building

```bash
# Build for deployment
pnpm build

# Output: dist/index.js
# This is the compiled worker ready for wrangler deploy
```

### Testing

```bash
# Run tests once
pnpm test

# Watch mode (re-run on file changes)
pnpm test:watch

# Coverage report
pnpm test:coverage
```

### Environment Variables

**Development** (`.dev.vars` or wrangler dev):
```
ENVIRONMENT=development
DATABASE_URL=postgresql://user:pass@localhost:5432/codex_dev
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET_BOOKING=whsec_test_...
STRIPE_WEBHOOK_SECRET_PAYMENT=whsec_test_...
RATE_LIMIT_KV=(local KV)
```

**Staging** (wrangler.jsonc):
```
ENVIRONMENT=staging
API_URL=https://api-staging.revelations.studio
WEB_APP_URL=https://codex-staging.revelations.studio
DB_METHOD=PRODUCTION
```

**Production** (wrangler.jsonc):
```
ENVIRONMENT=production
API_URL=https://api.revelations.studio
WEB_APP_URL=https://codex.revelations.studio
DB_METHOD=PRODUCTION
```

### Secrets Management

Store sensitive values as wrangler secrets (never in wrangler.jsonc):

```bash
# Staging environment
wrangler secret put DATABASE_URL --env staging
wrangler secret put STRIPE_SECRET_KEY --env staging
wrangler secret put STRIPE_WEBHOOK_SECRET_BOOKING --env staging

# Production environment
wrangler secret put DATABASE_URL --env production
wrangler secret put STRIPE_SECRET_KEY --env production
wrangler secret put STRIPE_WEBHOOK_SECRET_BOOKING --env production
```

Secrets are encrypted by Cloudflare and injected at runtime.

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

### Webhook Configuration in Stripe Dashboard

1. Login to https://dashboard.stripe.com
2. Navigate to Settings → Developers → Webhooks
3. Click "Add endpoint"
4. For each webhook type, add endpoint:

| Event Type | URL |
|---|---|
| Booking (checkout.session.completed) | https://ecom-api.revelations.studio/webhooks/stripe/booking |
| Payment (payment_intent.*, charge.*) | https://ecom-api.revelations.studio/webhooks/stripe/payment |
| Subscription (customer.subscription.*, invoice.*) | https://ecom-api.revelations.studio/webhooks/stripe/subscription |
| Customer (customer.*) | https://ecom-api.revelations.studio/webhooks/stripe/customer |
| Connect (account.*, capability.*, person.*) | https://ecom-api.revelations.studio/webhooks/stripe/connect |
| Dispute (charge.dispute.*, radar.early_fraud_warning.*) | https://ecom-api.revelations.studio/webhooks/stripe/dispute |

5. For each endpoint:
   - Copy the "Signing secret" (starts with `whsec_`)
   - Store as wrangler secret: `wrangler secret put STRIPE_WEBHOOK_SECRET_BOOKING --env production`
   - Select which events to receive
   - Click "Create endpoint"

6. Test webhook delivery:
   - Click on endpoint
   - Scroll to "Recent events"
   - Click "Send test webhook"
   - Check that delivery shows "Delivered" (200 status)

---

## File Structure

```
workers/ecom-api/
├── src/
│   ├── index.ts                      # Main worker entry point (Hono app setup)
│   ├── types.ts                      # TypeScript type definitions (StripeWebhookEnv)
│   ├── index.test.ts                 # Worker integration tests
│   ├── security.test.ts              # Security middleware tests
│   │
│   ├── routes/
│   │   ├── checkout.ts               # Checkout session creation (POST /checkout/create)
│   │   └── purchases.ts              # Purchase history/details (GET /purchases/:id)
│   │
│   ├── handlers/
│   │   ├── checkout.ts               # handleCheckoutCompleted() webhook handler
│   │   └── __tests__/
│   │       └── checkout.test.ts      # Checkout handler unit tests
│   │
│   ├── middleware/
│   │   ├── verify-signature.ts       # Stripe signature verification
│   │   └── __tests__/
│   │       └── verify-signature.test.ts  # Signature verification tests
│   │
│   └── utils/
│       ├── webhook-handler.ts        # createWebhookHandler() factory
│       ├── validate-env.ts           # Environment variable validation
│       └── metadata.ts               # Stripe metadata validation utilities
│
├── dist/                             # Build output (generated)
│   └── index.js                      # Compiled worker
│
├── package.json                      # Dependencies and scripts
├── wrangler.jsonc                    # Cloudflare Workers configuration
├── tsconfig.json                     # TypeScript configuration
├── vitest.config.ts                  # Vitest configuration
├── vite.config.ts                    # Vite build configuration
└── CLAUDE.md                         # This documentation
```

---

## Common Tasks

### Add New Webhook Handler

**Goal**: Process payment_intent.succeeded events

**Steps**:

1. **Create handler function** in `src/handlers/payment.ts`:
```typescript
import type { Context } from 'hono';
import type Stripe from 'stripe';
import type { StripeWebhookEnv } from '../types';

export async function handlePaymentSucceeded(
  event: Stripe.Event,
  stripe: Stripe,
  c: Context<StripeWebhookEnv>
) {
  const obs = c.get('obs');
  const paymentIntent = event.data.object as Stripe.PaymentIntent;

  obs.info('Processing payment.succeeded', {
    id: paymentIntent.id,
    amount: paymentIntent.amount
  });

  // Add your logic here
  // e.g., update payment status, send email, etc.
}
```

2. **Wire handler** in `src/index.ts`:
```typescript
import { handlePaymentSucceeded } from './handlers/payment';

app.post(
  '/webhooks/stripe/payment',
  verifyStripeSignature(),
  createWebhookHandler('Payment', handlePaymentSucceeded)
);
```

3. **Test locally**:
```bash
stripe listen --forward-to http://localhost:42072/webhooks/stripe/payment
stripe trigger payment_intent.succeeded
```

4. **Deploy and configure**:
```bash
pnpm deploy --env production
# Then configure webhook in Stripe dashboard
```

---

### Debug Webhook Issues

**Symptom**: Webhook not being received

**Troubleshooting**:
```bash
# 1. Check worker logs
wrangler tail --env production

# 2. Verify webhook endpoint in Stripe dashboard
# Dashboard → Settings → Webhooks → Click endpoint → Recent events

# 3. Check if event was sent and response status
# Look for "Delivered" (200) or "Failed" (non-200)

# 4. If 401 Unauthorized: Signature verification failed
# - Verify webhook secret is correct
# - Check that secret matches what's in wrangler secret

# 5. If 400 Bad Request: Missing signature header
# - This shouldn't happen with Stripe, indicates misconfiguration

# 6. If handler error but 200 returned: Check error logs
# - Error logged to observability but webhook still acknowledged
# - Look in Cloudflare observability for error details
```

---

### Increase Rate Limits

**Goal**: Allow more checkout requests during flash sale

**Steps**:

1. **Update in src/routes/checkout.ts**:
```typescript
checkout.post('/create',
  withPolicy({
    auth: 'required',
    rateLimit: 'api'  // Change from 'auth' (10/min) to 'api' (100/min)
  }),
  // ... rest of handler
);
```

Or create custom rate limit:
```typescript
import { rateLimit, RATE_LIMIT_PRESETS } from '@codex/security';

checkout.post('/create',
  async (c, next) => {
    return rateLimit({
      kv: c.env.RATE_LIMIT_KV,
      maxRequests: 50,  // Custom limit
      windowMs: 60 * 1000
    })(c, next);
  },
  withPolicy({ auth: 'required' }),
  // ... rest
);
```

2. **Deploy and verify**:
```bash
pnpm deploy --env production

# Test new limit
for i in {1..60}; do
  curl -X POST https://ecom-api.revelations.studio/checkout/create ...
done
```

---

### Monitor Webhook Health

**Using Stripe Dashboard**:
1. Settings → Webhooks → Click endpoint
2. "Recent events" tab shows delivery status
3. Red "Failed" indicates issues

**Using Worker Logs**:
```bash
wrangler tail --env production | grep webhook
```

**Metrics to Monitor**:
- Webhook delivery success rate (% delivered vs failed)
- Processing latency (time from receipt to completion)
- Error rate (% handler errors)

---

## References

**Stripe Documentation**:
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- [Webhook Signatures](https://stripe.com/docs/webhooks/signatures)
- [Checkout Session API](https://stripe.com/docs/api/checkout/sessions/create)
- [Payment Intent API](https://stripe.com/docs/api/payment_intents)

**Codex Platform**:
- [@codex/purchase Documentation](../../packages/purchase/CLAUDE.md)
- [@codex/database Documentation](../../packages/database/CLAUDE.md)
- [@codex/worker-utils Documentation](../../packages/worker-utils/CLAUDE.md)
- [@codex/security Documentation](../../packages/security/CLAUDE.md)

**Frameworks & Tools**:
- [Hono Documentation](https://hono.dev/)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [Stripe CLI](https://stripe.com/docs/stripe-cli)
- [Zod Validation](https://zod.dev/)

**External Services**:
- [Stripe API Reference](https://stripe.com/docs/api)
- [Stripe Test Mode](https://stripe.com/docs/testing)
- [Stripe Signing Secrets](https://dashboard.stripe.com/apikeys)

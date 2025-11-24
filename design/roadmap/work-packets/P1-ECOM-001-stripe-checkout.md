# P1-ECOM-001: Stripe Checkout Integration

**Priority**: P0 (Critical - revenue generation)
**Status**: 🚧 Not Implemented
**Estimated Effort**: 4-5 days

---

## Table of Contents

- [Overview](#overview)
- [System Context](#system-context)
- [Database Schema](#database-schema)
- [Service Architecture](#service-architecture)
- [Implementation Patterns](#implementation-patterns)
- [API Integration](#api-integration)
- [Available Patterns & Utilities](#available-patterns--utilities)
- [Dependencies](#dependencies)
- [Implementation Checklist](#implementation-checklist)
- [Testing Strategy](#testing-strategy)
- [Notes](#notes)

---

## Overview

Stripe Checkout Integration enables creators to monetize their content by accepting one-time payments for content access. This service creates Stripe Checkout sessions, tracks purchase records, and enables content access after successful payment.

The checkout flow bridges content discovery with payment processing. When a customer wants to purchase paid content, this service creates a Stripe-hosted checkout page, handles the payment redirect flow, and records the completed purchase in the database for access control verification.

Key capabilities:
- **Checkout Session Creation**: Generate Stripe Checkout sessions with content pricing and customer info
- **Purchase Recording**: Create purchase records after successful payment (via webhook from P1-ECOM-002)
- **Idempotency**: Prevent duplicate purchases using Stripe Payment Intent ID as unique identifier
- **Revenue Tracking**: Calculate and store revenue splits (Phase 1: 100% to creator, future: platform/org fees)
- **Purchase Verification**: Query purchases to verify content access (consumed by P1-ACCESS-001)

This service is consumed by:
- **Frontend**: Creates checkout sessions when user clicks "Purchase"
- **Access Control** (P1-ACCESS-001): Verifies purchase exists before granting streaming access
- **Stripe Webhooks** (P1-ECOM-002): Completes purchase after payment success event
- **Admin Dashboard** (P1-ADMIN-001): Displays revenue analytics and purchase history

---

## System Context

### Upstream Dependencies

**Content Service** (P1-CONTENT-001) (✅ Complete):
- Queries `content` table to get pricing (`priceCents`)
- Verifies content exists and is published before creating checkout
- Reads creator ID for revenue routing

**Stripe API** (External Service):
- Creates Checkout Sessions via Stripe SDK
- Redirects customer to Stripe-hosted payment page
- Sends webhooks on payment completion (handled by P1-ECOM-002)

**Auth Service** (✅ Available):
- Provides authenticated customer context (user ID, email)
- Session validation for checkout endpoints

### Downstream Consumers

**Stripe Webhooks** (P1-ECOM-002):
- Receives `checkout.session.completed` event from Stripe
- Creates purchase record using `PurchaseService.completePurchase()`
- Integration: Webhook handler calls purchase service after signature verification

**Access Control** (P1-ACCESS-001):
- Queries `purchases` table to verify customer has purchased content
- Purchase must have `status = 'completed'` for access
- Integration: Access service checks for purchase record before streaming URL generation

**Admin Dashboard** (P1-ADMIN-001):
- Displays revenue analytics (total sales, revenue splits)
- Shows purchase history per creator
- Integration: Queries purchases table with aggregations

### External Services

**Stripe**: Payment processing, checkout sessions, webhooks
**Neon PostgreSQL**: Purchase records and revenue tracking
**Cloudflare Workers**: Checkout API and webhook handler

### Integration Flow

```
Customer clicks "Purchase"
    ↓
POST /api/checkout (create session)
    ↓
Checkout Service validates content + pricing
    ↓
Create Stripe Checkout Session
    ↓
Return session URL to frontend
    ↓
Frontend redirects to Stripe
    ↓
Customer completes payment on Stripe
    ↓
Stripe sends webhook (checkout.session.completed)
    ↓
Webhook Handler (P1-ECOM-002) creates purchase record
    ↓
Access Control grants streaming access
```

---

## Database Schema

### Tables

#### `purchases`

**Purpose**: One-time content purchase records linking customers to purchased content. Enables access verification and revenue tracking.

**Key Fields**:
- `id` (text, PK): Unique purchase identifier
- `customerId` (text, FK → users.id): Purchasing customer
- `contentId` (text, FK → content.id): Purchased content
- `amountPaidCents` (integer): Total paid by customer in cents (e.g., 999 = $9.99)
- `currency` (text): Currency code (default: 'usd')
- `stripePaymentIntentId` (text, unique): Stripe Payment Intent ID (idempotency key)
- `status` (text): 'pending' | 'completed' | 'refunded' | 'failed'
- `platformFeeCents` (integer): Platform fee (Phase 1: 0, Phase 2+: configurable)
- `organizationFeeCents` (integer): Org fee (Phase 1: 0, Phase 2+: configurable)
- `creatorPayoutCents` (integer): Creator payout (Phase 1: 100% of amount)
- `purchasedAt` (timestamp): When payment completed
- `refundedAt`, `refundReason`, `refundAmountCents`, `stripeRefundId`: Refund tracking
- `createdAt`, `updatedAt`: Timestamps

**Constraints**:
- Primary Key: `id`
- Foreign Keys:
  - `customerId` → `users.id`
  - `contentId` → `content.id`
- Unique: `stripePaymentIntentId` (prevents duplicate purchases)
- Unique: `(customerId, contentId)` WHERE `status = 'completed'` (one purchase per customer per content)
- Check: `amountPaidCents = platformFeeCents + organizationFeeCents + creatorPayoutCents` (revenue must add up)
- Check: `amountPaidCents >= 0`
- Check: `status` IN ('pending', 'completed', 'refunded', 'failed')

**Indexes**:
- `idx_purchases_customer_id` ON `customerId`: Customer purchase history
- `idx_purchases_content_id` ON `contentId`: Content purchase count
- `idx_purchases_status` ON `status`: Filter by purchase status
- `idx_purchases_stripe_payment_intent_id` ON `stripePaymentIntentId`: Idempotency lookups

**Phase 1 Revenue Model**:
```
amountPaidCents = creatorPayoutCents
platformFeeCents = 0
organizationFeeCents = 0
```

**Future Phases**:
- Phase 2: Platform takes percentage fee
- Phase 3: Stripe Connect automated payouts

### Relationships

```
users (1) ─────< purchases (N)
  └─ customerId (customer who purchased)

content (1) ─────< purchases (N)
  └─ contentId (what was purchased)
```

### Migration Considerations

**Manual Steps Required**:
- CHECK constraints must be added manually to migration SQL
- Partial unique index: `WHERE status = 'completed' AND refundedAt IS NULL`
- Verify revenue split adds up: `amount = platform + org + creator`

**Idempotency Pattern**:
```sql
-- Prevent duplicate purchases with same Payment Intent ID
CREATE UNIQUE INDEX idx_purchases_stripe_payment_intent_unique
ON purchases (stripe_payment_intent_id);

-- Prevent multiple completed purchases for same customer + content
CREATE UNIQUE INDEX idx_no_duplicate_purchases
ON purchases (customer_id, content_id)
WHERE status = 'completed' AND refunded_at IS NULL;
```

---

## Service Architecture

### Service Responsibilities

**PurchaseService** (extends `BaseService` from `@codex/service-errors`):
- **Primary Responsibility**: Manage purchase lifecycle from checkout to completion
- **Key Operations**:
  - `createCheckoutSession(contentId, customerId)`: Create Stripe checkout session
  - `completePurchase(paymentIntentId)`: Record completed purchase (called by webhook)
  - `verifyPurchase(contentId, customerId)`: Check if customer has purchased content
  - `getPurchaseHistory(customerId, filters)`: List customer's purchases
  - `refundPurchase(purchaseId, reason)`: Process refund (Phase 2+)

### Key Business Rules

1. **Content Pricing Validation**:
   - Content must exist and be published (`status = 'published'`, `deletedAt IS NULL`)
   - Content must have `priceCents > 0` (cannot checkout free content)
   - Content must not already be purchased by customer

2. **Checkout Session Creation**:
   - Read content pricing from `content.priceCents`
   - Create Stripe Checkout Session with content details
   - Mode: 'payment' (one-time purchase, not subscription)
   - Success/cancel URLs redirect back to frontend
   - Customer email pre-filled from auth context

3. **Purchase Completion** (via webhook):
   - Extract `paymentIntentId` from Stripe event
   - Create purchase record with `status = 'completed'`
   - Calculate revenue split (Phase 1: 100% creator, 0% platform/org)
   - Set `purchasedAt` timestamp
   - Idempotency: If payment intent already recorded, return existing purchase

4. **Purchase Verification** (for access control):
   - Query: `WHERE customerId = ? AND contentId = ? AND status = 'completed'`
   - Returns boolean: has purchase or not
   - Used by access service before granting streaming URL

### Design Patterns

#### Pattern 1: Service Factory with Stripe SDK

**Problem**: Stripe SDK needs API key from environment, service needs dependency injection

**Solution**: Factory function that initializes both service and Stripe client

```typescript
// Base service class (all services extend this)
export abstract class BaseService {
  protected db: DrizzleDB;
  protected environment: string;

  constructor(config: ServiceConfig) {
    this.db = config.db;
    this.environment = config.environment;
  }
}

// Purchase service extends BaseService + adds Stripe client
export class PurchaseService extends BaseService {
  private stripe: Stripe;

  constructor(config: ServiceConfig & { stripeSecretKey: string }) {
    super(config); // Call BaseService constructor
    this.stripe = new Stripe(config.stripeSecretKey, {
      apiVersion: '2024-11-20.acacia', // Use latest API version
    });
  }

  // Service methods use this.stripe and this.db
}

// Factory function creates service with all dependencies
export function createPurchaseService(env: {
  DATABASE_URL: string;
  STRIPE_SECRET_KEY: string;
  ENVIRONMENT: string;
}): PurchaseService {
  const db = getDatabaseClient(env.DATABASE_URL);

  return new PurchaseService({
    db,
    environment: env.ENVIRONMENT,
    stripeSecretKey: env.STRIPE_SECRET_KEY,
  });
}
```

#### Pattern 2: Idempotent Purchase Recording

**Problem**: Webhook may be called multiple times with same payment intent

**Solution**: Use payment intent ID as idempotency key with database unique constraint

```typescript
async completePurchase(paymentIntentId: string): Promise<Purchase> {
  // Step 1: Check if purchase already recorded (idempotency)
  const existing = await this.db.query.purchases.findFirst({
    where: eq(purchases.stripePaymentIntentId, paymentIntentId),
  });

  if (existing) {
    // Already processed, return existing record
    return existing;
  }

  // Step 2: Fetch Stripe Payment Intent for details
  const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);

  // Step 3: Extract metadata (contentId stored when creating checkout)
  const contentId = paymentIntent.metadata.contentId;
  const customerId = paymentIntent.metadata.customerId;

  // Step 4: Get content to calculate revenue split
  const content = await this.db.query.content.findFirst({
    where: eq(content.id, contentId),
  });

  if (!content) {
    throw new NotFoundError(`Content ${contentId} not found`);
  }

  // Step 5: Calculate revenue split (Phase 1: simple)
  const amountPaidCents = paymentIntent.amount; // Stripe stores in cents
  const platformFeeCents = 0; // Phase 1: no platform fee
  const organizationFeeCents = 0; // Phase 1: no org fee
  const creatorPayoutCents = amountPaidCents; // Phase 1: 100% to creator

  // Step 6: Insert purchase record (atomic)
  const [purchase] = await this.db.insert(purchases).values({
    customerId,
    contentId,
    stripePaymentIntentId: paymentIntentId,
    amountPaidCents,
    currency: paymentIntent.currency,
    platformFeeCents,
    organizationFeeCents,
    creatorPayoutCents,
    status: 'completed',
    purchasedAt: new Date(),
  }).returning();

  return purchase;
}
```

#### Pattern 3: Content Validation Pipeline

**Problem**: Multiple validation checks before creating checkout

**Solution**: Validation pipeline with early returns and specific errors

```typescript
async createCheckoutSession(
  contentId: string,
  customerId: string,
  successUrl: string,
  cancelUrl: string
): Promise<{ sessionUrl: string; sessionId: string }> {
  // Validation Pipeline

  // 1. Validate content exists and is published
  const content = await this.db.query.content.findFirst({
    where: and(
      eq(content.id, contentId),
      eq(content.status, 'published'),
      isNull(content.deletedAt)
    ),
  });

  if (!content) {
    throw new NotFoundError('Content not found or not published');
  }

  // 2. Validate content has a price
  if (!content.priceCents || content.priceCents <= 0) {
    throw new ValidationError('Cannot create checkout for free content');
  }

  // 3. Check if customer already purchased
  const existingPurchase = await this.db.query.purchases.findFirst({
    where: and(
      eq(purchases.customerId, customerId),
      eq(purchases.contentId, contentId),
      eq(purchases.status, 'completed')
    ),
  });

  if (existingPurchase) {
    throw new ConflictError('Customer has already purchased this content');
  }

  // 4. Create Stripe Checkout Session
  const session = await this.stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: content.title,
          description: content.description || undefined,
        },
        unit_amount: content.priceCents, // Stripe expects cents
      },
      quantity: 1,
    }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: customerId, // Pre-fill from auth context
    metadata: {
      contentId,
      customerId,
    },
  });

  return {
    sessionUrl: session.url!,
    sessionId: session.id,
  };
}
```

### Error Handling Approach

**Custom Error Classes** (extend base errors from `@codex/service-errors`):
- `ContentNotFoundError`: Content doesn't exist or isn't published → HTTP 404
- `ValidationError`: Free content, invalid pricing → HTTP 400
- `AlreadyPurchasedError`: Customer already owns content → HTTP 409
- `StripeError`: Stripe API failure → HTTP 502 (Bad Gateway)

**Error Propagation**:
- Service throws specific error classes
- Worker catches via `mapErrorToResponse()` from `@codex/service-errors`
- Frontend receives actionable error messages

### Transaction Boundaries

**Operations requiring `db.transaction()`**:
- None in Phase 1 (all operations are single inserts)
- Future: Refund processing (update purchase + create refund record)

**Single-operation methods**:
- `completePurchase()`: Single INSERT (idempotent via unique constraint)
- `verifyPurchase()`: Single SELECT
- `getPurchaseHistory()`: Single SELECT with joins

---

## Implementation Patterns

### Pseudocode: Create Checkout Session

```
FUNCTION createCheckoutSession(contentId, customerId, successUrl, cancelUrl):
  // Step 1: Validate inputs
  VALIDATE contentId is UUID
  VALIDATE customerId is UUID
  VALIDATE successUrl is valid URL
  VALIDATE cancelUrl is valid URL

  // Step 2: Fetch content from database
  content = DATABASE.query(
    SELECT * FROM content
    WHERE id = contentId
      AND status = 'published'
      AND deleted_at IS NULL
  )

  IF content is NULL:
    THROW ContentNotFoundError("Content not found")
  END IF

  // Step 3: Validate content is purchasable
  IF content.priceCents <= 0 OR content.priceCents IS NULL:
    THROW ValidationError("Content is free, cannot create checkout")
  END IF

  // Step 4: Check for existing purchase
  existingPurchase = DATABASE.query(
    SELECT * FROM purchases
    WHERE customer_id = customerId
      AND content_id = contentId
      AND status = 'completed'
    LIMIT 1
  )

  IF existingPurchase exists:
    THROW AlreadyPurchasedError("Already purchased")
  END IF

  // Step 5: Create Stripe Checkout Session
  stripeSession = STRIPE_API.createCheckoutSession({
    mode: 'payment',
    lineItems: [{
      priceData: {
        currency: 'usd',
        productData: {
          name: content.title,
          description: content.description
        },
        unitAmount: content.priceCents
      },
      quantity: 1
    }],
    successUrl: successUrl,
    cancelUrl: cancelUrl,
    customerEmail: getCustomerEmail(customerId),
    metadata: {
      contentId: contentId,
      customerId: customerId
    }
  })

  // Step 6: Return session URL for frontend redirect
  RETURN {
    sessionUrl: stripeSession.url,
    sessionId: stripeSession.id
  }
END FUNCTION
```

### Pseudocode: Complete Purchase (Webhook Handler)

```
FUNCTION completePurchase(paymentIntentId):
  // Step 1: Idempotency check
  existingPurchase = DATABASE.query(
    SELECT * FROM purchases
    WHERE stripe_payment_intent_id = paymentIntentId
    LIMIT 1
  )

  IF existingPurchase exists:
    // Already processed, return existing
    RETURN existingPurchase
  END IF

  // Step 2: Fetch Payment Intent from Stripe
  paymentIntent = STRIPE_API.retrievePaymentIntent(paymentIntentId)

  IF paymentIntent.status != 'succeeded':
    THROW ValidationError("Payment intent not succeeded")
  END IF

  // Step 3: Extract metadata
  contentId = paymentIntent.metadata.contentId
  customerId = paymentIntent.metadata.customerId

  // Step 4: Fetch content for creator info
  content = DATABASE.query(
    SELECT * FROM content WHERE id = contentId
  )

  IF content is NULL:
    THROW NotFoundError("Content not found")
  END IF

  // Step 5: Calculate revenue split (Phase 1: simple)
  amountPaidCents = paymentIntent.amount
  platformFeeCents = 0              // Phase 1: no fees
  organizationFeeCents = 0          // Phase 1: no fees
  creatorPayoutCents = amountPaidCents  // Phase 1: 100% to creator

  // Step 6: Insert purchase record
  purchase = DATABASE.insert(purchases, {
    id: generateUUID(),
    customerId: customerId,
    contentId: contentId,
    stripePaymentIntentId: paymentIntentId,
    amountPaidCents: amountPaidCents,
    currency: paymentIntent.currency,
    platformFeeCents: platformFeeCents,
    organizationFeeCents: organizationFeeCents,
    creatorPayoutCents: creatorPayoutCents,
    status: 'completed',
    purchasedAt: NOW(),
    createdAt: NOW(),
    updatedAt: NOW()
  })

  // Step 7: Log purchase for analytics
  LOG.info("Purchase completed", {
    purchaseId: purchase.id,
    customerId: customerId,
    contentId: contentId,
    amountCents: amountPaidCents
  })

  RETURN purchase
END FUNCTION
```

### Pseudocode: Verify Purchase (Access Control)

```
FUNCTION verifyPurchase(contentId, customerId):
  // Simple query to check purchase exists
  purchase = DATABASE.query(
    SELECT id FROM purchases
    WHERE customer_id = customerId
      AND content_id = contentId
      AND status = 'completed'
    LIMIT 1
  )

  RETURN purchase IS NOT NULL
END FUNCTION
```

---

## API Integration

### Endpoints

| Method | Path | Purpose | Security Policy |
|--------|------|---------|-----------------|
| POST | `/api/checkout` | Create Stripe checkout session | `POLICY_PRESETS.authenticated()` |
| GET | `/api/purchases` | List customer's purchases | `POLICY_PRESETS.authenticated()` |
| GET | `/api/purchases/:id` | Get single purchase | `POLICY_PRESETS.authenticated()` |

### Standard Pattern

```typescript
// POST /api/checkout - Create checkout session
app.post('/api/checkout',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedHandler({
    inputSchema: createCheckoutSchema, // Zod validation
    handler: async ({ input, context }) => {
      const service = createPurchaseService(context.env);

      const { sessionUrl, sessionId } = await service.createCheckoutSession(
        input.contentId,
        context.user.id,
        input.successUrl,
        input.cancelUrl
      );

      return { sessionUrl, sessionId };
    }
  })
);

// GET /api/purchases - List purchases
app.get('/api/purchases',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedGetHandler({
    inputSchema: purchaseQuerySchema,
    handler: async ({ input, context }) => {
      const service = createPurchaseService(context.env);

      const purchases = await service.getPurchaseHistory(
        context.user.id,
        input // filters
      );

      return {
        data: purchases.items,
        pagination: purchases.pagination
      };
    }
  })
);
```

### Request/Response Examples

**Create Checkout Request**:
```typescript
POST /api/checkout
{
  "contentId": "abc-123",
  "successUrl": "https://example.com/success",
  "cancelUrl": "https://example.com/cancel"
}
```

**Create Checkout Response**:
```typescript
{
  "sessionUrl": "https://checkout.stripe.com/pay/cs_test_...",
  "sessionId": "cs_test_abc123"
}
```

**List Purchases Response**:
```typescript
{
  "data": [{
    "id": "purchase-123",
    "contentId": "abc-123",
    "content": {
      "title": "Introduction to TypeScript",
      "slug": "intro-typescript"
    },
    "amountPaidCents": 999,
    "currency": "usd",
    "status": "completed",
    "purchasedAt": "2025-01-15T10:30:00Z"
  }],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalCount": 5,
    "totalPages": 1
  }
}
```

---

## Available Patterns & Utilities

### Foundation Packages

#### `@codex/database`

**Query Helpers**:
- `scopedNotDeleted(table, userId)`: Creator scoping (not needed for purchases - no creator scope)
- `withPagination(query, page, pageSize)`: Purchase history pagination

**When to use**: Purchase queries don't use creator scoping (customer scoping instead). Use standard Drizzle queries with `eq(purchases.customerId, userId)`.

---

#### `@codex/service-errors`

**BaseService** (extend this):
```typescript
import { BaseService, type ServiceConfig } from '@codex/service-errors';

export class PurchaseService extends BaseService {
  private stripe: Stripe;

  constructor(config: ServiceConfig & { stripeSecretKey: string }) {
    super(config); // Provides this.db, this.environment
    this.stripe = new Stripe(config.stripeSecretKey);
  }
}
```

**Error Classes**:
- `NotFoundError`: Content not found
- `ValidationError`: Free content, invalid input
- `ConflictError`: Already purchased

**When to use**: Extend BaseService for dependency injection. Throw specific errors for business logic failures.

---

#### `@codex/validation`

**Purchase Schemas** (to be created):
```typescript
// @codex/validation/purchase-schemas.ts
export const createCheckoutSchema = z.object({
  contentId: z.string().uuid(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export const purchaseQuerySchema = z.object({
  status: z.enum(['completed', 'refunded']).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
```

**When to use**: Validate all API inputs. Validation happens in `createAuthenticatedHandler()`.

---

### Utility Packages

#### `@codex/worker-utils`

**Worker Setup**:
```typescript
import { createWorker } from '@codex/worker-utils';

const app = createWorker({
  serviceName: 'checkout-api',
  enableCors: true,
  enableSecurityHeaders: true,
});

// Mount routes
app.route('/api/checkout', checkoutRoutes);
```

**When to use**: Use `createWorker()` for all workers. Use `createAuthenticatedHandler()` for all authenticated routes.

---

#### `@codex/observability`

**Logging**:
```typescript
const obs = new ObservabilityClient('purchase-service', env.ENVIRONMENT);

// Log purchase completion
obs.info('Purchase completed', {
  purchaseId: purchase.id,
  customerId,
  contentId,
  amountCents: purchase.amountPaidCents,
});

// Log Stripe errors
obs.error('Stripe API error', error);
```

**When to use**: Log all purchase events for revenue tracking and debugging.

---

### External SDKs

#### Stripe SDK

**Installation**:
```bash
pnpm add stripe
```

**Usage**:
```typescript
import Stripe from 'stripe';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia',
});

// Create checkout session
const session = await stripe.checkout.sessions.create({ ... });

// Retrieve payment intent (in webhook)
const paymentIntent = await stripe.paymentIntents.retrieve(id);
```

**When to use**: All Stripe API calls. Always use latest API version.

---

## Dependencies

### Required (Blocking)

| Dependency | Status | Description |
|------------|--------|-------------|
| Content Service (P1-CONTENT-001) | ✅ Complete | Need `content` table for pricing and creator info |
| Auth Service | ✅ Available | Customer authentication and context |
| Stripe Account | ✅ Available | Stripe API keys configured |

### Optional (Nice to Have)

| Dependency | Status | Description |
|------------|--------|-------------|
| Stripe Webhooks (P1-ECOM-002) | 🚧 Parallel | Webhook handler completes purchases. Can develop checkout first, webhook second. |

### Infrastructure Ready

- ✅ Database schema tooling (Drizzle ORM)
- ✅ Worker deployment pipeline
- ✅ Stripe SDK support
- ✅ Error handling (@codex/service-errors)
- ✅ Validation (@codex/validation)

---

## Implementation Checklist

- [ ] **Database Setup**
  - [ ] Create `purchases` schema in `packages/database/src/schema/purchases.ts`
  - [ ] Generate migration with CHECK constraints
  - [ ] Add unique constraint on `stripePaymentIntentId`
  - [ ] Add partial unique index on `(customerId, contentId)` WHERE status='completed'
  - [ ] Run migration in development

- [ ] **Service Layer**
  - [ ] Create `packages/purchase/src/services/purchase-service.ts`
  - [ ] Implement `PurchaseService` extending `BaseService`
  - [ ] Add Stripe SDK initialization in constructor
  - [ ] Implement `createCheckoutSession()` method
  - [ ] Implement `completePurchase()` method (for webhook)
  - [ ] Implement `verifyPurchase()` method (for access control)
  - [ ] Implement `getPurchaseHistory()` method
  - [ ] Add custom error classes
  - [ ] Add unit tests with mocked Stripe API

- [ ] **Validation**
  - [ ] Add `createCheckoutSchema` to `@codex/validation`
  - [ ] Add `purchaseQuerySchema`
  - [ ] Add schema tests (100% coverage)

- [ ] **Worker/API**
  - [ ] Create checkout routes or add to existing worker
  - [ ] Implement `POST /api/checkout` endpoint
  - [ ] Implement `GET /api/purchases` endpoint
  - [ ] Implement `GET /api/purchases/:id` endpoint
  - [ ] Apply route-level security
  - [ ] Add integration tests

- [ ] **Integration**
  - [ ] Test checkout session creation end-to-end
  - [ ] Test idempotency (multiple webhook calls)
  - [ ] Test purchase verification (with access service)
  - [ ] Test already-purchased error
  - [ ] Update package documentation

- [ ] **Deployment**
  - [ ] Configure STRIPE_SECRET_KEY in Cloudflare
  - [ ] Update wrangler.jsonc with Stripe bindings
  - [ ] Test in preview environment
  - [ ] Deploy to production

---

## Testing Strategy

### Unit Tests

**Service Layer** (`packages/purchase/src/__tests__/`):
- Test checkout session creation (mock Stripe API)
- Test purchase completion idempotency
- Test revenue split calculation (Phase 1: 100% creator)
- Test validation errors (free content, already purchased)
- Mock database and Stripe SDK

**Validation Layer**:
- 100% coverage for purchase schemas
- Test checkout URL validation
- Test query parameter validation

### Integration Tests

**API Endpoints** (`workers/checkout-api/src/__tests__/`):
- Test checkout endpoint with real database
- Test purchase history endpoint
- Test error responses (404, 409, 400)
- Mock Stripe API calls

### E2E Scenarios

**Successful Purchase Flow**:
1. Customer requests checkout for content
2. Checkout service creates Stripe session
3. Frontend redirects to Stripe
4. Customer completes payment (simulated in test)
5. Webhook receives `checkout.session.completed`
6. Purchase service records completed purchase
7. Access service verifies purchase exists
8. Customer can stream content

**Already Purchased Scenario**:
1. Customer requests checkout for already-owned content
2. Service checks for existing purchase
3. Throws `AlreadyPurchasedError`
4. Frontend receives 409 error
5. Frontend shows "You already own this content"

**Idempotency Scenario**:
1. Webhook receives payment intent ID
2. Purchase service checks if already recorded
3. Finds existing purchase record
4. Returns existing record (no duplicate)

### Local Development Testing

**Tools**:
- `pnpm test`: Run all tests
- `pnpm --filter @codex/purchase test:watch`: Watch mode
- Stripe CLI: `stripe listen --forward-to localhost:8787/webhooks/stripe`
- Mock Stripe API in tests

**Test Data**:
- Seed test content with various prices
- Use Stripe test mode API keys
- Mock successful payment intents

---

## Notes

### Phase 1 Simplifications

**Revenue Split**:
- 100% to creator (`creatorPayoutCents = amountPaidCents`)
- No platform fee (`platformFeeCents = 0`)
- No organization fee (`organizationFeeCents = 0`)

**Future Phases**:
- Phase 2: Configurable platform/org fees
- Phase 3: Stripe Connect automated payouts

### Security Considerations

**Payment Intent ID as Idempotency Key**:
- Stripe guarantees Payment Intent IDs are unique
- Database unique constraint prevents duplicate purchases
- Webhook can safely be called multiple times

**Customer Verification**:
- Customer ID from auth context (cannot spoof)
- Checkout session metadata validated in webhook
- Access control queries completed purchases only

### Performance Considerations

**Expected Load** (Phase 1):
- Checkout sessions: ~10-100/day
- Purchase completions: ~10-100/day (webhook calls)
- Purchase verifications: ~1,000-10,000/day (access checks)

**Indexes**:
- `customer_id` index: Purchase history queries
- `stripe_payment_intent_id` unique index: Idempotency
- `(customer_id, content_id)` unique index: Already-purchased checks

---

**Last Updated**: 2025-11-23
**Version**: 2.0 (Enhanced with implementation patterns and pseudocode)

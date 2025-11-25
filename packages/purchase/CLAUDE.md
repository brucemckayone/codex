# @codex/purchase

Stripe Checkout integration and purchase management service for Codex platform. Handles one-time payment purchases, idempotent purchase recording, revenue split calculations, and purchase verification for access control.

## Overview

@codex/purchase manages the complete purchase lifecycle: creating Stripe Checkout sessions, recording completed purchases from webhook events, verifying purchase ownership, and calculating immutable revenue splits. This package bridges Stripe payment processing with the Codex platform, enabling creators to monetize content via one-time purchases. Purchases are immutable after creation and scoped to individual customers, supporting multiple content libraries.

**Business responsibility**: Purchase management, Stripe integration, revenue tracking.

**Key use cases**:
- Create Stripe Checkout sessions for paid content purchases
- Record completed purchases from Stripe webhook events (idempotent)
- Verify customer owns purchased content (for access control)
- Query purchase history with filters and pagination
- Calculate and store revenue splits (platform/org/creator fees)

## Public API

| Export | Type | Purpose |
|--------|------|---------|
| `PurchaseService` | Class | Main service for purchase operations |
| `createStripeClient()` | Function | Factory for Stripe SDK with pinned API version |
| `verifyWebhookSignature()` | Function | Centralized webhook signature verification |
| `calculateRevenueSplit()` | Function | Calculate platform/org/creator fee distribution |
| `CheckoutSessionResult` | Interface | Stripe checkout session response |
| `Purchase` | Interface | Purchase record type |
| `PurchaseWithContent` | Interface | Purchase with content metadata |
| `AlreadyPurchasedError` | Class | Customer already owns content |
| `ContentNotPurchasableError` | Class | Content cannot be purchased (free, draft, deleted) |
| `PaymentProcessingError` | Class | Stripe API failure |
| `PurchaseNotFoundError` | Class | Purchase record not found |
| `isPurchaseServiceError()` | Function | Type guard for purchase errors |

**Validation schemas** (re-exported from @codex/validation):
- `createCheckoutSchema` - Validates checkout request (contentId, urls)
- `purchaseQuerySchema` - Validates history query (status, page, limit)
- `getPurchaseSchema` - Validates single purchase lookup (purchaseId)

## Core Service: PurchaseService

Full qualified name: `@codex/purchase.PurchaseService`

Service for purchase lifecycle management with Stripe Checkout integration. Handles session creation, purchase completion from webhooks, verification, and history queries. Extends BaseService for dependency injection and error handling.

### Constructor

```typescript
constructor(config: ServiceConfig, stripe: Stripe)
```

**Parameters**:
- `config.db: Database` - Drizzle database client (dbHttp for production)
- `config.environment: string` - Deployment environment (development/staging/production)
- `stripe: Stripe` - Stripe SDK client instance

### Methods

#### createCheckoutSession()

Create Stripe Checkout session for purchasing content.

```typescript
async createCheckoutSession(
  input: CreateCheckoutInput,
  customerId: string
): Promise<{
  sessionUrl: string;
  sessionId: string;
}>
```

**Parameters**:
- `input.contentId: string` - UUID of content to purchase
- `input.successUrl: string` - URL to redirect after successful payment
- `input.cancelUrl: string` - URL to redirect if payment canceled
- `customerId: string` - UUID of purchasing customer

**Returns**:
- `sessionUrl: string` - Stripe-hosted checkout page URL
- `sessionId: string` - Stripe session ID for webhook matching

**Business logic**:
1. Validates input (content ID format, valid URLs)
2. Checks content exists, is published, and not deleted
3. Validates content has price > 0 (rejects free content)
4. Checks customer hasn't already purchased (throws AlreadyPurchasedError)
5. Creates Stripe session with content price and metadata
6. Returns checkout URL for frontend redirect

**Throws**:
- `ContentNotPurchasableError` - Content is free, draft, deleted, or not found (400)
- `AlreadyPurchasedError` - Customer already purchased content (409)
- `PaymentProcessingError` - Stripe API failure (502)
- `ValidationError` - Invalid input (400)

**Transaction safety**: No transaction needed (single operation)

**Observability**: Logs checkout session creation with contentId, customerId

#### completePurchase()

Record completed purchase after Stripe payment success. Called by webhook handler.

```typescript
async completePurchase(
  metadata: CompletePurchaseMetadata,
  paymentIntentId: string
): Promise<Purchase>
```

**Parameters**:
- `metadata.customerId: string` - Customer who completed payment
- `metadata.contentId: string` - Content being purchased
- `metadata.organizationId: string | null` - Organization (if org-scoped content)
- `metadata.amountPaidCents: number` - Total payment amount in cents
- `metadata.currency: string` - Payment currency (e.g., 'usd')
- `paymentIntentId: string` - Stripe Payment Intent ID (idempotency key)

**Returns**: Created or existing Purchase record

**Business logic**:
1. Checks if payment intent already recorded (idempotency)
2. If exists, returns existing purchase (duplicate webhook call)
3. Fetches content to validate and get creator info
4. Calculates revenue split (default: 10% platform / 90% creator)
5. Inserts purchase record with immutable splits
6. Grants access via contentAccess table (for query optimization)
7. Logs successful purchase

**Idempotency**: Guaranteed by unique constraint on stripePaymentIntentId

**Throws**:
- `ContentNotFoundError` - Content not found (404)
- `PaymentProcessingError` - Database insert fails (500)

**Transaction safety**: Uses transaction for atomic purchase + contentAccess insert

**Observability**: Logs purchase completion with full context (customerId, contentId, amount)

#### verifyPurchase()

Check if customer owns purchased content.

```typescript
async verifyPurchase(
  customerId: string,
  contentId: string
): Promise<boolean>
```

**Parameters**:
- `customerId: string` - Customer ID to verify
- `contentId: string` - Content ID to check

**Returns**: True if customer has completed purchase, false otherwise

**Query**: Single SELECT on purchases table with indexes on (customerId, contentId, status)

**Throws**: None (returns false for non-existent purchases)

**Used by**: ContentAccessService for access control verification

#### getPurchaseHistory()

Query customer's purchases with filters, sorting, and pagination.

```typescript
async getPurchaseHistory(
  customerId: string,
  input: PurchaseQueryInput
): Promise<{
  items: PurchaseWithContent[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}>
```

**Parameters**:
- `customerId: string` - Customer ID (scoping)
- `input.page: number` - Page number (1-indexed, default 1)
- `input.limit: number` - Items per page (default 20, max 100)
- `input.status?: 'completed' | 'refunded' | 'failed'` - Filter by status
- `input.sortBy?: 'recent' | 'price'` - Sort order (default 'recent')

**Returns**:
- `items[]` - Array of purchases with content metadata
- `pagination` - Page info (total count, totalPages)

**Query strategy**:
1. Count total purchases matching filters
2. Fetch paginated purchases with content joins
3. Apply status filter if provided
4. Sort by purchasedAt DESC (recent) or priceCents DESC (price)
5. Return page with metadata

**Throws**: None

**Observability**: Logs page number, filter, sort parameters

#### getPurchase()

Get single purchase by ID.

```typescript
async getPurchase(
  purchaseId: string,
  customerId: string
): Promise<Purchase | null>
```

**Parameters**:
- `purchaseId: string` - Purchase ID to fetch
- `customerId: string` - Customer ID (scope check)

**Returns**: Purchase record if found and owned by customer, null otherwise

**Scoping**: Query includes `customerId` equality check (prevents access to other customers' purchases)

**Throws**: None

## Stripe Client Factory

### createStripeClient()

Factory function for creating Stripe SDK instance with pinned API version.

```typescript
export function createStripeClient(apiKey: string): Stripe
```

**Parameters**:
- `apiKey: string` - Stripe secret key (STRIPE_SECRET_KEY)

**Returns**: Fully configured Stripe client

**Key features**:
- Pins Stripe API version to 2025-02-24.acacia (internal constant)
- Single source of truth for API version (easier to upgrade)
- Consistent configuration across all Stripe operations

**Throws**: Error if API key missing or invalid

**Usage**:
```typescript
const stripe = createStripeClient(env.STRIPE_SECRET_KEY);
const service = new PurchaseService({ db, environment }, stripe);
```

### verifyWebhookSignature()

Verify Stripe webhook signature and construct event.

```typescript
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  webhookSecret: string,
  stripeClient: Stripe
): Stripe.Event
```

**Parameters**:
- `rawBody: string` - Raw HTTP request body (required for signature verification)
- `signature: string` - stripe-signature header value
- `webhookSecret: string` - Webhook endpoint secret (STRIPE_WEBHOOK_SECRET_*)
- `stripeClient: Stripe` - Stripe client instance

**Returns**: Verified Stripe event object

**Security**: Uses HMAC-SHA256 verification. Prevents spoofed webhooks.

**Throws**:
- Error if signature header missing (400)
- Error if signature verification fails (401)
- Error if webhook secret not configured (500)

**Usage**:
```typescript
const event = verifyWebhookSignature(
  rawBody,
  signature,
  env.STRIPE_WEBHOOK_SECRET_BOOKING,
  stripe
);
```

## Revenue Calculator

### calculateRevenueSplit()

Calculate platform, organization, and creator fee distribution.

```typescript
export function calculateRevenueSplit(
  amountPaidCents: number,
  platformFeePercentage: number,
  organizationFeePercentage: number
): RevenueSplit
```

**Parameters**:
- `amountPaidCents: number` - Total customer payment (cents)
- `platformFeePercentage: number` - Platform fee percentage (default: 10%)
- `organizationFeePercentage: number` - Organization fee percentage (default: 0%)

**Returns**:
```typescript
{
  platformFeeCents: number;
  organizationFeeCents: number;
  creatorPayoutCents: number;
}
```

**Business logic**:
1. Calculate platform fee: `amountPaidCents * (platformFeePercentage / 100)`
2. Calculate org fee: `amountPaidCents * (organizationFeePercentage / 100)`
3. Creator payout: `amountPaidCents - platformFeeCents - organizationFeeCents`

**Verification**: Sum of all three equals amountPaidCents

**Phase 1 defaults**:
- platformFeePercentage: 10% (configured via platform_agreements table)
- organizationFeePercentage: 0% (configured via organization_agreements table)
- creatorPayoutPercentage: 90% (calculated as remainder)

**Example**:
```typescript
const split = calculateRevenueSplit(9999, 10, 0);
// Returns:
// {
//   platformFeeCents: 1000,
//   organizationFeeCents: 0,
//   creatorPayoutCents: 8999
// }
```

## Usage Examples

### Basic: Create checkout session

```typescript
import { PurchaseService, createStripeClient } from '@codex/purchase';
import { dbHttp } from '@codex/database';

// Initialize service
const stripe = createStripeClient(env.STRIPE_SECRET_KEY);
const service = new PurchaseService({ db: dbHttp, environment: 'production' }, stripe);

// Create checkout
const result = await service.createCheckoutSession({
  contentId: 'content-123',
  successUrl: 'https://example.com/success',
  cancelUrl: 'https://example.com/cancel',
}, userId);

// Returns: { sessionUrl: 'https://checkout.stripe.com/...', sessionId: 'cs_...' }
```

### Basic: Verify purchase for access control

```typescript
const service = new PurchaseService({ db, environment }, stripe);

// Check if customer can access content
const hasPurchase = await service.verifyPurchase(userId, contentId);

if (!hasPurchase) {
  throw new AccessDeniedError('Must purchase to access');
}

// Grant streaming access
const streamingUrl = await generateSignedUrl(contentId);
```

### Basic: Complete purchase from webhook

```typescript
import { verifyWebhookSignature } from '@codex/purchase';

// In webhook handler
const event = verifyWebhookSignature(
  rawBody,
  signature,
  env.STRIPE_WEBHOOK_SECRET_BOOKING,
  stripe
);

if (event.type === 'checkout.session.completed') {
  const session = event.data.object;
  const purchase = await service.completePurchase(
    {
      customerId: session.metadata.customerId,
      contentId: session.metadata.contentId,
      organizationId: session.metadata.organizationId || null,
      amountPaidCents: session.amount_total,
      currency: session.currency,
    },
    session.payment_intent
  );
  console.log('Purchase recorded:', purchase.id);
}
```

### Advanced: Get purchase history with filters

```typescript
const service = new PurchaseService({ db, environment }, stripe);

// Get completed purchases, page 2, sorted by price
const history = await service.getPurchaseHistory(userId, {
  page: 2,
  limit: 20,
  status: 'completed',
  sortBy: 'price',
});

history.items.forEach(item => {
  console.log(`${item.content.title}: $${(item.amountPaidCents / 100).toFixed(2)}`);
});

console.log(`Page ${history.pagination.page} of ${history.pagination.totalPages}`);
```

### Advanced: Calculate custom revenue split

```typescript
import { calculateRevenueSplit } from '@codex/purchase';

// Custom split: 15% platform, 5% org, 80% creator
const split = calculateRevenueSplit(
  9999,     // Customer paid $99.99
  15,       // 15% platform
  5         // 5% org
);

// Store in purchase record
const purchase = await db.insert(purchases).values({
  customerId,
  contentId,
  amountPaidCents: 9999,
  platformFeeCents: split.platformFeeCents,      // 1500 ($15.00)
  organizationFeeCents: split.organizationFeeCents, // 500 ($5.00)
  creatorPayoutCents: split.creatorPayoutCents,   // 7999 ($79.99)
  stripePaymentIntentId: paymentIntentId,
  status: 'completed',
  purchasedAt: new Date(),
});
```

### Error handling: Already purchased

```typescript
import { AlreadyPurchasedError } from '@codex/purchase';

try {
  const result = await service.createCheckoutSession({
    contentId: 'content-123',
    successUrl: '...',
    cancelUrl: '...',
  }, userId);
} catch (error) {
  if (error instanceof AlreadyPurchasedError) {
    return ctx.json({
      error: 'Already purchased',
      code: 'ALREADY_PURCHASED',
      status: 409,
    }, 409);
  }
  throw error;
}
```

### Error handling: Content not purchasable

```typescript
import { ContentNotPurchasableError } from '@codex/purchase';

try {
  const result = await service.createCheckoutSession({...}, userId);
} catch (error) {
  if (error instanceof ContentNotPurchasableError) {
    // Content is free, draft, deleted, or not found
    return ctx.json({
      error: `Content not purchasable: ${error.message}`,
      code: 'NOT_PURCHASABLE',
      status: 400,
    }, 400);
  }
  throw error;
}
```

### Error handling: Stripe API error

```typescript
import { PaymentProcessingError } from '@codex/purchase';

try {
  const result = await service.createCheckoutSession({...}, userId);
} catch (error) {
  if (error instanceof PaymentProcessingError) {
    // Stripe API failure
    console.error('Stripe error:', error.message);
    return ctx.json({
      error: 'Payment processing unavailable',
      code: 'STRIPE_ERROR',
      status: 502,
    }, 502);
  }
  throw error;
}
```

## Integration Points

### Depends On

| Package | Why |
|---------|-----|
| `@codex/database` | Query/insert purchases, content, contentAccess tables |
| `@codex/validation` | Validate checkout input, purchase queries |
| `@codex/service-errors` | BaseService, error mapping |
| `stripe` | Stripe SDK for checkout sessions and payment intents |

### Used By

| Component | Usage |
|-----------|-------|
| `workers/ecom-api` | POST /checkout/create endpoint, webhook handlers |
| `@codex/access` | ContentAccessService.verifyAccess() for purchase verification |

### Database Tables

| Table | Operations | Purpose |
|-------|-----------|---------|
| `purchases` | SELECT, INSERT | Purchase records with revenue splits |
| `content` | SELECT | Validate content exists and is published |
| `contentAccess` | INSERT, SELECT | Grant/verify purchase access (optimization) |
| `platform_agreements` | SELECT | Get active platform fee percentage |
| `organization_agreements` | SELECT | Get org-specific fee percentages |
| `creator_agreements` | SELECT | Get creator-specific payout percentages |

## Error Handling

### AlreadyPurchasedError

Thrown when customer attempts to purchase content they already own.

```typescript
export class AlreadyPurchasedError extends ConflictError {
  // HTTP 409 Conflict
}
```

**When thrown**: createCheckoutSession() finds existing completed purchase

**Recovery**: Show "You already own this content" message to user

**Context data**:
- `customerId: string` - Customer who owns content
- `contentId: string` - Content already purchased

### ContentNotPurchasableError

Thrown when content cannot be purchased (free, draft, deleted, not found).

```typescript
export class ContentNotPurchasableError extends ValidationError {
  // HTTP 400 Bad Request
}
```

**When thrown**:
- Content has priceCents <= 0 (free)
- Content status != 'published'
- Content not found or deleted
- Content ID format invalid

**Recovery**: Show error message to user, prevent purchase attempt

**Context data**:
- `contentId: string` - Content ID
- `reason: 'free' | 'not_published' | 'deleted' | 'not_found'` - Why not purchasable

### PaymentProcessingError

Thrown when Stripe API operation fails.

```typescript
export class PaymentProcessingError extends InternalServiceError {
  // HTTP 502 Bad Gateway
}
```

**When thrown**:
- Stripe session creation fails
- Stripe API connectivity issue
- Stripe rate limits exceeded

**Recovery**: Retry with exponential backoff, alert infrastructure team

**Context data**:
- `originalError: Error` - Underlying Stripe error

### PurchaseNotFoundError

Thrown when purchase record cannot be found.

```typescript
export class PurchaseNotFoundError extends NotFoundError {
  // HTTP 404 Not Found
}
```

**When thrown**: getPurchase() queries for non-existent ID or owned by different customer

**Recovery**: Show "Purchase not found" message

## Performance Considerations

### Query Optimization

**Indexes on purchases table**:
- `(customerId, status)` - Purchase history queries
- `(stripePaymentIntentId)` - Webhook idempotency checks
- `(customerId, contentId)` - Duplicate purchase prevention

**Batch operations**:
- completePurchase() inserts both purchase + contentAccess in single transaction
- getPurchaseHistory() single query with pagination (no N+1)

### Caching Opportunities

- Purchase verification (verifyPurchase) is cheap (single indexed query)
- Can be called per-request for streaming URL generation
- No caching needed (real-time access verification)

### Stripe API Considerations

- Checkout sessions are short-lived (24hr default)
- Payment intents are long-lived (idempotency keys)
- Webhook retries require idempotency (handled via paymentIntentId)

## Testing

### Integration Test Structure

Tests use real database with ephemeral test branches.

```typescript
import { PurchaseService, createStripeClient } from '@codex/purchase';
import { setupTestDatabase, seedTestUsers } from '@codex/test-utils';

// Setup
const db = setupTestDatabase();
const [user] = await seedTestUsers(db, 1);
const stripe = createStripeClient(env.STRIPE_SECRET_KEY);

const service = new PurchaseService({ db, environment: 'test' }, stripe);
```

### Test Patterns

**Checkout creation**:
- ✅ Create session for publishable content with price
- ✅ Fail on free content (priceCents = 0)
- ✅ Fail on draft content (status != 'published')
- ✅ Fail on already purchased content
- ✅ Fail on non-existent content

**Purchase completion**:
- ✅ Record purchase from webhook metadata
- ✅ Idempotency (same paymentIntentId returns existing)
- ✅ Calculate revenue split correctly
- ✅ Create contentAccess record
- ✅ Fail if content not found

**Verification**:
- ✅ Return true for customer's own purchases
- ✅ Return false for non-existent purchases
- ✅ Return false for other customers' purchases

**History queries**:
- ✅ Paginate correctly with limit/offset
- ✅ Filter by status
- ✅ Sort by date (recent) or price
- ✅ Include content metadata in results

### Running Tests

```bash
# Run all tests
pnpm --filter @codex/purchase test

# Watch mode
pnpm --filter @codex/purchase test:watch

# With coverage
pnpm --filter @codex/purchase test:coverage
```

## Security Model

### Input Validation

All inputs validated via Zod schemas:
- `contentId` - UUID format
- `customerId` - UUID format
- `successUrl`, `cancelUrl` - Valid URLs
- `amountPaidCents` - Non-negative integer

### Scoping

All queries scoped to `customerId`:
- Purchases: Can only see own purchases
- Verification: Only own purchases count as "verified"
- History: Only own purchase history returned

### Idempotency

Webhook processing guaranteed idempotent via:
- Unique constraint on `stripePaymentIntentId`
- Query-before-insert pattern in completePurchase()
- Database ensures exactly one purchase per paymentIntentId

### Stripe Security

- Webhook signatures verified with HMAC-SHA256
- Stripe credentials never logged or exposed
- Payment intents fetched server-side (not trustedclient metadata)

## Deployment

### Environment Variables

Required in wrangler.jsonc secrets:
- `STRIPE_SECRET_KEY` - Stripe secret API key (format: `sk_test_*` or `sk_live_*`)
- `STRIPE_WEBHOOK_SECRET_BOOKING` - Webhook secret for checkout.session.completed events

### Stripe Configuration

Must be set up in Stripe Dashboard:
1. Create Webhook Endpoint:
   - URL: `https://{worker-domain}/webhooks/stripe/booking`
   - Events: `checkout.session.completed`
   - API version: 2025-02-24.acacia

2. Verify Webhook Secret:
   - Copy from Stripe Dashboard
   - Set as `STRIPE_WEBHOOK_SECRET_BOOKING` in Cloudflare secrets

### Testing in Staging

```bash
# Start local worker
cd workers/ecom-api && pnpm dev

# Listen for Stripe events
stripe listen --forward-to http://localhost:42072/webhooks/stripe/booking

# Trigger test event
stripe trigger checkout.session.completed
```

## Notes & Future Work

### Phase 1 Simplifications

- Revenue split: 10% platform / 90% creator (configurable via agreement tables)
- One-time payments only (no subscriptions)
- Manual refund handling (not automated)
- No payment method tokenization (each purchase creates new session)

### Future Phases

- Phase 2: Refund processing with automated reversals
- Phase 3: Stripe Connect for automated creator payouts
- Phase 4: Subscription support (recurring charges)
- Phase 5: Multiple payment methods (Apple Pay, Google Pay)

### Performance Optimization Opportunities

- Cache streaming URL generation response (if access doesn't change frequently)
- Batch-verify purchases for multiple customers
- Archive completed purchases after retention period
- Use Stripe reporting API for revenue analytics

---

**Last Updated**: 2025-11-24
**Status**: Production Ready
**Test Coverage**: >90% on all public methods

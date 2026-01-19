# @codex/purchase

Stripe Checkout integration and purchase management service for Codex platform. Handles one-time payment purchases, idempotent purchase recording, revenue split calculations, and purchase verification for access control.

## Overview

@codex/purchase manages the complete purchase lifecycle: creating Stripe Checkout sessions, recording completed purchases from webhook events, verifying purchase ownership, and calculating immutable revenue splits. This package bridges Stripe payment processing with the Codex platform, enabling creators to monetize content via one-time purchases. Purchases are immutable after creation and scoped to individual customers, supporting multiple content libraries across organizations.

**Business responsibility**: Purchase management, Stripe integration, revenue tracking and distribution.

**Key use cases**:
- Create Stripe Checkout sessions for paid content purchases
- Record completed purchases from Stripe webhook events (idempotent via paymentIntentId)
- Verify customer owns purchased content (for access control)
- Query purchase history with filters and pagination
- Calculate and store immutable revenue splits (platform/org/creator fees)
- Support future phases: refunds, subscriptions, multiple payment methods

## Public API

| Export | Type | Purpose |
|--------|------|---------|
| `PurchaseService` | Class | Main service for purchase operations |
| `createStripeClient()` | Function | Factory for Stripe SDK with pinned API version |
| `verifyWebhookSignature()` | Function | Centralized webhook HMAC-SHA256 signature verification |
| `calculateRevenueSplit()` | Function | Calculate platform/org/creator fee distribution |
| `DEFAULT_PLATFORM_FEE_PERCENTAGE` | Constant | 1000 (10% in basis points) |
| `DEFAULT_ORG_FEE_PERCENTAGE` | Constant | 0 (0% in basis points) |
| `CheckoutSessionResult` | Interface | Stripe checkout session response |
| `CompletePurchaseMetadata` | Interface | Metadata from Stripe webhook |
| `Purchase` | Type | Purchase record type (from database schema) |
| `PurchaseWithContent` | Interface | Purchase with content metadata |
| `RevenueSplit` | Interface | Revenue split calculation result |
| `AlreadyPurchasedError` | Class | Customer already owns content (409 Conflict) |
| `ContentNotPurchasableError` | Class | Content cannot be purchased (400 Bad Request) |
| `PaymentProcessingError` | Class | Stripe API failure (502 Bad Gateway) |
| `PurchaseNotFoundError` | Class | Purchase record not found (404 Not Found) |
| `RevenueCalculationError` | Class | Revenue split calculation invalid (500) |
| `isPurchaseServiceError()` | Function | Type guard for purchase/service errors |
| `wrapError()` | Function | Wrap unknown errors with context |

**Validation schemas** (re-exported from @codex/validation):
- `createCheckoutSchema` - Validates checkout request (contentId: uuid, successUrl: url, cancelUrl: url)
- `purchaseQuerySchema` - Validates history query (page: 1+, limit: 1-100, status?: 'completed'|'refunded'|'failed')
- `getPurchaseSchema` - Validates single purchase lookup (id: uuid)
- `purchaseStatusEnum` - Enum: 'pending'|'completed'|'refunded'|'failed'

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
- `stripe: Stripe` - Stripe SDK client instance from createStripeClient()

**Example**:
```typescript
import { PurchaseService, createStripeClient } from '@codex/purchase';
import { dbHttp } from '@codex/database';

const stripe = createStripeClient(env.STRIPE_SECRET_KEY);
const purchaseService = new PurchaseService(
  { db: dbHttp, environment: 'production' },
  stripe
);
```

### Methods

#### createCheckoutSession()

Create Stripe Checkout session for purchasing content.

```typescript
async createCheckoutSession(
  input: CreateCheckoutInput,
  customerId: string
): Promise<CheckoutSessionResult>
```

**Parameters**:
- `input.contentId: string` - UUID of content to purchase
- `input.successUrl: string` - URL to redirect after successful payment
- `input.cancelUrl: string` - URL to redirect if payment canceled
- `customerId: string` - UUID of purchasing customer

**Returns**:
```typescript
{
  sessionUrl: string;    // Stripe-hosted checkout page URL
  sessionId: string;     // Stripe session ID for webhook matching
}
```

**Business logic**:
1. Validates input (schema: content ID format, valid URLs)
2. Fetches content, checks exists and not deleted
3. Validates content has organizationId (Phase 1: only org-scoped content is purchasable)
4. Validates content status = 'published' (draft/archived cannot be purchased)
5. Validates content priceCents > 0 (free content rejected)
6. Checks for existing completed purchase (throws AlreadyPurchasedError)
7. Creates Stripe Checkout session with content price and metadata
8. Returns checkout URL for frontend redirect

**Metadata sent to Stripe**:
```typescript
{
  contentId: string;
  customerId: string;
  organizationId: string;  // From content.organizationId
  creatorId: string;       // From content.creatorId
}
```

**Throws**:
- `ValidationError` - Input validation fails (400)
- `ContentNotPurchasableError` - Content is free, draft, deleted, or lacks organizationId (400)
- `AlreadyPurchasedError` - Customer already purchased content (409)
- `PaymentProcessingError` - Stripe API failure or session URL missing (502)

**Transaction safety**: No transaction needed (single database read + Stripe API call)

**Observability**: Logs checkout session creation with contentId, customerId, sessionId

**Example**:
```typescript
const result = await purchaseService.createCheckoutSession({
  contentId: 'content-123',
  successUrl: 'https://example.com/success',
  cancelUrl: 'https://example.com/cancel',
}, 'customer-456');

// Frontend redirects user to result.sessionUrl
window.location.href = result.sessionUrl;
```

#### completePurchase()

Record completed purchase after Stripe payment success. Called by webhook handler after signature verification.

```typescript
async completePurchase(
  stripePaymentIntentId: string,
  metadata: CompletePurchaseMetadata
): Promise<Purchase>
```

**Parameters**:
- `stripePaymentIntentId: string` - Stripe Payment Intent ID (unique constraint, idempotency key)
- `metadata.customerId: string` - Customer who completed payment
- `metadata.contentId: string` - Content being purchased
- `metadata.organizationId: string | null` - Organization (nullable, fetched from content if missing)
- `metadata.amountPaidCents: number` - Total payment amount in cents
- `metadata.currency: string` - Payment currency (e.g., 'usd', default: 'usd')

**Returns**: Created or existing Purchase record

**Business logic**:
1. Checks if paymentIntentId already recorded (idempotency)
2. If exists, returns existing purchase (duplicate webhook call = safe retry)
3. Fetches content to validate exists and extract organizationId
4. Validates organizationId exists (Phase 1: personal content cannot be purchased)
5. Calculates revenue split using defaults (10% platform / 0% org / 90% creator)
6. Inserts purchase record with immutable revenue splits (atomic transaction)
7. Grants content access atomically in same transaction
8. Returns new or existing purchase record

**Idempotency**: Guaranteed by unique constraint on stripePaymentIntentId
- First call: Creates purchase + access
- Duplicate call: Returns existing purchase (no duplicate created)
- Safe for Stripe's webhook retries (max 3 attempts)

**Revenue split calculation**:
```
Platform: ceil(amountPaidCents * platformFeePercentage / 10000)
Org: ceil(remaining * orgFeePercentage / 10000)
Creator: amountPaidCents - platformFeeCents - orgFeeCents
```

**Throws**:
- `PaymentProcessingError` - Content not found, organizationId missing, or database insert fails (502/500)
- `ServiceError` - Wrapped unknown errors

**Transaction safety**: Uses db.transaction() for atomic purchase + contentAccess insert
- Both succeed together or entire transaction rolls back
- Prevents orphaned access records

**Observability**: Logs purchase completion with customerId, contentId, amountPaidCents, revenue splits

**Example**:
```typescript
import { verifyWebhookSignature } from '@codex/purchase';

// In webhook handler
const event = await verifyWebhookSignature(
  rawBody,
  req.header('stripe-signature'),
  env.STRIPE_WEBHOOK_SECRET_BOOKING,
  stripe
);

if (event.type === 'checkout.session.completed') {
  const session = event.data.object;
  const purchase = await purchaseService.completePurchase(
    session.payment_intent,  // stripePaymentIntentId
    {
      customerId: session.metadata.customerId,
      contentId: session.metadata.contentId,
      organizationId: session.metadata.organizationId || null,
      amountPaidCents: session.amount_total,
      currency: session.currency,
    }
  );
  console.log('Purchase recorded:', purchase.id);
}
```

#### verifyPurchase()

Check if customer owns purchased content. Used by access control.

```typescript
async verifyPurchase(
  contentId: string,
  customerId: string
): Promise<boolean>
```

**Parameters**:
- `contentId: string` - Content ID to check
- `customerId: string` - Customer ID to verify

**Returns**: `true` if customer has completed purchase, `false` otherwise

**Query**: Single indexed lookup on purchases table
```sql
SELECT EXISTS (
  SELECT 1 FROM purchases
  WHERE content_id = ? AND customer_id = ? AND status = 'completed'
)
```

**Throws**: None (returns false for non-existent purchases, errors are wrapped)

**Used by**: ContentAccessService.verifyAccess() for determining if user can stream

**Example**:
```typescript
const hasPurchase = await purchaseService.verifyPurchase(contentId, userId);
if (hasPurchase) {
  // Grant streaming access
  const streamingUrl = await generateSignedUrl(contentId);
} else {
  throw new AccessDeniedError('Must purchase to access');
}
```

#### getPurchaseHistory()

Query customer's purchases with filters, sorting, and pagination.

```typescript
async getPurchaseHistory(
  customerId: string,
  input: PurchaseQueryInput
): Promise<{
  items: PurchaseWithContent[];
  total: number;
  page: number;
  limit: number;
}>
```

**Parameters**:
- `customerId: string` - Customer ID (scoping - only own purchases returned)
- `input.page: number` - Page number (1-indexed, default: 1)
- `input.limit: number` - Items per page (default: 20, max: 100)
- `input.status?: 'completed' | 'refunded' | 'failed'` - Filter by status (optional)
- `input.contentId?: string` - Filter by specific content (optional)

**Returns**:
```typescript
{
  items: Array<{
    // Purchase fields
    id: uuid;
    customerId: string;
    contentId: uuid;
    amountPaidCents: number;
    currency: string;
    status: 'completed' | 'refunded' | 'failed';
    purchasedAt: Date;

    // Content metadata (joined)
    content: {
      id: uuid;
      title: string;
      slug: string;
      thumbnailUrl?: string;
      contentType: 'video' | 'audio' | 'written';
    };
  }>;
  total: number;     // Total matching purchases
  page: number;
  limit: number;
}
```

**Query strategy**:
1. Count total purchases matching filters (no pagination)
2. Fetch paginated purchases with content joins
3. Apply status filter if provided
4. Apply contentId filter if provided
5. Sort by purchasedAt DESC (most recent first)
6. Return page with metadata

**Scoping**: All queries include `customerId = ?` (prevents access to other customers' purchases)

**Throws**: None (errors are wrapped)

**Example**:
```typescript
const history = await purchaseService.getPurchaseHistory(userId, {
  page: 2,
  limit: 20,
  status: 'completed',
});

history.items.forEach(item => {
  console.log(`${item.content.title}: $${(item.amountPaidCents / 100).toFixed(2)}`);
});

console.log(`Page ${history.page} of ${Math.ceil(history.total / history.limit)}`);
```

#### getPurchase()

Get single purchase by ID with ownership verification.

```typescript
async getPurchase(
  purchaseId: string,
  customerId: string
): Promise<Purchase>
```

**Parameters**:
- `purchaseId: string` - Purchase ID to fetch
- `customerId: string` - Customer ID for authorization check

**Returns**: Purchase record if found and owned by customer

**Security**:
1. Query by purchaseId only (two-step security)
2. Check if purchase.customerId === customerId
3. Throw PurchaseNotFoundError (404) if not found
4. Throw ForbiddenError (403) if user doesn't own purchase

**Throws**:
- `PurchaseNotFoundError` - Purchase doesn't exist (404)
- `ForbiddenError` - Purchase exists but belongs to different customer (403)

**Example**:
```typescript
try {
  const purchase = await purchaseService.getPurchase(purchaseId, userId);
  console.log(purchase);
} catch (error) {
  if (error instanceof PurchaseNotFoundError) {
    // Return 404
  } else if (error instanceof ForbiddenError) {
    // Return 403
  }
}
```

## Stripe Client Factory

Centralized Stripe SDK initialization with pinned API version. Provides single source of truth for all Stripe operations.

### createStripeClient()

Factory function for creating Stripe SDK instance with pinned API version.

```typescript
export function createStripeClient(apiKey: string): Stripe
```

**Parameters**:
- `apiKey: string` - Stripe secret key (STRIPE_SECRET_KEY from environment)

**Returns**: Fully configured Stripe client with API version pinned

**API Version**: 2025-10-29.clover (pinned by Stripe Node SDK v19.3.1)

**Key features**:
- Single source of truth for API version (easier to upgrade)
- Consistent configuration across all workers
- Stripe SDK features: checkout sessions, payment intents, webhook verification

**Throws**: Error if apiKey empty or undefined

**Best practice**: Create once during worker initialization, pass to PurchaseService

**Example**:
```typescript
// In worker initialization
const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);
const purchaseService = new PurchaseService({ db, environment }, stripe);

// Reuse for multiple operations
const session = await stripe.checkout.sessions.create({...});
const paymentIntent = await stripe.paymentIntents.retrieve('pi_123');
```

### verifyWebhookSignature()

Verify Stripe webhook signature and construct event. Prevents webhook spoofing.

```typescript
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  webhookSecret: string,
  stripeClient: Stripe
): Promise<Stripe.Event>
```

**Parameters**:
- `rawBody: string` - Raw HTTP request body (exact bytes from Stripe, not parsed JSON)
- `signature: string` - stripe-signature header value
- `webhookSecret: string` - Webhook signing secret (STRIPE_WEBHOOK_SECRET_BOOKING)
- `stripeClient: Stripe` - Initialized Stripe client instance

**Returns**: Verified Stripe event object (safe to use, signature verified)

**Security**:
- Uses HMAC-SHA256 signature verification (timing-safe)
- Raw body required (prevents tampering after parsing)
- Signature includes timestamp (prevents replay attacks)
- Async for Cloudflare Workers compatibility (SubtleCrypto)

**Throws**:
- `Stripe.errors.StripeSignatureVerificationError` - Signature invalid (401)
- Error if signature header missing
- Error if webhook secret not configured

**Webhook Events Handled** (Phase 1):
- `checkout.session.completed` - Purchase complete, record in database
- Future: `charge.refunded`, `customer.subscription.*`, etc.

**Example**:
```typescript
import { verifyWebhookSignature } from '@codex/purchase';

// In webhook route handler
const event = await verifyWebhookSignature(
  rawBody,
  req.header('stripe-signature'),
  env.STRIPE_WEBHOOK_SECRET_BOOKING,
  stripe
);

// Now safe to use event.data
if (event.type === 'checkout.session.completed') {
  const session = event.data.object;
  // Process purchase
}
```

## Revenue Calculator

### calculateRevenueSplit()

Calculate platform, organization, and creator fee distribution from purchase amount.

```typescript
export function calculateRevenueSplit(
  amountPaidCents: number,
  platformFeePercentage: number,
  orgFeePercentage: number
): RevenueSplit
```

**Parameters**:
- `amountPaidCents: number` - Total customer payment in cents (e.g., 2999 = $29.99)
- `platformFeePercentage: number` - Platform fee in basis points (10000 = 100%, 1000 = 10%)
- `orgFeePercentage: number` - Organization fee in basis points (0-10000)

**Returns**:
```typescript
{
  platformFeeCents: number;      // Platform cut (rounded up)
  organizationFeeCents: number;  // Organization cut (rounded up)
  creatorPayoutCents: number;    // Creator cut (exact remainder)
}
```

**Algorithm**:
1. Calculate platform fee: `ceil(amountPaidCents * platformFeePercentage / 10000)`
2. Calculate remaining after platform: `amountPaidCents - platformFeeCents`
3. Calculate org fee: `ceil(remaining * orgFeePercentage / 10000)`
4. Calculate creator payout: `amountPaidCents - platformFeeCents - orgFeeCents`
5. Verify sum equals total (sanity check)

**Rounding rules**:
- Platform and org fees: Rounded UP (platform/org get full cents)
- Creator payout: Exact remainder (ensures total equality)
- CHECK constraint in database verifies: `amountPaidCents = platformFeeCents + organizationFeeCents + creatorPayoutCents`

**Validation**:
- Throws if inputs not integers
- Throws if amountPaidCents < 0
- Throws if percentages not in 0-10000 basis points range
- Throws if calculated sum doesn't equal total

**Phase 1 Defaults**:
- Platform: 10% (1000 basis points)
- Organization: 0% (0 basis points)
- Creator: 90% (remainder)

**Throws**: `RevenueCalculationError` if validation fails

**Example**:
```typescript
// $29.99 purchase with 10% platform fee, 0% org fee
const split = calculateRevenueSplit(2999, 1000, 0);
// Result: {
//   platformFeeCents: 300,      // $3.00
//   organizationFeeCents: 0,    // $0.00
//   creatorPayoutCents: 2699    // $26.99
// }
// Verification: 300 + 0 + 2699 = 2999 ✓

// $100.00 with custom split: 10% platform, 20% org
const customSplit = calculateRevenueSplit(10000, 1000, 2000);
// Platform: ceil(10000 * 1000 / 10000) = $10.00 = 1000
// Remaining: 10000 - 1000 = 9000
// Org: ceil(9000 * 2000 / 10000) = $18.00 = 1800
// Creator: 10000 - 1000 - 1800 = $72.00 = 7200
// Result: { platformFeeCents: 1000, organizationFeeCents: 1800, creatorPayoutCents: 7200 }
```

### Constants

```typescript
export const DEFAULT_PLATFORM_FEE_PERCENTAGE = 1000;  // 10% in basis points
export const DEFAULT_ORG_FEE_PERCENTAGE = 0;          // 0% in basis points
```

## Usage Examples

### Basic: Create checkout session

```typescript
import { PurchaseService, createStripeClient } from '@codex/purchase';
import { dbHttp } from '@codex/database';

// Initialize service
const stripe = createStripeClient(env.STRIPE_SECRET_KEY);
const service = new PurchaseService({ db: dbHttp, environment: 'production' }, stripe);

// Create checkout for user
const result = await service.createCheckoutSession({
  contentId: 'content-123',
  successUrl: 'https://example.com/library',
  cancelUrl: 'https://example.com/content/content-123',
}, userId);

// Frontend redirects
return ctx.json({
  data: {
    checkoutUrl: result.sessionUrl,
    sessionId: result.sessionId,
  },
});
```

### Basic: Verify purchase for access control

```typescript
import { ContentAccessService } from '@codex/access';
import { PurchaseService } from '@codex/purchase';

const accessService = new ContentAccessService(config);
const purchaseService = new PurchaseService(config, stripe);

// In streaming endpoint
const hasPurchase = await purchaseService.verifyPurchase(contentId, userId);

if (hasPurchase) {
  // Grant streaming access
  const streamingUrl = await accessService.generateStreamingUrl(contentId, userId);
  return ctx.json({ data: { streamingUrl } });
}

throw new AccessDeniedError('Must purchase to access this content');
```

### Basic: Complete purchase from webhook

```typescript
import { verifyWebhookSignature, PurchaseService, createStripeClient } from '@codex/purchase';

const stripe = createStripeClient(env.STRIPE_SECRET_KEY);
const service = new PurchaseService({ db, environment }, stripe);

// In webhook handler (POST /webhooks/stripe/booking)
export async function handleWebhook(c: Context) {
  const rawBody = await c.req.text();
  const signature = c.req.header('stripe-signature');

  // Verify signature
  const event = await verifyWebhookSignature(
    rawBody,
    signature,
    c.env.STRIPE_WEBHOOK_SECRET_BOOKING,
    stripe
  );

  // Handle checkout completion
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const purchase = await service.completePurchase(
      session.payment_intent,
      {
        customerId: session.metadata.customerId,
        contentId: session.metadata.contentId,
        organizationId: session.metadata.organizationId || null,
        amountPaidCents: session.amount_total,
        currency: session.currency,
      }
    );
    console.log('Purchase recorded:', purchase.id);
  }

  return c.json({ received: true }, 200);
}
```

### Advanced: Query purchase history with filters

```typescript
const service = new PurchaseService({ db, environment }, stripe);

// Get user's completed purchases, page 2
const history = await service.getPurchaseHistory(userId, {
  page: 2,
  limit: 20,
  status: 'completed',
});

// Render purchase list
history.items.forEach(item => {
  console.log(`${item.content.title} - Purchased ${item.purchasedAt.toLocaleDateString()}`);
  console.log(`Amount: $${(item.amountPaidCents / 100).toFixed(2)}`);
});

console.log(`Showing ${history.items.length} of ${history.total} purchases`);
console.log(`Page ${history.page} of ${Math.ceil(history.total / history.limit)}`);
```

### Advanced: Custom revenue split calculation

```typescript
import { calculateRevenueSplit } from '@codex/purchase';

// Scenario: Custom organization agreement (15% platform, 5% org, 80% creator)
const amountPaidCents = 9999;  // $99.99

const split = calculateRevenueSplit(
  amountPaidCents,
  1500,  // 15% platform
  500    // 5% org
);

console.log(`Customer paid: $${(amountPaidCents / 100).toFixed(2)}`);
console.log(`Platform cut: $${(split.platformFeeCents / 100).toFixed(2)}`);
console.log(`Org cut: $${(split.organizationFeeCents / 100).toFixed(2)}`);
console.log(`Creator payout: $${(split.creatorPayoutCents / 100).toFixed(2)}`);

// Store in database
await db.insert(purchases).values({
  customerId,
  contentId,
  amountPaidCents,
  platformFeeCents: split.platformFeeCents,
  organizationFeeCents: split.organizationFeeCents,
  creatorPayoutCents: split.creatorPayoutCents,
  // ... other fields
});
```

### Error handling: Already purchased

```typescript
import { AlreadyPurchasedError } from '@codex/purchase';
import { mapErrorToResponse } from '@codex/service-errors';

try {
  const result = await service.createCheckoutSession({
    contentId,
    successUrl,
    cancelUrl,
  }, userId);
} catch (error) {
  if (error instanceof AlreadyPurchasedError) {
    // Return 409 with user-friendly message
    return ctx.json({
      error: 'You already own this content',
      code: 'ALREADY_PURCHASED',
    }, 409);
  }
  // Let worker's error handler map other errors
  return mapErrorToResponse(error);
}
```

### Error handling: Content not purchasable

```typescript
import { ContentNotPurchasableError } from '@codex/purchase';

try {
  const result = await service.createCheckoutSession({...}, userId);
} catch (error) {
  if (error instanceof ContentNotPurchasableError) {
    // Content is free, draft, deleted, or lacks organizationId
    const reason = error.context?.reason || 'unknown';
    return ctx.json({
      error: `Content not available for purchase: ${reason}`,
      code: 'NOT_PURCHASABLE',
    }, 400);
  }
  throw error;
}
```

### Error handling: Stripe API failure

```typescript
import { PaymentProcessingError } from '@codex/purchase';

try {
  const result = await service.createCheckoutSession({...}, userId);
} catch (error) {
  if (error instanceof PaymentProcessingError) {
    // Stripe API error
    return ctx.json({
      error: 'Payment service temporarily unavailable',
      code: 'PAYMENT_SERVICE_ERROR',
    }, 502);
  }
  throw error;
}
```

## Integration Points

### Depends On

| Package | Usage |
|---------|-------|
| `@codex/database` | Query/insert purchases, content, contentAccess tables; transactions |
| `@codex/validation` | Validate checkout input, purchase queries (createCheckoutSchema, purchaseQuerySchema) |
| `@codex/service-errors` | BaseService, error classes, wrapError, error mapping |
| `stripe` (npm) | Stripe SDK for checkout sessions, payment intents, webhook verification |

### Used By

| Component | Usage | Details |
|-----------|-------|---------|
| `workers/ecom-api` | Checkout endpoints, webhook handlers | POST /checkout/create, POST /webhooks/stripe/booking |
| `@codex/access` | Access verification | ContentAccessService.verifyAccess() checks purchase ownership |
| Future: Refund workers | Refund processing | Will call completePurchase() to record refunds |

### Database Tables

| Table | Operations | Purpose |
|-------|-----------|---------|
| `purchases` | SELECT, INSERT, UPDATE | Purchase records with revenue splits, status tracking |
| `content` | SELECT | Validate content exists, published, has price, extract organizationId |
| `contentAccess` | INSERT, SELECT | Grant/verify purchase access for streaming |
| `platformFeeConfig` | SELECT | Query active platform fee percentage (Phase 2+) |
| `organizationPlatformAgreements` | SELECT | Query org-specific platform fees (Phase 2+) |
| `creatorOrganizationAgreements` | SELECT | Query org revenue share with creators (Phase 2+) |

## Data Models

### Database Schema: Purchases Table

```sql
CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT random_uuid(),

  -- Foreign keys
  customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE RESTRICT,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,

  -- Payment
  amount_paid_cents INTEGER NOT NULL,           -- e.g., 2999 = $29.99
  currency VARCHAR(3) NOT NULL DEFAULT 'usd',

  -- Revenue split (immutable snapshot)
  platform_fee_cents INTEGER NOT NULL DEFAULT 0,        -- Platform's cut
  organization_fee_cents INTEGER NOT NULL DEFAULT 0,    -- Org's cut
  creator_payout_cents INTEGER NOT NULL DEFAULT 0,      -- Creator's cut

  -- Agreement tracking (audit trail, NULL if defaults used)
  platform_agreement_id UUID REFERENCES organization_platform_agreements(id),
  creator_org_agreement_id UUID REFERENCES creator_organization_agreements(id),

  -- Stripe reference
  stripe_payment_intent_id VARCHAR(255) NOT NULL UNIQUE,

  -- Status tracking
  status VARCHAR(50) NOT NULL,                  -- 'pending', 'completed', 'refunded', 'failed'
  purchased_at TIMESTAMP WITH TIME ZONE,       -- When payment completed

  -- Refund tracking
  refunded_at TIMESTAMP WITH TIME ZONE,
  refund_reason TEXT,
  refund_amount_cents INTEGER,
  stripe_refund_id VARCHAR(255),

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),

  -- Constraints
  CHECK (amount_paid_cents >= 0),
  CHECK (platform_fee_cents >= 0),
  CHECK (organization_fee_cents >= 0),
  CHECK (creator_payout_cents >= 0),
  CHECK (status IN ('pending', 'completed', 'refunded', 'failed')),
  CHECK (amount_paid_cents = platform_fee_cents + organization_fee_cents + creator_payout_cents)
);

-- Indexes
CREATE INDEX idx_purchases_customer_id ON purchases(customer_id);
CREATE INDEX idx_purchases_content_id ON purchases(content_id);
CREATE INDEX idx_purchases_organization_id ON purchases(organization_id);
CREATE INDEX idx_purchases_stripe_payment_intent ON purchases(stripe_payment_intent_id);
CREATE INDEX idx_purchases_created_at ON purchases(created_at);
CREATE INDEX idx_purchases_purchased_at ON purchases(purchased_at);
```

### Purchase Record Type

```typescript
type Purchase = {
  id: string;                           // UUID
  customerId: string;                   // User ID
  contentId: string;                    // Content ID
  organizationId: string;               // Organization ID
  amountPaidCents: number;              // Total paid (e.g., 2999)
  currency: string;                     // 'usd', etc
  platformFeeCents: number;             // 10% by default
  organizationFeeCents: number;         // 0% by default
  creatorPayoutCents: number;           // 90% by default
  platformAgreementId: string | null;   // Audit trail
  creatorOrgAgreementId: string | null; // Audit trail
  stripePaymentIntentId: string;        // Stripe reference
  status: 'pending' | 'completed' | 'refunded' | 'failed';
  purchasedAt: Date | null;
  refundedAt: Date | null;
  refundReason: string | null;
  refundAmountCents: number | null;
  stripeRefundId: string | null;
  createdAt: Date;
  updatedAt: Date;
};
```

### PurchaseWithContent

```typescript
interface PurchaseWithContent extends Purchase {
  content: {
    id: string;
    title: string;
    slug: string;
    thumbnailUrl?: string;
    contentType: 'video' | 'audio' | 'written';
  };
}
```

## Error Handling

### AlreadyPurchasedError

Thrown when customer attempts to purchase content they already own.

```typescript
export class AlreadyPurchasedError extends ConflictError {
  // HTTP 409 Conflict
}
```

**When thrown**: createCheckoutSession() finds existing completed purchase for customer+content

**User-facing message**: "You already own this content"

**Recovery**:
- Show message to user
- Offer button to view content instead
- Skip checkout flow

**Context data** (available via error.context):
- `contentId: string` - Content ID
- `customerId: string` - Customer ID
- `code: 'ALREADY_PURCHASED'`

**Example handling**:
```typescript
try {
  const session = await service.createCheckoutSession({...}, userId);
} catch (error) {
  if (error instanceof AlreadyPurchasedError) {
    return ctx.json({ error: 'Already purchased', code: 'ALREADY_PURCHASED' }, 409);
  }
}
```

### ContentNotPurchasableError

Thrown when content cannot be purchased (free, draft, deleted, lacks organizationId).

```typescript
export class ContentNotPurchasableError extends BusinessLogicError {
  // HTTP 400 Bad Request
}
```

**When thrown**:
- Content has priceCents <= 0 (free content)
- Content status != 'published' (draft/archived)
- Content not found or deleted
- Content lacks organizationId (Phase 1 restriction)
- Content ID format invalid

**User-facing messages**:
- "Content is free and does not require purchase" (reason: 'free')
- "Content must be published before it can be purchased" (reason: 'not_published')
- "Content is no longer available" (reason: 'deleted')
- "Content does not have a price set" (reason: 'no_price')

**Recovery**:
- Show message to user
- Prevent purchase attempt
- Redirect to content view (if free) or error page

**Context data**:
- `contentId: string` - Content ID
- `reason: 'free' | 'not_published' | 'deleted' | 'no_price'` - Why not purchasable
- `code: 'CONTENT_NOT_PURCHASABLE'`

### PaymentProcessingError

Thrown when Stripe API operation fails.

```typescript
export class PaymentProcessingError extends InternalServiceError {
  // HTTP 502 Bad Gateway
}
```

**When thrown**:
- Stripe checkout session creation fails
- Stripe API connectivity issue or timeout
- Stripe rate limits exceeded (429)
- Session URL not generated (should never happen)
- Content not found during webhook processing
- Database insert fails

**Recovery**:
- Retry with exponential backoff (Stripe retry policy)
- Alert infrastructure team
- Show generic "Payment service unavailable" to user
- Queue webhook for retry

**Context data**:
- `stripeError?: string` - Original Stripe error message
- `contentId?: string` - Content being purchased
- `code: 'PAYMENT_PROCESSING_ERROR'`

### PurchaseNotFoundError

Thrown when purchase record cannot be found.

```typescript
export class PurchaseNotFoundError extends NotFoundError {
  // HTTP 404 Not Found
}
```

**When thrown**: getPurchase() queries for non-existent ID

**Recovery**: Show "Purchase not found" message, redirect to purchase history

**Context data**:
- `purchaseId: string` - Purchase ID searched
- `code: 'PURCHASE_NOT_FOUND'`

### RevenueCalculationError

Thrown when revenue split calculation produces invalid results.

```typescript
export class RevenueCalculationError extends InternalServiceError {
  // HTTP 500 Internal Server Error
}
```

**When thrown**:
- Input validation fails (amountCents not integer, < 0)
- Fee percentages outside 0-10000 range
- Calculated split sum doesn't equal total (calculation bug)
- Negative fee values (should never happen)

**Recovery**: Log detailed error, alert engineering team, return 500

**Context data**:
- `amountCents?: number` - Input amount
- `platformFeePercentage?: number` - Input percentage
- `orgFeePercentage?: number` - Input percentage
- `type: 'invalid_amount' | 'invalid_platform_fee' | 'invalid_org_fee' | 'calculation_mismatch' | 'negative_fee'`

## Performance Considerations

### Query Optimization

**Indexes on purchases table**:
- `(customer_id)` - Purchase history queries
- `(stripe_payment_intent_id)` - Webhook idempotency checks
- `(created_at)` - Sorting by recent purchases
- `(purchased_at)` - Sorting by purchase date

**Query patterns**:
- Checkout creation: 1 SELECT on content (indexed by id)
- Purchase completion: 1 SELECT for idempotency check, 1 INSERT purchase, 1 INSERT access
- Verification: 1 indexed SELECT on (customerId, contentId, status)
- History: COUNT + pagination SELECT with content join

**Batch operations**:
- completePurchase() uses single transaction (atomicity over multiple operations)
- getPurchaseHistory() single query with pagination (no N+1 queries)

### Database Constraints Performance

**Revenue split CHECK constraint**:
- Verified on INSERT (PostgreSQL enforces)
- Prevents invalid splits at database level
- Lightweight validation (pure arithmetic)

**Unique constraint on stripePaymentIntentId**:
- Enforced by PostgreSQL unique index
- Fast lookup for idempotency
- Single SELECT sufficient to detect duplicates

### Caching Opportunities

**Limited caching needed**:
- verifyPurchase() is cheap (single indexed query)
- No need to cache since real-time access verification required
- Future: Could cache in KV for very high-traffic content

### Stripe API Considerations

**Rate limits**:
- Stripe checkout session creation: 100 requests/second
- Webhook delivery: Automatic retries (exponential backoff)
- Payment intent retrieval: Included in general API limits

**Idempotency**:
- Webhook retries: Up to 3 attempts with 5s + 30s delays
- Duplicate webhook handling: Idempotent via stripePaymentIntentId constraint
- Failed webhooks: Manual retry or invoice-based reconciliation

**Stripe API Version**:
- Pinned to 2025-10-29.clover
- Update via createStripeClient() factory
- Breaking changes reviewed during upgrades

### Cost Optimization

**Stripe fees**:
- Transaction fee: 2.9% + $0.30 (standard)
- Platform gets 10% (covers Stripe fee + operational cost)
- Creator gets 90%

**Database operations**:
- Checkout: 1 query (content lookup)
- Webhook: 1 query (idempotency) + 1 transaction (insert 2 rows)
- History: 2 queries (count + paginated fetch)
- Verification: 1 query (indexed)

## Testing

### Integration Test Structure

Tests use real database (ephemeral test branches) with mocked Stripe client.

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase, seedTestUsers, withNeonTestBranch } from '@codex/test-utils';
import { PurchaseService, createStripeClient } from '@codex/purchase';
import type Stripe from 'stripe';

// Enable ephemeral Neon branch for this test file
withNeonTestBranch();

describe('PurchaseService', () => {
  let db: Database;
  let service: PurchaseService;
  let mockStripe: Stripe;
  let userId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    const [user] = await seedTestUsers(db, 1);
    userId = user.id;

    // Mock Stripe client
    mockStripe = {
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({
            id: 'cs_test_123',
            url: 'https://checkout.stripe.com/pay/cs_test_123',
          }),
        },
      },
    } as unknown as Stripe;

    service = new PurchaseService(
      { db, environment: 'test' },
      mockStripe
    );
  });

  afterAll(async () => {
    await closeDbPool();
  });

  // Tests...
});
```

### Test Patterns

**Checkout creation**:
```typescript
it('should create checkout session', async () => {
  const result = await service.createCheckoutSession({
    contentId,
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
  }, userId);

  expect(result.sessionUrl).toBeDefined();
  expect(result.sessionId).toBe('cs_test_123');
});

it('should reject free content', async () => {
  await expect(service.createCheckoutSession({
    contentId: freeContentId,
    successUrl: '...',
    cancelUrl: '...',
  }, userId)).rejects.toThrow(ContentNotPurchasableError);
});

it('should reject already purchased', async () => {
  // Create first checkout
  await service.createCheckoutSession({...}, userId);

  // Create purchase record
  await completePurchase(paymentIntentId, {...});

  // Second attempt fails
  await expect(service.createCheckoutSession({...}, userId))
    .rejects.toThrow(AlreadyPurchasedError);
});
```

**Purchase completion**:
```typescript
it('should record purchase', async () => {
  const purchase = await service.completePurchase('pi_123', {
    customerId: userId,
    contentId,
    organizationId,
    amountPaidCents: 2999,
    currency: 'usd',
  });

  expect(purchase.status).toBe('completed');
  expect(purchase.platformFeeCents).toBe(300);
  expect(purchase.creatorPayoutCents).toBe(2699);
});

it('should be idempotent', async () => {
  // First call
  const purchase1 = await service.completePurchase('pi_123', metadata);

  // Duplicate call
  const purchase2 = await service.completePurchase('pi_123', metadata);

  // Same purchase returned
  expect(purchase2.id).toBe(purchase1.id);
});
```

**Verification**:
```typescript
it('should verify purchase', async () => {
  await service.completePurchase('pi_123', metadata);

  const hasAccess = await service.verifyPurchase(contentId, userId);
  expect(hasAccess).toBe(true);
});

it('should deny unowned purchases', async () => {
  await service.completePurchase('pi_123', {
    customerId: userId,
    contentId,
    organizationId,
    amountPaidCents: 2999,
  });

  const hasAccess = await service.verifyPurchase(contentId, otherUserId);
  expect(hasAccess).toBe(false);
});
```

### Running Tests

```bash
# Run all tests
pnpm --filter @codex/purchase test

# Watch mode
pnpm --filter @codex/purchase test:watch

# With coverage
pnpm --filter @codex/purchase test:coverage

# Specific test file
pnpm --filter @codex/purchase test revenue-calculator.test.ts
```

### Test Utilities Available

```typescript
import {
  setupTestDatabase,      // Initialize test database
  teardownTestDatabase,   // Cleanup
  seedTestUsers,          // Create test users
  withNeonTestBranch,     // Enable ephemeral branch
  closeDbPool,           // Close WebSocket pool
} from '@codex/test-utils';
```

## Security Model

### Input Validation

All inputs validated before database operations:
- Content ID: UUID format
- Customer ID: UUID format (extracted from authenticated context)
- Success/cancel URLs: Valid HTTPS URLs
- Amount: Non-negative integer (from Stripe)
- Page/limit: Positive integers

### Scoping

All queries scoped to prevent cross-user access:
- Purchases: Returns only customer's own purchases
- Verification: Only own purchases count as "verified"
- History: Only own purchase history returned

**Two-step security in getPurchase()**:
1. Query by ID (no customer filter)
2. Check purchase.customerId === customerId
3. Throw 403 if mismatch (prevents account enumeration)

### Idempotency & Replay Prevention

Webhook processing guaranteed safe via:
- **Unique constraint** on `stripePaymentIntentId` (prevents duplicate purchases)
- **Query-before-insert** pattern (detects duplicates quickly)
- **Database transaction** (atomic purchase + access grant)
- **Stripe signature verification** (prevents spoofed webhooks)

### Stripe Security

- Webhook signatures verified with HMAC-SHA256 (timing-safe)
- Stripe credentials never logged or exposed
- Raw body required for signature verification (prevents tampering)
- Payment intents fetched server-side (not trusted from client metadata)

### Amount Verification

- Customer payment verified by Stripe (not trusting client)
- Stripe Checkout session controls amount (customer can't modify)
- Revenue split calculation verified by CHECK constraint
- All currency in integer cents (no floating-point errors)

## Deployment

### Environment Variables

Required in Cloudflare secrets (wrangler.jsonc):

```json
{
  "env": {
    "production": {
      "vars": {
        "STRIPE_SECRET_KEY": "sk_live_..."
      },
      "secrets": ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET_BOOKING"]
    },
    "staging": {
      "vars": {
        "STRIPE_SECRET_KEY": "sk_test_..."
      },
      "secrets": ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET_BOOKING"]
    }
  }
}
```

**Variables**:
- `STRIPE_SECRET_KEY` - Stripe secret API key (format: `sk_test_*` or `sk_live_*`)
- `STRIPE_WEBHOOK_SECRET_BOOKING` - Webhook endpoint secret for checkout.session.completed events

### Stripe Dashboard Configuration

1. **API Keys**:
   - Get Secret Key from Stripe Dashboard
   - Add to Cloudflare secrets

2. **Webhook Endpoint**:
   - Create Webhook Endpoint
   - URL: `https://{worker-domain}/webhooks/stripe/booking`
   - Events to listen: `checkout.session.completed`
   - API version: 2025-10-29.clover (matches SDK)
   - Copy Webhook Secret to Cloudflare

3. **Customers**:
   - Enable through Stripe Dashboard
   - Payment methods: Card (default, required)
   - Future: Apple Pay, Google Pay, Bank Transfers

### Testing in Staging

```bash
# Start worker locally
cd workers/ecom-api && pnpm dev

# Listen for Stripe test events
stripe listen --forward-to http://localhost:42072/webhooks/stripe/booking

# Trigger test event
stripe trigger checkout.session.completed
```

### Production Considerations

- Monitor webhook delivery (Stripe Dashboard Logs)
- Alert on failed webhooks (manual remediation)
- Monitor revenue calculations (audit trail via agreement IDs)
- Archive old purchases for analytics (separate batch job)
- Monitor payment intent creation rate (against Stripe rate limits)

## Notes & Future Work

### Phase 1 Current State

**Implemented**:
- One-time purchases only
- Revenue split: 10% platform / 90% creator (configurable)
- Stripe Checkout integration
- Webhook processing (checkout.session.completed)
- Idempotent purchase recording
- Purchase history queries
- ContentAccess grant for verified purchases

**Not Yet Implemented**:
- Custom organization fees (Phase 2)
- Refund processing (Phase 2)
- Subscription support (Phase 3)
- Multiple payment methods (Phase 3)
- Revenue reconciliation (Phase 2+)
- Dispute handling (Phase 2+)

### Phase 2 Planned Features

- Refund processing: Record refunds, reverse revenue splits, auto-reverse contentAccess
- Stripe Connect: Automatic creator payouts (instead of platform handling)
- Custom agreement system: Org/creator negotiate fees at transaction time
- Revenue reporting: Analytics API for creators and platform

### Phase 3+ Features

- Subscription support: Recurring monthly charges
- Apple Pay / Google Pay integration
- Bank transfers / wire payments
- Multi-currency support (EUR, GBP, JPY, etc)
- Gift cards / promotional codes
- Affiliate/referral system
- Disputed purchase handling

### Performance Optimization Opportunities

- Cache streaming URL generation (if purchase doesn't change)
- Batch-verify purchases for multiple customers (bulk query)
- Archive completed purchases (historical analytics queries)
- Use Stripe reporting API instead of direct webhooks (faster reconciliation)
- Pre-calculate revenue splits (instead of on-demand)

### Known Limitations

- Phase 1: Only organization-scoped content purchasable (personal content = free)
- Phase 1: No partial refunds (full refund or nothing)
- Phase 1: No subscription discounts (all charges full price)
- Phase 1: Single-currency (USD only)
- Phase 1: Manual refund request handling (not automated)

---

**Last Updated**: 2025-12-14
**Status**: Production Ready
**Test Coverage**: >90% on all public methods
**Stripe API Version**: 2025-10-29.clover
**Stripe Node SDK**: v19.3.1+

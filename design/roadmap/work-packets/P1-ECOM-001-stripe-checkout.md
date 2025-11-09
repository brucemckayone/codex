# Work Packet: P1-ECOM-001 - Stripe Checkout Integration

**Status**: 🚧 To Be Implemented
**Priority**: P0 (Critical - revenue generation)
**Estimated Effort**: 4-5 days
**Branch**: `feature/P1-ECOM-001-stripe-checkout`

---

## Current State

**✅ Already Implemented:**
- Stripe webhook worker skeleton (`workers/stripe-webhook-handler/src/index.ts`)
- Webhook signature verification (`workers/stripe-webhook-handler/src/middleware/verify-signature.ts`)
- Security middleware (headers, rate limiting, CSP)
- Database client with Drizzle ORM
- Validation package for input validation

**🚧 Needs Implementation:**
- Purchase database schema (content_purchases table)
- Purchase validation schemas
- Checkout service (create Stripe sessions)
- Purchase API endpoints
- Tests

---

## Dependencies

### Required Packages (Already Available)
```typescript
import { db } from '@codex/database';
import Stripe from 'stripe'; // Install: pnpm add stripe
import { z } from 'zod';
import { ObservabilityClient } from '@codex/observability';
import { securityHeaders, rateLimit } from '@codex/security';
```

### Required Secrets (Configure in Cloudflare)
```bash
STRIPE_SECRET_KEY              # Stripe API key
STRIPE_WEBHOOK_SECRET_PAYMENT  # Already in use
```

### Required Documentation
- [E-Commerce TDD](../../features/e-commerce/ttd-dphase-1.md) - Feature specification
- [STANDARDS.md](../STANDARDS.md) - Coding patterns
- [Database Schema Design](../../infrastructure/DATABASE_SCHEMA_DESIGN.md) - Schema structure

---

## Implementation Steps

### Step 1: Create Purchase Schema

**Note**: Schema aligns with `design/features/shared/database-schema.md` v2.0 (lines 320-410). Phase 1 uses simple revenue model: 100% to creator, no platform/org fees.

**File**: `packages/database/src/schema/purchases.ts`

```typescript
import { pgTable, uuid, varchar, integer, text, timestamp, index, unique, check, sql } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { content } from './content';
import { revenueSplitConfigurations } from './revenue-splits'; // Phase 2+

/**
 * Purchase records (one-time content purchases)
 * Aligned with database-schema.md lines 320-410
 *
 * Phase 1: Simple purchases with 100% to creator
 * Phase 2+: Revenue splitting with platform/org fees
 * Phase 3+: Stripe Connect automated payouts
 */
export const purchases = pgTable('purchases', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Relationships
  customerId: uuid('customer_id').notNull().references(() => users.id),
  contentId: uuid('content_id').notNull().references(() => content.id),

  // Payment (integer cents to avoid rounding errors - ACID compliant)
  amountPaidCents: integer('amount_paid_cents').notNull(), // Total amount customer paid
  currency: varchar('currency', { length: 3 }).default('usd').notNull(),
  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }).unique().notNull(),
  // Note: Payment Intent ID is unique identifier from Stripe, used for idempotency

  // Revenue Split (calculated at purchase time)
  revenueSplitConfigId: uuid('revenue_split_config_id').references(() => revenueSplitConfigurations.id),
  // Tracks which configuration was used (Phase 2+, NULL in Phase 1)

  platformFeeCents: integer('platform_fee_cents').default(0).notNull(),
  // Phase 1: 0 (no platform fee)
  // Phase 2+: Based on revenue_split_configuration

  organizationFeeCents: integer('organization_fee_cents').default(0).notNull(),
  // Phase 1: 0 (no organization fee)
  // Phase 2+: Based on revenue_split_configuration (only if content.organization_id NOT NULL)

  creatorPayoutCents: integer('creator_payout_cents').notNull(),
  // Phase 1: = amount_paid_cents (100% to creator)
  // Phase 2+: = amount_paid_cents - platform_fee_cents - organization_fee_cents

  // Payout Tracking (Phase 3+ - Stripe Connect)
  creatorPayoutStatus: varchar('creator_payout_status', { length: 50 }).default('pending'),
  // 'pending' | 'paid' | 'failed'
  creatorStripeTransferId: varchar('creator_stripe_transfer_id', { length: 255 }),
  creatorPayoutAt: timestamp('creator_payout_at', { withTimezone: true }),

  organizationPayoutStatus: varchar('organization_payout_status', { length: 50 }).default('pending'),
  // 'pending' | 'paid' | 'failed'
  organizationStripeTransferId: varchar('organization_stripe_transfer_id', { length: 255 }),
  organizationPayoutAt: timestamp('organization_payout_at', { withTimezone: true }),

  // Status
  status: varchar('status', { length: 50 }).default('pending').notNull(),
  // 'pending' | 'completed' | 'refunded' | 'failed'

  // Refund Tracking
  purchasedAt: timestamp('purchased_at', { withTimezone: true }),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
  refundReason: text('refund_reason'),
  refundAmountCents: integer('refund_amount_cents'), // Can be partial refund (Phase 2+)
  stripeRefundId: varchar('stripe_refund_id', { length: 255 }),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
    .$onUpdate(() => new Date()),
}, (table) => ({
  // Indexes
  customerIdIdx: index('idx_purchases_customer_id').on(table.customerId),
  contentIdIdx: index('idx_purchases_content_id').on(table.contentId),
  statusIdx: index('idx_purchases_status').on(table.status),
  createdAtIdx: index('idx_purchases_created_at').on(table.createdAt),
  stripePaymentIntentIdx: index('idx_purchases_stripe_payment_intent_id').on(table.stripePaymentIntentId),
  payoutStatusIdx: index('idx_purchases_payout_status').on(table.creatorPayoutStatus, table.organizationPayoutStatus),

  // Prevent duplicate completed purchases (partial unique index)
  // Only one completed purchase per customer per content (excluding refunded)
  noDuplicatePurchases: unique('idx_no_duplicate_purchases').on(table.customerId, table.contentId)
    // Note: Drizzle doesn't support WHERE clause in unique constraints yet
    // Apply manually: WHERE status = 'completed' AND refunded_at IS NULL

  // Revenue split validation (ensure cents add up exactly)
  // Note: Drizzle doesn't support CHECK constraints yet - apply in migration SQL
  // CHECK (amount_paid_cents = platform_fee_cents + organization_fee_cents + creator_payout_cents)
  // CHECK (amount_paid_cents >= 0)
}));

export type Purchase = typeof purchases.$inferSelect;
export type NewPurchase = typeof purchases.$inferInsert;
```

**Migration Notes**:

After generating migration with `pnpm --filter @codex/database db:gen:drizzle`, manually add these constraints to the migration SQL:

```sql
-- Add partial unique index (prevent duplicate purchases)
CREATE UNIQUE INDEX idx_no_duplicate_purchases
  ON purchases(customer_id, content_id)
  WHERE status = 'completed' AND refunded_at IS NULL;

-- Add CHECK constraints for revenue split validation
ALTER TABLE purchases
  ADD CONSTRAINT check_revenue_split_adds_up
  CHECK (amount_paid_cents = platform_fee_cents + organization_fee_cents + creator_payout_cents);

ALTER TABLE purchases
  ADD CONSTRAINT check_amount_non_negative
  CHECK (amount_paid_cents >= 0);

-- Add CHECK constraints for status values
ALTER TABLE purchases
  ADD CONSTRAINT check_status_values
  CHECK (status IN ('pending', 'completed', 'refunded', 'failed'));

ALTER TABLE purchases
  ADD CONSTRAINT check_creator_payout_status
  CHECK (creator_payout_status IN ('pending', 'paid', 'failed'));

ALTER TABLE purchases
  ADD CONSTRAINT check_organization_payout_status
  CHECK (organization_payout_status IN ('pending', 'paid', 'failed'));
```

**Apply migration**:
```bash
# Generate migration
pnpm --filter @codex/database db:gen:drizzle

# Edit migration file to add CHECK constraints and partial unique index

# Apply to local DB
pnpm --filter @codex/database db:migrate
```

### Step 2: Create Purchase Validation

**Note**: Validation schemas are pure functions (no DB dependency). Phase 1 checkout only needs contentId - customer comes from auth context.

**File**: `packages/validation/src/purchase-schemas.ts`

```typescript
import { z } from 'zod';

/**
 * Validation for creating checkout session
 * Customer ID comes from auth context, not client input
 */
export const createCheckoutSchema = z.object({
  contentId: z.string().uuid('Invalid content ID format'),
});

/**
 * Validation for checking purchase access
 * Used by content player to verify customer has purchased
 */
export const checkAccessSchema = z.object({
  contentId: z.string().uuid('Invalid content ID format'),
});

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;
export type CheckAccessInput = z.infer<typeof checkAccessSchema>;
```

**Testing**: See `design/roadmap/testing/ecommerce-testing-definition.md` for comprehensive validation test patterns (pure functions, 100% coverage, no DB).

### Step 3: Create Purchase Service

**Note**: Service uses dependency injection pattern. Phase 1 implements simple revenue model: 100% to creator, no platform/org fees.

**File**: `packages/purchases/src/service.ts`

```typescript
import { db } from '@codex/database';
import { content, purchases, type Purchase } from '@codex/database/schema';
import { eq, and, isNull } from 'drizzle-orm';
import Stripe from 'stripe';
import { ObservabilityClient } from '@codex/observability';

export interface PurchaseServiceConfig {
  db: typeof db;
  stripe: Stripe;
  obs: ObservabilityClient;
}

export interface IPurchaseService {
  createCheckoutSession(
    customerId: string,
    contentId: string
  ): Promise<{ checkoutUrl: string; sessionId: string }>;

  hasAccess(customerId: string, contentId: string): Promise<boolean>;

  handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void>;
}

export class PurchaseService implements IPurchaseService {
  private config: PurchaseServiceConfig;

  constructor(config: PurchaseServiceConfig) {
    this.config = config;
  }

  async createCheckoutSession(
    customerId: string,
    contentId: string
  ): Promise<{ checkoutUrl: string; sessionId: string }> {
    const { db, stripe, obs } = this.config;

    // Step 1: Get content details (must be published and not deleted)
    const contentItem = await db.query.content.findFirst({
      where: and(
        eq(content.id, contentId),
        eq(content.status, 'published'),
        isNull(content.deletedAt)
      ),
    });

    if (!contentItem) {
      throw new Error('CONTENT_NOT_FOUND');
    }

    if (contentItem.priceCents === null || contentItem.priceCents === 0) {
      throw new Error('CONTENT_IS_FREE'); // Free content doesn't need checkout
    }

    // Step 2: Check for existing purchase (prevent duplicates)
    const existingPurchase = await db.query.purchases.findFirst({
      where: and(
        eq(purchases.customerId, customerId),
        eq(purchases.contentId, contentId),
        eq(purchases.status, 'completed'),
        isNull(purchases.refundedAt)
      ),
    });

    if (existingPurchase) {
      throw new Error('ALREADY_PURCHASED');
    }

    // Step 3: Create Stripe Checkout Session
    // Note: We don't create purchase record yet - webhook does that on completion
    // This prevents pending records for abandoned checkouts
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: contentItem.title,
            description: contentItem.description || undefined,
          },
          unit_amount: contentItem.priceCents,
        },
        quantity: 1,
      }],
      success_url: `${process.env.WEB_APP_URL}/content/${contentId}?purchase=success`,
      cancel_url: `${process.env.WEB_APP_URL}/content/${contentId}?purchase=cancel`,
      metadata: {
        customerId,
        contentId,
        creatorId: contentItem.creatorId,
        organizationId: contentItem.organizationId || '',
        priceCents: contentItem.priceCents.toString(),
      },
    });

    obs.info('Checkout session created', {
      sessionId: session.id,
      customerId,
      contentId,
      amountCents: contentItem.priceCents,
    });

    if (!session.url) {
      throw new Error('STRIPE_SESSION_URL_MISSING');
    }

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
    };
  }

  async hasAccess(customerId: string, contentId: string): Promise<boolean> {
    const { db } = this.config;

    const purchase = await db.query.purchases.findFirst({
      where: and(
        eq(purchases.customerId, customerId),
        eq(purchases.contentId, contentId),
        eq(purchases.status, 'completed'),
        isNull(purchases.refundedAt)
      ),
    });

    return !!purchase;
  }

  async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const { db, obs } = this.config;

    const { customerId, contentId, creatorId, organizationId, priceCents } = session.metadata || {};

    if (!customerId || !contentId || !creatorId || !priceCents) {
      throw new Error('MISSING_METADATA');
    }

    const paymentIntentId = session.payment_intent as string;
    if (!paymentIntentId) {
      throw new Error('MISSING_PAYMENT_INTENT');
    }

    const amountPaidCents = parseInt(priceCents, 10);

    // Idempotency: Check if purchase with this payment intent already exists
    const existingPurchase = await db.query.purchases.findFirst({
      where: eq(purchases.stripePaymentIntentId, paymentIntentId),
    });

    if (existingPurchase) {
      obs.info('Purchase already recorded', { purchaseId: existingPurchase.id, paymentIntentId });
      return; // Already processed (duplicate webhook)
    }

    // Phase 1: Simple revenue model (100% to creator, no fees)
    const platformFeeCents = 0;
    const organizationFeeCents = 0;
    const creatorPayoutCents = amountPaidCents;

    // Create completed purchase record
    const [purchase] = await db.insert(purchases).values({
      customerId,
      contentId,
      amountPaidCents,
      currency: 'usd',
      stripePaymentIntentId: paymentIntentId,
      platformFeeCents,
      organizationFeeCents,
      creatorPayoutCents,
      status: 'completed',
      purchasedAt: new Date(),
      creatorPayoutStatus: 'pending', // Phase 3: Stripe Connect will handle payout
      organizationPayoutStatus: organizationId ? 'pending' : null,
    }).returning();

    obs.info('Purchase completed', {
      purchaseId: purchase.id,
      customerId,
      contentId,
      amountPaidCents,
      paymentIntentId,
    });

    // TODO: Send purchase confirmation email (P1-NOTIFY-001)
    // TODO: Phase 3 - Trigger Stripe Connect payout to creator
  }
}

/**
 * Factory function for dependency injection
 */
export function getPurchaseService(env: {
  DATABASE_URL: string;
  STRIPE_SECRET_KEY: string;
  ENVIRONMENT: string;
}): PurchaseService {
  const database = getDbClient(env.DATABASE_URL);
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-11-20.acacia',
    typescript: true,
  });
  const obs = new ObservabilityClient('purchase-service', env.ENVIRONMENT);

  return new PurchaseService({
    db: database,
    stripe,
    obs,
  });
}
```

### Step 4: Create Checkout API Endpoints

**Note**: All endpoints require authentication. Customer ID comes from auth context, not client input (prevents spoofing).

**File**: `workers/purchase-api/src/routes/checkout.ts` (or add to existing worker)

```typescript
import { Hono } from 'hono';
import type { Context } from 'hono';
import { getPurchaseService } from '@codex/purchases';
import { createCheckoutSchema, checkAccessSchema } from '@codex/validation';
import { requireAuth } from '../middleware/auth';
import { securityHeaders, rateLimit } from '@codex/security';
import { ZodError } from 'zod';
import { ObservabilityClient } from '@codex/observability';

type Bindings = {
  DATABASE_URL: string;
  STRIPE_SECRET_KEY: string;
  ENVIRONMENT: string;
};

type AuthContext = {
  Bindings: Bindings;
  Variables: {
    user: { id: string; email: string; role: string };
  };
};

const app = new Hono<AuthContext>();

// Security middleware
app.use('*', securityHeaders());
app.use('/api/checkout', rateLimit({ windowMs: 60000, max: 10 })); // 10 checkouts/min per IP

/**
 * POST /api/checkout - Create Stripe checkout session
 */
app.post('/api/checkout', requireAuth(), async (c: Context<AuthContext>) => {
  const obs = new ObservabilityClient('purchase-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const body = await c.req.json();
    const validated = createCheckoutSchema.parse(body);

    const service = getPurchaseService(c.env);
    const result = await service.createCheckoutSession(
      user.id, // Customer ID from auth, not client input!
      validated.contentId
    );

    return c.json({ data: result }, 201);
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: err.errors }
      }, 400);
    }

    const errorMessage = (err as Error).message;
    if (errorMessage === 'CONTENT_NOT_FOUND') {
      return c.json({
        error: { code: 'CONTENT_NOT_FOUND', message: 'Content not found or not published' }
      }, 404);
    }
    if (errorMessage === 'CONTENT_IS_FREE') {
      return c.json({
        error: { code: 'CONTENT_IS_FREE', message: 'Free content does not require checkout' }
      }, 400);
    }
    if (errorMessage === 'ALREADY_PURCHASED') {
      return c.json({
        error: { code: 'ALREADY_PURCHASED', message: 'You have already purchased this content' }
      }, 409);
    }

    obs.trackError(err as Error, { userId: user.id, contentId: validated.contentId });
    return c.json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create checkout session' }
    }, 500);
  }
});

/**
 * GET /api/purchases/access/:contentId - Check if user has access to content
 * Used by content player to verify purchase before streaming
 */
app.get('/api/purchases/access/:contentId', requireAuth(), async (c: Context<AuthContext>) => {
  const obs = new ObservabilityClient('purchase-api', c.env.ENVIRONMENT);
  const user = c.get('user');
  const contentId = c.req.param('contentId');

  try {
    const validated = checkAccessSchema.parse({ contentId });

    const service = getPurchaseService(c.env);
    const hasAccess = await service.hasAccess(user.id, validated.contentId);

    return c.json({ data: { hasAccess } });
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid content ID', details: err.errors }
      }, 400);
    }

    obs.trackError(err as Error, { userId: user.id, contentId });
    return c.json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to check access' }
    }, 500);
  }
});

export default app;
```

---

## Testing Strategy

**Test Specifications**: See `design/roadmap/testing/ecommerce-testing-definition.md` for comprehensive test patterns, including:
- Validation tests (Zod schemas, pure functions, no DB, 100% coverage)
- Service tests (mocked Stripe API, mocked DB, business logic isolation)
- Integration tests (real DB, real Stripe test mode, end-to-end checkout flow)
- Webhook handler tests (signature verification, idempotency, duplicate handling)
- Common testing patterns and test data factories

**To Run Tests**:
```bash
# Validation tests (fast, no DB, no Stripe)
pnpm --filter @codex/validation test

# Service tests (fast, mocked DB, mocked Stripe)
pnpm --filter @codex/purchases test

# Integration tests (slow, real DB, Stripe test mode)
STRIPE_SECRET_KEY=sk_test_... DATABASE_URL=postgresql://... pnpm --filter @codex/purchases test:integration

# All tests
pnpm test

# With coverage
pnpm test --coverage
```

---

## Definition of Done

### Code Implementation
- [ ] Purchase schema created in `packages/database/src/schema/purchases.ts`
  - [ ] `purchases` table with all fields from database-schema.md v2.0
  - [ ] UUID primary keys, integer cents for money
  - [ ] Revenue split fields (Phase 1: platformFeeCents=0, organizationFeeCents=0)
  - [ ] Payout tracking fields (Phase 3+)
  - [ ] Proper indexes and constraints
  - [ ] CHECK constraint: amount = platform + org + creator
  - [ ] Partial unique index: prevent duplicate purchases
- [ ] Migration generated and applied
  - [ ] SQL matches database-schema.md lines 320-410
  - [ ] CHECK constraints added manually to migration
  - [ ] Partial unique index added manually
  - [ ] Migration tested on local DB
- [ ] Validation schemas in `packages/validation/src/purchase-schemas.ts`
  - [ ] `createCheckoutSchema` (contentId only)
  - [ ] `checkAccessSchema`
- [ ] Purchase service implemented in `packages/purchases/src/service.ts`
  - [ ] `createCheckoutSession()` method
  - [ ] `hasAccess()` method (check if customer purchased content)
  - [ ] `handleCheckoutCompleted()` method (webhook handler)
  - [ ] Dependency injection pattern with PurchaseServiceConfig
  - [ ] Factory function `getPurchaseService()`
  - [ ] Phase 1 revenue model: 100% to creator
- [ ] API endpoints created in `workers/purchase-api/src/routes/checkout.ts`
  - [ ] POST /api/checkout (create session)
  - [ ] GET /api/purchases/access/:contentId (check access)

### Testing
- [ ] Validation tests passing (100% coverage, no DB, no Stripe)
  - [ ] All validation rules tested
  - [ ] Edge cases covered
- [ ] Service tests passing (mocked DB, mocked Stripe)
  - [ ] All public methods tested
  - [ ] Error paths tested
  - [ ] Business logic verified
  - [ ] Stripe API mocked (no real calls)
- [ ] Integration tests passing (with test DB, Stripe test mode)
  - [ ] End-to-end checkout flow
  - [ ] Duplicate purchase prevention
  - [ ] Webhook idempotency
  - [ ] Revenue split calculations (Phase 1)
- [ ] API tests passing
  - [ ] Authentication required
  - [ ] All endpoints tested
  - [ ] Error responses verified

### Quality & Security
- [ ] Customer ID from auth context only (never from client input)
- [ ] Content must be published to purchase
- [ ] Duplicate purchase prevention working
- [ ] Webhook idempotency working (payment_intent_id as key)
- [ ] Revenue split validation (CHECK constraint enforced)
- [ ] Observability logging added
  - [ ] All operations logged
  - [ ] No PII in logs (only IDs)
- [ ] Error handling comprehensive
  - [ ] All error codes documented
  - [ ] Proper HTTP status codes
- [ ] Input validation with Zod
- [ ] TypeScript types exported

### Documentation
- [ ] Schema fields documented
- [ ] API endpoints documented
- [ ] Error codes documented
- [ ] Service interfaces documented
- [ ] Integration points documented
- [ ] Stripe API version noted (2024-11-20.acacia)

### DevOps
- [ ] CI passing (tests + typecheck + lint)
- [ ] No new ESLint warnings
- [ ] No new TypeScript errors
- [ ] Code reviewed against STANDARDS.md
- [ ] Branch deployed to staging
- [ ] Stripe test mode keys configured in staging

---

## Interfaces & Integration Points

### Upstream Dependencies

**P1-CONTENT-001** (Content Management):
- **Dependency**: Checkout requires published content with pricing
- **Tables**: `content` (lines 185-254 in database-schema.md)
- **Fields Used**:
  - `id` - Referenced by `purchases.content_id`
  - `title`, `description` - Stripe product data
  - `price_cents` - Stripe amount (must be > 0)
  - `status` - Must be 'published'
  - `creator_id` - For revenue routing (Phase 1: 100% to creator)
  - `organization_id` - For org revenue (Phase 2+)
  - `deleted_at` - Must be NULL
- **Query Example**:
```typescript
// Purchase service validates content before checkout
const contentItem = await db.query.content.findFirst({
  where: and(
    eq(content.id, contentId),
    eq(content.status, 'published'),
    isNull(content.deletedAt)
  ),
});

if (!contentItem) throw new Error('CONTENT_NOT_FOUND');
if (contentItem.priceCents === null || contentItem.priceCents === 0) {
  throw new Error('CONTENT_IS_FREE');
}
```

**Auth Middleware**:
- **Dependency**: All API endpoints require authenticated customer
- **Context Required**: `user.id` (used as customerId)
- **Middleware**: `requireAuth()` sets `c.get('user')`
- **Security**: Customer ID from auth prevents spoofing (user cannot purchase as someone else)

**Stripe API**:
- **Dependency**: Stripe SDK for checkout sessions and webhooks
- **API Version**: `2024-11-20.acacia`
- **Secrets Required**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET_PAYMENT`
- **Test Mode**: Always use `sk_test_*` keys in development/CI
- **Integration**: Create checkout session → redirect to Stripe → webhook on completion

### Downstream Consumers

**P1-ECOM-002** (Stripe Webhooks):
- **Consumes**: `handleCheckoutCompleted()` method from purchase service
- **Webhook Event**: `checkout.session.completed`
- **Integration**:
```typescript
// Webhook handler calls purchase service
app.post('/webhooks/stripe/payment', verifySignature(), async (c) => {
  const event = await stripe.webhooks.constructEvent(body, signature, secret);

  if (event.type === 'checkout.session.completed') {
    const service = getPurchaseService(c.env);
    await service.handleCheckoutCompleted(event.data.object);
  }
});
```
- **Idempotency**: Uses `stripe_payment_intent_id` (unique per payment)
- **Metadata Required**: `customerId`, `contentId`, `creatorId`, `priceCents`

**P1-ACCESS-001** (Content Access):
- **Consumes**: `hasAccess()` method to check if customer purchased content
- **Integration**:
```typescript
// Access service checks purchase before granting access
const service = getPurchaseService(env);
const hasPurchased = await service.hasAccess(customerId, contentId);

if (!hasPurchased && content.visibility === 'purchased_only') {
  throw new Error('PURCHASE_REQUIRED');
}
```
- **Fields Read**: `customer_id`, `content_id`, `status`, `refunded_at`
- **Query Pattern**: Only completed, non-refunded purchases grant access

**P1-NOTIFY-001** (Email Service):
- **Consumes**: `purchases` table for purchase confirmation emails
- **Trigger**: After `handleCheckoutCompleted()` creates purchase
- **TODO**: Call email service from purchase service (not yet implemented)
- **Email Data**: Customer email, content title, amount paid, receipt URL

**P1-ADMIN-001** (Admin Dashboard):
- **Consumes**: `purchases` table for platform analytics
- **Access Pattern**: Platform owners view all purchases
- **Query**: No customer filtering (admin sees all)
- **Use Case**: Revenue tracking, purchase analytics, support

### Error Propagation

| Service Error | HTTP Status | Error Code | Downstream Impact |
|---------------|-------------|------------|-------------------|
| `CONTENT_NOT_FOUND` | 404 | `CONTENT_NOT_FOUND` | Customer cannot purchase unpublished/deleted content |
| `CONTENT_IS_FREE` | 400 | `CONTENT_IS_FREE` | Customer should access free content directly |
| `ALREADY_PURCHASED` | 409 | `ALREADY_PURCHASED` | Customer already owns content (access granted) |
| `STRIPE_SESSION_URL_MISSING` | 500 | `INTERNAL_ERROR` | Stripe API failure (retry or contact support) |
| `MISSING_METADATA` | 500 | `INTERNAL_ERROR` | Webhook missing data (investigate Stripe integration) |
| `MISSING_PAYMENT_INTENT` | 500 | `INTERNAL_ERROR` | Webhook missing payment intent (Stripe error) |
| `VALIDATION_ERROR` | 400 | `VALIDATION_ERROR` | Client receives field-level validation errors |

### Business Rules

1. **Content Must Be Published**: Only published content can be purchased
   - Enforced in service: `eq(content.status, 'published')`
   - Prevents purchasing draft/archived content

2. **Duplicate Purchase Prevention**: Customer cannot purchase same content twice
   - Database constraint: Unique index on (customer_id, content_id) WHERE status='completed' AND refunded_at IS NULL
   - Service checks existing purchase before creating session

3. **Free Content No Checkout**: Free content (priceCents=0 or NULL) doesn't use Stripe
   - Enforced in service: Throw error if price is 0
   - Customer accesses free content directly (no purchase record)

4. **Revenue Split Validation**: Money splits must add up exactly (no rounding errors)
   - Database CHECK constraint: `amount_paid_cents = platform_fee_cents + organization_fee_cents + creator_payout_cents`
   - Phase 1: `platform_fee_cents = 0`, `organization_fee_cents = 0`, `creator_payout_cents = amount_paid_cents`

5. **Webhook Idempotency**: Duplicate webhooks don't create duplicate purchases
   - Enforced by: `stripe_payment_intent_id` UNIQUE constraint
   - Service checks existing purchase with payment_intent_id before insert

6. **Customer ID from Auth**: Customer ID always from auth context, never client input
   - Security: Prevents user purchasing as someone else
   - Enforced in API: `customerId = user.id` (from JWT)

### Data Flow Examples

**Purchase Flow**:
```
Customer              API                Service              Stripe
  |                    |                    |                    |
  | POST /api/checkout |                    |                    |
  |------------------->|                    |                    |
  |                    | validate content   |                    |
  |                    |------------------->|                    |
  |                    |                    | check published    |
  |                    |                    | check not purchased|
  |                    |                    | create session     |
  |                    |                    |------------------->|
  |                    |                    |<-------------------|
  |                    |<-------------------|                    |
  | {checkoutUrl}      |                    |                    |
  |<-------------------|                    |                    |
  | redirect to Stripe |                    |                    |
  |------------------------------------------->                  |
  | enters card, pays  |                    |                    |
  |------------------------------------------->                  |
  |                    |                    |                    |
  |                    |      (webhook: checkout.session.completed)
  |                    |                    |<-------------------|
  |                    |                    | create purchase    |
  |                    |                    | status='completed' |
  |                    | redirect success   |                    |
  |<----------------------------------------|                    |
```

**Access Check Flow**:
```
Content Player      Access API          Purchase Service      Database
  |                    |                       |                   |
  | GET /api/access/:id|                       |                   |
  |------------------->|                       |                   |
  |                    | hasAccess(customer,id)|                   |
  |                    |---------------------->|                   |
  |                    |                       | query purchases   |
  |                    |                       |------------------>|
  |                    |                       |<------------------|
  |                    |<----------------------|                   |
  | {hasAccess: true}  |                       |                   |
  |<-------------------|                       |                   |
```

---

## Business Context

### Why This Matters

Stripe checkout is the **revenue generation engine** of the platform - creators monetize content, customers purchase access. This work packet enables:

1. **Creator Monetization**: Creators set prices, customers pay, money flows
2. **Transaction Security**: Stripe handles PCI compliance (no card storage)
3. **Revenue Splitting**: Foundation for Phase 2+ platform/org fees
4. **Purchase Tracking**: Audit trail for accounting, support, refunds

### User Personas

**Customer (Primary)**:
- Discovers paid content via marketplace/search
- Clicks "Purchase" → redirected to Stripe Checkout
- Enters payment info (card, Apple Pay, Google Pay)
- Redirected back to platform with access granted
- Receives purchase confirmation email (P1-NOTIFY-001)

**Creator**:
- Sets content pricing via P1-CONTENT-001
- Receives 100% of revenue (Phase 1)
- Views purchase analytics in dashboard
- Can issue refunds (Phase 2+)

**Platform Owner** (via P1-ADMIN-001):
- Views all purchases across platform
- Monitors revenue metrics
- Handles customer support (refunds, disputes)
- Tracks Stripe fees and payouts (Phase 3+)

### Business Rules (Expanded)

**Purchase Lifecycle**:
```
pending (Stripe checkout) → completed (payment success) → [refunded] (optional)
                         ↓
                     failed (payment declined)
```

**Revenue Model (Phase 1)**:
- `platform_fee_cents` = 0 (no platform fee)
- `organization_fee_cents` = 0 (no org fee)
- `creator_payout_cents` = `amount_paid_cents` (100% to creator)
- Constraint: `amount_paid_cents = 0 + 0 + creator_payout_cents`

**Revenue Model (Phase 2+)**:
- Platform fee: Configurable % or flat fee
- Organization fee: Configurable % or flat fee (if content belongs to org)
- Creator payout: Remainder after fees
- Constraint ensures exact cent allocation (no rounding errors)

---

## Security Considerations

### Authentication & Authorization

**Layer 1: API Authentication**:
- All endpoints require `requireAuth()` middleware
- JWT token validated, customer context injected
- No anonymous purchases

**Layer 2: Customer ID Security**:
- Customer ID from auth context: `customerId = user.id`
- NEVER from client input (prevents spoofing)
- User cannot purchase as someone else

**Layer 3: Content Validation**:
- Content must be published (not draft/archived)
- Content must have price > 0
- Content must not be deleted

**Layer 4: Webhook Verification**:
- Stripe webhook signature verified (P1-ECOM-002)
- Prevents malicious webhook injection
- Uses `STRIPE_WEBHOOK_SECRET_PAYMENT`

### PCI Compliance

- **No Card Storage**: Stripe handles all payment data
- **No Card Processing**: Platform never sees card numbers
- **Stripe Checkout**: PCI-compliant hosted page
- **Tokens Only**: Platform stores `stripe_payment_intent_id` (safe identifier)

### Duplicate Purchase Prevention

**Database Level**:
```sql
CREATE UNIQUE INDEX idx_no_duplicate_purchases
  ON purchases(customer_id, content_id)
  WHERE status = 'completed' AND refunded_at IS NULL;
```

**Service Level**:
```typescript
const existingPurchase = await db.query.purchases.findFirst({
  where: and(
    eq(purchases.customerId, customerId),
    eq(purchases.contentId, contentId),
    eq(purchases.status, 'completed'),
    isNull(purchases.refundedAt)
  ),
});

if (existingPurchase) throw new Error('ALREADY_PURCHASED');
```

### Webhook Idempotency

**Payment Intent as Key**:
- Stripe sends duplicate webhooks (network retries)
- `stripe_payment_intent_id` is UNIQUE identifier
- Service checks existing purchase before insert
- Prevents double-charging

**Observability Pattern**:
```typescript
const existingPurchase = await db.query.purchases.findFirst({
  where: eq(purchases.stripePaymentIntentId, paymentIntentId),
});

if (existingPurchase) {
  obs.info('Purchase already recorded', { purchaseId: existingPurchase.id });
  return; // Already processed
}
```

### Threat Scenarios

| Threat | Mitigation |
|--------|------------|
| User purchases as another user | Customer ID from auth only, not client input |
| User purchases unpublished content | Service validates `status = 'published'` |
| User purchases same content twice | Unique constraint + service check |
| Malicious webhook injection | Signature verification in P1-ECOM-002 |
| Payment intent replay | UNIQUE constraint on `stripe_payment_intent_id` |
| Revenue split manipulation | CHECK constraint enforces sum validation |

---

## Performance Considerations

### Database Indexes

**Critical Indexes** (from schema):
```sql
-- Customer purchase lookup (access check)
CREATE INDEX idx_purchases_customer_id ON purchases(customer_id);

-- Content sales analytics
CREATE INDEX idx_purchases_content_id ON purchases(content_id);

-- Purchase status filtering
CREATE INDEX idx_purchases_status ON purchases(status);

-- Recent purchases (admin dashboard)
CREATE INDEX idx_purchases_created_at ON purchases(created_at);

-- Webhook idempotency lookup
CREATE INDEX idx_purchases_stripe_payment_intent_id ON purchases(stripe_payment_intent_id);

-- Payout tracking (Phase 3+)
CREATE INDEX idx_purchases_payout_status ON purchases(creator_payout_status, organization_payout_status);
```

**Index Usage**:
- `customer_id` index: Access check (most frequent query)
- `stripe_payment_intent_id` index: Webhook idempotency check
- `created_at` index: Recent purchases for admin
- `status` index: Filtering completed/pending/refunded

### Expected Load (Phase 1)

- **Purchases**: ~10-50 per day (customer activity)
- **Access Checks**: ~1,000-10,000 per day (content streaming)
- **Webhooks**: Same as purchases (1:1 ratio)
- **Checkout Sessions**: ~15-75 per day (some abandoned, ~66% conversion)

**Database Sizing**:
- `purchases` table: ~500 rows (Phase 1)
- Total storage: < 100 KB (metadata only)

### Stripe API Performance

- **Checkout Session Creation**: ~300-500ms (Stripe API call)
- **Webhook Processing**: ~50-100ms (database insert)
- **Access Check**: < 10ms (indexed query)

**Rate Limiting**:
- Checkout: 10 requests/min per IP (prevents abuse)
- Stripe API: 100 requests/second (default limit)

---

## Monitoring & Observability

### Logging Strategy

**Service Logs** (ObservabilityClient):
```typescript
// Checkout session created
obs.info('Checkout session created', {
  sessionId: session.id,
  customerId,
  contentId,
  amountCents: contentItem.priceCents,
});

// Purchase completed
obs.info('Purchase completed', {
  purchaseId: purchase.id,
  customerId,
  contentId,
  amountPaidCents,
  paymentIntentId,
});

// Errors
obs.trackError(err, { userId: user.id, contentId });
```

**API Logs**:
```typescript
obs.info('Checkout API request', {
  method: 'POST',
  path: '/api/checkout',
  userId: user.id,
  contentId: validated.contentId,
});
```

### Metrics to Track

**Purchase Metrics**:
- `purchases.created.count` - Total purchases (by content, by customer)
- `purchases.revenue.sum` - Total revenue in cents
- `purchases.revenue.avg` - Average purchase price
- `purchases.completed.count` - Successful purchases
- `purchases.failed.count` - Failed payments

**Checkout Metrics**:
- `checkout.sessions.created.count` - Sessions created
- `checkout.conversion.rate` - Sessions → completed purchases (%)
- `checkout.abandoned.count` - Sessions without completion

**API Metrics**:
- `api.checkout.requests.count` - By endpoint
- `api.checkout.latency.p95` - 95th percentile latency
- `api.checkout.errors.count` - By error code

### Alerts

**Critical Alerts**:
- `purchases.failed.rate > 10%` - High payment failure rate
- `api.checkout.errors.rate > 5%` - High API error rate
- `stripe.api.latency > 2000ms` - Stripe API slow

**Warning Alerts**:
- `checkout.conversion.rate < 50%` - Low conversion (abandoned checkouts)
- `purchases.created.count = 0` for 24h - No revenue

---

## Rollout Plan

### Pre-Deployment

1. **Stripe Account Setup**:
   - Create Stripe account (or use existing test account)
   - Generate API keys: `STRIPE_SECRET_KEY` (sk_test_* for staging)
   - Generate webhook secret: `STRIPE_WEBHOOK_SECRET_PAYMENT`
   - Configure webhook endpoint in Stripe dashboard

2. **Database Migration**:
```bash
# Generate migration
pnpm --filter @codex/database db:gen:drizzle

# Edit migration to add CHECK constraints and partial unique index

# Apply to staging DB
DATABASE_URL=<staging> pnpm --filter @codex/database db:migrate

# Verify table exists
psql <staging_db> -c "\d purchases"
```

3. **Seed Test Data**:
```sql
-- Insert test purchase (for testing hasAccess)
INSERT INTO purchases (id, customer_id, content_id, amount_paid_cents, currency, stripe_payment_intent_id, platform_fee_cents, organization_fee_cents, creator_payout_cents, status, purchased_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '<test_customer_id>',
  '<test_content_id>',
  999,
  'usd',
  'pi_test_123',
  0,
  0,
  999,
  'completed',
  NOW()
);
```

### Deployment Steps

1. **Deploy Code**:
   - Merge feature branch to main
   - CI builds and deploys to staging
   - Smoke test: `curl -X POST https://staging.codex.app/api/checkout -H "Authorization: Bearer <token>" -d '{"contentId":"<uuid>"}'`

2. **Verify Stripe Integration**:
   - Create test checkout session
   - Complete payment in Stripe test mode
   - Verify webhook received (P1-ECOM-002)
   - Verify purchase record created

3. **Test Access Check**:
   - Call `/api/purchases/access/:contentId` with purchased content
   - Verify `{hasAccess: true}` response

4. **Monitor**:
   - Watch logs for errors
   - Check metrics dashboard
   - Verify Stripe dashboard shows test payments

### Rollback Plan

**If Issues Detected**:
1. **Code Rollback**: Revert deploy via CI
2. **Database Rollback** (if schema issues):
```sql
-- Drop table (only if no production data!)
DROP TABLE purchases CASCADE;

-- Revert migration
DELETE FROM drizzle_migrations WHERE name = '000X_purchases';
```

**Rollback Criteria**:
- Error rate > 10%
- Stripe API failures
- Webhook processing errors
- Revenue split constraint violations

---

## Known Limitations (Phase 1)

### Simplified Revenue Model

1. **No Platform Fee**:
   - Phase 1: 100% to creator (`platform_fee_cents = 0`)
   - Limitation: Platform doesn't earn revenue yet
   - Future: Configurable platform fee (% or flat)

2. **No Organization Fee**:
   - Phase 1: No org cut (`organization_fee_cents = 0`)
   - Future: Orgs can take % of creator sales

3. **No Stripe Connect Payouts**:
   - Phase 1: Manual payouts (outside platform)
   - Future (Phase 3+): Automated payouts via Stripe Connect

### Missing Features

1. **No Refunds**:
   - Phase 1: No refund UI/API
   - Workaround: Manual refund in Stripe dashboard
   - Future: Refund endpoint, partial refunds

2. **No Subscriptions**:
   - Phase 1: One-time purchases only
   - Future: Monthly/annual subscriptions (Stripe Subscriptions)

3. **No Bundles/Discounts**:
   - Phase 1: Individual content purchases
   - Future: Content bundles, promo codes, discounts

4. **No Multi-Currency**:
   - Phase 1: USD only
   - Future: Support EUR, GBP, etc.

### Technical Debt

1. **No Abandoned Cart Recovery**:
   - Phase 1: No pending purchase records
   - Impact: Cannot email customers who abandoned checkout
   - Future: Track checkout sessions, send reminder emails

2. **No Purchase Analytics**:
   - Phase 1: Basic count/sum metrics
   - Future: Detailed analytics (conversion funnel, revenue by content)

3. **No Fraud Detection**:
   - Phase 1: Relies on Stripe Radar (default)
   - Future: Custom fraud rules, velocity checks

---

## Questions & Clarifications

### Resolved

**Q: Should we create purchase record before or after Stripe checkout?**
A: After (in webhook). Creating before leads to abandoned purchase records. Webhook ensures only successful payments create records.

**Q: How to prevent duplicate purchases?**
A: Two layers: (1) Service checks existing purchase before creating session, (2) Database unique constraint on (customer_id, content_id) WHERE status='completed'.

**Q: How to handle duplicate webhooks?**
A: Use `stripe_payment_intent_id` as idempotency key. Check if purchase with that payment_intent_id exists before inserting.

**Q: Should free content use purchase records?**
A: No. Free content (price=0 or NULL) throws `CONTENT_IS_FREE` error. Customer accesses directly without purchase flow.

**Q: How to calculate revenue splits in Phase 1?**
A: Simple: `platform_fee_cents = 0`, `organization_fee_cents = 0`, `creator_payout_cents = amount_paid_cents`. CHECK constraint enforces sum.

### Open

**Q: Should we support Apple Pay / Google Pay?**
Current: Stripe Checkout supports them automatically (payment_method_types: ['card'])
- **Recommendation**: Phase 1 - default Stripe handling. Phase 2 - explicitly list payment methods.

**Q: Should we track abandoned checkouts?**
Current: No tracking (no pending purchase record)
- **Recommendation**: Phase 2 - track checkout sessions, send reminder emails after 24h.

**Q: How to handle Stripe fees?**
Current: Stripe deducts ~2.9% + 30¢ from each payment (standard pricing)
- **Impact**: Creator receives net amount (Stripe fee already deducted)
- **Future**: Store Stripe fee in purchase record for accounting

---

## Success Criteria

### Functional Goals

- [ ] Customer can purchase paid content via Stripe Checkout
- [ ] Customer redirected to Stripe → enters payment → redirected back
- [ ] Purchase record created on successful payment (via webhook)
- [ ] Duplicate purchase prevention working (both service + DB)
- [ ] Access check returns `true` for purchased content
- [ ] Webhook idempotency working (duplicate webhooks handled)
- [ ] Revenue split calculated correctly (Phase 1: 100% to creator)
- [ ] Free content throws error (no checkout for free)
- [ ] Content must be published to purchase

### Non-Functional Goals

- [ ] Checkout latency < 1 second (Stripe API call)
- [ ] Access check latency < 50ms (database query)
- [ ] Webhook processing < 200ms
- [ ] All operations logged to observability (no PII)
- [ ] 100% test coverage for validation schemas
- [ ] 80%+ test coverage for service logic
- [ ] Stripe API mocked in tests (no real calls in CI)
- [ ] Proper error codes and HTTP status

### Business Goals

- [ ] P1-ECOM-002 can process checkout webhooks successfully
- [ ] P1-ACCESS-001 can check purchase before granting access
- [ ] P1-ADMIN-001 can view purchase analytics
- [ ] Creators receive 100% of revenue (Phase 1)
- [ ] Stripe handles PCI compliance (no card storage)
- [ ] Purchase flow is intuitive (minimal friction)

---

## Related Documentation

**Database Schema** (Source of Truth):
- [database-schema.md](../../features/shared/database-schema.md) - v2.0
  - Lines 320-410: `purchases` table (revenue splits, payout tracking)
  - Lines 185-254: `content` table (referenced by purchases)
  - Lines 65-127: `users` table (customer_id, creator_id FK)

**Architecture & Patterns**:
- [STANDARDS.md](../STANDARDS.md) - Coding patterns
  - § 1.2: Validation separation (Zod schemas separate from DB)
  - § 2.1: Service layer patterns (dependency injection)
  - § 2.3: Payment security (PCI compliance, customer ID from auth)
  - § 3.1: Error handling (error codes, observability)
- [Stripe Integration Guide](../../infrastructure/StripeIntegration.md) - Stripe patterns
  - § 2: Checkout Sessions (hosted checkout)
  - § 4: Webhook handling (signature verification, idempotency)
  - § 6: Test mode best practices

**Testing Strategy**:
- [ecommerce-testing-definition.md](../testing/ecommerce-testing-definition.md) - Test specifications
  - Lines 1-80: Validation test patterns
  - Lines 81-200: Service test patterns (mocked Stripe)
  - Lines 201-300: Integration test patterns (Stripe test mode)
  - Lines 301-350: Webhook test patterns (signature, idempotency)
- [Testing.md](../../infrastructure/Testing.md) - General testing approach
  - § 2: Unit vs integration tests
  - § 5: Mocking external APIs (Stripe)

**Feature Specifications**:
- [ttd-dphase-1.md](../../features/e-commerce/ttd-dphase-1.md) - E-commerce requirements
  - § 1: Purchase flow (customer → checkout → webhook → access)
  - § 3: Revenue model (Phase 1: 100% to creator)
  - § 5: Duplicate prevention (idempotency)

**Related Work Packets**:
- [P1-CONTENT-001](./P1-CONTENT-001-content-service.md) - Content must be published to purchase (upstream)
- [P1-ECOM-002](./P1-ECOM-002-stripe-webhooks.md) - Webhook handler calls handleCheckoutCompleted() (downstream)
- [P1-ACCESS-001](./P1-ACCESS-001-content-access.md) - Checks hasAccess() before streaming (downstream)
- [P1-NOTIFY-001](./P1-NOTIFY-001-email-service.md) - Purchase confirmation emails (downstream)
- [P1-ADMIN-001](./P1-ADMIN-001-admin-dashboard.md) - Purchase analytics (downstream)

**Code Examples**:
- Webhook handler skeleton: `workers/stripe-webhook-handler/src/index.ts`
- Signature verification: `workers/stripe-webhook-handler/src/middleware/verify-signature.ts`
- Auth middleware: `workers/auth/src/middleware/auth.ts` - Hono auth pattern
- Validation: `packages/validation/src/user-schema.ts` - Zod schema examples

**Infrastructure**:
- [CI/CD Guide](../../infrastructure/CICD.md) - Deployment automation
  - § 3: Path-based test filtering
  - § 7: Stripe test mode in CI
- [Observability](../../infrastructure/Observability.md) - Logging and metrics
  - § 2: PII redaction patterns
  - § 4: Error tracking

---

## Notes for LLM Developer

### Critical Patterns

1. **Customer ID from Auth**: ALWAYS use customer ID from auth context
   - Customer ID = `user.id` from JWT
   - NEVER from client input (prevents spoofing)
   - User cannot purchase as someone else

2. **Stripe SDK Setup**:
   ```typescript
   import Stripe from 'stripe';

   const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
     apiVersion: '2024-11-20.acacia', // Pin API version
     typescript: true,
   });
   ```

3. **Mock Stripe in Tests**: Never make real Stripe API calls in CI
   ```typescript
   vi.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue({
     id: 'cs_test_123',
     url: 'https://checkout.stripe.com/test',
   } as any);
   ```

4. **Webhook Idempotency**: Use payment_intent_id as key
   ```typescript
   const existingPurchase = await db.query.purchases.findFirst({
     where: eq(purchases.stripePaymentIntentId, paymentIntentId),
   });

   if (existingPurchase) {
     obs.info('Purchase already recorded');
     return; // Already processed
   }
   ```

5. **Revenue Split Validation**: Phase 1 simple model
   ```typescript
   const platformFeeCents = 0;
   const organizationFeeCents = 0;
   const creatorPayoutCents = amountPaidCents; // 100% to creator

   // Database CHECK constraint enforces:
   // amountPaidCents = platformFeeCents + organizationFeeCents + creatorPayoutCents
   ```

### Common Pitfalls

1. **Taking customer ID from client input**:
   ```typescript
   // ❌ WRONG - client can spoof customer ID
   const body = await c.req.json();
   const service = getPurchaseService(c.env);
   await service.createCheckoutSession(body.customerId, body.contentId);

   // ✅ CORRECT - customer ID from auth
   const user = c.get('user');
   const service = getPurchaseService(c.env);
   await service.createCheckoutSession(user.id, validated.contentId);
   ```

2. **Creating purchase record before Stripe checkout**:
   ```typescript
   // ❌ WRONG - creates abandoned purchase records
   const [purchase] = await db.insert(purchases).values({ status: 'pending' });
   const session = await stripe.checkout.sessions.create({...});
   // User abandons checkout → pending purchase stays forever

   // ✅ CORRECT - create purchase in webhook only
   const session = await stripe.checkout.sessions.create({...});
   // Webhook creates purchase only if payment succeeds
   ```

3. **Not checking webhook idempotency**:
   ```typescript
   // ❌ WRONG - duplicate webhooks create duplicate purchases
   async handleCheckoutCompleted(session) {
     await db.insert(purchases).values({...});
   }

   // ✅ CORRECT - check payment_intent_id first
   async handleCheckoutCompleted(session) {
     const existing = await db.query.purchases.findFirst({
       where: eq(purchases.stripePaymentIntentId, paymentIntentId),
     });
     if (existing) return; // Already processed

     await db.insert(purchases).values({...});
   }
   ```

4. **Using DECIMAL for money**:
   ```typescript
   // ❌ WRONG - DECIMAL has rounding errors
   amountPaidCents: decimal('amount_paid_cents', { precision: 10, scale: 2 })

   // ✅ CORRECT - INTEGER cents (ACID-compliant)
   amountPaidCents: integer('amount_paid_cents')
   ```

5. **Forgetting CHECK constraint for revenue splits**:
   ```sql
   -- ❌ WRONG - no validation, cents can leak
   CREATE TABLE purchases (
     amount_paid_cents INTEGER,
     creator_payout_cents INTEGER
   );

   -- ✅ CORRECT - CHECK constraint enforces sum
   ALTER TABLE purchases
     ADD CONSTRAINT check_revenue_split_adds_up
     CHECK (amount_paid_cents = platform_fee_cents + organization_fee_cents + creator_payout_cents);
   ```

### Testing Checklist

- [ ] Validation tests run WITHOUT database, WITHOUT Stripe API
- [ ] Service tests mock Stripe API (no real calls)
- [ ] Integration tests use Stripe test mode (`sk_test_*`)
- [ ] All error paths tested (CONTENT_NOT_FOUND, ALREADY_PURCHASED, etc.)
- [ ] Duplicate purchase prevention tested (both service + DB)
- [ ] Webhook idempotency tested (duplicate webhooks)
- [ ] Revenue split validation tested (CHECK constraint)

### If Stuck

- **Schema questions**: Check `design/features/shared/database-schema.md` lines 320-410
- **Stripe patterns**: Check `design/infrastructure/StripeIntegration.md`
- **Testing patterns**: Check `design/roadmap/testing/ecommerce-testing-definition.md`
- **Auth context**: Check `workers/auth/src/middleware/auth.ts`
- **Standards**: Check `STANDARDS.md` § 2.3 (payment security)

**Finding Documentation**: Use Context-7 map or [CONTEXT_MAP.md](../CONTEXT_MAP.md) for architecture navigation.

---

**Last Updated**: 2025-11-05

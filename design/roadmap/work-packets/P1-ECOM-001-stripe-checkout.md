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

## Integration Points

### Existing Code Used
- Stripe webhook handler: `workers/stripe-webhook-handler/src/index.ts` (will call service in P1-ECOM-002)
- Database client: `@codex/database`
- Security middleware: `@codex/security`
- Observability: `@codex/observability`

### Future Integration
- **P1-ECOM-002**: Webhook handler will call `handleCheckoutCompleted()`
- **P1-ACCESS-001**: Will use `hasAccess()` to gate content
- **P1-NOTIFY-001**: Will send purchase confirmation email

---

## Related Documentation

**Must Read**:
- [STANDARDS.md](../STANDARDS.md) - § 2 Security, § 6 Error handling
- [E-Commerce TDD](../../features/e-commerce/ttd-dphase-1.md) - Feature spec
- [Database Schema Design](../../infrastructure/DATABASE_SCHEMA_DESIGN.md)

**Reference**:
- [Testing Strategy](../../infrastructure/Testing.md)
- [CI/CD Guide](../../infrastructure/CICD.md)

**Code Examples**:
- Webhook handler skeleton: `workers/stripe-webhook-handler/src/index.ts`
- Signature verification: `workers/stripe-webhook-handler/src/middleware/verify-signature.ts`

---

## Notes for LLM Developer

1. **Install Stripe SDK**: `pnpm add stripe` in purchases package
2. **Mock Stripe in Tests**: Never make real Stripe API calls in CI
3. **Idempotency**: Handle duplicate webhooks gracefully
4. **Free Content**: Grant access immediately without Stripe
5. **Audit Trail**: Create pending purchase BEFORE Stripe call
6. **Use Test Mode**: Always use `sk_test_*` keys in development

**If Stuck**: Check [CONTEXT_MAP.md](../CONTEXT_MAP.md) or use Context-7 map.

---

**Last Updated**: 2025-11-05

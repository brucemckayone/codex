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

**File**: `packages/database/src/schema/purchases.ts`

```typescript
import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { content } from './content';

/**
 * Content purchases (one-time payments)
 */
export const contentPurchases = pgTable('content_purchases', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),

  // Relationships
  customerId: text('customer_id').notNull(), // User ID
  contentId: text('content_id').notNull()
    .references(() => content.id, { onDelete: 'restrict' }),
  organizationId: text('organization_id').notNull(),

  // Payment details
  pricePaidCents: integer('price_paid_cents').notNull(),
  status: text('status', { enum: ['pending', 'completed', 'failed'] })
    .default('pending').notNull(),

  // Stripe references
  stripeCheckoutSessionId: text('stripe_checkout_session_id'),
  stripePaymentIntentId: text('stripe_payment_intent_id'),

  // Timestamps
  purchasedAt: timestamp('purchased_at'),
  refundedAt: timestamp('refunded_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
    .$onUpdate(() => new Date()),
});

// Prevent duplicate purchases (race condition protection)
// CREATE UNIQUE INDEX idx_content_purchases_no_duplicates
//   ON content_purchases(customer_id, content_id)
//   WHERE status IN ('completed', 'pending');

export type ContentPurchase = typeof contentPurchases.$inferSelect;
export type NewContentPurchase = typeof contentPurchases.$inferInsert;
```

**Generate and apply migration**:
```bash
pnpm --filter @codex/database db:gen:drizzle
pnpm --filter @codex/database db:migrate
```

### Step 2: Create Purchase Validation

**File**: `packages/validation/src/purchase-schemas.ts`

```typescript
import { z } from 'zod';

/**
 * Validation for creating checkout session
 */
export const createCheckoutSchema = z.object({
  contentId: z.string().uuid(),
});

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;
```

**Tests** (No DB!):

**File**: `packages/validation/src/purchase-schemas.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { createCheckoutSchema } from './purchase-schemas';

describe('Purchase Validation', () => {
  it('should validate valid checkout input', () => {
    const input = {
      contentId: '123e4567-e89b-12d3-a456-426614174000',
    };

    const result = createCheckoutSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should reject invalid UUID', () => {
    const input = {
      contentId: 'not-a-uuid',
    };

    const result = createCheckoutSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should reject missing contentId', () => {
    const input = {};

    const result = createCheckoutSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});
```

### Step 3: Create Purchase Service

**File**: `packages/purchases/src/service.ts`

```typescript
import { db } from '@codex/database';
import { content, contentPurchases } from '@codex/database/schema';
import { eq, and, inArray } from 'drizzle-orm';
import Stripe from 'stripe';
import { ObservabilityClient } from '@codex/observability';

export interface IPurchaseService {
  createCheckoutSession(
    customerId: string,
    contentId: string,
    organizationId: string
  ): Promise<{ checkoutUrl: string; sessionId: string }>;

  hasAccess(customerId: string, contentId: string): Promise<boolean>;

  handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void>;
}

export class PurchaseService implements IPurchaseService {
  private stripe: Stripe;
  private obs: ObservabilityClient;

  constructor(stripeSecretKey: string, environment: string = 'development') {
    this.stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-11-20.acacia',
      typescript: true,
    });
    this.obs = new ObservabilityClient('purchase-service', environment);
  }

  async createCheckoutSession(
    customerId: string,
    contentId: string,
    organizationId: string
  ): Promise<{ checkoutUrl: string; sessionId: string }> {
    // Step 1: Get content details
    const contentItem = await db.query.content.findFirst({
      where: and(
        eq(content.id, contentId),
        eq(content.organizationId, organizationId),
        eq(content.status, 'published')
      ),
    });

    if (!contentItem) {
      throw new Error('Content not found or not published');
    }

    // Step 2: Check for existing purchase
    const existingPurchase = await db.query.contentPurchases.findFirst({
      where: and(
        eq(contentPurchases.customerId, customerId),
        eq(contentPurchases.contentId, contentId),
        inArray(contentPurchases.status, ['completed', 'pending'])
      ),
    });

    if (existingPurchase) {
      throw new Error('Content already purchased or purchase pending');
    }

    // Step 3: Handle free content (no Stripe needed)
    if (contentItem.priceCents === 0) {
      await this.grantFreeAccess(customerId, contentId, organizationId);
      throw new Error('Free content - access granted immediately');
    }

    // Step 4: Create pending purchase record (idempotency + audit trail)
    const [purchase] = await db.insert(contentPurchases).values({
      customerId,
      contentId,
      organizationId,
      pricePaidCents: contentItem.priceCents,
      status: 'pending',
    }).returning();

    // Step 5: Create Stripe Checkout Session
    try {
      const session = await this.stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: contentItem.title,
              description: contentItem.description,
            },
            unit_amount: contentItem.priceCents,
          },
          quantity: 1,
        }],
        success_url: `${process.env.WEB_APP_URL}/content/${contentId}?purchase=success`,
        cancel_url: `${process.env.WEB_APP_URL}/content/${contentId}?purchase=cancel`,
        metadata: {
          purchaseId: purchase.id,
          customerId,
          contentId,
          organizationId,
        },
      });

      // Step 6: Update purchase with Stripe session ID
      await db.update(contentPurchases)
        .set({ stripeCheckoutSessionId: session.id })
        .where(eq(contentPurchases.id, purchase.id));

      this.obs.info('Checkout session created', {
        purchaseId: purchase.id,
        sessionId: session.id,
      });

      if (!session.url) {
        throw new Error('Stripe session URL not generated');
      }

      return {
        checkoutUrl: session.url,
        sessionId: session.id,
      };
    } catch (err) {
      // Rollback: Mark purchase as failed
      await db.update(contentPurchases)
        .set({ status: 'failed' })
        .where(eq(contentPurchases.id, purchase.id));

      this.obs.trackError(err as Error, { purchaseId: purchase.id });
      throw err;
    }
  }

  async hasAccess(customerId: string, contentId: string): Promise<boolean> {
    const purchase = await db.query.contentPurchases.findFirst({
      where: and(
        eq(contentPurchases.customerId, customerId),
        eq(contentPurchases.contentId, contentId),
        eq(contentPurchases.status, 'completed'),
        isNull(contentPurchases.refundedAt)
      ),
    });

    return !!purchase;
  }

  async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const { purchaseId, customerId, contentId } = session.metadata || {};

    if (!purchaseId) {
      throw new Error('Missing purchaseId in session metadata');
    }

    // Idempotency check
    const purchase = await db.query.contentPurchases.findFirst({
      where: eq(contentPurchases.id, purchaseId),
    });

    if (!purchase) {
      throw new Error(`Purchase not found: ${purchaseId}`);
    }

    if (purchase.status === 'completed') {
      this.obs.info('Purchase already completed', { purchaseId });
      return; // Already processed (duplicate webhook)
    }

    // Update purchase to completed
    await db.update(contentPurchases)
      .set({
        status: 'completed',
        purchasedAt: new Date(),
        stripePaymentIntentId: session.payment_intent as string,
      })
      .where(eq(contentPurchases.id, purchaseId));

    this.obs.info('Purchase completed', { purchaseId, customerId, contentId });

    // TODO: Send purchase confirmation email (P1-NOTIFY-001)
  }

  private async grantFreeAccess(
    customerId: string,
    contentId: string,
    organizationId: string
  ): Promise<void> {
    await db.insert(contentPurchases).values({
      customerId,
      contentId,
      organizationId,
      pricePaidCents: 0,
      status: 'completed',
      purchasedAt: new Date(),
    }).onConflictDoNothing();
  }
}

// Export singleton (environment-specific initialization)
let purchaseServiceInstance: PurchaseService | null = null;

export function getPurchaseService(env: { STRIPE_SECRET_KEY: string; ENVIRONMENT?: string }): PurchaseService {
  if (!purchaseServiceInstance) {
    purchaseServiceInstance = new PurchaseService(
      env.STRIPE_SECRET_KEY,
      env.ENVIRONMENT || 'development'
    );
  }
  return purchaseServiceInstance;
}
```

### Step 4: Create Checkout API Endpoint

**File**: Add to existing worker or create new endpoint

```typescript
import { Hono } from 'hono';
import { getPurchaseService } from '@codex/purchases';
import { createCheckoutSchema } from '@codex/validation';
import { securityHeaders, rateLimit } from '@codex/security';

type Bindings = {
  STRIPE_SECRET_KEY: string;
  ENVIRONMENT: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', securityHeaders());
app.use('/api/checkout', rateLimit({ windowMs: 60000, max: 10 })); // 10 requests/min

// Create checkout session
app.post('/api/checkout', async (c) => {
  try {
    // TODO: Get from session
    const customerId = 'user-123';
    const organizationId = 'org-123';

    const body = await c.req.json();
    const validated = createCheckoutSchema.parse(body);

    const purchaseService = getPurchaseService(c.env);
    const result = await purchaseService.createCheckoutSession(
      customerId,
      validated.contentId,
      organizationId
    );

    return c.json({ data: result }, 201);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({
        error: { code: 'VALIDATION_ERROR', message: err.errors }
      }, 400);
    }

    if ((err as Error).message.includes('already purchased')) {
      return c.json({
        error: { code: 'ALREADY_PURCHASED', message: 'Content already purchased' }
      }, 409);
    }

    return c.json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create checkout' }
    }, 500);
  }
});

// Check access (used by content player)
app.get('/api/purchases/access/:contentId', async (c) => {
  const customerId = 'user-123'; // TODO: From session
  const contentId = c.req.param('contentId');

  const purchaseService = getPurchaseService(c.env);
  const hasAccess = await purchaseService.hasAccess(customerId, contentId);

  return c.json({ hasAccess });
});

export default app;
```

---

## Test Specifications

### Unit Tests (Validation - No DB)

Already covered in Step 2: `packages/validation/src/purchase-schemas.test.ts`

### Integration Tests (Service with DB)

**File**: `packages/purchases/src/service.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PurchaseService } from './service';
import { createTestDb, createTestContent, createTestUser } from '@codex/test-utils';
import type Stripe from 'stripe';

describe('PurchaseService Integration', () => {
  let service: PurchaseService;
  let contentId: string;
  let customerId: string;
  let organizationId: string;

  beforeEach(async () => {
    const testDb = await createTestDb();
    service = new PurchaseService('sk_test_mock', 'test');
    organizationId = 'org-test-123';

    // Create test content
    contentId = await createTestContent({
      organizationId,
      priceCents: 999,
      status: 'published',
    });

    customerId = await createTestUser();

    // Mock Stripe
    vi.spyOn(service['stripe'].checkout.sessions, 'create').mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/test',
    } as any);
  });

  it('should create checkout session for paid content', async () => {
    const result = await service.createCheckoutSession(
      customerId,
      contentId,
      organizationId
    );

    expect(result.checkoutUrl).toContain('checkout.stripe.com');
    expect(result.sessionId).toMatch(/^cs_/);

    // Verify pending purchase created
    const purchase = await db.query.contentPurchases.findFirst({
      where: and(
        eq(contentPurchases.customerId, customerId),
        eq(contentPurchases.contentId, contentId)
      ),
    });

    expect(purchase?.status).toBe('pending');
  });

  it('should prevent duplicate purchases', async () => {
    await service.createCheckoutSession(customerId, contentId, organizationId);

    await expect(
      service.createCheckoutSession(customerId, contentId, organizationId)
    ).rejects.toThrow('already purchased');
  });

  it('should grant free content immediately', async () => {
    const freeContentId = await createTestContent({
      organizationId,
      priceCents: 0,
      status: 'published',
    });

    await expect(
      service.createCheckoutSession(customerId, freeContentId, organizationId)
    ).rejects.toThrow('Free content');

    const hasAccess = await service.hasAccess(customerId, freeContentId);
    expect(hasAccess).toBe(true);
  });

  it('should handle checkout completion idempotently', async () => {
    const { sessionId } = await service.createCheckoutSession(
      customerId,
      contentId,
      organizationId
    );

    const mockSession: Stripe.Checkout.Session = {
      id: sessionId,
      payment_intent: 'pi_test_123',
      metadata: {
        purchaseId: 'purchase-123',
        customerId,
        contentId,
      },
    } as any;

    // First call
    await service.handleCheckoutCompleted(mockSession);

    // Second call (duplicate webhook)
    await expect(
      service.handleCheckoutCompleted(mockSession)
    ).resolves.not.toThrow();

    // Verify only one completed purchase
    const purchases = await db.query.contentPurchases.findMany({
      where: and(
        eq(contentPurchases.customerId, customerId),
        eq(contentPurchases.contentId, contentId),
        eq(contentPurchases.status, 'completed')
      ),
    });

    expect(purchases.length).toBe(1);
  });
});
```

---

## Definition of Done

- [ ] Purchase schema created and migration applied
- [ ] Validation schemas with tests (100% coverage, no DB)
- [ ] Purchase service implemented
- [ ] Service integration tests passing (with test DB)
- [ ] Checkout API endpoint created
- [ ] Stripe mocked in tests (no real API calls in CI)
- [ ] Duplicate purchase prevention working
- [ ] Free content handling working
- [ ] Idempotency for webhook handling
- [ ] Error handling consistent with STANDARDS.md
- [ ] Observability logging added
- [ ] CI passing (tests + typecheck + lint)

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

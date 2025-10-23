# E-Commerce - Phase 1 TDD (Technical Design Document)

## System Overview

The e-commerce system facilitates one-time purchases of digital content using Stripe Checkout. The architecture is designed for security and reliability, ensuring that payment processing is handled by Stripe to minimize our PCI compliance scope, while our backend reliably tracks purchases to grant content access.

**Key Architecture Decisions**:
- **Stripe Checkout (Hosted)**: We will redirect users to a Stripe-hosted page for payment. This is the most secure approach, as sensitive card details never touch our servers.
- **Webhook-Driven Fulfillment**: Content access is granted only after a verified webhook from Stripe confirms a successful payment. This prevents users from gaining access without a completed payment.
- **Pending Purchase Record**: A `purchases` record with a `pending` status is created *before* the user is redirected to Stripe. This record is then updated to `completed` by the webhook, creating a clear audit trail.
- **Idempotent Webhook Handler**: The webhook processor is designed to handle duplicate events from Stripe without creating duplicate purchases.

**Architecture Diagram**: See [Direct Purchase Checkout Flow](../_assets/direct-checkout-flow.png)

---

## Dependencies

### Must Be Completed First

1.  **Auth System** ([Auth TDD](../auth/ttd-dphase-1.md)): The e-commerce flow requires an authenticated user to link purchases to an account.
2.  **Content Management System** ([Content Management TDD](../content-management/ttd-dphase-1.md)): We need published content with an associated price to sell.
3.  **Notification Service** ([Notifications TDD](../notifications/ttd-dphase-1.md)): Required for sending purchase receipts and refund confirmations.
4.  **Database Schema**: The `purchases` table must be migrated.
5.  **Stripe Account Setup**: A Stripe account with API keys and a configured webhook endpoint is necessary.

### Can Be Developed In Parallel

- **Content Access Feature**: This feature will consume the `purchases` table to verify access, but its development is not a blocker for implementing the purchase flow itself.

---

## Component List

### 1. Purchases Service (`packages/web/src/lib/server/purchases/service.ts`)

**Responsibility**: Core business logic for creating checkouts, handling webhooks, and managing refunds.

**Interface**:
```typescript
export interface IPurchasesService {
  /**
   * Creates a Stripe Checkout session for a given user and a generic purchasable item.
   * Creates a 'pending' purchase record before returning the Stripe session URL.
   */
  createCheckoutSession(userId: string, itemId: string, itemType: string): Promise<{ checkoutUrl: string }>;

  /**
   * Handles a 'checkout.session.completed' event from a Stripe webhook.
   * Verifies the event, updates the purchase status to 'completed', and triggers access grant logic.
   */
  handleSuccessfulCheckout(session: Stripe.Checkout.Session): Promise<void>;

  /**
   * Instantly creates a 'completed' purchase record for a free item.
   */
  grantFreeItemAccess(userId: string, itemId: string, itemType: string): Promise<void>;

  /**
   * Initiates a refund via Stripe and updates the purchase record.
   */
  refundPurchase(purchaseId: string, reason: string): Promise<void>;
}
```

**Implementation**:
```typescript
import { db } from '$lib/server/db';
import { content, purchases, users } from '$lib/server/db/schema';
import { stripe } from '$lib/server/stripe';
import { and, eq } from 'drizzle-orm';
import { notificationService } from '$lib/server/notifications';
import { error } from '@sveltejs/kit';

export class PurchasesService implements IPurchasesService {
  async createCheckoutSession(userId: string, itemId: string, itemType: string): Promise<{ checkoutUrl: string }> {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) {
      throw error(404, 'User not found');
    }

    // 1. Fetch the purchasable item's details based on its type
    let itemDetails;
    switch (itemType) {
      case 'content':
        itemDetails = await db.query.content.findFirst({ where: eq(content.id, itemId) });
        if (!itemDetails) throw error(404, 'Content not found');
        break;
      // Future cases for 'offering', 'subscription_tier', etc.
      // case 'offering':
      //   itemDetails = await db.query.offerings.findFirst({ where: eq(offerings.id, itemId) });
      //   if (!itemDetails) throw error(404, 'Offering not found');
      //   break;
      default:
        throw error(400, 'Invalid item type');
    }

    // 2. Check if already purchased
    const existingPurchase = await db.query.purchases.findFirst({
      where: and(
        eq(purchases.customerId, userId),
        eq(purchases.itemId, itemId),
        eq(purchases.itemType, itemType),
        eq(purchases.status, 'completed')
      )
    });
    if (existingPurchase) {
      throw error(409, 'Item already purchased');
    }

    // 3. Handle free items separately
    if (itemDetails.price === 0) {
        await this.grantFreeItemAccess(userId, itemId, itemType);
        throw error(200, 'Free content access granted');
    }

    // Use a transaction to ensure atomicity
    return db.transaction(async (tx) => {
      // 4. Create a pending purchase record
      const [pendingPurchase] = await tx.insert(purchases).values({
        customerId: userId,
        itemId: itemId,
        itemType: itemType,
        amountPaid: itemDetails.price,
        currency: 'usd',
        status: 'pending',
        creatorId: itemDetails.ownerId, // Assumes 'ownerId' field exists on all purchasable models
        platformFeeAmount: 0,
        creatorPayoutAmount: itemDetails.price
      }).returning();

      // 5. Create Stripe Checkout Session
      const session = await stripe.checkout.sessions.create({
        customer_email: user.email,
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: itemDetails.title,
              description: itemDetails.description || undefined,
            },
            unit_amount: Math.round(itemDetails.price * 100), // Price in cents
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${process.env.AUTH_URL}/${itemType}/${itemId}?purchase_success=true`,
        cancel_url: `${process.env.AUTH_URL}/${itemType}/${itemId}`,
        metadata: {
          purchaseId: pendingPurchase.id,
          userId: userId,
          itemId: itemId,
          itemType: itemType,
        }
      });

      if (!session.url) {
        // The transaction will be rolled back if we throw an error here
        throw error(500, 'Failed to create Stripe checkout session');
      }
      
      // 6. Update purchase record with Stripe session ID
      await tx.update(purchases)
          .set({ stripeCheckoutSessionId: session.id })
          .where(eq(purchases.id, pendingPurchase.id));

      return { checkoutUrl: session.url };
    });
  }

  async handleSuccessfulCheckout(session: Stripe.Checkout.Session): Promise<void> {
    const { purchaseId, itemType, itemId } = session.metadata;
    if (!purchaseId || !itemType || !itemId) {
      throw new Error('Missing required metadata in webhook');
    }

    const purchase = await db.query.purchases.findFirst({ where: eq(purchases.id, purchaseId) });

    if (purchase?.status === 'completed') {
      console.log(`Purchase ${purchaseId} already completed.`);
      return;
    }

    // Update purchase to 'completed'
    const [updatedPurchase] = await db.update(purchases).set({
      status: 'completed',
      purchasedAt: new Date(),
      stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    }).where(eq(purchases.id, purchaseId)).returning();

    // Trigger access grant logic based on item type
    switch(itemType) {
        case 'content':
            // This would create a record in a `content_access` table
            console.log(`Granting access to content ${itemId} for user ${updatedPurchase.customerId}`);
            break;
        // Future cases
        // case 'offering':
        //    console.log(`Booking offering ${itemId} for user ${updatedPurchase.customerId}`);
        //    break;
    }

    // Send receipt email
    const user = await db.query.users.findFirst({ where: eq(users.id, updatedPurchase.customerId) });
    if (user) {
      await notificationService.sendEmail({
        template: 'purchase-receipt',
        recipient: user.email,
        data: {
          customerName: user.name,
          orderNumber: updatedPurchase.id,
          totalAmount: updatedPurchase.amountPaid,
        }
      });
    }
  }

  async grantFreeItemAccess(userId: string, itemId: string, itemType: string): Promise<void> {
    // Logic to grant access to free items
  }

  async refundPurchase(purchaseId: string, reason: string): Promise<void> {
    // Logic to refund a purchase via Stripe and update the DB
  }
}

export const purchasesService = new PurchasesService();
```

### 2. API Route: Checkout Session Creation (`packages/web/src/routes/api/checkout/+server.ts`)

**Responsibility**: A protected endpoint that the frontend calls to initiate a purchase.

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAuth } from '$lib/server/guards';
import { purchasesService } from '$lib/server/purchases/service';

export const POST: RequestHandler = async ({ request, locals }) => {
  const user = requireAuth({ locals, url: request.url });
  const { itemId, itemType } = await request.json();

  if (!itemId || !itemType) {
    return json({ error: 'itemId and itemType are required' }, { status: 400 });
  }

  try {
    const { checkoutUrl } = await purchasesService.createCheckoutSession(user.id, itemId, itemType);
    return json({ checkoutUrl });
  } catch (e) {
    return json({ error: e.body?.message || 'Failed to create checkout' }, { status: e.status || 500 });
  }
};
```

### 3. API Route: Stripe Webhook Handler (`workers/webhook-handler`)

**Responsibility**: A dedicated, publicly accessible Cloudflare Worker to receive and process webhooks from Stripe. This decouples payment fulfillment from the main web application, increasing resilience.

**Architecture Note on Code Sharing**:
For this worker to function, the `PurchasesService` (and any other shared business logic) must be located in a shared `packages/` directory within the monorepo (e.g., `packages/core-logic`). Both the SvelteKit app and this worker will import the service from that shared package. This avoids code duplication and ensures consistent business logic.

**Worker Implementation (`workers/webhook-handler/src/index.ts`)**:
```typescript
import { stripe } from './stripe'; // Worker-specific Stripe client initialization
import { purchasesService } from '@codex/core-logic'; // Importing from shared package

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const sig = request.headers.get('stripe-signature');
    const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
    let event: Stripe.Event;

    try {
      const body = await request.text();
      event = stripe.webhooks.constructEvent(body, sig!, webhookSecret!);
    } catch (err) {
      console.error('Webhook signature verification failed.', err.message);
      return new Response('Invalid request', { status: 400 });
    }

    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object as Stripe.Checkout.Session;
        console.log('Handling successful checkout for session:', session.id);
        // Use `ctx.waitUntil` to allow the response to be sent
        // while the async task continues in the background.
        ctx.waitUntil(purchasesService.handleSuccessfulCheckout(session));
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  },
};
```


---

## Data Models / Schema

**Schema Definition** (`packages/db/src/schema/purchases.ts`):
This schema is based on the `database-schema.md` document and updated for future extensibility.

```typescript
import { pgTable, uuid, varchar, text, decimal, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { content } from './content';

export const purchaseStatusEnum = pgEnum('purchase_status', ['pending', 'completed', 'refunded', 'failed']);

export const purchases = pgTable('purchases', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').references(() => users.id).notNull(),
  
  // Polymorphic relationship to the purchased item
  itemId: uuid('item_id').notNull(),
  itemType: varchar('item_type', { length: 50 }).notNull(), // e.g., 'content', 'offering', 'subscription_tier'

  // Ownership for revenue tracking
  creatorId: uuid('creator_id').references(() => users.id).notNull(),

  // Payment Details
  amountPaid: decimal('amount_paid', { precision: 10, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).default('usd').notNull(),
  status: purchaseStatusEnum('status').default('pending').notNull(),

  // Stripe IDs
  stripeCheckoutSessionId: varchar('stripe_checkout_session_id', { length: 255 }).unique(),
  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }).unique(),

  // Revenue Split (Phase 1: No split)
  platformFeeAmount: decimal('platform_fee_amount', { precision: 10, scale: 2 }).default('0').notNull(),
  creatorPayoutAmount: decimal('creator_payout_amount', { precision: 10, scale: 2 }).notNull(),

  // Timestamps
  purchasedAt: timestamp('purchased_at'),
  refundedAt: timestamp('refunded_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

---

## Third-Party Integrations

### Stripe
- **SDK**: `stripe` npm package.
- **Configuration**: API keys and webhook secret will be managed via environment variables.
- **APIs Used**:
    - `stripe.checkout.sessions.create`: To initiate the payment flow.
    - `stripe.webhooks.constructEvent`: To securely verify incoming webhooks.
    - `stripe.refunds.create`: For the admin refund functionality.
- **Webhook Endpoint**: `/api/webhooks/stripe` will be configured in the Stripe Dashboard to listen for `checkout.session.completed` events.

---

## Security Considerations

- **Webhook Signature Verification**: This is the most critical security step. The `stripe.webhooks.constructEvent` function MUST be used to prevent attackers from faking successful payments by calling our webhook endpoint directly.
- **Idempotency**: The webhook handler must be idempotent. By checking if the purchase status is already `completed`, we prevent granting access or sending multiple receipts if Stripe sends the same webhook more than once.
- **Server-Side Price Check**: The price of the content is fetched from our database on the server (`contentItem.price`). The client does not send a price, preventing price manipulation attacks.
- **Environment Variables**: All Stripe keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) must be stored securely as environment variables and never exposed on the client side.

---

## Testing Strategy

- **Unit Tests (Vitest)**:
    - Test the `PurchasesService` logic in isolation.
    - Mock the `stripe` SDK to simulate API calls (`checkout.sessions.create`, `refunds.create`).
    - Test various scenarios: successful checkout, existing purchase, free content, etc.
- **Integration Tests (Vitest)**:
    - Test the `/api/checkout` and `/api/webhooks/stripe` endpoints.
    - Use a real test database (cleared before each run).
    - Use the **Stripe CLI** (`stripe listen --forward-to ...`) to send mock webhook events to the local development server to test the webhook handler end-to-end.
- **E2E Tests (Playwright)**:
    - A full user journey: log in, navigate to content, click "Buy Now", interact with the Stripe Checkout test page (using test card numbers), and verify that access is granted upon returning to the site.

---

## Related Documents

- **PRD**: [E-Commerce Phase 1 PRD](./pdr-phase-1.md)
- **Cross-Feature Dependencies**:
  - [Auth TDD](../auth/ttd-dphase-1.md)
  - [Content Management TDD](../content-management/ttd-dphase-1.md)
  - [Notifications TDD](../notifications/ttd-dphase-1.md)
- **Infrastructure**:
  - [Database Schema](../shared/database-schema.md)

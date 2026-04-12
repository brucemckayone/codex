# WP4: Ecom Revenue Emails

**Parent spec**: `docs/email-notifications-design-spec.md`
**Priority**: P0
**Dependencies**: WP1, WP2
**Estimated scope**: 6 files changed/created, ~350 lines of new code

---

## Goal

Wire all 6 P0 revenue emails and 2 P2 creator emails to their Stripe webhook triggers in ecom-api, so that every purchase, subscription, renewal, failure, cancellation, and refund event sends the correct transactional email via the notifications-api internal endpoint.

## Context

The ecom-api worker handles Stripe webhooks in four handler files: `checkout.ts`, `subscription-webhook.ts`, `payment-webhook.ts`, and `connect-webhook.ts`. These handlers already process the full business logic (create purchases, update subscriptions, process refunds, update Connect status) but send zero email notifications. The `sendEmailToWorker()` helper from WP1 wraps the fire-and-forget `waitUntil()` pattern, HMAC header generation, and error suppression. All 8 template schemas and global seed records exist from WP2. The `WORKER_SHARED_SECRET` is already defined in shared `HonoEnv` Bindings but is not present in the ecom-api or organization-api wrangler configs.

## Changes

### `workers/ecom-api/src/handlers/checkout.ts` (update)

After `purchaseService.completePurchase()` succeeds in the `handleCheckoutCompleted` function, add two email sends. Both must be inside `c.executionCtx.waitUntil()` to avoid blocking the 200 response to Stripe.

**Data resolution**: The handler already has `validatedMetadata` (with `customerId`, `contentId`, `organizationId`) and `amountTotal`. However, it lacks customer name/email, content title, creator details, and org name. Add a lightweight DB query to resolve these:

```typescript
import { sendEmailToWorker } from '@codex/worker-utils';
import { formatGBP } from '@codex/constants';
import { content, users, organizations } from '@codex/database/schema';
import { eq } from 'drizzle-orm';

// --- Inside handleCheckoutCompleted, after completePurchase() succeeds ---

// Resolve email context: customer, content, creator, org
// Single query using the existing `db` instance already in handler scope
const emailContext = await resolveCheckoutEmailContext(
  db,
  validatedMetadata.customerId,
  validatedMetadata.contentId,
  validatedMetadata.organizationId
);

if (emailContext) {
  // 1. Purchase receipt to customer (P0 - transactional)
  c.executionCtx.waitUntil(
    sendEmailToWorker(c.env, c.executionCtx, {
      to: emailContext.customerEmail,
      toName: emailContext.customerName,
      templateName: 'purchase-receipt',
      category: 'transactional',
      userId: validatedMetadata.customerId,
      organizationId: validatedMetadata.organizationId,
      data: {
        userName: emailContext.customerName || 'there',
        contentTitle: emailContext.contentTitle,
        priceFormatted: formatGBP(amountTotal),
        purchaseDate: new Date().toLocaleDateString('en-GB'),
        contentUrl: `${c.env.WEB_APP_URL}/content/${validatedMetadata.contentId}`,
        orgName: emailContext.orgName || '',
      },
    })
  );

  // 2. New sale notification to creator (P2 - transactional)
  if (emailContext.creatorEmail) {
    const platformFeeBps = 1000; // 10% from FEES.PLATFORM_PERCENT
    const creatorShareCents = amountTotal - Math.round((amountTotal * platformFeeBps) / 10000);

    c.executionCtx.waitUntil(
      sendEmailToWorker(c.env, c.executionCtx, {
        to: emailContext.creatorEmail,
        templateName: 'new-sale',
        category: 'transactional',
        data: {
          creatorName: emailContext.creatorName || 'Creator',
          contentTitle: emailContext.contentTitle,
          saleAmount: formatGBP(creatorShareCents),
          buyerName: emailContext.customerFirstName || 'A customer',
          dashboardUrl: `${c.env.WEB_APP_URL}/studio/revenue`,
        },
      })
    );
  }
}
```

Add a private helper function at the bottom of the file (or in a shared `email-context.ts` util):

```typescript
interface CheckoutEmailContext {
  customerEmail: string;
  customerName: string | null;
  customerFirstName: string | null;
  contentTitle: string;
  creatorEmail: string | null;
  creatorName: string | null;
  orgName: string | null;
}

async function resolveCheckoutEmailContext(
  db: DrizzleClient,
  customerId: string,
  contentId: string,
  organizationId: string | null
): Promise<CheckoutEmailContext | null> {
  try {
    // Fetch customer
    const customer = await db.query.users.findFirst({
      where: eq(users.id, customerId),
      columns: { email: true, name: true },
    });
    if (!customer) return null;

    // Fetch content + creator
    const contentItem = await db.query.content.findFirst({
      where: eq(content.id, contentId),
      columns: { title: true, creatorId: true },
    });
    if (!contentItem) return null;

    // Fetch creator
    const creator = contentItem.creatorId
      ? await db.query.users.findFirst({
          where: eq(users.id, contentItem.creatorId),
          columns: { email: true, name: true },
        })
      : null;

    // Fetch org name
    let orgName: string | null = null;
    if (organizationId) {
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, organizationId),
        columns: { name: true },
      });
      orgName = org?.name ?? null;
    }

    return {
      customerEmail: customer.email,
      customerName: customer.name,
      customerFirstName: customer.name?.split(' ')[0] ?? null,
      contentTitle: contentItem.title,
      creatorEmail: creator?.email ?? null,
      creatorName: creator?.name ?? null,
      orgName,
    };
  } catch {
    // Email context resolution is non-critical -- don't break webhook
    return null;
  }
}
```

### `workers/ecom-api/src/handlers/subscription-webhook.ts` (update)

Add email sends to four event branches. Each handler already has a `db` client in scope and Stripe event data. Data resolution requires customer lookup from Stripe's customer ID or subscription metadata.

```typescript
import { sendEmailToWorker } from '@codex/worker-utils';
import { formatGBP } from '@codex/constants';
import { users } from '@codex/database/schema';
import { eq } from 'drizzle-orm';

// Helper: resolve customer email from Stripe customer ID or metadata
async function resolveSubscriptionCustomer(
  db: DrizzleClient,
  stripeCustomerId: string | Stripe.Customer | Stripe.DeletedCustomer | null,
  stripe: Stripe
): Promise<{ email: string; name: string | null } | null> {
  try {
    // Get the Stripe customer to find the platform userId from metadata
    const customerId =
      typeof stripeCustomerId === 'string'
        ? stripeCustomerId
        : stripeCustomerId?.id;
    if (!customerId) return null;

    const stripeCustomer = await stripe.customers.retrieve(customerId);
    if (stripeCustomer.deleted) return null;

    // Platform userId stored in customer metadata during checkout creation
    const userId = stripeCustomer.metadata?.userId;
    if (userId) {
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { email: true, name: true },
      });
      if (user) return user;
    }

    // Fallback: use Stripe customer email directly
    return stripeCustomer.email
      ? { email: stripeCustomer.email, name: stripeCustomer.name }
      : null;
  } catch {
    return null;
  }
}
```

**CHECKOUT_COMPLETED (subscription mode)** -- after `service.handleSubscriptionCreated(subscription)`:

```typescript
case STRIPE_EVENTS.CHECKOUT_COMPLETED: {
  // ... existing code ...
  await service.handleSubscriptionCreated(subscription);

  // Send subscription-created email
  const customer = await resolveSubscriptionCustomer(db, session.customer, stripe);
  if (customer) {
    const item = subscription.items.data[0];
    const priceAmount = item?.price?.unit_amount ?? 0;
    const interval = item?.price?.recurring?.interval ?? 'month';
    const nextBillingDate = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toLocaleDateString('en-GB')
      : 'N/A';

    c.executionCtx.waitUntil(
      sendEmailToWorker(c.env, c.executionCtx, {
        to: customer.email,
        toName: customer.name ?? undefined,
        templateName: 'subscription-created',
        category: 'transactional',
        data: {
          userName: customer.name || 'there',
          planName: item?.price?.nickname || 'Subscription',
          priceFormatted: formatGBP(priceAmount),
          billingInterval: interval,
          nextBillingDate,
          manageUrl: `${c.env.WEB_APP_URL}/account/billing`,
        },
      })
    );
  }
  break;
}
```

**INVOICE_PAYMENT_SUCCEEDED** -- after `service.handleInvoicePaymentSucceeded(invoice)`:

```typescript
case STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED: {
  const invoice = event.data.object as Stripe.Invoice;
  await service.handleInvoicePaymentSucceeded(invoice);

  // Only send renewal email for recurring invoices, NOT the first invoice
  if (invoice.billing_reason === 'subscription_cycle') {
    const customer = await resolveSubscriptionCustomer(db, invoice.customer, stripe);
    if (customer) {
      const line = invoice.lines?.data?.[0];
      const nextBillingDate = line?.period?.end
        ? new Date(line.period.end * 1000).toLocaleDateString('en-GB')
        : 'N/A';

      c.executionCtx.waitUntil(
        sendEmailToWorker(c.env, c.executionCtx, {
          to: customer.email,
          toName: customer.name ?? undefined,
          templateName: 'subscription-renewed',
          category: 'transactional',
          data: {
            userName: customer.name || 'there',
            planName: line?.price?.nickname || 'Subscription',
            priceFormatted: formatGBP(invoice.amount_paid ?? 0),
            billingDate: new Date().toLocaleDateString('en-GB'),
            nextBillingDate,
            manageUrl: `${c.env.WEB_APP_URL}/account/billing`,
          },
        })
      );
    }
  }

  obs?.info('Invoice payment succeeded', { invoiceId: invoice.id });
  break;
}
```

**INVOICE_PAYMENT_FAILED** -- after the existing `obs?.warn(...)`:

```typescript
case STRIPE_EVENTS.INVOICE_PAYMENT_FAILED: {
  const invoice = event.data.object as Stripe.Invoice;

  const customer = await resolveSubscriptionCustomer(db, invoice.customer, stripe);
  if (customer) {
    const line = invoice.lines?.data?.[0];
    // Stripe retries automatically; next_payment_attempt is a Unix timestamp
    const retryDate = invoice.next_payment_attempt
      ? new Date(invoice.next_payment_attempt * 1000).toLocaleDateString('en-GB')
      : 'soon';

    c.executionCtx.waitUntil(
      sendEmailToWorker(c.env, c.executionCtx, {
        to: customer.email,
        toName: customer.name ?? undefined,
        templateName: 'payment-failed',
        category: 'transactional',
        data: {
          userName: customer.name || 'there',
          planName: line?.price?.nickname || 'Subscription',
          priceFormatted: formatGBP(invoice.amount_due ?? 0),
          retryDate,
          updatePaymentUrl: `${c.env.WEB_APP_URL}/account/billing`,
        },
      })
    );
  }

  obs?.warn('Invoice payment failed', {
    invoiceId: invoice.id,
    amountDue: invoice.amount_due,
  });
  break;
}
```

**SUBSCRIPTION_DELETED** -- after `service.handleSubscriptionDeleted(subscription)`:

```typescript
case STRIPE_EVENTS.SUBSCRIPTION_DELETED: {
  const subscription = event.data.object as Stripe.Subscription;
  await service.handleSubscriptionDeleted(subscription);

  const customer = await resolveSubscriptionCustomer(db, subscription.customer, stripe);
  if (customer) {
    const item = subscription.items.data[0];
    const accessEndDate = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toLocaleDateString('en-GB')
      : 'N/A';

    c.executionCtx.waitUntil(
      sendEmailToWorker(c.env, c.executionCtx, {
        to: customer.email,
        toName: customer.name ?? undefined,
        templateName: 'subscription-cancelled',
        category: 'transactional',
        data: {
          userName: customer.name || 'there',
          planName: item?.price?.nickname || 'Subscription',
          accessEndDate,
          resubscribeUrl: `${c.env.WEB_APP_URL}/pricing`,
        },
      })
    );
  }

  obs?.info('Subscription deleted', { subscriptionId: subscription.id });
  break;
}
```

### `workers/ecom-api/src/handlers/payment-webhook.ts` (update)

In the `CHARGE_REFUNDED` case, after `service.processRefund(paymentIntentId)`, add:

```typescript
import { sendEmailToWorker } from '@codex/worker-utils';
import { formatGBP } from '@codex/constants';
import { users, content, purchases } from '@codex/database/schema';
import { eq } from 'drizzle-orm';

case STRIPE_EVENTS.CHARGE_REFUNDED: {
  const charge = event.data.object as Stripe.Charge;
  // ... existing paymentIntentId extraction ...

  await service.processRefund(paymentIntentId);

  // Resolve refund email context
  try {
    // Look up purchase by stripePaymentIntentId to get customer and content
    const purchase = await db.query.purchases.findFirst({
      where: eq(purchases.stripePaymentIntentId, paymentIntentId),
      columns: { customerId: true, contentId: true, amountPaidCents: true },
    });

    if (purchase) {
      const [customer, contentItem] = await Promise.all([
        db.query.users.findFirst({
          where: eq(users.id, purchase.customerId),
          columns: { email: true, name: true },
        }),
        db.query.content.findFirst({
          where: eq(content.id, purchase.contentId),
          columns: { title: true },
        }),
      ]);

      if (customer) {
        c.executionCtx.waitUntil(
          sendEmailToWorker(c.env, c.executionCtx, {
            to: customer.email,
            toName: customer.name ?? undefined,
            templateName: 'refund-processed',
            category: 'transactional',
            data: {
              userName: customer.name || 'there',
              contentTitle: contentItem?.title || 'Content',
              refundAmount: formatGBP(charge.amount_refunded),
              originalAmount: formatGBP(purchase.amountPaidCents),
              refundDate: new Date().toLocaleDateString('en-GB'),
            },
          })
        );
      }
    }
  } catch {
    // Non-critical -- don't break refund webhook
    obs?.warn('Failed to resolve refund email context', { paymentIntentId });
  }

  obs?.info('Charge refund processed', {
    chargeId: charge.id,
    paymentIntentId,
    amountRefunded: charge.amount_refunded,
  });
  break;
}
```

### `workers/ecom-api/src/handlers/connect-webhook.ts` (update)

In the `ACCOUNT_UPDATED` case, after `service.handleAccountUpdated(account)`, add the P2 creator email:

```typescript
import { sendEmailToWorker } from '@codex/worker-utils';
import { users } from '@codex/database/schema';
import { eq } from 'drizzle-orm';

case STRIPE_EVENTS.ACCOUNT_UPDATED: {
  const account = event.data.object as Stripe.Account;
  await service.handleAccountUpdated(account);

  // Send connect-account-status email to creator (P2)
  try {
    // Resolve creator from Connect account metadata or DB
    const creatorUserId = account.metadata?.userId;
    if (creatorUserId) {
      const creator = await db.query.users.findFirst({
        where: eq(users.id, creatorUserId),
        columns: { email: true, name: true },
      });

      if (creator) {
        // Determine human-readable status and action required
        let accountStatus = 'Active';
        let actionRequired = '';

        if (!account.charges_enabled && !account.payouts_enabled) {
          accountStatus = 'Action Required';
          actionRequired = account.requirements?.currently_due?.length
            ? 'Please complete your account verification to start receiving payouts.'
            : 'Your account is being reviewed by Stripe.';
        } else if (!account.charges_enabled) {
          accountStatus = 'Restricted';
          actionRequired = 'Charges are currently disabled. Please check your Stripe dashboard.';
        } else if (!account.payouts_enabled) {
          accountStatus = 'Payouts Pending';
          actionRequired = 'Payout capability is pending. Stripe may require additional verification.';
        }

        c.executionCtx.waitUntil(
          sendEmailToWorker(c.env, c.executionCtx, {
            to: creator.email,
            templateName: 'connect-account-status',
            category: 'transactional',
            data: {
              creatorName: creator.name || 'Creator',
              accountStatus,
              actionRequired,
              dashboardUrl: `${c.env.WEB_APP_URL}/studio/settings/payments`,
            },
          })
        );
      }
    }
  } catch {
    // Non-critical -- don't break Connect webhook
    obs?.warn('Failed to send connect status email', {
      accountId: account.id,
    });
  }

  obs?.info('Connect account updated', {
    accountId: account.id,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
  });
  break;
}
```

### `packages/constants/src/format.ts` (new)

Currency formatting utility for GBP:

```typescript
/**
 * Format pence amount as GBP string with currency symbol.
 *
 * @param pence - Amount in pence (integer)
 * @returns Formatted string, e.g. 999 -> "£9.99", 0 -> "£0.00", 1 -> "£0.01"
 */
export function formatGBP(pence: number): string {
  const pounds = Math.abs(pence) / 100;
  const formatted = pounds.toFixed(2);
  return pence < 0 ? `-£${formatted}` : `£${formatted}`;
}
```

Also update `packages/constants/src/index.ts` to re-export:

```typescript
export { formatGBP } from './format';
```

### `workers/ecom-api/src/types.ts` (update)

The `StripeWebhookEnv` already extends `HonoEnv['Bindings']`, which includes `WORKER_SHARED_SECRET: string`. No type changes are needed because the shared Bindings definition already declares it. However, verify the wrangler config provides the value at runtime:

**`workers/ecom-api/wrangler.jsonc`** -- add `WORKER_SHARED_SECRET` to the development `[vars]` section (it is already documented in media-api's wrangler.jsonc as the pattern to follow):

```jsonc
// In [vars] section:
"WORKER_SHARED_SECRET": "test-worker-shared-secret"
```

Production deployment must set this as a Cloudflare secret (`wrangler secret put WORKER_SHARED_SECRET`).

---

## Verification

### Unit Tests

**`workers/ecom-api/src/handlers/__tests__/checkout.test.ts`** (new or extend):

- `handleCheckoutCompleted` calls `sendEmailToWorker` with `purchase-receipt` template containing correct tokens (`userName`, `contentTitle`, `priceFormatted`, `purchaseDate`, `contentUrl`, `orgName`)
- `handleCheckoutCompleted` calls `sendEmailToWorker` with `new-sale` template to creator email with correct `saleAmount` (90% of sale)
- Webhook handler still returns 200 even if `sendEmailToWorker` throws (fire-and-forget pattern)
- `resolveCheckoutEmailContext` returns `null` when customer not found (does not throw)

**`workers/ecom-api/src/handlers/__tests__/subscription-webhook.test.ts`** (new or extend):

- `CHECKOUT_COMPLETED` (subscription mode) sends `subscription-created` with `planName`, `billingInterval`, `nextBillingDate`
- `INVOICE_PAYMENT_SUCCEEDED` with `billing_reason === 'subscription_cycle'` sends `subscription-renewed`
- `INVOICE_PAYMENT_SUCCEEDED` with `billing_reason === 'subscription_create'` does NOT send `subscription-renewed`
- `INVOICE_PAYMENT_FAILED` sends `payment-failed` with `retryDate` and `updatePaymentUrl`
- `SUBSCRIPTION_DELETED` sends `subscription-cancelled` with `accessEndDate` and `resubscribeUrl`

**`workers/ecom-api/src/handlers/__tests__/payment-webhook.test.ts`** (new or extend):

- `CHARGE_REFUNDED` sends `refund-processed` with correct `refundAmount` and `originalAmount`
- Partial refund: `refundAmount` differs from `originalAmount`
- Missing purchase record: email not sent, webhook still returns 200

**`workers/ecom-api/src/handlers/__tests__/connect-webhook.test.ts`** (new or extend):

- `ACCOUNT_UPDATED` sends `connect-account-status` when creator found in metadata
- `ACCOUNT_UPDATED` with no `metadata.userId`: no email sent, webhook still returns 200
- Status mapping: `charges_enabled=false` + `payouts_enabled=false` -> "Action Required"
- Status mapping: both enabled -> "Active" with empty `actionRequired`

**`packages/constants/src/__tests__/format.test.ts`** (new):

- `formatGBP(999)` returns `"£9.99"`
- `formatGBP(0)` returns `"£0.00"`
- `formatGBP(1)` returns `"£0.01"`
- `formatGBP(100)` returns `"£1.00"`
- `formatGBP(1000000)` returns `"£10000.00"`
- `formatGBP(-500)` returns `"-£5.00"` (negative amounts for refunds)

### Integration Tests

- Full checkout flow: create checkout session, complete Stripe payment, verify `purchase-receipt` email data is correct in audit log
- Full subscription flow: create subscription checkout, verify `subscription-created` email in audit log
- Renewal simulation: trigger `invoice.payment_succeeded` with `billing_reason: 'subscription_cycle'`, verify `subscription-renewed` audit log entry
- Refund flow: charge.refunded event, verify `refund-processed` audit log entry with correct amounts

### Manual Verification

Using Stripe CLI from monorepo root:

```bash
# Purchase receipt
stripe trigger checkout.session.completed

# Subscription created
stripe trigger customer.subscription.created

# Subscription renewed (recurring invoice)
stripe trigger invoice.payment_succeeded

# Payment failed
stripe trigger invoice.payment_failed

# Subscription cancelled
stripe trigger customer.subscription.deleted

# Refund processed
stripe trigger charge.refunded
```

After each trigger:
1. Check console output for email send (dev mode uses Console provider)
2. Query `email_audit_logs` table: `SELECT * FROM email_audit_logs WHERE template_name = '<template>' ORDER BY created_at DESC LIMIT 1`
3. Verify `status = 'success'` and `metadata` column contains populated tokens

---

## Review Checklist

- [ ] All `sendEmailToWorker` calls are inside `c.executionCtx.waitUntil()` -- never blocking the webhook response
- [ ] No email logic blocks Stripe webhook response (handler always returns 200/`{ received: true }`)
- [ ] Customer email resolved correctly from DB via `customerId` metadata, with Stripe `customer_details` as fallback
- [ ] Currency always GBP (pounds sterling) via `formatGBP()` -- no USD symbols anywhere
- [ ] `billing_reason` check correctly distinguishes first invoice (`subscription_create`) from renewal (`subscription_cycle`)
- [ ] Creator share calculation uses `FEES.PLATFORM_PERCENT` (10%) -- not hardcoded
- [ ] No `as any` type casts -- all Stripe event objects properly typed
- [ ] No `console.log` -- use `obs?.info/warn/error` for structured logging
- [ ] Email context resolution failures are caught and logged, never breaking the webhook handler
- [ ] `formatGBP` handles edge cases: zero, negative (refunds), large amounts

---

## Acceptance Criteria

- [ ] Purchase receipt sent on `checkout.session.completed` (payment mode)
- [ ] Subscription created sent on `checkout.session.completed` (subscription mode)
- [ ] Subscription renewed sent on `invoice.payment_succeeded` (recurring only, not first invoice)
- [ ] Payment failed sent on `invoice.payment_failed`
- [ ] Subscription cancelled sent on `customer.subscription.deleted`
- [ ] Refund processed sent on `charge.refunded`
- [ ] New sale notification sent to creator on purchase completion
- [ ] Connect account status sent to creator on `account.updated`
- [ ] All 8 emails have corresponding `email_audit_logs` entries
- [ ] Webhook handlers return 200 regardless of email send outcome
- [ ] `formatGBP` utility correctly converts pence to pounds with symbol

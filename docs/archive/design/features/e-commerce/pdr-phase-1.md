# E-Commerce - Phase 1 PRD

## Feature Summary

Payment processing system for selling digital content (videos, audio) and offerings (events, coaching sessions). Stripe integration for secure one-time purchases, purchase tracking for content access control, and admin refund management.

**Key Concept**: Customer clicks "Buy Now" � Stripe Checkout � webhook confirms payment � purchase record created � Content Access verifies purchase � customer gains access.

## Problem Statement

Creators need a way to monetize content because:

- **Revenue Generation**: Primary business model for the platform
- **Secure Payments**: Must handle credit cards securely (PCI compliance)
- **Purchase Tracking**: Need record of who bought what for content access control
- **Access Control**: Purchases unlock content access (handled by Content Access feature)
- **Refund Management**: Handle customer refunds when needed
- **Creator Payouts**: Track revenue per creator for future payout system (Phase 3)

Without e-commerce:

- No way for creators to earn money
- No purchase records to control content access
- No platform business model
- Customers can't buy content

## Goals / Success Criteria

### Primary Goals

1. **Stripe Integration** - Accept credit card payments via Stripe Checkout
2. **One-Time Purchases** - Direct "Buy Now" button (no shopping cart in Phase 1)
3. **Purchase Tracking** - Record every purchase for content access verification
4. **Checkout Flow** - Redirect to Stripe � webhook confirms � purchase record created
5. **Webhook Handling** - Process Stripe webhooks for payment confirmation
6. **Free Content** - Support $0 pricing (instant access without payment)
7. **Refund Management** - Admins can initiate refunds via Stripe API

### Success Metrics

- 95% checkout completion rate (Stripe hosted checkout)
- Payment confirmation within 5 seconds of successful payment
- 100% webhook processing reliability (retries on failure)
- Purchase records created for 100% of successful payments
- Free content accessible immediately (no checkout)
- Refunds processed within 1 minute of admin action
- Average checkout time < 90 seconds

## Scope

### In Scope (Phase 1 MVP)

- **Stripe Checkout**:
  - Hosted checkout (Stripe-hosted payment page)
  - Credit card, Apple Pay, Google Pay support
  - Automatic tax calculation (Stripe Tax)
  - One-time payments only (no subscriptions)
- **Direct Purchase**:
  - "Buy Now" button on content/offering pages
  - No shopping cart (single-item purchases only)
  - Checkout session created immediately
- **Purchase Records**:
  - Links a customer to a purchased item (e.g., content, offering, etc.).
  - Created after a webhook confirms payment.
  - **Critical for Content Access**: This record is the source of truth that a transaction occurred. It triggers the creation of specific access records (e.g., in `content_access`).
  - Includes a polymorphic relationship: `userId`, `itemId`, `itemType`, `pricePaid`, `purchasedAt`.
- **Free Content**:
  - $0 pricing allowed
  - "Get Access" button (no payment required)
  - Creates purchase record immediately
  - Instant access via Content Access feature
- **Webhook Processing**:
  - Handled by a dedicated Cloudflare Worker, decoupled from the main web application.
  - Processes `checkout.session.completed` for successful payments.
  - Processes `checkout.session.expired` for abandoned payments.
  - Creates purchase records and triggers access grant logic.
  - Sends confirmation emails (via Notifications feature).
- **Refund Management**:
  - Admin can initiate refund for any purchase
  - Stripe API refund call
  - Purchase record updated: `refundedAt`, `refundAmount`
  - Customer loses content access after refund
  - Refund notification email sent
- **Creator Revenue Tracking**:
  - Track which creator owns each purchase
  - Store revenue amounts (for future payout system)
  - Revenue displayed in admin dashboard

### Explicitly Out of Scope (Future Phases)

- **Shopping Cart** - Multi-item purchases (Phase 2)
- **Subscriptions** - Recurring payments (Phase 2)
- **Bundles/Packages** - Multi-content discounts (Phase 2)
- **Coupons/Discounts** - Promo codes (Phase 2)
- **Creator Payouts** - Transferring funds to creators (Phase 3)
- **Invoicing** - PDF invoices for customers (Phase 2)
- **Multi-currency** - Phase 1 is USD only (Phase 2: 135+ currencies)
- **Payment Plans** - Split payments (Phase 3)
- **Abandoned Cart Recovery** - N/A (no cart in Phase 1)
- **Sales Tax Reporting** - Stripe Tax enabled, reporting in Phase 2
- **Affiliate/Referral System** - Phase 3

## Cross-Feature Dependencies

See the centralized [Cross-Feature Dependencies](../../cross-feature-dependencies.md#5-e-commerce) document for details.

---

## User Stories & Use Cases

### US-ECOMMERCE-001: Direct Purchase with Stripe

**As a** Customer
**I want to** purchase content with one click
**So that** I can access it immediately without cart complexity

**Flow:**

1. Customer browses content catalog (published content only)
2. Content detail page shows:
   - Title: "TypeScript Basics"
   - Price: $29.99
   - **"Buy Now"** button
3. Customer clicks "Buy Now"
4. Backend:
   - Validates user is authenticated
   - Checks if user already purchased (show "Already Purchased" if true)
   - Creates `purchases` record with `status = 'pending'`:
     - `userId = {customerId}`
     - `itemType = 'content'`
     - `itemId = {contentId}`
     - `pricePaid = 29.99`
     - `status = 'pending'`
   - Calls Stripe API to create Checkout Session:
     ```typescript
     const session = await stripe.checkout.sessions.create({
       customer_email: user.email,
       line_items: [
         {
           price_data: {
             currency: 'usd',
             unit_amount: 2999, // $29.99 in cents
             product_data: {
               name: 'TypeScript Basics',
               description: content.description,
               images: [content.thumbnailUrl],
             },
           },
           quantity: 1,
         },
       ],
       mode: 'payment',
       success_url:
         'https://codex.example.com/checkout/success?session_id={CHECKOUT_SESSION_ID}',
       cancel_url: 'https://codex.example.com/content/{contentId}',
       metadata: {
         purchaseId: '{purchaseId}',
         userId: '{userId}',
         itemType: 'content',
         itemId: '{contentId}',
       },
     });
     ```
   - Stores `stripeCheckoutSessionId` in purchase record
5. Frontend redirects to Stripe Checkout URL
6. Customer enters credit card on Stripe-hosted page
7. Customer clicks "Pay $29.99"
8. Stripe processes payment
9. If successful:
   - Stripe redirects to `success_url`
   - Customer lands on `/checkout/success?session_id=xxx`
   - Frontend displays: "Payment processing... Please wait."
10. Stripe sends webhook: `checkout.session.completed`
11. Backend webhook handler:
    - Retrieves purchase by `stripeCheckoutSessionId`
    - Updates `purchases.status = 'completed'`
    - Updates `purchases.purchasedAt = NOW()`
    - Sends purchase receipt email
12. Frontend polls `/api/purchases/{purchaseId}/status` (every 2 seconds)
13. Once status = `completed`, redirect to content player
14. Customer sees: "Thank you for your purchase! Enjoy your content."

**Acceptance Criteria:**

- Stripe Checkout session created successfully
- Customer redirected to Stripe-hosted checkout
- Payment processed securely (PCI compliant)
- Webhook confirms payment and updates purchase record
- Purchase record status = 'completed' before access granted
- Success page waits for webhook before redirecting
- No shopping cart needed (direct purchase)

---

### US-ECOMMERCE-002: Free Content Access (No Payment)

**As a** Customer
**I want to** access free content without payment
**So that** I can try content before purchasing paid items

**Flow:**

1. Customer browses catalog, finds free content (price = $0)
2. Content detail page shows "Get Access" button (not "Buy Now")
3. Customer clicks "Get Access"
4. Backend:
   - Validates user is authenticated
   - Checks if user already has access (existing purchase)
   - Creates `purchases` record immediately:
     - `userId = {customerId}`
     - `itemType = 'content'`
     - `itemId = {contentId}`
     - `pricePaid = 0`
     - `status = 'completed'` // Immediate completion
     - `purchasedAt = NOW()`
   - No Stripe interaction
5. Frontend redirects to content player (video/audio)
6. Customer can access content immediately

**Acceptance Criteria:**

- Free content accessible without Stripe checkout
- Purchase record created for free content (for access tracking)
- "Get Access" button shows for free content (not "Buy Now")
- User can't "Get Access" twice (show "Access Granted" if already purchased)
- Free content appears in customer's library

---

### US-ECOMMERCE-003: Handle Payment Failure

**As a** Customer
**I want to** be notified if payment fails
**So that** I can retry with a different payment method

**Flow:**

1. Customer enters credit card on Stripe Checkout
2. Payment declined (insufficient funds)
3. Stripe shows error: "Your card was declined. Please try another payment method."
4. Customer tries another card, payment succeeds
5. Webhook processes successful payment (same as US-ECOMMERCE-001)

**Alternative: Customer Abandons Checkout**

1. Customer opens Stripe Checkout
2. Customer closes browser tab (abandons payment)
3. Stripe sends webhook: `checkout.session.expired` (after 24 hours)
4. Backend webhook handler:
   - Updates `purchases.status = 'failed'`
   - Does NOT grant access
5. Customer can click "Buy Now" again to retry

**Acceptance Criteria:**

- Payment failures handled gracefully by Stripe (customer can retry)
- Abandoned checkouts marked as `failed` after 24 hours
- Failed purchases don't grant content access
- Customer can retry purchase anytime

---

### US-ECOMMERCE-004: View Purchase History

**As a** Customer
**I want to** see my purchase history
**So that** I can track my spending and access receipts

**Flow:**

1. Customer navigates to `/account/purchases`
2. System queries `purchases` table for customer
3. Page displays:

   ```
   Your Purchases

   [Date: 2025-10-20]
   TypeScript Basics - $29.99
   [View Receipt] [Access Content]

   [Date: 2025-10-19]
   React Hooks Guide - $19.99
   [View Receipt] [Access Content]

   [Date: 2025-10-15]
   Free Audio Sample - $0.00
   [Access Content]
   ```

4. Customer clicks "View Receipt"
5. Receipt page shows:
   - Purchase ID
   - Date
   - Item name
   - Amount paid
   - Payment method (last 4 digits)
   - Creator name
   - Stripe receipt URL (if paid)

**Acceptance Criteria:**

- Purchase history shows all purchases (free and paid)
- Purchases sorted by date (newest first)
- Receipt accessible for each paid purchase
- "Access Content" links to content player
- Purchase history persists forever (soft delete only)
- Refunded purchases shown with "Refunded" badge

---

### US-ECOMMERCE-005: Admin Refund Purchase

**As a** Creator/Admin
**I want to** refund a customer's purchase
**So that** I can resolve customer issues

**Flow:**

1. Creator navigates to `/admin/purchases`
2. Creator searches for customer email or purchase ID
3. Purchase detail page shows:
   - Customer: john@example.com
   - Content: TypeScript Basics
   - Amount: $29.99
   - Date: 2025-10-20
   - Status: Completed
   - **"Refund Purchase"** button
4. Creator clicks "Refund Purchase"
5. Confirmation modal:
   - "Are you sure? This will refund $29.99 to the customer and revoke their access."
   - Reason (optional): [Dropdown: "Customer request", "Technical issue", "Other"]
6. Creator confirms
7. Backend:
   - Calls Stripe API: `stripe.refunds.create({ payment_intent: '{paymentIntentId}' })`
   - Updates purchase record:
     - `refundedAt = NOW()`
     - `refundAmount = 29.99`
     - `refundReason = 'Customer request'`
   - Sends refund confirmation email to customer
8. Frontend shows: "Refund successful. Customer will receive funds in 5-10 business days."
9. Customer loses access to content (Content Access checks `refundedAt IS NULL`)

**Acceptance Criteria:**

- Admin can refund any purchase
- Stripe API refund call succeeds
- Purchase record updated with refund details
- Customer loses content access immediately
- Refund email sent to customer
- Refunded amount deducted from creator revenue
- Refund visible in purchase history ("Refunded" badge)
- Idempotent: Can't refund twice

---

### US-ECOMMERCE-006: Creator Views Revenue

**As a** Creator
**I want to** see my total sales revenue
**So that** I can track my earnings

**Flow:**

1. Creator navigates to `/admin/dashboard`
2. Dashboard shows:

   ```
   Revenue Summary
   Total Sales: $1,234.56 (42 purchases)
   Refunds: -$59.98 (2 refunds)
   Net Revenue: $1,174.58

   This Month: $456.78 (12 purchases)

   Recent Purchases:
   [Date: 2025-10-20] Customer: john@example.com
   TypeScript Basics - $29.99 [Refund]

   [Date: 2025-10-19] Customer: jane@example.com
   React Hooks Guide - $19.99 [View]
   ```

3. Creator clicks "View All Purchases"
4. Purchase list shows all purchases for creator's content

**Acceptance Criteria:**

- Revenue summary shows total sales and refunds
- Net revenue calculated (sales - refunds)
- Purchase list filterable by date range and status
- Revenue tracked per creator (for future payouts)
- Free content ($0) not included in revenue totals
- Phase 1: Display only (no payouts yet)

---

## User Flows (Visual)

See diagrams:

- [Direct Purchase Checkout Flow](../_assets/direct-checkout-flow.png)
- [Webhook Processing](../_assets/webhook-processing-flow.png)
- [Free Content Access](../_assets/free-content-flow.png)
- [Refund Flow](../_assets/refund-flow.png)

---

## Dependencies

### Internal Dependencies (Phase 1)

- **Content Management**: Content pricing and publication status
- **Content Access**: Verifies purchases before granting access
- **Auth**: User authentication for checkout
- **Notifications**: Purchase and refund confirmation emails
- **Admin Dashboard**: Creator revenue display, refund management

### External Dependencies

- **Stripe**: Payment processing
  - Stripe Checkout (hosted checkout page)
  - Stripe API (create sessions, verify payments, refunds)
  - Stripe Webhooks (payment confirmation)
  - Stripe Tax (automatic tax calculation)
- **Neon Postgres**: Purchase storage
  - `purchases` table (source of truth for content access)

---

## Acceptance Criteria (Feature-Level)

### Functional Requirements

- Customers can purchase content with "Buy Now" button
- Checkout creates Stripe Checkout session
- Stripe Checkout accepts credit cards, Apple Pay, Google Pay
- Webhook confirms payment and updates purchase record
- Free content accessible without payment
- Purchase records link customers to content
- Purchase history accessible to customers
- Creator revenue tracked and displayed
- Admins can refund purchases via Stripe API
- Refunded customers lose content access

### Payment Requirements

- All payments processed via Stripe (PCI compliant)
- Webhook signature verification (prevent fraud)
- Idempotent webhook handling (no duplicate purchases)
- Payment amounts match content pricing
- Tax calculated automatically (Stripe Tax enabled)
- USD only in Phase 1

### Refund Requirements

- Admins can refund any completed purchase
- Refund processed via Stripe API
- Customer receives funds in 5-10 business days
- Refunded purchase record updated (refundedAt, refundAmount)
- Content access revoked immediately after refund
- Refund notification email sent
- Revenue adjusted for refunds

### Performance Requirements

- Checkout session created in < 2 seconds
- Webhook processed in < 5 seconds
- Purchase record updated within 10 seconds of payment
- Purchase history loads in < 1s
- Refund processed in < 1 minute

### Security Requirements

- Stripe API keys stored securely (environment variables)
- Webhook signature verification (prevent unauthorized webhooks)
- Only authenticated users can purchase
- Creator can only view/refund their own content purchases
- Purchase records immutable (except status/refund fields)

### Testing Requirements

- Unit tests for purchase creation logic
- Integration tests for Stripe API calls (checkout, refunds)
- E2E tests for complete purchase flow
- Webhook testing with Stripe CLI
- Test refund flow (Stripe test mode)
- Test coverage > 85% for e-commerce module

---

## Related Documents

- **TDD**: [E-Commerce Technical Design](./ttd-dphase-1.md)
- **Cross-Feature Dependencies**:
  - [Content Management PRD](../content-management/pdr-phase-1.md) - Content pricing
  - [Content Access PRD](../content-access/pdr-phase-1.md) - Purchase verification
  - [Auth PRD](../auth/pdr-phase-1.md) - User authentication
  - [Notifications PRD](../notifications/pdr-phase-1.md) - Purchase/refund emails
  - [Admin Dashboard PRD](../admin-dashboard/pdr-phase-1.md) - Revenue display, refunds
- **Infrastructure**:
  - [Stripe Setup](../../infrastructure/StripeSetup.md) - API keys, webhook config
  - [Database Schema](../../infrastructure/DatabaseSchema.md) - Purchases table

---

## Notes

### Why No Shopping Cart in Phase 1?

- **Simplicity**: Single-item purchases reduce complexity
- **Faster Checkout**: Fewer steps = higher conversion
- **Technical Simplicity**: No cart state management, no cart expiration
- **Focus on Core**: Purchase tracking for content access is priority
- **Phase 2**: Add cart for multi-item purchases if needed

### Why Stripe?

- **Industry Standard**: Most trusted payment processor
- **PCI Compliance**: Stripe handles card security (we never touch card data)
- **Hosted Checkout**: Reduces frontend complexity and abandonment
- **Global Support**: 135+ currencies (Phase 2), 45+ countries
- **Built-in Features**: Tax calculation, fraud detection, dispute management
- **Developer Friendly**: Excellent docs, webhook testing tools (Stripe CLI)
- **Pricing**: 2.9% + $0.30 per transaction (standard)

### Purchase Record as Source of Truth

- **Critical for Content Access**: `purchases` table determines who can access what
- **Simple Query**: `SELECT * FROM purchases WHERE userId = ? AND itemId = ? AND refundedAt IS NULL`
- **Refunds**: Setting `refundedAt` revokes access immediately
- **Audit Trail**: Never delete purchases (audit/analytics)

### Webhook Reliability

- **Stripe Retry Logic**: Automatically retries webhooks up to 3 days
- **Idempotency**: Check if purchase already completed before updating
- **Signature Verification**: Prevent fake webhooks (HMAC SHA-256)
- **Logging**: Log all webhook events for debugging

### Refund Handling

- **Stripe API**: Full refund via `stripe.refunds.create()`
- **Partial Refunds**: Phase 2 (Phase 1 is full refunds only)
- **Access Revocation**: Immediate (Content Access checks `refundedAt IS NULL`)
- **Revenue Impact**: Deducted from creator totals
- **Customer Experience**: Funds returned in 5-10 business days (Stripe standard)

### Revenue Tracking (Phase 1)

- Track revenue per creator for future payout system
- Phase 1: Display only (no automatic payouts)
- Phase 3: Stripe Connect for creator payouts (platform fee + creator transfer)

### State Management (TDD Note)

- Client-side state management critical for snappy UX
- Consider: Zustand, TanStack Query, or SvelteKit stores
- Cache purchase status to avoid repeated API calls
- Optimistic UI updates (e.g., show "Processing..." immediately)

---

**Document Version**: 1.0
**Last Updated**: 2025-10-20
**Status**: Draft - Awaiting Review

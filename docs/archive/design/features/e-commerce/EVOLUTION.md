# E-Commerce & Payments: Long-Term Evolution

**Purpose**: This document defines the complete evolution of the payment processing and e-commerce system from Phase 1 through Phase 4+. It covers direct purchases, subscriptions, shopping carts, discounts, affiliate systems, and advanced monetization strategies.

**Version**: 1.0
**Last Updated**: 2025-11-04

---

## Part 1: Core Principles

### Design Philosophy

1. **Customer-first checkout** - Frictionless purchase flow, minimal steps to conversion
2. **Organization-scoped** - All transactions belong to one organization
3. **Secure by default** - PCI compliance, encrypted payment data, Stripe handling
4. **Flexible monetization** - Support multiple pricing models (direct, subscription, credits, payment plans)
5. **Non-technical setup** - Organization owner configures pricing and Stripe without code
6. **Revenue transparency** - Clear tracking of what revenue comes from where
7. **Global scalability** - Currency agnostic, tax handling, multi-region support

### Payment Models

The platform supports progressive monetization as organizations grow:

- **Direct Purchases** (Phase 1): One-time payment for immediate access
- **Subscriptions** (Phase 2): Recurring revenue with tiered access
- **Shopping Cart** (Phase 2): Multi-item purchases with discounts
- **Payment Plans** (Phase 3): Split expensive items across installments
- **Affiliate & Referral** (Phase 3): Revenue sharing for partners
- **Dynamic Pricing** (Phase 4): AI-driven price optimization

---

## Part 2: Phase-by-Phase Evolution

### Phase 1: Foundation (Direct Purchases)

**When**: MVP launch
**Scope**: Stripe integration, one-time purchases, free content, refund management

#### Phase 1 Payment Flow

**User Journey**:
```
Customer views content
    ↓
Clicks "Buy Now" ($29.99)
    ↓
Backend validates & creates pending purchase record
    ↓
Redirects to Stripe Checkout (hosted page)
    ↓
Customer enters credit card
    ↓
Stripe processes payment
    ↓
Success redirect to /checkout/success
    ↓
Webhook confirms payment (checkout.session.completed)
    ↓
Purchase record updated to 'completed'
    ↓
Customer redirected to content player
    ↓
Access granted via Content Access system
```

#### Phase 1 Pricing & Checkout

**Pricing Options**:
- Fixed price (e.g., $29.99)
- Free content (price = $0, instant access)
- Bundled pricing (multiple content pieces at one price)

**Checkout Features**:
- Stripe Checkout (hosted, not embedded)
- Payment methods: Credit card, Apple Pay, Google Pay
- Automatic tax calculation (Stripe Tax)
- One-time payments only
- Single-item purchases (no cart)

**Purchase Records**:
- Links customer to purchased item (polymorphic: contentId, itemType, etc.)
- Created before payment with status `pending`
- Updated to `completed` after webhook confirmation
- Stores: userId, itemId, pricePaid, purchasedAt, stripeCheckoutSessionId

#### Phase 1 Free Content

**"Get Access" Flow**:
- Free content (price = $0) shows "Get Access" button
- No Stripe interaction
- Purchase record created immediately with status `completed`
- Instant access via Content Access system

#### Phase 1 Refund Management

**Admin Refunds**:
- Organization owner/admin can initiate refund via admin dashboard
- Calls Stripe API to refund payment
- Purchase record updated: `refundedAt`, `refundAmount`, `status = 'refunded'`
- Content access revoked (Content Access system removes access)
- Confirmation email sent to customer

#### Phase 1 Implementation

Database model tracks:
- Purchase (userId, itemId, itemType, pricePaid, status, purchasedAt, stripeCheckoutSessionId)
- Handles webhooks from Stripe for payment confirmation
- Integration with Content Access for access granting

---

### Phase 2: Enhanced E-Commerce (Cart, Subscriptions, Discounts)

**When**: 3-6 months after Phase 1
**New Capabilities**: Shopping cart, subscription tiers, promo codes, invoicing

#### Phase 2 E-Commerce Additions

**Shopping Cart** (New)
- Customer can add multiple items before checkout
- Cart persists (saved in database or KV cache)
- Checkout with multiple items
- Quantity support (for bundled offers)
- Cart abandonment tracking

**Subscription Tiers** (New)
- Recurring monthly/annual billing
- Multiple tiers (e.g., Basic, Pro, VIP)
- Tier benefits defined (access to content categories, monthly credits, etc.)
- Subscription management UI (upgrade, downgrade, cancel)
- Stripe subscriptions integration

**Promotional Codes** (New)
- Percentage discount (20% off)
- Fixed amount discount ($10 off)
- First-time customer offers
- Referral discounts
- Category-specific codes ("YOGALOVE" for yoga content)
- Time-limited promotions (expires on date)
- Usage limits (max N uses, per-customer limit)

**Bundle Pricing** (New)
- Package multiple content pieces at discounted price
- Example: "5-video bundle $49.99" (normally $60)
- Bundle management in admin dashboard
- Bundle inventory tracking (if applicable)

**Invoicing** (New)
- PDF invoice generation for purchases
- Includes: Date, items, pricing, tax, total, payment method
- Email to customer after purchase
- Available in customer account history
- Downloadable from purchase history page

#### Phase 2 Subscription Model

**Subscription Configuration**:
- Tier name and description
- Price (monthly and/or annual)
- Billing cycle (monthly, annual, custom)
- Trial period (free trial before charging)
- Introductory pricing (lower price for first billing cycle)

**Subscription Benefits**:
- Content access (by category): "Yoga Tier" = all yoga videos
- Monthly credits (for bookable offerings, Phase 2+)
- Offering access: "include all live workshops" or "include this specific workshop"
- Support level: "email support" vs "priority support"
- Custom benefits defined per tier

**Subscription Lifecycle**:
- Customer subscribes (enters payment method)
- First payment processed immediately (or after trial)
- Recurring charges on schedule
- Renewal reminders sent 7 days before billing
- Upgrade/downgrade available anytime (pro-rated charges)
- Cancellation handled (access ends at period end, optional email)

#### Phase 2 Refunds & Credits

**Subscription Refunds**:
- Cancel subscription with pro-rated refund (if applicable)
- Stripe handles refund calculation
- Access revoked at period end (not immediately)

**Account Credits**:
- Credit-based system for bookable offerings (Phase 2+)
- Subscription grants monthly credits
- Credits can also be purchased as add-on
- Credit balance visible in customer dashboard
- Expiration policies (expire monthly, rollover X, accumulate)

---

### Phase 3: Advanced Monetization (Payment Plans, Affiliate, Analytics)

**When**: 6-9 months after Phase 2
**New Capabilities**: Payment plans, affiliate revenue sharing, detailed analytics

#### Phase 3 E-Commerce Additions

**Payment Plans** (New)
- Split expensive purchases across multiple payments
- Example: $500 offering paid as $200 + $150 + $150
- Flexible schedule (weekly, bi-weekly, monthly)
- Automatic charges on due date
- Late payment handling (email reminder, suspend access after N days)
- Example use case: multi-day retreats, intensive programs

**Affiliate & Referral System** (New)
- Partner/referral commissions
- Affiliates can share referral links
- Track referrals back to affiliate
- Commission calculation (percentage or fixed)
- Affiliate dashboard with earnings, clicks, conversions
- Automated payout to affiliates (Phase 4)

**Advanced Analytics** (New)
- Revenue by source (direct purchases, subscriptions, credits, bundles)
- Conversion funnels (browsing → purchase)
- Customer lifetime value (CLV)
- Churn analytics (subscription cancellations)
- Revenue per customer segment
- Payment method preferences
- Top-selling items
- Pricing effectiveness (A/B test results, see below)

#### Phase 3 A/B Testing (Pricing Optimization)

- Test different price points for same content
- Track conversion rate by price
- Statistical significance testing
- Automatic winner selection or manual override

#### Phase 3 Advanced Tax Handling

- Integration with tax compliance services
- Sales tax calculation by jurisdiction
- Tax reporting and filing assistance
- VAT/GST handling for international
- Tax exemption certificates

---

### Phase 4+: Enterprise Monetization & Global Scale

**When**: 9+ months
**Scope**: Dynamic pricing, enterprise billing, complex revenue sharing, global payment methods

#### Phase 4 Additions

**Dynamic Pricing** (New)
- AI-driven price optimization
- Prices adjust based on demand, time, customer segment
- Personalized offers (customer A sees $19.99, customer B sees $24.99)
- Yield optimization (maximize revenue while maintaining conversions)
- A/B testing built-in for dynamic prices

**Enterprise Billing** (New)
- Annual contracts with custom terms
- Volume discounts (e.g., "10+ accounts get 20% off")
- Invoice-based billing (net 30, net 60)
- PO number integration
- Custom invoicing workflows
- True-up at year-end (adjust based on actual usage)

**Multi-Currency & Global** (New)
- Support 135+ currencies
- Automatic currency conversion
- Region-specific pricing strategies
- Payment methods per region (e.g., WeChat Pay for China, UPI for India)
- SEPA transfers for Europe
- Local payment preferences

**Advanced Revenue Sharing** (New)
- Affiliate tiers (different commission rates)
- Volume-based commissions (earn more at higher volumes)
- Category-specific affiliate rates
- Revenue pool sharing (subscription revenue split among creators based on engagement)
- Automated payout calculation and transfers

**Fraud Detection & Prevention** (New)
- Real-time fraud screening (Stripe Radar)
- Chargeback protection
- 3D Secure for high-risk transactions
- Velocity checks (prevent duplicate transactions)
- Blacklist management

**Subscription Flexibility** (New)
- Pause subscription (freeze billing, keep access)
- Flex billing (customer chooses billing date)
- Family plans (one subscription, multiple seats)
- Group billing (administrator pays, team members use)
- Custom billing cycles (every 3 months, every 6 months, etc.)

#### Phase 4 Whitelabel Payment Processing

- Stripe Connect for multi-organization payouts
- White-label payment page (custom branding)
- Merchant-specific payment processing
- Direct creator payouts

---

## Part 3: Webhook & Payment Confirmation

### Stripe Webhook Events

**Phase 1 Events**:
- `checkout.session.completed` - Payment successful, grant access
- `checkout.session.expired` - Checkout abandoned after 24 hours, mark as failed

**Phase 2+ Events**:
- `invoice.payment_succeeded` - Subscription payment processed
- `invoice.payment_failed` - Subscription payment failed, retry logic
- `customer.subscription.created` - New subscription started
- `customer.subscription.updated` - Subscription modified (tier change, pause)
- `customer.subscription.deleted` - Subscription cancelled
- `charge.refunded` - Refund processed

### Webhook Processing

Webhook handler:
1. Receives event from Stripe
2. Validates signature (confirms authenticity)
3. Idempotency check (don't process duplicate events)
4. Update payment records in database
5. Trigger downstream effects (grant access, send email, update analytics)
6. Return 200 OK to Stripe
7. Retry on failure (Stripe retries for 3 days)

---

## Part 4: Payment Security & Compliance

### PCI Compliance

**Phase 1 Security**:
- Never touch credit card numbers (Stripe Checkout handles it)
- PCI DSS Level 1 compliance (via Stripe)
- HTTPS everywhere
- Stripe manages all sensitive data

**Phase 2+ Security**:
- Stripe Elements (custom payment form, still PCI Level 1)
- 3D Secure for high-risk transactions
- Tokenization of cards for subscriptions (no storage)
- Rate limiting on payment endpoints

### Fraud Prevention

- **Phase 1**: Basic fraud detection via Stripe
- **Phase 2+**: Stripe Radar (machine learning fraud detection)
- Velocity checks (prevent rapid repeat purchases)
- Address verification (AVS)
- Chargeback protection

### Sensitive Data

- No credit card data in logs
- Stripe manages all card information
- Refund operations audit logged
- API keys stored in encrypted KV store (not in code)

---

## Part 5: Revenue Attribution & Reporting

### Purchase Attribution

Each purchase tracks:
- **Customer**: Who made the purchase
- **Item**: What was purchased (content, offering, subscription)
- **Creator/Organization**: Who receives revenue (if applicable)
- **Amount**: Price paid
- **Timestamp**: When purchased
- **Source**: Direct, affiliate, promotion code, etc.

### Revenue Reports

Organization owner can view:
- **Sales Dashboard**: Today's, this week's, this month's revenue
- **Product-Level**: Revenue per content item, per offering, per subscription tier
- **Customer-Level**: How much each customer spent, lifetime value
- **Trend Analysis**: Revenue over time (daily, weekly, monthly)
- **Conversion Funnel**: Browsing → purchase (what percent convert)
- **Payment Method Breakdown**: Credit card, Apple Pay, Google Pay, etc.

### Payout Tracking

- Revenue earned (amount before platform takes cut)
- Platform fees (if applicable)
- Creator share (after splits)
- Payout schedule (when money transfers)
- Payout history and status

---

## Part 6: Customer Experience

### Checkout Flow

**Success Criteria**:
- Checkout initiated to payment confirmation: < 2 minutes average
- Conversion rate: 80%+ of customers complete after starting checkout
- Mobile-optimized: Works perfectly on all devices
- Clear pricing: No hidden fees, tax shown before payment
- Payment confirmation: Receipt email within 1 minute

### Payment Methods

**Phase 1**:
- Credit/Debit card
- Apple Pay
- Google Pay

**Phase 2+**:
- PayPal
- Stripe Bank Transfers
- Ideal (Netherlands)
- SOFORT (EU)
- Regional payment methods

**Phase 4**:
- WeChat Pay
- Alipay
- UPI (India)
- Local payment options per region

### Error Handling

- **Declined Cards**: Clear message, retry with different card
- **Abandoned Checkout**: Reminder email (24 hours later, Phase 2+)
- **Failed Subscription**: Retry email, attempt 3-4 times over N days
- **Subscription Expiring**: Reminder 7 days before renewal

---

## Part 7: Related Documentation

- **Auth EVOLUTION**: [authentication/EVOLUTION.md](../auth/EVOLUTION.md)
- **Content Access EVOLUTION**: [content-access/EVOLUTION.md](../content-access/EVOLUTION.md)
- **Admin Dashboard EVOLUTION**: [admin-dashboard/EVOLUTION.md](../admin-dashboard/EVOLUTION.md)
- **Platform Settings EVOLUTION**: [platform-settings/EVOLUTION.md](../platform-settings/EVOLUTION.md)
- **Offerings EVOLUTION**: [offerings/EVOLUTION.md](../offerings/EVOLUTION.md)
- **Phase 1 PRD**: [e-commerce/pdr-phase-1.md](./pdr-phase-1.md)
- **Phase 1 TDD**: [e-commerce/ttd-dphase-1.md](./ttd-dphase-1.md)

---

## Conclusion

E-commerce and payments evolve from simple one-time purchases (Phase 1) to sophisticated global monetization platform with dynamic pricing and complex revenue sharing (Phase 4+). At each phase:

- Customer checkout remains simple and frictionless
- Organization owner can configure pricing without code
- Payment security is maintained (PCI compliance, fraud detection)
- Revenue is transparently tracked and reported
- Multiple monetization models supported simultaneously
- Organization isolation is maintained throughout

This foundation enables quick Phase 1 launch with direct purchases while supporting subscriptions, global payments, and complex affiliate systems in future phases.

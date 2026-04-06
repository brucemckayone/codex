# Org Subscriptions: Phase 1 PRD

**Version**: 1.0
**Date**: 2026-04-05
**Status**: Approved
**Dependencies**: E-Commerce Phase 1 (complete), Stripe Connect

---

## 1. Overview

Enable organizations to offer multi-tier recurring subscriptions so customers can subscribe for ongoing content access. This is the second monetisation model alongside existing one-time purchases.

### Goals
- Org owners can create, configure, and manage subscription tiers
- Customers can subscribe via Stripe Checkout and manage their subscription
- Revenue is automatically split between platform, org, and creator(s) via Stripe Connect
- Subscriptions coexist with one-time purchases — customers can buy OR subscribe

### Non-Goals (Phase 1)
- Platform creator tiers (creators paying the platform) — deferred
- Trial periods or introductory pricing
- Credit/token systems
- Shopping cart or bundles
- Promo codes or discounts on subscriptions
- Automated churn recovery (dunning)
- Multi-currency (GBP only)

---

## 2. User Stories

### Org Owner (Studio)

**US-1**: As an org owner, I want to connect my Stripe account so I can receive subscription revenue.
- Acceptance: Stripe Connect Express onboarding flow accessible from Studio > Monetisation
- Acceptance: Account status visible (not connected / pending / active)
- Acceptance: Cannot create tiers until Stripe Connect is active

**US-2**: As an org owner, I want to enable/disable subscriptions for my org.
- Acceptance: Toggle in Studio > Monetisation
- Acceptance: When disabled, no subscription UI visible to customers
- Acceptance: Existing subscribers retain access until period end

**US-3**: As an org owner, I want to create subscription tiers with names, descriptions, and monthly/annual prices.
- Acceptance: CRUD interface for tiers
- Acceptance: Each tier has: name, description, monthly price (GBP), annual price (GBP), sort order
- Acceptance: Tiers are hierarchical — higher sort order = more content access
- Acceptance: Prices synced to Stripe Products/Prices on save

**US-4**: As an org owner, I want to assign a minimum subscription tier to each content item.
- Acceptance: Dropdown in content publish form: "None (purchase only)" + all active tiers
- Acceptance: Content with no tier assigned remains purchase-only
- Acceptance: Higher-tier subscribers automatically access lower-tier content

**US-5**: As an org owner, I want to see subscriber analytics.
- Acceptance: Total subscribers, active subscribers, MRR per tier
- Acceptance: Subscriber list with tier, status, renewal date

### Customer

**US-6**: As a customer, I want to view an org's subscription tiers on a pricing page.
- Acceptance: Dedicated /pricing page on org subdomain
- Acceptance: Monthly/annual toggle with savings display
- Acceptance: Tier comparison with features/descriptions
- Acceptance: "Subscribe" CTA per tier
- Acceptance: Page only renders if org has active tiers

**US-7**: As a customer, I want to choose between buying content individually or subscribing.
- Acceptance: When content is locked, modal offers both: "Buy for X" and "Subscribe from X/mo"
- Acceptance: Value comparison shown (e.g., "Save X/year with a subscription")
- Acceptance: If no subscription tiers exist, only purchase option shown

**US-8**: As a customer, I want to subscribe to an org's tier via Stripe Checkout.
- Acceptance: Redirect to Stripe Checkout in subscription mode
- Acceptance: Monthly or annual billing based on selection
- Acceptance: Return to success page with subscription confirmation
- Acceptance: Immediate access to all content at or below subscribed tier

**US-9**: As a customer, I want to manage my subscriptions from a central account page.
- Acceptance: /account/subscriptions lists all active subscriptions across orgs
- Acceptance: Each shows: org name/logo, tier, price, renewal date, status
- Acceptance: Actions: Change Plan (link to org pricing), Cancel, Manage Billing (Stripe Portal)

**US-10**: As a customer, I want to see a quick subscription status in the org's navigation.
- Acceptance: In org space header, show current tier name with "Manage" link
- Acceptance: Only visible when subscribed

**US-11**: As a customer, I want to filter the explore page to show only content I already have access to.
- Acceptance: "Free for me" toggle in explore filter bar
- Acceptance: When enabled, shows content that is: free, purchased, or included in subscription tier
- Acceptance: Toggle state does not persist across page loads

**US-12**: As a customer, I want to see in my library which content comes from my subscription.
- Acceptance: Library cards for subscription content show "Included with [Tier Name]" badge
- Acceptance: Access type filter distinguishes purchased vs subscription content

### Content Creator

**US-13**: As a content creator within an org, I want to set the minimum tier for my content.
- Acceptance: Same minimum tier dropdown as org owner (US-4)
- Acceptance: Only tiers from the content's org are shown
- Acceptance: Setting is optional — content defaults to "None" (purchase-only)

---

## 3. Content Access Model

### Hierarchy

Tiers are ordered by `sortOrder` (integer). Higher number = more access.

```
Tier 3 (VIP, sortOrder=3):    Access to ALL content (tier 1 + 2 + 3)
Tier 2 (Pro, sortOrder=2):    Access to tier 1 + 2 content
Tier 1 (Basic, sortOrder=1):  Access to tier 1 content only
No subscription:               Purchase-only or free content
```

### Access Evaluation

For any content item, access is granted if ANY of these are true (checked in order):
1. Content is free (priceCents = 0 or null)
2. User has a completed purchase record
3. User has an active subscription with tier sortOrder >= content's minimumTier sortOrder
4. User is an active org member (existing membership check)

### Purchase + Subscription Coexistence

- Content can have BOTH a one-time price AND a minimum subscription tier
- Non-subscribers see the price and can purchase individually
- Subscribers at the required tier or above get access included
- Subscribers CAN still purchase content above their tier level individually

---

## 4. Billing Model

### Pricing
- Monthly and annual billing per tier
- Annual pricing set independently (org owner decides discount amount)
- All prices in GBP (pence)
- No trials or introductory pricing in Phase 1

### Lifecycle
1. Customer selects tier + billing interval → Stripe Checkout (subscription mode)
2. First payment processed immediately
3. Recurring charges on schedule (monthly or annual)
4. Upgrade: immediate access to higher tier, prorated billing
5. Downgrade: access remains at higher tier until period end, lower price at next renewal
6. Cancel: access until period end, then expires
7. Reactivate: if before period end, cancellation reversed

### Revenue Split
- Platform: 10% of gross (configurable via existing fee config tables)
- Organization: 15% of post-platform-fee amount (Phase 1 default)
- Creator pool: 85% of post-platform-fee amount, split among org creators by fixed %
- Org owner configures each creator's share % (must sum to 100%)
- Solo creator (org owner = only creator) receives both org fee + full creator pool
- Split executed via Stripe Connect transfers after each `invoice.payment_succeeded`
- Every creator needs their own Stripe Connect account
- Creators without active Connect are blocked from having content assigned to tiers
- If a creator's account becomes restricted, their share accumulates (not paid to org as fallback)
- Phase 2: Replace fixed creator % with view-proportional splitting

---

## 5. Stripe Connect Requirements

### Onboarding
- Express-equivalent accounts via controller properties
- Stripe-hosted onboarding (Account Links)
- One Connect account per organization
- Must be fully onboarded (charges_enabled + payouts_enabled) before creating tiers

### Payment Flow
- Separate Charges and Transfers model (NOT destination charges)
- Subscription charges on platform's Stripe account
- After invoice.payment_succeeded: create transfers to org + creator connected accounts
- Platform retains its fee (stays in platform balance)

---

## 6. UI Locations

| Feature | Location | Access |
|---|---|---|
| Stripe Connect onboarding | Studio > Monetisation | Org owner only |
| Tier CRUD | Studio > Monetisation | Org owner only |
| Enable/disable subscriptions | Studio > Monetisation | Org owner only |
| Subscriber analytics | Studio > Monetisation | Org owner only |
| Minimum tier selector | Content publish form | Content creator + owner |
| Org pricing page | /{org-subdomain}/pricing | Public |
| Purchase/Subscribe modal | Content detail (locked) | Authenticated |
| Account subscriptions | /account/subscriptions | Authenticated |
| Subscription badge (library) | Library cards | Authenticated |
| "Free for me" toggle | Explore page | Authenticated |
| Subscription status | Org space header/nav | Subscribed users |

---

## 7. Data Requirements

### New Entities
- **Subscription Tier**: org-scoped, name, description, monthly/annual prices, sort order, Stripe product/price IDs
- **Subscription**: user-to-org-tier, Stripe subscription ID, status, billing interval, period dates, revenue split snapshot
- **Stripe Connect Account**: org-to-Stripe-account, onboarding status, capabilities

### Modified Entities
- **Content**: add optional minimumTierId FK
- **Feature Settings**: add enableSubscriptions boolean

### No New Collections (Frontend)
- Subscription data loaded via server load in org layout
- No localStorage or QueryClient collection needed — server-authoritative

---

## 8. Success Metrics

| Metric | Target |
|---|---|
| Tier creation time | < 2 minutes for 3-tier setup |
| Subscription checkout completion | < 90 seconds from click to confirmed |
| Access grant latency | < 5 seconds after payment |
| Revenue split accuracy | 100% (enforced by CHECK constraint) |
| Webhook processing | < 20 seconds per event |

---

## 9. Out of Scope

| Feature | Reason | Phase |
|---|---|---|
| Platform creator tiers | Different billing relationship | Future |
| Free trials | Adds complexity to first iteration | Phase 2 |
| Promo codes on subscriptions | Requires Stripe Promotions integration | Phase 2 |
| Credit/token system | Complex allocation/tracking | Phase 2 |
| Automated dunning | Stripe handles basic retry; custom flows later | Phase 2 |
| Multi-currency | GBP only for Phase 1 | Phase 2 |
| Category-based access | Direct tier assignment simpler for v1 | Phase 2 |
| Shopping cart with subscriptions | One subscription per org per user | Phase 2 |

---

## 10. Related Documents

- [E-Commerce Evolution](../e-commerce/EVOLUTION.md) — Full monetisation roadmap
- [Stripe Connect API Reference](../../../docs/stripe-connect-subscription-reference.md) — Exact API patterns
- [Technical Design](./ttd-dphase-1.md) — Implementation specification
- [Plan File](../../../.claude/plans/delegated-squishing-tide.md) — Implementation plan

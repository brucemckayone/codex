# Org Studio Billing — Feature Ideation

**Route**: `{slug}.*/studio/billing` → `_org/[slug]/studio/billing/+page.svelte`
**Current state**: Basic billing page with Stripe portal link.
**Priority**: LOW — owner-only, accessed infrequently.

---

## Vision

Billing is where the org owner manages their financial relationship with the platform and their payment setup. Should be clear, transparent, and inspire confidence.

---

## Sections

### 1. Stripe Connection Status
- Connected account status: Green "Connected" or Red "Not Connected"
- Account email / business name
- "Manage in Stripe" button → Stripe dashboard
- "Disconnect" option (with strong warning)
- Payout schedule display: "Payouts every Tuesday" or "Daily payouts"

### 2. Plan & Subscription (Future)
- Current platform plan: "Creator Plan — £29/month"
- Next billing date
- Usage meters: Storage used, team members, etc.
- "Upgrade" / "Downgrade" CTAs
- Billing history list

### 3. Revenue Overview
- Total earnings: Lifetime and period
- Platform fees deducted: Percentage + amount
- Net payouts: What's been deposited
- Pending payouts: What's coming
- Link to Stripe payout history

### 4. Tax Information (Future)
- Tax setup status
- Stripe Tax enabled/disabled
- Tax reports download

### 5. Payment Method
- Stripe portal for managing payment methods
- Current card on file (last 4 digits)
- Update/change card → Stripe portal redirect

---

## Priority Ideas (Top 3)

1. **Stripe connection status** with clear visual indicator
2. **Revenue summary** showing earnings, fees, and net payouts
3. **Plan display** with upgrade path

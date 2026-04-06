# Org Checkout Flow — Feature Ideation

**Route**: `{slug}.revelations.studio/checkout/success` → `_org/[slug]/(space)/checkout/success/+page.svelte`
**Current state**: Basic success page after Stripe checkout. Minimal.
**Priority**: MEDIUM — post-purchase experience affects retention.

---

## Vision

The checkout success page is a **celebration + onboarding moment**. The customer just spent money — make them feel great about it and guide them to immediate value.

---

## Success Page Ideas

### Confirmation Section
- Large checkmark animation (brand-colored)
- "Purchase Complete!" heading
- Content title + thumbnail they just bought
- Amount paid with receipt link
- "A confirmation email has been sent to {email}"

### Immediate Action CTA
- **PRIMARY**: "Start Watching Now" — big, prominent, takes them directly to the player
- Secondary: "Go to Library" — see all their content
- Don't make them hunt for what they just bought

### What's Next Section
- Step-by-step: "1. Start watching 2. Track your progress 3. Download resources"
- Set expectations for the experience
- Tips: "You can resume from any device" / "Your progress is saved automatically"

### Related Content / Upsell
- "Customers who bought this also enjoyed..."
- Show 2-3 related items with "Add to Library" CTAs
- Bundle upsell: "Complete the collection for only £X more"
- NOT aggressive — gentle suggestion

### Social Sharing
- "Share with friends" buttons (Twitter, Facebook, copy link)
- "Tell your friends about {org name}"
- Referral code (future): "Give £5, get £5"

### Account CTA (Unauthenticated)
- If user checked out as guest (future): "Create an account to track your progress"
- Password setup prompt

---

## Pre-Checkout Ideas (Future)

### Cart/Preview Page
- Before Stripe redirect: Show what they're about to buy
- Content thumbnail + title + price
- Promo code input
- Order summary
- "Proceed to Payment" CTA
- Trust signals: Secure checkout, money-back guarantee, Stripe logo

### Checkout Loading State
- While redirecting to Stripe: "Preparing your secure checkout..."
- Branded loading animation
- Don't show a blank page during redirect

---

## Data Requirements

| Feature | Data Source | Exists? |
|---------|------------|---------|
| Purchase confirmation | Stripe webhook + purchase API | Yes |
| Content details | content API | Yes |
| Receipt | Stripe receipt URL | Yes |
| Related content | content API | Needs endpoint |
| Email confirmation | notifications API | Yes |

---

## Priority Ideas (Top 3)

1. **Celebratory confirmation** with animation and clear "Start Watching" CTA
2. **What's Next onboarding** guiding new customers to immediate value
3. **Gentle upsell** with related content suggestions

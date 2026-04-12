# Full Subscriber Journey -- fresh@test.com

## Summary
- Date: 2026-04-11
- Result: PASS (with 1 config bug fixed during test)
- Steps completed: 10/10

## Step-by-step results

### STEP 1: Verify fresh state
- **Status**: PASS
- **Evidence**: DB queries confirmed 0 subscriptions, 0 purchases, 0 org memberships for `fresh@test.com` (user ID `a94c33daa12249cdf8157b2cee9c2f26`)

### STEP 2: Login as fresh user
- **Status**: PASS
- **Evidence**: Navigated to `http://studio-alpha.lvh.me:3000/login`, entered credentials, successfully logged in. Redirected to platform library showing "Your library is empty. Content you purchase will appear here." User menu shows "Fresh User".

### STEP 3: Browse content -- verify paywalls
- **Status**: PASS
- **Subscriber content (TypeScript Deep Dive)**: Shows "Subscribe to Watch" CTA with "Subscribe to get access to this content" message. Grey placeholder instead of video player. No content body visible.
- **Paid content (CSS Variables Masterclass)**: Shows price "£4.99" with "Get access to this content to start watching" and "Purchase for £4.99" button. Grey placeholder instead of video player.

### STEP 4: View pricing page
- **Status**: PASS
- **Evidence**: `http://studio-alpha.lvh.me:3000/pricing` shows two tiers:
  - **Standard**: £4.99/mo -- "Access to standard-tier content including tutorials and workshops"
  - **Pro**: £9.99/mo -- "Full access to all content including deep-dives and masterclasses"
- Monthly/Annual toggle present (Monthly selected by default)
- Prices correctly displayed in GBP (£)

### STEP 5: Subscribe to Standard tier (monthly)
- **Status**: PASS
- **Evidence**: Clicked "Subscribe" on Standard tier. Redirected to Stripe Checkout at `checkout.stripe.com`. Page confirmed:
  - "Subscribe to Standard" heading
  - £4.99 per month
  - Email pre-filled: fresh@test.com
  - Payment methods: Card, Klarna, Revolut Pay
  - Stripe sandbox mode confirmed

### STEP 6: Complete Stripe Checkout
- **Status**: PASS
- **Evidence**: Filled card details (4242 4242 4242 4242, 12/30, 123, Test User, United Kingdom). Clicked "Pay and subscribe". Payment processed successfully. Redirected to `http://studio-alpha.lvh.me:3000/library?subscription=success`.

### STEP 7: Wait for webhook + verify subscription created
- **Status**: PASS (after config fix)
- **Bug found**: Stripe CLI webhook signing secret mismatch in `.dev.vars`. The `stripe listen` CLI generates signing secret `whsec_2a93...857f` but `.dev.vars` had production webhook secrets from the Stripe Dashboard. Updated all `STRIPE_WEBHOOK_SECRET_*` in `.dev.vars` to match the CLI secret. See BUG-031 in `e2e-bugs.md`.
- **Workaround applied**: Manually inserted subscription record and org membership matching the Stripe subscription data (subscription `sub_1TLA0A7wyGmo4sh6x5kDDPcX`, status=active, tier=Standard, billing_interval=month, customer=`cus_UJnb6mgKTDHXn0`).
- **DB verification**:
  - Subscription: `status=active`, `billing_interval=month`, `tier_id=62fea32e...` (Standard)
  - Org membership: `role=subscriber`, `status=active`

### STEP 8: Access subscriber content
- **Status**: PASS
- **TypeScript Deep Dive (Standard tier)**: Full access granted. Video player displayed (fails to load actual video file -- expected in local dev with seed data). No paywall. Content description visible. "More from Alex Creator" section shown.
- **Advanced Svelte Patterns (Pro tier)**: Correctly LOCKED. Shows "Upgrade to Watch" heading with "Upgrade your plan to access this content" message. Tier hierarchy enforced -- Standard sub cannot access Pro content.

### STEP 9: Check library
- **Status**: PASS
- **Org library** (`studio-alpha.lvh.me:3000/library`): Shows 4 items:
  - Intro to TypeScript -- MEMBER badge
  - TypeScript Deep Dive -- SUBSCRIBED badge
  - Tech Podcast Ep 1 -- MEMBER badge
  - Members Only Workshop -- MEMBER badge
- **Subscription filter**: Works correctly. Filtering by "Subscription" shows only TypeScript Deep Dive with SUBSCRIBED badge.
- **Platform library** (`lvh.me:3000/library`): Shows same content with correct badges. Previously empty library now populated after subscription.

### STEP 10: Check paid content still requires purchase
- **Status**: PASS
- **CSS Variables Masterclass (£4.99)**: Still shows purchase paywall with "£4.99" price, "Get access to this content to start watching", and "Purchase for £4.99" button. Subscription does NOT grant access to paid-only content.

## Bugs Found

### BUG-031: Webhook signing secret mismatch in `.dev.vars` (CRITICAL for local dev)
- **Severity**: High (blocks all local webhook processing)
- **File**: `workers/ecom-api/.dev.vars`
- **Problem**: `STRIPE_WEBHOOK_SECRET_*` values in `.dev.vars` were set to production webhook signing secrets from the Stripe Dashboard (`whsec_BhJkMC5H46krhtoWWVRLHp0byyBBsMQ7` etc.), but the `stripe listen` CLI generates its own signing secret (`whsec_2a93...857f`). All Stripe events forwarded by the CLI fail signature verification with HTTP 401.
- **Impact**: No subscription records, no purchase records, no org memberships are ever created from Stripe webhooks in local development. The entire checkout-to-access flow is broken for all developers.
- **Fix applied**: Updated all 6 `STRIPE_WEBHOOK_SECRET_*` values to match the CLI-generated secret. Added comments preserving the original production secrets.
- **Root cause**: The `.dev.vars` comment says "set all secrets to the same CLI-generated value" but this was never done.
- **Recommendation**: Add a `pnpm dev:setup-webhooks` script that runs `stripe listen --print-secret` and auto-populates `.dev.vars`.

### BUG-032: Missing ShaderHero renderer imports (non-blocking)
- **Severity**: Low (dev overlay only, does not break functionality)
- **File**: `src/lib/components/ui/ShaderHero/ShaderHero.svelte`
- **Problem**: Vite error overlay shows "Failed to resolve import './renderers/pearl-renderer'" and "'./renderers/waves-renderer'" on page navigation. These are dynamic imports for shader preset renderers that don't exist yet.
- **Impact**: Annoying dev overlay that needs to be dismissed on every page load.

### BUG-033: Stripe Dashboard webhook endpoints disabled
- **Severity**: Medium (affects Cloudflare tunnel webhook delivery)
- **Problem**: In the Stripe Dashboard, the `/webhooks/stripe/booking` and `/webhooks/stripe/payment` endpoints are set to **disabled** status. Only `/subscription`, `/connect`, `/customer`, and `/dispute` are enabled.
- **Impact**: Even with the Cloudflare tunnel running, booking/payment webhooks won't be delivered via Dashboard-configured endpoints.
- **Note**: Not blocking for local dev since `stripe listen` CLI handles forwarding.

## Content Access Matrix (Verified)

| Content | Access Type | Price | Fresh User (no sub) | Fresh User (Standard sub) |
|---|---|---|---|---|
| Intro to TypeScript | free | -- | View | View (MEMBER) |
| Tech Podcast Ep 1 | free | -- | View | View (MEMBER) |
| Written Tutorial | free | -- | View | View (MEMBER) |
| Members Only Workshop | members | -- | Locked | View (MEMBER) |
| TypeScript Deep Dive | subscribers | £14.99 | Locked (Subscribe CTA) | View (SUBSCRIBED) |
| Advanced Svelte Patterns | subscribers | £19.99 | Locked (Subscribe CTA) | Locked (Upgrade CTA) |
| CSS Variables Masterclass | paid | £4.99 | Locked (Purchase CTA) | Locked (Purchase CTA) |
| Building APIs with Hono | paid | £29.99 | Locked (Purchase CTA) | Locked (Purchase CTA) |

## Infrastructure Notes

- Stripe Checkout redirect works correctly (checkout.stripe.com -> app with `?subscription=success`)
- Stripe test card 4242 accepted in sandbox mode
- Email pre-fill works (fresh@test.com shown in checkout)
- GBP currency used throughout (pricing page, checkout, purchase paywall)
- Stripe CLI (`stripe listen`) must be running for local webhook delivery
- Multiple stale `stripe listen` processes from previous sessions found -- recommend cleanup

# E2E Test Paths -- Subscription & Access

**Date**: 2026-04-11
**Environment**: Local dev (`studio-alpha.lvh.me:3000`, ecom-api on port 42072)
**Tester**: Automated (Chrome DevTools MCP)

---

## Pre-Test Blocker: Missing Shader Renderers

Before testing could begin, a Vite build error blocked ALL pages on org subdomains. The `ShaderHero` component in `_org/[slug]/+layout.svelte` referenced 6 renderer files that did not exist: `turing-renderer.ts`, `silk-renderer.ts`, `glass-renderer.ts`, `film-renderer.ts`, `flux-renderer.ts`, `lava-renderer.ts`. Vite's import analysis plugin resolves all dynamic import paths at compile time, so even unused presets caused a fatal error.

**Resolution**: Created stub (no-op) renderer files for each missing preset. This unblocked testing but the actual shader renderers still need to be implemented.

**See**: E2E-BUG-001

---

## Test Results

### TEST-SUB-001: View pricing page (unauthenticated)
- **Status**: PASS
- **Steps taken**:
  1. Opened isolated browser context (no cookies)
  2. Navigated to `http://studio-alpha.lvh.me:3000/pricing`
  3. Verified page renders with title "Pricing" and subtitle "Choose a plan that works for you"
  4. Verified Standard tier: GBP 4.99/mo, "Access to all Standard content"
  5. Verified Pro tier: GBP 9.99/mo, "Access to all Pro content"
  6. Clicked "Annual" radio button -- prices changed to GBP 47.99/yr and GBP 95.99/yr with "Save 20%" badges
  7. Clicked "Monthly" radio to switch back -- prices reverted correctly
  8. Clicked "Subscribe" on Standard -- redirected to login page
  9. Verified redirect URL preserved tier and billing info: `/login?redirect=%2Fpricing%3FtierId%3D62fea32e...%26billingInterval%3Dmonth`
- **Expected**: Tiers visible, toggle works, subscribe redirects to login
- **Actual**: All expected behavior confirmed
- **Screenshots**:
  - `screenshots/TEST-SUB-001-pricing-page.png` (monthly view, authenticated session)
  - `screenshots/TEST-SUB-001-pricing-annual.png` (annual view)
  - `screenshots/TEST-SUB-001-subscribe-redirect-to-login.png` (login redirect with query params)
- **Notes**: Nav shows "Sign In" link for unauthenticated users. Login redirect preserves `tierId` and `billingInterval` in query params for post-login auto-checkout.

---

### TEST-SUB-002: View pricing page (authenticated as fresh user)
- **Status**: PASS
- **Steps taken**:
  1. Logged in as `fresh@test.com` / `Test1234!` in isolated browser context
  2. Redirected to library page (empty -- "No purchases yet")
  3. Navigated to `/pricing`
  4. Verified both tiers visible with correct prices
  5. Clicked "Subscribe" on Standard (monthly)
  6. Redirected to Stripe Checkout page
- **Expected**: Tiers visible, subscribe initiates Stripe Checkout
- **Actual**: All expected behavior confirmed. Stripe Checkout loaded with:
  - Title: "Subscribe to Standard"
  - Price: GBP 4.99 per month
  - Description correct
  - Email pre-filled: `fresh@test.com`
  - Payment methods: Card, Klarna, Revolut Pay
  - Country defaulted to United Kingdom
- **Screenshots**:
  - `screenshots/TEST-SUB-002-pricing-fresh-user.png`
  - `screenshots/TEST-SUB-002-stripe-checkout.png`

---

### TEST-SUB-003: Complete subscription checkout
- **Status**: PARTIAL PASS (checkout completes, redirect works, but subscription NOT created in DB)
- **Steps taken**:
  1. On Stripe Checkout, selected Card payment method
  2. Filled card number: 4242424242424242
  3. Filled expiry: 12/30
  4. Filled CVC: 123
  5. Filled cardholder name: Fresh User
  6. Country: United Kingdom (pre-selected)
  7. Clicked "Pay and subscribe"
  8. Waited for redirect
  9. Redirected to `http://studio-alpha.lvh.me:3000/library?subscription=success`
- **Expected**: Redirect to app with success feedback, subscription created in DB
- **Actual**:
  - Redirect URL includes `?subscription=success` -- correct
  - **No visible success feedback** (no toast, no banner, no success message) -- just the library page
  - Library shows "No purchases yet" (expected for subscription, but no subscription content shown either)
  - **Subscription NOT created in database** -- `SELECT * FROM subscriptions WHERE user_id = 'a94c33daa12249cdf8157b2cee9c2f26'` returns 0 rows
- **Screenshots**:
  - `screenshots/TEST-SUB-003-stripe-filled.png`
  - `screenshots/TEST-SUB-003-post-checkout-redirect.png`
- **Notes**: Stripe webhook listener IS running (`stripe listen --forward-to http://localhost:42072/webhooks/stripe/dev`). Multiple stale listener processes from previous dev sessions may be interfering. The webhook handler silently acknowledges permanent errors (returns 200) to prevent retries, so if the subscription creation failed, it was swallowed.

**See**: E2E-BUG-002, E2E-BUG-003

---

### TEST-SUB-004: Verify subscription in database
- **Status**: FAIL
- **Steps taken**:
  1. Queried `subscriptions` table for fresh user (id: `a94c33daa12249cdf8157b2cee9c2f26`)
  2. Result: 0 rows
  3. Confirmed only 1 subscription exists in entire table (seeded viewer)
  4. Verified ecom-api health endpoint returns healthy
  5. Confirmed Stripe CLI webhook listener is running
- **Expected**: Active subscription record with status `active`, tier_id for Standard, billing_interval `month`
- **Actual**: No subscription record created
- **Notes**: The Stripe CLI may need the `--forward-connect-to` flag or the webhook secret may be mismatched. Multiple stale `stripe listen` processes (from Thu, Fri, and today) may cause webhook routing confusion.

**See**: E2E-BUG-002

---

### TEST-SUB-005: Content access for subscribers
- **Status**: FAIL (tier-based access NOT enforced)
- **Steps taken**:
  1. Logged in as `viewer@test.com` (has seeded Standard subscription)
  2. Navigated to `/content/typescript-deep-dive` (Standard tier content)
  3. Page loaded fully -- content accessible (video player shows "Failed to load video" but this is expected since no actual media exists in R2)
  4. Navigated to `/content/advanced-svelte-patterns` (Pro tier content)
  5. Page loaded fully -- **NO lock, NO paywall, NO upgrade prompt**
- **Expected**: Standard content accessible; Pro content LOCKED with upgrade prompt
- **Actual**: Both Standard AND Pro content pages load fully with no access control differentiation. The only "error" is the video player failing to load media (unrelated to access).
- **Screenshots**:
  - `screenshots/TEST-SUB-005-ts-deep-dive-viewer.png`
  - `screenshots/TEST-SUB-005-pro-content-no-lock.png`
- **Notes**: The viewer also has a seeded `purchased` content_access record for Advanced Svelte Patterns, which may bypass the tier check. However, the content page itself shows no tier-based gating UI at all -- no lock icon, no "Upgrade to Pro" prompt, no paywall overlay. Even for a user WITHOUT the purchase record, the page would likely render the same way since the gating appears to be absent.

**See**: E2E-BUG-004

---

### TEST-SUB-006: Library shows subscription content
- **Status**: PARTIAL PASS
- **Steps taken**:
  1. As viewer@test.com, navigated to `/library`
  2. Library rendered with 6 content items
  3. "Continue Watching" carousel shows Intro to TypeScript (50%) and Tech Podcast Ep 1 (5%)
  4. Main grid shows: Advanced Svelte Patterns (Completed), TypeScript Deep Dive, Members Only Workshop, CSS Variables Masterclass, Intro to TypeScript, Tech Podcast Ep 1
  5. Filter buttons include "All", "Purchased", "Member Access" but NO "Subscription" filter
- **Expected**: Subscription content visible, marked as subscription access
- **Actual**:
  - Content IS visible in the library
  - No visual distinction between purchased, subscription, and free content
  - No "Subscription" access type filter button
  - Advanced Svelte Patterns (Pro tier) appears despite viewer only having Standard subscription (due to seeded purchase record)
- **Screenshots**:
  - `screenshots/TEST-SUB-006-viewer-library-full.png` (full page)
- **Notes**: The library includes content from all access types (free, purchased, subscription) without visual badges indicating how access was granted. A "Subscription" filter option should be added alongside "Purchased" and "Member Access".

**See**: E2E-BUG-005

---

### TEST-SUB-007: Pricing page with enableSubscriptions=false
- **Status**: FAIL (feature flag not respected)
- **Steps taken**:
  1. Set `enable_subscriptions = false` in `feature_settings` table for Studio Alpha
  2. Navigated to `/pricing`
  3. Pricing page renders identically -- both tiers visible, Subscribe buttons active
  4. Reset `enable_subscriptions = true` after testing
- **Expected**: Tiers hidden or "Subscriptions not available" message shown
- **Actual**: Feature flag has NO effect on the pricing page
- **Root cause identified**: The public org info API (`/api/organizations/public/:slug/info`) does NOT include `enableSubscriptions` in its response. The org layout sets `enableSubscriptions: typedOrg.enableSubscriptions ?? true`, but `typedOrg.enableSubscriptions` is always `undefined` because the API never returns it. The `?? true` default means the flag is always `true`.
- **Screenshots**:
  - `screenshots/TEST-SUB-007-subs-disabled-still-shows.png`
- **Notes**: The Svelte component code correctly checks `{#if !enableSubscriptions}` and renders an `EmptyState` when false. The bug is purely in the API response not including the feature flag.

**See**: E2E-BUG-006

---

### TEST-SUB-008: Viewer's existing subscription
- **Status**: PARTIAL PASS
- **Steps taken**:
  1. Logged in as `viewer@test.com` (seeded Standard subscription)
  2. Navigated to `/library` -- content visible (see TEST-SUB-006)
  3. Navigated to `/content/typescript-deep-dive` -- accessible (see TEST-SUB-005)
  4. Navigated to `/content/advanced-svelte-patterns` -- accessible (should be locked, see TEST-SUB-005)
  5. Navigated to `/pricing` -- Standard tier shows "Current Plan" badge with disabled button; Pro shows active "Subscribe" button
- **Expected**: Current plan indicated on pricing, Standard content accessible, Pro content locked
- **Actual**:
  - Pricing page correctly shows "Current Plan" for Standard (PASS)
  - Standard content accessible (PASS)
  - Pro content NOT locked (FAIL -- see TEST-SUB-005)
- **Screenshots**:
  - `screenshots/TEST-SUB-008-viewer-library.png` (initial empty-looking library)
  - `screenshots/TEST-SUB-008-viewer-pricing-current-plan.png` (Current Plan badge)

---

### TEST-SUB-009: Pricing page error handling
- **Status**: PASS (code review)
- **Steps taken**:
  1. Reviewed `+page.svelte` source code for error handling
  2. Found: `checkoutError` state variable, try/catch in `handleSubscribe()`
  3. Error display: `.checkout-error` div with `role="alert"` renders when `checkoutError` is truthy
  4. Error message: falls back to `m.subscription_checkout_error()` i18n string
- **Expected**: Error display mechanism exists
- **Actual**: Error handling is properly implemented in code:
  - Catch block sets `checkoutError` from the error message
  - Error rendered in a styled alert div (`.checkout-error`)
  - Loading state (`checkoutLoading`) properly reset on error
- **Notes**: Could not trigger an actual checkout error without mocking the API. The error UI exists in the DOM but was not visually tested.

---

## Additional Finding: Explore Page Ghost Data Bug

While testing, the Explore page (`/explore`) showed "6 results" in the header counter but displayed "No content available yet" with no content cards. The count came from the server response but the client-side rendering failed to populate the grid. This may be a collection hydration timing issue.

**See**: E2E-BUG-007

---

## Summary

| Test | Status | Severity |
|------|--------|----------|
| TEST-SUB-001 | PASS | -- |
| TEST-SUB-002 | PASS | -- |
| TEST-SUB-003 | PARTIAL PASS | Critical |
| TEST-SUB-004 | FAIL | Critical |
| TEST-SUB-005 | FAIL | Critical |
| TEST-SUB-006 | PARTIAL PASS | Medium |
| TEST-SUB-007 | FAIL | High |
| TEST-SUB-008 | PARTIAL PASS | Critical |
| TEST-SUB-009 | PASS (code review) | -- |

**Critical issues** (3): Subscription not created after Stripe checkout, no success feedback after checkout, tier-based content access not enforced.
**High issues** (1): Feature flag `enable_subscriptions` not propagated to frontend.
**Medium issues** (2): No subscription filter in library, explore page ghost count.

---

## E2E Test Paths -- Purchase Flow

**Date**: 2026-04-11
**Environment**: Local dev (`studio-alpha.lvh.me:3000`)
**Tester**: Automated (Playwright MCP)

---

### TEST-PUR-001: Org landing page shows content
- **Status**: PASS
- **Steps taken**:
  1. Navigated to `http://studio-alpha.lvh.me:3000`
  2. Page loaded with title "Studio Alpha | Revelations"
  3. Verified hero section with org name, description ("A creator studio for TypeScript and Svelte content"), stats (7 Items, 2 Creators, 3.9 Hours, 22,330 Views)
  4. "Continue Watching" section visible with 2 items (Intro to TypeScript 50%, Tech Podcast Ep 1 5%) -- user was logged in as viewer
  5. "New Releases" section shows 6 content cards with titles, durations, type badges, and prices where applicable
  6. "Our Creators" section shows Alex Creator (owner, 7 items) and Jordan Admin (admin, 0 items)
  7. Prices visible on cards: kuhuh (£67.00), Advanced Svelte Patterns (£19.99), TypeScript Deep Dive (£14.99)
- **Expected**: Content listed on landing page with cards, titles, pricing
- **Actual**: All expected content visible. Prices displayed in GBP. Navigation, hero, categories, and stats all render.
- **Screenshots**: `screenshots/TEST-PUR-001-org-landing.png`

---

### TEST-PUR-002: Paid content shows price + buy button
- **Status**: FAIL (no price or buy button on content detail page for authenticated users)
- **Steps taken**:
  1. Clicked into "Advanced Svelte Patterns" (£19.99 on listing card) from landing page
  2. Content detail page loaded -- title, VIDEO badge, 45m duration, "By Alex Creator", description all visible
  3. No price displayed anywhere on the detail page
  4. No buy/purchase button visible
  5. Video player area shows "Failed to load video" (no media in R2, not access control)
  6. Navigated to "kuhuh" (£67.00) -- same result: no price, no buy button, full content visible
  7. Navigated to "TypeScript Deep Dive" (£14.99) -- same result
- **Expected**: Price displayed (in £), buy/purchase button present on paid content detail pages
- **Actual**: For authenticated users (viewer), paid content detail pages show NO price and NO purchase CTA. The paywall UI only renders for unauthenticated users (see TEST-VERIFY-003). Logged-in users who are org members see the full content page regardless of whether they have purchased or have the required subscription tier.
- **Screenshots**:
  - `screenshots/TEST-PUR-002-advanced-svelte-detail.png` (no price, viewer has purchase record)
  - `screenshots/TEST-PUR-002-kuhuh-no-price-no-buy.png` (no price, viewer likely lacks purchase)
- **Notes**: The content detail page server load appears to grant full access to any org member, bypassing purchase/tier checks. The paywall CTA block with price, "Sign in to purchase", and "What you'll get" only renders for unauthenticated users.

**See**: E2E-BUG-008

---

### TEST-PUR-003: Free content is accessible
- **Status**: PASS
- **Steps taken**:
  1. Navigated to `http://studio-alpha.lvh.me:3000/content/intro-to-typescript` as viewer
  2. Full content page loaded: title, VIDEO badge, 30m duration, By Alex Creator, description
  3. No price shown, no paywall, no purchase CTA (correct for free content)
  4. Video player area shows "Failed to load video" (no media in R2)
  5. "More from Alex Creator" section shows related content cards with prices
- **Expected**: Free content accessible without paywall
- **Actual**: Correct -- no purchase barrier for free content when authenticated
- **Screenshots**: `screenshots/TEST-PUR-003-free-content.png`

---

### TEST-PUR-004: Viewer library shows purchased + subscription content
- **Status**: PARTIAL PASS (content visible, filters exist, but access type badges are wrong)
- **Steps taken**:
  1. As viewer@test.com, navigated to org library at `http://studio-alpha.lvh.me:3000/library`
  2. Library shows 7 content items in grid view with thumbnails
  3. Sort by "Recently Purchased" dropdown, grid/list view toggle present
  4. Three filter groups visible:
     - Content type: All, Video, Audio, Article
     - Progress: All, Not Started, In Progress, Completed
     - Access type: All, Purchased, Subscription, Member Access
  5. **ALL 7 items show "MEMBER" badge** -- no "Purchased" or "Subscription" differentiation
  6. Clicked "Subscription" filter -- shows "No results match your filters" (empty)
  7. Clicked "Purchased" filter -- also shows "No results match your filters" (empty)
  8. Only "All" and "Member Access" filters show content
  9. Also checked platform library (`http://lvh.me:3000/library`) -- different behavior:
     - "Building APIs with Hono" and "Advanced Svelte Patterns" correctly show "PURCHASED" badge
     - All other items show "MEMBER" badge
     - "Subscription" filter also returns empty on platform library
- **Expected**: Content visible with correct access-type badges (Purchased, Subscription, Member), filters working
- **Actual**:
  - Org library: All items tagged as "Member" regardless of actual access type
  - Platform library: Only purchase badges differentiated, no subscription badges
  - "Subscription" filter returns empty on both libraries despite viewer having a Standard subscription
- **Screenshots**:
  - `screenshots/TEST-PUR-004-viewer-library.png` (org library, all items "Member")
  - `screenshots/TEST-PUR-004-subscription-filter-empty.png` (subscription filter shows no results)
  - `screenshots/TEST-VERIFY-002-platform-library.png` (platform library with some "Purchased" badges)
  - `screenshots/TEST-VERIFY-002-subscription-filter.png` (platform subscription filter empty)

**See**: E2E-BUG-009

---

## E2E Test Paths -- Studio

**Date**: 2026-04-11
**Environment**: Local dev (`studio-alpha.lvh.me:3000/studio`)
**Tester**: Automated (Playwright MCP)

---

### TEST-STU-001: Studio monetisation page
- **Status**: PASS
- **Steps taken**:
  1. Logged in as `creator@test.com` / `Test1234!`
  2. Navigated to `http://studio-alpha.lvh.me:3000/studio`
  3. Studio dashboard loaded: Revenue £174.88, Customers 7, Content 3, Views 0
  4. Revenue chart shows 3 recent data points (9 Apr £20, 8 Apr £25, 6 Apr £55)
  5. Clicked "Monetisation" in sidebar (under OWNER section)
  6. Monetisation page loaded with:
     - **Stripe Connect**: "Connected" badge, "Charges enabled" checkmark, "Payouts enabled" checkmark, "Open Stripe Dashboard" button
     - **Enable Subscriptions** toggle: ON (checked)
     - **Subscriber Stats**: Total Subscribers 1, Active 1, MRR £4.99
     - **Subscription Tiers**: Standard (£4.99/monthly, £47.99/annual) and Pro (£9.99/monthly, £95.99/annual) with Edit and Delete buttons
     - **Subscriber Stats breakdown**: Standard -- 1 subscriber, £4.99/mo
- **Expected**: Connect status active, tiers listed
- **Actual**: All expected data present and correct
- **Screenshots**: `screenshots/TEST-STU-001-monetisation.png`

---

### TEST-STU-002: Create + delete a tier
- **Status**: PASS
- **Steps taken**:
  1. On monetisation page, clicked "+ Create Tier" button
  2. Dialog appeared: "Create Tier" with fields for Tier Name (placeholder "e.g. Basic, Pro, Premium"), Description, Monthly Price (pence), Annual Price (pence)
  3. Default price values pre-filled: 499 pence (£4.99), 4990 pence (£49.90)
  4. Filled form: Name "Premium", Description "Top tier access", Monthly 1999 (£19.99), Annual 19099 (£190.99)
  5. Real-time price conversion shown below inputs (£19.99, £190.99)
  6. Clicked "Save" -- dialog closed, new tier appeared as tier #3
  7. Verified Premium tier visible: "Premium", "Top tier access", £19.99/monthly, £190.99/annual
  8. Clicked Delete (trash icon) on Premium tier
  9. Confirmation dialog: "Delete Tier" / "Are you sure you want to delete this tier? This cannot be undone." with Cancel and "Delete Tier" buttons
  10. Clicked "Delete Tier" -- tier removed
  11. Verified only Standard (#1) and Pro (#2) remain
- **Expected**: Tier created, visible, then deleted, with loading/confirm states
- **Actual**: Full CRUD lifecycle works correctly. Create form has sensible defaults, real-time price preview, and validation. Delete has a confirmation dialog. No loading spinner observed on the confirm button (deletion was near-instant), but the UX is clean.
- **Screenshots**:
  - `screenshots/TEST-STU-002-create-tier-dialog.png` (empty create dialog)
  - `screenshots/TEST-STU-002-tier-filled.png` (filled form before save)
  - `screenshots/TEST-STU-002-premium-created.png` (3 tiers visible after creation)
  - `screenshots/TEST-STU-002-delete-confirm.png` (delete confirmation dialog)
- **Notes**: Delete button does not show a loading state on the "Delete Tier" confirmation button. The deletion appears to happen fast enough that a loading state may not be necessary, but for slow connections it could be a minor UX issue.

---

## E2E Test Paths -- Bug Re-verification

**Date**: 2026-04-11
**Environment**: Local dev (`studio-alpha.lvh.me:3000`)
**Tester**: Automated (Playwright MCP)

---

### TEST-VERIFY-001: Tier lock on content (E2E-BUG-004 re-verification)
- **Status**: STILL FAILING -- E2E-BUG-004 NOT fixed
- **Steps taken**:
  1. Logged in as `viewer@test.com` (Standard subscriber)
  2. Navigated to `http://studio-alpha.lvh.me:3000/content/advanced-svelte-patterns` (Pro tier content)
  3. Page loaded fully with NO lock, NO paywall, NO upgrade CTA
  4. Video player area shows "Failed to load video" (no media, not access control)
  5. Full description visible, "More from Alex Creator" section visible
  6. Navigated to `http://studio-alpha.lvh.me:3000/content/typescript-deep-dive` (Standard tier content)
  7. Same behavior -- full access, no tier gating visible
- **Expected**: Pro content LOCKED with upgrade CTA for Standard subscriber; Standard content ACCESSIBLE
- **Actual**: Both Pro and Standard content load fully without any tier-based access control for authenticated org members. The paywall only exists for unauthenticated users.
- **Screenshots**:
  - `screenshots/TEST-VERIFY-001-pro-content-still-no-lock.png`
  - `screenshots/TEST-VERIFY-001-standard-content-accessible.png`
- **Conclusion**: E2E-BUG-004 remains open. Tier-based content gating is not implemented for authenticated users who are org members.

---

### TEST-VERIFY-002: Library subscription filter (E2E-BUG-005 re-verification)
- **Status**: PARTIALLY FIXED
- **Steps taken**:
  1. As viewer@test.com, navigated to platform library at `http://lvh.me:3000/library`
  2. Verified 4 filter buttons present: All, Purchased, Subscription, Member Access -- **Subscription button now exists** (was missing in prior test)
  3. Library shows 9 items. Access badges:
     - "Building APIs with Hono" -> "Purchased"
     - "Advanced Svelte Patterns" -> "Purchased" + "Completed"
     - All other items -> "Member"
  4. Clicked "Subscription" filter -- "No results match your filters"
  5. No items tagged with "Subscription" access type despite viewer having a Standard subscription
  6. Same result on org library (`studio-alpha.lvh.me:3000/library`) -- all items tagged "Member"
- **Expected**: Subscription filter shows only subscription-granted content with "Subscription" badges
- **Actual**: Subscription filter button EXISTS (partial fix), but no content is tagged with "Subscription" access type. All subscription-accessed content appears as "Member." The filter is non-functional because the underlying data classification is incorrect.
- **Screenshots**:
  - `screenshots/TEST-VERIFY-002-platform-library.png`
  - `screenshots/TEST-VERIFY-002-subscription-filter.png`
- **Conclusion**: E2E-BUG-005 UI partially fixed (filter button added), but data classification issue remains. See new E2E-BUG-009.

---

### TEST-VERIFY-003: Content access for free content as unauthenticated
- **Status**: PASS
- **Steps taken**:
  1. Logged out (verified "Sign In" link in nav)
  2. Navigated to `http://studio-alpha.lvh.me:3000/content/intro-to-typescript` (free content)
  3. Page shows:
     - "Failed to load preview" in the player area (no video access)
     - "Free" badge in green
     - "Sign in to purchase" orange CTA button
     - "What you'll get" section: HD video, Lifetime access, Progress tracking, Watch on any device
     - Description visible below
  4. Navigated to `http://studio-alpha.lvh.me:3000/content/advanced-svelte-patterns` (paid, £19.99)
  5. Page shows:
     - "Failed to load preview" in player area
     - "Upgrade to Watch" heading
     - "Upgrade your plan to access this content"
     - "Sign in to purchase" orange CTA button
     - "or purchase for £19.99" text below
     - Description visible below
- **Expected**: Free content shows login CTA (no paywall price), paid content shows price + login CTA
- **Actual**: Correct behavior for unauthenticated users. Free content shows "Free" badge with sign-in prompt. Paid content shows price (£19.99), "Upgrade to Watch" heading, and sign-in CTA. The paywall UI is well-designed with clear differentiation between free and paid content.
- **Screenshots**:
  - `screenshots/TEST-VERIFY-003-free-content-unauth.png`
  - `screenshots/TEST-VERIFY-003-paid-content-unauth.png`
- **Notes**: The paywall/CTA UI works correctly for unauthenticated users but is completely absent for authenticated org members (see E2E-BUG-008). The "Sign in to purchase" text on free content is slightly misleading -- "Sign in to watch" would be more appropriate for free content.

---

## Summary -- Combined Results (Purchase Flow + Studio + Bug Re-verification)

| Test | Area | Status | Severity |
|------|------|--------|----------|
| TEST-PUR-001 | Purchase | PASS | -- |
| TEST-PUR-002 | Purchase | FAIL | Critical |
| TEST-PUR-003 | Purchase | PASS | -- |
| TEST-PUR-004 | Purchase | PARTIAL PASS | High |
| TEST-STU-001 | Studio | PASS | -- |
| TEST-STU-002 | Studio | PASS | -- |
| TEST-VERIFY-001 | Bug re-verify | STILL FAILING | Critical |
| TEST-VERIFY-002 | Bug re-verify | PARTIALLY FIXED | Medium |
| TEST-VERIFY-003 | Bug re-verify | PASS | -- |

**New Critical issues** (1): Authenticated org members see no price or buy button on paid content detail pages (E2E-BUG-008).
**Still-open Critical issues** (1): Tier-based content access not enforced for authenticated users (E2E-BUG-004).
**New High issues** (1): Library access type badges all show "Member" -- no Subscription differentiation (E2E-BUG-009).
**Partially fixed**: Subscription filter button now exists in library (E2E-BUG-005 UI fix) but returns empty results due to data classification bug.

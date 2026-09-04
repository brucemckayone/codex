# E2E Bugs Found -- Subscription & Access Flows

**Date**: 2026-04-11 (initial), 2026-04-11 (final re-verification), 2026-04-10 (post-fix re-verification), 2026-04-11 (full journey test)
**Total bugs**: 12 (BUG-011 fixed during test, BUG-010 partially resolved for new users, BUG-012 = repeat of BUG-003)

---

### E2E-BUG-001: Missing shader renderer files cause Vite build error blocking all org pages
- **Severity**: Critical (site-breaking)
- **Test**: Pre-test blocker (affects ALL tests)
- **Steps to reproduce**:
  1. Start dev server (`pnpm dev`)
  2. Navigate to any page on an org subdomain (e.g. `http://studio-alpha.lvh.me:3000/pricing`)
  3. Observe Vite error overlay
- **Expected**: Page renders normally
- **Actual**: Vite error: `Failed to resolve import "./renderers/turing-renderer" from "src/lib/components/ui/ShaderHero/ShaderHero.svelte". Does the file exist?`
- **Root cause**: `ShaderHero.svelte` has a switch statement with dynamic imports for 14 shader presets, but only 8 renderer files exist. Missing: `turing-renderer.ts`, `silk-renderer.ts`, `glass-renderer.ts`, `film-renderer.ts`, `flux-renderer.ts`, `lava-renderer.ts`. Vite's import analysis plugin resolves all dynamic import paths at compile time.
- **Screenshot**: `screenshots/TEST-SUB-001-vite-error.png`
- **Workaround applied**: Created stub (no-op) renderer files that satisfy the `ShaderRenderer` interface.
- **Suggested fix**: Either implement the remaining renderers or remove the unreferenced cases from the switch statement. The stubs are at `apps/web/src/lib/components/ui/ShaderHero/renderers/{turing,silk,glass,film,flux,lava}-renderer.ts`.

---

### E2E-BUG-002: Stripe subscription webhook does not create subscription record in database
- **Severity**: Critical
- **Test**: TEST-SUB-003, TEST-SUB-004
- **Steps to reproduce**:
  1. Log in as `fresh@test.com`
  2. Go to `/pricing`, click Subscribe on Standard (monthly)
  3. Complete Stripe Checkout with test card 4242424242424242
  4. After redirect, check DB: `SELECT * FROM subscriptions WHERE user_id = 'a94c33daa12249cdf8157b2cee9c2f26'`
- **Expected**: Subscription record created with `status = 'active'`, `tier_id` = Standard tier ID
- **Actual**: 0 rows in subscriptions table. Only the seeded viewer subscription exists (1 total row).
- **Root cause candidates**:
  1. Multiple stale `stripe listen` processes running simultaneously (7+ processes from different days), possibly causing webhook routing conflicts
  2. The webhook handler at `workers/ecom-api/src/utils/webhook-handler.ts` silently acknowledges permanent errors with HTTP 200 (line 81), which means Stripe won't retry failed processing
  3. The webhook secret (`STRIPE_WEBHOOK_SECRET`) may not match between the Stripe CLI and the worker environment
- **Suggested fix**:
  1. Kill all stale `stripe listen` processes and restart a single instance
  2. Add webhook event logging (even a simple DB table) to track received vs processed events
  3. Consider returning 500 for non-transient processing failures to allow Stripe retries
  4. Add a `/webhooks/stripe/dev/test` diagnostic endpoint that logs the last N received events

---

### E2E-BUG-003: No success feedback after subscription checkout redirect
- **Severity**: High
- **Test**: TEST-SUB-003
- **Steps to reproduce**:
  1. Complete a subscription checkout (any tier)
  2. After Stripe redirects back to the app at `/library?subscription=success`
  3. Observe the page
- **Expected**: A toast notification, success banner, or celebratory message acknowledging the subscription was created
- **Actual**: Plain library page with no indication that anything happened. The `?subscription=success` query parameter is in the URL but nothing reads it.
- **Screenshot**: `screenshots/TEST-SUB-003-post-checkout-redirect.png`
- **Suggested fix**: In the library page's `+page.svelte` or `+page.server.ts`, check for `subscription=success` query parameter and display a toast or inline success message (e.g. "Welcome! Your Standard subscription is now active."). Consider also auto-scrolling to subscription content or showing a confetti animation for first-time subscribers.

---

### E2E-BUG-004: Tier-based content access not enforced on content detail page
- **Severity**: Critical
- **Test**: TEST-SUB-005
- **Steps to reproduce**:
  1. Log in as `viewer@test.com` (has Standard subscription, NOT Pro)
  2. Navigate to `/content/advanced-svelte-patterns` (requires Pro tier, `minimum_tier_id` = Pro)
  3. Observe the page
- **Expected**: Content page shows a lock/paywall overlay or "Upgrade to Pro" prompt. Video player should NOT attempt to load. User should see what the content is about but not access the media.
- **Actual**: Full content page loads with no lock indicator. Video player attempts to load (fails due to no R2 media, not due to access control). Title, description, duration, and "More from" section all visible.
- **Screenshot**: `screenshots/TEST-SUB-005-pro-content-no-lock.png`
- **Notes**: The content detail page at `_org/[slug]/(space)/content/[contentSlug]/+page.svelte` does have some subscription-related code (lines 45-56 reference `enableSubscriptions`), but it appears the actual tier comparison (user's subscription tier vs content's `minimum_tier_id`) is not implemented or not blocking the page render.
- **Suggested fix**:
  1. In the content detail `+page.server.ts`, compare the user's subscription tier level against the content's `minimum_tier_id` tier level
  2. Pass an `accessGranted: boolean` flag to the page
  3. When `accessGranted === false`, render a paywall overlay with the tier name and an "Upgrade" CTA linking to `/pricing`
  4. Ensure the streaming URL endpoint also enforces tier checks server-side (defense in depth)
- **Re-verified 2026-04-11 (final)**: Partially resolved. The subscription context logic in `content-detail.ts` (lines 108-120) correctly compares tier sortOrder. However, viewer@test.com also has a direct PURCHASE of the Pro content, so tier-only lockout cannot be tested in isolation with current seed data. The paywall rendering for members WITHOUT subscription (emma@test.com) works correctly -- they see "Subscribe to Watch" + "Purchase for £19.99" CTA. The core tier comparison code appears correct; the original bug report may have been observing purchase-override behavior.

---

### E2E-BUG-005: Library has no "Subscription" access type filter
- **Severity**: Medium
- **Test**: TEST-SUB-006
- **Steps to reproduce**:
  1. Log in as `viewer@test.com`
  2. Navigate to `/library`
  3. Look at the access type filter buttons
- **Expected**: Filter options include "All", "Purchased", "Subscription", "Member Access"
- **Actual**: Filter options are "All", "Purchased", "Member Access" -- no "Subscription" option
- **Screenshot**: `screenshots/TEST-SUB-006-viewer-library-full.png`
- **Notes**: Additionally, library items have no visual badge or indicator showing HOW access was granted (purchased vs subscription vs free vs complimentary). Users cannot distinguish between content they bought outright and content included in their subscription.
- **Suggested fix**:
  1. Add a "Subscription" filter button alongside the existing access type filters
  2. Add small access-type badges to library cards (e.g., "Subscribed" tag for subscription content, "Purchased" for bought content)

---

### E2E-BUG-006: Feature flag `enable_subscriptions` not propagated from API to frontend
- **Severity**: High
- **Test**: TEST-SUB-007
- **Steps to reproduce**:
  1. `psql -c "UPDATE feature_settings SET enable_subscriptions = false WHERE organization_id = 'f9965f78-f562-4852-bdfd-a1c12f109ddb'"`
  2. Navigate to `http://studio-alpha.lvh.me:3000/pricing`
  3. Observe that subscription tiers are still visible and Subscribe buttons are active
  4. Reset: `UPDATE feature_settings SET enable_subscriptions = true ...`
- **Expected**: When `enable_subscriptions = false`, the pricing page should show an EmptyState ("Subscriptions are not available") and the Pricing nav link should be hidden
- **Actual**: Feature flag has no effect. Pricing page renders identically.
- **Root cause**: The public org info API endpoint (`GET /api/organizations/public/:slug/info`) does NOT include `enableSubscriptions` in its response. The org layout at `_org/[slug]/+layout.server.ts` line 79 sets `enableSubscriptions: typedOrg.enableSubscriptions ?? true`, but `typedOrg.enableSubscriptions` is always `undefined`, so the `?? true` fallback means the flag is perpetually `true`.
- **Screenshot**: `screenshots/TEST-SUB-007-subs-disabled-still-shows.png`
- **Suggested fix**:
  1. Add `enableSubscriptions` (from `feature_settings.enable_subscriptions`) to the public org info API response in the organization-api worker
  2. Verify the org layout correctly reads and passes it to child routes
  3. Also hide the "Pricing" nav link when subscriptions are disabled (check `navigation.ts` config)
  4. Also gate the checkout endpoint -- return 403 when `enable_subscriptions = false` to prevent API-level bypass
- **Re-verified 2026-04-11 (final)**: Still broken in TEST-FINAL-008. Disabling `enable_subscriptions` in DB has zero effect on pricing page rendering.

---

### E2E-BUG-007: Explore page shows "6 results" count but "No content available yet" message
- **Severity**: Medium
- **Test**: Discovered during TEST-SUB-005
- **Steps to reproduce**:
  1. Log in as `viewer@test.com`
  2. Navigate to `http://studio-alpha.lvh.me:3000/explore`
  3. Observe the result count and content grid
- **Expected**: "6 results" header AND 6 content cards displayed in the grid
- **Actual**: Header says "6 results" but the grid area shows "No content available yet. This organization hasn't published any content yet."
- **Screenshot**: `screenshots/TEST-SUB-005-explore-empty-bug.png`
- **Notes**: The count likely comes from the SSR server data, while the content grid relies on client-side collection hydration that may be failing. The empty state check (`items.length === 0`) may be evaluating before the collection is hydrated with SSR data.
- **Suggested fix**: Ensure the "6 results" count and the content grid both read from the same data source, or ensure the empty state check accounts for the SSR hydration lifecycle.

---

### E2E-BUG-008: Authenticated org members see no price or buy button on paid content detail pages
- **Severity**: Critical
- **Test**: TEST-PUR-002
- **Steps to reproduce**:
  1. Log in as `viewer@test.com` (org member with Standard subscription)
  2. Navigate to `http://studio-alpha.lvh.me:3000/content/kuhuh` (£67.00 paid content the user has NOT purchased)
  3. Observe the content detail page
- **Expected**: The page should show the price (£67.00), a "Purchase" or "Buy" button, and potentially restrict video access until purchased. Content that the user has not purchased should show a purchase CTA.
- **Actual**: The full content page renders with no price, no purchase button, and no paywall. The video player area shows "Failed to load video" only because no media exists in R2, not due to access control. The same behavior occurs for all paid content (kuhuh £67.00, Advanced Svelte Patterns £19.99, TypeScript Deep Dive £14.99). Prices are only visible on listing cards (explore, landing page), never on the detail page for authenticated users.
- **Screenshots**:
  - `screenshots/TEST-PUR-002-kuhuh-no-price-no-buy.png`
  - `screenshots/TEST-PUR-002-advanced-svelte-detail.png`
- **Root cause**: The content detail page (`_org/[slug]/(space)/content/[contentSlug]/+page.svelte`) has a paywall CTA block that only renders for unauthenticated users. For authenticated org members, the server load grants full access regardless of purchase status or tier level. The paywall condition likely checks `user === null` rather than `hasAccess === false`.
- **Suggested fix**:
  1. In the content detail `+page.server.ts`, check if the authenticated user has purchased this specific content OR has a sufficient subscription tier
  2. Pass `hasAccess: boolean` and `price: number | null` to the page component
  3. When `hasAccess === false`, render the paywall CTA with price and purchase button (same style as unauthenticated view but with a "Buy for £X" button instead of "Sign in to purchase")
  4. Ensure the streaming URL endpoint also enforces access checks server-side

---

### E2E-BUG-009: Library access type badges always show "Member" -- no Subscription or Purchased differentiation in org library
- **Severity**: High
- **Test**: TEST-PUR-004, TEST-VERIFY-002
- **Steps to reproduce**:
  1. Log in as `viewer@test.com` (Standard subscriber with purchase records)
  2. Navigate to org library at `http://studio-alpha.lvh.me:3000/library`
  3. Observe the access type badges on content cards
  4. Click the "Subscription" filter button
  5. Click the "Purchased" filter button
- **Expected**: Content cards should show differentiated badges:
  - "Purchased" for content bought outright (e.g., Advanced Svelte Patterns)
  - "Subscription" for content accessible via subscription tier
  - "Member" for free/member-access content
  And the Subscription and Purchased filters should return matching items.
- **Actual**:
  - **Org library** (`studio-alpha.lvh.me:3000/library`): ALL items show "MEMBER" badge regardless of how access was granted. Both "Subscription" and "Purchased" filters return zero results.
  - **Platform library** (`lvh.me:3000/library`): "Building APIs with Hono" and "Advanced Svelte Patterns" correctly show "PURCHASED" badges. All other items show "MEMBER". "Subscription" filter still returns zero results.
  - The discrepancy between org library (all Member) and platform library (some Purchased) suggests the org library endpoint returns different or missing access type data.
- **Screenshots**:
  - `screenshots/TEST-PUR-004-viewer-library.png` (org library, all Member)
  - `screenshots/TEST-PUR-004-subscription-filter-empty.png`
  - `screenshots/TEST-VERIFY-002-platform-library.png` (platform library, some Purchased)
  - `screenshots/TEST-VERIFY-002-subscription-filter.png`
- **Root cause candidates**:
  1. The org library API endpoint may not return `accessType` or may default all items to "member"
  2. The subscription access grant may not be setting the `accessType` field to "subscription" in the `content_access` table
  3. The library frontend may be falling back to "member" when `accessType` is null/undefined
- **Suggested fix**:
  1. Verify `content_access` table: check `access_type` column values for the viewer's records (are any set to "subscription"?)
  2. Ensure the subscription webhook/grant flow sets `access_type = 'subscription'` when granting access
  3. Ensure the org library API endpoint includes `accessType` in its response
  4. Ensure the library component reads and displays the correct `accessType` from the data rather than defaulting to "member"
- **Re-verified 2026-04-11 (final)**: Still broken in TEST-FINAL-005. Viewer's org library shows ALL items as "MEMBER". The "Subscription" filter returns zero results. The platform library at `lvh.me:3000/library` does show "Purchased" badges correctly for some items (confirmed in prior audit), but org library does not. Emma Wilson's org library correctly shows "PURCHASED" badge for TypeScript Deep Dive, suggesting the bug is specific to subscription-granted access not being reflected in the accessType field.
- **Re-verified 2026-04-10 (post-fix)**: Still broken. All items show "MEMBER" on first SSR load. After TanStack DB hydration, "PURCHASED" badge appears for purchased content. No "SUBSCRIBED" badge ever appears. Both "Subscription" and "Purchased" filters return empty results. Root cause: library API does not include `accessType` differentiation in its response.
- **Re-verified 2026-04-11 (full journey test)**: PARTIALLY FIXED. Fresh user's org library now shows correct differentiated badges: "SUBSCRIBED" for TypeScript Deep Dive, "MEMBER" for free/member content. Platform library also correct. "Subscription" filter correctly returns only the subscribed content (TypeScript Deep Dive). The fix appears to be working for new subscription grants but may have required the manual DB insert to set the correct access_type. Need to verify webhook handler sets access_type correctly when processing real events.

---

### E2E-BUG-010: Subscribers can access paid content without purchasing
- **Severity**: Critical
- **Test**: TEST-REVERIFY-001 (discovered during post-fix re-verification)
- **Date**: 2026-04-10
- **Steps to reproduce**:
  1. Log in as `viewer@test.com` (Standard subscriber, has purchases of "Advanced Svelte Patterns" and "Building APIs with Hono" only)
  2. Navigate to `http://studio-alpha.lvh.me:3000/content/css-variables-masterclass`
  3. Observe the content detail page
- **Expected**: Page should show paywall with "Purchase for 4.99" button. Viewer has no purchase of this content. Having a subscription should not grant access to `access_type = 'paid'` content.
- **Actual**: Full access granted. Video player attempts to load (dev error). No price shown, no purchase button, no paywall. The content is fully accessible as if purchased.
- **Cross-reference**: Emma Wilson (member, no subscription) correctly sees paywall with "Purchase for 4.99" for the same content. This confirms:
  - The frontend paywall rendering is correct
  - The bug is in the **backend access control service** (`getStreamingUrl` / `ContentAccessService`)
  - The access check incorrectly grants access when the user has any active subscription, even for content with `access_type = 'paid'` that requires a separate purchase
- **Root cause**: The backend `ContentAccessService.getStreamingUrl()` likely checks for org membership or subscription status but does not distinguish between `access_type = 'paid'` (requires purchase) and `access_type = 'subscribers'` (requires subscription). Any authenticated org member with a subscription gets streaming URLs for all content.
- **Suggested fix**:
  1. In `ContentAccessService.getStreamingUrl()`, check `content.access_type`:
     - `'free'` or `'members'`: grant access to any org member
     - `'paid'`: check `purchases` table for matching `customer_id + content_id` record
     - `'subscribers'`: check subscription tier level against `content.minimum_tier_id`
  2. Return 403 when the user's access grants (membership + subscription + purchases) do not cover the content's access requirements
- **Screenshots**:
  - `reverify-001c-viewer-paid-content-NO-PAYWALL-BUG.png`
  - `reverify-001d-viewer-paid-content-NO-PAYWALL-confirmed.png`
  - `reverify-003a-emma-paid-content-paywall-PASS.png` (correct behaviour for member without subscription)
- **Re-verified 2026-04-11 (full journey test)**: FIXED for fresh@test.com. The fresh user with a Standard subscription correctly sees the purchase paywall for "CSS Variables Masterclass" (paid content, £4.99). The paywall shows price, description, and "Purchase for £4.99" button. Subscription does NOT grant access to paid-only content. This may have been a data issue with viewer@test.com's seed data having broader access grants.

---

### E2E-BUG-011: Webhook signing secret mismatch blocks all local webhook processing
- **Severity**: Critical (blocks local dev checkout flow)
- **Date**: 2026-04-11
- **Test**: Full subscriber journey (STEP 7)
- **Steps to reproduce**:
  1. Start dev services with `pnpm dev` (includes `stripe listen --forward-to http://localhost:42072/webhooks/stripe/dev`)
  2. Complete a Stripe Checkout (subscription or purchase)
  3. Check DB for subscription/purchase records
- **Expected**: Webhook handler processes `checkout.session.completed` event and creates records
- **Actual**: 0 records created. The `stripe listen` CLI signs events with its own secret (e.g. `whsec_2a93...857f`) but `workers/ecom-api/.dev.vars` has production Stripe Dashboard webhook secrets (e.g. `whsec_BhJk...sMQ7`). The `verifyStripeSignature()` middleware rejects all events with HTTP 401 "Invalid signature".
- **Root cause**: `.dev.vars` comments state "set all secrets to the same CLI-generated value" but this was never done. The 6 `STRIPE_WEBHOOK_SECRET_*` values were set to per-endpoint production secrets from the Stripe Dashboard rather than the CLI-generated secret.
- **Fix applied**: Updated all 6 `STRIPE_WEBHOOK_SECRET_*` values in `.dev.vars` to match the `stripe listen --print-secret` output. Original production values preserved in comments.
- **Recommendation**: Add a `pnpm dev:setup-webhooks` script that:
  1. Runs `stripe listen --print-secret`
  2. Auto-updates `.dev.vars` with the CLI secret for all 6 webhook secret env vars
  3. Runs on first `pnpm dev` or as a setup step

---

### E2E-BUG-012: No success toast/banner after subscription checkout redirect
- **Severity**: Medium (UX only, not functional)
- **Date**: 2026-04-11
- **Test**: Full subscriber journey (STEP 6)
- **Steps to reproduce**:
  1. Complete a subscription checkout
  2. Stripe redirects to `http://studio-alpha.lvh.me:3000/library?subscription=success`
  3. Observe the page
- **Expected**: Toast notification, success banner, or celebratory message (e.g. "Welcome! Your Standard subscription is now active.")
- **Actual**: Plain library page. The `?subscription=success` query param is in the URL but nothing reads it. User has no visual confirmation that their subscription was created.
- **Notes**: Same as E2E-BUG-003 from prior audit. Still not addressed.

# Frontend Commerce Flows Audit

## Overview

This audit covers every frontend file involved in the commerce lifecycle: subscription tiers, content access control, one-time purchases, Stripe Connect onboarding, and the post-purchase experience. The codebase implements a dual-commerce model -- one-time content purchases AND subscription tiers with Connect payouts to org owners.

**Files audited:** 35+ files across routes, remote functions, server loads, shared components, types, navigation config, and utility modules.

**Audit date:** 2026-04-10

---

## Customer Subscription Journey

### Step 1: Discover pricing (Org Pricing Page)

**Files:**
- `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.server.ts` (lines 1-39)
- `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte` (lines 1-320)

**Flow:** Customer navigates to `/pricing` on an org subdomain. Server load fetches tiers (public, no auth) and the user's current subscription (if authenticated) in parallel. The page renders tier cards with monthly/annual toggle, savings percentage, and subscribe CTAs.

**Access:** Public page with DYNAMIC_PUBLIC cache for unauthenticated visitors, PRIVATE for authenticated users. Tiers endpoint is public (no auth required).

### Step 2: Trigger checkout

**Files:**
- `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte` (line 36-54, `handleSubscribe`)
- `apps/web/src/lib/remote/subscription.remote.ts` (lines 121-143, `createSubscriptionCheckoutSession`)

**Flow:** Customer clicks "Subscribe" on a tier card. If unauthenticated, redirects to `/login?redirect=/pricing`. If authenticated, calls `createSubscriptionCheckoutSession` command which creates a Stripe Checkout Session via `api.subscription.checkout()` and returns the `sessionUrl`. Client-side redirect via `window.location.href`.

### Step 3: Stripe Checkout (external)

Customer completes payment on Stripe-hosted checkout page.

### Step 4: Return to success page

**Files:**
- `apps/web/src/routes/_org/[slug]/(space)/checkout/success/+page.server.ts` (lines 1-58)
- `apps/web/src/routes/_org/[slug]/(space)/checkout/success/+page.svelte` (lines 1-33)
- `apps/web/src/lib/components/ui/CheckoutSuccess/CheckoutSuccess.svelte` (lines 1-413)

**Flow:** Stripe redirects to `/checkout/success?session_id={ID}&contentSlug={slug}`. Server load verifies the session via `api.checkout.verify()`. The CheckoutSuccess component handles three states: success (animated checkmark + content preview + CTA), pending (spinner + auto-retry every 3s, up to 5 attempts via `invalidate('checkout:verify')`), and fallback (retries exhausted, friendly messaging with library link).

### Step 5: Manage subscription

**Files:**
- `apps/web/src/routes/(platform)/account/subscriptions/+page.server.ts` (lines 1-25)
- `apps/web/src/routes/(platform)/account/subscriptions/+page.svelte` (lines 1-367)

**Flow:** User navigates to `/account/subscriptions` on the platform domain. Server load fetches all active subscriptions via `api.subscription.getMine()`. Page displays subscription cards with org logo, tier name, status badge, price, period end date, and actions (Change Tier, Cancel, Reactivate). Cancel opens a dialog with optional reason textarea.

### Step 6: Access content

**Files:**
- `apps/web/src/routes/_org/[slug]/(space)/content/[contentSlug]/+page.server.ts` (lines 1-143)
- `apps/web/src/routes/_org/[slug]/(space)/content/[contentSlug]/+page.svelte` (lines 1-350)
- `apps/web/src/lib/components/content/ContentDetailView.svelte` (lines 1-768)
- `apps/web/src/lib/server/content-detail.ts` (lines 1-191)
- `apps/web/src/lib/components/player/access-state.ts` (lines 1-62)

**Flow:** Content detail page fetches content (public), then streams access check + playback progress for authenticated users. `loadSubscriptionContext()` compares the user's subscription tier `sortOrder` against the content's `minimumTierId` to determine if subscription covers the content. `deriveAccessState()` produces one of: `unlocked`, `preview`, `locked:purchase_required`, `locked:subscription_required`, `locked:higher_tier_required`, or `locked:auth_required`.

---

## Studio Monetisation Management

### Monetisation Dashboard

**File:** `apps/web/src/routes/_org/[slug]/studio/monetisation/+page.svelte` (lines 1-849)

**Sections:**
1. **Stripe Connect status** -- Badge showing active/onboarding/restricted/not connected, with onboard/continue/dashboard buttons
2. **Enable Subscriptions toggle** -- Disabled until Connect is active; toggles `enableSubscriptions` feature flag via `api.org.updateFeatures()`
3. **Subscriber stats** -- Total subscribers, active subscribers, MRR (only shown when totalSubscribers > 0)
4. **Tier CRUD** -- List of tiers with rank, name, description, monthly/annual prices, edit/delete buttons
5. **Tier breakdown** -- Per-tier subscriber count and MRR table

**Data loading:** All client-side queries (SPA pattern) -- `listTiers`, `getConnectStatus`, `getOrgSettings`, `getSubscriptionStats`. Page renders instantly with skeletons.

### Tier CRUD

**Remote functions:** `createTier`, `updateTier`, `deleteTier`, `reorderTiers` in `apps/web/src/lib/remote/subscription.remote.ts`

**Dialog:** Create/edit tier dialog with name (max 100), description (max 500), monthly price (min 100 pence), annual price (min 100 pence). After save, calls `invalidateAll()` to refresh all queries.

### Connect Onboarding

**Flow:** Owner clicks "Set up Stripe Connect" -> `connectOnboard()` returns an `onboardingUrl` -> `window.location.href` redirect to Stripe. On return, `?connect=success` triggers `syncConnectStatus()` in `onMount` to poll Stripe directly (no webhook tunnel in local dev).

### Content Tier Gating

**File:** `apps/web/src/lib/components/studio/content-form/PublishSidebar.svelte`

Content form includes an access type selector with options: free, paid, subscribers (only when tiers exist). When "subscribers" is selected, a minimum tier dropdown appears. The `minimumTierId` is submitted as a hidden input.

### Billing Page

**File:** `apps/web/src/routes/_org/[slug]/studio/billing/+page.svelte` (lines 1-249)

Shows revenue summary (total revenue, total purchases, avg order value), Stripe portal button (via `portalSessionForm`), and top content by revenue table.

---

## Content Access UI

### Access State Derivation

**File:** `apps/web/src/lib/components/player/access-state.ts`

```
hasAccess -> unlocked
hasPreview -> preview
!isAuthenticated -> locked:auth_required
requiresSubscription && hasSubscription && !subscriptionCoversContent -> locked:higher_tier_required
requiresSubscription -> locked:subscription_required
default -> locked:purchase_required
```

### Locked Content Display (ContentDetailView)

**File:** `apps/web/src/lib/components/content/ContentDetailView.svelte`

Three purchase sections:
1. **Subscription required** (`needsSubscription`): Shows "Subscribe" or "Upgrade" CTA linking to `/pricing`. If content also has a price, shows "or purchase for X" with the purchase form.
2. **Purchase required** (`needsPurchase`): Shows price, purchase form, and "What you'll get" benefits list.
3. **Free but no access** (`isFree && !hasAccess`): Shows "Free" badge and login link for unauthenticated users.

### Player States

- **Full access + streaming URL:** Full VideoPlayer with progress tracking
- **Preview available:** PreviewPlayer with autoplay (falls back to thumbnail on error via `<svelte:boundary>`)
- **No preview, locked:** Thumbnail with gradient overlay, lock icon, and CTA text

---

## Purchase Flow UI

### Content Purchase (Form Action)

**Files:**
- `apps/web/src/routes/_org/[slug]/(space)/content/[contentSlug]/+page.server.ts` (lines 126-143, `actions.purchase`)
- `apps/web/src/lib/server/content-detail.ts` (lines 145-191, `handlePurchaseAction`)

Uses SvelteKit form action with `use:enhance` for progressive enhancement. The form submits `contentId` as a hidden input. The `handlePurchaseAction` shared helper creates a Stripe Checkout session. Error handling: 409 (already owned), organization-related errors (coming soon message), and generic 500.

### Checkout Success Pages

- **Org:** `apps/web/src/routes/_org/[slug]/(space)/checkout/success/` -- uses `buildContentUrl()` for content link
- **Creator:** `apps/web/src/routes/_creators/checkout/success/` -- uses simple path-based content link

Both delegate to the shared `CheckoutSuccess` component.

### Library Pages

- **Platform library:** `apps/web/src/routes/(platform)/library/+page.svelte` -- all purchased content across all orgs, client-side from localStorage-backed `libraryCollection`
- **Org library:** `apps/web/src/routes/_org/[slug]/(space)/library/+page.svelte` -- filtered to current org

Both use `loadLibraryFromServer()` on mount, `useLiveQuery` for reactivity, client-side filtering/sorting/pagination with continue-watching section.

### Purchase History

**File:** `apps/web/src/routes/(platform)/account/payment/+page.svelte` (lines 1-300+)

Server-loaded purchase history with table display, status filtering (completed/pending/failed/refunded), pagination, and Stripe billing portal button.

---

## Bugs Found

### BUG-FE-001: Delete tier dialog has no loading state on the delete button

**File:** `apps/web/src/routes/_org/[slug]/studio/monetisation/+page.svelte`, line 573
**Severity:** Medium
**Description:** The `handleDeleteTier()` function does not set a loading state on the delete button. This means a user can click the delete button multiple times before the first request completes, potentially causing duplicate delete requests. The `createTier`/`updateTier` flows correctly use `tierFormLoading` to disable the submit button, but `handleDeleteTier` does not.

```svelte
<!-- Line 573: No loading prop -->
<Button variant="destructive" onclick={handleDeleteTier}>
  {m.monetisation_tiers_delete()}
</Button>
```

**Fix:** Add a `deleteLoading` state variable and pass `loading={deleteLoading}` to the delete button, similar to `tierFormLoading`.

---

### BUG-FE-002: Delete tier error reuses `tierFormError` variable from create/edit dialog

**File:** `apps/web/src/routes/_org/[slug]/studio/monetisation/+page.svelte`, lines 222-224 and 567-568
**Severity:** Low
**Description:** `handleDeleteTier` writes errors to `tierFormError` (line 223), which is the same variable displayed in the create/edit dialog (line 543). If the user opens the create dialog after a failed delete, they will see the stale delete error message. The delete dialog at line 567 also reads `tierFormError`, but these two dialogs share state incorrectly.

**Fix:** Create a separate `deleteError` state variable for the delete dialog.

---

### BUG-FE-003: Connect onboarding returnUrl uses `/studio/monetisation` without org slug prefix

**File:** `apps/web/src/routes/_org/[slug]/studio/monetisation/+page.svelte`, lines 250-251
**Severity:** Low (works on org subdomains but fragile)
**Description:** The return URL is built as `${page.url.origin}/studio/monetisation?connect=success`. On org subdomains this works because the slug is in the hostname. However, if the routing ever changes or this code is reused in a non-subdomain context, the URL would be wrong.

---

### BUG-FE-004: Subscription checkout success redirects to `/library?subscription=success` on platform domain, not org domain

**File:** `apps/web/src/lib/remote/subscription.remote.ts`, lines 91-92 and 137-138
**Severity:** Medium
**Description:** Both `createSubscriptionCheckout` (form) and `createSubscriptionCheckoutSession` (command) default `successUrl` to `${url.origin}/library?subscription=success`. Since subscription checkout happens on the org subdomain, `url.origin` correctly resolves to the org origin. But the customer is redirected to `/library` which exists on the org subdomain. This works, but the `?subscription=success` query param is never consumed anywhere -- no toast, no banner, no special UI acknowledges the successful subscription on the library page.

**Fix:** Either consume the `?subscription=success` param on the library page to show a success toast, or redirect to `/checkout/success` with the session_id for a proper success flow.

---

### BUG-FE-005: `currentPeriodEnd` cast as `unknown as string` in subscription management page

**File:** `apps/web/src/routes/(platform)/account/subscriptions/+page.svelte`, lines 158 and 169
**Severity:** Low (cosmetic type issue)
**Description:** The code casts `sub.currentPeriodEnd as unknown as string` twice. This indicates a type mismatch between the `UserOrgSubscription` type (which extends `Subscription` from the DB schema where `currentPeriodEnd` is likely a `Date`) and what the API actually returns (likely a serialized string). The double cast hides this.

**Fix:** Ensure the `UserOrgSubscription` type correctly represents the serialized API response (string, not Date) or add a proper type guard/transformation.

---

### BUG-FE-006: Pricing page shows "Subscribe" button for unauthenticated users but calls `handleSubscribe` which redirects to login

**File:** `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte`, lines 36-54
**Severity:** Low (functional but UX issue)
**Description:** When an unauthenticated user clicks "Subscribe", the `handleSubscribe` function redirects to `/login?redirect=/pricing`. However, after successful login, the user returns to the pricing page and must click again. The redirect loses the intended tier selection and billing interval. This is a two-click purchase flow.

**Fix:** Encode `tierId` and `billingInterval` in the redirect URL so the pricing page can auto-initiate checkout on return from login.

---

### BUG-FE-007: Pricing page has no error display when checkout fails

**File:** `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte`, lines 50-53
**Severity:** Medium
**Description:** The `handleSubscribe` function catches errors silently -- it only resets `checkoutLoading` to null. No error message is displayed to the user. If the API call fails (network error, Stripe error, etc.), the user sees the button return to its default state with no feedback.

```typescript
} catch {
  checkoutLoading = null;
  // No error display!
}
```

**Fix:** Add a `checkoutError` state variable and display an alert below the tier card or as a toast.

---

### BUG-FE-008: Platform pricing page is a static marketing placeholder disconnected from actual subscription system

**File:** `apps/web/src/routes/(platform)/pricing/+page.svelte` (lines 1-213)
**Severity:** Medium (confusing UX)
**Description:** The platform-level `/pricing` page shows hardcoded "Free / Creator / Enterprise" plans with generic features and CTAs that link to `/register` and `/about`. This is completely separate from the org-level subscription tier system. A user navigating to `/pricing` from the platform navbar sees marketing copy, not actual purchasable plans. The navigation config at `apps/web/src/lib/config/navigation.ts` includes `/pricing` in both `PLATFORM_NAV` (line 31) and `MOBILE_PLATFORM_NAV` (line 106), leading users to this disconnected page.

**Fix:** Either remove `/pricing` from platform navigation (it only makes sense on org subdomains) or turn it into a discovery page that lists orgs with their subscription offerings.

---

### BUG-FE-009: `enableSubscriptions` feature flag is only checked in the studio monetisation page, not in the public pricing page or content detail

**File:** `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte` (no check), `apps/web/src/routes/_org/[slug]/(space)/content/[contentSlug]/+page.server.ts` (no check)
**Severity:** Medium
**Description:** The `enableSubscriptions` feature flag controls whether the owner can manage subscriptions in the studio, but the customer-facing pages do not check it. If an owner disables subscriptions, the pricing page still shows tiers, subscription checkout still works, and content detail still shows subscription-gated UI. The flag effectively does nothing for the customer experience.

**Fix:** Pass the feature flag from the org layout (or a dedicated settings load) and conditionally hide the pricing nav link, pricing page content, and subscription CTA on content detail when disabled.

---

### BUG-FE-010: Subscription context `$effect` in content detail pages does not handle rejection

**File:** `apps/web/src/routes/_org/[slug]/(space)/content/[contentSlug]/+page.svelte`, lines 51-59
**Severity:** Low
**Description:** The `$effect` that resolves `data.subscriptionContext` uses `.then()` but has no `.catch()`. If the promise rejects (which can happen since the server load already `.catch()`-wraps it, but edge cases exist), the `subCtx` state will never update from its defaults. While the defaults are safe, a `.catch()` would be more robust.

---

### BUG-FE-011: Tier form price inputs accept raw pence values but display is confusing

**File:** `apps/web/src/routes/_org/[slug]/studio/monetisation/+page.svelte`, lines 516-540
**Severity:** Low (UX)
**Description:** Tier prices are entered in pence (e.g., 499 for GBP4.99) with a `min={100}` and `step={1}`. The form hint shows the formatted price (`formatPrice(tierPriceMonthly)`), but the input label says "Monthly Price" / "Annual Price" without indicating the unit is pence. A creator might enter 499 thinking it means GBP499 instead of GBP4.99.

**Fix:** Add explicit unit labels (e.g., "Monthly Price (pence)") or use a GBP-formatted input that converts to/from pence internally.

---

### BUG-FE-012: Reactivate subscription error uses `cancelError` variable

**File:** `apps/web/src/routes/(platform)/account/subscriptions/+page.svelte`, lines 85-86
**Severity:** Low
**Description:** `handleReactivate` writes errors to `cancelError`, which is displayed inside the cancel dialog. If reactivation fails, the error only becomes visible if the user opens the cancel dialog.

**Fix:** Add a separate `reactivateError` state or a general `actionError` that is displayed in the subscription card.

---

## Improvements

### IMP-FE-001: Duplicated content detail page code between org and creator routes

**Files:**
- `apps/web/src/routes/_org/[slug]/(space)/content/[contentSlug]/+page.svelte` (350 lines)
- `apps/web/src/routes/_creators/[username]/content/[contentSlug]/+page.svelte` (371 lines)

**Description:** These two pages are nearly identical. Both render `ContentDetailView` with the same streaming pattern, the same skeleton states, the same related content section, and the same skeleton CSS. The only differences are: (1) the creator page has a `creatorAttribution` snippet with a link, (2) href builder for related content. Both share the same CSS block for skeletons (lines 230-349 and lines 252-370).

**Recommendation:** Extract the streaming wrapper logic and skeleton CSS into a shared component or a Svelte action, reducing maintenance burden. The `ContentDetailView` component itself is already shared; the surrounding `{#if}/{#await}` wrapper and skeleton CSS should be too.

---

### IMP-FE-002: Duplicated library page code between platform and org routes

**Files:**
- `apps/web/src/routes/(platform)/library/+page.svelte` (221 lines)
- `apps/web/src/routes/_org/[slug]/(space)/library/+page.svelte` (264 lines)

**Description:** Nearly identical filter/sort/pagination logic. The only differences are: (1) org library filters by `organizationSlug`, (2) org library has an `accessType` filter and a "View full library" link, (3) error message strings differ slightly. Both share the `LibraryPageView` component.

**Recommendation:** Extract the shared filter/sort/pagination logic into a composable function or a wrapper component.

---

### IMP-FE-003: No tier upgrade/downgrade flow from within content detail or subscription management

**Files:**
- `apps/web/src/routes/(platform)/account/subscriptions/+page.svelte` (line 179-183)
- `apps/web/src/lib/remote/subscription.remote.ts` (lines 158-165, `changeSubscriptionTier`)

**Description:** The `changeSubscriptionTier` command exists in the remote functions but is never called from any UI. The subscription management page's "Change Tier" button navigates to the org pricing page (`buildOrgUrl(page.url, sub.organization.slug, '/pricing')`), which shows tier cards with "Subscribe" buttons. There is no inline upgrade/downgrade flow. The pricing page shows the current plan as disabled but doesn't offer a "Change to this plan" action for existing subscribers.

**Recommendation:** Implement an upgrade/downgrade flow: (a) add a "Change Plan" button on the pricing page for existing subscribers that calls `changeSubscriptionTier`, or (b) redirect to a Stripe-hosted upgrade session.

---

### IMP-FE-004: No confirmation or success feedback after subscription actions

**Description:** After `cancelSubscription` and `reactivateSubscription`, the page calls `invalidate('cache:versions')` to refresh data, but there is no toast or success message. The user must visually confirm the status badge changed.

**Recommendation:** Show a success toast after cancel/reactivate actions.

---

### IMP-FE-005: Monetisation page has no `+page.server.ts` -- all data is client-side

**File:** `apps/web/src/routes/_org/[slug]/studio/monetisation/+page.svelte`

**Description:** The monetisation page renders client-side only (studio SPA mode). While this is consistent with the SPA pattern, the heavy use of `as QueryResult<T>` type assertions (lines 73-101) suggests the query return types are not well-typed. There are 5 different `as QueryResult<T>` casts.

**Recommendation:** Create a typed wrapper or generic for the SPA query pattern to eliminate the manual type assertions.

---

### IMP-FE-006: Checkout success does not invalidate the library collection

**Files:**
- `apps/web/src/routes/_org/[slug]/(space)/checkout/success/+page.server.ts`
- `apps/web/src/lib/components/ui/CheckoutSuccess/CheckoutSuccess.svelte`

**Description:** After a successful purchase, the CheckoutSuccess component shows a "Start Watching" link, but it does not trigger any library invalidation. If the user navigates to their library, they may see stale data until the next `visibilitychange` event triggers a version check. The server-side KV version bump (from the ecom-api webhook) may not have propagated yet.

**Recommendation:** Add `invalidate('cache:versions')` or `invalidateCollection('library')` in the CheckoutSuccess component after successful verification.

---

### IMP-FE-007: Free content shows "What you'll get" benefits list identically to paid content

**File:** `apps/web/src/lib/components/content/ContentDetailView.svelte`, lines 332-365

**Description:** Free content shows the same benefits list ("HD video", "Lifetime access", "Progress tracking", "Any device") as paid content. For free content, "Lifetime access" is misleading since there is nothing to "buy".

**Recommendation:** Show a different benefits list for free content, or simplify to just "Sign in to start watching".

---

### IMP-FE-008: Tier breakdown in monetisation page has hardcoded English strings

**File:** `apps/web/src/routes/_org/[slug]/studio/monetisation/+page.svelte`, lines 475-476

```svelte
<span class="breakdown-count">{tb.subscriberCount} subscribers</span>
<span class="breakdown-mrr">{formatPrice(tb.mrrCents)}/mo</span>
```

**Description:** "subscribers" and "/mo" are hardcoded English strings, not i18n message functions. This is inconsistent with the rest of the page which uses `$paraglide/messages`.

**Recommendation:** Replace with i18n message functions.

---

### IMP-FE-009: No loading skeleton for the enableSubscriptions feature toggle

**File:** `apps/web/src/routes/_org/[slug]/studio/monetisation/+page.svelte`, line 362

**Description:** While `dataLoading` is true, the Switch is rendered with `checked={false}` (hardcoded to false during loading, line 362). This causes a visual flash: the toggle appears unchecked during loading, then snaps to checked if subscriptions are enabled. This is jarring.

**Recommendation:** Show a skeleton or disabled state for the entire feature toggle row during loading.

---

### IMP-FE-010: Org library page has client-side auth guard instead of server-side redirect

**File:** `apps/web/src/routes/_org/[slug]/(space)/library/+page.svelte`, lines 31-33

**Description:** The library page uses a client-side `$effect` to redirect unauthenticated users. Since the page has no `+page.server.ts`, the auth check only happens after the client renders. An unauthenticated user sees a flash of the loading state before being redirected.

**Recommendation:** Add a `+page.server.ts` with `locals.user` check and server-side redirect, consistent with the platform library page approach (which also lacks one, but the platform layout handles auth).

---

### IMP-FE-011: Subscription checkout form (`createSubscriptionCheckout`) is defined but never used

**File:** `apps/web/src/lib/remote/subscription.remote.ts`, lines 74-103

**Description:** The `createSubscriptionCheckout` form function (progressive enhancement version) is defined but never referenced in any Svelte component. Only the command version (`createSubscriptionCheckoutSession`) is used on the pricing page. The form version would provide better progressive enhancement (works without JS).

**Recommendation:** Either use the form version on the pricing page for progressive enhancement, or remove the dead code.

---

### IMP-FE-012: No tier features/perks management in the studio

**Description:** Subscription tiers only have name, description, and prices. There is no way for creators to define tier-specific features or perks (e.g., "Early access", "Bonus content", "Discord access"). The pricing page shows only one generic benefit per tier: "Access to all {tierName} content".

**Recommendation:** Add a features/perks field to the tier model and display them on the pricing page.

---

### IMP-FE-013: Pricing page does not distinguish annual price display

**File:** `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte`, line 111

**Description:** When the annual toggle is selected, the price shows the full annual amount (e.g., "GBP49.90/year"). Most SaaS pricing pages show the monthly-equivalent price (e.g., "GBP4.16/month, billed annually") to make comparison easier.

**Recommendation:** Show the monthly-equivalent price when annual billing is selected, with a "billed annually" qualifier.

---

### IMP-FE-014: `formatPrice` returns empty string for null/undefined, not a fallback

**File:** `apps/web/src/lib/utils/format.ts`, line 67-70

**Description:** `formatPrice(null)` returns `''` (empty string). Several components conditionally check for this, but it can lead to empty spots in the UI if a price is unexpectedly null.

**Recommendation:** Consider returning `'GBP0.00'` or a specific "Price not set" string for null values, with an explicit "free" check at the call site.

---

## Work Packets

### WP-FE-01: Fix tier delete dialog bugs (BUG-FE-001, BUG-FE-002)

**Scope:** `apps/web/src/routes/_org/[slug]/studio/monetisation/+page.svelte`
**Effort:** 30 minutes
**Changes:**
1. Add `deleteLoading` state variable
2. Pass `loading={deleteLoading}` to the destructive button in the delete dialog
3. Create `deleteError` state variable, separate from `tierFormError`
4. Display `deleteError` in the delete dialog, clear it when dialog opens
5. Set `deleteLoading = true` at start of `handleDeleteTier`, reset in `finally`

---

### WP-FE-02: Add error handling to pricing page checkout (BUG-FE-007)

**Scope:** `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte`
**Effort:** 30 minutes
**Changes:**
1. Add `checkoutError` state variable
2. Set it in the catch block of `handleSubscribe`
3. Display an `Alert` below the tier grid when `checkoutError` is set
4. Clear the error when a new checkout is initiated

---

### WP-FE-03: Implement enableSubscriptions feature flag on customer-facing pages (BUG-FE-009)

**Scope:** Org layout, pricing page, content detail, navigation
**Effort:** 2-3 hours
**Changes:**
1. Load org feature settings in the org layout server load (or a parallel request)
2. Pass `enableSubscriptions` flag to child routes via layout data
3. In the pricing page, show an empty state when subscriptions are disabled
4. In the content detail, hide subscription CTA when disabled
5. Conditionally show/hide the `/pricing` nav link based on the flag
6. In the org navigation config, make the pricing link conditional

---

### WP-FE-04: Fix subscription success redirect and add success feedback (BUG-FE-004, IMP-FE-004)

**Scope:** Subscription remote functions, library page, subscription management page
**Effort:** 1-2 hours
**Changes:**
1. Change subscription checkout successUrl to use the existing `/checkout/success` page with `session_id` param
2. OR: Consume `?subscription=success` query param on the library page to show a success toast
3. Add success toast after cancel/reactivate subscription actions
4. Add `invalidate('cache:versions')` in checkout success component after verification

---

### WP-FE-05: Implement tier upgrade/downgrade flow (IMP-FE-003)

**Scope:** Pricing page, subscription remote functions, new upgrade dialog
**Effort:** 4-6 hours
**Changes:**
1. On the pricing page, detect if the user has an existing subscription
2. For existing subscribers, show "Upgrade" or "Downgrade" instead of "Subscribe"
3. Create an upgrade confirmation dialog showing price difference and proration
4. Call `changeSubscriptionTier` command on confirmation
5. Handle the response and redirect/refresh appropriately

---

### WP-FE-06: Consolidate duplicated content detail wrapper code (IMP-FE-001)

**Scope:** Org and creator content detail pages
**Effort:** 2-3 hours
**Changes:**
1. Create a shared `ContentDetailWrapper.svelte` component that encapsulates the `{#if}/{#await}` streaming pattern
2. Accept `data`, `form`, `creatorAttribution` snippet, and `buildRelatedHref` as props
3. Move the skeleton CSS into the shared component
4. Simplify both org and creator content detail pages to thin wrappers

---

### WP-FE-07: Add i18n for remaining hardcoded commerce strings (IMP-FE-008)

**Scope:** Monetisation page, content detail, library pages
**Effort:** 1 hour
**Changes:**
1. Replace "subscribers" and "/mo" in tier breakdown with i18n messages
2. Audit all commerce-related components for remaining hardcoded strings
3. Add missing message keys to `apps/web/messages/en.json`

---

### WP-FE-08: Fix reactivate error display (BUG-FE-012)

**Scope:** `apps/web/src/routes/(platform)/account/subscriptions/+page.svelte`
**Effort:** 20 minutes
**Changes:**
1. Add `reactivateError` state (or per-subscription error map)
2. Display error inline on the subscription card, not in the cancel dialog
3. Clear error when a new action is initiated

---

### WP-FE-09: Preserve tier selection through login redirect (BUG-FE-006)

**Scope:** Pricing page
**Effort:** 1 hour
**Changes:**
1. Encode `tierId` and `billingInterval` in the redirect URL when redirecting to login
2. On pricing page mount, check for these params and auto-initiate checkout if present and user is authenticated
3. Clear the params from URL after initiating checkout

---

### WP-FE-10: Remove or repurpose platform-level pricing page (BUG-FE-008)

**Scope:** Platform pricing page, navigation config
**Effort:** 1-2 hours
**Changes:**
1. Option A: Remove `/pricing` from `PLATFORM_NAV` and `MOBILE_PLATFORM_NAV` -- pricing only makes sense on org subdomains
2. Option B: Transform the platform pricing page into a discovery page showing orgs with subscription offerings
3. Clean up the static marketing content or connect it to actual platform features

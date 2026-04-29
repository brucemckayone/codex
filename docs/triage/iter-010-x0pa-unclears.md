# Codex-x0pa — Running Unclears, Missing Pieces, and Improvements

> Living artifact for the subscription E2E suite work. Updated as we go through Sessions 1–3 and discover gaps the audit missed.
>
> Sibling to:
> - `docs/triage/iter-010-audit-x0pa.md` — fixed-point audit (snapshot)
> - `docs/triage/iter-010.md` — /triage cycle decision log
> - Codex-x0pa — bead the work belongs to
> - Codex-c2fgc — "Free for me" product feature follow-up
> - Codex-vas3y — skipped-specs cleanup follow-up

## Schema

Each entry has:
- **ID** — `U-NN` (Unclear), `M-NN` (Missing), `I-NN` (Improvement)
- **Date** — when first noted
- **Flagged by** — `bruce`, `claude`, `<sub-agent>`
- **Description** — the question, missing piece, or improvement candidate
- **Status** — `OPEN` / `INVESTIGATING` / `RESOLVED` / `DEFERRED` / `BLOCKED`
- **Resolution** — answer + commit/file link if resolved; next-step if not

Status decay: anything `RESOLVED` more than 30 days ago can be archived to a "Resolved" section at the bottom.

---

## Active entries

| ID | Date | Flagged by | Description | Status | Resolution / next step |
|----|------|------------|-------------|--------|------------------------|
| **U-01** | 2026-04-29 | bruce | Can a customer purchase a subscription if the org owner hasn't completed full Connect setup? | RESOLVED | NO. `SubscriptionService.createCheckoutSession` (`packages/subscription/src/services/subscription-service.ts:401-403`) throws `ConnectAccountNotReadyError` if `!chargesEnabled \|\| !payoutsEnabled`. The seed activates Studio Alpha against real Stripe (`commerce.ts:77-120`) and reads `charges_enabled` back from `accounts.retrieve()` — DB reflects truth. One-time purchase (`PurchaseService`) degrades gracefully without `transfer_data`; subscription does NOT. |
| **U-02** | 2026-04-29 | claude | If `setupStudioUserWithConnect` were to write a DB row with `chargesEnabled=true` against a fake `stripeAccountId`, would tier CRUD or subscription checkout fail? | RESOLVED | YES. Tier creation calls `stripe.products.create()` against the connected account, would 404 / account_invalid. Subscription checkout would fail at `accounts.retrieve()` even before the gate at line 401. Plan tweak: drop the helper, use seeded `creator@test.com` for spec 02. |
| **U-03** | 2026-04-29 | claude | What does the studio UI render when Connect status = `onboarding` (Stripe account exists but `chargesEnabled=false`)? Disabled tier-create button? Hidden tier section? Error toast? | OPEN | Need to read `apps/web/src/routes/_org/[slug]/studio/monetisation/+page.svelte` for the gating logic. Spec 01.b ("Set up Stripe redirect") may need to assert this state. |
| **U-04** | 2026-04-29 | claude | Does TierService block tier CRUD if Connect isn't `chargesEnabled`? Audit didn't see a gate, but UI may gate it client-side. | OPEN | Read `packages/subscription/src/services/tier-service.ts` createTier/listTiers methods + the studio monetisation page mount logic. |
| **U-05** | 2026-04-29 | claude | What does the customer pricing page show if the org's Connect account is in `onboarding` state (tiers exist but checkout would fail)? Subscribe button disabled? Hidden? Tooltip? | OPEN | Read `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte` tier-card render logic + check whether it queries `connect/status` upstream. |
| **U-06** | 2026-04-29 | claude | When spec 03 forges `checkout.session.completed`, does `routeDevWebhook` actually accept events with arbitrary `metadata` (`codex_user_id`, `codex_org_id`, `codex_tier_id`) or does it require specific shape? | OPEN | Read `workers/ecom-api/src/utils/dev-webhook-router.ts:73` + the handler downstream (`SubscriptionService.handleCheckoutSessionCompleted` or wherever the dispatcher routes to). Test by sending a minimal event payload first. |
| **U-07** | 2026-04-29 | claude | What's the dev shared secret for `routeDevWebhook`? Is it any of the existing `STRIPE_WEBHOOK_SECRET_*` envvars, or a separate `DEV_WEBHOOK_SECRET`? | OPEN | Read `workers/ecom-api/src/utils/dev-webhook-router.ts` env binding + worker config. |
| **U-08** | 2026-04-29 | claude | After `subscription.created` webhook lands, how long does it take for the `subscriptions` row to be queryable? Is there a transaction commit lag we need to poll past? Cache invalidation lag? | OPEN | Need to time it. `waitForSubscriptionRow` should retry every 250ms up to 5s. If consistently <1s, no polling needed. |
| **U-09** | 2026-04-29 | claude | Does spec 03's pricing-page round-trip after subscribe survive the `cache:org-versions` invalidation correctly? Or do we need to dispatch a `visibilitychange` event like `subscription-cross-device.spec.ts` does? | OPEN | Mirror cross-device spec's pattern OR trigger `invalidate('cache:org-versions')` programmatically. Need to verify post-subscribe page load reflects the new state without stale-cache lag. |
| **U-10** | 2026-04-29 | claude | The "Subscribe" CTA in pricing — is the test selector `[data-testid="tier-cta-subscribe"][data-tier="standard"]` or something else? `subscription-cross-device.spec.ts` uses `tier-cta-current` and `tier-cta-reactivate`, suggesting `tier-cta-subscribe` exists but unverified. | OPEN | Grep `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte` for `data-testid="tier-cta-`. If pattern matches, use it; if not, propose adding it (small, non-controversial). |
| **U-11** | 2026-04-29 | claude | What does `/studio/monetisation` look like when there are 0 tiers vs N tiers? Does spec 02 need to navigate from a different page after creating each tier? | OPEN | Read the page. May affect spec 02's interaction model. |
| **U-12** | 2026-04-29 | claude | Spec 04 ("tier-gated content access") asserts the AccessRevokedOverlay or "Upgrade to Pro" CTA renders for over-tier content. Audit unclear whether it's an overlay-on-player or a redirect-to-pricing-page. | OPEN | Read the content detail page render logic when `accessType='subscribers'` && user's tier < required tier. |
| **U-13** | 2026-04-29 | claude | Spec 05 ("library subscription badge") — what's the actual `accessType` value for tier-gated content in the library? `'subscription'`? `'tier'`? `'subscribers'`? | OPEN | Grep `apps/web/src/lib/collections/library.ts` for the type union + check what `listUserLibrary()` returns for sub-included content. |
| **U-14** | 2026-04-29 | claude | Are there CI runners with the Stripe CLI pre-installed? If not, the path-gated PR CI for spec 03 must use strategy C (forged event) — strategy A (Stripe CLI) only viable in nightly with explicit install step. | OPEN | Need to check `.github/workflows/*.yml` for Stripe CLI install patterns. May also affect local-dev experience for developers who don't have Stripe CLI. |
| **U-15** | 2026-04-29 | claude | The audit found `cleanupStripeSeedObjects()` archives test products with `metadata.codex_seed=true`. What metadata key should specs 02 and 03 use for THEIR test products / sessions / subscriptions so a future cleanup doesn't lump them with seed objects (or ignore them)? | OPEN | Propose `metadata.codex_e2e_test=true` + `metadata.codex_e2e_test_run_id=<timestamp>`. Verify nothing else uses these keys. |
| **M-01** | 2026-04-29 | claude | No helper today wraps the `setHeaders(CACHE_HEADERS.PRIVATE)` + `await thingThatCanThrow()` order rule for the new spec routes. Specs may not surface this; defensive note for any new server load they touch. | DEFERRED | Document in `apps/web/CLAUDE.md` ordering rule already covers it. Not a blocker for x0pa. |
| **M-02** | 2026-04-29 | claude | No `pnpm test:e2e:subscription` script alias for the new directory. Developers will type the path directly. | OPEN | Add to `apps/web/package.json` scripts: `"test:e2e:subscription": "playwright test --project=e2e e2e/subscription"`. ~2 line change. |
| **M-03** | 2026-04-29 | claude | The audit didn't trace what happens when a freshly-subscribed user navigates back to `/pricing` — does the page re-fetch subscription state, or rely on the `cache:org-versions` invalidation flowing through? Spec 03's final assertion may be flaky depending on this. | OPEN | Verify with a targeted read of the pricing page's subscription-context source (likely via parent layout). |
| **I-01** | 2026-04-29 | claude | Existing `subscription-cross-device.spec.ts` and `account-subscription-cancel.spec.ts` would benefit from the same `subscription.ts` helpers we're building (e.g., `cancelAnyActiveSubscriptions` for clean teardown). Currently they hand-roll equivalents. | DEFERRED | Once `helpers/subscription.ts` ships in Session 1, file a follow-up bead to refactor existing specs to use it. Not in x0pa scope. |
| **I-02** | 2026-04-29 | claude | The 4 stale-skip specs (`pricing-reactivate`, `streaming-revocation`, `subscription-paused-resumed`, `progress-save-access-gate`) all duplicate the auth-worker health probe inline. After x0pa lands, consolidate the probe into `fixtures/auth.ts`. | DEFERRED | File under Codex-vas3y when that work begins. |
| **I-03** | 2026-04-29 | claude | The seed's `activateConnectAccount` flow (commerce.ts:77-120) is duplicated knowledge the test suite needs. If we ever DO need a per-test fresh-Connect helper (vs reusing seeded), extracting `activateStripeConnectAccount(stripe, accountId)` to a shared util in `@codex/test-utils/src/e2e/stripe.ts` would prevent drift. | DEFERRED | Not needed right now (plan uses seeded creator). File when/if a future spec needs a per-test Connect activation. |
| **I-04** | 2026-04-29 | claude | Spec 01.b intercepts the redirect to `connect.stripe.com` — should we ALSO assert the redirect URL contains correct query params (account ID, return URL)? Adds 2-line assertion, prevents silent drift if `connectOnboard()` changes its URL shape. | OPEN | Yes — include in spec 01 as a low-cost extra assertion. |

---

## Resolved entries

(empty until first resolution)

---

## Update log

| Date | Edit |
|------|------|
| 2026-04-29 | Initial creation. Seeded with U-01–U-15, M-01–M-03, I-01–I-04 from /triage iter-010 design conversation + Connect-readiness investigation. |

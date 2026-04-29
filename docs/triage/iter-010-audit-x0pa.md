# Codex-x0pa Audit — Subscription E2E Coverage Matrix

> Produced 2026-04-29 by /triage iter-010 design phase. Input for the user's scope decision.

## §1 — TL;DR

- The bead's 10 steps are roughly **30% covered** today: only step 9 (manage subscription) and step 10 (cancel) have green specs; steps 1–7 are entirely uncovered, and step 8 is **based on a feature that does not exist** in the codebase.
- The subscription suite that *does* exist (`account-subscription-cancel.spec.ts`, `subscription-cross-device.spec.ts`) was added 2026-04-22 — *after* x0pa was filed (2026-04-05). x0pa is **partially stale** in the same way Codex-d3g6 was: it asks for "step 10 cancels" coverage that already lives at `apps/web/e2e/account-subscription-cancel.spec.ts:114-225`.
- **Step 8 staleness is harder.** The user's clarification ("Free for me toggle … should set the price to zero, and that should signify it's free for me … delivered to the user's library") describes a feature that is **not implemented**: the content-creation form has no per-content "Free for me" toggle; price=0 already signifies "free", but `listUserLibrary()` (`packages/access/src/services/ContentAccessService.ts:1199`) does **not** auto-deliver free content to subscribers/followers — only to management roles, purchasers, and active subscribers of tier-gated content. This belongs in a backlog item, not in an E2E suite.
- **Highest-leverage 4 specs to write first** (in order):
  1. Studio Stripe Connect onboarding (steps 1–2) — uses pre-seeded `connectedAccountId`
  2. Tier CRUD + assign-tier-to-content (steps 2–3)
  3. Customer subscribe via Stripe Checkout (steps 4–5)
  4. Tier-gated content access + library badge after subscribe (steps 6–7)
- **Prerequisite infrastructure changes**: extend `commerce.ts` seed with a no-Stripe org and a no-Connect-yet org; add `apps/web/e2e/helpers/subscription.ts` with shared subscribe / setup-tier helpers; introduce a per-test reset mechanism (Stripe test-mode customer cleanup) so the suite stays under 2% flake. Webhook strategy — use `stripe trigger` + `routeDevWebhook` (already exists at `workers/ecom-api/src/utils/dev-webhook-router.ts:73`) — no new ALLOW_TEST_HOOKS endpoint required for the bead's happy-path flow.

## §2 — Coverage matrix

| Step | Description | Existing spec(s) | Coverage | Gap |
|------|-------------|------------------|----------|-----|
| 1 | Org owner connects Stripe | (none) | NONE | No spec exercises `/studio/monetisation` Connect-onboarding UI; user clarified test will use pre-seeded `connectedAccountId` and assert the in-app onboarded-state UI |
| 2 | Creates 3 tiers | (none) | NONE | `monetisation/+page.svelte` tier-create dialog (lines 106-180) untested; only `seedCommerce` creates them via DB |
| 3 | Assigns tier to content | (none) | NONE | `AccessSection.svelte` "subscribers" + tier picker (lines 81-116) is reachable only as a static select; no spec creates content with `minimumTierId` via UI |
| 4 | Customer views pricing page | (none — `subscription-cross-device.spec.ts:135-149` *visits* it for an authenticated subscribed user only) | PARTIAL | Public pricing page render (unauthed + auth-but-unsubscribed) untested; tier card "Subscribe" CTA (`pricing/+page.svelte:790`) untested |
| 5 | Subscribes to tier | (none) | NONE | No spec drives `POST /subscriptions/checkout` → Stripe Checkout → `checkout.session.completed` webhook → DB subscription row |
| 6 | Accesses tier-gated content | (none — `streaming-revocation.spec.ts` is `test.skip` and asserts the *denied* path) | NONE | No spec verifies subscriber successfully streams `subscribers`-mode content (`tsDeepDive`, `advancedSvelte`); `packages/access/src/services/__tests__/content-access-service-followers-subscription.test.ts` covers it at unit level only |
| 7 | Sees subscription in library with badge | (none) | NONE | `(platform)/library` page renders a "Subscription" tab (`library.ts:23` `LibraryItem.accessType`) but no spec asserts a subscriber sees tier-included content there; bug-hunt only smokes the URL (`bug-hunt.spec.ts:332-339`) |
| 8 | Uses Free for me toggle | n/a | n/a | **Feature does not exist in code.** No "Free for me" toggle in `ContentForm.svelte` / `AccessSection.svelte`; price=0 already maps to `accessType='free'`; `listUserLibrary()` does NOT include public free content for subscribers (`ContentAccessService.ts:1442` comment confirms this is intentional). See §6. |
| 9 | Manages subscription in account page | `account-subscription-cancel.spec.ts:114-225` | FULL | Cancel + reload-persistence + rollback assertions all pass against seeded ACTIVE subscription |
| 10 | Cancels subscription | `account-subscription-cancel.spec.ts:114-191` | FULL | Same spec — covers optimistic flip, `currentPeriodEnd` retention, no-hard-refresh, and server-reconciled persistence |

## §3 — Existing spec inventory

- **`apps/web/e2e/account-subscription-cancel.spec.ts`** (3 tests, ~serial) — Logs in as `viewer@test.com`, clicks Cancel on the seeded Studio Alpha subscription, asserts CANCELLING badge + currentPeriodEnd + no-hard-refresh, reloads to verify server reconciliation, and stub-fails the network to verify rollback. Fixture: seeded viewer + active sub. Status: **passing** (assumes z1wuz fix is live — STRIPE_SECRET_KEY set in `.env.test`). Runtime: ~30-50s for the trio. Strong template for steps 5/9/10 specs.
- **`apps/web/e2e/subscription-cross-device.spec.ts`** (1 test) — Two contexts, cancel in A, dispatch `visibilitychange` in B, assert pricing-page tier CTA flips. Fixture: same seeded viewer. Status: **passing**. Runtime: ~25-40s. Demonstrates pricing page tier-card test selectors (`tier-cta-current` / `tier-cta-reactivate`) and how to drive `cache:org-versions` invalidation.
- **`apps/web/e2e/pricing-reactivate.spec.ts`** (3 tests, all `test.skip(true, BLOCKER_MESSAGE)`) — All blocked on **Codex-z1wuz which is CLOSED** (verified via `bd show z1wuz`). **Stale skip** — author note says "Delete the `test.skip` lines once z1wuz lands" and z1wuz landed. Should either be re-enabled or have its skip reason updated.
- **`apps/web/e2e/streaming-revocation.spec.ts`** (3 tests, all skipped) — Authored against a hypothetical `POST /_test/revocation` endpoint that does not exist. Skip reason references z1wuz (closed). Real blocker is the missing `ALLOW_TEST_HOOKS` endpoint, not z1wuz. Skip message is **misleading**.
- **`apps/web/e2e/subscription-paused-resumed.spec.ts`** (1 test, skipped) — Same `_test` endpoint blocker.
- **`apps/web/e2e/progress-save-access-gate.spec.ts`** (skipped, same blocker chain).
- **`apps/web/e2e/account/payment.spec.ts`** — Account payment-method UI smoke; not subscription-flow relevant. Mentions "stripe" in copy only.
- **`apps/web/e2e/org/member.spec.ts:130-141`** — Asserts the `'subscriber'` org-role is *accepted* by the membership fixture. Not a subscription flow test.
- **`apps/web/e2e/auth-flow.spec.ts`, `forms/*.spec.ts`** — Auth lifecycle, no subscription touch.
- **`apps/web/e2e/studio/*.spec.ts`** (7 specs) — content list, navigation, settings, analytics, breadcrumbs, team, media. Zero coverage of `/studio/monetisation` or `/studio/billing`.
- **`apps/web/e2e/bug-hunt.spec.ts:332-339`** — Smokes `/library` URL only ("does it 200 and not contain 'Failed to load'").
- **`apps/web/e2e/content-cache.spec.ts`** — Publish→appear chain; uses freshly created org via `registerSharedStudioUser` helper. Strong template for "create studio user with org + tier" specs.

## §4 — Seed inventory

`pnpm db:seed` (`packages/database/scripts/seed-data.ts`) produces (verified against `commerce.ts` and `constants.ts`):

- **Users** (11): `creator@test.com` (owns Studio Alpha, Connect active), `viewer@test.com` (subscribed to Standard), `admin@test.com` (owns Studio Beta), `luzura@test.com` (owns Of Blood & Bones), `newcreator@test.com` (creator role, no org), `fresh@test.com` (clean customer), and 5 customer1–5 with varied purchase histories. All passwords: `Test1234!`.
- **Orgs** (3): `studio-alpha` (Connect active, 4 tiers seeded across orgs), `studio-beta` (no Connect, no tiers seeded for it but `betaStandard` tier defined), `of-blood-and-bones` (no Connect, `bonesSoulPath` tier defined).
- **Tiers** (4 in code, only created in Stripe + DB linked when `STRIPE_SECRET_KEY` is set): `alphaStandard` (£4.99/mo), `alphaPro` (£9.99/mo), `betaStandard` (£6.99/mo), `bonesSoulPath` (£15/mo).
- **Subscriptions** (1): viewer → `alphaStandard`, `status='active'`, real Stripe sub when `STRIPE_SECRET_KEY` is set, synthetic ID otherwise.
- **Connect Accounts** (1): `studio-alpha` only — pre-filled to `charges_enabled=true` via `activateConnectAccount()` (`commerce.ts:77-120`).
- **Content (subscription-relevant)**:
  - `intro-to-typescript` — free, published, member-of-Alpha-only via `contentAccess` row (`viewerIntroTs`)
  - `advanced-svelte-patterns` — `subscribers`, requires `alphaPro` (viewer's Standard does NOT cover)
  - `typescript-deep-dive` — `subscribers`, requires `alphaStandard` (viewer's Standard DOES cover)
  - `members-only-workshop` — hybrid `paid` + `alphaStandard` tier (£9.99 OR sub)
  - `css-variables-masterclass` — `paid` £4.99, no tier
  - `community-qa-behind-the-scenes` — `followers`-only
  - `internal-planning-session` — `team`-only
- **Purchases** (14): one-time purchases for various users; viewer has Svelte (Alpha) + Hono (Beta) + Cacao (Bones).
- **Free content delivery to library**: NOT seeded — `intro-to-typescript` is free + has explicit `complimentary` access for viewer only. There is **no fixture proving the "free goes to subscriber's library" path** because that path does not exist in the service layer.

**Gaps for the bead's flow**:
- No org with **zero tiers** (so the "creator creates 3 tiers" spec must use Studio Beta or a fresh org).
- No org with **Connect not yet onboarded** (so the "creator clicks Onboard" spec must use Studio Beta or a fresh org).
- No customer with **no subscription** to a tiered org (use `fresh@test.com` against Studio Alpha — this works).

## §5 — Infrastructure findings

- **Webhook strategy (existing tests)**: None of the existing E2E specs drive Stripe webhooks. The cancel flow works because `SubscriptionService.cancelSubscription` writes `cancel_at_period_end=true` directly to Stripe (real test-mode sub) AND updates the DB row optimistically — the webhook is fire-and-forget. **For step 5 ("subscribe to tier")**, however, the DB subscription row is created **only via webhook** (`handleSubscriptionWebhook` for `checkout.session.completed`). This means a real subscribe E2E **must** drive a webhook.
- **Webhook bridge available today**: `workers/ecom-api/src/utils/dev-webhook-router.ts:73` (`routeDevWebhook`) accepts `POST /webhooks/stripe/dev` with a single shared signing secret and dispatches to all four handlers based on event type prefix. The Stripe CLI usage pattern is documented in `workers/ecom-api/CLAUDE.md`: `stripe listen --forward-to http://localhost:42072/webhooks/stripe/dev`. **No `ALLOW_TEST_HOOKS` endpoint is required for happy-path flows.**
- **Helpers / fixtures available**:
  - `apps/web/e2e/fixtures/auth.ts` — `authenticateAsUser` (fresh unique user), `registerSharedUser` / `injectSharedAuth` (shared user across describe block).
  - `apps/web/e2e/helpers/studio.ts` — `setupStudioUser`, `registerSharedStudioUser`, `navigateToStudio`, `injectOrgCookies`. `setupStudioUser` already creates a fresh org + member with optional platform-role upgrade (auto re-login). **Strong reuse.**
  - `packages/test-utils/src/e2e/fixtures/org.fixture.ts` — `createOrgMember`, `createOrgWithMembers`. Used under the hood by studio helpers.
  - `packages/test-utils/src/e2e/helpers/http-client.ts`, `assertions.ts` — shared API assertions.
  - **Missing**: helper to assign a tier to content via UI; helper to subscribe a fresh user; helper to wait for a webhook to land (Stripe-CLI events are async — the dev-router fires in <1s on a warm worker but flake risk is non-zero).
- **Health probes**: every existing subscription spec uses the `request.get('http://localhost:42069/health')` pattern from `auth-flow.spec.ts` — copy-paste this into new specs. Per-worker probes for 42069 (auth), 42072 (ecom-api), 42075 (organization-api), 4001 (content-api) cover all subscription-relevant deps.
- **Idempotency pattern**: The seeded-viewer cancel spec relies on `afterEach → reactivateIfCancelling` (`account-subscription-cancel.spec.ts:108-112`). For specs that create fresh users + orgs (the steps 1-3 specs will), idempotency is automatic — each `Date.now()`-suffixed slug is unique. For specs that drive Stripe Checkout against the seeded viewer, you'll need a teardown step that **cancels any subscription created during the test** so the next run starts clean. The `subscription-cross-device.spec.ts:74-103` `afterEach` pattern (open a fresh browser context + clean up) is the canonical template.

## §6 — Step 8 ("Free for me") investigation

- **Where is the toggle?** It does not exist. `ContentForm.svelte` (`apps/web/src/lib/components/studio/ContentForm.svelte`) and `AccessSection.svelte` (`apps/web/src/lib/components/studio/content-form/AccessSection.svelte`) expose only `free`, `paid`, `subscribers`, `followers`, `team` access types and a `priceCents` field. There is no per-content "deliver to subscriber's library" toggle.
- **What does `accessType='free'` do today?** It means: anyone can stream the content (no purchase, no follow, no subscription, no tier) — see `getStreamingUrl` decision table in `packages/access/CLAUDE.md`. Free content is **publicly browseable** but does **NOT auto-populate** the user's library.
- **What does `listUserLibrary()` actually return?** Three buckets merged (`packages/access/src/services/ContentAccessService.ts:1199-1442`):
  1. **Purchased**: rows in `purchases` with `status='completed'`.
  2. **Membership**: content from orgs where the user has owner/admin/creator role (management only). Comment at line 1442 states explicitly: *"Including [followers' free content] here would pollute every subscriber's/follower's library with the full free catalogue."*
  3. **Subscription**: tier-gated content where the user's active subscription's tier ≥ `minimumTierId`. Free + non-tier-gated content is NOT included.
- **Is delivery tested?** Unit tests exist for the three branches (`packages/access/src/__denoise_proofs__/iter-007/F8-listUserLibrary-step1-sequential.test.ts`, `packages/access/src/services/__tests__/content-access-service-followers-subscription.test.ts`), but **no E2E** asserts library contents after a state change.
- **Recommendation**: Drop step 8 from the suite scope. File a separate **product** bead capturing the user's intent: "creators should be able to mark a free content as 'auto-deliver to library' so users discover it without an explicit purchase action". This is a feature design conversation, not an E2E test.

## §7 — Proposed gap-fill suite

Five new specs, ordered by build dependency. All sit under `apps/web/e2e/subscription/` (new directory) for filesystem clarity; CI path-gate at `apps/web/e2e/subscription/**`.

1. **`subscription/01-studio-connect-onboarding.spec.ts`** — Steps 1–2 (Connect happy-path UI)
   - Asserts: (a) `/studio/monetisation` for a fresh creator with no Connect account renders "Not connected" status; (b) clicking "Set up Stripe" calls `connectOnboard` and redirects to a Stripe URL (we intercept the redirect, do NOT follow); (c) for a creator with seeded Connect (use seeded `creator@test.com`), the page shows "Active" + dashboard link; (d) `connect-status` query returns `chargesEnabled=true`.
   - Fixtures: existing `setupStudioUser({ orgRole: 'owner', platformRole: 'creator' })` for the un-onboarded path; seeded `creator@test.com` for the active path.
   - Prereqs: none — uses existing helpers.
   - Runtime: ~25s.
   - Complexity: **S**.
2. **`subscription/02-studio-tier-crud.spec.ts`** — Steps 2–3 (tier creation + content gating)
   - Asserts: (a) creator creates 3 tiers (Bronze/Silver/Gold) via the `/studio/monetisation` dialog; (b) tiers appear in `listTiers` with stripeProductId/stripePriceMonthlyId set; (c) creator creates new content with `accessType='subscribers'` and `minimumTierId` set to the Bronze tier; (d) `listTiers` returns 3 tiers in correct sortOrder.
   - Fixtures: fresh creator+org via `setupStudioUser`. Cleanup via Stripe test-mode product archival is not needed because `cleanupStripeSeedObjects()` only cares about `metadata.codex_seed=true`; new test-mode tiers will accumulate but are bounded — see §9.
   - Prereqs: tier creation requires Connect to be active (UI gates on `chargesEnabled`). So this spec must run **after** spec 01 establishes the pattern, OR seed Connect for the test org. Recommend: extend `setupStudioUser` to optionally pre-seed a Connect account (S helper change).
   - Runtime: ~40s.
   - Complexity: **M** (helper extension).
3. **`subscription/03-customer-subscribe-checkout.spec.ts`** — Steps 4–5 (subscribe via Stripe Checkout)
   - Asserts: (a) `fresh@test.com` visits `studio-alpha.lvh.me/pricing` and sees 2 tier cards (Standard, Pro); (b) clicking "Subscribe" on Standard calls `POST /subscriptions/checkout` and redirects to `checkout.stripe.com`; (c) we drive completion via Stripe CLI: `stripe checkout sessions complete <session_id>` OR via test-card auto-fill on the hosted page (decide in §9); (d) after the webhook fires, `GET /subscriptions/current` returns the new subscription with `status='active'`; (e) the Standard tier card flips to "Current plan".
   - Fixtures: `fresh@test.com` (clean customer), seeded Studio Alpha (already has Connect + 2 tiers).
   - Prereqs: Stripe CLI must be running and forwarding to `localhost:42072/webhooks/stripe/dev`. Add a `playwright.config.ts` precondition probe that 503s if Stripe CLI is down (consistent with existing health-probe pattern).
   - Runtime: ~60s (worst — Stripe Checkout hosted page is slow).
   - Complexity: **L** (Stripe CLI orchestration is new).
4. **`subscription/04-tier-gated-content-access.spec.ts`** — Step 6 (access tier-gated content)
   - Asserts: (a) the freshly subscribed user from spec 03 (or seeded `viewer@test.com` for isolation) navigates to `/content/typescript-deep-dive` (Standard-tier content); (b) the player mounts; (c) `getStreamingUrl` returns 200 with a signed R2 URL; (d) navigating to `/content/advanced-svelte-patterns` (Pro-tier content) renders the AccessRevokedOverlay or pricing CTA — verifies tier ≥ minimum check.
   - Fixtures: seeded viewer (Standard sub already exists per `commerce.ts:678-697`). **No new fixture work.**
   - Prereqs: none.
   - Runtime: ~20s.
   - Complexity: **S**.
5. **`subscription/05-library-subscription-badge.spec.ts`** — Step 7 (library shows subscription content with badge)
   - Asserts: (a) seeded viewer logs in, navigates to `/library`; (b) the library shows `typescript-deep-dive` (Standard tier match) with `accessType='subscription'` badge; (c) filtering library by "Subscription" tab keeps it visible; (d) `intro-to-typescript` (free + complimentary access record) appears with `accessType='complimentary'` or similar.
   - Fixtures: seeded viewer.
   - Prereqs: none.
   - Runtime: ~15s.
   - Complexity: **S**.

**Sum runtime estimate**: ~160s (well under the 5-min budget; spec 03 dominates).

## §8 — Prereq infrastructure changes

- **`packages/database/scripts/seed/commerce.ts`** — No change needed for the 5 specs above (the seed already provides Connect active + tiers + sub for the cancel/access happy path). Optional improvement: emit a **second** Connect-not-yet-active org so spec 01's "un-onboarded" path doesn't have to spin up a fresh org via `setupStudioUser`. **No bead today** — not blocking.
- **`apps/web/e2e/helpers/studio.ts`** — Extend with `setupStudioUserWithConnect(options)` that calls the existing factory + writes a `stripeConnectAccounts` row directly via `dbHttp` (mirroring `commerce.ts:758-772`). This unblocks spec 02 without standing up a real Stripe Connect account in the test. **No bead today** — file a new one.
- **`apps/web/e2e/helpers/subscription.ts`** (NEW) — Three helpers: `cancelAnyActiveSubscriptions(userId)` (idempotent teardown), `triggerStripeCliEvent(eventType, fixture)` (wraps `stripe trigger ...`), `waitForSubscriptionRow(userId, orgId, opts)` (polls DB until webhook lands, with timeout). **No bead today** — file a new one.
- **`apps/web/playwright.config.ts`** — Add an optional Stripe CLI webServer entry guarded by `process.env.STRIPE_CLI_AVAILABLE` so spec 03 skips cleanly when the CLI isn't available locally. **No bead today** — small inline change.
- **Existing skipped specs**: `pricing-reactivate.spec.ts`, `streaming-revocation.spec.ts`, `subscription-paused-resumed.spec.ts`, `progress-save-access-gate.spec.ts` all reference Codex-z1wuz which **is closed**. Either re-enable them (if still applicable post-z1wuz fix) or update their skip messages. **Recommend**: file a single follow-up bead — "Audit & re-enable subscription-suite skipped specs after z1wuz close". Likely candidates for re-enable: `pricing-reactivate.spec.ts` (per its own author note, "Delete the `test.skip` lines once z1wuz lands"). Likely candidates for new ALLOW_TEST_HOOKS dependency: `streaming-revocation`, `progress-save-access-gate`, `subscription-paused-resumed` (still need a way to forge revocation/pause events without driving Stripe).
- **CI path-gate config** (likely `.github/workflows/e2e.yml` or similar — not read here) — Add `apps/web/e2e/subscription/**`, `workers/ecom-api/**`, `packages/purchase/**`, `packages/access/**`, `apps/web/src/routes/_org/[slug]/(space)/pricing/**`, `apps/web/src/routes/_org/[slug]/(space)/checkout/**`, `apps/web/src/routes/_org/[slug]/studio/billing/**`, `apps/web/src/routes/_org/[slug]/studio/monetisation/**`, `apps/web/src/routes/(platform)/account/subscriptions/**` to the trigger paths. **File a bead for the CI config change** if not already covered.

## §9 — Open questions for the user

1. **Stripe Checkout completion strategy for spec 03** — Stripe-hosted checkout is the friction point. Three options:
   - **A.** Drive `stripe trigger checkout.session.completed --override checkout_session:metadata.session_id=<id>` after the redirect. Keeps the hosted page out of the test.
   - **B.** Have Playwright fill the test card on the hosted Stripe form (`4242 4242 4242 4242`). Slower (~30s for the page round-trip), brittle if Stripe redesigns.
   - **C.** Stub the redirect — intercept the `Location` header from `/subscriptions/checkout`, fabricate a session-completed event with the correct `metadata.codex_*` fields, and POST it to `/webhooks/stripe/dev`. Fastest, but moves us furthest from a real flow.
   - **Recommended default: C** for happy-path coverage in CI, with **A** preserved for nightly/manual confidence runs. The bead's stated purpose is "all 10 steps must pass" — exercising the redirect URL is enough; we don't need the hosted page round-trip.
2. **Test isolation for newly created subscriptions** — Spec 03 leaves a Stripe test-mode subscription on the seeded viewer (or fresh user). Options:
   - **A.** Cancel via API in `afterEach` (current cancel-spec pattern).
   - **B.** Let `commerce.ts:cleanupStripeSeedObjects` archive on next seed run (lazy).
   - **Recommended default: A.**
3. **Should we re-enable the 4 skipped subscription specs** (`pricing-reactivate`, `streaming-revocation`, `subscription-paused-resumed`, `progress-save-access-gate`) **as part of this scope, or in a follow-up?**
   - **Recommended default: follow-up bead.** Their value is independent of x0pa's 10 steps, and `pricing-reactivate`'s skip is the easiest unblock since z1wuz is closed.
4. **Step 8 ("Free for me") — file a separate product bead, drop entirely, or reinterpret as "subscribed user sees free content in library"?**
   - **Recommended default: file a separate product bead.** This is a UX / data-model decision, not an E2E gap.
5. **Should spec 02's tier-creation drive **real** Stripe Product/Price creation** (slow, real network) **or stub the `tier.create` remote function?**
   - **Recommended default: real.** The seed already does it; the path is part of the bead's contract; runtime impact is ~5s per tier.
6. **Suite naming + grouping** — Put all 5 in `apps/web/e2e/subscription/01-…` etc., or sprinkle them by surface (some in `studio/`, some in `account/`)?
   - **Recommended default: dedicated `subscription/` directory** so the CI path-gate trigger paths are simple to match.

## §10 — Recommended scope (TL;DR repeated as actionable)

If you want to ship x0pa in **2-3 implementation sessions**:

- **Session 1** (~half day) — Land helpers (`subscription.ts` helper module) + spec 01 (Connect onboarding) + spec 02 (tier CRUD). Both are S/M complexity, exercise the studio-side surfaces, and give immediate green coverage on the steps with zero coverage today.
- **Session 2** (~full day) — Land spec 03 (subscribe via checkout) using webhook strategy C from §9.1. This is the L spec; budget time for Stripe CLI / webhook orchestration tuning. Add the playwright.config.ts CLI-availability probe.
- **Session 3** (~half day) — Land specs 04 + 05 (tier-gated stream + library badge) — both S, both reuse seeded viewer, both straightforward assertions on existing UI.
- **Defer**: skipped-spec re-enable audit, "Free for me" product conversation, second seeded org without Connect — file follow-up beads.
- **Close x0pa** when specs 01–05 ship green at <5min total runtime and steps 9–10 (already covered) are explicitly cited as "not in this PR's diff but cited in the spec inventory".

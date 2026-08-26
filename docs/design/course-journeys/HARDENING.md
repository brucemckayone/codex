# Phase-A hardening — prototype review + FE/BE/design/cache mapping

**Status:** hardened analysis, 2026-07-23. Produced by a 12-agent review fleet (6 grounding
deep-reads → 5 adversarial re-checks against live code → 1 synthesis) run against
[`SPEC.md`](./SPEC.md) v2 + [`FRONTEND-MAP.md`](./FRONTEND-MAP.md) + the 13-surface
[`./prototype/`](./prototype/). Epic `Codex-2pryk`, tracking bead `Codex-yfdcw`.

**Authority:** where this doc's findings correct SPEC.md or FRONTEND-MAP.md, **this doc wins**
(it was verified `file:line` against the live codebase; the older docs carry stale anchors).
Critical model-level corrections have also been folded inline into SPEC/FRONTEND-MAP with a
pointer back here. This is the decision document that feeds `codex-epic-create` (Phase B).

**Read order for building:** SPEC.md (model) → FRONTEND-MAP.md (surface→component) → **this doc**
(corrections, conflicts, parallelization, open questions).

> Every non-obvious claim below carries a `path:line` anchor verified during the pass. The
> bead-status/PR-number framing in §F is from the caching agent and was **not** re-verified
> against the tracker (per the pass's "code is authoritative, tracker is not" rule); the
> branch/file/schema facts underlying each conflict **are** verified.

## Decisions (2026-07-23, from user)
1. **accessType** → hard-replace in one atomic PR (H1).
2. **followers/team** → explicit flags `isFollowerGated` + `isTeamOnly` (H2 — user overrode the "fold" recommendation).
3. **Course-sub billing** → separate Stripe product per course + `planId` FK (H3).
4. **Epic structure** → **three epics**: Cleanup (Epic 0) → Foundations (Epic 1) → Surfaces (Epic 2) — see §G.
5. Proceeding unless overridden: media completion auto-writes on genuine finish, written stays explicit (H5);
   reporting ships `live`+`course`, `track` dropped for v1 (H9); course purchases depend on h69cg landing (in-flight).
6. **VERIFIED 2026-07-23 (two Phase-A gates cleared):** cijzb brand-studio **is on dev** (PR #398 merged 2026-07-20)
   → WP-5 unblocked (H6); nk4km is **closed** → `revenueType` landed, course-revenue is a WP-6 design detail (H4).

---

## A. Prototype fix list

Deduped, prioritized. Only `prototype-fix` rows are applied to the mockup now; `real-build-concern`
rows are logged for the epic (they resurface in later sections).

| Surface (file:line) | Fix | Sev | Type |
|---|---|---|---|
| checkout.html:150-152 ← content-standalone.html:220 | `offer=buy` fails `O.paths.some()` and silently falls back to £12 membership. Add a `content_purchase` single-item summary/confirm path so a "buy for £9" pick isn't bait-switched into a course sub. | High | real-build-concern (fix scent in proto: route content buys to a distinct confirm) |
| course-dashboard.html:159 | New-Member arrival not walkable: `COURSE` seed has `done:4` so first-run "Begin" branch is dead. Add `?state=new`/`?first` to force `done=0`; point checkout confirm CTA at it (mirror library.html:202). | High | prototype-fix |
| course-sell.html:1987 | Descent copy "settle one ground before the next opens" implies sequential-unlock; contradicts D4 + reframed in-course gate. Reframe to payment-framing ("all five depths open when you join"). | Med | prototype-fix |
| course-sell.html:382-385,44,3533-3537 | "Begin free" hero/float CTA link to `#invite` (paid-primary £12); real free door is de-emphasized. Point "Begin free" at `content-standalone.html?free=1`/`#feel`, or relabel to match the paid invite. | Med | prototype-fix |
| content-standalone.html:231 | Owned-state hardcodes `'via full membership'`; showcase item is `content_purchase` (mock-data.js:199). Derive `via` from entitlement source ("purchased"). | Med | prototype-fix |
| explore.html:269 ← content-standalone.html | Free/`course-only`-badged cards all open the locked showcase. Pass `?free` for free items so scent matches. | Med | prototype-fix |
| course-sell.html:39, course-dashboard.html:97 | Dev chrome: "← concepts" → index.html + "Sales preview"/"Inside the journey" labels. Strip escape-hatch, rename to product labels. | Low | prototype-fix |
| reporting.html:115-116 | 7d/30d/All toggle has no handler. Wire a no-op visual `.on` swap (or remove). | Low | prototype-fix |
| explore.html:132 / library.html:148 / content-standalone.html:105 vs member surfaces | Same top-bar slot points owners at the marketing "buy" page ("Rootwork" → course-sell) vs members' "Your journey" → dashboard. Standardize an entitlement-aware journey affordance. | Med | real-build-concern |
| mock-data.js:90-98,78-82 / explore.html:263 / course-editor.html:181 | Access-source lexicon drift ("members"/"via membership"/"subscribers"/"Included"). Pin one lexicon mapped to SPEC §6.1 (free / purchased / included-in-tier / part-of-course). | Med | real-build-concern |
| content-incourse.html:235-248 | Completion end-state fires on position (`?i=` last), not real all-complete. Gate celebration on genuine completion. | Med | real-build-concern |
| library.html:289 | Both in-progress "Continue" cards resume Rootwork (single dataset). Carry `courseId` + resume index. | Low | real-build-concern (single-dataset) |
| studio-journeys.html:142-151,187 | Card actions carry no id; every card opens Rootwork editors; landing-page "Winter offering" "Edit page" → course builder. Route by `[id]` + branch builder on `pageType`. | Low | real-build-concern |
| explore.html:131-133 | Public Explore foregrounds members-only "Library" to anon. Auth-aware nav. | Low | real-build-concern |

**Keep-list (do not regress):** `canView` vs `canEnterCourse` owned-not-enrolled state
(content-standalone.html:234-249, `?notenrolled`); per-type completion gate
(content-incourse.html:206-221); `?i=` walkable sequence + peak-end moment; reporting provenance
legend (reporting.html:35-46); library access-source grouping + resume rail + first-run; checkout
offer architecture (no hard-preselect, `?offer=` deep-link).

**Confirmed absences (real-build):** no skeleton states on any streamed surface (F15); no id/param
threading through studio/member surfaces; course-editor + sales builder intentionally desktop-only
(<900px "needs more room") — deliberate, but creators cannot author on mobile.

---

## B. Doc deltas — SPEC.md & FRONTEND-MAP.md

The edit list, grounded in harden corrections. Both docs claim v2 "grounded against live schema"
but carry stale anchors — these correct them. (Items marked ✅ have been folded inline; the rest
live here as the record.)

**SPEC.md**

1. **§5 line 124** — "mirror `syncContentCategories`" — that helper **does not exist**. Replace with:
   *space guard via `spaceWhere` (`categories-service.ts:414`, a `private spaceWhere(space): SQL[]`) +
   service-layer scoping.* ✅
2. **§6.2 code block (lines 165-172)** — add explicit column types: `userId` MUST be **`text`** (not
   implied uuid) — `users.id` is `text('id').primaryKey()` (`users.ts:30`). Every user FK in
   §5/§6/§11 pseudo-code (`entitlements`, `course_subscriptions`, `practice_completions`,
   `course_enrollments`) must be `text`. **Highest-value correction.** ✅
3. **§6.2 `source` enum (line 169)** — annotate that `'tier_subscription'` is **resolver-output-only,
   never inserted**. Recommend: omit it from the DB write-path CHECK; keep it only in the TypeScript
   union. A documented "we don't insert it" convention is not enforced and is a latent
   instant-revocation bug (SPEC §6.2 line 178 mandates tier grants derived). ✅
4. **§6.1 (lines 153-159)** — flag the **lossy mapping**: current `content.accessType` CHECK =
   `free|paid|followers|subscribers|team` (`content.ts:349-350`), but the 4-flag model has **no home
   for `followers` (free-opt-in gate) or `team` (management-only)**. Both are live code paths
   (`ContentAccessService.ts:789/742`). SPEC must state where `followers`/`team` land (drop? map to
   new flags? separate policy?). This is a migration gap, not a rename. → **Open question H2.** ✅
5. **§6.1 `includedInTierId`** — add: preserves the **"this tier and above by sortOrder"** semantic
   (`ContentAccessService.ts:410`, `content-detail.ts:289`); it is a 1:1 rename of `minimumTierId`
   (same FK, `set null`), not a redefinition.
6. **§6.3/§6.4 resolver pseudocode** — add two arms the pseudocode omits but live code requires:
   (a) **management-role bypass** (owner/admin/creator view all org content —
   `ContentAccessService.ts:414-416,432-433,459,465`, load-bearing for studio/builder preview);
   (b) **orgless-content-with-tier fail-closed deny** (`ContentAccessService.ts:342-352`, Codex-up7bx).
   "Collapse the two trees" must not drop these. ✅
7. **§6.4** — note `getStreamingUrl` runs the check **inside `db.transaction`** and fires
   `getProgress` in parallel; the "success-with-null-URL = written article has access" semantic
   (`content-detail.ts:197-199`) must be preserved. Not a bare substitution.
8. **§15 appendix (line 423)** — "`'members'` is a stale alias for `'team'`" is correct for the
   constant comment, but the **schema column comment `content.ts:263` is itself stale** (lists
   `free|paid|subscribers|members`, omits followers/team). The CHECK (`:350`) is the truth; also flag
   the third drifted enum `ACCESS_TYPES` (`constants/content.ts:37-43` =
   `free|purchased|subscription|complimentary|members_only`) whose callers the entitlements work must audit.
9. **§7** — add a **payout-coupling requirement**: course purchase + course-sub paths MUST route
   through `writePurchasePayouts`/`executeTransfers`/split-CHECK/GBP-guard/idempotency, or creators go
   unpaid. Coupling to revenue-share (Codex-nk4km): `creator_organization_agreements.revenueType`
   CHECK allows only `subscription|content_purchase` (`ecommerce.ts:373-375`) — course revenue needs a
   decision (§D / open question H4).
10. **§7 `course_subscriptions`** — add a `planId` decision: `subscriptions` anchors price via `tierId`
    (`subscriptions.ts:101`); proposed `course_subscriptions` (courseId only) has no column to record
    which plan/Stripe price when a course has >1 plan (blocked on open decision #2). Also note
    `pendingPayouts.subscriptionId` hard-FKs `subscriptions` (`subscriptions.ts:290`) — not
    polymorphic; course-sub payouts need a second nullable FK + CHECK-one.
11. **§11 `practice_completions`** — flag the **`(userId, contentId)` cross-course completion bleed** as
    a reporting-integrity decision (not just UX): a shared practice counts complete in every course's
    funnel via the §11 join. Confirm acceptable before building the rollup. → **Open question H8.**
12. **§12 caching** — strengthen "cache narrowly (short TTL or per-request)" to **per-request or
    version-keyed only; a short-TTL persistent entitlement cache is prohibited** (violates
    `cache/CLAUDE.md:99` + §6.2 instant-revocation). Add: per-request resolver must be **batched** (one
    query for all courses on a dashboard) to avoid N+1 on Neon HTTP.

**FRONTEND-MAP.md**

13. **§5.2 SubscribeButton row (line 120)** — CORRECTION: `SubscribeButton` is **org-subscription-only**
    (reads `subscriptionCollection.state.get(organizationId)`, `SubscribeButton.svelte:94`; links
    `/account/subscriptions`). It models none of SPEC §7's three course paths. The **entire
    `components/subscription/*` family** (SubscribeButton/SubscribeCTA/SubscribeStickyBar/HealthBanner)
    is org-bound. Offer/pricing cards are **fully net-new**; grep for `TierCard|PricingCard|PlanCard|OfferCard`
    = 0 hits (tier cards inlined in `pricing/+page.svelte`). ✅
14. **§5.2 "Continue rail" row (line 122)** — remove `browse/BrowseModule` as an option: it is a
    type/category **grid** with controlled `onTypeChange/onCategoryChange`, not a horizontal rail. Only
    `Carousel` fits.
15. **§5.2 "player.css" (line 127)** — filename is `VideoPlayer/styles.css`; inverse-chrome tokens live
    in `styles/tokens/player.css`. Two files, not one.
16. **§5.3 #8 (line 150)** — "no generic KPI-tile primitive exists" is **false**:
    `studio/analytics/KPICard.svelte:31` (money=pence GBP, sparkline, `valueContent` Snippet) +
    `studio/StatCard.svelte:17` exist. Journey insight tiles are a **reuse/variant of KPICard**, not
    net-new. (Internally contradicts §5.2 line 134 which already lists `studio/analytics/*`.) ✅
17. **§5.4 "Share as-is: BrandStudioCanvas" (line 153)** — overstated. Canvas is **coupled to the
    brand-editor store** (`import { brandEditor }` `BrandStudioCanvas.svelte:25`, reads `editingTheme`,
    calls `setEditingTheme`), hard-depends on `CanvasToolbar.svelte`, `resolvePreviewPath`
    (`preview-canvas.ts:87`), and a fixed **4-member** `PreviewRouteId` catalog (`preview-canvas.ts:15`
    = `landing|grid|detail|player`, not 3). Reuse = "clone the stable-iframe pattern + supply a journey
    route catalog + toolbar + parameterize the theme source," not share-as-is. ✅
18. **§5.4 boundary-script path (line 167)** — actual path is
    `apps/web/scripts/check-brand-editor-boundary.mjs` (the map is right; the inventory dropped the
    prefix). **GAP:** the gate scans `src/routes` only (`:38 ROUTES_ROOT`, `:94 walk`), never `src/lib`.
    The page-builder public renderer lives in `$lib/page-builder/` (a lib module); if it statically
    imports `$lib/components/page-builder/*`, the editor bundles into the public chunk and the
    routes-only scan stays green. The gate MUST additionally treat `$lib/page-builder/**` as a scanned
    root (or assert it never imports `$lib/components/*`). "Generalise to an array of banned modules"
    does not close this. ✅
19. **§6.3 grounding rule (line 186)** — "check `ui/index.ts` before making a primitive" is
    **unreliable**: `ui/index.ts` is a partial barrel (ContentCard/PriceBadge/Accordion/Breadcrumb/
    FilterBar/DataTable/ShaderHero etc. are **not** in it). Change to "grep `ui/*/index.ts` subdirs too."
20. **§5.4 routes table (line 170)** — "each gets a `+page.server.ts` role gate" is not the house
    pattern: only `studio/brand` + `studio/categories` have one; `studio/content`/`analytics` gate
    client-side. Correct to: **server-gate mutating routes** (curriculum, builder — brand pattern) and
    **client-gate read-only routes** (list, insights — analytics pattern). Byte-clone predicate is
    `userRole !== 'admin' && userRole !== 'owner'` (`brand/+page.server.ts:22`).
21. **§1 course-dashboard row (line 39)** — add the SSR gap: dashboard sits under `(space)` which is
    **SSR by default** (no override anywhere in `(space)/`). "Non-SSR" needs an explicit local
    `export const ssr=false` (`content/new/+page.ts:2` precedent) while keeping `+page.server.ts` for
    the `canEnterCourse` gate.

---

## C. accessType replacement — verdict

**Verdict: HARD-REPLACE (resolves SPEC §12 open decision #5).** Pre-prod greenfield, D2 locks it, zero
rows to migrate; a shim manufactures debt for data that doesn't exist and complicates the resolver. But
it must ship **atomically in one PR** (the epic mandates one PR anyway) — dropping the columns breaks
~8 consumer areas on one compile front, and main runs preview-only
(`feedback_main_needs_static_analysis_gate`) so a partial landing is undetected-red.

**Two axes — do NOT conflate (the grep trap):**
- **Axis A (replace):** `content.accessType` (`content.ts:264`, CHECK `:348-351` =
  `free|paid|followers|subscribers|team`) + `content.minimumTierId` (`:272`, `set null`) + constant
  `CONTENT_ACCESS_TYPE`. → `isFree`/`isPurchasable`/`includedInTierId`/`courseOnly`.
- **Axis B (leave alone):** `contentAccess.accessType` grant record (`ecommerce.ts:44` =
  `purchased|subscription|complimentary|preview`, FK `contentId` **cascade** `:33` — not restrict). This
  is the ancestor of §6.2 `entitlements.source`, superseded separately, not by §6.1.

**Blast radius (readers/writers of Axis A):**
- `packages/access/src/services/ContentAccessService.ts` — **2399 lines** (not "~550"); two duplicated
  decision trees: `hasContentAccess` (`:309-470`, branches `:414/419/436/449`) and `getStreamingUrl` tx
  (`:742/789/868/949`) + `getUserContentAccessType` mapper (`:414-436`). Biggest single rewrite; the
  resolver collapses both into `canView`.
- `packages/constants/src/content.ts:60-69` (`CONTENT_ACCESS_TYPE`) — every importer compile-breaks
  (good; finds callers).
- `packages/content/src/services/content-service.ts:267-283,437-469,914-915` — the
  (accessType,minimumTierId) normalization/coupling disappears.
- `packages/validation/src/content/content-schemas.ts:371-514` — **~8 `.refine` blocks** (not 5) coupling
  accessType↔tier↔price↔org, all rewritten.
- `packages/subscription/src/services/tier-service.ts:584-593` — tier-delete sweep nulls `minimumTierId`
  → retarget to `includedInTierId` + add `course_tier_access` sweep.
- `apps/web`: `lib/server/content-detail.ts` (`isPublicAccessType:152`, `loadSubscriptionContext:248-290`),
  `lib/server/api.ts:133` (type union), `lib/utils/{subscription-context,access-context}.svelte.ts`,
  `PriceBadge`/`ContentCard` badge logic, `_creators/[username]/…/+page.server.ts` (shares the helper),
  display components.
- **Seeds (3 files, not 2):** `seed/constants.ts`, `seed/content.ts:135-190` (write-path force-nulls
  tier), `seed/validate.ts:13-15,52-75` (invariant asserts + `AccessKind` union). CI seed-validate reds
  the moment columns change — treat seed rewrite as a required WP.
- Test suites: `ContentAccessService.integration.test.ts` (2000+ lines), `content-service.test.ts`,
  `tier-service.test.ts`, `content-schemas.test.ts`, `access-context.test.ts`, e2e
  `02-studio-tier-crud.spec.ts`. Rewrite as spec, don't skip (`feedback_test_drift_fix_not_skip`).

**Migration approach:** `pnpm db:generate` (Drizzle, never hand-write SQL); latest is `0078_*` → `0079+`.
DDL over the **direct** Neon endpoint, not `-pooler` (`feedback_neon_pgbouncer_ddl_breaks`); local via
`docker exec neon-postgres-1 psql`. Polymorphic `entitlements`/`landing_pages.subjectId` create no FK
ordering constraints. **Security-critical:** the `canView` swap is **one shared helper
(`content-detail.ts loadAccessAndProgress`) feeding two routes** (org `(space)/content/…` +
`_creators/[username]/content/…`, docstring `:1-11`) plus the worker-side `@codex/access` gate — rewire
in `@codex/access` so org and creator routes can't diverge (partial rollout = leak: `courseOnly` denied
on one URL, served on the other).

---

## D. Monetization / Stripe — net-new vs reuse

**Three §7 paths mapped to existing infra:**

| Path | Reuses | Net-new |
|---|---|---|
| One-off course purchase (`courses.priceCents`) | `PurchaseService.createCheckoutSession/completePurchase`, `checkout.ts` route, Stripe webhook, revenue-split/payout ledger (`purchase-service.ts:807`) | `purchases`/`contentAccess` are `contentId`-keyed (restrict on `purchases.contentId:425`); a course has no contentId → grant lands in `entitlements(resourceType='course')`. Checkout accepts `courseId`. |
| Course-specific subscription (`course_subscription_plans`/`course_subscriptions`) | `SubscriptionService`+`TierService` Stripe product/price sync, subscription webhooks, self-heal `ensureSubscriptionDataPresent` | Entire new `CourseSubscriptionService`; **blocked on open decision #2** (per-course product vs metered add-on). |
| Org tier → course (`course_tier_access(courseId,tierId)`) | tier derivation `hasSubscriptionAccess` sortOrder compare (`:404-410`) — reusable as-is; subscriptions already grant live | Explicit join (not min-tier) + derivation arm + tier-delete sweep. |

**Entitlement-write seam:**
- **Purchase:** `purchase-service.ts:781` — the `contentAccess` upsert inside the tx (atomic, idempotent
  via `stripePaymentIntentId` unique). Exactly where the `entitlements` insert goes.
- **Subscription:** today writes **no** grant row (tier access derived — grep-confirmed 0 writes in
  `packages/subscription`). §6.2 keeps **course-subs stored** but **tier-subs derived** — asymmetry.
  Concrete failure mode: the course-sub `entitlements` write must live in the **self-heal helper**
  (`ensureSubscriptionDataPresent`), not only `subscription.created` — else an out-of-order
  `invoice.payment_succeeded`-first delivery = paid-but-locked-out.

**Money-path + payout-coupling risks:**
- New course paths **MUST reuse** `writePurchasePayouts`/`executeTransfers`/split-CHECK/`assertGbpOnly`/
  idempotency-keys or creators go unpaid. But `writePurchasePayouts` resolves `creatorId` from the
  **content row** (`:802`) and `purchases` CHECK enforces `amountPaid = platform+org+creator` with
  `contentId` NOT NULL — a course sale needs course→creator resolution + a nullable/polymorphic purchase
  target. Not reusable unchanged.
- **Cross-epic (Codex-nk4km):** `revenueType` CHECK allows only `subscription|content_purchase`
  (`ecommerce.ts:373-375`); a course revenue event has no allowed type. Adding one touches the CHECK, the
  `@codex/agreements` state machine, proposals CHECK (`:259`), thread index (`:241`), and partial-unique
  `uq_creator_org_agreement_active_per_type` (`:397`) — **in nk4km's live files (WP-1/WP-6 in flight)** →
  direct `ecommerce.ts` merge contention.
- **Registry additions** (`service-registry.ts`): `EntitlementsService` (lazy, injected into
  `ContentAccessService` like `purchase` at `:373`), `CourseService`, `LandingPageService`,
  `CourseSubscriptionService` (must use `getLazyStripeClient():203` + `feeConfig:registry.feeConfig`).
  Course/entitlement reads + streaming gate → **content-api** (port 4001, co-located with access); course
  checkout/subscription/webhooks → **ecom-api**. No new worker.

---

## E. Data-fetching + caching plan (per surface, condensed)

Routes under `_org/[slug]/`. Public = new `(space)/journeys/`; studio = `studio/journeys/`.

| # | Surface | Render | Resolver invocation | Caching |
|---|---|---|---|---|
| explore | `(space)/journeys` (or extend explore) | SSR shell+stream (P1), auth-aware sort (`explore/+page.server.ts:145`) | none (public discovery) | `COLLECTION_ORG_PAGES/COURSES` version; **note: explore serves `PRIVATE` on both branches (:146/:206)** → not CDN-cacheable; needs a deliberate `DYNAMIC_PUBLIC` decision, not inheritance |
| course-sell | `(space)/journeys/[slug]/+page.server.ts` | SSR shell+stream; await sections+course+stages+testimonials (SEO), stream sell-preview + related | **no `canView` on the shell** — public preview = existing 30s `preview.m3u8`/`HeroInlineVideo` (no auth); `canView` only for authed guide video + free-taste door — must not block first paint/SEO | `PAGE_CONFIG`/`COURSE_CONFIG` version-bump (auth-agnostic payload cached; entitlement layered per-request); shell is `PRIVATE` unless split (org layout injects `user` → auth-varying HTML) |
| checkout | `(space)/journeys/[slug]/checkout/+page.server.ts` + form action | SSR + form action (mirror `content/[contentSlug]/+page.server.ts:170 handlePurchaseAction`) | none pre-pay; success writes `entitlements` via webhook; `if(!locals.user)` deferred (account-after-payment, U1/F17) | not cached (prices server-authoritative) |
| content-standalone | **reuse** `(space)/content/[contentSlug]/` | SSR shell+stream (existing) | `canView` replaces `getStreamingUrl`-throws gate in shared `content-detail.ts`; adds `?notenrolled` (canView✓/canEnterCourse✗) | existing PRIVATE + streamed `accessAndProgress` |
| library | `(space)/library` (extend) | **Client-TanStack** (existing `libraryCollection` localStorage, no `+page.server.ts`, client `$effect` guard `:33-35`) | resolver feeds new/extended `getJourneyLibrary` query() — grouping by course = **collection-schema change** (`hydration.ts` version branch + cross-org filter, shared with platform `/library`; `listUserLibrary` needs a **4th course-entitlement source arm**) | `COLLECTION_USER_LIBRARY` version; **R-B: schema change strands stale localStorage → empty library until cache-bust** — needs `hydration.ts` version branch |
| course-dashboard | `(space)/journeys/[slug]/dashboard/` + **local `ssr=false`** | SPA; `+page.server.ts` runs `canEnterCourse` gate server-side (P4), returns enrollment + progress rollup; client hydrates | `canEnterCourse` (server load) → redirect to sell if false | per-request/batched entitlement (never cross-user cache); `initProgressSync` already covers this subtree (org layout) |
| content-incourse | `(space)/journeys/[slug]/practice/[contentSlug]/` (or `?i=` on dashboard) | SPA (ssr=false) | `canView` (practice stream) + `canEnterCourse` (in-course chrome) | as content-standalone |
| studio-journeys | `studio/journeys/+page.svelte` | Client `query()`, no server load (P5, mirror `content/`); client `$effect` gate | `listJourneys({orgId,status})` reactive off URL | `live` rollups streamed |
| builder-new | `studio/journeys/new/` (`+page.ts` ssr=false) | Client; `command()`/`form()` create | inherit studio gate | — |
| course-editor | `studio/journeys/[id]/curriculum/` | Client `query()` + `command()`/`form()` CRUD | admin/owner **server** `+page.server.ts` gate (mutating) | `waitUntil(invalidate(course:config:{courseId}))` per mutation |
| builder (sales) | `studio/journeys/[id]/page/` + `+page.server.ts` | Clone `studio/brand/`: `BrandStudioLayout`, same-origin iframe of `(space)/journeys/[slug]`, new `codex:page-preview:v1` bridge | admin/owner server gate | `invalidate(page:config:{pageId})` + collection keys |
| reporting | `studio/journeys/[id]/insights/` | Client `query()`, no server load (P5, mirror `analytics/`); provenance-tagged | client `$effect` gate | consume `live` now; `course` after new tables |

**Caching mechanics (critical):** `VersionedCache` keys version by **`id` alone**
(`versioned-cache.ts:110`); all types under one id share a version. Pick **ONE id space (stable
`pageId`/`courseId`, never slug)** and use it byte-identical in write + `getVersion()` + `invalidate()` —
the live `ORG_CONFIG` bug (written by `slug`, streamed by `org:config:{orgId}`, invalidated key nobody
writes) proves misalignment silently no-ops streaming. **Also:** client staleness dispatch is
**substring-match** (`k.includes(':content')`, `_org/[slug]/+layout.svelte:245-251`) — a new
`:pages`/`:courses` key matches no branch and is inert without a new branch; recommend exact-key mapping
as a prerequisite refactor. New `CacheType.PAGE_CONFIG`/`COURSE_CONFIG` + `COLLECTION_ORG_PAGES/COURSES`,
FEE_CONFIG version-bump precedent (no meaningful TTL). **Entitlement reads: per-request or version-keyed
only — short-TTL persistent cache is prohibited** (`cache/CLAUDE.md:99` + §6.2). Tier-derived grants break
per-user version keys (editing `course_tier_access`/tier sortOrder changes many users, touches none of
their keys) → per-request is the safe default; batch the resolver to avoid dashboard N+1.

**F19 shared-progress-store resolution:** Extend the **existing `progressCollection`**
(`collections/progress.ts:53`; already SSR-safe, localStorage, cross-device-synced via `initProgressSync`,
`browser`-guarded) with course/completion fields; hydrate from server load; player/standalone/dashboard/
library all `useLiveQuery` off it. Completion writes via new `command()` (mirror `savePlaybackProgress`,
`library.remote.ts:249`) → server `practice_completions`, version-bump invalidation. **Do not** add a
parallel course-progress store. Note: content page today reads streamed `accessAndProgress` into `$state`,
NOT the collection (`content/[contentSlug]/+page.svelte:104`) — two representations exist; F19 is unmet by
current code. Also note `savePlaybackProgress` already auto-sets `completed=true` at 95% — collides with
§14.3(a) media auto-completion; the completion write seam must reconcile these.

---

## F. Cross-epic conflicts + required sequencing

| Item | Verdict | Sequencing |
|---|---|---|
| **brand-studio clone target (Codex-cijzb)** | 🟢 **RESOLVED (verified 2026-07-23)** | The clone surface (`components/brand-studio/*`, `studio/brand/*` route, `brand-preview-bridge.ts`) **IS on `origin/dev`** — PR #398 merged 2026-07-20T12:36Z. The Phase-A "absent from dev" claim was a **stale-ref error**. **WP-5 is NOT blocked.** (The cijzb *epic* bead is still open for deferred follow-ups, but the clone target is available; the "93 svelte-check errors" were the cold-check false-cascade, not real.) |
| **`content.accessType` hard-replace** | 🟠 COLLISION (self-contained) | No other active branch mutates Axis A (the `visibility→accessType` migration already landed, historical). Do it as the schema WP + resolver WP immediately after. Must ship atomically (§C). |
| **Revenue-share (Codex-nk4km)** | 🟢 **LANDED (verified 2026-07-23)** | nk4km is **CLOSED** — the `revenueType` CHECK + agreements state machine in `ecommerce.ts` have shipped. No live-file contention. Adding course revenue is now a **design choice against stable code** (reuse `content_purchase` terms, or add a `course_purchase`/`course_subscription` revenueType) — see H4. |
| **Payout parity (Codex-h69cg)** | 🟢 OVERLAP-REUSE | h69cg (in-progress) fixes one-off purchases writing nothing to the payout ledger + hardcoded `DEFAULT_ORG_FEE_PERCENTAGE=0`. Course purchases must inherit the fixed path → **depend on h69cg landing** rather than re-implementing (and re-breaking) the asymmetry. |
| **Analytics pipeline (Codex-arhvd)** | 🟢 OVERLAP-REUSE | `content_view_events`/`content_daily_stats` don't exist yet; arhvd produces the `live` tier. Independent schemas (parallel-safe). Only the reporting-cutover WP depends on arhvd for real `live` numbers. `track` tier (sales-page views/referrer) captured/planned nowhere — surface as open decision (instrument vs drop). |
| **Org landing redesign (Codex-dr57r)** | 🟠 OVERLAP-REUSE (sequence-sensitive) | dr57r is actively refining `ContentCard`/`Carousel firstItemHero`/browse (PR #390→dev). No schema conflict; pure FE-component churn. **Sequence the public-sales-renderer WP after dr57r's cards/carousel stabilize** to avoid re-skinning a moving component. |
| **subscription_tiers** | 🟢 REUSE untouched | Has `sortOrder` (`subscriptions.ts:38`); `course_tier_access(courseId,tierId)` references `subscription_tiers.id`. No tier-table change. |
| **Tier-change UX (Codex-sing6)** | ⚪ INDEPENDENT | Touches billing/proration, not entitlement tables. Resolver only reads active-sub state. No ordering constraint. |

---

## G. Parallelization & worktree plan

**Dependency graph (whole build):**
```
WP-0 (shared contracts: PageBuilderState + SectionModel types + codex:page-preview:v1 msg type + generalized boundary gate)
  │
WP-1 SCHEMA (11 tables + accessType→policy) ──────┐   [BE, atomic, single PR front]
  │                                                │
WP-2 RESOLVER (canView/canEnterCourse, gate        │
     getStreamingUrl in @codex/access, batched) ───┤  depends WP-1
  │                                                 │
  ├── WP-3 Public sales renderer (FE) ──────────────┤ depends WP-1,WP-2 + dr57r cards
  ├── WP-4 Dashboard + in-course player (coupled) ──┤ depends WP-1,WP-2, progressCollection extend
  ├── WP-5 Studio builder (FE, clone brand-editor) ─┤ depends WP-0, **cijzb merged to dev**
  ├── WP-6 Monetization (BE) ───────────────────────┤ depends WP-1,WP-2, **h69cg landed, nk4km ecommerce.ts settled**
  └── WP-7 Reporting ───────────────────────────────┘ depends WP-1 (course tables) + arhvd (live tier)
```

**FE-only:** WP-3, WP-5 (after schema/resolver contract fixed). **BE-only:** WP-1, WP-2, WP-6.
**Coupled:** WP-4 (server gate + client SPA + progress store). WP-7 straddles (BE tables + FE tiles).

**Serialization required:** WP-1 → WP-2 → everything (resolver + shared `content-detail.ts` helper +
`libraryCollection` schema are cross-cutting chokepoints; two agents editing them collide — R-D). WP-1
must land atomically (all consumer rewrites in one PR). **Single-thread** the
`libraryCollection`/`hydration.ts` schema change.

**Coordination seam (lets BE + FE proceed independently):** land **WP-0 first** — a shared TypeScript
contract holding (a) `PageBuilderState` + `SectionModel` shapes, (b) the `entitlements` resolver return
type / `canView`/`canEnterCourse` signatures, (c) the `codex:page-preview:v1` versioned message type,
(d) the new remote-function `query()` signatures (`getJourneyLibrary`, `listJourneys`, course/page reads),
(e) `buildJourneyUrl` (net-new, mirror `build-url.ts:221`). Once these types exist, a BE worktree
implements resolver+services+webhooks against the signatures while an FE worktree builds surfaces against
mocked query() returns matching the same types. Without WP-0, three agents cloning the brand-editor
store/rail-model/bridge each invent a divergent section-model and the clones won't compose.

**Proposed worktree split:**
- **Worktree BE** (`feat/journeys-backend`): WP-0 (types), WP-1 (schema + accessType), WP-2 (resolver +
  `@codex/access` rewire), WP-6 (monetization), WP-7 BE (course tables/queries). Owns `packages/*`,
  `workers/*`, seeds, migrations.
- **Worktree FE** (`feat/journeys-frontend`): WP-3 (sales renderer + `$lib/page-builder`), WP-4
  (dashboard/player + progressCollection), WP-5 (studio builder clone), WP-7 FE (insight tiles). Owns
  `apps/web/src/{routes,lib/components,lib/page-builder}`.
- **Seam:** WP-0 contract module (shared package, e.g. `@codex/shared-types` or a new
  `$lib/journeys/contracts.ts` mirrored to a package) — edited once, then frozen; both worktrees import
  it. `content-detail.ts` + `libraryCollection` are the only files both need — BE owns the
  `content-detail.ts`/`@codex/access` gate rewrite (WP-2), FE waits for it.

**Fresh-worktree caveat:** copy `.dev.vars*` + `.env.dev` from main and `pnpm build` first
(`feedback_worktree_dev_stack_secrets`); agents commit to their feature branch, never main
(`feedback_agent_branch_not_main`).

**Epic decomposition (feeds `codex-epic-create`) — ✅ DECIDED 2026-07-23: THREE epics.** A dedicated
**cleanup epic lands first** to de-risk the atomic Foundations PR (the 2399-line `ContentAccessService` and
the drifted enums are too dangerous to rewrite cold), then Foundations (BE), then Surfaces (FE).

*Epic 0 — Journeys Cleanup (behavior-preserving; lands first, independently):*
Tidies exactly the surfaces the build will touch so the Foundations PR is a clean swap, not surgery on a
monster. All non-behavioral — lock behavior with the existing tests before each refactor.
- **CE-1** Decompose `ContentAccessService.ts` (2399 lines) — split the two duplicated decision trees
  (`hasContentAccess` :309-470 + `getStreamingUrl` tx :742-949) and the `getUserContentAccessType` mapper
  into cohesive modules; pin behavior with `ContentAccessService.integration.test.ts` (2000+ lines) first.
  **Keystone** — makes WP-2's resolver rewrite tractable.
- **CE-2** Consolidate the three drifted access enums (`CONTENT_ACCESS_TYPE`, `ACCESS_TYPES`
  `constants/content.ts:37-43`, the stale `content.ts:263` column comment, and the distinct
  `contentAccess.accessType` grant enum) to one source of truth; audit + fix every `ACCESS_TYPES` caller.
- **CE-3** Clarify the shared `content-detail.ts loadAccessAndProgress` seam (feeds org + creator routes) so
  WP-2's `@codex/access` rewire is a single clean swap that can't diverge by route; document the sharing.
- **CE-4** Generalize the import-boundary CI gate to scan `$lib` (fix the routes-only blind spot,
  `check-brand-editor-boundary.mjs:38,94`) so the page-builder public/editor split can't leak.
- **CE-5** `VersionedCache` client staleness dispatch: replace the substring-match
  (`_org/[slug]/+layout.svelte:245-251`) with exact-key mapping so new `:pages`/`:courses` keys aren't inert.
- **CE-6** Scaffold `libraryCollection`/`hydration.ts` version-branching so the later course-grouping schema
  change can't strand localStorage (R-B); tidy the cross-org filter shared with platform `/library`.

*Epic 1 — Journeys Foundations (BE), depends Epic 0 merged:*
- **WP-0** Shared contracts (`PageBuilderState`/`SectionModel`, resolver signatures, `codex:page-preview:v1`, remote `query()` sigs, `buildJourneyUrl`) · dep: Epic0 · **blocks all**
- **WP-1** Schema: 11 tables + accessType→§6.1 policy (`isFree`/`isPurchasable`/`includedInTierId`/`courseOnly`/`isFollowerGated`/`isTeamOnly`) + seed rewrite · dep: WP-0 · atomic
- **WP-2** Entitlements resolver + `@codex/access` gate rewire (canView/canEnterCourse, batched, mgmt-bypass + orgless fail-closed preserved) · dep: WP-1
- **WP-6** Monetization: course purchase + course-sub (separate Stripe product/course + `planId`) + course_tier_access, entitlement-write seams, payout reuse · dep: WP-2, h69cg, nk4km-coordination

*Epic 2 — Journeys Surfaces (FE + reporting), depends Epic 1 merged:*
- **WP-3** Public sales renderer + `$lib/page-builder` section renderer + `PAGE_CONFIG` cache · dep: Epic1, dr57r-cards · parallel-eligible
- **WP-4** Dashboard + in-course player + progressCollection extend + F19 store · dep: Epic1 · coupled · parallel-eligible
- **WP-5** Studio builder: clone brand-editor (layout/canvas/bridge), create flow, curriculum editor, sales builder, studio home · dep: Epic1 (brand-studio already on dev — **no cijzb gate**, verified 2026-07-23) · parallel-eligible
- **WP-7** Reporting: `live` now, `course` after new tables, `track` dropped v1 · dep: Epic1 + arhvd · coupled

Parallel within Epic 2: WP-3/WP-4/WP-5/WP-7 all concurrent (brand-studio on dev unblocks WP-5). Epic 0 is
entirely parallel-safe work that can proceed immediately (no dependency on the schema/resolver).

---

## H. Open questions & design-gap conversations

### Must-answer-before-building

**H1. `accessType` hard-replace vs shim (SPEC §12 #5). — ✅ DECIDED: (a) hard-replace, one atomic PR**
(pre-prod, zero rows, D2 locks it; a shim buys nothing without prod data and complicates the resolver). See §C.

**H2. Where do `followers` and `team` access states go? — ✅ DECIDED: (b) explicit flags.**
`followers` → `isFollowerGated`, `team` → `isTeamOnly` (first-class flags, NOT dropped or folded);
`isTeamOnly` is additionally covered by the resolver's management-role bypass. Reflected in SPEC §6.1.
Live paths that gain these flags: `ContentAccessService.ts:789/742`.

**H3. Course-subscription billing shape (SPEC §12 #2). — ✅ DECIDED: (a) separate Stripe product per course**
+ a `planId` FK on `course_subscriptions` (reuse `TierService` product/price sync + payout fan-out; >1
plan/course representable). The `pendingPayouts` hard-FK incompatibility (§B item 10) must be resolved
(second nullable FK + CHECK-one).

**H4. Revenue-share `revenueType` for course revenue (Codex-nk4km — now CLOSED/landed, verified 2026-07-23).**
The `revenueType` CHECK (`subscription|content_purchase`) has shipped; there is **no live-file contention**.
Remaining decision (design, not coordination): (a) reuse `content_purchase` share terms for course
purchases (no schema change); (b) add `course_purchase`/`course_subscription` types (schema + state machine
+ proposals + unique-index changes). **Recommend (a)** unless course economics genuinely differ from content
economics — decide during WP-6 scoping. Downgraded from must-answer to a WP-6 design detail.

**H5. D7 media-completion boundary (SPEC §14.3, FRONTEND-MAP §3).** Does media auto-write
`practice_completions` on genuine 100% finish, or keep an explicit "mark done" for media too? Complicated
by `savePlaybackProgress` already auto-setting `completed=true` at 95%. Options: (a) auto-write row on true
finish, written stays explicit; (b) explicit for all. **Recommend (a)** (SPEC's lean) — but reconcile the
95%-vs-100% threshold and make the completion row (not `videoPlayback.completed`) the source of truth.

**H6. cijzb merge gate — ✅ RESOLVED (verified 2026-07-23).** brand-studio + the `studio/brand` route +
`brand-preview-bridge.ts` are on `origin/dev` (PR #398 merged 2026-07-20). WP-5's clone target is available;
**no gate**. Build WP-5 against dev's brand-studio.

### Can-defer

**H7. R2 namespace for sell videos (SPEC §12 #1).** reuse `{creatorId}/hls/{mediaId}/` vs dedicated
`page-assets/`. **Recommend:** reuse existing media keys; revisit only if separation becomes an ops need.

**H8. `practice_completions (userId, contentId)` cross-course bleed (SPEC §11).** A shared practice counts
complete in every course's funnel; hard to reverse once completions accumulate. Options: (a) accept
`(user, content)` (SPEC's choice); (b) key `(user, course, content)`. **Recommend (a)** but get explicit
product sign-off before building the rollup. Deferrable to the reporting WP.

**H9. `track` reporting tier — instrument or drop (SPEC §14.4).** Sales-page views/referrer captured
nowhere; arhvd doesn't cover it. **Recommend (b) for v1** — ship `live`+`course` only ("how they paid, not
where they came from"), revisit instrumentation post-launch.

**H10. Enrollment auto-create timing (SPEC §12 #3) — effectively resolved.** Leans **auto-create on
entitlement grant** (dashboard/first-run assume it). Note only.

**H11. Library IA (SPEC §12 #4) — effectively resolved.** Leans **courses as a distinct shelf** +
source-grouped ownership. Note only.

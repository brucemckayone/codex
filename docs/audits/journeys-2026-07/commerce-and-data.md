# Journeys / Courses — Commerce + Data Path Audit

**Branch**: `feat/journeys-offer-write-path` · **Date**: 2026-07-27 · **Scope**: READ-ONLY audit
**Conformance standard**: root `CLAUDE.md` → Strict Rules

---

## Executive summary

1. The backend WP-6 purchase machinery **largely exists and is course-aware** — `POST /checkout/course`, `POST /checkout/course-subscription`, `GET /courses/:id/offer`, the `kind:'course'` booking-webhook branch, `completeCoursePurchase`, the full `entitlement-writer` seam, and the stored∪derived resolver. The framing "the whole purchase settlement is unimplemented" is inaccurate.
2. What is missing is **wiring, not machinery**. `apps/web` has **zero** callers of any course-commerce endpoint: `createServerApi` exposes no `checkout.course`, no `checkout.courseSubscription`, no `courses.offer`. The buy button is a no-op local flag.
3. Two of the three "ways in" are **unconfigurable**: `CourseSubscriptionService.createPlan` and `CourseAccessService.setTierAccess` exist but are exposed by **no route**, so `course_subscription_plans` and `course_tier_access` can never be populated. The course-subscription checkout endpoint is therefore permanently dead.
4. `landing_pages.offer` is a **write-only bag** — written by `updateJourneyOffer`, read only by the studio builder. The public `getCoursePage` does not even project it. Its sole downstream effect is the `courses.price_cents` side-write.
5. `deriveCheckoutOffers` reads the `invite` section's **authored copy** and lets an authored `priceLabel` **override** the authoritative `course.priceCents` — so the displayed price can disagree with what Stripe charges. The module's own doc comment claims the opposite.
6. **Security (critical)**: `content.courseOnly` defaults `false`, the curriculum editor never sets it, and no UI anywhere writes it. The access decision falls through to `grant('free')`. Every practice in a paid journey is therefore streamable by an **anonymous** visitor at its standalone `/content/[slug]` URL. The journey paywall is bypassable by URL, and the default configuration is the vulnerable one.
7. Scoping is otherwise **sound** — every journeys read/write carries an org predicate in `.where()` or in a join. `saveCurriculum`'s bare-id writes are correctly guarded. Zod, transactions, `ctx.services.*`, and envelope conformance all check out.

**Findings**: 5 critical · 2 high · 3 medium · 5 low (15 total)

---

## A. Purchase path gap analysis

### A.1 What already exists (reusable, course-aware)

| Component | Location | Course-aware? |
|---|---|---|
| One-off course checkout endpoint | `workers/ecom-api/src/routes/checkout.ts:127-141` | Yes — `createCourseCheckoutSchema`, `auth: 'required'`, `rateLimit: 'strict'` |
| One-off course session builder | `packages/purchase/src/services/purchase-service.ts:850-895` | Yes — price derived from `courses.priceCents`, published + non-deleted + no-double-purchase guards |
| Course-subscription checkout endpoint | `workers/ecom-api/src/routes/checkout.ts:149-163` | Yes — but see **A.4**, it can never resolve a plan |
| Course-subscription session builder | `packages/subscription/src/services/course-subscription-service.ts:236` | Yes — platform-charge model, mirrors org subs |
| Three-path offer read | `workers/ecom-api/src/routes/courses.ts:28-40` → `packages/access/src/services/course-access-service.ts:109-190` | Yes — composes purchase + subscription + tier paths **and** the viewer's `entitled` flag |
| Booking-webhook course branch | `workers/ecom-api/src/handlers/checkout.ts:128`, `:256-350` | Yes — routes `session.metadata.kind === 'course'` |
| Course purchase completion | `packages/purchase/src/services/purchase-service.ts:996-1144` | Yes — idempotent on `stripePaymentIntentId`, immutable revenue split, reuses `writePurchasePayouts` |
| Course-sub webhook branches | `workers/ecom-api/src/handlers/subscription-webhook.ts:373, :407, :470, :556` | Yes — created / updated / deleted / invoice-succeeded |
| Tier access management | `packages/access/src/services/course-access-service.ts:51-103` | Yes — but see **A.5**, no route exposes it |

### A.2 Entitlement write path — what exists, what is missing

Schema: `packages/database/src/schema/entitlements.ts:44-110`. Split-FK (`contentId` XOR `courseId`, CHECK at `:100-103`), `source` constrained to `content_purchase | course_purchase | course_subscription | grant` (`:105-108`), idempotency via partial unique indexes on `revokedAt IS NULL` (`:90-97`).

Writers — `packages/purchase/src/services/entitlement-writer.ts`:

| Source | Writer | Called by | Status |
|---|---|---|---|
| `content_purchase` | `:53` `writeContentPurchaseEntitlement` | `purchase-service.ts:774` | Wired |
| `course_purchase` | `:78` `writeCoursePurchaseEntitlement` | `purchase-service.ts:1124` | Wired (webhook-reachable) |
| `course_subscription` | `:113` `writeCourseSubscriptionEntitlement` | `course-subscription-service.ts:448` | Wired but unreachable (no plan can exist — **A.4**) |
| `course_subscription` renewal | `:147` `refreshCourseSubscriptionEntitlementExpiry` | `course-subscription-service.ts:496` | Same |
| `course_subscription` revoke | `:170` `revokeCourseSubscriptionEntitlement` | `course-subscription-service.ts:557, :588` | Same |
| `grant` | — | — | **No writer exists.** The CHECK permits it; nothing inserts it. *(unverified whether intentional — confirm by grepping for an admin course-grant endpoint; `admin.grantContentAccess` writes `contentAccess`, not `entitlements`)* |

Reader: `packages/access/src/services/content-access/entitlements-resolver.ts:162-172` — `hasCourseEntitlement` = stored grant ∪ derived tier grant. Backs `canEnterCourse`. Batched variant at `:180-226` (two SELECTs regardless of N).

**Conclusion**: the grant write path for a one-off course purchase is complete end-to-end. The course-subscription grant path is complete but starved of its precondition.

---

### A.3 — CRITICAL — The journey buy button performs no Stripe action

**File**: `apps/web/src/routes/_org/[slug]/(space)/journeys/[journeySlug]/checkout/+page.svelte:198-205`

```svelte
<button type="button" class="co-cta" onclick={() => (initiated = true)}>
  Continue <span aria-hidden="true">→</span>
</button>
```

The click sets a local `$state` flag which reveals a notice at `:210-217` ("Secure checkout is being connected … payment goes live with the monetization release"). No network call, no redirect to Stripe.

**Failure scenario**: A creator publishes a journey priced £49 and shares the link. Every visitor who clicks "Continue" sees a placeholder notice. Zero revenue is collectible from the journeys product, despite `POST /checkout/course` being deployed and functional.

**Severity**: **critical**

---

### A.4 — CRITICAL — No web-side client for any course-commerce endpoint

**Files**: `apps/web/src/lib/server/api.ts:1779-1820` (the `checkout` namespace)

The `checkout` namespace exposes only `create` (content), `createPortalSession`, and `verify`. There is no `course`, no `courseSubscription`. There is no `courses` namespace at all — `GET /courses/:courseId/offer` has no client method.

Verified by exhaustive grep over `apps/web/src` for `checkout/course`, `courseCheckout`, `courseSubscription`, `courseOffer`, `getCourseOffer`: **zero matches** outside test files.

**Failure scenario**: Even after A.3 is fixed, there is no transport to call. The checkout page cannot ask the server which paths are live (`getCourseOffer`), cannot create a session, and cannot distinguish "this course has a subscription plan" from "it does not".

**Severity**: **critical** (blocks A.3; both are one work item in practice, split because the API-client surface is independently reusable by the sell page and library)

---

### A.5 — CRITICAL — `course_subscription_plans` has no route-exposed write path

**Files**: `packages/subscription/src/services/course-subscription-service.ts:107-213` (`createPlan`) · `workers/ecom-api/src/routes/checkout.ts:156` (the only route touching `ctx.services.courseSubscription`)

`createPlan` creates the Stripe Product + monthly/annual Prices + the `course_subscription_plans` row. Grep for `ctx.services.courseSubscription.` across `workers/` returns exactly one hit — `createCheckoutSession`. Nothing calls `createPlan`.

Consequently `getPlanForCourse` (`:216-227`) always returns `null`, which means:
- `getCourseOffer` never emits the `subscription` path (`course-access-service.ts:161-168` → `subscription: null`).
- `POST /checkout/course-subscription` cannot resolve a Stripe Price and fails for every course.

**Failure scenario**: A creator enables "course subscription — £12/month" in the studio Pricing panel. `updateJourneyOffer` persists `subscriptionEnabled: true, subscriptionPriceCents: 1200` into `landing_pages.offer`. No `course_subscription_plans` row is created, no Stripe Product exists. If the checkout were wired (A.3/A.4), clicking that path would error. Today it silently shows an authored teaser price for a product that cannot be sold.

**Severity**: **critical**

---

### A.6 — HIGH — `course_tier_access` has no route-exposed write path

**Files**: `packages/access/src/services/course-access-service.ts:51-103` (`setTierAccess`) · `packages/worker-utils/src/procedure/service-registry.ts:848` (the only other mention — a comment)

Grep for `setTierAccess` across `workers/` and `apps/web/src`: no callers. The only route using `ctx.services.courseAccess` is `GET /courses/:courseId/offer` (`workers/ecom-api/src/routes/courses.ts:34`).

Consequently `course_tier_access` is always empty, so:
- `hasDerivedCourseTierAccess` (`entitlements-resolver.ts:135-154`) can never return `true`.
- `getCourseOffer` never emits the `tier` path (`course-access-service.ts:170-176` → `tiers: []`).
- The `tiersEnabled` toggle in the studio Pricing panel is inert.

**Failure scenario**: A creator with an existing "Inner Circle" org tier enables `tiersEnabled` on a journey, expecting Inner Circle members to get access. No grant row is written. Inner Circle members hit `canEnterCourse === false` and are redirected to the sales page.

**Severity**: **high** (a documented way-in cannot be configured; distinct from A.5 in that no endpoint exists at all, so this is a build gap rather than a dead deployed endpoint)

---

### A.7 Ordered build list for a real three-way purchase

See the consolidated **Build list** table at the end of this document (items **BL-1** … **BL-11**).

---

## B. Offer read/write divergence

### B.1 Source-of-truth map

| Source | Written by | Read by | Authoritative? |
|---|---|---|---|
| `courses.price_cents` | `updateJourneyOffer` — `course-journey-service.ts:1541-1553` (**sole writer**) | `deriveCheckoutOffers` (`checkout-offer-model.ts:148`), `createCourseCheckoutSession` (`purchase-service.ts:876`), `getCourseOffer` (`course-access-service.ts:156`), `InviteSection.svelte:76`, every journey list projection (`course-journey-service.ts:310, 426, 848, 992`) | **YES** — the one-off price of record |
| `landing_pages.offer` (jsonb) | `updateJourneyOffer` — `course-journey-service.ts:1530-1538` | **Only** `getJourneyForBuilder` — `:1179` (select), `:1206` (projection). Not projected by the public `getCoursePage` (`:270-281`). | **NO** — write-only bag; round-trips to the studio builder and nowhere else |
| `invite` section `props.offers` | Page-builder section props via `saveJourneyPage` (`course-journey-service.ts:1401-1410`) — org-authored jsonb | `deriveCheckoutOffers` — `checkout-offer-model.ts:140-146`; `InviteSection.svelte:49` | **NO** — presentational copy, yet it **drives the checkout offer list** |
| `course_subscription_plans` | `createPlan` — **unreachable** (A.5) | `getPlanForCourse` (`:216`), `getCourseOffer` (`:123-129`), `createCheckoutSession` | **YES** in design; always empty in practice |
| `subscription_tiers` ⋈ `course_tier_access` | `setTierAccess` — **unreachable** (A.6) | `hasDerivedCourseTierAccess` (`:135-154`), `getCourseOffer` (`:130-147`) | **YES** in design; always empty in practice |

### B.2 — CRITICAL — `deriveCheckoutOffers` never reads `page.offer`

**File**: `apps/web/src/routes/_org/[slug]/(space)/journeys/[journeySlug]/checkout/checkout-offer-model.ts:136-165`

```ts
const invite = findInviteSection(page.sections);
const authored = invite
  ? asObjectArray<CheckoutOffer>(invite.props, 'offers', (entry) => mapOffer(entry, course))
  : undefined;
if (authored && authored.length > 0) return authored;
if (course.priceCents !== null) { /* single hardcoded one-off */ }
return [];
```

`page.offer` is never consulted. The checkout's offer catalogue is a function of authored section props plus `course.priceCents` — nothing else.

**Failure scenario**: Creator sets `tiersEnabled: true`, `subscriptionEnabled: true` (£12/mo), `oneOffEnabled: true` (£49) in the Pricing panel and saves. `updateJourneyOffer` commits both rows. The creator opens the checkout and sees **only** the one-off £49 card (the `course.priceCents` fallback), because the `invite` section has no authored `offers` array. Two of the three toggles produce no visible change anywhere on the public surface.

**Severity**: **critical** (the studio pricing UI is disconnected from the surface it purports to configure)

---

### B.3 — HIGH — Authored `priceLabel` overrides the authoritative one-off price

**File**: `apps/web/src/routes/_org/[slug]/(space)/journeys/[journeySlug]/checkout/checkout-offer-model.ts:109-115`

```ts
const authoredPrice = fieldString(entry, 'priceLabel');
const priceLabel =
  authoredPrice ??
  (!recurring && course.priceCents !== null
    ? formatCleanPrice(course.priceCents)
    : undefined);
```

`authoredPrice` is checked **first**. `course.priceCents` is only a fallback for when no `priceLabel` was authored. For a `recurring` entry there is no DB fallback at all — the price is whatever string the creator typed.

This directly contradicts the module's own doc block at `:10-12`:
> "The ONE-OFF price is SERVER-AUTHORITATIVE: it is always re-derived from the frozen `course.priceCents`, never trusted from authored copy."

**Failure scenario**: `courses.price_cents = 4900`. Creator authors an invite offer `{ id: 'one-off', name: 'Own it', per: 'once', priceLabel: '£19' }` — perhaps stale copy from a past sale. The checkout renders "£19 · one-off". Once BL-2 lands, `POST /checkout/course` derives £49 from the row and Stripe charges £49. The buyer was shown £19 and charged £49 — a consumer-protection exposure, not merely a display bug.

**Severity**: **high**

---

### B.4 — MEDIUM — `landing_pages.offer` is not projected on the public read

**File**: `packages/access/src/services/course-journey-service.ts:270-281` — the `getCoursePage` select list omits `offer` (contrast `getJourneyForBuilder` at `:1179`).

**Failure scenario**: Any fix that makes the checkout honour the offer bag (BL-3) must first widen this projection and the `JourneyPageRecord` DTO. Attempting the checkout fix alone yields `page.offer === undefined` at runtime with no type error, because `JourneyPageRecord.offer` is declared optional (`packages/shared-types/src/journeys.ts:162`) — a silent no-op.

**Severity**: **medium** (a latent trap for the intended fix, not a live defect)

---

### B.5 Client-trusted prices — verified clean on the write path

Every money value on the write path is server-derived. Recorded here because the brief asked explicitly:

- `createCourseCheckoutSession` (`purchase-service.ts:850-880`) accepts only `{ courseId, successUrl, cancelUrl }` (`createCourseCheckoutSchema`); the amount comes from `courses.priceCents`.
- `completeCoursePurchase` (`:996`) takes `metadata.amountPaidCents` from the Stripe session's `amount_total` (`handlers/checkout.ts:287`) — i.e. what Stripe actually charged, not a client claim.
- `updateJourneyOfferBodySchema` (`packages/validation/src/schemas/journeys.ts:269-277`) is `.strict()` with `priceCentsSchema` on both price fields; the write is org-scoped inside a transaction.

The **only** client-authored money value in the system is the *display* string `priceLabel` — finding **B.3**.

---

## C. Conformance violations

### C.1 — MEDIUM — `completeCoursePurchase` course lookup omits the soft-delete filter

**File**: `packages/purchase/src/services/purchase-service.ts:1012-1015`

```ts
const course = await tx.query.courses.findFirst({
  where: eq(courses.id, metadata.courseId),
  columns: { organizationId: true, creatorId: true },
});
```

No `isNull(courses.deletedAt)`. Contrast `createCourseCheckoutSession:857-862`, which does filter — so the two ends of the same flow disagree.

**Failure scenario**: Buyer starts checkout for course X. Creator soft-deletes X while the Stripe session is open. Buyer pays. The webhook completes the purchase, books the revenue split and payouts, and writes a **permanent** `course_purchase` entitlement (`:1124`) to a deleted course. `canEnterCourse` grants, then `resolveCourseBySlug` returns null and the dashboard 404s — a paid-for, permanently inaccessible entitlement with no refund trigger.

**Severity**: **medium**

---

### C.2 — MEDIUM — Bare `catch {}` discards actionable server guidance on curriculum save

**File**: `apps/web/src/routes/_org/[slug]/studio/journeys/[id]/curriculum/+page.svelte:274-275`

```ts
} catch {
  toast.error('Could not save the curriculum — please try again');
}
```

The error object is not even bound. The service's specific, user-actionable `ForbiddenError('A practice references content outside this organization')` (`course-journey-service.ts:1681-1683`) and `NotFoundError('Journey course not found')` (`:1599`) are both reduced to "please try again".

The sibling offer command gets this right — `journeys.remote.ts:331-333` forwards 4xx text via `error(err.status, err.message)` while letting 5xx propagate. That is the pattern this call site should follow.

**Failure scenario**: A creator's curriculum save fails because one practice points at content from another org (or content that was soft-deleted mid-edit). They see "please try again", retry identically, and fail identically — with no path to discovering which practice is at fault.

**Severity**: **medium**

---

### C.3 — LOW — Entitlement-resolver failure silently degrades to "not enrolled"

**Files**: `checkout/+page.server.ts:57-59` · `[journeySlug]/+page.server.ts:64-68`

```ts
const enrolled = user
  ? await resolveCanEnterCourse(event, user.id, course.id).catch(() => false)
  : false;
```

Any resolver error — worker outage, timeout, 500 — becomes "not enrolled". No logging (contrast `getCoursePagePreview` at `journeys.remote.ts:355-368`, which logs unexpected failures and stays silent only on the expected 403).

**Failure scenario**: content-api degrades. An owner of the course sees a "buy" CTA instead of "Enter the journey". Blast radius is bounded: it fails *toward* the purchase surface, never toward access, and `CourseAlreadyOwnedError` (`purchase-service.ts:893`) blocks a duplicate checkout server-side. The real cost is that a resolver outage is invisible.

**Severity**: **low**

---

### C.4 — LOW — Non-null assertions where the sibling route hoists a real guard

**File**: `apps/web/src/routes/_org/[slug]/(space)/journeys/[journeySlug]/dashboard/+page.server.ts:66`

```ts
const dashboard = await fetchCourseDashboard(event, user!.id, course!.id);
```

Sound today — `evaluateCourseGate` guarantees both are non-null past the gate. The practice route handles the identical situation with an explicit narrowing guard instead (`practice/[contentSlug]/+page.server.ts:71`: `if (!user || !course) error(404, ...)`), which survives refactors of the gate. The assertion form does not.

**Severity**: **low**

---

### C.5 — LOW — Raw `Error` throws instead of typed `ServiceError` subclasses

**File**: `packages/access/src/services/course-journey-service.ts:723, :1291, :1311, :1737`

e.g. `:1291` — `throw new Error('createJourney: course insert returned no row')`

Root `CLAUDE.md`: "**MUST** throw typed `ServiceError` subclasses … NEVER throw raw strings or generic `Error`". These sit inside `try` blocks whose `this.handleError` wraps unknowns into `InternalServiceError`, so no internals leak to the client — but the typed error code is lost, and the rule is unambiguous. `InternalServiceError` is the correct class here.

**Severity**: **low**

---

### C.6 — LOW — Two public reads resolve a course id with no org predicate

**Files**: `packages/access/src/services/course-journey-service.ts:506` (`getCourseSellPreview`) · `:224` (`getContentCourses`)

Both filter on `status = PUBLISHED` + `deletedAt IS NULL` but carry no `organizationId`. Both are public-by-design reads of already-public data, so this is not a data-exposure finding in the `scopedNotDeleted` sense. It does mean a request on org A's host can read org B's published sell preview via `/api/journeys/courses/:courseId/sell-preview`, which breaks the org-isolation invariant the rest of the file maintains.

**Severity**: **low**

---

### C.7 — LOW — Unguarded enrollment-count helper

**File**: `packages/access/src/services/course-journey-service.ts:1988-1992` — `inArray(courseEnrollments.courseId, courseIds)` with no org predicate.

Currently safe: the sole caller (`listJourneysForOrg` → `loadCourseRollups`) org-filters `courses` at `:1943` first. The helper itself provides no defence-in-depth, so a future caller passing unfiltered ids would leak cross-org enrollment counts.

**Severity**: **low**

---

### C.8 Verified clean (no findings)

Recorded so a future pass does not re-litigate these:

- **Scoping**: every read and write in `course-journey-service.ts` carries an org predicate in `.where()` or in an `innerJoin`. `listEnrolledJourneys` scopes via the join (`:998-1006`), not the `where` — correct, not a gap.
- **`saveCurriculum` bare-id writes** (`:1711, :1724, :1749, :1760, :1768, :1780`): guarded. `assertCourseInOrg` runs first (`:1659`); `existingIds` derives from a `courseId`-scoped select (`:1688-1696`); `keptIds` filters on `existingIds.has(id)` (`:1701-1705`), so a foreign stage id from the client falls to the insert branch and creates a new stage in the correct course. A cross-org stage write is not reachable.
- **Zod on every write**: `saveJourneyPageBodySchema`, `updateJourneyOfferBodySchema`, `saveCurriculumBodySchema` — all `.strict()` (`packages/validation/src/schemas/journeys.ts:245, :277`).
- **Transactions on every multi-step write**: `:1236` (create), `:1354` (page save), `:1497` (offer), `:1687` (curriculum).
- **`ctx.services.*` throughout**: no ad-hoc service instantiation in `workers/content-api/src/routes/journeys.ts` or `workers/ecom-api/src/routes/`.
- **Envelope conformance**: handlers return plain objects (`PageOffer`, `EditorCurriculum`); `procedure()` wraps.
- **No `as any` / `as unknown as` / `@ts-ignore`** anywhere in the journeys service, remote, seam, or route surface. The `AccessQueryClient` / `EntitlementWriteClient` types use proper `Parameters<Parameters<…>>` derivation (`entitlements-resolver.ts:49`, `entitlement-writer.ts:39`).
- **`updateJourneyOffer` guards**: rejects an enabled-but-unpriced path (`:1486-1495`), rejects one-off on a non-course page (`:1524-1528`), rolls back when the subject course update matches zero rows (`:1557-1559`). This method is well-built; its problem is that nothing reads its output (B.2).

---

## D. Access-gate correctness

### D.1 — CRITICAL — Paid journey practice content is publicly streamable at its standalone URL

The prior concern ("a flag gate treats no-gate-configured as free, so a non-free row with no gate is silently public") is **confirmed, and it is reachable in the default journey-authoring flow**.

**The chain, link by link:**

1. `content.courseOnly` defaults to **`false`** — `packages/database/src/schema/content.ts:285`:
   ```ts
   courseOnly: boolean('course_only').notNull().default(false),
   ```
2. `saveCurriculum` links content into a course **without touching the content's flags** — `packages/access/src/services/course-journey-service.ts:1787-1791`:
   ```ts
   await tx.insert(stagePractices).values({ stageId, contentId: practice.contentId, sortOrder: j });
   ```
   No `courseOnly` write. Adding content to a paid curriculum does not gate it.
3. **No UI writes `courseOnly` anywhere.** An exhaustive grep for `courseOnly|course_only` across `apps/web/src` returns **zero** matches. The only write path in the entire repo is `ContentService.create/update` via an *optional* `validated.courseOnly ?? false` (`packages/content/src/services/content-service.ts:280, :483`; schema `packages/validation/src/content/content-schemas.ts:323`). Neither the journey builder nor the curriculum editor exposes it.
4. The access decision **falls through to a grant** — `packages/access/src/services/content-access/access-decision.ts:313-314`:
   ```ts
   // ── free / fallthrough — WP-1 granted here (free content, no price). ───────
   return grant('free');
   ```
   Reached whenever `courseOnly === false`, `isTeamOnly === false`, `isFollowerGated === false`, `includedInTierId === null`, and `priceCents` is null-or-0 — i.e. the default flag set.
5. The standalone content route resolves access through this decision — `apps/web/src/lib/server/content-detail.ts:196-200, :246` (`api.access.getStreamingUrl` → `ContentAccessService.canView`).
6. The slugs are discoverable: `loadPublicStages` (`course-journey-service.ts:2223-2260`) publishes the practice content rows on the **public** sell page, and `getContentCourses` (`:211`) maps content → courses.

**Failure scenario (concrete):**
- Creator builds journey "Deep Work", prices it £49 one-off via the Pricing panel (`courses.price_cents = 4900`).
- Adds 12 practices through the curriculum editor, selecting content created in the studio with default flags (`isFree: true`, `courseOnly: false`).
- Publishes the journey.
- An **anonymous** visitor hits `/journeys/deep-work/practice/lesson-1` → correctly redirected to the sales page (gate at `practice/[contentSlug]/+page.server.ts:47-67`).
- The same anonymous visitor hits `/content/lesson-1` → `canView` returns `true` via `grant('free')` → **a signed HLS URL is issued**. All 12 practices are free to anyone with the slug.

**Why the course gate does not save this**: `evaluateCourseGate` and `canEnterCourse` are both sound (see D.2). They protect the *journey* surfaces. The leak is a second, unprotected door to the same media.

**Blast radius**: video and audio practices leak a signed stream URL. Written practices leak their `bodyHtml` — and note that inside the journey the written path deliberately skips `canView` (`practice/[contentSlug]/+page.server.ts:83-86`, justified because course entry is enforced there), so written bodies have no content-level gate to fall back on at all.

**The fix exists but is never applied**: when `courseOnly` **is** `true`, `access-decision.ts:252-256` correctly suppresses every standalone path and requires a course entitlement. The defect is that nothing in the journey authoring flow ever sets it.

**Severity**: **critical** — the journeys paywall is bypassable by URL, no authentication required, and the default configuration is the vulnerable one.

---

### D.2 — Verified NOT a defect: the course gate itself is sound

Recorded because the brief asked for a precise verdict.

- `evaluateCourseGate` — `apps/web/src/lib/journeys/gate.ts:36-41` — is strict and fails closed: missing course → 404; unauthenticated → redirect; `!canEnterCourse` → redirect. There is no permissive branch.
- Both member routes call it **before** loading any data, and both act on the outcome: `dashboard/+page.server.ts:43-63`, `practice/[contentSlug]/+page.server.ts:47-67`. Gate ordering is correct (resolve slug → gate → load), so a non-entitled user never receives progress or curriculum data.
- The practice route additionally gates the media stream on `canView` and withholds the URL on denial (`:83-86, :96`).
- `canEnterCourse` requires a **live** stored grant (`revokedAt IS NULL` and not past `expiresAt` — `entitlements-resolver.ts:77-82`) or an active tier grant. A paid course with no grant is not enterable.
- The worker enforces the same gate independently before returning dashboard/practice payloads (`workers/content-api/src/routes/journeys.ts:233, :299`), so the web gate is defence-in-depth rather than the sole control.
- `round-d-seam.ts` sanitises written `bodyHtml` server-side before it reaches the player's `{@html}` (`:124-146`) — the stored-XSS vector is handled.

**An unpaid visitor cannot reach paid practice content *through the journey routes*.** The exposure in D.1 is entirely via the standalone content route.

---

## Build list

Ordered by dependency. Sizes: **S** ≤ ½ day · **M** ≈ 1–2 days · **L** ≈ 3+ days.

| ID | Work item | Type | Size | Depends on | Addresses |
|---|---|---|---|---|---|
| **BL-1** | **Default `courseOnly = true` for curriculum-linked content.** In `saveCurriculum`, set `content.courseOnly = true` on newly-linked practices inside the existing transaction (`course-journey-service.ts:1687-1795`); add an explicit per-practice "also sell standalone" opt-out in the curriculum inspector. Backfill migration for practices already linked to priced courses. | service + migration + UI | **M** | — | **D.1** |
| **BL-2** | **Add the course-commerce API client.** `api.checkout.course()`, `api.checkout.courseSubscription()`, `api.courses.getOffer()` in `apps/web/src/lib/server/api.ts`, mirroring the existing `checkout.create` shape. | api client | **S** | — | **A.4** |
| **BL-3** | **Server-authoritative offer read on the checkout.** Replace `deriveCheckoutOffers`' authored-props source with `GET /courses/:id/offer` (`CourseOffer`: `paths`, `purchase`, `subscription`, `tiers`, `entitled`). Keep authored copy for *prose only* (`name`, `blurb`, `bullets`, `who`); take **every price from the DTO**. Retire the authored-`priceLabel` precedence. | web load + offer model | **M** | BL-2 | **B.2**, **B.3** |
| **BL-4** | **Wire the buy button.** Replace the `initiated` flag with a `command()` that calls the right endpoint per selected path and redirects to `sessionUrl`; handle `CourseAlreadyOwnedError` / `CourseNotPurchasableError` with actionable copy. | remote fn + UI | **M** | BL-2, BL-3 | **A.3** |
| **BL-5** | **Expose course-subscription plan management.** Route + validation schema for `CourseSubscriptionService.createPlan` (and an update/archive path), `requireOrgManagement` + `strict` rate limit. Call it from `updateJourneyOffer`'s flow so enabling the subscription path provisions the Stripe Product + Prices, or rejects when Connect is not ready (`ConnectAccountNotReadyError`). | route + service wiring | **M** | — | **A.5** |
| **BL-6** | **Expose tier→course access management.** Route for `CourseAccessService.setTierAccess` + a tier multi-select in the Pricing panel, so `tiersEnabled` writes real `course_tier_access` rows. | route + UI | **M** | — | **A.6** |
| **BL-7** | **Make `landing_pages.offer` authoritative or delete it.** Decide: either project `offer` on the public `getCoursePage` (`:270-281`) and have BL-3 read it, **or** drop the bag and derive presentation from `CourseOffer` + section props. Do not leave a written-but-unread column. | schema/DTO + decision | **S** | BL-3 | **B.2**, **B.4** |
| **BL-8** | **Soft-delete filter on the purchase-completion course lookup.** Add `isNull(courses.deletedAt)` at `purchase-service.ts:1013` and decide the policy for a mid-flight delete (refund vs. complete-and-flag). | service | **S** | — | **C.1** |
| **BL-9** | **Surface real errors on curriculum save.** Bind the error at `curriculum/+page.svelte:274` and forward 4xx text, following the `journeys.remote.ts:331-333` pattern. | UI | **S** | — | **C.2** |
| **BL-10** | **Log resolver degradation.** Add observability to the two `.catch(() => false)` sites (`checkout/+page.server.ts:58`, `[journeySlug]/+page.server.ts:65`) so an entitlement-resolver outage is visible. | web load | **S** | — | **C.3** |
| **BL-11** | **Conformance sweep on the journeys service.** Replace the four raw `Error` throws with `InternalServiceError`; replace the `dashboard/+page.server.ts:66` non-null assertions with the practice route's narrowing guard; add org predicates to `getCourseSellPreview`, `getContentCourses`, and the `loadCourseRollups` enrollment count. | service + web | **S** | — | **C.4**–**C.7** |

**Critical path to collectable revenue**: BL-2 → BL-3 → BL-4 (one-off purchases live). BL-5 and BL-6 are independent and unlock the other two ways-in.

**BL-1 should not wait on any of it** — it is the only security item, and it is independently shippable.

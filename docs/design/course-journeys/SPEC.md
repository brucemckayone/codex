# Landing Page Builder & Guided Journeys — Engineering Design Spec (v2)

**Status:** v2 design, architecture decisions locked 2026-07-22. Pre-production /
development — we optimize for the **best-fit system, not the least change to existing
code**. Grounded against the live schema + platform patterns (two codebase audits;
file:line anchors in §15).

**Hardening (2026-07-23):** a 12-agent review fleet re-verified this spec against live code and
produced [`HARDENING.md`](./HARDENING.md) — the authoritative delta record (corrections, cross-epic
conflicts, the parallelization/worktree plan, and open questions H1–H11). Where it corrects this doc,
**it wins**. Critical model-level corrections are folded inline below and marked `[H]`.

**What this is:** the build spec for a **creator-controlled landing-page builder** whose
**first page type is a course ("guided journey")**. Companion docs: [`README.md`](./README.md)
(design capture — *why* the sales page looks the way it does) and [`./prototype/`](./prototype/)
(the static course sales-page prototype). Beads epic `Codex-2pryk`.

**Immediate deliverable:** a **prototype** — the page builder UI + a mocked backend/data
model — *before* any implementation (§13). Everything below exists to make that prototype
faithful.

---

## 1. Summary

A creator builds a **landing page** once; the platform renders it and (for courses) a
companion **member dashboard**. A **page** is a generic, typed, section-composed object;
a **course** is the curriculum domain object a course-type page presents. This split is
what lets *retreats* and other future page types reuse the builder without a rewrite.

Three surfaces:
- **Sales / landing page** — public, SSR, SEO-significant. Story → scope → proof → free
  taste → the offer.
- **Journey dashboard** — authed, members only, **not SSR** (no SEO need). Resume /
  next / progress.
- **Studio page builder** — the creator authoring tool; two-pane, live-previewed,
  reusing the brand-editor's design language and shared primitives.

Access is governed by a **new unified entitlements layer** (§6), so one content item can
be purchasable, subscription-included, and/or course-only — independently — and course
access never leaks between courses that happen to share content.

## 2. Locked decisions

| # | Decision | Consequence |
|---|---|---|
| D1 | **Generic page model; course = first page type/template** | `landing_pages` (presentation) is separate from `courses` (curriculum). New types add a template, not a rebuild. |
| D2 | **Unified entitlements/grants layer** | Content & courses resolve access through one `entitlements` model; `content.accessType` is replaced by a separable access *policy*. |
| D3 | **Org-scoped only (v1)** | Every row scopes by a non-null `organizationId`. Personal/orgless courses deferred. |
| D4 | **Payment gating, not prerequisite unlock** | Stage "gates" are narrative. Progress is display-only; it never controls access. |
| D5 | **Prototype-first** | Build the builder UI + backend mock before implementation. |
| D6 | **Brand: inherit by default, override per-page** | Org brand is the default; each page may override tokens (reuse brand-editor override shape). |
| D7 | **Explicit completion, not watch-%** | A "mark complete" action writes a completion row; playback watch-% is *resume*, not *done*. |
| Confirmed | URL segment `journeys`; dashboard non-SSR; sell-video previews OK; **stage ≠ category**. | — |

## 3. Non-goals (v1)
- Personal (orgless) courses; global/platform stage taxonomy.
- Sequential prerequisite unlocking, drip scheduling, certificates.
- Course bundles / cross-course prerequisites.
- Multi-page marketing sites (the builder makes *a* page per offering, not a site tree).

---

## 4. The page model (D1)

A **page** is generic presentation; a **course** is curriculum. A course-type page binds
to a course.

```ts
landingPages = pgTable('landing_pages', {
  id, organizationId (NOT NULL, cascade), creatorId (NOT NULL, restrict),
  pageType: varchar(30).notNull(),          // 'course' now; 'retreat' etc. later
  slug: varchar(160).notNull(),             // unique per org (partial idx, not-deleted)
  title, status ('draft'|'published'|'archived'), publishedAt, featured, sortOrder,

  subjectType: varchar(30),                 // 'course' → the domain object this page presents
  subjectId: uuid(),                        // → courses.id (polymorphic; validated in service)

  brandOverrides: jsonb().$type<BrandTokenOverrides>(),  // per-page --brand-* overrides (D6)
  sections: jsonb().$type<PageSection[]>().default([]),  // ordered, typed, toggleable (§4.1)
  createdAt, updatedAt, deletedAt,
})
```

### 4.1 Sections (the composable unit)
`sections` is an **ordered array** of `{ id, type, enabled, props }`. Reordering =
array order; on/off = `enabled`; copy = `props`. The course template ships a default set
(`hero, introVideo, ache, turn, reel, map, feel, proof, guide, faq, invite` — the
prototype's sections). A future retreat template defines its own section catalogue.
Rendering maps `type → Svelte component`; unknown types are skipped (forward-compatible).

`★ Insight ─────────────────────────────────────`
Keeping `sections` as data (not columns) is what makes on/off + reorder + new page types
cheap: the builder mutates an array, the renderer walks it, and a new template is just a
new registered section-type set. It also mirrors the brand editor's token-override shape,
so `brandOverrides` can literally reuse that store/serialization — the "reduce
duplication" ask (§9) starts here.
`─────────────────────────────────────────────────`

---

## 5. Curriculum data model (course, stages, practices)

```ts
courses = pgTable('courses', {
  id, organizationId (NOT NULL, cascade), creatorId (NOT NULL, restrict),
  slug (unique per org), title, kicker, lede,
  status, publishedAt,
  guide: jsonb(),                           // { name, bio, portraitMediaId, quote }

  // Sell media — media-item refs (reuse pipeline; §10)
  introVideoMediaId, previewVideoMediaId, guideVideoMediaId,  // → mediaItems, set null

  // Pricing / access config (the three course-access paths — §6/§7)
  priceCents: integer(),                    // one-off purchase price (NULL = not sold standalone)
  // course-specific subscription plan lives in course_subscription_plans (below)
  createdAt, updatedAt, deletedAt,
})

courseStages = pgTable('course_stages', {           // ORDERED gates, owned by one course
  id, courseId (NOT NULL, cascade), name, gloss,
  sortOrder (NOT NULL),                              // the gate order
  createdAt, updatedAt, deletedAt,
}) // unique(courseId, sortOrder) where not deleted

stagePractices = pgTable('stage_practices', {       // stage ⋈ content (concurrent pool)
  stageId (NOT NULL, cascade), contentId (NOT NULL, cascade), sortOrder,
}, primaryKey(stageId, contentId))
// Space guard (content.orgId === course.orgId) enforced in service.
// [H] There is NO syncContentCategories helper — mirror categories-service.ts spaceWhere() (:414).

courseTestimonials = pgTable('course_testimonials', {
  id, courseId (NOT NULL, cascade), quote, authorName, authorContext,
  avatarMediaId, sortOrder, createdAt, updatedAt, deletedAt,
})
```

**Why stage ≠ category (validated):** `categories` are *space-wide* with a unique
slug-per-org — a taxonomy primitive reused across all content. A stage is *owned by one
course* and ordered within it — a curation primitive. Folding them collides on slugs the
moment a second course reuses a topic. A practice is a `content` row that can *also* carry
categories; the systems coexist.

A **practice = a `content` row** (`contentType IN ('video','audio','written')` →
practice/audio/reflection). Reused as-is except for the access-policy rework below.

---

## 6. Access & entitlements (D2 — the greenfield core)

Replace the single `content.accessType` enum (which conflates *how you qualify* with
*what the thing is*) with **(a) a per-resource access *policy*** and **(b) a unified
*entitlement* that records a granted right.**

### 6.1 Content access policy (separable states)
Content's independent availability becomes explicit, non-exclusive flags (dev-only rework
— nothing is production-fixed):

```ts
// on content (replaces accessType/minimumTierId conflation)
isFree:          boolean   // open to all
isPurchasable:   boolean   // + priceCents  → one-off content purchase
includedInTierId: uuid?    // included in this org tier (and above, by sortOrder)
courseOnly:      boolean   // NOT independently reachable — ONLY via a course entitlement
isFollowerGated: boolean   // [H] DECIDED: explicit flag — free to org followers/opt-in (was accessType 'followers')
isTeamOnly:      boolean   // [H] DECIDED: management/staff-only (was accessType 'team'); also covered by resolver role-bypass
```
`courseOnly=true` suppresses every standalone path regardless of the others — the content
exists only inside courses. `free/purchasable/tier-included` may combine freely.

> **[H] DECIDED (2026-07-23).** The live `content.accessType` CHECK
> (`free|paid|followers|subscribers|team`, `content.ts:349-350`) maps as: `free`→`isFree`,
> `paid`→`isPurchasable`, `subscribers`→`includedInTierId`, `followers`→`isFollowerGated`,
> `team`→`isTeamOnly` — the last two are **explicit first-class flags** (per user decision, not dropped or
> folded; `isTeamOnly` is additionally covered by the resolver's management-role bypass). See HARDENING §H2.

### 6.2 Entitlements (the grant record)
```ts
entitlements = pgTable('entitlements', {
  id, userId (NOT NULL, TEXT),   // [H] users.id is text('id') not uuid — every user FK here + in
  organizationId (NOT NULL),     //     course_subscriptions/practice_completions/course_enrollments is TEXT
  resourceType: varchar(20),   // 'content' | 'course'  (extensible: 'page','bundle')
  resourceId:   uuid(),
  source:       varchar(30),   // 'content_purchase'|'course_purchase'|'course_subscription'|'grant'
                               // [H] 'tier_subscription' is RESOLVER-OUTPUT-ONLY, never inserted (tier grants derived, §6.2); omit from write-path CHECK
  sourceRef:    uuid(),        // purchase id / subscription id / course_subscription id
  grantedAt, expiresAt?, revokedAt?,
})
```
- **Stored grants:** one-off content purchase, one-off course purchase, course
  subscription, manual admin grant.
- **Derived grants:** tier-subscription access is computed live from the user's active
  `subscriptions` row + the tier→course/content mappings (`course_tier_access`,
  `content.includedInTierId`) — not materialized, so tier changes take effect instantly.
- A single **resolver** unions stored + derived into "the set of resources U may access."

### 6.3 Resolution (the two questions)
```
canView(user, content):                       # may the user open this content anywhere?
  if userManagesOrg(user, content.orgId): return true   # [H] owner/admin/creator see all org content (CAS.ts:414-459) — load-bearing for studio/builder preview
  if content.orgId is null and content.includedInTierId: return false  # [H] orgless+tier = fail-closed deny (CAS.ts:342-352)
  if content.isFree: return true
  if content.courseOnly:
      return any(course ∋ content where hasCourseEntitlement(user, course))
  if hasContentEntitlement(user, content): return true          # purchase or tier-included
  if content.includedInTierId and userTierClears(user, content.includedInTierId): return true
  return any(course ∋ content where hasCourseEntitlement(user, course))   # via a course you own

canEnterCourse(user, course):                 # may the user open the course DASHBOARD/journey?
  return hasCourseEntitlement(user, course)   # course purchase | course sub | tier grants THIS course
```

`★ Insight ─────────────────────────────────────`
`canView` and `canEnterCourse` being **different questions** is exactly the "shared
content ≠ shared course access" rule you called out. If you bought Course A and it shares
practice X with Course B, you can *view X* (you hold a path to X via A), but you cannot
*enter Course B's journey* (no entitlement over B). One is a resource check, the other is
a course-scoped check — collapsing them is what causes access to leak.
`─────────────────────────────────────────────────`

### 6.4 Where it lives
This supersedes the current `ContentAccessService.accessType` decision tree. The resolver
becomes the single authority; `getStreamingUrl` gates on `canView`; the course dashboard
gates on `canEnterCourse`. Streaming mechanics are unchanged (HMAC-token HLS proxy;
direct-presigned audio waveform).

---

## 7. Monetization — three course-access paths

| Path | Mechanism | Grants |
|---|---|---|
| **Org subscription tier** | `course_tier_access(courseId, tierId)` join — *explicit* tier→course grants (not just min-tier, so "certain tiers → certain courses" is exact) | course entitlement while the tier subscription is active (derived) |
| **One-off course purchase** | `courses.priceCents` + a purchase → `entitlements(source='course_purchase')` | permanent course entitlement |
| **Course-specific subscription** | `course_subscription_plans(courseId, priceMonthly, priceAnnual, stripe…)` + `course_subscriptions(userId, courseId, status, stripe…)` | course entitlement while active — a low-friction entry into one course |

Content-level: one-off content purchase (`isPurchasable`+`priceCents`) and tier-included
(`includedInTierId`) as in §6.1. Stripe flows reuse the existing purchase/subscription
infrastructure (`@codex/purchase`, `@codex/subscription`); each successful payment writes
an `entitlements` row (or, for tiers, is derived).

> **[H] DECIDED (2026-07-23):** course subscriptions use a **separate Stripe product per course** (reuse
> `TierService` product/price sync); add a `planId` FK on `course_subscriptions`. Course purchase +
> course-sub revenue MUST reuse the payout ledger (`writePurchasePayouts`/`executeTransfers`), and
> `pendingPayouts.subscriptionId` (which hard-FKs org `subscriptions`) needs a second nullable FK +
> CHECK-one. See HARDENING §D / §H3.

---

## 8. Surfaces to design (each a design pass; prototype covers the builder first)

1. **Studio page builder** (this prototype) — §9.
2. **Public sales/landing page** — SSR shell+stream; sections → components; the descent
   map (public, no progress); brand inherited + per-page overrides.
3. **Journey dashboard** — authed, client-rendered; playlist rail + working pane + map
   with progress overlay; resume.
4. **User library redesign** — a course purchase grants many content items; the library
   must show *courses* (enrolled/owned) and the content they unlock, and how to reach it.
   Query = the user's entitlements + enrollments grouped by course.
5. **Explore** — how courses surface in discovery alongside content.
6. **Course-owned content page vs standalone** — the **same content item renders a
   different UI inside a course** (stage context, next/prev in stage, progress, mark
   complete) than standalone. Route context (courseId present) selects the UI.
7. **Recommendations / cross-links** — a standalone content page shows "this is part of
   *[Course]*" (upsell); in-course pages recommend within the course.

## 9. Studio page builder (reuse the brand editor)

Clone the brand-editor architecture (`Codex-cijzb`) and **share primitives with it** to
avoid duplication — consolidate the two-pane shell, the postMessage live-preview bridge,
and the token-override store into reusable pieces both tools consume.

- **Two-pane workspace** — reuse `BrandStudioLayout` (rail | canvas). Rail = authoring:
  **section list (add / reorder / toggle)**, per-section copy fields, **stage + practice
  composer**, testimonials, FAQ, guide block, **media slots** (sell videos), **pricing /
  access config** (the three paths + per-content policy), and **brand overrides** (reuse
  the brand-editor colour/token controls).
- **Canvas** — an **iframe of the real sales page**, same-origin.
- **Live preview** — mirror `brand-preview-bridge.ts`: versioned message type
  (`codex:page-preview:v1`), **explicit `targetOrigin`**, applier **inert unless embedded**,
  never posts back. Payload = the pending page draft (sections + brandOverrides); the
  framed page re-derives its render — copy/order/theme changes go live with no reload.
- **Import boundary** — inert applier + store under `$lib/page-builder` (public-bundle
  safe); heavy editor UI under `$lib/components/page-builder`; add to the WP-0.2 CI gate.
- **Creation-flow UX is first-class (friction risk):** the prototype must demonstrate the
  *whole* "create a course → arrange → price → publish" flow, not just a static screen.
  Sensible defaults, a template starting point, and inline preview are the anti-friction
  levers to test.

## 10. Media & R2 for sell videos

Sell/preview videos are **regular `mediaItems`** (reuse upload → RunPod → HLS pipeline);
the course stores `introVideoMediaId` / `previewVideoMediaId` / `guideVideoMediaId`.
- **Public preview** uses the existing **30s `preview.m3u8`** primitive (public-safe, no
  auth) via `HeroInlineVideo`/`IntroVideoModal` (precedent: `org.introVideoUrl`).
- **Authed guide video** resolves via the access resolver (`canView`) + `VideoPlayer`.
- **R2 layout (open decision §12):** default is to reuse existing media keys
  (`{creatorId}/hls/{mediaId}/…`), so a sell video can be *either* an existing content
  item's media *or* a media item uploaded just for the page. A dedicated
  `page-assets/…` namespace is the alternative if we want sell media clearly separated
  from catalogue content.

## 11. Progress, completion & reporting (D7)

- **`practice_completions(userId, contentId, completedAt, source)`** — **confirmed
  required.** Written by an **explicit "mark complete" action** (works for `written`
  practices, which have no playback signal). Watch-% from `videoPlayback` is used for
  **resume position only**, not completion (may auto-suggest completion, but the row is
  the source of truth).
- **`course_enrollments(userId, courseId, enrolledAt, source, lastActivityAt, completedAt?)`**
  — who is "on"/"has taken" a course; created on entitlement/first access; drives the
  dashboard and reporting. Course completion = all required practices completed.
- **Progress rollup** = `practice_completions ⋈ stage_practices` scoped to the enrollment.
- **Creator / back-office reporting** — enrolments, purchases (one-off + course-sub +
  tier), and completions per course: who purchased, who's enrolled, who finished.

## 12. Caching & open decisions

**Caching:** courses/pages are read-heavy, rarely-mutating → `VersionedCache` version-bump
(TTL only a GC backstop). Add `CacheType.PAGE_CONFIG` / `COURSE_CONFIG` + a per-org
collection key; `waitUntil(cache.invalidate(...))` after every mutation; stream versions
to the client like `ORG_CONFIG`. **Entitlement/access reads** are per-user and
authorization-sensitive — cache narrowly (short TTL or per-request), never across users.

**Open decisions:**
1. **R2 namespace** for sell videos — reuse media keys vs dedicated `page-assets/` (§10).
2. **Course-subscription billing** — separate Stripe products per course, or a metered
   add-on to the org account? (affects `course_subscription_plans`).
3. **Enrollment auto-create** — on entitlement grant, or lazily on first dashboard visit?
4. **Library IA** — courses as a distinct shelf vs interleaved with owned content.
5. **`accessType` migration** — since we're pre-prod, hard-replace `accessType` with the
   §6.1 policy, or keep a compatibility shim during the rework?

## 13. Prototype plan (the immediate deliverable — D5)

A static, LAN-served prototype (house convention; no design system — a faithful stand-in),
in scratchpad then captured to `./prototype/builder/`. Two parts:

**A. Page-builder UI** — two-pane, styled to echo the brand editor's design language:
- Rail: section list (add/reorder/toggle) · per-section copy · stage & practice composer ·
  media slots · pricing/access (three paths + per-content policy incl. `courseOnly`) ·
  brand-override controls.
- Canvas: live preview rendering the course sales page (reuse the existing
  `prototype/course-sell.html` sections as the render target) — edits reflect live.
- Demonstrates the **full create-a-course flow** end-to-end (the friction-critical UX).

**B. Mocked backend / data model** — `builder-data.js`: an in-memory implementation of
the §4–§6 model (pages, sections, courses, stages, practices, entitlements, access
policy) with the **`canView` / `canEnterCourse` resolver** working, so we can *exercise*
the model — e.g. flip a practice to `courseOnly`, switch a viewer's entitlements, and
watch access change. This is how we validate the schema before writing a single migration.

Verification: serve over LAN, Playwright desktop+mobile, zero console errors, screenshots
removed from the repo root afterward. Present for review; iterate the model from what the
prototype teaches before grounding to real tokens/schema.

**Superseded:** the v1 §7 API package and §13 WP breakdown are dropped; a new epic +
WP set is derived *after* the prototype pins the model.

---

## 14. Prototype outcomes (2026-07-22) — what the full build validated & discovered

The prototype grew past §13's "builder + mock" scope into the **whole system — 13 surfaces**,
a full user-flow + friction pass, and a triage that fixed 19 of 21 friction points. This
section folds the **backend-relevant** outcomes into the spec; the per-surface **design-system**
mapping lives in [`FRONTEND-MAP.md`](./FRONTEND-MAP.md); the flow/friction analysis is captured
in [`./prototype/flows.html`](./prototype/flows.html).

### 14.1 Surfaces built (supersedes the §8 list's "to design")
Public: **explore · course-sell · checkout · content-standalone**. Member: **library ·
course-dashboard · content-incourse**. Creator studio: **studio-journeys (home/index) ·
builder-new (create flow) · course-editor (curriculum) · builder (sales page) · reporting**.
Plus **flows.html** (the flow/friction map). Three surfaces beyond §8 emerged and are now
first-class: the **studio home / journeys index** (the creator hallway that lists every
journey/page and routes to Curriculum · Sales page · Insights — nothing linked *to* the
create flow without it), the **create flow** (type → name → start-from, config-driven), and
**reporting** (see §14.4). All verified: 0 console errors, 0 horizontal overflow at 390px.

### 14.2 Entitlement model validated (§6)
The `canView` vs `canEnterCourse` split (§6.3) was exercised end-to-end against a working mock
resolver (`prototype/mock-data.js` `window.MOCK`). The states it proved distinct:
free · locked-purchasable (the three "ways in") · owned-standalone · owned-in-course ·
**owned-but-not-enrolled** (`canView`=true via content purchase, `canEnterCourse`=false → the
standalone page offers "see the journey", never a false "open in course") · tier-member. The
model holds; **shared content did not leak course access** in any state.

### 14.3 Completion — per-type refinement of D7 / §11
The prototype split completion by content type, which refines (does not overturn) D7:
- **written / reflection / practice** → an **explicit "Mark complete"** (no playback signal; the
  D7 case).
- **audio / video** → completion presented as **automatic on finish** ("saves as you listen ·
  completes when you finish") — no redundant button.

**Decision to confirm (D7 boundary):** either (a) **auto-write** the `practice_completions` row
on genuine 100% playback for media, keeping explicit for written; or (b) keep a subtle explicit
"mark done" for media too. Recommend (a) — matches expectation and keeps the row the source of
truth (watch-% still drives *resume*, a true finish writes *done*). The UI must never show a
redundant explicit button on playback media.

### 14.4 Reporting provenance (refines §11)
Every reporting metric must carry its **data provenance**, because the three tiers have very
different build costs — surfacing this in the mock *is* the "what's required to gather it" note:
- **`live`** — derivable today from `@codex/purchase` + `@codex/subscription` + payouts
  (revenue, purchase/subscription mix, recent activity).
- **`course`** — needs the planned `course_enrollments` + `practice_completions` tables (§11):
  enrolled / active / completed, stage-completion funnel.
- **`track`** — **not captured anywhere today and not yet planned**: sales-page views, traffic
  source / referrer / campaign. The funnel's top ("viewed sales page → opened an offer") is
  un-trackable without net-new instrumentation. Reporting must show *how* someone paid (live),
  not *where they came from* (track), until that instrumentation exists.

### 14.5 UX flow decisions (complement D1–D7; full rationale in flows.html §5)
- **U1 — Offer default (checkout).** Full membership **£12 highlighted "best value"**, £6
  course-sub as the deliberate **decoy**, £45 one-off as the **anchor** (Hick's Law "highlight
  the recommended" + anchoring/decoy). Highlight, don't hard-preselect; keep £6 one click away
  so course-only intent isn't alienated. Label each offer by **scope × commitment**.
- **U2 — Post-purchase landing.** Land on the **dashboard**, which must be **first-run-ready**
  (never an empty room — a "Begin" card is the pre-focused first step, one click to practice
  one). Research leans toward dropping straight into the first practice for time-to-first-value;
  the compromise keeps orientation. Revisit toward direct-to-practice if activation data argues.
- **U3 — Stage gate = suggested arc, not a lock** (this is D4, made legible). Copy is
  invitation-to-pace ("the whole path stays open — {next} is here whenever {current} settles");
  access stays entitlement-gated and progress display-only. No padlocks.

### 14.6 Open decisions the prototype now informs (§12)
- **#3 Enrollment auto-create** → lean **auto-create on entitlement grant**: the dashboard and
  first-run states assume an enrollment exists the moment access is granted (empty-dashboard is
  onboarding, not absence).
- **#4 Library IA** → lean **courses as a distinct shelf**: the prototype library leads with a
  "Your journeys" carousel + a "Continue" resume rail, then "everything you own" grouped by
  **access source** (`via`: membership / purchased / part-of-course / free) — the source
  grouping is how the shelf answers "why can I see this".

### 14.7 Checkout (informs §7 monetization)
The prototype checkout is a mock (no payment form), but three findings are grounded and
carry-forward: **carry the selected offer into checkout** (deep-link pre-selects the path, so a
"ways in" pick isn't re-decided); **trust / risk-reversal cues** at the payment step (VAT-
inclusive "no hidden fees", "cancel anytime", security badge, one social-proof line — Baymard's
top abandonment causes); and **account-after-payment + minimal fields** (email + card, create
the account post-purchase) — the last two need the real Stripe form (real-build).

---

## 15. Appendix — grounding references
Data model: `packages/database/src/schema/{content.ts,categories.ts,subscriptions.ts,playback.ts}`;
`packages/constants/src/content.ts` (accessType = `free|paid|followers|subscribers|team`; `'members'` is a stale alias for `'team'`);
`packages/content/src/services/{content-service.ts,media-service.ts,categories-service.ts}`;
`packages/subscription/src/services/tier-service.ts`;
`packages/access/src/services/ContentAccessService.ts` (+ `hls-token.ts`, `hls-rewrite.ts`); `packages/purchase`.

Presentation: `apps/web/src/routes/_org/[slug]/(space)/{+page.server.ts,+page.svelte,content/[contentSlug]/…}`;
`.../[slug]/{+layout.server.ts,+layout.svelte}`; `apps/web/src/hooks.ts`; `packages/urls/src/build-url.ts`.

Builder reuse: `apps/web/src/routes/_org/[slug]/studio/{+layout.ts,+layout.server.ts,brand/…}`;
`apps/web/src/lib/brand-editor/{brand-preview-bridge.ts,brand-editor-store.svelte.ts,css-injection.ts}`;
`apps/web/src/lib/components/brand-studio/{BrandStudioLayout.svelte,BrandStudioCanvas.svelte}`.

Theming/media/cache: `apps/web/src/lib/styles/tokens/org-brand.css`; `apps/web/src/lib/components/ui/ShaderHero/`;
`packages/transcoding/src/{services/transcoding-service.ts,paths.ts}` (30s `preview.m3u8`);
`workers/media-api/src/routes/{transcoding.ts,webhook.ts}`; `packages/cache/src/{versioned-cache.ts,cache-keys.ts,CLAUDE.md}`.

## Provenance
v1 (2026-07-21): grounded course spec. v2 (2026-07-22): full-read review reframed to a
landing-page builder with a unified entitlements layer, prototype-first; decisions D1–D7.
v2.1 (2026-07-22): prototype completed to all 13 surfaces + a user-flow/friction pass;
outcomes folded into §14 (per-type completion, reporting provenance, UX decisions U1–U3,
entitlement-state validation) and the front-end→design-system bridge captured in
[`FRONTEND-MAP.md`](./FRONTEND-MAP.md). Raw v1 body + captured feedback in git history.

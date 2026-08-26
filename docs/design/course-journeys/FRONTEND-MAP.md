# Front-end → Backend → Design-system map

**Status:** bridge doc, 2026-07-22. Maps the completed **prototype** (13 surfaces +
`flows.html`) onto (a) the backend model in [`SPEC.md`](./SPEC.md) v2 and (b) the real
Codex design system. This is the hand-off from "faithful static prototype" to "epic work
packages grounded in real tokens, components and schema".

**Hardening (2026-07-23):** a 12-agent fleet re-verified every §5 component claim against live code.
Corrections below are marked `[H]`; the full delta record + parallelization plan live in
[`HARDENING.md`](./HARDENING.md) (§B has the complete list).

**Read order:** [`SPEC.md`](./SPEC.md) (backend authority) → this doc (what each surface
needs + how it maps) → [`./prototype/flows.html`](./prototype/flows.html) (personas,
journeys, the 21-item friction triage, decisions U1–U3).

> **Grounding rule (non-negotiable):** the prototype's `fresh.css` tokens and the neutral
> `--st-*` studio chrome are **stand-ins**. Do **not** port them. Re-implement every surface
> on the real token layer (`apps/web/src/lib/styles/tokens/`) and existing components, per the
> `design-system` skill and its MCP verification gate. §5 lists the exact mapping.

---

## 1. Surface inventory — prototype → backend

Each surface, what it is, the backend it needs (tables/resolver/endpoints from SPEC §4–§11),
its key states/params, and the friction items it resolved (see `flows.html`). Design-system
components are in §5.

### Public funnel

| Surface (`prototype/…`) | Backend it needs | Key states / params | Friction resolved |
|---|---|---|---|
| **explore.html** — discovery | Public read: published `landing_pages` (pageType=course) + `content` with access policy (§6.1); category facets. No auth. | facet chips (type/topic/free); journey vs content cards | — |
| **course-sell.html** — sales page | SSR shell+stream (SPEC §8.2). `landing_pages.sections` (§4.1) → components; `courses` + `course_stages`/`stage_practices` for the descent map; `course_testimonials`; sell videos via `mediaItems` + 30s `preview.m3u8` (§10); brand inherit + `brandOverrides` (D6). | scroll reveals; float CTA @50% scroll; free-taste door → `?free` | F1, F3 |
| **checkout.html** — offer / pay | Three access paths (§7): `course_tier_access` / `courses.priceCents` / `course_subscription_plans`. Each success → `entitlements` row (or derived for tier). | `?offer=` pre-selects a path; confirmation seam | D1/U1, F2, F17, F18 |
| **content-standalone.html** — content outside a course | `canView(user, content)` (§6.3); access policy (§6.1) → the "ways in"; `?free` = `isFree`; `?notenrolled` = `canView` true / `canEnterCourse` false; breadcrumb from owning course. | visitor / member toggle; `?free`; `?notenrolled` | F9, F18, F19, F20 |

### Member loop

| Surface | Backend it needs | Key states / params | Friction resolved |
|---|---|---|---|
| **library.html** | The user's `entitlements` + `course_enrollments` grouped by course; owned `content` with access-source (`via`). Distinct "journeys" shelf + resume rail (§14.6 lean). | `?state=new` first-run (no enrollments) | F14, F15 |
| **course-dashboard.html** — journey portal | `canEnterCourse(user, course)` gate (§6.3); `course_enrollments` + progress rollup (`practice_completions ⋈ stage_practices`, §11); `course_stages` order. Non-SSR (D-confirmed). | first-run (0%) → "Begin"; in-progress → "Resume"; complete → "Revisit" | F5 |
| **content-incourse.html** — the player | Same `content`, **different UI** when `courseId` present (§8.6): stage context, prev/next in course order, mark-complete. `?i=` = flat practice index (→ `course_stages.sortOrder` + `stage_practices.sortOrder`). Completion per §11 + §14.3. | `?i=` walkable sequence; gate-crossing cue; completion end-state | F6/U3, F7, F8, F21 |

### Creator studio (clones brand-editor — SPEC §9)

| Surface | Backend it needs | Key states / params | Friction resolved |
|---|---|---|---|
| **studio-journeys.html** — studio home / index *(new, beyond §8)* | List creator's `landing_pages` + `courses` (status draft/published) with `live` reporting rollups; routes to Curriculum/Sales/Insights. | `?empty` = no journeys yet | F13, F15 |
| **builder-new.html** — create flow *(new)* | Creates a `landing_pages` row (+ a `courses` row for pageType=course) from a template (§4.1 default section set); config-driven per type. | type → name → start-from | — |
| **course-editor.html** — curriculum | CRUD `course_stages` (ordered) + `stage_practices` (concurrent pool); per-practice access policy (§6.1) incl. `courseOnly`; publish → `courses.status`. | artswitch (Curriculum·Sales·Insights); publish pre-flight | F11, F12 |
| **builder.html** — sales-page builder | `landing_pages.sections` (add/reorder/toggle/props) + `brandOverrides` (D6); pricing panel = the course's offer (§7, one source of truth); iframe live-preview bridge (§9). | mode tabs (Design/Pricing/Brand/SEO); publish pre-flight | F11, F12, F16 |
| **reporting.html** — insights | Provenance-tagged metrics (§14.4): `live` (purchase/subscription/payout), `course` (enrollments/completions — needs new tables), `track` (sales-page views — **not captured**). | period toggle; provenance legend | — |

---

## 2. Entitlement model — validated by the prototype (SPEC §6)

The mock resolver (`prototype/mock-data.js` `window.MOCK`) exercised `canView` vs
`canEnterCourse` across every state, proving **shared content never leaks course access**:

| Viewer state | `canView(content)` | `canEnterCourse(course)` | Surface behaviour |
|---|---|---|---|
| Anonymous, free content | ✓ (`isFree`) | ✗ | plays; nudge into the journey |
| Anonymous, locked | ✗ | ✗ | "ways in" (3 paths); 30s taste |
| Member, tier-included content | ✓ (derived tier grant) | ✓ if tier grants course | in-course view + "open in {course}" |
| Bought content à la carte, **not enrolled** | ✓ (`content_purchase`) | ✗ | standalone play + "see the journey" (never "open in course") — F9 |
| Course purchase / course-sub | ✓ for its practices | ✓ | full journey + dashboard |

**Build note:** `getStreamingUrl` gates on `canView`; the dashboard route gates on
`canEnterCourse` (§6.4). The not-enrolled state (`?notenrolled`) is the one that proves the
two questions must stay separate.

## 3. Completion & reporting mapping

- **Completion (§11 + §14.3):** `practice_completions` is the source of truth. UI splits by
  type — **written/reflection/practice** → explicit "mark complete"; **audio/video** →
  automatic on genuine finish (no redundant button; watch-% still = *resume*). Confirm the
  D7 boundary: auto-write the row on media finish (recommended) vs keep an explicit control.
- **Reporting provenance (§14.4):** every metric carries `live | course | track`. Ship
  `live` first (derivable today), `course` with the new tables, and **either instrument or
  drop** `track` (sales-page views/referrer are captured nowhere today). Reporting promises
  *how they paid*, not *where they came from*, until `track` exists.

## 4. Findings folded in (from `flows.html`)

- **Personas:** Seeker · Deciding Visitor · New Member · Returning Member · Creator — the
  flows are emotional-first, not navigational.
- **Friction triage:** 21 points, **19 resolved** in the prototype; 2 carried to the build
  because they need the backend — **F17** (checkout payment-field minimisation +
  account-after-payment) and **F19** (one shared progress *store* rendered identically on
  player/standalone/library; the prototype has the canonical breadcrumb identity, not the
  store).
- **UX decisions U1–U3** (SPEC §14.5): offer default (£12 highlighted / £6 decoy / £45
  anchor); post-purchase → first-run-ready dashboard; stage gate = suggested arc, not a lock.

---

## 5. Design-system mapping

The design system lives in `apps/web/src/lib/styles/tokens/*` (+ `themes/{light,dark}.css`,
`org-brand.css`), `apps/web/src/lib/components/`, and the brand-studio chain. Governance is the
`design-system` skill (`.claude/skills/design-system/`) with a **mandatory MCP visual gate**
(`references/09-mcp-verification.md`) before any visual work closes.

### 5.1 Token mapping (prototype stand-in → real)
The prototype's `fresh.css` (warm brand tones) and neutral `--st-*` studio chrome are
**thrown away**; every value re-binds to the real four-layer cascade (raw → semantic theme →
`org-brand.css` OKLCH derivation → inline `--brand-*` injection on `.org-layout`).

| Prototype stand-in | Real token | Note |
|---|---|---|
| `fresh.css` brand tones (`--ember/--blood/--clay/--rose/--bone/--ink`) | org `--brand-*` inputs → consumed as `--color-*` semantics | Never hardcode; page inherits org brand + per-page `brandOverrides` (D6). Components read `--color-*`, **never `--brand-*`**. |
| `--st-bg/--st-panel/--st-text/--st-gold` (studio chrome) | `--color-{background,surface,surface-card,text,text-secondary}` etc. | Studio uses the normal semantic layer — it is theme-aware, not a separate palette. |
| hardcoded px / radii / type / timing | `--space-*` · `--radius-*` · `--text-*` (fluid `clamp`) + `--font-*`/`--leading-*` · `--duration-*` + `--ease-*` | Tokens-only rule (`apps/web/CLAUDE.md`). |
| video/audio dark chrome | `--color-player-*` | Inverse (white-on-dark) chrome, org-overridable — the in-course player. |
| `--color-heading` usage | `--color-heading` (independent of body text) | Already a first-class token (brand-editor WP-0.1). |

### 5.2 Component reuse (prototype pattern → existing component)

| Prototype pattern (surface) | Existing component + variant | Gap / net-new |
|---|---|---|
| Offer / pricing cards (course-sell, checkout) | `ui/ContentCard` `variant:featured` + `ui/PriceBadge` | **[H] fully net-new** — NOT `SubscribeButton` (it's org-sub-only, `SubscribeButton.svelte:94`); the whole `components/subscription/*` family is org-bound; grep `TierCard\|PricingCard\|OfferCard`=0. The 3-path checkout is all new. |
| Stage / module accordion (course-editor, dashboard) | `ui/Accordion/*` (single+multiple) | per-item progress + "still-ahead" state (new sub-parts) |
| Journey-map rail · "Continue" rail (dashboard, library) | `carousel/Carousel` (`firstItemHero`) / `browse/BrowseModule` | journey-progress node styling (new) |
| "Ways in" (content-standalone, checkout) | `ui/Tabs` + `ContentCard` grid | compose only |
| Filter chips (explore, library) | `ui/ActiveFiltersStrip` + `ui/FilterBar` `type:pills` + `ui/FilterDrawer` | none |
| Search (explore, library) | `ui/SearchPill` | none |
| Waveform / audio (content) | `AudioPlayer/*`, `ContentCard/AudioWaveform` | none |
| In-course video (content-incourse) | `VideoPlayer` + `player.css` inverse chrome | lesson chrome + next-up (new layout) |
| Breadcrumb signpost (content-standalone, player) | `ui/Breadcrumb` | none (F19) |
| Two-pane builder (builder, course-editor, builder-new) | `brand-studio/BrandStudioLayout` + `BrandStudioCanvas` + `rail/*` | section-editor UI (clone — §5.4) |
| Publish pre-flight (F12) | `ui/Dialog` / `ui/Feedback/ConfirmDialog` | checklist body (compose) |
| First-run / empty states (F15) | `ui/EmptyState` (`title/description/icon/action`) | none |
| Toasts (save/publish) | `ui/Toast/Toaster` + `toast-store` | none |
| Segmented control (device/period toggles) | `ui/Tabs` or `FilterBar type:pills` | no true segmented control (minor) |
| Reporting tiles (reporting) | `studio/analytics/*`, `ui/DataTable`, `ui/Badge` | journey KPI stat-tiles (new) |
| Progress bar (dashboard, course, player rail) | — (`Feedback/NavigationProgress` is route-only) | **net-new ProgressBar/ring primitive** |

### 5.3 Net-new components (don't exist yet)
1. **ProgressBar / progress-ring** — token-driven completion primitive (course + lesson).
2. **Page-builder editor UI** (`$lib/components/page-builder/`): section add-picker, per-section
   config editors (analog of `brand-editor/levels/*`), drag-reorder canvas rail.
3. **Section renderer** (`$lib/page-builder/`, public-safe/inert): section-type → DS-component map
   for public journey pages.
4. **Page-builder store** (`.svelte.ts`, `saved`/`pending` runes spine cloned from
   `brand-editor-store.svelte.ts`) + **section-model** (analog of `rail/rail-model.ts`: catalog,
   ordering, search).
5. **Page-builder preview bridge** — extend/clone `brand-preview-bridge.ts` with a section-config
   message type; explicit `targetOrigin`, inert-unless-embedded.
6. **Curriculum / stage editor** parts (stage list, lesson rows, access/lock state).
7. **Journey / offer card** composition + **stage-node map** rail visual (over `Carousel`).
8. **Journey insights stat-tiles** — **[H] NOT net-new**: reuse/variant of the existing
   `studio/analytics/KPICard.svelte` (money=pence GBP, sparkline, `valueContent` Snippet) +
   `studio/StatCard.svelte`. A KPI-tile primitive already exists.

### 5.4 Studio builder — clone the brand editor (SPEC §9)
**Share as-is:** `BrandStudioLayout` (pass different rail/canvas snippets), `BrandStudioCanvas`
(stable same-origin `<iframe>` of the real page + the `onframeload` bridge seam — `src` derives
from route+slug only, never editor state, so edits never reload it), the `createBrandPreviewSender`
bridge mechanics, `css-injection` helpers, all `rail/*` primitives (`RailGroup`, `RailControl`,
`ChangeLedger`), the generic field primitives (`BrandSliderField`, OKLCH color pickers, `FontPicker`),
and all `ui/*`.

**Clone (page-builder-specific):** the store (section list + per-section props, mirroring the
`saved`/`pending` spine), a **section-model** (`rail-model.ts` analog), section-config editors
(`levels/*` analog), and a preview payload carrying **section config** instead of brand tokens.

**Import boundary (replicate WP-0.2 exactly):** `$lib/page-builder` = public-safe/inert (section
renderer + inert preview applier); `$lib/components/page-builder` = heavy editor UI, imported ONLY
by `studio/journeys/*` routes. Add a CI gate cloned/generalised from
`apps/web/scripts/check-brand-editor-boundary.mjs`. Public journey pages import only `$lib/page-builder`.

> **[H] Two corrections (HARDENING §B.17-18).** (1) The existing gate scans `src/routes` ONLY, never
> `src/lib` (`check-brand-editor-boundary.mjs:38,94`). The public section renderer lives in
> `$lib/page-builder/` (a lib module) — if it statically imports `$lib/components/page-builder/*`, the
> editor bundles into the PUBLIC chunk and the routes-only scan stays green (silent leak to every anon
> sales-page visitor). The cloned gate MUST also scan `$lib/page-builder/**` (or assert it never imports
> `$lib/components/*`). (2) `BrandStudioCanvas` is **not** share-as-is — it imports the brand-editor store
> + `CanvasToolbar` + a fixed **4-member** preview-route catalog (`preview-canvas.ts:15`); clone the
> stable-iframe pattern, don't reuse the component.

**Routes** (siblings under `_org/[slug]/studio/`, inherit `ssr=false` + the studio auth guard;
each gets a `+page.server.ts` role gate reusing parent `userRole`):

| Prototype surface | Route | Mirrors |
|---|---|---|
| studio-journeys | `studio/journeys/+page.svelte` (+`.server.ts` list/gate) | a studio list page (`content/`) |
| builder-new | `studio/journeys/new/+page.svelte` | `content/new/` |
| course-editor | `studio/journeys/[id]/curriculum/+page.svelte` | new (curriculum editor) |
| builder | `studio/journeys/[id]/page/+page.svelte` | **exact clone of `studio/brand/`** |
| reporting | `studio/journeys/[id]/insights/+page.svelte` | `studio/analytics/` |

## 6. Grounding rules the build must obey
1. **Tokens only** — no hardcoded px/hex; `var(--space-*)`, `var(--color-*)`, `var(--radius-*)`,
   `var(--text-*)`, `var(--duration-*)`/`var(--ease-*)`.
2. **Consume semantic `--color-*`** (theme- + org-brand-aware); never `--brand-*` directly.
3. **Svelte 5 runes** — typed `interface Props` + `$props()`/`$state`/`$derived`, `Snippet` +
   `{@render}`, extend `HTML*Attributes`, `$app/state` not `$app/stores`; **Melt UI headless**,
   composition-first; check `ui/index.ts` before making a primitive.
4. **Import boundary** — public route files import only `$lib/page-builder` (inert); heavy editor
   UI stays in `$lib/components/page-builder`; enforce with a cloned CI gate.
5. **Clone `/studio/brand` exactly** for `studio/journeys/[id]/page` (BrandStudioLayout + stable
   same-origin iframe canvas + `onframeload` bridge seam + role-gated server load).
6. **Public journey pages = shell+stream** (`+page.server.ts`: await critical/SEO, stream secondary
   with `.catch()`); root-relative URLs via `lib/utils/subdomain.ts` builders.
7. **Cards transparent-by-default + typed-by-content** (audio=waveform, article=editorial,
   video=play-ring; neutral palette — aspect ratio/layout carry the signal); token-driven
   skeletons; a11y (focus tokens, media captions, `prefers-reduced-motion`).
8. **MCP verification gate** — before closing any visual WP, run the `svelte` / `context7` /
   `chrome-devtools` / `playwright` gate (`references/09-mcp-verification.md`).

## 7. Open decisions — resolved or informed (SPEC §12 / §14.6)
- **#3 enrollment auto-create** → auto-create on entitlement grant (dashboard/first-run
  assume it). **#4 library IA** → courses as a distinct shelf + source-grouped ownership.
- Still open: **#1** R2 namespace for sell videos; **#2** course-subscription billing shape;
  **#5** `accessType` hard-replace vs shim; the **D7 media-completion boundary** (§3 above).

## 8. Suggested epic WP sequence (derive with `codex-epic-create`)
1. **Schema + migrations** — `landing_pages`, `courses`, `course_stages`, `stage_practices`,
   `course_testimonials`, `entitlements`, `course_subscription_plans`, `course_subscriptions`,
   `course_tier_access`, `practice_completions`, `course_enrollments`; replace `accessType`
   with the §6.1 policy.
2. **Entitlements resolver** — `canView` / `canEnterCourse` + tier-derived grants; gate
   `getStreamingUrl` and the dashboard route.
3. **Public sales renderer** — sections→components, SSR shell+stream, brand inherit/override.
4. **Journey dashboard + in-course player** — enrollments, progress rollup, completion.
5. **Studio builder** — clone brand-editor (two-pane + iframe + postMessage), `$lib/page-builder`
   boundary; create flow, curriculum editor, sales-page builder, studio home.
6. **Reporting** — `live` tier first; `course` with the new tables; `track` decision.

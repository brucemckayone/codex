# The axis contract — binding spec

**`00-design-language-research.md` §2.2 (the axis set), §2.3 (axis → CSS), §2.4 (the two-pole
refactor), §2.5 (new tokens), §2.6 (the `SectionDesign` contract and resolution order), §3 (per-type
compositions), §4 (the eight presets) and §5.1 (the accessibility floors) ARE the contract** — as
amended below. Every work package implements against that document plus these amendments. Nothing
here restates the research; where the two disagree, this file wins.

Rationale for each amendment is given, because a WP that does not understand *why* will regress it.

---

## A1 — The render seam is the UNIFIED component set under `render/`, not `render-edit/`

The research names `render-edit/SectionRenderer.svelte` as the single place the seam lands. That is the
wrong tree. Programme decision D3 unifies the two trees, and the survivor is **`render/`**:

- `render/sections/*` (12 files, 350–935 lines) is the richer set. It already handles
  `JourneySalesContext`, the streamed `sellPreview`, the authoritative `offer`, enrolment-aware CTA
  targeting, progressive enhancement and reduced-motion gating. None of that exists in `render-edit/`.
- `render-edit/sections/*` (8 files, 40–132 lines) is a thinner parallel set that shares one component
  across several semantic types. It is **deleted**.

The surviving components take the edit seam as PROPS (`editable`, `onEdit`) — never as an import,
because `$lib/page-builder` is the CE-4-scanned `PUBLIC_LIB_ROOT` and must never pull in
`$lib/components/page-builder`.

`render/SectionRenderer.svelte` is therefore where `resolveDesign`, the `data-jp-*` attribute
emission and `container-type: inline-size` land.

**Why it matters:** building the seam in `render-edit/` would wire the axes into the tree that is
about to be deleted, and would leave the published page — the thing creators are actually selling
with — still ignoring every axis.

## A2 — `--tap-target-min` must not scale below the WCAG floor

The research defines `--tap-target-min: var(--space-11)` and calls it "44px × density". That
multiplication is the bug: `--space-11` derives from `--space-unit`, which derives from
`--brand-density-scale`. An org that sets a density below 1 silently drops the token under 44px, and
the guardrail that was supposed to be non-negotiable becomes brand-dependent.

```css
/* WRONG — an org at density 0.9 yields 39.6px */
--tap-target-min: var(--space-11);

/* CORRECT — density may only ever make the target LARGER */
--tap-target-min: max(2.75rem, var(--space-11));
```

A floor that a brand setting can lower is not a floor. Assert this in a test at a sub-1 density.

## A3 — Existing pages are migrated to Candlelit IN THE SAME MIGRATION that adds the column

The research is right that the axis DEFAULTS should describe a sensible neutral page rather than
today's cinematic look — a new creator with no design opinion should not inherit a niche aesthetic.
But that makes the Candlelit migration load-bearing: any published page the migration misses silently
changes appearance for real visitors.

Remove the risk by construction. The Drizzle migration that adds `landing_pages.design` also writes
the Candlelit bundle onto **every existing row in the same step**, so `design IS NULL` can never occur
for a pre-existing page. The neutral defaults then only ever apply to pages created after this lands.

This supersedes the wording of D8 in `README.md`: existing pages are preserved by an explicit
migration, not by the defaults happening to match.

Verify after migrating: the golden page
(`of-blood-and-bones` → `pricing-smoke-test`) must be pixel-comparable before and after. That is the
regression test for the entire foundation round.

## A4 — Both barrels, or the type is invisible

`SectionDesign` must be exported from **`packages/shared-types/src/journeys.ts` AND
`packages/shared-types/src/index.ts`** (the barrel). An additive type added only to its source file
does not reach consumers, and the failure mode is a confusing "module has no exported member" at a
call site that looks correct. Build `shared-types` alone first to confirm.

Likewise `resolveDesign` and `SectionDesign` must be re-exported from the `$lib/page-builder` barrel
alongside `resolveVariant` / `SectionVariant`.

`resolveDesign` lives in `section-catalog.ts` beside `resolveVariant` and stays pure + framework-free
+ DOM-free, per the import-boundary gate.

## A5 — `design` needs a REAL schema, because `z.custom` validates nothing structural

`packages/validation/src/schemas/journeys.ts:214` currently declares:

```ts
export const pageSectionSchema = z.custom<PageSection>(…)
```

That is a type assertion with a predicate, not a structural schema. Adding `design` to the TypeScript
interface therefore gets **no validation at all** — an arbitrary string reaches `resolveDesign` and is
emitted as a `data-jp-*` attribute value.

This is not an XSS vector (Svelte escapes attribute values), but it is still wrong: unknown values
produce attributes that match no CSS rule, so the section silently renders with axis defaults and the
creator sees a control that appears to do nothing. Validate `design` as a real object of closed
`z.enum`s, with unknown keys stripped and every field optional. Related: bead `Codex-us9ay`.

## A6 — Fix the duplicate-anchor defect in the same change

`Codex-yxkj7` (P1): `SectionRenderer` uses the section TYPE as the DOM id, so the golden page already
serves two `<section id="ache">`. F2 introduces a new `.jp-sec` wrapper in exactly this component —
fix the id scheme there rather than leaving a known-invalid document behind. Existing cross-section
anchor links (`#map`, `#invite`, the hero scroll cue) must keep working.

## A7 — i18n is single-owner, and the renderer already has hardcoded English

The orchestrator owns `messages/en.json`. Worktrees REPORT keys; they never regenerate
`src/paraglide/`. Two worktrees recompiling paraglide strips keys and produces runtime 500s.

Already present and needing keys — found in `render/sections/HeroSection.svelte`:
`'Begin the journey'` and `'Go to your dashboard'` are inline English in the public renderer. Every
new variant label, axis label, axis value label and preset name is builder UI and needs a key too.

paraglide-js is **1.11.8 with NO plural support** — never ICU `{count, plural, …}`; use a separate
`_one` key plus a call-site ternary. New keys must land in BOTH `src/paraglide/messages/en.js` and the
`messages.js` barrel.

## A8 — Opportunistic fixes allowed in the component WPs

`render/sections/HeroSection.svelte` renders an inline `<svg>` chevron, which breaks the design
system's "no inline SVG — use `Icon/*Icon.svelte` via `IconBase`" rule. Fix violations of this class
when the WP is already in the file. Do NOT go hunting outside the WP's file set.

## A9 — Work-package ORDER inside each component: axes first, compositions last

The research's §6 sequences the programme; this sequences each individual component WP. Three stages,
in this order, so a WP that runs long stops at a coherent point:

1. **Wire all nine axes.** Replace every hardcoded layout / rhythm / type / edge / surface / motion /
   media literal with the corresponding `--jp-*` read. This is the highest-leverage half by a wide
   margin: nine axes across existing compositions already multiplies the reachable design space, and it
   is what makes the presets function at all.
2. **Collapse the axis-in-disguise variants** (research §3) with a stored-value migration, so a
   published page keeps its current appearance.
3. **Add the new compositions**, in the order the research lists them.

A component honouring nine axes with three compositions is far more flexible than today. A component
with six compositions and no axes is not flexible at all — it is just six more fixed looks. If a WP
must be cut short, it stops after stage 1 or 2, never mid-stage.

## A10 — Verification is measured, not asserted

Per WP, before AND after, all six combinations (`of-blood-and-bones`, `studio-alpha`, `studio-beta` ×
light, dark):

- Contrast via canvas `fillStyle` + `getImageData` readback — Chrome serialises `color-mix()` as
  `oklab()` floats and a regex over `getComputedStyle` returns garbage ~1.0 ratios. Resolve the
  effective background by walking ancestors until alpha > 250, because `body` is transparent here.
- Tap targets measured at `density: compact`, the worst case, on the content box INSIDE any border.
- Reduced motion: assert `--jp-reveal-distance` resolves to `0` and no element carries a running
  animation. Speeding an animation up is not stopping it.
- The three builder preview widths (375 / 768 / 1440). Container-query scoping means a composition can
  be correct at 1440 and broken at 375 independently.

HTTP 200 is not "it works" — assert rendered output and persisted state.

`studio-alpha` now has two seeded journey pages (`bone-deep`, `tending-the-grief`) specifically so
brand-neutrality is verifiable; it had none before this programme.

---

# Amendments from the component audit (`01-component-audit.md`)

The audit corrected several of my assumptions. These amendments supersede anything above that
conflicts.

## A11 — 11 public components, and they do NOT read `--jp-*`

There are **11** public section components (one per catalogue type, 6003 lines total), not 12. More
importantly: `render-edit/journey-sections.css` is **not shared with the public tree at all** — only
`render-edit/SectionRenderer.svelte:12` consumes it. Each public section is 100% self-contained
`<style>` and speaks **semantic `--color-*`**, which `.journey-palette--page`
(`journey-palette.css:236-247`) re-points onto the `--jp-*` ladder. `--jp-*` appears **0×** in
`render/sections/*.svelte`.

That indirection is the seam to reuse, so the division of labour is:

- **Colour stays `--color-*`.** Already brand-derived and auto-contrasted through the palette. Axes
  must not introduce a parallel colour vocabulary into the sections.
- **Geometry, rhythm, type-scale, edge, motion and media roles are `--jp-*`.** These are genuinely new
  roles with no `--color-*` equivalent (`--jp-rhythm`, `--jp-measure`, `--jp-reveal-distance`,
  `--jp-edge-width`, `--jp-media-aspect`, `--jp-display`).

The one exception is `--jp-accent-*`, which IS colour — it is an indirection over the ember tokens so
`accent: none` is five declarations rather than a repo-wide replace (research §2.3). Keep it, and note
it is the deliberate exception.

## A12 — All 37 variants already have working CSS, in the canvas tree

`render-edit/journey-sections.css` contains full modifier implementations for **every** declared
variant: `.jp-hero--split` (:274), `.jp-hero--minimal` (:308),
`.jp-prose--centered/--statement/--wide/--twocol` (:320-329), `.jp-video--simple/--split` (:372-375),
`.jp-descent`/`.jp-stagegrid`/`.jp-stages` (:380/:420/:428), `.jp-proof--stack/--spotlight`
(:457-464), `.jp-guide--centered/--quote` (:483-496), `.jp-faq--boxed` (:529),
`.jp-invite--banner/--card` (:550-557).

**This reframes the programme from "invent 37 layouts" to "port and generalise 37 layouts that already
exist."** Every component WP begins by reading its type's existing modifier rules and porting them —
never by designing from scratch. Design from scratch only for the genuinely new compositions in
research §3.

## A13 — The public tree is the one that diverged, and the bridge already exists

`render-edit/*` speaks the builder's vocabulary 1:1 with `section-fields.ts`. Verified against the
database: the golden page stores `hero.{eyebrow, headline, sub, button, accent, felt, quiet, trust,
bg}`, `ache.{kicker, heading, body}`, `faq.{q1,a1,…}` — i.e. **the builder's names are what is in the
data.** The public renderer's own vocabulary (`subheadline`, `ctaLabel`, `beats[]`, `items[]`) is the
later invention.

`render/coerce.ts:58-130` is already a competent bridge — `asStringFrom` (preference lists),
`asStringsFrom` (synthesise a list from flat fields), `asNumberedGroups` (`q1/a1` → array). So
`Codex-tqr51` is about the keys still **outside** that bridge, not a total copy loss.

**Confirmed live instance:** `HeroSection.svelte:41` reads `asString(config, 'ctaLabel')` with no
bridge to the stored `button`, then falls back to the hardcoded string `'Begin the journey'`. The
golden page stores `button: "Get started"` and the served HTML contains `Begin the journey`. A
creator's chosen CTA label is being replaced by hardcoded English on a real page.

**Direction:** extend the bridge, do not migrate the data. The builder's names are the input; the
array shapes stay the renderer's internal contract; `coerce.ts` reconciles them at the read boundary.
This keeps existing pages rendering with no migration and no change to the section prop contracts.
Take the exhaustive per-type key diff from audit §B verbatim — it is the WP's checklist.

## A14 — Container queries, not viewport media queries (answers audit E.5 Q2)

The canvas is container-query fluid (`.jp { container-type: inline-size }`,
`journey-sections.css:34`); the public tree is not. One answer, decided here: **container queries.**
The new `.jp-sec` wrapper carries `container-type: inline-size`, and `density` resolves through `cqw`
per research §2.3. A composition can be correct at 1440 and broken at 375 independently, which is
exactly why verification uses all three preview widths (A10).

Consequence for the WPs: the three raw-px media queries (`ReelSection:876` `760px`,
`ReelSection:890` `420px`, `InviteSection:510` `640px`) become container queries, not
`--breakpoint-*` media queries.

## A15 — The guide portrait contract addition lands in FOUNDATION (answers audit E.5 Q3)

`guidePortraitMediaId` and `guideVideoMediaId` are written by the builder but never projected into the
public render context. Surfacing them means a field on `JourneyCourseView` or `SellPreview` — a
shared-types edit. It belongs in the foundation round, not WT-6, because it is a cross-worker contract
change.

## A16 — Foundation is STAGED, in one worktree, with a gate between stages

The audit's serial list is 28 shared files plus a migration, a 575-line CSS split into nine partials,
and the unification of 11 components. That is too much for one uninterrupted pass. It runs as two
stages in the SAME worktree (`feat/journey-sections-foundation`, off `dev@013e2d42`) so the branch
stays coherent — never `isolation: 'worktree'`, which would give each agent its own tree.

- **F-A · contract + plumbing.** Audit Tier 1, the `SectionDesign` type and its two barrels,
  `resolveDesign`, the extended `coerce.ts` bridge, the guide-portrait context field, the
  duplicate-anchor fix, the `.jp-sec` wrapper emitting `data-jp-*` with `container-type`, and all four
  barrels' exports added up front. `variant`, `design`, `editable` and `onEdit` are added to the shared
  props interface as OPTIONAL — each component WP then implements them. Gate: `pnpm check:ci`, both
  `check:brand-boundary`, `pnpm typecheck`, `pnpm --filter web test`.
- **F-B · CSS substrate + axes + migration + minimal builder UI.** The `journey-sections.css` split
  into per-type partials, the new shared public-section CSS layer, `journey-design.css` (the 38 axis
  rules), the five new tokens, the two-pole refactor, the `--jp-faint` AA fix, the `landing_pages.design`
  migration with the Candlelit backfill, and a minimal design panel + preset picker. Same gate, plus
  the golden-page before/after comparison from A3.

### The unification lands in CONSOLIDATION, not in foundation — and this ordering is load-bearing

My earlier plan put the tree unification in F-A. That is wrong, and the reason is A12: the 37 variant
implementations live in `render-edit/journey-sections.css`. Deleting the canvas tree before those
layouts have been ported into the public components destroys the reference the component WPs are
supposed to port FROM.

Correct order:

1. **F-A / F-B** — contract, plumbing, axis substrate. The canvas tree is untouched. F-B splits
   `journey-sections.css` into per-type partials so each WP has a clean file to port from.
2. **WT-1…WT-7** — each WP ports its type's variant CSS out of its partial into its public component,
   wires the nine axes, adds compositions, AND implements `editable`/`onEdit` on its components. The
   unification therefore happens incrementally, per type, by the WP that owns those files.
3. **Consolidation** — only now repoint `JourneyBuilderCanvas.svelte` at the unified public components,
   delete `render-edit/sections/*`, `render-edit/section-registry.ts`, `render-edit/section-render.ts`
   and the drained `journey-sections.css` partials.

The canvas keeps showing a different page than the published one until consolidation. That is
acceptable — it already does today, and the alternative is losing the layouts.

## A17 — `JourneyPreviewFrame.svelte` is dead code

Exported from `components/page-builder/index.ts:17` and imported by **no route** — the full-page
iframe preview path is dead; only the inline canvas is live. Do not treat it as a verification
surface. Decide its fate (wire up or delete) in consolidation, not in a component WP.

## A18 — Raw-value cleanup is per-WP, because the files are per-type

The audit found 82 raw `px` and 12 raw hex/rgb occurrences across the public tree, concentrated in
`ReelSection` (18 px + 6 rgb/hex), `MapSection` (13), `FeelSection` (10), `ProofSection` (9). Each WP
cleans its own files — they are per-type, so this is disjoint work.

Highest-value classes, because they are the ones that break on a light-brand org:
`rgba(0,0,0,·)` scrims and text-shadows (`ReelSection:372,577,614,656,698`) and `#000` inside
`color-mix` (`GuideSection:197,211`, `IntroVideoSection:210,339`, `ReelSection:371,475`). Both become
`color-mix(in oklab, var(--color-background) …)` or a `--jp-scrim-*` token. Also: `SectionSkeleton:48-58`
and `MapSection:534-537` each re-declare `.sr-only` locally — use the global utility.

## A21 — A new page gets an EXPLICIT preset written, never implicit defaults

`SECTION_DESIGN_DEFAULTS` (width `text`, density `regular`, surface `bare`, edge `hairline`, align
`center`, type `balanced`, accent `fill`, motion `rise`, media `frame`) deliberately differs from the
recommended default preset **Signal** (width `wide`, surface `panel`, align `start`). That is not an
inconsistency to reconcile by changing one to match the other — the two serve different jobs:

- The **axis defaults** are the safety floor. They exist so a section with no stated opinion, from any
  client, at any version, still renders coherently. `resolveDesign` is total precisely so no axis can
  ever emit an empty attribute.
- The **preset** is a product choice a creator can see and change.

The rule: **page creation writes an explicit `design` bundle.** Never rely on the defaults to produce
the intended look.

The reason is a UI one. If a new page stores no `design`, the preset picker has nothing selected while
the page visibly renders *like something*. A creator then sees a control that appears to be doing
nothing, and any preset they pick looks like it "changed" the page when it merely made the existing
look explicit. An explicit stored value is inspectable, diffable and editable; an implicit default is
invisible. This is the same argument as A3's migration-not-defaults decision, applied to new pages
rather than old ones.

F-B2 owns this, alongside the migration and the picker.

## A22 — `createDefaultSections()` is DEAD CODE, and that changes `Codex-maf0y`

Verified: `createDefaultSections` in `section-catalog.ts:545` has exactly two references — its own
definition and the barrel re-export at `page-builder/index.ts:80`. **No caller anywhere in
`apps/web`, `packages` or `workers`.**

Corroborated by the data: no page in the database has the 11-section default set. The seeded pages
have four sections each (from `seed-portals.ts`'s own `buildSections()`), and the golden page's 11 were
evidently assembled by hand in the builder.

Two consequences:

1. **The "course template ships a default set" behaviour (SPEC §4.1) does not actually happen.** A new
   page does not start populated. Whether it should is a product question outside this programme's
   scope, but it must be answered before wiring A21 into "page creation" — because there may be no
   single page-creation path to wire into. F-B2 should establish where a page first comes into
   existence (likely the first `saveJourneyPage` from the builder) and put the explicit `design` write
   there.
2. **Bead `Codex-maf0y`** ("Journey sections seed placeholder copy that a published page serves to real
   visitors") is currently **latent, not live** — the placeholder copy is in `defaultProps`, but with no
   caller nothing seeds it on page creation. It becomes live the moment anyone wires the default
   template up. Worth recording on that bead so it is not closed as "not reproducible", and worth
   flagging to whoever implements A21: applying the default template without first fixing the
   placeholder copy would ship "A common question?" to real buyers.

## A20 — i18n scope is DELIBERATELY bounded, and here is the line

Fully internationalising this programme would mean roughly 176 new keys: 9 axis labels + 39 axis-value
labels, 8 preset names + 8 descriptions, and ~110 composition labels and hints. That is enough to
dominate the programme, and this repo already has two open beads from exactly this failure mode
(`Codex-3x8a2`, `Codex-6rbbx` — "keys were listed but not added"). So the line is drawn explicitly:

**IN scope — do it properly, these are new UI:**
- The 9 axis labels and their 39 value labels (the design panel).
- The 8 preset names and descriptions (the preset picker).
- The two hardcoded English strings in the public renderer: `HeroSection.svelte`'s
  `'Begin the journey'` and `'Go to your dashboard'`. These are on a public page. Note that once the
  `coerce.ts` bridge reads `button`, `'Begin the journey'` only shows when the creator set nothing — but
  it still needs a key.

**OUT of scope — pre-existing inline English, left as-is:**
- `section-catalog.ts`'s variant `label` and `hint` strings. They are already inline English today;
  adding more of the same keeps existing debt rather than creating a new category.

There is also a structural reason not to do it mid-programme: `section-catalog.ts` is a deliberately
pure, framework-free, public-bundle-safe module. Importing paraglide messages into it would make the
catalogue impure and pull message code into the public chunk. Doing it right means the catalogue holds
message *ids* that the builder UI resolves — a real refactor with its own risk, and not this
programme's job. File it as its own bead at consolidation, when the true key count is known.

## A23 — THE VERIFICATION ENVIRONMENT: the shared worker fleet must serve the SAME BRANCH

This one will waste a whole worktree's time if it is not understood, because the failure looks exactly
like a broken feature.

The read path for a journey page is **web → `content-api` worker → `CourseJourneyService`
(`packages/access`) → Postgres**. The worker fleet binds fixed ports (`SERVICE_PORTS`), so only ONE
fleet can run at a time. If that fleet runs from a checkout that does not have the branch's code, then:

- the branch's web app on its own vite port renders correctly-shaped HTML, but
- the data it renders came from a worker built from a **different** branch, so any new column,
  projection or schema field is simply absent.

Observed concretely: with the fleet on the main checkout (`dev`) and the branch's vite on 3020, the
golden page served the **neutral axis defaults** while the database held Candlelit — because
`content-api` was running `dev`'s `CourseJourneyService`, which does not select `landing_pages.design`.
Nothing was broken. The evidence was just being generated by the wrong build.

**Rule:** the shared fleet runs from whichever checkout holds the base branch the worktrees are built
on. It is now running from `/Users/brucemckay/development/Codex-js-foundation`
(`feat/journey-sections-foundation`), which serves `lvh.me:3000` plus all nine workers. Component
worktrees run **only** their own web app on their assigned port
(`pnpm --filter web exec vite dev --port 30NN --strictPort`) and share that fleet.

**Corollary for any WP that changes a `packages/*` file:** the workers consume the BUILT `dist`
(`@codex/access` declares `"main": "./dist/index.js"`). A source edit with no rebuild is invisible —
run `pnpm --filter @codex/<pkg> build`. A dist older than its source is the tell.

**Verified once the fleet moved:** all 11 sections of the golden page serve the exact Candlelit bundle
(`narrow/airy/media/none/center/monumental/glow/drift/bleed`) over HTTP 200. That closes the last
unverified link in the foundation — page-level `design` → service → renderer → DOM.

## A24 — The canvas readback needs `globalCompositeOperation = 'copy'`

A10 says to resolve the effective background by walking ancestors until alpha > 250. That is necessary
but not sufficient. The canvas probe itself must set `globalCompositeOperation = 'copy'`: with the
default `source-over`, a transparent colour composites onto whatever pixel was there before and reads
back as **opaque**, producing garbage ratios near 1.0 — the same symptom as the `getComputedStyle`
regex trap, from a different cause. Every measurement in this programme uses `copy`.

## A25 — APPROVED follow-up: section-less pages get Signal, not Candlelit

F-B2 followed A3 literally and backfilled Candlelit onto every row, then flagged that **678 of the 695
rows have zero sections** (only 17 pages hold any). Those pages get a cinematic look they have never
displayed, so a creator who later populates one starts from a niche aesthetic instead of the
recommended default — precisely what the neutral defaults exist to avoid.

That reasoning is right and the correction is approved:

```sql
UPDATE landing_pages SET design = '<signal bundle>'::jsonb
WHERE jsonb_array_length(sections) = 0;
```

It cannot change any appearance, because a section-less page renders nothing. Ship it as a follow-up
migration in consolidation. (Most of those 678 rows are `cascade-*` integration-test leftovers in the
dev database, which is a separate observation about test pollution — see `Codex-bsbf8`.)

## A26 — The composition count is 62, not 55: the research miscounted its own tables

Research §3's summary sentence says "37 → 8 collapsed away, 26 new … landing at ~55". Its own tables
list **29 new rows** and **33 kept/collapsed rows = 62**, and the genuine merges are **6**, not 8.

F-C implemented the **tables**, which are the specification; the summary is arithmetic. Final per-type
counts: hero 6 · introVideo 5 · ache 6 · turn 6 · reel 5 · map 6 · feel 6 · proof 6 · guide 5 · faq 5 ·
invite 6.

**Size the work packages from the per-type counts, never from "55."** The programme is ~13% larger than
the headline number. Also correct A20's i18n estimate: the composition strings are **62 labels + 62
hints**, not ~110.

## A27 — DECISION on the media blocker (`Codex-wqxv4`): Option A, as stage F-D

F-C found that `courses` exposes only four sell-media slots (`introVideoMediaId`,
`previewVideoMediaId`, `guidePortraitMediaId`, `guideVideoMediaId`) — **no hero image and no
signature.** Today's `hero.split` renders a *synthetic* radial-gradient plate, not real media. So
`hero.full-bleed`, `hero.poster`, `guide.letter` and `reel.strip` cannot render what they describe, and
the `media` axis is largely meaningless on the **hero** — the highest-visibility section on the page.

F-C was right to declare no field rather than ship a control that cannot change what renders; that is
precisely the mistake `SectionFieldDef.mediaSlot`'s own JSDoc exists to prevent.

**Decision: add `courses.heroMediaId` and `courses.signatureMediaId`** as named slots consistent with
the existing four, in a serial stage **F-D**, before the component rounds. A hero image is table stakes
for a landing-page builder — nearly every design family needs one — so leaving it out would undercut
the programme's whole premise. It is a cross-worker contract change (schema + `@codex/shared-types` +
the service projection + the builder field), which is exactly why it cannot live in a worktree.

**`reel.strip` is DESCOPED.** It needs 3–5 clips against a single `previewVideoMediaId`, which is an
array problem rather than a missing slot. Declared in the catalogue, left unbuilt, tracked on
`Codex-wqxv4`. WT-2 implements its other four compositions.

## A28 — `OWED_READS` is a self-clearing checklist, and it is how each worktree knows it is done

F-C added an `OWED_READS` map to `section-fields.test.ts`: `hero: accent/felt/bg` ·
`introVideo: clip/duration` · `reel: duration` · `ache: points` · `turn: from/to` ·
`guide: clip/duration/facts` · `faq: g1-g3` · `invite: accent`.

It is **a work list, not an exemption.** The suite also asserts each entry is *still genuinely unread*,
so a worktree that wires its read **must delete its own line or the test fails.** It should be empty by
consolidation. Treat your type's entry as a precise definition of done for the authorable-fields half of
your WP.

## A29 — Build the generic array control ONCE, in consolidation

F-C added four control types to the field model (`number`, `toggle`, `list`, `repeater`) and declared the
fields, but deliberately did not build the editor UI. Its recommendation, which I accept: build it once.

Three repeaters and three lists now exist across four types, so the alternative is four worktrees each
shipping their own; the interaction surface (add / remove / reorder / empty state / keyboard) is where
the bugs live and must behave identically everywhere; and `SectionEditor.svelte` is a single shared file,
so seven parallel implementations of it is exactly the conflict F-C exists to prevent.

Note the shapes are load-bearing, not cosmetic: `previewDuration` is read behind
`typeof raw === 'number'`, so a `text` control would write `"480"` and the section would silently fall
back to its default. That is how these keys became read-but-unwritable in the first place.

## A30 — Do NOT add a FAQ/proof `items[]` repeater without migrating first (`Codex-wtfs1`)

Both renderers **prefer** `items[]` and fall back to the numbered `q1/a1…` vocabulary. A repeater bound
to `items[]` is therefore a second authoring path that *wins*: a creator opens a page authored as
`q1/a1`, sees an empty repeater, adds one entry, and the three Q&As the page has been serving silently
vanish. Nothing errors and nothing warns — their own edit destroys content they could not see.

Order is mandatory: migrate stored numbered flats → `items[]` first, then add the repeater, and keep the
numbered fallback in `coerce.ts` for un-migrated rows.

## A31 — The FIRST component round is a SINGLE pilot worktree, not a pair

Revising my own plan. The README says two worktrees at a time, which came from the previous UX-polish
effort's cadence — but that effort was polishing surfaces whose mechanism already existed. Nothing has
yet wired a single design axis to a single component, so round one is not a polish round; it is the
first use of a mechanism that has only been proven in isolation.

Concretely, the unknowns the brief cannot answer in advance:

- Does `--jp-rhythm` compose correctly against a component's real padding, or does the
  `clamp(calc(--space-8 × rhythm), 6cqw, calc(--space-20 × rhythm))` form fight an existing
  `min-height`?
- Does the shared public-section CSS layer actually contain what a component needs when it deletes its
  local duplicates, or is it missing recipes nobody noticed?
- **Does Candlelit reproduce the section's current appearance?** This is the unverified bet from A3, and
  the first worktree is where it gets tested for real.
- Do the `--jp-accent-*` and `--jp-media-*` role tokens survive contact with a component that has five
  blend layers and a scrim?

Two worktrees hitting those simultaneously means two independent answers, possibly divergent, and I
would be reconciling them at merge instead of deciding them once.

**So: WT-3 (hero) runs alone as the pilot.** It is the right choice — highest visibility, the richest
inventory of hardcoded locks (`min-height: 100svh`, centred flex, a 12-mote atmosphere layer, a
word-by-word kinetic headline, fixed `padding-block`), six compositions, and it exercises nearly every
axis including `media` and `accent: glow`.

Whatever the pilot learns gets folded into the remaining six briefs before any of them start. Pairs
resume at round two: (WT-5 social, WT-4 map) → (WT-1 prose, WT-7 invite) → (WT-2 video, WT-6 guide).
This is the same reasoning that made the foundation serial, applied one level down — and F-C and F-D
both exist because that reasoning was right.

## A32 — A27 was half-right: a "hero image" can only be a VIDEO's poster frame (`Codex-490z7`)

F-D delivered A27 as specified and then raised the thing A27 did not know. Verified directly against
the database:

```
media_items · check_media_type  CHECK (media_type IN ('video','audio'))
```

**A still image cannot be a `media_items` row.** That is precisely why `courses.coverImageKey` is an
R2-key varchar rather than a media reference (`Codex-eqh0z`). So `courses.heroMediaId` — a `media_items`
FK — necessarily resolves through `toStill()` to the picked item's `thumbnailKey`, i.e. **a video's
auto-generated poster frame.** The same has always been true of `guide.portraitMediaId`, which A27 told
F-D to model on.

**What a creator actually experiences: to set a hero image they must upload a *video* and accept its
poster frame. There is no path to "upload this JPEG as my hero."** For a landing-page builder that is a
real gap — `hero.full-bleed`, `hero.poster` and `hero.split-media` are all image-led, and the `media`
axis is largely meaningless on the hero without one.

F-D built what was specified and raised the design question instead of quietly widening scope. That was
the right call, and it is what the "tell me if an instruction is wrong" clause is for.

**Decision: this does NOT block the component rounds, and it is not being done now.** The render-context
field `heroImageUrl` is the seam, and it is already correct and populated. A section consumes
`heroImageUrl` without knowing whether a video poster or an uploaded JPEG produced it — so WT-3 and WT-6
build their image-led compositions now, and real image upload lands behind the same seam afterwards via
the existing `coverImageKey` / `processCourseCover` pattern (R2-key column + multipart endpoint + the
image-processing service, which also handles SVG sanitisation per R15). Tracked on `Codex-490z7` with the
proposed fallback chain: `heroImageKey ?? heroMediaId`'s poster `?? ` today's synthetic plate.

**Also worth knowing from F-D:** the "four existing slots" A27 said to match are not four of a kind.
Three are real `courses` columns; `guidePortraitMediaId` lives inside the `guide` jsonb bag, and
`updateJourneySellMedia` read-then-merges it in-transaction so the guide's name/bio/quote survive. So
"match the existing slots" pointed at two different mechanisms. F-D used real columns, which is both
what I asked for and the better shape — the jsonb placement looks like a legacy accident and the
service's own comment flags it as unusual.

## A33 — The seeded `hero` variant was a SEED ARTIFACT, and rewriting it is restoration

The WT-3 pilot was the first code ever to honour `PageSection.variant` on the public page, and it
immediately found that **all seven real journey pages were about to change appearance.**

`seed-portals.ts:450` wrote `variant: 'split'` on every hero it created. The renderer ignored `variant`
entirely (`Codex-qcgo3`), so every seeded page **stored** a split hero while **rendering** a centred
stage. Migration 0085 then renamed the id in place, `split` → `split-media`, faithfully preserving a
value nobody had ever seen take effect. The moment the plumbing landed, all seven would have flipped to
a two-column split-media hero.

**Migration `0087` rewrites them to `stage`, and the seeder now writes `stage`.**

This looks like it contradicts F-C's principle that a creator's design choices are their content — the
principle behind the collapse migration's non-destructive `m.axes || section.design` merge. It does not,
and the distinction is the whole point:

- the value came from a **seed script**, not from a person;
- it was **never expressed**, because the renderer discarded it;
- **Candlelit's own variant map says `hero: stage`** (research §4.1), so the data and the preset
  documenting "today's page" disagreed — and the data was the artifact.

Writing `stage` restores what every visitor has actually been looking at, which is the standing A3/D8
invariant. `split-media` is not retired and loses nothing: it stays one of the hero's six compositions,
selectable in the builder. What it stops being is a default that arrived by accident.

Dry-run in a rolled-back transaction first, because `jsonb_agg` rebuilds the array: section **order
identical** (`hero,introVideo,ache,ache,turn,reel,map,feel,proof,faq,invite`), `UPDATE 7`, and a second
run `UPDATE 0`.

**The general lesson for every remaining worktree:** a stored value that the renderer has been ignoring
is not evidence of intent. Check what your type's pages store *before* assuming today's appearance is
your default composition.

## A34 — Shared fixes applied after the pilot

The pilot reported these rather than editing shared files, which was correct. All four are now on the
integration branch:

| Fix | Why |
|---|---|
| `CtaLink.svelte` `min-height: var(--tap-target-min)` | The CTA's content box measured **40–41px against a 44px floor** at every density and width — `--text-base` at `--leading-none` plus 2 × `--space-3` is 40px, and nothing declared a floor. Affects every journey CTA |
| New **`--jp-accent-mark`** role | `--jp-accent-fill` is `transparent` at `accent: text` and `edge`, so decorative brand marks vanished on 2 of 5 values. Real colour on all five; neutralises to `--jp-heading` at `accent: none` |
| `LEGACY_SECTION_VARIANTS.hero.minimal` += `type: 'expressive'` | The pilot found a **second** difference the map missed: `minimal` also shrank the headline ~23%. Without it a stored `minimal` renders monumental where it rendered small. Latent (no page stores it), which is why it was invisible |
| `HeroSectionProps` += `accent` / `felt` / `bg` | The three `OWED_READS.hero` keys, now wired. That self-clearing test went red exactly as A28 designed, and is cleared |

Adding `--jp-accent-mark` **broke the axis probe** in `journey-design.test.ts`, which asserts each value
emits *exactly* its specified properties. That is the harness working — the contract is pinned, so
widening it is a deliberate edit in two places, not a silent drift. Updated; 164 files / 1889 tests green.

## A35 — Two defects deferred to consolidation with reasons

**`Codex-8jve9` — `--jp-ember` is theme-blind while `--color-brand-primary` is not.** Measured: on
`of-blood-and-bones` dark the CTA is `#e1233b` while the entire journey accent ladder stays `#552e8e`.
Cause: `--jp-ember: var(--brand-color, var(--color-brand-primary, …))`, and `--brand-color` is always
set, so the theme-aware fallback never fires. **Not a one-liner**: F-B1's 100-combination sweep and every
accent figure in `04-contrast-baseline.md` were measured against the light purple, and
`--jp-ember-text`'s 55% calibration was derived against it. The fix must be paired with a re-sweep. Do
not attempt it in a component worktree.

**`Codex-b0fm6` — the builder spins on "Loading page…" forever** when `getJourneyForBuilder` returns
null, with the `[id]` param being the **landing_page id, not the course id**. Pre-existing, reproduced on
the base. It will cost every remaining worktree time, because the brief tells them all to add their
section through the builder.

## A19 — Frozen files: do not edit in any round

**AMENDED.** The list below was inherited from the audit's "frozen" recommendation, and it was wrong
about two files: `page-builder-store.svelte.ts` and `builder-save.ts` are **not** frozen, because the
page-level design write path IS store + save plumbing and F-B2 could not have been done without them.
F-B2 added `setPageDesign` and `setSectionDesignAxis` beside `setSectionVariant`, plus `design` on
`SavePagePayload` — additive and tested. Component worktrees still must not touch them.

`render/reveal.ts` (correct as-is, used by 9 of 11) · `render/safe-href.ts` (security guard) ·
`render/brand-overrides.ts` + its test · `page-builder-store.svelte.ts`, `builder-save.ts`,
`page-preview-bridge.ts`, `preview-protocol.ts` (store/save plumbing, orthogonal to this programme).

---

## Adopted without amendment

Recorded so no WP re-litigates them:

- **Nine axes**, closed enums, `data-*` attributes on the wrapper, consumed as custom properties. Not
  free-form values, not per-section CSS.
- **`edge` fuses border width and elevation.** They co-vary across all nine families; splitting gives
  20 combinations of which ~5 are coherent. `soft` exists so "elevation, no border" stays reachable.
- **`align` is a 2-value axis and still earns its slot** — it deletes ~8 redundant variants that
  differ in nothing but alignment and measure.
- **`accent: text` and `accent: glow` resolve to `--jp-ember-text`, never `--jp-ember`.** The latter
  measures 2.98:1 on dark ink and 2.46:1 on light. This is flagged in the research as the single most
  likely regression in the programme.
- **`accent: none` still resolves `--jp-accent-fill` to `--jp-ink-4`** so a price-bearing CTA stays a
  visibly distinct filled control in a monochrome family.
- **`media: bleed` is the only value shipping a scrim**, and its 21:9 aspect and 62% stop are tuned
  together. Aspect and scrim are coupled — changing one requires re-measuring text contrast over it.
- **`radius`, `elevation`, `colour`, `font`, `case`, `weight`, `columns`, `order`, `atmosphere`,
  `contrast`, `divider` and `sticky` are CUT** as axes, for the reasons in research §2.7.
- **Prices come only from `JourneySalesContext.offer`**, never authored copy, and every `invite`
  composition degrades to a price-less CTA when `offer` is null. Do not reintroduce an authored price
  string. Currency is GBP (£).
- **Retro/print ships as a documented recipe, not a preset** — it depends on a brand typeface the
  creator may not have chosen.

---

# Amendments from ROUND 2 (WT-5 social · WT-4 map)

Both worktrees ran in parallel off `359d0fc7`. Every amendment below is measured, and
several correct earlier amendments or the baseline document itself.

## A36 — a section `<h2>` reads `--jp-heading-size`; `--jp-display` is the PAGE's display heading

Both worktrees hit this independently and both asked for it to be decided once, out loud.
At `type: monumental`, `--jp-heading-size` **is** `--text-4xl` (48px) — exactly what the
`proof`, `faq` and `map` headings ship today. `--jp-display` is 80px, the hero's `h1` size.

Wiring a section `<h2>` to `--jp-display` would have taken every heading **48px → 80px on
every published page**, breaking the A3/D8 invariant silently. WT-5 measured 48→48 by using
`--jp-heading-size`; WT-4 measured the same and additionally pinned its third level (stage
name) at `max(--text-lg, --jp-heading-size / 2)`, landing on today's `--text-xl` exactly.

**The rule:** `--jp-display` is the page's display heading (the hero's `h1`). Every other
section's `h2` reads `--jp-heading-size`. A third, card-scale rung is A44.

`journey-sections-shared.css` already encodes this via `.jp-sec__heading--sub`, but its
comment reads as a suggestion ("for a subordinate heading inside the same section"). Taken
literally it says a section `h2` should use `--jp-display`. It is load-bearing, not advice.

## A37 — never carry a hardcoded mix percentage across onto an axis token

WT-5 replaced `color-mix(--color-brand-primary 26%, transparent)` with
`color-mix(--jp-accent-edge 26%, transparent)` and **regressed a ring from 3.32:1 to 1.62:1**,
because at `accent: glow` `--jp-accent-edge` is already a 45% ember mix — so 26% of it is
~12% ember.

**The axis token IS the strength the axis chose. Read it directly.** Every worktree will meet
this, because almost every "faint brand tint" in this tree is spelled as a mix of a raw brand
token.

## A38 — `--jp-accent-mark` contradicted its own documentation; FIXED on the integration branch

`journey-design.css`'s comment states the role "tracks `--jp-accent-text` deliberately … and
that inherits the AA-safe `--jp-ember-text` rather than the 2.04:1-in-dark `--jp-ember`."
The declarations assigned `var(--jp-ember)` at base, `fill`, `edge` and `glow`; only `text`
got the AA-safe value. **A34 documented the intent correctly and implemented the opposite.**

Both worktrees independently measured **exactly the 2.04:1 the comment names** against a 3:1
graphic floor — WT-5 via an accordion indicator, WT-4 via the descent spine. WT-4 worked
around it with local `--descent-signal` / `--descent-bloom` aliases.

Fixed: `--jp-accent-mark` now resolves to `--jp-ember-text` on all four values that were
wrong (`none` keeps `--jp-heading`). The pinned axis probe in `journey-design.test.ts` was
updated in the same change, which is A34's design — the contract is pinned so widening it is
deliberate, not silent drift. **Consolidation cleanup:** collapse WT-4's `--descent-signal`
back onto the role.

A34's reason for adding the role (marks vanish at `accent: text`/`edge`) still stands; it was
never contrast-safe, which is what the comment already knew.

## A39 — no alpha low enough to READ as faint survives the dark pole

Stated deliberately more broadly than my first version, because WT-4 showed the narrow version
would have missed its own two failures.

I originally framed this as an A37 corollary — "don't carry a mix percentage onto a *pre-mixed*
axis token like `--jp-accent-edge` at `glow`." WT-4 correctly pointed out that its failures were
**not** that case: `--jp-accent-text` is a text-role token, not pre-mixed, so nothing was
double-counted. A worktree reading the narrow rule would have checked only `--jp-accent-edge`
and shipped both defects.

**The general rule:** any alpha low enough to look faint fails 3:1 at the dark pole, whatever
token it is mixed from. Measured, three times, in two components:

| element | mix | dark ratio |
|---|---|---|
| WT-5, control ring | `--jp-accent-text` @ 55% | **2.53** |
| WT-4, node ring | `--descent-signal` @ 60% | **2.53** |
| WT-4, spine fade top | `--descent-signal` @ 45% | **2.05** |

The two 2.53s are independent measurements of the same failure mode in different components,
from different tokens — which is what makes this a rule rather than a coincidence.

WT-4 swept the thresholds rather than guessing, and the numbers are reusable: over the node's
own surface dark does not clear 3:1 until **80%**; over the page, until **70%**. Below that,
carry resting/hover state on **fill and border-weight**, not on opacity. Same class as the
pilot's CTA `min-height` — a decorative treatment applied to a functional element.

## A40 — invert continuous-motion fallbacks: the STATIC layout is the baseline

WT-5's `marquee`, written the usual way (animate, then override under reduced motion),
measured **clean on every probe** — `--jp-reveal-distance: 0`, zero running animations,
`transform: none` — and still parked **two of three quotes outside the clipped strip**,
because `.proof__track` is `flex: none` so `flex-wrap` never engaged.

An override-based fallback must remember *every* property the ticker set, and the forgotten
one was the one that made wrapping possible. So: **the static wrapped list is the baseline,
and the ticker lives inside `@media (prefers-reduced-motion: no-preference)`.** Nothing to
undo, nothing to forget, and every non-animating path — no CSS, SSR, reduced motion,
`motion: none` — lands on a layout showing every item.

**Use this for `reel.strip` and `invite.sticky`.** Ticker speed is
`calc(var(--jp-reveal-duration) * 52)`, solved backwards so `drift` ≈ 42s, which keeps the
`motion` axis in reach instead of a magic constant.

## A41 — `studio-beta` CANNOT satisfy A10, for any type

Verified twice: **zero courses, zero landing pages.** No served beta journey page exists or
ever has, so combinations 5 and 6 of "all six combinations" are unachievable as written.

**Standard method until it is seeded:** re-point `--brand-color` / `--color-brand-primary`
(and `--brand-color-dark`) to `#2563EB` on a served `studio-alpha` page and **label the
reading emulated.** Faithful for this pair specifically — `branding_settings` shows beta
declares no accent, background, font or dark overrides, identical in shape to alpha, so the
primary hue is the entire difference. Either seed beta one journey page centrally, or amend
A10 to name this method.

## A42 — `proof` precedence inverted to authored-wins

`context.testimonials` was overriding authored `q1/n1/c1`. **`course_testimonials` is empty
for every course (0 rows)**, so the flip moves zero pixels today and would have become a
migration the moment any creator added one row — at which point their typed quotes would
have silently vanished. Now consistent with every other prop's `authored ?? derived`.

## A43 — the programme docs were UNTRACKED for the whole programme

Root cause of a real defect this round: the eight files in `docs/design/journey-sections/`
existed only in the main checkout as untracked files, so **every worktree brief cited a path
that did not exist.** WT-5 recovered silently; WT-4 had to be corrected mid-flight. Now
committed on the integration branch, so rounds 3 and 4 read them from their own worktree.

## A44 — the `type` axis has no card-scale rung, and most sections are made of that

`--jp-display` and `--jp-heading-size` are both *heading* steps. A card-scale quote, an FAQ
question row, a map stage name, a guide bio and a feel inclusion are none of them — so
without a third rung the bulk of most sections is out of the `type` axis's reach.

WT-5 derived `clamp(var(--text-base), calc(var(--jp-heading-size) * 0.5), var(--text-2xl))`
in-component (17 / 17 / 20 / 24px across the four values), with `0.5` solved backwards from
Candlelit exactly as the pilot solved its `80svh`. WT-4 independently used
`max(--text-lg, --jp-heading-size / 2)` for its stage name.

Two components have now invented the same rung two different ways. **Promote it to a real
`--jp-body-size` in `journey-design.css` at consolidation** rather than letting four more
worktrees each derive it.

## A45 — CORRECTION to `04-contrast-baseline.md`: `.descent__node` was never theme-invariant

The baseline recorded `.descent__node` as `rgb(56,21,17)` "identical in light AND dark", and
`Codex-rvkmc` carried that as the cause of `.descent__rn`'s 4.45:1. **Both are wrong.**

WT-4 measured the node responding to the theme normally — pre-lit fill `rgb(210,204,196)`
light / `rgb(56,21,17)` dark, which are simply the two poles of `--color-surface-secondary`.
The baseline's two passes **each measured one pole twice and reported it as invariant.** This
is the missing-settle artifact of pilot lesson 8 corrupting a *baseline document*, not just a
live reading — so any figure in `04-contrast-baseline.md` taken before A46's settle is
suspect.

The real fault was the **foreground**, and worse than recorded: in the **lit** state that SSR
actually serves, the numeral painted `--color-brand-accent` and measured **1.13:1 in light**.
The bead's 4.45 is the *pre-lit dim* state. Fixed by routing through `--jp-accent-text` and
dropping the node tint 26% → 18%. `Codex-rvkmc` is closed.

**General lesson:** state matters as much as combination. Measure the state SSR emits, not
only the state the page settles into after enhancement.

## A46 — CORRECTION to pilot lesson 8: the settle must exceed the longest TRANSITION

260ms is not enough. With `background` transitioning on `var(--jp-reveal-duration)`
(`--duration-slowest`, 800ms at `drift`), WT-4 measured a surface at `rgb(71,38,32)` whose
settled value is `rgb(56,21,17)` — **a 4-point contrast error that looked entirely
plausible.** Everything was re-measured at 1200ms.

**Lesson 8 now reads:** 2× `requestAnimationFrame` plus a timeout **longer than the longest
`transition-duration` in the section**.

## A47 — the accent chain, stated accurately (this CORRECTS my own first version)

My first draft of this amendment repeated WT-4's framing without checking it, and said the
spine "has been shipping the platform's warning amber" and that "the old colour was a fallback
bug rather than a choice." **Both halves are wrong, and the accurate version is narrower.**

**The amber IS the platform's intended default accent.** `lib/brand-editor/defaults.ts:16`
declares `BRAND_DEFAULT_ACCENT = '#F59E0B'` and `tokens/colors.css:36` declares
`--color-warning: #f59e0b`. They are the same colour. So `--color-brand-accent:
var(--brand-accent, var(--color-warning))` falls back to precisely the amber the brand editor
shows as its own default swatch. Nothing leaked; an org that sets no accent is *supposed* to
be amber.

**And `of-blood-and-bones` DOES set one.** WT-4 checked `brand_overrides` and concluded neither
seeded org sets an accent — but the accent lives in `branding_settings.accent_color_hex`, where
`of-blood-and-bones` holds `#ED8110`. Custom properties inherit and `[data-org-brand]`
(`tokens/org-brand.css:18`) sits below `:root` (`themes/light.css:2`), so inside an org layout
the org definition wins regardless of their equal specificity. That org's spine was `#ED8110`
orange — never amber. WT-4's measurement of `#f59e0b` was on `studio-alpha`, which sets no
accent, so it was correct-by-design rather than evidence of a bug.

**Consequence for what shipped:** routing the spine onto the ember ladder is, on
`of-blood-and-bones`, a change from *the org's chosen accent* to *the org's primary* — a
deliberate design change, not a bug fix. It remains the right call (the axis system routes
every accent role through `--jp-ember` by design, and the 3:1 graphic-floor fix under A38/A39
is real and independent), but it must be recorded as a design decision. Approved by the user
2026-08-20 on the explicit principle that **brand colour must come from the token system**.

**The genuine underlying defect, which IS real and is platform-wide:**

1. The default accent is *expressed through* `--color-warning`, welding two unrelated
   semantics. Change the warning colour and every unset org's accent changes with it.
2. `themes/light.css:64` and `themes/dark.css:58` declare `--color-brand-accent:
   var(--color-warning)` with **no `--brand-accent` indirection at all.** Harmless inside an
   org layout, where the closer `[data-org-brand]` wins — but on any platform surface outside
   one, an org's accent can never apply.

76 consumers read `var(--color-brand-accent)`, including `Button`, `Badge`, `ContentCard`,
`SubscribeCTA`, `FeatureCarousel`, the platform homepage and seven journey sections. This is
the root cause of `Codex-d01er` ("`Badge variant="accent"` is warning-coloured") — one chain,
two symptoms. **Deliberately NOT fixed in round 2**: a 76-consumer token change is its own
work package with its own contrast sweep, and quietly widening a component round into it is
the scope error this contract exists to prevent. Filed separately.

**The transferable lesson:** verify what a token RESOLVES to, and verify the claim about *why*.
A plausible token name is not evidence of a plausible value — and "this looks like a bug" is
not evidence that it is one. Two of us asserted a fallback bug; the value was the documented
default all along.

## A48 — MEASURED CSS trap: `auto-fit` needs a FLEXIBLE max

`repeat(auto-fit, minmax(min(16rem, 100%), 24rem))` collapsed to a **single** 384px track at
a 768px grid — three cards stacked in one column at every width including 1440. A fixed max
makes the repetition count resolve to 1. Reproduced on a bare 768px probe:

| track | result at 768px |
|---|---|
| `minmax(min(16rem,100%), 24rem)` | `384px` (one track) |
| `minmax(16rem, 24rem)` | `384px` (one track) |
| `minmax(min(100%,16rem), 1fr)` | `374px 374px` (two tracks) |

It looks like a design choice rather than a bug, which is why it costs time. Belongs beside
pilot lesson 7.

## A49 — `ache: variant "default"` is on SIX sections across BOTH orgs, not one

The brief told every worktree that `studio-alpha`'s single `ache` section carries the invalid
`variant: "default"`. WT-4 found it on **six**: `of-blood-and-bones`
{`bone-deep`, `tending-the-grief`, `ancestral-threads`, `return-to-the-shoreline`} plus
`studio-alpha` {`bone-deep`, `tending-the-grief`}. Still leave them — the evidence is now
six times stronger, and it is WT-1's fixture to reason about.

## A50 — `map` consumes EIGHT axes, and that is correct

`media` is deliberately unconsumed: a stage has no media in the read model, and research
§2.2 names the five types where `media` is meaningful, saying the rest "ignore it, exactly as
they ignore a variant they do not offer." Do not treat an unconsumed `media` as a shortfall
on a type that has no media. Documented in the component header.

Related, and the same discipline: WT-4 shipped `table` with **3 columns, not the research's
4**, because `minutes` and per-stage `access` have no field on `JourneyPracticeView` /
`JourneyStageView`. A fourth column would have been a control that renders nothing — the
exact mistake `SectionFieldDef.mediaSlot`'s JSDoc exists to prevent.

## A51 — Candlelit's `width` was `narrow` and is now `text`; migration 0088 moves the data with it

The A3 bet — "Candlelit reproduces today's appearance" — was flagged as unverified because it
could not be checked before a component consumed an axis. Round 2 consumed them and measured
it. **It holds on eight of nine axes and fails on `width`, systematically:**

| section | cap today | Candlelit `narrow` | delta |
|---|---|---|---|
| hero | 48rem | 48rem | 0 — but only because the pilot TUNED it there |
| map | 60rem | 48rem | −12rem |
| proof | 68rem | 48rem | −20rem |
| reel | 72rem | 48rem | −24rem |

Only the hero matched. `narrow` narrows every other section by 12–24rem, so the bet was false
on this axis for essentially the whole page, across 695 rows.

**Resolved: Candlelit becomes `width: text` (64rem)**, which is within 8rem of every real cap
where `narrow` is 12–24rem off three of four. A per-type override map inside the preset would
be more faithful but needs the A21/A29 preset variant maps, which do not exist yet, and would
stop the preset being nine plain axes. User decision, 2026-08-20.

**The preset and the data are ONE change.** `design-vocabulary.test.ts` pins the preset to the
bundle 0084 backfilled, and its comment gives the reason: if they drift, all 695 pages silently
become "Custom" in the picker — a creator opens the panel and their page matches no preset. So
migration `0088` rewrites the stored `width` in the same commit as the preset edit.

**0088 is scoped to page-level `design` only, deliberately.** Two sections on the golden page
(`turn`, `feel`) carry a section-level `{"align":"center","width":"narrow"}` — that is **0085's
collapse output**, written so the retired prose `centered` variant kept its published
appearance. Those sections genuinely rendered narrow, so a section override correctly stays at
48rem while its page moves to 64rem. Overwriting them would destroy exactly what 0085
preserved. Section-level design is a creator's content (F-C's principle); only the backfilled
page-level bundle was ours to correct.

The predicate matches the exact nine-key bundle, not `design->>'width' = 'narrow'`. Both select
the same 695 rows today, but the loose form would also catch a page a creator later set to
`narrow` deliberately, and nothing could tell them apart afterwards. Dry-run in a rolled-back
transaction: `UPDATE 695`, golden page → `text`, both section overrides still `narrow`, and
F-B2's Signal probe (`studio-alpha/fb2-design-default-probe`, the only non-Candlelit bundle)
untouched. Verified after applying: 695 at `text`, 0 remaining `narrow` page-level, 2 section
overrides intact.

**The general lesson, and it is the round's most important:** an unverified assertion that
underpins a data migration must be verified by the FIRST work that can test it, and the test
must cover every axis rather than the ones that happen to be easy to eyeball. Candlelit was
right about typography — the part that got attention — and wrong about measure on three of four
sections, which nobody could see until an axis was consumed.

## A52 — process: re-read the branch tip immediately before merging

The orchestrator merged `feat/journey-sections-map` at `98db53ea` after WT-4 reported
completion, then gated the integration branch — but WT-4 had produced a SECOND commit
(`cebee3ac`) in response to a mid-flight correction, containing two real 3:1 fixes. **The gate
therefore ran green on an incomplete tree.** Nothing was lost because the follow-up was caught,
but a green gate on a stale tip is exactly the kind of false assurance this programme keeps
finding. Re-read the tip at merge time; a report is a snapshot, not a promise of finality.

## A53 — the vite-during-tests hazard is REAL but NOT universal

WT-5 measured a 30× slowdown (6384s vs 142s) with its dev server running, producing 7 false
failures. WT-4, running the same suite with its own vite up, measured **176s vs 142s and zero
failures** — a 1.24× slowdown. So the hazard is real, was misreported by me as a general rule,
and is evidently load-dependent. WT-4's own conclusion is the right one to carry: **"it passed
with vite up" is not evidence that vite-up is safe.** Stop your vite; just do not conclude your
machine is immune because one run survived.

## A54 — never compose an `--jp-edge-*` token into a larger value

Both halves of this are now measured, from opposite directions, in the same file.

`--jp-edge-width` resolves to a **unitless `0`** at `edge: none`, which poisons `max()` and makes
a `border` shorthand invalid. WT-7's inherited work already documented that half.

`--jp-edge-shadow` resolves to the **keyword `none`** at `edge: none` (Candlelit — so all seven
published pages) and at `edge: heavy`. `box-shadow`'s grammar is `none | <shadow>#`: `none` cannot
be one *item* of a comma list. So

```css
box-shadow: inset 0 0 0 2px var(--jp-accent-mark), var(--jp-edge-shadow);
```

is **invalid at computed-value time**, and because `box-shadow` is not inherited it falls back to
its initial value — `none`. Measured `getComputedStyle(el).boxShadow === "none"` at those two
values, and a literal `inset 0 0 0 2px red, none` behaves identically, so it is the CSS grammar
and not a `var()` quirk.

The cost, before it was caught: the recommended-tier ring, the price-less threshold's only
boundary on four of seven pages, and the sticky bar's edge **all painted nothing** — on every
published page, invisibly, because the declaration silently evaporates rather than erroring.

**The rule:** an `--jp-edge-*` token is the whole value of its own property, or it is not used.
If a composition wants an axis border *and* its own ring, the ring goes on `outline` (with a
negative `outline-offset` to sit inside), leaving `box-shadow` to the axis alone. Every remaining
worktree will meet this the moment it wants "the axis edge plus my own emphasis".

## A55 — A36 NARROWED: `invite`'s `<h2>` is the tree's only display-scale section heading

A36 says a section `<h2>` reads `--jp-heading-size` and NEVER `--jp-display`. It was written from
four sections whose local heading rules were all `--text-3xl`/`--text-4xl`, and its purpose is to
stop an axis growing a 48px heading to 80px on published pages.

`invite` is the exception, verified on the base commit: `.invite__heading` shipped
`font-size: var(--text-display)` where `.feel__heading` shipped `--text-3xl`. It is the page's
**closing** display moment, paired with the hero's opening one. Applying A36's letter would take
the desktop heading **80 → 48px on seven published pages** — the same A3/D8 breach A36 exists to
prevent, arriving from the other side.

Measured at real viewports (375 / 768 / 1440), because `--text-*` carries `vw`:

| `type` | `--jp-display` (what ships) | `--jp-heading-size` (A36's letter) |
|---|---|---|
| `restrained` | 24.6 / 28.5 / 30 | 20.4 / 23.4 / 24 |
| `balanced` | 37.2 / 46.1 / 48 | 24.6 / 28.5 / 30 |
| `expressive` | 28.0 / 35.2 / 44 | 31.0 / 38.4 / 40 |
| **`monumental`** | **44.0 / 50.6 / 80** | 37.2 / 46.1 / 48 |

`monumental` is Candlelit and is what all seven pages carry, and its row is **identical to the
base commit at all three widths — zero delta**.

**The amended rule:** A36 governs a section `<h2>` that today ships `--jp-heading-size`-scale
type. The test is **what the element ships on `dev`, not its tag name.** `invite` is the sole
exception in the tree; a future worktree claiming a second one must show the measured base-commit
`font-size`, as WT-7 did.

## A56 — A33 is a CLASS of defect, not an incident (migration 0089)

0087 rewrote a seeded `hero: split-media` back to `stage` because the seeder wrote a variant the
renderer discarded, so no visitor ever saw it. Round 3 found **exactly the same defect on
`invite`**: `seed-portals.ts:499` hardcoded `variant: 'card'` on every invite it created, and all
seven real pages stored `card` while rendering the cinematic `pool`. Migration `0089` restores
`pool`; the seeder is fixed in the same change, because by value alone a creator's deliberate
`card` is indistinguishable from the artifact.

Two types, two seeders' literals, two silent flips averted. **Every remaining worktree must check
its own type's stored variant against what the page actually renders, as part of stage 2** — the
check is not optional and it is not the orchestrator's to remember for you. `introVideo`, `reel`,
`guide` and the remaining prose types all have seeder-written variants that have never been
expressed.

The distinction that decides the fix is the one 0087 drew and 0089 restates, and it stayed sharp
under pressure in this round because both cases appeared at once:

- **A seeder's literal, never expressed** → restore what visitors have been seeing. `invite: card`.
- **A human's choice, expressed in a builder where it visibly did something** → leave it, and let
  it land. The golden page's `turn`/`feel` carry section-level `{"align":"center","width":"narrow"}`
  written by 0085 from a `centered` variant a person selected; WT-1 left them, correctly, and the
  consequence is that honouring them changes those two sections from a 68rem left-aligned
  two-column layout to a 48rem centred measure stack. **That is `Codex-qcgo3` landing, not a
  regression.**

By value alone the two are indistinguishable. Provenance is the whole of the test.

## A57 — a token DOCUMENTED as a mirror is not a mirror until both expressions are read side by side

The journey on-fill ratio (`studio-alpha`'s label at 4.43:1) sat open for three rounds on this
reasoning, recorded in `journey-design.test.ts`'s `KNOWN_OPEN` note: *"`--jp-on-ember` mirrors
`--color-text-on-brand`, so the same 4.43 applies to every primary Button on that org … a design
decision with a much wider blast radius than a section axis."*

Read side by side they were never the same expression:

```
--color-text-on-brand : clamp(0,    (0.62 - l) * 1000, 1)
--jp-on-ember         : clamp(0.05, (0.60 - l) *  100, 0.98)
```

Different pivot, different multiplier, and — the one that mattered — **a different ceiling**. On
`#E11D48` (OKLCH L = 0.5858) both pivots saturate, so the platform token hands back `#ffffff`
(4.70:1, passes) and the journey token handed back `#f8f8f8` (4.45:1, fails). One side of the 4.5
floor each, from a two-hundredths difference.

The original analysis was **right** that no PIVOT fixes it — 0.60, 0.62 and 0.65 all measure
identical, because the fill's lightness saturates every threshold — and wrong about what followed.
The pivot was never the variable; the RANGE was. `--jp-on-ember`'s ceiling is now `1`, the sweep
is green across all 100 combinations at all 8 poles, `KNOWN_OPEN` is empty (kept for its
mechanism), and the blast radius was journey-only the whole time.

**AND A SECOND CORRECTION, TO MY OWN FIRST VERSION OF THIS AMENDMENT.** I wrote that this
closed `Codex-g7ipk`. It does not. `Codex-g7ipk` is a **different, still-open P1**: brand-painted
surfaces (`Button.svelte:110-112`, `FeatureCarousel.svelte:384-393`) hardcoding
`--color-text-inverse` / `--media-glyph` instead of consuming `--color-text-on-brand` at all — 9
pairs below AA, with a documented trap that a naive repoint regresses every PLATFORM dark primary
button, because `--color-text-on-brand` is a static `#ffffff` outside `[data-org-brand]`.

The journey on-fill ratio **never had a bead of its own.** `CONTINUE-round-2.md` attributed it to
`Codex-g7ipk` on the strength of both being "on-brand ink", and every later doc inherited that
line, including the WP brief handed to WT-7. They are cousins and not the same defect: g7ipk is
about which surfaces CONSUME the platform token; this was about the JOURNEY token's own range.
Fixed here, verified by the 100 × 8 sweep, and **`Codex-g7ipk` remains open and untouched.**

Which makes this amendment an instance of itself: I verified the two token EXPRESSIONS side by
side and then took the bead ID on trust from a summary doc. Read the bead, not the citation.

Note what made it findable: WT-7 was told to measure what a token *resolves to* and to verify the
*claim about why*. It reported `sameToken: false` as a measured fact. The bead had been reasoned
about accurately and never read.

**Corollary for the remaining rounds:** `journey-design.test.ts` computes contrast in a JS colour
model and then asserts that model against the stylesheet (`the colour model matches the CSS it
claims to model`). Changing any palette token therefore takes THREE coupled edits — the CSS, the
model's derivation, and the formula assertion. The guard caught a half-change within a second,
which is exactly its purpose; do not work around it.

## A58 — the `--jp-display` rung is NON-MONOTONIC: `expressive` renders SMALLER than `balanced`

Measured at 375 / 768 / 1440: `expressive` gives 28.0 / 35.2 / 44px where `balanced` gives
37.2 / 46.1 / 48px. The cause is upstream of this programme — `--text-5xl` maxes at `2.75rem`
while `--text-4xl` maxes at `3rem`, so the ladder inverts at that step.

`--jp-heading-size` is monotonic (24 / 30 / 40 / 48), so the fault is isolated to the display rung
and reaches every `--jp-display` consumer: today the hero's `h1` and `invite`'s `h2`. A creator
moving `type` from `balanced` to `expressive` gets a *smaller* display heading, which reads as a
bug in the axis rather than in a typography token. Reported, not fixed here — it is a
`tokens/typography` change with consumers well outside the journey tree.

## A59 — porting a heading to `.jp-sec__heading` changes THREE properties, not one

The shared atom carries `line-height` and `letter-spacing` as well as `font-size`. `invite`'s
`<h2>` moved from `--leading-tight` to `--leading-none` (100px → 80px on an 80px heading) and from
a local `-0.02em` to `--tracking-tighter` (−0.03em) — both while its `font-size` was byte-for-byte
unchanged.

Neither is a defect and both are the `type` axis doing what stage 1's mapping table asks. But they
are **silent Candlelit deltas** for any section whose local heading rule did not already match the
axis, and a worktree that only diffs `font-size` will report "matches" and be wrong. Measure
leading and tracking alongside size when verifying Candlelit.

## A60 — `onEdit` must write back to the key the value was READ FROM

Alias lists are ordered preference lists, so an inline edit that always writes the canonical key
corrupts a page that stores the alias. Concretely: the six seeded `ache` sections store `eyebrow`;
had their inline edit written `kicker`, the page would hold **both**, `eyebrow` would keep winning
the preference list, and **the creator's edit would render as nothing while the data silently grew
a second copy.**

All four round-3 sections use a `readKey(keys, fallback)` helper that returns whichever alias the
value actually came from, pinned by a test asserting a page storing `statement` edits as
`statement` and one storing `heading` edits as `heading`. Every worktree implementing the
`editable`/`onEdit` seam over an aliased prop needs this; it is not covered by the pilot's lesson 9,
which is about SSR-safety rather than write-back.

## A61 — CORRECTION to A10's tap-target metric: "content box inside any border" is wrong for a hairline

`--tap-target-min` is `max(2.75rem, var(--space-11))` = 44px, and with the app's global
`box-sizing: border-box` that yields a **44px border box and a 42px content box**. Read to the
letter, A10 fails by 2px on every journey CTA on every section — including the pilot's, which A34
records as fixed.

WCAG 2.5.5 / 2.5.8 measure the **pointer target**, and a 1px transparent border is part of the
clickable area, so a 44px border box passes. A10's wording was aimed at *padded* boxes, which is
where round 2's real error happened — a control whose visible box cleared 44px while its content
box did not.

**Amended:** measure the pointer target, i.e. the border box, and separately confirm no *padding*
is eating the target. `CtaLink` is deliberately unchanged; if the letter is ever preferred it needs
`min-height: calc(var(--tap-target-min) + 2 * var(--border-width))`.

## A62 — a reported "pre-existing i18n key" must be verified against `en.json`

WT-1 reported seven keys, four of them as already existing (`journey_turn_stages_label_descent`,
`journey_feel_preview_group`, `journey_feel_preview_play`, `journey_feel_preview_pause`). **None of
the four was in `messages/en.json`**, and the three prose components imported paraglide not at all
— the strings were inline English literals in `aria-label`s and `<p>`s. Round 3 needed **twelve**
new keys, not the eight requested.

This is a benign-looking error with a sharp edge: i18n is single-owner precisely so a worktree
cannot add keys, which means the orchestrator is the only party who can notice a key does not
exist. A report that says "already exists" ends the check unless someone greps.

**Rule for both sides.** A worktree citing an existing key quotes the `en.json` line. The
orchestrator greps every claimed key before accepting the list, and greps the components for
`m.journey_*` call sites to confirm the strings are actually keyed rather than merely reported.
Verified after wiring: all 27 `journey_*` keys reach BOTH generated files
(`src/paraglide/messages/en.js` and `src/paraglide/messages.js`), with only the former git-tracked.

---

# ROUND 4 AMENDMENTS (A63–A72)

Round 4 wired the last three types (`introVideo`, `reel`, `guide`), completing all 11. Every amendment
below is a MEASUREMENT, and several correct an earlier amendment rather than extending it.

## A63 — A54's mechanism is the KEYWORD, not the `--jp-edge-*` family. Generalise it.

A54 was derived from `--jp-edge-shadow` and written as *"never compose an `--jp-edge-*` token into a
larger value."* That framing is too narrow and would have missed most of the surface.

The actual failure: **a custom property resolving to the keyword `none` — or to a unitless zero —
cannot participate in a list, a shorthand, or a math function.** The whole declaration then goes
invalid at computed-value time and falls back to its initial value. It stays syntactically valid, so
nothing lints it and nothing warns.

Three more axis tokens resolve to `none`, and **none of them is in the `--jp-edge-*` family**:

| token | `none` at |
|---|---|
| `--jp-accent-glow` | 4 of 5 `accent` values |
| `--jp-media-scrim` | 4 of 5 `media` values |
| `--jp-media-mask` | 4 of 5 `media` values |

So `background: var(--jp-media-scrim), var(--color-surface)` evaporates exactly as A54's three rings
did — and that is a *natural* thing to write, because layering a scrim over a surface is what the token
is for.

**The rule:** any axis token that can resolve to a keyword must be used as the WHOLE value of its
property, never as one item of a list, never inside `min()`/`max()`/`clamp()`/`calc()`. Want the axis
value *plus* your own? Put yours on a different property — a ring goes on `outline` with a negative
`outline-offset`.

Guard filed as `Codex-3kqqp`. A prose warning in a component header demonstrably does not propagate —
see A64.

## A64 — `--jp-edge-width` was a unitless `0`, and it silently killed a border on every published page

`journey-design.css` declared `--jp-edge-width: 0` at `edge: none` and `edge: soft`. A unitless zero is
a `<number>`, not a `<length>`, so **any math on the token mixes types**.

`MapSection.svelte:1056` shipped, on four card selectors:
```css
border: max(var(--jp-edge-width), var(--border-width)) solid var(--jp-edge-color);
```
written specifically to FLOOR the width so cards could not dissolve at `edge: none`. Because
`edge: none` IS Candlelit, the shorthand went invalid on every published page and `border-style` stayed
`none` — the exact opposite of what the floor intended. `dev@013e2d42` ships those cards with a real
hairline (`border: var(--border-width) solid var(--color-border-subtle)`), so it was a live regression,
not a new look.

**Both declarations now carry an explicit `0px`, so component math on the token is safe.** The twelve
plain `border: var(--jp-edge-width) solid X` consumers are unaffected — `0px` and `0` are identical
there, which is exactly why only MATH on the token broke and why it was so easy to ship.

**The process lesson is larger than the fix.** `InviteSection.svelte:1187-1196` MEASURED and documented
this precise mechanism in round 3, in prose, ending *"Reported for a one-character fix in the axis file;
until then, no component math touches that token."* The diagnosis was correct and complete, and nobody
swept the tree — so a second component carried the same bug for a whole round. **A correct diagnosis
recorded only in a component header does not reach the next component.** It needs a test, or a fix at
the root, or both.

## A65 — A51's per-type override map is now needed on FOUR of the nine axes

A51 named the gap (*"a per-type override map inside the preset… needs the A21/A29 preset variant maps,
which do not exist yet"*) and deferred it. It now has four independent measurements:

| axis | page-level value | the type that disagrees | measured |
|---|---|---|---|
| `width` | `text` | `reel` 72rem→64rem, `introVideo` 60rem→64rem | accepted at A51 |
| `type` | `monumental` | **`feel`** — ships `--text-3xl` (40px) where `proof`/`faq` ship `--text-4xl` (48px), so A36 grows its `<h2>` **+8px on 2 published pages** | round 4 |
| `media` | `bleed` | **`guide`** — letterboxes the *portrait* to 21/9 (407×175 @1440); `mask` is `4/5`, what the base shipped. **`introVideo`** — wants `frame`; `bleed` takes it 16/9→21/9 and radius→0. But `reel` and the round-1 `hero` both want `bleed` | round 4 |
| `align` | `center` | `reel` — base right-aligned `.reel__sub` at `@media (--breakpoint-md)` unconditionally | round 4 |

**None of these can be fixed locally, and that is the whole point.** Lowering `type: monumental` to
spare `feel` breaks `proof`/`faq`'s clean 48→48. Changing `media: bleed` to spare `guide` or
`introVideo` changes `hero` and `reel` on every published page — and `bleed` is the ONLY value that
ships a scrim, so it is load-bearing for any composition placing text over media. Each fix is correct
for one type and a regression for another. That is the definition of a missing layer.

Evidence FOR keeping the page-level default: `introVideo`'s `type` matched **byte-identically** at all
three widths (37.24 / 46.08 / 48px), because `.intro__heading` shipped `var(--text-4xl)` and
`--jp-heading-size` at `monumental` *is* `--text-4xl`. The page value is right for most types most of
the time. **The override map must be an escape hatch, not a replacement.**

Constraint on its shape: `design-vocabulary.test.ts:116-131` pins Candlelit's nine values to what `0084`
backfilled onto 695 rows, precisely so preset and data cannot drift. **The override map must sit BESIDE
the pinned bundle**, resolving `section.design[axis]` → `preset.perType[type][axis]` →
`page.design[axis]` → default. Modify the pinned values and all 695 pages read as "Custom" in the picker.

Filed as `Codex-9tze8`.

## A66 — "Verify Candlelit" is TWO different checks, and only one of them is falsifiable

A3/D8's bet is that 695 rows were backfilled with a preset **reproducing today's appearance**. Every
Candlelit check through round 3 was therefore a **fidelity** check: does the preset render what shipped?

`guide` has never appeared on a published page — **zero rows in the entire database**. So for `guide`
there is no "today" to reproduce, and the fidelity check is not merely hard, it is **undefined**. The
only available check is a **consistency** check: does the bundle produce something coherent and legible
for this type?

**A worktree must state which check it performed.** Both of Candlelit's known errors — `0088`'s `width`
and `0089`'s `invite` variant map — were caught by fidelity, i.e. by someone noticing a mismatch against
a real page. **A type with no stored rows has no such tripwire**, which makes it the likeliest place for
a third Candlelit error to survive undetected. For row-less types, do the arithmetic; do not trust the
eye.

## A67 — Three measurement corrections, each of which changed a conclusion

**(a) Type must be measured at REAL viewports, not a constrained container.** `--text-*` carries a `vw`
term, so a container constrained to 375px inside a 1440px window reports the **1440px** `font-size`.
A first pass read 48px at 375; the truth was 37.24px. A10's "constrain `.jp-sec`'s inline size" is
correct for *container queries* and wrong for *type*. Resize the viewport for anything type-related.

**(b) A10's ancestor walk CANNOT measure text over media.** The scrim and the poster are
absolutely-positioned **siblings**, not ancestors, so walking up returns the frame's base colour. It
reported 15.58:1 for a chip whose real backdrop is a plate. Use a **glyph-pixel diff** instead: shoot
the region with text visible, shoot it again with `color: transparent`, and take contrast only where ink
landed. Note `visibility: hidden` is the WRONG control — it removes the chip's own plate, so the
"without" shot reads what is behind the plate, which produced 7082 phantom "glyph" pixels in a 4700px
box and a **reproducible-to-2dp 2.16:1** that was pure artefact.

**(c) There is a THIRD reveal state beyond round 3's SSR-vs-settled: armed-and-never-entered.**
`reveal.ts` arms `opacity: 0` from JS and clears it only when an IntersectionObserver fires, so a
below-the-fold section stays invisible indefinitely. A scroll sweep left **5–10 nodes still armed** on
an 8078px page, and a crop behind an invisible section reads the page background as a plausible, stable,
**wrong** ratio.

**CORRECTED — "force `is-in`" does NOT work, and I wrote that here without testing it.** The arming
class sits on the **PARENT**, not the revealed element: `.ache__inner` carries `reveal--armed` while its
children carry `.jp-reveal` + `data-jp-step`. Adding `is-in` to all 39 `.jp-reveal` nodes left every one
of them still computing `opacity: 0`, because `is-in` is not what the rule keys on.

**The forcing action that works is to REMOVE `reveal--armed` from the parents** (11 of them on the
golden page):
```js
document.querySelectorAll('.reveal--armed').forEach((n) => n.classList.remove('reveal--armed'));
```
**And the failure was silent, which is the part worth internalising.** A sweep using the `is-in`
approach returned `worst: null` for `ache`, `turn` and `feel` — read as "nothing to measure" rather than
"I could not measure". After disarming the parents the same sweep measured **3 to 26 leaves per
section**, so it had been under-sampling *every* section, not merely missing three. **Assert a non-zero
measured count per section and treat zero as a failure**, never as a pass — the same discipline as
`sectionCount === 0` on the builder.

Also: the builder canvas loads curriculum stages **asynchronously** — 20 descendants at a 2.5s settle,
**128 at 9s** on the same section. A46's "2× rAF + ≥1200ms" is calibrated for the PUBLIC page and
**under-reports canvas fidelity**. Wait for a stable count.

## A68 — `--jp-media-scrim` is bottom-anchored, so the aspect↔scrim coupling has a half no aspect fix reaches

The `media: bleed` rule, in three parts. Parts 1–2 were anticipated; **part 3 was not.**

1. **Text on media only where the axis ships a scrim** — `bleed`, only `bleed`. At `frame`/`mask`/`inset`
   the caption, meta and transport drop *below* the frame. §5.1 says the composition "uses `bleed`", but
   `media` is creator-facing, so a composition must **degrade**, not demand.
2. **Never override the aspect per breakpoint — FLOOR it.** `min-height: calc(var(--jp-body-size) *
   11.5)`, scoped to where text is actually over media. A floor can only make the box taller, moving the
   62% stop further above the text; a second `aspect-ratio` can make it shorter.
3. **`--jp-media-scrim` is `to top`, so it protects nothing at the TOP of the box at any aspect — and a
   text block that WRAPS climbs out of it.** Neither is an aspect problem, so part 2 cannot fix either.
   Reel's rec tag was unprotected **by construction**, not by aspect. Over-media blocks therefore read
   `background: var(--jp-media-scrim)` **on their own box** with `padding-block-start` as the fade
   lead-in, and top-anchored chrome carries its own plate at **88%** — not a glassy 55%, because A39
   applies to plates too.

Since Candlelit is `media: bleed`, all three describe the live path on **695 pages**, not a new surface.

## A69 — A56's seeder claim is FALSE for `introVideo` and `reel`

A56 says `introVideo`, `reel` and `guide` all carry seeder-written variants that have never been
expressed. **`seed-portals.ts` writes `variant` on exactly four types**: `hero:stage` (:458),
`ache:default` (:470), `map:descent` (:483), `invite:pool` (:503). Neither video type appears, so there
is no seeder literal for either to be an artifact of.

Both stored rows (`introVideo|theatre`, `reel|theatre`) are the catalogue **default** landing, and
stored value, Candlelit's map, catalogue default and rendered markup all agree. **A clean negative.**
The check was still worth running — 0087 and 0089 were both positives — but the amendment overstated its
scope. `0090`/`0091` remain unused.

## A70 — A22's "`Codex-maf0y` is latent, not live" is wrong, and each bridge fix promotes one more placeholder

A22 reasons from `createDefaultSections` being dead code. But the placeholder reaches pages via the
**add-section path**, which seeds the catalogue's `defaultProps`. Two published rows confirm it.

**The mechanism nobody had written down:** a seeded placeholder is invisible while its type's bridge is
broken, because the renderer reads the canonical key and the row stores the alias. Wiring the bridge
**promotes the placeholder to visible.** Measured on `studio-alpha/bone-deep` (published): the guide
placeholder went from **2 occurrences / 0 rendered** to **3 / 1**. `faq` and `proof` already went through
this conversion in rounds 2 and 3, unnoticed.

So `Codex-maf0y` is not "placeholders exist" — it is **"each bridge fix promotes one more placeholder to
visible"**, which makes the remaining types a *queue* of future leaks rather than a static list. That is
what makes it worth prioritising.

**Do not fix it renderer-side.** A renderer already self-hides an *absent* field; a placeholder is
present-with-placeholder-content, and string-matching seed text breaks the moment the seed changes. The
fix is seeding strategy, in a closed file.

## A71 — The builder canvas applies NO page-level styling: not the axes, not brand overrides

`resolveDesign` is called in exactly three places — `render/SectionRenderer.svelte:67`,
`PageDesignPanel.svelte:49`, `SectionEditor.svelte:63` — and **never in `render-edit/`**. Measured: the
canvas emits **0/10** `data-jp-*` and resolves **0/9** axis properties on 11 of 11 sections; the public
page emits 10/10 and 9/9 on 11 of 11.

But it is wider than the axes. Page-level styling lives in **two** public-tree wrappers:
`render/JourneyRenderer.svelte:55` `brandOverridesToStyleAttr(...)` and `render/SectionRenderer.svelte:67`
`resolveDesign(...)`. `JourneyBuilderCanvas.svelte:28` imports `render-edit`'s `SectionRenderer`
**directly**, bypassing both.

Confirmed by a real divergence: `--color-brand-primary` read `#D82741` in the canvas and `#552e8e` on the
public page for the same org. Cause — `landing_pages 'of-blood-and-bones/pricing-smoke-test'` is the
**only** row with non-empty `brand_overrides`
(`{"primaryColor": "#552e8e", "tokenOverrides": {"--brand-shader-preset": "lava"}}`), and it is the golden
page every measurement runs against. **The public page is correct; the canvas does not read the override.**

This changes the fix: a patch that only calls `resolveDesign` in `render-edit/SectionRenderer` would still
preview the wrong brand on that page, and would do so *more convincingly* because everything else would
look right. Filed as `Codex-6nrsk`.

**Corollary for `04-contrast-baseline.md`:** `#552e8e` is a **PAGE** fact, not an org fact.
`branding_settings.primary_color_hex` for `of-blood-and-bones` is `#D82741`. Any figure attributed to that
org must name the page — the same token measured 6.04 dark on the golden page and 8.38 on `bone-deep`, and
both are correct.

**Corollary for annotate-don't-drain (A16):** it *strengthens* the rule. If the canvas applies no
page-level styling, draining a `_*.css` partial takes the twin from *untreated* to *unstyled*, which A16
explicitly will not accept.

## A72 — What the builder actually does with the four unbuilt control kinds: it MIS-authors

A29 says `number`, `toggle`, `list` and `repeater` have "no editor UI" and concludes the fields "cannot be
authored at all". The plan is right; **the diagnosis is wrong, and the truth is worse.**

`SectionEditor.svelte:183-231` branches `media` → `MediaPicker`, `textarea` → `<textarea>`, `select` →
`<select>`, then a **catch-all `{:else}` → `<input type="text">`**. There is no branch for the four kinds,
so all four render a normal-looking text box, and `onInput` (`:78-81`) writes `target.value` — a **string**
— into the key. `valueOf()` (`:73-76`) returns `''` for any non-string.

Proved end to end: typing into guide's field labelled **"Credentials"** (declared `repeater`, `itemFields:
[{label},{detail}]`) persisted `props.facts` with `jsonb_typeof = string`; `render/coerce.ts`
`asObjectArray` then discards it at `if (!Array.isArray(value)) return undefined;` with no warning. The
field's own hint reads *"The hairline-ruled fact list… years practising, students taught, qualifications."*

The six affected fields, of 82 declared across 11 types: `ache.points`, `turn.points`, `feel.inclusions`,
**`feel.previewDuration`** (does not vanish — substitutes a hardcoded 480s, the worst behaviour of the six),
`guide.facts`, `invite.offers`.

**A29's scope is also too wide:** `turn.before-after` IS authorable (`from`/`to` are declared `textarea` and
both render), and `invite.offers` is decorative for authoring because `InviteSection.svelte:189` derives
paths from `context.offer`, not from the repeater. The unreachable-composition count is **7** and does not
widen: `ache.list`/`checklist`, `turn.arc`/`numbered`, `feel.grid`/`ledger`/`stack`, each verified at its
gate.

**Sequencing matters, and it is the opposite of the obvious order.** Because `valueOf()` blanks non-strings,
once a field correctly holds an array the text box renders **empty over real content**, and a creator
"filling in the blank" overwrites the array with a string. **The catch-all must stop claiming these kinds
BEFORE or WITH the real control, never after.** That is `Codex-wtfs1`'s trap on a different key.

Filed as `Codex-28ifd`. A renderer's correct behaviour meanwhile is to read the DECLARED shape only and
self-hide — never to accept the string, because a field with two sub-fields makes `{label: <whole string>}`
a guess dressed as data, and shipping the guess makes it a contract the eventual migration must preserve.

## A73 — A53 refined: the trigger is CONCURRENT VITE INSTANCES, not raw load average

A53 was recorded as "load-dependent test timeouts", from three data points where a worktree at load
average 44 saw four failed tests and two failed suites — every one a timeout in a file it never
touched — and passed 61/61 on re-run in isolation.

**A fourth data point changes the diagnosis.** `pnpm --filter web test` returned **exit 0, 173/173
files** at load average **55**, higher than any of the failing runs, with **only the dev fleet
running and no sibling vite**. The failing run was at load 44 **with a sibling worktree's vite up**.

So the distinguishing variable is not the load number, it is **how many vite dev servers are
resident**. That fits the mechanism better than raw CPU pressure: vitest's own transform/collect
phases contend with a watching vite over the module graph and the filesystem, and a second vite
doubles that contention regardless of what the load average happens to read.

**Practical rules, unchanged in substance but now correctly aimed:**
- **Stop your vite before gating.** This was already the advice; it is now the *primary* one rather
  than one mitigation among several.
- A high load average alone is not a reason to distrust a green run, or to postpone one. Tonight's
  load peaked at 55 from `mds_stores` (Spotlight) indexing two fresh worktrees at 118% CPU — nothing
  to do with the test run, and the run was green.
- A timeout in a suite you never touched is still grounds to re-run that file in isolation before
  reporting a failure. **Report the load average AND whether another vite was up** — the second half
  is the one that turned out to matter.

## A74 — Running a gate and not waiting for it is the same as not running it

The orchestrator committed a new test file after starting `pnpm typecheck --force` but before it
finished. `tsc` then found a `TS2345` in that very file — a `Record<string, readonly string[]>` where
the consuming `Map` is keyed by `CourseSectionType`.

**It escaped because `vitest` does not typecheck.** The test file was green under
`pnpm --filter web test` and stayed green after the fix; only the separate `tsc --noEmit` gate could
ever have caught it. That is exactly why the gate is four commands rather than one, and the four are
not interchangeable:

| command | what only IT can catch |
|---|---|
| `pnpm check:ci` | formatting and lint that the others ignore |
| `check:brand-boundary` (+ `:test`) | a public-bundle import that typechecks fine |
| `pnpm typecheck --force` | **type errors in test files**, which vitest never sees |
| `pnpm --filter web test` | behaviour, which types cannot express |

Two corollaries worth stating because both have now cost something:
- **`--force` is not optional.** A cached `FULL TURBO` is not a gate that ran. Confirm `0 cached`.
- **Capture the real exit code.** `$?` after a pipe to `tail` measures `tail`; `lsof -ti:PORT | head -1
  && echo OCCUPIED` reports `head`'s status. Redirect to a file and read `$?` on the next line.

### And a shell hazard that corrupted a commit message and a bead reason

zsh **executes backticks inside a double-quoted string**, so `git commit -m "... \`auto\` ..."` ran
`auto` and silently deleted the word, leaving a sentence reading "it would fall back to  on the first
one". A `??` in a `bd close --reason` string was glob-expanded and truncated the reason. And
`grep --include=*.svelte` unquoted fails to match at all.

**Write any prose containing backticks, `??`, or globs via `git commit -F -` with a QUOTED heredoc
(`<<'MSG'`), or single-quote the argument.** The failure is silent in every case: you get a commit,
a closed bead, or an empty grep result, and nothing tells you a word went missing.

## A75 — The hero plays its media, all six compositions carry it, and the atmosphere yields (`Codex-uj4jc`)

A32 recorded that a hero "image" can only be a video's poster frame and deferred the fix. This closes
the half that needed no migration, and in doing so found that the deferral had been hiding a second,
larger omission.

**The hero never received the video at all.** `getCourseSellPreview` projected `courses.heroMediaId`
through `toStill` only:

```
heroImageUrl: toStill(courseRow.heroMediaId),   // the thumbnail
                                               // ...and toClip was never called
```

`toClip` sat in the same function, ten lines above, already resolving `intro`, `reel` and `guideClip`
into `{ playlistUrl, posterUrl, durationSeconds }`. So a creator uploaded a video, the projection
reduced it to a poster URL, and the manifest the hero needed was discarded at the boundary. The hero
could not have played its own media however the component was written. `heroClip` is now projected
beside `heroImageUrl` — the same item resolved both ways, OPTIONAL-additive like `guideClip`, so an
older worker deployment degrades to the still.

### Three decisions, and what each rejects

**1 · `mediaMode` is CONTENT; `media` is DESIGN; the axis wins.** The section gains an authored
`mediaMode` (`none` · `image` · `loop` · `click`) choosing WHICH asset appears, while the `media` axis
keeps deciding HOW it is shaped. `media: none` means "no plate at all", so it necessarily overrules the
mode. Both alternatives were worse. Ignoring the mode silently leaves an author picking "silent looping
video", seeing nothing, and having no way to learn why. Auto-lifting the axis mutates a design decision
as a side effect of a content choice — the precise conflation the axis/field split exists to prevent.
So `SectionFieldDef.disabledWhenAxis` greys the control and puts the reason where the hint was. The
renderer and the builder are guarded separately, because a disabled control over a renderer that
ignored the axis would be a lie in the other direction.

**2 · All six compositions carry media, and the three without a plate OFFER it.** `wantsMedia` used to
fold two different questions together — whether media is wanted, and whether this layout has anywhere
to put it — which is what confined media to `split-media`, `full-bleed` and `poster`. They are now
separate: `plateLed` answers WHERE, `mediaMode` answers WHAT. `stage`, `oversized` and `banner` have no
plate in their layout, so on those a video becomes an invitation beside the CTAs rather than being
silently dropped. `loop` lands there too — there is nowhere to loop footage, so the author's intent to
feature a video is honoured as a link instead of discarded.

The affordance's label is AUTHORED. The hero's clip and the `introVideo` section's film are separate
slots pointing wherever the creator aimed them, so a hardcoded "Watch intro" would be this section
making a claim about content it does not own.

**3 · The atmosphere recedes when real media is painted.** `.hero__atmos` already multiplied its whole
opacity by the `--jp-sec-atmos` 0/1 gate, keyed on the `surface` axis. That gate now also reads whether
media is present, as a MULTIPLIER rather than a replacement — so `surface` keeps the final say and a
section gated to zero stays at zero. Composed this way for the same reason the gate is an opacity and
not an `{#if}`: the markup stays mounted, so a late-resolving streamed preview costs no layout shift.

"Painted", not "present". A `click` affordance on a plate-less `stage` hero leaves the ember doing the
whole job of carrying the mood, so it must not dim — only `image` and `loop`, and only where a plate
exists, recede it.

### The forward-compatibility rule this had to obey

Seven live journey pages have no `mediaMode`. Absence resolves to **today's appearance** —
`heroImageUrl ? 'image' : 'none'` — not to a nicer default. This is A33's lesson applied in the
inverse direction: a stored value the renderer ignored is not evidence of intent, and neither is no
stored value at all. The builder therefore offers an explicit "Automatic" choice, so returning to that
state stays authorable rather than becoming unreachable once a mode is set.

### What is still open

`Codex-490z7` — real image upload, so a hero image need not be a video's poster frame — now depends on
this and lands as the `image` mode's second source: `heroImageKey ?? heroMediaId`'s poster `?? ` the
synthetic plate. Two traps on that path are already paid for elsewhere in this repo and must not be
rediscovered: the write path goes through `forwardMultipartUpload()`, because re-forwarding a `File`
strips the filename in production; and it must be a `form()`/FormData path rather than a `command()`,
because command arguments serialize through devalue, which has no representation for a `File`.

## A76 — The canvas gets the course's real media, and the recession's live reach is measured (`Codex-bvhcr`)

### The omission, and why nothing could see it

`JourneyBuilderCanvas` assembles its render context with `builderSalesContext`, whose `sellPreview` is
**optional and defaults to null**. The canvas never passed one. So `hero`, `introVideo`, `reel` and
`guide` — the four types that read `context.sellPreview`; `feel` only *mentions* it in comments, its
taste player being synthetic until `Codex-scab9` — each drew their media-less fallback in the canvas
while the same stored page rendered the real media publicly.

The defect was invisible for a structural reason worth naming: **the disagreement sat between a default
and a value, not between two visible behaviours.** "No media" is also the correct output for a course
that has picked none, so nothing about the canvas alone looked wrong, and no assertion over the canvas
alone could witness it. Only the comparison with the public page is evidence. A75 sharpened the cost —
it added a `media` mode control whose entire effect was hidden on the surface where you author it.

The seam already existed and the query already existed. `resolveSellPreview` is the same public,
auth-free query the public sales load streams; the fix is to call it and pass the result down. Nothing
new was built.

### Two hops, two guards

A prop can be dropped at either end, so both ends are pinned, in the file that owns each:

| hop | guard | file |
|---|---|---|
| canvas → `builderSalesContext` | the call site must mention `sellPreview` | `canvas-public-parity.svelte.test.ts` |
| route → canvas | the `<JourneyBuilderCanvas>` tag must pass it, gated on both UUIDs, degrading to null | `page/__tests__/builder-canvas-wiring.test.ts` |

Both are SOURCE-level by necessity, not by preference: the builder mounts only behind a loaded draft in
an `ssr = false` subtree, and a prop omission is observable in markup rather than in a rendered tree.
Each was negative-controlled — removing the line it guards makes that test, and only that test, fail.

The route guard is deliberately **per-prop** rather than "every declared prop must be passed", because
the stronger form fails today and legitimately: `offer` is declared on the canvas and never passed
either, so `InviteSection` draws a price-less CTA in the canvas while the live page prices itself
(`Codex-4wun2`). Generalise the guard when that lands — the general form is what would have caught both
at once.

### The recession's live reach: ZERO pages, and the arithmetic behind that

A75's "the atmosphere recedes when real media is painted" was carried forward as *"the seven live pages
showing a still now render a dimmer ember"*. **It does not reach them, and the number is a
three-condition chain collapsed into one.** Measured against the dev database:

1. **7** pages carry a `hero_media_id` — this is the real source of "seven";
2. **5 of those 7 have no `hero` section at all** — they are section-less rows (A25), so no hero
   component runs;
3. the **2** that do (`bone-deep`, `pricing-smoke-test`) both store `variant: stage`, and `stage` is
   **not plate-led** (`plateLed` = `split-media | full-bleed | poster`), so `showPlate` is false and
   `mediaPresent` cannot become true.

Reaching `resolveMediaMode`'s fallback branch is not the same as resolving to `image`, and resolving to
`image` is not the same as painting a plate. **DECISION (owner, 2026-08-25): the recession stays keyed
on `image` OR `loop`.** The rationale is that real media carries the mood and a still photograph is
real media; narrowing it to `loop` would leave a still competing with the ember, which is the problem
the recession exists to solve. Recorded here because the misreading invited a "fix" to live behaviour
that no live page exhibits.

### Verified end to end

On `pricing-smoke-test`, canvas and public page now emit **byte-identical** media across all four
types: `introVideo` → "Play the 717-second intro film" (the 717 is `intro.durationSeconds`, so the
label itself proves the preview arrived), `reel` → "Play the practice preview", `guide` → "Play the
guide clip" plus the same portrait URL, `hero` → nothing on either, correctly, because its stored
composition is `stage`. Controlled by removing the forwarding line and watching a full 20 s: the
affordances never appear, while the canvas keeps rendering all 11 sections and their real copy. A 4 s
window was NOT sufficient to tell "never arrives" from "not yet" — the first attempt at this control
was invalid for exactly that reason.

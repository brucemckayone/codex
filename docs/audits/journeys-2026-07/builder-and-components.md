# Journeys page-builder + section-component audit

**Date** 2026-07-27 · **Branch** `feat/journeys-offer-write-path` · **Scope** read-only
**Surfaces** `apps/web/src/lib/page-builder/**`, `apps/web/src/lib/components/page-builder/**`, `apps/web/src/lib/components/journeys/**`, `apps/web/src/routes/_org/[slug]/studio/journeys/**`, `packages/access/src/services/course-journey-service.ts`, `packages/database/src/schema/journeys.ts`

---

## Executive summary

1. **The variant axis is entirely dead on the live page.** 37 variants are declared across 11 types, the picker persists them, and **zero** of the 11 `render/sections/*.svelte` components read `variant`. Every variant renders identically. (critical)
2. **The builder and the live page speak different prop vocabularies.** Three independent field vocabularies exist (`section-catalog.ts` `defaultProps`, `section-fields.ts`, `render/types.ts`). Commit `abb22315` added a read-time "BUILDER-SHAPE BRIDGE" covering **4 of 11** types; the other 7 still silently drop authored copy. 16 builder-editable fields are read by nothing. (critical)
3. **The builder's 8-type factoring is the correct one.** `render-edit/` already collapses ache/turn/feel→`prose` and introVideo/reel→`video`. The evidence confirms the user's read (turn≈ache, reel≈introVideo, feel≈prose+list). The live side hard-codes per-type layouts that are *variant-shaped*. Proposed catalogue: **11 → 8 primitives**, adopting render-edit's factoring.
4. **No media can be attached to any section.** `courses.introVideoMediaId` / `previewVideoMediaId` / `guideVideoMediaId` / `guide.portraitMediaId` are **read-only across the entire codebase** — no service method, remote, or UI writes them. The builder's `media` control is a plain text input. introVideo, reel and guide can never show their primary content. (critical)
5. **There is no course cover/thumbnail column at all** — not missing UI, missing schema. This is why `JourneyCard` is typographic-only. (high)
6. **Publish reports success when the save failed** (`handlePublish` awaits a self-catching `handleSave`). Unpublish has no cascade, leaving `courses.status='published'` and the journey live on `/explore`. (high)
7. Design-system conformance is largely **good**: no `$app/stores`, no `$page`, no forced `color-scheme`, accessible keyboard reorder. Real hits are 5 `rgba(0,0,0,…)` in `ReelSection`, a hardcoded `#c24129` brand fallback, and ~4,000 lines of scoped CSS duplicating 600 lines of `journey-sections.css`.
8. `/studio/journeys/[id]/insights` exists (95 lines) and **nothing links to it**.

---

## A. Section-component consolidation analysis

### A.1 The four contracts

Four artefacts claim to define the same 11 section types. Only two of them agree with each other.

| Artefact | Path | Vocabulary | Honours `variant`? |
|---|---|---|---|
| Catalogue seed copy | `apps/web/src/lib/page-builder/section-catalog.ts:114-440` | `kicker/heading/body`, `q1/n1/c1`, `button`, `price` | declares 37 |
| Builder field schema | `apps/web/src/lib/components/page-builder/section-fields.ts:70-195` | **identical to catalogue** | n/a |
| Builder canvas components | `apps/web/src/lib/page-builder/render-edit/sections/*.svelte` (8 files, 521 lines) | **identical to catalogue** | **yes — fully** |
| Live public components | `apps/web/src/lib/page-builder/render/sections/*.svelte` (11 files, 6,011 lines) | `beats[]`, `points[]`, `items[]`, `offers[]`, `inclusions[]`, `subheadline`, `ctaLabel`, `title`, `foot`, `priceNote`, `bio[]` | **no — never** |

The first three are consistent. The live renderer is the outlier. `SectionProps = Record<string, unknown>` (`packages/shared-types/src/journeys.ts:59`) means nothing type-checks the divergence.

**Two mutually incompatible component contracts:**

- `render/section-registry.ts:34-37` — `{ config: SectionProps; context: JourneySalesContext }`
- `render-edit/section-render.ts:33-44` — `{ props, variant, editable?, onEdit?, stages? }`

`render-edit/section-render.ts:8` documents its contract as belonging to "every `render/sections/*.svelte` component" — it does not; those take `{config, context}`. This contract split is the structural reason one component set cannot serve both surfaces.

### A.2 The consolidation matrix

Rendered structure derived from each live component's markup and prop reads.

| Type | Live component (lines) | eyebrow slot | heading | body | list / array | media | grid | Reads from `context` | Variants declared → honoured |
|---|---|---|---|---|---|---|---|---|---|
| `hero` | `HeroSection.svelte` (554) | `eyebrow` | `headline` → `<h1>`, word-split kinetic | `subheadline` | — | shader bg | — | `course.title/kicker/lede`, `checkoutUrl`, `enrolled` | 4 → 0 |
| `introVideo` | `IntroVideoSection.svelte` (442) | `eyebrow` | `heading` | `sub` | — | HLS modal + `posterUrl` | — | `sellPreview.intro` | 3 → 0 |
| `ache` | `AcheSection.svelte` (351) | `eyebrow` | — | — | **`beats[]`** pinned 100vh scroll | — | — | — | 4 → 0 |
| `turn` | `TurnSection.svelte` (473) | `eyebrow` | `statement` | `lede` | **`points[]`** roman-numeral arc | — | 2-col | — | 4 → 0 |
| `reel` | `ReelSection.svelte` (936) | `eyebrow` | `heading` | `sub` | **`captions[]`** cross-fade | HLS modal + `posterUrl` + letterbox | — | `sellPreview.reel` | 3 → 0 |
| `map` | `MapSection.svelte` (686) | `eyebrow` | **`title`** | `sub` + **`foot`** | — | — | stage `<ol>` + practice cards | `stages`, `stageCount`, `practiceCount` | 3 → 0 |
| `feel` | `FeelSection.svelte` (704) | `eyebrow` | `heading` | `body` | **`inclusions[{label,detail}]`** | fake preview player | 2-col | — | 4 → 0 |
| `proof` | `ProofSection.svelte` (468) | `eyebrow` | `heading` | — | **testimonials[{quote,name,ctx}]** | avatar initial | `<ul>`/grid | **`testimonials` (wins over authored)** | 3 → 0 |
| `guide` | `GuideSection.svelte` (453) | `eyebrow` | `heading` | **`bio[]`** | **`credentials[]`** | `portraitUrl` `<img>` | 2-col | — | 3 → 0 |
| `faq` | `FaqSection.svelte` (414) | `eyebrow` | `heading` | — | **`items[{question,answer}]`** `<details>` | — | — | — | 3 → 0 |
| `invite` | `InviteSection.svelte` (530) | `eyebrow` | `heading` | `sub` | **`offers[{…}]`** | — | — | `course.priceCents`, `checkoutUrl`, `enrolled` | 3 → 0 |

Variant totals: hero 4 · introVideo 3 · ache 4 · turn 4 · reel 3 · map 3 · feel 4 · proof 3 · guide 3 · faq 3 · invite 3 = **37 declared, 0 honoured**.

Grep proof: `variant` appears in `render/sections/*` only at `HeroSection.svelte:119,123` and `InviteSection.svelte:137,158` (that is `CtaLink`'s own unrelated `variant` prop) and `FeelSection.svelte:468` / `ReelSection.svelte:606` (`font-variant-numeric` in CSS). No component receives or reads `PageSection.variant`.

### A.3 Which types are genuinely distinct — verdict

**The user's read is confirmed on all three counts.**

- **`turn` ≈ `ache`** — CONFIRMED. Identical declared field shape (`{kicker, heading, body}`, `section-catalog.ts:193-197` vs `215-219`), the same shared `PROSE_VARIANTS` (`section-catalog.ts:191,213`), and the same builder component (`render-edit/section-registry.ts:32-33`). Their only difference is the live *layout*: ache renders a pinned scroll sequence, turn a two-column numbered arc. That is a layout choice — i.e. a variant.
- **`reel` ≈ `introVideo`** — CONFIRMED. Identical field shape (`{kicker, heading, sub, clip, duration}`, `section-catalog.ts:168-174` vs `229-235`), shared `VIDEO_VARIANTS` (`166`, `227`), shared builder component (`render-edit/section-registry.ts:30-31`). The only substantive difference is which clip slot they read — `sellPreview.intro` vs `sellPreview.reel` (`IntroVideoSection.svelte:94`, `ReelSection.svelte:171`). That is a **field**, not a type.
- **`feel` ≈ prose + a list** — CONFIRMED. Declares `PROSE_FIELDS` and renders `{eyebrow, heading, body}` plus an `inclusions[]` list and a decorative preview widget (`FeelSection.svelte:43-58`). Prose with a list variant.

**Genuinely distinct primitives (5):** `hero` (h1 + kinetic + shader + enrolment-aware CTA), `map` (renders from `context.stages`, not authored copy), `proof` (renders from `context.testimonials`), `guide` (single-person portrait/bio/credentials), `invite` (offer set + price + conversion CTA). `faq` is structurally proof-minus-avatars but its `<details>` semantics and absence of a context data source justify keeping it.

**The catalogue's own docstring already concedes the collapse** (`section-catalog.ts:22-26`): *"the prototype's one `prose` renderer backs `ache`/`turn`/`feel`; … `film`→`introVideo`"*. The 11-type split was a deliberate widening of a prototype that had fewer renderers — and only the semantic labels were widened, never the layouts.

### A.4 Proposed consolidated catalogue — 11 → 8

This is exactly the factoring `render-edit/section-registry.ts:28-40` already ships. The recommendation is to promote it to *the* catalogue and make the live components variant-driven.

| # | Primitive | Field schema | Variants |
|---|---|---|---|
| 1 | `hero` | `eyebrow, headline, accent, subheadline, felt, ctaLabel, quiet, trust, bg` | `centered · left · split · minimal` |
| 2 | `prose` | `eyebrow, heading, body, items[]` | `centered · statement · wide · twocol · **sequence** · **arc** · **inclusions**` |
| 3 | `media` | `eyebrow, heading, sub, **slot: 'intro'\|'preview'**, clipLabel, duration, posterUrl, captions[], tag` | `cinema · simple · split · **letterbox**` |
| 4 | `curriculum` | `eyebrow, heading, sub, foot` | `descent · list · grid` |
| 5 | `proof` | `eyebrow, heading, quotes[{quote,name,context}], trustLabel` | `grid · stack · spotlight` |
| 6 | `guide` | `eyebrow, heading, bio[], quote, portraitUrl, credentials[], clipLabel, duration` | `portrait · centered · quote` |
| 7 | `faq` | `eyebrow, heading, items[{question,answer}]` | `accordion · open · boxed` |
| 8 | `invite` | `eyebrow, heading, accent, sub, priceNote, ctaLabel, risk, offers[]` | `descent · banner · card` |

Three new variants (`sequence`, `arc`, `inclusions`) and one new variant (`letterbox`) are the *existing live layouts* of ache/turn/feel/reel, promoted from hard-coded per-type behaviour to selectable compositions. Net effect: the creator gains 4 layouts they could never previously choose, and loses nothing.

### A.5 Migration mapping

| Old type | New type | New variant | Key renames |
|---|---|---|---|
| `hero` | `hero` | keep | `sub`→`subheadline`, `button`→`ctaLabel` |
| `introVideo` | `media` | `cinema` | `kicker`→`eyebrow`, `clip`→`clipLabel`, + `slot: 'intro'` |
| `ache` | `prose` | **`sequence`** | `kicker`→`eyebrow`; `[heading, body]`→`items[]` |
| `turn` | `prose` | **`arc`** | `kicker`→`eyebrow`, `heading`→`heading`, `body`→`body`, `points`→`items` |
| `reel` | `media` | **`letterbox`** | `kicker`→`eyebrow`, `clip`→`clipLabel`, + `slot: 'preview'` |
| `map` | `curriculum` | keep | `heading`→`heading` (was `title`), `note`→`foot` |
| `feel` | `prose` | **`inclusions`** | `kicker`→`eyebrow`; `inclusions`→`items` |
| `proof` | `proof` | keep | `q1/n1/c1…`→`quotes[]`, `trust`→`trustLabel` |
| `guide` | `guide` | keep | `role`→`eyebrow`, `body`→`bio[]` |
| `faq` | `faq` | keep | `q1/a1…`→`items[]` |
| `invite` | `invite` | keep | `price`→`priceNote`, `button`→`ctaLabel` |

**`landing_pages.sections` jsonb migration.** A `jsonb` rewrite over `landing_pages` where `page_type='course'`, per element of the `sections` array: set `type`, set `variant` (**must be explicit** — `resolveVariant` would otherwise fall back to `defaultVariant` and silently re-layout every ache/turn/feel), rename keys per the table, and fold numbered groups (`q1/n1/c1`, `q1/a1`) into object arrays. The existing `asNumberedGroups` / `asStringFrom` readers in `render/coerce.ts:74-130` document the exact fold and can be ported to SQL or run as a one-shot script. Because every reader is defensive and `type` is a widenable `string` (`shared-types/src/journeys.ts:64-67`), the migration can ship *after* the readers accept both shapes — no lock-step deploy needed.

> **BLOCKER — duplicate DOM ids.** `render/SectionRenderer.svelte:32` sets `id={section.type}` as the in-page anchor, and the hero's scroll cue targets `#map`. Collapsing ache/turn/feel to `type: 'prose'` yields three elements with `id="prose"`, and renaming `map`→`curriculum` breaks the existing `#map` anchor. The consolidation **requires** an explicit `anchor` field on `PageSection` (or switching to `section.id`) plus an anchor rewrite in the same migration. (high)

### A.6 Is the builder extensible?

**No.** Adding one section type today requires **11 files**:

| # | File | Change | Fails loudly? |
|---|---|---|---|
| 1 | `packages/shared-types/src/journeys.ts:41` | extend `CourseSectionType` | — |
| 2 | `apps/web/src/lib/page-builder/section-catalog.ts:114` | catalogue entry + variants + `defaultProps` | no — silently absent from the add-picker |
| 3 | `apps/web/src/lib/components/page-builder/section-fields.ts:70` | `SECTION_FIELDS` entry | **yes** (`Record<CourseSectionType, …>` is exhaustive) |
| 4 | `apps/web/src/lib/page-builder/render/section-registry.ts:46` | `SECTION_COMPONENTS` entry | **yes** (exhaustive `Record<CourseSectionType, …>`) |
| 5 | `apps/web/src/lib/page-builder/render/sections/X.svelte` | new live component | — |
| 6 | `apps/web/src/lib/page-builder/render/types.ts` | new props interface | no |
| 7 | `apps/web/src/lib/page-builder/render-edit/section-registry.ts:28` | `SECTION_COMPONENTS` entry | **no** — `Record<string, …>`, so the section is silently invisible in the builder |
| 8 | `apps/web/src/lib/page-builder/render-edit/sections/X.svelte` | new canvas component | — |
| 9 | `apps/web/src/lib/page-builder/render-edit/journey-sections.css` | `jp-x*` styles | no |
| 10 | `apps/web/src/lib/components/page-builder/VariantPicker.svelte:22-61` | new `thumb` branch (16-way string `{#if}` chain) | no — renders an empty thumbnail |
| 11 | `apps/web/src/lib/page-builder/section-catalog.test.ts` | catalogue expectations | yes |

The typing asymmetry between #4 (exhaustive) and #7 (open) is a defect in itself: a new type breaks the build for the *public* renderer but is *silently* omitted from the builder — precisely backwards, since the builder failure is the one a creator sees. (medium)

**Single-source-of-truth proposal.** One `SectionSpec` per type, in the public-safe tree:

```ts
// $lib/page-builder/sections/<type>.spec.ts  — inert data, no component imports
interface SectionSpec<P> {
  type: string; label: string; icon: string; keywords: string[];
  fields: readonly SectionFieldDef[];          // drives the inspector AND documents props
  variants: readonly SectionVariant[]; defaultVariant: string;
  defaults: P;                                  // typed, not Record<string, unknown>
  read(props: SectionProps): P;                 // the coerce boundary, per type
}
```
Plus **one** component contract carrying both `context` (course/stages/testimonials/checkoutUrl) and the edit seam (`editable`, `onEdit`), so a single component set serves both surfaces and `editable` gates only the contenteditable affordance.

**What blocks it today:**
1. **The CE-4 import boundary.** `section-fields.ts` lives under `$lib/components/page-builder` (editor tree) while `section-catalog.ts` lives under `$lib/page-builder` (public tree, `PUBLIC_LIB_ROOT`), and the public tree must not import the editor tree (`section-catalog.ts:12-16`). They therefore cannot share one object today. Field *metadata* is inert data with no component imports, so **moving `section-fields.ts` into `$lib/page-builder` resolves this** — only the control components stay in the editor tree. This is the single highest-leverage unblock.
2. **`SectionProps = Record<string, unknown>`** (`shared-types/src/journeys.ts:59`) — no per-type type exists, so no compiler check can catch vocabulary drift. The spec's typed `defaults: P` + `read()` closes it.
3. **The two component contracts** (§A.1) — must be unified before one component set can serve both.
4. **Two full CSS implementations** (§F.4) — 600 lines of global `jp-*` versus ~4,000 lines of scoped per-component CSS, with zero shared selectors.

---

## B. Builder ↔ live fidelity divergences

### B.1 The five collapsed types

| Stored type | Builder canvas renders | Live page renders | Consequence |
|---|---|---|---|
| `ache` | `ProseSection` — heading + body block | `AcheSection` — 100vh pinned scroll, `heading` and `body` become **two sequential "beats"** with crossfade + progress rail | Structurally unrecognisable; the creator's single prose block becomes a two-screen cinematic sequence |
| `turn` | `ProseSection` | `TurnSection` — 2-col, roman-numeral descent arc, rail-draw reveal | Layout the builder never shows |
| `feel` | `ProseSection` | `FeelSection` — 2-col, `inclusions[]` list, animated fake preview player | Layout + a whole list the builder cannot edit |
| `introVideo` | `VideoSection` — static frame | `IntroVideoSection` — HLS modal + poster + skeleton | Builder shows no player state |
| `reel` | `VideoSection` | `ReelSection` — letterboxed, caption cross-fade, corner tag, 936 lines | Most divergent of all |

`render-edit/section-registry.ts:10-13` compounds this with a copy-pasted docstring asserting *"This module (and everything under `render/`) is the PUBLIC page renderer, not editor UI"* — false; this is the builder registry. (low, but actively misleading during triage)

### B.2 Fields the builder edits that the live component ignores

Sixteen editable fields write to keys nothing reads. All are `section-fields.ts` entries with no corresponding read in `render/sections/*`.

| Type | Dead field(s) | Builder writes | Live reads instead |
|---|---|---|---|
| `hero` | `accent`, `felt`, `quiet`, `bg` | `section-fields.ts:77,86,92,104` | nothing (`HeroSection.svelte:39-45`) |
| `hero` | `sub`, `button` | `section-fields.ts:82,89` | `subheadline`, `ctaLabel` (`HeroSection.svelte:41-42`) |
| `introVideo`/`reel` | `kicker` | `section-fields.ts:59` | `eyebrow` only, **no bridge** (`IntroVideoSection.svelte:36`, `ReelSection.svelte:44`) |
| `introVideo`/`reel` | `clip`, `duration` | `section-fields.ts:62-63` | nothing |
| `feel` | `kicker` | `PROSE_FIELDS`, `section-fields.ts:52` | `eyebrow` only, **no bridge** (`FeelSection.svelte:43`) |
| `map` | `heading`, `note` | `section-fields.ts:120,125` | `title`, `foot` (`MapSection.svelte:47,49`) |
| `guide` | `role`, `body`, `clip`, `duration` | `section-fields.ts:150,152,159,160` | `eyebrow`, `bio[]` (a **string array**, not a string) (`GuideSection.svelte:34-39`) |
| `invite` | `accent`, `risk` | `section-fields.ts:175,189` | nothing |
| `invite` | `price`, `button` | `section-fields.ts:182,187` | `priceNote`, `ctaLabel` (`InviteSection.svelte:47-48`) |

**Bridge coverage** (`render/coerce.ts:58-130`): only `ache` (`AcheSection.svelte:38-41`), `turn` (`TurnSection.svelte:43-46`), `proof` (`ProofSection.svelte:56-70`) and `faq` (`FaqSection.svelte:46-60`) are bridged. `hero`, `introVideo`, `reel`, `map`, `feel`, `guide`, `invite` — **7 of 11** — are not. Severity: **critical** (a creator fills a field, publishes, and the copy never appears).

### B.3 Fields the live component reads that the builder cannot set

| Type | Unsettable field | Live read | Effect |
|---|---|---|---|
| `hero` | `secondaryLabel`, `secondaryHref` | `HeroSection.svelte:43-44` | secondary CTA unreachable |
| `introVideo`/`reel` | `posterUrl` | `:39` / `:47` | no poster ever |
| `reel` | `caption`, `captions[]`, `tag` | `:60-65` | caption line never renders |
| `feel` | `inclusions[]`, `previewTitle`, `previewSub`, `previewDuration` | `:46-58` | the entire right-hand "what's inside" column and the preview player are dead |
| `guide` | `name`, `bio[]`, `credentials[]`, `portraitUrl` | `:34-39` | the guide's name, portrait and credentials cannot be authored |
| `invite` | `offers[]` | `:49-60` | the 3-path offer teaser is unauthorable |
| `proof` | `trustLabel` (canonical) | `:45` | only reachable via the legacy `trust` alias |

### B.4 Silent precedence overrides

- **`proof`**: `ProofSection.svelte:73-77` — `context.testimonials` **wins** over authored `q1/n1/c1`. A creator types three testimonials, sees them in the canvas, and the live page shows the DB rows instead. The bridge comment (`:50-54`) documents authored fields as a *fallback only*. (high)
- **`hero`**: `HeroSection.svelte:48-50` — `course.kicker/title/lede` fall back *under* authored props (correct direction).
- **`map`**: `MapSection.svelte:52-54` — stages always come from `context.stages`; authored copy is chrome only (correct and documented).

### B.5 The `media` control is not a media picker

`SectionEditor.svelte:105-115` — `control: 'media'` renders `<input type="text" placeholder="On-frame label">`. It writes a decorative string. Combined with §D.3, **no section can be given a video or image through the builder**. (critical)

---

## C. Prototype vs implementation drift

Prototypes: `docs/design/course-journeys/prototype/`.

| # | Gap | Evidence | Sev |
|---|---|---|---|
| C1 | **Variants are inert.** The prototype's inspector treats layout options as "part of the component" (`builder.html:268-271`) and the live page switches on them. Implementation persists them and the public renderer ignores them. | `builder.html:295` `SCHEMA`; §A.2 | critical |
| C2 | **`builder-new.html` (the 2-step create wizard) is not implemented.** Prototype: step 1 "What are you making?" (type grid), step 2 template/"Start from" presets incl. `blank` (`builder-new.html:85-156`). Implementation `new/+page.svelte` is 262 lines with no template/preset concept. | `new/+page.svelte`; `builder-new.html:144-156` | medium |
| C3 | **Journeys list filters differ.** Prototype filters `All / Journeys / Pages / Drafts` — i.e. by **type** (course vs landing) *and* draft (`studio-journeys.html:106-109`). Implementation filters status only: `All / Draft / Published / Archived` (`+page.svelte:24-29`). A creator cannot separate courses from plain landing pages. | as cited | medium |
| C4 | **Insights action missing.** Prototype derives actions from type and adds `Insights` for published courses (`studio-journeys.html:141-151`), with `Curriculum` as **primary**. Implementation offers `Curriculum` + `Edit page` (primary), no Insights — while the route exists. | `+page.svelte:159-168`; §D.1 | high |
| C5 | **Explore card hover-preview absent.** Prototype `.jcard` has a cover band + `.jcard__preview` hover-to-play with sweep + scrub (`explore.html:56-77`). Implementation has neither. Note the stored guidance that hover is not a valid gesture for media autoplay — this needs a click affordance, not a literal port. | `explore.html:52-87`; §E | medium |
| C6 | **Prototype `feel`/`reel` section fragments are fully realised in `render/` but unauthorable.** `sections/feel.frag.html:396L` and `reel.frag.html:495L` were ported to 704/936-line live components whose distinguishing content (`inclusions[]`, `captions[]`, clips) has no editor. | §B.3 | high |
| C7 | Prototype `SCHEMA.reel` is `{heading, clip}` — a **media-typed** clip field intended as a real picker (`builder.html:305`); implementation degraded it to a text label. | `SectionEditor.svelte:105-115` | high |

`course-sell.html` (3,578 lines) is faithfully realised by `render/sections/*` — that half of the port is genuinely complete. The drift is concentrated in the **builder** and in the **write path** for media.

---

## D. Studio surface gaps

### D.1 Journeys list — `studio/journeys/+page.svelte` (455 lines)

Verified: the only per-row actions are `Curriculum` (courses only) and `Edit page` (`:159-168`).

| # | Missing | Evidence | Sev |
|---|---|---|---|
| D1a | **No publish/unpublish control.** Status is display-only (`:136`); changing it requires opening the builder, using the top-bar `<select>`, and saving. | `+page.svelte:136,159-168` | high |
| D1b | **No "view live" / "open public page" link.** | ibid. | high |
| D1c | **No way to open the course itself** (dashboard/portal). Both actions lead to editors. | ibid. | medium |
| D1d | **No archive, delete, or duplicate.** | ibid. | medium |
| D1e | **No Insights link**, though `[id]/insights/+page.svelte` (95 lines) exists. A repo-wide grep for route links to `/insights` returns only API paths — the route is **orphaned and unreachable**. | `[id]/insights/+page.svelte`; grep | high |

The row itself is informative (title, status, tagline, stages/practices/enrolled/30-day revenue/updated) and correctly uses `page` from `$app/state` (`:14`). The gap is purely action affordances.

### D.2 Curriculum editor — `[id]/curriculum/+page.svelte` (1,381 lines)

Assessment: **better than reported, but structurally unmaintainable.**

- IA is sound: breadcrumb (`:289`), `h1` (`:296`), two-pane structure + inspector (`:329`, `:462`), content picker with search and type filters (`:606-639`).
- Reorder is **accessibly implemented** — labelled up/down buttons (`:343-355`, `:386-398`), not drag-only.
- **Real defect:** 1,381 lines in a single route file (script 280 / markup 380 / CSS 719) with **no component extraction** — the largest file in the journeys UI. The stage list, practice row, inspector and content picker are all inline. This is the most likely source of the "badly laid out" impression: at 380 lines of markup, three columns of concern compete in one flat template. (medium)
- The prototype splits this across `course-editor.html` (373 lines) — a much simpler two-pane shape. The implementation grew a third region (the picker) inline.

### D.3 Builder shell — `[id]/page/+page.svelte` (752 lines)

| # | Finding | Evidence | Sev |
|---|---|---|---|
| D3a | **Top bar packs 9 control groups into one flat `<header>`**: doc-title `<input>`, status `<select>`, artifact nav, 3-button device group, 2-button history group, "Full width", "View live", "Save", "Publish". No grouping, no overflow, no responsive collapse. | `:301-383` | medium |
| D3b | **`handlePublish` reports success unconditionally.** `handleSave` catches its own errors and returns normally (`:251-255`), and returns early on a pricing failure (`:241`). So `await handleSave(); toast.success('Page published')` fires even when nothing saved. | `:273-277` | high |
| D3c | **`handleViewLive` opens the page even if the save failed** — same root cause, so the creator inspects stale content believing it is current. | `:264-271` | medium |
| D3d | **No explicit unpublish affordance.** Possible only via the status `<select>` + Save; the Publish button is always enabled and always labelled "Publish" even when already published. | `:311-320,382` | medium |
| D3e | **No cover/thumbnail upload — and no column to put one in.** `packages/database/src/schema/journeys.ts:123-171`: `courses` has `introVideoMediaId`, `previewVideoMediaId`, `guideVideoMediaId`, `guide.portraitMediaId` — **no still-image cover/thumbnail/poster column**. `landing_pages` (`:50-117`) has none either. | as cited | high |
| D3f | **The only image affordance in the builder is a dead placeholder.** `PageSeoPanel.svelte:82-87` renders a 🖼 emoji `<span>` and the caption *"1200×630 · media library soon"* — no input, no upload. | as cited | high |
| D3g | **All four course media refs are read-only codebase-wide.** `introVideoMediaId`/`previewVideoMediaId`/`guideVideoMediaId`/`portraitMediaId` appear only in the schema and in `course-journey-service.ts:502-561` (reads, building `SellPreview`). No `update(courses).set({…MediaId})` exists; `journeys.remote.ts` exposes no sell-media or guide command. The `guide` jsonb is likewise only selected (`:774`, `:847`), never written. → introVideo, reel and guide can never show their primary content. | grep across `apps/web/src`, `packages/*/src`, `workers/*/src` | critical |

Note the platform **already has** this pattern: categories carry `coverImageUrl` with an upload path (`apps/web/src/lib/server/api.ts:897,1007-1010`). Journeys simply never adopted it.

### D.4 Preview / live mode — traced

- **`previewMode` is not a preview.** It only hides the editor rails; the canvas still mounts the static `render-edit/` components. The code says so plainly (`:354-359`): *"Full width only hides the editor rails … the cinematic motion lives in the PUBLIC renderer."* Two things are named "preview" and neither previews the live page. (medium)
- **"View live" is correct** and shows draft content to managers by design: `handleViewLive` opens `/journeys/{slug}` (`:270`); the public load first tries `getCoursePage` (published only), then falls back to `getCoursePagePreview` for signed-in users, gated by the worker's `requireOrgManagement`, 404 for everyone else (`(space)/journeys/[journeySlug]/+page.server.ts:38-54`). Fail-closed and sound.
- **But there is no draft indicator.** A manager viewing an unpublished journey sees an apparently live page with no "draft — not visible to the public" banner (grep of that `+page.svelte` finds only the preview-bridge receiver, `:15-28`). Easy to mistake draft for published. (medium)
- **Unpublish has no cascade.** `saveJourneyPage` publishes the subject course when publishing (`course-journey-service.ts:1419-1437`) but never reverses it: setting the page to `draft`/`archived` leaves `courses.status='published'`. `listPublishedJourneys` requires both (safe), but **`listPublishedCourses` filters on `courses.status` alone** (`:851-857`) and powers the public `/explore` rail (`(space)/explore/+page.server.ts:219`). An "unpublished" journey therefore keeps a card on /explore whose sales page 404s. (high)
- **`courses.slug`/`title` drift from the page.** `saveJourneyPage` updates only `landingPages` (`:1400-1415`); the course keeps its creation-time slug (`:1280-1289`). Explore links via the **course** slug/id (`explore/+page.svelte:183-187`) while the org landing links via **`journey.pageId`** (`(space)/+page.svelte:616-620`). After a slug rename these resolve differently. *Unverified:* whether `buildJourneyUrl`'s id fallback masks the 404 — confirm by renaming a published journey's slug and loading `/explore`. (high)

---

## E. The public course card

Two different components render journeys publicly:

- **`JourneyCard.svelte`** (265 lines) — org landing, via `Carousel` (`(space)/+page.svelte:607-623`), typed `JourneyCardView`, links by `pageId`.
- **`JourneyRailCard.svelte`** — `/explore` rail, typed `CourseCardSummary` from a **third** types module `$lib/journeys/types` (`explore/+page.svelte:24-25`), links by course `slug`/`id`.

**Assessment of `JourneyCard`: it conforms to the design system, and the "too basic" complaint is a data gap, not a token gap.**

Verified conformance: transparent background until hover (`:120,130-134`), no per-type accent colour, all values tokenised, `:focus-visible` ring (`:136-139`), `prefers-reduced-motion` block (`:254-263`), 2-line tagline clamp. Its docstring (`:9-12`) explicitly justifies *"no cover image, no hardcoded tone gradient (which would vanish on dark org brands)"* — consistent with the stored guidance that `color-mix(brand, transparent)` gradients disappear on dark orgs.

The prototype's `.jcard` (`explore.html:54-87`) adds exactly two things: (a) a **168px cover band** tinted by a per-journey tone (`ember`/`blood`/`clay`, `:57-59`), and (b) a **hover-to-play preview** with sweep + scrub (`:68-77`). Both are unavailable-by-design or unavailable-by-data:

| # | Finding | Sev |
|---|---|---|
| E1 | The card has **no visual mass** — no image, no band, no aspect ratio. It is a text block with a foot. This is the legitimate substance of "too basic", but the prototype's fix (per-tone gradient) is what the design system forbids. The correct fix is a **real cover image**, which requires the missing schema column (D3e), or a brand-aware `ShaderHero`-style band. | high |
| E2 | Cannot express hover-preview: needs `previewVideoMediaId`, which nothing can set (D3g) — and per stored guidance would need a click affordance rather than hover autoplay. | medium |
| E3 | **Badge text drifts from its own docstring** — `:5` promises a "Journey" badge; `:71` renders `Portal`. Also inconsistent with `journey-card__go` = "View portal" vs the route namespace `/journeys/`. Journeys/Portals naming is inconsistent across the surface (page title "Portals", `+page.svelte:94`; empty state "No portals yet", `:175`). | low |
| E4 | Two card components + three types modules (`$lib/page-builder`, `$lib/journeys/types`, `render/types.ts`) for one concept; the two cards will drift. | medium |
| E5 | Hardcoded `letter-spacing: 0.08em` (`:159,166`) instead of a tracking token. Token fallback chains (`--text-2xs, var(--text-xs)`, `--font-semibold, var(--font-medium)`, `--leading-tight, 1.2`) suggest the author was unsure those tokens exist — worth resolving to real tokens. | low |

---

## F. Design-system conformance

Scanned every `.svelte`/`.ts` under the five journeys roots (tests excluded).

**Clean:** zero `$app/stores` imports · zero `$page` references (all use `page` from `$app/state`) · zero `color-scheme` declarations · zero forced dark.

### F.1 Hardcoded colour values

| File:line | Value | Sev |
|---|---|---|
| `render/sections/ReelSection.svelte:372,577,614,656,698` | `rgba(0, 0, 0, 0.4/0.5/0.6)` in shadows and text-shadows — will not respond to theme or brand | medium |
| `render/sections/GuideSection.svelte:197,211`, `IntroVideoSection.svelte:210,339`, `ReelSection.svelte:371,475` | `#000` inside `color-mix(in oklab, …)` darkening — defensible but bypasses the token layer | low |
| `components/page-builder/PageBrandPanel.svelte:31,70` | hardcoded brand default `'#c24129'` in the brand panel itself | medium |

### F.2 Hardcoded dimensions

32 non-hairline `px` values. Concentrated in `VariantPicker.svelte` (17 hits, `:31-56` inline styles + `:136-184`) for schematic thumbnails — arguably legitimate for abstract diagrams (low). Others worth tokenising: `PageBrandPanel.svelte:207,221-222` and `PagePricingPanel.svelte:233,247-248` (identical `34px`/`16px` switch dimensions, duplicated between the two panels), `MapSection.svelte:371-374`, `FeelSection.svelte:531,544-545`, `ReelSection.svelte:581-582`, `JourneyBuilderCanvas.svelte:274-275`. (low)

### F.3 Accessibility — builder controls

**Better than expected.**

- `SectionList.svelte` — reorder via labelled up/down buttons (`:116-133`) with drag as a pointer *enhancement*; the grip is `aria-hidden` and the docstring states the intent (`:7-8`). Enable/disable and remove carry `aria-label` + `aria-pressed` (`:148-172`). Correct.
- Curriculum reorder likewise button-based (§D.2).
- Builder top bar: `aria-pressed` on device/mode buttons, `aria-label` on history buttons and both fields (`[id]/page/+page.svelte:308,315,329,340,349`).

Remaining gaps:

| # | Finding | Sev |
|---|---|---|
| F3a | `SectionEditor.svelte:139-145` — "Delete" removes a section with no confirmation and no undo hint (undo exists via ⌘Z but is undiscoverable here). `SectionList.svelte:164-172` same. | low |
| F3b | `VariantPicker` thumbnails are `aria-hidden` (`:23`) and options are distinguished only by label + `hint`; acceptable, but the selected state should be verified to be announced. *Unverified* — confirm with a screen reader or by inspecting `:63-75` for `aria-pressed`/`role="radiogroup"`. | low |
| F3c | Inline canvas editing uses `contenteditable` (`render-edit/EditableText.svelte`, 42 lines) with no documented keyboard-escape or label; *unverified* whether an assistive-tech user can discover or exit the editable region. | medium |

### F.4 CSS duplication between `render/` and `render-edit/`

`render-edit/journey-sections.css` (600 lines) defines 52 global `jp-*` selectors. The 11 `render/sections/*.svelte` components carry **~4,000 lines of scoped CSS** (Reel 654, Map 445, Feel 439, Hero 397, Invite 365, Proof 333, Guide 307, IntroVideo 306, Turn 341, Faq 247, Ache 211) using an entirely different naming scheme (`.ache__`, `.turn__`, `.hero__`…). **Zero shared selectors.** Two complete, independent CSS implementations of the same 11 sections — the two surfaces cannot help but diverge visually, and every layout fix must be made twice. (high — this is the mechanical root of the fidelity gap alongside §A.1)

---

## Work items

| ID | Item | Size | Depends on | Sev |
|---|---|---|---|---|
| W1 | Move `section-fields.ts` into `$lib/page-builder` (inert data, CE-4-safe) so catalogue + fields become one module | S | — | high |
| W2 | Define typed per-type `SectionSpec` (fields + variants + typed defaults + `read()`); replace the three vocabularies | M | W1 | critical |
| W3 | Unify the two component contracts into one `{props, variant, context, editable?, onEdit?}` | M | W2 | critical |
| W4 | Make the 11 live components honour `variant` (37 variants, currently all inert) | L | W3 | critical |
| W5 | Add `anchor` to `PageSection` and stop deriving DOM ids from `type` (`render/SectionRenderer.svelte:32`) — prerequisite for any type collapse | S | — | high |
| W6 | Collapse 11 → 8 primitives per §A.4; promote ache/turn/feel/reel layouts to variants `sequence`/`arc`/`inclusions`/`letterbox` | L | W4, W5 | high |
| W7 | Migrate `landing_pages.sections` jsonb: type + explicit variant + key renames + numbered-group folding + anchors | M | W6 | high |
| W8 | Retire duplicate CSS — one implementation for both surfaces | L | W3 | high |
| W9 | Add a course cover-image column + upload, reusing the category `coverImageUrl` pattern (`api.ts:897,1007`) | M | — | high |
| W10 | Add a sell-media write path (`introVideoMediaId`/`previewVideoMediaId`/`guideVideoMediaId`/`guide.portraitMediaId`) — service method + remote command + UI | L | — | critical |
| W11 | Replace the fake `media` control (`SectionEditor.svelte:105-115`) with a real media picker | M | W10 | critical |
| W12 | Bridge or remove the 7 unbridged types' dead fields (§B.2) — interim fix pending W2 | S | — | critical |
| W13 | Author-side editors for `inclusions[]`, `captions[]`, `offers[]`, `credentials[]`, `bio[]`, `name`, `secondaryLabel/Href` (§B.3) | M | W2 | high |
| W14 | Fix `handlePublish` false-success + `handleViewLive` on failed save (make `handleSave` return a result or rethrow) | S | — | high |
| W15 | Cascade unpublish page→course, or make `listPublishedCourses` require a published landing page | S | — | high |
| W16 | Keep `courses.slug`/`title` in sync with the page on save; reconcile explore-vs-landing link derivation | S | W15 | high |
| W17 | Journeys list: add publish/unpublish, view-live, archive, duplicate, and an Insights link (un-orphan the route) | M | W14 | high |
| W18 | Restructure the builder top bar into grouped/overflowing regions; rename `previewMode` to "Full width" throughout | S | — | medium |
| W19 | Draft banner on the public sales page when served via `getCoursePagePreview` | S | — | medium |
| W20 | Extract the 1,381-line curriculum route into components (stage list / practice row / inspector / picker) | M | — | medium |
| W21 | Make `render-edit/section-registry.ts` exhaustive (`Record<CourseSectionType, …>`) so a new type fails loudly in the builder | S | — | medium |
| W22 | Fix `render-edit/section-registry.ts:10-13` and `section-render.ts:8` docstrings (both describe the wrong module) | S | — | low |
| W23 | Tokenise `rgba(0,0,0,…)` in `ReelSection`, the `#c24129` brand default, and the duplicated panel switch dimensions | S | — | medium |
| W24 | Give `JourneyCard` visual mass via cover image or brand-aware band (not a per-tone gradient); settle Journey/Portal naming | M | W9 | high |
| W25 | Consolidate the two card components + three journey types modules | M | W2 | medium |
| W26 | Implement the 2-step create wizard with templates/presets (`builder-new.html`) | M | W2 | medium |
| W27 | Verify `contenteditable` canvas editing is keyboard/AT-navigable (F3c) | S | — | medium |

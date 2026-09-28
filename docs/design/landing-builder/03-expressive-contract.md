# 03 — Expressive Styles and storytelling (BINDING)

**Status: BINDING from 2026-09-27.** This extends `01-contract.md` and `02-kit-foundation.md`. Where
this document and 01 disagree, this document wins, and only in the clauses it names (§2). Everything
else in 01 stays binding: every reachable combination is designed, plain words, layouts arrange and
never censor, no borrowed copy, honest offer copy, the accessibility floor, small files. Amendments are
appended in §13 with a date and a reason.

Branch: `feat/landing-builder-expressive`, stacked on `feat/landing-builder-redesign`.

## 0. Owner decisions (2026-09-27, verbatim)

> "the thing im looking from here is like a set of really different styles here, moree interfactive
> components. we are looking for something next level with all of these design like awwwards level
> without the usabliitiy issues. really telling the story the journey really making it intersting
> there, a variety of different styles and so on. always looking good in the brand settings"

> "i guess its important that no matter the style chosen the journey etc its conforming to brand
> settings aslong as thats not over ridden. It should be a high level of design quality able to
> support anything the user needs itto"

Choices (AskUserQuestion, option labels verbatim): variety from **"Styles with their own look"**,
**"Different starting pages"**, **"Richer sections"** and **"More colour range"** · fonts: **"Suggest,
creator confirms"** · corners: **"Brand radius, Style bends it"** · first Styles: **Path, Poster,
Studio, Quiet** — "im sure much of this can be done in parrallell".

---

## 1. The brand rule (applies to every Style, every section, every WP)

**A Style decides how the brand is used, never which brand.**

| The brand owns (a Style reads, never replaces) | A Style owns |
|---|---|
| Primary, secondary and accent colours, light and dark | Layout defaults, section order, starter recipe |
| Background colour, light and dark | Type scale, leading, tracking, case |
| Heading and body fonts | Rhythm: section padding, container, measure |
| Corner radius (a Style may *bend* it, §4.2) | Surface: atmosphere, texture, shapes, edges |
| The shader: preset, intensity, vignette, grain | Motion and interactive treatments |
| Logo | How the two brand colours are distributed |

Precedence: a page's own brand overrides (Style tab: two colours, two fonts) win over the org brand.
Nothing else may. A Style's font pairing is a **suggestion** the creator accepts in the Style tab
(§9); until accepted the brand's fonts render, and "Use organisation brand" undoes it.

Consequences, each testable (§11):
- No Style stylesheet contains a literal colour or font family. Colours come from `--lp-*` tokens
  and `oklch(from var(…))` / `color-mix()` over them; families only from `var(--font-heading)` /
  `var(--font-body)`.
- Every Style must look designed in any brand in the contrast matrix, with any font the
  `FontPicker` offers (`$lib/components/brand-editor/FontPicker.svelte`). Emphasis comes from size,
  case, tracking and leading, never `font-weight` on a single-weight display face.
- No photograph is recoloured (tints, duotones, blend modes over creator images). The owner rejected
  that on 2026-07 (memory: brand duotone reverted — "totally out of brand"). Brand lives in the
  chrome around images: frames, scrims, shapes, marks.

---

## 2. Clauses of 01 this document replaces

| 01 clause | Was | Now |
|---|---|---|
| §1 "Motion is one moment" | One hero entrance per Style; sections never animate on scroll | **Motion follows the story** (§6). The hero entrance stays; story motion is allowed where it carries meaning. Generic fade-up-every-section is still forbidden. |
| §4 "No second WebGL canvas. Atmosphere is CSS" | CSS glow only | Still **no second canvas**: the org's shader already runs full-page behind every org page (§5.1). A section may show it through the `atmosphere` scheme. CSS glow remains the fallback. |
| §4 Styles table: Radius row | Bold ≤ sm, Soft ≥ xl regardless of brand | **Bent from the brand radius** (§4.2). |
| §2 Styles list | 4 Styles | 8 Styles (§3, §4). |
| §5 Schemes | 5 schemes | 6: + `atmosphere` (§5.1). |
| 01 decision 4 "at most two agents at a time" | — | Unchanged by default. The owner may raise it; the orchestrator states the spend estimate first (§12). |

---

## 3. Vocabulary — orchestrator-owned (`kit/model/ids.ts`, `packages/validation/src/schemas/landing-page.ts`)

- **Styles:** `bold` (default) · `clean` · `soft` · `cinematic` · `path` · `poster` · `studio` · `quiet`.
- **Schemes:** `base` · `soft` · `contrast` · `brand` · `accent` · `atmosphere`.
- **New layouts** on existing types (the first layout stays each type's fallback, so no stored page
  changes meaning):

| Type | Added | What it is |
|---|---|---|
| hero | `poster` | Display type at full Style scale, set around an image that overlaps the section edge |
| benefits | `bento` | Tiles of mixed sizes; the first is large and may carry its image |
| transformation | `toggle` | Before and after as two tabs |
| curriculum | `map` | The journey map: the course's stages as stops on a drawn route, each opening to its practices |
| testimonials | `marquee` · `wall` | A slowly moving strip of quotes with a pause control · a masonry wall |

- **New section types:**

| Type id | Creator label | Layouts (first = fallback) | Props beyond the common set |
|---|---|---|---|
| `story` | Story | `scroll` `chapters` `strip` | `steps?: { heading: string; body?: string; image?: ImageRef }[]` (1–8) |
| `gallery` | Gallery | `mosaic` `strip` `grid` | `items?: { image: ImageRef; caption?: string }[]` (1–12) |

- **Every section** may carry `props.background?: ImageRef` (generalises 01 A5's `cta.background`;
  same key, so no stored data changes). Not offered on `hero`, which has its own media.
- The server stores props as a bounded passthrough record (`pageSectionSchema`, 16KB), and the
  page-image orphan scan deep-scans props for minted keys (01 A3). So new props need no server schema
  change; only the id lists above do.

---

## 4. The eight Styles — `kit/model/style-definitions/<id>.ts` + `kit/styles/style-<id>.css`

Each Style is a complete, distinct design, not a size preset. Each one below names ONE signature
feature. A Style's quality is judged by whether a visitor would take two of its pages for two
different sites if the brands were swapped.

### 4.1 Identities

- **Bold** (default). *The headline is the hero.* The largest display type, tight leading, full-bleed
  bands in the brand colour and its contrast. Signature: **headlines that build** (whole-element
  entrance, §6) and **numbers that count up**. Font suggestion: none (the brand's own fonts are the
  point).
- **Clean.** *Image-led and crisp.* Hairlines, generous air, images at real size. Signature: **image
  reveals** (a clip wipe as an image enters) and the `gallery` `grid`. Font suggestion: a neutral
  grotesk pair.
- **Soft.** *Rounded, tinted, calm.* Signature: **brand-tinted shapes** drifting slowly behind
  sections, and curved section edges. Font suggestion: a rounded or soft humanist sans.
- **Cinematic.** *Dark and immersive* (dark in both themes, the documented exception, 01 §4).
  Signature: **the org's own moving background** behind the hero and CTA (`atmosphere`), and the
  `story` `scroll` (a sticky image that changes as the steps pass). Font suggestion: an extended
  grotesk or a high-contrast display face.
- **Path** (new). *The course as a route.* A line runs down the page and draws as the visitor
  scrolls, with a stop at each section. Signature: the `curriculum` `map` as its default. Palette: the
  route in the secondary colour, CTAs in the primary. Font suggestion: a humanist sans pair.
- **Poster** (new). *Loud and graphic.* Colour blocks in BOTH brand colours (`brand` and `accent`
  schemes alternate), display type that crowds its frame, images that overlap section edges, small
  rotated labels. Signature: the `hero` `poster` layout, the `benefits` `bento`, and testimonials as a
  `marquee` (a moving strip of praise). Font suggestion: a condensed display face with a plain body.
- **Studio** (new). *Handmade and warm.* A fine paper grain, hand-drawn marks (an underline under
  headings, a circle round numbers, a scribbled frame round images) that draw in when they enter,
  photos set at a slight tilt in a plain frame. Signature: the marks. Testimonials default to `wall`,
  gallery to `mosaic`. Font suggestion: a characterful serif or grotesk heading with a readable body.
  **Not** the cream-plus-serif-plus-terracotta default: the ground is the brand's own background.
- **Quiet** (new). *Space and one accent.* No colour bands (every section `base`), thin rules, the
  secondary colour used only for markers, links and the CTA. Signature: **read-along** — a statement
  paragraph brightens from `--lp-ink-soft` to `--lp-ink` as it crosses the middle of the screen (both
  states pass 4.5:1). Font suggestion: a light serif heading with a neutral sans body. **Not** the
  near-black-plus-one-acid-accent default.

The Style WP picks exact families from the `FontPicker` list, all different across Styles, and records
them in §13.

### 4.2 Corners: the brand radius, bent

`--lp-brand-radius: var(--brand-radius, var(--radius-md))` (kit base). A Style sets each radius token
as `clamp(<floor>, calc(var(--lp-brand-radius) * <k>), <ceiling>)`:

| Style | card / media k (floor, ceiling) | button | notes |
|---|---|---|---|
| Bold | 0.25 (0, `--radius-sm`) | 0.25 | never a pill |
| Clean | 1 (0, none) | 1 | the brand radius exactly |
| Soft | 2 (`--radius-md`, 2rem) | pill-if-rounded | |
| Cinematic | 1 (0, none) | pill-if-rounded | |
| Path | 1 (0, none) | 1 | route stops are circles (decoration, not brand shape) |
| Poster | 0.25 (0, `--radius-sm`) | 0.25 | labels pill-if-rounded |
| Studio | 0.5 (0, `--radius-md`) | 0.5 | photo frames square |
| Quiet | 0.5 (0, `--radius-md`) | 0.5 | |

**pill-if-rounded** = `min(calc(var(--lp-brand-radius) * 1000), var(--radius-full))`: a pill when the
brand is rounded at all, square when the brand is square. So a square brand stays square in every
Style except Soft's cards, which keep a gentle `--radius-md` floor. That is the owner's "Soft rounds it
up".

### 4.3 Where a Style's CSS lives, and how it wins

Today, Bold's, Soft's and Cinematic's treatments of each block sit INSIDE the block component
(`:global(.lp[data-lp-style='soft']) .benefits-grid li`). Measured 2026-09-27: 160 such selectors
across 12 blocks and 3 primitives, for three Styles, and `InstructorBlock.svelte` is already at 452
lines. Eight Styles cannot live that way, and four Style agents could not work in parallel if they did.

- **New Style work never edits a block.** A Style's tokens, page-level decoration AND its treatment
  of every block and primitive live in its own stylesheet, `kit/styles/style-<id>.css`. When that
  passes ~600 lines it becomes `kit/styles/<id>/` (`style.css`, `blocks.css`), imported by
  `PageRenderer`.
- **Precedence without `!important`:** every rule in a Style stylesheet that reaches inside a block
  starts `:is(.lp, #lp-style)[data-lp-style='<id>']`. `:is()` takes its strongest argument's
  specificity, and no element has that id, so the unused id lifts the rule above any block's scoped
  rules (which carry classes only). A Style rule must never undo a block's `:focus-visible` outline or
  its reduced-motion guards.
- A block exposes its stable class names as its styling API. A class rename in a block is a breaking
  change for every Style stylesheet: grep them in the same commit.
- The existing in-block overrides for Bold, Soft and Cinematic stay where they are. Moving them is not
  part of this programme.

### 4.4 Defaults

Every Style defines a layout and a scheme for all 16 types (`StyleDefinition.layouts/schemes`), an
`order` and a `starter`. 01's invariant stays: no `brand` band next to a `contrast` band
(`catalog.test.ts`). The new layouts are what make each Style a distinct page rather than a
re-tuning: testimonials alone read four different ways across Poster, Studio, Clean and Cinematic
(`marquee`, `wall`, `grid`, `quote`).

---

## 5. Surfaces — `kit/styles/surfaces.css`, `kit/SectionShell.svelte`, `schemes.css`

### 5.1 The `atmosphere` scheme: the org's shader, seen through a section

Facts (verified 2026-09-27): `routes/_org/[slug]/+layout.svelte` mounts `<ShaderHero
class="shader-hero--fullpage" />` on EVERY org page — `position: fixed; inset: 0; z-index: 0`, blurred
by `filter: blur(var(--blur-2xl))` off the landing page, with `data-hero-shader-active` on
`.org-layout` when the org has a preset. It pauses only when the tab is hidden, and under reduced
motion it paints one frame and stops. On a sales page it is covered by `.org-main`'s
`color-mix(… 80%, transparent)` background, then `.lp`, then each opaque section: **the GPU runs it and
nobody sees it.**

The scheme:
- A section with scheme `atmosphere` paints a **uniform scrim** of its pole's ground over the shader.
  Ink is computed against the ground as usual. The scrim strength `s` is the smallest value for which
  ink, ink-soft, accent-as-text, button and focus colours pass their 01 §5 floors against BOTH
  worst-case composites: ground over pure black and ground over pure white at strength `s`. That is
  an executable test, not a judgment. A Style may make it stronger, never weaker.
- For the shader to show, the page must clear the stack above it for the life of that page only:
  `.org-main`'s background, `.lp`/`.lp-page` backgrounds (each non-atmosphere section is opaque
  anyway), via `.org-layout:has(.lp[data-lp-atmosphere])` rules. The same selector may lift the blur
  (`filter: none`) when the Style asks for a sharp background (`data-lp-atmosphere='sharp'`). This is
  the one org-layout edit this programme makes (CSS only, E1's territory, §12).
- **No shader preset** (`.org-layout:not([data-hero-shader-active])`), or outside the org layout (the
  studio canvas, the style gallery, thumbnails): `atmosphere` renders the ground with the existing CSS
  glow (`.lp-atmos`). It is always a designed section, never a hole.
- Never a second canvas, and never a shader inside a section.

### 5.2 Textures and shapes

Three textures: `grain`, `paper`, `contour` (topographic lines). Each is drawn as a CSS mask
(`mask-image` of a static SVG) over `background-color: var(--lp-line)` or a tint of it, so the colour
always comes from tokens. Textures are decorative, low contrast, and never behind body text at a
level that moves text contrast below its floor. Shapes (Soft): two or three blob masks tinted from
`--lp-accent` at low alpha. Styles choose via `--lp-texture` / `data-*` hooks E1 defines.

### 5.3 Section edges

`straight` (default) · `curve` (Soft) · `angle` (Poster). An edge must show the next section's own
background in the cut, in every scheme pair, both themes, and at every container width. If E1 cannot
make that robust, it stops and reports rather than shipping a fragile edge.

### 5.4 Background images

`props.background` renders in `SectionShell` as a decorative full-bleed `<img alt="" loading="lazy">`
behind the content. While it is set, the section's colours come from the `on-media` recipe: a
uniform scrim, never a gradient whose stops move with the section's height (memory: scrim stops are
aspect-coupled). The editor offers it as a generic section control (§9), not a per-block field.

---

## 6. Motion follows the story — `kit/styles/motion.css`, `kit/motion/*`

**Allowed:** the Style's one hero entrance (01), plus story motion: a route that draws with scroll,
a scroll story's image change, a before/after switch, numbers counting up once, a headline that
builds, marks drawing in, a read-along paragraph, a pausable marquee, shapes drifting slowly, and
parallax of at most `--space-10` on media.

**Forbidden:** a fade-up on every section; anything that takes scrolling over (no wheel or touch
`preventDefault`, no smooth-scroll library, no pinning that traps the page); content hidden until
JavaScript runs; motion lasting more than five seconds without a pause control (WCAG 2.2.2), except
the brand shader and slow drift, which stop under reduced motion; anything flashing more than three
times a second; splitting headings into per-word or per-letter elements (it breaks inline editing's
identical-markup rule, 01 A4, and screen-reader text).

**Mechanism:**
- Scroll-linked motion uses CSS scroll-driven animations (`animation-timeline: view()` / `scroll()`)
  inside `@supports (animation-timeline: view())`. Unsupported browsers show the final state. No
  scroll-linked motion is driven from JavaScript.
- Every animation is gated by `@media (prefers-reduced-motion: no-preference)` and
  `.lp:not([data-lp-still])` (thumbnails, galleries, the editing canvas). With no JS, reduced motion,
  or no support, the final state renders.
- JavaScript only where CSS cannot: count-up (`IntersectionObserver`, once, the final value already
  in the HTML and announced once), the scroll story's active step, the marquee pause button, tabs.
  Each checks `matchMedia('(prefers-reduced-motion: reduce)')` and the still flag.
- Data-attribute API (E2 defines, blocks and Styles consume; values are the contract):

| Attribute | Effect |
|---|---|
| `data-lp-reveal="rise\|fade\|wipe\|scale"` | enters as it scrolls into view |
| `data-lp-draw` | an SVG stroke or a masked mark draws itself as it enters |
| `data-lp-build="rise\|wipe\|track"` | a heading builds as a whole element |
| `data-lp-parallax="1\|2"` | media drifts against the scroll, 1 = subtle |
| `data-lp-count` | a number counts up once when first seen |
| `data-lp-readalong` | a paragraph brightens as it crosses the viewport middle |

Styles apply these to their SIGNATURE elements through their own CSS or through block options; no
Style applies `reveal` to every section.

---

## 7. Interactive components — accessibility and no-JS behaviour are part of the spec

- **Journey map** (`curriculum` `map`). An `<ol>` of stages; each stage is a `<details>` whose
  `<summary>` shows the stage number (a real sequence), title and practice count, and whose body lists
  its practices. The first stage is open. A decorative SVG route (`aria-hidden`) joins the stops and
  draws with scroll. It winds at wide container widths and runs straight when narrow. Live stages only.
- **Scroll story** (`story` `scroll`). From a container width of about 48rem: steps on one side, a sticky
  frame on the other that shows the active step's image (crossfade; active step via
  `IntersectionObserver`). Narrower, without JS, or under reduced motion: each step shows its own image
  inline. **Chapters** (`story` `chapters`): each step is a full-width scene, the image behind a uniform
  scrim. **Strip** (`story` `strip`, `gallery` `strip`): native horizontal scroll with
  `scroll-snap-type`, a labelled focusable region, and previous/next buttons.
- **Before and after** (`transformation` `toggle`). The WAI-ARIA tabs pattern (arrow keys, `aria-selected`,
  `tabpanel`). Without JS both lists render side by side, as `columns` does.
- **Marquee** (`testimonials` `marquee`). A duplicated track moving slowly; the duplicate is
  `aria-hidden` and `inert`; a visible pause/play button (`aria-pressed`); pauses on hover and
  `:focus-within`. Under reduced motion it is a static grid with no duplicate.
- **Wall** (`testimonials` `wall`), **Mosaic / Grid** (`gallery`), **Bento** (`benefits`): CSS grid or
  columns only; captions are `<figcaption>`; every image's alt comes from its `ImageRef`.
- **Poster hero** (`hero` `poster`). Text never sits on a photo without a solid panel or the uniform
  scrim behind it.
- **Count-up** (`stats`, all layouts). Only a value that parses as a number animates; prefixes and
  suffixes (`£`, `h`, `+`) stay put; the HTML holds the final value.
- Every interactive element: `:focus-visible` (R14), 44px targets, nothing that only works on hover.

---

## 8. Starting pages — `kit/model/recipes.ts`

A recipe is an ordered list of `{ type, layout? }`. Layouts are pinned only where the recipe's point
depends on one; everything else resolves from the Style. Recipes are Style-agnostic.

| id | Label | Sections |
|---|---|---|
| `full` | The full story | hero, problem, transformation, benefits, curriculum, instructor, testimonials, pricing, faq, cta |
| `short` | Short and direct | hero, benefits, testimonials, pricing, faq, cta |
| `journey` | The journey | hero, story (`scroll`), curriculum (`map`), instructor, testimonials, pricing, cta |
| `video` | Video first | hero (`cover`), video, benefits, testimonials, pricing, cta |
| `show` | Show the work | hero, gallery, text, testimonials, pricing, cta |

Offered where a page starts empty (`EmptyPage.svelte` → `startFromTemplate`) and, if it fits the
flow, on `studio/journeys/new`. The seed pages are re-seeded across recipes and Styles, so the demo
shows the range instead of one skeleton seven times.

---

## 9. Editor — `lib/components/page-builder/editor/`

- **Style tab:** eight Styles as live thumbnails of this page's hero, two columns, each with its name
  and one line. When the chosen Style suggests fonts that differ from the page's, a row offers
  them ("This Style suggests X and Y · Use them") with a live sample. Accepting writes the page's own
  brand fonts. Changing Style never changes fonts by itself.
- **Section controls** (generic, beside layout, colour and spacing): **Background image** (not on
  hero). The colour swatches gain **Moving background** (`atmosphere`); where the org has no shader
  its swatch previews the glow fallback, and its tooltip says so plainly.
- **Section gallery:** Story and Gallery appear in their groups with real renders.
- **Empty page:** the recipes, each with its section list; "start from" applies it in one undoable step.
- The canvas stays still while editing (01). Motion is seen in Preview.

---

## 10. Usability and performance guardrails ("without the usability issues")

- Native scrolling everywhere; the back button, find-in-page and text selection behave normally.
- Every page reads completely with JavaScript off, with reduced motion, and in browsers without
  scroll-driven animation support.
- Keyboard and touch reach everything a pointer does. No hover-only information.
- Contrast floors (01 §5) hold for every Style × scheme × brand × theme, including `atmosphere`
  (§5.1) and backgrounds (§5.4).
- No new canvas. No animation library. JS for motion under ~4KB gzipped in total. A Style's CSS
  within ~600 lines per file (§4.3). Hero media still paints in the first HTML (LCP). CLS stays 0:
  nothing resizes after hydration.
- Images below the fold are `loading="lazy"`; story and gallery images use the `md` variant unless
  full-bleed (`lg`).

---

## 11. Gates

Per WP (orchestrator re-runs after each report): scoped vitest · `svelte-check` no new errors in touched
files · biome on touched files · `check:brand-boundary` · Svelte autofixer clean · screenshots of the
WP's work in **three real brands** (of-blood-and-bones, studio-alpha, a dark brand), light and dark,
desktop and 390px mobile.

New executable gates (written in the WP that introduces the thing):
- **Brand conformance:** a test reads every `style-*.css` and `surfaces.css`, with comments stripped,
  and fails on any literal colour (`#…`, `rgb(`, `hsl(`, named colours outside `transparent` /
  `currentColor`) or any `font-family` that is not a `var(--font-*)`.
- **Atmosphere contrast:** §5.1's black/white composite test for every Style and pole.
- **Motion safety:** a render under reduced motion and a render with `data-lp-still` show no running
  animations. Public SSR HTML holds every text in its final state (no inline `opacity: 0`, no hidden
  content).
- **Interactive components:** keyboard tests for tabs, disclosure, marquee pause and strip buttons.
- The existing contrast matrix and `catalog.test.ts` invariants cover all 8 Styles.

Before the PR: everything in 01 §9, plus a visual sweep of every Style with every recipe, reviewed.

---

## 12. Work packages and territories

Partitioned by FILE: no two concurrent WPs share a file. Anything outside a WP's territory is a
handoff, never an edit. 01 §8 process rules apply, plus: write incrementally in the order the brief
gives and keep a progress file (a spend-limit kill must never leave a half-written file that looks
finished).

| WP | Territory | Depends on |
|---|---|---|
| **R0** (orchestrator) | this contract · `ids.ts` · `types.ts` · validation `landing-page.ts` · `model/style-definitions/*` split with stub Styles · stub `style-{path,poster,studio,quiet}.css` · `blocks/story`, `blocks/gallery` (definition + a working fallback layout) · catalog/registry entries · the `atmosphere` scheme id with a provisional recipe | — |
| **E1 Surfaces** | `styles/surfaces.css` · `schemes.css` (atmosphere) · `SectionShell.svelte` · `kit.css` (`--lp-brand-radius`, texture hooks) · `PageRenderer.svelte` (atmosphere flag, background prop pass-through) · the org-layout CSS rules of §5.1 | R0 |
| **E2 Motion** | `styles/motion.css` · `kit/motion/*` · `primitives/Heading.svelte` (build) · `blocks/stats/*` (count-up) · mark masks for Studio | R0 |
| **E3 Story & journey** | `blocks/story/*` · `blocks/curriculum/*` (`map`) · `blocks/transformation/*` (`toggle`) · **adds `map` and `toggle` to `ids.ts` and its validation twin** | R0; uses E2's attribute API as specified here |
| **E4 Showcase** | `blocks/gallery/*` · `blocks/testimonials/*` (`marquee`, `wall`) · `blocks/hero/*` (`poster`) · `blocks/benefits/*` (`bento`) · **adds those four layouts to `ids.ts` and its twin** | R0 |
| **E5 Editor** | `StylePanel` · `SchemeSwatches` · `SectionInspector` (background) · `EmptyPage` · `SectionGallery` · `model/recipes.ts` · `messages/en.json` (the only WP that edits it) | R0 |
| **S1–S4 Styles** | S1 Path + Quiet · S2 Poster + Studio · S3 Bold + Clean · S4 Soft + Cinematic — each its `model/style-definitions/<id>.ts` + `styles/style-<id>.css` (§4.3); never a block | E1–E4 |
| **V Verify** | contrast/conformance tests, e2e for interactive components, reseed across recipes, visual sweep, `codex-review` | all |

**Why E3 and E4 add their own layout ids:** several block tests assert that every layout of a type
renders a distinct structure (`BenefitsBlock.svelte.test.ts`: `shapes.size === layouts.length`), so
a layout id may only land together with the block that renders it. E3 and E4 must therefore never
run at the same time as each other (both edit `ids.ts`). Run them in different pairs: E1 with E3,
then E2 with E4.

Estimate (memory rule of thumb, ~190k output tokens per implementation agent): about 13 agent runs,
~2.5M output tokens. Concurrency is the owner's call; the default stays two at a time.

---

## 13. Amendments

_(append here: `X<n> · <date> · <WP> · what changed · why`)_

- **X1 · 2026-09-27 · E1 · Atmosphere tokens and veils.** On an `atmosphere` section the accent moves
  to Y ≤ 0.06 (light) / ≥ 0.41 (dark), the button to Y ≤ 0.115 / ≥ 0.26, and the ghost-button line is
  `--lp-ink-soft`; ink and soft ink are the usual ones. The veil is 0.82 (light) / 0.86 (dark): the
  smallest two-decimal values that hold every floor over pure black AND pure white (`schemes.test.ts`
  §5, with a minimality check). Why: with the usual accent and button the minimum veil was 0.97/0.98 —
  the shader would have been invisible. Engines without `pow()` in relative colour get a veil of 1.
- **X2 · 2026-09-27 · E1 · The fallback glow** (no preset, editing canvas, thumbnails) is the brand
  hue at a FIXED lightness (L 0.89 light / 0.30 dark, chroma ≤ 0.08) at 0.9 opacity; its second light
  mixes the secondary 70% with the primary so an achromatic secondary never reads grey. It varies hue,
  not luminance, so it can be strong and still clear every text floor (measured by its own test).
  Replaces §5.1's "the existing CSS glow", which at 14–18% was invisible.
- **X3 · 2026-09-27 · E1 · `data-lp-atmosphere` is withheld when still, not only when editing:** Style
  tab and gallery thumbnails render inside the studio's own `.org-layout`, whose `.org-main` the page
  rule would otherwise clear.
- **X4 · 2026-09-27 · E1 · Mobile clearance band:** under `--below-md` the org layout keeps its 80%
  cover on `.org-main`'s bottom `--space-20` (the mobile nav's clearance), so no raw shader strip shows
  between the last section and the footer.
- **X5 · 2026-09-27 · E1 · Surfaces API (page-level, set on `.lp[data-lp-style='<id>']`, read by style
  queries on the named container `lp-page`):** `--lp-texture: grain | paper | contour`
  (+ `--lp-texture-strength` 0–1), `--lp-shapes: blobs` (+ `--lp-shapes-strength` 0–1, a share of the
  proven 0.12 alpha), `--lp-edge: curve | angle` (+ `--lp-edge-depth`, always capped at the section
  padding; `--lp-edge-offset` is read-only), `--lp-atmosphere-scrim` (thicker only), `--lp-atmos-a/-b`.
  Pages with texture or shapes take the moved brand on `base`/`soft`/`contrast`; `brand`/`accent`
  bands paint texture away from their ink. No texture or shapes on `atmosphere` or on-media sections.
  Engines without custom-property style queries draw plain, straight sections.
- **X6 · 2026-09-27 · E1 · Background images** render for every type except `hero` and `cta`; `cta`
  keeps its A5 field until the editor's generic control lands (E5).
- **X7 · 2026-09-27 · orchestrator · Radius floors** inside `clamp()`/`min()` are written `0rem`:
  `--radius-none` is a unitless `0`, which voids the whole math function.
- **X8 · 2026-09-27 · E3 · Story and journey.** The before/after `toggle` renders as `columns` on the
  server and becomes tabs only while it is below the viewport, so nothing on screen re-lays out (a
  toggle already in view at load stays columns until it next leaves the screen). A journey-map stage
  with nothing inside is a plain stop, not a `<details>` (a disclosure that opens to nothing), as the
  accordion already does. Visitor copy lives in block-local `copy.ts` files, the existing precedent
  (curriculum, preview, instructor, stats, video).
- **X9 · 2026-09-27 · orchestrator · Atmosphere panel mode.** E1 measured the live shader at ~14%
  under the 0.86 dark veil: quieter than the no-shader glow, so an org that adds a shader would see LESS
  atmosphere. The veil stays proven, but a Style may now choose WHERE it is drawn:
  `--lp-atmosphere-veil: section | panel`. `panel` draws the veil only behind the section's content,
  with the Style's card radius, and leaves the shader at full strength around it — nothing readable
  sits outside the panel, so the contrast proof is unchanged. Default `section`.
- **X10 · 2026-09-27 · E1 · Panel geometry and its limits.** The card is the `.lp-inner` content
  column grown by `clamp(--space-4, 2.5cqi, --space-10)`, over the section's content box, with
  `--lp-radius-card`, painted with the SAME veil and moved tokens (drawn on `.lp-surface::after`). The
  section's own veil is cleared only by the selector that draws the card (a test pins both
  occurrences). A section with a direct `.lp-bleed` child, or with a background image, keeps the
  full SECTION veil — its words may reach the edges. **Rule for every block:** an element that moves
  WORDS into the bleed tracks is marked `.lp-bleed`. The fallback (no shader, canvas, thumbnails)
  draws the card over the glow, so the canvas shows the live composition. Verified geometrically
  (every text line box and control inside the card, ±0.5px) for Bold's four hero layouts and the CTA
  band at 1440 and 390; other Styles and blocks verify their own.
- **X11 · 2026-09-27 · orchestrator · A page with its own colours uses the glow, not the org's
  shader.** `ShaderHero` reads the ORG's brand, so under a page's own primary or secondary colour the
  org's moving background would clash with the page. The owner's rule is that a page conforms to the
  brand "aslong as thats not over ridden", so when a page overrides a colour, `atmosphere` draws the
  glow (which follows the page's colours) and `data-lp-atmosphere` is not set.
- **X12 · 2026-09-27 · E2 · Motion mechanics.** (a) On an `svg`, `data-lp-draw` is a clip wipe from the
  top, timed on `view(block 50%)`: a dash draw cannot work with `vector-effect: non-scaling-stroke`
  (Chromium 141 and WebKit 26 measure `pathLength` in user units but apply dashes in screen pixels — a
  400px line drew 50% at "full"); `data-lp-draw="stroke"` opts a SCALING stroke into the dash draw.
  (b) The gates are `@media screen and (prefers-reduced-motion: no-preference)` → `@supports
  (animation-timeline: view())` → `:root[data-theme] .lp:not([data-lp-still])`; `screen` so print shows
  the final state. (c) `track` is `scale` from the start edge plus a fade — animating
  `letter-spacing` re-wraps a balanced heading every frame (CLS). (d) Parallax "at most `--space-10`"
  is the distance from rest. (e) Count-up skips a figure already on screen at hydration; its real text
  stays in the DOM (painted transparent) under an `aria-hidden` counting copy. (f) Style hooks:
  `--lp-build-display | -heading | -title: rise | wipe | track`, `--lp-media-reveal: rise | fade | wipe
  | scale`, `--lp-media-parallax: 1 | 2`, `--lp-text-readalong: on`, `--lp-stat-count: none` (count-up
  is on by default), marks `--lp-mark-underline | -circle | -scribble | -arrow` drawn by
  `--lp-mark-draw` (a beat after their host enters; `--lp-mark-range` and the host `view-timeline`
  are retired by X13), and `--lp-route-draw` for Path's page line. Never two motion attributes on one
  element (they share `animation`). A mark's host must be one of the entrance candidates listed in
  the `motion.css` header.
- **X13 · 2026-09-28 · orchestrator · Entrances are triggered, not scrubbed.** An entrance tied to
  scroll position (`entry 0% entry clamp(25svh, 100%, 50svh)`) cannot finish for an element near the
  end of a short page — it can never scroll that far into view — so it would stay part-faded (on a short
  page, the call to action's own heading). Reveals, heading builds and marks therefore run once, on a
  time-based animation, when one shared `IntersectionObserver` sees them clear the floating CTA bar;
  they are armed only for elements below the fold at hydration, so without JS, under reduced motion,
  or still, the final state renders. Scrubbed motion (parallax, the route draw, read-along) stays CSS
  scroll-driven: at the page end it leaves only harmless partial states (an offset, a partly drawn
  decorative line, text at `--lp-ink-soft`, which still passes 4.5:1). Amends §6's "No scroll-linked
  motion is driven from JavaScript": a one-shot trigger is not scroll-linked. *As built (E2):* two
  observers per page (`motion/stage.ts`) — the first report decides (on screen or already passed →
  left final; below the fold → armed), and an armed element plays when its top clears the line
  `max(15% of the screen, the floating bar's footprint + 2%)`, measured from the real `.lp-sticky`.
  An armed element in view that the page can no longer scroll up to the line plays at once (the
  short-page case), checked against its nearest scrolling ancestor so the editor's Preview works too.
  A candidate is armed only if `motion.css` actually gives it a time-based animation (tried once with
  `data-lp-enter="wait"`); content added after hydration is staged by a `MutationObserver`. All
  motion JS, count-up included: 2,122 B gzipped. Entrances no longer need scroll-timeline support, so
  they play in Firefox too.
- **X14 · 2026-09-28 · orchestrator · Layout ids both builders use.** Three new v2 layouts share a name
  with an old builder variant of the same type: hero `poster`, testimonials `wall` and `marquee`. The
  old testimonial wall and moving strip ARE the new ones, so the legacy table now maps `proof.wall →
  wall` and `proof.marquee → marquee` (they went to `grid` and `featured` only while v2 lacked them).
  The old hero `poster` was a framed media plate — a different design from the new type-led poster —
  so it still becomes `cover`. `upgrade.ts` now reads a layout id in the namespace of whoever wrote
  it: a legacy-only type name, or a hero/faq on a page without a v2 Style, goes through the legacy
  table FIRST; everything else passes through first, as before. Pinned both ways, including
  idempotence; a mutation that skips the table-first rule fails the hero test.
- **X15 · 2026-09-28 · E4 · Picture sizes.** A picture drawn wider than the `md` file (400px) takes
  `lg` (800px): the mosaic's large tiles, the strip's landscapes, two-column grids and the bento lead.
  Amends §10's "md unless full-bleed". Tiles wider than 800 CSS px still upscale until
  `Codex-61zsk.13` adds a larger variant or `srcset`.
- **X16 · 2026-09-28 · E5 · Editor.** The Style tab mounts only while open (eight live thumbnails; the
  size bindings that cost 574ms of forced reflow were replaced by `ResizeObserver` measuring). A
  page's "current fonts" = its own, else the org's, else Inter; "Use these fonts" writes the pair as
  one undo step. The five recipes replace the empty page's single "start from the template"; new
  pages start empty, so `studio/journeys/new` needs no extra step. Clean's font pair (Manrope + Inter)
  is provisional until S3.
- **X17 · 2026-09-28 · S2 · Poster and Studio as built.** Poster ("printed sheets pasted up the page"):
  brand and accent fields alternate with paper, never contrast; capitals at display and heading
  size; rotated stickers; photos printed over a block of the other brand colour; angled edges; the
  panel veil with a sharp shader; fonts Anton + Roboto. Studio ("a maker's studio wall"): base/soft
  alternation, stats on accent with drawn circles, drawn underlines under section headings, a
  scribbled frame round the guide portrait, tilted prints with a lifted-ground border, paper grain at
  0.22; fonts Bitter + Figtree. Known limits: Poster's capitals read poorly in a script heading face;
  a brand with no secondary colour gives Poster's accent fields the org's secondary (grey on
  studio-alpha).

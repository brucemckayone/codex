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
| §5 token table: the `--lp-accent` row ("links, highlights, markers") | The accent paints marks | A drawn mark takes **`--lp-mark-ink`**, the 3:1 decorative grade (X24, X28). `--lp-accent` is the text grade (4.5:1): links and highlighted words, never a stroke. |

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
  brand colour used only for markers, links and the CTA (X21 — not the secondary). Signature: **read-along** — a statement
  paragraph brightens from `--lp-ink-soft` to `--lp-ink` as it crosses the middle of the screen (both
  states pass 4.5:1). Font suggestion: a light serif heading with a neutral sans body. **Not** the
  near-black-plus-one-acid-accent default.

The Style WP picks exact families from the `FontPicker` list, all different across Styles, and records
them in §13.

### 4.2 Corners: the brand radius, bent

> **Amended by X44 (phase 3a):** the source of a card's, a picture's and a button's corner is now
> the org's `--radius-card`, `--radius-lg` and `--radius-button`. The bends below stand.

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
- **X18 · 2026-09-28 · S4 · Soft and Cinematic as built.** Soft ("a calm, flowing surface"): one
  colour in tones — soft/base alternate in the full order AND the starter; the one filled card is a
  pebble of the PRIMARY; drifting shapes (strength 0.7, a mask fades them toward each band's top and
  foot so two same-colour bands never show a step) and curved edges; fonts Nunito + Outfit. Cinematic
  ("a film in scenes"): hero and CTA default to `atmosphere` with the panel veil and a SHARP shader
  (blurred Bloom read as mud); title cards narrow to a 46rem column; luminous hero/CTA titles; fonts
  Unbounded + Sora. **Radius floors:** inside an org, `--radius-md` IS the brand radius
  (`org-brand.css`), so a floor of `--radius-md` is 0 for a square brand and voids "Soft rounds it
  up" — a Style that must round a square brand floors on a space token (Soft uses `--space-2`). §4.2's
  ceilings still work, since they only cap.
- **X19 · 2026-09-28 · orchestrator · The second brand colour must be a colour.** `--lp-brand-2`
  prefers `--brand-secondary` even when it is a neutral (studio-alpha: secondary `#737373`, accent
  amber), so every Style that paints the second colour — Poster's fields, Soft's pebbles, Path's route,
  Quiet's markers — goes grey. The grey is usually not chosen: `BRAND_DEFAULT_SECONDARY` is
  `#737373`, so every org that never picked a second colour carries it. Fix at the source, once, in
  `schemes.css`: the second colour is the secondary when it has real chroma, otherwise the accent,
  otherwise the hue-shifted primary. It is pure CSS — S1 proved a chroma switch with premultiplied
  `color-mix()` (alpha `clamp(0, (c − 0.02) × 1000, 1)`; the picked colour within 1/255, or the
  fallback exactly), so it works on a page's own brand scope unchanged. A brand whose colours are all
  neutral stays neutral.
- **X20 · 2026-09-28 · S1 · Path and Quiet as built.** Path ("the course as a route"): one line in the
  second colour runs down a lane in the gutter from the hero's haloed start to the call to action's
  target, with a stop at every section heading; it draws to the middle of the screen as the visitor
  scrolls, a "you are here" marker rides its tip and each stop fills as the line reaches it; the
  journey map's stops sit on the route itself; defaults curriculum `map`, story `scroll`; the brand's
  corners exactly; fonts Lato + Source Sans 3. Quiet ("space and one accent"): every section on the
  brand's own ground parted by one hairline, the second colour only for markers, links and the call
  to action; read-along on the statement's first paragraph; the most padding of any Style; secondary
  buttons as underlined links; fonts Spectral + DM Sans. Both re-point the kit's own pole-switched
  accent tokens at the second colour (so the kit's moves keep every floor) and fall back to the
  primary when the second colour is neutral — superseded at the source by X19, harmless alongside it.
  All eight Styles' suggested families are distinct; Bold suggests none.
- **X21 · 2026-09-28 · orchestrator · Quiet's one accent is the brand colour.** §4.1 said Quiet's
  accent is the secondary; X19 exposed why that is wrong. The kit moves any colour used as text or a
  button into its ground's safe band, and a bright second colour (a gold, an amber) lands on brown on
  a light ground — measured on studio-alpha after X19, Quiet's "Join now" was ochre on a rose brand,
  with the brand's colour nowhere on the page; brand 2's gold gave an olive button. On a default org
  the second colour is the platform's amber (Codex-tbr04), not the brand at all. So Quiet uses the
  kit's accent and button colours as they are (the primary): the ask is the brand's colour, the same
  as the sticky bar and every other action on the org's site. Measured after: studio-alpha button
  rgb(214 27 68) light / rgb(255 47 89) dark; brand 2 its navy. A Style may still paint the second
  colour as decoration (Path's route, Poster's fields); the call to action is always the primary.
- **X22 · 2026-09-28 · S3 · Bold and Clean as built.** Bold ("said in headlines"): the largest type
  in the system (display ~157px, headings ~90px at 1440; a side-head step-down wherever a heading
  shares its row), one brand colour at full volume plus its contrast inverse — brand slabs at the
  hero, stats and CTA, contrast at problem, transformation and curriculum — and deliberately never
  the second colour (two loud fields is Poster's page). A 6px ink slab tops each ground section after
  the first, so plain sections in a row still read as separate. Story defaults to `chapters` (flat
  slabs); preview `base`; the featured card is always the OTHER pole (a brand card vanished on a navy
  brand's contrast band); the starter gains stats. Motion: the hero headline rises out of a fixed
  line under its own last baseline (`lp-bold-lift`, clip measured in the headline's em), every other
  heading builds `rise`, figures count up. No font suggestion; corners `clamp(0rem, brand × 0.25,
  --radius-sm)`, never a pill. Clean ("a portfolio"): the ground, a 5% whisper tint for reading
  sections, contrast "screening rooms" for video, preview and the CTA; the brand colour only on the
  ask. The hero picture takes 7/12 of the row and bleeds off the page edge (words stay in the
  column, X10); gallery `grid` in 3:2 frames, at most three to a row, a hairline caption rail. Motion:
  every picture wipes open while the photo settles from 1.1 (both end together); a hover lean-in on
  hover-capable devices only. Fonts Plus Jakarta Sans + Inter (replacing X16's provisional Manrope +
  Inter; Inter is the platform default body face, chosen knowingly). Corners: the brand's exactly.
  Rule the renderer test enforces: a Style's defaults never repeat a coloured band in its own full
  order (Bold's first draft put curriculum and preview on contrast side by side). The fourteen
  suggested families across the seven Styles that suggest fonts are all distinct.
- **X23 · 2026-09-28 · orchestrator · Brand never touches contrast on the page as it renders.**
  `catalog.test.ts` held each Style's full `order` to "a brand band never touches a contrast band"
  (with a very dark brand the two are near-identical and smear into one block), but nothing held the
  STARTER, a creator's reorder, or a hidden section between two bands — and Bold, the default Style,
  opened every new page brand hero → contrast problem. `keepBandsApart` (`resolve.ts`) now steps a
  Style DEFAULT back to `base` when it would put brand against contrast in either order, exactly as
  it already did for a repeated band; a scheme the creator chose is never overridden. Bold's starter
  now resolves brand · base · contrast · base · contrast · base · base · brand · base · base · brand.
  Pinned: `resolve.test.ts` (both orders, the chosen pair kept, and every Style's resolved starter
  and order checked for both rules — red before the fix on `bold starter 1: brand → contrast`);
  `template.test.ts`'s inline copy of the rule updated to match.
- **X24 · 2026-09-28 · V2b · Kit polish.**
  - **`--lp-mark-ink`, a decorative grade.** The accent is text-grade (4.5:1), so a bright second
    colour drawn as a line or marker landed on brown. Decorative marks (Path's route, stops, tip,
    map and timeline markers, story line) take `--lp-mark-ink`: the same fragment machinery, 3:1
    (WCAG 1.4.11) with the accent's own ~9.7% margin against the WORST surface of each pole (light
    Y ≤ 0.18 → 3.33:1 on the soft band at L 0.900; dark ≥ 0.185 → 3.30:1; atmosphere and decorated
    0.11 / 0.27). Amber #F59E0B's light route is rgb(165 105 3), not rgb(129 81 0). A kit test
    forbids any `color:` or button token taking it: marks only, never text.
  - **`--lp-accent-source`** (default `var(--lp-brand)`) is read by every accent and mark recipe;
    buttons still read `--lp-brand` (X21). A Style that wants its accent in another colour sets
    this one public token (Path: `var(--lp-brand-2)`) instead of re-pointing kit privates.
    `registry.test.ts` holds every `--_*` a Style declares OR reads to a declaration it may use (the
    kit sheets, its own `--_<id>-…` namespace, or a listed block private with its owner); a rename
    anywhere fails the build instead of silently falling back to the primary.
  - **Read-along ends on the paragraph's own colour** (`@keyframes lp-readalong` has only a
    `from`): it had brightened the statement's soft-ink answers to full ink, breaking motion.css's
    rule that an animation ends on the element's own look.
  - **Poster reserves its pictured geometry** while the hero has no still known at render and the
    mode is not "No image": a clip that lands fills the same box (it had jumped the words 116–151px at
    1440, and pushed the next section off screen at 390). Auto with no media now shows the brand
    plate; the type-only poster is the explicit "No image". Codex-vn5ir: hero-media presence on the
    awaited view would let auto-without-media render type-only with no shift.
  - **The plate is drawn in its panel's own ink** (`Media.svelte`): its disc and ring were the
    section's accent, which on a white-ink brand band is white on a near-white panel (1.04:1, a blank
    card on studio-alpha) and on a black-ink band a black disc at 20.12:1, as loud as body text. Now
    `--lp-panel-ink` mixed 18% / 32% into `--lp-panel`: disc ~1.5, ring ~2.1–2.5 in every brand and
    theme measured, always quieter than the softest text. Poster's empty picture, which runs off the
    band's foot, also gets a sheet of its own (the panel tinted like a card, 1.14–1.34 off the
    ground), computed one element up — `--lp-panel` declared from itself would be a cycle.
  - **A per-Style sticky-bar scheme** (`StyleDefinition.sticky`, absent = contrast; Cinematic soft,
    Quiet base) replaces PageRenderer's hard-code.
  - **"Keep my fonts"** declines a Style's font suggestion for that page and Style (per viewer,
    localStorage, every access guarded; no schema change).
  - **Path's stops sit on the heading** with a creator eyebrow (they sat 41px above) and on the CTA
    band's headline (25px above).
- **X25 · 2026-09-28 · V2a · Measured in the browser, and the looks it called.**
  - **§1's floors hold in every Style, brand and theme.** A calibrated instrument measured each text
    element against its PAINTED backdrop (glyphs hidden, the box captured, the 5th percentile per
    line), on the still page. Calibration: 32 planted checks. It failed exactly the planted fails,
    including a gradient that a flat `background-color` check passes at 4.89 but that paints 3.14,
    and white on a photo (1.66 vs 1.67 ground truth). It passed exactly the passes, a 1px stripe
    included. Coverage: 429 pages, 21,475 elements measured —
    - 8 Styles × brands 0–3 + org × light/dark, with pictures;
    - every atmosphere-scheme type with the org shader live, sampled three times (tightest 4.83,
      soft ink, light);
    - every non-default layout once;
    - every Style at 390.

    Result: 0 below the floor. The 16 flags were line-box geometry, each re-measured under the
    glyphs' own ink:
    - Studio's drawn circles crossing the empty ascent of a stat or price at 390: 9.78–17.01;
    - Poster's −2° transformation stickers, whose axis-aligned line box pokes past the pill: 15.58.

    102 aria-hidden story-chapter numerals at 2.24–2.89 are decoration (WCAG 1.4.3 exempts them).
  - **Marquee:** the opening mark's room is made on the voice, as the wall's is, from Voice's own
    sizes (pinned by the block's test). Bold's open cards had hung it 10.4px outside the card. Poster,
    which sets marquee quotes at title size, makes a title-size room.
  - **Bold:** section headings the kit's `rise` hook arms draw with Bold's own lift instead of the
    kit's fade-up: full ink, rising through a fixed line. It is gated like the kit's motion.
  - **Cinematic over the glow (no shader):** each title card gets an ink hairline rim and a shade
    under it. The rim had faded to ΔL 0.005 on about 60% of the edge. This is paint only; X10's
    geometry is unchanged.
  - **Clean in a 50–64rem container** (the editor's Tablet frame): the split hero's buttons share
    the row or each take a full row, never a ragged stack.
  - **Poster:** a photo under words in the text block's columns sits down by the colour block's
    offset. The block had caught a heading's last line at 2.15:1. `--_off` is now declared on the
    photo, so the room and the block read one value.
  - **Comments:** Soft's and Cinematic's wall comments are corrected (air only). Soft's chapters use
    `row-gap`.
  - **Handoffs, outside V2a's files:**
    - Bold's display with a long creator headline (61–85 characters at ~157px, up to 987px tall at
      1440) needs a hero length hook like ProblemBlock's `data-long`.
    - Seven of eight Styles stack split-hero buttons raggedly at tablet width (a ButtonRow rule).
    - The section-veil Styles (Clean, Soft, Quiet) show a mottled grey band and a pale edge over a
      blurred Bloom shader on atmosphere (the kit veil and the blurred canvas's edge).
    - The wall's quote room could come from one Voice-side value.
- **X26 · 2026-09-28 · orchestrator + R1 · What the branch review found.** The codex-review lenses
  were chosen by roster globs: silent-failure-hunter and scoping-security. Scoping-security found
  nothing in the diff. Silent-failure-hunter found 1 medium, 2 low and 1 nit, all fixed here, each
  with a test that fails without it:
  - **A layout id is read in the namespace of whoever wrote the section**, decided by the same test
    as its props. A section is legacy if its type is a legacy-only name, or if it is a hero or faq
    on a page without a valid v2 Style AND its props have the old builder's shape (a hero
    `headline`, a faq without `items`). "No valid Style" alone is not enough. The save schema
    degrades an unknown Style to none (deploy skew, or a Style retired later: Codex-61zsk.29), and
    such a page's v2 Poster hero was being read as the old `poster`, turned into `cover`, and
    autosaved that way. Only two ids mean different things in the two namespaces: hero `poster` →
    `cover`, and the retired `centered` → `statement`. The second is deliberate, because the old
    builder had renamed `centered` to `stage`; it is pinned.
  - **`upgradePage` is total for names `Object.prototype` has.** Every table lookup is own-property
    only (`own()`, and `mapLegacyProps`). `{type:'constructor', variant:'x'}` had thrown, and
    `toString`/`valueOf` had made sections typed as functions. Only a raw DB write could reach it,
    but this path renders the public page. `isLayoutOf` (ids.ts) still indexes plainly; it is safe
    while every caller passes a real type id.
  - **"Keep my fonts" remembers a decline for the whole visit when storage is refused.** The
    fallback moved to module scope, because the panel mounts only while its tab is open.
  - **A count-up cancelled from outside still settles** (`finished.then(settle, settle)`). It had
    stayed in its counting state with its frame loop running.
  - **The portal seed says what it retires.** It logs each course plan it retires, and keeps (with a
    warning) a plan with any subscription not `cancelled`.

  Not fixed, and filed: Codex-61zsk.29 (whether an unknown Style should be rejected on save instead
  of degraded, the owner's call) and Codex-n4844 (the brand-override sanitiser admits `image-set(`;
  CSP contains it).
- **X27 · 2026-09-28 · orchestrator + V3 · A long headline steps down (Codex-61zsk.23).** Bold's
  display (~157px at 1440) turned an 85-character headline into a wall. With the buttons' end
  measured against a 900px fold in brand 0, Bold's heroes ended at: statement 1093, split 1425,
  cover 1952, centered 1050, poster 1468. Poster's poster hero ran 9 lines to 1354 and split words
  mid-word ("MINUTE/S"). Cinematic's cover ran 6 lines to 1007.
  - **One line for "long".** `isLongHeading` (`kit/model/long-heading.ts`, over 64 characters) is
    shared by the hero and the problem statement, which had its own literal 64. The hero marks
    `.hero__headline` with `data-long`. The length measured is the headline the hero actually
    draws, so a hero left empty is measured by the course title.
  - **The step sits on the headline's parent**, as `<parent>:has(> .hero__headline[data-long])`
    setting `--lp-display-scale`. The poster's picture drops by one headline line and reads the
    scale on `.hero-poster__media`, a sibling of the headline, so the picture steps with the
    words (Bold 317→239px, Poster 260→202, Cinematic 254→212). HeroBlock's test pins each layout's
    parent class, so wrapping the headline fails a test instead of silently losing the step.
  - **Scales are absolute, per layout, at ≥ 56rem containers.** A custom property cannot multiply
    its own inherited value, and the measures differ. Each value is the largest step at which the
    field's maximum (120 characters) still ends, lede and buttons with it, above a 1440 × 900
    fold in the widest face measured (Archivo Black). A phone already draws the display at its
    floor.

    | Style | statement | centered | cover | poster | split |
    |---|---|---|---|---|---|
    | Bold | 0.70 | 0.62 | 0.50 | 0.45 | 0.40 |
    | Poster | 0.70 | 0.62 | 0.55 | 0.50 | 0.45 |
    | Cinematic | 0.80 | holds (120ch: 6 lines, ends at 855) | 0.62 | 0.62 | 0.55 |

    Cinematic's cover value also serves its no-photo title card: 85 characters was 6–7 lines
    ending at 930–1020, and is now 6 lines ending at 798 in brand 0.
  - **Measured after:**
    - Bold, 320 rows (5 layouts × 1440/390 × brands 0/3 × light/dark × 8 lengths): all 80 long
      rows at 1440 fit, with 0 split words. Every row at 390 and every short row is unchanged.
    - Poster and Cinematic, 240 rows A/B: all 60 long rows at 1440 fit, 0 changed elsewhere.
  - **Not fixed, and filed as Codex-61zsk.30:** at full size, 46–64 characters still runs past the
    fold in Bold's split, cover and poster heroes (6–8 lines, buttons ending at 932–1389). Poster's
    poster hero splits words from 46 characters. A single length line cannot fix this: it needs a
    second tier or a smaller base display in those layouts.
  - **Not measured:** 1024 × 768, containers of 50–56rem, the public page's site header above the
    hero, and the other five Styles with long headlines.
- **X28 · 2026-09-28 · orchestrator + V3 · Studio's pen takes the mark ink (Codex-61zsk.27).**
  Studio drew every pen mark in `--lp-accent`. That is the text grade, which moves a bright brand as
  far as a line of text needs: a teal brand's marks came out in `rgb(1 78 72)`, a near-black green
  at 9.2:1 on the page's ground, and a rose brand's in wine.
  - **The five pen marks take `--lp-mark-ink`:** the section-heading underline, the hero
    underline, the number circles, the portrait's scribble and the problem's dashes. The dash names
    the ink itself; it had inherited the block's accent bar. Studio's sheet no longer names
    `--lp-accent`.
  - **Measured** (OK-L, and chroma where it moved):

    | Page | Before | After | Brand |
    |---|---|---|---|
    | teal, light | L .38 | L .47 | L .60 |
    | teal, dark | L .73 | L .63 | L .60 |
    | rose, light | L .41, C .156 | L .50, C .191 | L .59, C .222 |
    | rose, dark | C .146 | C .217 | C .222 |

    - Against their ground: flat ≥ 4.58, painted 5th percentile ≥ 4.40. Studio draws paper grain,
      so the kit's decorated grade applies, and its marks sit at 4.6–6.3 rather than ~3.3.
    - Text over the marks, measured under the glyphs' own ink: every mark host is at p5 ≥ 16.1 at
      1440 and ≥ 16.3 at 390.
  - **Not moved:** the prints' paper border and 1px ring frame the photograph; they are not pen
    strokes. Marks on the accent field (stats) and on the brand band (the CTA) resolve to ink
    either way.
  - **`style-studio.test.ts`** finds a mark the way the page draws it: a rule masked with a
    `--lp-mark-*` shape, read with Svelte's CSS parser. It requires that rule's own paint to
    resolve to exactly `var(--lp-mark-ink)`, following the sheet's custom properties, so neither a
    `var()` hop nor a tint can hide the grade.
  - **The reference pattern moved with it.** `motion.css`'s header showed a mark painted in
    `--lp-accent`, which the next Style would have copied. It now shows the mark ink and names the
    accent as the wrong grade. §2 records that 01's token table no longer paints markers in the
    accent.
  - **Filed as Codex-61zsk.31:** the portrait's frame is drawn on the print's paper edge, not
    outside it as its comment says. In dark mode it crosses that border at 2.78 / 2.80:1 (about 4.0
    in the accent). Against the section's ground it holds 4.58 / 4.64.
- **X29 · 2026-09-28 · orchestrator + V3 · A split hero's buttons are never ragged
  (Codex-61zsk.24).** From the split's own 50rem breakpoint to about 70rem, the words column is
  narrower than a phone, so its two buttons wrapped into a ragged stack. That happened at 820 in
  Soft, Cinematic, Path, Poster, Studio and (brand 0) Bold, and at 1000 in Poster. Clean had fixed
  it for itself in X25.
  - **One kit rule, in HeroBlock's split styles.** `@container (50rem <= width < 70rem)` gives that
    column ButtonRow's phone rule: the row stretches, the buttons grow, and a quiet button or Bold's
    link-styled secondary keeps its width. Clean's copy is deleted. The two copies of the rule point
    at each other ("change them together"). HeroBlock's test pins the markup the rule selects on,
    the three declarations, and that the range starts exactly at the split's own breakpoint.
  - **Why not in ButtonRow.** 14 blocks use it, and it measures only the section, so it can't tell a
    half-width column from a full-width row. A 50–70rem rule there would stretch every full-width
    button row on a tablet. Making the column a size container would let the phone rule fire by
    itself, but it breaks two ways:
    - it collapses wherever a block shrink-wraps the row (the statement hero's `justify-self: end`);
    - it re-bases every `cqi` token inside, so Bold's `--lp-button-size` would move even at 1440.
  - **Why 70rem, not Clean's 64rem.** Poster's capitals pair (about 456px) stayed ragged up to
    1056px in brand 0, so 64rem would have left it ragged at 1024, the landscape-tablet width.
    70rem is where a 1:1 split's words column reaches 30rem, the width the phone rule is written
    for.
  - **Measured** over 8 Styles × 820/1000/1440 × brands 0 and 3, 48 rows each way:
    - 0 ragged after;
    - 1440: 16 of 16 rows identical to before;
    - buttons that already fit share a filled row, a little wider than their natural size, which
      is ButtonRow's own phone look.
  - **Limits:** a creator's longer labels can still go ragged above 70rem, because no width rule can
    know label widths (filed as Codex-61zsk.32). The sample pair fits every Style from 1088px. Only
    a browser can see raggedness; the tests pin the keys and the range.

    The owner later chose to leave it as is ("Leave as is (Recommended)"), and .32 is closed.
- **X30 · 2026-09-29 · orchestrator + S29 · An unknown page Style is rejected on save
  (Codex-61zsk.29).** The owner's decision, verbatim: "Reject the save (Recommended)", meaning "The
  editor says the save failed and keeps the creator's work. The stored page never changes to a Style
  they didn't pick."

  Before this, the save schema degraded an unknown Style to none, like every design axis. A page
  saved during deploy skew (the web newer than the content-api worker) therefore silently became
  Bold.
  - **Only the Style rejects.** `sectionDesignSchema.style` (`packages/validation`, `journeys.ts`)
    and its twin `pageDesignSchema.style` (`landing-page.ts`) are now plain enums. An absent Style
    still passes. A section's `scheme` and `spacing` keep degrading, for the reason their comment
    gives: one section losing an axis is better than a failed page save.
  - **Only writes reject.** No read path parses with these schemas. The builder's read is a plain
    select, and `upgrade.ts` passes a stored Style through only when it is a known id. Anything
    else resolves to Bold on load. So a page whose Style is retired later still renders and still
    saves (as Bold); it can never get stuck failing every save.
  - **What the creator sees.** The top bar and toast say the save failed, and the editor keeps
    every edit. Autosave never retries on its own, and the local draft survives. The message
    itself reads "Invalid request data": `withServiceErrors` forwards only a 4xx's top-level
    message, and the schema's sentence ("Unknown page Style. Refresh and choose a Style again.")
    stays in the response's doubly nested `details`. Filed as Codex-pubug.
  - **Tests** (`packages/validation`, 576/576): the save body rejects an unknown or non-string
    Style with the issue at `design.style`, and accepts every id and an absent Style. An unknown
    `scheme` or `spacing` still degrades. The twin rejects the same way. Calibrated by restoring
    the `.catch`: exactly the 4 new tests went red.
- **X31 · 2026-09-29 · orchestrator + V3 · Medium headlines get their own step
  (Codex-61zsk.30).** The owner's decision, verbatim: "A second size step (Recommended)", meaning
  "Medium headlines get their own smaller step; short headlines keep Bold's full display size."
  - **Three tiers from one module.** `headingLength()` in `kit/model/long-heading.ts` returns
    short (up to 24 characters), medium (25–64) or long (over 64). `isLongHeading` is the long
    tier, so ProblemBlock is unchanged. HeroBlock marks the drawn headline `data-medium` or
    `data-long`.
  - **Why the medium line is 24.** A full-size sweep of 30 headlines (20–64 characters) over
    Bold, Poster and Cinematic, 5 layouts each, in Archivo Black at 1440 × 900. The longest
    headline each layout fits:

    | Layout | Fits up to |
    |---|---|
    | Bold cover | 24 |
    | Bold poster | 27 |
    | Poster cover | 31 |
    | Bold split | 40 |
    | Bold statement | 46 |
    | Poster split | 50 |
    | Cinematic poster | 50 |
    | Poster statement | 55 |

    One shared line has to sit where the tightest layout breaks, and that is Bold's cover.
  - **The steps,** at ≥ 56rem, on the headline's parent as in X27. Each is the largest scale at
    which a 61–64-character headline ends above the fold with 0 split words:

    | Style | statement | split | cover | poster |
    |---|---|---|---|---|
    | Bold | 0.90 | 0.55 | 0.70 | 0.65 |
    | Poster | 0.95 | 0.55 | 0.75 | 0.60 |
    | Cinematic | — | — | 0.75, the no-photo card only | 0.85 |

    - Every layout is monotonic: short ≥ medium ≥ X27's long.
    - Where the full size holds to 64 there is no step: Bold's and Poster's centered, and
      Cinematic's statement, split, centered and pictured cover.
  - **Measured after** (1440, three Styles, 30 headlines):
    - 468 medium rows in stepped layouts: 0 past the fold, 0 split words;
    - unstepped layouts and every short row: unchanged;
    - 390: every row unchanged.
  - **The cost of one shared line**, filed as Codex-61zsk.34 (a continuous, per-layout scale;
    needs the owner's OK):
    - layouts that hold more step down anyway (at 40 characters, Bold's statement goes from 157
      to 141px, and its split from 110 to 86px);
    - the size jumps while a creator types, at the 25th and the 65th character.
  - **Filed as Codex-61zsk.33:** Poster's poster hero splits a long word mid-word even in a short
    headline ("MORNINGS," at 21 characters). That depends on word length, so no length tier can
    fix it.
  - **Instrument note:** on a browser context's first page, `fonts.ready` resolves before the
    brand webfont has even been requested, so the first measurement reads the fallback face.
    Warm up with a throwaway page before measuring.
- **X32 · 2026-09-29 · orchestrator + V3 · Studio's portrait frame sits outside the print
  (Codex-61zsk.31).** The owner's decision, verbatim: "Move it outside (Recommended)", meaning
  "Matches the design's intent and fixes the dark-mode dip; the frame gets a little air around the
  photo. Checked at phone width too."

  The scribbled frame's comment said "outside the print", but it was drawn on the print's paper
  edge, with much of its stroke over the photograph. X28's 2.78:1 was the border alone. Measured
  across every pixel of the stroke, the dark minimum was 1.04–1.25.
  - **The outset is proportional:** `inset: calc(-1 * (var(--space-7) + 5%))`. The scribble's
    paths wander in from their box by up to 4.5% of it. A fixed 56px step cleared the print at
    1440 but left 3.4px of air, with the stroke in the shade, on a 746px stacked print at 820. The
    measured air is now 14–18px at every width from 390 to 1440.
  - **Room, never clipping,** in Studio's own rules:
    - a split portrait pads in by the frame's reach minus its distance from the section edge
      (0 at 1440);
    - a centred portrait is capped at `100% - 2 × --space-8`;
    - below the guide's split width, `(width < 52rem)`, a stacked portrait keeps the frame's foot
      clear of the heading. The new test pins that query to InstructorBlock's own
      `(min-width: 52rem)`.
  - **Measured after,** on 24 pages (split and centred × 390/820/1440 × brands 3 and org × light
    and dark):
    - 0 stroke pixels on the print or over the photo;
    - air 13–18px;
    - contrast outside the photo at least 4.34 (light at least 4.56);
    - no horizontal scroll on any page.
  - **The cost:** on narrow screens the print steps in to make room. The split print loses about
    68px of width at 390 and 84px at 820, and the centred one goes from 320 to 291px at 390. 1440
    is unchanged.
- **X33 · 2026-09-29 · orchestrator + V4 · A Moving background reads as the brand, edge to edge
  (Codex-61zsk.25).** Over a blurred org shader (Bloom), Clean, Soft and Quiet drew an atmosphere
  section as a mottled grey band, with a pale frame at the window's edges.
  - **The pale frame.**
    - *Cause:* `filter: blur()` on the fixed shader box averages in the transparent pixels past
      its edge. On the raw shader, L climbed from 0.27 to 0.63 over the outer ~130px, and an
      atmosphere section, which clears the stack, shows that.
    - *Fix* (`routes/_org/[slug]/+layout.svelte`): on a blurred atmosphere page only, the
      canvas runs 2 × `--blur-2xl` (120px) past every edge, with `object-fit: cover`. The gate is
      `.org-layout[data-hero-shader-active]:not(.org-layout--landing):has(.lp[data-lp-atmosphere]:not([data-lp-atmosphere='sharp']))`.
    - *Render work is unchanged.* The canvas ELEMENT grows, not its box, so the drawing buffer
      ShaderHero sizes from the box stays the window, and so does its under-768px resolution cap.
      Only the composited area grows (+48% at 1440, +107% at 390).
    - *Measured:* the edge dL went from +0.048 to 0.000 (light, 1440).
    - *No sideways scroll:* at 390, each overscanned page (canvas at −120,−120, 630 × 1084) keeps
      `scrollWidth` 390. Five pages outside the gate keep a window-sized canvas: no atmosphere,
      a page brand, Cinematic's sharp background, org home and explore.
  - **The grey band.**
    - *Cause:* a light veil over a dark shader. 18% of a near-black field takes the ground to
      L 0.87 at chroma 0.004, and at the proven veil strength even white can't clear L 0.88. So the
      lever is colour, not lightness.
    - *Fix:* a Style opts in with `--lp-atmosphere-ground: tint` (Clean, Soft and Quiet do). The
      atmosphere section's `--lp-bg` becomes the Style's panel ground, the tint its own cards
      carry. The live veil paints that at the same proven strength
      (`rgb(from var(--lp-bg) r g b / var(--_atmos-s))`), and every word is computed against it.
    - *Dark:* the dark panel ground reaches L 0.28, so a branchless pole step
      (`clamp(0, (l - 0.5) * 1e6, 1)`) brings it to the edge of the band §5.1's proof holds for
      (L ≤ 0.24, chroma ≤ 0.039). Light passes through unchanged.
    - *Measured,* over 3 Styles × light/dark × 1440/390 × two brands (48 live runs):
      - band chroma: crimson .003–.004 → .030–.043; teal .011–.014 → .018–.031;
      - shader transmission unchanged (light .18, dark .14);
      - all 104 text measurements ≥ 4.5 under the glyph ink, the tightest 4.78 (Quiet, light, 390);
      - Bold, Path and Studio, and pages without an atmosphere section: unchanged.
  - **Where it can't reach:**
    - a browser without custom-property style queries keeps the old grey veil (the kit's
      progressive-enhancement rule);
    - Bold, Path and Studio draw the same plain veil, so they still show the grey band. Opting
      them in is one line each, plus a measurement (filed as Codex-61zsk.35).
- **X34 · 2026-09-29 · orchestrator + V5 · A hero headline is sized continuously by its length
  (Codex-61zsk.34).** The owner's decision, verbatim: "we move to co timuous layout scalle use
  subagents preserve context do this before pushing prs". It replaces X27's and X31's steps as
  the primary scale. They were one shared line for every layout, and the size jumped as a
  creator typed past it.
  - **The signal.** HeroBlock sets the drawn headline's length (the course title when the heading
    is empty) as `--lp-heading-chars` on each layout's words root. The poster's root is inside
    HeroPoster, so for the poster the property sits on a plain box around it. Codex-61zsk.36 moves
    it to a HeroPoster prop.
  - **The scale.** Per Style and layout, at ≥ 56rem, on the same parent the steps use:
    `<base> * min(1, pow(C / var(--lp-heading-chars, 120), p))`.
    - It sits inside `@supports (line-height: pow(2, 0.5))`, a probe on a real property; a
      custom-property probe always passes. A browser without `pow()` keeps X27/X31's steps, which
      stay as the fallback.
    - The continuous selector (1,5,0) beats the steps' (1,4,0).
    - An unset length counts as 120, the smallest size.
  - **The fit.**
    - B(n) is the largest scale that ends within the 900px fold with 0 split words. It was found
      by binary search, as the minimum over brands 0 and 3 and over two headline families: F1 is
      V3's headline, and F2 is the same with longer words.
    - Each curve sits under 0.99 · B(n), moves at most 3% per character, and has the most area
      over 20–120 characters.
    - Gap to the boundary: at least 1.0–2.5%. The largest one-character move: 1.9%.
  - **28 rules across all 8 Styles** (C / p, with the layout's base where it isn't 1):

    | Style | statement | split | cover | centered | poster |
    |---|---|---|---|---|---|
    | Bold | 43 / .45 | 31 / .36 (.7) | 19 / .39 | 57 / .55 (.84) | steps |
    | Poster | 54 / .45 | 29 / .28 (.7) | 27 / .40 | 73 / .83 (.84) | steps |
    | Cinematic | 85 / .39 | 78 / .51 (.7) | 45 / .38 (card 53 / .43, .82) | 106 / 1.36 (.84) | steps |
    | Clean | — | 79 / .39 (.8) | 81 / .43 | — | 70 / .47 |
    | Soft | — | — | 110 / 1.34 | — | 39 / .20 |
    | Path | — | 91 / .32 (.7) | 65 / .36 | — | 22 / .20 |
    | Studio | — | — | 68 / .34 | — | 31 / .21 |
    | Quiet | 97 / .26 | 72 / .35 (.7) | 68 / .57 | 109 / .66 (.84) | 16 / .20 |

    **Refit after the first push.** The first fit sampled the long-word family (F2) only every 5
    characters. At every length, brand 0 missed between the samples:
    - past the fold, by 1–21px (Quiet's cover by up to 74);
    - a split word at 42–43 characters in four unstepped posters.

    These 12 rules were refitted against F2 at every length, and only their C and p moved. The
    table shows the refitted values.

  - **The three stepped posters keep their steps** (Bold, Poster and Cinematic). Their limit is the
    longest word beside the picture, not the headline's length. A length-only curve that never
    splits a word lost to the steps at most lengths. A word-length signal belongs to
    Codex-61zsk.33. The structural test pins them as stepped only.
  - **Smaller than today's step at some lengths.** In each case today's step was either tight or
    splitting long words:
    - Bold statement at 115–120 characters (−11%);
    - Bold cover at 48–64 (−11% at 64, where today ended at 895 of 900);
    - Cinematic cover at 46–64 (−12.5%).

    Never smaller: Poster split, Cinematic statement and split.
  - **Measured,** over 35 layout variants, with both headline families at EVERY length from 20 to
    120, in both brands:
    - 0 past the fold and 0 split words;
    - the size never grows with length;
    - geometry is identical up to each layout's C;
    - 390: 7,888 of 7,888 rows identical;
    - 1440, layouts without a rule: 2,968 rows identical;
    - the stepped posters: 732 rows identical.
  - **Known gaps:**
    - a poster's lede can still run under its picture's foot. The cause is HeroPoster's
      negative float margin, which predates X34. Its rows went 22 → 16, and 2 of those 16 are
      new, at 120 characters (Codex-61zsk.36);
    - not measured: 1024 wide, containers of 50–56rem, the public page's header, and the editor
      canvas.
- **X35 · 2026-10-09 · orchestrator + p3a · Phase 3a: the org's derived tokens are the source
  (Codex-61zsk.41, Task 1).** The owner's decision (2026-09-30), verbatim: "Follow the org
  (Recommended)". The kit had re-derived a second palette from the raw brand inputs; it now
  draws the org's own `--color-*` tokens and keeps its move formulas only as the safety net.
  - **The source.** `.lp` reads the org's nine tokens as `--_org-*` (`schemes.css`):
    `--color-background`, `-surface-secondary`, `-surface-card`, `-text`, `-text-secondary`,
    `-border`, `-heading`, `-focus` and `-interactive`. A page's own brand makes the root a
    nested `[data-org-brand]` carrier, which re-derives them there.
  - **Where.** Base and soft sections that are not over a picture, in every Style but
    Cinematic. **Cinematic's dark room stays, deliberately**: its sections keep the kit's
    inks.
  - **The floors.** An org colour is drawn exactly, and moved only as far as a floor needs:
    text 4.5:1, large text, marks, buttons and the focus ring 3:1. The grades are the band's
    worst surface times a 2% margin. Plain: text `--_ot` (light Y ≤ .114, dark ≥ .25), large
    `--_ol` (≤ .196 / ≥ .15). Decorated (Studio's paper, Soft's shapes): `--_odt`
    (.086 / .33) and `--_odl` (.155 / .203). The hairline is decoration and is the org's
    exactly.
  - **The bands (amended by X48).** The ground, the soft band and the card move only when
    outside their band: light L ≥ its edge (chroma capped at 0.046 only when moved), dark
    L ≤ its edge (0.039). The edge is no longer fixed at 0.9 / 0.24: it is the narrowest band
    of the pole that holds the org's ground (X48), so the ground is drawn as itself unless it
    lies past the pole's last band. The surfaces share the ground's band, so there is one
    worst surface for every ink on it, and each band has its own grades.
  - **Polarity follows the org's ground (amended by X48).** The pole is the ground's own, by its
    luminance, in either theme: an org background with no dark twin keeps the light pole in
    dark mode, as the org's own pages do, and a dark one is the dark pole in light mode too.
    PageRenderer names each theme's band on the root (`data-ground-light`,
    `data-ground-dark`); the selectors no longer read the carrier's style text.
  - **The one departure: the soft band (X47, D14).** On an org's background the soft band is
    not `--color-surface-secondary`. It is the org's ground a step toward its ink, with the
    ground's chroma kept. This is the one place the kit departs from the org's derived token.
    The reason: the org makes its secondary surface for small controls (its search box), at
    half the ground's chroma, and as a full-width band on a warm ground it reads grey. On the
    platform's neutral ground the token stands.
  - **Tests:** `e2e/page-kit/brand-fidelity.spec.ts` "a base section is drawn in the org's own
    tokens" (4 pages × 2 themes), "a … preview on a … viewer draws the org's … tokens", "a dark
    preview on a light viewer resolves a page carrier's DARK brand tokens";
    `kit/styles/schemes.test.ts` "the org is the source — its tokens, drawn exactly unless a
    floor fails (phase 3a)": it models `org-brand.css`, draws the seeded orgs exactly, holds
    every floor for ANY org colour on the worst surface its band can hold, and moves no further
    than 3% past what that surface needs.
  - **Measured** against explore: 27 of 32 base-section readings differed before; 0 after.
- **X36 · 2026-10-09 · p3a · The button is the org's, at the org's height and weight; the
  floating bar defaults to `base` (Task 2).**
  - **Fill and label.** A primary button is the org's `--color-interactive` through `--_ol`,
    with the org's label rule (the platform's lightness pivot, `--color-on-interactive`'s
    own). Accent text is the same colour at the text grade. The kit's own bands (contrast,
    brand, accent) keep their own button grade (.248 / .175).
  - **Shape.** In every Style a call to action is the org's large button,
    `--tap-target-min` (44px), and a leading one (`size="lg"`: the hero's, the closing
    band's, a featured offer's) its extra large, `max(--tap-target-min, --space-12)` (48px).
    Both are scaled by the brand's density, at `--font-medium`. A Style keeps the label's
    size, tracking and padding.
  - **The bar's scheme.** `PageRenderer` passes `STYLES[style].sticky ?? 'base'`, and
    `StickyCta`'s own default is `base` too. Quiet names `base`; Cinematic names `soft`, its
    tint. A dark bar is a band the org's site never shows, and its button would have to move
    to stay legible.
  - **Tests:** spec "every call to action is the org's button height and weight" (compared as
    numbers since 3a Task 3: at a density other than 1 the computed height prints rounded);
    the button rows of the spec's mapping; schemes.test "draws the org's button, accent text
    and marks on base and soft — on both paths"; `PageRenderer.svelte.test.ts` "floats the
    bar on the org's own surface (base, its raised card) unless a Style names a band:
    Cinematic's on its tint"; `StickyCta.svelte.test.ts` "defaults to the base scheme, as
    PageRenderer does".
- **X37 · 2026-10-09 · p3a · `--lp-accent-source` is the marks' source only.** It is the brand
  colour a Style's marks are moved from (Path draws its route in the second colour). Accent
  text and buttons are the org's interactive colour in every Style, never the source, so a
  page's words and its asks are one colour. A mark is graphic grade (3:1) and is never the
  colour of text or of a button. **Tests:** schemes.test "moves the accent and the buttons from
  the brand, the marks from their source — on both paths"; "the mark is graphic grade only" ("is
  never the colour of text or of a button anywhere in the kit", with its calibration).
- **X38 · 2026-10-09 · p3a · A mid-tone button darkens a little and keeps white (D8).** The
  owner's decision, verbatim: "Darken a little, keep white (Recommended)".
  - **The rule.** Where white falls just short of 4.5:1 on the org's fill, the fill darkens
    only as far as white needs (`--_wl-*`, `--_wl-f`). A bright fill keeps the org's black
    label (`--_wk`, the switch at Y .182). On Tending the Grief, #ef3d0b is drawn #dd3809 with
    a white label, in both themes.
  - **Where it differs from the org.** The org's own label rule would put black on such a fill
    (for example `#FF0000`, which the kit draws `#ed0000` with white). That difference is the
    decision.
  - **Tests:** schemes.test "keep white — a mid-tone button darkens a little rather than take a
    black label (owner, D8)", with its teeth; spec "Tending the Grief's mid-tone brand darkens a
    little and keeps a white label" (light and dark).
- **X39 · 2026-10-09 · p3a · A page background with no twin follows the org in the other theme
  (D7, `data-page-bg`).** The owner's decision, verbatim: "Follow the org's dark mode
  (Recommended)".
  - **The rule.** A page that sets only `--brand-bg` draws it in light mode only, and a page
    that sets only `--brand-bg-dark` draws it in dark mode only. In the other theme the page
    takes the org's own ground and inks.
  - **The attributes.** `PageRenderer` marks the carrier `data-org-bg` and names the theme(s)
    the background is for in `data-page-bg` (`light` | `dark` | `both`). Both are derived
    from the properties declared, never from the style text.
  - **Tests:** spec "a light-only page background gives way to the org's dark mode", its
    preview case, and "studio-alpha light: a dark-only page background gives way to the org's
    light mode"; `PageRenderer.svelte.test.ts` "names which theme the page's own background is
    for, so the other takes the org's (owner, D7)"; schemes.test "gives a page background with
    no twin back to the org in the other theme (owner, D7)".
- **X40 · 2026-10-09 · p3a · Path's missing second colour is a tone of the org's own (D11).** The
  owner's decision, verbatim: "A tone of the org's colour (Recommended)". It replaces the
  invented 45° hue (of-blood-and-bones' ochre #765821).
  - **The rule.** With no second colour of the org's own, `--lp-brand-2` is the org's colour
    at the same hue, moved in OKLCH lightness toward the ground (+0.2 on the light pole, −0.2
    on the dark), turning back at the band edge (L 0.78 / 0.25). An org's own second colour
    is untouched.
  - **Tests:** schemes.test "the second colour's tone — the org's own hue, apart from it (owner,
    D11)", with its teeth; spec "Path's route is a tone of the org's colour" (light and dark).
- **X41 · 2026-10-09 · p3a · The hero's main button over a photo is the org's own button (D10).**
  The owner first chose "The org's colour (Recommended)". After seeing a lightened build turn
  Tending the Grief's orange into coral (#ff7863), the owner chose "Org's own button
  (Recommended)" (D10b).
  - **The rule.** The hero's primary button over media is exactly the button the kit draws on
    the org's surfaces. One rule carries both selectors and the two declarations, so they
    cannot drift apart.
  - **Why WCAG allows it.** WCAG 1.4.11 asks a control with visible text for no contrasting
    edge, only a legible label and a visible focus ring
    (https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html#boundaries). The focus
    ring stays the on-media ink, at least 6.96:1 against the lightest surface any brand's scrim
    allows.
  - **Scope.** The secondary, quiet and watch controls, and the words, keep the on-media ink.
  - **Known gap:** a Cinematic cover hero over a photo gets the org's button at the dark-pole
    grade, while Cinematic's sections keep their own button. No live page has one.
  - **Tests:** schemes.test "the hero's main button over a photo is the org's own button
    (owner, D10)" (shared definition; focus ring for every brand); spec "the hero's main button
    over its photo is the button its own sections draw" (light and dark).
- **X42 · 2026-10-09 · p3a · The floating bar is a raised card (D9, Task 3).** The owner's
  decision, verbatim: "Raised card (Recommended)". Since Task 2 the bar sat on the org's ground,
  flat against the page it floats over.
  - **The rule.** On the org's surfaces (scheme `base`), the bar draws its scheme's card colour,
    `--lp-panel`, which there is the org's `--color-surface-card`. It sits on
    `--lp-shadow-raised` (= `--shadow-xl`): the shadow the org floats its own bar
    (`SubscribeStickyBar`) and its raised panels on. It holds the org's button. Quiet adds its
    hairline rim over the same shadow. Cinematic's `soft` bar keeps its tint, because there
    the card is the ground.
  - **The floors.** The card is held in the ground's band exactly as the ground is (the same
    `clamp`, per pole), so every ink and button proven on that band holds on it.
  - **Card against ground.** No seeded org's card equals its ground:
    - of-blood-and-bones: #fffffd on #f3f0e7 (1.14:1), both themes;
    - studio-alpha and studio-beta, light: #ffffff on #fafafa (1.04:1). That is near-equal,
      so the shadow carries the bar;
    - studio-alpha and studio-beta, dark: the platform's card #404040 (L 0.37) lies above the
      dark band, so it is held at L 0.24 (#1f1f1f) on #171717 (1.09:1), and the org's dark
      shadow carries it.
    - Neither studio has a bar on a live page, because nothing is on sale.
  - **Measured on of-blood-and-bones, light:** text 20.97:1, price 9.43:1 (12.61:1 dark), the
    button against the card 7.06:1, and its label 7.07:1. On Tending the Grief's own #dd3809
    the button is 4.52:1 against the card and its label 4.52:1 on it.
  - **Tests:** spec "the floating bar is a raised card in the org's card colour, with the org's
    button" (2 pages × 2 themes): the card, the shadow and all four floors. The card is the
    org's exactly when it lies in the band, and on the band's edge when it does not.
    schemes.test "the floating bar is a raised card in the org's card colour (owner, D9)": the
    drawn rule, the card in the ground's band, the floors for any brand and org ground, and the
    seeded orgs. `StickyCta.svelte.test.ts` holds the default scheme.
- **X43 · 2026-10-09 · p3a · Labels in the org's case and tracking (Task 3).** A label, the
  eyebrow (the kit's kicker), is in the org's `--text-transform-label`:
  `--lp-case-label: var(--text-transform-label, none)`.
  - **The tracking.** The org has no label-tracking token. Its own uppercase labels pair the
    case with `--tracking-wider` (0.05em) in 15 of the 20 places that read the case token, and
    in 11 of the 13 on its public pages: the floating bar, the catalogue tile, the content
    page's two, and 7 on the pricing page. The other 5 use `--tracking-wide`. So an uppercase
    label takes
    `--tracking-wider`, through `@container lp-page style(--lp-case-label: uppercase)` on each
    section. A label in any other case keeps its Style's tracking.
  - **Explore's kicker.** It is a literal 0.2em at 13px (`JourneyEntryCard`), not a token, so
    the kit does not copy it.
  - **Before → after,** on all 7 live pages, both themes: sentence case at 0–0.04em became
    uppercase at 0.05em. 0 of 14 rows matched explore's case before; 14 of 14 after.
  - **The fold (X34, X29, X27, X31).** 2,828 rows were re-measured and are identical to before:
    0 past the fold, 0 split words, min gap 55.3px. An uppercase tracked eyebrow is 18–23%
    wider, but every live one stays on one line; the longest is 324 of 355px at 390.
  - **Known gaps:**
    - SideLabel, the offer badge and the testimonial marquee's labels (blocks) do not read
      `--lp-case-label`, so they stay in their own case;
    - a browser without style queries keeps the Style's tracking.
  - **Tests:** spec "every eyebrow is in the org's label case and tracking" (4 pages); "the
    hero's eyebrow reads as its explore card's kicker" ("FOR THE WEIGHT YOU CARRY", equal to
    explore's); "a page that sets its labels in sentence case keeps them, at its Style's
    tracking".
- **X44 · 2026-10-09 · p3a · Corners: the org's radius tokens, bent (Task 3; amends §4.2).** A
  card's corner is the org's `--radius-card`, a picture's its `--radius-lg` and a button's its
  `--radius-button`, each times the Style's bend from §4.2, with §4.2's floors and ceilings.
  Chips and pill-if-rounded stay on the brand radius. The org's tokens are re-derived on a
  page's own carrier.
  - **Before,** the raw brand radius times the bend drew every card and picture at two thirds
    of the org's card corner. Buttons are unchanged, because `--radius-button` is the brand
    radius.
  - **Drawn** (card and picture / button, px), verified on all 24 combinations:

    | Style (k) | of-blood-and-bones (radius 0.33rem) | studio-alpha (0.375rem) | studio-beta (0.5rem) |
    |---|---|---|---|
    | Bold, Poster (.25) | 1.98 / 1.32 | 2.25 / 1.5 | 3 / 2 |
    | Studio, Quiet (.5) | 3.96 / 2.64 | 4.5 / 3 | 6 / 4 |
    | Clean, Path (1) | 7.92 / 5.28 | 9 / 6 | 12 / 8 |
    | Soft (2) | 15.84 / pill | 18 / pill | 24 / pill |
    | Cinematic (1) | 7.92 / pill | 9 / pill | 12 / pill |

    Clean and Path draw the org's own card corner. Explore's content cards are rounder, at
    `--radius-xl` (10.56 / 12 / 16).
  - **Harness note.** Hydration sets the root's attributes back to the page's own about 0.66s
    after the server's HTML renders. So the spec's `openAs` waits for a quiet network before
    it draws anything on the root, and the corners test checks that the Style it set is still
    the one drawn.
  - **Tests:** spec "every Style's corners are the org's radius tokens, bent" (3 orgs × 8
    Styles × card, picture and button).
- **X45 · 2026-10-09 · p3a · Shadows: the org's own, where a Style lifts a card (Task 3).**
  - **What the org draws.** Explore's cards rest on `--shadow-md` (on the picture, since the
    card itself is transparent) and lift to `--shadow-lg` under the pointer. The home page's
    carousel slides sit on `--shadow-lg`. Its floating bar and raised panels (Spotlight, the
    subscribe panel, the pricing tier cards) sit on `--shadow-xl`.
  - **The kit's two tokens.** `--lp-shadow-card` (`--shadow-md`) for a card at rest, and
    `--lp-shadow-raised` (`--shadow-xl`) for one that floats over the page (X42). The org's
    dark mode deepens both.
  - **Per Style:**
    - Soft's one filled card in a band rests on `--lp-shadow-card`. It was the card's own
      ground deepened.
    - Cinematic's plates keep the room's own shade: the room is the Style's deliberate dark,
      where a grey shadow cannot show.
    - Studio's prints are a photograph's edge, the Style's texture, and keep theirs.
    - Clean, Bold and Poster draw no card shadow by design; Path and Quiet draw flat cards.
  - **Known gap:** the org's shadow fine-tune (`--brand-shadow-scale`, `--brand-shadow-color`)
    never reaches `--shadow-*`. The tokens are composed at `:root`
    (`styles/tokens/shadows.css:12`), and `org-brand.css:190-191` re-declares only their
    inputs. The org's own site has the same gap, and the kit matches it.
  - **Tests:** spec "Soft's filled card rests on the org's card shadow" (light and dark; red on
    the old Soft stylesheet); the bar's shadow in X42's spec case.
- **X46 · 2026-10-09 · p3a · Phase 3a measured, before → after (c9ffbea2^ → Task 3).** The
  owner's question for every page: does it read as the org's own site?
  - **Before** was measured on the pre-3a sources swapped back in. The swap was calibrated:
    1,064 of Task 1's readings were re-measured and the only 2 that differed were on explore's
    own heading pick. **After** is the final tree.
  - **Results:**
    - colour: X35's 27 of 32 → 0, unchanged since Task 2 (studio-alpha and studio-beta: 255
      of 256 readings identical between Task 2 and Task 3, the other on explore);
    - labels: 0 of 14 sales-page rows in explore's label case → 14 of 14 (X43);
    - corners: X44;
    - the bar: 0 of 6 bars in the org's card → 6 of 6, light and dark. On of-blood-and-bones it
      went from a dark contrast band (#23100c with #f74518 and a black label) to the org's card
      #fffffd holding its #a62b0c button (X42).
  - **Captures:** before | after | explore at 1440 light, one per org, shown to the owner on
    2026-10-09.
  - **Measured on the seeded brands.** During the first after run the owner was trying other
    brands on of-blood-and-bones in the brand editor (#8B5CF6, then #FF0000 on #FDF3ED). Those
    6 rows were re-measured once the seed was restored. The other 14 were identical between
    the two runs.
- **X47 · 2026-10-10 · p3a · The soft band keeps the ground's warmth (D14; amends X35).** The
  owner's decision, verbatim: "Warm step of the parchment (Recommended)". Shown the band as
  built (the org's secondary surface), the parchment a step darker keeping its warmth, the
  peach tint from before phase 3a, and no band (`scratchpad/3a/t3-options/`). D13, label
  tracking, was "Narrow, 0.05em (Recommended)", as built (X43).
  - **The rule.** On an org's background (`[data-org-bg]` above the page, or on it), the soft
    surface is `oklch(from var(--_org-ground) calc(l + var(--_soft-step)) c h)`: the ground,
    a step toward its ink, with its chroma and hue. The step is the one `org-brand.css` takes
    for its secondary surface, chosen by the POLE, not the theme: −0.03 on the light pole,
    +0.04 on the dark. So an org whose ground stays light in dark mode steps darker in both
    themes. Before, in dark mode it drew the dark theme's secondary surface, a step LIGHTER
    than its parchment.
  - **The platform.** On the platform's neutral ground there is no chroma to keep, so the soft
    band stays `--color-surface-secondary` (#f5f5f5 on #fafafa; #404040 held in the dark
    band). That includes a page whose own background is handed back (X39) to an org with
    none. The scoped previews' platform copies are unchanged; their four background copies
    take the rule.
  - **Everything that reads the soft surface follows.** That means soft sections, and any
    element a block gives the `soft` scheme. On the live pages those are Studio's tabs card,
    the featured offer, a bento tile and a before/after column. By code they can also be the
    lead testimonial, a CTA panel and a marked picture. A Style's tint mixes into the new
    surface, and Cinematic's room keeps its own band.
  - **The floors.** `--_org-soft-bg` still holds the surface inside the ground's band in each
    pole, so every ink and button proven there holds. Where the step lands outside the band,
    the band's edge takes it and its chroma cap applies, as before.
  - **Measured on of-blood-and-bones** (#f3f0e7, oklch 0.955 0.0124 91.3), on its 16 soft
    surfaces across 3 live pages:
    - light: #e7e6e2 (oklch 0.925 0.0062) → #e9e6dd (oklch 0.925 0.0124);
    - dark: #fffdf9 (oklch 0.995 0.0062) → #e9e6dd, the same as light;
    - drawn as Clean (5% tint): #e6ddd7 → #e7ddd3; as Soft (16%): #f0d8cf → #f1d8cb.
  - **The studios** are unchanged. studio-alpha's Tending the Grief captures are pixel-identical
    before and after, as is, and with its benefits section drawn soft. studio-beta's Cinematic
    band is #151f33 before and after.
  - **Tests:** spec "of-blood-and-bones/ancestral-threads {light, dark}: the soft band is the
    org's ground a step darker, its warmth kept". It computes the expected colour from the
    measured ground, and holds every soft surface to it within 1/255 and to the ground's
    chroma within 0.002. Spec "studio-alpha/tending-the-grief light: on the platform's neutral
    ground the soft band is the platform's own, unchanged". schemes.test "the soft band keeps
    the ground's warmth (owner, D14)" covers the CSS text and both poles. For every org ground
    in the matrix, the seeded grounds, the bar's grounds and a 216-colour sweep of the cube, it
    checks that the ground's chroma is kept and that, at every Style's tint, the drawn band is
    no nearer its ink than the band's worst surface. It also covers the platform's own surface
    and the same band in either theme.
- **X48 · 2026-10-10 · p3a · The org's real ground: the pole from its lightness, the bands
  widened, and a soft band that always stands apart (Codex-61zsk.42; amends X35 and X47).**
  The owner's decisions, verbatim: "Fix it next (Recommended)", under D1's "Follow the org
  (Recommended)", and for the brands to judge it on, "Sample brands for reviews
  (Recommended)" (D15: `docs/handover/phase3-sources/review-brands/`). On the review brands
  the kit drew night's forest ground (#15211C, L 0.235) at L 0.900, pale mint, in both themes,
  and sand (#E9D8B4, L 0.887) at 0.900, where D14's soft band equalled the ground.
  - **The pole.** A ground with luminance Y > 0.1791 is the light pole; at or below it, the
    dark pole. 0.1791 is where black and white ink cross: white on Y and black on Y are equal at
    √(1.05 × 0.05) − 0.05 (4.58:1 each), and the kit's inks already switch there (`--_w`). A
    mid-tone ground could be either; the ink that holds more contrast on it decides. CSS cannot
    read a colour's lightness, so `model/resolve.ts` (`groundBand`, `resolveGroundBands`)
    resolves each theme's ground, PageRenderer names it on the root, and `schemes.css` selects
    on `data-ground-light^='d'` (a dark pole in the light theme) and `data-ground-dark^='l'` (a
    light pole in the dark theme). The dark theme's ground is the org's dark twin, else its
    light background (as `org-brand.css` paints it); a page's own background decides its own
    theme only (D7). No background is the platform's: no band, and the theme's pole.
  - **The bands.** A ground is drawn in the narrowest band of its pole that holds its OKLCH
    lightness, else on the pole's last band, where it moves to the edge:

    | band | edge | text | large | decorated text | decorated large | keep white |
    |---|---|---|---|---|---|---|
    | l90 | L ≥ 0.90 | Y ≤ .114 | .196 | .086 | .155 | on |
    | l85 | 0.85 | .086 | .155 | .064 | .121 | on |
    | l80 | 0.80 | .062 | .118 | .044 | .091 | on |
    | l75 | 0.75 | .041 | .086 | .026 | .065 | on |
    | l70 | 0.70 | .022 | .058 | .011 | .042 | on |
    | l65 | 0.65 | .009 | .039 | .0009 | .026 | on |
    | d24 | L ≤ 0.24 | Y ≥ .25 | .15 | .33 | .203 | on |
    | d30 | 0.30 | .316 | .194 | .417 | .261 | off |
    | d36 | 0.36 | .414 | .26 | .535 | .34 | off |
    | d42 | 0.42 | .552 | .352 | .69 | .443 | off |
    | d48 | 0.48 | .737 | .475 | .885 | .574 | off |

    l90 and d24 are the bands the kit always had. Each grade is the org's move (X35) at 2% past
    what the band's worst surface needs, over the whole sRGB cube and the band's edge ring,
    plain and under the decorations that ship, rounded toward the ink by less than 0.001.
    **The limits:** l65 is the last light step at which decorated text still reaches 4.5:1
    with that margin (an edge of 0.64 cannot, even with black ink), and d48 the last dark step
    (0.54 cannot, even with white). A light-pole ground with L < 0.65 or a dark-pole ground with
    L > 0.48 moves to that edge. In a 5,832-colour sample of the cube that is 1,841 colours,
    the saturated mid-tones between L 0.48 and 0.65; none of the review brands or seeds is one.
    **Keep white (D8)** is on only where white holds the band's large grade (Y ≤ .181): off from
    d30, where the grade lifts a button to Y ≥ .194 and its label is black (≥ 4.88:1).
  - **The soft band (amends X47).** It is the ground as its band draws it (`--lp-ground`), a
    step toward its ink with its chroma (−0.03 light pole, +0.04 dark). Where that step would
    leave the band, the kit takes it the other way (`--_band-side`), rather than holding a
    clamp that would collapse it onto the ground: the step keeps its whole size either way.
    **The minimum:** 0.03 OKLCH lightness on an org's background (0.04 on the dark pole), and
    0.014 on the platform's own ground, whose secondary surface is the platform theme's (0.0150
    on #fafafa). schemes.test and the e2e both check these numbers; the e2e allows 0.001 for 8-bit
    paint. A Style's tint still mixes into the band and the band still holds it.
  - **The moving background (§5.1)** is sized for the worst backdrops of l90 and d24 only, so
    on a page whose ground is in any other band PageRenderer draws an `atmosphere` section as
    `base` (`atmosphereProven`).
  - **Measured, before → after** (OKLCH L of the org's `--color-background` | the kit's ground |
    its soft band, of-blood-and-bones' sales page carrying each review brand through the brand
    API, 1440, `scratchpad/3a/t42-brands-{before,after}.log`):
    - night, both themes: 0.235 | 0.900 | 0.900 → 0.235 | 0.235 | 0.195 (d24 in both);
    - sand, both themes: 0.887 | 0.900 | 0.900 → 0.887 | 0.887 | 0.857 (l85 in both);
    - lilac: light 0.957 | 0.957 | 0.927 and dark 0.200 | 0.200 | 0.160 (l90, d24), unchanged
      apart from the dark soft band, which now steps darker (0.2001 + 0.04 would leave d24);
    - red (the platform's ground): unchanged, 0.985 | 0.985 | 0.970 light and 0.205 | 0.205 |
      0.240 dark.
    No review brand's ground moved. The seeds (of-blood-and-bones on l90 in both themes;
    studio-alpha and studio-beta with no band) are pixel-identical before and after: 5 seeded
    pages × 2 themes, full page.
  - **Tests.** Spec `brand-fidelity.spec.ts` "review brand {night, sand, lilac, red, plain}
    {light, dark}": the kit's ground equals the org's `--color-background` and its ink the
    org's `--color-text` on the same page (measured both, within 1/255), its ink holds 4.5:1,
    and every soft surface stands the minimum apart. The ink is what proves the pole: on the
    wrong pole night's ground still lands within 1/255 and its moved ink still holds 4.5:1
    (calibrated: with the light theme's dark-pole selectors broken, the spec first passed all
    10, so the ink check was added; now exactly night light fails, and schemes.test's routing
    test, 1 of 94). It puts each brand on a page carrier (no DB write) and names the carrier's
    bands with `resolveGroundBands`, as PageRenderer does; the org-ground path is the one the
    seeds and the API-applied captures exercise. Six failed before (night's ground light and
    its soft band dark, sand's ground in both themes, and red and plain light at the platform's
    0.015 step against a 0.03 minimum, which set the platform's own figure). schemes.test §16
    "the org's real ground": the pole at the ink crossover over a 5,832-colour sample; the
    narrowest band; every band's grades on its worst surface for any org colour, at 2% and no
    further; the limits; keep white; every band rule in the CSS; the flip and its minimum; and
    the review brands and seeds in both themes, at every Style's tint, plain and decorated, with
    every floor. `resolve.test.ts` covers `groundBand`, `resolveGroundBands` and
    `atmosphereProven`; `PageRenderer.svelte.test.ts` covers the root's band attributes and an
    atmosphere section drawn as base on l85.

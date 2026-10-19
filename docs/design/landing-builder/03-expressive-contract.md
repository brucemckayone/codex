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
| transformation | `toggle` | Before and after: two tabs on a phone, opening on the after; side by side wider (X55) |
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
- **Before and after** (`transformation` `toggle`). On a phone-width section, the WAI-ARIA tabs pattern
  (arrow keys, `aria-selected`, `tabpanel`), opening on the after side; wider, and without JS, both
  lists render side by side, as `columns` does (X55).
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
  (curriculum, preview, instructor, stats, video). *Amended by X55: the tabs only on a phone-width
  section, opening on the after side; wider it stays the columns.*
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
- **X49 · 2026-10-10 · p3a · D12 on the org's side: its borders step away from its ground
  (Codex-j4ioe).** The owner's decision, verbatim: "Fix it on the org's site (Recommended)".
  `org-brand.css`'s `[data-org-bg]` rules stepped the four border levels (subtle .06, border
  .12, hover .15, strong .18) by THEME: darker in light mode, lighter in dark. A ground on the
  other side lost them. of-blood-and-bones' parchment (L 0.955) stays light in dark mode, so
  every level clamped to L 1.000 (#fffffc, about 1.1:1). The mirror case is night (L 0.235) in
  light mode, where every level went darker into black (0.175 to 0.055). Sand in dark mode
  clamped the same way as the parchment.
  - **The rule.** Each level is `oklch(from <background> calc(l + <step> * var(--_bg-away))
    …)`. `--_bg-away` is −1 on a light ground and +1 on a dark one, in both rules. The side is
    the ground's luminance at Y 0.1791, the kit's pole crossover (X48). **The mapping:**
    relative colour gives l, c and h, not luminance, so `org-brand.css` rebuilds it exactly:
    a = c·cos h and b = c·sin h; OKLab's three LMS′ rows, each cubed, give linear LMS; and Y
    is one row of LMS → linear sRGB → Y (−0.040774541, 1.112492185, −0.071717644). No single
    lightness would serve, because a grey crosses at L 0.5637 and a saturated colour does not.
    The helpers are functions of the channel keywords, so they hold for whichever background
    a border is derived from. The kit's four scoped previews of `--_org-line` take the same
    expression.
  - **Measured on explore** (OKLCH L of the background → subtle, border, hover, strong):
    - seed dark: 0.955 → 1.000 ×4, now 0.895, 0.835, 0.805, 0.775;
    - night light: 0.235 → 0.175, 0.115, 0.085, 0.055, now 0.295, 0.355, 0.385, 0.415;
    - sand dark: 0.887 → 0.947, 1.000 ×3, now 0.827, 0.767, 0.737, 0.707;
    - unchanged: seed light, night dark, sand light, lilac in both themes, and red and plain
      (no background).
    Of the seeded pages (5 sales pages and 3 explore pages × 2 themes, full length), only
    of-blood-and-bones in dark mode changes: 4 pages, 7,472 to 31,024 pixels each. The rest are
    pixel-identical, except studio-alpha's explore page (its animated hero) and Tending the
    Grief in light mode, which differ by up to 3 levels between any two runs. That org has no
    `[data-org-bg]`.
  - **Tests.** In spec `brand-fidelity.spec.ts`, "D12 {of-blood-and-bones dark, night light}"
    (red first: 2 failed and their 2 controls passed). It reads the org's background and all
    four levels on the page, and checks each level steps away by its whole step, to within
    0.005. In schemes.test §17, three tests: the helpers' text, evaluated as the browser does,
    equal the luminance and the kit's pole over a 5,832-colour sample; every level in both
    rules carries the side, and no fixed step remains; and every level stands its whole step
    from any ground in either theme. §10's model of `org-brand.css` takes the same rule
    (`ORG_BORDERS`, `awayFrom`).
- **X50 · 2026-10-10 · p3a · B2: the org's moving background is on by default (D4,
  Codex-61zsk.35).** The owner's decision, verbatim: "On by default (Recommended)". When an org
  has a shader preset other than 'none', every Style's hero and closing ask (`cta`) open and
  close on it.
  - **The rule.** `resolveScheme(type, design, style, { orgShader })`: a scheme the page set
    wins; otherwise, with the org's shader on, `hero` and `cta` are `atmosphere`
    (`SHADER_SECTIONS`); otherwise the Style's default. Cinematic already drew both as
    atmosphere and is unchanged. With no shader, nothing moves. **Amended by X51:** the
    closing ask is no longer defaulted (D16); only the hero is.
  - **Plain data.** `orgShader(org, pending)` sits in `$lib/page-builder/org-grounds.ts` beside
    `orgGrounds`. It reads the brand editor's pending overrides while the editor is open, and
    otherwise the saved `brandFineTune.tokenOverrides` (unreadable JSON counts as no shader).
    This is the org layout's own `hasShaderPreset` rule, the one that sets
    `data-hero-shader-active`. PageRenderer takes it as the `orgShader` prop. The journey page,
    the studio page-kit, Canvas and MiniPreview pass it. The kit reads no store.
  - **Every band.** A band's veil is the thinnest that holds every floor over pure black and
    pure white (§5.1) for that band's grounds. The cases are the band's worst surface, 216
    cube grounds drawn in the band × 14 brands, and 4,096 brands on the worst surface.
    - Measured light: l90 .82, l85 .89, l80 .98, l75, l70 and l65 1.
    - Measured dark: d24 .86, d30 .92, d36, d42 and d48 1.
    - Each band rule carries `--_g{l,d}-veil`, and the veil is
      `max(--_atmos-min, --_band-veil, --lp-atmosphere-scrim)`. Cinematic's room sets
      `--_band-veil: 0`, because its room is the first dark band in every theme.
    - A veil of 1 shows no shader. Atmosphere is drawn only where a band lets through at least
      half of what its pole's first band does: l90 18% and l85 11%; d24 14% and d30 8%
      (`ATMOSPHERE_BANDS`). l80 lets through 2%, and every other band is opaque, so those draw
      `base` (PageRenderer).
  - **The tint (X33) for Bold, Path and Studio.** Over a dark shader, their plain veil reads
    as a grey band. They take the tint, as Clean, Quiet and Soft do, but only under
    `.org-layout[data-hero-shader-active]`.
    - Why only there: a page that set a Moving background itself, with no shader, must not
      change. Of Blood & Bones' Tending the Grief is a Path page with an atmosphere instructor
      section.
    - The org layout carries the flag in the studio too, so the canvas shows what the page
      will.
    - Why the first band's proof covers the second: the panel ground clamps itself into the
      first band from any ground (light [0.9, 0.965]; dark capped at 0.24). The tint's proof
      therefore covers l85 and d30 grounds at the first band's veil, the thinnest any band
      draws.
  - **One canvas.** The shader is the org layout's. The kit adds none: every page measured has
    exactly 1 `canvas`.
  - **Measured, before → after** (1440, reduced motion, so the shader is one still frame):
    - studio-alpha ('glow', Quiet, no band): hero and closing ask go from base to atmosphere,
      at 0.82 light and 0.86 dark.
    - night ('nebula', d24 in both themes) on Of Blood & Bones' Studio page: base and brand
      become atmosphere at 0.86.
    - sand ('silk', l85): atmosphere at 0.89.
    - lilac ('aurora', l90 light, d24 dark): 0.82 and 0.86.
    - Pixel-identical, full length: Of Blood & Bones' 4 sales pages and studio-beta's, in both
      themes (10 captures), and red and plain applied to Of Blood & Bones (Ancestral Threads
      and Tending the Grief × 2 themes, 8 captures). One first capture caught the pricing
      before its offers loaded. Re-shot twice in each state, all were identical.
  - **Tests.**
    - `resolve.test.ts`: the default with and without an org shader, for every Style; an
      explicit scheme wins; `ATMOSPHERE_BANDS` (l85 and d30 in, l80 and d36 out). Red: 2
      failed.
    - `org-grounds.test.ts`: the saved preset, and the editor's pending one.
    - schemes.test §18: the measured veils equal the CSS and the first bands equal §5.1's;
      exactly l90, l85, d24 and d30 are drawn, in both themes; 0.01 thinner fails; the glow
      holds; and the CSS text.
    - `atmosphere-tint.test.ts`:
      - the opt-in set, with Bold, Path and Studio gated on the shader (red against the
        ungated form: 1 failed);
      - the tint's floors on the l85 and d30 grounds;
      - teeth: there the plain veil fails at the first band's strength.
    - `PageRenderer.svelte.test.ts`: atmosphere drawn as base on l80.
    - Spec `org-shader.spec.ts`: studio-alpha in light and dark has its hero and every closing
      ask in atmosphere, one canvas, a veil inside (0.5, 1), and ink, soft ink and accent at
      4.5:1 and the button at 3:1 over black and white. Of Blood & Bones has no atmosphere and
      no flag. Red: studio-alpha's hero was base, 2 of 4 failed.
  - **Not done.**
    - SectionInspector still resolves a section's scheme without `orgShader`, so its picker
      shows the Style's default for the hero and closing ask. It is outside this change.
    - Atmosphere draws the kit's inks; the org's inks are drawn on base and soft only. So
      studio-alpha's red headings are ink on its hero and closing ask.
    - In a still frame, sand's hero reads greyer than its ground: silk shows through at 11%.
- **X51 · 2026-10-10 · p3a · B2 narrowed: the opening only, and the org's heading colour on
  the veil (D16, D17; amends X50).** The owner's decisions, verbatim: D16 "Opening only
  (Recommended)", and D17 "Keep the org's colour (Recommended)". The owner saw the B2 stills
  and gave two reasons:
  - on night, sand and lilac the closing ask had lost its band in the org's colour;
  - on the veil the org's heading colour gave way to the kit's ink.
  - **D16, the rule.** With an org shader, only the hero defaults to `atmosphere`:
    `SHADER_SECTIONS` is `hero` alone. The closing ask keeps its Style's own default
    (brand, accent, or whatever the Style designs). A scheme the page set still wins, so a
    creator can still put the closing ask on the moving background. Cinematic is unchanged:
    its Style draws both.
  - **D17, the rule.** On an atmosphere section, a heading draws the org's heading colour
    (`--_org-heading`), moved along its own path only as far as its floor needs. The floor is
    measured over the section's worst backdrop: the veil at the band's strength over pure
    black or over pure white.
    - The grades match the org's surfaces: a title at the text grade (4.5:1, `--_g-aot`), and
      a display or section heading at the large grade (3:1, `--_g-aol`). Each is 2% past what
      the worst veiled backdrop of the band needs, rounded toward the ink.
    - Per drawn band (luminance; light caps it, dark floors it):
      - l90: text .059, large .113;
      - l85: .057 / .111;
      - d24: .408 / .255;
      - d30: .41 / .257.
    - The grades sit in each drawn band's rule, with the first band's as the fallback. They
      are routed to the ground's pole as `--_aot-*` / `--_aol-*`, generated like the other
      moves. A colour that holds is drawn exactly. A failing one deepens or lightens along its
      own hue, never to black.
    - Scope: headings and titles only. The ink, accent, mark and button keep atmosphere's own
      moves.
    - Not Cinematic, whose room keeps the kit's inks.
    - It is on the exact path only. Without it, the heading stays the kit's ink.
    - A moving background is never decorated, so the decorated re-routing (`--_odt-*` /
      `--_odl-*`) never reaches it.
    - A Style's tinted ground (X33) is clamped into the first band, so it is never nearer the
      ink than the band's own ground.
  - **Measured on studio-alpha** ('glow', Quiet), 1440, still frame (reduced motion):
    - Light hero heading: the org's #e11d48 (OKLCH L .586, C .222, h 17.6) is now drawn as
      #ba163a (L .508, C .193, h 17.6). Over the .82 veil on its ground #fce0e0 it holds
      3.43–5.40:1 over black and white. Raw, it was 2.51–3.95:1; under B2 it was the kit's
      #000000.
    - Dark hero heading: #ff4c64 holds as it is: 3.36–5.35:1 on the .86 veil over #2e1819.
      Under B2 it was #ffffff.
    - Both closing asks are back to their pre-B2 band (Quiet's `base`, the org's crimson
      heading). They are pixel-identical to the pre-B2 captures in light and dark.
    - The owner's B2 figures for the closing ask, from the band's left edge (OKLCH C): night
      gold #caa750 C .113 went to olive #292d1b C .031; sand ink blue #1d375b C .072 went to
      #d0c9b5 C .028; lilac purple #8e61f7 C .214 went to #c9c2dc C .037. D16 gives those
      bands back. Re-shot on of-blood-and-bones' Studio page (Ancestral Threads), all six
      closing asks (night, sand and lilac in both themes) are Studio's `brand` again, and
      pixel-identical to their pre-B2 captures.
  - **Tests.**
    - `resolve.test.ts`: only the hero's default moves, in every Style; an explicit scheme
      wins, `atmosphere` on a closing ask included; a whole page resolves with the closing
      ask at Quiet's own. Red: 2 failed of 40.
    - `schemes.test.ts` §19, red at 4 of 4:
      - each drawn band's grades are 2% past its worst veiled backdrop (over that band's
        `atmosphereBandCases` grounds), and no further;
      - the 14 brands plus a 216-colour sweep, floored, hold 4.5:1 and 3:1 over the worst of
        both veiled backdrops and the glow where no shader runs;
      - a colour that already holds is unchanged, and the crimson deepens on its own hue;
      - the shipped text: band rules, fallbacks, pole routing, and the rule's place inside the
        exact path.
    - The parity generator and §16's band-rule text carry the new fragments and grades.
    - Spec `org-shader.spec.ts`, red at 2 of 4 (studio-alpha in both themes):
      - the hero is atmosphere and every closing ask is its Style's default;
      - each hero heading is not the kit's ink, is within 4° of the org's heading hue, and
        holds its grade over both veiled backdrops.
- **X52 · 2026-10-11 · 3b round 1 · The veil under the words only (`--lp-atmosphere-veil:
  words`), and Studio's moving background drawn sharp.** REJECTED by the owner the same day, on
  the before/after pictures: *"your way of showing the shader is terrrrrrrible it should be more
  like a blur or popacity over the full thing just less"*. Reverted before it left the branch;
  X53 replaces it. Kept for the record. The owner's note on the live page: *"cant really see it moving or
  anything alittle too much blur"*. Two causes, both on the page: the inner pages' 60px
  `--blur-2xl` (only `data-lp-atmosphere='sharp'` lifts it), and the 0.82 / 0.86 veil over the
  whole opening, which left about a fifth of the shader.
  - **The rule.** A third value of X9's axis. A block marks the box that holds its words
    (`data-lp-words`): the hero's copy in the statement, split, centred and cover layouts, and
    the closing ask's words. On an atmosphere section, that box paints the section's own veil
    (`rgb(from var(--lp-bg) r g b / var(--_atmos-s))`: the plain ground, or X33's tint), and a
    `box-shadow` in the same colour carries it past the box: spread 3σ, blur 2σ, with
    σ = `clamp(--space-3, 1.4cqi, --space-6)`. Where the shader runs, the section itself is
    cleared, by the same `:has()` that finds the box.
  - **Why the proof is unchanged.** An outer shadow is never drawn inside its box, so every
    word sits on the veil at exactly `--_atmos-s`, the strength §5.1 proves over pure black and
    pure white. The spread puts the shadow at Φ(3) = 0.9987 of the veil at the box's edge
    (inside one 8-bit step), so no seam shows.
  - **Limits.** The poster's words share its grid with the picture and have no box of their
    own, so a poster hero keeps the section veil; any section with no marked box does. Without
    a shader the box is drawn over the glow too, as X10's panel is, so the canvas shows the
    composition.
  - **Studio** takes it: `--lp-atmosphere-veil: words` and `atmosphere: 'sharp'`. The other
    six Styles that blur are unchanged until round 5 spreads what works.
  - **Seen** (1440, still): of-blood-and-bones' Ancestral Threads (statement hero, its 'flow'
    shader) in light and dark, and studio-alpha's 'glow' drawn as Studio. Pictures:
    `docs/handover/phase3-sources/round1/`.
  - **Open:** on a centred or statement hero the box is the content column's width, so the
    patch is nearly a panel; a patch hugging the lines is the alternative.
- **X53 · 2026-10-11 · 3b round 1 · Studio's moving background: the veil over every band
  again, a third of the blur, and 1.6 times as much of the shader through (replaces X52).**
  BUILT on `feat/landing-builder-phase3b`; the owner chose it from before / A / B pictures.
  - **The blur.** `atmosphere: 'hazy'`, a third value beside `soft` and `sharp`. The org
    layout blurs the shader by `--blur-xl` (20px) instead of `--blur-2xl` (60px), and the
    canvas runs twice that radius past each edge, as `soft` does. Cutting the blur alone (A)
    sharpened the shapes and showed them moving, but let no more of the shader through.
  - **The veil.** `--lp-atmosphere-show` (>= 1, default 1) lets that many times as much of the
    shader through as the proven veil: `s = 1 − show · (1 − max(floor, band veil, scrim))`.
    Studio sets 1.6: 0.71 (light) / 0.78 (dark) where the floors are 0.82 / 0.86. It scales
    with each band's own floor, so a band that needs a solid veil (1) keeps it. Studio only,
    and only where the org's shader runs; without one the section is the glow on its ground,
    unchanged.
  - **Why it holds: measured, not proven.** §5.1's veil is proven over pure black and pure
    white, so any shader. This one is not. It is measured over of-blood-and-bones' 'flow'
    shader (1440 @2x, 20px blur, words hidden, three frames six seconds apart, composited in
    sRGB as the browser does, and checked against a veiled frame to within 1.2/255 in dark).
    Every line of the opening held its floor (4.5:1 for text under 24px, 3:1 for the title
    and the button against its surround) down to 0.65 in light (bound by the note under the
    button) and 0.75 in dark (bound by the lede). `schemes.test.ts` holds the multiple there:
    only Studio sets it, and never past those two measured veils. **Wrong, and replaced by
    X54:** that was measured with the words AT REST. The shader is fixed while they scroll, so
    each line passes over the darker top of the window, where 'flow' light needs 0.76; two of
    the opening's 4.5:1 lines fell to 4.38 and 4.24 at 300px. And on a second shader,
    studio-alpha's 'glow', the fixed 0.71 left the title at 2.61:1 and the facts at 3.65:1.
  - **The risk** that a darker (light) or brighter (dark) shader than 'flow' falls under a
    floor was real (above). X54 closes it: no fixed multiple holds, so the page measures.
  - **Seen** (1440, still and live): Ancestral Threads, light and dark. Pictures:
    `docs/handover/phase3-sources/round1/` (section 0).
- **X54 · 2026-10-11 · 3b round 1 · The live veil: as thin as Studio asks wherever the shader
  behind each ink allows (replaces X53's fixed multiple; BUILT, decided without the owner).**
  The owner chose X53's look (B: the whole band, a 20px blur, 1.6 times the shader) and asked
  for no further input; the goal said to lower `--lp-atmosphere-show` until both shaders hold.
  None does at the look the owner chose ('glow' light needs 0.817 where B gives 0.712), so
  instead of a lower multiple everywhere, the veil is measured where it is drawn and the
  approved look stays wherever it holds.
  - **The rule.** `--lp-atmosphere-show` now names the thinnest the veil may go
    (`--_atmos-thin`); the proven veil (`--_atmos-floor`, §5.1, with the band's and the
    scrim) is the thickest. The section draws `max(thin, --_atmos-need)`, and with no
    `--_atmos-need` the floor. Both ends are registered numbers (`@property`, initial 1), so
    the page reads what CSS computed, and a browser that cannot read them never thins.
  - **The measurement.** The org layout's fullpage shader (`ShaderHero tone`) samples, about
    twice a second and only while a page asks, the part of its frame the window shows: drawn
    at 4 × 4 per cell and averaged to a 48 × 30 grid, keeping each cell's darkest and lightest
    colour per channel since the shader, its colours or its size last changed
    (`shaderTone`). It reports its CSS blur, and whether its frame is still. A moving shader
    is watched for eight frames (about four seconds) before anything thins: one frame of
    'flow' had thinned the veil to 0.712 where the frames after it needed 0.727. A still
    shader (reduced motion, the studio) draws one frame, so one is all of it, and it draws its
    same moment again for a page that starts asking.
  - **The veil.** The kit's root (`atmosphere-veil.ts`) finds every ink drawn straight on an
    atmosphere section's veil (nothing filled between): each element's words, at 4.5:1 or
    3:1 for large text, hidden ones too, as they may be shown, but not words on their own
    fill; a control's fill, borders and drawn lines (an opaque box-shadow), an SVG's strokes
    and fills, and a Style's marks (pseudo-elements, X24) over their host and half an em round
    it, all at 3:1. Colours are read by drawing them, never parsed. Each ink is held over the
    cells under its own box grown by twice the shader's blur, which mixes in what lies that
    far off (`liveVeil`: the composite in sRGB, its darkest and lightest ends, an ink inside
    that run counted as failing), and the section takes the thinnest veil at which all of
    them hold, 2% past. Again on each report, scroll (the window's or any scroller's), change
    of a section's size and `<details>` toggling. A section with no ink on the window keeps
    its veil. Whatever it cannot measure keeps the proven veil: an ink it cannot read or that
    is not opaque, one on a translucent fill, a mark drawn with an image. It eases in as it
    thins (`data-lp-veil-easing`, `--duration-slowest`) and thickens at once.
  - **Measured** over the composite actually drawn (words hidden, p0.1, each ink against its
    own pixels), before the review's changes made it thicker still: 'glow' light 12 of 12 hold
    at 0.817 (9 fail at X53's 0.712); 'glow' dark 12 of 12 at 0.776, Studio's own; 'flow' light
    at rest 11 of 11 at 0.712, scrolled 300px 8 of 8 at 0.767 (2 fail at 0.712); 'flow' light at
    phone width 11 of 11 at 0.712. As built: 'flow' light holds the proven veil for four
    seconds, eases to 0.737 and holds it (0.025 over the owner's look); 0.762 at 150px and
    0.792 at 300px; 'flow' dark 0.776 at 300px; 'glow' light 0.817 and dark 0.776.
    `e2e/page-kit/live-veil.spec.ts` measures it on CI ('glow', both themes), and fails a
    runtime that measures but writes Studio's veil.
  - **Cost.** Nothing on a page whose Styles do not thin (the other seven): no section asks,
    so the shader samples nothing. On Studio, a 192 × 120 readback twice a second, and on
    each scroll frame the boxes of the inks on the window (a line on the same cells reuses its
    last answer); a count rolling up is measured as it rolls and the page read again once it
    stops.
  - **Open:** a moving shader starts again on a resize and on a theme change (its colours
    change), so it holds the proven veil for four seconds after either, which includes a
    phone whose window grows as its address bar hides. The veil changes as the opening
    scrolls, in steps of 0.005, thickening at once. Only Chromium has been measured.

- **X55 · 2026-10-11 · 3b round 2 · The payoff first: the change side by side with its after lines
  loudest, the switch on phones only; a benefit's name at a middle size (BUILT, decided without the
  owner; amends X8).** The reference plan (`phase3-sources/ref-plan`, sections 3 and 4): "the payoff
  hides behind a toggle that opens on the before", and "the benefits [are] at body size, under
  headings three to six times their size".
  - **The toggle** is the columns wherever they sit side by side, and the switch only where they
    would stack: phone width is the columns' own breakpoint, read from the stylesheet (`--_phone`, set
    under the complement of the columns' `@container (min-width: 44rem)`) on a ResizeObserver over
    the section, so a resize either way swaps it, and the number lives in one place. On a phone it
    opens on the after side, the tabs still in reading order (where you are, where you will be). X8's
    rule holds: the first swap waits until the section is ahead of the visitor. Not re-decided: the
    canvas's editable side titles, which the tabs do not offer, now show on a wide canvas.
  - **The after lines** in `columns` take the display face at title size, as the toggle's panel
    already did, over the before side's body lines in the soft ink, so the payoff is the loudest
    thing after the heading. Measured in all eight Styles (gallery, 1440): after 24–32px, before
    19.6–20.8px, every row still level across the two sides.
  - **A benefit's name** in the `grid` sits two fifths of the way from the Style's title size to its
    heading's (a fifth when four sit to a row), through a Heading hook, `--lp-title-lift` (0 the
    title, 1 the heading), like `--lp-display-scale`. A new size value was rejected: the builds
    (`motion.css`) key on `[data-size='title']`, and a new value would have silently dropped every
    Style's entrance from the names. The name keeps the title's ink, the text grade, since at a
    0.9 text scale it falls under large-text size. Ancestral Threads: 26.3px to 39.5px under a
    59.4px heading, at most two lines; a phone, 25.1px under 32.2px. The gallery's four 16–18
    character names stay within two lines in every Style (Bold 43px, Quiet 27.5px).
  - **Not built:** the plan's optional mark beside each benefit (it needs a field on the item, the
    editor's work in 3c); the split and checklist layouts keep their sizes (split's rows are
    already title size; the checklist is compact by design).
  - **Tests:** the toggle's unit tests at phone width and wide and across a resize, a source pin
    tying `--_phone` to the columns' breakpoint, and `e2e/page-kit/type-rank.spec.ts` measuring the
    after lines against the before and each name against the Style's two sizes resolved where it
    sits. The seed pins Ancestral Threads' benefits `grid`, a test subject now.
  - **From the review:** the swap waits a frame after the ResizeObserver reports (made inside its
    delivery it resized the observed section, a reported loop on every rotation); a visitor focused
    on a tab when the tabs give way keeps their place on that side's column; Soft centres its head
    over a toggle drawn as the columns, as over the columns (source-pinned only: the local stack had
    stopped, so it was not looked at); source pins for the four-across lift and Soft's resets.
- **X56 · 2026-10-12 · 3b round 4, first part · The page never contradicts its own offers: one
  featured path everywhere it sells, seeded words that name no payment model, and every seeded
  FAQ titled (BUILT, decided without the owner; Codex-61zsk.39).** The reference plan
  (`phase3-sources/ref-plan`, sections 7–9): the words under Join's heading "never say 'one
  payment' over a monthly price", the questions "start with no title", and the closing ask's
  small print reads "One payment, no deadline" next to £15 a month.
  - **One featured path.** The call to action priced from the platform's recommendation
    (`pricingView(context, {})`), because a block sees only its own props, so a creator who
    recommended another path (`offers[].best` on the pricing section) saw the pricing section and
    the floating bar feature it, and the call to action feature a different one. The kit page
    context now carries the page's offer choices (`offerProps`, the pricing section's props, which
    `PageRenderer` already read for the bar), and the call to action prices from them. The hero's
    facts line keeps `{}` on purpose: it shows the lowest price, and the props only decorate and
    recommend; they never add or remove a path.
  - **Seeded words.** Ancestral Threads and Return to the Shoreline described a one-off ("A
    one-off payment…", "One payment, yours to repeat.") while their pages can recommend the org's
    membership. A seeded page cannot know which ways in a database will offer (a one-off in CI;
    the owner's database adds the membership through tier access the seed never resets), so the
    words now name no payment model and stay true for every way in: "Every way in opens the whole
    lineage practice…", "No deadline to finish." The small print under a price was already the
    path's own billing line (Codex-61zsk.38); a section's words are the creator's.
  - **Every seeded FAQ titled.** All four seeded FAQs had no heading, and the kit adds no fallback
    heading (only the hero's headline falls back), so the questions began untitled. The seed's
    copy type now requires one, so a new portal cannot ship without it.
  - **Not in this part:** the large gaps under the pricing cards and above the questions, which
    needed the page in a browser (the local dev stack was down); X58 is that part. The seed change
    reaches a database only through a re-seed, which is the owner's to run.
  - **Tests:** `PageRenderer.svelte.test.ts` authors `best` on the one-off, where the platform would
    recommend the cheapest tier, and requires the call to action's price and deep link, the pricing
    section's link and the floating bar's price to name the same path (two plants: the call to
    action back on `{}`, and the context handing out nothing, each fail with `'£15'` for `'£49'`).
    Removing a seeded FAQ heading fails the seed's own type check.
- **X57 · 2026-10-12 · 3b round 3 · Each stage one row with its practices' kind and length, the
  stages folding on a phone; the guide signs off with a round portrait (BUILT, decided without the
  owner; Codex-61zsk.46).** The reference plan (`phase3-sources/ref-plan`, sections 5 and 6): "each
  stage and its practices read as one row, with each practice's kind and length. On phones, stages
  open and close, so the section is half the height", and "the tiny landscape thumbnail above
  Nell's name goes. A round portrait shows instead, or her initials when there's no photo."
  - **Kind and length, on every practice.** Every curriculum layout gains them, because the list
    is shared: "Video · 13 min", "Audio · 20 min", "Reading". The length is the practice's
    `durationSeconds` (Codex-61zsk.46's data half, #559): whole minutes, rounded rather than
    floored, then hours ("1 hr 15 min"), and "under 1 min" below a minute. With no length (a
    reading, a film never probed, an older worker) the kind stands alone. The words are spoken
    "title, kind, length", with the commas hidden and the dot drawn. The pair closes the title's
    line where the list has room and drops under the title where it has not. The list is its own
    inline-size container (`26rem`), because a card is narrow on a wide band; it is
    `inline-size: 100%`, since a size container in a centring parent shrinks to nothing.
  - **One row a stage.** The timeline draws a rule over each stage's words and practices, clear of
    the spine. Its practices go unruled, and the first sits level with the stage name: both lines
    centre on the marker. The expandable list keeps its ruled practices.
  - **Folding on a phone.** Below the width at which the row stacks (`--_phone` under the
    complement of `@container (min-width: 52rem)`), each stage's name becomes the button of an
    ARIA accordion over its line and practices. It uses the FAQ's disclosure model with the first
    stage open, `hidden="until-found"`, and the arrow keys between stages; a stage with nothing
    inside stays a plain row. X8's rule holds: it is served open, so no-JS visitors read every
    stage, and it folds only while the section is ahead of the visitor. A visitor focused on a stage
    when the fold gives way keeps their place on that stage. Measured at 390: the sample's six
    stages of four drop to 0.44 of the open height (2650 to 1155px), and Studio, Bold and Cinematic
    to 0.42–0.44. Ancestral Threads' three short stages save less (list 685 to 462px, 0.67),
    because the open first stage is most of it. `whenAhead` and the `--_phone` follower moved out
    of the before and after's toggle into `kit/primitives/swap.ts`, shared by both. The toggle's 36
    tests pass on them unchanged, and the fake observers moved to `swap.testing.ts`.
  - **The guide's sign-off.** Split and centred sign off with a round portrait beside the name and
    role (56px): the block's own portrait, or its clip's frame, else the guide's initials, as the
    medallion. A circle holds the place while the stream is out, so the name never moves. The
    "thumbnail" was the signature slot: without an uploaded mark, `signatureUrl` is a frame of the
    Signature film, and `Signature.svelte` drew that photo through its ink filter. The quote layout
    keeps the mark. Whether a film's frame should ever stand in as a signature changes a studio
    slot, so it is the owner's call (Codex-61zsk.47: keep, make the signature upload-only, or retire
    the slot; the recommendation is the last two). The owner chose the last two on 2026-10-14;
    built in X80.
  - **Found on the way:** `org-brand.css` paints every `[class*='__title']` and `[class*='-title']`
    with the org's heading colour. A practice named `practice__title` turned Of Blood & Bones'
    practice names its heading green, which only a real org brand shows. Renamed, and
    `blocks/heading-ink-class-names.test.ts` now fails on any kit class like it.
  - **Not done:** Path's route stop beside the stacked instructor split (Codex-61zsk.26), which this
    round did not touch.
  - **Tests:** the curriculum's kind and length in every layout, and the length's rounding. The
    timeline: served open; folding on a phone once ahead, the first stage open; never folding in
    view or scrolled past; following the width both ways; folding at once in a still preview; the
    arrow keys; and the focus handed back. The sign-off: portrait, clip frame, initials, the held
    circle, no face without a name, and the mark kept in the quote. Every new test was calibrated
    against a planted tree: the fold at any width, the fold in view, no stage opened, the focus
    dropped, the face never asked for, no held circle, no initials, and the colliding class name.
- **X58 · 2026-10-12 · 3b round 4, second part · A section with no words of its own continues the
  band above it (BUILT, decided without the owner; Codex-61zsk.48).** The reference plan
  (`phase3-sources/ref-plan`, sections 7 and 8): "The large gap under the cards goes", and "Today
  the questions start with no title after a large gap."
  - **What the gap was.** Measured on Ancestral Threads at 1440 (Studio), it is exactly 192px:
    pricing's foot (96) and the questions' own top padding (96). That is the joint every pair of
    sections on one ground gets. It read as a hole only because the questions have no heading. A
    heading set in the same place (in the browser alone, never in the database) made the same
    192px read as an ordinary section break. So the gap is not the page's rhythm being too loose.
    It is a section with nothing to announce it, spaced as if it announced something.
  - **The fix.** X56 titles every seeded FAQ, but that reaches a database only through a re-seed,
    and a creator may leave any section untitled. The kit keeps such a section legitimate: the
    hero's headline is its one sanctioned fallback, so the kit never invents a heading. Instead,
    a section whose block has no head, on the same plain ground as the section above, continues
    that band. It gives up its top padding (`--lp-pad-start`, which is now the band's top padding
    for anything placed from it), so the band above's foot is the whole joint. Ancestral Threads'
    questions now sit 96px under the cards at 1440 and 64px at 390. Across the eight Styles the
    joint is that Style's own foot: Studio, Path and Cinematic 96, Poster 96, Soft 106, Bold 120,
    Clean and Quiet 123. Soft and Poster keep their edge's overlap, since the cut is the ground's
    own colour there.
  - **Where it never applies:** across a change of ground (the bands part it), on or under a
    picture, on the shader, or under the hero or the closing ask (each draws its own backdrop).
  - **What "no head" means.** It is the block's own reading, not a guess from the outside. Nine
    blocks draw their head from the eyebrow, heading and lead (benefits, curriculum, FAQ, gallery,
    stats, story, testimonials, transformation, video), and all nine now read it through one
    `hasHead`, which the page reads too. The other five (pricing, problem, instructor, preview,
    text) head themselves another way and never continue.
  - **The Styles.** Bold's slab and Quiet's hairline say "a new section starts here", so a
    continuing section gets neither; the slab would also have sat in its words. Path's stop is
    measured from the band's top padding, so on a continuing section it sits where it sits on any
    untitled one, half a heading line below the band's top. A story with no heading already ran its
    first scene to the band's top edge; it still does.
  - **Not done:** the questions' heading itself on the owner's page, which needs the re-seed X56
    already notes, or a heading typed in the editor.
  - **Tests:** `continuingSections` against each condition: the untitled questions under the offer
    continue; any one of the eyebrow, heading and lead keeps them apart; words that are only spaces
    count as none; never across a change of ground, on the shader, on or under a picture, under the
    hero or the closing ask, or for a type outside the nine; a hidden section between is not there;
    and never the first. The page marks exactly that section. A guard test holds `HEADED_BY_WORDS`
    to exactly the blocks that call `hasHead`, and leaves no block reading the three fields by hand.
    Every condition was calibrated against a planted tree: removing each of the seven checks fails
    a test, dropping a type from the list or hand-rolling one block's head fails the guard, and a
    page that never passes the mark fails the page test. In the browser, removing the mark brings
    Bold's slab and Quiet's hairline back.
- **X59 · 2026-10-12 · 3b round 5 · Every Style that blurs takes the hazy look, and the live veil
  reads Path's route (BUILT, decided without the owner; Codex-61zsk.49).** X52: "The other six
  Styles that blur are unchanged until round 5 spreads what works." The owner chose X53's look for
  Studio (B: the whole band, a 20px blur, 1.6 times the shader) as "a blur or opacity over the full
  thing, just less", having called the heavy blur "terrible".
  - **Who takes it.** Bold, Clean, Soft, Path and Quiet now ask for `atmosphere: 'hazy'`, as Studio
    does. Poster and Cinematic keep the shader sharp behind their panel, where it already shows at
    full strength around the words. A test holds every Style to one of the two (hazy, or sharp with
    `--lp-atmosphere-veil: panel`), so none is left on the old blur.
  - **One look, one rule.** The 1.6 moved from Studio's stylesheet to one rule on
    `.lp[data-lp-atmosphere='hazy']`, where the shader runs. The thinner veil was measured under the
    20px blur, and the blur alone (X53's A) let no more of the shader through, so a Style can take
    neither without the other. `schemes.test.ts` now holds the multiple to exactly that rule.
  - **Path could never thin.** X54's live veil gave up on any mark drawn with a gradient, and never
    read a section's own pseudo-elements, so Path (its route is gradients, its walked line on the
    section itself) kept the proven veil. The reader now holds a gradient mark by its opaque stops:
    a translucent stop is shading, as a soft shadow already was, and a stop in the ground's own
    colour (a ring's hole, within the two 8-bit steps a translucent veil loses to the canvas) is the
    ground. An absolutely placed mark is measured over its own box, the offsets the browser reports
    from its containing block, rather than its host's: Path's rail is a 41px strip, and measured over
    the whole hero it would have forced the thickest veil. A mark drawn with a picture still keeps
    the proven veil.
  - **Measured** (the hero): of-blood-and-bones' Return to the Shoreline (Path, 'flow') thins to
    0.737 in light at 1440 (floor 0.82), and to the thin end, 0.776, in dark at 390 (floor 0.86).
    Over studio-alpha's 'glow' at 1440, near-black in light, every hazy Style measures 0.817 in
    light and 0.806 to 0.816 in dark: there the shader allows almost nothing thinner, and the live
    veil keeps it so.
    These are moving shaders read at one moment, so they vary by a step.
  - **The proof.** `live-veil.spec.ts` ran on Studio's multiple added by hand. It now runs on its
    page's own look (Tending the Grief is Quiet) in every hazy Style, the root switched to each,
    so each Style's own inks, marks and buttons are held to their floors over the shader drawn. It
    reads gradient marks and the section's own marks as the runtime does, and holds each ink over
    its own section's pixels: Path's rail ends at the hero's foot, and the next section draws its
    route there in the same ink.
  - **Path's guide, stacked (Codex-61zsk.26).** A stop's height is worked out, never measured: the
    section's padding, its eyebrow, its heading's size (X24). Stacked on a phone, the guide's split
    puts its portrait above the heading, a 4:5 picture the content column wide and then the
    split's gap, so the stop sat 412px above "Meet your guide" at 390. The stop now adds that
    picture's height while the split is stacked, and not side by side, where the heading heads its
    column again. `path-route.spec.ts` holds every section's stop on Return to the Shoreline to the
    middle of its heading's first line at 390 and 1440, read at rest (the hero's words rise into
    place as the page opens, and read mid-rise sit up to 16px low). Calibrated: no lead fails at
    390, the lead kept side by side fails at 1440.
  - **Tests:** `imageColours` reads every stop of Path's route as the browser computes it, nothing
    where nothing is drawn, and refuses a picture alone or among gradients. The Style test, and the
    page test, which also no longer leaves Cinematic without its `'sharp'` for the tests after it.
    Calibrated: a Style without the look, a second multiple, and the rule keyed back on Studio each
    fail the scheme tests; a veil forced to the thin end fails the proof over 'glow' light; and
    Path's route drawn faint fails it in both themes, which it could not have seen before.
- **X60 · 2026-10-12 · 3b follow-up · A poster's headline no larger than its longest word fits
  beside the picture, and its words wrap round all of the picture (BUILT, decided without the
  owner; Codex-61zsk.33, Codex-61zsk.36).** V3 and V5 (X34) found two faults in the poster hero.
  A word wider than the measure beside the picture was cut mid-word, with no hyphen, even in a
  short headline ("Your mornings, calmer" in Poster at 1440). And the lede could run under the
  picture's last stretch.
  - **The widest word sets the size.** Beside the picture, a headline's widest word, not its
    length, decides how large it can be: a long word is cut first. So the poster draws its
    headline at the smallest of the Style's size, the column over its first word (which always
    opens the first line, above the picture at the column's width) and what the picture leaves of
    the column (0.54 of it, less the gap) over its widest word after that; a type-only poster has
    the column for both. Where the words fit, the Style's size stands, steps and curves as X27, X31
    and X34 left them; only a headline whose word would be cut comes out smaller.
  - **A word weighed by its letters, a face by its scale.** Faces differ by more than two to one:
    a long word in Unbounded's capitals takes 1.06em a letter, in Bebas Neue's 0.46. One factor for
    every face would cut Unbounded's words or halve Bebas Neue's headlines, and `ch` (the face's
    own "0") was no better: fitted so no face is cut, it left the narrowest faces' headlines a
    third smaller than they fit. And counting letters overstates most words, since an "m" is about
    three "i"s in any face. So a word is weighed by its letters, each relative to an average
    lowercase letter (`GLYPH_WEIGHT`, the median over every face the brand editor offers), and each
    face has one scale, in capitals and as written (`FACE_SCALE`, em per unit of weight, the most
    any of 70 long, wide-lettered words needs): drawn no wider than weight × scale, less the
    Style's tracking. HeroBlock weighs the headline's runs (`headingRuns`: between spaces, or just
    after a hyphen, a dash or a slash), and the poster takes its first and widest in both cases.
    Measured with canvas, one glyph at a time (kerning only narrows a word), at weights 400 and
    700, the larger kept.
  - **Matched in CSS, on the face the page resolves.** The face reaches the page through CSS
    alone, from three writers (the org layout, the brand editor's preview, a page's own fonts),
    all into `--brand-font-heading`. A fourth writer for a width would drift from them unseen. So
    the lookup is CSS too: `styles/faces.css`, written from the table, matches
    `--lp-font-display`, which already resolves the dark face and the body face behind the
    heading. A style query compares the text as written: Chrome matched `"Archivo Black"` and not
    `'Archivo Black'`, and a page's own fonts leave a one-word face bare (`Syne`), which the first
    sweep's lookup missed. So each face is matched in all three spellings, alone and first in the
    org's sans stack, and a test holds each writer's spelling to the sheet. An unknown face, or a
    browser without style queries, keeps the widest face's scale: smaller, never cut. The Style's
    tracking is divided by `1em` where a browser can divide a length by a length (behind a test on
    a real property), and left out where it cannot, which only reckons a word wider.
  - **The foot.** The picture ran off the band's foot with a negative margin, which shortened the
    float, so the lines in its last padding ran full width under it. The float now keeps its
    whole box, and the poster itself reaches into the band's padding, its words ending a padding
    short of the foot. Where the words fit beside the picture nothing moves; where they run
    longer, they now pass below it instead of under it.
  - **HeroPoster takes the length and the widths as props** (`chars`, `runs`, set on its own
    root), and the plain box HeroBlock wrapped round it to carry the length is gone.
  - **Measured** in the kit's gallery (`/studio/page-kit`, the poster hero of every Style) over
    104 headlines, 20 to 120 characters with a long word first, between, last or nowhere, in the
    gallery's Archivo Black and Syne and, in Bold and Poster, Anton and Unbounded, at 1440 and 390:
    4,160 headlines each before and after.

    | | before | after |
    |---|---|---|
    | a word cut mid-word at 1440 | 47 (Bold, Poster, Cinematic, Path, Studio, Quiet) | 0 |
    | a lede glyph over the picture | 67 (Soft, Cinematic, Path, Studio, Quiet) | 0 |
    | a headline glyph or a button over the picture | 0 | 0 |
    | a headline that fit, drawn at its own size, 1440 | | 1,903 of 2,033 (93.6%) |
    | at 390 | | every one |

    The 130 that come out smaller do by a median 6.6% (90th percentile 12.4%), and all have their
    long word after the first: where it falls, on the first line, beside the picture or below it,
    is not something CSS can know, so it is held to the measure beside the picture wherever it
    falls. The most a fitting headline lost is 40.6%: Bold's "Back resilience for you" in Syne,
    whose second word shares the open first line. Syne accounts for 82 of the 130: its letters
    depart most from the shared shape, so its scale is set by its widest word. The first sweep,
    with letters counted and each face's widest letter, cut nothing either, but drew 1,174 fitting
    headlines smaller, up to 60%. The lede now ends a padding short of the foot, so a long one runs
    on below the picture rather than under it, and a few more headlines' buttons fall below a
    900px fold than before (Quiet's in Archivo Black, 17 to 20): those buttons were sitting on the
    picture.
  - **Tests:** `faces.test.ts` holds the sheet to its table, the table to the brand editor's
    faces, each writer's spelling of a one-word and a two-word face to the sheet, the sans stack to
    `org-brand.css`, the sheet to the kit's imports, and every Style's tracking to an em length (a
    bare number would make the poster's size invalid, which drops it to the body's).
    `long-heading.test.ts`: runs weighed by letters, the first apart, breaks after a hyphen, a dash
    or a slash, an accented letter as its base, an unknown one as the widest. `HeroBlock` puts the
    six widths on the poster's root and nowhere else, and the length there too, with the wrapper
    gone. The page's editor-parity test now compares attributes in name order: the editor holds
    the picture from the first paint and the page sets `data-pictured` when the still arrives, so
    the order was timing. `poster-fit.spec.ts` (opt-in, local: the gallery is a development route)
    is the sweep, holding no word cut at 1440 and nothing over the picture at either width.
    Calibrated: the sheet edited by hand, a face dropped, the stack respelled, the sheet not
    loaded, the widths left off the poster, the length passed for the widths, and the editor
    differing from the page each fail their test; and the sweep passes on this branch and fails with the
    float's margin put back (Soft's long ledes run under the picture at 1440) and with the size left
    unbounded ("resilience" cut in Bold at 1440). Its first draft read the picture once, before the
    headlines, and failed this branch: the picture moves with the headline, so it now reads it for
    each.
- **X61 · 2026-10-12 · 3c D1 · The page's first three dials: colour, corners and spacing, each one
  step either side of the Style's (BUILT, decided without the owner; Codex-61zsk.50).** 04 §3.3
  proposed five dials of three curated steps, each step proven, each with "use the Style's" as its
  reset; §6 put the dials first. These three go first because every step lands on a state the kit
  already proves: a scheme or a spacing any section may already pick, or corners a Style already
  draws. Type drama and motion need new proofs, so they follow.
  - **Stored as `design.dials`, and unset is the Style's.** Each dial holds one of two named steps;
    the middle step is the absent key, so the reset deletes it and a page that sets no dial
    renders exactly as before. Not in `brandOverrides`, which is the brand editor's own shape, and
    not as top-level `density`, `motion` or `type`, which the write boundary strips as legacy axes.
    The write boundary degrades each dial on its own (an unknown step reads as the Style's, a
    reset, never a different look), as a section's scheme does. `upgradePage` now carries the
    dials: it kept only the Style, and the editor saves what it returns, so any new key was
    dropped on load and wiped on the next save.
  - **Colour: one rung of ground → soft tint → brand colour.** Muted brings every coloured band the
    Style picks (contrast, brand, second colour) down to the soft tint; vivid takes every soft tint
    up to the brand colour. The ground stays the ground, so a page keeps its reading surface; a
    scheme the creator chose and the org's moving background never move. Vivid's brand colour
    yields to a band beside it: next to another brand band they read as one slab, and next to
    contrast they smear for a dark brand, so `keepBandsApart` would step one back, and it steps
    back the later one, which was Soft's closing ask (its questions are a soft tint right above
    it). Some steps change nothing by construction: vivid on Bold and Poster (no soft tints), muted
    on Cinematic (no coloured bands to bring down), and both on Quiet, which draws no bands. The
    editor's control should say so (D4). Rejected: vivid as the second colour (beside contrast it
    can smear too, and nothing guards that pair), lifting the ground (the page loses its reading
    surface), and a special case for Quiet's ask. Proof: every scheme is already proven for 4,096
    brands × both poles (`schemes.test.ts`, independent of the Style), so a dial that only
    reassigns proven schemes needs no new contrast proof; the band rules are held for every Style
    at every step.
  - **Corners: the brand's own, or Soft's.** `brand` is the kit's own corners, the org's tokens as
    its own pages draw them; `rounder` is Soft's recipe on any Style (cards and pictures twice the
    org's radius, from a gentle floor to 2rem; buttons and chips pills when the brand is rounded at
    all). Both are recipes the kit already ships. A Style's own devices keep their shape (Studio's
    square print frames, Poster's pills). Drawn as one `kit.css` rule per step, one attribute above
    each Style's tokens, so it wins by specificity and never by load order. Rejected: doubling each
    Style's own factor (Bold at 0.5 or Soft at 4 are new looks no Style draws).
  - **Spacing: the rhythm a section takes when it picks none.** Compact or spacious for every
    section without its own spacing; a compact layout stays compact. It moves the band's padding
    rung only, the one each Style already tunes; the gaps inside a section stay the Style's.
    Rejected: scaling `--lp-gap` and `--lp-stack` (96 rules in 32 files read them, each an
    unproven combination per Style).
  - **Not yet:** type drama ("louder" has about 1% headroom on the hero at 56rem and up, X34, so it
    comes with a committed fold harness or leaves the hero alone), motion (still and gentle need
    the motion gates widened), and the editor's controls (D4). The gallery takes
    `?dials=colour:muted,corners:rounder,spacing:spacious`.
  - **Tests:** `resolve.test.ts` holds, for every Style at every step: muted leaves no coloured
    band, vivid lifts every soft tint with no band beside it and only those, Soft's ask keeps the
    brand colour, the ground stays and Quiet is unchanged, the creator's scheme and the moving
    background stay, and no band sits beside its twin or the brand colour beside contrast; the
    spacing dial sets the rhythm and keeps a section's own and a compact layout's.
    `upgrade.test.ts`: dials carried, idempotent, sanitised. The validation tests and
    `ids.parity.test.ts`: the twin lists equal, every dial validated, an unknown step degraded.
    `dials.test.ts`: `brand` is the kit's own corners and `rounder` Soft's, every Style declares
    its corners on its root and nothing below a root declares one. `PageRenderer.svelte.test.ts`:
    the root names a known corners step only. `page-dials.spec.ts` (e2e, the seeded reference
    page): in a real cascade, `brand` equals the kit's own, `rounder` equals Soft's, and the page's
    button follows. Calibrated: each rule planted out (no neighbour yield, muted leaving brand, a
    chosen scheme moved, the spacing dial ignored, vivid lifting the ground, dials dropped on
    upgrade, a twin respelled, a dial unvalidated, a bad bag rejecting, dials off the save route,
    `rounder` drifting from Soft, a corner declared below a root or in a component, a step's rule
    renamed, an unknown step written, the attribute never written) fails its test; and the e2e passes on the branch and fails with the `brand` rule
    cut to a Style's own specificity (`.lp[data-lp-corners='brand']`), where load order, not the
    dial, decides: the Style's corners won on all four tokens.

- **X62 · 2026-10-12 · 3c D1, second half · The type dial and the motion dial, each one step
  either side of the Style's, or both below it (BUILT, decided without the owner;
  Codex-61zsk.51).** The last two of 04 §3.3's five dials, on X61's `design.dials`: `drama`
  (calmer · the Style's · louder) and `motion` (still · gentle · the Style's). X61's rules hold:
  the Style's is the absent key, a step is a named value at both twins (`ids.ts`, `@codex/validation`)
  and in `@codex/shared-types`, and the root names a step only when it is a known one
  (`data-lp-drama`, `data-lp-motion`).
  - **Type: a factor in every headline size, beside the org's own scale.** `--lp-drama-display`
    (the opening and the closing ask) and `--lp-drama-heading` (the section headings) are
    multiplied into the 28 size declarations the kit and the eight Styles make, next to
    `var(--lp-scale)`: `calc(clamp(…) * var(--lp-scale) * var(--lp-drama-heading, 1))`. So each
    Style's sizes, steps and curves keep their shape at every step, and no declaration multiplies its
    own inherited value (X27). Calmer is 0.85 on both; louder is 1.15 on the heading size only,
    because the opening and the closing ask are already drawn as large as they fit (X34) and have no
    room to rise. A section heading a layout draws at display size (the problem's statement) goes
    with them: calmer takes it down and louder leaves it. `kit.css` declares the factors, and `dials.test.ts` fails on any size without its
    kind's factor, on the wrong kind, or on a factor declared anywhere else (the closing band's
    hold, below, is the one declaration outside it).
    - **Louder grows a section heading as far as its widest run fits, and nothing else.**
      - **The fit.** A fixed 1.15 cut words. Poster's phone heading sits on its clamp's floor
        (2.1rem), where "Transformation:" just fits, so any step above 1 broke it. So louder draws a
        section heading at `min(louder, max(own, column ÷ run))`: the Style's step up, less where the
        heading's widest run would no longer fit its column, and never below the Style's own size.
        Heading weighs its own text into three properties (`widestRun`, on X60's runs in
        `long-heading.ts`), and the CSS weighs a run in the page's display face (`faces.css`), or in
        capitals where a Style draws them (Poster).
      - **The column is the head's room, and the layout names it.** The section's content column
        is `--lp-column`, declared on each section because a Style may re-set the gutter or the
        container there. A head with less room names it as `--lp-heading-column`, beside the rule
        that makes the room:
        - the measure: the story, gallery, pricing and "What's inside" heads (the last added on
          rebasing onto X63), and the story's chapters;
        - a split's share (5/12 or 7/12 of the column, or half, less its gap): the FAQ and
          pricing-focus heads, the stats grid, the text and benefits columns, the problem split and
          Studio's problem list, the guide's split (across the band on Bold and Cinematic),
          Cinematic's quote, the CTA split, and Clean's heads with their lead beside them;
        - `0px` where a head shares its row with something drawn at its own width (pricing's band,
          beside its price). CSS cannot know that room, so the heading holds at the Style's size.
          (Since X66, that hold is `--lp-heading-hold: 1`: a room of nothing is now the title floor.)
      - **Everything else drawn at the heading's size follows the dial down, never up.** A lifted
        title, the bento's lead tile, a quote, a price, a stage or chapter number, and Studio's
        problem lines all sit in a card's or a column's room, where no fit bound can see their words.
        At louder, `--lp-drama-held` (1 ÷ the factor) takes the step back out. The closing band
        draws its heading at the ask's size, which has no step in it, so it declares
        `--lp-drama-held: 1`. `dials.test.ts` fails on any other use of the heading's size that does
        not hold.
      - **The proof is relative: louder never breaks a word the Style keeps whole.** No run the
        Style draws within its line is drawn wider at louder, in any of the 60 runs below. What the
        Style itself draws too wide is not louder's to fix. At the Style's own size, 1,268 (heading,
        text) pairs in 30 of the 60 runs draw a run wider than its line. 722 of them are in
        Unbounded, the widest face the brand editor offers, and 309 are Poster in its own face.
        The last full run, after the rebase onto X63 added the "What's inside" heading to the
        sample page, counts 1,313: 752 in Unbounded, 324 Poster in its own face. The 45 more are
        all that heading, which the narrowed run counts at 45 on its own. Over half of each of
        those two is on a phone, in the problem's statement at display size, where Poster
        hyphenates by design. The rest are long words in split heads at 1024 and 1440. That is filed as Codex-61zsk.60, which
        reuses this fit at the Style's own size (X66: 992 of the 1,065 headings fitted, 0 still over).
      - **Known limit.** Path's route stop is worked out from the heading's size token, not from the
        size it is drawn at. Where the fit holds a heading back, the stop sits up to the step's
        share of half a line low (about 5px at 1440).
      - Rejected:
        - a fixed factor, which cut words (above);
        - a factor per Style: eight numbers to keep tuned against eight curves, and still blind to
          the word;
        - gating on the character count, which is blind to the column: a 14-letter word fits a full
          column at 1440 and breaks in a 5/12 split;
        - measuring in JS after hydration, which would make the heading jump after first paint;
        - making each head a size container, which would shrink its own `cqi` sizes with it.
    - Rejected: a shared ladder of sizes, which would flatten eight hand-set curves into one; and a
      louder opening, which the poster and the fitted heroes cannot take.
  - **Motion: still is the page reduced motion sees; gentle keeps what plays once.**
    - **Still.** Every entrance, every response to a hover or a click, and everything that follows
      the scroll or moves on its own stops at its final look. The stage arms nothing, so no figure
      counts up and no entrance waits hidden. The scroll story never follows, and the strip's
      arrows jump rather than glide. The timing tokens go instant on the root as `tokens/motion.css`
      makes them for reduced motion (0.01ms, so a `transitionend` still fires). The four
      `--transition-*` tokens are declared again there, because a custom property takes its `var()`s
      where it is declared and `:root`'s would keep `:root`'s durations.
    - **Gentle.** Entrances and the answers to a hover or a click play. A route drawn down the page,
      parallax, the read-along, the drifts, the marquee and the scroll story stop: nothing follows
      the scroll and nothing moves on its own.
    - **The org's moving background stops at either step.** The live page holds the window's shader
      still through `shaderTone.hold()`, the channel X54 opened between the background and a page,
      and lets go when it is gone. The studio's shader is still already, so a still page or the
      canvas never holds it.
    - **The gates.** Two lists in `motion/attributes.ts`, spelled the same inside `.lp:not(…)` in the
      CSS: `NOTHING_MOVES` (a still page, or the dial at still) gates the 43 entrance and
      response sites, and `NOTHING_FOLLOWS` (also any step) gates the 30 scrubbed and looping sites.
      The 11 sites that are about a still page being looked at (placeholders, plates, the folded
      clipless bands, the veil) keep the still page's own gate. A list inside one `:not()` takes the
      specificity of its strongest argument, so no gated rule's specificity moved.
    - Rejected: reusing `data-lp-still`, which also draws the editor's placeholders and plates and
      takes the live veil away, so a visitor would see the canvas; chaining `:not()`s, which adds a
      class's weight to 73 rules and can turn their cascade against ungated Style rules; and leaving
      the background moving at gentle, the largest moving thing on screen on a step whose one rule
      is that nothing moves on its own.
  - **Tests.**
    - `motion.test.ts` holds every animating declaration in the kit to the right list: an
      animation behind the still page's own gate runs at the dial's still, and a scroll-driven one
      or a loop behind `NOTHING_MOVES` runs at gentle. In `motion.css`, everything outside the
      scrubbed `@supports` stands behind the entrance gate and everything inside behind the follow
      gate. The marquee and the scroll story leave whole, and the still page's own gate guards
      nothing that moves.
    - `dials.test.ts`: the factors and their census, the still rule held to the token file, and
      every use of the heading's size outside a section heading holding louder's step out.
    - `long-heading.test.ts`: `widestRun`. `lift.source.test.ts`: a lifted title follows the dial
      down only.
    - The stage, the count-up, the scroll story, the channel and ShaderHero, at both steps.
    - `PageRenderer.svelte.test.ts`: the root names known steps only, gentle stages and still does
      not, and the background is held at either step on the live page, never on the canvas or a
      thumbnail.
    - `e2e/page-kit/page-dials.spec.ts`, in a real cascade on the reference page: every size probed
      at each step is the Style's times its factor and the page's own heading follows. On Path and
      Soft, gentle leaves no scroll-driven animation and no loop, and still leaves no animation and
      no timed transition.
    - `e2e/page-kit/louder-fit.spec.ts`, opt-in (`LOUDER_FIT=1`, a development route): every
      section heading of the sample page in all eight Styles at five widths, and in Anton and
      Unbounded on Bold and Poster, set to 60 texts. Louder draws no run wider than its line where
      the Style draws it within, never draws below the Style's size, never lifts a title, and still
      takes some heading the whole step in each Style and face at some width. On a phone a Style
      may rightly hold every heading, because its own size already fills the column. It passes: 60
      runs in 13 minutes.
    - **Calibrated:** each was planted out and failed. CSS: seven gate plants. JS: four. Renderer:
      four. Type and still CSS: six, and an unheld price. e2e: louder doing nothing, the colour
      transitions left on `:root`'s durations, the route following the scroll at gentle, and in
      `louder-fit` the fit turned off (118 faults) and the FAQ's split forgetting its room (7,
      all in the FAQ). After the rebase onto X63, the "What's inside" head forgetting its room
      gave 22 faults, all on that heading in Poster at 1024 and 1440 ("Transformation",
      "Photography" drawn wider than the line); with its room, none. The full run passed again
      on that base: 60 runs in 15 minutes.
    - **`louder-fit`'s first runs measured nothing.** On the branch's old base, reduced motion
      still gave every property a 0.01ms transition, so a size read straight after a heading's text
      was swapped returned the size before the swap. The fit looked switched off: almost a
      thousand words read as running over, and the fit-off plant failed exactly as the clean run
      did. A probe found it: each piece of the fit's expression, set as the heading's own size,
      read back the same stale number. Codex-1vs02 fixed the base, and the branch was rebased on
      it. The spec also turns a heading's transitions off while it reads it, so it no longer
      depends on that fix. A plant that fails the same way the clean run fails proves nothing,
      which is why both plants are re-run on every change to the instrument.
  - **Not done:** the editor's controls for all five dials (D4).

- **X63 · 2026-10-12 · 3b · "What's inside": every practice in the course as a picture-led card
  to swipe through, straight after the hero (BUILT, decided BY the owner on 2026-10-12;
  Codex-61zsk.52).** The owner reviewed a working mock-up (`phase3-sources/whats-inside`) and took
  every recommendation on it. On the stage line: "I like the stages idea here, showing what's in
  each stage."
  - **Its own section type.** `inside`, labelled "What's inside", with one layout, `carousel`. It
    can go anywhere, like any type, and is the second section in every Style's order and starter,
    straight after the hero (`STORY_ORDER`, and Cinematic's and Quiet's own orders). A visitor
    sees what they would be buying before they are sold it. The full-story recipe, and the
    portal seeded from it (Ancestral Threads), start with it too. The four shorter recipes keep
    their own point: the essentials, the journey's story, the video, the pictures.
  - **The card.** It shows the picture at 16:9. Below that come the kind and length, in X57's own
    words through `CURRICULUM_COPY` ("Video · 12 min", or "Reading" alone). Then comes the title,
    in full however long it is, and last "Stage 2 · Breath" in small type on every card. It is
    spoken "title, kind, length, stage": the title leads the markup and the kind leads the eye.
    The card is a pure showcase. Nothing on it is a link or takes a press, and the row's own
    arrows are the section's only buttons.
  - **No picture.** The frame shows the kind's icon in a ring, on the brand colour. The brand
    ground is a nested `brand` scheme, so the icon's ink is the kit's proven ink on any brand. On
    a brand, accent or contrast band, the brand would vanish into the band or smear against it,
    so the tile takes the band's own panel instead. A picture that fails to load gets the same
    tile, never a broken image (`Media` gained a `fallback` snippet).
  - **The row.** It uses `ScrollStrip`: the browser's own scrolling, snapping card by card, as an
    ordered list in a labelled region. The heading names it, or "What's inside" when there is no
    heading. The visitor drives it; it never moves by itself, and the section adds no motion of
    its own. Cards are about four-fifths of a phone's width (`clamp(17rem, 80cqi, 22.5rem)`), so
    the next one shows at the edge. A wide screen shows three whole cards and part of a fourth.
    Up to three practices sit from the column's start, as any row does (the coordinator's
    default; centring or growing them was not taken). The arrows sit under the row on the right,
    where the gallery's and the story's strips put them. Beside them is the position: the cards
    wholly in view, "1–3 of 18" (`ScrollStrip`'s new `position`). It is hidden from a screen
    reader, which already hears the list's length.
  - **The words.** A new section starts with the heading "What's inside" and one line: "Every
    practice in {course}, in the order you'll meet them." There is no eyebrow, as with the
    kit's other starters.
  - **Its band keeps each Style's alternation.** It takes base after the Studio, Path, Bold,
    Poster, Cinematic and Quiet heroes, and the tint between Clean's hero and its change. Under
    Soft's tinted hero it sits on the page. That is the one place the build departs from the
    mock-up, which continued Soft's tint into the carousel: a Style's own order never runs one
    coloured band into the same one (`PageRenderer.svelte.test.ts`; `keepBandsApart` steps it
    back to base anyway), because the two read as one oversized slab. The bands that were already
    there are unchanged in every Style.
  - **The Styles' own looks.** Studio draws each picture as one of its prints, untilted, since a
    tilt inside a scroller is clipped. Bold tops each card's words with its ink rule. Bold and
    Clean lay the head across a row, as they do the gallery's and the curriculum's. Soft centres
    the head over its row of cards, as it does the curriculum's cards.
  - **No practices yet.** A heading over nothing is an empty promise, so the public page folds
    the band away from the first paint, as the video's does. Where the page is only looked at
    (the canvas, a still thumbnail), it keeps a row of tiles. While editing, a prompt points to
    the Curriculum tab.
  - **The data.** The public sales read (`loadPublicStages`) now carries each practice's
    picture as a full CDN URL: the creator's own thumbnail, else its film's frame, else null.
    That is an optional `thumbnailUrl` on `JourneyPracticeView`. It arrives in the awaited page
    read, so the cards and their words are in the first HTML. Only the image bytes load later:
    the first four (as many as a wide screen shows) load straight away at
    `fetchpriority="low"`, behind the hero's, and the rest lazily, through `srcset` (`Media`
    gained `srcset`, `sizes` and `early`). The other curriculum reads used to hand out the
    frame's raw R2 key as the URL (Codex-e140e). Now one resolver, `resolvePracticeThumbnail`,
    serves all of them. A deleted media item lends no picture and no length on any of them: its
    frame object outlives the delete, so every read joins only live media, in the join, which
    keeps the practice. The canvas mapping now carries `durationSeconds` too, which it had
    dropped since X57.
  - **Drafts.** The canvas shows draft practices and the live page omits them, as the
    curriculum section already does: the canvas draws from the editor's read.
  - **Shared with the curriculum.** `PracticeCard`, `PracticeTile` and `practiceCard()` live in
    `blocks/inside/`. A curriculum layout that groups practices by stage (Codex-61zsk.55) lays
    out the same cards with the stage line left off, so the kind, length and picture are never
    worked out twice.
  - **Rejected, and why.**
    - *4:5 or 1:1 pictures.* They keep only 45% or 56% of a 16:9 frame's width, so a film's
      frame (every transcode's thumbnail) is cropped hard. 16:9 also keeps a phone's card short
      enough to show its words.
    - *The kit's default strip card*, with half the next card showing. A 16:9 picture that small
      is a stamp, and half a card reads as a grid that was cut off.
    - *Smaller cards, more at once.* They are stamps for the same reason.
    - *Arrows in the heading row.* On a phone they sit far from the cards they move.
    - *Arrows over the strip's edges.* They cover the pictures and are easy to miss on touch.
    - *Dots.* They stop working past about eight items.
    - *A plain count* ("18 practices"). It was a fair second choice, but the hero's facts line
      already carries the totals.
    - *No position.* It leaves the peek alone to say there is more.
    - *A stage marker over each stage's first card.* It leaves most cards without a stage.
    - *A stage chip on the picture.* It competes with the photograph.
    - *"Inside the journey".* The gallery already starts "Inside {course}".
    - *Always the hero's other ground.* In Studio, Soft and Path that lands on the same ground
      as the section after it.
    - *Cutting long titles at three lines.* It hides a creator's words.
  - **Not done:** a finishing transcode still invalidates no cached content list (Codex-1szw2,
    its own bead). It is latent here, since the sell page's read is not cached. Also not done:
    making a changed picture appear at once. A visitor who already holds the old one sees it for
    up to an hour, the platform's window for every image (accepted). Both are left to their own
    work.
  - **Tests:**
    - The resolver alone. A real-database read of every curriculum surface, written while the
      raw-key bug still reproduced, covering the custom picture, the frame, a written practice,
      a deleted media item and a draft.
    - The routes passing the CDN base, and the canvas mapping.
    - `Media`'s sizes, early load and stand-in, and `ScrollStrip`'s position.
    - The block: every practice in order with its kind, length, title and stage; the row's
      label, order and buttons; pictures at their sizes; the tile, on a failed picture and on
      each filled band; the first four early; no link and nothing to press; the empty fold,
      canvas and thumbnail; and the starter's words.
    - Every Style putting it second, in its order and on a new page.
    - Each was calibrated against a planted fault, from a raw key handed out to a link on the
      card.
- **X64 · 2026-10-12 · 3b · Simple one-job sections: Picture, Heading, Break and Button, each
  joining the band it serves (BUILT; the design decided BY the owner on 2026-10-12, the Button's
  actions decided WITHOUT the owner; Codex-61zsk.53).** The owner reviewed the mock-up and design
  note (`phase3-sources/simple-sections`) and approved every pick on it. Their added decisions:
  pictures come from uploads only, through the page-image pipeline, with replace and remove
  proven through the save diff and the sweep (replace, remove, undo, the same key twice on one
  page); `xl` registered with the sweep (closes Codex-61zsk.13, full-bleed page images
  upscaling); `ImageField` keeping the picture's own fields; and a check of Codex-a0e3a.
  - **Four section types**, first in the gallery under a new group, "Basics". None stores a
    colour by default, none takes a background picture, and no Style's starter or recipe
    gains one (a new Picture would be empty, and a Heading has no starter words). Each Style's
    order places them where a full page shows them at work: a Picture after the problem, a
    Heading before the curriculum, a Button after it, and a Break before the testimonials.
    - *Picture* (`contained`, `full`, `beside`): one upload and an optional caption, never laid
      over the photograph. In the column it keeps its own shape, never cropped and never taller
      than `--lp-picture-tall`. Full width it runs edge to edge at 2:1, 3:2 from 34rem and 4:5
      on a phone, cropped around its focal point. Beside its caption it is a 7:5 row from 52rem,
      the words at its foot like a gallery label.
    - *Heading* (`start`, `center`; centred by default in Soft and Cinematic): an optional small
      label and a chapter title at the section-heading size, an `<h2>`. Over 64 characters it
      steps down to a lifted title size. A label alone counts as empty. Its head is drawn as
      every section's head is: the measure, the heading within 20ch of its own face, and the
      measure named as that heading's room (X62; below).
    - *Break* (`space`): space, exactly one rhythm step high. A new one stores no spacing and
      reads Medium; Small and Large are stored. It has no colour control. An optional mark
      (off by default) in each Style's own drawing.
    - *Button* (`stack`, `row`): the label is the creator's own words; the action is one of a
      proven set. There is no small-print field: the billing line is derived.
  - **The bands (`joinSimpleSections`).** Simple sections are transparent to `keepBandsApart`:
    the ordinary sections resolve as if they were not there, so a Picture between Bold's brand
    hero and its contrast problem cannot stop the problem stepping back. Then each run of simple
    sections between ordinary sections A (above) and B (below) takes a neighbour's ground:
    - everything before the run's first Heading joins A; from that Heading on joins B, because
      a heading announces what follows; with no B, the Heading's part joins A (and the
      inspector says "A heading reads best right above the section it introduces");
    - X58's guards hold: nothing joins the hero or the closing ask (each draws its own
      backdrop), a section on a picture, or a section on the shader. A section that can join
      neither stands on its Style's own ground (`base`), padded on both sides, except a Break,
      which takes B's ground when it cannot take A's, so it is never a stripe of its own;
    - a colour the creator chose stands alone and is never overridden. A Break's stored scheme
      is ignored.
  - **The joints (`continuingSections`, `kit.css`).** A joined Picture, Break or Button gives up
    its top padding. A joined Heading keeps its top (a new part starts) and the section it
    announces gives up its own, head and all. A Break has no padding: its height is its rung.
    The foot gained its own variable, `--lp-pad-end`. A full-width Picture's foot is the depth
    of the Style's band edge (`--_edge-d`, 0 where a Style has none), so the next band's curve or
    angle lands in padding and never on the photograph; with a caption it is the compact rung.
    Nothing sits flush under a full-width Picture with no caption: the section below keeps its
    top, X58's included.
  - **The live page folds** an empty Picture, an empty Heading and a Button with nowhere to go
    (`foldForVisitors`), before the bands resolve, so no band rule counts a section a visitor
    cannot see. The canvas and still thumbnails keep them all, with their prompts. A Picture
    whose image fails to load hides its figure on the live page.
  - **The Styles.** The marks, all in an ink already proven on every ground a Break can stand
    on: Studio a short stroke of its pen (`--lp-mark-underline`, drawn on as it enters), Bold
    its slab in the ink, Quiet its hairline in the line, Poster a thick printed rule in its
    line, Soft three small pebbles and Cinematic a hairline fading at both ends, both in
    `--lp-mark-ink`. Clean ("parted by air") and Path (the route already runs through the pause)
    have none, so the inspector hides the switch there. A marked Break replaces the Style's own
    separator at its joint: Bold's slab and Quiet's hairline are never drawn on a Break or on
    the section after a marked one. Studio frames a Picture in the column or beside its words
    as one of its prints, sets its caption in the display face's italic, and underlines a
    Heading section's heading (the pen's one exception: a chapter head). Bold sets a caption
    under its printed rule, except at full width. Soft centres a Button.
  - **Picture data.** An `ImageRef` is now `{ key, alt?, focus?, w?, h? }`. The upload writes a
    fourth size, `xl`, at `min(1600, width)` and never upscales, and returns the picture's
    width and height, which `ImageField` stores; replacing the picture drops the old focal point,
    and writing the description keeps the rest of the reference (it used to rebuild it).
    `pageImageSrcset` lists `xl` only with a size, each width capped at the picture's own. The
    focal point is stored in whole percent; the centre is never stored. The inspector offers it
    under the upload, live at full width and explained in the other layouts: tap or click to
    place it, the arrow keys move it 2% (Shift 10%), "Use the centre" removes it, and three
    crops (wide 2:1, tablet 3:2, phone 4:5) show what each screen keeps.
  - **Replace and remove.** The save nominates and the sweep decides, as for every page image.
    The save's diff moved beside the key rules (`droppedPageImageKeys`,
    `@codex/image-processing`): replacing a Picture nominates the old picture; removing it, or
    deleting the section, nominates it; putting it back (an undo) nominates nothing, and the
    earlier nomination is refused by the sweep, which reads the pages first; and the same
    picture on two Pictures stays until neither shows it. Every nomination names the four
    objects, `xl` included, and the sweep deletes and keeps all four.
  - **The Button's actions (decided WITHOUT the owner).**
    - `join` (the default, stored as no action): the closing ask's path through `OfferAsk`, the
      closing ask's own offer extracted with its markup and class names unchanged, so the two
      can never disagree. Priced, it shows the recommended path's price above the button and
      its derived billing line under it; otherwise "Continue" for a member, the closed notice,
      or a price-less button. On the canvas with no price it adds "Your price shows here once
      the journey has one (the Pricing tab)."
    - `section`: a jump to a section on this page, by section id (`#anchor`); no price.
    - `preview`: plays the page's preview film in the shared player; offered only once the
      journey has one; no price.
    - `link`: an https address with a host and no credentials, at most 2000 characters, opened
      in a new tab with `rel="noopener"`, its accessible name ending "(opens in a new tab)"; no
      price. The write boundary refuses anything else: `buttonActionSchema` in
      `@codex/validation`, applied by `pageSectionSchema` to a Button's `props.action`, with a
      twin reader in the kit held to it by a parity test. The inspector writes a link only once
      it is a full https address, and shows "Use a full web address that starts with https://"
      until then.
    - Each action starts with its own label until the creator writes one: "Join now", "Read
      on", "Watch the preview", "Find out more".
    - **A dead target is hidden on the live page**, never sent to the checkout: a section that
      is hidden, deleted or folded, a preview film the page does not have (known from the
      awaited `filmsAttached`, or once the stream settles), or a stored action that cannot be
      read. Its label was written for that destination. The canvas keeps it and says why
      visitors will not see it.
    - The floating bar steps aside while a Button is on screen, as for the offer and the
      closing ask.
  - **The editor.** Colour reads "Matches the section above" (or below) until the creator picks
    one; a Break shows "A pause has no colour of its own" instead of swatches, and notes the
    colour change that already makes a pause, and two pauses in a row. The canvas draws a Break
    as a dashed outline with the chip "Pause · Medium. Visitors see only the space." and an
    empty Heading's "Type the heading for what follows". The compact closing ask's gallery
    line now reads "A band of its own: one line and a button".
  - **Rejected, and why.**
    - *A band of its own for each simple section.* That is the empty stripe, and a picture two
      paddings below the words it shows.
    - *A bare URL as the Button's only destination.* It puts the page's price beside a link
      that leaves the page, the contradiction X56 removed, and it was the only way to reach a
      section or the film.
    - *Script actions* (or `javascript:`, `data:` and the like). They run code on a visitor's
      page under the creator's words. The set is closed and checked at the write boundary.
    - *A dead target falling back to "Join".* The label was written for somewhere else, so
      the visitor would land at the checkout under the wrong words.
    - *The price inside the button* ("£15/mo"). It hides the billing line and makes the label
      too long for a phone.
    - *A Break split across a change of colour.* It looks balanced but has no centre for a mark.
    - *Pictures from the media library.* `media_items` hold no images yet. "Use a picture
      already on this page" is small and later.
    - *`xl` at 2400.* About twice the bytes and Wasm memory, for a full bleed on a 2x wide
      screen; 1600 covers a 1440 window at 1x and the column at 2x.
  - **Codex-a0e3a (unused-image cleanup can delete pictures an unpublished edit still shows):
    the gap is real, and not fixed here.** A published page's unpublished edit lives only in
    the tab's session storage (`page-builder-store.svelte.ts`), and autosave never writes a
    published page, so the sweep reads only the published sections. A picture uploaded into
    such an edit and left for longer than the grace period (7 days) is deleted. The fix needs
    a server-side draft or a keep-alive for pending uploads: backend, schema and API work of
    its own.
  - **With the page dials (X61), on rebasing onto them:** the colour dial reads the bands, not
    the sections. Vivid's brand colour yields to the nearest band beside it, so it looks past a
    simple section between the two, which takes one of their bands. A Picture under Soft's
    questions therefore does not let them go brand against the brand ask. A simple section takes
    no dial of its own: it joins a band that is already dialled. X61's tests now read the page's
    bands the way the bands' own tests do. Calibrated: reading the raw neighbours failed, and so
    did the first section reading the page's last band (`lastIndexOf` reads a negative start
    from the end).
  - **Checked in a browser** (every Style's full gallery page at 1440 and 390, real photographs
    in local R2): each simple section on the ground of the neighbour it joins, and its joints'
    padding as above. One fault was found and fixed. In Soft and Poster, whose sections rise into
    the one above along an edge, the next section covered a marked Break's foot to the edge's
    depth, and a mark centred in the whole step sat under the cut (up to 18px at 1440). A marked
    Break now keeps `padding-block-end: var(--_edge-d, 0px)` inside its one step, so the mark
    is centred in what the cut leaves. Clearance went from −15 and −18 to +15 and +13 at 1440,
    and from −5 and +2 to +10 and +14 at 390. No section's height changed, nor did any other
    Style. `edge-clearance.test.ts` holds the rule, the full Picture's foot, and the depth's
    name in `surfaces.css`. Calibrated: removing the Break's padding failed its test, and
    renaming the depth failed the name's.
    - A full-width Picture with no caption, in Soft and Poster at 1440 and 390: the next
      section starts exactly at the photograph's foot, and the Picture's foot padding equals
      the edge's depth (61.4px at 1440; 30.7px and 23px at 390), so the curve or angle is drawn
      in the padding and never on the photograph. In Bold, which has no edge, both are 0. With a
      caption (planted, since the gallery gives a Picture none), the foot is the compact rung:
      the caption ends 0px above the next section at 1440 in Soft and Poster, where the edge's
      depth is capped at exactly that rung, and 7.7px and 15.4px above it at 390. The edge never
      covers the words, as for any compactly spaced section in those Styles. The curve's highest
      point is mid-page and the caption starts at the left, so the words read clear of it.
    - The Button's actions, planted one at a time in the gallery, in Bold and Soft, live and on
      the canvas. A link opens in a new tab with `rel="noopener"`, its accessible name is "Find
      out more (opens in a new tab)", and no price is shown beside it. A section jump goes to the
      FAQ's anchor and scrolls to it. A Button aimed at a missing section is not drawn on the
      live page; on the canvas it carries "The section this button goes to is hidden or deleted.
      Visitors will not see this button until you choose another." A preview with no film hides
      its whole section once the stream settles, so it leaves no band; on the canvas it stands
      with "This journey has no preview film. Visitors will not see this button until you add
      one."
    - The canvas's prompts: an empty Picture says "Add a picture: tap here, then choose one.",
      and a Break says "Pause · Medium. Visitors see only the space." The visitor's view of the
      same page drops the empty Picture and shows neither prompt.
  - **The Heading section's width (decided WITHOUT the owner, on rebasing onto X62).** The head
    was held to the lead's measure (`--lp-measure-lead`, 36 to 44ch of the BODY face, about
    400px) and named no room. louder-fit over every Style's page found two faults with that.
    - Louder grew the heading against the whole column: 95 faults, all on this heading.
    - Even at the Style's own size it broke long words: the run's own-size count rose from 1313
      to 1552, +239 pairs from this one heading, in the one section whose whole job is its
      heading.
    The head is now drawn as every other section's head: the measure, the heading within 20ch
    of its own face (so the cap grows with the type), and `--lp-heading-column: var(--lp-measure)`.
    louder-fit then passed with no faults (60 runs, 14 minutes), and the own-size count was 1367:
    +54, this heading's share like any other head's, which is Codex-61zsk.60's. Calibrated: with
    the room planted out and the width kept, 46 faults, all on this heading, in Bold and Poster at
    1024 and 1440.
    - *Rejected: naming the lead's measure as the room and keeping the narrow head.* It clears
      louder's faults by holding the heading at the Style's size, but keeps the 239 broken words.
    - *Rejected: a measure of its own for a chapter head.* It is a section's head; a second
      measure is one more width for every Style to tune.
  - **Not done:** the canvas's "Make this a Heading" swap for a Text holding only a heading.
  - **Tests:**
    - The bands: every Style's ordinary sections unchanged with the four in place, and every
      pair of every Style's ordinary types with each simple type between them (the premise
      asserted: some pairs really do step back); each one in every Style's full page on the
      ground of the neighbour it joins; the run split at its Heading; the fallbacks; every
      guard; a chosen colour; a Break's ignored colour.
    - The joints and the fold, each condition alone.
    - The page: every section drawn in order under one h1, simple ones on a neighbour's
      ground; identical with and without the editor in every Style; an empty Picture and
      Heading folded for a visitor and kept on the canvas.
    - The Button through the page: the joining ask's markup identical to the closing ask's in
      every offer state; its labels; the canvas's price hint; each action's link, button or
      film and no price beside it; every dead target hidden live and explained on the canvas;
      untrusted links never drawn; the floating bar stepping aside.
    - The marks: drawn exactly in the Styles that offer one, in their proven ink, and the
      separators matched against real elements under a plain and a marked Break.
    - The editor: no action written that the save would refuse; the preview offered only with
      a film; the notes; the mark only where a Style draws it; the focal point placed, moved,
      centred and explained; a half-typed link kept out of the page.
    - The save diff for a Picture: replace, remove, undo, the same key twice, a move, and the
      four objects.
    - The upload: `xl` at 1600, no upscale, the memory freed; the sweep deleting and keeping
      `xl`; an old three-size key still valid.
    - `OfferAsk`'s extraction was proven once against the closing ask as it was before it
      (every layout, every offer state, page and canvas, 36 renders identical, the CSS moved
      rule for rule), then that comparison was removed with the old file.
    - Every new test was calibrated against a planted fault: 54 plants, each red.
    - Two existing kit gates caught real faults during the build: a `heading__title` class the
      org's brand sheet would have painted in its heading colour (the class-name test), and an
      un-namespaced private in Soft's pebbles (the private-property registry).
- **X65 · 2026-10-13 · 3b follow-up · A cover hero holds its play button's place while the
  video is on its way, and a sell page's layout shift is measured (BUILT, decided without the
  owner; Codex-61zsk.40).** #561 made the awaited view say which films can come
  (`filmsAttached`), so a hero whose only media is a video is framed from the first paint. Its
  VERIFY step, a layout-shift total of 0 on a real page, had not been measured. It now has, and
  the cover was the one layout that still moved.
  - **Why the cover, and only the cover.** Split, centered, statement and poster draw the play
    button over the picture, inside a box whose place #561 already holds. The cover draws it in
    the words' column, and drew it only once the clip had landed. That column ends at its foot
    (`align-content: end`) above a `min-block-size` floor. At 1440 the late row lifted the words
    inside an unchanged band. At 390, where the words already fill the floor, it made the band
    38px taller and pushed the page down.
  - **The decision.** While a hero video the awaited view says is attached is on its way, the
    cover draws the play button's box, hidden (`visibility: hidden`) and inert. When the clip
    lands, the same box becomes the button: one element throughout, so nothing remounts and the
    entrance does not replay. A video that then fails to resolve leaves no box, as every other
    layout leaves the words alone.
  - **Rejected: moving the cover's button over the picture**, as the other layouts draw it. It
    would remove the shift by changing the cover's design, where the button reads with the
    words it belongs to. **Rejected: a reserved gap without the button in it** (a fixed
    min-height on the column). The gap would have to track the button's size in every Style
    and on every phone; holding the button itself is exact by construction.
  - **Measured.** A Playwright probe loads each public sell page signed out and sums its
    `layout-shift` entries (none after input) from navigation until the stream settles, at 1440
    and 390. Each shift is attributed to its section. It only reads pages. On
    of-blood-and-bones ancestral-threads (statement, hero video only), return-to-the-shoreline
    (split), tending-the-grief (cover, hero video only), and studio-alpha's bone-deep and
    tending-the-grief (no film):
    - **Calibrated:** with #561's hold planted out, ancestral-threads read 0.1669 at 1440 and
      0.1740 at 390, its hero 489px at the first paint and 1038px once settled.
    - **With web fonts held constant** (every font file aborted, so the fallback draws
      throughout and no swap can move a line): the cover 0.0147 to 0 at 1440 and 0.0447 to 0 at
      390, where the band is now 550px from the first paint instead of growing to it from its
      512px floor. Every film layout and both no-film pages read 0 after the fix.
    - **With web fonts loading as usual**, what is left is the fonts, not the films: the cover
      at 390 is 0.0826, its headline going from 2 lines to 4 when the brand face lands. Every
      brand face falls back to one Arial tuned for Inter. Filed as Codex-61zsk.61.
    - With fonts aborted, the split at 390 moves its picture 26px and back as its words re-wrap
      twice while the fallback resolves. It is the same before and after this fix, absent when
      fonts load, and text, not the picture.
  - **Tests** (`HeroBlock.svelte.test.ts`): the held box at the first paint, inert and with the
    button's label; the same box becoming the button when the clip lands; no box when the video
    fails or none is attached; and the rule that hides it. Each was calibrated against a
    planted fault (nothing held, the held box visible, the held box not inert, the box remounted
    when the clip lands), and each failed on its own assertion.
- **X66 · 2026-10-13 · 3c follow-up · A section heading drawn no larger than its widest word
  fits, at the Style's own size as at louder (BUILT, decided without the owner; Codex-61zsk.60).**
  X62 fitted a section heading to its room only at louder. At the Style's own size it was the
  Style's size whatever its words, and X62's census counted what that cut: in Poster's FAQ,
  "Transformation:" at 74.56px in a 5/12 track at 1440, across the questions beside it.
  - **The rule.** Every section heading is drawn at `min(cap, max(title, hold × own, (1 − hold) ×
    room ÷ run))`. `cap` is the dial's size for it (`--lp-size-heading`: the Style's, its step up
    at louder, its step down at calmer), `own` is the Style's size before louder's step, `room` is
    X62's (the section's column, or the room a layout names), and `run` is X62's weight of its
    widest run in the page's face. So a heading is drawn at the dial's size wherever its words fit,
    and only as much smaller as its widest word needs: X60's poster headline, and X62's louder, are
    the same rule. A heading with no words is drawn at the dial's size.
  - **Never smaller than a title.** A heading stays a head, and a room that came to nothing (a
    layout's rule gone wrong, or a column a Style collapses) cannot draw it at no size. A word too
    long even at a title's size runs past its line, as every word did before. In the sweep none
    did.
  - **A held head: `--lp-heading-hold: 1`, in place of X62's `--lp-heading-column: 0px`.** Where a
    head shares its row with something drawn at its own width (pricing's band beside its price, at
    60rem and up), CSS cannot know its room. X62 named that room `0px`, which louder read as
    "hold". Under this rule a room of nothing is fitted to the title floor, so the band now says
    what it means: hold, at the Style's size, which louder does not grow (`--lp-drama-held` takes
    the step back out) and calmer still takes down. *Amended by X70: the band wraps its price
    under a head whose widest word does not fit beside it, and holds nothing.*
  - **Measured** with `louder-fit.spec.ts`, which now reads each heading three ways: held at the
    Style's size as it was drawn before (the census), at its own size, and at louder. Over the 8
    Styles, the gallery's face and, in Bold and Poster, Anton and Unbounded, 5 widths and 60 texts
    (60 runs, 24 minutes):

    | (heading, text) pairs with a run wider than its line | before | after |
    |---|---|---|
    | section headings fitted (the column, or a named room) | 992 | 0 |
    | section headings held (the pricing band, 1024 and 1440, Poster) | 73 | 73 |
    | titles and the problem's display statement (not fitted here) | 302 | 302 |
    | at louder, a run the Style's size keeps within its line | 0 | 0 |

    The before is 1,367, X64's own-size count, and the census held at the Style's size counts the
    same 1,367 on the after. A fitted heading came out a median 16.5% smaller, a tenth of them over
    27%. The most was 50.5%: Poster in Unbounded at 1024, the FAQ's "Transformation:" alone, 56.3
    to 27.8px. 606 of the 992 are Poster and Bold in Unbounded, the widest face offered.
  - **What it costs.** The run is weighed with each face's scale (X60's `FACE_SCALE`), set by the
    widest of 70 long words, so most words read a little wider than they draw: 507 (heading, text)
    pairs whose words fit at the Style's size come out smaller, by a median 3.9% (90th 6.4%, the
    most 13.4%: Cinematic's closing band at 360, "Transformation:" alone). 168 of them are the
    story's chapter heads, and 297 are in Poster. X60 took the same trade for the poster headline.
  - **Known limits.**
    - The 73 held: the pricing band's heading is drawn at the Style's size beside its price, so a
      long word there still runs past its line, in Poster at 1024 and 1440 (Codex-61zsk.63).
    - Titles (260) and the display statement (42): a title sits in a card's room, which no rule
      names yet, and the statement is drawn at display size, where Poster hyphenates by design
      on a phone (X62). Filed as Codex-61zsk.62. *Amended by X71: every layout that sets a title
      in a card names that card's room, and titles and the display statement are fitted as a
      section heading is.*
  - **Tests.** `heading-fit.test.ts` (CI) parses `Heading.svelte`'s rule and computes it, units
    and all, from the properties a page, the dial and a layout give it: the Style's size where
    words fit, a long word fitted exactly, the title floor, a named room narrower and wider than
    the column, capitals, tracking, no words, louder, calmer, and the hold. It fails as the browser
    does on a `max()` that mixes a number with a length, which is invalid and leaves the heading
    at its parent's size. It counts every `--lp-heading-hold` in the kit (only the band, only at
    60rem) and every named room (none of nothing). `louder-fit.spec.ts` (opt-in, local) adds the
    own-size check: no fitted heading draws a run past its line unless it sits on the title floor,
    which it logs. Calibrated: the guard's seven plants (the cap, the floor or the hold term
    dropped, the hold given as a number, the cap at the own size, the band unheld, the FAQ given a
    room of `0px`) each fail only their own tests, and the sweep fails with the fit removed (1,319
    faults), with the band unheld (95, all the band) and with the FAQ's room removed (104, all the
    FAQ).
  - Rejected:
    - **A floor at a share of the Style's size.** The census held at
      the Style's size shows what each would still cut: at 0.9 of it, 540 of the 1,065; at 0.8,
      227; at 0.7, 83; at 0.5, 3. A floor low enough to cut nothing is no floor, and it is a number
      to tune for every Style.
    - **Fitting only Poster and Bold**, where most of the count is. The rule is the same in every
      Style and changes nothing where words fit, and Cinematic, Path, Soft and Studio have 66
      fitted pairs between them.
    - **Measuring the heading in script after it is drawn.** It draws at the Style's size until
      the script runs, then changes: a layout shift on every page with a long word, and no fit at
      all where the script never runs.
- **X67 · 2026-10-13 · 3b follow-up · A brand face on its way draws in a fallback sized for it,
  so the page does not re-wrap when the face lands (BUILT, decided without the owner;
  Codex-61zsk.61).** X65 measured a cover hero at 390 still shifting once its brand faces
  arrived, and put it down to every face falling back to one Arial tuned for Inter.
  - **What was actually happening (corrects X65 and the bead).** With a brand face set,
    `org-brand.css` made `--font-body` and `--font-heading` that face alone, with no fallback
    after it. Until the web font landed, the page drew in the browser's default serif (Times
    New Roman), on an org that sets Inter as well, and 'Inter-fallback' was never reached.
    X65's "2 lines to 4" misread the line height. The headline went from one line (43px) to
    two (87px), and the swap re-wrapped 18 of the page's 252 text blocks.
  - **The decision.** Three changes:
    - Every font stack now ends the way `--font-sans` does (`'Inter-fallback', system-ui,
      -apple-system, sans-serif`), light and dark.
    - Every face the brand editor offers gets its own fallback: a face the visitor already
      has, sized and set on the brand face's lines, one per weight the page asks for
      (`lib/brand-editor/font-fallbacks.ts`, written to `font-fallbacks.css`). Every writer of
      a brand face puts the fallback after the face (`withFallback`): the org layout, the
      brand editor and its live preview, and a page's own fonts.
    - 'Inter-fallback' itself is now Inter's row of that table. Before, 500 borrowed 400 and
      600 borrowed 700, and both bold faces were set at regular's 107%, about 5% too wide.
  - **How a fallback is made.** Each face is drawn at each weight with
    `font-synthesis: none`, as the kit draws it, so a face with one weight is measured at that
    weight. `size-adjust` is its width over the local face's on one running sentence.
    `ascent-override` and `descent-override` are its own line metrics divided by that size,
    because `size-adjust` scales them too.
    - A face's local face is whichever of Arial and Times New Roman re-wraps less of the
      corpus; every row's choice was checked against the data. Courier New is used for the
      three monospace faces.
    - Each local face is named with its Liberation twin, which Linux ships with the same
      widths.
  - **Measured: the corpus.** 49 faces each set 24 headlines and 8 ledes, at 9 widths and 6 of
    the kit's sizes and weights, 864 settings per face.
    - A face's own fallback re-wraps a median of 1.9% (the most is Unbounded at 5.1%).
    - The alternatives re-wrap far more: Arial sized for Inter 13.1%, and the default serif a
      bare face drew 17.0%.
    - In three faces the face's own fallback only ties the one fallback for all, or misses it
      by one setting: Rubik 2.78% against 2.66%, Manrope tied, and Lilita One tied with the
      serif.
  - **Measured: the pages.** Three sell pages at 390, 768, 1024 and 1440. Each page was drawn
    with every font file refused, then again loaded, once everything had settled, and every
    text block was matched by order.
    - Blocks re-wrapped by the swap: of-blood-and-bones tending-the-grief went from 18/24/10/21
    to 3/6/4/5, studio-alpha tending-the-grief from 4/9/7/10 to 0/1/4/4, and bone-deep from
    6/4/3/2 to 0/0/0/0.
    - Of the 27 left, 22 are blocks whose own width moves with the font. The page kit sets
      about 55 measures in `ch`, which is the width of a "0" in whichever face is drawing, and
      no fallback can hold that (Codex-61zsk.64).
    - Re-wraps at an unchanged width went from 82 to 5. One of the five is a facts line in
      tabular figures that sits within 3px of its box (Figtree's tabular digits are wider than
      Arial's). It re-wrapped as built too.
  - **Why the measure has no timing in it.** A timed probe (layout-shift entries during a real
    load) read of-blood-and-bones at 390 as 0.1011, against 0.0826 as built, in one run. Its
    0.0698 shift was the cover's play button arriving about 2s after the fonts, which is
    X65's race with the stream and not a font. A frame-by-frame timeline found the line that
    really moved: the facts line, at Figtree's arrival.
  - **Rejected:**
    - **The tail alone** (every face on 'Inter-fallback'): it re-wraps a median 13.1%.
    - **Georgia for the serif faces**: Linux has no metric twin for it, so Linux would draw
      something nobody had measured.
    - **Emitting only the faces in use**: it would save about 2.3KB brotli per org page, but
      needs three places to emit them (the org layout, the brand editor's preview, a page's own
      fonts) and three ways to drift. The sheet costs 49KB raw, 3.2KB gzip and 2.3KB brotli.
      Its `local()` faces fetch nothing, and a face no text uses is never resolved.
    - **`font-display: optional`**: there would be no swap, but no brand face either on a
      first visit over a slow connection.
  - **The face lookup** (`faces.css`, X60) matches the face as the page resolves it. Each
    spelling is now the face as written, or followed by its own fallback, and then the tail;
    the spellings of a face on its own are gone, because no stack produces one any more. Its
    sheet went from 36.5KB to 31.5KB (2.1KB gzip, dev's 2.0KB).
  - **Tests.**
    - `font-fallbacks.test.ts` holds:
      - the sheet to its table;
      - one entry for every face the brand editor offers, with Courier New for the monospace
        faces;
      - four weights each, within bounds;
      - the sheet loaded by the org layout;
      - `typography.css`'s 'Inter-fallback' to Inter's row;
      - `withFallback` and `firstFamily`.
    - `faces.test.ts` holds that every writer's value followed by the tail is matched, and
      that all 7 font stacks end with that tail.
    - `brand-overrides.test.ts` holds that a face with a fallback is quoted and followed by
      it, and that the function is idempotent, as its docblock says.
    - Nine faults were planted, and each was caught by the test written for it.
  - **Opt-in measure** (`e2e/page-kit/font-fallbacks.spec.ts`, `FONT_FALLBACKS=1`). It
    measures the table again, and reproduced it exactly: 49 of 49 faces, the same local faces,
    0 difference. It holds every row within half a point of size and one point of each line
    metric, and holds the rates above. On the seeded pages it holds that 0 blocks re-wrap at
    the same width; dev as built has 29. `FONT_FALLBACKS=measure` prints the table again. It
    was calibrated against a planted row, a swapped local face and dev as built.
- **X68 · 2026-10-13 · 3b follow-up · The black-and-white proof holds the proven veil; the veil
  drawn is held between its two ends (Codex-61zsk.65; BUILT, decided without the owner;
  test only).** `org-shader.spec.ts` (B2, X50, X51) held every ink on studio-alpha's hero to its
  floor over the veil drawn (`--_atmos-s`) on pure black and pure white. Since X54 the live veil
  may thin that veil below the proven one once it has measured the shader behind each ink, and
  since X59 studio-alpha's hero has the hazy look, so it does. The spec read at network idle and
  the live veil writes within a quarter of a second of that, so the spec passed when it read
  first and failed when it read second. `live-veil.spec.ts` had said so in its docblock: the proof
  of a thinned veil "cannot be the black-and-white bound `org-shader.spec.ts` holds the proven
  veil to".
  - **Measured** on dev's code (741bb12b): studio-alpha / Tending the Grief at 1440, reduced
    motion, opened as the spec opens it and read every 250ms from its read point. The live veil
    wrote within 250ms in all 12 loads. The read had already seen it in 2 of 6 loads as built
    (dark 0.796, light 0.817, against proven veils of 0.86 and 0.82), and in 5 of 6 on the
    font-fallback branch (X67), which measures sooner. Soft ink `#aaa8a8` over the dark hero at
    0.796 is 3.67:1 against white. The spec failed 1 of 8 dark runs across the two builds; CI's
    slower GL had so far always read first.
  - **The rule.** The black-and-white bound is held to the proven veil (`--_atmos-floor`),
    which is what §5.1 proves. The veil drawn is held between the Style's end (`--_atmos-thin`)
    and the proven one, whichever side of the race the read lands on. A thinner veil is proven
    over the pixels drawn by `live-veil.spec.ts`, which waits until the live veil has measured.
    Nothing the spec held is dropped: where no Style thins, the veil drawn is the proven one.
  - **Rejected:** waiting for the live veil in this spec (it would then read only the thinned
    veil, which black and white cannot prove, and fail by design); reading before the live veil
    starts (nothing marks that moment, so it stays a race); a retry or a lower floor (the bound
    is right, on the wrong veil).
  - **Calibrated** on a bounded local stack, studio-alpha in both themes:
    - the fixed spec 6 of 6;
    - with its read forced to wait for the live veil's write, the fixed spec 6 of 6, and dev's
      spec failed every dark run (0.801 and 0.811, 3.73 and 3.85:1 over white);
    - a proven veil 0.1 thinner failed both themes on the bound (3.25:1 light over black, 3.55:1
      dark over white);
    - a veil drawn 0.05 under the Style's end failed both (0.662, 0.726);
    - one 0.05 over the proven veil failed both (0.87, 0.91).
- **X69 · 2026-10-13 · 3b follow-up · A full-bleed page image offers every size it has, at the
  width it is drawn (Codex-61zsk.13; BUILT, decided without the owner).** #574 gave page images an
  `xl` variant (1600, never upscaled) and the Picture section a srcset. A section's backdrop, the
  closing ask's band and the creator's own hero image still drew `lg`, one 800px file, at every
  width: upscaled 1.8 times across a 1440 band, and twice the bytes a phone at 1x needs.
  - **The rule.** All three draw `pageImageSrcset` (sm, md and lg, and `xl` only for an image that
    carries its size), with `sizes` taken from each layout's own geometry:
    - `100vw` for whatever runs full bleed or across the content column: the cover, statement and
      centred heroes, the closing ask's band, and a backdrop;
    - `(min-width: 50rem) 50vw, 100vw` for split, whose columns halve at its 50rem container;
    - `(min-width: 56rem) 46vw, 100vw` for the poster, whose picture takes 46% at 56rem.

    A still from the journey is not a page image, so it keeps its one URL (filed as
    Codex-61zsk.66, "A journey's hero still reaches the page as one URL").
  - **Measured.** The candidate Chromium chooses for each `sizes`:
    - full bleed takes `xl` at 1440 and 1024 at 1x, and at 390 at 3x;
    - split and the poster take `lg` at 1x, where their column is at most 800px, and `xl` at 2x;
    - every layout takes `md` at 390 at 1x.

    An image without its size tops out at `lg`, as before. No seeded page draws a page image in
    these three places, so there is no page to check them on; the seeded pages' markup is
    unchanged.
  - **Rejected:**
    - `sizes="auto"`: it applies only to lazy images, and a full-bleed image is drawn edge to edge,
      where `100vw` is exact.
    - A `sizes` per container width: `sizes` reads the viewport, and the kit's breakpoints are
      container queries. A viewport-width overestimate costs at most the page's side gutters.
    - A 1200px variant between `lg` and `xl`: it would change the image pipeline and every stored
      image for a step `xl` already covers.
  - **Tests** (HeroBlock, CtaBlock and PageRenderer):
    - each hero layout offers all four sizes, with its own `sizes`;
    - an image without its size has no `xl`;
    - the course still has no srcset;
    - the band and a backdrop at `100vw`.

    Seven plants each failed only their own tests: the cover's srcset dropped, split's and the
    poster's `sizes` set to `100vw`, a srcset on the course still, `xl` never listed, the band's
    srcset dropped, and a backdrop at `50vw`.
- **X70 · 2026-10-13 · 3c follow-up · The pricing band puts its price under a heading whose widest
  word does not fit beside it (Codex-61zsk.63; BUILT, decided without the owner; amends X66).** At
  60rem and up the band drew its head beside a price strip drawn at its own width
  (`minmax(0, 1fr) auto`), so CSS could not know the head's room, and X66 held it at the Style's size
  (`--lp-heading-hold: 1`). 73 pairs still drew a run wider than the line: Poster and Poster in
  Unbounded at 1024 and 1440, where "TRANSFORMATION:" ran into the £49.
  - **The rule.** The band's row is a wrapping flex row whose head grows from nothing
    (`flex: 1 1 0`). A flex item's automatic minimum is its min-content, its own longest word at the
    size the fit draws it, so the row wraps exactly when that word would not fit beside the price,
    and the price strip goes under the head. On a row of its own the head's room is its measure,
    which the fit already knows; on a shared row it has more than its word. The hold is gone. The
    price keeps the row's end (`justify-content: space-between`), or its start when it is alone.
    `--lp-heading-hold` stays in the rule, because louder-fit uses it to draw a heading as it was.
  - **The head is a column flex, not a grid.** As a grid it drew right in the gallery and failed the
    sweep with 73 faults: a grid's min-content leaves out any child whose own minimum is 0, and
    `min-width: 0` on a heading is a common cure for a grid blowout (the sweep sets it to read a
    heading's room). The head's minimum fell to nothing, the row never wrapped, and the word ran
    into the price as before. A flex column keeps each child's min-content in its own.
  - **Measured** in the gallery, as built and now:
    - with the gallery's own heading, in Poster at 1440 and 1024 and in Clean at 1440, light and
      dark, the band is byte-identical;
    - so is Clean's band with "Transformation: your calm", which fits beside its price;
    - in Poster that heading ran into the price at both widths. It is now drawn whole, with the price
      under it: 74.6px fitted to 64.2px at 1440, and 56.3px at 1024.
  - **The sweep** (`louder-fit.spec.ts`, every Style, 5 widths, 60 texts): 1 passed, no fault. The
    73 band pairs no longer run over, and no other row of the census moved. The fit now draws 10
    band headings whose words fit a little smaller (2.5 to 4.7%, all Poster in Unbounded), within
    its own spread (X66: median 4%). The 302 pairs still over are the titles and the display
    statement (Codex-61zsk.62).
  - **Rejected:**
    - Capping the price strip at a share of the column (`fit-content(5/12)`) and naming the rest
      as the head's room. A large price and its button can be wider than the cap, and
      `fit-content` then grows past it, so the named room would overstate the real one and the
      word would still reach the price.
    - A fixed 7 : 5 split: it narrows every band's heading for the rare long word.
    - Keeping the hold, which leaves the overflow.
  - **Tests** (`heading-fit.test.ts`, CI):
    - no layout holds its head;
    - the band's row is `flex` with `wrap`, and its head is a column `flex: 1 1 0`;
    - nothing gives the head a minimum of its own or an overflow that zeroes it;
    - the census now reads every stylesheet in the kit too, a Style's included.

    Seven plants each failed only their own tests: the hold put back in the band, a hold in Poster's
    stylesheet, the head's minimum set to 0, its overflow hidden, the row unwrapped, the head's
    basis set to `auto`, and the head made a grid again.
- **X71 · 2026-10-13 · 3c follow-up · A title is drawn no larger than its widest word fits its card,
  and a display statement no larger than it fits its column (Codex-61zsk.62; BUILT, decided without
  the owner; amends X66).** X66 fitted section headings only. At the Style's own size the sweep still
  counted 302 (heading, text) pairs with a run wider than its line. 260 were titles: the benefits
  grid 132, the bento 74, the course's cards 36 and its timeline 18. The other 42 were the problem's
  display statement, in Bold and Poster on a phone and in Poster in Unbounded at 768. A title sits in
  a card, and no layout named a card's room.
  - **The rule.** Heading weighs every heading but the hero's headline, whose layouts size it (X60).
    The weight and the hold are read once, in the base rule, and each size is fitted as a section
    heading is: `min(own, max(floor, room / widest run))`.
    - A display statement: its own size is the display size at its layout's scale, and its room is
      the column, or the one its layout names. It is never drawn smaller than a title.
    - A title: its own size is the lifted title (X55), and its room is the least of the column, the
      room its head names, and its card's (`--lp-title-column`). It is never drawn smaller than the
      body, so it stays a title.
    - Poster weighs its display line and its bento lead in capitals, where it sets their case.
  - **Each card names its title's room:** its share of the column, less its inset (its padding and
    border across).
    - The benefits grid is `--_n` across, and that count now draws the tracks too
      (`repeat(var(--_n), …)`). Soft's boxed cards are inset by their padding and border.
    - The bento's tile spans `--_span` of `--_cols`, and the span now places it too
      (`grid-column: span var(--_span)`). Bold opens every tile but the lead, inset 0. The lead was
      drawn at the heading's size by a rule that beat the title's; it now takes the heading's size,
      weight, leading and tracking as the title's own tokens (`--lp-title-lift: 1`), so it is fitted
      to its tile like every other name.
    - The course's cards are `--_n` across, inset by `--space-6` and the border; Bold's open cards 0.
    - The timeline's name has the row past its marker, and wide its 5/12 beside the practices. Path
      reaches the list past the column to sit its markers on the route; that reach is now the
      timeline's own `--_reach`, which its margin is drawn from, so the room counts it.
    - The course's map: a stop's name shares its row with the marker, the practice count and the
      sign, and from 48rem a stop is 60% of the list. The count is as wide as its words, which no
      rule can subtract, so the name and its count are now one `<hgroup>`, the heading and its
      line. (A `<summary>` holds phrasing and heading content, and `<hgroup>` is heading content;
      a `<div>` there is not allowed.) The hgroup's track is the room: the stop, less the marker,
      the sign and the gaps beside them, with Path's reach counted. The count stands beside the
      name while the name's longest word leaves it room, and under the name when it does not, as it
      already did on a phone. Beside the name it now stands on the name's first baseline. As built
      it stood at the top of its row: the padding meant to centre it on the marker was never valid
      (`--space-0` is a unitless 0, and `max()` of a number and a length is dropped; the names'
      own padding has the same fault, filed as Codex-61zsk.67). So across 30 stops beside their
      names, at 600 to 1440, the count is now 5 to 14px lower, on the line it labels. Path's map reach
      is the map's own `--_reach` too, and its margin is drawn from it. The sweep's own map page
      found these: 72 pairs, all at 768 in Bold and Poster in Unbounded, with the name's line at
      223px of a 699px column.
    - A lone card's measure is in the body's `ch`, which no title can read, so its room is the
      column. A title in a card that names no room (the questions' columns, the offer cards) and a
      section heading drawn at title size are fitted to the column and to the room their head
      names, which are never narrower than their line.
  - **Measured** with `louder-fit.spec.ts`, which now also reads the four layouts with titles that
    the gallery's sample page does not draw (the course's map, the pricing cards, the quote, the text
    statement), and checks that every room a card names is its title's line. The sweep held every
    heading's box to its room by zeroing its `min-inline-size`, which is right for a grid item:
    its automatic minimum stretches it past its track and hides a word that runs over. For a flex
    item that minimum is the layout. On the map it is what moves the count under a long name, so
    zeroing it read a line the page never draws, and the first sweep of the map's fix still
    counted all 72. The sweep now zeroes only a grid item's minimum. Calibrated on the map page:
    the fix passes with no fault. With the row unwrapped (`flex-wrap: nowrap`, planted), it faults
    36 times on a phone, where the count must go under the name. On dev's build, where the name
    is a grid item, it still finds dev's 72. One limit stays: unwrapped at 768, the name keeps its
    width and the count runs into the sign instead, which a heading's own check cannot see, so a
    test in CI holds the row's wrap (below). The full sweep:
    - Before the map's fix, all four pages in all 8 Styles at 5 widths and 3 faces: the only
      faults were the map's 72. Every room a card names was its title's line within 0.5px, and
      at louder no heading ran past its line. After the fix and the sweep's correction, the map's
      page alone passes. The full sweep on the merged head (e1bfdcc0, PR #583; recorded with
      X72) passed with no fault: of 2,583 (heading, text) pairs the Style's size draws too wide
      (1,267 titles, 84 display statements, 1,232 section headings), none is after the fit, and
      every named room is its title's line.
    - **What it costs.** On the sample page, re-taken on dev with the same sweep, section headings
      are unchanged: 1,164 pairs drawn smaller on both, none by a different amount. The titles and
      statements now fitted take a little off words that already fit, as X66's headings do (the
      run is weighed with the face's widest-word scale). In each Style's own face that is a
      median 3.5% and at most 5.2%, and in Unbounded at most 7.3%. Over the full sweep (every
      page): titles a median 2.9%, at most 5.5%; statements 4.0%, at most 4.5%; section headings
      3.1%. In Anton the sweep reads up to
      35%, as it reads up to 49% for dev's own headings. The sweep swaps a face in as a bare
      family name, which may never take that face's own fit factor (Codex-61zsk.68).
  - **Rejected:**
    - Making each card an inline-size query container, so that `100cqi` is its room. Every kit size
      is a `cqi` token that resolves where it is used, so inside a card container every size in the
      card (title, body, small text, buttons, gaps) would be measured against the card, not the
      section, and shrink. Naming the container does not help: an unnamed query and every `cq` unit
      bind to the nearest container of its type.
    - Making the title its own container, with its text in an inner block. The canvas edits a
      heading's text in place (`textContent`, an `:empty` placeholder), which an inner element
      breaks. A container around the heading would rescale its own size, a `cqi` token, as a card
      container would. The map's `<hgroup>` is a flex row and no container.
    - On the map, a fixed track for the count, so the room could subtract it. The count's width
      differs with the count ("1 practice", "12 practices") and with the face, and a wider one
      would run into the sign. Setting the count under the name at every width was rejected as well: it
      changes every stop to fix only the long words.
    - Measuring each title in script and writing its room. The server's page and the first paint
      would draw the word cut, then jump.
    - The title size as a title's floor: the benefits grid lifts its names (X55), and a long word
      there needs to go below the unlifted size.
  - **Tests** (CI): `heading-fit.test.ts` computes the display and title rules as it computes the
    heading's: the Style's size where words fit, a long word fitted exactly, the floors, a named room
    narrower and wider than the column, the head's room, capitals, louder, and the hold. Its census
    finds the room named in each of the five layouts, an inset beside every padding or border a
    Style gives a card, the timeline and the map widened only by their reach, the map's room as its
    stop less every track beside the name and a gap for each, its stop stepped by the share its
    stops are drawn at, the map's row wrapping a name that grows from nothing and is capped at its
    track with nothing giving it a minimum of its own, and no room of nothing. `lift.source.test.ts` reads the lift from the
    title's own size and the count from `--_n`.

    Eighteen plants each failed only their own tests: the title's floor dropped, the title blind to
    its card, the display unfitted, Soft's inset dropped, Bold's tile inset dropped, Bold's card
    inset dropped, Path's margin back in place of its reach, the timeline's wide room dropped, a
    room of nothing, and on the map its room without the sign, its stop at a share its stops are
    not drawn at, Path's margin back in place of its reach, a track added beside the name with no
    room for it, its row unwrapped, the name's basis `auto`, its minimum zeroed, its cap dropped,
    and the count let shrink. In the browser, the sweep's room check fired on both plants: Soft's inset dropped read a
    room 48px too wide at every width on both pages that draw it, and the timeline's wide room
    dropped read 862.7px for a 349.9px line at 1024 and 1018.9px for 414.9px at 1440.
- **X72 · 2026-10-13 · 3c · The course's practices as one row of cards per stage: Layered stages
  (Codex-61zsk.55; BUILT, the owner approved the design and the mockup).** A fifth curriculum
  layout, `layered`, beside the timeline, the accordion, the cards and the map. Each stage is a
  heading and a row of the course's practices drawn as What's inside's picture-led cards
  (`PracticeCard`), with the card's stage line left off because the row's heading names the stage.
  The data, loading and caching design is `phase3-sources/whats-inside/data-design.md`
  §"Layered stages": no new fields, no new reads, no caching.
  - **A row is a `ScrollStrip`**: the browser's own scrolling, snapping card by card, never moving
    by itself, a labelled region ("Stage 2 · Breath") with its own previous and next buttons
    ("Previous practice in Stage 2"). The buttons sit in the stage's heading line, level with the
    heading's last line, so a row that fits pays no line for them. That needed one additive prop on
    the strip, `head`: with it, the heading and the buttons share a line above the row, and only
    the buttons hide when there is nothing to scroll or no script. Without it the strip's markup is
    as before (a test proves it).
  - **A stage of one practice is a plain card**, not a strip: nothing to scroll, so no region, no
    buttons and no tab stop. **A stage with none** shows its heading alone, and while editing a
    prompt under it points to the Curriculum tab. It never reaches the live page.
  - **The heading**: "Stage 2 · 5 practices", the stage's name as a title lifted 0.4 toward the
    heading's size (as the benefits grid's names), and the stage's line. The name is an h3 under
    the section's h2, as in the other four layouts.
  - **The name's room** (X71). Beside the buttons, the heading's room is the line (the column: the
    strip pads its line in by the same inset) less both buttons, the two gaps on the line and its
    own margin, and the strip names it (`--lp-heading-column` on its heading). With no script the
    buttons are gone and the room is understated: drawn a little small, never cut. A strip with a
    heading draws no position readout, whose width is its words' and could not be taken from the
    room. A stage of one practice, or none, has the column.
  - **The rows run to the band's edges** while every word keeps the content column: the section's
    tracks are inherited through the list and each stage, and the root is a bleed only when there
    are stages to show.
  - **Shared with What's inside**, moved out of `InsideBlock` with no change to it: the card's
    width and gap (`--lp-practice-card`, `--lp-practice-gap`, kit.css), its picture `sizes`, and
    the tile rule (a missing picture draws on the brand on the page's grounds, on the band's panel
    on a brand, accent or contrast band; Bold's curriculum is contrast and Poster's accent). Every
    picture loads lazily with the same `sizes`, so none competes with the hero and a picture both
    sections show is fetched once.
  - **Per Style.** Studio draws a hairline over each stage, Bold its ink rule, Soft none. The rule
    is the stage's first grid row, on the content column, so it spans the heading's whole line, the
    buttons too. The layout places that row and never draws it: an empty row would still take a
    gap in every Style, so it exists only where a Style gives it content. The stage's number is
    drawn with the eyebrow's dials, so it is a chip exactly where a Style fills its eyebrow (Soft,
    whose labels are pills whenever the brand is rounded) and the plain word everywhere else.
    Prints, Bold's card rule and the hung heads carry over by class name.
  - **The editor.** The layout picker lists it from the definition, previewed with the creator's
    own stages and pictures. When it is chosen and the page has a What's inside section that is
    not hidden, one line under the layouts: "Your What’s inside section already shows these
    practices as cards. Most pages need only one of the two." Advice only; nothing is hidden. The
    design's check read `s.enabled`; the inspector treats only `enabled === false` as hidden, so
    the check is `enabled !== false`.
  - **Vocabulary**: `layered` in `ids.ts` and its validation twin. An older web build renders the
    Style's own curriculum layout instead. No Style defaults to it, so no starter, order or band
    moves.
  - **Measured** in the gallery (Studio, Bold and Soft; light and dark; 1440 and 390; every stage
    read), with the photographs:
    - a row per stage, a region named "Stage N · Name" with "Previous / Next practice in Stage N";
      the buttons level with the heading's last line (0px off, every stage);
    - Studio's rule 1px in the line colour, Bold's 3px in the band's ink, Soft none; Soft's number
      a chip, every other Style's the plain word;
    - every row runs to the band's edges and the page never scrolls sideways; no stage line on a
      card, no link, no picture loaded early, every photograph loaded once in view;
    - a stage's name at 1440: 37.3px in Studio, 55.3px in Bold, 34.9px in Soft; none wider than
      its room.
    The gallery's course has six stages of four, so one practice and none are the unit tests'.
    The louder-fit sweep on the layered page (8 Styles, 5 widths, 3 faces) passed with no fault:
    every stage name's line is its named room to half a pixel.
  - **Rejected:**
    - A strip for a one-practice stage: a region and a tab stop with nothing to scroll.
    - The buttons under each row, as the strip drew them: every stage would pay a line, empty on
      rows that fit.
    - The rule on the strip's button line: that line pads itself in from the band's edge, so its
      border would run the band's full width.
    - A Soft rule for the chip: the eyebrow's dials already say which Styles fill a label.
    - Hiding What's inside, or the curriculum, when both show the cards: the creator decides.
  - **Tests** (CI):
    - `CurriculumBlock.svelte.test.ts`: every layout's shared checks, with the selector taught the
      card and each card's spoken text read part by part; and 8 for this layout (rows and their
      labels, the count, one practice as a plain card, an empty stage and its prompt, no stage
      line, the tile per scheme, lazy pictures with `sizes`, the bleed only with stages);
    - `ScrollStrip.svelte.test.ts`: without `head` the markup is as before; with it the heading
      leads; only the buttons hide;
    - `layers.source.test.ts`: the rule's row is placed, never drawn, by the layout; Studio's and
      Bold's rules; no other Style's; the number's dials;
    - `SectionInspector.svelte.test.ts`: the note with What's inside, the moment the layout is
      chosen, and none for a hidden one, none without one, none for another layout;
    - `heading-fit.test.ts`: the strip heading's room, evaluated with distinct sizes, is the line
      less the two buttons, two gaps and the margin.
    - Calibrated: 16 unit plants, each failing only its own test; in the browser, a room that counts one button faults at every width
      (the room 44px wider than the line), and a page that never loads faults at each width while
      the rest of the run still reads.
  - **The sweep** (`louder-fit.spec.ts`) reads the layered page, and its room check reads a strip
    heading's line too (a section's `--lp-heading-column` elsewhere is a cap, not a line). An hour
    of a run was once lost to one slow worker, so a page that does not load is now a fault and the
    run goes on, and faults are printed as each page is read.
- **X73 · 2026-10-13 · 3c · The Type facet's mechanism, drawing nothing new (Codex-61zsk.56, part
  one; BUILT. The owner approved the data design, `phase3-sources/type-facet/data-design.md`, from
  the D0 spike's option B′, 05 §6. Three choices below were decided without the owner, each marked.)**
  A page can name another Style's Type, `design.facets.type` (Bold, Poster, Soft or Quiet): that
  Style's sizes, weights, case, tracking and leading and its fitted hero, in the page's own faces.
  The page keeps its own surfaces, marks, motion, spacing and order. This part builds the mechanism
  with an empty allow-list, so no page can draw a borrowed Type yet and every page draws exactly as
  before; part two proves each pair (its hero fit, the louder sweep with a Type axis, Poster's Type
  under Bold's lift) and lists the ones that pass.
  - **The data.** `TYPE_FACETS` in `ids.ts` and its validation twin (pinned by
    `ids.parity.test.ts`), `facets` on the kit's `PageDesign` and on shared-types' `SectionDesign`,
    and `TYPE_FACET_BASES`, the allow-list, a Type list per Style, empty. The write boundary
    (`pageFacetsSchema`, on both design schemas) degrades an unknown Type to the Style's own, never
    a failed save. `upgradePage` carries a Type its Style may take and drops any other, so the
    editor's next save wipes it.
  - **Decided without the owner: the allow-list is checked on read, not at the write boundary.** The
    data design put both checks at the boundary. Which Style may take which Type is checked where a
    page is read (`readPageFacets`, by the renderer and by `upgradePage`), so the boundary checks
    only the vocabulary and the list lives once, in `ids.ts`. A pair taken off the list later must
    stop drawing on the pages saved before, which only a read can see; a second copy at the boundary
    would also need the default Style's twin. Rejected: both checks (two copies of a list that
    changes with every proof).
  - **Decided without the owner: the root always names its Type.** The data design set
    `data-lp-type-facet` only for an allowed pair. The renderer sets it on every page, to the
    page's own Style unless it borrows one, and every Type rule is keyed on it. A Type rule then
    weighs exactly what it weighed keyed on the Style, one attribute for one, so no specificity
    moves (the corners dial still wins by one attribute, X34's continuous fit still beats its
    steps). Rejected: setting it only for a borrowed Type, which needs every Type rule written
    twice, once per key.
  - **Decided without the owner: the filing.** TYPE is how the words are set: sizes, weights, case,
    tracking, leading and hyphenation, a line's measure in `ch`, the hero's fit
    (`--lp-display-scale`), and the heading fit's face and run. The spike filed rhythm (padding,
    margin, gap, the column and the section pads) under Type as well. Here spacing stays the
    Style's: the design's own list for the Type ("faces, sizes, case, tracking, leading") names no
    spacing; a borrowed column width or section pad would reflow every band, which is not a
    headline; and every one of the 26 rules outside the roots that set spacing alone is a Style's
    own arrangement (a gallery's gaps, a caption's inset, a portrait's margin). Also the Style's: a
    centred line's balance (`text-wrap`, which answers the centring), a title's lift (a layout's
    hook, `Heading.svelte` says so), a button drawn as a link (`text-decoration`), and Cinematic's
    titles lit from behind (`text-shadow`, a light in the accent). Rejected: the spike's filing,
    and filing by property alone, which would have moved Soft's card padding away from its border.
  - **The re-key.** 66 rules in the eight sheets move from the Style's key to the Type's, whole: an
    attribute for an attribute. Each Style's root splits in two, its Type
    (`.lp[data-lp-type-facet='<id>']`) and the rest, and five rules split the same way: Bold's
    stage list (the block's size stays, the name's size moves), Bold's stat label (its type moves,
    its ink stays), Cinematic's opening card (its display step moves, the card stays) and Bold's
    credentials in their two variants (the weight moves, the rules stay).
  - **The couplings** (the data design's H1–H15), each a Style's device that carries type and stays
    the Style's, whole: Bold's lift (H1: its clip is measured in the headline's em, read from the
    Type's size), Bold's stage number (H9: the block's size, the Type's tracking token, so it
    follows whichever Type is drawn), Cinematic's scroll numerals (H10), Poster's sticker (H15) and
    Poster's chapter figure, a device as H10's numerals are. H2 and H3 are part two's proofs.
  - **The gallery** takes `?type=<id>` (`proofType`), which draws any pair, listed or not, so a pair
    is measured before it is offered. A page never passes it.
  - **Measured: nothing changes.** Every element's computed style (and its `::before` and
    `::after`) and every kit token on the root and each section were read before and after the
    re-key: the full gallery page and five layout pages (every section type at each of its
    layouts, the hero again at its medium and long fits), 8 Styles, 1440 and 390, light (and dark
    on the full page). 336 cases and 154,207 paths, none changed by the re-key. The one case that
    differed drew a missing-picture tile where a photograph failed to load in the earlier run (CSS
    cannot add an element; every other path matched), and the same case read twice on the final
    head is identical. The probe is calibrated: with the gallery's `?type=poster` on Bold's and
    Soft's pages, 717 of 1,276 and 1,004 of 1,296 paths change.
  - **What a borrowed Type draws** (the gallery's proof, none offered): a section heading takes
    the Type's size and case (Bold's 90.2px is 74.6px in capitals under Poster's Type and 41.6px
    under Quiet's; Soft's 51.2px is 90.2px under Bold's), while the column, the corners and the
    buttons' padding stay the page's (Bold 82rem, Soft 68rem, Clean 76rem, Quiet 64rem), and no
    page scrolls sideways at 1440 or 390.
  - **Tests** (CI):
    - `type-facet.test.ts`, read from every sheet and block: each rule keyed on the Type or on the
      Style, never both (a second key may sit inside `:where()`); nothing but type on a Type's key;
      no type on a Style's key but for the five devices, each of which must still name a rule; no
      token declared by both a Type's root and a Style's; every Style has a Type root;
    - `facets.test.ts` (the reader, with a list of its own), `upgrade.test.ts`,
      `PageRenderer.svelte.test.ts` (the root always names its Type; a pair off the list, an
      unknown Type and a stray bag draw the Style's own; the proof draws any pair),
      `ids.parity.test.ts`, and the validation schemas' tests.
    - Calibrated: 13 plants (6 on the data path, 7 on the guards), each failing its own tests, and
      a second key inside `:where()` passing.
  - **No new request, no cache change.** The Types use the page's own faces, and the facet travels
    in the page document as the dials do.
- **X74 · 2026-10-13 · 3c · The Type facet's menu: each pair proved, refitted or dropped
  (Codex-61zsk.56, part two; BUILT. The owner's recommendation in the data design, verbatim: "keep a
  pair if it passes and drop it if it doesn't, decided by the measurement". Four choices below were
  decided without the owner, each marked.)** Part one (X73) built the mechanism with an empty
  allow-list. This part measures every pair the data design proposed (4 Types on 6 bases, 20 swaps)
  and lists the ones that hold: 15 of the 20 (Bold's page Poster's, Soft's and Quiet's; Clean's page
  Bold's, Soft's and Quiet's; Soft's page Quiet's; Cinematic's page all four; Poster's page Bold's,
  Soft's and Quiet's; Quiet's page Soft's; Path's and Studio's none, as the data design set: their
  marks read the type's numbers).
  - **Decided without the owner: a pair is held to its base's own page, not to a fixed line.** Each
    pair is drawn twice in one page load, once in the borrowed Type and once with the root's Type
    set back to the base's own, the control. At every headline length from 20 to 120 characters, in
    four word families (plain, and a long word first, between and last), in brands 0 and 3, the pair
    must end no further past a 1440 × 900 fold than the control, cut no word the control keeps
    whole, lay nothing over the poster's picture that the control keeps clear, and at 390 run no
    glyph past the column. Why: the controls miss too. X34 fitted each curve on two wordings, and
    other wordings of the same length end up to 42px past the fold on a Style's own page (Clean's
    split and poster, Soft's poster, Cinematic's split, Bold's centred by 1px). That is X34's to
    fix,
    filed as Codex-z9kl4; held to an absolute line, a pair would be cut for its base's miss.
    Rejected: an absolute fold (it blames the Type for the base), and X34's two families only (they
    hide what the sweep found).
  - **What the sweep found, before any refit** (1440, brands 0 and 3, 404 headlines a case):
    62 of the 100 pair-layouts held at full size. The other 38 drew worse than their control, from
    13 times (Poster's Type on Quiet's cover) to 373 times (Poster's Type on Quiet's statement; a
    headline can both end past the fold and cut a word): a long word such as "Transformation" or
    "Nourishment" cut where the statement's measure is narrow, or a long headline ending past the
    fold on the split.
  - **Decided without the owner: the refit is one factor per pair and layout.** `--lp-type-fit`
    multiplies the hero's display size wherever it is drawn (`Heading.svelte`'s display size,
    HeroPoster's, and the hero's entrance wrapper, below), and nothing declares it on a page's own
    Type, so
    own pages draw as before. Each pair's factor is the largest at which it holds against its
    control, found by bisection over every headline that misses at full size and then read over
    all of them, the least of the two brands, with 1% to spare as X34 kept: 36 factors, from 0.86 to
    0.98 (Bold's sheet, on Clean's page statement 0.93, split 0.88, cover 0.97, centred 0.91 and
    poster 0.93; on Cinematic's page statement 0.94, split 0.97 and centred 0.95; on Poster's page
    statement 0.98, split 0.97, centred 0.95 and poster 0.98. Poster's sheet, on Bold's page
    statement 0.92, split 0.92, cover 0.88 and centred 0.86; on Cinematic's page statement 0.88,
    split 0.91, cover 0.96, centred 0.91 and poster 0.95. Soft's sheet, on Bold's page cover 0.89;
    on Clean's page split 0.98 and cover 0.88; on Cinematic's page cover 0.96; on Poster's page
    cover 0.94; on Quiet's page split 0.93, cover 0.88 and poster 0.92. Quiet's sheet, on Bold's
    page cover 0.92 and centred 0.97; on Clean's page split 0.98, cover 0.92 and centred 0.96; on
    Soft's page cover 0.97 and poster 0.97). They sit in
    the Type's sheet, keyed `.lp[data-lp-type-facet='<type>']:where([data-lp-style='<base>'])`, so
    a factor weighs exactly what the Type's own rules weigh, inside `@container (min-width: 56rem)`
    (narrower, the hero is fitted to its column by its widest word, below). Rejected: refitting
    X34's C and p per
    pair (two numbers for each of up to 110 curves, five times X34's method, for a shape the
    factor already follows); one refit per Type at its worst base (the data design's H3 sketch: it
    shrinks every base for the narrowest); one factor per pair (its worst layout would shrink the
    other four).
  - **Decided without the owner: the factor holds with the hero's eyebrow too.** Read again with an
    eyebrow ("Six weeks, online": one line, as the field's hint, "a few words", has it), 39 of the
    85 offered pair-layouts drew worse than their control on 52 of 170 cases, each a headline ending
    2 to 37px past the fold. Without an eyebrow a pair may end anywhere short of the fold where its
    control does, and the factors were fitted to that room; the eyebrow's line takes it, so the pair
    crosses while its control, with room to spare, does not. Each of the 39 was searched again
    with the eyebrow, and its factor is the least of the two, so it holds either way. Rejected:
    holding a pair to the page without an eyebrow only (it is one field away for every creator); a
    second factor for a hero with one (`:has(> .hero__eyebrow)`: twice the rules for a difference
    of at most 7 points, where X34 sizes a Style's own hero the same either way). A two-line eyebrow
    is not measured, as it is not for a Style's own hero.
  - **Decided without the owner: a pair whose hero needs less than 0.85 goes.** Five pairs are not
    offered: Poster's Type on Clean's page (split 0.82), Bold's Type on Soft's page (split 0.84),
    Poster's Type on Soft's page (statement 0.71), Bold's Type on Quiet's page (statement 0.81 and
    split 0.84) and Poster's Type on Quiet's page (statement 0.74 and split 0.80). The floor was
    fixed when the search had read 11 cases, before any pair fell under it, so it is not drawn where
    the results fall. Why: a Type borrowed for its headline should draw its headline, and past 15%
    smaller the hero no longer reads at that Type's size. Rejected: no floor (Poster's Type at 0.71
    of itself on Soft's statement is no longer Poster's headline), and a floor set after the data.
  - **Bold's lift cut a mark over a capital, on Bold's own page (H2).** The data design asked
    whether Poster's leading (0.88) under Bold's lift cuts what Bold's (0.9) does not. Measured
    (`type-lift.spec.ts`): every clipped headline on each base, in each Type it may take, in four
    faces (brands 0 and 3, Anton and Unbounded), at 1440 and 390, set to descenders, ascenders and
    accents over capitals, pictured through its clip and through one too wide to cut. Poster's Type
    cut exactly what Bold's own did: in Anton, the marks of É, Å and Ö, which reach 0.38em past the
    line box, where the clip stopped at 0.3em, on 17 headlines a page, and on the hero for as long
    as the page is open (it keeps its last frame). So the fault was Bold's: its lift's last frame
    now
    opens a whole em over the first line; the first frame and the travel are unchanged, so the lift
    still starts from nothing and its line still stands still. After it: Bold's 32 reads clean, each
    seeing its planted cut.
    - The instrument: no clip at all is drawn on another compositing path, which moves pixels where
      nothing was cut, so the whole is drawn through a clip too wide to cut; a smooth scroll moved
      the page between two shots, so it scrolls instantly; a region is shot twice and must match;
      and on every page a planted cut into the first headline's own box must be seen.
  - **Poster's wipe cut its hero's marks and commas, on Poster's own page.** It keeps its last
    frame too, `inset(-0.5em -0.25em)`, but on a wrapper set in the body's em (about 8.5px), while
    the hero's marks reach 0.39em of the headline above its box and its commas 0.10em below: 28
    cuts in 18 of Poster's 32 reads, under every Type, Poster's own included, with Bold's lift
    already fixed and Bold's 32 reads clean. **Decided without the owner:** every
    hero's entrance wrapper (`.hero__enter-h`, HeroBlock) now takes the headline's display size, as
    Bold's alone did, so any entrance's clip is measured in the headline's em; the wrapper holds
    nothing but the headline, whose own size is set in the same terms, so nothing else moves.
    Rejected: widening Poster's wipe in the body's em (a number that would have to track every
    Type's display size). After it, all 64 reads are clean (Bold's and Poster's bases, every Type,
    four faces, 1440 and 390), each seeing its planted cut.
  - **A hero's long word ran off a phone's screen, on Bold's and Poster's own pages.** Read at 390,
    every pair borrowing Bold's or Poster's Type drew worse than its control on the 36 headlines
    with "Transformation" in them, in every layout but the statement, and so did Bold's own page.
    Every heading is drawn no larger than its widest run fits its room (X66, X71) but the hero's,
    which its layouts size (X34, X60): only where it is wide. At a phone's display floor, Bold's
    52px and Poster's 44px drew the word 410 and 455px wide against a 355px column. The split's,
    cover's, centred and poster's copy is a grid item whose minimum is its longest word, so the
    word ran off the screen, and the statement's, held to its column, split it mid-word.
    **Decided without the owner:** the hero's headline is weighed as every heading is, and held
    where it is wide (`--lp-heading-hold`, HeroBlock, the only hold the kit has), so its wide size
    is the layouts' exactly and below 56rem it is fitted: "Transformation…" at 390 is drawn at
    42.4px in Bold's Type and 32.8px in Poster's, Quiet's 1px overhang goes, Cinematic's comes
    down 0.8%, and Clean's and Soft's are as they were. A headline whose words fit is drawn as
    before. Rejected: a factor per pair on a phone too (it shrinks every headline for one long
    word, and leaves Bold's and Poster's own pages cut); dropping the pairs that read worse at 390
    (it blames a borrowed Type for a fault its own page has); and weighing the hero at every
    width (the wide sizes are X34's, measured to cut no word, and a weight reckons a word wider
    than it draws: X60's poster shrank 6.4% of headlines that fitted). The verify now sets each
    headline's weight as `Heading.svelte` does and reads a word split on a phone too, but in a Type
    that hyphenates there by design (Poster's, X62).
  - **Louder** (X62) with a Type axis: read in full on Cinematic's page under the four Types it may
    take. Its 26 faults were 18 on the story's scroll, a room the layout over-reckoned, and 8 of the
    instrument's (a heading's line read as a whole pixel); both are fixed in X75. The other Styles
    were not read again under every Type: X75's audit reads every heading's room against its line,
    in every layout, Style and width, and that is what a heading's fit depends on in any Type. The
    hero, which the audit leaves out, is the type-fit sweep's, above.
  - **Ink:** a CI test draws each of the four Types on every seeded page's root and reads every
    colour the page's own Type does, equal (`brand-fidelity.spec.ts`). Contrast cannot move: the
    kit grades a heading as text at every size (`schemes.css`).
  - **Own pages draw as before:** every element's computed style (and its `::before` and `::after`)
    and every kit token on the root
    and each section, on every Style's own pages (the full gallery page and five layout pages, the
    hero again at its medium and long fits; 8 Styles, light and dark, 1440 and 390), at dev's source
    and at this branch's: 336 cases and 149,370 paths. 310 differ, on three elements, and none
    moves:
    the hero headline's wrapper now takes the headline's size in the four Styles where it did not
    (294 paths; under Poster on a phone 16.35px to 44px, its box and the headline's unchanged to a
    tenth of a pixel; only the em an entrance's clip is measured in moves), and the closing ask's
    compact layout is a wrapping row (X75; 16 paths, every box unchanged). The probe sees a borrowed
    Type: on Bold's page under Poster's, 719 of 1,207 paths change.
  - **Tests:** In CI: `type-facet.test.ts` holds each factor to a pair the list offers, in that
    Type's
    sheet, keyed with its base inside `:where()`, at or over the floor and under 1, inside the wide
    container only, on a hero layout's words, once per pair and layout; `facets.test.ts` pins the
    menu itself (a change to it is a change to what creators are offered) and that no Style is
    offered its own Type, nor Path and Studio any; `PageRenderer.svelte.test.ts` and
    `upgrade.test.ts` draw and carry an offered pair and drop one off the list;
    `brand-fidelity.spec.ts` gains "every Type draws the page's own ink"; `HeroBlock.svelte.test.ts`
    holds each hero layout's headline weighed by its own widest run; and `heading-fit.test.ts`
    holds no head but the hero's headline, and that only at 56rem and wider. Opt-in, for the next
    change to a Type or a base: `type-fit.spec.ts` (`TYPE_FIT=1`, and `TYPE_FIT_SEARCH=1` to
    measure factors again), `type-lift.spec.ts` (`TYPE_LIFT=1`) and louder-fit's Type axis
    (`LOUDER_FIT_TYPES=offered`); each instrument that sets a headline's words sets its weight
    with them, as `Heading.svelte` does. Calibrated: 8 plants on the guards and the pin, each
    failing its own test; 3 on the phone fix (the hero unweighed again, failing all five layouts;
    the hold dropped, and the hold at every width, each failing the hold test); a colour in a
    Type's sheet failing the ink test; a factor taken back to full size failing the verify; and
    the lift's planted cut, seen on every page it reads.
- **X75 · 2026-10-18 · 3c follow-up · Every heading is fitted to the line its layout gives it, and
  the sweeps can see a layout that does not (Codex-61zsk.69; BUILT, decided without the owner;
  amends X66, X71).** X71 named a card's room in the layouts the louder sweep read. The sweep reads
  a section in every Style only on its four extra pages, so a layout drawn only where some Style's
  own sample draws it was read in that Style alone. Borrowing a larger Type (X74) found one: the
  story's scroll fitted its titles to the section's column, 699px at 768, in a words column of
  340px, and Unbounded under Bold's Type drew "Transformation" 363px wide, under the picture beside
  it. Cinematic's own titles are small enough to hide it; any Style with the scroll and a wide face
  showed it on dev.
  - **The audit.** A read that needs no words: every heading but the hero's, in every layout of
    every type (page k draws every type at its k-th layout), in 8 Styles at five widths, with the
    gallery's pictures and without, the room the fit divides by (`--_column`) against the line the
    heading is drawn on. Each heading is read twice: set to a long run of short words, a box that
    shrinks to its words fills its room; set to one word longer than any room, a box that grows
    from its words (the offer's band, X70) wraps its row and takes its room. A line is short only if
    it is short in both. A flex item's line is its row's (its box grows with its longest word); a
    heading capped in its own `ch` (a band's 18ch) is a count of characters, not a room; and a
    length the fit reads is probed in the face the fit reads it in (below).
  - **What it found:** five layouts over-reckoned the room. The story's scroll (699 for a 340px line
    at 768, 721 for 646 at 1440); the story's strip (328 for 240 to 256 at 360); the FAQ's columns
    (699 for 334 at 768, 1312 for 634 at 1440, and Soft's tiles on a phone); the offer's cards and
    its
    focus card (1312 for 360 to 408, and for 633, at 1440); and the closing ask's compact layout
    (699
    for 332 at 768, 1312 for 918 at 1440). Only the scroll ran a corpus word past its line. The
    other
    four were latent for its words, each drawing inside its line at its own size, but a longer real
    name, or a longer word in a wider face, would run past the card.
  - **The rooms, each named as X71's are**, from the token that draws the layout's tracks, so the
    two
    cannot drift:
    - the story's scroll, wide: half the column less the step's own gap, which places the words (a
      subgrid's gap stands in for its parents', so Cinematic's wider scene gaps do not move it);
    - the story's strip: a card is the strip's item, which the story now names itself (Clean re-sets
      it);
    - the FAQ's columns: `--_n` across, which now draws the tracks; Soft's tiles are inset by their
      padding and border;
    - the offer's cards: `--_n` across, which now draws the tracks, a lone card held to the lead's
      measure, and the focus layout's card its 7/12; a card is inset by its padding and border,
      Bold's open cards by neither.
  - **Decided without the owner: the compact ask wraps instead of naming a room.** Its offer is as
    wide as its own words, and grows with a Type's price size, so no rule can subtract it. As the
    offer's band does (X70), the words now grow from nothing beside the offer: their narrowest is
    the title's widest word at the size the fit draws it in the column, and the row wraps before
    that
    word could reach the offer. In the usual case it draws the same (every box unchanged to a tenth
    of a pixel). Rejected: a fixed width for the offer, which would wrap a borrowed Type's price;
    and a cautious room, which X71 forbids (a name that fits must not be drawn smaller).
  - **Not a fault, and why: a head names its measure as its heading's room.** Six blocks draw their
    head at the measure (`max-inline-size: var(--lp-measure)`, 62ch in the body's face) and name the
    same measure as the heading's room. A custom property is resolved where it is used, so it might
    seem the heading reads the `ch` in its own, far wider face; but the room is read in `font-size`,
    where a font-relative unit is the parent's face, the head box's. The heading's room is the box's
    own 62ch, on its line to the pixel (720.9px at 1440). A probe that resolves the room in a
    child's
    `inline-size` reads it in the heading's face (4,094px) and must not be trusted; the audit reads
    it in the parent's.
  - **The louder sweep's line.** It read a heading's line with `clientWidth`, a whole pixel, so a
    box
    that shrinks to its one word (a centred band's, a statement's) read that word as over: 8 of the
    26 faults in Cinematic's first read under Bold's and Poster's Type (the other 18 were the
    story's
    scroll, above). It now reads the content
    box's used width, unrounded and untransformed. And it read a flex item's line from its own box,
    which grows with its longest word, so it could never see a word wider than a card's row: it now
    reads the row. Calibrated: with the offer card's room taken out and its name lifted to the
    heading's size, 458 faults read from the row and 35 from the box (all in Unbounded, where a word
    outran even the widest the box could grow to).
  - **After:** 400 pages, every heading's room within half a pixel of its line, 0 faults. The
    scroll's title under Bold's Type in Unbounded at 768 is 32.3px (it was 37.4px) and ends 27px
    inside its line; the four latent layouts draw the corpus at the sizes they did.
  - **Tests:** `e2e/page-kit/heading-room.spec.ts` (opt-in, local: `HEADING_ROOM=1`, about two
    hours),
    the audit: run it on any change to a layout's columns, a card's padding or a strip's items.
    Calibrated: with four rooms taken out (the scroll's, the compact layout's wrap, the FAQ's and
    the
    offer's), a read of the two pages that draw three of them, at 768, reports 14 faults, all on
    exactly those three.
- **X76 · 2026-10-14 · 3c · Section controls, part one: every picture a creator uploads is steered
  by its focal point, a FAQ can open on its first answer, and Text's picture can follow the words
  (Codex-61zsk.58, round a; BUILT. The owner approved the mock and its data design,
  `phase3-sources/editor-3c/`, on 2026-10-13. Three choices below were decided without the owner,
  each marked.)**
  - **The focal point reaches every upload.** X64 stored the point on the picture (`ImageRef.focus`)
    and only the Picture block's full width read it. Now every block that crops a creator's picture
    steers it: the hero's own image in its five layouts (both of the poster's frames, the cover and
    the split's), Text's picture, a benefit's in the grid and the mixed tiles, a story moment's in
    the scroll (and its sticky frame), the chapters and the strip, every gallery picture, the
    closing band's background and any section's background (`SectionShell`). A library still the
    hero draws in place of an upload has no point, and is drawn as before.
  - **A picture nobody pointed draws exactly as before.** `storedFocus` answers only a point the
    creator placed: none, a malformed one or the centre is `undefined`, so `Media` writes no
    `object-position` and every saved page keeps its markup. `readFocus`, which always answers (the
    editor's dot needs a place), stays the editor's.
  - **The editor previews each layout's own cut.** `focalLayouts` names, per layout, the shapes the
    picture is cut to (`{ at: 'wide' | 'tablet' | 'phone', ratio }`); the focal tool draws one
    preview per shape, its columns in proportion to the ratios so every preview has one height, and
    is live only in a layout that cuts (it explains itself in the others, as before). An item's
    field (a benefit's, a moment's, a gallery picture's) now hears the section's layout, which it
    never did. Every image field must say where it is cut (`focal-point.svelte.test.ts`), so a new
    one cannot ship without its previews.
  - **Measured.** Every `.lp-media` frame and every section's surface, in the six types that carry
    an upload, at each of their layouts, in eight Styles at 1440 and 390 (80 loads). The probe is
    calibrated by the two frames fixed in CSS: a benefit's grid picture reads 3:2 and a strip's card
    4:5 in every Style (Studio's 1.479 is its 1.2° tilt widening the box it is read by).
  - **Decided without the owner: each preview is the Style that cuts hardest.** A Style's cut of a
    3:2 photograph keeps a band; a harder cut's band lies inside a gentler one's, wherever the point
    is. So the hardest cut shows what every Style keeps: the hero's cover is 15:8 wide (Clean; Bold
    draws 1.51) and 2:3 on a phone. Each is named as a simple ratio no more than half a percent
    gentler than the hardest measured (the mosaic's widest tile on a phone, 2.556, is named 13:5,
    not 5:2, which would have shown 2% more than it keeps). A layout whose tiles differ (the mixed
    tiles, the mosaic, the gallery's strip) previews the tile that cuts most; a tile's drift frame,
    larger than the tile so its picture can move, is not a cut. Rejected: a preview per Style (the
    field would need the page's Style, which no field reads), and the middle Style's (it shows a Style
    keeping more than it does).
  - **Decided without the owner: a background previews the middle band.** A section's shape is its
    contents' height: 0.66 to 2.21 wide and 0.18 to 0.79 on a phone across the five types measured,
    so no one cut is every band's. The preview is the middle one (7:5 wide, 1:2 on a phone).
    Rejected: the hardest cut (a sliver no creator would recognise as their band).
  - **The FAQ's first answer** (`openFirst`, the accordion only): open when the page opens, the rest
    closed until tapped; without script every answer shows, as before. It is read once, when the
    accordion is made, as the curriculum's accordion reads its first stage, so a later change never
    reopens an answer the visitor closed; the canvas redraws the list, so the creator sees the
    change at once.
  - **Text's picture after the words** (`imageAt: 'after'`, in the statement and the centred
    layouts): the head, the passage, the picture, then the ask, a band-gap off the words as it was
    above them. In two columns the picture already sits in the heading's column beside the words,
    so the choice is not offered there.
  - **Decided without the owner: a choice stores only what it changes.** A new `choice` control (a
    two-button group in the spacing dial's look) whose first option is the default and is stored as
    the absent key, so every saved page reads as it did and the stored vocabulary is only `'after'`.
    Rejected: storing `'before'` (a second spelling of every page saved before).
  - **Tests** (CI): `focal-point.svelte.test.ts` (every place, every layout: the point reaches each
    of the creator's pictures, and a picture with none has no `object-position`; every image field
    names its cuts, in layouts the field is shown in), `page-images.test.ts`, the FAQ's, Text's and
    the inspector's (the choice stores only "after"; the open-first toggle shows only in the
    accordion; the background's and a benefit row's focal tools steer by arrow keys). Calibrated: 9
    plants, each failing its own tests, every file restored.
  - **In the browser** (the gallery's `?set=` and `?focus=`, in 8 Styles at 1440 and 390). Text's
    picture after the words, light and dark, both layouts: all 64 read head, passage, picture, ask,
    nothing overlapping, the picture as far off the words as the ask is off the picture. With a
    point, every one of the 15 sample pictures in Benefits, Gallery, Picture, Story and Text is
    steered by it, in every Style at both widths; without one, none writes an `object-position`
    (Picture's full width included). The FAQ opens on its first answer and only that (Bold and
    Soft, both widths). One read was redirected by the local `api` rate limit (the studio's
    membership check, about 20 pages a minute) and was read again on its own.
  - **No new request, no cache change.** The point travels in the page document with the picture.
- **X77 · 2026-10-19 · 3c · Section controls, part two: a face for each quote, a mark for each
  benefit, and the row that leads (Codex-61zsk.58, round b; BUILT. The owner approved the mock and
  its data design, `phase3-sources/editor-3c/`, on 2026-10-13, initials only once one quote has a
  photo included. Three choices below were decided without the owner, each marked.)**
  - **A face for each quote.** A quote the creator adds may carry their photo of the person
    (`photo`, an upload with its focal point; the field is decorative, since the name is what
    reads). Once one quote in a section has a photo, every named byline leads with a 2.5rem circle,
    the photo or the name's initials, the course's own quotes included, so the names line up; a
    quote with no name has no circle, and a section with no photo draws exactly as before. The
    face is `Media`'s, so a photo that fails to load falls back to the letters, and it is steered
    by its focal point in all five layouts (`focal-point.svelte.test.ts`). `initials` moves to
    `kit/model/`, shared with the guide's medallion.
  - **Decided without the owner: the initials sit on the panel, as the guide's face does (X57).**
    `--lp-panel` in `--lp-panel-ink`, the kit's text ink computed against the panel itself in every
    scheme (at least 4.58:1, schemes.css fact 1), inside a hairline of the section's own line: on
    Bold's near-white ground the panel is near-white too, and without the line the letters seemed
    to float. Rejected:
    the section's filled scheme, which the census sketched from `Media`'s mark: in Highlighted's
    panel and the wall's first tile the circle would be the panel's own colour, and vanish.
  - **A mark for each benefit.** One of twelve platform icons (`kit/model/marks.ts`, a closed
    list read through `readOneOf`, so anything else reads as none). In Grid, Side by side and Mixed
    tiles it sits above the item's name; in Checklist it takes the tick's place. The editor picks
    it from tap-sized cells (a new `mark` control); choosing it again takes it away.
  - **Decided without the owner: two inks, each where it was.** A mark above a name paints its
    stroke in `--lp-mark-ink`, the graphic grade (§5: a drawn mark, never the colour of text; the
    kit's guard test holds every file to it, and the mark obeys it through `stroke`, not `color`).
    In Checklist the chosen icon keeps the tick's own box and ink, `--lp-accent`, the stricter text
    grade, so every checklist saved before draws in the colour it did. Rejected: moving the tick
    to the mark ink (every checklist page changes colour), and the accent for the new marks (the
    contract keeps it for text).
  - **The row that leads.** A definition may say which stored entry its layout draws larger
    (`leadingItem`): the testimonials' Highlighted, Big quote and Wall, the mixed tiles' first, the
    mosaic's first picture. The inspector tags that row "Leads" (to a screen reader, "…, leads in
    this layout"); nothing is stored.
  - **Decided without the owner: a creator's quote leads only when the course has none.** The
    course's own testimonials are drawn first, so while it has any, no row the creator wrote is
    tagged. Rejected: the first row always (it would tag a quote the page does not lead with).
  - **In the browser** (the gallery's `?faces=1` and `?marks=1`, in 8 Styles at 1440 and 390).
    Faces, all five layouts (80 reads): each of the 320 named bylines leads with a round 2.5rem
    face (38.4px at the brand's density) beside and level with its name; the 80 photos loaded, the
    240 sets of initials fit their circles, and no byline runs past its card, the wall's narrow
    tile and the strip's 22rem card included. Marks, all four layouts (64 reads): each of the 256
    marks is drawn before or above its own item's name and inside it, its stroke the mark ink
    (Checklist's, the tick's accent), nearly all on a scheme where the two inks differ, so the read
    can tell them apart. 144 reads, no faults, on the final code (the initials' ring included).
  - **Tests** (CI): `TestimonialsBlock.svelte.test.ts` (no face before a photo; in every layout,
    the photo and every other named quote's initials; a stray photo value is no face; the quote
    that leads, and none while the course's come first), `BenefitsBlock.svelte.test.ts` (unknown
    marks dropped; the checklist's tick replaced in place, `check` drawing the tick itself; above
    its own item's name in the other three; the mixed tiles' lead), `focal-point.svelte.test.ts`
    (the face steered in every layout; `testimonials.photo` names its cuts) and
    `SectionInspector.svelte.test.ts` (the picker stores and takes away a mark; the Leads tag where
    a layout leads, and only there; a quote's photo gets its focal tool). Calibrated: 14 plants,
    each failing its own tests, every file restored; and the one the first run missed (the mark's
    `aria-hidden`, which `IconBase` already sets) planted as an exposed mark, which fails.
  - **No new request, no cache change.** A face is the page's own upload at its smallest stored
    size; a mark is an icon the bundle already carries.
- **X78 · 2026-10-19 · 3c · The editor for the page's dials and its headlines from another Style
  (Codex-61zsk.59, D4; BUILT. The owner approved the mock and its data design,
  `phase3-sources/editor-3c/`, on 2026-10-13: "all your recommendations are just perfect".
  Three choices below were decided without the owner, each marked.)** X61 and X62 gave a page five
  dials and X73 and X74 a menu of headline Types, and until now the gallery's `?dials=` was the
  only way to set them.
  - **Where.** The Style tab, between the Styles and the page's brand, as one group, "Adjust
    Bold": each dial is "the Style, one step either way", so the Style and its dials read as one
    decision in two steps. Each dial is three buttons; the middle one is named after the Style
    ("Bold's") and is the dial's reset: pressing it deletes the dial from the page. Colour,
    corners, spacing, then Headlines (the Type's swatches, then the size dial), then motion, whose
    canvas holds still while editing, so its note points to Preview. "Use Bold's own for all of
    these" shows only while something is adjusted, takes everything off in one undo step, and
    says so. The Page tab's inspector gains one line, what the page adjusts ("Adjusted: Less
    colour · Rounder corners · Quiet's headlines.", or "Not adjusted: Bold's own throughout."),
    and no controls of its own: there is one place to change a dial.
  - **The store.** `setPageDial`, `setTypeFacet` and `resetPageLook` beside `setPageStyle`. A step
    already set, an unknown step and an off-menu Type are no-ops (no undo step, not dirty). The
    Style's own deletes the key, and an emptied bag is deleted, never kept as `{}`: the dirty check
    compares JSON with a load, which never holds an empty bag, so `{}` would read as an edit nobody
    made. A Style change that the page's Type cannot follow takes the Type off in the same step,
    so one undo brings both back, and the panel says so ("Clean keeps its own headlines, so
    Poster's headlines came off this page. Undo puts them back."). Saving is unchanged: the whole
    `design` bag is written, so a reset (an absent key) persists.
  - **Steps that change nothing say so, from the kit.** `dialNoEffect` (`kit/model/dial-effect.ts`)
    computes colour from each Style's own sample page, every type in its order, resolved with the
    step and without it: exactly X61's list (more colour in Bold and Poster, which have no soft
    tints; less colour in Cinematic, which has no coloured bands to bring down; both in Quiet,
    which draws no bands). Corners is a short table, as CSS is not resolved in a unit test:
    `rounder` is Soft's own recipe, and `brand` is Path's own corners.
  - **Decided without the owner: each reason names its step, and one reason is said once.** A
    dial's three steps share one note, so the mock's "In Bold this changes nothing: Bold has no
    soft tints.", shown while the Style's own step is pressed, read as that step doing nothing;
    and in Quiet, where both colour steps have one reason, the mock said it twice (found in the
    browser). Now: "“More colour” changes nothing in Bold: Bold has no soft tints.", and "Neither
    step changes anything in Quiet: Quiet draws no colour bands." Rejected: a note per step, read
    only for that step, which would hide from sight what a step does until it is pressed.
  - **Decided without the owner: Path's "Your brand's" changes nothing only for a rounded brand.**
    The data design said `brand` is a no-op for Clean and Path, marked UNVERIFIED for chips. Read
    against the sheets: Clean draws its chips at the brand's radius, where the dial draws pills, so
    it changes Clean's chips and is not listed; Path's chips are pills wherever the brand is
    rounded at all (`--lp-radius-pill-if-rounded`), so there it changes nothing, but a square
    brand's chips are square on Path and the dial makes them pills. The panel reads the brand's
    radius (the brand editor's pending one while it is open) and says "changes nothing" only where
    it is true. Rejected: the mock's unconditional note, which a square brand would see change.
  - **The headlines.** Only the proven swaps for the page's Style (`TYPE_FACET_BASES`), two to a
    row, each a real `.lp` root drawing the page's own headline in that Type's tokens; the Style's
    own swatch names its own Type on its root, as `PageRenderer` always does, since every Type's
    rules are keyed on it. Path and Studio say why they take none ("its marks are measured against
    them"). Each Style card shows the page as it would be in that Style, its dials included and its
    Type where that Style may take it; the section gallery previews a new section the same way.
  - **Decided without the owner: the spacing note says where the size comes from.** The data
    design found "{size} is the default for this layout" wrong once the page's spacing dial is set.
    `spacingSource` (beside `resolveSpacing`, in its order: the section's own, a compact layout,
    the page's dial, the default) lets the inspector say "Large, from the page." exactly where the
    dial gave it; a compact layout still outranks the dial and says so. Rejected: restating the
    order in the inspector, which could drift from the resolver.
  - **Keyboard and screen readers.** Every control is a labelled group of toggle buttons
    (`aria-pressed`), the pattern the Style cards, layouts, colours and spacing already use: Tab
    moves, Space or Enter presses. The middle step reads "Bold's, the Style's own"; each step is
    described by its dial's note, a no-op's reason included; a reset or a dropped Type is a polite
    status; the reset leaves focus on the colour dial's own step.
  - **In the browser** (the real builder on studio-alpha's test page, Bold, 1440; every save
    refused in the browser, both of autosave's attempts counted, and the page's stored row the
    same before and after): Bold's own steps pressed, "More colour" quieter with its reason;
    less colour, rounder corners and Poster's headlines on the canvas at once (`data-lp-corners`
    `rounder`, `data-lp-type-facet` `poster`), the size dial's own step renamed "Poster's"; a
    change to Path took Poster's headlines off and said so ("Path keeps its own headlines, so
    Poster's headlines came off this page. Undo puts them back."), with Path's reason under
    Headlines and "Your brand's" quieter for this rounded brand; Quiet's colour steps one reason,
    said once; the reset said "Back to Quiet's own." and left focus on the colour dial's own
    step. The first run found the note's unnamed, repeated reason (above).
  - **Tests** (CI): `page-builder-store.test.ts` (each writer writes and deletes, deletes the empty
    bag, refuses an unknown step and an off-menu Type, is a no-op at its step, is one undo step;
    a Style change takes an unfollowable Type off in the same step and keeps one it can take; the
    reset takes both off as one step), `dial-effect.test.ts` (the computed colour no-ops are X61's
    list; the corners table, Path's for a rounded brand only; spacing, size and motion always
    change), `StylePanel.svelte.test.ts` (the own step named and pressed; a step written and taken
    off; each no-op reason naming its step, Quiet's two said once; each Style's menu, its own Type
    named on its root; Path's reason; a Type dropped by a Style change and the status; the cards
    with the page's dials and Type; the reset, its status and focus; Preview; the gallery's
    previews) and `Inspector.svelte.test.ts` (the page's summary line; "from the page" only where
    the dial applies). Calibrated: 14 plants, and 2 for the note's reasons, each failing its own
    tests, every file restored.
  - **No new request, no cache change.** The dials and the facet travel in `design`, saved as
    every edit is; the studio is client-rendered, and the panel is mounted only while the Style
    tab is open.
- **X79 · 2026-10-19 · 3c follow-up · A film section with no film folds before the bands resolve
  (Codex-61zsk.57, a bug; decided without the owner, with the reasons and what was rejected.)**
  A Video or Preview section whose film was not coming hid itself in CSS (`.video-none`,
  `.preview-none`, Codex-61zsk.37), but `resolveSections` still counted it as a band, so the
  sections either side could take one colour and meet as one slab. Counted across every Style,
  with a film section between each pair of banded sections after a hero: 151 of 1,800 shapes for
  Video and 156 of 1,800 for Preview put two bands of one colour together on a visitor's page.
  Folded first, none does.
  - **The fold.** `foldForVisitors` drops a Video section when the intro film is known not to
    come, and a Preview section when the preview film is, with the empty Pictures and Headings
    and the dead Buttons (X64), so no band rule counts it. A Button that jumps to it folds too, as
    for any section that is gone. The canvas and stills keep every section, as for every fold:
    there it asks for its film. So, unlike X64's folds (each a simple section, which never moves
    a band), this one can recolour an ordinary band: a section after a folded one, or before it
    under the vivid colour dial, which reads the next band, can take another colour on a
    visitor's page than on the canvas and stills, while the film is missing.
  - **The rule, once.** Whether a film is coming is one function, `filmToShow`
    (`kit/model/films.ts`): here, `true`; known not to come, `false` (the awaited view says none
    is attached, or the stream settled without it, or failed); on its way, `undefined`. The
    Video and Preview blocks, a preview Button and the page all read it, so the band rules and
    a block that hides itself cannot disagree. A block drawn on its own still hides itself.
  - **Decided without the owner: the fold follows the stream.** The page reads the settled stream
    (`settled()`, as the blocks do) and folds again when it settles: from the first paint when no
    film is attached, once the stream settles when an attached film does not come, and back for a
    film that arrives anyway. On the server nothing has settled, so the first paint folds only
    what the awaited view knows, and hydration matches it. Rejected: folding once, from
    `filmsAttached` alone, which would hide a film the creator has just attached while the
    awaited view still says none (Codex-61zsk.40 keeps that film showing on purpose); and keeping
    the section in the page but skipping it in the band rules, which would leave a Button that
    jumps to it pointing at nothing.
  - **Decided without the owner: a preview Button takes the same rule.** It was dead whenever the
    awaited view said no film, even when the film then arrived; it now plays a film that arrives
    anyway, as the Preview section shows it.
  - **In the browser:** not run. The change is which sections the renderer draws and the colour
    each band resolves to, both asserted on the real `PageRenderer` in the component tests; the
    colours themselves are the schemes' own, unchanged.
  - **Tests** (CI): `films.test.ts` (here, attached or not; none once the stream settles or fails;
    none from the first paint when none is attached; on its way while pending; each film its
    own), `simple-sections.test.ts` (Video and Preview fold only for their own film; a Button to
    a folded section folds), `PageRenderer.svelte.test.ts` (on Clean, Benefits and Testimonials
    no longer meet as two soft tints, and the canvas keeps the Video; folded from the first paint
    and back for a film that arrives anyway; held while an attached film is on its way and folded
    when the stream brings none; Preview the same; the pages meant to draw every section now bring
    their films), `ButtonBlock.svelte.test.ts` (folded once the stream settles without a film;
    plays one that arrives anyway) and `canvas-parity.svelte.test.ts` (no band at all for a film
    section with no film; the canvas, those sections set aside, is the public page). Calibrated: 8
    plants, the original bug first (Testimonials back to a soft tint beside Benefits), each
    failing its own tests, every file restored.
  - **No new request, no cache change.** The page reads the stream the blocks already read.

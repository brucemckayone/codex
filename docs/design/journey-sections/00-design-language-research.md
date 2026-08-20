# Journey sections — the design-language axis model

**Status:** research, implementation-ready. Round 0 input for the section-expansion programme.
**Audience:** the engineer adding configuration knobs to `apps/web/src/lib/page-builder/render-edit/sections/*.svelte`.
**Scope:** how one set of 11 section components expresses many design languages without becoming 11 × N bespoke components.

> This is an **expansion, not a replacement**. Today's single aesthetic — dark ink, ember bloom, cinematic
> letterboxing, serif display — survives intact as the **Candlelit** preset (§4.1). Every mechanic that
> produces it today is preserved; it simply stops being the only reachable point in the space.

---

## 0. What the codebase already decides for us

Read before proposing anything. Four facts constrain the whole model.

### 0.1 The colour layer is already solved, twice over

`apps/web/src/lib/page-builder/journey-palette.css` derives a full ladder from **one** input
(`--jp-ink` ← `--brand-bg` ← `--color-background`) and auto-contrasts every rung off the ink's own
OKLCH lightness. Insets (`--jp-ink-2/3/4`), text (`--jp-text/dim/faint`), hairlines
(`--jp-line-subtle/line/strong/hover`), accents (`--jp-ember`, `--jp-ember-text`, `--jp-on-ember`,
`--jp-blood`, `--jp-rose`) and atmosphere (`--jp-atmos-veil`) all follow from it, and the dark pole
re-points that single property and nothing else.

**Consequence: colour is not an axis.** Any axis proposing colour values is duplicating this file.
The axes below *deploy* the ladder; they never define colour.

Two hard-won constraints in that file that the axis work must honour:

| Constraint | Why | Axis impact |
|---|---|---|
| `--jp-ember` is a **fill**, not text — it measures 2.98:1 on dark ink, 2.46:1 on light. `--jp-ember-text` exists precisely for text. | Documented in the file with measured ratios. | `accent: 'text'` MUST resolve to `--jp-ember-text`. Never `--jp-ember`. This is the single most likely regression in the whole programme. |
| Re-pointing `--color-background: var(--jp-ink)` on the *same* element is a custom-property cycle. That is why `.journey-palette` and `.journey-palette--page` are two classes. | Documented. | `surface: 'invert'` cannot be implemented by re-deriving `--jp-ink` from `--jp-heading`. See §2.4 for the two-pole refactor that makes it safe. |

### 0.2 The brand layer already owns four scale multipliers

`apps/web/src/lib/styles/tokens/org-brand.css` already exposes, at **org** scope:

```
--brand-density-scale  →  --space-unit: calc(0.25rem * var(--brand-density-scale))
--brand-text-scale     →  --text-scale, multiplied into --text-5xl / --text-display
--brand-shadow-scale   →  --shadow-strength: calc(1% * var(--brand-shadow-scale, 1))
--brand-radius-base    →  --radius-base  (and thus every --radius-*)
--brand-heading-weight / --brand-body-weight / --brand-text-transform-label
--brand-font-heading / --brand-font-body
```

**Consequence: the axes must MULTIPLY onto these, never replace them.** A creator who set org density
to 0.9 must still get 0.9 relative behaviour on a journey page. Concretely: the density axis emits a
unitless `--jp-rhythm`, and the section's padding is `calc(var(--space-16) * var(--jp-rhythm))` — so
`--brand-density-scale` is still in the chain via `--space-unit`.

It also means **typeface and weight are not axes**. They are brand inputs. This resolves what would
otherwise be a broken axis: luxury-minimal and brutalist both want a *monumental size jump* but
opposite weights (light vs heavy). Split the concerns — the axis owns the **scale**, the brand owns the
**face and weight** — and both families land correctly from one axis value.

### 0.3 The section contract has an additive seam

`packages/shared-types/src/journeys.ts`:

```ts
export interface PageSection {
  readonly id: string;
  type: string;
  enabled: boolean;
  variant?: string;   // "which composition" — optional, widenable, falls back to type default
  name?: string;
  props: SectionProps;
}
```

`variant` is already the composition slot. There is no treatment slot. `design?: SectionDesign` is the
additive field (§2.6), and `JourneyCoursePage` already carries per-page `brandOverrides`, which
structurally mirrors the brand-editor state — that is where page-scoped brand inputs (radius, fonts)
belong, not in a section axis.

### 0.4 Sections are container-query scoped, and their padding is hardcoded

`render-edit/journey-sections.css` sizes everything in `cqw` against a container, with literals:

```css
.jps        { padding: clamp(2rem, 6cqw, 4.4rem) clamp(1.4rem, 6cqw, 4rem); }
.jp-prose   { padding: clamp(2.6rem, 7cqw, 4.6rem) clamp(1.4rem, 6cqw, 3.4rem); }
.jp-hero__headline { font-size: clamp(1.8rem, 6.6cqw, 3.6rem); }
```

Two implications. First, the container-query scoping is **correct and should be kept** — the builder
canvas renders sections at 375/768/1440 widths and `cqw` is why that works. The axis attributes
therefore belong on the element that establishes the container. Second, those `rem` literals are the
density and type axes waiting to be extracted; every one of them becomes
`clamp(calc(A * var(--jp-rhythm)), Ncqw, calc(B * var(--jp-rhythm)))` or a `--jp-display-*` read.
This is a token-compliance fix the programme gets for free.

---

## 1. Design-language families

Nine families. Each is defined by a **mechanical signature** — measurable choices, not adjectives. No
family here is distinguished by colour alone; colour is §0.1's problem and it is already solved.

Column key for the tables:

- **Ratio** — the type scale ratio (each step multiplies the last).
- **Measure** — target body line length in `ch`.
- **Rhythm** — vertical spacing multiplier relative to 1.0 = today's section padding.
- **Edge** — border and elevation material.
- **Accent** — how the brand accent is deployed.

### 1.1 Editorial / Magazine

**Position:** writers, essayists, researchers, thought-leadership. High-ticket knowledge products sold
on the strength of the prose itself. The reader must believe the author can write.

| Mechanic | Value |
|---|---|
| Type scale ratio | 1.333 (perfect fourth) — many usable steps |
| Display face role | Serif at normal weight, sized 2–3 steps above body; it is a *heading*, not a poster |
| Measure | 62–68ch |
| Vertical rhythm | 1.0× |
| Alignment | Left, ragged right. Headings share the body's left edge |
| Edge treatment | Hairline horizontal rules only. No box borders anywhere |
| Corner radius | `--radius-none` to `--radius-xs` |
| Surface | Bare — the page's own ink, no panels. Content sits *on* the page |
| Colour deployment | Accent as **text**: kickers, drop-cap, link underline, footnote markers |
| Shadow / elevation | None |
| Motion | Fade + rise on scroll entry, short distance, no stagger |
| Image treatment | Framed with a visible caption line, inset to the measure. Never bleeding |

**Tell:** the eyebrow and the body share a left edge, and there is a hairline under every section head.

### 1.2 Brutalist / Utilitarian

**Position:** developer courses, trades, indie-hacker "no fluff" positioning. The design's job is to
signal that no budget went into design — which reads as budget going into content.

| Mechanic | Value |
|---|---|
| Type scale ratio | 1.5+ — few steps, enormous gaps between them |
| Display face role | The **body** face at heavy weight, or the mono face. No separate display face |
| Measure | 45–52ch (deliberately tight, high line count) |
| Vertical rhythm | 0.75× — cramped, information-dense |
| Alignment | Left flush, with the grid visible as actual lines |
| Edge treatment | `--border-width-thick` (2px) on every block, plus a hard offset drop with **zero blur** |
| Corner radius | `--radius-none`, absolutely |
| Surface | Panel — every block is a visible box |
| Colour deployment | Accent as **fill**: solid rectangles of it, text reversed out |
| Shadow / elevation | Hard offset only (`Npx Npx 0 0`), never blurred |
| Motion | None. Instant state changes. Optionally a marquee |
| Image treatment | None, or unframed and full-bleed. No rounding, no scrim |

**Tell:** 2px borders with a hard un-blurred offset shadow, mono labels, and radius 0 everywhere.

### 1.3 Soft-organic / Wellness

**Position:** yoga, breathwork, somatics, therapy, coaching. The current product's actual dominant
customer. The page must feel like an exhale.

| Mechanic | Value |
|---|---|
| Type scale ratio | 1.2 (minor third) — gentle, no shouting |
| Display face role | Humanist serif or rounded sans at light-to-normal weight |
| Measure | 58–64ch |
| Vertical rhythm | 1.25× — air is the message |
| Alignment | Centred, generous |
| Edge treatment | **None.** No borders at all. Separation comes from space and soft elevation |
| Corner radius | `--radius-xl` on panels, `--radius-full` on controls |
| Surface | Tinted — soft washes and gradient blooms, low chroma |
| Colour deployment | Accent as tinted background + accent text. Never a hard fill |
| Shadow / elevation | Large, very diffuse, very low opacity |
| Motion | Slow fade, long stagger, gentle drift |
| Image treatment | Masked — arch, oval, or soft blob clip-path |

**Tell:** no border anywhere, pill controls, and a shadow you have to look for.

### 1.4 Luxury-minimal

**Position:** photography workshops, architecture, high-ticket masterclasses, craft at the top of the
market. Restraint is the price signal.

| Mechanic | Value |
|---|---|
| Type scale ratio | 1.618 — and only three sizes used on the whole page |
| Display face role | High-contrast serif, or a wide-tracked sans, at light weight |
| Measure | 52–58ch |
| Vertical rhythm | 1.5× — the emptiness *is* the design |
| Alignment | Centred; labels uppercase with `--tracking-wider` or wider |
| Edge treatment | A single hairline, used perhaps twice on the page |
| Corner radius | `--radius-none` or `--radius-xs` |
| Surface | Bare |
| Colour deployment | Accent **absent**. Monochrome from the ladder; the accent appears at most as one hairline |
| Shadow / elevation | None |
| Motion | Slow fade only. No transform |
| Image treatment | Inset with an enormous margin, or a single full-bleed plate. Nothing in between |

**Tell:** three type sizes, one hairline, no accent colour, and more empty space than content.

### 1.5 Technical / dense-dashboard

**Position:** data, finance, engineering, certifications, curriculum-heavy programmes. Buyers scan for
completeness and compare against a syllabus.

| Mechanic | Value |
|---|---|
| Type scale ratio | 1.125–1.2 — many small steps, fine-grained hierarchy |
| Display face role | The sans at semibold. No display face at all |
| Measure | 70–80ch |
| Vertical rhythm | 0.75× |
| Alignment | Left, strictly gridded |
| Edge treatment | Hairline on everything — reads as a table |
| Corner radius | `--radius-sm` |
| Surface | Panel, with inverted header rows |
| Colour deployment | Accent as **edge** — left-border status stripes, plus small fills on badges only |
| Shadow / elevation | `--shadow-xs` at most |
| Motion | None. Interactions are instant |
| Image treatment | Framed diagrams, or none. Mono for durations and counts |

**Tell:** hairline grid, mono numerals, and a left-border accent stripe rather than a filled badge.

### 1.6 Cinematic / immersive — **today's look**

**Position:** transformational and depth work, narrative-led, film-first. Sold on mood.

| Mechanic | Value |
|---|---|
| Type scale ratio | 1.414 |
| Display face role | Serif at normal weight, sized to poster scale, `--tracking-tight` |
| Measure | 46–52ch (short lines, high drama) |
| Vertical rhythm | 1.25× |
| Alignment | Centred |
| Edge treatment | None — but corner brackets on media frames |
| Corner radius | `--radius-lg` on media only; text blocks have none |
| Surface | Media-bleed plus **atmosphere**: radial bloom, vignette, drifting motes, the veil |
| Colour deployment | Accent as **glow** — the ember as light, not as ink |
| Shadow / elevation | Enormous, diffuse, and *coloured* (`0 24px 55px -38px` over `--jp-blood`) |
| Motion | Parallax, slow drift, staggered reveal |
| Image treatment | Full-bleed with a letterbox scrim gradient |

**Tell:** a radial ember bloom behind centred serif, corner brackets on the video frame, motes.

This family is fully implemented today. Every mechanic above maps to existing CSS in
`journey-sections.css` (`.jp-hero__glow`, `.jp-hero__motes`, `.jp-hero__vignette`,
`.jp-video__corner--*`, `.jp-descent__spine`, `.jp-proof-card::after`).

### 1.7 Retro / print

**Position:** craft, analogue skills, music, illustration, letterpress-adjacent nostalgia.

| Mechanic | Value |
|---|---|
| Type scale ratio | 1.5, with a slab or grotesk display at bold |
| Display face role | Heavy display face, often reversed out of a filled banner |
| Measure | 55–60ch |
| Vertical rhythm | 1.0× |
| Alignment | Centred heads over left body; rules do the separating |
| Edge treatment | Double rules — a thick and a thin paired, print-style |
| Corner radius | `--radius-none` |
| Surface | Tinted "paper", with tight panels |
| Colour deployment | Accent as **fill** in solid blocks; reversed-out banner headings |
| Shadow / elevation | Hard offset |
| Motion | None, or a marquee ticker |
| Image treatment | Duotone or halftone-masked, hard-edged |

**Tell:** paired thick/thin rules, reversed-out banner headings, uppercase tracked-out labels,
typographic ornaments (rules and dingbats from the face — never emoji, per platform rule).

### 1.8 Playful / high-energy

**Position:** fitness challenges, bootcamps, kids and creative programmes, community cohorts. Urgency
and momentum.

| Mechanic | Value |
|---|---|
| Type scale ratio | 1.5 — loud jumps |
| Display face role | Geometric sans at extra-bold, tight tracking |
| Measure | 45–52ch |
| Vertical rhythm | 1.0× |
| Alignment | Centred |
| Edge treatment | `--border-width-thick` in the accent colour |
| Corner radius | `--radius-xl` on panels, `--radius-full` on every control |
| Surface | **Inverted** / accent-filled bands; whole sections flip |
| Colour deployment | Accent as **fill**, everywhere, at full strength |
| Shadow / elevation | Medium, slightly hard, tinted |
| Motion | Stagger with spring easing (`--ease-spring`, `--ease-bounce`), marquee |
| Image treatment | Masked in playful shapes; numeric badges over media |

**Tell:** whole inverted bands, pill CTAs at `--radius-full`, spring easing, big numerals.

### 1.9 Contemporary / product

**Position:** the sensible default. The creator who wants "a good modern course page" and has no design
opinion. Commercially the most common request, and the family the platform default should land on.

| Mechanic | Value |
|---|---|
| Type scale ratio | 1.25 |
| Display face role | The sans at bold, 2 steps above body |
| Measure | 60–66ch |
| Vertical rhythm | 1.0× |
| Alignment | Left for prose, centred for section heads |
| Edge treatment | Hairline |
| Corner radius | `--radius-md` / `--radius-lg` |
| Surface | Panel cards on a lightly tinted page |
| Colour deployment | Accent as **fill** on the CTA only; accent as text on links |
| Shadow / elevation | `--shadow-sm` / `--shadow-md`, neutral |
| Motion | Fade + rise with a short stagger |
| Image treatment | Framed, rounded, consistent aspect |

**Tell:** rounded cards with hairlines and a small neutral shadow; one filled accent button per section.

---

## 2. The orthogonal axis model

**This is the section that matters.** Everything above is inputs; this is the deliverable.

### 2.1 The split, and why it is drawn here

Two kinds of variation, and they must live in different namespaces:

| | `variant` | `design` |
|---|---|---|
| **What it is** | The **composition** of one section — what elements exist and where they sit | The **treatment** applied to whatever composition is there |
| **Scope** | Section-**specific**. A `hero` variant means nothing to a `faq` | **Universal**. Every axis value means the same thing on all 11 types |
| **Owned by** | The section component's markup | Shared CSS keyed off attributes on the section wrapper |
| **Cardinality** | ~4–6 per type, 11 types → ~55 named compositions | 9 axes × 4–5 values → 38 CSS rules, total, forever |
| **Stored as** | `PageSection.variant?: string` (exists) | `PageSection.design?: SectionDesign` (new, §2.6) |

Mature builders draw this line the same way, and one of them draws it explicitly:

- **Squarespace** section editor: a **Design/Format** tab whose "options vary depending on the section
  type" (composition), a separate **Colors** tab that selects a *named, globally-defined* theme where
  "any changes made to a color theme affect all sections on your site that use that theme", and a
  **Background** tab where media is either full-bleed or inset. Their guidance is the thesis of this
  document: the global editor **defines** the styles, and the section settings only **apply** them.
- **Shopify**: `color_palette` is "a global set of named colors defined once in `settings_schema.json`"
  (2–20 entries) that sections *pick from* rather than typing hex into; `color_scheme` is a named
  bundle selectable at theme, section and block level, with section-level overriding global. The
  rationale given is exactly ours — keep merchants inside a defined set instead of free-form values.
- **Framer**: variants are composition states of a component; styling is separate and inherited.
- **Open Props**: scales are *numbered and closed* (`--size-fluid-1..3`, `--radius-1..6`, `--ease-1..5`)
  rather than free-form — a closed enum per dimension.

**The modelling decision, stated plainly:** closed enums per axis, resolved page → section, emitted as
`data-*` attributes, consumed as custom properties. Not free-form values. Not per-section CSS. The
alternative modelling — free-form numeric controls per section (Wix-style absolute positioning) —
produces pages that cannot be made coherent and cannot be re-themed later. Rejected.

### 2.2 The axis set

Nine axes. Each row's **Cut test** column shows the family disagreement that earns it a slot; an axis
where all nine families agree is a constant, not a knob.

| # | Axis | Values | Default | Earns its slot because |
|---|---|---|---|---|
| 1 | `width` | `narrow` · `text` · `wide` · `full` | `text` | luxury/cinematic want `narrow`, editorial/wellness/retro `text`, technical/brutalist/playful/contemporary `wide` — 3+ values in genuine use |
| 2 | `density` | `compact` · `regular` · `airy` · `vast` | `regular` | brutalist/technical `compact`, contemporary/editorial/retro/playful `regular`, wellness/cinematic `airy`, luxury `vast` — all four used |
| 3 | `surface` | `bare` · `tint` · `panel` · `invert` · `media` | `bare` | editorial/luxury `bare`, wellness/retro `tint`, technical/brutalist/contemporary `panel`, playful `invert`, cinematic `media` — all five used |
| 4 | `edge` | `none` · `hairline` · `soft` · `heavy` · `offset` | `hairline` | wellness `soft`, cinematic `none`, editorial/technical/contemporary `hairline`, playful `heavy`, brutalist/retro `offset` — all five used |
| 5 | `align` | `start` · `center` | `center` | editorial/brutalist/technical `start`; wellness/luxury/cinematic/playful/retro `center` |
| 6 | `type` | `restrained` · `balanced` · `expressive` · `monumental` | `balanced` | technical `restrained`, contemporary/editorial `balanced`, wellness/retro/playful `expressive`, luxury/brutalist/cinematic `monumental` |
| 7 | `accent` | `text` · `fill` · `edge` · `glow` · `none` | `fill` | editorial/wellness `text`, playful/retro/brutalist/contemporary `fill`, technical `edge`, cinematic `glow`, luxury `none` — all five used |
| 8 | `motion` | `none` · `fade` · `rise` · `stagger` · `drift` | `rise` | brutalist/technical/retro `none`, luxury `fade`, editorial/contemporary `rise`, playful `stagger`, wellness/cinematic `drift` |
| 9 | `media` | `bleed` · `frame` · `mask` · `inset` · `none` | `frame` | cinematic `bleed`, editorial/contemporary/technical `frame`, wellness/playful `mask`, luxury `inset`, brutalist `none` |

Two axes need a defence beyond the table.

**`align` has only two values — is a 2-value enum an axis?** Yes, and it is the highest-return axis in
the set. Today, alignment is encoded *in the variant namespace*: `hero` ships `centered` and `left`;
prose types ship `centered` (centred, 46rem) and `wide` (left, 62rem). Those pairs differ in nothing
but alignment and measure — both of which are axes. Promoting `align` deletes roughly eight redundant
variants across four section types and stops the combinatorial explosion at source. A 2-value axis
that removes eight compositions is cheaper than the compositions.

**`media` is inert on 6 of 11 types — is that an axis?** Yes. It is meaningful on `hero`, `introVideo`,
`reel`, `guide` and `proof` (avatars) — five types, above the three-type bar — and `none` is a
legitimate value. Sections without media ignore it, exactly as they ignore a `variant` they do not
offer. Flag it in the editor UI as conditional so creators are not shown a dead control.

### 2.3 Axis → CSS, value by value

Every axis value sets **only custom properties**. No axis value writes a layout rule. This is the
constraint that keeps the CSS at 38 rules: section CSS reads `var(--jp-rhythm)` and never needs to know
which density value produced it, so no axis needs a per-section override and no specificity war starts.

Existing tokens wherever possible. New tokens are marked **NEW** and justified in §2.5.

#### 1. `width` — how much horizontal room the content takes

| Value | Emits |
|---|---|
| `narrow` | `--jp-content-max: 48rem; --jp-measure: var(--measure-narrow);` **NEW** measure |
| `text` | `--jp-content-max: 64rem; --jp-measure: var(--measure-lede);` (64ch, exists) |
| `wide` | `--jp-content-max: var(--container-max); --jp-measure: var(--measure-wide);` **NEW** measure |
| `full` | `--jp-content-max: 100%; --jp-measure: var(--measure-wide);` |

`--jp-content-max` caps the section's inner wrapper; `--jp-measure` caps running body copy inside it.
Two properties because they diverge: a `wide` technical section has a 78rem grid holding 78ch rows,
and `full` means the *surface* is edge-to-edge while copy still caps — per the standing rule that
"full width" describes the surface, not the text.

#### 2. `density` — vertical rhythm and internal gaps

| Value | Emits |
|---|---|
| `compact` | `--jp-rhythm: 0.75;` |
| `regular` | `--jp-rhythm: 1;` |
| `airy` | `--jp-rhythm: 1.25;` |
| `vast` | `--jp-rhythm: 1.6;` |

Consumed as `padding-block: clamp(calc(var(--space-8) * var(--jp-rhythm)), 6cqw, calc(var(--space-20) * var(--jp-rhythm)))`
and `gap: calc(var(--space-6) * var(--jp-rhythm))`. Because `--space-*` derives from `--space-unit`,
which derives from `--brand-density-scale`, the org's global density stays in the chain — the axis
multiplies it, does not override it. This replaces the `clamp(2rem, 6cqw, 4.4rem)` literals in
`journey-sections.css`.

#### 3. `surface` — what the section's own background is

| Value | Emits |
|---|---|
| `bare` | `--jp-sec-bg: transparent; --jp-sec-pad-inline: 0;` |
| `tint` | `--jp-sec-bg: var(--jp-ink-2);` |
| `panel` | `--jp-sec-bg: var(--jp-ink-3); --jp-sec-radius: var(--radius-card);` |
| `invert` | `--jp-ink: var(--jp-pole-b);` **NEW** token — see §2.4 |
| `media` | `--jp-sec-bg: transparent; --jp-sec-atmos: 1;` (unlocks the bloom/vignette/veil layer) |

`--jp-sec-atmos` is a 0/1 gate the cinematic atmosphere layer multiplies its opacities by, so the
existing `.jp-hero__glow` / `__vignette` / `__motes` markup can stay and simply resolve to zero opacity
outside `surface: media`. Cheaper and lower-risk than conditionally rendering the markup.

#### 4. `edge` — border and elevation as one material

| Value | Emits |
|---|---|
| `none` | `--jp-edge-width: 0; --jp-edge-shadow: none;` |
| `hairline` | `--jp-edge-width: var(--border-width); --jp-edge-color: var(--jp-line); --jp-edge-shadow: var(--shadow-xs);` |
| `soft` | `--jp-edge-width: 0; --jp-edge-shadow: var(--shadow-lg);` |
| `heavy` | `--jp-edge-width: var(--border-width-thick); --jp-edge-color: var(--jp-accent-edge); --jp-edge-shadow: none;` |
| `offset` | `--jp-edge-width: var(--border-width-thick); --jp-edge-color: var(--jp-line-strong); --jp-edge-shadow: var(--space-1) var(--space-1) 0 0 var(--jp-line-strong);` |

Border width and elevation are **deliberately fused into one axis.** They co-vary perfectly across all
nine families: nobody pairs hairline borders with a huge coloured glow, and nobody pairs 2px brutalist
borders with soft diffuse elevation. Splitting them gives 5 × 4 = 20 combinations of which about five
are coherent — which is a worse product, not a more flexible one. The `soft` value exists exactly so
the one family that wants *no border but real elevation* (wellness) is reachable without the split.

#### 5. `align` — the text axis

| Value | Emits |
|---|---|
| `start` | `--jp-align: start; --jp-text-align: left; --jp-measure-margin: 0;` |
| `center` | `--jp-align: center; --jp-text-align: center; --jp-measure-margin: auto;` |

Note `--jp-align` uses logical `start`, not `left`, so `justify-items`/`align-items` consumers stay
writing-mode correct; `--jp-text-align` is the physical value `text-align` needs.

#### 6. `type` — the scale, not the face

| Value | Ratio | Emits |
|---|---|---|
| `restrained` | 1.125 | `--jp-display: var(--text-2xl); --jp-heading-size: var(--text-xl); --jp-display-leading: var(--leading-snug); --jp-display-tracking: var(--tracking-normal);` |
| `balanced` | 1.25 | `--jp-display: var(--text-4xl); --jp-heading-size: var(--text-2xl); --jp-display-leading: var(--leading-tight); --jp-display-tracking: var(--tracking-normal);` |
| `expressive` | 1.5 | `--jp-display: var(--text-5xl); --jp-heading-size: var(--text-3xl); --jp-display-leading: var(--leading-tight); --jp-display-tracking: var(--tracking-tight);` |
| `monumental` | 1.618 | `--jp-display: var(--text-display); --jp-heading-size: var(--text-4xl); --jp-display-leading: var(--leading-none); --jp-display-tracking: var(--tracking-tighter);` |

Face and weight come from `--brand-font-heading` and `--brand-heading-weight` and are **not** part of
this axis (§0.2). This is what lets `monumental` serve both luxury-minimal (light didone) and brutalist
(heavy grotesk) from one value. All four values are existing `--text-*` tokens, which already carry
`--brand-text-scale`.

#### 7. `accent` — where the brand colour lands

| Value | Emits |
|---|---|
| `text` | `--jp-accent-text: var(--jp-ember-text); --jp-accent-fill: transparent; --jp-accent-edge: var(--jp-line); --jp-accent-glow: none;` |
| `fill` | `--jp-accent-text: var(--jp-ember-text); --jp-accent-fill: var(--jp-ember); --jp-accent-on-fill: var(--jp-on-ember); --jp-accent-edge: var(--jp-ember); --jp-accent-glow: none;` |
| `edge` | `--jp-accent-text: var(--jp-text); --jp-accent-fill: transparent; --jp-accent-edge: var(--jp-ember); --jp-accent-glow: none;` |
| `glow` | `--jp-accent-text: var(--jp-ember-text); --jp-accent-fill: var(--jp-ember); --jp-accent-on-fill: var(--jp-on-ember); --jp-accent-edge: color-mix(in oklab, var(--jp-ember) 45%, transparent); --jp-accent-glow: 0 var(--space-6) var(--space-14) calc(var(--space-10) * -1) var(--jp-blood);` |
| `none` | `--jp-accent-text: var(--jp-heading); --jp-accent-fill: var(--jp-ink-4); --jp-accent-on-fill: var(--jp-heading); --jp-accent-edge: var(--jp-line); --jp-accent-glow: none;` |

The `--jp-accent-*` names are a thin **indirection layer** over the existing ember tokens, and that is
their entire purpose: `accent: none` becomes five declarations instead of two hundred grep-and-replace
edits. Note `text` and `glow` both resolve accent text to `--jp-ember-text`, never `--jp-ember` — see
§0.1. The CTA on `accent: none` stays a filled control (using `--jp-ink-4`), because a price-bearing
CTA must remain the visually dominant element even in a monochrome family.

#### 8. `motion` — reveal character

| Value | Emits |
|---|---|
| `none` | `--jp-reveal-distance: 0; --jp-reveal-duration: 0ms; --jp-reveal-stagger: 0ms; --jp-reveal-ease: linear;` |
| `fade` | `--jp-reveal-distance: 0; --jp-reveal-duration: var(--duration-slower); --jp-reveal-stagger: 0ms; --jp-reveal-ease: var(--ease-out);` |
| `rise` | `--jp-reveal-distance: var(--space-4); --jp-reveal-duration: var(--duration-slow); --jp-reveal-stagger: var(--duration-fast); --jp-reveal-ease: var(--ease-out);` |
| `stagger` | `--jp-reveal-distance: var(--space-6); --jp-reveal-duration: var(--duration-slow); --jp-reveal-stagger: var(--duration-normal); --jp-reveal-ease: var(--ease-spring);` |
| `drift` | `--jp-reveal-distance: var(--space-8); --jp-reveal-duration: var(--duration-slowest); --jp-reveal-stagger: var(--duration-normal); --jp-reveal-ease: var(--ease-smooth);` |

All durations resolve through `--duration-*`, which `tokens/motion.css` already collapses to `0.01ms`
under `prefers-reduced-motion: reduce` — so every value degrades to `none`'s *timing* for free. The
`--jp-reveal-distance` transform must still be neutralised explicitly, since a 0.01ms animation to a
translated end state still moves the element; `journey-sections.css` already has the
`@media (prefers-reduced-motion: reduce) { .jp * { animation: none !important; } }` block to extend.

#### 9. `media` — image and video treatment

| Value | Emits |
|---|---|
| `bleed` | `--jp-media-radius: 0; --jp-media-inset: 0; --jp-media-aspect: 21 / 9; --jp-media-scrim: linear-gradient(to top, var(--jp-ink), transparent 62%); --jp-media-mask: none;` |
| `frame` | `--jp-media-radius: var(--radius-lg); --jp-media-inset: 0; --jp-media-aspect: 16 / 9; --jp-media-scrim: none; --jp-media-mask: none;` |
| `mask` | `--jp-media-radius: var(--radius-xl); --jp-media-inset: 0; --jp-media-aspect: 4 / 5; --jp-media-scrim: none; --jp-media-mask: <arch clip-path>;` |
| `inset` | `--jp-media-radius: var(--radius-none); --jp-media-inset: var(--space-12); --jp-media-aspect: 3 / 2; --jp-media-scrim: none; --jp-media-mask: none;` |
| `none` | `--jp-media-display: none;` |

**Aspect ratio and scrim are coupled and this is a known trap.** Changing a media card's
`aspect-ratio` changes where an opaque scrim's gradient stops fall relative to the text sitting on it,
which silently changes text contrast. `bleed` is the only value that ships a scrim, and its
21:9 aspect and 62% stop are tuned together. Any future aspect change on `bleed` requires re-measuring
the text contrast over it — this is not a free parameter.

### 2.4 The prerequisite refactor: making `surface: invert` cycle-free

`surface: invert` is the one axis value that cannot be implemented naively, and it is worth getting
right before any component work starts.

The obvious implementation is to swap ink and heading:

```css
/* WRONG — custom-property cycle at every nesting depth */
[data-jp-surface='invert'] { --jp-ink: var(--jp-heading); }
```

`--jp-heading` is *derived from* `--jp-ink`, so defining `--jp-ink` in terms of it is a cycle, and both
properties become invalid at computed-value time. Nesting does not save it: custom properties inherit
as **unresolved token streams**, so an intermediate `--jp-ink-flip` re-substitutes the child's own
`--jp-ink` and the cycle reappears one level down. This is the same class of failure
`journey-palette.css` already documents for `--color-background`.

The fix is to declare **both poles once, from the single input, in the base class** — so neither pole
reads a property the invert rule redefines:

```css
.journey-palette.journey-palette.journey-palette {
  /* the creator's chosen background — the one input */
  --jp-pole-a: var(--brand-bg, var(--color-background));
  /* its auto-contrast partner: the SAME formula --jp-heading already uses */
  --jp-pole-b: oklch(from var(--jp-pole-a) clamp(0.05, (0.62 - l) * 100, 0.96) calc(c * 0.25) h);

  --jp-ink: var(--jp-pole-a);
  /* --jp-heading and the whole ladder continue to derive from --jp-ink, unchanged */
}

[data-jp-surface='invert'] { --jp-ink: var(--jp-pole-b); }
```

Now the entire ladder — `--jp-ink-2/3/4`, `--jp-heading`, `--jp-text/dim/faint`, `--jp-line-*` —
re-derives correctly inside an inverted section with **one declaration and no cycle**, because
`--jp-pole-b` depends only on `--jp-pole-a`, which nothing overrides. The dark pole keeps working
unchanged: it re-points `--jp-pole-a` instead of `--jp-ink`.

Two new tokens, both load-bearing, both justified. This refactor is a prerequisite for `surface`, and
it should land in the foundation round before any section component is touched.

### 2.5 New tokens: the complete list

Everything else in §2.3 uses existing tokens. These are genuinely new.

| Token | Value | Why it cannot reuse an existing token |
|---|---|---|
| `--measure-narrow` | `46ch` | Only `--measure-lede: 64ch` exists. The `width` axis needs three measures |
| `--measure-wide` | `78ch` | As above |
| `--jp-pole-a` / `--jp-pole-b` | see §2.4 | Required to make `surface: invert` cycle-free |
| `--jp-rhythm` | unitless, default `1` | `--brand-density-scale` is org-global and single-valued; this is per-section and must multiply onto it, not replace it |
| `--tap-target-min` | `var(--space-11)` (44px × density) | Nothing names the WCAG 2.5.5 minimum today, and §5's guardrail must be assertable in code and in tests |

The `--jp-sec-*`, `--jp-accent-*`, `--jp-edge-*`, `--jp-reveal-*`, `--jp-media-*` and `--jp-display-*`
families are **role aliases**, not new primitives — each resolves to an existing `--jp-*`, `--space-*`,
`--text-*`, `--radius-*`, `--shadow-*` or `--duration-*` token. That indirection is the mechanism by
which one axis value re-themes every section at once.

### 2.6 The contract and the resolution order

Additive against the frozen `PageSection` envelope. Every field optional, every unknown value ignored —
forward-compatible exactly as `variant` already is.

```ts
// packages/shared-types/src/journeys.ts  — and its barrel index.ts
export interface SectionDesign {
  width?:   'narrow' | 'text' | 'wide' | 'full';
  density?: 'compact' | 'regular' | 'airy' | 'vast';
  surface?: 'bare' | 'tint' | 'panel' | 'invert' | 'media';
  edge?:    'none' | 'hairline' | 'soft' | 'heavy' | 'offset';
  align?:   'start' | 'center';
  type?:    'restrained' | 'balanced' | 'expressive' | 'monumental';
  accent?:  'text' | 'fill' | 'edge' | 'glow' | 'none';
  motion?:  'none' | 'fade' | 'rise' | 'stagger' | 'drift';
  media?:   'bleed' | 'frame' | 'mask' | 'inset' | 'none';
}

export interface PageSection {
  /* ...existing... */
  design?: SectionDesign;   // per-section override
}

export interface JourneyCoursePage {
  /* ...existing... */
  design?: SectionDesign;   // page defaults — the "look"
}
```

**Resolution, per axis, first hit wins:** `section.design[axis]` → `page.design[axis]` →
the axis default in §2.2.

Per-section overrides on top of page defaults are the right modelling, not page-only, because a real
page genuinely wants a `vast` hero above a `compact` FAQ — that is good design, not incoherence. This
is also precisely what Shopify and Squarespace both ship (global defines, section overrides for that
section only).

`radius` is the counter-example and the reason it is **cut** (§2.7): pill cards next to sharp cards on
one page is never right. Radius belongs at page scope, via the `brandOverrides` field that already
exists and already mirrors the brand-editor state.

**Render seam.** `render-edit/SectionRenderer.svelte` is the single place this lands. It already
resolves `variant` via `resolveVariant(section)`; it gains a sibling `resolveDesign(section, page)` and
emits the result as attributes on a wrapper element:

```svelte
<div class="jp-sec"
     data-jp-width={design.width} data-jp-density={design.density}
     data-jp-surface={design.surface} data-jp-edge={design.edge}
     data-jp-align={design.align} data-jp-type={design.type}
     data-jp-accent={design.accent} data-jp-motion={design.motion}
     data-jp-media={design.media}>
  <Component props={section.props} {variant} {editable} {onEdit} {stages} />
</div>
```

Three notes on that markup. **The wrapper must be the container-query container** — today's sections
size in `cqw` and that must keep working, so `container-type: inline-size` moves onto `.jp-sec`.
**Attributes, not classes**, because one value per axis is structurally enforced (a class list can
carry `jp--compact jp--vast` simultaneously; an attribute cannot) and the enum self-documents in
devtools; specificity is identical at (0,1,0). **`resolveDesign` is pure and belongs in
`section-catalog.ts`** next to `resolveVariant` — it is public-bundle-safe, framework-free, and unit
testable without a DOM, which matters because `$lib/page-builder` is scanned by the import-boundary
gate and must never pull in editor UI.

### 2.7 Axes considered and CUT

An axis nobody disagrees on is a constant. An axis that duplicates another layer is a bug.

| Cut axis | Why |
|---|---|
| `radius` | `--brand-radius-base` already owns this globally, and creators already set it in the brand editor. Per-section radius is where a page starts looking incoherent. Reachable where it is genuinely needed via page-scoped `brandOverrides` |
| `elevation` / `shadow` | Folded into `edge`. They co-vary perfectly across all nine families; split gives 20 combinations, ~5 coherent. The `soft` value covers the one family wanting elevation without a border |
| `colour` / `palette` | Already solved by `journey-palette.css` + `brandOverrides` (§0.1). Also the layer Shopify/Squarespace both model as global-define/section-select — which is what these two already are |
| `font` / `typeface` | Brand layer (`--brand-font-heading`, `--brand-font-body`). A per-section typeface is how a page becomes a ransom note |
| `case` / `text-transform` | `--brand-text-transform-label` exists at brand scope, and case correlates ~1:1 with `type` + `accent`. Constant, not knob |
| `weight` | `--brand-heading-weight` / `--brand-body-weight` exist. Deliberately excluded from `type` so `monumental` serves both luxury (light) and brutalist (heavy) |
| `columns` | Composition. A 2-col vs 3-col proof grid *is* the variant. Putting column count in `design` would make `design` section-aware and collapse the whole split |
| `order` / `reverse` (media left/right) | Composition, and only meaningful on split compositions. `split` vs `split-reverse` variants |
| `atmosphere` | Already the conjunction of `surface: media` + `accent: glow` + `motion: drift`. A fourth way to say "cinematic" |
| `contrast` / `emphasis` | Already `surface: invert` + `accent: fill`. Redundant |
| `divider` / `seam` | Belongs to the **page**, not a section: two adjacent sections cannot independently own the line between them. Page-level setting if wanted at all |
| `sticky` / scroll behaviour | Behaviour, not design language, and meaningful only on `invite`. Belongs in that section's props |

---

## 3. Per-section variant recommendations

Compositions only. Anything that varies alignment, measure, surface, accent or motion is an axis and
does **not** appear here.

The most important finding in this section: **a large share of today's 37 variants are axis values
wearing composition names.** `hero: minimal` is `stage` + `density: compact` + `accent: none` +
`motion: none` — a preset. `prose: centered` vs `prose: wide` differ only in `align` and `width`.
`introVideo: cinema` vs `simple` differ only in `media`. Collapsing these is not a loss of capability;
it is the same capability, reachable in combination with everything else.

Legend — **E** exists today · **C** collapse (existing variants merging into one composition) ·
**N** new.

### `hero` — today: `centered`, `left`, `split`, `minimal`

| Composition | | Mechanical description |
|---|---|---|
| `stage` | **C** | Headline stack over an atmosphere layer; media is background, not an element. Absorbs `centered` + `left` (they were `align`) and `minimal` (a preset) |
| `split-media` | **E** | Two columns: copy column beside a media panel |
| `full-bleed` | **N** | Media fills the section; copy sits over a scrim, letterboxed |
| `oversized` | **N** | The headline *is* the hero — display at monumental, no media, one small meta row beneath |
| `banner` | **N** | Single short row: eyebrow, headline, inline CTA. No min-height. For pages whose hero is not the pitch |
| `poster` | **N** | A framed portrait or poster plate with the copy set beneath it |

### `introVideo` — today: `cinema`, `simple`, `split`

| Composition | | Mechanical description |
|---|---|---|
| `theatre` | **E** (`cinema`) | Framed player with corner brackets and a meta row (tag, duration) |
| `plain` | **C** (`simple`) | Bare player with a caption line. Today this is `theatre` + `media: inset` — keep as a composition only because the meta row genuinely disappears |
| `split` | **E** | Copy column beside the player |
| `bleed` | **N** | Player edge-to-edge, no frame, no brackets |
| `card` | **N** | Player inside a panel with stacked title/duration/access rows |

### `ache` — today: prose set (`centered`, `statement`, `wide`, `twocol`)

| Composition | | Mechanical description |
|---|---|---|
| `column` | **C** | Eyebrow, heading, body in one measure. Absorbs `centered` + `wide` (they were `align` + `width`) |
| `statement` | **E** | Oversized heading carrying the whole section; short body beneath |
| `paired` | **E** (`twocol`) | Heading in one column, body in the other |
| `list` | **N** | The ache as 3–5 named pains, each its own row with a marker |
| `quote` | **N** | The ache in the reader's own voice, set as a pull-quote |
| `checklist` | **N** | "This is you if…" as ticked rows |

### `turn` — today: prose set, default `statement`

| Composition | | Mechanical description |
|---|---|---|
| `statement` | **E** | The pivot as one oversized line |
| `column` | **C** | Standard measure stack |
| `paired` | **E** (`twocol`) | Statement one side, lede the other |
| `arc` | **E**, unnamed | The roman-numeralled stage list `TurnSection` already derives from `points` by splitting on an en/em dash. Behaviour exists; give it a name |
| `before-after` | **N** | Two panels: from / to |
| `numbered` | **N** | The promise as three numbered beats |

### `reel` — today: `cinema`, `simple`, `split`

| Composition | | Mechanical description |
|---|---|---|
| `theatre` | **E** (`cinema`) | Framed clip with transport and meta |
| `plain` | **C** (`simple`) | Clip with caption only |
| `split` | **E** | Copy beside clip |
| `strip` | **N** | A horizontal row of 3–5 clip thumbnails; one plays inline |
| `waveform` | **N** | Audio-first: the equaliser and playhead *are* the section. Matters because an audio preview should look like audio, not like a video with the picture missing |

### `map` — today: `descent`, `list`, `grid`

| Composition | | Mechanical description |
|---|---|---|
| `spine` | **E** (`descent`) | Vertical spine with gate nodes, roman numerals, practice cards per stage |
| `rows` | **E** (`list`) | Compact one-line stage rows |
| `cards` | **E** (`grid`) | A card per stage in an auto-fit grid |
| `table` | **N** | A real table: stage / lessons / minutes / access. The composition dense buyers scan |
| `timeline` | **N** | Horizontal scroll-snap track, one panel per stage |
| `numbered-prose` | **N** | Stages as numbered editorial paragraphs, no chrome at all |

### `feel` — today: prose set

| Composition | | Mechanical description |
|---|---|---|
| `paired` | **E** (`twocol`) | Feeling copy one side, the inclusions list the other. This is what the section actually does today |
| `column` | **C** | Feeling copy, then inclusions beneath, one measure |
| `statement` | **E** | Oversized feeling line, inclusions as a quiet run-on list |
| `grid` | **N** | Inclusions as an even card grid under the feeling copy |
| `ledger` | **N** | Inclusions as a hairline-ruled label/detail ledger |
| `stack` | **N** | Alternating full-width bands, one per inclusion |

### `proof` — today: `grid`, `stack`, `spotlight`

| Composition | | Mechanical description |
|---|---|---|
| `grid` | **E** | Three-up auto-fit cards |
| `stack` | **E** | One column, full measure |
| `spotlight` | **E** | One quote at large scale |
| `wall` | **N** | Dense masonry of many short quotes with avatars |
| `marquee` | **N** | Continuously scrolling quote ticker. **Must** ship its reduced-motion static fallback in the same commit |
| `pull` | **N** | A single quote as an editorial pull-quote inside the page measure, no card |

### `guide` — today: `portrait`, `centered`, `quote`

| Composition | | Mechanical description |
|---|---|---|
| `portrait` | **E** | Portrait plate beside the bio |
| `column` | **C** (`centered`) | Bio only, no media |
| `quote` | **E** | Big pull-quote leads; bio and attribution beneath |
| `credentials` | **N** | Portrait plus a hairline-ruled fact list (years practising, students taught, qualifications) |
| `letter` | **N** | A signed personal letter; signature image, no portrait frame |

### `faq` — today: `accordion`, `open`, `boxed`

| Composition | | Mechanical description |
|---|---|---|
| `accordion` | **E** | Click to expand, one at a time |
| `open` | **E** | Everything expanded |
| `boxed` | **C** | Each entry in a panel. Largely `open` + `surface: panel`; keep only if the per-entry panel differs from the section panel |
| `paired` | **N** | Two-column Q/A rows, all open, hairline-ruled |
| `grouped` | **N** | Categorised accordions with a group heading per cluster |

### `invite` — today: `descent`, `banner`, `card`

| Composition | | Mechanical description |
|---|---|---|
| `pool` | **E** (`descent`) | The cinematic close: ember pool, single path, atmosphere |
| `banner` | **E** | Compact horizontal offer strip |
| `card` | **E** | One quiet card, no atmosphere |
| `tiers` | **N** | Two or three side-by-side plan columns with a "best" flag. The offer model already supports multiple canonical paths and `InviteOffer.best` — this composition is the one that renders what the data already holds |
| `table` | **N** | Feature-comparison matrix across the available paths |
| `sticky` | **N** | Persistent bottom bar plus a short in-flow section |

**Standing constraint for every `invite` composition:** prices come only from
`JourneySalesContext.offer`, never from authored copy, and every composition must degrade to a
price-less CTA when `offer` is `null` (it is `.catch()`-guarded because the page is SEO-critical).
`priceLabel` was removed from the authored shape precisely because a page could otherwise advertise
£12/month for a £15 tier. New compositions must not reintroduce an authored price string. Currency is
GBP (£).

**Net effect:** 37 variants today → 8 collapsed away, 26 new, landing at **~55 compositions across 11
types**, each genuinely a different arrangement rather than a different treatment.

---

## 4. Composition presets — the "looks"

Eight presets. Each is a full `design` axis bundle plus per-type variant preferences: one click, a
coherent page. Named for creators choosing a look, not for designers naming a system.

Stored as page-level `JourneyCoursePage.design` plus a per-type variant map; a creator who then changes
one section keeps the preset for everything else, because resolution is per-axis (§2.6).

### 4.1 Candlelit — *reproduces today's page exactly*

Family: cinematic/immersive. For depth work, narrative and film-led programmes.

| Axis | Value |
|---|---|
| `width` | `narrow` |
| `density` | `airy` |
| `surface` | `media` |
| `edge` | `none` |
| `align` | `center` |
| `type` | `monumental` |
| `accent` | `glow` |
| `motion` | `drift` |
| `media` | `bleed` |

Variants: `hero: stage` · `introVideo: theatre` · `ache: column` · `turn: statement` · `reel: theatre` ·
`map: spine` · `feel: paired` · `proof: grid` · `guide: portrait` · `faq: accordion` · `invite: pool`

**This is the migration target for every existing published page.** The axis defaults in §2.2 are
deliberately *not* these values — the defaults describe a sensible neutral page, so existing pages must
be migrated by writing this preset onto them, not by leaving `design` unset. That migration is a
foundation-round task, and it is what makes this an expansion rather than a replacement.

### 4.2 Quiet Studio

Family: luxury-minimal. For photography, architecture, craft at the top of the market.

`width: narrow` · `density: vast` · `surface: bare` · `edge: hairline` · `align: center` ·
`type: monumental` · `accent: none` · `motion: fade` · `media: inset`

Variants: `hero: oversized` · `introVideo: plain` · `ache: statement` · `turn: statement` ·
`map: numbered-prose` · `feel: ledger` · `proof: pull` · `guide: credentials` · `faq: paired` ·
`invite: card`

### 4.3 The Long Read

Family: editorial/magazine. For writers, essayists and researchers.

`width: text` · `density: regular` · `surface: bare` · `edge: hairline` · `align: start` ·
`type: balanced` · `accent: text` · `motion: rise` · `media: frame`

Variants: `hero: poster` · `introVideo: plain` · `ache: column` · `turn: numbered` · `reel: strip` ·
`map: numbered-prose` · `feel: ledger` · `proof: pull` · `guide: letter` · `faq: paired` ·
`invite: card`

### 4.4 Open Air

Family: soft-organic/wellness. For yoga, breathwork, somatics, therapy, coaching.

`width: text` · `density: airy` · `surface: tint` · `edge: soft` · `align: center` ·
`type: expressive` · `accent: text` · `motion: drift` · `media: mask`

Variants: `hero: poster` · `introVideo: plain` · `ache: quote` · `turn: statement` · `reel: waveform` ·
`map: rows` · `feel: grid` · `proof: stack` · `guide: letter` · `faq: accordion` · `invite: card`

### 4.5 Plain Facts

Family: brutalist/utilitarian. For developer courses, trades, no-fluff positioning.

`width: wide` · `density: compact` · `surface: panel` · `edge: offset` · `align: start` ·
`type: monumental` · `accent: fill` · `motion: none` · `media: none`

Variants: `hero: oversized` · `introVideo: card` · `ache: list` · `turn: before-after` · `reel: strip` ·
`map: table` · `feel: ledger` · `proof: stack` · `guide: credentials` · `faq: grouped` ·
`invite: table`

### 4.6 The Syllabus

Family: technical/dense-dashboard. For certifications, data and engineering, curriculum-heavy
programmes.

`width: wide` · `density: compact` · `surface: panel` · `edge: hairline` · `align: start` ·
`type: restrained` · `accent: edge` · `motion: none` · `media: frame`

Variants: `hero: banner` · `introVideo: card` · `ache: list` · `turn: numbered` · `reel: strip` ·
`map: table` · `feel: ledger` · `proof: wall` · `guide: credentials` · `faq: grouped` ·
`invite: tiers`

### 4.7 Full Send

Family: playful/high-energy. For fitness challenges, bootcamps, cohort programmes.

`width: wide` · `density: regular` · `surface: invert` · `edge: heavy` · `align: center` ·
`type: expressive` · `accent: fill` · `motion: stagger` · `media: mask`

Variants: `hero: banner` · `introVideo: bleed` · `ache: checklist` · `turn: before-after` ·
`reel: strip` · `map: timeline` · `feel: stack` · `proof: marquee` · `guide: portrait` ·
`faq: accordion` · `invite: sticky`

### 4.8 Signal — *the recommended platform default*

Family: contemporary/product. For the creator with no design opinion who wants a good modern page.

`width: wide` · `density: regular` · `surface: panel` · `edge: hairline` · `align: start` ·
`type: balanced` · `accent: fill` · `motion: rise` · `media: frame`

Variants: `hero: split-media` · `introVideo: card` · `ache: checklist` · `turn: before-after` ·
`reel: theatre` · `map: cards` · `feel: grid` · `proof: wall` · `guide: portrait` ·
`faq: accordion` · `invite: tiers`

### The ninth family, and why it gets no preset

**Retro/print** (§1.7) is a real family and stays in the model, but it does not earn a preset slot. It
is the family most dependent on the brand's *typeface* — a slab or grotesk display carries it, and the
same axis values under Inter read as a slightly heavy version of Full Send. Shipping a preset whose
success depends on a font the creator has not chosen would be a preset that mostly lands wrong. It is
reachable deliberately: `Full Send` with `motion: none`, `media: frame`, `surface: tint`,
`edge: offset`, plus a slab brand face. Document it as a recipe, not a button.

---

## 5. Accessibility and failure modes

Each family has a characteristic way of breaking. The guardrails below are **non-negotiable regardless
of chosen design** — no axis value, no preset, and no creator override may cross them.

### 5.1 The non-negotiables

| Guardrail | Value | Enforcement |
|---|---|---|
| Body text contrast | 4.5:1 against its own surface | `--jp-text`/`--jp-dim` are auto-contrasted off `--jp-ink`. Any axis introducing a new surface must re-derive, never hardcode. `--jp-faint` is for non-essential text only |
| Large text contrast | 3:1 (≥24px, or ≥18.66px bold) | `--jp-heading` derives via the `l < 0.62` step function. `type: monumental` qualifies for 3:1; `type: restrained` headings often do not, so they must clear 4.5:1 |
| UI and graphic contrast | 3:1 | Applies to `--jp-accent-edge`, focus rings, spine/node graphics, and every `--jp-line-*` used as a meaningful boundary |
| Accent as text | Never `--jp-ember` | Measured at 2.98:1 (dark ink) / 2.46:1 (light ink). `accent: text` and `accent: glow` resolve to `--jp-ember-text`, which clears AA at both poles |
| Tap target | `--tap-target-min` = `var(--space-11)` (44px × density) | Applies to every CTA, accordion header, tier selector and carousel control, in **every** `density` value. `density: compact` shrinks padding, never below this floor |
| Body font size | `--text-base` floor (≈16px) | `type: restrained` reduces heading steps only. No axis value may set body copy below `--text-sm`, and `--text-xs` is metadata only |
| Reduced motion | Every `motion` value renders as `none` | `--duration-*` already collapse to `0.01ms`. Additionally: `--jp-reveal-distance` must resolve to `0`, `@keyframes` content must stop (not just speed up), and `marquee` must render static |
| Focus visibility | Always, at 3:1 | `--focus-offset` / `--focus-offset-inset` exist. `edge: none` and `edge: soft` remove borders but must **never** remove the focus ring; `surface: invert` must re-derive the ring colour from the flipped ink |
| Heading order | Semantic, independent of `type` | `type: monumental` on a `faq` must not promote its heading level. Visual scale and document outline are separate |
| Text over media | Scrim mandatory | `media: bleed` is the only value shipping a scrim, and any composition placing text over media must use `bleed`, not `frame` |

### 5.2 Per-family failure modes

| Family | How it breaks | Guardrail that catches it |
|---|---|---|
| **Editorial** | Hairline rules drop below 3:1 and the structure disappears for low-vision readers; 68ch measure plus a small `--text-base` becomes hard to track | `--jp-line` (20% lift), not `--jp-line-subtle` (12%), for any rule doing semantic work. Measure caps at 78ch |
| **Brutalist** | Heavy accent-coloured borders read as decoration while carrying meaning; hard-offset shadows produce accidental low-contrast text overlaps; radius 0 plus 2px borders shrinks the usable tap area inside controls | `edge: heavy` accent borders must clear 3:1 and never be the *only* signal. `--tap-target-min` measured on the content box, inside the border |
| **Wellness** | `edge: soft` removes every boundary — card edges become invisible in bright ambient light and to low-vision users; pill controls at `--radius-full` shrink the corner hit area; `motion: drift` at `--duration-slowest` is nausea-inducing for vestibular users | Elevation alone is never the only grouping signal — space or a heading must also carry it. Reduced-motion kills `drift` entirely |
| **Luxury-minimal** | The signature failure: light-weight type at large size looks elegant and measures badly, and `accent: none` removes the last colour cue so links and CTAs become indistinguishable from text | Light weights only at `type: monumental` sizes qualifying for 3:1. `accent: none` still resolves `--jp-accent-fill` to `--jp-ink-4` so the CTA stays a visibly distinct filled control |
| **Technical** | 80ch lines at `density: compact` with `--text-sm`; accent-as-edge stripes are a 4px colour cue with no text label; table compositions lose their header association on mobile | Measure caps at 78ch. `accent: edge` stripes must be paired with a text label. `map: table` and `invite: table` need real `<th scope>` and a documented mobile reflow |
| **Cinematic** | Text over media, which is *the* contrast failure of the whole set — a light frame in a dark video silently drops the headline below 3:1; motes and drift are continuous animation; the ember bloom tempts accent-as-text | Scrim is mandatory and its gradient stops are coupled to `--jp-media-aspect` (§2.3) — changing one requires re-measuring the other. Continuous animation must stop under reduced-motion, not merely accelerate |
| **Retro** | Duotone and halftone image treatments destroy contrast for any text placed over them; reversed-out banner headings on a mid-lightness accent fill fail both ways | Duotone media never carries text. Reversed-out headings use `--jp-on-ember`, which is derived, not assumed |
| **Playful** | `surface: invert` inverts the *background* but component-level colours often do not follow, producing accent-on-accent; `motion: stagger` with `--ease-spring` overshoots; large filled colour blocks tempt below-AA white text | `surface: invert` re-points `--jp-pole-a`'s consumer so the whole ladder re-derives (§2.4) — never a one-off background swap. Spring easing collapses under reduced-motion |
| **Contemporary** | The quiet failure: `--shadow-sm` on `--jp-ink-3` panels over `--jp-ink` gives a card boundary at well under 3:1, so on some brand backgrounds the cards simply vanish | Panels get `edge: hairline`, not elevation alone, at `--jp-line` strength |

### 5.3 What to test

The guardrails above are assertable, and most of them are cheap:

- **Contrast, per axis combination.** The dangerous set is `surface` × `accent` × `type` — 5 × 5 × 4 =
  100 combinations, each at both the light and dark ink poles. `journey-palette.test.ts` already
  establishes the pattern of computing measured ratios from the derivation; extend it rather than
  eyeballing. This catches the vanishing-card and invisible-hairline failures mechanically.
- **Tap targets, per `density`.** Assert every interactive element's computed box ≥ `--tap-target-min`
  at `compact`, the worst case.
- **Reduced motion, per `motion` value.** Assert `--jp-reveal-distance` resolves to `0` and no element
  carries a running animation.
- **Visual check across the eight presets** at the three builder preview widths (375 / 768 / 1440). The
  container-query scoping means a preset can be correct at 1440 and broken at 375 independently.
- Note the local-test hazard: scope any run to `--filter web`. A bare root `pnpm test` truncates the
  dev database.

---

## 6. Implementation order

Not a plan — a dependency statement, since some of this must precede component work.

1. **Foundation, before any component.** `--jp-pole-a`/`--jp-pole-b` refactor (§2.4); the five new
   tokens (§2.5); `SectionDesign` in `@codex/shared-types` **and its barrel `index.ts`**;
   `resolveDesign` beside `resolveVariant` in `section-catalog.ts`; the 38 axis rules as a new
   `journey-design.css`; `data-jp-*` emission plus `container-type` on the wrapper in
   `SectionRenderer.svelte`; **and the Candlelit migration onto every existing published page.**
2. **Extract the literals.** Replace the `clamp(2rem, 6cqw, 4.4rem)`-style padding and font-size
   literals in `journey-sections.css` with `--jp-rhythm` and `--jp-display-*` reads. This is where the
   axes actually start working, and it is a pure token-compliance win independent of new compositions.
3. **Collapse before expanding.** Retire the eight axis-in-disguise variants (§3) with a stored-value
   migration. `resolveVariant` already falls back safely for unknown variants, so the migration is
   about not silently changing published pages, not about avoiding crashes.
4. **Then the 26 new compositions**, per section type.
5. **Then the editor UI** — the preset picker, the nine axis controls, and conditional display for
   `media` on text-only section types.

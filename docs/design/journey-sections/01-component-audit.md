# Journey Sections — Structural Component Audit

**Scope**: the Codex course/journey landing-page builder's section renderers, ahead of a
program to give every section type an orthogonal design-knob treatment.
**Method**: read-only. Every claim carries a `file:line`. No code was modified.
**Date**: 2026-08-19 · **Branch**: `dev` @ `013e2d42`

---

## 0. Corrections to the briefing assumptions

Four of the five numbered assumptions hold. One is wrong on a detail, and two need a
material addition.

| # | Assumption | Verdict |
|---|---|---|
| 1a | `render/sections/*.svelte` — public renderer, **12 files**, 350–935 lines, props `{ config, context }` | **WRONG on the count.** There are **11** files, one per catalogue type, totalling 6003 lines (350–935 is correct). There is no 12th. Props contract is exactly `{ config: SectionProps; context: JourneySalesContext }` — `render/section-registry.ts:34-37`. |
| 1b | `render-edit/sections/*.svelte` — studio canvas, 8 files, 40–132 lines, props `{ props, variant, editable, onEdit, stages }` | **CORRECT.** 8 files, 513 lines total, 40–132 each. Contract at `render-edit/section-render.ts:33-44`. |
| 2 | `render/SectionRenderer.svelte` never passes `variant`, so all 37 variants are inert on the published page | **CORRECT, and worse than stated.** `render/SectionRenderer.svelte:33` is `<Component config={section.props} {context} />`. `variant` is not merely un-passed — it is **not in the public props type at all** (`render/section-registry.ts:34-37`), so adding it is a contract change, not a one-line fix. Variant count is exactly 37 (hero 4 + introVideo 3 + ache 4 + turn 4 + reel 3 + map 3 + feel 4 + proof 3 + guide 3 + faq 3 + invite 3). |
| 3 | `section-fields.ts` writes prop keys the public renderer never reads, on 7 of 11 types | **CORRECT — exactly 7.** hero, introVideo, reel, map, feel, guide, invite drop keys. ache, turn, proof, faq are fully bridged. Full key-level diff in §B. |
| 4 | `render-edit/journey-sections.css` (575) + `journey-palette.css` (247) hold the shared styling; each public section additionally has a large `<style>` block | **HALF WRONG, and this is the most important correction in the audit.** `journey-sections.css` is **not shared with the public tree at all.** It is consumed only by `render-edit/SectionRenderer.svelte:12`. The public sections import no stylesheet; each is 100% self-contained `<style>`. Only `journey-palette.css` is genuinely shared (4 surfaces). |

**Two additions the briefing did not anticipate:**

**(A) All 37 variants already have full CSS implementations — in the wrong tree.**
`render-edit/journey-sections.css` contains modifier rules for every declared variant:
`.jp-hero--split` (:274), `.jp-hero--minimal` (:308), `.jp-prose--centered/--statement/--wide/--twocol`
(:320-329), `.jp-video--simple/--split` (:372-375), `.jp-descent`/`.jp-stagegrid`/`.jp-stages`
(:380/:420/:428), `.jp-proof--stack/--spotlight` (:457-464), `.jp-guide--centered/--quote`
(:483-496), `.jp-faq--boxed` (:529), `.jp-invite--banner/--card` (:550-557). The variant
*design work* is done; it lives on the canvas side and has no public counterpart. This
reframes the program from "invent 37 layouts" to "port + generalise 37 layouts that exist".

**(B) The public sections consume zero `--jp-*` tokens.** `--jp-*` appears 238× in
`render-edit/journey-sections.css`, 44× in `journey-palette.css`, 13× in the member
dashboard, 6× in `render/JourneyRenderer.svelte`, 5× in checkout — and **0× in
`render/sections/*.svelte`**. The public sections speak only semantic `--color-*`, which
`.journey-palette--page` (`journey-palette.css:236-247`) re-points onto the `--jp-*` ladder.
That indirection is why the palette work landed cleanly, and it is the seam a design-axis
layer should reuse.

---

## A. Tree reconciliation

### A.1 Type → file map

| Catalogue type | PUBLIC (`render/sections/`) | lines | STUDIO CANVAS (`render-edit/sections/`) | lines |
|---|---|---:|---|---:|
| `hero` | `HeroSection.svelte` | 553 | `HeroSection.svelte` | 106 |
| `introVideo` | `IntroVideoSection.svelte` | 441 | `VideoSection.svelte` *(shared)* | 46 |
| `ache` | `AcheSection.svelte` | 350 | `ProseSection.svelte` *(shared)* | 40 |
| `turn` | `TurnSection.svelte` | 472 | `ProseSection.svelte` *(shared)* | 40 |
| `reel` | `ReelSection.svelte` | 935 | `VideoSection.svelte` *(shared)* | 46 |
| `map` | `MapSection.svelte` | 685 | `MapSection.svelte` | 132 |
| `feel` | `FeelSection.svelte` | 703 | `ProseSection.svelte` *(shared)* | 40 |
| `proof` | `ProofSection.svelte` | 467 | `ProofSection.svelte` | 54 |
| `guide` | `GuideSection.svelte` | 452 | `GuideSection.svelte` | 40 |
| `faq` | `FaqSection.svelte` | 413 | `FaqSection.svelte` | 45 |
| `invite` | `InviteSection.svelte` | 532 | `InviteSection.svelte` | 50 |

Registries: `render/section-registry.ts:46-58` (11→11) and
`render-edit/section-registry.ts:28-40` (11→8).

### A.2 Import sites — CONFIRMED: canvas renders `render-edit/*`, published page renders `render/*`

```
apps/web/src/lib/components/page-builder/JourneyBuilderCanvas.svelte:28
  import { SectionRenderer } from '$lib/page-builder/render-edit';
apps/web/src/lib/components/page-builder/JourneyBuilderCanvas.svelte:196
  <SectionRenderer {section} {editable} {onEditProp} {stages} />

apps/web/src/routes/_org/[slug]/(space)/journeys/[journeySlug]/+page.svelte:17
  import { JourneyRenderer } from '$lib/page-builder/render';
apps/web/src/routes/_org/[slug]/(space)/journeys/[journeySlug]/+page.svelte:100
  <JourneyRenderer coursePage={renderCoursePage} sellPreview={data.sellPreview} …

apps/web/src/lib/page-builder/render/JourneyRenderer.svelte:22
  import SectionRenderer from './SectionRenderer.svelte';
apps/web/src/lib/page-builder/render/JourneyRenderer.svelte:96
  <SectionRenderer sections={coursePage.page.sections} {context} />
```

The studio route imports the canvas, not the public renderer:
```
apps/web/src/routes/_org/[slug]/studio/journeys/[id]/page/+page.svelte:30
  JourneyBuilderCanvas,
apps/web/src/routes/_org/[slug]/studio/journeys/[id]/page/+page.svelte:504
  <JourneyBuilderCanvas
```
and only imports a *type* from `render-edit` (`+page.svelte:51`). The divergence is
documented in-code as a known follow-up at `JourneyBuilderCanvas.svelte:9-14`.

### A.3 Findings on the two-tree split

- **`render-edit/SectionRenderer.svelte` DOES resolve and pass the variant** — `:29`
  `const variant = $derived(resolveVariant(section))`, `:35`
  `<Component props={section.props} {variant} {editable} {onEdit} {stages} />`. The public
  one does neither. The variant plumbing exists; it exists on the wrong side.
- **`render-edit/*` speaks the builder's vocabulary exactly** — `kicker/heading/body`,
  `q1/a1`, `eyebrow/headline/accent/sub/felt/button/quiet/trust/bg`, `price/risk`,
  `role/clip/duration/note`. It is a 1:1 match with `section-fields.ts`. The
  **public** tree is the one that diverged, not the canvas.
- **`JourneyPreviewFrame.svelte` (143 lines) is exported (`components/page-builder/index.ts:17`)
  but imported by no route.** The full-page iframe preview path is dead code today; only
  the inline canvas is live. Worth confirming before any worktree assumes it is a
  verification surface.

---

## B. Per-component dossier (11 public section components)

Notation: **W** = written by the builder (`section-fields.ts`) · **R** = read by the public
component · **W-only** = builder writes it, public renderer ignores it (silently dropped
copy) · **R-only** = renderer reads it, no builder field can set it (permanently seeded or
blank). `defaultProps` come from `section-catalog.ts`.

---

### B.1 `hero` — `render/sections/HeroSection.svelte` · 553 lines

**Props read** (`:39-45`): `eyebrow`, `headline`, `subheadline`, `ctaLabel`,
`secondaryLabel`, `secondaryHref`, `trust`.
**Context read**: `course.kicker` (:48 eyebrow fallback), `course.title` (:49 headline
fallback — headline is non-optional in effect), `course.lede` (:50), `enrolled` (:61,:64),
`dashboardUrl`/`checkoutUrl` (:61).

**Builder writes** (`section-fields.ts:116-156`, defaults `section-catalog.ts:148-158`):
`eyebrow`, `headline`, `accent`, `sub`, `felt`, `button`, `quiet`, `trust`, `bg`.

**DIFF**
- **W-only (6, dropped)**: `accent` (italic headline ending), `sub` (the sub-line — the
  renderer reads `subheadline`), `felt` (emphasis line), `button` (CTA label — the renderer
  reads `ctaLabel`), `quiet` (secondary link), `bg` (`ember`/`blood`/`still` background
  treatment — the canvas honours it via `.jp-hero[data-bg='blood']`
  `journey-sections.css:257`; the public hero has no equivalent).
- **R-only (4)**: `subheadline`, `ctaLabel`, `secondaryLabel`, `secondaryHref`.
- **Shared (3)**: `eyebrow`, `headline`, `trust`.
- Net effect: a creator's sub-line, CTA label, accent, emphasis line, quiet link and
  background choice all vanish. The published hero shows eyebrow + headline + course lede +
  `'Begin the journey'` (:66 hardcoded fallback).

**Variant handling**: none. `variant` appears only as `CtaLink`'s unrelated style prop
(`:119`, `:123`). Declared-with-no-branch: `centered`, `left`, `split`, `minimal` (4/4).

**Hardcoded aesthetic inventory**
| Cat | What | Where |
|---|---|---|
| `rhythm` | `min-height: 100vh` / `100svh` — the hero is always full-viewport | `:166-167` |
| `rhythm` | `padding-block: var(--space-24) var(--space-16)`, `padding-inline: var(--space-5)` | `:168-169` |
| `layout` | flex column, `align-items:center`, `justify-content:center` — centring is structural, not a variant | `:162-165` |
| `type` | `text-align: center` on the root | `:171` |
| `width` | inner `max-width: 56rem`; headline `max-width: 16ch`; sub `max-width: 42ch` | `:245`, `:260`, `:278` |
| `type` | headline `font-family: var(--font-heading)`, `font-size: var(--text-display)`, `letter-spacing:-0.02em` | `:262-266` |
| `type` | eyebrow `--text-sm` + `letter-spacing:.08em` + `text-transform:uppercase` (this eyebrow recipe is repeated verbatim in 8 of 11 sections) | `:251-254` |
| `surface` | breathing glow: `radial-gradient` of brand-primary 24% / brand-accent 14%, `opacity:.55`, `filter: blur(var(--blur-2xl))`, `aspect-ratio:1`, `width:min(92vw,48.75rem)` | `:183-198` |
| `decoration` | 12 motes, count in JS (`:70-71 MOTE_COUNT = 12`), per-mote geometry by CSS `nth-child` | `:70`, style block |
| `decoration` | vignette layer `.hero__vignette` | markup `:100` |
| `decoration` | scroll cue: hairline + spark + inline `<svg>` chevron with hardcoded `width="16" height="10"` and `stroke-width="1.4"` | `:138-155` |
| `motion` | 8 named keyframe animations with **hardcoded durations/delays**: `hero-breathe 11s` (:364), `hero-rise` (:372), `hero-word-in .9s` + `calc(var(--word-i)*0.08s + 0.2s)` (:393-394), `hero-fade-up .8s` ×4 at `0.1s/1.05s/1.25s/1.42s` (:399-408), `hero-heartbeat 4.5s` (:411), `hero-fade-up .9s 1.65s` (:416), `hero-spark 2.8s` (:419), `hero-cue-bob 2.8s` (:422) |
| `motion` | headline split per-word in JS (`:55`) purely to drive the stagger — the DOM shape is animation-coupled |
| `edge` | `border-radius: var(--radius-full)` ×3 (:190,:214,:307), `var(--radius-sm)` (:349) |

**Non-token raw values**: `box-shadow: 0 0 6px …` (`:221`), `width: 1px` (`:331`),
`box-shadow: 0 0 9px …` (`:351`), `filter: blur(10px)` (`:429`).

**Contrast/a11y**: `--color-text-tertiary` used for meaningful text at `:301` (trust line),
`:326`, `:355` — on a journey page that token resolves to `--jp-faint`
(`journey-palette.css:157-158`), the 50%-toward-background mix that bead `Codex-rvkmc`
names. `<h1>` at `:108` — correct, and the only `h1` in the tree. Decorative layers all
carry `aria-hidden` (`:93`,`:131`,`:138`). No unnamed interactive elements (CTAs get their
label from `children`).

**Complexity verdict: large.** The per-word DOM split, the 12-mote nth-child geometry, the
8 keyframes and the `100svh` commitment all have to become knobs, and three of the four
declared variants (`left`, `split`, `minimal`) change the root layout mode, not just spacing.

---

### B.2 `introVideo` — `render/sections/IntroVideoSection.svelte` · 441 lines

**Props read** (`:36-39`): `eyebrow`, `heading`, `sub`, `posterUrl`.
**Context read**: `sellPreview` (`:94` `{#await}`) → `preview.intro.playlistUrl`,
`.durationSeconds`, `.posterUrl`.

**Builder writes** (`section-fields.ts:157` → `videoFields('introVideoMediaId')`,
`:85-107`): `kicker`, `heading`, `sub`, `clipMedia` *(media slot — writes
`courses.introVideoMediaId`, not a props key)*, `clip`, `duration`.

**DIFF**
- **W-only (3, dropped)**: `kicker` (no `['eyebrow','kicker']` fallback here — unlike
  ache/turn — so the eyebrow never renders from builder data), `clip` (the on-frame label:
  the canvas shows it at `render-edit/sections/VideoSection.svelte:35`, the public frame has
  no tag element), `duration` (the public badge is computed from the real clip,
  `:99` `formatDuration(intro.durationSeconds)` — the authored field is decorative).
- **R-only (2)**: `eyebrow`, `posterUrl`.
- **Shared (2)**: `heading`, `sub`.
- The `clipMedia` picker **is** wired correctly (slot → `courses.introVideoMediaId` →
  `context.sellPreview.intro`), per `section-fields.ts:44-55`.

**Variant handling**: none. Declared-with-no-branch: `cinema`, `simple`, `split` (3/3).

**Hardcoded aesthetic inventory**
| Cat | What | Where |
|---|---|---|
| `width` | root `max-width: 60rem`; lead `max-width: 40rem` | `:143`, `:154` |
| `rhythm` | `padding-block: var(--space-16)`, `padding-inline: var(--space-5)` | `:145-146` |
| `type` | `text-align: center` on the root — the `split` variant would need this inverted | `:147` |
| `type` | heading `--font-heading` / `--text-4xl` / `-0.015em` | `:168-171` |
| `media` | frame `aspect-ratio: 16 / 9` | `:190` |
| `edge` | frame `border-radius: var(--radius-card)` | `:191` |
| `surface` | poster injected as a CSS custom property from author data: `--poster: url(${JSON.stringify(p.posterUrl)})` | markup `:84` |
| `surface` | key-light aura: brand gradient, `aspect-ratio:1`, `opacity:.66` under enhancement | `:225-242` |
| `motion` | `intro-breathe 9s` (`:236`), `intro-pulse 3.2s` (`:317`) + second ring `animation-delay:1.6s` (`:321`) |
| `decoration` | two pulse rings, vignette, sheen — fixed count in markup `:101-102`, `:91-92` |
| `type` | duration badge `--text-xs` + `letter-spacing:.06em` | `:371-373` |

**Non-token raw values**: `#000` inside `color-mix` (`:210`, `:339`),
`margin-left: 3px /* optical centring */` (`:351`), `box-shadow: 0 0 8px` (`:383`).

**Contrast/a11y**: `<h2>` `:63`. Play button has an accessible name (`:107-109`
`aria-label="Play the {N}-second intro film"`). Skeleton has an `sr-only role="status"`
(`SectionSkeleton.svelte:32`). No text over the poster. **Minor risk**: the author-supplied
`posterUrl` reaches a `style` attribute (`:84`) via `JSON.stringify` only — it does **not**
pass through `safeHref`, unlike `GuideSection.svelte:71`. `JSON.stringify` escapes quotes
and backslashes so a CSS break-out is not reachable today, but it is an inconsistent guard.

**Complexity verdict: medium.** Streamed-await branching triples the states to design for
(pending / resolved / null). `split` is the only variant that fights the current layout.

---

### B.3 `ache` — `render/sections/AcheSection.svelte` · 350 lines

**Props read** (`:38-41`): `eyebrow` ← `asStringFrom(['eyebrow','kicker'])`;
`beats[]` ← `asStringArray('beats')` **??** `asStringsFrom(['heading','body'])`.
**Context read**: none. `context` is accepted only for contract uniformity (`:28-29`).

**Builder writes**: `PROSE_FIELDS` (`section-fields.ts:69-73`) = `kicker`, `heading`, `body`.

**DIFF**
- **W-only: none.** All three keys are consumed via the bridge.
- **R-only (1)**: `beats[]` — the array shape has no builder editor.
- **Fidelity bug, not a drop**: `[heading, body]` become two *beats*, and every beat renders
  at `--text-3xl` serif (`:243-251`). The creator's body paragraph is typeset as a second
  headline. Worse, `beats.length > 1` is the trigger for `enhanced` (`:52`), so filling both
  fields silently arms a **two-viewport pinned scrolljack** (`:280`
  `height: calc((var(--beat-count) + 1) * 100vh)`).

**Variant handling**: none. Declared-with-no-branch: `centered`, `statement`, `wide`,
`twocol` (4/4). Note `.jp-prose--*` in `journey-sections.css:320-329` already implements all
four for the canvas.

**Hardcoded aesthetic inventory**
| Cat | What | Where |
|---|---|---|
| `rhythm` | `padding-block: var(--space-20)`, `padding-inline: var(--space-5)` | `:155-156` |
| `layout` | `display:grid; place-items:center` — centring is structural | `:153-154` |
| `type` | `text-align: center` + `max-width: 48rem` on the frame | `:203-205` |
| `type` | beat `--font-heading` / `--text-3xl` / `--leading-snug` / `-0.01em` / `text-wrap:balance` | `:245-251` |
| `type` | chapter eyebrow `--text-sm` + `letter-spacing: .18em` + uppercase (note: **.18em**, vs .08em in hero — the eyebrow recipe is not consistent across sections) | `:213-216` |
| `decoration` | flanking hairlines via `::before/::after` with `content:''`, `width: clamp(1.5rem,6vw,3rem)`, gradient to brand-accent, second one `scaleX(-1)` | `:221-234` |
| `surface` | breathing aura `radial-gradient` brand-accent 30% → brand-primary 12%, `opacity:.6`, `blur(--blur-2xl)`, `aspect-ratio:1`, `width:min(78vw,38.75rem)` | `:161-178` |
| `surface` | cinematic vignette `::after` `radial-gradient(125% 95% at 50% 50%, transparent 52%, background 55%)` | `:182-192` |
| `motion` | `ache-breathe 8s ease-in-out infinite` (raw `ease-in-out`, not a token) | `:291`, `:330-340` |
| `motion` | pinned scroll: `position:sticky; top:0; height:100vh` + one viewport per beat | `:278-287` |
| `motion` | beat crossfade `opacity/transform/filter 0.85s` — **raw duration**, not `--duration-*` | `:313-316` |
| `decoration` | progress segments `width: clamp(1.6rem,5vw,2.9rem)` | `:261` |

**Non-token raw values**: `height:1px` (`:225`), `height:2px` (`:262`),
`box-shadow: 0 0 14px` (`:272`), `min-height: clamp(220px,40vh,360px)` (`:298`),
`filter: blur(3px)` (`:312`), `0.85s` ×3 (`:314-316`), `8s ease-in-out` (`:291`).

**Contrast/a11y**: `.ache__chapter` uses `--color-text-tertiary` (`:217`) — this is the
exact selector bead `Codex-rvkmc` cites at 4.22:1. **No heading element at all**: the beats
are `<p>` (`:122`), so an `ache` section contributes nothing to the document outline even
though it is visually a headline. Scroll-hijack has no opt-out beyond
`prefers-reduced-motion`.

**Complexity verdict: medium.** Small file, but the pinned scrolljack is coupled to
`beats.length`, and three of four declared variants are non-pinned layouts — so the variant
work is really "make the pin one option among four".

---

### B.4 `turn` — `render/sections/TurnSection.svelte` · 472 lines

**Props read** (`:43-46`): `eyebrow` ← `['eyebrow','kicker']`; `statement` ←
`['statement','heading']`; `lede` ← `['lede','body']`; `points[]` ← `asStringArray('points')`.
**Context read**: none (`:33-34`).

**Builder writes**: `PROSE_FIELDS` = `kicker`, `heading`, `body`.

**DIFF**
- **W-only: none.**
- **R-only (1)**: `points[]` — and this is the section's entire right-hand column. The
  numbered "descent arc" (`:108-127`) — rail, root, roman numerals, per-stage name/gloss,
  the dash-split parser at `:75-87` — **can never render from builder data**. Half of the
  section's design is unreachable.
- Self-hide guard `:90` `{#if p.statement || p.lede}` means the section does appear
  (heading is seeded), just as a one-column text block.

**Variant handling**: none. Declared-with-no-branch: `centered`, `statement`, `wide`,
`twocol` (4/4). Note the current layout is essentially the `twocol` variant, hardcoded.

**Hardcoded aesthetic inventory**
| Cat | What | Where |
|---|---|---|
| `layout` | `grid-template-columns: 1fr` → `minmax(0,.9fr) minmax(0,1.1fr)` at `--breakpoint-md` — the asymmetric split is fixed | `:171`, `:175-179` |
| `type` | `text-align: left` on the root (the only left-aligned section) | `:142` |
| `width` | inner `max-width: 68rem`; head `34ch`; statement `32ch`; lede `40ch`; gloss `46ch` | `:165`,`:191`,`:206`,`:218`,`:347` |
| `rhythm` | `padding-block: var(--space-20)`, gaps `--space-12` / `--space-16` | `:138`,`:172`,`:178` |
| `type` | statement `--font-heading` / `--text-4xl` / `--leading-tight` / `-0.02em` | `:207-211` |
| `type` | numerals `--font-heading` + `font-style: italic` + `--text-3xl` + `letter-spacing:.02em` | `:316-321` |
| `surface` | numeral colour ramps with index: `color-mix(brand-accent calc(58% + var(--d)*10%), text-secondary)` — a per-item colour gradient baked into CSS | `:322-326` |
| `surface` | warm well `radial-gradient`, `left:62%`, `bottom:-16%`, `width:min(115%,60rem)`, `blur(--blur-xl)` | `:146-161` |
| `decoration` | thread `width: clamp(3rem,6vw,5rem)`, gradient to transparent, `transform-origin:left` | `:225-236` |
| `decoration` | rail base + progress + glowing root, all absolutely positioned to `var(--space-1)` | `:246-290` |
| `layout` | stage grid `clamp(3rem,6vw,4.4rem) 1fr` + `column-gap: clamp(.7rem,1.8vw,1.3rem)` | `:302-303` |
| `decoration` | **progressive indent**: `padding-left: calc(var(--d,0) * clamp(0px,1vw,15px))` — each stage steps right | `:332` |
| `motion` | 6 reveal choreography blocks keyed on `:global(.reveal--armed)` with delays `60ms`,`120ms`,`200ms`,`calc(var(--d)*110ms)`,`150ms`,`1000ms` | `:357-441` |
| `motion` | `!important` overrides under reduced motion (7 declarations) | `:446-471` |

**Non-token raw values**: `height:2px` (`:228`), `width:2px` (`:251`),
`box-shadow: 0 0 12px` (`:272`), `0 0 18px 3px` (`:290`), `1px solid` (`:309`),
`clamp(0px,1vw,15px)` (`:332`), and the raw `ms` delays above.

**Contrast/a11y**: `--color-text-tertiary` at `:410` (armed numeral state). `<h2>` `:100`,
`<h3>` `:118` — correct nesting. `<ol aria-label="The stages of the descent">` (`:113`) is
good. Numerals are `aria-hidden` (`:116`) so screen readers get an unnumbered list —
acceptable since `<ol>` conveys order.

**Complexity verdict: medium.** The choreography is elaborate but mechanical. The real work
is that `points[]` needs an author-side array editor before any of the arc is reachable.

---

### B.5 `reel` — `render/sections/ReelSection.svelte` · 935 lines

**Props read** (`:44-47`, `:59-65`): `eyebrow`, `heading`, `sub`, `posterUrl`,
`captions[]` **??** `[caption]`, `tag` (default `'Preview'`).
**Context read**: `sellPreview` twice — `:171` (duration badge), `:189` (play chrome) →
`preview.reel.playlistUrl`, `.durationSeconds`.

**Builder writes**: `videoFields('previewVideoMediaId')` = `kicker`, `heading`, `sub`,
`clipMedia` *(slot)*, `clip`, `duration`.

**DIFF**
- **W-only (3, dropped)**: `kicker` (no fallback), `clip`, `duration` (badge is computed
  from the real clip, `:172`).
- **R-only (5)**: `eyebrow`, `posterUrl`, `captions[]`, `caption`, `tag`. The whispered
  caption — a signature element of the design — has no author control at all.
- **Shared (2)**: `heading`, `sub`.

**Variant handling**: none. Declared-with-no-branch: `cinema`, `simple`, `split` (3/3).

**Hardcoded aesthetic inventory** — the densest in the tree
| Cat | What | Where |
|---|---|---|
| `media` | `aspect-ratio: 2.4 / 1` ultrawide letterbox — the section's identity | `:363` |
| `media` | responsive aspect flips: `4 / 3` + `min-height:280px` @760px, `3 / 3.4` @420px | `:881-882`, `:892` |
| `width` | inner `max-width: 72rem`; lead `30ch`; title `24ch`; sub `30ch`; caption `32ch` | `:293`,`:314`,`:328`,`:340`,`:657` |
| `layout` | editorial split header with `text-align: right` on the sub | `:348` |
| `type` | title `clamp(var(--text-3xl), 5.4vw, var(--text-5xl))` — one of only two fluid type ramps in the tree | `:331` |
| `type` | rec tag `--text-xs` + uppercase + `letter-spacing: .28em`; `.2em` at the 420px breakpoint | `:572-575`, `:895` |
| `surface` | **5 stacked `mix-blend-mode` layers**: `screen` ×4 (`:424`,`:435`,`:448`,`:460`) + `overlay` (`:481`) — base / body / rim / glow / haze / grain |
| `surface` | grain at `opacity: 0.07` (`:480`), haze `opacity:.6` (`:461`), scrim `rgba(0,0,0,.6)` (`:698`) |
| `decoration` | 4 viewfinder corner marks, fixed in markup | `:160-163` |
| `decoration` | **32 hand-written `<rect>` elements** forming the waveform, absolute x/y/height per bar, `viewBox="0 0 480 40"` | `:217-248` |
| `decoration` | second `<svg>` re-uses them via `<use href="#{waveId}">`, id from a module-scope counter | `:251-257`, `:927-935` |
| `motion` | `reel-breath 8s`, `reel-drift 22s … alternate`, `reel-pulse 4s`, `reel-skeleton 1.4s` ×2, `reel-ring 2.8s` | `:487`,`:491`,`:589`,`:727`,`:825`,`:742` |
| `motion` | caption cross-fade on a JS interval: `5600ms` cycle, `420ms` swap | `:109-115` |
| `motion` | `transform: translateY(26px)` / `translateY(34px) scale(0.985)` reveal offsets | `:851`,`:863` |
| `type` | caption `--font-heading` + `clamp(var(--text-base), 2.5vw, var(--text-2xl))` + `text-align:center` | `:648-653` |

**Non-token raw values** — the worst offender in the tree: `#000` in `color-mix` (`:371`,
`:475`), `rgba(0,0,0,0.4)` (`:372`), `rgba(0,0,0,0.5)` ×2 (`:577`,`:614`),
`rgba(0,0,0,0.6)` ×2 (`:656`,`:698`), `inset 0 1px 0` (`:385`), `7px`/`2px` sizes
(`:581`,`:582`,`:800`,`:809`), `translateY(-2px)` (`:707`), `margin-left:3px` (`:764`),
`0 0 5px`/`0 0 10px` glows (`:791`,`:802`), `min-height:280px` (`:882`), plus the raw-px
`@media (max-width: 760px)` / `(max-width: 420px)` breakpoints (`:876`,`:890`) which bypass
the design system's `--breakpoint-*` custom media used by `TurnSection.svelte:175`.

**Contrast/a11y**: text over image is real here — `.reel__caption` and `.reel__tag` sit on
the poster and lean on `text-shadow: 0 1px 6px rgba(0,0,0,.5)` (`:577`,`:614`) and
`0 2px 14px rgba(0,0,0,.6)` (`:656`) for legibility, which is not a measurable contrast
guarantee. `<h2>` `:130` with an `id` derived from the module counter. Play button has
`aria-label="Play the practice preview"` (`:204`). Pending/empty play affordances are
`<span aria-hidden>` (`:190`,`:268`) — correct. **Note** this component's aspect-ratio is
changed at two breakpoints while the scrim gradient stops are fixed — the exact coupling
recorded in memory as *opaque scrim stops are aspect-coupled*.

**Complexity verdict: extra-large.** 935 lines, 5 blend layers, 32 hand-authored SVG rects,
a module-scope id counter, two raw-px breakpoints, and an aspect-ratio that is
simultaneously the section's identity and a responsive variable. This is the single hardest
component to make orthogonal and should not share a worktree with anything else.

---

### B.6 `map` — `render/sections/MapSection.svelte` · 685 lines

**Props read** (`:46-49`): `eyebrow`, `title`, `sub`, `foot`.
**Context read**: `stages` (`:52-54`, sorted by `sortOrder`) → `stage.name`, `stage.gloss`,
`stage.practices[].{contentId, contentType, title, sortOrder}`; `course.stageCount` (`:181`),
`course.practiceCount` (`:184`).

**Builder writes** (`section-fields.ts:161-171`): `eyebrow`, `heading`, `sub`, `note`.

**DIFF**
- **W-only (2, dropped)**: `heading` (renderer reads `title`) and `note` (renderer reads
  `foot`). The published heading therefore always falls back to the hardcoded
  `"Everything you'll walk."` (`:55`), and the closing note — which the field's own hint
  advertises as "Shown under the map" (`section-fields.ts:169`) — never appears.
- **R-only (2)**: `title`, `foot`.
- **Shared (2)**: `eyebrow`, `sub`.

**Variant handling**: none. Declared-with-no-branch: `descent`, `list`, `grid` (3/3). The
canvas implements all three (`journey-sections.css:380`, `:420`, `:428`) and
`render-edit/sections/MapSection.svelte:63-130` branches on them explicitly — a ready-made
reference implementation.

**Hardcoded aesthetic inventory**
| Cat | What | Where |
|---|---|---|
| `width` | inner `max-width: 60rem`; head `48rem`; sub `44rem`; foot `46ch` | `:252`,`:262`,`:289`,`:651` |
| `type` | `text-align: center` on the head; `center` again on the foot | `:264`,`:526` |
| `layout` | band grid `minmax(13rem, 16.5rem) minmax(0, 1fr)` — gate column width is a magic pair | `:396` |
| `layout` | gate grid `var(--descent-node) minmax(0,1fr)` — one of the few named custom properties | `:404` |
| `rhythm` | `padding-block: var(--space-20)` | `:247` |
| `type` | title `--text-4xl`; gate name `--text-xl`; card title `--text-base`; card meta `--text-xs` | `:280`,`:446`,`:515`,`:494` |
| `edge` | practice card `border-radius: var(--radius-card)` | `:471` |
| `decoration` | vertical spine: track + JS-driven `draw` whose `height` is set imperatively in px (`:125` `draw.style.height = maxDrawn + 'px'`) |
| `decoration` | glowing gate nodes with roman numerals; `ROMAN` table capped at 10 (`:69`) |
| `decoration` | 🔒 emoji lock glyph rendered as content (`:222`) and `▶ ♪ ✎` glyph map (`:63-67`) |
| `motion` | monotonic scroll draw with a `vh * 0.62` "reach line" (`:122`), `document.fonts.ready` re-measure (`:153-155`), a `setTimeout(400)` settle (`:157`) |
| `motion` | per-gate ignition via `litCount` (`:197` `lit = !enhanced \|\| i < litCount`) — DOM-measured with `querySelectorAll('.descent__node')` (`:127`), i.e. the JS is coupled to a class name |

**Non-token raw values**: `box-shadow: 0 0 10px` (`:363`), `bottom:-3px`, `9px` ×2
(`:371`,`:373`,`:374`), `0 0 12px 2px` (`:378`), `0 0 0 1px` / `0 10px 34px -14px` /
`inset 0 1px 0` (`:425-427`), `0 12px 34px -20px` (`:479`), the sr-only `1px/1px/-1px`
block (`:534-537`), `inset 0 1px 0` (`:607`).

**Contrast/a11y**: `--color-text-tertiary` on meaningful text at `:497` (card type label,
`--text-xs`), `:507`, `:610` — small text through `--jp-faint`, squarely in `Codex-rvkmc`.
`<h2>` `:175` → `<h3>` `:204` → `<h4>` `:224` — a correct three-level outline, the only
section that builds one. `<span class="descent__sr">included with membership</span>`
(`:225`) is a visually-hidden hint. Lock glyph is `aria-hidden` (`:222`). The emoji lock
also violates the recorded *no emoji in product UI* rule.

**Complexity verdict: large.** Two coupled JS systems (imperative spine height + DOM-queried
gate ignition), a three-level heading outline, and three declared variants that are three
genuinely different layouts. The canvas twin gives you the target markup for all three.

---

### B.7 `feel` — `render/sections/FeelSection.svelte` · 703 lines

**Props read** (`:43-50`, `:57-62`): `eyebrow`, `heading`, `body`, `inclusions[]`
(`{label, detail}` objects), `previewTitle`, `previewSub`, `previewDuration` (number,
default **480**).
**Context read**: **none** (`:36-37`) — and this is the defect in bead `Codex-scab9`:
`context.sellPreview.reel` is in scope and unused.

**Builder writes**: `PROSE_FIELDS` = `kicker`, `heading`, `body`.

**DIFF**
- **W-only (1, dropped)**: `kicker` (no `['eyebrow','kicker']` fallback here, unlike
  ache/turn — so the eyebrow never renders).
- **R-only (5)**: `eyebrow`, `inclusions[]`, `previewTitle`, `previewSub`,
  `previewDuration`. `inclusions[]` is the entire right-hand column and `previewTitle` is
  the on/off switch for the free-taste player (`:63` `hasPlayer = !!previewTitle`) — so
  **two of the section's three regions are unreachable from the builder**. A published
  `feel` section is heading + body and nothing else.
- **Shared (2)**: `heading`, `body`.

**Variant handling**: none. Declared-with-no-branch: `centered`, `statement`, `wide`,
`twocol` (4/4).

**Hardcoded aesthetic inventory**
| Cat | What | Where |
|---|---|---|
| `layout` | `grid-template-columns: 1fr` → `minmax(0,1.04fr) minmax(0,.96fr)` — a near-50/50 split expressed as magic fractions | `:280`, `:287` |
| `width` | inner `max-width: 68rem`; body `46ch`; a `max-width:none` reset at `:679` |
| `rhythm` | `padding-block: var(--space-20)` | `:269` |
| `type` | eyebrow `letter-spacing: .28em` (third distinct eyebrow tracking in the tree) | `:301` |
| `type` | heading `--text-3xl`; body `--text-lg`; taste title `--text-lg`; meta `--text-sm`/`--text-xs` | `:310`,`:320`,`:452`,`:457`,`:466` |
| `edge` | taste card `border-radius: var(--radius-xl)`; wave bars `--radius-xs` | `:334`, `:496` |
| `decoration` | **56 generated equaliser bars** with per-bar height/duration/delay computed in JS from `sin`/`cos` (`:74-94`), fed to CSS as `--h/--d/--delay` (`:233`) |
| `motion` | `feel-eq var(--d,1.1s)` per bar (`:512-513`), `feel-pulse 2s` (`:429`) |
| `motion` | fake transport: `requestAnimationFrame` accumulating `elapsed` (`:130-146`) |
| `layout` | inclusion row grid `clamp(1.9rem,3.5vw,2.3rem) 1fr` | `:591` |
| `decoration` | `&#10022;` (✦) hardcoded as the inclusion bullet | markup `:250` |
| `type` | `font-variant-numeric: tabular-nums` on the time readout | `:468` |

**Non-token raw values**: `translateY(-2px)` (`:397`), `gap:2px` (`:488`), `width:1.5px` +
`0 0 10px` (`:531`,`:534`), `9px` ×2 + `0 0 0 3px` + `0 0 12px` (`:544`,`:545`,`:550`,`:551`),
`width:1px` (`:576`), `0 0 22px -4px` (`:622`).

**Contrast/a11y** — the worst in the tree:
- `.feel-wave` (`markup :223-237`) carries `role="presentation"`, `aria-hidden="true"`
  **and** `onclick={seek}`. A seek control that is a non-interactive, aria-hidden `<div>`
  with a click handler: no keyboard path, no role, no name, invisible to AT.
- `--color-text-tertiary` for meaningful text at `:458`, `:478`, `:644`.
- The play button is correct (`aria-pressed`, dynamic `aria-label`, `:193-194`).
- `<h2>` `:172`, no lower levels — fine.
- Per `Codex-scab9`, clicking play moves a playhead and produces no audio.

**Complexity verdict: large.** Not for its layout — for its debt. The 56-bar generator, the
rAF transport, the aria-hidden seek div and the unreachable right column all have to be
resolved before "give it design knobs" is even a coherent request. Strongly recommend
`Codex-scab9` is fixed *inside* this worktree, not after it.

---

### B.8 `proof` — `render/sections/ProofSection.svelte` · 467 lines

**Props read** (`:37-38`, `:45`, `:56-70`): `eyebrow`, `heading`,
`trustLabel` ← `['trustLabel','trust']`, and authored testimonials via
`asNumberedGroups({quote:'q', authorName:'n', authorContext:'c'})`.
**Context read**: `testimonials` — **and context WINS**: `:73-77`
`context.testimonials.length > 0 ? context.testimonials : authored`.

**Builder writes** (`section-fields.ts:173-191`): `eyebrow`, `heading`, `q1-q3`, `n1-n3`,
`c1-c3`, `trust`.

**DIFF**
- **W-only: none** — every key is read.
- **R-only (1)**: `trustLabel` (the legacy `trust` alias covers it).
- **Precedence trap**: the authored `q/n/c` are *shadowed* whenever the course has any
  testimonial row. A creator editing quotes in the builder sees them in the canvas
  (`render-edit/sections/ProofSection.svelte:33`) and sees the *course's* testimonials on
  the live page. Not a dropped key — a silent source swap, and arguably more confusing.

**Variant handling**: none. Declared-with-no-branch: `grid`, `stack`, `spotlight` (3/3).

**Hardcoded aesthetic inventory**
| Cat | What | Where |
|---|---|---|
| `layout` | responsive column count baked in: `1fr` → `repeat(2, …)` → `repeat(3, …)` | `:182`, `:192`, `:199` |
| `width` | inner `max-width: 68rem`; head `44rem` | `:150`, `:156` |
| `type` | `text-align: center` on the head | `:155` |
| `edge` | card `border-radius: var(--radius-card)` | `:214` |
| `surface` | card lift shadows `0 24px 55px -38px` → `0 30px 60px -34px` on hover | `:221`, `:255` |
| `decoration` | oversized `--text-5xl` decorative quote mark | `:284-286` |
| `decoration` | gradient avatar with **`nth-child(3n+1)` / `nth-child(3n+3)`** hue rotation (`journey-sections.css:450-451` equivalent) — a 3-column assumption encoded in a selector |
| `motion` | reveal delay driven from markup: `style="--reveal-delay: {i * 90}ms"` (`:101`) and `{testimonials.length * 90}ms` (`:123`) |
| `motion` | hover `translateY(-4px)` (`:249`); armed offset `translateY(22px)` (`:414`) |
| `decoration` | trust "stack" renders up to 5 dots (`:125` `.slice(0, 5)`) |

**Non-token raw values**: `height:1px` (`:235`), `translateY(-4px)` (`:249`),
`inset 0 0 0 1px` + `0 6px 16px -8px` (`:312-313`), `inset 0 0 0 1px` + `0 0 0 2px`
(`:379-380`), `translateY(22px)` (`:414`).

**Contrast/a11y**: `<h2>` `:94` only. Avatar initial is `aria-hidden` (`:107`). `<ul>/<li>`
+ `<figure>/<blockquote>/<figcaption>` is a well-formed structure. No `--color-text-tertiary`
use — this is the cleanest section on the `Codex-rvkmc` axis.

**Complexity verdict: medium.** The three variants are pure grid re-flows plus one
type-scale change, and the canvas already implements them. The `nth-child(3n)` avatar
tinting and the `i * 90ms` stagger are the only real couplings.

---

### B.9 `guide` — `render/sections/GuideSection.svelte` · 452 lines

**Props read** (`:34-39`, `:47`): `eyebrow`, `heading`, `name`, `bio[]` (**string array**),
`portraitUrl`, `credentials[]`, `quote`.
**Context read**: none (`:27-28`).

**Builder writes** (`section-fields.ts:192-223`): `role`, `heading`, `body`, `quote`,
`portraitMedia` *(slot `guidePortraitMediaId`)*, `clipMedia` *(slot `guideVideoMediaId`)*,
`clip`, `duration`.

**DIFF** — the most broken of the eleven
- **W-only (4, dropped)**: `role` (renderer reads `eyebrow`), **`body`** (the field labelled
  "Bio" — the renderer reads `bio` as a *string array*, so a plain string is discarded by
  `asStringArray`; the guide's entire biography never renders), `clip`, `duration`.
- **R-only (5)**: `eyebrow`, `name`, `bio[]`, `portraitUrl`, `credentials[]`.
- **Shared (2)**: `heading`, `quote`.
- **Both media pickers are inert on the live page.** `section-fields.ts:50-54` asserts
  "the guide reads `portraitUrl` — all projected from `courses.*MediaId`". Verified: nothing
  projects it. `grep portraitUrl` across `apps/web/src`, `packages/*/src`, `workers/*/src`
  returns only the type declaration (`render/types.ts:228`) and that comment.
  `JourneyCourseView` (`journey-queries.ts:110-121`) has no portrait field, and `SellPreview`
  (`render/types.ts:50-55`) carries only `{intro, reel}`. So `guidePortraitMediaId` and
  `guideVideoMediaId` are written to `courses` and read by nobody public — the public guide
  renders a *decorative* brand-lit panel with a letter monogram (`:81-86`) instead, and has
  no video affordance at all.
- Net: a published guide section shows heading + pull-quote + a monogram panel. Role, bio,
  portrait and video are all lost.

**Variant handling**: none. Declared-with-no-branch: `portrait`, `centered`, `quote` (3/3).

**Hardcoded aesthetic inventory**
| Cat | What | Where |
|---|---|---|
| `layout` | `grid-template-columns: 1fr` → `minmax(0,.7fr) minmax(0,1fr)` at md — portrait column is 70% of the text column | `:156`, `:164` |
| `width` | inner `max-width: 60rem`; quote `32ch` | `:158`, `:364` |
| `media` | **two different portrait aspect ratios**: `4 / 5` for the frame (`:176`) and `3 / 4` for the inner ember (`:237`) |
| `media` | `object-fit: cover` on the photo | `:227` |
| `edge` | `border-radius: var(--radius-card)` | `:177` |
| `surface` | `mix-blend-mode: overlay` on the grain layer at `opacity: .14` | `:268-269` |
| `type` | monogram at `--text-6xl` with a `var(--text-display)` fallback — `font-size: var(--text-6xl, var(--text-display))` | `:303` |
| `type` | quote at `--text-5xl` decorative mark, body copy `--text-base`, heading `--text-3xl` | `:373`,`:339`,`:330` |
| `motion` | `guide-breathe 7.5s var(--ease-in-out)` | `:247` |
| `motion` | reveal delays passed as **duration tokens used as delays**: `style="--reveal-delay: var(--duration-slow)"` etc. (`:66`,`:96`,`:105`,`:114`,`:125`,`:134`) — a token-category mismatch worth cleaning |
| `decoration` | 4-layer poster stack (ember / grain / vignette / sheen) with a 5th (monogram) only in the no-photo branch | `:76-86` |
| `edge` | credentials as pills, `border-radius: var(--radius-full)`, `--text-xs` | `:401-403` |

**Non-token raw values**: `#000` inside `color-mix` twice (`:197`, `:211`) — the only
section with **zero** raw px, but two raw hex values.

**Contrast/a11y**: `<h2>` `:94` only. Portrait `alt` is conditional and correctly empty when
there is no name: `alt={p.name ? 'Portrait of ' + p.name : ''}` (`:72`). `safeHref` guards
the `src` (`:71`) — the only section that guards an author URL. Decorative layers all
`aria-hidden`. No `--color-text-tertiary`. The monogram is `aria-hidden` (`:85`). Clean on
a11y; broken on data.

**Complexity verdict: medium.** The layout is simple. The work is data: `body`→`bio[]`,
the two dead media slots, and `role`→`eyebrow`. The three variants map onto the existing
two-column / one-column / quote-led CSS already in `journey-sections.css:483-496`.

---

### B.10 `faq` — `render/sections/FaqSection.svelte` · 413 lines

**Props read** (`:44-61`): `eyebrow`, `heading`, `items[]` (`{question, answer}` objects)
**??** `asNumberedGroups({question:'q', answer:'a'})`.
**Context read**: none (`:37-38`).

**Builder writes** (`section-fields.ts:224-232`): `heading`, `q1-q3`, `a1-a3`.

**DIFF**
- **W-only: none.** Fully bridged — the only type where the bridge covers everything the
  builder offers.
- **R-only (2)**: `eyebrow` (no builder field, so it never renders), `items[]`.
- Note `asNumberedGroups` scans to `max = 12` (`coerce.ts:115`) while the builder offers
  exactly 3 slots — so the data model already supports 12 Q&As and the UI caps at 3.

**Variant handling**: none. Declared-with-no-branch: `accordion`, `open`, `boxed` (3/3).
The canvas implements `accordion` via `open={i === 0}` logic
(`render-edit/sections/FaqSection.svelte:18-19`) plus `.jp-faq--boxed`
(`journey-sections.css:529-530`).

**Hardcoded aesthetic inventory**
| Cat | What | Where |
|---|---|---|
| `width` | inner `max-width: 48rem`; answer `max-width: 60ch` | `:175`, `:340` |
| `type` | `text-align: center` on the head | `:181` |
| `type` | eyebrow `letter-spacing: .32em` (the widest of the four distinct eyebrow trackings) | `:189` |
| `type` | heading `--text-4xl`; question `--font-heading` + `--text-xl`; answer `--font-body` + `--text-base` | `:198`,`:250-252`,`:341-342` |
| `edge` | row separator `border-bottom: var(--border-width) solid var(--color-border-subtle)` | `:223` |
| `rhythm` | question `padding-block: var(--space-5)`; panel `padding-block: 0 var(--space-5)`; panel `padding-inline: 0 var(--space-12)` — the answer is indented by a fixed inline padding | `:233`,`:334-335` |
| `decoration` | `+`/`−` glyph built from two pseudo-element bars that rotate on `[open]` | `:521-527` |
| `motion` | imperative height animation in `smoothDetails` (`:74-131`) — reads `scrollHeight`, writes `panel.style.height` in px, listens for `transitionend` on `height` |
| `motion` | reveal stagger via `d1`–`d5` classes, capped at 5 (`:67` `Math.min(i + 1, 5)`) |
| `layout` | `list-style: none` on the list | `:234` |

**Non-token raw values**: `panel.style.height = '0px'` ×2 (`:96`,`:111`), `height:1px`
(`:208`), `margin-top:2px` (`:282`), `height:1.5px` (`:308`).

**Contrast/a11y**: native `<details>/<summary>` — keyboard and AT correct for free, and the
component says so (`:7-10`). `<h2>` `:141`. Icon is `aria-hidden` (`:154`).
`smoothDetails` calls `event.preventDefault()` on the summary click and then sets
`node.open` manually (`:88`,`:101`,`:109`) — the native toggle is replaced, and it bails
under reduced motion (`:87`). No `--color-text-tertiary`. Second-cleanest section.

**Complexity verdict: small.** The smallest real surface area. `open` and `boxed` are a
CSS-only change plus one boolean. Good candidate to pair with another type in one worktree.

---

### B.11 `invite` — `render/sections/InviteSection.svelte` · 532 lines

**Props read** (`:54-57`, `:70`): `eyebrow`, `sub`, `priceNote`, `heading` (fallback
`'Begin the work.'`), `ctaLabel` (fallback `'Join now'`), plus `offers[]` read *indirectly*
through `deriveOfferPaths(context.offer, context.course, config)` (`:62`) →
`offer-paths.ts:146-160` reads `offers[].{id, name, who, blurb, bullets, best}`.
**Context read**: `offer` (`:62`), `course` (`:62`), `enrolled` (`:68`,`:78`),
`dashboardUrl`/`checkoutUrl` (`:78-81`).

**Builder writes** (`section-fields.ts:233-256`): `eyebrow`, `heading`, `accent`, `sub`,
`price`, `button`, `risk`.

**DIFF**
- **W-only (4, dropped)**: `accent` (second italic line), `price`, `button` (renderer reads
  `ctaLabel`), `risk` (risk-reversal line).
  `price` is dropped **deliberately and correctly** — `Codex-2pryk.2.4.3` moved all pricing
  to `context.offer` (documented `:6-17`, `render/types.ts:247-260`). But the builder still
  offers the field with a hint telling creators to "Wrap the amount in the offer"
  (`section-fields.ts:247`). That is a control that actively invites a creator to state a
  price that will be ignored. `button` and `risk`, by contrast, are pure vocabulary drift.
- **R-only (3)**: `priceNote`, `ctaLabel`, `offers[]`. `offers[]` is the whole
  multi-path pricing surface — no author control exists, so `path.name`/`blurb`/`best`
  always come from `deriveOfferPaths`' own defaults.
- **Shared (3)**: `eyebrow`, `heading`, `sub`.

**Variant handling**: none. Declared-with-no-branch: `descent`, `banner`, `card` (3/3).

**Hardcoded aesthetic inventory**
| Cat | What | Where |
|---|---|---|
| `rhythm` | `min-height: 100svh` — the invite is always full-viewport (as is the hero; two full-height sections per page) | `:175` |
| `rhythm` | `padding-block: var(--space-24) var(--space-20)` | `:178` |
| `width` | inner `max-width: 60rem`; head `44rem` | `:276`, `:285` |
| `type` | `text-align: center` on the head **and** on the single-offer block | `:286`, `:384` |
| `layout` | offer grid `1fr` → `repeat(3, minmax(0,1fr))` — hardcoded 3-across | `:318`, `:328` |
| `type` | heading `--text-display` + `-0.02em`; offer name `--text-base`; price `--text-3xl` | `:300-304`,`:365`,`:409` |
| `edge` | offer + single card `border-radius: var(--radius-card)` | `:338`, `:378` |
| `edge` | badge `border-radius: var(--radius-full)` + `--text-xs` + uppercase + `.04em` | `:353-357` |
| `decoration` | descent hairline + travelling spark + glowing seed (`markup :106-108`), all absolutely positioned |
| `decoration` | ember "pool" `.invite__pool` in the no-paths branch (`markup :157`) |
| `motion` | `invite-breathe 8s`, `invite-descend 5s`, `invite-pulse 5s` | `:459`,`:463`,`:467` |
| `motion` | reveal ladder as explicit classes `--d1`/`--d2`/`--d3` in markup (`:115`,`:119`,`:124`) rather than an index |
| `layout` | `@media (max-width: 640px)` — **raw px breakpoint** | `:510` |
| `rhythm` | `padding-inline: var(--space-6)` inside that query | `:513` |

**Non-token raw values**: `width:1px` (`:230`), `0 0 12px 3px` (`:253`), `0 0 18px 5px`
(`:266`, `:502`), `0 0 26px 8px` (`:506`), `@media (max-width: 640px)` (`:510`).

**Contrast/a11y**: `<h2>` `:115`. `"Recommended"` badge (`:129`) is a plain `<span>` — it is
visible text so it is announced, but it is not programmatically associated with the offer it
labels. CTAs get names from `children`. Decorative layers `aria-hidden` (`:106`, `:157`).
No `--color-text-tertiary`.

**Complexity verdict: large.** Not for its CSS — for its blast radius. This is the
conversion surface, it depends on `offer-paths.ts` (460 lines + 564 lines of tests), it has
a deliberate "authored price is ignored" invariant that any refactor must preserve, and its
three variants (`descent`/`banner`/`card`) change the atmosphere layer, not just the grid.
Give it a dedicated worktree and pair it with the `offer-paths` tests.

---

### B.12 Diff summary table

| Type | W-only (dropped) | R-only (unwritable) | Bridged? |
|---|---|---|---|
| `hero` | `accent`, `sub`, `felt`, `button`, `quiet`, `bg` | `subheadline`, `ctaLabel`, `secondaryLabel`, `secondaryHref` | ✗ |
| `introVideo` | `kicker`, `clip`, `duration` | `eyebrow`, `posterUrl` | ✗ |
| `ache` | — | `beats[]` | ✓ |
| `turn` | — | `points[]` | ✓ (copy only) |
| `reel` | `kicker`, `clip`, `duration` | `eyebrow`, `posterUrl`, `captions[]`, `caption`, `tag` | ✗ |
| `map` | `heading`, `note` | `title`, `foot` | ✗ |
| `feel` | `kicker` | `eyebrow`, `inclusions[]`, `previewTitle`, `previewSub`, `previewDuration` | ✗ |
| `proof` | — | `trustLabel` | ✓ (but context shadows authored) |
| `guide` | `role`, `body`, `clip`, `duration` | `eyebrow`, `name`, `bio[]`, `portraitUrl`, `credentials[]` | ✗ |
| `faq` | — | `eyebrow`, `items[]` | ✓ |
| `invite` | `accent`, `price`*, `button`, `risk` | `priceNote`, `ctaLabel`, `offers[]` | ✗ |

*`price` is dropped by design (`Codex-2pryk.2.4.3`); the *field* should be removed, not read.

**Totals**: 7 types drop keys (hero, introVideo, reel, map, feel, guide, invite) — bead
`Codex-tqr51`'s claim is exact. **23 builder-writable keys are read by nothing.**
**26 renderer-read keys have no builder control**, 8 of them array shapes that carry a
section's primary content (`beats[]`, `points[]`, `items[]`, `inclusions[]`, `captions[]`,
`offers[]`, `bio[]`, `credentials[]`).

---

## C. Shared-substrate inventory

### C.1 The `--jp-*` token ladder

All declared in `apps/web/src/lib/page-builder/journey-palette.css` except three, which are
declared in `render-edit/journey-sections.css:28-40` under `.jp`.

| Token | Declared | Derives from | Consumers |
|---|---|---|---|
| `--jp-ink` | `journey-palette.css:72` (light pole), `:202` (dark pole) | `--brand-bg` → `--brand-bg-dark` → `--color-background` | the whole ladder; `JourneyRenderer.svelte:121` |
| `--jp-heading` | `:81-83` | `oklch(from --jp-ink clamp(0.05,(0.62-l)*100,0.96) calc(c*0.25) h)` — auto-contrast | 55 uses, mostly `journey-sections.css` |
| `--jp-ink-2/-3/-4` | `:88-90` | `--jp-ink` mixed 6/12/18% toward `--jp-heading` | `journey-sections.css`; aliased to `--color-surface*` at `:238-241` |
| `--jp-text` | `:93` | 82% heading | `.jp` root `:36`; alias `--color-text` `:154` |
| `--jp-dim` | `:94` | 70% heading | 15 uses; alias `--color-text-secondary` `:156` |
| **`--jp-faint`** | **`:95`** | **50% heading / 50% ink** | **13 uses; aliased to `--color-text-muted` AND `--color-text-tertiary` at `:157-158`** |
| `--jp-line-subtle/-line/-strong/-hover` | `:98-101` | 12/20/32/44% heading | aliased to `--color-border*` `:243-246` |
| `--jp-ember` | `:106` | `--brand-color` → `--color-brand-primary` → `--color-interactive` | 76 uses — the most-used token |
| `--jp-blood` / `--jp-blood-deep` | `:107-108` | `--brand-secondary`; `l - 0.08` | 16 / 6 |
| `--jp-rose` | `:109` | `--brand-accent` | 10 |
| `--jp-on-ember` | `:110` | auto-contrast off `--jp-ember` | 6 |
| `--jp-ember-text` | `:125` | `--jp-ember` 60% + `--jp-heading` | **1** — the AA-safe accent-text token exists and is almost unused |
| `--jp-atmos-veil` | `:140` | alpha ramps with `--jp-ink` lightness | `JourneyRenderer.svelte:145` |
| `--jp-serif` | `journey-sections.css:30` | `--font-heading` | 24 |
| `--jp-sans` | `journey-sections.css:31` | `--font-body` → `--font-sans` | 1 |
| `--jp-ease` | `journey-sections.css:32` | `--ease-out` | 17 |

**Flagged for `Codex-rvkmc`** — tokens used for *meaningful* text that derive too close to
the background:
- `--jp-faint` itself: a 50/50 mix of text and background by construction. Fails AA in both
  theme poles regardless of brand.
- The two aliases at `journey-palette.css:157-158` are what make this **wide**: any component
  inside a journey page that asks for the ordinary semantic `--color-text-muted` or
  `--color-text-tertiary` silently receives the 50% mix. In the public tree that is
  **12 declarations across 6 files**: `AcheSection.svelte:217` (+`:264` as a fill),
  `FeelSection.svelte:458,478,644`, `HeroSection.svelte:301,326,355`,
  `MapSection.svelte:497,507,610`, `TurnSection.svelte:410`. Several are `--text-xs`
  (`MapSection.svelte:494,502`), where the 4.5:1 small-text floor applies with no large-text
  exemption.
- `--jp-ember` used directly as small text is a second, documented case — the file itself
  measures it at 2.98:1 / 2.46:1 (`journey-palette.css:112-124`) and provides
  `--jp-ember-text` as the fix. That fix has **one** consumer. Any accent-text introduced by
  the new design axes must use `--jp-ember-text`, not `--jp-ember`.

### C.2 What is shared vs duplicated

**`render-edit/journey-sections.css` (575 lines) is shared by exactly one thing** —
`render-edit/SectionRenderer.svelte:12` imports it, and all 8 canvas components consume its
`.jp-*` classes. It is a *complete* design system for the canvas: 4 global primitives
(`.jp-kick :45`, `.jp-eyebrow :52`, `.jp-h :59`, `.jp-cta :66`), then per-section blocks, then
8 shared keyframes (`:560-567`) and one reduced-motion block (`:569-574`).

**Nothing in it reaches the public page.** The public sections import no CSS file; each
carries its own `<style>` block (roughly 200–650 lines each, ~4,100 lines total).

**Specific rules duplicated between the two trees** (same design intent, two independent
implementations, guaranteed to drift):

| Intent | Canvas | Public |
|---|---|---|
| eyebrow / kicker recipe | `.jp-eyebrow` `journey-sections.css:52-58`, `.jp-kick :45-51`, `.jp-prose__kick :317` | re-declared in **9** components with **4 different trackings**: `.08em` (`HeroSection:253`, `TurnSection:199`, `IntroVideoSection:161`, `MapSection:271`, `ProofSection:164`, `InviteSection:293`, `ReelSection:321`), `.18em` (`AcheSection:215`), `.28em` (`FeelSection:301`), `.32em` (`FaqSection:189`) |
| serif heading recipe | `.jp-h :59-65` | re-declared in all 11 (`--font-heading` + `--font-normal` + a `--text-*` + a negative tracking); tracking varies `-0.005em`/`-0.01em`/`-0.015em`/`-0.02em` |
| CTA | `.jp-cta :66-86` | `render/CtaLink.svelte` (a real `<a>` with a focus ring) — genuinely different and the public one is better |
| section padding | `clamp(2.6rem, 7cqw, 4.6rem)` container-relative (`:316`) | `var(--space-20)` / `var(--space-16)` / `var(--space-24)` viewport-fixed — the canvas is **container-query fluid** (`.jp { container-type: inline-size }` `:34`), the public tree is not |
| breathing glow | `.jp-hero__glow :99-116` | `HeroSection:183-198` |
| video frame | `.jp-video__frame :339-350` + corners `:364-368` | `IntroVideoSection:190+`, `ReelSection:363+` — twice more |
| descent spine + gates | `.jp-descent__spine :390`, `.jp-descent-gate__node :395` | `MapSection` `.descent__spine`, `.descent__node` |
| quote card + avatar | `.jp-proof-card :442`, `.jp-proof-av :449` + `nth-child(3n)` `:450-451` | `ProofSection` `.proof__figure`, `.proof__avatar` |
| accordion glyph | `.jp-faq__ic` `journey-sections.css:521-527` | `.faq__ic` `FaqSection:277-322` — same two rotating pseudo-element bars, reimplemented |
| reduced-motion kill switch | `journey-sections.css:569-574` (one block, `.jp *`) | **11 separate `@media (prefers-reduced-motion)` blocks**, one per component, some using `!important` (`TurnSection:446-471`, `HeroSection:542`, `ReelSection:907`) |

The canvas uses **container queries** (`@container (max-width: 420px)` `:304`,
`(max-width: 520px)` `:330`/`:376`, `(min-width: 680px)` `:413`, `(max-width: 620px)` `:497`)
while the public tree mixes custom-media (`@media (--breakpoint-md)` `TurnSection:175`) with
raw px (`ReelSection:876,890`, `InviteSection:510`). Unifying the responsive strategy is a
foundation-round decision, not a per-component one.

### C.3 `render/JourneyRenderer.svelte` — page-level atmosphere

157 lines. It owns:
- **Brand override injection** — `:82-86`, nested `[data-org-brand]` + inline
  `--brand-*` style attr from `brandOverridesToStyleAttr` (`:54-56`).
- **The palette classes** — `.journey-page.journey-palette` on the outer element,
  `.journey-palette--page` on an inner one (`:95`). The split is *cycle-critical* and
  explained at `:88-94`; a worktree must not collapse it.
- **`background: var(--jp-ink)` / `color: var(--jp-text)` / `overflow: clip`** — `:121-124`.
- **The single page-wide atmosphere** — `.journey-page__atmos` `:138-156`: a fixed-height
  (`min(90svh, 60rem)`) ember bloom, two `radial-gradient`s (ember 22% at `50% 0%`, rose 14%
  at `78% 12%`) under a `--jp-atmos-veil` wash.
- **The floating CTA** — `:97-101`, with hardcoded English labels `'Continue →'` / `'Begin →'`.
- **Context assembly** — `:70-79`; `checkoutUrl`/`dashboardUrl` via `buildJourneyUrl`.

**What must become configurable for a non-cinematic look**: the atmosphere block is the
page's single most opinionated element and has no off switch. `height: min(90svh, 60rem)`,
the two gradient positions/percentages, and the fact that it exists at all are all fixed.
A "quiet" or "editorial" page style needs `.journey-page__atmos` to be either token-driven
(`--jp-atmos-*` inputs) or gated by a page-level style attribute. `overflow: clip` on
`.journey-page` (`:124`) will also fight any variant that wants a bleed.

### C.4 The four shared primitives

| File | Lines | What it does | Style-locked? |
|---|---|---|---|
| `render/reveal.ts` | 77 | Svelte action. One-shot `IntersectionObserver`; adds `reveal--armed` from JS (so SSR/no-JS paint revealed), flips `is-in` on intersect. Bails entirely under `prefers-reduced-motion` or no `IntersectionObserver` (`:43-46`). | **No** — it ships zero CSS. Thresholds (`0.12`) and `rootMargin` (`0px 0px -8% 0px`) are overridable options (`:65-66`). The *paired CSS* lives in each consumer, so 9 components each define their own armed/in states. Genuinely reusable; keep it. |
| `render/CtaLink.svelte` | 122 | Token-driven `<a>` CTA with `data-variant` (`primary`/`secondary`) and `data-size` (`md`/`lg`). Guards `href` through `safeHref` (`:42`). Has the mandatory `:focus-visible` ring (`:109-112`). | **Partly.** Two variants and two sizes only, all `--color-*`-driven. `border-radius: var(--radius-button)` (`:62`), `--font-semibold` (`:64`), `translateY(1px)` on active (`:106` — the one raw px). A design-axis program will want a third/fourth weight (ghost, link) and per-section size control; this is a *small*, safe file to extend. |
| `render/FloatingCta.svelte` | 109 | Fixed bottom-centre pill; slides in past 50% viewport (`:41`). Correctly skips arming inside an iframe (`:36`) so the builder preview never shows it. `inert` when hidden (`:56`). | **Yes, fully.** Position (`bottom: var(--space-5)`, `left: 50%`), `border-radius: var(--radius-full)`, `backdrop-filter: blur(var(--blur-lg))`, `--shadow-xl`, and the `translate(-50%, 200%)` park are all fixed (`:62-85`). There is no way to turn it off, move it, or restyle it per page. Labels are hardcoded in `JourneyRenderer.svelte:100`. |
| `render/SectionSkeleton.svelte` | 59 | `{#await}` pending placeholder. `shape: 'media' \| 'text'`, wraps the DS `Skeleton`. `sr-only role="status"` label (`:32`). | **Mostly.** `aspect-ratio: 16 / 9` is hardcoded for the media shape (`:43`) — wrong for `ReelSection`'s 2.4:1 frame, which is why Reel rolls its own skeleton (`ReelSection:194`, `:727`, `:825`) instead of using this. Used by `IntroVideoSection` only (`:22`). Needs an `aspect` prop before it can serve both. Also re-declares `.sr-only` locally (`:48-58`) instead of using the global utility. |

---

## D. Test + i18n surface

### D.1 Tests

**Section-component tests — there are two.**

| File | Covers |
|---|---|
| `apps/web/src/lib/page-builder/render/SectionRenderer.svelte.test.ts` (102) | The *selection* contract only: enabled+known render in order, disabled dropped, unknown dropped. Asserts `selectRenderableSections` directly + one jsdom mount. **Does not assert any prop reaches a component**, which is precisely why `Codex-qcgo3` went unnoticed. |
| `apps/web/src/lib/page-builder/render/sections/IntroVideoSection.svelte.test.ts` | The only per-section test. Locks shell+stream: heading renders immediately, skeleton while pending, play affordance on resolve, graceful null. |

**Nine of eleven public sections have no test at all**: Hero, Ache, Turn, Reel, Map, Feel,
Proof, Guide, Faq. None of the 8 `render-edit` components has a test.

**Supporting tests that constrain the work**

| File | Lines | What it locks |
|---|---|---|
| `apps/web/src/lib/page-builder/section-catalog.test.ts` | 179 | Ship order as a literal array (`:31`), unique types, every def has label/summary/icon/keywords (`:39-44`), **every def has ≥1 variant and `defaultVariant` is in the set** (`:108-112`), `variantsForType('hero') >= 2` (`:116`), `resolveVariant` fallbacks (`:120-125`), `createSection`/`createDefaultSections` seeding. Table-driven — adding variants is safe, **renaming or reordering types is not**. |
| `apps/web/src/lib/components/page-builder/section-fields.test.ts` | 43 | Every catalogue type has ≥1 field; every field key matches `/^[a-zA-Z][a-zA-Z0-9]*$/` (`:24`); `select` must have options and nothing else may (`:29-33`); unknown type → generic `body`. |
| `apps/web/src/lib/page-builder/journey-palette.test.ts` | 395 | **The highest-blast-radius test in the program.** It reads `journey-palette.css` and `render-edit/journey-sections.css` **as text** and asserts structure: the compound selector has exactly 3 `.journey-palette` repetitions and no descendant combinator (`:86-87`); `--jp-ink` is declared exactly twice in the palette and **zero times** in `journey-sections.css` (`:95-97`); the ink derives from `--brand-bg` not `--color-brand-primary` in both poles (`:100-115`); both dark selector forms present (`:130-135`); heading auto-contrast is not a fixed lightness (`:139-146`); no surface token reads the brand primary (`:149-158`); **`journey-sections.css` must contain `@import '../journey-palette.css'` and it must precede the first rule** (`:171-178`); the two-class cycle-safety split (`:183-206`); the member dashboard's own re-points (`:209-265`); and a jsdom `JourneyRenderer` mount asserting the two palette classes sit on different, nested elements (`:329-391`). |
| `apps/web/src/lib/page-builder/render/coerce.test.ts` | 77 | The bridge readers. |
| `apps/web/src/lib/page-builder/offer-paths.test.ts` | 564 | Invite pricing derivation. |
| `apps/web/src/lib/page-builder/page-builder-store.test.ts` (349), `builder-save.test.ts` (581), `page-preview-bridge.test.ts` (325), `preview-protocol.test.ts` (62), `monetisation-store.test.ts` (304), `render/brand-overrides.test.ts` (117), `render/safe-href.test.ts` (40), `components/page-builder/preview-wiring.test.ts` (63) | Store/save/preview plumbing — unaffected by section-level work. |

**Consequence for the split**: `journey-palette.test.ts` is a text-assertion test over *both*
shared stylesheets. **Any worktree that edits either CSS file can break it**, and it will
break specifically if the foundation round splits `journey-sections.css` into partials
(the `@import`-before-first-rule assertion at `:171-178` and the "no `--jp-ink` here"
assertion at `:96-97`). It must be updated once, in the serial round.

### D.2 i18n

**There is no i18n in either tree. Zero paraglide references.**
`grep "m\.[a-z_]*("` and `grep "paraglide"` across `src/lib/page-builder` and
`src/lib/components/page-builder` return nothing (the only hits are the word "messages" in
a comment at `builder-save.ts:63` and a `.journey-palette` string count in a test). The rest
of the app uses `from '$paraglide/messages'` in **165** files, so this is a genuine gap, not
a project-wide absence.

**Section copy is author-supplied data** — `PageSection.props` jsonb, correctly not
translated.

**But there is a substantial body of hardcoded English that *is* rendered**, in two classes:

**(a) Builder-UI strings — `section-catalog.ts` + `section-fields.ts`, ~150 literals**
- 11 × `label` + 11 × `summary` (`section-catalog.ts:117-118`, `:162-163`, … `:405-406`)
- 37 × variant `label` + 37 × variant `hint` (`:78-81`, `:83-87`, `:89`, `:91-95`, `:100-104`,
  `:105`, `:106`, `:122-145`, `:244-261`, `:300-317`, `:342-359`, `:378-390`, `:410-427`)
- ~55 field `label` + ~15 field `hint` + 3 select option labels (`section-fields.ts:60-256`)
- All 11 `defaultProps` bodies are English seed copy (`section-catalog.ts:148-158` etc.) —
  these are *written into the creator's page* on section creation, so they are arguably data,
  not UI. Worth an explicit decision.

**(b) Hardcoded English on the PUBLIC page** — these render to visitors:
`'Begin the journey'` (`HeroSection:66`), `'Go to your dashboard'` (`HeroSection:65`,
`InviteSection:69`), `'Join now'` (`InviteSection:70`), `'Begin the work.'`
(`InviteSection:57`), `'Recommended'` (`InviteSection:129`), `'The honest answers.'`
(`FaqSection:63`), `'What the ground gives back.'` (`ProofSection:78`),
`"Everything you'll walk."` (`MapSection:55`), `'stages'` / `'practices'`
(`MapSection:181,184`), `'included with membership'` (`MapSection:225`),
`'Practice'`/`'Audio'`/`'Reflection'` (`MapSection:57-61`),
`'Ninety seconds inside the work.'` (`IntroVideoSection:42`),
`'Play the {N}-second intro film'` (`IntroVideoSection:107`),
`'This is what a descent looks like.'` (`ReelSection:50`), `'Preview'` (`ReelSection:65`),
`'Play the practice preview'` (`ReelSection:204`), `'Play preview'`/`'Pause preview'`
(`FeelSection:194`), `'Free taste — … preview'` (`FeelSection:185`),
`'The stages of the descent'` (`TurnSection:113`), `'Loading the intro film'`
(`IntroVideoSection:95`), `'Loading preview'` (`SectionSkeleton:20`),
`'Continue →'`/`'Begin →'` (`JourneyRenderer:100`), `'Portrait of {name}'`
(`GuideSection:72`), `'No visible sections…'` (`JourneyBuilderCanvas:192`).

**Blast radius**: `messages/en.json` and the generated `src/paraglide/messages/*.js` +
`messages.js` barrel are **single-owner files** — the recorded rule is that a worktree must
never `git restore` them in isolation, and that a key needs *both* generated files. If the
program adds i18n keys per section type, every worktree touches `en.json`. **Recommendation:
add every i18n key the program will need in the serial foundation round, in one commit, and
forbid parallel worktrees from touching `en.json` at all.** Alternatively defer i18n
entirely to a final consolidation pass — but do not let 7 worktrees each add keys.

### D.3 Playwright e2e — **zero blast radius**

`find e2e -name "*.spec.ts"` returns 38 specs. **None touches the journey builder or a
journey sales page.** `grep -rn "journeys" e2e/` returns **nothing**. The only matches for
"builder"/"Journey" in `e2e/` are incidental comments about Melt UI's *toast builder*
(`e2e/agreements/propose-accept.spec.ts:81-83`) and its *combobox builder*
(`e2e/studio/team.spec.ts:101`).

No e2e spec uses a text locator that variant labels or section copy could break. The
existing journey suites are unit/component-level only. **This removes e2e from the
coordination problem entirely** — but it also means there is no end-to-end regression net,
so the recorded *verify before close* rule has to be satisfied by manual Playwright checks
per worktree, not by a suite.

---

## E. Work-splitting recommendation

### E.1 The hard constraint

Per-type parallelism is **impossible as the tree stands**, for three independent reasons:

1. **`render-edit/journey-sections.css` is one file holding every type's variant CSS**
   (`:87-557`). Every worktree needs it.
2. **`render-edit/sections/ProseSection.svelte` serves 3 types** (ache/turn/feel) and
   **`VideoSection.svelte` serves 2** (introVideo/reel). Five types, two files.
3. **Six per-type declarations live in shared files**: `section-catalog.ts` (all 11 types'
   variants + defaults), `section-fields.ts` (all 11 field sets), `render/types.ts` (all 11
   prop interfaces), `render/section-registry.ts` (the props contract), `render/coerce.ts`
   (the bridge readers), `render/SectionRenderer.svelte` (the plumbing).

### E.2 SERIAL FOUNDATION ROUND — must land before any parallel work

Every file below would otherwise be touched by two or more worktrees.

**Tier 1 — the contract (no parallel work can begin without these)**

| File | Lines | Why serial | What must land |
|---|---:|---|---|
| `packages/shared-types/src/journeys.ts` | — (§`:41-85`) | Frozen cross-worker contract; `variant` already exists at `:77`. If the program adds a `design`/`SectionDesign` field it goes here **and** in the barrel `index.ts` (additive types need both — recorded rule). | Any new `PageSection` field; nothing else. |
| `apps/web/src/lib/page-builder/render/section-registry.ts` | 97 | `SectionComponentProps` (`:34-37`) is the single props contract for all 11. | Add `variant` (+ any design prop) to the interface. |
| `apps/web/src/lib/page-builder/render/SectionRenderer.svelte` | 45 | `:33` is the one call site. | Pass `variant={resolveVariant(section)}` and the design prop. Import `resolveVariant` from `../section-catalog`. |
| `apps/web/src/lib/page-builder/render-edit/section-render.ts` | 57 | The canvas contract (`:33-44`) must converge with the public one, or the two trees stay divergent forever. | Decide: unify onto one contract, or keep two and accept permanent drift. **Recommend unify.** |
| `apps/web/src/lib/page-builder/render/types.ts` | 283 | All 11 per-type prop interfaces in one file (`:118-280`). | Reconcile every interface with the builder vocabulary in one pass (this *is* `Codex-tqr51` stage 2). |
| `apps/web/src/lib/page-builder/section-catalog.ts` | 549 | All 11 defs, all 37 variants, all 11 `defaultProps`. | Final variant/preset id set + defaults. **Nothing else may edit this file afterwards.** |
| `apps/web/src/lib/components/page-builder/section-fields.ts` | 265 | All 11 field sets. | Final field set per type, including the array editors the R-only keys need. Consider moving it into `$lib/page-builder` as `Codex-tqr51` proposes, so catalogue + fields are one inert module — that move is itself a foundation-round act. |
| `apps/web/src/lib/page-builder/render/coerce.ts` | 159 | Shared readers (`asStringFrom`, `asStringsFrom`, `asNumberedGroups` — the existing bridge, `:58-130`). | Any new reader (object-array editors, numeric, enum). |

**Tier 2 — the CSS substrate (the single most important foundation act)**

| File | Lines | Why serial | What must land |
|---|---:|---|---|
| `apps/web/src/lib/page-builder/render-edit/journey-sections.css` | 575 | Holds all 8 components' styling **and all 37 variant modifiers**. | **Split it into per-family partials** — `journey-sections/_base.css` (the `.jp` root `:28-40`, `.jp-kick/.jp-eyebrow/.jp-h/.jp-cta` `:45-86`, the 8 keyframes `:560-567`, the reduced-motion block `:569-574`) plus `_hero.css`, `_prose.css`, `_video.css`, `_descent.css`, `_proof.css`, `_guide.css`, `_faq.css`, `_invite.css`. **Without this split, parallel worktrees are not disjoint and the program serialises on one 575-line file.** |
| `apps/web/src/lib/page-builder/journey-palette.css` | 247 | Consumed by 4 surfaces (public renderer, canvas, checkout, member dashboard). | Any new design-axis token layer (`--jp-measure-*`, `--jp-rhythm-*`, `--jp-atmos-*`…). Also the right place to fix `--jp-faint` (`:95`) for `Codex-rvkmc` — one line, four surfaces. Do it here, once. |
| A **new** shared public-section CSS layer | — | If the public sections are to share the eyebrow/heading/measure recipes instead of re-declaring them 9–11 times, that layer must exist before any worktree can consume it. | Create it in the foundation round; each worktree then deletes its local duplicate. |

**Tier 3 — shared components and barrels**

| File | Lines | Why serial |
|---|---:|---|
| `render-edit/sections/ProseSection.svelte` | 40 | Serves `ache` + `turn` + `feel` — three worktrees. |
| `render-edit/sections/VideoSection.svelte` | 46 | Serves `introVideo` + `reel` — two worktrees. |
| `render/CtaLink.svelte` | 122 | Used by `hero` + `invite`; likely gains variants for everyone. |
| `render/SectionSkeleton.svelte` | 59 | Needs an `aspect` prop before `reel` can stop rolling its own. |
| `render/reveal.ts` | 77 | Used by 9 of 11. Safe as-is; freeze it rather than edit it. |
| `render/FloatingCta.svelte` | 109 | Page-level; only changes if the atmosphere becomes configurable. |
| `render/JourneyRenderer.svelte` | 157 | Owns the palette-class split and the page atmosphere. |
| `render/index.ts` (49) · `page-builder/index.ts` (92) · `render-edit/index.ts` (24) · `components/page-builder/index.ts` (45) | — | Four barrels. Every new export lands in one of them → merge conflicts. Add all planned exports in the foundation round. |
| `components/page-builder/VariantPicker.svelte` | 195 | Draws a schematic per `variant.thumb` key. Every new `thumb` value needs a new schematic **here**. All 11 types share it. |
| `components/page-builder/SectionEditor.svelte` | 342 | Renders the variant picker (`:80-92`) and the field controls for all types. |

**Tier 4 — tests that must be updated once**

| File | Lines | Why |
|---|---:|---|
| `apps/web/src/lib/page-builder/journey-palette.test.ts` | 395 | Text-asserts **both** shared stylesheets. The `journey-sections.css` split (Tier 2) breaks `:96-97` and `:171-178`. Must be rewritten in the same commit as the split. |
| `apps/web/src/lib/page-builder/section-catalog.test.ts` | 179 | Table-driven over the catalogue; the variant assertions (`:108-125`) are the natural home for the new "every declared variant has an implementation" guard `Codex-qcgo3` asks for. |
| `apps/web/src/lib/components/page-builder/section-fields.test.ts` | 43 | Same for fields; the natural home for `Codex-tqr51`'s round-trip table test ("every writable key is read, every read key is writable"). |
| `apps/web/src/lib/page-builder/render/SectionRenderer.svelte.test.ts` | 102 | Must gain a "variant reaches the component" assertion, or `Codex-qcgo3` can regress silently. |
| `messages/en.json` + `src/paraglide/messages/*.js` + `src/paraglide/messages.js` | — | Single-owner. Land **all** i18n keys here in one commit or defer i18n entirely to consolidation. |

### E.3 PARALLEL ROUNDS — disjoint file sets (valid *only after* E.2 lands)

Seven worktrees, grouped so that no two share a file. The grouping is forced by the
`render-edit` twin sharing, not chosen.

| WT | Types | Owns exclusively | Notes |
|---|---|---|---|
| **WT-1 · prose** | `ache`, `turn`, `feel` | `render/sections/AcheSection.svelte` (350) · `render/sections/TurnSection.svelte` (472) · `render/sections/FeelSection.svelte` (703) · `render-edit/sections/ProseSection.svelte` (40) · `journey-sections/_prose.css` | Largest by lines (1565). Must own `Codex-scab9` (Feel's fake player) and the aria-hidden seek div. `points[]`/`inclusions[]`/`beats[]` array editors. All three share one variant set, so one variant implementation serves three types — good leverage. |
| **WT-2 · video** | `introVideo`, `reel` | `render/sections/IntroVideoSection.svelte` (441) + its test · `render/sections/ReelSection.svelte` (935) · `render-edit/sections/VideoSection.svelte` (46) · `journey-sections/_video.css` | Contains the tree's hardest component. Owns the two raw-px breakpoints (`ReelSection:876,890`), the 5 blend layers, the 32 SVG rects, and the aspect-ratio↔scrim coupling. Both types share `VIDEO_VARIANTS`, so again one implementation serves two. **Do not add a third type here.** |
| **WT-3 · hero** | `hero` | `render/sections/HeroSection.svelte` (553) · `render-edit/sections/HeroSection.svelte` (106) · `journey-sections/_hero.css` | Highest-visibility surface. 6 dropped keys, 4 variants, 8 keyframes, `100svh`, the per-word DOM split, and the `bg` (ember/blood/still) treatment the canvas already implements. |
| **WT-4 · map** | `map` | `render/sections/MapSection.svelte` (685) · `render-edit/sections/MapSection.svelte` (132) · `journey-sections/_descent.css` | Two coupled JS systems; the canvas twin is the reference for all 3 variants. Also owns removing the 🔒 emoji. |
| **WT-5 · social** | `proof`, `faq` | `render/sections/ProofSection.svelte` (467) · `render/sections/FaqSection.svelte` (413) · `render-edit/sections/ProofSection.svelte` (54) · `render-edit/sections/FaqSection.svelte` (45) · `journey-sections/_proof.css` · `journey-sections/_faq.css` | The two cleanest types (both fully bridged, both a11y-sound). Lightest worktree — pair them. Owns the `proof` context-vs-authored precedence decision. |
| **WT-6 · guide** | `guide` | `render/sections/GuideSection.svelte` (452) · `render-edit/sections/GuideSection.svelte` (40) · `journey-sections/_guide.css` | Mostly a *data* worktree: `body`→`bio[]`, `role`→`eyebrow`, and wiring the two dead media slots (`guidePortraitMediaId`, `guideVideoMediaId`) into the public render context. That last part reaches `journey-queries.ts` / `SellPreview` — **flag it: it may need a foundation-round contract addition**, in which case decide it in E.2, not here. |
| **WT-7 · invite** | `invite` | `render/sections/InviteSection.svelte` (532) · `render-edit/sections/InviteSection.svelte` (50) · `journey-sections/_invite.css` · `offer-paths.ts` (460) + `offer-paths.test.ts` (564) | Commerce-critical. Must preserve the "authored price is never rendered" invariant (`Codex-2pryk.2.4.3`). Owns deleting the misleading `price` field and adding an `offers[]` editor. |

At two worktrees at a time that is four rounds: (WT-3, WT-5) → (WT-1, WT-4) →
(WT-2, WT-7) → (WT-6, +consolidation). WT-3 and WT-5 first because they are the
highest-visibility and the lowest-risk respectively — a good pair to validate the foundation
contract before committing the harder types to it.

### E.4 Files MORE THAN ONE worktree would touch — the definitive list

These are the serial-round deliverables. Any of them still in flux when parallel work
starts will produce merge conflicts, and the recorded *auto-merge Frankenstein* failure mode
(sibling PRs silently combining both sides, requiring `svelte-check` on changed files with a
warm build) applies directly.

**Contract & model (8)**
1. `packages/shared-types/src/journeys.ts` — and its barrel `packages/shared-types/src/index.ts`
2. `apps/web/src/lib/page-builder/section-catalog.ts`
3. `apps/web/src/lib/components/page-builder/section-fields.ts`
4. `apps/web/src/lib/page-builder/render/types.ts`
5. `apps/web/src/lib/page-builder/render/section-registry.ts`
6. `apps/web/src/lib/page-builder/render/SectionRenderer.svelte`
7. `apps/web/src/lib/page-builder/render/coerce.ts`
8. `apps/web/src/lib/page-builder/render-edit/section-render.ts`

**CSS substrate (3)**
9. `apps/web/src/lib/page-builder/render-edit/journey-sections.css` — **must be split**
10. `apps/web/src/lib/page-builder/journey-palette.css`
11. the new shared public-section CSS layer (does not exist yet)

**Shared components (6)**
12. `apps/web/src/lib/page-builder/render-edit/sections/ProseSection.svelte` — 3 types
13. `apps/web/src/lib/page-builder/render-edit/sections/VideoSection.svelte` — 2 types
14. `apps/web/src/lib/page-builder/render/CtaLink.svelte`
15. `apps/web/src/lib/page-builder/render/SectionSkeleton.svelte`
16. `apps/web/src/lib/page-builder/render/JourneyRenderer.svelte`
17. `apps/web/src/lib/page-builder/render/FloatingCta.svelte`

**Builder UI (2)**
18. `apps/web/src/lib/components/page-builder/VariantPicker.svelte`
19. `apps/web/src/lib/components/page-builder/SectionEditor.svelte`

**Barrels (4)**
20. `apps/web/src/lib/page-builder/index.ts`
21. `apps/web/src/lib/page-builder/render/index.ts`
22. `apps/web/src/lib/page-builder/render-edit/index.ts`
23. `apps/web/src/lib/components/page-builder/index.ts`

**Tests (4)**
24. `apps/web/src/lib/page-builder/journey-palette.test.ts` — text-asserts both stylesheets
25. `apps/web/src/lib/page-builder/section-catalog.test.ts`
26. `apps/web/src/lib/components/page-builder/section-fields.test.ts`
27. `apps/web/src/lib/page-builder/render/SectionRenderer.svelte.test.ts`

**i18n (1, single-owner)**
28. `apps/web/messages/en.json` + generated `src/paraglide/messages/en.js` and
    `src/paraglide/messages.js`

**Frozen — do not edit in any round**
- `apps/web/src/lib/page-builder/render/reveal.ts` (77) — correct as-is, used by 9 of 11
- `apps/web/src/lib/page-builder/render/safe-href.ts` (41) — security guard
- `apps/web/src/lib/page-builder/render/brand-overrides.ts` (138) + its 117-line test
- `apps/web/src/lib/page-builder/page-builder-store.svelte.ts` (528), `builder-save.ts` (335),
  `page-preview-bridge.ts` (163), `preview-protocol.ts` (81) — store/save plumbing, orthogonal

### E.5 Three open questions the foundation round must answer

1. **Unify the two trees, or keep both?** Keeping both means every worktree implements each
   design twice, in two vocabularies, with no shared CSS — and the drift this audit documents
   returns within one cycle. Unifying onto one component per type behind an `editable` flag
   is what `JourneyBuilderCanvas.svelte:13-14` already files as the follow-up, and what
   `Codex-qcgo3`'s SCOPE section calls for. **Recommend unify, and treat the unification as
   the foundation round's primary deliverable.** If it unifies, the E.3 split collapses to
   one file per type plus one CSS partial per type — genuinely disjoint, no shared twins.
2. **Container queries or viewport media queries?** The canvas is container-query fluid
   (`.jp { container-type: inline-size }`, `journey-sections.css:34`); the public tree is not.
   A design-axis system that expresses `measure` and `rhythm` needs one answer, decided once.
3. **Does the guide's portrait need a contract change?** `guidePortraitMediaId` is written but
   never projected into the public render context. Surfacing it means adding a field to
   `JourneyCourseView` or `SellPreview` — a shared-types edit that belongs in E.2, not WT-6.

---

## Appendix — raw non-token values by file (pre-existing violations)

82 raw-`px` occurrences and 12 raw hex/rgb occurrences across the public tree. Per file:
`ReelSection` 18 px + 6 rgb/hex · `MapSection` 13 · `FeelSection` 10 · `ProofSection` 9 ·
`InviteSection` 6 · `TurnSection` 6 · `AcheSection` 5 · `FaqSection` 5 · `HeroSection` 4 ·
`SectionSkeleton` 3 · `IntroVideoSection` 2 px + 2 hex · `CtaLink` 1 · `GuideSection` 0 px +
2 hex · `FloatingCta`, `JourneyRenderer`, `SectionRenderer` 0.

Distinct classes, in descending value:
- **`rgba(0,0,0,·)` for scrims/text-shadows** — `ReelSection:372,577,614,656,698`. Should be
  `color-mix(in oklab, var(--color-background) …)` or a `--jp-scrim-*` token; these are the
  values that break on a light-brand org.
- **`#000` inside `color-mix`** — `GuideSection:197,211`, `IntroVideoSection:210,339`,
  `ReelSection:371,475`. Same fix.
- **Raw-px media queries** bypassing `--breakpoint-*` — `ReelSection:876` (`760px`),
  `ReelSection:890` (`420px`), `InviteSection:510` (`640px`). Contrast
  `TurnSection:175` which correctly uses `@media (--breakpoint-md)`.
- **Raw transition durations** bypassing `--duration-*` — `AcheSection:314-316` (`0.85s` ×3),
  `AcheSection:291` (`8s ease-in-out`), plus ~20 raw `ms` delays in `TurnSection:357-441`.
- **Hairlines and glows as raw px** — `1px`/`1.5px`/`2px` widths and `0 0 Npx` box-shadows
  throughout; `--border-width` and a `--glow-*` token set would absorb nearly all of them.
- **`SectionSkeleton:48-58`** re-declares `.sr-only` locally; `MapSection:534-537` does the
  same. Both should use the global utility.

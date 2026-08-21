# Measured contrast baseline — before any change

Measured 2026-08-19 on the running dev stack, `of-blood-and-bones` →
`/journeys/pricing-smoke-test` (the golden page, 11 sections, the only page with
`brandOverrides`). Org brand: cream `#F6EFE6` light ink / `#200000` dark ink.

> **CORRECTION (WT-3 pilot).** This document originally said "brand accent resolves to `#552e8e`". That
> is the **LIGHT value only** — `of-blood-and-bones` has a distinct dark brand, `#e1233b`, which my
> original measurement missed because it read `getComputedStyle` immediately after flipping the theme and
> got the pre-flip value back. **The flip needs a settle: 2× `requestAnimationFrame` plus ~260ms.**
> Without it every theme-flipped number is quietly wrong in both directions, and looks plausible.
>
> Every `--jp-ember` / `--jp-ember-text` figure below was therefore measured against the light purple at
> both poles. They are correct as *measurements of the current token*, because `--jp-ember` is itself
> theme-blind (`Codex-8jve9`) — it reads `--brand-color`, which is always set, so the theme-aware
> fallback never fires. When that bead is fixed, the dark-pole accent numbers here must be re-derived
> against `#e1233b`, including `--jp-ember-text`'s 55% calibration.

**Method.** Canvas `fillStyle` + `getImageData` readback, because Chrome serialises `color-mix()` as
`oklab()` floats and a regex over `getComputedStyle` returns garbage ~1.0 ratios. Effective background
resolved by walking ancestors until alpha > 250, because `body` is transparent in this app. Theme
flipped by setting BOTH `data-theme="dark"` and the `.dark` class — `org-brand.css` keys its dark
branches on both forms, so setting one leaves the other's rules matching.

## The numbers

| Role / selector | Light | Dark | AA floor | Verdict |
|---|---:|---:|---|---|
| `--jp-heading` | 18.38 | 17.51 | 4.5 / 3 | pass, comfortably, both poles |
| `--jp-text` | 15.41 | 11.04 | 4.5 | pass |
| `--jp-dim` | 11.05 | 7.79 | 4.5 | pass |
| **`--jp-faint`** | 5.22 | **4.11** | 4.5 | **FAILS in dark** |
| `--jp-ember` *(as text)* | 8.49 | **2.04** | 4.5 | **FAILS in dark, hard** |
| `--jp-ember-text` | 13.93 | 5.40 | 4.5 | pass — the mitigation works |
| `--jp-line` *(as boundary)* | 1.79 | 1.49 | 3.0 | **FAILS both** |
| `--jp-line-subtle` | 1.40 | — | 3.0 | fails both (decorative only) |
| `p` | 11.05 | 7.79 | 4.5 | pass |
| `h2` (48px) | 18.38 | 17.51 | 3.0 | pass |
| **`.ache__chapter`** (15px / 600) | 5.22 | **4.11** | 4.5 | **FAILS in dark** |
| **`.descent__rn`** (20px / 400) | **3.74** | **3.74** | 4.5 | **FAILS both** |

15px at weight 600 is **not** WCAG "large text" — large requires ≥24px, or ≥18.66px bold. So
`.ache__chapter` needs the full 4.5:1 and misses it in dark.

## What this corrects

Bead **`Codex-rvkmc`** is directionally right but wrong in its specifics, and the difference changes
where the fix goes:

- It reports `.ache__chapter` at **4.22**. Measured **4.11 dark / 5.22 light**.
- It reports `.descent__rn` at **1.78 via brand-accent**. Measured **3.74 in both themes** — and its
  background reads `rgb(210,204,196)` in *dark* theme, i.e. the same as light. That element sits on a
  surface that does not follow the theme flip, which is a separate and arguably more interesting defect
  than the ratio.
- Most importantly, the bead does not say **which theme**. `--jp-faint` PASSES in light (5.22) and
  FAILS in dark (4.11). A fix validated only in light theme would look correct and ship the bug.

## What it confirms

The research's warning about the ember is exactly right, and brand-dependent in a way worth noting:
`--jp-ember` measures **2.04:1 in dark** — a hard fail as text — while measuring a comfortable
**8.49:1 in light** on this org, because this brand's accent resolves to a dark purple. So a
light-theme-only check would pass and a different brand would fail differently.

That is precisely why the rule is stated as an absolute rather than a measurement: **`accent: text` and
`accent: glow` must resolve to `--jp-ember-text`, never `--jp-ember`** — measured 5.40:1 dark /
13.93:1 light. The guarantee has to hold for every brand, not just the ones that happen to pass.

## AFTER F-B1 — browser-verified (commit `d1c69754`, port 3020)

| Role / selector | Light before → after | Dark before → after | Floor | Verdict |
|---|---|---|---|---|
| `--jp-faint` | 5.22 → **7.14** | **4.11 → 5.38** | 4.5 | **FIXED** — 50% → 58% mix toward heading |
| `.ache__chapter` | 5.22 → **7.14** | **4.11 → 5.38** | 4.5 | **FIXED** |
| `--jp-ember-text` | 13.93 → 14.62 | 5.40 → **6.04** | 4.5 | improved — 60% → 55% mix |
| `--jp-text` / `--jp-dim` / `--jp-heading` | unchanged | unchanged | — | no collateral drift |
| **`.descent__rn`** (20px / 400) | 3.74 → **4.45** | 3.74 → **4.45** | 4.5 | **STILL FAILS** → WT-4 |

Both poles resolve to real colours in both themes, which is the two-pole refactor working:
light `--jp-pole-a` `rgb(246,239,230)` / `--jp-pole-b` `rgb(1,0,0)`; dark `--jp-pole-a` `rgb(32,0,0)` /
`--jp-pole-b` `rgb(252,238,236)`. The dark branch re-points **pole A**, and pole B follows.

`--jp-faint` was deliberately not pushed further: it stays a 1.45× separation below `--jp-dim`, so it
remains a real rung rather than becoming a synonym for dim. A test guards the separation at >1.25×.

### An extra finding from the 8-brand sweep, not in the original bead

`--jp-ember-text` at its old 60% mix measured **4.45:1 on a `surface: panel` background in dark**.
`panel` lifts the section background 12% toward the contrast pole, and the accent-text rung had only
0.9 of headroom against the page ink. Three of five `accent` values put text in that position, so this
was **12 of the 100 swept combinations** — a broken preset, not an edge case. Now 55%, clearing 4.5 on
panel at both poles. The research's mitigation was validated against the page ink only; the sweep is
what caught that a lifted surface changes the answer.

### `.descent__rn` — the ratio is the symptom, the surface is the cause

Its effective background owner is **`.descent__node` at `rgb(56,21,17)`, identical in light and dark**.
The descent node surface does not respond to the theme flip at all, which is why the ratio is the same
number in both themes and why no palette change can fix it. **WT-4 (map) owns this** — it is a
`MapSection.svelte` / `_descent.css` defect, not a palette one.

## Consequences for the work

1. **F-B owns the `--jp-faint` fix**, and must verify in **dark** — the pole where it fails. One line in
   `journey-palette.css`, four consuming surfaces.
2. **`--jp-line` at 1.79 / 1.49 fails 3:1**, so it may not be the only signal for any meaningful
   boundary. This lands on the `edge: hairline` axis value: research §5.2 predicted it for the editorial
   family, and it is measured here. Where a hairline carries structure, use `--jp-line` at minimum and
   pair it with space or a heading — never elevation alone (which is the `contemporary` family's quiet
   failure: `--shadow-sm` on `--jp-ink-3` over `--jp-ink` gives a card boundary well under 3:1).
3. **`.descent__rn`'s non-flipping background** belongs to WT-4 (`map`). Flag it there explicitly: the
   ratio is a symptom, the stale surface is the cause.
4. Every WP re-measures these roles for the text it touches, in all six org × theme combinations. This
   table is the light/dark baseline for `of-blood-and-bones` only; `studio-alpha` (#E11D48) and
   `studio-beta` (#2563EB) will differ, and the ember reading especially so.

---

## ROUND 2 CORRECTION — figures taken before the longer settle are SUSPECT

`.descent__node` is recorded above as `rgb(56,21,17)` "identical in light AND dark." **It is
not theme-invariant.** WT-4 measured it responding normally: pre-lit fill `rgb(210,204,196)`
light / `rgb(56,21,17)` dark — simply the two poles of `--color-surface-secondary`. The two
passes that produced the "invariant" reading **each measured one pole twice**, because the
settle was shorter than the element's own `background` transition (800ms at `drift`).

That is pilot lesson 8's artifact corrupting a baseline document rather than a live reading, so
**any figure here taken with a ~260ms settle should be re-measured** before being relied on.
The corrected method is 2× `requestAnimationFrame` plus a timeout longer than the longest
`transition-duration` in the section — 1200ms in practice. See contract A45 and A46.

Also add, since sections reach it through a `--color-*` alias without knowing: `--jp-line-subtle`
(what `--color-border-subtle` re-points to) measures **1.40 light / 1.21 dark**, fainter than
the documented `--jp-line` at 1.79 / 1.49.

And note `.descent__rn`'s recorded 4.45:1 is its **pre-lit dim** state; the state SSR serves
measured **1.13:1** in light. A single ratio per element is not enough when the element has an
enhancement pass.

---

## ROUND 4 RE-MEASUREMENT — the accent ladder, done properly (`Codex-gkhro`)

The correction above says any figure taken with a ~260ms settle should be re-measured. This is the
first block of that work: **the whole accent ladder, both poles, all five accent values**, on the
golden org and page.

**Method**, per contract A67 — worth stating because two of its clauses were established by finding
that the earlier method produced confident wrong numbers:
- Canvas `fillStyle` + `getImageData` with `globalCompositeOperation = 'copy'`. With the default
  `source-over` a transparent parent composites onto the previous pixel and reads back opaque.
- Effective background resolved by **walking ancestors until alpha > 250** (`body` is transparent).
- Theme flipped by setting **both** `data-theme` AND the `.dark` class — `data-theme` alone leaves
  `.dark` selectors matching.
- Settle of **2× `requestAnimationFrame` plus 1300ms** (A46).
- **Reveals forced `is-in`** before measuring (A67c) — `reveal.ts` arms `opacity: 0` from JS and clears
  it only when an IntersectionObserver fires, so a below-the-fold section stays invisible indefinitely
  and a crop behind one reads the page background as a plausible, stable, wrong ratio.

**Surface:** `of-blood-and-bones` / `pricing-smoke-test`, the `map` section.
`--jp-sec-bg` resolved to `rgb(32,0,0)` dark and `rgb(246,239,230)` light.

| accent | `--jp-accent-mark` dark | `--jp-accent-text` dark | mark light | text light |
|---|---|---|---|---|
| `none` | 17.51 | 17.51 | 18.38 | 18.38 |
| `text` | 6.04 | 6.04 | 14.62 | 14.62 |
| `fill` | 6.04 | 6.04 | 14.62 | 14.62 |
| `edge` | **6.04** | **11.04** | **14.62** | **15.41** |
| `glow` | 6.04 | 6.04 | 14.62 | 14.62 |

Resolved colours: `--jp-accent-mark` and `--jp-accent-text` are both `rgb(155,132,187)` wherever they
agree; at `accent: none` both are `rgb(252,238,236)`; `--jp-accent-text` at `accent: edge` is
`rgb(210,189,185)`.

### The correction this produced: a 2.04 that was attributed to the wrong token

`MapSection` recorded, in round 2, that `--jp-accent-mark` "is 8.49:1 in light and **2.04:1 in dark**",
and built a local `--descent-signal` alias to avoid it. Re-measured, the token that actually measures
**2.04 dark** is `--jp-ember` / `--jp-accent-fill` — `rgb(85,46,142)`. `--jp-accent-mark` is
`rgb(155,132,187)` at **6.04**, because A38 repointed it off `--jp-ember` onto `--jp-ember-text`.

Round 2 read the *aliased* token's ratio onto the *alias*. That is a standing hazard here, because this
palette is layered aliases several deep: **read both expressions before believing that X mirrors Y.**

Two things worth noting alongside it:
- The same run reproduced **`--jp-accent-edge` at 2.05 dark**, matching WT-6's independent figure
  exactly. So that measurement was sound; only the accent-mark one was a conflation. `--jp-accent-edge`
  remains decorative-only.
- `--jp-accent-mark` and `--jp-accent-text` are now **identical at four of five accent values**, which
  is what licensed collapsing `--descent-signal` back onto `--jp-accent-mark` (round 4, and zero visual
  change on any published page, because Candlelit is `accent: glow` where they already agreed).

### A token's ratio is not what it paints

`.descent__spine` reads `--descent-signal` and then mixes it 80% toward transparent at the call site, so
it measures **11.04 dark** where the raw token is 6.04. `.descent__node` measures **9.13 dark**. Both
readings are unchanged before and after the collapse.

So: measure the ELEMENT for a pass/fail claim, and the token only to understand which rung you are on.
A table of token ratios cannot tell you whether a component passes.

### Still outstanding for `Codex-gkhro`

Everything above the "ROUND 2 CORRECTION" heading remains taken with the short settle. This block
covers the accent ladder only. The per-element figures for the other ten section types have not been
re-measured, and the note about `.descent__rn` having three different ratios depending on enhancement
state is the reason a re-sweep must **name the state it measured** rather than recording one number
per element.

## ROUND 4 RE-MEASUREMENT, part 2 — the full-page dark sweep (`Codex-gkhro`)

**Every text-bearing leaf in all 11 sections** of the golden page, dark pole, WCAG floors applied per
element (4.5 normal, 3.0 for ≥24px or ≥18.66px bold). Method as part 1, plus the corrected reveal
disarm (see A67(c) — the `is-in` approach in the first draft of that amendment does not work).

**Result: ZERO failures.** Worst margin per section, sorted by headroom:

| section | worst element | size | ratio | floor | headroom | leaves measured |
|---|---|---|---|---|---|---|
| `hero` | `.cta` "Get started" | 17px | **4.66** | 4.5 | **+0.16** | 16 |
| `invite` | `.cta` "Get started" | 15px | **4.66** | 4.5 | **+0.16** | 26 |
| `map` | numeral "12" | 13px | 5.00 | 4.5 | +0.50 | 25 |
| `feel` | `.jp-sec__eyebrow` | 15px | 6.04 | 4.5 | +1.54 | 3 |
| `ache` ×2 | `.jp-sec__eyebrow` | 15px | 7.79 | 4.5 | +3.29 | 3 |
| `turn` | `.jp-sec__eyebrow` | 15px | 7.79 | 4.5 | +3.29 | 3 |
| `introVideo` | `.jp-sec__eyebrow` | 15px | 7.79 | 4.5 | +3.29 | 4 |
| `reel` | `.jp-sec__eyebrow` | 15px | 7.79 | 4.5 | +3.29 | 5 |
| `proof` | `.jp-sec__eyebrow` | 15px | 7.79 | 4.5 | +3.29 | 12 |
| `faq` | `.faq__q-text` | 24px | 11.04 | 3.0 | +8.04 | 4 |

### The finding: the primary CTA has 0.16 of headroom

`.cta` "Get started" measures **4.66** against a 4.5 floor, in **both** `hero` and `invite` — i.e. the
primary call to action on every journey page, at the harder pole. It passes, and it is the least
comfortable pass on the page by a factor of three. Any change to the brand colour, the button fill, or
the surface behind it moves it under. Filed as a bead.

Note what this is NOT: `Codex-5wgwf` records "every org primary button, 2.26:1" for
`--color-text-on-brand` against the light brand in dark mode. That is a different measurement of a
different pair, and I have not reconciled the two — do not assume they are the same number seen twice.
This reading is the `.cta` label against its resolved backdrop on the journey page.

### Scope, stated so this is not read as more than it is

Dark pole, `of-blood-and-bones`, `pricing-smoke-test`, at the default viewport. Not yet swept: the light
pole, the other two orgs, and the 375/768 widths — and per A67(a) the widths matter for TYPE, because
`--text-*` carries a `vw` term, so a narrow reading needs a real viewport resize rather than a
constrained container. The `.jp-sec__eyebrow` figure recurring at 7.79 across six types is a good sign
that the shared atoms behave consistently, and also a reminder that a shared atom means a single
regression would move all six at once.

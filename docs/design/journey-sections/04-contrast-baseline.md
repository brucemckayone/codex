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

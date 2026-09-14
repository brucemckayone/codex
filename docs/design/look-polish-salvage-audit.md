# Salvage audit — `feat/ui-standards-and-look-polish` vs merged `dev`

**Date:** 2026-09-14 · **Baseline:** `origin/dev` @ `76e521f0` (contains #498 and #499)
**Branch audited:** `feat/ui-standards-and-look-polish` (32 commits, never pushed, merge-base `0fc2f921`)

## Why this exists

Both branches were cut from the same `dev` tip on 2026-09-07 and ran the *same*
programme in parallel. `feat/ui-awwwards-design-pass` was pushed and merged as
#498; this branch was never pushed and is now invisible to every tool the
workflow uses (no worktree, no PR, no remote).

The question per fix is **not** "do the files differ" — 45 files all differ,
`dev` is newer — but **"does `dev` contain the fix"**. A sample of two gave
opposite answers, so each was checked individually.

## Method, and where it failed

A mechanical pass (does the custom property the fix introduced exist on `dev`?)
**produced a false clear**. `1d7109a2`'s token exists on `dev`, yet the defect is
live: presence of `--jp-accent-on-fill` says nothing about *which accent values*
declare it. Every verdict below is therefore based on the **defect's own
invariant**, checked by mapping each declaration to its enclosing selector.

## Verdicts

`dev` touches 18 of the branch's 45 files. 22 commits touch those 18; four are
the bulk "implementation round" passes #498 redid wholesale. Of the 13 named
fixes:

### Live on `dev` — salvage

| Commit | Defect, verified on `dev` |
|---|---|
| `8c025f47` | `--text-5xl` maxes at 2.75rem, **below** `--text-4xl`'s 3rem, in `typography.css` AND `org-brand.css`. Open bead `Codex-h3qpm`. |
| `b4e8d2ed` | `--jp-accent-glow` resolves to `0 24px 56px -40px`. A −40px spread shrinks the shadow rect 40px per side, so a 150×44 CTA becomes 70×−36 and paints **nothing**. Candlelit's signature bloom reaches 2 of its 6 consumers; the 4 it misses are the CTA button, accent mark and duration pill. No control-scale variant exists tree-wide. |
| `4d59fbd1` | `.jp-sec__heading--sub` (`journey-sections-shared.css:122`) sets **only** `font-size`, so it inherits `--jp-display-leading` — `--leading-none` (1.0) at `type: monumental`. A wrapped sub-heading collides at 390px. |
| `53dfc352` | `.reel__head` is `justify-content: space-between` with only a gap and **zero** `max-width` constraints, leaving heading and deck ~684px apart at `width: wide`. |
| `1d7109a2` | `[data-jp-accent='text']` (:720) and `[data-jp-accent='edge']` (:767) set `--jp-accent-fill: transparent` and declare **no** `--jp-accent-on-fill`, inheriting `:where(.jp-sec)`'s `--jp-on-ember` — ink auto-contrasted against a fill they never paint. `fill`, `glow` and `none` all declare theirs. Strands white ink on the section ground. |
| `b3c90fde` | Same family as above — the hollow accents' on-fill pointing at the wrong text role. |
| `588408f4` | `[data-jp-surface='bare']` sets `--jp-sec-pad-inline: 0px` (:363), deferring its gutter to a page gutter that does not exist. |
| `ea60de22` | The same `bare` block declares no `--jp-sec-atmos`, so it inherits rather than stating 0. |
| `965e0539` | `--jp-sec-atmos` on `dev` is a **0/1 gate** (`:87` and `:516`, its own comment says so). The branch grades it (0.18 / 0.45 / 0.7); without that, seven looks render flat. |
| `35afd5cd` | `JourneyRenderer.svelte:275,289` gates the page-wide bloom on `--jp-atmos-veil` alone, which tracks ink darkness — so Quiet Studio (`accent: none`) gets an ember bloom it renounces. **Rides in with the additive set** (`dev` has not touched `JourneyRenderer`). |

### Partial on `dev`

| Commit | What is and isn't covered |
|---|---|
| `d39eb2fe` | `GuideSection` **is** fixed on `dev` — it collapses to `grid-template-columns: 1fr` with an explicit note (:785-797). `IntroVideoSection` is **not**: it declares only `1fr` and `1fr 1.1fr` with no media-conditional collapse, so with `media: none` the copy stays pinned in one column of two and ~48% is blank. |
| `2cef7842` | `dev` hardcodes the tint wash at `at 14% 0%` — left-biased, which covers the common `align: start` case. It is align-**blind**, so at `align: center` the wash sits at 14% while the copy is centred. The branch keys it to the axis (`--jp-wash-x`: 22% start / 50% center). Residual gap, not a missing fix. |

### Superseded — take `dev`'s version

| Commit | How `dev` solved it instead |
|---|---|
| `27c3898c` | `#498` fixed the FAQ question/answer size collapse via `--faq-answer-size` rather than a `max()` hierarchy floor. |
| `a9bf9a16` | `dev` made the invite ring **axis-conditional** through `--invite-bar-ring` / `--invite-best-outline` (set to `none` at six sites) instead of flooring an additive outline. |
| `0aa76a5c` | `#498`'s `b0221b95` ("let the `accent` axis reach the pay button") covers the same ground. |

## Consequence for the plan

"Take `#498`'s versions of the contested files" is **wrong**: 10 live fixes plus
2 partials sit in them. They cannot be merged — `#498` rewrote those files — so
each must be **ported onto `dev`'s versions** as a small, individually
falsifiable change.

The 27 additive files are unaffected by this and can land as-is: the upload-time
duration feature, the three page-builder bugs `#498` never touched, the 73 i18n
strings (re-derived, not the reordered blob), `look-reach.test.ts`, and the
design docs.

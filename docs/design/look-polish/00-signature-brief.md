# Look polish — the signature-mechanism brief

Status: BINDING for this programme. Where this disagrees with taste, this wins;
where it disagrees with `docs/design/journey-sections/02-axis-contract.md`, the
axis contract wins (it is the older, wider contract).

Branch `feat/ui-standards-and-look-polish`, based `origin/dev@0fc2f921`.

---

## 1. The measured finding this programme exists to fix

The page-builder offers eight page-level LOOKS (`design-vocabulary.ts`
`SECTION_DESIGN_PRESETS`). Each is a bundle of nine axis values. The owner's
verdict, 2026-09-07: **only `candlelit` reads as designed.**

That is not a taste accident. Measured on `origin/dev@0fc2f921`:

| look | `--jp-sec-atmos` | `--jp-accent-glow` | `--jp-media-scrim` |
|---|---|---|---|
| **candlelit** | **1** | real shadow | real gradient |
| quiet-studio | 0 | `none` | `none` |
| long-read | 0 | `none` | `none` |
| open-air | 0 | `none` | `none` |
| plain-facts | 0 | `none` | *(unset — `media:none`)* |
| syllabus | 0 | `none` | `none` |
| full-send | 0 | `none` | `none` |
| signal | 0 | `none` | `none` |

Consumption of those three tokens, counted in the section `<style>` blocks:

- `--jp-sec-atmos` — read by **10 of 11** sections (all but Faq)
- `--jp-accent-glow` — read by **6** (Feel, Guide, Hero, IntroVideo, Reel, Turn)
- `--jp-media-scrim` — read by **4** (Guide, Hero, IntroVideo, Reel)

So an atmosphere codepath is wired through almost the whole renderer and
**fires for exactly one look**. The other seven render the same geometry with
the depth switched off.

It is NOT an under-specification problem. Non-flat declaration counts per look:
candlelit 23/29, quiet-studio 23/30, long-read 21/29, open-air 23/28,
plain-facts 23/27, syllabus 23/30, full-send 26/30, signal 26/31. Every look is
equally specified. Seven are specified *off*.

**Corollary — the axis system is a token-remapping layer, not a styling layer.**
All 42 `[data-jp-*]` blocks live in `journey-design.css`; each sets 1–6 custom
properties. Section components consume them (95–241 `var()` calls each). There
is no per-look CSS anywhere and there must not be.

## 2. Why there is no such thing as a per-look edit

The eight looks are permutations of 36 shared axis values in ONE file. Sharing,
enumerated:

- `surface:panel` → plain-facts, syllabus, signal
- `surface:bare` → quiet-studio, long-read
- `accent:fill` → plain-facts, full-send, signal
- `accent:text` → long-read, open-air
- `media:frame` → long-read, syllabus, signal
- `media:mask` → open-air, full-send
- `type:monumental` → candlelit, quiet-studio, plain-facts
- `type:expressive` → open-air, full-send
- `type:balanced` → long-read, signal
- `density:regular` → long-read, full-send, signal
- `density:compact` → plain-facts, syllabus
- `density:airy` → candlelit, open-air
- `width:wide` → plain-facts, syllabus, full-send, signal
- `width:text` → candlelit, long-read, open-air
- `edge:hairline` → quiet-studio, long-read, syllabus, signal
- `align:center` → candlelit, quiet-studio, open-air, full-send
- `align:start` → long-read, plain-facts, syllabus, signal
- `motion:none` → plain-facts, syllabus
- `motion:drift` → candlelit, open-air
- `motion:rise` → long-read, signal

Consequences that bind the work:

1. **`journey-design.css` is owned by NOBODY but the orchestrator.** A stated
   `notEditable` list is a convention and conventions lose to shapes.
2. **Any axis-value change must be checked against every look that shares it** —
   and `candlelit` must come out byte-identical unless a change is deliberately
   for it. It is the reference; regressing it is the one unacceptable outcome.
3. **The parallel territory is the 11 section components**, which are disjoint
   files with their own `<style>` blocks.

## 3. Each look gets ONE signature mechanism

The vocabulary today has one atmospheric value per axis and three or four flat
ones. The fix is not "turn candlelit's glow on everywhere" — that would make
eight identical cinematic looks. Each look earns a *different* mechanism, so
the axis values stay honest and the looks stay distinguishable.

| look | intended audience (from its own description) | signature mechanism | primary axis values it must ride |
|---|---|---|---|
| **candlelit** | narrative, depth work, film-led | **the bloom** — REFERENCE, unchanged | `surface:media` `accent:glow` `media:bleed` |
| **quiet-studio** | photography, architecture, craft | **the mat** — gallery mount: generous optical margin, hairline registration rule set off the content edge, wide-tracked small-caps kicker, caption baseline | `surface:bare` `media:inset` `edge:hairline` |
| **long-read** | writers, essayists, researchers | **the column** — drop cap, baseline-grid leading, hanging accent rule at the measure edge | `surface:bare` `accent:text` `width:text` `align:start` |
| **open-air** | yoga, breathwork, somatics, coaching | **the wash** — soft radial atmosphere (not a flat tint), large-radius diffuse lift, organic mask already present | `surface:tint` `media:mask` `density:airy` |
| **plain-facts** | developer courses, trades, direct | **the hard offset** — zero radius, solid displaced shadow, monospace kicker, no diffusion anywhere | `surface:panel` `edge:offset` `motion:none` |
| **syllabus** | certifications, curriculum-heavy | **the ledger** — counter-driven numbering, tabular horizontal rules, edge stripe as a spine | `surface:panel` `accent:edge` `density:compact` |
| **full-send** | high-energy positioning | **the slab** — inverted ground carrying its own gradient/grain, heavy structural border, staggered arrival | `surface:invert` `edge:heavy` `motion:stagger` |
| **signal** | the sane default | **the bar** — restrained panel, one unambiguous accent bar, nothing else | `surface:panel` `accent:fill` `motion:rise` |

Rule: a signature mechanism is expressed as **new or re-valued custom properties
in the axis blocks**, consumed by sections. No section may test for a look name,
and no look name may appear in any selector. If a mechanism cannot be expressed
through the axis vocabulary, the vocabulary gains a token — it does not gain a
special case.

## 4. Phases, and who writes what

| phase | scope | writer | why | status |
|---|---|---|---|---|
| **A** | `journey-design.css` axis token table + any new tokens | orchestrator ONLY | contested by all 8 looks | **DONE** `965e0539` |
| **B** | the 11 `render/sections/*Section.svelte` consumers | one agent per file, batched | disjoint, enforceable territory | running |
| **C** | `design-vocabulary.ts` → paraglide + `messages/en.json` | orchestrator ONLY | shared generated source; two writers strip keys | **DONE** `3c3f425c` |
| **D** | video duration auto-apply | orchestrator ONLY | crosses store + fields + media picker | **DONE** `2be58716` |

### Phase A, as shipped

`--jp-sec-atmos` went from a 0/1 gate to a graded scalar — bare 0, panel 0.18,
tint 0.45, invert 0.7, media 1 (unchanged). `tint` and `invert` gained gradient
grounds lifting toward the OPPOSITE POLE, not the brand ember (an ember mix goes
muddy on a saturated brand; a pole lift is a pure luminance move that holds for
every hue in both themes). `edge: soft` lg→xl, `edge: heavy` gained the mass it
never had, `edge: offset` doubled its register shift.

**It caught a real AA regression on the way.** The 100-combination contrast sweep
measures every ratio against the flat `--jp-ink`, so it structurally cannot see a
gradient. The first cut shipped a 12% slab lift at `--jp-faint` **4.4989:1** and
the sweep passed it. A gradient-extreme suite now measures the LIFTED stop on
both org poles, with a calibration test proving the lift genuinely costs contrast
so the suite cannot go vacuous. Lifts settled at 8% (invert) and 6% (tint).
`--jp-faint` over `invert` is only **4.8451:1 flat** on a light org — 0.345 of
headroom for the whole gradient to spend, and the worst org DIFFERS per surface,
so both fixtures are mandatory: testing one would have cleared 12%.

### Phase C, and what it could NOT cover

73 keys, `studio_builder_look_preset_*` / `studio_builder_axis_*`. The tables hold
`() => string` thunks, not strings, so the locale is read at use time AND every
call site becomes a compile error until updated — getters would have needed no
consumer change, which is exactly why they were rejected.

**The i18n surface is 392 strings, not 73, and 339 of them are BLOCKED** — this is
a finding, not an omission:

| file | strings | status |
|---|---|---|
| `design-vocabulary.ts` | 73 | **done** — editor-only, public page never imports it |
| `section-fields.ts` | 139 | **blocked** — imported by SEVEN section components plus `render/coerce.ts` and `render/index.ts` |
| `section-catalog.ts` | 200 | **blocked** — A20 states it outright: "importing paraglide here would pull message code into the public chunk" |

Both blocked files are in the PUBLIC renderer's import graph, so keying them ships
message code into the public sales-page chunk. Unblocking them means moving editor
chrome out of the public bundle first — its own refactor. And their `defaultProps`
(`'A headline that names the promise'`) are a separate matter again: that is SEED
CONTENT written into the creator's saved page, not chrome, so keying it is a
product decision about which locale a new page is authored in.

Brand tokens needed no work: all 11 section components already carry **zero** raw
colour literals across ~1,640 `var()` calls. That was verified by a calibrated
probe, not assumed — a uniform zero is the signature of a broken instrument, so
the regex was self-tested on known-positive input first.

Phase B agents are forbidden from: editing `journey-design.css`, editing
`messages/en.json`, any git command, any install, any repo-wide gate, and root
`pnpm test`. A fix needing a file outside their one section is reported under
`handoffs`, never applied.

## 5. The gates

Nothing in this programme is done until:

1. `candlelit`'s resolved token set is **unchanged** — asserted, not eyeballed.
2. No look name appears in any selector or any section component.
3. Every new token is **read by at least one section** (a written-but-unread
   token is invisible and must not ship).
4. Every axis value still resolves for all 11 section types.
5. `pnpm typecheck` and the page-builder test suites green.
6. i18n: zero hardcoded display strings left in `design-vocabulary.ts`.

## 6. Standing traps in this territory

- **`--jp-media-scrim` is `none` for `media:none`** — an edge-token `none`
  poisons any shorthand that interpolates it.
- **A `-dark` slot falls back to the LIGHT value** if the dark override is
  missing; check both themes for every new token.
- **`durationSeconds` is the SOURCE asset length, not the preview clip's** —
  `FeelSection` documents a 30-minute figure on a 30-second clip. Phase D must
  not auto-fill from it naively.
- Axis values are validated `z.enum(...).catch(undefined)` and `resolveAxis`
  drops an illegal value **silently**. A typo degrades invisibly.

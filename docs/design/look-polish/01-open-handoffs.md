# Open handoffs from the Phase B section pass

Every item here was **found, verified and deliberately not applied** by the
agent that owns the section it came from — because applying it needed a file
that agent does not own, or because it would change Candlelit and that call
belongs to a human. They are not speculation; each came with a file:line.

35 handoffs from 11 agents. **4 are already applied** in `2b33dbd1`
(the `surface: tint` radius, three-way corroborated, plus the three token
seams `--jp-motion-loop`, `--jp-display-measure`, `--jp-accent-rule-end`).

The rest are recorded here rather than filed as beads because this workspace
cannot sync beads (local schema fork, 2026-08-24), so a bead would be
invisible to anyone else.

## Triage order

Sorted by how many independent agents asked for it — corroboration across
agents that could not see each other's work is the strongest signal available.


## RESOLUTION LOG — measured outcomes, added after the Phase B sweep

Each entry is the number that decided it, not an opinion. `APPLIED` means the
change is committed and verified in a browser; `DECLINED` means measured and
deliberately not done, with the measurement that argues against it.

### APPLIED

| handoff | measurement |
|---|---|
| `--jp-motion-loop`, `tint` radius, `--jp-display-measure` | 2b33dbd1 |
| the `media` axis could never paint | hero/introVideo/reel pinned `bleed` — the same value Candlelit's look supplies — on the ONLY four types that consume `--jp-media-*`. Freed three; `quiet-studio` now resolves `inset` (48px mount, 3/2) where it resolved `bleed` (0px, 21/9). Candlelit byte-identical. `guide` keeps its pin. |
| `surface: bare` inline padding | the comment deferred to a "page gutter" that does NOT exist — `0px/0px` on all seven ancestors up to `body`. At 390px, `leftGap` was 0/0/9 on three sections; now 20/20/21. Desktop A/B shift: 0.0px. |
| `--jp-accent-on-fill` on the hollow accents | `text`/`edge` paint `fill: transparent` but inherited `--jp-on-ember` (white). Five sections measured 1.14–1.34:1 against their ground; now 15.62–18.43:1. Guarded structurally + anti-vacuity checked. |
| the additive boundary floor | rendered the real branch (needs a price + the `sticky` variant, both reverted). `hairline` was 1px border + 1px ring = 2px IN TWO COLOURS; `heavy` 3px. Now exactly one boundary at all five values; `edge: none` unchanged at 1px. |
| the sub-heading rung | inherited `--jp-display-leading` (1.0, calibrated for an 80px display). At 390px a wrapped sub-heading was 37.6px text on 37.6px leading — descenders touching. Now 47.0px. |

### DECLINED, with the measurement

**`edge: hairline` -> `--jp-line-strong`.** Measured every rung against every
surface at both org poles: `line` 1.25–1.79, `line-strong` 1.79–2.68,
`line-hover` 2.82–4.15. `strong` fails the 3:1 graphic floor on ALL eight
surface/pole combinations, so it would change all eight looks — `turn`/`proof`/
`faq` carry hairline on every look via the type table, Candlelit included — for
NO compliance gain. Reaching 3:1 needs `line-hover`, which reads as a divider
rather than a hairline: a design decision, not a fix. And the file's own caveat
is not violated — it requires a hairline not be the ONLY signal, and The Long
Read pairs it with ~208px of `density: regular` space.

**Capping `media: inset` proportionally.** THE AXIS CANNOT EXPRESS THIS, which
is the substantive reason rather than a preference. A proportional cap needs a
container-relative unit, and `cqw` in the axis file resolves against whichever
container each consumer happens to establish — or, where none exists, against
the small viewport, which is not the box at all. So the cap is only meaningful
inside a consumer that knows its own container, which is exactly why
`IntroVideoSection` hand-rolls `--iv-mount: min(var(--jp-media-inset, 0px),
6cqw)`. It is already capped where it was worth capping.

The case the handoff worried about — the guide's portrait column — cannot occur
by default: `guide` PINS `media: frame`, where `--jp-media-inset` is `0px`, and
all four of GuideSection's consumptions resolve to zero (verified). Driven to
`inset` by hand the mount is 48px on a 410x273 plate, which is 35.1% of its
height and not the 48% the handoff estimated. Hero and Reel apply it to a
full-width 16:9 stage, where the handoff itself calls 48px modest.

**NOT verifiable on this fixture, and stated as such rather than claimed:** the
mount's effect on a real photograph. `bone-deep` carries no media on hero, reel
or guide, so `.guide__img` is absent and no 48px mount renders anywhere on the
page. Any future claim about the print crop needs a fixture with images.

### STILL OPEN — needs an owner decision, not more measurement

- `--jp-eyebrow-tracking` per `type` value. Quiet Studio's brief names a
  "wide-tracked small-caps kicker" and the hero cannot deliver it, but every
  type-keyed value that reaches `restrained`/`balanced` also reaches
  `monumental`, which Candlelit shares. Changes Candlelit's kicker.
- Promoting `--jp-body-size` from its clamp to four explicit steps. Moves live
  pages by ±2px at narrow viewports.
- `--jp-accent-mark-glow`, a mark-scale companion to `--jp-accent-glow`.
  `.invite__seed`'s halo now renders on all eight looks including Plain Facts,
  whose signature is "no diffusion anywhere"; every in-file spelling regresses
  Candlelit.
- Display tracking at the sub rung. `--jp-display-tracking` is calibrated for
  the display and is arguably too tight at 48px, but changing it alters the
  single-line rendering of every heading on every look.

---

### → `journey-design.css`  (16 requests)

**from `FeelSection.svelte`** **[APPLIED 2b33dbd1]**

Declare a unitless CONTINUOUS-MOTION gate: `--jp-motion-loop: 1` in the `:where(.jp-sec)` defaults block and `--jp-motion-loop: 0` in `[data-jp-motion='none']`. Nothing else needs to change — I have already written the consumer, `animation: feel-eq calc(var(--d, 1.1s) * var(--jp-motion-loop, 1))` at FeelSection.svelte:1242, with a `1` fallback so it is byte-identical on all eight looks until this lands.

> _why:_ `motion: none` currently stops REVEALS but not continuous decorative animation, because every motion value is published as a `<time>` and CSS `calc()` cannot divide a `<time>` by a `<time>` — so a section cannot derive the 0/1 factor a looping animation needs from what the axis already publishes. Plain Facts and The Syllabus both ride `motion: none` and both get 56 dancing equaliser bars in this section today. This is the brief's own "if a mechanism cannot be expressed through the axis vocabulary, the vocabulary gains a token" case. It is Candlelit-safe by construction (`drift` keeps the default `1`, so `calc(0.85s * 1)` is `0.85s`) and it is not Feel-specific: the hero's motes, the ember breathe and the descent spark are all infinite keyframe loops with the same hole. Please confirm the name — I have declared it under `tokensAdded` precisely because an invented custom-property name fails silently.

**from `FeelSection.svelte`** **[APPLIED 2b33dbd1]**

Give `[data-jp-surface='tint']` an `--jp-sec-radius` (`--radius-xl` is the value that matches the brief's wording), so the wash's diffuse lift has a large radius to hang on.

> _why:_ Open Air's signature is recorded in the brief as "soft radial atmosphere … large-radius diffuse lift", and `edge: soft` now delivers `--shadow-xl`. But radius belongs to `surface`, and `tint` does not set it — so it inherits `--radius-none` from the defaults. Every `tint` section is therefore a SQUARE box wearing the most diffuse shadow on the axis, which reads as a hard-edged cloud: the shadow says soft and the corners say hard. Zero Candlelit risk — `surface: media` also leaves radius at `--radius-none`, but it paints `--jp-sec-bg: transparent` with `--jp-edge-shadow: none`, so radius is invisible there. `invert` staying square is correct for a slab and `bare` is transparent, so `tint` is the only value that needs this.

**from `HeroSection.svelte`** **[APPLIED 2b33dbd1]**

Add `--jp-display-measure` to the `type` axis. `[data-jp-type='monumental']` MUST be exactly `16ch` or Candlelit's headline changes; suggested for the rest: expressive `18ch`, balanced `22ch`, restrained `26ch`, plus a `:where(.jp-sec)` default of `16ch`. HeroSection already reads it as `var(--jp-display-measure, 16ch)` in two places (`.hero__headline` and `oversized`'s 1.5x cap), so it is consumed the moment it lands and is a no-op until then.

> _why:_ `max-width: 16ch` is the monumental answer applied to all four type scales. `ch` tracks font size, so it caps the LINE at sixteen characters at any size: correct under an 80px display, and at `restrained` it turns a hero headline into a four-line stack of two-word rows. There is no unitless type-scale token to derive this from inside a section, so the axis has to name it — which is the brief's own rule (the vocabulary gains a token, not a special case). This is the one token I read that the file does not yet set.

**from `HeroSection.svelte`** **[APPLIED 2b33dbd1]**

Give `[data-jp-surface='tint']` a `--jp-sec-radius` (`var(--radius-card)` or `var(--radius-xl)`). Only Open Air rides `tint`, and Candlelit is `surface: media`, so nothing else moves.

> _why:_ `edge: soft` just went `--shadow-lg` -> `--shadow-xl`, and `tint` sets no radius, so Open Air's wash is now a hard-cornered 90-degree rectangle floating under the most diffuse shadow on the axis. THE WASH is the one signature where soft geometry is the mechanism, and a large diffuse lift under square corners reads as a mistake rather than as air. I cannot fix it in the section: radius belongs to `surface` per that file's own comment, and there is no axis signal a component can key a radius floor off (`--jp-edge-shadow` is a shadow value, not arithmetic).

**from `HeroSection.svelte`**

Consider `--jp-eyebrow-tracking` per `type` value — the shared `.jp-sec__eyebrow` atom already reads it with a `--tracking-wider` fallback, so it needs no consumer change. The classic pairing is inverse: `monumental` -> `--tracking-wider`+ (a wide-tracked kicker under a tight display), `restrained` -> `--tracking-wide`. NEEDS AN OWNER DECISION, because it changes Candlelit's kicker.

> _why:_ Quiet Studio's signature explicitly names a "wide-tracked small-caps kicker", and the hero cannot deliver it: setting the tracking in the section applies it to all eight looks, and any type-keyed value that reaches `restrained`/`balanced` also reaches `monumental`, which Candlelit shares with Quiet Studio and Plain Facts. Related and NOT expressible at all: Plain Facts's "monospace kicker" — its only unshared axis value is `edge: offset`, and a font-family on an edge axis is incoherent. That part of the brief needs either a tenth axis or dropping.

**from `MapSection.svelte`** **[APPLIED 2b33dbd1]**

Give `[data-jp-surface='tint']` an `--jp-sec-radius` — `var(--radius-xl)` is the largest existing step (`--radius-base * 2`). It touches no other look: `tint` is Open Air's alone, and Candlelit rides `surface: media`.

> _why:_ `tint` sets no `--jp-sec-radius`, so it inherits the `:where(.jp-sec)` default `--radius-none`. Paired with `edge: soft`'s new `--shadow-xl` and `0px` border width, Open Air now renders a large diffuse shadow against a HARD SQUARE corner with no border to resolve it — which is the exact failure the `soft` block's own comment warns about ("a tighter shadow against a washed ground reads as a seam"), just arriving from the corner instead of the blur. The brief's signature for that look is "the wash — soft radial atmosphere, LARGE-RADIUS diffuse lift"; the radius is the half that is missing. MapSection already consumes `--jp-sec-radius` on `.descent`, so the token lands with no consumer change (as do the other ten sections).

**from `MapSection.svelte`**

Measure `--jp-accent-edge` against `--jp-pole-b` on both org fixtures and both themes, and if it is under the 3:1 graphic floor, re-point `edge: heavy`'s `--jp-edge-color` at an ember rung that clears it (the palette already has `--jp-ember-text` at 6.04 dark / 14.62 light for exactly this reason) rather than at `--jp-ember`.

> _why:_ `[data-jp-edge='heavy']` sets `--jp-edge-color: var(--jp-accent-edge)`, which at `accent: fill` is `--jp-ember` — the token the palette header records at 2.04:1 in dark on the golden org. Full Send pairs `edge: heavy` with `surface: invert`, so that 2px STRUCTURAL border sits ember-on-pole-b, the same pairing that measures ~2:1, under the 3:1 UI/graphic floor from research §5.1. This pre-exists on `.descent`'s own border rather than being introduced by anything here, but `heavy` is now load-bearing for a look's signature (and, after this change, for the map's table head rule), so it is worth a number rather than an assumption. Related: the still-open `Codex-8jve9` (`--jp-ember` is theme-blind).

**from `GuideSection.svelte`**

Give `[data-jp-accent='text']` and `[data-jp-accent='edge']` an explicit `--jp-accent-on-fill: var(--jp-heading)` (or state in the block comment that the pair is unusable at those two values).

> _why:_ Both values set `--jp-accent-fill: transparent` but leave `--jp-accent-on-fill` inheriting the default `var(--jp-on-ember)` — an ink auto-contrasted against a fill those values never paint. A consumer that does not branch therefore strands ember-ink on the page or on a photograph (white on cream in light theme). Three sections now carry a hand-written hollow state to work around it (GuideSection `data-guide-play`, IntroVideoSection `data-iv-plate`, ProofSection `data-plated`), which is the tell that the default is wrong rather than that the consumers were careless. A neutral on-fill would make the un-branched case merely plain instead of invisible.

**from `GuideSection.svelte`**

Consider capping `media: inset`'s `--jp-media-inset` proportionally, e.g. `min(var(--space-12), 9%)`, or splitting a narrower value for column-scale media.

> _why:_ 48px of board is modest on a full-width 16:9 stage (Hero, Reel, IntroVideo) and disproportionate in the guide's portrait column: measured at `width: narrow` + `density: vast` (quiet-studio) the plate is ~299×199 CSS px, so a 48px board leaves a 203×103 print — the mount eats ~48% of the box height and crops a portrait to a 2:1 band. Shared by four media consumers and it is an axis-value taste call, so not touched from a section. GuideSection's mount now at least weights it optically rather than shrinking it further.

**from `InviteSection.svelte`**

`surface: bare` sets `--jp-sec-pad-inline: 0px`, and `edge: hairline` then draws a full-box border on a box with no inline padding — so on quiet-studio and long-read the section's registration rule renders as a rectangle hugging the text, which is the exact inverse of THE MAT's "hairline registration rule set off the content edge". Two options. (a) Give `bare` a non-zero `--jp-sec-pad-inline`; this is a one-line change but it shifts the content column of EVERY bare section on the page, so it needs sweeping across all 11 consumers before it lands. (b) Add a role alias — e.g. `--jp-sec-edge-inset`, `var(--space-5)` at `bare` and `0px` on the default and every other surface — so a section can write `padding-inline: calc(var(--jp-sec-pad-inline) + var(--jp-sec-edge-inset))` and the optical space appears only where the surface removed it. Candlelit is `surface: media`, where (b) resolves to `0px`, so it is a guaranteed no-op there. I deliberately did NOT write a speculative read of an unset token; say the word and I will add the consumption in this file.

> _why:_ It is not per-section: every section that draws `border: var(--jp-edge-width)` on its section box has the same collision, and it is contested by both `bare` looks plus the four `hairline` ones. `journey-design.css` is orchestrator-owned.

**from `InviteSection.svelte`** **[APPLIED 2b33dbd1]**

`surface: tint` leaves `--jp-sec-radius` at the `:where(.jp-sec)` default `--radius-none`, while `edge: soft` now supplies `--shadow-xl`. Open-air is the only look on either value, and the brief names its mechanism "the wash — soft radial atmosphere, LARGE-RADIUS diffuse lift". An xl diffuse shadow under a zero-radius box reads as a print misregistration, not as air — it is the one combination on the axis where the shadow and the corner actively contradict. Suggest `[data-jp-surface='tint'] { --jp-sec-radius: var(--radius-card); }` (or `--radius-xl` if the wash should read softer than a panel). Only `tint` consumes it, so only open-air changes; candlelit is `media`, whose `--jp-sec-radius` this does not touch.

> _why:_ Radius belongs to `surface` by the axis file's own division of labour (the `edge: offset` comment says so explicitly and refuses to set it), and both values are contested territory in the shared file.

**from `InviteSection.svelte`**

THE BOUNDARY FLOOR ON `.invite__single` (the price-less threshold card, the live branch on four of the seven published pages) AND `.invite__bar` IS ADDITIVE, NOT A FLOOR. Each spells `border: var(--jp-edge-width) solid …` plus an unconditional inset 1px `outline`, so wherever the axis DOES supply a border the two are adjacent: 2px at `hairline`, 3px at `heavy` and `offset`, and on the bar in two different colours (`--jp-accent-edge` border against an `--jp-accent-mark` outline), which reads as a sloppy double rule rather than as one boundary. Every spelling I can reach from inside my file either composes an `--jp-edge-*` token — forbidden by this file's own twice-measured rule, and `soft`'s `0px` would lose its only expression — or regresses candlelit, which renders the floor path (`edge: none`) and would take a 1px content shift if the outline became a border. The clean fix is a token: something like `--jp-edge-floor`, `var(--border-width)` at `none` and `soft` and `0px` at `hairline`/`heavy`/`offset`, so the consumer writes `outline: var(--jp-edge-floor) solid …` and the ring appears only when the axis drew nothing. At `edge: none` that resolves to exactly today's `--border-width`, so candlelit is unchanged. Two consumers in this file are ready for it.

> _why:_ It needs a new axis value in the contested file, and getting it wrong silently costs the primary CTA its only boundary on four published pages — which is how the current additive spelling got there.

**from `InviteSection.svelte`**

`.invite__seed` (the mark the descent hairline lands on) carries an unconditional soft halo — `box-shadow: 0 0 var(--space-5) var(--space-1) color-mix(… --jp-accent-mark 55% …)`. Now that the descent is no longer atmosphere-gated it renders on all eight looks, including plain-facts, whose signature is "no diffusion anywhere". The axis already has the right shape of token — `--jp-accent-glow` is a real shadow only at `accent: glow` and `none` on the other four values — but it cannot be used here: its value is a large downward-offset `--jp-blood` shadow, a completely different graphic, so substituting it or adding it to the list changes candlelit. What would work is a second, smaller companion (`--jp-accent-mark-glow`?) resolving to exactly candlelit's current `0 0 var(--space-5) var(--space-1) color-mix(in oklab, var(--jp-accent-mark) 55%, transparent)` at `accent: glow` and `none` elsewhere. Note the `@keyframes invite-pulse` in my file animates a SECOND, brighter form of the same shadow, so the token would need both stops or the keyframe would have to stay hand-rolled.

> _why:_ A mark-scale glow companion is axis vocabulary, and `--jp-accent-glow` is shared with six other sections; re-shaping it or adding a sibling is a decision for the token table, not for one consumer. Reported rather than applied because every in-file spelling regresses candlelit.

**from `ProofSection.svelte`**

`[data-jp-surface='bare']` zeroes `--jp-sec-pad-inline` to `0px`. Give it a floor instead — either keep `--space-5` there, or split the role into a paint gutter and a minimum gutter (`--jp-sec-gutter`) that `bare` cannot take below `--space-5`.

> _why:_ `surface` and `edge` are independent axes and there is NO page gutter behind them (`.journey-page` and `.jp-sec` both declare zero padding), so `bare` plus any bordered edge puts the copy flush against a hairline wherever `--jp-content-max` exceeds the viewport — every phone, on quiet-studio and long-read. I floored it LOCALLY (`--proof-pad-inline`), which is a per-section patch of a vocabulary defect: the same collision is available to all 11 sections, and 11 local floors is how the `clamp(2rem, 6cqw, 4.4rem)` literals got eight spellings. Fixing it in the axis file lets every section drop the local floor. Verified no-op at Candlelit either way (`edge: none` is `0px`).

**from `FaqSection.svelte`**

Measure and (if it holds) promote `--jp-body-size` from the preserved clamp to the four explicit declarations its own comment already names — `--text-base` / `--text-base` / `--text-lg` / `--text-xl`.

> _why:_ At `type: restrained` the rung is 17px against this section's answer text at a fixed `--text-base` (16px), so the question/answer hierarchy in the Syllabus rests on family + colour + a 1px step. The answer cannot shrink (it is the legibility floor) and the question cannot grow without moving Candlelit, so the fix is the rung. The axis file records why the promotion is unmeasured (±2px at narrow viewports on 7 published pages, A3/D8); this section is the largest consumer of that rung, which is the argument for measuring it now. NOT applied — not my file, and it moves live pages.

**from `AcheSection.svelte`** **[APPLIED 2b33dbd1]**

Give `[data-jp-surface='tint']` a `--jp-sec-radius` — `var(--radius-xl)` reads right against the new bloom ground. Add it inside the existing `tint` block, where radius already lives (`panel` sets `--radius-card` there), so there is no source-order fight of the kind the `edge: offset` comment warns about.

> _why:_ `tint` sets no radius, so it inherits the `--radius-none` default: Open Air is a HARD-CORNERED rectangle carrying `--shadow-xl` from `edge: soft`. The brief's own signature for that look is "the wash — soft radial atmosphere, large-radius diffuse lift", and the large radius is the half that is missing. `tint` is used by open-air ALONE, so nothing else shares the value, and candlelit is `surface: media` — untouched either way.


### → `ReelSection.svelte`  (2 requests)

**from `IntroVideoSection.svelte`**

Same inert-`--jp-media-inset` defect as finding 1, and it is the second implementation of this media box. `.reel__frame` (line 827) consumes the token as `padding` only, against five layers pinned `inset: 0` (lines 869, 882, 891, 973, 983) — so `media: inset` produces no visible mount there either. The fix is the one now in IntroVideoSection: one defaulted local (`min(var(--jp-media-inset, 0px), 6cqw)`, with the `0px` fallback for a host that mounts a section without the `.jp-sec` frame), the layer stack inset by it, and a registration hairline gated on a derived `media === 'inset'` attribute so it cannot land on the frame edge of the other four values.

> _why:_ That file is owned by another Phase B agent. Reel and IntroVideo are the two sections whose lower half IS a media box, so leaving one of them inert means `media: inset` — one of quiet-studio's three signature axis values — still does nothing on half the surface area it applies to.

**from `ReelSection.svelte`**

CANDLELIT-AFFECTING, so left for you — four edits, in descending order of value. (1) Line 1331: raise the duration pill's plate from `--color-background` 55% to 88%, matching the tag it sits opposite; the rule is now a single declaration and the reasoning is in the comment above it. This is contract A39 half-applied — the pill is the same `--color-heading` on the same unscrimmed poster the 2.69:1 measurement was taken against. (2) Line 953: `.reel__frame::before` from `z-index: 5` to `3`, so the sheen stops washing over the rec tag and the duration pill (above poster 1 and scrim 2, below chrome 4). (3) Line 852: `.reel__sub` from `font-size: var(--text-base)` to `max(var(--text-base), calc(var(--jp-heading-size) / 2.4))`, which changes only `type: monumental` (16px -> 20px) and holds the header's hierarchy at `restrained`. (4) Line 683: `class="jp-reveal" data-jp-step="3"` on `.reel__stage`, so the media arrives after the copy at `motion: stagger`/`drift`.

> _why:_ Each improves several of the seven weak looks, and each alters what Candlelit's nine values render — (1) and (2) on every published page, (3) at `type: monumental`, (4) at `motion: drift`. The brief makes regressing Candlelit the one unacceptable outcome and directs exactly this case to a handoff, so I measured them and stopped. (1) and (2) are contrast/layering defects rather than taste, and (1) has a measured figure behind it.


### → `IntroVideoSection.svelte`  (2 requests)

**from `IntroVideoSection.svelte`**

NOT APPLIED because it changes candlelit — orchestrator's call. The media stage is excluded from the `motion` axis's reveal ladder entirely: `.iv__stage` and `.iv__media` carry no `.jp-reveal` class and no `data-jp-step`, so only the copy animates and the LARGEST element in the section never participates. `motion: stagger` is full-send's signature ("staggered arrival") and its frame simply paints. The change is `class="jp-reveal" data-jp-step="3"` on `.iv__stage` (line ~488). Two caveats worth deciding with it: candlelit's film frame would newly arrive on the drift timing rather than painting immediately, and the stage mounts from a STREAMED promise, so a resolve after the observer has added `is-in` paints it revealed with no transition — the reveal is armed per container, not per element.

> _why:_ Improves the four looks with a real reveal (full-send, signal, long-read, open-air) and alters the one look the owner says already works, which the brief routes here rather than into an edit.

**from `IntroVideoSection.svelte`**

NOT APPLIED, same reason, lower value. `.iv__play` and `.iv__pulse` are `max(var(--tap-target-min), var(--space-16))` — a fixed 64px that does not track `--jp-rhythm`, so the control is the same size in a `vast` frame as in a `compact` one. `max(var(--tap-target-min), calc(var(--space-16) * var(--jp-rhythm)))` keeps WCAG 2.5.5's 44px floor intact (rhythm only ever multiplies upward from 48px) and would give quiet-studio's `vast` frame a proportionate control, but `airy` is candlelit, so it would take that button from 64px to 80px.

> _why:_ Candlelit-affecting, and unlike the reveal gap it is a refinement rather than a missing mechanism — worth a decision, not worth spending the reference look on unasked.


### → `journey-design.test.ts`  (2 requests)

**from `MapSection.svelte`**

If the orchestrator wants the simplification, retire `expect(mapDecl('.descent__card', 'flex-basis', ONE_UP_AT)).toBe('100%')` (and the `24 * REM < 390` line beside it, which only exists to explain why that rule was insufficient) so the dead `@container (max-width: 24rem) .descent__card { flex-basis: 100% }` can be deleted. `.descent__cell-gloss { display: none }` in the same block is NOT dead — it is the table composition's narrow-width behaviour — so the at-rule itself stays.

> _why:_ That declaration is now unreachable as a behaviour change: the `min-width: min(100%, 11rem)` floor already forces one-up wherever two chips cannot fit, and at a 24rem container the practice row measures about 274px against a 2 × 176px + gap requirement — so `flex-basis: 100%` decides nothing the floor has not already decided. The file's own comment predicted this ("the mitigation EXISTS — it just starts one breakpoint too late... so state the constraint instead"). I left it in place because that suite pins the string, and the test file is not mine to edit.

**from `ProofSection.svelte`**

Lines ~1704-1706: the comment still calls `--jp-sec-atmos` "a 0/1 opacity gate consumed as `opacity: var(--jp-sec-atmos)`". Reword to say it is a graded scalar whose bare `0` must stay unitless because it is a `<number>` (the operative reason the assertion excludes it), and that consumers may now grade it.

> _why:_ Test-file prose, which I may not edit. The old wording is the exact documentation that turned the scalar into a gate in the first place — the brief's own diagnosis — and it now sits in the file whose job is to stop that class of drift. The assertion itself is still correct and my changes do not touch its danger set (`--jp-edge-width` is `0px` not a bare `0`, `--jp-reveal-distance` is `0px`, and `--jp-sec-atmos` is not in AXIS_SPEC's named rules).


### → `typography.css`  (2 requests)

**from `InviteSection.svelte`**

`--text-5xl` is `clamp(1.75rem, 1rem + 2.5vw, 2.75rem)` while `--text-4xl` is `clamp(2.25rem, 1.8rem + 2.25vw, 3rem)` — smaller at BOTH bounds. So `type: expressive` renders a smaller `--jp-display` than `type: balanced` at every viewport width, which is a non-monotonic type ladder. This file's own heading note already reported it; the consequence I can now quantify is that it is the reason the price cap above cannot restore hierarchy for open-air and full-send: at 375px the `<h2>` is 28.0px against a 27.1px price, and capping the price against `--jp-display` instead would shrink Candlelit at 768px (38.4 -> 33.7px). The fix has to be in the ladder — `--text-5xl` needs a floor and a cap between `--text-4xl` and `--text-display`.

> _why:_ A global token consumed far outside the page builder; changing it is an appearance change on every surface in the app and cannot be scoped to a section component.

**from `AcheSection.svelte`**

Add a `--tracking-widest` rung (~0.12em) above `--tracking-wider` (0.05em). Do NOT then set `--jp-eyebrow-tracking` in AcheSection without the owner's sign-off — see why below.

> _why:_ There is no tracking token above 0.05em, and three sections shipped ceremonial kickers at .18em (Ache), .28em (Feel) and .32em (Faq); all three narrowed to `--tracking-wider` on adoption because, as this component's own comment records, "`0.08em` has no token". Quiet Studio's signature explicitly names a "wide-tracked small-caps kicker", and the shared atom already exposes the `--jp-eyebrow-tracking` seam for exactly this — the seam has nothing wide to point at. WARNING, and the reason I did not apply the consuming half: widening Ache's eyebrow tracking changes CANDLELIT's eyebrow too (it would restore the ceremony candlelit had before adoption). That is a restoration the owner should choose, not a polish agent.


### → `GuideSection.svelte`  (1 request)

**from `IntroVideoSection.svelte`**

The comment at lines 744-752 states that `--jp-media-inset` is "a UNITLESS `0` at `bleed`, `frame` and `mask` (3 of 5 values, including Candlelit)". A64 gave the axis's zeros units — `journey-design.css` and `journey-design.test.ts`'s AXIS_SPEC both pin `0px` — so the comment now teaches a wrong fact about the current token, and its conclusion (that math on the token is unsafe) is the opposite of true.

> _why:_ Not my file, and it is a comment rather than a defect — but this is the file whose `inset: var(--jp-media-inset)` I cite as precedent, and a reference implementation propagates its comments as well as its code: the next person to need `calc()` on that token will read this and avoid the correct fix.


### → `FeelSection.svelte`  (1 request)

**from `FeelSection.svelte`**

Three fixes in my own file that I found, verified and deliberately did NOT apply, because each changes what Candlelit paints. Ordered by value: (1) FeelSection.svelte:1350 — the timeline spine's `top`/`bottom: var(--space-4)` should be `calc(var(--space-4) * var(--jp-rhythm))` to match the row padding it aligns with, or that plus half the node diameter for true node-centre-to-node-centre alignment. (2) FeelSection.svelte:1279 — the playhead halo's `color-mix(… var(--color-background) 70% …)` should read `--color-surface-elevated`, the card it actually sits on; or delete the dot and halo entirely as a simplification. (3) FeelSection.svelte:1070 and :1142 — `outline-offset: 2px` should be `var(--space-0-5)`.

> _why:_ The brief's instruction is explicit: a fix that improves seven looks and changes Candlelit is reported, not applied. (1) is the clearest defect of the three and is live on a shipped look — Quiet Studio is `density: vast`, where the spine overshoots the first node by ~9.6px as a visible stub; Candlelit is `airy` and carries a 4px stub, and no formulation is an identity at rhythm 1.25 without a magic divisor. (2) is wrong on all eight looks, Candlelit included, but `--jp-ink` and `--jp-ink-3` are different colours so the correction is visible there during playback. (3) is almost certainly a no-op — `--space-0-5` is documented as "2px * density" and computes to exactly 2px at unit density — but it carries `--brand-density-scale`, so it could move the ring on a custom-density org; confirming the seeded orgs' density is enough to unblock it.


### → `HeroLoopVideo.svelte`  (1 request)

**from `HeroSection.svelte`**

`.hero-loop__plate` reads `var(--jp-media-plate, var(--color-surface-secondary))`. Nothing in `journey-design.css` (or anywhere else I could find) sets `--jp-media-plate` — either add it to the `media` axis or drop the indirection and name the fallback directly.

> _why:_ A dead custom-property read is silent: it always resolves to the fallback, so the seam looks wired and is not. It is harmless today because the fallback is correct, but it is exactly the shape that gets counted as a consumer during an audit. Reporting rather than touching it — not my file.


### → `MapSection.svelte`  (1 request)

**from `MapSection.svelte`**

In `.descent__card:hover, .descent__row:hover, .descent__stagecard:hover, .descent__panel:hover` (line 1303), change `background: var(--color-surface)` to `var(--color-surface-tertiary)`; or delete the hover block entirely, since `.descent__card` is a non-interactive `<article>` and the hover promises an affordance that does not exist. Either way it is a one-line edit in the file I own — NOT applied because it changes Candlelit.

> _why:_ The card hover RECEDES, in both themes. In the journey palette the surface ladder is inverted relative to the usual semantic reading: `--color-surface` is `--jp-ink-2` (6% toward heading) while `--color-surface-secondary` is `--jp-ink-3` (12%) — journey-palette.css:519-521. The card rests on ink-3 and hovers to ink-2, so hover moves it ONE RUNG TOWARD THE PAGE GROUND: lighter on a light page, darker on a dark one, i.e. the direction flips with theme but the meaning does not — the card always retreats. `--color-surface` reads like the elevated rung, which is exactly why this is silent. `--color-surface-tertiary` (ink-4, 18%) moves it away from the ground in both themes. This improves all eight looks and changes Candlelit's hover state, so per the brief it is reported rather than applied.


### → `ReelSection.svelte.test.ts`  (1 request)

**from `ReelSection.svelte`**

Retire the test 'reuses the bars through a <use> reference rather than drawing them twice' (it asserts `.reel__wave--fill use` is present and `.reel__wave--fill rect` is empty). It pins the existence of a layer that is clipped to zero width and can never paint, which blocks deleting the invisible progress-fill SVG, the `<use>`/`<g id>` pair and the playhead. The sibling test that pins the 32 bars' byte-identical geometry should stay, retargeted from `.reel__wave--base rect` to whatever the single remaining SVG is. I cannot edit a test file, so the deletion is unapplied until this lands.

> _why:_ Test file, not mine — and a red test blocks the batch. The simplification the owner asked for is otherwise unreachable in this component: it is the largest ornate no-earn in the file (a full second SVG render plus the module-scope id sequence that exists to keep the symbol unique) and it paints nothing in any of the eight looks.


### → `journey-design.test.ts)`  (1 request)

**from `TurnSection.svelte`** **[APPLIED 2b33dbd1]**

Add `--jp-accent-rule-end` to the `accent` axis: `transparent` at `[data-jp-accent='glow']`, `var(--jp-accent-mark)` at `text` / `fill` / `edge` / `none`, and a default in the `:where(.jp-sec)` block (`transparent` keeps the canvas tree, which emits no data-jp-*, on today's rendering). NOTE THE TEST COST, which must land in the same change or the suite goes red: `journey-design.test.ts`'s AXIS_SPEC asserts the EXACT property set per axis rule, and a separate test requires every axis property to have a `:where(.jp-sec)` default — so that is 5 CSS declarations + 1 default + 6 AXIS_SPEC entries. `transparent` is not a keyword the guard treats as dangerous (it only flags `none`/`auto`), and my read is a plain gradient stop, not math.

> _why:_ `accent: glow` is the only DIFFUSE accent value and it is candlelit-exclusive, so this pins candlelit's fade byte-for-byte while giving the other seven looks a rule that reads as a rule. TurnSection already reads it with a `transparent` fallback (line 492), so the token has a consumer the day it is set and changes nothing until then. It matters most on `surface: bare`, where the atmosphere scalar is 0 by design and this 2px rule is the section's whole accent contribution — the mat's registration rule and the column's hanging rule are both this element.


### → `journey-design.test.ts (or wherever the gradient-extreme contrast suite lives)`  (1 request)

**from `TurnSection.svelte`**

Record — or measure — that a SECTION'S OWN ATMOSPHERE LAYER sits outside the contrast sweep. The new gradient-extreme suite measures `--jp-sec-bg`; it cannot see a `.turn__atmos`-style veil painted by a component on top of that ground. Phase B has just switched that veil on for panel / tint / invert across the ten sections that read the token, so the worst-case rung over a lifted ground now has a second, unmeasured term.

> _why:_ I verified it is safe in MY file by inspection — the only text over the veil reads --color-text / --color-text-secondary / --color-heading, i.e. --jp-dim at worst (7.79:1 dark), never --jp-faint, which has only 0.345 of headroom on `invert`. I cannot make that claim for the other nine consumers, and the sweep will not catch it if one of them paints --jp-faint over a bloom.


### → `*Section.svelte (the other ten) + a guard in journey-design.test.ts`  (1 request)

**from `ProofSection.svelte`**

Sweep for `color-mix(… var(--jp-accent-edge) N%, var(--jp-edge-color))` (and any state expressed as a mix of those two tokens) and re-point the accent half to `--jp-accent-mark`. Then add a derived guard: for every (accent, edge) pair in AXIS_SPEC, fail if a section's declaration mixes two tokens that resolve to the SAME value.

> _why:_ `--jp-accent-edge` collapses onto `--jp-edge-color` on three of the eight looks — `accent: none` and `accent: text` both resolve it to `--jp-line`, which is what `edge: hairline` sets the border to, and `edge: heavy` sets the border to `--jp-accent-edge` itself. `color-mix(X 34%, X)` is X: I confirmed it renders pixel-identical in Chromium. So any section using that shape has a state that provably cannot change, and nothing lints it because the CSS is valid. This is the same failure class as the `--jp-accent-fill: transparent` pilot lesson that produced `--jp-accent-mark` in the first place, so the axis file already carries the fix — it just was not swept, which is exactly what the A54 note warns happens to a diagnosis recorded in one component's prose.


### → `JourneyRenderer.svelte)`  (1 request)

**from `FaqSection.svelte`**

`[data-jp-surface='bare']` sets `--jp-sec-pad-inline: 0px` with the comment "the page gutter carries it". THERE IS NO PAGE GUTTER: `JourneyRenderer`'s style block sets only position/isolation/background/color/overflow on `.journey-page`, `.journey-palette--page` has no layout rule anywhere (grepped `journey-palette.css` — zero `padding`), and `.jp-sec` in `SectionFrame` sets only position/isolation/container-type. Fix one of: floor bare at `--space-5` (the clamp's own minimum, so nothing else moves), or give `.journey-palette--page` an inline gutter.

> _why:_ At `surface: bare` on any viewport narrower than the content cap, EVERY section's copy is flush to the screen edge — all 11 components, not just this one, in quiet-studio and long-read. My `max(--jp-sec-pad-inline, --jp-edge-width * 8)` floor only rescues the case where an edge is actually drawn (8px at hairline); it cannot help a borderless bare section, and 8px is not a phone gutter.


### → `FaqSection.svelte (mine — needs a Candlelit decision, not a file I lack)`  (1 request)

**from `FaqSection.svelte`**

If the orchestrator will accept a Candlelit change, add an atmos-scaled decorative layer behind the header (the ProofSection shape: an absolutely-positioned `aria-hidden` div, `opacity: var(--jp-sec-atmos)` over a radial `--jp-accent-mark` mix at ~9%), which would give panel/tint/invert 0.18/0.45/0.7 of a bloom.

> _why:_ `--jp-sec-atmos` is 1 at `surface: media`, which IS Candlelit, so ANY new atmos read here paints at full strength in the one look the owner says already works — there is no multiplier or floor that fixes that direction, because Candlelit sits at the scalar's maximum. Reported instead of applied, per the brief's rule. My judgement is that it should stay unbuilt: an FAQ is a ruled list, and what it owed the seven weak looks was rule weight and structure, which is what shipped.


### → `journey-sections-shared.css`  (1 request)

**from `AcheSection.svelte`**

Add one focus rule for the inline-edit seam: `.jp-sec [contenteditable]:focus-visible { outline: var(--border-width-thick) solid var(--color-focus); outline-offset: var(--space-0-5); }`.

> _why:_ `render/editable.ts` gives the seam `contenteditable`, `role="textbox"` and an accessible name but it is an ATTRIBUTE BAG and can carry no CSS, and no section styles `:focus-visible` for it — so keyboard editing in the studio canvas has no visible focus indicator on any of the eleven sections. It belongs in the shared layer, not in my file: eleven local copies is the precise anti-pattern that file exists to absorb (and the two sections that DO have focus rings spell the offset as a raw `2px`, which a shared rule would also retire). Research §5.1 is explicit that `edge: none` and `edge: soft` remove borders but must never remove a focus ring. Zero effect on the public page, which emits no edit attributes at all.


## Themes worth noticing

- **`surface: tint` needed a radius** — three agents, independently. Applied.
- **`--jp-media-inset` is inert at three of five media values**, including
  Candlelit, and two sections implement the same media box. IntroVideo and
  Reel both raised it; it is a genuine duplication, not a per-file nit.
- **Several want a Candlelit change** and correctly refused to make it. Those
  are the ones to read first: they are the polish the reference look itself
  is blocking.
- **`typography.css` has an inverted step**: `--text-5xl` is SMALLER than
  `--text-4xl` at both clamp bounds, so `type: expressive` renders smaller
  display type than `balanced`. Two agents found it. That is a token-scale
  bug outside this programme's territory and worth its own change.
- **`FaqSection` claims there is no page gutter**, so `surface: bare`'s
  `--jp-sec-pad-inline: 0px` may leave content flush to the viewport on the
  two looks that ride `bare` (Quiet Studio, The Long Read). UNVERIFIED by me
  — check before acting.

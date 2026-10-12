# Landing builder, phase 3c D0: what it costs to split a Style into facets

Status: **SPIKE, 2026-10-12.** It measures the refactor that 04 §3.2 calls "the honest cost". It
decides nothing. Bead Codex-61zsk.54 ("3c D0: facet spike — measure what splitting each Style into
swappable facets costs").
- Branch: `spike/Codex-3c-d0-facets`, based on `feat/Codex-61zsk.51-motion-type-dials` (475c0901),
  the branch with the dials.
- The throwaway prototype is commit 8b084841. It is **not for merging**.

Every number is labelled:
- **[M] measured** means counted by a parser, a test run or a browser probe on this branch;
- **[E] estimated** means reasoned from measured inputs. Each estimate says what it rests on.

File:line references are to the pre-spike files at 475c0901.

## 0. The answer, in short

1. **Most of a Style is Type** [M]. Of the 671 declarations in the eight Style sheets:
   - Type is 39% (34% type, 5% rhythm);
   - Marks 25%;
   - Surface 16%;
   - Motion 9%;
   - 11% fits none of the four.

   Marks are almost all two Styles: Path 91 and Studio 54 of the 168.
2. **The sheets split cheaply. The blocks don't.** Of the 230 rules in the sheets outside the root
   tokens, 183 [M] are one facet already, so moving them is a selector edit.
   - **The blocks.** 153 more Style rules [M] live inside 28 components, as 03 §4.3 left them. Of
     their 182 Style keys, 40% are layout and 45 mix facets. These blocks are where the work is.
3. **19 real couplings** [M, adjudicated]. These are rules whose meaning depends on another
   facet's presence or numbers (§2). They sit mostly in Path's route, Studio's pen and Poster's
   stickers, which are each Style's signature. One of the 19 is a group: the hero fit (51 rules),
   which is tuned to Surface and Marks details as well as to Type.
4. **The swap works** [M]. Bold's type with Soft's surfaces renders in a real cascade, the dials
   still win, and plain Bold and plain Soft resolve exactly as before. 2 of 1,300 kit tests fail,
   both pins on the old root selector.
5. **The proof matrix is not the problem; review is** [E].
   - **Contrast** costs nothing per combination. The kit proves colour per token value, not per
     Style.
   - **Fit** costs about 3–4 minutes of browser time per combination.
   - **Review** is the limit: an owner looking at 4,096 combinations is about 68 hours.
6. **Recommendation:** a **Type facet only** (option B′), with an allow-list of about 20 swaps,
   and the dials for the rest. Surface waits until its in-block rules move into the sheets. Marks
   and Motion stay with their Style. §6 gives the options and their costs.

## 1. Census: every rule by facet

**Method** [M]. Each `style-<id>.css` was parsed with `svelte/compiler`'s `parseCss`, flattened the
way `kit/styles/motion.test.ts` flattens it (nested rules joined, at-rules kept), and each
declaration was classified:
- **Type:** `font*`, `letter-spacing`, `line-height`, `text-transform`, `hyphens`, `text-shadow`,
  and `--lp-size-*`, `--lp-leading-*`, `--lp-tracking-*`, `--lp-weight-*`, `--lp-case-*`,
  `--lp-display-scale`, `--lp-measure*`, and the button's label size, weight and tracking.
  - **Rhythm** is counted inside Type, as 04 §3.2 files it: `padding*`, `margin*`, `gap`,
    `--lp-pad-*`, `--lp-container`, `--lp-gutter`, `--lp-gap`.
- **Surface:** `background*`, `border*`, `box-shadow`, `clip-path`, `--lp-radius-*`, `--lp-rule`,
  `--lp-shadow-*`, `--lp-edge*`, `--lp-shapes*`, `--lp-texture*`, `--lp-eyebrow-*`,
  `--lp-button-pad`, and a card's own padding.
  - Shapes and textures count as Surface, as 03 §5.2 files them, so "decoration" in Marks means
    what a Style draws on its content.
- **Motion:** `animation*`, `transition*`, `--lp-enter-*`, `--lp-build-*`, read-along, the
  marquee pace, every `@keyframes`, everything under `prefers-reduced-motion` or the still gate,
  and a hover that moves.
- **Marks:** `content`, `mask*`, `stroke`, counters, static `rotate`, Path's `--_path-*`, and the
  room a mark makes for itself. Pseudo-element rules take the facet of what they draw, so their
  `position` and `inset` go with them.
- **Doesn't fit:**
  - Layout: grid, alignment, sizes, `position`;
  - Colour: `color`, `--lp-tint-*`, `--lp-line`, `--lp-accent-source`;
  - Atmosphere: `--lp-atmosphere-*`.

There were 16 judgement calls the property table could not make (Quiet's hairline is Surface;
Studio's and Path's room for their marks is Marks; and so on). The scripts list them.

**Rules per facet, per Style** [M]. The root token block is shown separately, as declarations.

| Style | Type | Surface | Motion¹ | Marks | facet + layout² | 2+ facets | no facet | rules | root decls: T (rhythm) · S · M · K · other |
|---|---|---|---|---|---|---|---|---|---|
| Bold | 18 | 3 | 2 | 0 | 2 | 1 | 5 | 31 | 19 (3) · 7 · 5 · 0 · 0 |
| Clean | 5 | 1 | 5 | 0 | 2 | 1 | 9 | 23 | 20 (5) · 4 · 4 · 0 · 2 |
| Soft | 3 | 7 | 3 | 0 | 0 | 0 | 0 | 13 | 16 (2) · 12 · 3 · 0 · 3 |
| Cinematic | 14 | 2 | 1 | 2 | 1 | 1 | 1 | 22 | 10 (0) · 5 · 3 · 0 · 4 |
| Path | 3 | 3 | 4 | 33 | 1 | 1 | 2 | 47 | 13 (2) · 4 · 3 · 4 · 0 |
| Poster | 20 | 2 | 2 | 8 | 1 | 1 | 3 | 37 | 19 (3) · 8 · 5 · 0 · 1 |
| Studio | 4 | 2 | 2 | 24 | 1 | 2 | 8 | 43 | 13 (1) · 7 · 3 · 0 · 0 |
| Quiet | 5 | 2 | 3 | 0 | 2 | 1 | 1 | 14 | 22 (4) · 5 · 3 · 0 · 1 |
| **All** | **72** | **22** | **22** | **67** | **10** | **8** | **29** | **230** | **132 (20) · 52 · 29 · 4 · 11** |

¹ Motion includes the 4 `@keyframes` blocks. ² One facet plus layout or colour in the same rule.

**Declarations** [M]: 671 in the eight sheets.

| Type | Rhythm | Surface | Motion | Marks | Layout | Colour | Atmosphere |
|---|---|---|---|---|---|---|---|
| 227 | 37 | 108 | 57 | 168 | 50 | 14 | 10 |

**Rules inside the blocks** [M]. There are 153 distinct component rules keyed on a Style, in 28
files:
- Bold names 61, Soft 75, Cinematic 45 and Clean 1. A rule shared by two Styles is counted under
  each, so the keys total 182.
- 58 of the 182 keys are shared selectors, such as
  `.lp:is([data-lp-style='soft'], [data-lp-style='cinematic'])`.

By the same property table, the 182 keys are:

| Layout | Surface | Type | Motion | Marks | Colour | 2+ kinds |
|---|---|---|---|---|---|---|
| 73 | 40 | 21 | 1 | 1 | 1 | 45 |

The layout keys are mostly Soft's and Cinematic's centred heads. Type includes rhythm, as above.

**The data half** [M]. Each `style-definitions/<id>.ts` sets:
- a layout and a scheme for all 16 section types;
- 6 featured-card schemes;
- an `order` and a `starter`;
- fonts (7 of 8);
- `atmosphere` (3 of 8 here; Codex-61zsk.49 makes it 7);
- `sticky` (2 of 8).

None of these is a facet. Layouts and schemes are already the creator's, per section. `featured`
picks the scheme of a section's one filled card, so it is colour. `fonts` is a suggestion the
creator accepts into the page's brand, so a Type facet changes scale, leading, tracking and case,
never the families.

**What fits none of the four:**
- **Layout picks:** Bold's hung heads (`style-bold.css:265–306`), Clean's split hero and grid
  columns, Studio's problem list, Soft's centred heads (32 in-block rules), and Cinematic's.
  - Soft's own header files centring under TYPE. Here it is layout, which is also how 04 §3.4
    offers it ("alignment").
- **Scheme maps** and the featured-card map (data half).
- **Colour inside the sheets:** the tints (`--lp-tint-soft`, `--lp-tint-panel`), Poster's printed
  rules (`style-poster.css:209`), Path's accent source, and Cinematic's dark ground (in
  `schemes.css`).
- **The Moving background's ground**, `--lp-atmosphere-ground` (6 Styles).
- **The floating bar** (`sticky`, plus Quiet's shadow at `style-quiet.css:211`).
- **Script reads of the Style** (9) [M]:
  - `featuredScheme(page.style, …)` in 7 blocks is colour;
  - `PreviewBlock.svelte:41` places Cinematic's play button in the centre, which is layout;
  - `InstructorBlock.svelte:157` shows Soft's credentials as chips because Soft's layout is
    centred, which is also layout.

  All 9 stay on the Style, so none changes.

## 2. Coupling: where one facet leans on another

An automated pass flagged 85 candidates [M]. A rule was flagged when:
- it declares two facets;
- or its selector is keyed on another facet's element or state, a scheme or the Moving
  background;
- or a value reads another facet's token.

Each candidate was then read and sorted.

### 2.1 Hard couplings: the refactor's real cost (19)

Each one needs a decision (which facet owns it), a second key, or a re-measure. Without one, the
combination is silently wrong.

| # | Where | What couples |
|---|---|---|
| H1 | `style-bold.css:125` | `.hero__enter-h { font-size }`: a Type declaration that exists only so Bold's lift clip is measured in the headline's em (Motion). |
| H2 | `style-bold.css:113`, `:233` | Bold's lift keyframes and the build on every heading. The clip overhang was tuned at Bold's display leading of 0.9 ("at leading under 1 the glyphs stand past their line box"). Poster's leading is 0.88, tighter than anything proven. |
| H3 | the hero fit: 28 continuous rules (X34) and 23 steps (Bold, Poster, Cinematic; e.g. `style-bold.css:140–218`) | Fitted with each Style's own eyebrow, button padding and hero marks. Three things can move it: Soft's and Poster's chip adds `2 × --space-1` to the eyebrow; button padding is `--space-6/7/8` by Style; and Path's lane (`style-path.css:102`) narrows the column. X34's margin is 1–2.5% of the scale. |
| H4 | `style-path.css:102` with `style-bold.css:313` | A route stop sits on the heading's first line, read from `--lp-size-heading` on `.lp-section`. Bold's type re-sets it lower down, on 10 shared-row heads, so Path's marks on Bold's type miss those lines. |
| H5 | `style-path.css:484` | The split hero's stop hard-codes Path's own 0.7 display step. |
| H6 | `style-path.css:128` | The eyebrow offset assumes "this Style gives it no padding", which is a Surface fact. Soft's and Poster's chips pad it. |
| H7 | `style-studio.css:210`, `:232`, `:247` | The pen's underline (`inset-block-end: -0.3em` / `-0.36em`) was set against Studio's heading leading of 1.04–1.1. At Bold's 0.9 or Poster's 0.88 it meets the descenders. |
| H8 | `style-studio.css:304` with `style-bold.css:379` | Studio shrinks `.stat__value` to 0.74 of its cell so the figure and its circle fit: a Type rule owned by the Marks. Bold's type sets the same figure at display size. |
| H9 | `style-bold.css:333`, `:338` | The stage marker's block size (`--_marker`) and its number in the display face (`calc(var(--_marker) * 0.6)`): one device split across Type and Surface/Marks. |
| H10 | `style-cinematic.css:270` | The scroll story's numerals: a `::before` mark set in the display face, Marks and Type in one rule. |
| H11 | `style-studio.css:293`, `:297` | "The stage marker is the circle now, not a ring": the mark sets `border-color: transparent` on a marker that the Surface draws (`StageTimeline.svelte:128` Bold, `:139` Soft; `style-path.css:415`). |
| H12 | `style-studio.css:318` | `.stat::before { content: none }`: the mark deletes the separators the Surface draws between figures (`StatsBlock.svelte:190`, Bold's). |
| H13 | `style-studio.css:127–163` (8 rules) with `:90` | The tilt is "only prints"; the print (border, shadow, square corners) is Studio's Surface. Studio's marks on another Surface tilt bare photos. |
| H14 | `style-path.css:415`, `:468`, `:320` | Path's Surface reads Path's Marks tokens: the marker's `border-width: var(--_path-w)` and the featured offer's ring. Under another Marks facet `--_path-w` is undefined. The declaration is then invalid at computed-value time, so the ring goes and the border falls back to `medium` (CSS spec; not measured). |
| H15 | `style-poster.css:214`, `:227`, `:239` | The sticker: one device spread across Surface, Type, Colour and Marks. The chip is padding, no border, a pill and the button's fill; the label is bold and tracked, in the button's ink; the sticker is turned −2°. |
| H16 | `style-soft.css:222`, `:230`, `:207` | The drift animates `.lp-surface::after`, which has shapes only under Soft's Surface. **Measured:** on Bold with Soft's motion, `lp-soft-drift` runs on an empty layer (mask `none`, inset `auto`). |
| H17 | `style-path.css:293`, `:302`, `:389`, `:278` | The route draws with the scroll on Path's own pseudo-elements. With no Path marks it animates nothing; with Path marks and no Path motion, the route never draws. |
| H18 | `style-studio.css:405`, `:419` | The pen draws in on Studio's marks: the same as H17. |
| H19 | `Button.svelte:129` against `style-poster.css:261` and `style-quiet.css:200` | The button's hover belongs to whoever owns the button. Bold's hard offset shadow is in-block; Poster's knock and Quiet's lift are in sheets. With Bold's surfaces and Poster's motion, Poster's rule wins by its id lift and sets `box-shadow: none`. |

Without H3, these are about 45 rules in the sheets, plus the 4 in-block rules they collide with. H3
adds the 51 fit rules.

### 2.2 Soft couplings: work in any combination, measured in none (22)

These read another facet's live token, so they adapt. No combination outside their own Style has
been looked at.
- Bold's slab is placed by `--lp-pad`, `--lp-gutter` and `--lp-container` (`style-bold.css:250`).
- Soft's pebble clip reads the gutter (`style-soft.css:194`).
- Path: 7 stops and segments computed from Type tokens (`style-path.css:118`, `:135`, `:426`,
  `:431`, `:435`, `:449`, `:496`).
- Poster: 3 rules.
  - The block behind a photo reads `--lp-radius-media` (`:301`).
  - The marquee's room for its hanging mark is "a title's" (`:359`).
  - The hover knock fires on any button (`:261`).
- Studio: 8 circles and frames in the figure's em, with their room taken from the gap and gutter
  (`style-studio.css:264–360`).
- Quiet: 2 rules.
  - The hairline is inset by the gutter (`:144`).
  - The read-along fires on any statement paragraph (`:175`).

### 2.3 Rules keyed on a scheme or the Moving background (22)

These are Surface, Type, Motion or Marks rules that are conditional on the scheme map, the featured
map or a photo behind the words:
- Bold's slab only on `base`/`soft` bands;
- Soft's shapes and drift off on `atmosphere` and over media;
- Soft's pebble shadow on any nested scheme, which is the base Style's featured card;
- Cinematic's display scale over or off a photo (`style-cinematic.css:113`, `:158`, `:193`,
  `:198`), and its panel rhythm on `atmosphere` (`:97`);
- Path's route ink over a photo;
- Poster's block colour by scheme.

They stay correct as long as the schemes stay with the page's Style, which 04 §3.1 keeps. They
show that Surface and Colour share selectors: "Soft's surfaces" on Bold keep Bold's 0% tint
(measured, §4). The three lists overlap: Soft's drift is both H16 and keyed here.

The remaining candidates were one device read across two property groups (Quiet's link-styled
button, Clean's caption hairline, Path's map marker) or motion on content (Clean's zoom). They are
not couplings.

## 3. Selector shape and specificity

**Today** [M]. One `data-lp-style` value matches, so no two Style sheets ever compete.

| Rule | Selector | Specificity |
|---|---|---|
| a Style's root tokens | `.lp[data-lp-style='x']` | (0,2,0) |
| a Style rule inside a block | `:is(.lp, #lp-style)[data-lp-style='x'] …` | (1,1,0)+ |
| a Style motion rule | `:root[data-theme] .lp:not([data-lp-still], [data-lp-motion='still']):is(.lp, #lp-style)[data-lp-style='x'] …` | (1,5,0)+ |
| an in-block Style rule | `:global(.lp[data-lp-style='x']) .block` + Svelte's class | (0,4,0)+ |
| the corners dial | `.lp[data-lp-style][data-lp-corners='brand']` | (0,3,0): one attribute above a root |
| the type and motion dials | `.lp[data-lp-drama='…']`, `.lp[data-lp-motion='still']` | (0,2,0): they set tokens no Style sets |
| hero fit: continuous vs steps | X34 | (1,5,0) beats (1,4,0) |

The sheets carry 247 `data-lp-style='…'` keys [M]: Bold 31, Clean 23, Soft 13, Cinematic 23, Path 57,
Poster 38, Studio 46, Quiet 16.

**The plan.**
1. **One attribute per facet on the root:**
   - `data-lp-type-facet`
   - `data-lp-surface-facet`
   - `data-lp-motion-facet`
   - `data-lp-marks-facet`

   Each is the page's Style unless `design.facets` names another. `data-lp-style` stays for what
   fits no facet.

   The `-facet` suffix is not optional. Two of the plain names are taken:
   - `data-lp-type` is a section's type (83 uses in the sheets);
   - `data-lp-motion` is the motion dial, read as a bare `[data-lp-motion]` by Soft's drift gate.
2. **Swap one attribute for one attribute.** Every specificity in the table stays the same. The
   corners dial still wins by one attribute, the motion gates are unchanged, and the hero fit keeps
   its (1,5,0)/(1,4,0) order. **Measured:** in the probe (§4), plain Bold and plain Soft resolve
   exactly as before on all 21 probes. The corners dial's `brand` still beats Soft's surface
   corners: 12px against 24px.
3. **A second key goes inside `:where()`.** A coupled rule (§2.1) that must stay off unless two
   facets agree is keyed like this:
   `:is(.lp, #lp-style)[data-lp-marks-facet='path']:where([data-lp-type-facet='path'])`.
   That adds no specificity. A plain second attribute adds (0,1,0), and that breaks two things:
   - a double-keyed root rule ties the corners dial at (0,3,0) and beats it on load order;
   - inside one sheet it overturns rules that rely on a one-attribute difference, such as X34's
     continuous fit over its steps.
4. **One owner per token.** Root blocks from different Styles now match together at (0,2,0). A
   token declared by two facets would therefore be decided by import order (bold, clean, soft,
   cinematic, path, poster, studio, quiet). This needs a guard test. The prototype keeps it by
   construction for Bold and Soft, and the probe shows no token leaking.

**What the split adds to the cascade.** Today two Style sheets never compete. With facets, up to
four match at once.
- **Collisions** [M]: a rule from another facet, in another Style, setting the same property on
  the same element. Matched by each selector's last compound, so these are candidates:
  - `.timeline__marker border-color`: Path's Surface against Studio's Marks, and Studio's Marks
    against Bold's and Soft's in-block Surface (H11);
  - the button's hover `transform` and `box-shadow`: Bold's in-block Surface against Poster's and
    Quiet's Motion (H19);
  - plus one removal: Studio's `content: none` on `.stat::before` (H12).
- **A sheet rule always beats an in-block rule.** The `#lp-style` lift does that. So a Marks rule
  in Studio's sheet overrides a Surface rule in Bold's block whatever was intended. Before facets
  can be trusted, the in-block Surface rules have to move into the sheets. 03 §4.3 explicitly kept
  them in the blocks for this programme.

## 4. The swap: Bold's type with Soft's surfaces

**What was built** (commit 8b084841):
- **The model.** `PageFacets` and `readPageFacets` were added to `model/ids.ts`, `design.facets`
  to `PageDesign`, and the four root attributes to `PageRenderer`. The gallery takes
  `?facets=type:bold,surface:soft`.
- **The sheets.**
  - `style-bold.css`: the root split into Type, Surface and Motion blocks. 25 rules were re-keyed
    (19 Type, 4 Surface, 2 Motion). Bold's hung heads, its stats columns and its
    Moving-background ground stay on the Style.
  - `style-soft.css`: the root split into Style (tints, Moving-background ground), Type, Surface
    and Motion. 12 rules were re-keyed (2 Type, 8 Surface, 2 Motion).
- **The blocks.** 48 in-block rules in 16 components were re-keyed to the Surface facet: 38 by the
  property table and 10 by judgement (Soft's pebble gaps, the timeline markers, the problem's
  disc, and Bold's link-styled secondary and its hover). Bold's in-block Type and layout rules stay
  on the Style. That is correct here only because Bold is also the page's Style.
- **Size** [M]: 22 files, +170 −108. The in-block part was scripted from the census.

**What it showed** [M]. With the dev stack off, the cascade was checked with a probe, not
screenshots. Headless Chromium loaded the app's `global.css`, the kit's four sheets and all eight
Style sheets from disk into a page skeleton (four sections, a wall tile, a stat label), then read
the values below:

| Probe | Bold | Soft | Bold + Soft surface | …and corners: brand | Soft + Bold type | Bold + Soft motion |
|---|---|---|---|---|---|---|
| display size | 156.64px | 80px | **156.64px** | 156.64px | **156.64px** | 156.64px |
| container | 1312px | 1088px | **1312px** | 1312px | **1312px** | 1312px |
| card corner | 3px | 24px | **24px** | **12px** (dial wins) | 24px | 3px |
| button padding | 32px | 28px | **28px** | 28px | 28px | 32px |
| shapes · edge | none | blobs · curve | **blobs · curve** | blobs · curve | blobs · curve | none |
| eyebrow chip | 0 | 1 | **1** | 1 | 1 | 0 |
| soft-band tint | 0% | 16% | **0%** (colour stays Bold's) | 0% | 16% | 0% |
| slab over band 2 | gradient | none | **none** | none | none | gradient |
| shapes drift | none | `lp-soft-drift` | **none** (Bold's motion) | none | `lp-soft-drift` | **`lp-soft-drift` on an empty layer** (H16) |
| heading entrance | `lp-bold-lift` | none | `lp-bold-lift` | `lp-bold-lift` | none | none |
| wall tile padding | 0px | 40px | **40px** | 40px | 40px | 0px |
| stat label | 21px | 17px | **21px** | 21px | 21px | 21px |

Plain Bold and plain Soft read the same 21 values before and after the re-key [M]: 0 differences.
The in-block rules are Svelte-scoped, so the probe does not load them. Only the kit tests cover
them.

**What broke** [M]. `pnpm exec vitest run src/lib/page-builder/kit` ran 52 files and 1,300 tests in
85.7s. 1,298 passed and 2 failed, both in `dials.test.ts`:
- "rounder is Soft's corners" reads Soft's corners from `.lp[data-lp-style='soft']`;
- "wins over every Style's own" pins every Style's corners to that root selector.

The corners dial's contract ("one attribute above each Style's root") has to be re-stated against
the Surface facet's root. It still holds at (0,2,0), as the probe shows.

Everything else passed, which says as much about the tests as about the split:
- **The motion gates.** `motion.test.ts` still finds every gate.
- **The decorations.** `schemes.test.ts` still finds them: its reader already accepts
  `style-<id>-<part>.css`.
- **The type dial's pins** (`dials.test.ts`) read declarations whatever the selector.
- **No test asserts which facet a rule belongs to.**

**What leaks** [E], by reading:
- **The fold** (H3). Bold's hero fit was measured without Soft's eyebrow chip, which adds about
  8px per eyebrow. The fit's margin is 1–2.5% of the headline's scale, so a long headline with an
  eyebrow may pass the fold until it is re-measured.
- **The stage marker** (H9). Bold's type sets the marker 48–80px wide with a display-face number,
  so Soft's tinted disc grows to that size.
- **The pebble shadow.** It lands on Bold's filled cards, through Bold's featured map, as designed.
- **Bold's credentials.** The ledger rules (`Credentials.svelte:47`, `:65`) mix Surface and Type,
  stay Bold's, and sit beside Soft's pebbles.
- **Soft's centred heads.** They don't come along. Under §1's filing that is correct, because
  they are layout.
- **Not checked:** `pnpm typecheck` (it rewrites every `dist/`), the e2e specs, and any screenshot.

## 5. The matrix: what proving a combination costs

**Inputs:**
- **The kit's unit suite** [M]: 1,300 tests, 85.7s.
- **The colour proofs** are per token value, not per Style.
  - "4,096 brands × both poles × every scheme" runs in 5.65s [M].
  - The decoration sweep proves shapes and textures at any strength, stacked as well, at about 8s
    per strength (`schemes.test.ts`).
  - The tints are proven per Style tint.
- **The parent session's word-cut sweep for the louder dial** [M], 2026-10-12: 8 Styles × 5 widths
  (1,015 headings × 30 texts) in 9.0 minutes. That is 13.5s per Style and width.
- **The hero fit (X34)** [M, then]: 35 layout variants × 2 headline families × 101 lengths ×
  2 brands at 1440, plus 7,888 rows at 390. No timing was recorded.

**Per combination** [E]:
- **Contrast: nothing more.** A facet that names no colour adds no case.
  - `brand-conformance.test.ts` already holds every sheet to "no literal colour".
  - What it does not hold: a facet must not carry a colour-bearing token. Today those are the
    tints, Poster's `--lp-line` and Path's accent source, so they stay with the Style.
  - Two Styles' decorations never stack, because shapes and textures are both Surface.
- **Fit: about 3–4 minutes.**
  - The hero fold: 5 layouts × 2 families × 101 lengths × 2 brands, at 2 widths. About 1 minute,
    scaled from the louder sweep's in-page batch.
  - The section headings' word cuts: 5 widths × 13.5s at the Style's size and at louder
    (calmer only shrinks). About 2.25 minutes.
  - A combination that fails needs a refit. X34 found that by binary search, about 7 times the
    check.
- **Marks geometry: no tooling.** Nothing measures an underline against the next line, a circle
  against its cell or a stop against its heading. `style-studio.test.ts` checks paint and one
  portrait clearance. Building it is about one agent task, then about 1 minute per combination.
- **Owner review: about 1 minute** per combination (2 widths × 2 themes).

| Matrix | Combinations | Browser proof | Owner review |
|---|---|---|---|
| everything, 8⁴ | 4,096 | ≈ 240 h | ≈ 68 h |
| only what changes the fit: Type × 4 Surface groups (button pad 6/7/8, Soft's chip) × 4 Marks groups (none, Path's lane, Studio's underline, Poster's sticker) | ≈ 128 | ≈ 7.5 h | still per combination shown |
| **the proposed allow-list** (below) | **20** | **≈ 70 min** | **≈ 20 min** |

Every figure in this table is estimated [E].

Add the five dials at three steps each (243 states) and full freedom is about a million pages. The
dials were proven per step, by construction. Facets can't be, because H1–H19 are exactly the places
where one facet's numbers are another's assumptions.

**The proposed allow-list: 20 Type swaps** [E].
- **The voices: Bold, Poster, Soft and Quiet.** These are the four Types that read clearly
  differently: the largest and tightest, the uppercase crowding, the easy rounded leading, and the
  light serif-quiet. Clean's, Path's and Studio's sizes sit close to the kit's own. Cinematic's
  type is keyed on the Moving background and on photos (§2.3), so it can't travel.
- **The bases: Bold, Clean, Soft, Cinematic, Poster and Quiet.** Path and Studio are left out,
  because their marks read the Type's numbers (H4–H8).
- 4 voices × 6 bases, less each voice on its own base, gives **20**.
- Proving them takes about 70 minutes of browser time and about 20 minutes of owner review. CI
  can't afford that per push: E2E Web already needs 62 minutes. So it runs as a sweep whenever a
  Type or a base changes, as X34's fits and the louder sweep do. A unit test pins the menu to the
  proven list, and CI renders 3 samples.

## 6. Recommendation

| | **A. Full split** (4 facets × 8 Styles) | **B. Type and Marks** | **B′. Type only** | **C. Don't split: dials + section controls** |
|---|---|---|---|---|
| Sheet keys | 247 keys [M]; 18 rules to split [M]; 8 roots into ~32 blocks [E] | 85 Type and 74 Marks rules; 156 root declarations [M] | 85 rules; 152 root declarations [M] | 0 |
| In-block (by the property table) | 153 rules in 28 files: 55 clean re-keys, ~98 decisions, 58 shared selectors to split [M] | 22 re-keys, 41 decisions [M] | 21 re-keys, 36 decisions, in 16 files [M] | 0 |
| Hard couplings to resolve | all 19 (one is the 51-rule fit) [M] | 17 (all but H16, H19) | 6 for the allow-list (H1, H2, H3, H9, H10, H15); the Path and Studio ones are kept off by the list [E] | 0 |
| Data path | ids, types, upgrade, validation schema, renderer, editor: ~8 files (the dials took 19 and 38 [M]) | same | same | done (D1) |
| Tests that break | 2 corners pins [M], plus their e2e twin `page-dials.spec.ts` [E] | 1–2 | 0 for Bold's and Soft's Type re-keyed [M]; expected 0 for all 8 [E] | 0 |
| New tests | token owner, facet key, motion-needs-its-element, fit sweep, marks geometry (new tool), sample e2e | fit sweep, marks geometry, token owner | token owner, facet key, fit sweep (from the louder sweep), menu pin | none |
| Matrix to an allow-list | 4,096 → still needs a list of ~30 | 256 → ~30, plus a new geometry tool | 56 → 20 | 243 dial states, proven per step |
| Size [E] | ~50 files, 4–6 agent tasks | ~30 files, 3–4 tasks | ~20 files, ~2 tasks | 0 |

**Risks:**
- **A.**
  - The in-block migration has to come first (§3).
  - Import order starts deciding real cascades (4 collision sites found).
  - The dials overlap the facets: `rounder` already is Soft's surface corners, `drama` is Type
    scale, and the motion dial is Motion's amount. The editor (D4) would offer the same choice
    twice.
  - Most of the cost buys Marks and Motion swaps, which are the most coupled facets and the least
    reusable: only 3 Styles have marks, and each is that Style's signature.
- **B.** Marks are in 15 of the 19 hard couplings. "Studio's marks on Clean" (04's example) means
  first deciding H7, H8 and H11–H13 (underline against leading, the figure's size, the separators
  and the tilt) and building a geometry check that doesn't exist yet.
- **B′.**
  - The fit (H3) has to be re-proven per base. A failure means a per-combination refit and more
    rules, unless each Type is proven at the worst case of its bases (Soft's chip, button padding
    `--space-8`).
  - Bold's lift on Poster's 0.88 leading (H2) is re-measured, or that pair leaves the list.
  - Cinematic's numerals (H10) and Poster's stickers (H15) read the swapped Type's tokens. They
    stay on the page's Style, whole.
- **C.** It answers "a sense of more control", but not "mix and match styles". The owner's D3
  chose "Facets from a proven list".

**Recommended: B′ now, the rest of C kept.** Make Type the one facet, with the 20-swap menu above.
Before it ships, two guards: one owner per token, and every Style rule keyed on exactly one facet or
the Style.
- **What the creator gets.** It is the one swap that changes the page a lot ("Bold's headlines on a
  Soft page") and is mostly self-contained already. 72 of its rules and all 152 root declarations
  are Type alone, and its fit is per Type and layout today.
- **Surface comes later.** It waits for the in-block Surface rules (40 pure, plus 10 judgement calls
  in Bold and Soft alone) to move into the sheets. That was out of scope in 03 §4.3. The corners
  dial already gives Soft's corners to any Style meanwhile.
- **Marks and Motion stay with their Style.** The one Marks swap worth a later look is Studio's pen
  (underlines, circles, the scribbled frame) on Clean, Quiet or Soft: 3 combinations, once a
  geometry check exists. Its tilt and its removal of separators stay out.

## 7. Not measured by this spike
- No screenshot or visual judgement; the dev stack was off.
- No e2e spec was run, including `page-dials.spec.ts`, which pins `rounder` to Soft in a browser.
- No `pnpm typecheck` (the kit tests compiled every component the prototype touched).
- The in-block rules' cascade in a browser (scoped CSS).
- The fit sweep and the marks-geometry estimates have no timed run behind them. They are scaled
  from the louder sweep's.
- X56–X61 are not on this base branch. X59 (hazy for every Style that blurs) is on
  `feat/Codex-61zsk.49-spread-hazy`, and it moves `atmosphere` in 5 data halves. It touches only
  Moving-background rules, which §1 files under no facet.

The scripts are in the session scratchpad (`d0-facets/`): the census, the in-block planner, the
re-key and the probe. They are throwaway, like the prototype.

# Journey sections — continuation prompt (CONSOLIDATION)

Paste this whole file as the first message of a new chat.

---

We're continuing a programme that makes the **course landing-page builder's section components
flexible enough to express many design languages**. You are the **orchestrator**: you hold the
decisions and the merges. **All component work is done** — round 0 (research + audit), the five-stage
foundation, and four component rounds have landed and merged. **11 of 11 section types are wired, 62
compositions declared, nine design axes live.**

**Your job is consolidation, and then ONE PR to `dev` (not `main`).**

Read the programme docs before doing anything. They are the accumulated state, and everything below is
a summary of them, not a replacement. Committed at `docs/design/journey-sections/`:

| Doc | What it is |
|---|---|
| `README.md` | Programme spine — status, decisions, worktree split, test data. **Now current.** |
| `00-design-language-research.md` | 9 design families → the 9-axis model, 62 compositions, 8 presets |
| `01-component-audit.md` | Per-component dossier, `file:line` inventory. Line counts are PRE-work |
| **`02-axis-contract.md`** | **THE BINDING SPEC — 72 amendments. Where anything disagrees, this wins** |
| **`03-component-wp-brief.md`** | Four rounds of measured lessons. Read the round-4 section |
| `04-contrast-baseline.md` | **Partially re-measured.** The accent ladder is current; everything above the round-2 correction heading is still short-settle and suspect (`Codex-gkhro`) |
| `05-bridge-table.md` | **CLOSED** — all ten real bridges consumed |
| `CONTINUE-round-{2,3,4}.md` | Prior handoffs, kept for history |

## The model, in one box

- **`variant`** = *composition* (section-specific — 62 across 11 types)
- **`design`** = *treatment* (universal — 9 axes × 4–5 closed values). Axes: `width density surface
  edge align type accent motion media`
- Resolution per axis, first hit wins: `section.design[axis]` → `page.design[axis]` → axis default
- 8 named presets. **Candlelit** reproduces today's published page and is what migration `0084`
  backfilled onto **695 rows**; **Signal** is the recommended default for new pages
- **Candlelit's pinned bundle**, which you should keep in your head because it is the installed base:
  `width: text · density: airy · surface: media · edge: none · align: center · type: monumental ·
  accent: glow · motion: drift · media: bleed`. Pinned at `design-vocabulary.test.ts:116-131`

## Current state

**Integration branch `feat/journey-sections-foundation`** in worktree
`/Users/brucemckay/development/Codex-js-foundation`, based on `dev@013e2d42`. **Not pushed. No PR.**
Working tree clean.

**Re-read the tip before you gate or merge anything** (A52 — this has bitten three handoffs in a row,
including the one that produced this file). `git log --oneline -1`.

**Gate, measured independently rather than trusted:** `check:ci` **0** (1438 files, 179 warnings, 0
errors) · both `check:brand-boundary` **0** · `pnpm typecheck --force` **0** (57/57, **0 cached** — a
cached FULL TURBO is not a gate that ran) · `pnpm --filter web test` **0** (**172/172 files**) ·
`svelte-check` 65 errors repo-wide, **0 in `page-builder/render*`**, identical to the pre-round-4
baseline. Capture the REAL exit code — `$?` after a pipe to `tail` measures `tail`.

**Migrations applied:** `0084`–`0089`. Round 4 needed none (A69). The safe pair is `pnpm db:local:gen`
/ **`pnpm db:local:migrate`** — **not** `db:migrate`, whose root script does not exist.

**Closed by round 4:** `Codex-tqr51` · `Codex-i9pzs` · `Codex-qcgo3`. `OWED_READS` is **empty** for the
first time, so no authorable field on any type is unread.

### CRITICAL — where the dev stack runs (contract A23)

**The shared worker fleet runs from `/Users/brucemckay/development/Codex-js-foundation`**, serving
`lvh.me:3000` plus all nine worker ports. Worker ports are fixed, so only ONE fleet can run. Verify it
yourself before believing any end-to-end result: `lsof -ti:4001 | head -1 | xargs -I{} lsof -a -p {} -d
cwd`. **Check the callee port's cwd, not just vite's** — a stale callee renders correctly-shaped HTML
and the symptom is indistinguishable from a broken feature. Any `packages/*` change needs
`pnpm --filter @codex/<pkg> build`; the workers consume the built `dist`.

Note `lsof -ti:PORT | head -1 && echo OCCUPIED` reports **`head`'s** exit status, not `lsof`'s.

---

## CONSOLIDATION — the work, in the order I'd do it

### 1. The generic array control (A29 · `Codex-28ifd`) — the biggest single item

`number`, `toggle`, `list` and `repeater` are declared in `section-fields.ts` with no editor UI. **But
A29's diagnosis is wrong and the truth is worse (A72):** `SectionEditor.svelte:183-231` branches
`media` → `MediaPicker`, `textarea` → `<textarea>`, `select` → `<select>`, then falls through a
**catch-all `{:else}` to `<input type="text">`**. So all four kinds render a normal-looking text box and
`onInput` (`:78-81`) writes `target.value` — a **string** — into array- and number-shaped keys.

Proved end to end: typing into guide's field labelled **"Credentials"** (declared `repeater`,
`itemFields: [{label},{detail}]`) persisted `props.facts` with `jsonb_typeof = string`, and
`coerce.ts`'s `asObjectArray` discards it at `if (!Array.isArray(value)) return undefined;` — no
warning. A creator types, it saves, nothing appears.

**The six affected fields**, of 82 declared: `ache.points`, `turn.points`, `feel.inclusions`,
**`feel.previewDuration`** (worst — substitutes a hardcoded 480s rather than vanishing), `guide.facts`,
`invite.offers`. **7 compositions are unreachable** as a result: `ache.list`/`checklist`,
`turn.arc`/`numbered`, `feel.grid`/`ledger`/`stack`, each verified at its gate. A29 also over-scopes:
`turn.before-after` IS authorable (`from`/`to` are `textarea`), and `invite.offers` is decorative
because `InviteSection:189` derives paths from `context.offer`.

**Sequencing is counter-intuitive and it matters.** `valueOf()` (`:73-76`) returns `''` for any
non-string, so once a field correctly holds an array the text box renders **empty over real content**
and a creator "filling in the blank" destroys it. **The catch-all must stop claiming these kinds BEFORE
or WITH the real control, never after.** That is `Codex-wtfs1`'s trap on a different key — read A30
before binding a repeater to any key a renderer already prefers.

This is an interaction-design surface (add / remove / reorder / empty state / keyboard). **Ask the user
about it rather than designing it unilaterally** — their standing preference is to be asked before
visual work, and A29's own argument for building it once is that the interaction surface is where the
bugs live and must behave identically everywhere.

### 2. The builder canvas applies NO page-level styling (`Codex-6nrsk`)

Measured: the canvas emits **0/10** `data-jp-*` and resolves **0/9** axis properties on 11 of 11
sections; the public page emits 10/10 and 9/9. So a creator can change any of the nine axes, watch the
design panel's own resolved-value readout update, and see the canvas beside it **not move**.

**It is wider than the axes.** Page-level styling lives in TWO public-tree wrappers —
`render/JourneyRenderer.svelte:55` applies `brandOverridesToStyleAttr`, and
`render/SectionRenderer.svelte:67` applies `resolveDesign`. `JourneyBuilderCanvas.svelte:28` imports
`render-edit`'s `SectionRenderer` **directly**, bypassing both. So the canvas also fails to apply
`landing_pages.brand_overrides`, and a fix that only calls `resolveDesign` would still preview the wrong
brand — more convincingly, because everything else would look right.

Confirmed by a real divergence: `--color-brand-primary` reads `#D82741` in the canvas and `#552e8e` on
the public page for the same org, because `of-blood-and-bones/pricing-smoke-test` is the **only** row
with non-empty `brand_overrides` (`{"primaryColor": "#552e8e", "tokenOverrides":
{"--brand-shader-preset": "lava"}}`) — and it is the golden page every measurement runs against. The
public page is correct. **Unverified sub-question:** does the canvas apply `tokenOverrides` either? If
not, a creator who picked the `lava` shader preset cannot see it.

`render-edit/index.ts` says the canvas "gains them when consolidation repoints `JourneyBuilderCanvas` at
the unified components", i.e. it was meant to come with item 3. **It may be worth decoupling** — the
~20-line version makes the design panel honest much sooner. This changes how the builder LOOKS, so ask
first.

`canvas-public-parity.svelte.test.ts` **characterises** the current gap. Fixing it turns that test red
on purpose; delete the characterisation assertion rather than loosening it.

### 3. Tree unification (`Codex-eckbx`) — and the concrete blocker nobody had named

Repoint `JourneyBuilderCanvas` at the unified components and delete `render-edit/sections/*`.

**The actual blocker:** both barrels export a type named `SectionComponentProps` and **they disagree** —
the canvas contract calls the config bag `props` and **requires** `variant`; the public one calls it
`config` and makes `variant` **optional**. Reconciling those two names IS the unification
(`render-edit/index.ts`'s own convergence note).

**Do not drain the `_*.css` partials early.** A16 keeps them because they are the reference each
component WP ported FROM, and round 4 strengthened the argument: since the canvas applies no
page-level styling, draining a partial takes the twin from *untreated* to *unstyled*. Every worktree
annotated its twin with a port map and deliberately did not drain it.

Related, and deliberately left for you with full information: **7 of 16 canvas modifier rules are
unreachable at runtime** (`Codex-eqcpz`) — `guide--centered`, `hero--left`, `hero--minimal`,
`prose--centered`, `prose--twocol`, `prose--wide`, `video--simple`. `resolveVariant` migrates a stored
legacy id and returns the NEW id **before** any class is emitted, so a page storing `centered` emits
`.jp-prose--column` and never `.jp-prose--centered`. None is syntactically dead, which is why no linter
flags them. **They also encode exactly the semantics the canvas cannot render** — `0085`'s collapse
moved their meaning into the axis layer — so they are simultaneously dead code and port-reference
material. I did not delete them for that reason; the parity test pins them at exactly 7 so the decision
can be made with full information.

### 4. The remaining smaller items

- **The preset variant maps (A21/A29)** and **A65's per-type override map** (`Codex-9tze8`). The
  override map now has evidence on **four of nine axes**: `width` (accepted at A51), `type` (grows
  `feel`'s `<h2>` +8px because `feel` ships `--text-3xl` where `proof`/`faq` ship `--text-4xl`), `media`
  (letterboxes `guide`'s portrait to 21/9; `introVideo` wants `frame` while `reel` and `hero` want
  `bleed`), `align` (`reel`'s editorial split). **None can be fixed locally** — each fix is right for one
  type and a regression for another. It must sit BESIDE the pinned Candlelit bundle, or all 695 pages
  read as "Custom" in the picker.
- **~124 design-panel i18n keys (A26).** **Reframe this before budgeting it:** the labels are NOT
  missing. `design-vocabulary.ts`'s header documents them as deliberately inline English per A20,
  because `$lib/page-builder` is the CE-4-scanned public-bundle root and none of that copy is ever served
  to a visitor. A creator sees correct English today; an audit confirmed zero raw keys and zero blanks
  across all 11 panels. The task is **extract**, not fill in.
- **A25's section-less-pages migration** — 678 of 695 rows have zero sections and should get Signal
  rather than Candlelit. Data migration on 678 rows: get sign-off.
- **`Codex-gkhro`'s contrast re-sweep.** The accent ladder is done (`04-contrast-baseline.md`, round-4
  block). The other ten section types are still short-settle. A re-sweep must **name the state it
  measured** — `.descent__rn` has three different ratios depending on enhancement state.
- **The `--descent-signal`/`--descent-bloom` aliases** now resolve to the same value. A sweep could read
  `--jp-accent-mark` at the six call sites and drop both. Pure tidy, no behaviour change.
- **`Codex-1khpv`** — the catalogue ships emoji as section icons and it is **creator-visible**: the Add
  menu renders `"☺ Your guide …"`. Route all 11 through `Icon/*Icon.svelte` via `IconBase`. Note a
  glyph that looks typographic can still be an emoji — U+25B6 and U+2726 both carry emoji presentation
  on Apple platforms.
- **There is ZERO journey e2e coverage.** All 18 specs in `apps/web/e2e`, grepped for journey /
  landing.page / sell.page / `data-jp-` / `jp-sec` / section-type / studio/journeys: **no matches**. So
  "audit the specs for locator drift" has nothing to audit — and it explains why every round-4 finding
  needed an agent driving a browser by hand. `Codex-sf7t6`'s browser half would be the first journey
  spec; its structural half already exists as `canvas-public-parity.svelte.test.ts`.

---

## The two guards that now exist, and why

Both were added because a **correct diagnosis recorded only in a component header does not reach the
next component** (A64). Do not weaken either; if one fails, it is telling you something.

1. **`journey-design.test.ts` — keyword/unitless-zero guard (A63/A64, `Codex-3kqqp`).** Five assertions
   over every declaration in `render/sections/*.svelte`, with the dangerous set **derived from
   `AXIS_SPEC`** so a token added tomorrow is covered the day it is added. No keyword-valued token may
   be a list item; none may sit inside `min/max/clamp/calc`; the unitless-zero set must be empty.
   One `KNOWN_VIOLATIONS` entry, pinned at length 1: `HeroSection`'s
   `background-image: var(--jp-media-scrim), linear-gradient(…)`, which works at Candlelit's `bleed` and
   dies at the other four media values. Both honest fixes change the `media` axis's pinned semantics, so
   it is a design decision.
2. **`canvas-public-parity.svelte.test.ts` (`Codex-sf7t6`).** Registry parity, variant parity, and the
   two characterisations above.

**Both are proven falsifiable** — injected violations turn them red and name each one; byte-identical
restores return them to green. Do that for any guard you add: a guard that cannot fail is worthless. My
first attempt at one of those proofs used a selector that does not exist and the script printed success
anyway, so it tested nothing and looked like a pass. **Assert that the injection changed the file.**

## Hard constraints — every one cost something

- **NEVER** `pnpm db:seed` or `pnpm db:reset` — they TRUNCATE. Inspect with
  `docker exec -i neon-postgres-1 psql -U postgres -d main`.
- **NEVER** a bare `pnpm test` from the repo root — `.env.test` points `DATABASE_URL` at the **dev**
  database and `cleanupDatabase()` deletes real rows (`Codex-bsbf8`). The gate is
  `pnpm --filter web test`.
- **NEVER** `pnpm dev` in a worktree; never kill a port belonging to a running worktree.
- **i18n is single-owner.** **33 `journey_*` keys** now exist. Editing `messages/en.json` is enough — the
  fleet's vite regenerates — then verify every key reaches BOTH `src/paraglide/messages/en.js`
  (git-tracked, **force-add** it) and `src/paraglide/messages.js` (gitignored). paraglide-js is **1.11.8
  with no plural support** — never ICU; use a separate `_one` key plus a call-site ternary. **A62: quote
  the `en.json` line for any key you claim exists.** All six of round 4's claims were accurate against
  four false ones in round 3.
- **Import boundary:** nothing under `$lib/page-builder` may import `$lib/components/page-builder`.
  (That is why the parity test lives under `components/`.)
- Design tokens only. Svelte 5 runes (`$props()` + typed `interface Props`), `$app/state` not
  `$app/stores`. **`apps/web` has `strictNullChecks` OFF** — string discriminants, not boolean-literal
  ones. Currency GBP (£). **No emoji in product UI.**
- `prefers-reduced-motion` is inviolable: a `0.01ms` animation to a translated end state **still moves
  the element**. A40: the STATIC layout is the baseline.
- **A cold worktree reports 235 svelte-check errors, not 65** — `src/paraglide/messages.js` is a
  gitignored artifact, so until the vite plugin compiles it every `$paraglide/messages` import errors.
  Run `svelte-kit sync` and start vite once before believing any svelte-check number.
- **zsh, and these each cost a real mistake:** backticks inside a double-quoted `git commit -m` are
  **executed** (use `-F -` with a quoted heredoc `<<'MSG'`); `??` in a `--reason` string **globs**;
  `--include=*.svelte` unquoted fails to match.

## Verification — measured, not asserted (A10 + A24 + A67)

**HTTP 200 is not "it works."** Verify on the served page, not just via the gate.

Contrast: canvas `fillStyle` + `getImageData` with **`globalCompositeOperation = 'copy'`** — the default
`source-over` composites a transparent parent onto the previous pixel and reads back opaque. Resolve the
effective background by **walking ancestors until alpha > 250** (`body` is transparent). Flip theme by
setting **both** `data-theme` AND the `.dark` class. **Settle 2× rAF plus ≥1200ms** (A46).

**Three corrections that each changed a conclusion (A67):**
1. **Type must be measured at REAL viewports.** `--text-*` carries a `vw` term, so a container
   constrained to 375px inside a 1440px window reports the **1440px** `font-size`. A10's "constrain
   `.jp-sec`" is right for container queries and wrong for type.
2. **The ancestor walk cannot measure text over media** — scrim and poster are absolutely-positioned
   **siblings**. Use a glyph-pixel diff (shoot with text visible, then with `color: transparent`, sample
   only where ink landed). `visibility: hidden` is the WRONG control: it removes the chip's own plate.
3. **A third reveal state exists: armed-and-never-entered.** `reveal.ts` sets `opacity: 0` from JS and
   clears it only when an IntersectionObserver fires. Force `is-in`.

**And a fourth, from the round-4 re-measurement: a token's ratio is not what it paints.**
`.descent__spine` reads its signal then mixes it 80% toward transparent, so it measures 11.04 dark where
the raw token is 6.04. Measure the **element** for any pass/fail claim.

**Read both expressions before believing that X mirrors Y.** Round 2 recorded `--jp-accent-mark` at
"2.04:1 in dark" and built a workaround around it; the token that measures 2.04 is `--jp-ember` /
`--jp-accent-fill`. accent-mark is 6.04, because A38 repointed it. It read the aliased token's ratio
onto the alias.

**A53, now four data points and the picture has changed.** `pnpm --filter web test` returned **exit 0 at
load average 55** with only the fleet running. The false-failure run was at load **44 with a sibling
worktree's vite up**. So the trigger looks more like **concurrent vite instances** than raw load. Stop
your vite before gating, and if a suite you never touched times out, re-run that file in isolation
before reporting a failure — and report the load.

## Test data + surfaces

| org | brand | journey pages |
|---|---|---|
| `of-blood-and-bones` | cream `#F6EFE6` light / `#200000` dark, **distinct dark brand `#e1233b`**, accent `#ED8110`, Playfair. `branding_settings.primary_color_hex` is `#D82741` | `pricing-smoke-test` (11 sections — the golden page, the ONLY page with `introVideo`/`reel`, and the ONLY row with `brand_overrides`), `bone-deep` (+ a `guide`), `tending-the-grief`, `ancestral-threads`, `return-to-the-shoreline` |
| `studio-alpha` | `#E11D48`, no accent set | `bone-deep` (landing_page `4664e6ce-8285-4e69-9034-ba81189fce12`, 7 sections, + a `guide` + `introVideo` + `reel`), `tending-the-grief` |
| `studio-beta` | `#2563EB`, no accent | **none** — zero courses, zero landing pages (A41, `Codex-jl17s`). Measure by labelled brand substitution |

Password `Test1234!`; auth rate-limits at **5 logins / 15 min** — cache Playwright `storageState`. The
email field is `type="text"` with `id="email"`, so `input[type="email"]` never matches, and each failure
extends the shared window. `of-blood-and-bones`' owner is `luzura@test.com`; `creator@test.com` owns
`studio-alpha`.

Public page `http://<org>.lvh.me:3000/journeys/<slug>` — **redirects an ENTITLED viewer to
`/dashboard`**, so measure in a fresh cookie-free context with a `sectionCount === 0` reload guard.
Builder `/studio/journeys/[id]/page`, where **`[id]` is the landing_page id, not the course id**; a
`null` load spins on "Loading page…" forever (`Codex-b0fm6`). The add control is `.section-list__add`
and its label is `" Add"` with a **leading space**. The canvas loads curriculum stages
**asynchronously** — 20 descendants at 2.5s, **128 at 9s** — so A46's settle under-reports canvas
fidelity; wait for a stable count.

## Open beads

**P1:** `Codex-28ifd` mis-authoring controls · `Codex-bb445` stale uneditable `price` previewed on 7
published pages (creator-facing, not visitor-facing — 0× in the rendered DOM, hydration payload only) ·
`Codex-d01er` the whole `--color-brand-accent` chain, 76 consumers · `Codex-g7ipk` brand-painted
surfaces not consuming `--color-text-on-brand` (**the journey on-fill ratio was mis-filed under this
from round 2 onward; that ratio is FIXED and this bead is untouched — do not close it on journey work**)
· `Codex-8jve9` `--jp-ember` theme-blind (**narrowed:** the accent ladder is no longer affected, but
ember itself still measures 2.04 dark and the CTA still disagrees) · `Codex-gkhro` contrast re-sweep
(**partially done**) · `Codex-490z7` a hero image can only be a video's poster frame.

**P2:** `Codex-6nrsk` canvas applies no page-level styling · `Codex-eqcpz` 7 dead canvas rules ·
`Codex-sf7t6` parity test (structural half done) · `Codex-9tze8` per-type preset override map ·
`Codex-3kqqp` keyword-token guard (built; open for its one known violation) · `Codex-eckbx` tree
unification · `Codex-wtfs1` the `items[]` repeater data-loss trap · `Codex-6nb7i` inspector panels
2.52:1 · `Codex-h3qpm` `--text-5xl` maxes below `--text-4xl` · reel `captions[]` has no editor at all.

**P3:** `Codex-1khpv` emoji section icons (**confirmed creator-visible**) · `Codex-maf0y` placeholder
copy (**LIVE, and a queue — each bridge fix promotes one more**) · `Codex-wqxv4` media slots
(`reel.strip` permanently descoped: it needs 3–5 clips against one `previewVideoMediaId`, an array
problem rather than a missing slot) · `Codex-jl17s` studio-beta needs a journey page · `Codex-b0fm6`
builder infinite spinner · `Codex-scab9` the free-taste player is a visual mock · `Codex-lfheu` the
seeder writes a dead authored `price` prop · duration fields are free text but land in an M:SS badge ·
`SectionSkeleton` hardcodes 16/9, wrong under `bleed`/`mask` · the stale `JourneyBuilderCanvas` caveat ·
off-catalogue stored variants (10 hero with none, 6 ache storing `default`).

## The one risk to keep watching

**Candlelit has now been wrong three times, on three different axes, and every time nobody could tell
until an axis was consumed.** Round 2: `width: narrow` was 12–24rem off on three of four sections (fixed
by `0088`). Round 3: the preset's own *variant* map disagreed with stored data on `invite` (fixed by
`0089`). Round 4: `type: monumental` grows `feel`'s `<h2>` by 8px and `media: bleed` letterboxes
`guide`'s portrait — neither fixable locally, hence `Codex-9tze8`.

All 11 types have now been checked, but note **the check is not the same check for every type** (A66).
For a type with stored rows it is a *fidelity* check — does the preset render what shipped? For `guide`,
which had zero rows, fidelity is **undefined** and only a *consistency* check was possible. Both of
Candlelit's caught errors were caught by fidelity, i.e. by someone noticing a mismatch against a real
page, so **a type with no rows has no tripwire.** If you add a type or a preset, do the arithmetic.

**Never edit page data to make a preset match.** A creator's stored design is their content. The preset
and the data are pinned to each other by `design-vocabulary.test.ts` precisely so they cannot drift: if
you change one you change both, or all 695 pages read as "Custom" in the picker.

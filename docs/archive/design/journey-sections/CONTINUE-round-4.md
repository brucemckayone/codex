# Journey sections — continuation prompt (round 4)

Paste this whole file as the first message of a new chat.

---

We're continuing a programme that makes the **course landing-page builder's section components
flexible enough to express many design languages**. You are the **orchestrator**: you hold the
decisions and the merges; subagent worktrees do the implementation. Round 0 (research + audit), the
five-stage foundation, round 1 (hero pilot), round 2 (social + map) and round 3 (prose + invite) are
done and merged. **Your job is round 4 — the last component round.**

Read the programme docs before doing anything. They are the accumulated state, and everything below
is a summary of them, not a replacement. They are committed on the integration branch at
`docs/design/journey-sections/`:

| Doc | What it is |
|---|---|
| `README.md` | Programme spine — decisions, worktree split, test data |
| `00-design-language-research.md` | 9 design families → the 9-axis model, 62 compositions, 8 presets |
| `01-component-audit.md` | Per-component dossier, `file:line` inventory |
| **`02-axis-contract.md`** | **THE BINDING SPEC — now 62 amendments. Where anything disagrees, this wins** |
| **`03-component-wp-brief.md`** | **The checklist every worktree follows: 9 pilot lessons + round 2's + round 3's** |
| `04-contrast-baseline.md` | Measured contrast — **known-suspect, see `Codex-gkhro`** |
| `05-bridge-table.md` | Per-worktree `coerce.ts` changes — **known-incomplete, see A62 / round 3** |

## The shape of the thing

The builder wasn't restrictive by design — it was restrictive by a **wiring gap**. 37 variants were
declared, written by the picker, resolved by a helper, and then dropped, because `SectionRenderer`
never passed `variant` to the component. So the model is:

- **`variant`** = *composition* (section-specific — 62 across 11 types)
- **`design`** = *treatment* (universal — 9 axes × 4–5 closed values = 39 CSS rules, forever)
- Axes: `width` `density` `surface` `edge` `align` `type` `accent` `motion` `media`
- Resolution per axis, first hit wins: `section.design[axis]` → `page.design[axis]` → axis default
- 8 named presets. **Candlelit** reproduces today's page; **Signal** is the recommended default

## Current state

**Integration branch: `feat/journey-sections-foundation` @ `4fd004ef`**
in worktree `/Users/brucemckay/development/Codex-js-foundation`. Based on `dev@013e2d42`.
Not pushed. No PR. Working tree clean. **8 of 11 types done** (hero, proof, faq, map, ache, turn,
feel, invite), **41 compositions live**.

```
4fd004ef  docs — round 3's amendments (A54–A62) and the lessons for round 4
5614cbe0  fix — round 3's shared findings: the invite seed artifact, on-fill ink, 12 keys
9db7121b  merge: WT-7 invite
3701de9b  merge: WT-1 prose
0107e85b  docs — point the round 3 handoff at the new rung
64023e03  --jp-body-size rung + editAttrs typed
```

**Gate on that HEAD, verified independently by the orchestrator with REAL exit codes** (not `$?`
after a pipe to `tail` — that measures `tail`): `check:ci` **0** (179 warnings, 0 errors) · both
`check:brand-boundary` **0** · `pnpm typecheck --force` **0**, 57/57, **0 cached** ·
`pnpm --filter web test` **0**, **170 files / 2094 tests**, no timeouts at load average 26 ·
`svelte-check` 65 errors / 37 warnings repo-wide, **0 in any journey section**.

**Migrations applied locally:** `0084` (design column + Candlelit backfill), `0085` (variant
collapse), `0086` (hero + signature media slots), `0087` (hero `split-media` → `stage`), `0088`
(Candlelit `width` narrow → `text`, 695 rows), **`0089` (invite `card` → `pool`, 7 rows)**.

**Verified end-to-end on the served page after merging**, not just in tests: `data-jp-variant="pool"`
on the invite; `"Join now"` and `"Begin the work."` at **0 occurrences** anywhere; `is waiting.` and
`Start free · cancel anytime` rendering for the first time; a builder-selected `before-after` turn
changing the served HTML; `ache`'s undeclared `variant: "default"` still falling back to `column`.

### CRITICAL — where the dev stack runs (contract A23)

**The shared worker fleet runs from `/Users/brucemckay/development/Codex-js-foundation`**, serving
`lvh.me:3000` plus all nine worker ports. This is deliberate and must stay that way. Verify it
yourself before believing any end-to-end result: `lsof -a -p $(lsof -ti:4001) -d cwd`.

The read path is web → `content-api` worker → `CourseJourneyService` (`packages/access`) → Postgres.
Worker ports are fixed, so only ONE fleet can run. If the fleet serves a different branch, a
worktree's web app renders correctly-shaped HTML from a **stale callee**, and the symptom is
indistinguishable from a broken feature. **Check the callee port's cwd, not just vite's.** Any change
to a `packages/*` file needs `pnpm --filter @codex/<pkg> build` — the workers consume the built
`dist`.

**Do not merge into this branch while a worktree is mid-measurement** — its HEAD is the fleet's code.

---

## ROUND 4 — what to do

Two worktrees **in parallel**, both cut from `4fd004ef`. Ports 3024/3025 are free.

| WT | Types | Owns exclusively | Port |
|---|---|---|---|
| **WT-2 · video** | `introVideo`, `reel` | `render/sections/{IntroVideo,Reel}Section.svelte` (441 / 935) · `render-edit/sections/VideoSection.svelte` · `render-edit/journey-sections/_video.css` | 3024 |
| **WT-6 · guide** | `guide` | `render/sections/GuideSection.svelte` (452) · `render-edit/sections/GuideSection.svelte` · `render-edit/journey-sections/_guide.css` | 3025 |

**WT-2 owns the hardest component in the programme.** `ReelSection` is 935 lines with 18 raw `px`, 6
`rgb`/hex, five blend layers and 32 SVG rects, and it owns the `media: bleed` aspect↔scrim coupling
that every other type inherits.

**WT-6 is mostly data, and its hard problem is that its type does not exist yet** (below).

Worktree setup recipe (per worktree — this is the recipe that worked in round 3, verbatim):
```bash
cd /Users/brucemckay/development/Codex
git worktree add -b feat/journey-sections-video /Users/brucemckay/development/Codex-js-video 4fd004ef
for f in .env.dev .env.test .npmrc; do cp "$f" /Users/brucemckay/development/Codex-js-video/; done
for d in workers/*/; do w=$(basename $d); for f in .dev.vars .dev.vars.test; do \
  [ -f "$d$f" ] && cp "$d$f" "/Users/brucemckay/development/Codex-js-video/workers/$w/"; done; done
cd /Users/brucemckay/development/Codex-js-video && pnpm install --prefer-offline \
  && pnpm build --filter='./packages/*'
```
Each worktree runs ONLY its web app: `pnpm --filter web exec vite dev --port 30NN --strictPort`.
`--strictPort` is mandatory — without it vite silently squats a neighbour's port.

### Each worktree's three stages (contract A9 — strict order)

1. **Wire the axes that APPLY.** Replace every hardcoded layout / rhythm / type / edge / surface /
   motion / media literal with the corresponding `--jp-*` read. Highest-leverage half by far.
   **`media` DOES apply to all three of your types** — `hero`, `introVideo`, `reel`, `guide` and
   `proof` are the five research §2.2 names, and you own three of them. You are the first worktrees
   for which the `media` axis is real work rather than a documented N/A. State which axes apply in
   your component header, citing §2.2.
2. **Verify the collapse.** `0085` already migrated stored data; confirm the *rendered result* is
   unchanged. **And run the A56 check — see below, it has now caught two silent flips.**
3. **Add the new compositions.** Port from the type's `_*.css` partial first (`A12`).

Stop at a **stage boundary** if you run out of room, never mid-stage.

Final composition sets (from `section-catalog.ts`, **closed — do not edit**):
- `introVideo` (5): `theatre` `plain` `split` `bleed` `card`
- `reel` (5): `theatre` `plain` `split` `strip` `waveform` — **`strip` is DESCOPED per A27**
- `guide` (5): `portrait` `column` `quote` `credentials` `letter` — **check `letter` against A27
  and migration 0086 before building it; A27 descoped it when no media slot existed, and F-D added
  slots afterwards. Report which reading is right rather than guessing.**

---

## Banked findings — these are theirs to fix

### BOTH — the A56 check is now mandatory, and it has caught two silent flips

0087 rewrote a seeded `hero: split-media` back to `stage`. 0089 did the same for `invite: card`. In
both cases the seeder wrote a variant, the renderer discarded it, and **honouring it would have
flipped every published page to a composition no creator chose or had ever seen.**

Stored variants for your types, queried on the current DB:

```
introVideo | theatre | 1     reel | theatre | 1     guide | (none — zero sections anywhere)
```

`theatre` IS a declared composition, so `resolveVariant`'s unknown-id fallback does **not** protect
you. **Query what the page stores, then compare against what the DOM actually renders**, and if they
disagree, write the migration and fix the seeder in the same change. `data-jp-variant="theatre"` on
markup that is unmistakably something else is what the evidence looks like. A33/A56.

### WT-6 · guide — your section type DOES NOT EXIST, on any page, anywhere

Confirmed by query: **zero `guide` sections in the entire database.** Not "none on `studio-alpha`" —
none at all. WT-5 and WT-1 both hit a weaker version of this and lost time to it.

So before you can measure anything you must add a `guide` section **through the builder UI** at
`/studio/journeys/[id]/page` — not by writing to the database. Through the builder is deliberate: it
exercises the real add-section path and confirms the catalogue's `defaultProps` seed correctly. Add
it to a `studio-alpha` page for the brand-neutral reading and to `of-blood-and-bones` for the
branded one. **A direct SQL fixture write is blocked by the permission classifier — do not try to
work around it.**

Expect this to expose `Codex-maf0y` (the catalogue seeds placeholder copy — "A short bio that
establishes credibility and warmth" — which a published page then serves to real visitors). It is
now **LIVE and reproducible**; report if your type makes it worse, do not fix it here.

- **`guidePortraitMediaId` is NOT a real column.** It lives inside the `guide` jsonb bag, unlike the
  three that are real `courses` columns — see `sell-media-store.svelte.ts:36` and
  `journey-queries.ts:235`. Read that comment before touching the `media` axis on this type.
- `guide: ['clip', 'duration', 'facts']` is **your `OWED_READS` line** (`section-fields.test.ts`,
  under `$lib/components/page-builder/` — note the path). `facts` powers the `credentials`
  composition. **That file is SHARED and CLOSED — REPORT the line to delete, do not edit it.** It
  goes red the moment you wire the read; that is A28 working. Round 3's method, which I accepted:
  transiently delete the line, run that one file to prove it goes green, `git checkout --` it, and
  verify byte-identical against a pre-edit backup with a clean tree. Report both results.
- **`GuideSection` does not consume its bridge.** `coerce.ts` declares
  `guide: { eyebrow: ['eyebrow', 'role'], bio: ['bio', 'body'] }` and the file has **0 `asStringFrom`
  and 0 `aliasKeys` calls** — verified. This is the `Codex-tqr51` defect, same shape as the hero and
  invite instances. Copy `TurnSection`'s inline `asStringFrom(config, aliasKeys(...))` shape.
- `_guide.css` is the larger of the two partials (7.4KB) and `.jp-guide__play` is a single
  ~200-character line carrying `--jp-on-ember`, a gradient, a blend and a box-shadow. Read it before
  you port it.

### WT-2 · video — the largest component, and the one that owns `media: bleed`

- **`ReelSection` is 935 lines** with 18 raw `px`, 6 `rgb`/hex, five blend layers, 32 SVG rects.
  `IntroVideoSection` is 441. Budget accordingly and consider doing `introVideo` first — it is the
  smaller of the two and shares the `_video.css` partial, so it de-risks the port.
- **Raw-px media queries → `@container` queries** (A14): `ReelSection:876` (`760px`) and `:890`
  (`420px`). Not `--breakpoint-*` media queries. `.jp-sec` IS the container, and the builder canvas
  renders sections inside a device frame narrower than the window, where a viewport query reads the
  wrong number.
- **You own the `media: bleed` aspect↔scrim coupling.** A54's cousin lives here: see
  `feedback` in A9's floors — *text over media requires a scrim, and `media: bleed` is the only value
  that ships one*, so any composition placing text over media uses `bleed`, not `frame`. Changing a
  media card's `aspect-ratio` silently changes its text contrast, because the scrim's gradient stops
  are aspect-coupled. Measure both together.
- **`reel.strip` is DESCOPED (A27)** — `courses` exposes no media slot that can render it. Do not
  build it, and do not quietly substitute a synthetic gradient plate; that is exactly what today's
  `hero.split` does and A27 calls it out.
- `introVideo: ['clip', 'duration']` and `reel: ['duration']` are **your `OWED_READS` lines** —
  note the comment on the first: *`reel.clip` IS aliased (as `tag`)*. REPORT, do not edit.
- **Neither renderer consumes its bridge.** `coerce.ts` declares
  `introVideo: { eyebrow: ['eyebrow','kicker'] }` and `reel: { eyebrow: ['eyebrow','kicker'], tag:
  ['tag','clip'] }`; both files have **0 `asStringFrom` and 0 `aliasKeys` calls** — verified. These
  are the last three unbridged renderers in the tree (`Codex-tqr51`).
- **The last two hardcoded editorial-voice strings are yours** (`Codex-i9pzs`): `ReelSection:50`
  *"This is what a descent looks like."* and `IntroVideoSection:42` *"Ninety seconds inside the
  work."* Fall back to **DATA** (`context.course.title` or the creator's own field, as
  `InviteSection` now does) or **self-hide**. **NOT an i18n key** — a key holding one brand's voice
  moves the bug rather than fixing it. `ReelSection:65` *"Preview"* IS generic chrome and
  `journey_reel_tag_default` **already exists** — consume it. Closing these two closes the bead.

### Both worktrees also own
- `:focus-visible` on every interactive element; `edge: none`/`soft` must never remove the ring.
  Round 3's answer, if all your interactive elements are `CtaLink`: that component owns the ring as
  an `outline`, the `edge` axis only touches `border`/`box-shadow`, so it **cannot** reach it —
  measured true at `none`/`soft`/`hairline`. State the N/A with the measurement, don't assume it.
- Any inline `<svg>` → `Icon/*Icon.svelte` via `IconBase`. **A "typographic" glyph can still be an
  emoji** — U+25B6 and U+2726 both carry emoji presentation on Apple platforms. `ReelSection` has 32
  SVG rects; decide which are decorative geometry (fine inline as a drawn shape) and which are icons.
- Implementing `editable`/`onEdit` — **never via `EditableText`** (not SSR-safe). And **A60: write
  back to the key the value was READ from**, via a `readKey(keys, fallback)` helper, or a page
  storing an alias ends up holding both and the creator's edit renders as nothing.
- **Verifying the Candlelit claim for their types, on all nine axes**, including leading and tracking
  (A59), not just `font-size`.

---

## The measured lessons — in `03-component-wp-brief.md`, and READ THEM

That file now carries three rounds of lessons: the 9 pilot corrections, round 2's, and round 3's.
The five most expensive for round 4 specifically:

1. **A54 · never compose an `--jp-edge-*` token into a larger value.** `--jp-edge-shadow` is the
   keyword `none` at `edge: none` (Candlelit — every published page) and at `edge: heavy`, and `none`
   cannot be one item of a `box-shadow` list, so the whole declaration is invalid at computed-value
   time and falls back to the initial `none`. **Three rings painted nothing on every published page**
   before this was caught. Want the axis edge *plus* your own ring? The ring goes on `outline` with a
   negative `outline-offset`. **WT-2 has five blend layers and will want exactly this.**
2. **A55/A59 · check the base commit's `font-size` before applying A36.** A36 says a section `<h2>`
   reads `--jp-heading-size`, never `--jp-display` — but `invite` shipped `--text-display`, so the
   letter would have shrunk it 80 → 48px on seven pages. The test is **what the element ships on
   `dev`, not its tag name.** And porting to `.jp-sec__heading` moves `line-height` and
   `letter-spacing` too, so a Candlelit check that only diffs size reports a false match.
3. **A44 · card-scale text reads `--jp-body-size`, which EXISTS — do not derive your own.** Declared
   once in `journey-design.css`'s `:where(.jp-sec)`; measures **17 / 17 / 20 / 24px** across
   `restrained` / `balanced` / `expressive` / `monumental`. Guide bios and reel captions are exactly
   this scale. Need denser? Derive FROM the rung (`calc(var(--jp-body-size) / 1.2)`). Need a floor?
   Wrap it (`max(var(--text-lg), var(--jp-body-size))`). Never re-spell the clamp, never derive from
   `--jp-heading-size`.
4. **`--jp-accent-edge` fails the 3:1 graphic floor at EVERY accent value on a dark brand.** Measured
   independently by both round-3 worktrees on `of-blood-and-bones` dark: 1.27 at `glow`, 1.49 / 2.04 /
   2.04 at `text` / `fill` / `edge`. Use **`--jp-accent-mark`** for anything that must be SEEN — it
   measures 5.00 dark / 10.47 light. `--jp-accent-edge` is decorative-only until someone raises its
   mixes. And never carry a hardcoded percentage onto it (A37) — at `glow` it is already a 45% mix.
5. **A58 · the `--jp-display` rung is non-monotonic** — `type: expressive` renders a *smaller* display
   heading than `balanced`, because `--text-5xl` maxes below `--text-4xl`. Now `Codex-h3qpm`. Expect
   it; do not "fix" it locally.

Plus the three verification corrections that cost round 3 real time:

- **The public page redirects an entitled viewer to `/dashboard`.** The shared MCP browser carries a
  `creator@test.com` session, so `/journeys/<slug>` is only measurable in a **fresh, cookie-free
  context**. Add a `sectionCount === 0` guard that reloads once and re-measures — it caught a
  blank-render run in each worktree that would otherwise have been reported as real contrast.
- **`--jp-sec-pad-block` is 40px at 375**, 46.08 at 768, 82.56 at 1440. Corrects round 2's 22.5px.
  `airy` and `vast` **coincide** at 82.56 in a ~1376px container because the clamp's `6cqw` term
  dominates — correct, not a defect.
- **A53, third data point.** WT-1 at load average **44.45** (a sibling's vite up) saw 4 failed tests
  + 2 failed suites, every one a timeout in files it never touched; re-run in isolation, 61/61 green.
  The orchestrator's own full run with only the fleet up, at load **26**, saw zero timeouts in 27s.
  Confirmed load-dependent. Stop your vite, and **if you see a timeout in an untouched suite, re-run
  that file in isolation before reporting a failure — and report the load average.**

---

## Hard constraints — every one of these cost something

- **NEVER** `pnpm db:seed` or `pnpm db:reset` — they TRUNCATE. The safe pair is `pnpm db:local:gen` /
  **`pnpm db:local:migrate`** (note: **not** `db:migrate` — CLAUDE.md's name is stale, the root
  script does not exist). Inspect with `docker exec -i neon-postgres-1 psql -U postgres -d main`.
- **NEVER** a bare `pnpm test` from the repo root — `.env.test` points `DATABASE_URL` at the **dev**
  database and `cleanupDatabase()` deletes real rows (`Codex-bsbf8`). The gate is
  `pnpm --filter web test`. Put this in every subagent prompt.
- **NEVER** `pnpm dev` in a worktree; never kill a port belonging to a running worktree.
- **The gate is four commands, and `--force` is not optional:**
  ```
  pnpm check:ci
  pnpm --filter web check:brand-boundary && pnpm --filter web check:brand-boundary:test
  pnpm typecheck --force
  pnpm --filter web test
  ```
  A cached `FULL TURBO` is not a gate that ran. **Capture the real exit code** — `$?` after a pipe to
  `tail` measures `tail`. Redirect to a file and read `$?` on the next line. Then run
  `svelte-autofixer` (Svelte MCP) on every `.svelte` you changed; if you reject a suggestion, record
  the reasoning **in the file** (round 3 had two accepted rejections — a `performance.now()` rAF loop
  that cannot be `$derived`, and `a11y_no_noninteractive_tabindex` on a genuinely scrollable region).
- **i18n is single-owner (the orchestrator).** **27 keys now exist.** Worktrees **consume** and
  **report**. Never regenerate `src/paraglide/`. Editing `messages/en.json` is enough — the fleet's
  vite watches it and regenerates both files — then verify every key reaches BOTH
  `src/paraglide/messages/en.js` (git-tracked, force-added) and `src/paraglide/messages.js`
  (gitignored). paraglide-js is **1.11.8 with no plural support** — never ICU; use a separate `_one`
  key + a call-site ternary. **A62: a worktree citing an existing key quotes the `en.json` line, and
  the orchestrator greps every claimed key** — four of round 3's "already exists" claims were false.
- **Import boundary:** nothing under `$lib/page-builder` may import `$lib/components/page-builder`.
- **Closed files — do not edit in any worktree:** `section-catalog.ts`, `section-fields.ts`,
  `section-fields.test.ts`, `journey-design.css`, `journey-palette.css`,
  `journey-sections-shared.css`, `SectionRenderer.svelte`, `section-registry.ts`, `render/types.ts`,
  `coerce.ts`, `CtaLink.svelte`, `SectionSkeleton.svelte`, `JourneyRenderer.svelte`,
  `VariantPicker.svelte`, `SectionEditor.svelte`, `PageDesignPanel.svelte`,
  `DesignAxisControl.svelte`, all four barrels, `reveal.ts`, `safe-href.ts`, `brand-overrides.ts`,
  the store/save plumbing. **If a worktree needs one changed, it STOPS and REPORTS.**
- Design tokens only. Svelte 5 runes (`$props()` + typed `interface Props`), `$app/state` not
  `$app/stores`. `apps/web` has `strictNullChecks` **OFF** — use string discriminants, not
  boolean-literal ones. Currency GBP (£). No emoji in product UI.
- `prefers-reduced-motion` is inviolable: a `0.01ms` animation to a translated end state **still
  moves the element** — `--jp-reveal-distance` must resolve to `0` and keyframes must stop. **A40:
  invert continuous-motion fallbacks — the STATIC layout is the baseline.** WT-2 has autoplay
  ambience and will meet this.

## Verification — measured, not asserted (A10 + A24)

Before AND after, all six combinations (3 orgs × light/dark), for every text role touched. Canvas
`fillStyle` + `getImageData` with **`globalCompositeOperation = 'copy'`** — with the default
`source-over` a transparent parent composites onto the previous pixel and reads back **opaque**,
giving garbage ~1.0 ratios. (Use `source-over` **only** to composite a known translucent layer over a
known backdrop — the one place `copy` is wrong.) Resolve the effective background by walking
ancestors until alpha > 250 (`body` is transparent). Flip theme by setting **both** `data-theme` and
the `.dark` class. **Add a settle of 2× rAF plus ≥1200ms** (A46) — a 280ms settle produced a
4-point error that looked plausible.

**State the state you measured.** One element accumulated three ratios (1.78 / 4.45 / 1.13) because
three measurements caught the lit, post-fix and pre-lit states. The worst was the state SSR emits.

**Sanity-check your readings.** A blank screenshot with a healthy DOM means you measured a NEW tab —
discard those ratios (one such run reported 1.3 where the real value was 12.94).

**`studio-beta` has ZERO courses and ZERO landing pages** (A41, `Codex-jl17s`), so combinations 5/6
are unmeasurable on a real page for any type. Standard method: re-point
`--brand-color`/`--brand-color-dark`/`--color-brand-primary` to `#2563EB` on a served studio-alpha
page and **label the reading emulated** — faithful for this pair, which differs only by primary hue.
Round 3 cross-validated an emulated studio-alpha against the real one and got identical figures,
which is the check that licenses the method.

**A61 · tap targets:** measure the **pointer target** (the border box), and separately confirm no
*padding* is eating it. `--tap-target-min` is 44px and `box-sizing: border-box` yields a 44px border
box / 42px content box, so A10's original "content box inside any border" wording fails every journey
CTA by 2px against a WCAG rule that measures the pointer target. Measure at `density: compact`.

All three widths 375/768/1440 — measure by constraining `.jp-sec`'s inline size, since it IS the
container; that drives the container queries without resizing a shared window. **HTTP 200 is not "it
works."**

The browser is shared: each agent needs its own `isolatedContext` and must guard every
`evaluate_script` on `location.href`.

## Test data + surfaces

| org | brand | journey pages |
|---|---|---|
| `of-blood-and-bones` | cream `#F6EFE6` light / `#200000` dark, **distinct dark brand `#e1233b`**, accent `#ED8110`, Playfair | `pricing-smoke-test` (11 sections — the golden page, and the ONLY page with an `introVideo` or `reel`), `bone-deep`, `tending-the-grief`, `ancestral-threads`, `return-to-the-shoreline` |
| `studio-alpha` | `#E11D48`, no accent set | `bone-deep`, `tending-the-grief` (+ `proof`/`faq` from WT-5, + `turn`/`feel` from WT-1) |
| `studio-beta` | `#2563EB`, no accent set | **none** — measure by labelled brand substitution |

Password `Test1234!`; auth rate-limits at 5 logins / 15 min, so cache Playwright `storageState`.
`of-blood-and-bones`' owner is `luzura@test.com`; `creator@test.com` owns `studio-alpha`.
Public page `http://<org>.lvh.me:3000/journeys/<slug>` — **but a worktree uses its own port.**
Builder `/studio/journeys/[id]/page`. **The builder's `[id]` is the landing_page id, not the course
id**, and a `null` load spins on "Loading page…" forever (`Codex-b0fm6`, reproduced three times now).

## Orchestration pattern that worked

- One `Agent` per worktree, **max 2 concurrent**. Give each its exclusive file set and tell it to
  STOP and report rather than touch a shared file. Both round-3 worktrees respected this exactly.
- **The agent's final message IS its report** — say so explicitly, and specify the numbered report
  format you want. Round 3's two reports were complete and structured because the format was named
  in the prompt. (`SendMessage to: "main"` has been observed to queue and never arrive; do not rely
  on it.)
- **Verify the file:line pointers you hand down.** Before spawning, I checked every banked pointer
  against source and found one wrong — the brief claimed `invite.offers[]` was read in
  `InviteSection` via `asObjectArray` when it is read in `offer-paths.ts:146` as *decorations keyed
  by path id*, which changed WT-7's scope from "blocked on a missing editor" to "arrange real data".
  It cost five minutes and saved a wrong implementation.
- Tell them explicitly that **being corrected is wanted.** Round 3's worktrees between them found the
  A54 evaporating `box-shadow` (three rings painting nothing on every published page), disproved a
  three-round-old bead premise by reading two token expressions side by side, corrected the brief's
  raw-value attribution, corrected `04-contrast-baseline.md`'s primary-colour figure, and found a
  new `Codex-tqr51` instance the bridge table said did not exist. **Each was worth more than the
  code.**
- **Then verify their claims too.** WT-1 reported four i18n keys as pre-existing; none existed. Its
  components had no paraglide import at all. A grep took seconds.
- **Re-read the branch tip before merging** (A52). Round 3's handoff named `64023e03`; the real tip
  was `0107e85b`.
- After each worktree: merge, apply its reported shared fixes yourself, fold its lessons into
  `03-component-wp-brief.md`, add amendments to `02-axis-contract.md`, file beads for anything
  deferred, and **verify the merged result on the served page** rather than trusting the gate alone.

## After round 4 — consolidation

All 11 types will be done. What remains, and it is substantial:

- **The generic array control (A29) — the biggest single blocker.** `number`, `toggle`, `list` and
  `repeater` are declared with no editor UI, and `SectionEditor.svelte:78-81` writes `target.value`
  (a **string**) for every control except `media`. So `offers[]`, `inclusions[]`, `points[]`,
  `from`/`to` and `facts[]` cannot be authored at all, and **7 of WT-1's 18 compositions are
  markup-complete, test-pinned and unreachable from the builder.** Build it once.
- Repoint `JourneyBuilderCanvas` at the unified components and delete `render-edit/sections/*`
  (`Codex-eckbx`). Every worktree annotated its twin with a port map and deliberately did NOT drain
  it, because draining leaves the canvas previewing unstyled sections until this lands.
- The preset variant maps (A21/A29); the ~124 design-panel i18n keys (62 labels + 62 hints, A26).
- The section-less-pages-get-Signal migration (A25 — 678 of 695 rows have zero sections).
- `--jp-ember` theme-blindness (`Codex-8jve9`) + a full contrast re-sweep (`Codex-gkhro` — **every
  figure in `04-contrast-baseline.md` was taken with the short settle and is suspect**).
- Collapse WT-4's `--descent-signal` back onto `--jp-accent-mark` now A38 has landed.
- Audit all Playwright specs against the full diff for locator drift.
- Then **one PR to `dev`** (not `main`).

## Open beads from this programme

`Codex-tqr51` bridge copy loss — **4 of 7 types done; `introVideo`, `reel`, `guide` are round 4's**,
and they are the last three · `Codex-qcgo3` variant plumbing — **close condition MET and verified,
blocked only by `tqr51`; close it when round 4 lands** · `Codex-i9pzs` hardcoded editorial voice —
**2 renderers left, both WT-2's** · `Codex-eckbx` tree unification · `Codex-maf0y` placeholder copy —
**LIVE**, reproducible by adding any section in the builder · `Codex-wqxv4` media slots
(`reel.strip` descoped) · `Codex-490z7` a hero image can only be a video's poster frame ·
`Codex-wtfs1` the `items[]` repeater data-loss trap — **migrate before adding any repeater** ·
`Codex-6nb7i` inspector panels 2.52:1 · **`Codex-d01er` (P1)** the whole `--color-brand-accent`
chain, 76 consumers, needs its own WP + contrast sweep · **`Codex-g7ipk` (P1)** brand-painted
surfaces not consuming `--color-text-on-brand` — **note the comment I added: the programme docs
mis-filed the journey on-fill ratio under this bead from round 2 onward. That ratio is fixed; THIS
bead is untouched and has its own documented regression trap. Do not close it on journey work** ·
`Codex-8jve9` `--jp-ember` theme-blind · **`Codex-gkhro` (P1)** re-measure the contrast baseline ·
`Codex-jl17s` studio-beta needs a journey page · `Codex-b0fm6` builder infinite spinner ·
`Codex-scab9` the free-taste player is a visual mock, not real HLS · **NEW from round 3:**
`Codex-h3qpm` `--text-5xl` maxes below `--text-4xl` (P2) · `Codex-1khpv` the catalogue ships emoji
glyphs as section icons (P3) · `Codex-lfheu` the seeder writes a dead authored `price` prop (P3).

**CLOSED by round 3:** the journey on-fill ratio (`KNOWN_OPEN` is now empty and the 100 × 8 sweep is
green) · `Codex-8oznv` (`--jp-body-size`) · `Codex-pxxby` (`editAttrs` typing).

## The one risk to keep watching

**Candlelit has now been wrong twice, on two different axes, and both times nobody could tell until
an axis was consumed.** Round 2 found `width: narrow` was 12–24rem off on three of four sections
(fixed by 0088). Round 3 found the preset's own *variant* map disagreed with stored data on `invite`
(fixed by 0089), and that porting to the shared heading atom silently changes leading and tracking
(A59). The A3/D8 bet — that 695 rows were backfilled with a preset reproducing today's appearance —
has been checked for 8 of 11 types and corrected twice.

**Your three types are the last unchecked ones, and `reel`/`introVideo` are the most visually complex
in the tree.** Check all nine axes, plus leading and tracking. If Candlelit does not match,
**adjust the bundle and REPORT it — never edit page data.** A creator's stored design is their
content. The preset and the data are pinned to each other by `design-vocabulary.test.ts` precisely so
they cannot drift: if you change one you change both, or all 695 pages read as "Custom" in the picker.

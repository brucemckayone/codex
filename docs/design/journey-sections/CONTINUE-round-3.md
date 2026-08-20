# Journey sections — continuation prompt (round 3)

Paste this whole file as the first message of a new chat.

---

We're continuing a programme that makes the **course landing-page builder's section components
flexible enough to express many design languages**. You are the **orchestrator**: you hold the
decisions and the merges; subagent worktrees do the implementation. Round 0 (research + audit), the
five-stage foundation, round 1 (the hero pilot) and round 2 (social + map) are done and merged.
**Your job is round 3.**

Read the programme docs before doing anything — they are the accumulated state, and everything below
is a summary of them, not a replacement. **They are now committed on the integration branch**, so
they are in your worktree at `docs/design/journey-sections/`:

| Doc | What it is |
|---|---|
| `README.md` | Programme spine — decisions, worktree split, test data |
| `00-design-language-research.md` | 9 design families → the 9-axis model, 62 compositions, 8 presets |
| `01-component-audit.md` | Per-component dossier, `file:line` inventory |
| **`02-axis-contract.md`** | **THE BINDING SPEC — 53 amendments. Where anything disagrees, this wins** |
| **`03-component-wp-brief.md`** | **The checklist every worktree follows, incl. 9 pilot lessons + round 2's** |
| `04-contrast-baseline.md` | Measured contrast — **known-suspect, see `Codex-gkhro`** |
| `05-bridge-table.md` | Per-worktree `coerce.ts` changes + the hardcoded-voice inventory |

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

**Integration branch: `feat/journey-sections-foundation` @ `a67aacf6`**
in worktree `/Users/brucemckay/development/Codex-js-foundation`. Based on `dev@013e2d42`.
Not pushed. No PR. Working tree clean. **3 of 11 types done** (hero, proof, faq, map — 4 types).

```
a67aacf6  docs — WT-4's corrections to my own amendments
37626625  Candlelit's width becomes text, and the data moves with it
98dc0745  merge: WT-4's alpha-carried graphics fix
911bb5e0  docs — the programme docs + round 2's amendments
a8d6b35a  fix — round 2's shared findings (accent-mark, 10 map keys, OWED_READS)
11352aed  merge: WT-4 map
1f9770b1  merge: WT-5 social
359d0fc7  the WT-3 pilot's shared findings
```

**Gate on that HEAD, verified independently with REAL exit codes** (not `$?` after a pipe — that
measures `tail`): `check:ci` **0** (179 warnings, 0 errors) · both `check:brand-boundary` **0** ·
`pnpm typecheck --force` **0**, 57/57, **0 cached** · `pnpm --filter web test` **0**, **167 files /
1980 tests**. (`a67aacf6` is comment-and-markdown only, so only `check:ci` was re-run on it.)

**Migrations applied locally:** `0084` (design column + Candlelit backfill), `0085` (variant
collapse), `0086` (hero + signature media slots), `0087` (hero split-media → stage), **`0088`
(Candlelit `width` narrow → text, 695 rows)**.

### CRITICAL — where the dev stack runs (contract A23)

**The shared worker fleet runs from `/Users/brucemckay/development/Codex-js-foundation`**, serving
`lvh.me:3000` plus all nine worker ports. This is deliberate and must stay that way.

The read path is **web → `content-api` worker → `CourseJourneyService` (`packages/access`) →
Postgres**. Worker ports are fixed, so only ONE fleet can run. If the fleet serves a different
branch, a worktree's web app renders correctly-shaped HTML from a **stale callee**, and the symptom
is indistinguishable from a broken feature. **Check the callee port's cwd (`lsof -a -p <pid> -d cwd`),
not just vite's, before claiming any end-to-end verification.** Any change to a `packages/*` file
needs `pnpm --filter @codex/<pkg> build` — the workers consume the built `dist`.

**Do not merge into this branch while a worktree is mid-measurement** — its HEAD is the fleet's code.
Round 2 held both merges until both worktrees reported.

---

## ROUND 3 — what to do

Two worktrees **in parallel**, both cut from `a67aacf6`. Ports 3022/3023 are free.

| WT | Types | Owns exclusively | Port |
|---|---|---|---|
| **WT-1 · prose** | `ache`, `turn`, `feel` | `render/sections/{Ache,Turn,Feel}Section.svelte` (350 / 472 / 703) · `render-edit/sections/ProseSection.svelte` · `render-edit/journey-sections/_prose.css` (38) | 3022 |
| **WT-7 · invite** | `invite` | `render/sections/InviteSection.svelte` (532) · `render-edit/sections/InviteSection.svelte` · `render-edit/journey-sections/_invite.css` (48) | 3023 |

WT-1 is the largest WP in the programme (1525 lines across three types). WT-7 is the smallest but
**commerce-critical** — it is the surface a buyer decides from.

Worktree setup recipe (per worktree):
```bash
cd /Users/brucemckay/development/Codex
git worktree add -b feat/journey-sections-prose /Users/brucemckay/development/Codex-js-prose a67aacf6
for f in .env.dev .env.test .npmrc; do cp "$f" /Users/brucemckay/development/Codex-js-prose/; done
for d in workers/*/; do w=$(basename $d); for f in .dev.vars .dev.vars.test; do \
  [ -f "$d$f" ] && cp "$d$f" "/Users/brucemckay/development/Codex-js-prose/workers/$w/"; done; done
cd /Users/brucemckay/development/Codex-js-prose && pnpm install --prefer-offline \
  && pnpm build --filter='./packages/*'
```
Each worktree runs ONLY its web app: `pnpm --filter web exec vite dev --port 30NN --strictPort`.
`--strictPort` is mandatory — without it vite silently squats a neighbour's port.

### Each worktree's three stages (contract A9 — strict order)

1. **Wire the axes that APPLY.** Replace every hardcoded layout / rhythm / type / edge / surface /
   motion / media literal with the corresponding `--jp-*` read. Highest-leverage half by far.
   **`media` is conditional per type** (A50) — research §2.2 names the five types where it is
   meaningful (`hero`, `introVideo`, `reel`, `guide`, `proof`). `ache`/`turn`/`feel`/`invite` are not
   among them; check your read model and **do not invent a consumer to reach nine.** State which
   axes apply in your component header, citing §2.2.
2. **Verify the collapse.** `0085` already migrated stored data; confirm the *rendered result* is
   unchanged.
3. **Add the new compositions.** Port from the type's `_*.css` partial first (`A12`).

Stop at a **stage boundary** if you run out of room, never mid-stage.

Final composition sets (from `section-catalog.ts`, **closed — do not edit**):
- `ache` (6): `column` `statement` `paired` `list`* `quote`* `checklist`*
- `turn` (6): `statement` `column` `paired` `arc`* `before-after`* `numbered`*
- `feel` (6): `paired` `column` `statement` `grid`* `ledger`* `stack`*
- `invite` (6): `pool` `banner` `card` `tiers`* `table`* `sticky`*

`*` = new. `sticky` is continuous/pinned motion — see A40 below.

---

## Banked findings — these are theirs to fix

### WT-7 · invite — LIVE COPY LOSS ON THE COMMERCE SURFACE (verify first, then fix)

The code path is unambiguous; the DOM attribution needs your confirmation.

- `InviteSection:70` reads `asString(config, 'ctaLabel') ?? 'Join now'`. **The builder writes
  `button`.** `coerce.ts:212` declares `invite: { ctaLabel: ['ctaLabel','button'], priceNote:
  ['priceNote','risk'] }` — **F-A built the alias table and nothing consumes it.** `InviteSection`
  has 0 `aliasKeys` and 0 `asStringFrom` calls.
- **All 7 invite sections store a `button`**: `Get started` (golden page), `Begin` (the other 6).
  All 7 store a `risk` (`Start free · cancel anytime` / `Cancel anytime`). `"Join now"` appears **4×**
  in the served golden page.
- **Caution on the DOM evidence:** `Get started` *does* render once in a `variant="primary"` anchor
   — but the golden page has TWO sections storing `button: "Get started"`, told apart by their
  `accent`: `"LOVE IT "` is the **hero** (which the pilot already fixed) and `"is waiting."` is the
  invite. So confirm which element is which before claiming the loss; the orchestrator could not
  cleanly attribute it. This is the identical pattern to A13's confirmed `HeroSection` loss.
- The fix is inside YOUR file — `coerce.ts` is closed and already has what you need.
- Method note: `grep -c` counts **lines, not occurrences** and lies on minified HTML. Use
  `grep -o | wc -l`. Check whether a string is in a real element or only in the hydration payload —
  that is how map's loss hid.

Also WT-7's:
- `invite: ['accent']` is **your `OWED_READS` line** (`section-fields.test.ts:165`). All 7 pages
  store `accent: "is waiting."` and nothing reads it. **That file is SHARED — REPORT the line to
  delete, do not edit it.** It goes red once you wire the read; that is A28 working.
- **The `price` field is deleted, not bridged.** Do not reintroduce an authored price string in any
  composition. Prices come only from `JourneySalesContext.offer`, and every composition must degrade
  to a price-less CTA when `offer` is null (it is `.catch()`-guarded because the page is
  SEO-critical). Note 7 pages still *store* a `price` prop — ignore it, do not render it.
- `invite.offers[]` is consumed at `InviteSection:124` via `asObjectArray` with **no editor at all**,
  so it is permanently empty — and it is what `tiers`/`table` are meant to arrange. The generic array
  control is consolidation's job (A29); report what you need rather than building a bespoke one.
- `InviteSection:57` `'Begin the work.'` is voice-bearing (`Codex-i9pzs`). Fall back to **data** or
  **self-hide** — do NOT make it an i18n key. `InviteSection:70` `'Join now'` IS generic chrome and
  `journey_invite_cta_default` already exists — consume it.
- `InviteSection:510` has a raw-px media query (`640px`) → make it a `@container` query (A14).
- `sticky` is continuous/pinned motion: **make the static layout the baseline** (A40).

### WT-1 · prose — coverage is your biggest cost, and two sections carry protected overrides

- **`turn` and `feel` exist on exactly ONE page each** (`of-blood-and-bones/pricing-smoke-test`) and
  on **no `studio-alpha` page**. Same trap WT-5 hit. You have no brand-neutral fixture until you add
  them **through the builder UI** at `/studio/journeys/[id]/page`. `ache` is fine (8 sections).
- **DO NOT overwrite the two section-level `design` overrides.** The golden page's `turn` and `feel`
  both carry `{"align":"center","width":"narrow"}`. That is **0085's collapse output** — the prose
  `centered` variant was an axis-in-disguise and 0085 wrote the axes it encoded to preserve those
  sections' published appearance. Migration `0088` deliberately left them at `narrow` while moving
  the page to `text`, so they are the ONLY sections on that page still at 48rem. **That is correct.**
  Section-level design is a creator's content.
- **`ache` stores `variant: "default"` on SIX sections across BOTH orgs** (A49) — obb
  {`bone-deep`, `tending-the-grief`, `ancestral-threads`, `return-to-the-shoreline`} + studio-alpha
  {`bone-deep`, `tending-the-grief`}. `"default"` is not a declared ache variant. **LEAVE THEM.** It
  is genuine evidence that `resolveVariant` falls back safely, and F-A's schema cites it as the
  reason `variant` stays an open string. The round-2 brief said this was one section on one org; it
  is six.
- **`FeelSection` does not consume its bridge.** It reads `asString(config, 'eyebrow')` at `:43`
  while the builder writes `kicker`; `coerce.ts:208` declares the alias, unconsumed. 0 `asStringFrom`
  calls in the file. Its `heading`/`body` reads DO match what the builder writes.
- **`TurnSection` is CLEAN — do not "fix" it.** It already uses
  `asStringFrom(config, ['eyebrow','kicker'])`, `['statement','heading']`, `['lede','body']` inline
  at `:43-45`. That is why `turn` never showed the defect.
- `ache: ['points']` and `turn: ['from','to']` are **your `OWED_READS` lines**
  (`section-fields.test.ts:161-162`) — `points` powers the List/Checklist compositions, `from`/`to`
  the Before/after. **REPORT the lines; that file is shared.**
- `feel.inclusions[]` (`FeelSection:46`) and `turn.points[]` (`TurnSection:46`) are read via
  `asObjectArray`/`asStringArray` with **no editor**, so they are permanently empty — and they are
  central to those sections' purpose, not polish. `previewTitle` is the free-taste player's on/off
  switch and nothing can set it. Report; the generic array control is consolidation's (A29).
- `FeelSection` has 10 raw px/hex (A18). `AcheSection:*` `'The ache'`-class voice strings →
  data-fallback or self-hide, never an i18n key.

### Both worktrees also own
- `:focus-visible` on every interactive element; `edge: none`/`soft` must never remove the ring.
- Any inline `<svg>` → `Icon/*Icon.svelte` via `IconBase`. **A "typographic" glyph can still be an
  emoji** — U+25B6 carries emoji presentation on Apple platforms.
- Implementing `editable`/`onEdit` — **never via `EditableText`** (not SSR-safe; see below).
- **Verifying the Candlelit claim for their types.** Round 2 found `width` was wrong for every
  section; 0088 fixed it to `text`. If Candlelit still does not match, **adjust the bundle and REPORT
  it — never edit page data.**

---

## The measured lessons — in `03-component-wp-brief.md`, summarised

**From the hero pilot:**
1. Consume `--jp-sec-pad-block`/`-pad-inline`/`-gap`; don't re-spell the clamp. They contain `6cqw`
   and are declared on `.jp-sec`, so they **must be read on a descendant**.
2. `min-height` wants `min(100svh, calc(80svh * var(--jp-rhythm)))`, not the rhythm clamp.
3. Gate atmosphere with ONE `--jp-sec-atmos` declaration on the shared parent — a keyframe beats a
   `calc()` on the same element.
4. Never `--jp-accent-fill` for a small decorative mark (it is `transparent` on 2 of 5 values).
5. Divide `--jp-reveal-stagger` for anything staggering more than ~6 items.
6. `.jp-reveal` is scroll-triggered and doesn't fit an on-mount entrance.
7. `cqh` silently falls back to the viewport under `inline-size` containment. **`aspect-ratio` plus a
   definite cross-size is a blowout, not a constraint.**
8. **The contrast method needs a settle LONGER THAN THE LONGEST TRANSITION** — 2× rAF plus ~1200ms,
   not 260ms (A46). A 280ms settle produced a 4-point contrast error that looked plausible.
9. **Never import `EditableText` into `render/sections/*`** — not SSR-safe (it fills `textContent`
   from an action, and actions don't run during SSR). Use a spreadable `contenteditable` + `oninput`
   bag over real text children, and pin it with a test asserting the served markup contains real text.

**From round 2 — all measured:**
- **A36 · a section `<h2>` reads `--jp-heading-size`, NEVER `--jp-display`.** At `monumental`
  `--jp-heading-size` IS `--text-4xl` (48px) = what headings ship today; `--jp-display` is 80px, the
  hero's `h1`. Use `class="jp-sec__heading jp-sec__heading--sub"`. The shared-CSS comment now says so.
- **A37 · never carry a hardcoded mix percentage onto an axis token.** `--jp-accent-edge` at `glow`
  is already a 45% ember mix, so `26%` of it is ~12%. A ring regressed 3.32 → 1.62 this way.
- **A38 · `--jp-accent-mark` was FIXED** — its declarations contradicted its own comment. It now
  resolves to the AA-safe `--jp-ember-text`. Meaningful graphics owing 3:1 take `--jp-accent-text`.
- **A39 · no alpha low enough to READ as faint survives the dark pole.** Three measurements, two
  components, two different tokens: 55% → 2.53, 60% → 2.53, 45% → 2.05. Thresholds: over a tinted
  surface dark clears 3:1 only at **80%**; over the page at **70%**. Carry state on fill and
  border-*weight*, not opacity.
- **A40 · invert continuous-motion fallbacks — the STATIC layout is the baseline**, ticker inside
  `@media (prefers-reduced-motion: no-preference)`. Written the usual way, a marquee measured clean
  on every probe (distance 0, no running animation, `transform: none`) and **still parked 2 of 3
  items outside the clipped strip**, because `flex: none` blocked wrapping. An override-based
  fallback must remember every property the animation set. **`invite.sticky` needs this.**
- **A48 · `auto-fit` needs a FLEXIBLE max.** `minmax(min(16rem,100%), 24rem)` collapses to ONE track
  at 768px. Use `minmax(min(100%, 16rem), 1fr)`. Looks like a design choice, not a bug.
- **A53 · stop your vite before `pnpm --filter web test`.** WT-5 measured 30× (6384s vs 142s) and 7
  false failures in untouched suites; WT-4 measured 1.24× and zero. Load-dependent — **"it passed
  with vite up" is not evidence vite-up is safe.**
- **A52 · a report is a snapshot.** The orchestrator merged a reported SHA, gated green, and only
  then found a second commit with two real 3:1 fixes. Re-read the tip at merge time.
- **Verify what a token RESOLVES to, and verify the CLAIM about why.** Two agents asserted the
  descent spine was "shipping warning amber through a broken fallback." `BRAND_DEFAULT_ACCENT` is
  `#F59E0B` and `--color-warning` is `#f59e0b` — **the same colour** — so the amber was the
  platform's documented default, and `of-blood-and-bones` actually sets `#ED8110` in
  `branding_settings.accent_color_hex` (the other agent checked the wrong column). A plausible token
  name is not a plausible value, and "this looks like a bug" is not evidence it is one.
- **State the state you measured.** One element accumulated three contrast ratios (1.78 / 4.45 /
  1.13) because three measurements caught the lit, post-fix and pre-lit states. The worst was the
  state SSR actually emits.

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
  A cached `FULL TURBO` is not a gate that ran. **And capture the real exit code** — `$?` after a
  pipe to `tail` measures `tail`, not the command. Then run `svelte-autofixer` (Svelte MCP) on every
  `.svelte` you changed.
- **i18n is single-owner (the orchestrator).** 15 keys now exist: the five settled ones plus ten
  `journey_map_*`. Worktrees **consume** and **report**. Never regenerate `src/paraglide/`. The rule
  is really *exactly one process may, and `messages/en.json` is the source of truth* — the fleet's
  vite watches `en.json` and regenerates both files automatically, so editing `en.json` is enough;
  then verify key counts agree across `en.json`, `src/paraglide/messages/en.js` and
  `src/paraglide/messages.js`. Only `messages/en.js` is git-tracked (force-added). paraglide-js is
  **1.11.8 with no plural support** — never ICU; use a separate `_one` key + a call-site ternary.
- **Import boundary:** nothing under `$lib/page-builder` may import `$lib/components/page-builder`.
- **Closed files — do not edit in any worktree:** `section-catalog.ts`, `section-fields.ts`,
  `journey-design.css`, `journey-palette.css`, `journey-sections-shared.css`,
  `SectionRenderer.svelte`, `section-registry.ts`, `render/types.ts`, `coerce.ts`, `CtaLink.svelte`,
  `SectionSkeleton.svelte`, `JourneyRenderer.svelte`, `VariantPicker.svelte`, `SectionEditor.svelte`,
  `PageDesignPanel.svelte`, `DesignAxisControl.svelte`, all four barrels, `reveal.ts`,
  `safe-href.ts`, `brand-overrides.ts`, the store/save plumbing. **If a worktree needs one changed, it
  STOPS and REPORTS.**
- Design tokens only. Svelte 5 runes (`$props()` + typed `interface Props`), `$app/state` not
  `$app/stores`. `apps/web` has `strictNullChecks` **OFF** — use string discriminants, not
  boolean-literal ones. Currency GBP (£). No emoji in product UI.
- `prefers-reduced-motion` is inviolable: a `0.01ms` animation to a translated end state **still
  moves the element** — `--jp-reveal-distance` must resolve to `0` and keyframes must stop.

## Verification — measured, not asserted (A10 + A24)

Before AND after, all six combinations (3 orgs × light/dark), for every text role touched. Canvas
`fillStyle` + `getImageData` with **`globalCompositeOperation = 'copy'`** — with the default
`source-over` a transparent parent composites onto the previous pixel and reads back **opaque**,
giving garbage ~1.0 ratios. (Use `source-over` **only** to composite a known translucent layer over a
known backdrop — the one place `copy` is wrong.) Resolve the effective background by walking
ancestors until alpha > 250 (`body` is transparent). Flip theme by setting **both** `data-theme` and
the `.dark` class. **Add the ≥1200ms settle.**

**`studio-beta` has ZERO courses and ZERO landing pages** (A41, `Codex-jl17s`), so combinations 5/6
are unmeasurable on a real page for any type. Standard method: re-point
`--brand-color`/`--brand-color-dark`/`--color-brand-primary` to `#2563EB` on a served studio-alpha
page and **label the reading emulated** — faithful for this pair, which differs only by primary hue.

Tap targets at `density: compact` on the content box inside any border (or justify N/A, as `map` did:
`<article>` elements with no route to link to are not pointer targets). All three widths
375/768/1440 — measure by constraining `.jp-sec`'s inline size, since it IS the container; that drives
the container queries without resizing a shared window. **HTTP 200 is not "it works."**

The browser is shared: each agent needs its own `isolatedContext` and must guard every
`evaluate_script` on `location.href`.

## Test data + surfaces

| org | brand | journey pages |
|---|---|---|
| `of-blood-and-bones` | cream `#F6EFE6` light / `#200000` dark, **distinct dark brand `#e1233b`**, accent `#ED8110`, Playfair | `pricing-smoke-test` (11 sections — the golden page), `bone-deep`, `tending-the-grief`, `ancestral-threads`, `return-to-the-shoreline` |
| `studio-alpha` | `#E11D48`, no accent set | `bone-deep`, `tending-the-grief` (+ `proof`/`faq` added by WT-5) |
| `studio-beta` | `#2563EB`, no accent set | **none** — measure by labelled brand substitution |

Password `Test1234!`; auth rate-limits at 5 logins / 15 min, so cache Playwright `storageState`.
`of-blood-and-bones`' owner is `luzura@test.com`; `creator@test.com` owns `studio-alpha`.
Public page `http://<org>.lvh.me:3000/journeys/<slug>`; builder `/studio/journeys/[id]/page`.
**The builder's `[id]` is the landing_page id, not the course id**, and a `null` load spins on
"Loading page…" forever (`Codex-b0fm6`, reproduced twice).

## Orchestration pattern that worked

- One `Agent` per worktree, **max 2 concurrent**. Give each its exclusive file set and tell it to STOP
  and report rather than touch a shared file.
- **Require the report via `SendMessage`.** `to: "main"` was observed to only "queue for the main
  conversation's next turn" and never arrive; `to: "team-lead"` returns a confirming `msg_id`. Plain
  text turn-endings lost reports three times.
- Tell them explicitly that **being corrected is wanted.** Round 2's two worktrees between them
  refuted the orchestrator's `.descent__node` diagnosis, corrected an amendment that was too narrow,
  found a closed file contradicting its own comment, and corrected two figures in the baseline doc.
  Each was worth more than the code.
- **Verify independently.** Re-read the branch tip before merging, re-run the gate yourself, and
  check runtime behaviour rather than accepting a claim.
- After each worktree: merge, apply its reported shared fixes yourself, fold its lessons into
  `03-component-wp-brief.md`, add amendments to `02-axis-contract.md`, file beads for anything
  deferred.

## Remaining rounds

**Round 4:** (WT-2 video — `introVideo`/`reel`, hardest component at 935 lines, 18 px + 6 rgb/hex,
five blend layers, owns the `media: bleed` aspect↔scrim coupling; `reel.strip` is DESCOPED per A27)
+ (WT-6 guide — mostly data; **no page anywhere has a `guide` section**, and
`guidePortraitMediaId` lives inside the `guide` jsonb bag rather than being a real column).

**Consolidation:** repoint `JourneyBuilderCanvas` at the unified components and delete
`render-edit/sections/*` (`Codex-eckbx`); build the generic array control **once** (A29 — `number`,
`toggle`, `list`, `repeater` are declared with no editor UI, which is why `offers[]`/`inclusions[]`/
`points[]` are permanently empty); add the preset variant maps (A21/A29); the ~124 design-panel i18n
keys (62 labels + 62 hints, A26); the section-less-pages-get-Signal migration (A25 — 678 of 695 rows
have zero sections); `--jp-ember` theme-blindness + a contrast re-sweep (`Codex-8jve9` +
`Codex-gkhro`); collapse WT-4's `--descent-signal` back onto `--jp-accent-mark` now A38 has landed;
audit all Playwright specs against the full diff for locator drift; then **one PR to `dev`** (not
`main`).

## Open beads from this programme

`Codex-qcgo3` variant plumbing — stays open until a variant visibly changes a published page ·
`Codex-tqr51` bridge copy loss — hero + map halves closed, **invite and feel are round 3's** ·
`Codex-eckbx` tree unification · `Codex-maf0y` placeholder copy — **now LIVE**, reproducible by adding
any section in the builder · `Codex-i9pzs` hardcoded editorial voice, 4 renderers left ·
`Codex-wqxv4` media slots (`reel.strip` descoped) · `Codex-490z7` a hero image can only be a video's
poster frame · `Codex-wtfs1` the `items[]` repeater data-loss trap — **migrate before adding any
repeater** · `Codex-6nb7i` inspector panels 2.52:1 · **`Codex-d01er` (raised to P1)** the whole
`--color-brand-accent` chain: the default accent is expressed through `--color-warning`, and
`themes/{light,dark}.css` declare it with no `--brand-accent` indirection — **76 consumers**, needs its
own WP + contrast sweep, deliberately not fixed in a component round · `Codex-8jve9` `--jp-ember`
theme-blind (mark half fixed by A38) · **`Codex-gkhro` (P1)** re-measure `04-contrast-baseline.md` —
every figure taken with the short settle is suspect · **`Codex-jl17s`** studio-beta needs a journey
page · **`Codex-8oznv`** promote the `type` axis's third rung to `--jp-body-size` — two components
have derived it two different ways, and guide bios / map stage names / feel inclusions all need it ·
`Codex-b0fm6` builder infinite spinner · `Codex-g7ipk` on-brand ink — `studio-alpha` still fails at
4.43:1 because `#E11D48` is OKLCH L=0.5858, just under the 0.60 pivot; carried in
`journey-design.test.ts`'s `KNOWN_OPEN`, **written to FAIL if it ever stops failing**.

**Worth settling before round 3 starts:** `Codex-8oznv` (`--jp-body-size`). WT-1's three types and
WT-7's tier rows are all card-scale text, so all four will otherwise derive the rung a third and
fourth way. Also cheap: `Codex-9jqel`-class — type `editAttrs`' return as
`HTMLAttributes<HTMLElement>` from `svelte/elements`, which took `MapSection` to 0 svelte-check
errors and moved the repo 76/39 → 72/37.

## The one risk to keep watching

**Candlelit is now verified on `width` but not everywhere.** Round 2 found the preset's `width:
narrow` was 12–24rem off today's caps on three of four sections — the A3/D8 bet that 695 rows were
backfilled on, false on an axis nobody could check until an axis was consumed. Migration `0088` fixed
it to `text`. **Every remaining worktree must still check the other eight axes for its own type**, and
if Candlelit doesn't match, **adjust the bundle and report it — never edit page data.** A creator's
stored design is their content. Note the preset and the data are pinned to each other by
`design-vocabulary.test.ts` precisely so they cannot drift: if you change one, you change both, or all
695 pages read as "Custom" in the picker.

# Journey sections — continuation prompt (round 2)

Paste this whole file as the first message of a new chat.

---

We're continuing a programme that makes the **course landing-page builder's section components
flexible enough to express many design languages**. You are the **orchestrator**: you hold the
decisions and the merges; subagent worktrees do the implementation. Round 0 (research + audit), the
five-stage foundation, and round 1 (the hero pilot) are done and merged. **Your job is round 2.**

Read the six programme docs before doing anything — they are the accumulated state, and everything
below is a summary of them, not a replacement:

| Doc | What it is |
|---|---|
| `docs/design/journey-sections/README.md` | Programme spine — decisions, worktree split, test data |
| `00-design-language-research.md` | 9 design families → the 9-axis model, 62 compositions, 8 presets |
| `01-component-audit.md` | Per-component dossier, `file:line` inventory, disjoint-file analysis |
| **`02-axis-contract.md`** | **THE BINDING SPEC — 35 amendments. Where anything disagrees, this wins** |
| **`03-component-wp-brief.md`** | **The checklist every worktree follows, incl. the pilot's 9 measured lessons** |
| `04-contrast-baseline.md` | Measured contrast, both themes, with a correction |
| `05-bridge-table.md` | Per-worktree `coerce.ts` changes + the hardcoded-voice inventory |

## The shape of the thing

The builder wasn't restrictive by design — it was restrictive by a **wiring gap**. 37 variants were
declared, written by the picker, resolved by a helper, and then dropped, because `SectionRenderer`
never passed `variant` to the component. The layouts existed too, fully implemented in CSS, on the
wrong side of a tree split. So the model is:

- **`variant`** = *composition* (section-specific — 62 across 11 types)
- **`design`** = *treatment* (universal — 9 axes × 4–5 closed values = 39 CSS rules, forever)
- Axes: `width` `density` `surface` `edge` `align` `type` `accent` `motion` `media`
- Resolution per axis, first hit wins: `section.design[axis]` → `page.design[axis]` → axis default
- 8 named presets. **Candlelit** reproduces today's page; **Signal** is the recommended default

## Current state

**Integration branch: `feat/journey-sections-foundation` @ `359d0fc7`**
in worktree `/Users/brucemckay/development/Codex-js-foundation`. Based on `dev@013e2d42`.
Not pushed. No PR. Working tree clean.

```
359d0fc7  fix(journeys): the WT-3 pilot's shared findings
35d12496  merge: WT-3 hero
325c8898  WT-3 — hero reads all nine axes, six compositions
e10e8cc0  i18n — five settled journey fallback keys
5b583e29  F-D — hero + signature media slots
98b861a9  F-C — 62 compositions final + the collapse
69f2fb72  F-B2 — design column, write path, panel
d1c69754  F-B1 — 39 axis rules, two poles, CSS split
845086f0  F-A — contract + render seam
```

**Gate on that HEAD, verified independently (not taken on report):**
`check:ci` clean on 1430 files · both `check:brand-boundary` OK across 211 public files + 11/11 ·
`pnpm typecheck --force` **57/57, 0 cached** · `pnpm --filter web test` **164 files / 1889 tests**.

**Migrations applied locally:** `0084` (design column + Candlelit backfill, 696 rows), `0085` (variant
collapse, 22 retired ids), `0086` (hero + signature media slots), `0087` (hero split-media → stage).

### CRITICAL — where the dev stack runs (contract A23)

**The shared worker fleet runs from `/Users/brucemckay/development/Codex-js-foundation`**, serving
`lvh.me:3000` plus all nine worker ports. This is deliberate and it must stay that way.

The read path is **web → `content-api` worker → `CourseJourneyService` (`packages/access`) → Postgres**.
Worker ports are fixed, so only ONE fleet can run. If the fleet serves a different branch, a worktree's
web app renders correctly-shaped HTML from a **stale callee**, and the symptom is indistinguishable from
a broken feature. This cost real time before it was understood. **Check the callee port's cwd
(`lsof -a -p <pid> -d cwd`), not just vite's, before claiming any end-to-end verification.**

Corollary: any change to a `packages/*` file needs `pnpm --filter @codex/<pkg> build` — the workers
consume the built `dist`. A dist older than its source is the tell.

### Housekeeping you may want to do first

- `/Users/brucemckay/development/Codex-js-hero` (`feat/journey-sections-hero` @ `325c8898`) is **merged**
  and can be removed: `git worktree remove /Users/brucemckay/development/Codex-js-hero`.
- A vite is still running on **:3021** from that worktree — kill it before reusing the port.

---

## ROUND 2 — what to do

Two worktrees **in parallel**, both cut from `359d0fc7`. Round 1 was deliberately a single pilot
(contract A31) because nothing had wired an axis yet; that's now proven, so pairs resume.

| WT | Types | Owns exclusively | Port |
|---|---|---|---|
| **WT-5 · social** | `proof`, `faq` | `render/sections/ProofSection.svelte` (467) · `render/sections/FaqSection.svelte` (413) · `render-edit/sections/{Proof,Faq}Section.svelte` · `journey-sections/_proof.css` · `_faq.css` | 3022 |
| **WT-4 · map** | `map` | `render/sections/MapSection.svelte` (685) · `render-edit/sections/MapSection.svelte` · `journey-sections/_descent.css` | 3023 |

Worktree setup recipe (per worktree):
```bash
cd /Users/brucemckay/development/Codex
git worktree add -b feat/journey-sections-social /Users/brucemckay/development/Codex-js-social 359d0fc7
for f in .env.dev .env.test .npmrc; do cp "$f" /Users/brucemckay/development/Codex-js-social/; done
for d in workers/*/; do w=$(basename $d); for f in .dev.vars .dev.vars.test; do \
  [ -f "$d$f" ] && cp "$d$f" "/Users/brucemckay/development/Codex-js-social/workers/$w/"; done; done
cd /Users/brucemckay/development/Codex-js-social && pnpm install --prefer-offline \
  && pnpm build --filter='./packages/*'
```
Each worktree runs ONLY its web app: `pnpm --filter web exec vite dev --port 30NN --strictPort`.
`--strictPort` is mandatory — without it vite silently squats a neighbour's port.

### Each worktree's three stages (contract A9 — strict order)

1. **Wire all nine axes.** Replace every hardcoded layout / rhythm / type / edge / surface / motion /
   media literal with the corresponding `--jp-*` read. Highest-leverage half by far.
2. **Verify the collapse.** `0085` already migrated stored data; confirm the *rendered result* is
   unchanged.
3. **Add the new compositions.** Port from the type's `_*.css` partial first (`A12` — the layouts
   already exist); design only what's genuinely new.

Stop at a **stage boundary** if you run out of room, never mid-stage.

Final composition sets (from `section-catalog.ts`, finalised by F-C — **that file is closed, do not
edit it**):
- `proof` (6): `grid` `stack` `spotlight` `wall`* `marquee`* `pull`*
- `faq` (5): `accordion` `open` `boxed` `paired`* `grouped`*
- `map` (6): `spine` `rows` `cards` `table`* `timeline`* `numbered-prose`*

`*` = new. `marquee` **must** ship its reduced-motion static fallback in the same commit.

### Banked findings — these are theirs to fix

**WT-4 · map**
- `.descent__rn` measures **4.45:1 at 20px/400** against a 4.5 floor, and its effective background is
  `.descent__node` at **`rgb(56,21,17)` — identical in light AND dark**. The node surface doesn't follow
  the theme flip. The ratio is the symptom; the stale surface is the cause. This is the open half of
  `Codex-rvkmc`.
- Remove the 🔒 emoji (no emoji in product UI).
- 13 raw px/hex occurrences.
- Uses `--jp-accent-mark` for the spine and gate nodes — **not** `--jp-accent-fill`.
- `MapSection:534-537` re-declares `.sr-only` locally; use the global utility.
- `MapSection:72` `'Practice'` → `m.journey_map_practice_label()` (key exists).
- Bridge: `:47` `title` ← `heading`, `:49` `foot` ← `note`, via `aliasKeys('map', …)`.

**WT-5 · social**
- Both types are already fully bridged — **no `coerce.ts` changes needed.** The two cleanest components.
- **Do NOT add an `items[]` repeater** (`Codex-wtfs1`, contract A30). Both renderers *prefer* `items[]`
  and fall back to `q1/a1…`, so a repeater is a second authoring path that WINS: a creator opens a page
  authored as `q1/a1`, sees an empty repeater, adds one entry, and **the Q&As the page has been serving
  silently vanish**. Migration must come first, and it isn't in scope.
- `ProofSection:78` `'What the ground gives back.'` and `FaqSection:63` `'The honest answers.'` are
  voice-bearing (`Codex-i9pzs`) — fall back to **course data** or **self-hide**, do not make them keys.
- `InviteSection`-style accent dots use `--jp-accent-mark`.
- 9 (proof) + 5 (faq) raw px/hex.
- Owns the `proof` context-vs-authored precedence decision (`context.testimonials` vs authored `q1/n1/c1`).

### Both worktrees also own
- Their type's `OWED_READS` line in `section-fields.test.ts` — **that file is shared, so REPORT the line
  to delete, don't edit it.** `faq: g1-g3` is WT-5's. The test asserts each entry is still unread, so it
  goes red once you wire the read — that's contract A28 working, and you clear it at merge.
- `:focus-visible` on every interactive element.
- Any inline `<svg>` → `Icon/*Icon.svelte` via `IconBase`.
- Implementing `editable`/`onEdit` on their components — **but never via `EditableText`** (see below).

---

## The pilot's nine measured lessons — in `03-component-wp-brief.md`, summarised here

1. **Consume `--jp-sec-pad-block` / `-pad-inline` / `-gap`**; don't re-spell the clamp. They contain
   `6cqw` and are declared on `.jp-sec`, so they **must be read on a descendant** — an element is not
   its own query container.
2. **`min-height` needs its own shape:** `min(100svh, calc(80svh * var(--jp-rhythm)))`. Measured:
   compact 516 / regular 688 / **airy 860 = exactly today's 100svh** / vast capped.
3. **Gate atmosphere with ONE `--jp-sec-atmos` declaration on the shared parent**, not per layer as
   research §2.3 says — a keyframe beats a `calc()` on the same element.
4. **Never `--jp-accent-fill` for a small decorative mark** — it's `transparent` on 2 of 5 values.
   Use `--jp-accent-mark` (added after the pilot; real colour on all five).
5. **Divide `--jp-reveal-stagger`** for anything staggering more than ~6 items.
6. **`.jp-reveal` is scroll-triggered** and doesn't fit an on-mount entrance — drive your own keyframes
   from the four `--jp-reveal-*` properties.
7. **`cqh` silently falls back to the viewport** under `inline-size` containment. And **`aspect-ratio`
   plus a definite cross-size is a blowout, not a constraint** — it gave a 1658px panel inside a 458px
   column, cropped by `overflow: hidden` so it merely looked bland.
8. **The contrast method needs a settle** — 2× `requestAnimationFrame` + ~260ms after a theme flip, or
   `getComputedStyle` returns pre-flip values and every number is plausibly wrong.
9. **Never import `EditableText` into `render/sections/*`** — it is **not SSR-safe** (renders an empty
   element, fills `textContent` from an action, and actions don't run during SSR). Use a spreadable
   `contenteditable` + `oninput` bag over real text children. **This also blocks consolidation's plan to
   repoint the canvas at these components through it.**

Plus: **a stored value the renderer has been ignoring is not evidence of intent** (A33 — a seeded
`hero: split` nearly flipped seven live pages), and **the builder's `[id]` is the landing_page id, not
the course id**, with a `null` load spinning forever (`Codex-b0fm6`).

---

## Hard constraints — every one of these cost something

- **NEVER** `pnpm db:seed` or `pnpm db:reset` — they TRUNCATE. `pnpm db:generate` / `pnpm db:migrate` are
  the safe pair. Inspect with `docker exec -i neon-postgres-1 psql -U postgres -d main`.
- **NEVER** a bare `pnpm test` from the repo root — `.env.test` points `DATABASE_URL` at the **dev**
  database and `cleanupDatabase()` deletes real `organizations`/`content`/`purchases` rows
  (`Codex-bsbf8`). The gate is `pnpm --filter web test`. Put this in every subagent prompt; one agent was
  *instructed* to run the full suite and only avoided wiping the DB by reading the config instead of
  obeying.
- **NEVER** `pnpm dev` in a worktree; never kill a port belonging to a running worktree.
- **The gate is four commands, and `--force` is not optional:**
  ```
  pnpm check:ci
  pnpm --filter web check:brand-boundary && pnpm --filter web check:brand-boundary:test
  pnpm typecheck --force
  pnpm --filter web test
  ```
  A cached `FULL TURBO` is not a gate that ran. `pnpm build` + tests is not enough — neither typechecks.
- **i18n is single-owner (the orchestrator).** Five keys exist: `journey_hero_cta_default`,
  `journey_hero_cta_enrolled`, `journey_reel_tag_default`, `journey_invite_cta_default`,
  `journey_map_practice_label`. Worktrees **consume** them and **report** any others. Never regenerate
  `src/paraglide/` — two worktrees doing it strips keys → runtime 500s. paraglide-js is **1.11.8 with no
  plural support**: never ICU `{count, plural, …}`; use a separate `_one` key + a call-site ternary. New
  keys must land in `messages/en.json`, the force-tracked `src/paraglide/messages/en.js`, AND the
  generated `messages.js` barrel — and `git add` on that directory needs care, it's gitignored with one
  force-tracked file.
- **Import boundary:** nothing under `$lib/page-builder` may import `$lib/components/page-builder`.
- **Closed files — do not edit in any worktree:** `section-catalog.ts`, `section-fields.ts` (both
  finalised by F-C), `journey-design.css`, `journey-palette.css`, `journey-sections-shared.css`,
  `SectionRenderer.svelte`, `section-registry.ts`, `render/types.ts`, `coerce.ts`, `CtaLink.svelte`,
  `SectionSkeleton.svelte`, `JourneyRenderer.svelte`, `VariantPicker.svelte`, `SectionEditor.svelte`,
  `PageDesignPanel.svelte`, `DesignAxisControl.svelte`, all four barrels, `reveal.ts`, `safe-href.ts`,
  `brand-overrides.ts`, the store/save plumbing. **If a worktree needs one changed, it STOPS and
  REPORTS.** That's what kept round 1 conflict-free.
- Design tokens only. Svelte 5 runes (`$props()` + typed `interface Props`), `$app/state` not
  `$app/stores`. `apps/web` has `strictNullChecks` **OFF** — boolean-literal discriminants don't narrow,
  use string discriminants. Currency GBP (£). No emoji in product UI.
- `prefers-reduced-motion` is inviolable, and note a `0.01ms` animation to a translated end state
  **still moves the element** — `--jp-reveal-distance` must resolve to `0` and keyframes must stop, not
  merely accelerate.

## Verification — measured, not asserted (A10 + A24)

Before AND after, all six combinations (3 orgs × light/dark), for every text role touched. Canvas
`fillStyle` + `getImageData` with **`globalCompositeOperation = 'copy'`** — with the default `source-over`
a transparent parent composites onto the previous pixel and reads back **opaque**, giving garbage ~1.0
ratios. Resolve the effective background by walking ancestors until alpha > 250 (`body` is transparent
here). Flip theme by setting **both** `data-theme="dark"` and the `.dark` class. **Add the settle.**

Tap targets at `density: compact` on the content box inside any border. All three widths 375/768/1440 —
container-query scoping means a composition can be right at 1440 and broken at 375 independently.
**HTTP 200 is not "it works."**

The chrome-devtools/playwright browser is shared: each agent needs its own `isolatedContext` and must
guard every `evaluate_script` on `location.href`.

## Test data + surfaces

| org | brand | journey pages |
|---|---|---|
| `of-blood-and-bones` | cream `#F6EFE6` light / `#200000` dark, **distinct dark brand `#e1233b`**, Playfair | `pricing-smoke-test` (11 sections — the golden page), `bone-deep`, `tending-the-grief`, `ancestral-threads`, `return-to-the-shoreline` |
| `studio-alpha` | `#E11D48` | `bone-deep`, `tending-the-grief` (4 sections each) |
| `studio-beta` | `#2563EB` | **none** — too thin to seed; measure it by labelled brand substitution |

Password `Test1234!`; auth rate-limits at 5 logins / 15 min, so cache Playwright `storageState`.
`of-blood-and-bones`' owner is `luzura@test.com`; `creator@test.com` owns `studio-alpha`.
Public page `http://<org>.lvh.me:3000/journeys/<slug>`; builder `/studio/journeys/[id]/page`.

**No page anywhere has a `guide` section**, and coverage is patchy generally — add your type's section
**through the builder UI** (not SQL), which also exercises the real add-section path. Leave
`studio-alpha`'s `ache` section on its invalid `variant: "default"`: it's genuine evidence that
`resolveVariant` falls back safely, and F-A's schema cites it as the reason `variant` stays an open
string.

## Orchestration pattern that worked

- One `Agent` per worktree, **max 2 concurrent**. Give each its exclusive file set and tell it to STOP
  and report rather than touch a shared file.
- **Require the report via `SendMessage({to: "main", …})`.** Agents that ended their turn with plain text
  had their reports never arrive — three times. Verify independently anyway: re-run the gate yourself and
  check the runtime behaviour rather than accepting a claim.
- Tell them explicitly that **being corrected is wanted**. Every stage found something the contract had
  wrong, and each of those was worth more than the code.
- After each worktree: merge into the integration branch, apply its reported shared fixes yourself, fold
  its lessons into `03-component-wp-brief.md`, add amendments to `02-axis-contract.md`, and file beads
  for anything deferred.

## Remaining rounds

**Round 3:** (WT-1 prose — `ache`/`turn`/`feel`, largest at 1565 lines) + (WT-7 invite — commerce-critical).
**Round 4:** (WT-2 video — `introVideo`/`reel`, hardest component at 935 lines) + (WT-6 guide — mostly data).
**Consolidation:** repoint `JourneyBuilderCanvas` at the unified components and delete
`render-edit/sections/*` (`Codex-eckbx`); build the generic array control **once** (A29 — `number`,
`toggle`, `list`, `repeater` are declared but have no editor UI); add the preset variant maps (A21/A29 —
unblocked now the ids are stable); the ~100 design-panel i18n keys; the `section-less pages get Signal`
follow-up migration (A25); `--jp-ember` theme-blindness + a contrast re-sweep (`Codex-8jve9`); audit all
Playwright specs against the full diff for locator drift; then **one PR to `dev`** (not `main`).

## Open beads from this programme

`Codex-qcgo3` variant plumbing done, stays open until a variant visibly changes a published page ·
`Codex-tqr51` bridge, hero's confirmed loss closed, 6 types remain · `Codex-eckbx` tree unification
(consolidation) · `Codex-rvkmc` `--jp-faint` fixed, `.descent__rn` half is WT-4's · `Codex-maf0y`
placeholder copy — **latent, not live** (`createDefaultSections` has no callers) · `Codex-i9pzs`
hardcoded editorial voice, 7 renderers · `Codex-wqxv4` media slots (`reel.strip` descoped) ·
`Codex-490z7` hero image can only be a video poster · `Codex-wtfs1` the repeater data-loss trap ·
`Codex-6nb7i` inspector panels 2.52:1 · `Codex-d01er` `Badge variant="accent"` is warning-coloured ·
`Codex-8jve9` `--jp-ember` theme-blind · `Codex-b0fm6` builder infinite spinner · `Codex-g7ipk`
on-brand ink — note `studio-alpha` still fails at 4.43:1 even after that bead's prescribed fix, because
`#E11D48` is OKLCH L=0.5858, just under the 0.60 pivot; carried in `journey-design.test.ts`'s
`KNOWN_OPEN`, which is written to FAIL if it ever stops failing.

## The one risk to keep watching

**The Candlelit bet is only partly verified.** Every existing page was backfilled with that preset on
the research's assertion that it reproduces today's appearance. The hero pilot found it *mostly* holds —
three real deltas (leading 1.0 vs 1.25, tighter tracking, narrower measure), all judged correct and
accepted, none touched. **Every remaining worktree must check it for its own type**, and if it doesn't
match, **adjust the Candlelit bundle and report it — never edit page data.** A creator's stored design is
their content.

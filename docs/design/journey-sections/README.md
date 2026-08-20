# Journey section flexibility programme

**Goal.** Every section component in the course landing-page builder can express a wide range of
design languages, so a creator selling a brutalist tech course, a soft wellness programme, a
luxury workshop or a high-energy fitness challenge each gets a page that feels native to their
brand — without leaving the design-token system.

Today the builder is locked to exactly ONE aesthetic. This programme is an **expansion**, not a
replacement: the current candlelit/cinematic look survives as one preset among many, and is the
default for every already-published page.

**Status.** Round 0 complete. Foundation in progress on `feat/journey-sections-foundation`
(worktree `/Users/brucemckay/development/Codex-js-foundation`, off `dev@013e2d42`).

| Stage | Commit | State |
|---|---|---|
| F-A · contract + render seam | `845086f0` | **landed, verified** |
| F-B1 · axis CSS substrate | `d1c69754` | **landed, verified** |
| F-B2 · migration + builder controls | `69f2fb72` | **landed, verified** |
| F-C · catalogue + field sets, all 11 types | — | in flight |

### Why F-C exists (a plan correction)

`section-catalog.ts` (all 11 types' variants + defaults) and `section-fields.ts` (all 11 field sets) are
**single files holding every type**. Two parallel worktrees editing either one conflict, and the audit
said so explicitly: land the final variant set and field sets once, then nothing else edits them.

I nearly cut the first two component worktrees without noticing. Alternatives considered and rejected:
having the orchestrator apply catalogue changes between rounds (creates a round-trip — a worktree cannot
test a composition that is not declared), and accepting merge conflicts (the recorded *auto-merge
Frankenstein* failure mode, where sibling PRs silently combine both sides). Finishing both files once,
for all 11 types, removes the conflict and the round-trip together.

F-C also owns the **variant-collapse migration**, because that is one file mapping retired ids across
several types — the same conflict shape.

### Realistic remaining shape

Foundation took four stages. The component work is seven worktrees across four rounds, each needing
implement → verify → review → repair, plus a consolidation round. This is a multi-session programme, not
a single sitting. Everything needed to resume cold is in these six documents; the branch is
`feat/journey-sections-foundation` and the task list mirrors the rounds.

Gate on both landed stages, re-run independently by the orchestrator: `check:ci` clean,
`check:brand-boundary` OK across 210 public files + 11/11 tests, `pnpm typecheck --force` 57/57 with
**0 cached**, `pnpm --filter web test` 160 files / **1803 tests** passing.

**Note on the typecheck gate:** the first F-A run reported `57 cached — FULL TURBO` after a 1361-line
diff, which is exactly the shape of a gate that did not run. It turned out to be a legitimate replay of
the agent's own run, but `--force` is now mandatory at every gate for this reason.

### Verified landed behaviour

- **`variant` reaches the component** (`Codex-qcgo3` plumbing): 110 → 161 `data-jp-*` attributes in the
  served HTML; the golden page's stored `split` hero variant is observable for the first time. The bead
  stays open until a variant demonstrably changes the published page.
- **Duplicate anchors fixed** (`Codex-yxkj7`, closed): `id="ache"` 2 → 1; ids are now
  `hero, introVideo, ache, ache-2, …` with the first of each type keeping its type-named anchor so
  existing `#map`/`#invite` links still resolve.
- **`--jp-faint` AA fixed** (`Codex-rvkmc`, half): dark **4.11 → 5.38**, light 5.22 → 7.14, with
  `--jp-dim` separation held at 1.45×. The other half (`.descent__rn` / `.descent__node`) is a map
  defect, reassigned to WT-4.
- **Two-pole refactor live**: `--jp-pole-a`/`--jp-pole-b` both resolve in both themes; the dark branch
  re-points pole A and pole B follows. A test proves the ladder still resolves inside a doubly nested
  invert.

Docs: `00` research · `01` audit · `02` **axis contract (binding)** · `03` WP brief · `04` contrast
baseline · `05` bridge table.

---

## What is actually broken today

Established by reading the code, and corroborated by open beads:

| Finding | Bead | Evidence |
|---|---|---|
| `PageSection.variant` never reaches a live section component — all 37 declared variants are inert | `Codex-qcgo3` | `render/SectionRenderer.svelte` passes only `{ config, context }`; 8 of 11 public renderers never read `variant` |
| The builder writes prop keys the renderer never reads, on 7 of 11 types — authored copy is silently dropped | `Codex-tqr51` | `section-fields.ts` writes `kicker`/`sub`/`body`; `render/types.ts` declares `eyebrow`/`subheadline`/`beats` |
| Two divergent component trees — the studio canvas shows a different page than the one that publishes | `Codex-eckbx` | `render/sections/*` (12 files, 350–935 lines, `{config,context}`) vs `render-edit/sections/*` (8 files, 40–132 lines, `{props,variant,editable,onEdit,stages}`) |
| Journey muted/tertiary text below AA | `Codex-rvkmc` | `--jp-faint` is a 50% mix toward the page background |
| Seed placeholder copy is served to real visitors | `Codex-maf0y` | `section-catalog.ts` `defaultProps` |

The variant picker in the studio is therefore **decorative on the published page**. That single
fact is why the builder feels restrictive: the flexibility was declared but never wired.

The colour substrate, by contrast, is already right. `journey-palette.css` derives the whole
`--jp-*` ladder from `--brand-bg` via OKLCH relative colour with auto-contrast on both poles.
**Brand-flexibility is solved at the token level.** What is locked is composition, rhythm,
type-scale, edge treatment, surface treatment, motion and atmosphere — all hardcoded per section.

---

## Decisions (binding for every work package)

**D1 — Treatment is a new sibling field, not a `props` key.**
`PageSection` gains `design?: SectionDesign`. `props` stays authored *copy*; `design` is
*treatment*. Rationale: `props` is `Record<string, unknown>` and cannot be validated as a closed
enum; mixing copy and treatment makes the `Codex-tqr51` vocabulary audit permanently unresolvable;
and a page-level "look" needs to set treatment across all sections in one write, which a distinct
field makes trivial.

**D2 — Page-level design defaults, section-level overrides, resolved by CSS inheritance.**
The page carries a default `design`; a section sets only the axes it disagrees with. Implementation
is CSS custom-property inheritance — the page wrapper sets the axis properties, a section wrapper
re-points the ones it overrides. No JS merge, no per-token recomputation.

**D3 — Unify the two renderer trees behind ONE component set with an `editable` flag** (`Codex-eckbx`).
The richer public `render/sections/*` set is the survivor and gains the edit seam;
`render-edit/sections/*` is deleted. This is foundation work and is not optional: without it every
component work package does the work twice and the studio canvas keeps lying about what publishes.

**D4 — `variant` must reach the component** (`Codex-qcgo3`). `SectionRenderer` passes
`variant={resolveVariant(section)}`. Every declared variant id gets a real branch or is removed
from the catalogue — a declared-but-unimplemented variant is a lie in the UI.

**D5 — One prop vocabulary** (`Codex-tqr51`). The renderer's names win. A migration maps legacy
builder keys forward so stored drafts do not lose copy.

**D6 — Axis values are expressed in EXISTING tokens.** `--brand-density-scale`,
`--brand-radius-base` and `--brand-text-scale` already multiply the spacing/radius/type scales, so
density / edge / type-scale axes re-point those multipliers inside the section subtree and the
whole existing scale re-derives. A new token is allowed only when named and justified in the WP.

**D7 — Axes are `data-*` attributes on the section wrapper mapped to `--_*` private tokens in one
shared stylesheet.** No per-section bespoke CSS for a shared axis. A section that needs an axis to
mean something structurally different for it declares that in its own scoped CSS by consuming the
same `--_*` token differently.

**D8 — Today's look must be reproducible as one preset, and is the default for existing pages.**
Nothing already published may regress. A page with no `design` set renders exactly as it does now.

**D9 — `variant` is composition; `design` is treatment.** Composition is section-SPECIFIC (a hero
can be centred / left-editorial / split-media / full-bleed). Treatment is IDENTICAL across sections
(width, density, surface, edge, alignment, type-scale, motion, accent deployment). If a knob only
makes sense for one section type, it is a variant or a prop — not an axis.

**D10 — Accessibility floors are non-negotiable regardless of chosen design.** Minimum contrast,
minimum tap target, reduced-motion behaviour and minimum body size hold in every preset. A preset
that cannot meet them is a broken preset, not an accepted trade-off.

---

## Programme shape

```
Round 0  RESEARCH + AUDIT          2 read-only analysts, parallel          ← in flight
         → 00-design-language-research.md  (axis model + presets)
         → 01-component-audit.md           (per-component dossier + shared-file list)

Round 1  FOUNDATION                serial, ONE worktree, must land first
         Everything ≥2 component work packages would otherwise touch.

Round 2+ COMPONENTS                2 worktrees at a time, disjoint file sets
         One section type (or tight group) per worktree. Each worktree runs
         analyse → implement → verify → review → repair, then simplify + cleanup.

Round N  CONSOLIDATION             one integration branch
         Merge, gate, reconcile cross-section coherence, update the builder UI
         and the live page, then one PR to `dev`.
```

### Round 1 — foundation (serial)

| # | Work | Beads |
|---|---|---|
| F1 | `SectionDesign` contract: type in `@codex/shared-types` **and its barrel `index.ts`**, Zod schema in `@codex/validation`, page-level default field | — |
| F2 | Variant plumbing + tree unification onto one component set with `editable` | `Codex-qcgo3`, `Codex-eckbx` |
| F3 | Prop-vocabulary reconciliation + legacy-key forward migration | `Codex-tqr51` |
| F4 | The design-axis CSS substrate: `data-*` → `--_*` map, all axes, both themes, contrast-verified | — |
| F5 | `--jp-faint` AA fix — every section consumes it, so it cannot be fixed per-worktree | `Codex-rvkmc` |
| F6 | Minimal builder design panel + preset picker so the axes are drivable; full polish deferred to consolidation | — |

### Round 2+ — seven worktrees, four rounds

The grouping is **forced, not chosen** — the canvas tree shares one component across several types
(`ProseSection` serves ache/turn/feel; `VideoSection` serves introVideo/reel), and types that share a
variant set share an implementation. From audit §E.3:

| WT | Types | Owns exclusively | Why grouped |
|---|---|---|---|
| **WT-1 · prose** | `ache`, `turn`, `feel` | `AcheSection` (350) · `TurnSection` (472) · `FeelSection` (703) · `_prose.css` | One variant set serves three types. Largest by lines (1565). Owns `Codex-scab9` (Feel's fake player) |
| **WT-2 · video** | `introVideo`, `reel` | `IntroVideoSection` (441) + test · `ReelSection` (935) · `_video.css` | Share `VIDEO_VARIANTS`. Hardest component in the tree; owns the aspect↔scrim coupling. **Do not add a third type** |
| **WT-3 · hero** | `hero` | `HeroSection` (553) · `_hero.css` | Highest-visibility surface |
| **WT-4 · map** | `map` | `MapSection` (685) · `_descent.css` | Two coupled JS systems |
| **WT-5 · social** | `proof`, `faq` | `ProofSection` (467) · `FaqSection` (413) · `_proof.css` · `_faq.css` | The two cleanest types — both fully bridged, both a11y-sound. Lightest pair |
| **WT-6 · guide** | `guide` | `GuideSection` (452) · `_guide.css` | Mostly a *data* worktree; its contract need is pulled into foundation (A15) |
| **WT-7 · invite** | `invite` | `InviteSection` (532) · `_invite.css` · `offer-paths.ts` + test | Commerce-critical. Must preserve "authored price is never rendered" |

Round order — **the first round is a SINGLE pilot, not a pair** (contract A31): **WT-3 alone** →
(WT-5, WT-4) → (WT-1, WT-7) → (WT-2, WT-6) → consolidation.

Nothing has yet wired a single axis to a single component, so round one is the first real use of the
mechanism, not a polish round. Two worktrees hitting the same unknowns simultaneously would produce two
independent and possibly divergent answers — including on the **unverified Candlelit bet** — which I
would then reconcile at merge instead of deciding once. WT-3 (hero) is the right pilot: the richest
inventory of hardcoded locks and it exercises nearly every axis. What it learns is folded into the
remaining six briefs before they start.

Per worktree, in this order (contract A9): **wire all nine axes** → **collapse the axis-in-disguise
variants** with a stored-value migration → **add the new compositions**. Plus: clean that type's raw
`px`/hex violations (A18), measure contrast before and after in all six org × theme combinations, keep
tests green. Start by porting the type's existing canvas variant CSS (A12) — the layouts already
exist.

---

## Hard constraints — every one of these cost something previously

**Destructive commands.** Never `pnpm db:seed` or `pnpm db:reset` — they TRUNCATE. Never a bare
`pnpm test` from the repo root: `.env.test` points `DATABASE_URL` at the **dev** database and
`cleanupDatabase()` deletes `organizations` / `content` / `purchases` (`Codex-bsbf8`). The gate is
`pnpm --filter web test`. This goes in every subagent prompt.

**Gate on what CI actually runs.** `pnpm build` + `pnpm --filter web test` is not enough — neither
typechecks. Run `pnpm check:ci`, both `check:brand-boundary` gates, and `pnpm typecheck` before any
push.

**Import boundary.** `$lib/page-builder` is the CE-4-scanned `PUBLIC_LIB_ROOT`. Nothing under it
may import the studio editor UI (`$lib/components/page-builder`). The unified component set lives
under `$lib/page-builder` and takes its edit seam as a prop, never as an import.

**i18n is single-owner.** Two worktrees regenerating `src/paraglide/` strips keys → runtime 500s.
The orchestrator owns `messages/en.json`; worktrees report keys to add. paraglide-js 1.11.8 has NO
plural support — never ICU `{count, plural, …}`; use a separate `_one` key plus a call-site
ternary. Confirm new keys land in BOTH `src/paraglide/messages/en.js` and the `messages.js` barrel.

**Contrast must be measured, twice.** Before AND after, in all six combinations (3 orgs × 2
themes). Use a canvas `fillStyle` + `getImageData` readback — Chrome serialises `color-mix()` as
`oklab()` floats and a regex over `getComputedStyle` returns garbage ~1.0 ratios. Resolve the
effective background by walking ancestors until alpha > 250, because `body` is transparent here.

**HTTP 200 is not "it works."** Assert rendered output and persisted state.

**Dev servers.** One shared worker fleet from the main checkout (`pnpm dev`); each worktree runs
only the web app: `pnpm --filter web exec vite dev --port 30NN --strictPort`. `--strictPort` is
mandatory. Never let a subagent run `pnpm dev`.

**Shared browser.** The chrome-devtools MCP browser is shared. Each agent needs its own
`isolatedContext` and must guard every `evaluate_script` on `location.href`.

**e2e drift is the merge risk.** Before any PR, audit Playwright specs against the diff — changed
i18n *values* break `getByRole(…, { name })`.

**House rules.** Design tokens only, never hardcoded hex/px. Currency is GBP (£). No emoji in
product UI. Svelte 5 runes (`$props()` + `interface Props`), `$app/state` not `$app/stores`.
Every interactive element needs a `:focus-visible` rule (R14). Components rendering outside
`.org-layout` must not consume `[data-org-brand]`-only half-step spacing (R12).

---

## Test data

| org | `creator@test.com` | `admin@test.com` |
|---|---|---|
| `studio-alpha` (#E11D48) | owner | admin |
| `studio-beta` (#2563EB) | creator, NOT owner | owner |
| `of-blood-and-bones` | — | owner is `luzura@test.com` |

Password `Test1234!`. Auth rate-limits at 5 logins / 15 min — cache Playwright `storageState`.
`of-blood-and-bones` is the fully-branded org (cream `#F6EFE6` light / `#200000` dark, Playfair,
token + dark overrides) and the reference for "a real brand". `studio-alpha` vs `studio-beta` is
the brand-neutrality pair.

Surfaces: builder at `/studio/journeys/[id]/page`, published page at `/journeys/[journeySlug]`
(org subdomain — slug is in the hostname, never in the path).

### Verified state of the test data (2026-08-19)

| org | owner memberships | published content | courses | landing pages |
|---|---|---|---|---|
| `of-blood-and-bones` | 1 | 29 | 5 | 5 (one with 11 sections) |
| `studio-alpha` | 1 | 8 | **0** | **0** |
| `studio-beta` | 1 | 2 | **0** | **0** |

**The golden page** is `of-blood-and-bones` → `pricing-smoke-test` ("The Long Descent"): 11
sections, the only one with `brandOverrides` set. Verified rendering at
`http://of-blood-and-bones.lvh.me:3000/journeys/pricing-smoke-test` → HTTP 200, 362 KB, sections
`hero, introVideo, ache ×2, turn, reel, map, feel, proof, faq, invite`. Note `guide` is absent from
this page, so guide work needs a section added or a second page.

**The brand-neutrality gap.** Neither `studio-alpha` nor `studio-beta` has any course or landing
page, so "does this design work on a different brand" is currently unverifiable. Fix before the
component rounds by seeding portals into `studio-alpha`:

```
pnpm --filter @codex/database db:seed:portals -- --org=studio-alpha
```

`seed-portals.ts` is verified SAFE and additive: its only `TRUNCATE` references are in the header
comment describing what `db:seed` does (the script to avoid), and its single `.delete()`
(line 742) is scoped to `practice_completions` for idempotent progress reconciliation. It is
idempotent — an existing portal slug is left alone. `studio-beta` has only 2 published content
items, too thin for four portals with distinct practices, so `studio-alpha` (8 items) is the
neutral-brand target.

### One row in `landing_pages.design` deliberately does NOT hold Candlelit

F-B2 measured 695 rows immediately post-migration; I measured 696 afterwards. The difference is
accounted for: the 696th is a probe page F-B2 created to verify the Signal-on-creation write (A21),
titled `FB2 design default probe` on `studio-alpha`, **soft-deleted** along with its subject course
(`where title like 'FB2 design%' and deleted_at is null` → 0).

It therefore holds **Signal, not Candlelit**, and is the one row that will not match the backfill bundle
in any future audit of that column. Left in place deliberately: the platform rule is soft-delete only,
never hard-delete, and the migration's predicate treats soft-deleted rows as in scope on purpose (a
soft-deleted page can be restored). Nothing else on the dev database was written — `studio-alpha` /
`bone-deep` was the round-trip subject and psql confirms its `design` equals the backfill bundle exactly.

### `landing_pages` columns (verified)

`id, organization_id, creator_id, page_type, slug, title, status, published_at, featured,
sort_order, subject_type, subject_id, brand_overrides jsonb, sections jsonb, offer jsonb,
created_at, updated_at, deleted_at`.

There is **no `design` column** — F1 adds one via `pnpm db:generate` (never hand-written SQL).
Page-level design must NOT ride in `brand_overrides`: that type is compile-time mirrored against
the brand editor's `BrandEditorState` by the drift guard in `brand-overrides-guard.ts`, so adding a
key there would force a matching brand-editor key. There is also no `seo` column (bead
`Codex-2j8nq`), which is out of scope here.

### Defect found while establishing the baseline

`Codex-yxkj7` (P1) — `SectionRenderer` uses the section TYPE as the DOM id, so the golden page
already serves two `<section id="ache">`. Fixed in F2, which rewrites that component anyway.

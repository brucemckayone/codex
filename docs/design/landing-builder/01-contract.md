# 01 — Page kit contract (BINDING)

**Status: BINDING from 2026-09-26.** Every work package (WP) in `README.md` builds against this
document. Where code and this document disagree, stop and report — do not improvise. Amendments are
appended in §10 with a date and a reason; nothing is edited silently.

This supersedes `docs/design/journey-sections/*` (the nine-axis programme) for all new work. Those
documents stay as history; do not read them for guidance except where this contract points at them.

Owner decisions this contract encodes (2026-09-26):

1. **Style + layouts + colour schemes.** A page picks ONE Style. Each section picks one of 2–4
   hand-designed layouts, one of five brand-derived colour schemes, and a spacing size. The nine
   design axes, the eight "looks" and the 63 compositions are retired. Existing pages auto-migrate.
2. **Default Style = Bold** — oversized display type, full-bleed colour bands.
3. **Canvas-first editor** with autosave.
4. **Full programme, at most two agents at a time.**

---

## 1. Principles (apply to every WP)

- **Every reachable combination is designed.** Style × layout × scheme × spacing is small enough
  (4 × ~3 × 5 × 3 per type) that each must look intentional. If a combination looks broken, that is
  a defect — never "the creator shouldn't pick that".
- **Brand in, brand out.** Colour, type and shape come ONLY from the org brand tokens (plus a page's
  own brand overrides). No hardcoded colours, families, sizes, radii, durations or z-indexes — use
  `var(--space-*)`, `var(--text-*)`, `var(--radius-*)`, `var(--duration-*)`, `var(--color-*)`,
  `var(--font-heading)`/`var(--font-body)` and the kit's `--lp-*` tokens. Never faux-bold a
  single-weight display face (Archivo Black ships one weight): express emphasis with size, case,
  tracking and leading, not `font-weight` on headings.
- **Plain words.** Creator-facing text is sentence case and names what a thing does. No "surface",
  "density", "accent glow", "composition", "monumental". Section types have plain names (§2).
- **Layouts arrange; they never censor.** A layout may position, size and re-order content. It must
  not hide a field the creator filled. If a layout genuinely cannot show a field, the inspector hides
  that field for that layout (`BlockField.layouts`) — the block does not silently drop it.
- **No borrowed copy.** A block renders only its own props. No block falls back to another section's
  text (the legacy ache section echoed the hero sub-line). The one sanctioned fallback: an empty hero
  heading renders the course title.
- **Every page state has a next step.** Buyable → a CTA to checkout. Enrolled → "Continue". Not open
  for enrolment → an explicit notice where the CTA would be. A sales page is never CTA-less and silent.
- **Honest offer copy.** Price and cadence come only from the live offer (`context.offer`). A note
  under a one-off price never says "Cancel anytime"; unauthored notes are derived from the path kind.
- **Avoid the generic tells.** No ALL-CAPS eyebrow over every heading (eyebrows are optional and empty
  in starters; when used they are sentence case, styled per Style). No middle-dot meta strings as
  decoration. Numbered markers only for real sequences (the curriculum is one). No single-word italic
  "accent" in headlines. Cards are transparent by default; only a featured card carries a fill. Brand
  colour is for CTAs and the `brand` scheme, not for passive decoration.
- **Motion is one moment.** Each Style has ONE orchestrated hero entrance. Sections do not each fade
  in on scroll. Motion tokens only; `prefers-reduced-motion` renders the final state; no-JS renders
  the final state (hidden-until-revealed only via a class added from JS).
- **Accessibility floor.** WCAG 2.2 AA: text contrast ≥ 4.5:1 (≥ 3:1 for ≥ 24px display text and for
  UI boundaries) on EVERY scheme in BOTH themes, for every brand in the test matrix; 44px targets
  (`--tap-target-min`); `:focus-visible` on every interactive element (R14); exactly one `<h1>`;
  landmarks and heading order intact; media has alt text or is marked decorative.
- **Small files.** A block component should land under ~450 lines including styles. Comments explain
  non-obvious *why* only — this codebase's legacy blocks are 60% `<style>`, half of it prose.

---

## 2. Vocabulary — `apps/web/src/lib/page-builder/kit/model/ids.ts`

`ids.ts` and `types.ts` are the code form of this section. **Neither may be edited by a WP agent**
(hand off to the orchestrator). The validation twin lives in `packages/validation`.

| Type id | Creator label | Layouts (first = fallback) | Replaces legacy | Live data |
|---|---|---|---|---|
| `hero` | Hero | `statement` `split` `cover` `centered` | `hero` | hero still / clip |
| `video` | Video | `theatre` `split` | `introVideo` | intro clip |
| `problem` | The problem | `statement` `list` `split` | `ache` | — |
| `transformation` | Before and after | `columns` `steps` `statement` | `turn` | — |
| `benefits` | What's included | `grid` `checklist` `split` | `feel` | — |
| `curriculum` | Curriculum | `timeline` `accordion` `cards` | `map` | stages + practices |
| `preview` | Sneak peek | `feature` `split` | `reel` | preview clip |
| `instructor` | About you | `split` `quote` `centered` | `guide` | guide portrait / clip |
| `testimonials` | Testimonials | `grid` `featured` `quote` | `proof` | testimonials |
| `faq` | Questions | `accordion` `columns` | `faq` | — |
| `pricing` | Pricing | `cards` `focus` `band` | `invite` | offer paths |
| `cta` | Call to action | `band` `split` `compact` | — (new) | primary CTA |
| `stats` | Numbers | `row` `grid` | — (new) | curriculum counts |
| `text` | Text | `statement` `columns` `centered` | — (new) | — |

Styles: `bold` (default) · `clean` · `soft` · `cinematic`. Schemes: `base` · `soft` · `contrast` ·
`brand` · `accent`. Spacing: `compact` · `regular` (default) · `spacious`.

### v2 props per type (the ONLY keys a block reads)

Common: `eyebrow?` (short label, optional), `heading?`, `body?` (plain text; blank line = new
paragraph), `ctaLabel?`, `note?` (small reassurance under a CTA).

| Type | Keys beyond the common set |
|---|---|
| hero | `secondaryLabel?`, `secondaryHref?`, `media?: 'auto'\|'image'\|'video'\|'none'`, `watchLabel?` |
| video | `caption?` |
| problem | `points?: string[]` |
| transformation | `beforeLabel?`, `afterLabel?`, `before?: string[]`, `after?: string[]` |
| benefits | `items?: { title: string; detail?: string }[]` |
| curriculum | — (stages are live) |
| preview | `caption?` |
| instructor | `name?`, `role?`, `credentials?: string[]`, `quote?` |
| testimonials | `items?: { quote: string; name?: string; detail?: string }[]` (merged after live testimonials) |
| faq | `items?: { question: string; answer: string }[]`, `contactLabel?`, `contactHref?` |
| pricing | `offers?: { id: string; name?: string; blurb?: string; bullets?: string[]; best?: boolean }[]` — decorations of live paths only; never a price |
| cta | — |
| stats | `items?: { value: string; label: string }[]`, `live?: boolean` (derive from curriculum) |
| text | — |

---

## 3. Data, resolution and upgrade

**Envelope (unchanged columns):** `landing_pages.sections[] = { id, type, enabled, variant?, name?,
design?, props }`; `variant` holds the layout id; `design` holds `SectionStyle { scheme?, spacing? }`;
`landing_pages.design` holds `PageDesign { style? }`.

**Resolution** (`kit/model/resolve.ts`, WP2):

- layout = `section.variant` if valid for the type → `STYLES[style].layouts[type]` → first layout.
- scheme = `section.design.scheme` → `STYLES[style].schemes[type]` → `'base'`.
- spacing = `section.design.spacing` → `'regular'`.
- style = `page.design.style` → `'bold'`.

Unset values resolve from the Style, so **changing the Style re-composes the whole page**; a value the
creator picked stays put.

**Upgrade** (`kit/model/upgrade.ts`, WP1). A pure, total, idempotent function
`upgradePage({ design, sections }) → KitPage`:

- `upgradePage(upgradePage(x))` deep-equals `upgradePage(x)`; v2 input passes through (invalid ids
  coerced to absent).
- Type map per §2. Unknown legacy types are dropped.
- Legacy `variant` → nearest v2 layout, legacy `design` axes → `SectionStyle` (`surface: invert` →
  `contrast`; `tint`/`panel` → `soft`; `density: compact` → `compact`, `regular` → `regular`,
  `airy`/`vast` → `spacious`; everything else → absent). The complete tables live in Appendix A and
  are written by WP1 from the legacy catalogue's own descriptions.
- Legacy page look → Style: Candlelit → `cinematic`; Quiet Studio, The Long Read, Plain Facts,
  The Syllabus → `clean`; Open Air → `soft`; Full Send, Signal, unrecognised → `bold`. A look is
  recognised by matching the page's axis values against the preset table in
  `components/page-builder/design-vocabulary.ts`.
- Props are mapped to the v2 keys, reading EVERY historical alias the legacy coercers in
  `render/coerce.ts` accept. A prop whose value equals the legacy catalogue's seed default for that
  key is dropped — it was never authored (this is what removes the stray "Cancel anytime").
- Where applied: WP6 wires it at the public load choke point, WP9 at the builder load. The server
  stays vocabulary-agnostic on reads; it validates writes (v2 keys added by WP1, legacy keys pruned by
  WP9). Legacy rows are rewritten to v2 on their next save.

---

## 4. Styles — `kit/model/styles.ts` + `kit/styles/style-<id>.css` (WP2)

Each Style is a complete design system scoped to `.lp[data-lp-style='<id>']`. It sets the `--lp-*`
type, shape, rhythm and motion tokens, the per-type default layouts and schemes, and how the five
schemes are recipe'd. The numbers below are starting points for the design lead (WP2), who may tune
them and must record the final values in §10.

| | Bold (default) | Clean | Soft | Cinematic |
|---|---|---|---|---|
| Identity | The headline IS the hero. Oversized type, tight leading, full-bleed colour bands, hard edges. | Image-led and crisp. Confident type, generous air, alternating base/soft bands. | Rounded, tinted, calm. Warm surfaces, pill shapes, gentle rhythm. | Dark and immersive. Full-bleed media, luminous type, brand-tinted glow. |
| Display size (container-relative) | largest (~8.5rem max) | ~5.5rem max | ~4.75rem max | ~7rem max |
| Heading leading / tracking | 0.9 / tight | 1.02 / slight | 1.08 / normal | 0.98 / slight |
| Radius | ≤ `--radius-sm` (hard) | brand radius | ≥ `--radius-xl` (soft) | brand radius |
| Buttons | large, rectangular, solid | brand radius, solid | pill, solid | pill; solid primary + ghost secondary |
| Media | full-bleed, square corners | rounded to brand radius | large radius / soft mask | full-bleed with scrim |
| Default hero layout | `statement` | `split` | `centered` | `cover` |
| Default pricing layout | `focus` | `cards` | `cards` | `focus` |
| Scheme rhythm | alternating base / brand / contrast bands | base / soft | soft / base | dark base, `soft` lifted |
| Hero entrance | headline lines rise with a short stagger | media + copy settle | soft fade | media slow-reveal behind copy |

**Cinematic is dark by identity**: its `base` resolves dark in both themes. This is the one documented
exception to "respect the theme" and applies only to a page whose creator chose Cinematic. Every other
Style follows the viewer's light/dark theme.

**No second WebGL canvas.** Atmosphere is CSS: the brand mesh-gradient recipe from `SubscribeCTA`
(`color-mix(brand, white)` glows, compositor-only drift) — never `color-mix(brand, transparent)` over a
dark veil, which vanishes on dark brands.

---

## 5. Colour schemes — `kit/styles/schemes.css` (WP2)

A section sets `data-lp-scheme`; the scheme sets exactly these tokens, which are the ONLY colour
tokens a block may read (plus `--lp-media-scrim` where media is involved):

| Token | Role | Contrast floor |
|---|---|---|
| `--lp-bg` | section background | — |
| `--lp-ink` | headings, body | ≥ 4.5 vs `--lp-bg` |
| `--lp-ink-soft` | secondary text | ≥ 4.5 vs `--lp-bg` |
| `--lp-line` | rules, borders | ≥ 3 vs `--lp-bg` when it bounds a control; else decorative |
| `--lp-panel` / `--lp-panel-ink` | the one featured card / panel | ink ≥ 4.5 vs panel |
| `--lp-accent` | links, highlights, markers | ≥ 3 vs `--lp-bg` (≥ 4.5 if used as text) |
| `--lp-button-bg` / `--lp-button-ink` / `--lp-button-line` | primary CTA | ink ≥ 4.5 vs bg; bg ≥ 3 vs `--lp-bg` |
| `--lp-focus` | focus ring | ≥ 3 vs `--lp-bg` |

Recipes (Styles may re-recipe): `base` = the page background (theme-aware); `soft` = base nudged a few
lightness points toward the brand hue; `contrast` = the inverse pole (dark in light theme, light in
dark theme); `brand` = `--color-brand-primary` fill, button inverted; `accent` = brand secondary (fall
back to accent, then a hue-shifted primary). Ink is auto-contrasted from the background with OKLCH
relative colour — reuse the proven formulas in `lib/page-builder/journey-palette.css` and the
fallback-chain lessons in `lib/styles/tokens/org-brand.css`. **Test the floors executably** across a
brand matrix (at least: pale, mid-saturated, very dark and very light brand colours; light and dark
theme), the way `journey-palette.test.ts` does.

---

## 6. Rendering — `apps/web/src/lib/page-builder/kit/` (WP2 unless noted)

```
kit/
  index.ts                      public barrel
  PageRenderer.svelte           root: .lp[data-lp-style] (+ page brand overrides), loops sections
  SectionShell.svelte           <section class="lp-section" id data-lp-type/-layout/-scheme/-spacing>
  StickyCta.svelte              the floating CTA (redesigned)
  registry.ts                   type → { definition, component } for all 14 types
  model/ ids.ts types.ts (orchestrator-owned) · styles.ts resolve.ts cta.ts template.ts shape.ts
         upgrade.ts + legacy maps (WP1)
  styles/ kit.css schemes.css style-bold.css style-clean.css style-soft.css style-cinematic.css
  primitives/ Heading Text Eyebrow Button ButtonRow Media List Notice …
  blocks/<type>/ definition.ts  <Type>Block.svelte  <Type>Block.svelte.test.ts
```

- `PageRenderer` props: `page: KitPage`, `context: JourneySalesContext`, `edit?: { commit(sectionId,
  key, value) }`, `selectedId?`, and whatever the canvas needs to draw selection — the PUBLIC markup
  must be identical with and without `edit` apart from editable attributes.
- `SectionShell` owns: anchor id, scheme/spacing/layout/type data attributes, the container
  (`--lp-container`, `--lp-measure`), `container-type: inline-size` (blocks respond with `@container`,
  not viewport media queries), and the section's background.
- Page brand overrides keep today's mechanism: `render/brand-overrides.ts` → a nested
  `[data-org-brand]` with inline `--brand-*` vars.
- Inline editing keeps today's seam: primitives spread `editFieldAttrs(type, key, !!edit, commit)`
  from `render/editable.ts`. Only `text`/`textarea` fields marked `inline` are editable on canvas.
- `model/cta.ts`: `resolvePrimaryCta(context, label?)` → `{ state: 'buy' | 'continue' |
  'unavailable', href?, label }`; every CTA in every block goes through it and through
  `render/safe-href.ts`.
- `model/shape.ts`: page-shape validation for publish (one hero, first section is a hero, a reachable
  CTA when buyable) — the v2 successor of `validatePageShape`.
- `model/template.ts`: the starter page for a new journey page, per Style.
- The catalogue is an aggregator only. `registry.ts` imports each `blocks/<type>/definition.ts` and
  component; WP2 creates ALL 14 folders (flagship blocks real, the rest minimal stubs), so later WPs
  edit only inside their own folders.

---

## 7. Editor — `apps/web/src/lib/components/page-builder/editor/` (WP7, WP8)

- **Shell:** top bar (back to Portals · page title · status chip · device switch Desktop/Tablet/Mobile
  · undo/redo · save state · Preview · Publish) → slim left outline → canvas → right inspector.
  Tabs collapse to **Page · Style · Offer · Settings** (Offer reuses `PagePricingPanel`, Settings
  reuses `PageMediaPanel` + `PageSeoPanel` + slug).
- **Canvas at true scale:** the page renders at the real available width (Desktop = fill,
  Tablet = 820px, Mobile = 390px frames). Container queries make it lay out as it would at that width.
  No scaling to 50%.
- **Selection:** clicking a section selects it (outline highlight + inspector); text marked `inline`
  is edited in place; '+' insertion points between sections open the section gallery.
- **Inspector (section):** Layout picker with real mini-renders of THIS section's content in each
  layout · Colour: five swatches rendered in the page's actual scheme colours · Spacing S/M/L ·
  content fields from `definition.fields` (lists and items with add/remove/reorder) · media slot
  pickers · duplicate/hide/delete.
- **Inspector (page / Style tab):** the four Styles as live thumbnails of this page's hero; page brand
  overrides (primary + secondary colour, heading + body font) reusing brand-editor pickers, with
  "Use organisation brand" reset.
- **Section gallery:** grouped by `definition.group`, each type shown as a real render of its
  `sample` in the current Style.
- **Autosave:** a draft page autosaves ~1.5s after the last change ("Saving… / Saved / Couldn't
  save — Retry"). A PUBLISHED page does not push edits live on every keystroke: changes accumulate
  and the primary button becomes **Publish changes**. `beforeunload` guards unsaved work; the existing
  sessionStorage crash-recovery stays.
- Undo/redo (80 steps, burst-coalesced) is reused from `page-builder-store.svelte.ts`.

---

## 8. Process rules for WP agents

- Work ONLY inside your territory (your WP brief lists it). A change you need outside it → do not
  make it; describe it under **Handoffs** in your report. Files owned by nobody (orchestrator-only):
  `kit/model/ids.ts`, `kit/model/types.ts`, `render/types.ts`, `docs/design/landing-builder/*`,
  every `packages/*` file (except WP1/WP9), every route file not named in your brief.
- **Never** run git, `pnpm install`, root `pnpm test` (the test DB is the shared dev DB), `pnpm
  typecheck`/`pnpm build` repo-wide, or anything that restarts the dev stack. Run scoped tests only:
  `pnpm --filter web exec vitest run <paths>`.
- Run the Svelte MCP `svelte-autofixer` on every `.svelte` file you write until it is clean.
- Visual work is verified by LOOKING: the dev stack runs from this worktree at
  `http://<org>.lvh.me:3000`. Use your OWN browser page (chrome-devtools `new_page` with an
  `isolatedContext` named after your WP, or Playwright if told) and never touch another agent's page.
  Screenshot every layout in every Style, light and dark, desktop and mobile, and fix what looks weak
  before reporting. Studio routes need a login: `creator@test.com` / `Test1234!` (owner of
  `studio-alpha`).
- Report (your final message, in this order): **Built** (files) · **Decisions** (anything the
  contract left open, with values) · **Verified** (tests run + result, screenshots taken, what you
  fixed after looking) · **Handoffs** · **Known gaps**. Be exact; the orchestrator re-checks claims.

## 9. Gates

Per WP (orchestrator runs after the agent reports): scoped vitest green · `svelte-check` no new
errors in touched files · `biome check` on touched files · `check:brand-boundary` · autofixer clean ·
screenshots reviewed. Before the PR: `pnpm typecheck` (0 cached), web + package test suites,
`pnpm build --filter='./packages/*' --filter=web` (R16), `check:ci`, Playwright e2e for journeys,
`codex-review`.

## 10. Amendments

_(append here: `A<n> · <date> · <WP> · what changed · why`)_

---

## Appendix A — Legacy maps

_(written by WP1: legacy variant → v2 layout per type; legacy prop key → v2 key per type; the seed
default table used to drop unauthored props.)_

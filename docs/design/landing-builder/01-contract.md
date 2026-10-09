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

- **A1 · 2026-09-26 · orchestrator · Visitor-facing kit strings live in `kit/model/copy.ts`** (English
  constants, one module, translation-ready), not in `apps/web/messages/en.json`. Creator-facing labels
  live in each `definition.ts`. Why: `en.json` + its two generated Paraglide files are a single shared
  file that parallel block agents would all edit; the legacy catalogue already kept creator-authored
  and catalogue copy out of Paraglide (contract A20 of the axis programme). Studio EDITOR chrome
  (WP7/WP8, sequential) keeps using Paraglide `studio_builder_*` keys.
- **A2 · 2026-09-26 · orchestrator · Two aggregators, both WP2-owned and complete for all 14 types
  from day one:** `kit/model/catalog.ts` (pure TS: `DEFINITIONS` — type → `BlockDefinition`) and
  `kit/registry.ts` (type → Svelte component). Later WPs never edit either; they replace the files
  inside their own `blocks/<type>/` folder.
- **A3 · 2026-09-26 · orchestrator · Page images (WP10).** An uploaded page image is stored in R2 at
  `landing-pages/{pageId}/images/{imageId}` with the standard `sm|md|lg.webp` variants, and referenced
  from section props as an **`ImageRef = { key: string; alt?: string }`** (e.g. `props.image`,
  `props.background`, `items[].image`). The server finds references by deep-scanning section props for
  strings that are exactly a minted key — no per-type schema knowledge — so any block may carry images.
  Removing the last reference to a key (on save) or never saving an uploaded key queues it for the
  existing orphan sweep. The web resolves a ref to a URL with a pure helper
  (`lib/page-builder/page-images.ts`); blocks never build CDN URLs themselves.
  *Revised 2026-09-27 (codex-review):* the queue holds each image's three OBJECT keys (nothing lives at
  the base key), every upload is queued as it lands, and a queued row is a nomination, not a verdict —
  the sweep acts on a page image only after 7 days, and only if no page in the key's own org
  (soft-deleted included) still references it. One owner of the key shape:
  `@codex/image-processing` `page-image-keys.ts`.
- **A4 · 2026-09-26 · orchestrator (WP3/WP4 question) · The one sanctioned editor-only element.** A
  block may render an EMPTY-STATE PROMPT (e.g. "Add your intro video under Settings → Media") only
  when `edit` is non-null, and that element carries **`data-lp-edit-only`**. It must never exist on the
  public page — `PageRenderer.svelte.test.ts` asserts the public render has zero such elements, then
  strips them from the editing render before the identity comparison. Nothing else may differ between
  the two renders except editing attributes.
- **A5 · 2026-09-27 · orchestrator · Creator images in sections (WP10b).** New v2 prop keys, each an
  `ImageRef = { key, alt? }` (A3) edited with the new `BlockField` control `'image'`: `hero.image`
  (overrides the course hero still — the one sanctioned override of live media), `text.image` (shown
  beside the text in `columns`, above it in `statement`/`centered`), `benefits.items[].image`
  (`grid` tiles), `cta.background` (behind the `band` layout, under the Style's scrim). Blocks resolve
  a ref with `resolvePageImageUrl(ref, variant, context.mediaBaseUrl)` and render through `Media`
  (which already falls back to its plate on a failed load). An empty/absent ref renders exactly as
  today. `alt` is required for a non-decorative image (the field prompts for it); a hero/background
  image is decorative by default.
- **A6 · 2026-09-27 · orchestrator · Expressive Styles and storytelling.** `03-expressive-contract.md`
  is BINDING and replaces, for all later work: §1 "Motion is one moment" (now "motion follows the
  story"), §4's "No second WebGL canvas. Atmosphere is CSS" (still no second canvas; the org's own
  shader shows through the new `atmosphere` scheme), §4's Radius row (now bent from the brand
  radius), and the Style and scheme lists of §2 and §5 (8 Styles, 6 schemes, `story` and `gallery`
  types). Why: the owner asked for "a set of really different styles … more interfactive components …
  awwwards level without the usabliitiy issues", always conforming to brand settings.

---

## Appendix A — Legacy maps

_(written by WP1: legacy variant → v2 layout per type; legacy prop key → v2 key per type; the seed
default table used to drop unauthored props.)_

All of this is implemented as data + small pure functions in
`apps/web/src/lib/page-builder/kit/model/legacy/` and consumed by
`kit/model/upgrade.ts`. This appendix is the readable reference; the code
comments carry the full reasoning per choice and are the source of truth if
the two ever disagree.

### A.1 Type map

Legacy → v2 (§2's "Replaces legacy" column, inverted; `legacy/type-map.ts`):

| Legacy | v2 | Legacy | v2 |
|---|---|---|---|
| `hero` | `hero` | `reel` | `preview` |
| `introVideo` | `video` | `guide` | `instructor` |
| `ache` | `problem` | `proof` | `testimonials` |
| `turn` | `transformation` | `faq` | `faq` |
| `feel` | `benefits` | `invite` | `pricing` |
| `map` | `curriculum` | | |

Any other stored `type` is dropped. `cta`/`stats`/`text` have no legacy source (v2-only).

**The `hero`/`faq` trap.** These two are the only IDENTITY mappings — the legacy and v2 names are the
same string. `isSectionTypeId('hero')` is therefore true for BOTH a genuinely-legacy row and a
genuinely-v2 one, so "is the type string a valid v2 id" cannot decide whether `props` still needs
mapping. `upgrade.ts` resolves this with a structural tell instead: legacy `hero` always writes
`headline` (v2 always writes `heading`, never `headline`); legacy `faq` never writes `items` (v2's
`items[]` is faq's primary v2 content, and no legacy path ever produced one). Every other type's
legacy and v2 names are distinct, so the plain name check is reliable for the other nine.

### A.2 Variant → layout (per legacy type, current ids + retired ids chained through their rename)

PROVISIONAL: v2's actual layouts (`blocks/<type>/definition.ts`) do not exist yet (WP2). Every row is
a judgement call from the legacy variant's `hint` text against the v2 layout's NAME — the only two
things that exist to compare — and is freely revisable once the real layouts are visible.

| Legacy type | v2 layouts | Legacy variant → v2 layout |
|---|---|---|
| `hero` | statement, split, cover, centered | `stage`→statement · `split-media`→split · `full-bleed`→cover · `oversized`→statement · `banner`→centered · `poster`→cover · _retired:_ `centered`/`left`/`minimal`→statement (via `stage`) · `split`→split (via `split-media`) |
| `introVideo` | theatre, split | `theatre`→theatre · `plain`→theatre · `split`→split · `bleed`→theatre · `card`→theatre · _retired:_ `cinema`→theatre · `simple`→theatre |
| `ache` | statement, list, split | `column`→statement · `statement`→statement · `paired`→split · `list`→list · `quote`→statement · `checklist`→list · `descent`→list · _retired:_ `centered`/`wide`→statement (via `column`) · `twocol`→split (via `paired`) |
| `turn` | columns, steps, statement | `statement`→statement · `column`→statement · `paired`→columns · `arc`→steps · `before-after`→columns · `numbered`→steps · _retired:_ `centered`/`wide`→statement (via `column`) · `twocol`→columns (via `paired`) |
| `feel` | grid, checklist, split | `paired`→split · `column`→checklist · `statement`→checklist · `grid`→grid · `ledger`→checklist · `stack`→checklist · _retired:_ `centered`/`wide`→checklist (via `column`) · `twocol`→split (via `paired`) |
| `map` | timeline, accordion, cards | `spine`→timeline · `rows`→accordion · `cards`→cards · `table`→accordion · `timeline`→timeline · `numbered-prose`→accordion · _retired:_ `descent`→timeline (via `spine`) · `list`→accordion (via `rows`) · `grid`→cards (via `cards`) |
| `reel` | feature, split | `theatre`→feature · `plain`→feature · `split`→split · `bleed`→feature · `card`→feature · `waveform`→feature · _retired:_ `cinema`→feature · `simple`→feature (`strip` is declared-unavailable in the legacy catalogue and never stored) |
| `guide` | split, quote, centered | `portrait`→split · `column`→centered · `quote`→quote · `credentials`→split · `letter`→centered · _retired:_ `centered`→centered (via `column`) |
| `proof` | grid, featured, quote | `grid`→grid · `stack`→featured · `spotlight`→featured · `wall`→grid · `marquee`→featured · `pull`→quote (no retired ids exist for `proof`) |
| `faq` | accordion, columns | `accordion`→accordion · `open`→accordion · `boxed`→accordion · `paired`→columns · `grouped`→accordion (no retired ids exist for `faq`) |
| `invite` | cards, focus, band | `pool`→focus · `banner`→band · `card`→focus · `tiers`→cards · `table`→cards · `sticky`→band · _retired:_ `descent`→focus (via `pool`) |

### A.3 Prop key → v2 key (per legacy type)

Common v2 keys: `eyebrow?`, `heading?`, `body?`, `ctaLabel?`, `note?`. Every alias below prefers the
name the OLD PUBLIC RENDERER read (`render/types.ts`) over the name the OLD BUILDER wrote
(`section-fields.ts`) when the two differ, mirroring `render/coerce.ts`'s own precedent — a page
authored against the renderer's name still wins. Every scalar read is filtered against the seed-default
table (A.4) first, so unauthored catalogue/seed copy never reaches the alias chain.

| Legacy type → v2 | Mapping |
|---|---|
| `hero`→hero | `eyebrow`←eyebrow · `heading`←`headline` + `accent` joined on its own line · `body`←`sub` + `felt` as a second paragraph · `ctaLabel`←[ctaLabel,button] · `note`←`trust` · `secondaryLabel`←[secondaryLabel,quiet] · `secondaryHref`←secondaryHref · `media`←`mediaMode` (`''`→absent, `none`→none, `image`→image, `loop`/`click`→video) · `watchLabel`←`mediaLabel` · `bg` **dropped** (no v2 prop) |
| `introVideo`→video | `eyebrow`←[eyebrow,kicker] · `heading`←heading · `body`←sub · `caption`←`clip` · `duration` **dropped** |
| `ache`→problem | `eyebrow`←[eyebrow,kicker] · `heading`←heading · `body`←[body,sub] · `points`←`points` (NOT `beats` — see below) |
| `turn`→transformation | `eyebrow`←[eyebrow,kicker] · `heading`←[statement,heading] · `body`←[lede,body] · `before`←`from` split into paragraphs · `after`←`to` split into paragraphs · `points` **dropped — no v2 slot** (Arc/Numbered content loss; see Known gaps) |
| `feel`→benefits | `eyebrow`←[eyebrow,kicker] · `heading`←heading · `body`←body · `items[].title`←`inclusions[].label` · `items[].detail`←`inclusions[].detail` · `previewTitle`/`previewSub`/`previewDuration` **dropped — no v2 slot** |
| `map`→curriculum | `eyebrow`←eyebrow · `heading`←[title,heading] · `body`←`sub` · `note`←[foot,note] (no other keys — curriculum's stages are live data) |
| `reel`→preview | `eyebrow`←[eyebrow,kicker] · `heading`←heading · `body`←sub · `caption`←`captions[0]` else `caption` · `clip`/`tag`/`duration` **dropped — no v2 slot** |
| `guide`→instructor | `role`←`role` (NOT common `eyebrow` — see below) · `heading`←heading · `body`←[bio,body] (already a plain string; no array conversion needed for v2) · `name`←name · `quote`←quote · `credentials[]`←`facts[].label` + `: ` + `facts[].detail` when present · `clip`/`duration` **dropped** |
| `proof`→testimonials | `eyebrow`←eyebrow · `heading`←heading · `note`←[trustLabel,trust] (imperfect fit — see below) · `items[]`←numbered `q`/`n`/`c` triples (RECOVERED content — the old renderer never read these at all) |
| `faq`→faq | `eyebrow`←eyebrow · `heading`←heading · `items[]`←numbered `q`/`a` pairs · `g1..`(group label) **dropped — no v2 slot** · `contactLabel`/`contactHref` have no legacy source (v2-new) |
| `invite`→pricing | `eyebrow`←eyebrow · `heading`←`heading` + `accent` joined on its own line · `body`←sub · `ctaLabel`←[ctaLabel,button] · `note`←[priceNote,risk] · `offers[]`← same shape minus `who` (**dropped — no v2 `offers[]` field**); never seed-filtered (neither seed source ever seeds an `offers` array) |

**Non-obvious calls, spelled out:**
- **`ache.beats` vs `ache.points`.** `render/types.ts`'s `AcheSectionProps` declares `beats?:
  string[]`, but no editor field and no `coerce.ts` alias ever writes `beats` — it is read-but-
  unauthorable, the same defect class this codebase has repeatedly found elsewhere (Codex-tqr51 &c.).
  `section-fields.ts`'s actual field (shared with `turn`) is `points`, confirmed on the real
  `bone-deep` row. Mapped from `points`.
- **`guide.role` → v2 `role`, not common `eyebrow`.** The legacy field is literally labelled "Role /
  eyebrow" in `section-fields.ts` — one field serving both ideas. v2 instructor carries a dedicated
  `role?` AND the common `eyebrow?`; since legacy never had a distinct generic-eyebrow value for guide
  sections, `role` maps to v2 `role` and `eyebrow` is left unset rather than guessed.
- **`proof`'s aggregate trust line → `note`.** v2 testimonials has no dedicated "trust line" slot; the
  common `note?` ("small reassurance under a CTA") is the closest available fit even though
  testimonials sections rarely carry a CTA. Imperfect, and the best option in the given vocabulary.
- **`guide.facts[]` → `credentials: string[]`.** No existing alias bridges this shape gap (unlike
  `feel.inclusions`→`items`, nothing in `coerce.ts` ever read `facts` — again the same "declared,
  never wired" defect class). Joined as `"label: detail"` (or bare `label` with no detail).

### A.4 Seed-default table (unauthored-copy detection)

Full literal table: `legacy/seed-defaults.ts`. Sources, in provenance order:

1. `section-catalog.ts` `SECTION_CATALOG[type].defaultProps` — the builder's own placeholder copy.
2. `packages/database/scripts/seed-portals.ts` `buildSections()` — its FIXED literals only (`button:
   'Begin'`, `risk: 'Cancel anytime'`, `ache.eyebrow: 'Why this'`, `ache.heading: 'You already know
   the shape of it.'`, …); the per-portal `spec.title`/`lede`/`kicker`/`spec.stages…join`
   interpolations are excluded — those are that portal's own copy, not a placeholder.

`packages/database/scripts/seed-journey-content.ts`'s `COPY` table is **deliberately NOT a source**,
reversed from this file's first draft after `upgrade.test.ts` proved the concrete cost against the
real `bone-deep` row: that script's stated purpose is to replace generic placeholder copy with
specific, deliberately-authored prose ("demo data that reads as real copy at real lengths is the
whole point" — its own header). Treating its OUTPUT as the same kind of unauthored scaffolding as the
catalogue's defaults or `seed-portals.ts`'s uniform literals inverts that purpose, concretely: with
its `ache.body` ("You have done the reading…") in the table, upgrade dropped that specific paragraph
and fell back to `sub` (a duplicate lede sentence shared with the hero section) — a real quality
regression on the one page the script touches. `seed-portals.ts`'s literals do not have this problem:
short, generic and IDENTICAL across every portal by construction, the same property catalogue
defaults have and `COPY`'s long, specifically-voiced sentences do not.

Only NON-EMPTY strings count, matching `section-catalog.ts`'s own `seededSections()` precedent exactly
(`hero.accent`/`felt`/`quiet`/`trust` and `guide.quote` seed `''` in the catalogue — dropping an
already-empty value achieves nothing).
`hero.bg`/`introVideo.duration`/`reel.duration`/`guide.duration` are absent from the table on purpose:
those keys have no v2 destination at all (A.3), so they are dropped unconditionally regardless of
value.

**A finding worth the orchestrator's attention: real seeded pages are NOT an exact Candlelit match.**
`seed-portals.ts` `reconcilePage()` hardcodes `width: 'narrow'` for what its own comment calls "the
Candlelit bundle", but `design-vocabulary.ts`'s REAL Candlelit preset — and its own pinned test,
`design-vocabulary.test.ts` "Candlelit matches the bundle migration 0084 backfilled" — has `width:
'text'`. Since look-detection (A.5) requires an exact nine-axis match (mirroring
`findDesignPreset()`'s own precedent), every page `seed-portals.ts` writes ALREADY reads as "Custom"
in today's existing look picker, not Candlelit — this is a pre-existing drift between two files, not
something introduced here. Confirmed on all three sampled real rows: they upgrade to Style `bold`
("unrecognised"), not `cinematic`, and `upgrade.test.ts` pins this as the correct, honest behaviour
given the real data. Worth a follow-up bead to reconcile `seed-portals.ts`'s bundle with the real
Candlelit tuple, since it presumably means those pages don't render as Candlelit TODAY either.

### A.5 Look → Style (page-level, contract §3)

The eight `design-vocabulary.ts` `SECTION_DESIGN_PRESETS` nine-axis tuples, snapshotted in
`legacy/look-map.ts`, matched EXACTLY (all nine axes) against a page's stored `design` bundle:

| Preset | Style | `width` | `density` | `surface` | `edge` | `align` | `type` | `accent` | `motion` | `media` |
|---|---|---|---|---|---|---|---|---|---|---|
| Candlelit | **cinematic** | text | airy | media | none | center | monumental | glow | drift | bleed |
| Quiet Studio | clean | narrow | vast | bare | hairline | center | monumental | none | fade | inset |
| The Long Read | clean | text | regular | bare | hairline | start | balanced | text | rise | frame |
| Open Air | **soft** | text | airy | tint | soft | center | expressive | text | drift | mask |
| Plain Facts | clean | wide | compact | panel | offset | start | monumental | fill | none | none |
| The Syllabus | clean | wide | compact | panel | hairline | start | restrained | edge | none | frame |
| Full Send | bold | wide | regular | invert | heavy | center | expressive | fill | stagger | mask |
| Signal | bold | wide | regular | panel | hairline | start | balanced | fill | rise | frame |
| _unrecognised_ | **bold** | — any bundle matching none of the eight, including an empty/absent one — | | | | | | | | |

A page-level `style` key already present and valid wins outright (v2 pass-through) and skips this
detection entirely. All three real rows sampled for `upgrade.test.ts` carry the Candlelit bundle
verbatim → Style `cinematic`.

### A.6 Section-level axis → `SectionStyle` (contract §3, `legacy/axis-style-map.ts`)

Independent per-axis rules — NOT a tuple match like A.5 — reading only the section's own literal
`design` bag (a retired variant id's baked-in axes, e.g. `hero.minimal`'s implied `density: compact`,
are NOT merged in; confirmed low-stakes, `minimal` is unused in the three sampled real rows and the
catalogue's own comment calls it "latent today"):

- `surface: invert` → `scheme: contrast` · `tint`/`panel` → `scheme: soft` · everything else → absent.
- `density: compact` → `spacing: compact` · `regular` → `spacing: regular` · `airy`/`vast` →
  `spacing: spacious` · everything else → absent.
- The other seven legacy axes (`width`, `edge`, `align`, `type`, `accent`, `motion`, `media`) have no
  v2 `SectionStyle` counterpart and are not read here at all.

### A.7 Known content-loss gaps (real authored data with no v2 destination today)

Flagged for the orchestrator / a future contract amendment, not silently absorbed:

- **`turn.points`** (the Arc/Numbered compositions' roman-numeralled or three-beat list) has no v2
  transformation prop at all — contract §2's table is `eyebrow`/`heading`/`body`/`ctaLabel`/`note` +
  `beforeLabel`/`afterLabel`/`before`/`after` only. A page using either composition loses this content
  on upgrade.
- **`feel`'s free-taste preview player** (`previewTitle`/`previewSub`/`previewDuration`) has no v2
  benefits prop — dropped whole.
- **`reel`'s on-frame label / corner tag** (`clip`/`tag`) and **`guide`'s on-frame label** (`clip`) —
  no v2 slot.
- **`invite.offers[].who`** ("one line above the price") — v2 `pricing.offers[]` has no `who` field.
- **`hero.bg`** (the atmosphere recipe) — no v2 prop; superseded by the Style + scheme system, but the
  specific `ember`/`blood`/`still` choice a creator made is not preserved as such.

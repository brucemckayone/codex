# Pricing Page Polish Loop

**Status**: Living document. Updated every 20 minutes by the `/loop` cron.
**Started**: 2026-04-17
**Owner**: Claude (autonomous)
**Mandate**: The functional v1.1 spec (Codex-mlwp) is shipped. The page works but it reads as *centered SaaS*, not *editorial premium*. Polish it one section at a time until it feels as considered as the org landing page.

---

## North Star

The org landing page (`apps/web/src/routes/_org/[slug]/(space)/+page.svelte`) is the benchmark. The design language to bring across:

| Landing device | How to bring it to pricing |
|---|---|
| `.lede` eyebrow + hairline + display title | Use the same masthead treatment on every section header |
| `clamp()` display typography, dramatic scale | Hero heading should match the landing's gravity |
| Editorial asymmetry (bottom-left hero, magazine spreads) | Hero can stay centered but the tier row + FAQ should break the strict symmetry |
| Generous `--space-12`/`--space-16` section rhythm | Replace the current `--space-12` gap with something more editorial |
| `--container-max` 80rem breathing room | Current pricing is locked to 960px — too narrow for 3 cards |
| Brand-gradient atmospherics (ShaderHero canvas) | Bring a brand gradient mesh + noise into the hero backdrop |
| Content-density-adaptive layouts | Tier count (1/2/3/4+) should drive the card grid shape, not flex-wrap |
| `color-mix(in oklch, var(--color-brand-primary) N%, ...)` | Every surface, border, and tint should reach for brand color through `color-mix` |

---

## What's wrong with v1 (honest audit)

The code mirrors the v1.1 spec, but visually:

1. **Container is 960px** — three tier cards wrap awkwardly on laptop widths. Landing uses 80rem everywhere; pricing should too.
2. **Hero feels centered-SaaS** — fine structurally, but no atmosphere, no editorial eyebrow rule, typography caps out at `--text-4xl` while landing's hero is `clamp(3.5rem, 8vw, 8rem)`.
3. **Tier cards are identical** — recommended gets a glow ring but no dramatic *difference* in shape, elevation, or pacing. The magazine-spread idea the landing uses for single items isn't applied.
4. **No brand color elsewhere** — cards are neutral glass with faint brand border. The brand is barely present between the hero gradient and the CTA button.
5. **Feature checklist is generic** — three static strings (`all tier content / cancel anytime / instant access`) with identical check icons. Reads as template, not content.
6. **Content preview is a 6-up blur grid** — fine concept, but the overlay is centered glass with a small "browse the library" link. No editorial power.
7. **FAQ is a naked accordion card** — no masthead treatment, no visual interest, no section-level identity.
8. **Trust strip is flat** — three icon+label pairs, no hierarchy, no brand.
9. **Sticky CTA is functional but plain** — doesn't feel like a premium product chip.
10. **Section gaps use `--space-12`** — same as card internal padding, so nothing *sings* spatially.

---

## Polish Pass Schedule

Each cron fire (every 20 min) does **one pass** fully. After every pass: commit, push, update this doc.

| # | Section | Status | Notes |
|---|---|---|---|
| 1 | **Hero** — container widening, editorial lede masthead, display typography, brand gradient mesh backdrop, polished billing toggle | ✅ done | Commit on 2026-04-17 |
| 2 | **Tier Cards** — differentiated recommended treatment, editorial price display, meaningful feature list, brand-accent glow, card-count-adaptive grid | ✅ done | Commit on 2026-04-17 |
| 3 | **Content Preview** — move from "blur wall" to "editorial magazine spread" with mixed thumbnail tiles, real creator glimpses, branded stat | ✅ done | Commit on 2026-04-17 |
| 4 | **FAQ** — lede-style masthead, column-balanced two-up layout on wide screens, refined accordion chrome | ✅ done | Commit on 2026-04-17. Stayed single-column (editorial > two-up) |
| 5 | **Trust Strip** — editorial hairline above, brand microaccent, better iconography, refined hierarchy | ✅ done | Commit on 2026-04-17 |
| 6 | **Sticky CTA** — premium chip, tier-color glow, polished transitions, mobile-edge safe | ⬜ pending | |
| 7 | **Between-section rhythm** — breath, scroll reveals for each section, tighter vertical cadence | ⬜ pending | |
| 8 | **Full micro-polish review** — focus rings, motion reduce paths, dark mode, backdrop-filter fallback, skeleton match | ⬜ pending | |
| 9+ | **Continuous refinement** — each re-fire picks the weakest remaining section | ⬜ pending | |

---

## Inventory — Tokens I'm designing with

### Color
- **Brand palette**: `--color-brand-primary` (derived from `--brand-color`), plus `-hover`, `-active`, `-subtle` OKLCH variants
- **Interactive**: `--color-interactive` (same brand root)
- **Accent**: `--color-brand-accent` (from `--brand-accent`)
- **Surface**: `--color-surface`, `-secondary`, `-tertiary`, `-card`, `-elevated`
- **Text**: `--color-text`, `-secondary`, `-muted`, `-tertiary`, `-disabled`, `-on-brand`
- **Border**: `--color-border`, `-strong`, `-subtle`, `-hover`
- **Semantic**: `--color-success-600/50`, `--color-error-*`, `--color-warning-*`
- **Glass**: `--material-glass`, `--material-glass-border`, `--color-glass-tint`, `--color-glass-tint-dark`
- **Color-mix**: always reach for `color-mix(in oklch, var(--color-brand-primary) N%, transparent)` — gives brand depth without flat fills

### Typography
- **Fonts**: `--font-heading` (org-branded display), `--font-sans` (org-branded body), `--font-mono`
- **Scale**: `--text-xs` through `--text-4xl` — all `clamp()`-fluid and brand-scalable via `--text-scale`
- **Weights**: `--font-normal|medium|semibold|bold` — all brand-overridable
- **Line-height**: `--leading-none|tight|snug|normal|relaxed`
- **Tracking**: `--tracking-tighter|tight|normal|wide|wider`
- **Transform**: `--text-transform-label` (brand-configurable — may be `none` for lowercase brands)

### Space / Layout
- **Spacing**: `--space-0-5` through `--space-24` — multiplied by brand density scale
- **Radius**: `--radius-xs/sm/md/lg/xl/full` — all driven by `--brand-radius`
- **Container**: `--container-max` (80rem)
- **Breakpoints**: `--breakpoint-sm/md/lg/xl/2xl` via `@media (--breakpoint-md)`
- **Below-BP**: `@media (--below-md)` for mobile-only

### Depth / Material
- **Shadows**: `--shadow-xs/sm/md/lg/xl/inner` — brand-scalable via `--brand-shadow-scale`
- **Blur**: `--blur-sm/md/lg/xl/2xl`
- **Card interaction**: `--card-hover-scale`, `--card-image-hover-scale` — brand-tunable

### Motion
- **Duration**: `--duration-fast/normal/slow/slower`
- **Easing**: `--ease-default/in/out/bounce/smooth/spring`
- **Transitions**: `--transition-colors|transform|opacity|shadow`

### Borders
- **Widths**: `--border-width` (1px), `--border-width-thick` (2px)
- **Compound**: `--border-default`, `--border-focus`

---

## Pass 1 — Hero (2026-04-17 ~17:00 local)

### Goal
Turn the hero from "centered pricing title" into an editorial masthead that establishes the *membership* idea with the same gravity as the landing hero establishes the org.

### Concrete changes
1. **Container widening**: `.pricing-page { max-width: 960px }` → `max-width: 72rem` (1152px). Gives three tier cards room to live side-by-side at laptop widths without the current awkward wrap.
2. **Hero padding rhythm**: `var(--space-16) var(--space-4) var(--space-10)` → `var(--space-20) var(--space-8) var(--space-14)` — more dramatic top silence, roomier side padding, pushes the billing toggle into its own breathable zone.
3. **Hero lede masthead**: Replace plain eyebrow with a `.lede`-style treatment — `.lede__eyebrow` in small-caps brand-primary, hairline `<hr class="lede__rule">` beneath, then display title. Matches landing's editorial voice.
4. **Display typography**:
   - Heading: `font-size: clamp(2.75rem, 5vw + 1rem, 4.75rem)`, `line-height: var(--leading-none)`, `letter-spacing: var(--tracking-tighter)`
   - Subtitle: `--text-lg` → `--text-xl`, `max-width: 44ch`
5. **Brand gradient mesh backdrop**: New `::before` layer — two offset radial gradients in `color-mix(oklch, var(--color-brand-primary) 14%, transparent)` and `color-mix(oklch, var(--color-brand-primary) 7%, transparent)` at different positions, plus a subtle top-to-bottom wash to the surface color. Composites behind the hero to give atmospheric brand presence without imagery.
6. **Soft grain overlay**: Subtle SVG noise data-URI at `opacity: 0.04` layered over the gradient for editorial texture (matches the mood of the landing's shader without the heft).
7. **Billing toggle upgrade**:
   - Active pill background uses `color-mix(in oklch, var(--color-brand-primary) 12%, var(--color-surface))` — brand tint, not pure surface
   - Inactive options get `color: var(--color-text-tertiary)` for a softer starting state
   - Inner highlight via `inset 0 1px 0` white glass-tint stays
   - Savings pill: `--ease-bounce` stays, but scaled duration `var(--duration-slower)` and a slight upward translate in the bounce for Disney-principled overshoot
8. **Entrance stagger**: Keep the existing stagger (eyebrow → heading → subtitle → toggle) but bump delays to `0 / 100 / 200 / 320ms` so the reveal feels paced rather than rushed.

### Success criteria
- Hero feels as "premium / editorial" as the landing hero does when you arrive — specifically: there's atmosphere behind the text, the eyebrow+rule+title reads as a considered masthead not a form label, and the display title doesn't feel like a form heading.
- Billing toggle reads as part of the brand, not like a stock segmented control.
- Works at org-brand extremes: low-density (0.8x), high-density (1.2x), bold heading weight (900), pill-shaped radius (1rem).

### Out of scope for this pass
- Shader hero (landing has one; pricing doesn't need that weight).
- Changing the copy (i18n keys stay).
- Tier card changes (Pass 2).
- Touching `+page.server.ts` (backend untouched).

### Changes summary
- `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte` — template + styles for hero only.

---

## Log

- **2026-04-17 Pass 1 (Hero)**: Widened container to 72rem. Replaced centered SaaS hero with editorial lede: small-caps brand eyebrow → gradient-hairline rule → display title (`clamp(2.5rem, 4vw + 1rem, 4.5rem)`, tracking-tighter, leading-none, text-wrap balance) → muted subtitle. Added brand gradient mesh backdrop (three offset radial gradients in brand-primary OKLCH mixes + surface wash) with inlined fractalNoise SVG grain at 4% opacity / overlay blend for editorial texture. Upgraded billing toggle: brand-tinted active gradient instead of flat surface, focus-visible ring, softer border via `color-mix(border, 60%, transparent)`, deeper inner highlights. Savings pill now uses `success-700` on `success-50` with a border and a 3-stop bounce keyframe. Staggered entrance timing recalibrated (40/140/200/320/440ms) for a paced reveal rather than a rush.

- **2026-04-17 Pass 2 (Tier Cards)**: Full card rethink.
  - **Grid**: `flex-wrap: center` → CSS Grid with `repeat(auto-fit, minmax(min(100%, 18rem), 1fr))`. Clean 1/2/3/4+ column layouts; `--single` caps at 28rem centered, `--duo` caps at 52rem centered.
  - **Recommended differentiation**: floating ribbon (`.card__ribbon`) overhanging the card's top edge in a brand-gradient pill with shadow + brand glow. Featured card surface now carries a subtle `linear-gradient(brand-primary 6% → 1% → 3%)` wash over surface. Extra top padding (`--space-10`) accommodates the overhang. On desktop side-by-side layouts, featured gets a `margin-top: -space-4` lift so it physically sits above siblings. Featured box-shadow upgraded to include a brand-colored bloom (`0 space-6 space-12 … brand 22%`).
  - **Editorial price stack**: amount + interval + savings pill on one baseline row, monthly-equivalent helper line beneath on annual (`£X.XX/mo · billed annually`) or up-sell on monthly (`Save X% when billed annually`). Savings pill uses `−X%` glyph for discount-tag readability. Featured card's price amount renders in `--color-brand-primary` for visual anchor. Amount bumped to display-scale `clamp(2.25rem, 2vw + 1.5rem, 3rem)` in heading font.
  - **Features**: hairlined list — each item gets `padding: --space-3 0` with a bottom border between rows. Check icons now sit in a brand-tinted rounded squircle (`--space-6` circle, 12% brand on regular, 20% on featured). Text line-height tightened to snug, all copy punched up: "Cancel anytime" → "Cancel anytime, no questions asked"; "Instant access" → "Instant access on payment".
  - **Tier name typography**: `--text-xl` → `--text-2xl`, `--leading-tight`, `--tracking-tight`.
  - **CTA hierarchy**: `variant={isRecommended ? 'primary' : 'secondary'}` — only the recommended tier's CTA is filled primary, others are secondary. Creates one clear conversion focus per row.
  - **Current-plan label**: retained inline pill treatment; ribbon is recommendation-only.
  - **Glow**: conic gradient pulse tightened (70%/22%/70% stops, scale 1→1.005 micro-breathing, `--ease-smooth` instead of raw ease-in-out, 3.2s cycle).

  - **Next pass prerequisite**: Visual verification in-browser — boot `pnpm dev` from monorepo root and visit a 3-tier org's pricing page. Verify ribbon positioning at various widths, brand tint readability at low-saturation brands, feature icon circles scale properly with brand density. Watch for: ribbon collision with inner content at narrow widths, the featured card's `margin-top: -space-4` misbehaving in 1-tier and single-column mobile layouts (should collapse to 0 via `:not(.tier-stage--single)` but worth confirming).

- **2026-04-17 Pass 3 (Content Preview)**: Full rework of the "blur wall" into an editorial magazine spread.
  - **Structure**: `.content-preview` → `.preview` with three stacked regions — masthead lede, magazine spread, stat footer.
  - **Lede masthead**: matches Pass 1/2 editorial voice — `Inside the library` eyebrow → gradient hairline rule → display title ("A catalogue you'll never finish.") → muted subtitle ("Video, audio, and writing from every creator — included with every membership."). `clamp(1.75rem, 2.5vw + 1rem, 2.75rem)` title, text-wrap balance, max-width 20ch/48ch.
  - **Magazine spread**: CSS Grid with 1 hero tile + 3 supporting tiles on md+ (`grid-template-columns: 1.8fr 1fr`, `grid-template-rows: repeat(3, 1fr)`, `aspect-ratio: 5/2.4`). Mobile: 2×2 grid of 4:3 tiles. Radius-lg corner-rounding on the whole spread, shadow-md lift.
  - **Layered blur strategy**: hero tile (`--tile--0`) blur at `calc(--blur-sm / 2)` = 2px so the composition reads; supporting tiles at `--blur-sm` = 4px for denser tease. On hover, each tile reveals a sharper version (blur drops by half, saturate to 1). Hero tile drops to 1px blur on hover.
  - **Tile overlays**: brand-colored multiply gradient from transparent @ 42% to `color-mix(oklch, brand-primary 18%, black)` at bottom — ties tiles together visually while keeping brand presence. Each tile gets a content-type badge (Video/Audio/Article) in a black-glass pill with white-tinted border, top-right.
  - **Stat footer**: 3 big display-scale stats (Titles / Creators / Hours) in a grid with `grid-auto-flow: column`, separated by top+bottom hairlines. Numbers `clamp(1.75rem, 2vw + 1rem, 2.5rem)` in heading font, tracking-tighter, tabular-nums; labels in small-caps `tracking-wider`. Categories pills strip beneath (if available) using `stats.categories`. CTA pill at the bottom: brand-tinted background (`6% → 12%` on hover), brand-colored border (`25% → 45%` on hover), brand-colored shadow glow, with an animated → arrow that translates on hover via `--ease-spring`.
  - **Helper**: added local `formatHoursShort()` to script — mirrors landing page's hero-stats hours formatting.
  - **Motion**: existing scroll-triggered reveal (IntersectionObserver sets `preview-visible`) preserved; transition durations bumped to `--duration-slower * 1.2` with `--ease-smooth`.
  - **Backward compat**: observer still adds `preview-visible` to the bound element — only the base class name changed (`.content-preview` → `.preview`). `:global(.preview.preview-visible)` handles the reveal.

  - **Next pass prerequisite**: Visually verify the spread at various tile counts (we slice to 4 but source may have 3-6). Confirm content-type badges remain legible on busy thumbnails. Check that the `aspect-ratio: 5/2.4` spread doesn't get too short on ultrawide displays (may want to cap `max-height` on very wide viewports in a later pass). Also check that mobile 2×2 doesn't feel cramped at tiny widths — consider 1-column fallback below 320px.

- **2026-04-17 Pass 4 (FAQ)**: Editorial single-column FAQ with brand-indicator accordion.
  - **Decision**: Rejected two-column layout (prereq suggested it). Two-up FAQ grids feel SaaS-template-y; single-column with strong typography is more magazine / NYT-premium. Width capped at 48rem for comfortable reading.
  - **Structure**: `.faq-section` → `.faq`, `.faq-container` (glass card) → `.faq__list` (hairline-only). Retired `.section-heading`. Added `.faq__lede` matching Pass 1/2/3 masthead pattern (eyebrow → gradient rule → display title → subtitle).
  - **Copy shift**: eyebrow "The fine print" instead of "Frequently Asked Questions" form-label; title "Questions, answered." instead of plain "FAQ"; subtitle acknowledges creator customization ("plus room for anything the creators want you to know").
  - **Accordion chrome** (via `.faq__list :global(.accordion-*)` overrides, per Svelte parent-child scoping rules):
    - Trigger: heading font, `--text-base`, semibold, tracking-tight, `--space-5` vertical padding, generous left padding for the brand indicator.
    - Hover: brand-color text + 4% brand-tinted background wash.
    - Open: trigger text colored brand-primary.
    - Focus-visible: brand focus ring (via `--shadow-focus-ring`).
    - Chevron: brand-primary color, `--space-4` size, `--ease-spring` rotation (was `--ease-default`).
    - Left-edge brand indicator: `::before` pseudo renders a 2px pill on the trigger's left edge. Height transitions from 0 → 45% on hover, → 70% on open. Pseudo stays outside `:global()` per Svelte's selector parser (`:global(.accordion-trigger)::before` not `:global(.accordion-trigger::before)`).
    - Content: relaxed line-height, pretty text-wrap, 44rem content max-width, consistent left indentation matching trigger.
  - **Item separators**: hairlines (`color-mix(border, 50%, transparent)`) top of list + between items, none on last — replaces the old glass-card visual container.

  - **Next pass prerequisite**: Verify indicator-pseudo animation works (should fill from center-out). Test keyboard navigation — focus ring should be clearly visible on each trigger. Confirm chevron spring rotation feels alive without being distracting. Consider: on smallest viewports, does the `--space-6` left padding on trigger look excessive?

- **2026-04-17 Pass 5 (Trust Strip)**: Flat icon+divider row → editorial coda.
  - **Structure**: `.trust-bar` → `.trust` (column flex with `.trust__rule` + `.trust__signals`). Each signal gets wrapped icon + label: `.trust__signal > .trust__icon + .trust__label`. Dividers changed from vertical 1px bars to brand-colored dots (`.trust__dot`).
  - **Brand rhyme**: `.trust__rule` reuses the same `--space-16` wide gradient-hairline pattern as `.pricing-hero__rule`, `.preview__rule`, `.faq__rule`. Creates a visual refrain — every section opens (or in this case closes) with the same brand mark.
  - **Icons**: each SVG now lives inside a `--space-5` brand-tinted circle (`color-mix(brand, 10%, transparent)` background, brand-color on the icon). Matches the tier card feature icon treatment at slightly smaller scale.
  - **Dots**: tiny `--space-1` circles in `color-mix(brand, 45%, transparent)` replace the neutral 1px vertical dividers. Editorial, brand-present, not form-template-y.
  - **Typography**: label bumped `--text-xs` → `--text-sm`, `--font-normal` → `--font-medium`, added `--tracking-tight`. Color stays muted — icons carry the brand signal, text stays quiet.
  - **Mobile wrap**: below sm, signals stack vertically and dots hide — tinted icon circles alone carry the grouping. Cleaner than hard line-break + wrapped dots.
  - **Removed**: the faint 60% opacity on plain icons (no longer needed — icon is a proper tinted shape now).

  - **Next pass prerequisite**: Check that at tight viewport widths (600-768px), the dots don't get crowded; confirm the rule doesn't feel redundant next to the FAQ list's bottom border (there's no bottom border on FAQ list — each accordion item has its own). Also sanity-check that the `--space-5` icon circle + `--text-sm` label combo maintains vertical rhythm across brand density scales (0.8x / 1.0x / 1.2x).

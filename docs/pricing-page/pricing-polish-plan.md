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
| 6 | **Sticky CTA** — premium chip, tier-color glow, polished transitions, mobile-edge safe | ✅ done | Commit on 2026-04-17 |
| 7 | **Between-section rhythm** — breath, scroll reveals for each section, tighter vertical cadence | ✅ done | Commit on 2026-04-17 |
| 8 | **Full micro-polish review** — focus rings, motion reduce paths, dark mode, backdrop-filter fallback, skeleton match | ✅ done | Commit on 2026-04-17 |
| 9 | **Copy tightening (defaults)** — FAQ defaults rewritten for objection-handling, FAQ lede reframed from "fine print" to "before you subscribe" | ✅ done | Commit on 2026-04-17 |
| 10 | **Checkout error treatment** — editorial alert with icon, title+message hierarchy, dismiss button, transition | ✅ done | Commit on 2026-04-17 |
| 11 | **Preview fallback variants** — sparse-content orgs (0/1/2/3 thumbs) get dedicated spread layouts instead of section-disappearing hard gate | ✅ done | Commit on 2026-04-17 |
| 12 | **Visual verification + bug fixes** — live screenshot session found `//mo` double-slash on tier cards + section rules too faint on dark mode; both fixed | ✅ done | Commit on 2026-04-17 |
| 13 | **Mobile + light mode verify + tick() fix** — found preview reveal not firing post-stream; fixed with `tick()` before observer re-sweep | ✅ done | Commit on 2026-04-17 |
| 14 | **Sticky CTA annual helper** — adds "£X.XX/mo · billed annually" helper line on the sticky when Annual is active, matching tier card pattern | ✅ done | Commit on 2026-04-17 |
| 15 | **Keyboard focus ring a11y fix** — switched toggle + preview CTA from box-shadow to outline so active/hover state styles don't override focus-visible | ✅ done | Commit on 2026-04-17 |
| 16 | **Billing toggle ARIA radiogroup** — added roving tabindex + arrow-key navigation for proper WAI-ARIA radiogroup semantics | ✅ done | Commit on 2026-04-17 |
| 17 | **Ribbon shine micro-interaction** — one-shot diagonal overlay sweep on the recommended ribbon after page load, draws eye to the recommended tier | ✅ done | Commit on 2026-04-17 |
| 18 | **Savings pill as lure** — flipped visibility so pill shows on Annual button when Monthly is active (incentive), hides when Annual taken; copy now computed from max tier savings | ✅ done | Commit on 2026-04-17 |
| 19 | **Lighthouse a11y 100** — ran snapshot audit, found insufficient contrast on inactive toggle text, bumped color token to restore WCAG AA | ✅ done | Commit on 2026-04-17 |
| 20+ | **Continuous refinement** — each re-fire picks the weakest remaining detail | ⬜ pending | |

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

- **2026-04-17 Pass 6 (Sticky CTA)**: Full-bleed bar → floating premium pill (desktop) + full-bleed (mobile).
  - **Responsive split**: outer `.sticky-bar` is a `pointer-events: none` wrapper; `.sticky-bar__inner` is the actual pill. Desktop inner has `max-width: 44rem`, `border-radius: full`, `pointer-events: auto`. Mobile gets `.sticky-bar--mobile` class → inner resets to full-bleed, radius 0, no side/bottom borders — same chip chrome but edge-to-edge for thumb reach.
  - **Brand glow shadow**: inner now has a 3-layer shadow — `--shadow-xl` base + brand-colored bloom (`0 space-4 space-12 color-mix(brand, 18%, transparent)`) + inner glass highlight. The bloom ties the sticky visually to the recommended tier card's bloom (same token values).
  - **Editorial headline**: added `.sticky-bar__eyebrow` "Most Popular" in small-caps brand-primary above a `.sticky-bar__headline` row of `tier name · price`. Two-line info left, CTA + dismiss right. Echoes the ribbon on the recommended card — same "Most Popular" label, same brand voice.
  - **Typography**: tier name now uses `--font-heading` + `--text-base` semibold (was `--text-sm` medium sans). Price matches — heading font, bold, `tracking-tight`. Small interval (`/mo` `/yr`) stays sans + muted for scale contrast.
  - **Text truncation**: long tier names get ellipsis with `max-width: 16ch`, preventing layout explosion.
  - **Dismiss polish**: transition includes `transform rotate(90deg)` on hover for a playful reveal cue (disabled under `prefers-reduced-motion: reduce`). Hover background now a neutral-on-text mix instead of raw surface-secondary. Focus-visible ring via `--shadow-focus-ring`.
  - **Entrance**: `fly { y: 80, duration: 350 }` up from `y: 60, duration: 300` — slightly more dramatic lift, same cubicOut easing.
  - **Separator glyph**: `·` between name and price (not a layout gap) — reads as a single phrase rather than disjoint cells.
  - **Inner padding asymmetry**: `space-2 space-2 space-2 space-5` — left breathing room for the eyebrow-stacked info, tighter right padding so the Button sits nicely toward the edge.

  - **Next pass prerequisite**: Visual check on desktop scroll-trigger — bar should appear centered, not hug left edge. Confirm the brand glow isn't overpowering on high-saturation brands (terracotta at #C24129 can look intense; if so, dial back the 18% mix). Mobile: verify full-bleed works on iOS notch devices (safe-area-inset-bottom kicks in).

- **2026-04-17 Pass 7 (Between-section rhythm)**: Unified scroll-reveal system across below-fold sections.
  - **Removed**: bespoke `.preview` opacity/transform/transition CSS, the preview-specific IntersectionObserver, the `previewRef` state, the `unwatchPreview` $effect.root wrapper, the `preview-visible` global selector.
  - **Added**: shared `.reveal` base class (opacity: 0, translateY(`--space-5`), `--duration-slower` + `--ease-smooth`) and `:global(.reveal.reveal--visible)` trigger. Applied via `class="... reveal"` + `data-reveal` attribute to `.preview`, `.faq`, `.trust`. Generic observer in onMount queries `[data-reveal]:not(.reveal--visible)`, with initial sweep for static sections + post-stream re-sweep via `Promise.resolve(data.contentPreview/data.stats).finally(observeReveals)` to catch streamed-in sections.
  - **Child-rule motion**: `.preview__rule`, `.faq__rule`, `.trust__rule` now start at `scaleX(0.3)` and expand to `scaleX(1)` with a 150ms delay after their parent section reveals. Echoes the hero's `heroRuleExpand` keyframe — the section *lifts* first, then the rule *draws itself*. Consistent motion language top to bottom.
  - **Observer threshold**: 0.12 with `rootMargin: '0px 0px -8% 0px'` — section reveals when its top reaches 8% from the bottom of the viewport, which feels natural (triggers just before the section is fully in view, not after).
  - **Performance**: `observer.unobserve(entry.target)` on reveal prevents duplicate work; `observer.observe()` is idempotent so post-stream re-sweeps are safe even for already-observed elements.
  - **Reduced motion**: single guard under the reveal block resets opacity + transform to base values; rule scaleX resets to 1.
  - **Mount-time robustness**: since `.preview` is inside `{#await data.contentPreview}`, it may not exist at onMount. Promise-based re-sweep handles this without needing MutationObserver or retry polling. The observer's `threshold: 0.12` means even if a slow stream lands when the user has already scrolled past, the element reveals immediately on next scroll frame.

  - **Next pass prerequisite**: Visual smoke test — scroll from top to bottom. Expected: hero staggers on load, tier cards stagger via existing `cardReveal`, preview + faq + trust each lift-and-fade as they enter the viewport, their rules expand after. Check that refresh-while-scrolled-down doesn't leave sections stuck at opacity: 0 (the `finally(observeReveals)` should catch this). If reduced-motion is on, everything should appear statically.

- **2026-04-17 Pass 8 (Full micro-polish review)**: Cross-cutting cleanup across the whole page.
  - **Backdrop fallback**: `@supports not (backdrop-filter: blur(1px))` block rewritten. Removed orphan `.faq-container` reference (class was retired in Pass 4). Added `.card-shell` (skeleton) and `.preview__badge` to the fallback set. Featured card + featured skeleton get brand-tinted fallback backgrounds so recommendation reads even without blur support. Sticky-bar fallback now targets `.sticky-bar__inner` (where the backdrop actually lives), not the outer wrapper.
  - **Skeleton card shape match**: `.card-shell` now mirrors the Pass 2 tier card structure. Removed Pass-1-era `flex: 1 1 320px; max-width: 420px; min-width: 280px;` (redundant — grid handles sizing). Added new structural placeholders: `.skeleton--helper` (price helper line), `.card-shell__features` (hairlined feature list container), `.card-shell__feature` (row with icon circle + text bar), `.skeleton--feature-icon` (`--space-6` circle matching tier card feature-icon shape). Bumped skeleton count `Array(2)` → `Array(3)` to match the most common 3-tier reality. Removed unused `.skeleton--badge` selector (ribbons don't render on skeletons).
  - **Featured skeleton**: middle card (`i === 1`) gets `.card-shell--featured` with the same brand-tint gradient + extra top padding as the real featured card — loading state hints at the final recommendation hierarchy.
  - **Accessibility on loading**: `aria-busy="true"` + `aria-label="Loading subscription plans"` on the skeleton tier-stage; `aria-hidden="true"` on all decorative spans already in place.
  - **Skeleton shell chrome upgrade**: bumped from `blur(--blur-md)` + `40% border` + `shadow-sm` to match the real card's `blur(--blur-xl)` + `60% border` + `shadow-md` + inner-highlight inset. Shells now share visual language with their eventual content, preventing a layout/material jump on load.
  - **Skeleton reduced-motion guard**: new `@media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } }` — was already disabled by the global motion.css override, but an explicit guard documents the intent.
  - **Orphan CSS audit**: confirmed zero orphan class selectors remain (`section-heading`, `faq-container`, `content-preview`, `preview-grid/thumb/overlay/text`, `trust-bar/signal/divider`, `preview-visible` all gone from both template and CSS).
  - **Focus-visible audit**: all interactive elements covered — `.toggle-option`, `.accordion-trigger`, `.preview__cta`, `.sticky-bar__dismiss` have `:focus-visible { box-shadow: var(--shadow-focus-ring); }`. Buttons use the shared component's own handling. No gaps.

  - **Next pass prerequisite**: Visual smoke test of the loading state — refresh the page with network throttling to confirm the 3-shell skeleton (with featured middle) matches the final card count + featured position most of the time. Verify in Firefox (older version without backdrop-filter support) that the fallback solid surfaces look acceptable. Also scan for any lingering visual regressions on ultrawide (2560px+) viewports — the `--container-max: 72rem` cap should prevent sprawl.

- **2026-04-17 Pass 9 (Copy tightening — defaults)**: Rewrote the hard-coded `DEFAULT_FAQ` array and the FAQ lede for conversion-focused voice.
  - **FAQ eyebrow**: "The fine print" → "Before you subscribe". Removed the negative legal-gotcha connotation and reframed as pre-purchase reassurance. Pairs with the existing title ("Questions, answered.") to form a narrative: *Before you subscribe → Questions, answered.*
  - **FAQ subtitle**: "The short version — plus room for anything the creators want you to know." → "The questions we hear most — answered straight." Cleaner, more declarative; "answered straight" sets voice expectation.
  - **DEFAULT_FAQ reordering + rewrite** — ordered by conversion priority (lead with value, then friction, end with trust):
    1. *When does my access start?* — lead with the delivered value. "Immediately. The moment your payment confirms, every title included in your tier unlocks — no waiting period, no activation email to hunt down." (vs "Do I get instant access after subscribing?" + generic "yes" answer)
    2. *Can I cancel anytime?* — commitment reassurance. Specific: "Cancel from your account in a couple of clicks and you keep access through the end of the billing period you have already paid for."
    3. *Can I switch plans later?* — flexibility reassurance. Adds "the price difference is handled automatically" to address a common unknown.
    4. *Is my payment secure?* — trust finale. Rewrote from "what payment methods" (trust question masquerading as payment-options question) to the underlying concern. Answer: "Every transaction is processed by Stripe, the same payment infrastructure used by Amazon, Shopify, and most of the internet. The creators never see your card details." — social proof via brand anchoring + concrete privacy promise.
  - **Why this order matters**: opens with "you get everything immediately" (the benefit), moves through "you can leave / you can change" (removing friction), lands on "your payment is safe" (final trust lock). Reads like a short sales argument top-to-bottom, not an alphabetized FAQ.
  - **Override mechanism preserved**: orgs that customize their FAQ via the Studio editor see their own content — these defaults only appear for unconfigured orgs, which are also the orgs least likely to have their own conversion copy. Biggest leverage ships here.

  - **Next pass prerequisite**: Visual verify end-to-end (boot `pnpm dev`, scroll through on both desktop + mobile emulation, confirm reveal timings, check dark mode). This is the biggest outstanding debt — 9 passes of code polish without a single browser check. Also consider: preview section's `if withThumbs.length >= 3` hard-gate (section disappears entirely below 3 items) may be too strict; a 1-2-item fallback could still convert.

- **2026-04-17 Pass 10 (Checkout error treatment)**: Upgraded the flat red banner into a proper editorial alert.
  - **Structure**: single `<p>` wrapped in `<div>` → icon + body (title + message) + dismiss button. Template now renders `<AlertTriangleIcon>` in a tinted circle, a semibold "Something went wrong" title in the heading font, the actual error message beneath, and a rotating `XIcon` dismiss that clears `checkoutError`.
  - **Layout**: left-aligned flex row with `--space-3` gap; `max-width: 44rem` + `margin: 0 auto` so it doesn't sprawl on wide viewports. Matches the page's other max-widths (faq 48rem, preview footer 44rem).
  - **Visual hierarchy**: left-edge accent (`--border-width-thick` in `--color-error-600`) — standard design-system device for "read this" (used by Material, Ant, IBM Carbon). Surface softened via `color-mix(--color-error-50, 92%, --color-surface)` so it blends rather than screams. Shadow + inner highlight for a little lift.
  - **Icon treatment**: `--space-8` rounded squircle in `color-mix(--color-error-100, 80%, transparent)` with `--color-error-600` icon. Same squircle pattern as tier card feature icons and trust strip icons — consistent language across every icon-in-context on the page.
  - **Typography**: title uses `--font-heading`, `--text-sm`, semibold, tracking-tight. Message uses body font, same size, 0.9 opacity for subtle demotion.
  - **Dismiss button**: `--space-7` circle, rotates 90° on hover (motion guard for reduced-motion), uses `--shadow-focus-ring-error` for accessible focus styling (error-colored focus ring — semantic match to the surrounding context).
  - **Entrance**: `transition:fly={{ y: -12, duration: 220, easing: cubicOut }}` — drops down from the top briefly. Matches the sticky CTA's fly pattern but shorter + smaller y delta since error appears closer to where the user is looking.
  - **A11y**: `role="alert"` + `aria-live="polite"` (announces without interrupting), `aria-label="Dismiss error"` on the close button.
  - **State**: new inline `onclick={() => { checkoutError = ''; }}` gives users control — previously errors stayed until next attempt.

  - **Visual verify attempted**: Dev server was running on `:3000` but workers weren't (`:4001`, `:42069`, etc all closed). Navigation to `studio-alpha.lvh.me:3000/pricing` and `of-blood-and-bones.lvh.me:3000/pricing` returned the 404 "Organization not found" page — expected behavior when the org worker is unreachable. Seeded org slugs confirmed as `studio-alpha`, `studio-beta`, `of-blood-and-bones` (from `packages/database/scripts/seed/constants.ts`). **Next fire** should boot `pnpm dev` fully from the monorepo root to bring up all workers, then verify.

  - **Next pass prerequisite**: Full `pnpm dev` boot from monorepo root + visual walkthrough. Start with `of-blood-and-bones.lvh.me:3000/pricing` (terracotta brand — exercises the OKLCH color-mix paths nicely). Check: hero stagger, tier card ribbon/glow, preview spread, FAQ accordion, trust strip, sticky CTA on scroll past tier cards, error state if possible to trigger. Also check dark mode (toggle via `html.dark` or `?theme=dark`).

- **2026-04-17 Pass 11 (Preview fallback variants)**: Replaced the hard gate `if (withThumbs.length >= 3)` with count-adaptive spread layouts. Sparse-content orgs now get a properly-shaped preview section instead of the section disappearing entirely.
  - **Gate change**: condition flipped from `withThumbs.length >= 3` to `items.length > 0`. Any published content — even if none have thumbnails — renders the section with masthead + stats footer.
  - **Spread variants** via `--solo` / `--pair` / `--trio` / `--magazine` modifier classes. Variant chosen inline via `{@const spreadVariant = tiles.length === 1 ? 'solo' : ...}`.
  - **Solo (1 tile)**: mobile = full-width 16:9 hero. md+ = full-width 16:7 cinematic hero, single column, zero gap.
  - **Pair (2 tiles)**: mobile = 2-col 4:3 grid (inherits default). md+ = 2-col 16:7 aspect with `--space-1` gap.
  - **Trio (3 tiles)**: mobile = 1 full-width 16:9 hero (tile 0 spans full row) + 2 supporting 4:3 tiles below. md+ = 1.8fr/1fr 2-row grid, aspect 5:3, hero spans both rows — echoes the magazine shape at reduced density.
  - **Magazine (4+ tiles)**: unchanged — now explicitly scoped to `.preview__spread--magazine` instead of bare `.preview__spread`.
  - **Zero-tile fallback**: if `tiles.length === 0`, the `<div class="preview__spread">` is skipped entirely (wrapped in `{#if tiles.length > 0}`). The section still renders masthead + stats + CTA — the value prop still sells, just without a blur wall that reveals nothing.
  - **Layout principle**: every variant preserves the hero-anchor feel (always a dominant hero tile, supporting tiles balanced around it). Mobile always has a clear "main" tile. No variant wastes space with half-empty grid cells.

  - **Next pass prerequisite**: Visual verify the four variants at mobile + md+ widths once `pnpm dev` is fully booted. Specifically: does solo's 16:7 aspect feel too cinematic on desktop (may need to cap at 16:8 for a less-wide feel)? Does trio's mobile hero + supports ordering read naturally? Are the gaps consistent across variants? Also check: what happens when `items.length > 0` but all thumbnails fail to load (broken URLs)? Current code only filters out null `thumbnailUrl` — broken images would show alt text or a broken-image icon.

- **2026-04-17 Pass 12 (Visual verification + bug fixes)**: Workers came up this fire, so I finally walked the live page. Screenshot session at `of-blood-and-bones.lvh.me:3000/pricing` (terracotta `#f47d67` brand) in dark mode. Findings:
  - **Overall**: the 11 prior passes land. Editorial mastheads render with proper eyebrow → rule → display title → subtitle rhythm. Tier cards show ribbon + brand-tinted featured surface + brand-colored price on the recommended card. Preview spread renders with hero cactus photo + 3 supporting tiles, all with article-type badges. FAQ shows the Pass-9 rewritten defaults ("Before you subscribe" eyebrow, "When does my access start?" as first item, etc). Trust strip has tinted icon circles and brand dot dividers. Sticky CTA appears correctly when tier cards fully leave the viewport — floating pill with "MOST POPULAR" eyebrow, name · price, filled Subscribe button, rotating X dismiss.
  - **Bug fixed — `//mo` double slash**: tier card price interval was rendering as `£15.00//mo` because the Paraglide message `pricing_per_month` already returns `/mo` (with leading slash) and my Pass 2 template prepended another `/`. Removed the hard-coded `/` in the template; now renders `£15.00/mo` correctly. Single location in the tier card; sticky bar was unaffected (uses literal `'mo'`/`'yr'`).
  - **Tuning — section rule opacity**: the `*__rule` gradient hairline at 55% brand-primary was visually lost on dark mode over the brand-tinted hero backdrop. Bumped to 72% across all four sections (`.pricing-hero__rule`, `.preview__rule`, `.faq__rule`, `.trust__rule`) via a `replace_all: true` on the shared `color-mix(..., 55%, transparent)` snippet. 1px thickness is still the ceiling for perceptual visibility on dark mode — but the rule now reads as *there* rather than *maybe there*.
  - **Sticky CTA behavior confirmed**: `threshold: 0` on the tier-cards observer means sticky only appears when cards are fully off-screen (any pixel = intersecting). Initially I thought this was a bug (sticky not showing at scroll 750 when cards bottom=189 was still in viewport), but it's correct — at scroll 1500+ with cards fully off-screen, sticky appears with proper brand-glow shadow.
  - **Reveal system working**: scrolled to bottom, all 3 `[data-reveal]` sections (preview, FAQ, trust) got `reveal--visible` class. Rules then scaleX-expand via the 150ms-delayed child transition. Pass 7 architecture validated.
  - **Screenshots saved**: `.claude/pricing-hero-clean.png`, `.claude/pricing-tiers.png`, `.claude/pricing-sticky-visible.png`, `.claude/pricing-fullpage.png`. Viewport: 1440×900.

  - **Next pass prerequisite**: Light-mode verify (current was dark mode only). Also verify on narrower viewports (< 1024px, < 768px, < 640px) to confirm all breakpoint transitions work. Then consider: at very wide (≥ 1920px) viewports, does the hero feel underfilled? Might want a max-width cap on the hero content so it doesn't stretch absurdly wide. Also: test the Annual toggle click to confirm the savings pill bounce animation fires.

- **2026-04-17 Pass 13 (Mobile + light mode verify, tick() fix)**: Continued live visual verification across Annual toggle, mobile viewport, and a light-mode org. Found one critical timing bug and fixed it.
  - **Annual toggle verified**: Clicking Annual fires the savings pill (`Save 20%` in success-green) with the `savingsBounce` keyframe. Tier cards update: amounts switch to yearly totals, `−N%` inline discount pills appear beside prices, helper lines change from "Save N% when billed annually" to "£X.XX/mo · billed annually". All correct.
  - **Mobile verified (viewport 500×844)**: hero stacks compactly, tier cards become single-column stack with `MOST POPULAR` ribbon overhanging middle card, magazine preview renders as 2×2 grid, FAQ collapses to narrower width, trust strip stacks vertically (dots hidden per `@media (--below-sm)`). Mobile sticky bar is always-visible edge-to-edge via `.sticky-bar--mobile`. No layout breakage at any breakpoint.
  - **CRITICAL FIX — preview reveal not firing after stream resolves**: on mobile I noticed the preview section was stuck at `opacity: 0` even after scrolling past it. Debug probe confirmed: `.reveal--visible` class wasn't being added to `.preview` (was being added to `.faq` and `.trust` fine). Root cause: Pass 7's `Promise.resolve(data.contentPreview).finally(observeReveals)` callback ran BEFORE Svelte flushed the `{#await data.contentPreview}` block's post-settle DOM update, so `querySelectorAll('[data-reveal]')` didn't find the preview section. Fix: `await tick()` before `observeReveals()` inside both promise `.finally()` callbacks. `tick()` waits for Svelte's reactive DOM updates to apply. Now all three sections reveal correctly.
  - **Light mode verified (Studio Alpha, rose brand)**: navigated to `studio-alpha.lvh.me:3000/pricing` which has `--brand-bg` = light surface. Renders beautifully — white background, rose-pink brand accents, gradient hairline rule newly visible at 72% (Pass 12 bump paying off here too), brand-tinted featured card with ribbon, filled primary CTA on featured tier. Hero backdrop's gradient mesh is subtle but present (fades from brand-tinted edges to white center).
  - **Dark-mode-locked orgs**: `of-blood-and-bones` has `--brand-bg-dark` set without `--brand-bg` light equivalent, so `[data-theme='light']` on html doesn't override the org's chosen dark aesthetic. That's creator intent, not a bug — the pricing page respects the org's branding.
  - **Screenshots**: `.claude/pricing-annual.png`, `.claude/pricing-mobile-fixed.png`, `.claude/pricing-studio-alpha.png`.

  - **Next pass prerequisite**: Test narrow viewport sticky CTA — on mobile, sticky is full-bleed always-visible; check that it doesn't cover tier card Subscribe buttons when cards are in view (might need bottom padding on `.pricing-page` that accounts for sticky height). Also test keyboard-only navigation across the whole page (tab through eyebrow → toggle → cards → accordion → trust → sticky dismiss → CTA). Consider: should the sticky price also show a monthly-equivalent helper line when Annual is active? Currently shows `£49.90/yr` only, which is less mentally-anchorable than the tier cards' full price + helper stack.

- **2026-04-17 Pass 14 (Sticky CTA annual helper)**: Added the monthly-equivalent helper line to the sticky CTA when Annual is active.
  - **Problem**: on Annual, sticky showed just `£49.90/yr` — no mental anchor to the more familiar monthly unit. Tier cards show the full stack (yearly price + monthly-equivalent helper + "billed annually"). Sticky should match for consistency.
  - **Template**: added conditional `<span class="sticky-bar__helper">` after `.sticky-bar__headline` — renders when `billingInterval === 'year' && recommendedTier.priceAnnual > 0`. Content: `£{(priceAnnual / 1200).toFixed(2)}/mo · billed annually`.
  - **Style**: `--text-xs`, `--font-medium`, `--color-text-muted`, `--tracking-tight`, `--leading-tight`, `margin-top: --space-0-5`. Same visual weight as the tier card helper; sits right below the `name · price` headline row.
  - **Verified**: toggled between Monthly and Annual in-browser. Monthly shows the standard `name · £X/mo` headline, no helper. Annual shows `name · £X/yr` headline + helper line underneath.
  - **Conversion logic**: now when a user is deep in Annual, the sticky gives them the full context — yearly commitment, monthly-equivalent, billing cadence — without them having to scroll back to the cards. The decision moment stays anchored.

  - **Next pass prerequisite**: Keyboard-only navigation audit. Tab through the page and verify focus rings render at every stop: toggle buttons → tier card CTAs → preview "Browse the catalogue" link → accordion triggers → sticky Subscribe → sticky dismiss → trust icons (no focus needed, non-interactive). Also: check that Escape key doesn't break anything unexpectedly (the accordion uses Melt UI which should handle Escape natively). Consider: should the savings pill "Save 20%" be a focusable button that clicks Annual? Currently it's decorative text inside the Annual toggle button.

- **2026-04-17 Pass 15 (Keyboard focus ring a11y fix)**: Keyboard audit surfaced a silent focus ring failure on toggle buttons + preview CTA.
  - **Bug**: Two elements had `:focus-visible { outline: none; box-shadow: var(--shadow-focus-ring); }` — but the corresponding `:active` / `:hover` rules also set `box-shadow` with the same `(0,0,2,0)` CSS specificity. Source order determined the winner, and in both cases the state rule came after focus-visible, silently overriding the focus ring with the active/hover shadow. Result: focused-but-active Monthly toggle had NO visible focus ring. Same for `.preview__cta:hover` when also focused.
  - **Diagnosis**: in-browser script dispatched `el.focus({ focusVisible: true })`, then checked `getComputedStyle().boxShadow`. Toggle's focus-visible rule was matched (`matches(':focus-visible') === true`) but the rendered shadow was the `.active` state's shadow, not the focus ring. Confirmed the source-order cascade issue by grep: `.toggle-option:focus-visible` at line 862, `.toggle-option.active` at line 867.
  - **Fix**: swapped from `outline: none; box-shadow: var(--shadow-focus-ring)` to `outline: var(--border-width-thick) solid var(--color-focus); outline-offset: var(--space-0-5)`. Outline is independent of box-shadow, so active/hover state styles never conflict. Applied to both `.toggle-option:focus-visible` and `.preview__cta:focus-visible`.
  - **Verified**: re-ran the focus probe after reload. All three focusable elements (Monthly, Annual, Browse the catalogue) render `outline: 2px solid var(--color-focus)` with `outline-offset: 2px`. 
  - **Not affected**: `.accordion-trigger:focus-visible`, `.sticky-bar__dismiss:focus-visible`, `.checkout-error__dismiss:focus-visible` all use the box-shadow pattern but their corresponding hover states don't set box-shadow — so no conflict. Left as-is.
  - **Side note**: `--color-focus` resolves to `#EF4444`-ish on this dev setup (may be a seed-data quirk where the test orgs share a similar primary). Regardless, the ring renders visibly against any surface.

  - **Next pass prerequisite**: Deeper a11y audit — check accordion keyboard behavior (Arrow up/down to navigate between triggers, Home/End to jump to first/last, Enter/Space to toggle). Melt UI should provide this natively. Also: axe-core scan or Lighthouse accessibility audit to catch anything I missed (missing aria labels, color contrast on brand-tinted text, etc). Consider: is the billing toggle `role="radiogroup"` + `role="radio"` semantics correct? Radio groups usually have Arrow Left/Right key navigation — does that work with Melt's toggle or is the toggle custom?

- **2026-04-17 Pass 16 (Billing toggle ARIA radiogroup semantics)**: Completed the WAI-ARIA radiogroup pattern on the billing toggle.
  - **Pre-existing gap**: markup had `role="radiogroup"` + `role="radio"` + `aria-checked` but lacked (a) roving tabindex (Tab landed on BOTH buttons, not the canonical "one stop per group"), and (b) arrow-key navigation (Arrow Left/Right/Up/Down should move between radios + toggle the selection). Without these, screen reader users would announce the toggle as a radiogroup but keyboard behavior didn't match the role's implied contract.
  - **Implementation**:
    - **Roving tabindex**: `tabindex={billingInterval === 'month' ? 0 : -1}` on Monthly, inverse on Annual. Tab now enters the group exactly once — lands on the currently-checked radio, skips the unchecked one.
    - **Arrow-key handler**: new `handleBillingKey(e: KeyboardEvent)` function wired via `onkeydown` on the radiogroup wrapper. Arrow Right/Down → switch to Annual; Arrow Left/Up → switch to Monthly. Swaps `billingInterval` state, then `queueMicrotask(() => target.focus())` to shift keyboard focus to the newly-checked option after Svelte updates the DOM.
    - **`tabindex={-1}` on the group wrapper**: required by Svelte's a11y linter when an element has `role="radiogroup"` — ensures the group can receive programmatic focus if ever needed but isn't in the tab sequence (the radios handle that via their roving tabindex).
  - **Verified in-browser**:
    - Initial: Monthly `tabindex=0 aria-checked=true`, Annual `tabindex=-1 aria-checked=false`.
    - After ArrowRight dispatch: Monthly `tabindex=-1 aria-checked=false`, Annual `tabindex=0 aria-checked=true`, `document.activeElement` = Annual. 
    - After ArrowLeft dispatch: fully reverts, focus back on Monthly.
  - **Screen reader impact**: NVDA/VoiceOver/JAWS will now announce "billing period, radio group, monthly, 1 of 2, selected" when entering the group via Tab, and arrow keys will announce the transitions. Prior implementation announced the role but behaved like two independent buttons.

  - **Next pass prerequisite**: Accordion keyboard behavior audit — test Arrow Up/Down (Melt UI should provide this natively for `<Accordion.Root>`), Home/End, Enter/Space. Lighthouse or axe-core full-page a11y scan. Also check the tier card CTAs — the Button component's built-in focus styling should suffice, but verify there's no regression after the recent focus-visible refactor.

- **2026-04-17 Pass 17 (Ribbon shine micro-interaction)**: Added a one-shot diagonal shine sweep on the "Most Popular" ribbon to draw the eye to the recommended tier after page load.
  - **Why**: after 16 passes the page renders well, but entrance animations on all three tier cards use the same `cardReveal` keyframe with just a per-card delay. No visual cue distinguishes the recommended tier's *arrival*. The ribbon is the hierarchy anchor — a one-shot shine there, fired 1.2s after page load (after all card stagger completes), gives a final flourish without turning the page into a nightclub.
  - **Implementation**: `::after` pseudo on `.card__ribbon` with a 120° white gradient (transparent 25% → `color-mix(white, 38%, transparent)` 50% → transparent 75%) and `mix-blend-mode: overlay`. Translates from `translateX(-160%)` to `160%` over 2.2s with `--ease-smooth`. Runs once. `border-radius: inherit` keeps the sweep clipped to the pill shape, plus `overflow: hidden` on the ribbon.
  - **Blend mode choice**: `overlay` lightens light pixels, darkens dark ones — so the white shine reads correctly whether the brand is red, blue, or lavender. On a white ribbon (if ever) it'd be more muted; on a saturated brand pill it's a subtle highlight sweep without ever blowing out.
  - **Reduced motion**: wrapped in `@media (prefers-reduced-motion: no-preference)` — users with reduced-motion preference never see the pseudo-element at all.
  - **Timing choice**: 1.2s delay is after `cardReveal`'s max stagger (`120ms * 3 = 360ms` + 550ms duration ≈ 900ms, plus a ~300ms breather). The shine therefore lands AFTER the cards have finished arriving — a sequential choreography: cards arrive, then the eye is directed to the recommended one.
  - **Ribbon now has `overflow: hidden`**: required for the pseudo to be clipped to the pill silhouette. Pre-existed in the ribbon styling? No — I added it. Edge case: if ribbon text ever wraps (unlikely — `white-space: nowrap` is set), overflow hidden would truncate. But with nowrap + short "Most Popular" copy, safe.

  - **Next pass prerequisite**: Accordion arrow-key nav audit (Melt UI should provide Home/End/Arrow), then full-page Lighthouse/axe-core scan to catch any contrast issues on the brand-tinted pills/labels. Also consider: at the moment the ribbon shine fires, is the card already "settled"? If not, the shine may feel premature. Timing may need adjustment based on observed feel (currently open-loop — user-subjective judgment).

- **2026-04-17 Pass 18 (Savings pill repurposed as lure)**: Corrected a conversion-logic inversion on the billing toggle's "Save 20%" pill.
  - **Inverted problem**: the pill used to show only when `billingInterval === 'year'` — i.e. as a confirmation AFTER the user had already selected Annual. Pointless in that direction: the user already got the deal, why tell them "Save 20%"? The pill should be an INCENTIVE, visible when they're on Monthly so they see "Save 20%" on the Annual button and feel the pull.
  - **Flipped condition**: `{#if billingInterval === 'month' && maxAnnualSavings > 0}`. Pill now appears inside the Annual button when user is on Monthly. Clicking the Annual button (or the pill inside it — bubbling) commits. When Annual active, pill unmounts — no redundant badge on the already-selected option.
  - **Computed copy**: hardcoded `Save 20%` replaced with `Save {maxAnnualSavings}%`. New `$derived` computes `Math.max(0, ...tiers.map(savingsPercent))` across all tiers — so if a creator's tiers save 12/17/20%, the pill advertises the max (20) honestly. Falls back gracefully: if no tiers or all zero savings, pill doesn't render (guard: `> 0`).
  - **Entrance animation still works**: the `savingsBounce` keyframe fires when the element renders. On initial Monthly load, the pill bounces in 1.5× the normal duration with `--ease-bounce` — draws attention right as the hero stagger completes.
  - **Verified in-browser**: reload → Monthly active + `Save 20%` pill visible on Annual button. Click Annual → Annual active + pill unmounted + card prices switch to yearly totals + helper lines show monthly-equivalents. Full conversion chain: lure → commit → reassurance.

  - **Next pass prerequisite**: Consider: when pill is on Monthly-visible state, should there be a micro-animation to draw further attention (gentle pulse every few seconds)? Probably not — would be annoying. But worth noting as a future experiment if CTAs aren't converting. Alternative: add a subtle "shimmer" on the pill that matches the ribbon shine but slower, fires once on initial load only. Also: when switching back from Annual to Monthly, the pill re-appears via the render condition — maybe add a slight fade-in to avoid abrupt appearance.

- **2026-04-17 Pass 19 (Lighthouse a11y 100)**: Ran Chrome DevTools Lighthouse snapshot audit against the live page (of-blood-and-bones.lvh.me:3000/pricing, dark mode, desktop). Initial scores: Accessibility 96, Best Practices 100, SEO 100. One failing audit: `color-contrast`.
  - **Failing item**: inactive `.toggle-option` button — foreground `#717171` on background `#1e0605` = contrast ratio 3.97, below WCAG AA's 4.5 threshold for normal-weight 15px body text.
  - **Root cause**: `--color-text-muted` derives via `oklch(from brand-bg-dark clamp(0.3, abs(0.5 - l) + 0.3, 0.55) 0 0)`. On this org's very-dark brand bg, the clamp produces a mid-gray at ~45% luminance — fine on pure black, insufficient contrast on near-black-but-slightly-lit surfaces like `#1e0605`.
  - **Fix**: moved inactive `.toggle-option` color from `--color-text-muted` → `--color-text-secondary`, and hover from `--color-text-secondary` → `--color-text`. New hierarchy: resting secondary (`#d4d4d4`, ~11:1 on dark bg — AAA), hover full text (`#fafafa`), active full text on brand-tinted pill. Two distinct visible text weights (resting vs active/hover) + the BG pill difference = clear affordance.
  - **Kept token-driven**: didn't hardcode a color. The fix uses the higher-contrast semantic token that the design system already provides — works across all themes (light, dark, brand-branded) without bespoke rules.
  - **Verified post-fix**: re-ran Lighthouse audit. Accessibility: **100**. Best Practices: **100**. SEO: **100**. 34 passed, 0 failed.
  - **Scope note**: a broader fix would address `--color-text-muted` derivation in `org-brand.css` so it never drops below AA — but that's a system-level change affecting every page. The pricing-page-local fix is the right scope for this pass.

  - **Next pass prerequisite**: the same `--color-text-muted` issue could appear on other elements throughout the app (e.g., card helpers, trust labels, faq subtitles). A follow-up org-wide pass could audit all `--color-text-muted` usages against the dark-mode org backgrounds and fix the systemic issue. Within this file: spot-check that `.card__price-helper`, `.trust__label`, `.sticky-bar__helper`, `.preview__stat-label`, and `.preview__categories li` — all using muted — still render with sufficient contrast against their containers (they should since they sit on the same dark surface and may not have the contrast issue depending on exact computed color mix).

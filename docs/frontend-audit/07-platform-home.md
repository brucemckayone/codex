# 07 — Platform Home

## Scope

The platform landing page served from `lvh.me` (no subdomain):

| File | Lines | Role |
|---|---:|---|
| `apps/web/src/routes/(platform)/+page.svelte` | 177 | Hero + features landing |
| `apps/web/src/routes/(platform)/+page.server.ts` | 10 | `CACHE_HEADERS.STATIC_PUBLIC` — 1 hour edge cache |
| `apps/web/src/routes/(platform)/+layout.svelte` | 112 | SidebarRail + PageContainer + Footer + mobile nav (audited properly in Section 22) |

The landing page has two sections — **Hero** (title, tagline, 2 CTAs) and **Features** (3-card grid). No streamed data, no collections, no SEO schema beyond basic OG tags. Pure static marketing.

## CSS modernity

### In use — good

- **Custom media queries** (`@media (--breakpoint-md)`) drive the 1→3 column feature grid (line 142).
- **Modern grid + flex** — `.feature-grid` is CSS grid, `.cta-group` is flex with `flex-wrap` so buttons stack on narrow viewports.
- **`text-wrap` from base rules** flows down automatically (`theme/reset.css` sets `text-wrap: balance` on headings).
- **`aria-hidden="true"`** on decorative feature icons (lines 34, 41, 48) — clean a11y.
- **Semantic sectioning** — `<section class="hero">`, `<section class="features">`, proper `<h1>`/`<h2>`/`<h3>` hierarchy.

### Gaps

- **No container queries** even though this could be a reusable landing pattern. Each `.feature` card stretches/shrinks with the viewport directly via the grid, which is fine here but doesn't compose if the card ever appears in a narrower container.
- **Hero padding `var(--space-16) 0`** is constant across mobile and desktop. `var(--space-16)` is 64px — reasonable on desktop, excessive on a 320px-wide phone. Fluid padding via `clamp()` or a `--below-sm` reduction would read better on small screens.
- **No motion/entrance animations**. The landing is static. Reasonable for accessibility but some subtle fade/slide on hero would help the brand.

## Inheritance & reuse

### Reuse violations — the page re-implements two primitives that already exist

Verified that the UI primitive library (`components/ui/Button/`, `components/ui/Card/`) exports:

- **`Button`** with `variant: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'accent'`, `size: 'sm' | 'md' | 'lg'`, and `loading` state (`Button.svelte:19,26`).
- **`Card`** + `CardHeader`, `CardTitle`, `CardContent`, `CardDescription`, `CardFooter` sub-components.

The landing page instead hand-rolls both:

| Reinvention | Lines | What the existing primitive offers |
|---|---|---|
| `.cta` / `.cta-primary` / `.cta-secondary` (lines 93-121) | 29 lines of CSS | `<Button variant="primary">` + `<Button variant="secondary">` — plus loading states, size variants, `disabled` handling, focus rings matched to the token system |
| `.feature` card pattern (lines 148-154) | 7 lines of CSS | `<Card>` with `CardHeader`/`CardTitle`/`CardContent` for consistent padding, border, radius, and dark-mode behaviour |

The impact is subtle but real: if the design team later tunes button padding or card shadow across the app, the landing page doesn't follow suit. And any a11y improvement made to `Button.svelte` (focus-visible treatment, aria-busy for loading, etc.) bypasses the landing CTAs.

### i18n drift

The **body** of the page uses Paraglide: `{m.landing_hero_title()}`, `{m.landing_feature_curated_desc()}` — eight i18n calls.

The **head** (lines 9-18) uses hardcoded English: `<title>`, `<meta name="description">`, `<meta property="og:title">`, `<meta property="og:description">`, `<meta name="twitter:title">`, `<meta name="twitter:description">`.

For a platform that ships i18n infrastructure, the SEO metadata is the first thing a non-English user's browser sends to Google Translate. Moving the head strings to `m.*()` calls closes the drift.

### Token adoption

One hardcoded value in the styles:
- **Line 82**: `.tagline { max-width: 36rem; }` — 576px prose width. Not grievous (36rem at 16px is a reasonable measure), but `--container-sm: 40rem` and the global `max-width: 65ch` pattern used elsewhere (`global.css:75` on `p`) suggest a centralised "prose-width" token would be clearer.

Everything else is token-referenced — spacing, colours, radius, fonts, easings. This page was clearly authored with the token system in mind; the component-reuse gap feels more like *pre-existing landing page that got tokenised* than a conscious bypass.

### Hero title redundant with element styles

Lines 68-75 re-declare heading styles that `theme/base.css:36-46` already provides for `h1`:

| Declaration | Landing page | `theme/base.css` |
|---|---|---|
| `font-family: var(--font-heading)` | line 69 | line 37 |
| `font-weight: var(--font-bold)` | line 71 | line 38 |
| `color: var(--color-text)` | line 72 | `var(--color-text-primary)` on line 40 (caveat: two aliases for same value — see 2.6) |
| `line-height: var(--leading-tight)` | line 73 | line 39 |
| `letter-spacing: var(--tracking-tight)` | line 74 | line 45 |
| `font-size: var(--text-4xl)` | line 70 | line 44 |

Six rules perfectly duplicating `theme/base.css`'s `h1`. This is likely defensive — at some past point, the cascade wasn't reliable, so the landing page set everything explicitly. But it means if `h1` base styles change, the landing page silently doesn't follow.

Ditto lines 127-134 for the `.features-title` `<h2>`. Same pattern.

**Recommendation**: drop the redundant declarations. Let `theme/base.css` own the typography defaults; only keep `margin-bottom` (the one genuinely page-specific rule) and `text-align: center` on the features title. The cascade will do the rest.

## Wasted code

- **Double blank line at line 162-163** — cosmetic, not code, but flags a lost edit.
- **Hero `<meta property="og:type" content="website">`** duplicates the same declaration in the root layout's `<svelte:head>` (already in `+layout.svelte:75`). Browsers take the last one, so not a bug, but redundant.
- **`aria-hidden="true"`** on the three feature icons is correct, but the parent `<div class="feature-icon">` is sized with `width/height: var(--space-12)` even though the icon inside is `size={24}` (24px). At `--space-12 = 48px`, there's 12px of transparent padding around each 24px icon. Intentional visual breathing room — not waste, just noting the gap.

No unused CSS found in this file (grep confirms no orphaned selectors).

## Simplification opportunities

Ranked by impact/effort:

1. **Swap inline CTAs for `<Button>`** — import `Button` from `$lib/components/ui`, replace `<a class="cta cta-primary" href="/discover">` with `<Button href="/discover" variant="primary">`. Assuming Button supports `href` (check in Section 21); otherwise wrap the Button in an `<a>`. Kills ~29 lines of CSS.
2. **Swap inline `.feature` cards for `<Card>`** — similar pattern. Likely shrinks markup and wins consistency with the rest of the app.
3. **i18n-ise the head** — move `<title>`, descriptions, and OG/Twitter text to Paraglide messages. If there are locale-specific landing translations, this unlocks them.
4. **Drop redundant heading rules** — delete 5 duplicated declarations on `.hero-title` and `.features-title`, keep only page-specific ones (`margin-bottom`, `text-align`).
5. **Fluid hero padding** — use `padding: clamp(var(--space-8), 8vw, var(--space-16)) 0` so mobile breathes better.
6. **Consider centralising prose max-width** — a `--prose-max-width` token would unify `.tagline`'s 36rem with the app-wide `max-width: 65ch` pattern on `<p>`.

## Findings

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| 7.1 | Medium | `.cta` / `.cta-primary` / `.cta-secondary` (29 lines, 177:93-121) re-implement the `Button` primitive's `primary` and `secondary` variants | Swap inline classes for `<Button variant="primary" href="...">` |
| 7.2 | Medium | `.feature` cards (lines 148-154) re-implement the `Card`/`CardHeader`/`CardTitle`/`CardContent` primitive | Swap for `<Card>` composition |
| 7.3 | Medium | `<svelte:head>` hardcodes English strings; body uses Paraglide | Add `m.landing_head_title()` etc. and replace inline strings |
| 7.4 | Low | `.hero-title` (lines 68-76) redeclares 5 properties already owned by `theme/base.css:36-46` for `<h1>`; same for `.features-title` re: `<h2>` | Remove redundant declarations, keep only page-specific margin/align |
| 7.5 | Low | `.tagline { max-width: 36rem }` is a hardcoded measure; elsewhere the app uses `max-width: 65ch` on `<p>` | Pick a convention — a `--prose-max-width` token, or adopt `65ch` universally |
| 7.6 | Low | Hero `padding: var(--space-16) 0` is fixed on all viewports — 64px on mobile is cramped | Use `clamp(var(--space-8), 8vw, var(--space-16))` |
| 7.7 | Low | `<meta property="og:type" content="website">` is already declared in root layout | Remove the duplicate |
| 7.8 | Low | Double blank line at `+page.svelte:162` | Cosmetic cleanup |

## Quantitative summary

- **File size**: 177 lines — reasonable for a landing page.
- **Token compliance**: ~95%. Only `36rem` tagline max-width is a raw value.
- **Component reuse**: **mid-tier**. Two primitive reinventions (Button, Card) are the biggest drag on this otherwise well-authored page. Fixing them would save ~35 lines of CSS and align the landing with every other place buttons and cards appear.
- **i18n coverage**: body = complete, head = zero. Mixed.
- **Modern-CSS usage**: appropriate for content complexity. No container queries or `:has()` — correct calls for a flat two-section marketing page.

## Next section

08 — Platform discover (`(platform)/discover/`) — the first content-bearing route.

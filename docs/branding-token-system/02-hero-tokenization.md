# WP-02: Hero Section Tokenization

## Goal

Replace all 21 hardcoded `white`/`black`/`color-mix(white ...)` values in the org landing hero section with CSS custom properties that fall back to the current values. Implement the blend mode choice for the hero title.

## Depends On

- WP-01 (Foundation) — hero token keys need to exist in BRAND_PREFIX_KEYS
- WP-09 (CSS Injection) — hero keys must be registered before the brand editor can use them

## Background

The hero section in `apps/web/src/routes/_org/[slug]/(space)/+page.svelte` renders over the ShaderHero canvas. All text uses literal `white` or `color-mix(in srgb, white X%, transparent)` because the shader background is always dark/colorful. This makes hero text completely non-configurable.

The hero title uses a special `mix-blend-mode: difference` technique — white text that inverts against whatever is behind it, guaranteeing readability. This should be optionally replaceable with a solid color via a segmented control.

## Token Mapping

| Token Key | CSS Property | Default Value | Used By |
|---|---|---|---|
| `hero-text` | `--brand-hero-text` | `white` | Description, pills, stat numbers, base hero text |
| `hero-text-muted` | `--brand-hero-text-muted` | `white` | Stat labels, category pills (used at reduced opacity) |
| `hero-title-color` | `--brand-hero-title-color` | `white` | Hero title `<h1>` |
| `hero-title-blend` | `--brand-hero-title-blend` | `difference` | Hero title `mix-blend-mode` |
| `hero-cta-bg` | `--brand-hero-cta-bg` | `white` | Primary CTA button background |
| `hero-cta-text` | `--brand-hero-cta-text` | `color-mix(in oklch, var(--color-brand-primary) 75%, black)` | Primary CTA button text |
| `hero-glass-tint` | `--brand-hero-glass-tint` | `white` | Glass CTA background tint, play button |
| `hero-glass-text` | `--brand-hero-glass-text` | `white` | Glass CTA text |
| `hero-border-tint` | `--brand-hero-border-tint` | `white` | Pill borders, stat divider line |

---

## Instructions

### Step 1: Add hero keys to BRAND_PREFIX_KEYS

**File**: `apps/web/src/lib/brand-editor/css-injection.ts`

Add these keys to the `BRAND_PREFIX_KEYS` set (in the Hero layout section, after `'hero-logo-scale'`):

```typescript
// Hero text and color tokens
'hero-text',
'hero-text-muted',
'hero-title-color',
'hero-title-blend',
'hero-cta-bg',
'hero-cta-text',
'hero-glass-tint',
'hero-glass-text',
'hero-border-tint',
```

### Step 2: Replace hardcoded hero CSS

**File**: `apps/web/src/routes/_org/[slug]/(space)/+page.svelte`

Each replacement wraps the current value in a `var()` with the current value as fallback. **The visual result must be identical when no override is set.**

#### `.hero` container (line ~421)
```css
/* BEFORE */
color: white;

/* AFTER */
color: var(--brand-hero-text, white);
```

#### `.hero__title` (line ~470-471)
```css
/* BEFORE */
color: white;
mix-blend-mode: difference;

/* AFTER */
color: var(--brand-hero-title-color, white);
mix-blend-mode: var(--brand-hero-title-blend, difference);
```

#### `.hero__description` (line ~479)
```css
/* BEFORE */
color: color-mix(in srgb, white 80%, transparent);

/* AFTER */
color: color-mix(in srgb, var(--brand-hero-text, white) 80%, transparent);
```

#### `.hero__pill` (lines ~493-498)
```css
/* BEFORE */
background: color-mix(in srgb, white 15%, transparent);
border: var(--border-width) solid color-mix(in srgb, white 20%, transparent);
color: white;

/* AFTER */
background: color-mix(in srgb, var(--brand-hero-border-tint, white) 15%, transparent);
border: var(--border-width) solid color-mix(in srgb, var(--brand-hero-border-tint, white) 20%, transparent);
color: var(--brand-hero-text, white);
```

#### `.hero__pill--category` (lines ~508-509)
```css
/* BEFORE */
color: color-mix(in srgb, white 75%, transparent);
border-color: color-mix(in srgb, white 15%, transparent);

/* AFTER */
color: color-mix(in srgb, var(--brand-hero-text-muted, white) 75%, transparent);
border-color: color-mix(in srgb, var(--brand-hero-border-tint, white) 15%, transparent);
```

#### `.hero__pill--category:hover` (line ~515)
```css
/* BEFORE */
color: white;

/* AFTER */
color: var(--brand-hero-text, white);
```

#### `.hero__pills-sep` (line ~523)
```css
/* BEFORE */
background: color-mix(in srgb, white 40%, transparent);

/* AFTER */
background: color-mix(in srgb, var(--brand-hero-border-tint, white) 40%, transparent);
```

#### `.hero__cta--primary` (lines ~555-558)
```css
/* BEFORE */
background: white;
color: color-mix(in oklch, var(--color-brand-primary) 75%, black);

/* AFTER */
background: var(--brand-hero-cta-bg, white);
color: var(--brand-hero-cta-text, color-mix(in oklch, var(--color-brand-primary) 75%, black));
```

#### `.hero__cta--glass` (lines ~566-568)
```css
/* BEFORE */
background: color-mix(in srgb, white 12%, transparent);
color: white;
border: var(--border-width) solid color-mix(in srgb, white 25%, transparent);

/* AFTER */
background: color-mix(in srgb, var(--brand-hero-glass-tint, white) 12%, transparent);
color: var(--brand-hero-glass-text, white);
border: var(--border-width) solid color-mix(in srgb, var(--brand-hero-glass-tint, white) 25%, transparent);
```

#### `.hero__cta--glass:hover` (lines ~572-573)
```css
/* BEFORE */
background: color-mix(in srgb, white 20%, transparent);

/* AFTER */
background: color-mix(in srgb, var(--brand-hero-glass-tint, white) 20%, transparent);
```

#### `.hero__follow--active` (lines ~581-582)
```css
/* BEFORE */
background: color-mix(in srgb, white 25%, transparent);
border-color: color-mix(in srgb, white 40%, transparent);

/* AFTER */
background: color-mix(in srgb, var(--brand-hero-glass-tint, white) 25%, transparent);
border-color: color-mix(in srgb, var(--brand-hero-glass-tint, white) 40%, transparent);
```

#### `.hero__play-center` (lines ~605-609)
```css
/* BEFORE */
background: color-mix(in srgb, white 12%, transparent);
border: var(--border-width) solid color-mix(in srgb, white 25%, transparent);
color: white;

/* AFTER */
background: color-mix(in srgb, var(--brand-hero-glass-tint, white) 12%, transparent);
border: var(--border-width) solid color-mix(in srgb, var(--brand-hero-glass-tint, white) 25%, transparent);
color: var(--brand-hero-glass-text, white);
```

#### `.hero__play-center:hover` (lines ~619-620)
```css
/* BEFORE */
background: color-mix(in srgb, white 20%, transparent);
box-shadow: 0 0 0 var(--space-3) color-mix(in srgb, white 8%, transparent);

/* AFTER */
background: color-mix(in srgb, var(--brand-hero-glass-tint, white) 20%, transparent);
box-shadow: 0 0 0 var(--space-3) color-mix(in srgb, var(--brand-hero-glass-tint, white) 8%, transparent);
```

#### `@keyframes hero-play-pulse` (lines ~640-641)
```css
/* BEFORE */
0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, white 15%, transparent); }
50% { box-shadow: 0 0 0 var(--space-4) color-mix(in srgb, white 0%, transparent); }

/* AFTER */
0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--brand-hero-glass-tint, white) 15%, transparent); }
50% { box-shadow: 0 0 0 var(--space-4) color-mix(in srgb, var(--brand-hero-glass-tint, white) 0%, transparent); }
```

#### `.hero__stats` border (line ~683)
```css
/* BEFORE */
border-top: var(--border-width) solid color-mix(in srgb, white 25%, transparent);

/* AFTER */
border-top: var(--border-width) solid color-mix(in srgb, var(--brand-hero-border-tint, white) 25%, transparent);
```

#### `.hero__stat-number` (line ~699)
```css
/* BEFORE */
color: white;

/* AFTER */
color: var(--brand-hero-text, white);
```

#### `.hero__stat-label` (line ~707)
```css
/* BEFORE */
color: color-mix(in srgb, white 62%, transparent);

/* AFTER */
color: color-mix(in srgb, var(--brand-hero-text-muted, white) 62%, transparent);
```

---

## Verification Steps

### V1: Zero visual regression

1. Start `pnpm dev` from monorepo root
2. Navigate to org landing page (`bruce-studio.lvh.me:3000/`)
3. Take a screenshot BEFORE changes (or compare carefully)
4. After changes, the hero must look **pixel-identical** — every fallback matches the previous hardcoded value
5. Check all 4 hero layouts: default, centered, logo-hero, minimal
6. Check mobile viewport (<768px)

### V2: Hero tokens resolve correctly

1. Open DevTools → Elements → `.org-layout`
2. Verify NO `--brand-hero-*` properties are set (they should only exist when overridden)
3. Manually add `style="--brand-hero-text: #ff0000"` to `.org-layout`
4. Verify: description text, pill text, stat numbers turn red. Title should NOT change (it uses `hero-title-color`, a different token).
5. Remove the manual override

### V3: Title blend mode

1. Manually set `--brand-hero-title-color: #00ff00; --brand-hero-title-blend: normal` on `.org-layout`
2. Verify: title turns solid green, NO blend mode effect
3. Remove both → verify title returns to white + difference blend
4. Set only `--brand-hero-title-color: #ff0000` (without blend) → verify: title turns red but STILL has difference blend (because `hero-title-blend` defaults to `difference`)

### V4: CTA buttons

1. Manually set `--brand-hero-cta-bg: #000000; --brand-hero-cta-text: #ffffff` on `.org-layout`
2. Verify: primary CTA button has black background, white text
3. Manually set `--brand-hero-glass-tint: #ff0000; --brand-hero-glass-text: #ffffff`
4. Verify: glass buttons have red-tinted semi-transparent backgrounds, white text

### V5: Border/divider tint

1. Manually set `--brand-hero-border-tint: #00ff00` on `.org-layout`
2. Verify: pill borders, stat divider line, and pill backgrounds use green-tinted color-mix

### V6: Dark mode

1. Toggle to dark theme
2. Repeat V1 — hero should still look correct (hero is theme-independent, always renders over shader)
3. Verify custom overrides still work in dark mode

### V7: `color-mix()` browser compatibility

1. Test in Chrome (119+), Firefox (128+), Safari (16.4+)
2. Verify `color-mix(in srgb, var(--brand-hero-text, white) 80%, transparent)` resolves correctly when `--brand-hero-text` is NOT set (should use `white` fallback)

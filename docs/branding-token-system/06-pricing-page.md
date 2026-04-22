# WP-06: Pricing Page Cleanup

## Goal

Replace ~35 hardcoded values in the pricing page with design tokens. This is the single largest file cleanup.

## Depends On

- WP-01 (Foundation) — `--color-glass-tint`, `--ease-smooth`, `--tracking-tighter`, `--text-transform-label` must exist

## Background

The pricing page (`apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte`) has extensive glass-morphism effects, animated card reveals, and decorative elements. It uses:
- `color-mix(in srgb, white X%, transparent)` for glass highlights (8-12% white)
- `color-mix(in srgb, black X%, transparent)` for shadow/depth effects (4-8% black)
- Custom `cubic-bezier(0.16, 1, 0.3, 1)` easing (5+ times)
- Hardcoded letter-spacing values (`0.12em`, `-0.02em`, `0.04em`, `-0.01em`, `-0.03em`)
- `text-transform: uppercase` on labels
- Hardcoded animation durations (`500ms`, `350ms`, `550ms`, `600ms`)
- `blur(6px)` instead of `--blur-sm`
- Hardcoded opacity values in keyframes

---

## Instructions

### Step 1: Glass highlight effects

Replace `white` with `var(--color-glass-tint, white)` in all `color-mix()` calls that create glass highlights:

```css
/* Pattern: glass highlight on cards */
/* BEFORE */
inset 0 1px 0 color-mix(in srgb, white 8%, transparent)

/* AFTER */
inset 0 1px 0 color-mix(in srgb, var(--color-glass-tint, white) 8%, transparent)
```

Apply to lines: ~602, ~713, ~723, ~1010

### Step 2: Shadow/depth effects

Replace `black` with `var(--color-glass-tint-dark, black)` in shadow `color-mix()`:

```css
/* Pattern: depth shadow */
/* BEFORE */
inset 0 -1px 0 color-mix(in srgb, black 4%, transparent)

/* AFTER */
inset 0 -1px 0 color-mix(in srgb, var(--color-glass-tint-dark, black) 4%, transparent)
```

Apply to lines: ~714, ~722, ~1067

### Step 3: Easing curves

Replace all `cubic-bezier(0.16, 1, 0.3, 1)` with `var(--ease-smooth)`:

Lines: ~567, ~615 (×3), ~644, ~682, ~715

Note: Line 644 uses `cubic-bezier(0.34, 1.56, 0.64, 1)` — this is the EXISTING `--ease-bounce` token. Replace with `var(--ease-bounce)`.

### Step 4: Letter-spacing

| Line | Current | Replacement |
|---|---|---|
| ~527 | `0.12em` | `var(--tracking-wider)` (0.05em) — NOTE: this is `2.4×` wider than `--tracking-wider`. May need `calc(var(--tracking-wider) * 2.4)` or a new `--tracking-widest: 0.1em` token |
| ~541 | `-0.02em` | `var(--tracking-tight)` (-0.025em) |
| ~787 | `0.04em` | `var(--tracking-wider)` (close enough at 0.05em) |
| ~817 | `-0.01em` | `var(--tracking-normal)` (0) — or keep as-is if intentional |
| ~840 | `-0.03em` | `var(--tracking-tighter)` (-0.03em, defined in WP-01) |

**Decision needed**: The `0.12em` letter-spacing on the "PRICING" label is very wide. Options:
- Define `--tracking-widest: 0.1em` as a new token
- Use `calc(var(--tracking-wider) * 2)` for derived approach
- Keep `0.12em` as intentional design (it's a page header, not a repeating pattern)

### Step 5: Text-transform

Line ~528, ~787:
```css
/* BEFORE */
text-transform: uppercase;

/* AFTER */
text-transform: var(--text-transform-label, uppercase);
```

### Step 6: Animation durations

Replace hardcoded durations with tokens where they match:

| Line | Current | Replacement |
|---|---|---|
| ~567 | `500ms` | `var(--duration-slower)` (500ms) |
| ~615 | `200ms` (×3) | `var(--duration-normal)` (200ms) |
| ~644 | `350ms` | `var(--duration-slow)` (300ms) — close enough, or `calc(var(--duration-slow) * 1.17)` |
| ~682 | `550ms` | `var(--duration-slower)` (500ms) — close enough |
| ~715 | `350ms` | `var(--duration-slow)` |
| ~907 | `600ms` | `calc(var(--duration-slower) * 1.2)` or keep as choreography |
| ~1172 | `1.8s ease-in-out infinite` | shimmer animation — keep duration as choreography |

### Step 7: Blur values

Line ~943:
```css
/* BEFORE */
filter: blur(6px);

/* AFTER */
filter: blur(var(--blur-sm));
```

Note: `--blur-sm` = 4px, not 6px. May want `var(--blur-md)` (8px) instead. Check visually.

### Step 8: Scale transforms

Line ~944:
```css
/* BEFORE */
transform: scale(1.1);

/* AFTER */
transform: scale(var(--card-hover-scale, 1.1));
```

Or keep as pricing-specific since it's for a decorative glow effect, not a card hover.

### Step 9: Opacity values in keyframes

Lines ~586, ~649-651, ~695, ~754-756: These are animation keyframes with `opacity: 0`, `opacity: 0.5`, `opacity: 0.8`, `opacity: 1`.

These are choreography values — the opacity defines the animation curve, not a design token. **Exception: keep as-is.** Using `var(--opacity-50)` in keyframes would make the animation un-tunable (you'd change the token and break unrelated opacity uses).

### Step 10: Conic gradient animation (lines ~737-743)

```css
/* BEFORE */
background: conic-gradient(from 180deg, ..., transparent 60%, transparent 100%);
opacity: 0.7;

/* AFTER */
background: conic-gradient(from 180deg, ..., transparent 60%, transparent 100%);
opacity: var(--opacity-70);
```

The gradient percentages and colors using `var(--color-brand-primary)` and `var(--color-interactive)` are already token-based.

---

## Verification Steps

### V1: Pricing page visual regression

1. Navigate to org pricing page (`bruce-studio.lvh.me:3000/pricing`)
2. Verify: tier cards look identical (glass borders, highlights, shadows)
3. Verify: card reveal animations play smoothly
4. Verify: hover states on tier cards work correctly
5. Verify: featured/highlighted tier card stands out correctly
6. Verify: CTA buttons render correctly
7. Verify: FAQ section looks correct
8. Scroll through entire page — no visual issues

### V2: Glass tint override

1. In DevTools, set `--brand-glass-tint: #ff0000` on `.org-layout`
2. Verify: glass highlights on pricing cards shift to reddish tint
3. Set `--color-glass-tint-dark: #000080`
4. Verify: shadow/depth effects shift to dark blue
5. Remove overrides → verify returns to default

### V3: Animation timing

1. Hard refresh the pricing page to re-trigger card reveal animations
2. Verify: animations feel natural and smooth
3. Check that `--ease-smooth` produces similar motion to the original `cubic-bezier(0.16, 1, 0.3, 1)` — they should be identical since that IS the value

### V4: Letter-spacing

1. Verify: "PRICING" header label has appropriate letter-spacing
2. Verify: tier name labels have appropriate spacing
3. Verify: price amounts have appropriate negative tracking

### V5: Text-transform override

1. Set `--brand-text-transform-label: none` on `.org-layout`
2. Verify: "PRICING" label and tier labels change from UPPERCASE to normal case
3. Remove override → verify returns to uppercase

### V6: Mobile viewport

1. Resize to mobile (<768px)
2. Verify: pricing cards stack correctly
3. Verify: no overflow or clipping issues
4. Verify: touch interactions work

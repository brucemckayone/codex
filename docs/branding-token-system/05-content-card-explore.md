# WP-05: Content Card & Explore Page Cleanup

## Goal

Replace hardcoded scale values, easing curves, letter-spacing, text-transform, and font sizes in ContentCard and the explore page with design tokens.

## Depends On

- WP-01 (Foundation) — `--ease-smooth`, `--tracking-wider`, `--text-transform-label`, `--text-transform-meta`, `--card-hover-scale`, `--card-image-hover-scale` must exist

## Background

ContentCard is one of the most widely used components on org pages — it appears on landing, explore, library, studio content list, and search results. It has several hardcoded interaction values that should be tokens:
- `scale(1.02)` hover lift
- `scale(1.05)` image zoom
- `500ms cubic-bezier(0.2, 0, 0, 1)` image transition
- `0.625rem` font size (below `--text-xs`)
- `0.04em` letter-spacing
- `text-transform: uppercase` and `capitalize`

The explore page has `text-transform: capitalize` on filter chips.

---

## Instructions

### Step 1: ContentCard.svelte

**File**: `apps/web/src/lib/components/ui/ContentCard/ContentCard.svelte`

#### Hover scale (line ~360-361)
```css
/* BEFORE */
transform: translateY(calc(-1 * var(--space-0-5))) scale(1.02);

/* AFTER */
transform: translateY(calc(-1 * var(--space-0-5))) scale(var(--card-hover-scale, 1.02));
```

#### Image hover zoom (line ~408)
```css
/* BEFORE */
transform: scale(1.05);

/* AFTER */
transform: scale(var(--card-image-hover-scale, 1.05));
```

#### Image transition easing (line ~403)
```css
/* BEFORE */
transition: transform 500ms cubic-bezier(0.2, 0, 0, 1);

/* AFTER */
transition: transform var(--duration-slower) var(--ease-smooth);
```

#### Card hover transitions (lines ~351-358)
Replace `cubic-bezier(0.2, 0, 0, 1)` with `var(--ease-smooth)` in each transition declaration.

Also replace `300ms cubic-bezier(0.2, 0, 0, 1)` (line ~643) with `var(--duration-slow) var(--ease-smooth)`.

#### Badge font size (line ~578)
```css
/* BEFORE */
font-size: 0.625rem;

/* AFTER */
font-size: calc(var(--text-xs) * 0.8);
```

Note: `0.625rem` = 10px, while `--text-xs` = `clamp(0.75rem, ...)` ≈ 12px. `calc(var(--text-xs) * 0.8)` ≈ 9.6px, close enough. This scales with `--text-scale`.

#### Badge letter-spacing (line ~583)
```css
/* BEFORE */
letter-spacing: 0.04em;

/* AFTER */
letter-spacing: var(--tracking-wider);
```

Note: `--tracking-wider` = `0.05em`, slightly wider than `0.04em`. This is acceptable for badge text at small sizes.

#### Text transforms (lines ~582, ~671)
```css
/* BEFORE (line 582) */
text-transform: uppercase;

/* AFTER */
text-transform: var(--text-transform-label, uppercase);

/* BEFORE (line 671) */
text-transform: capitalize;

/* AFTER */
text-transform: var(--text-transform-meta, capitalize);
```

#### Opacity (line ~569)
```css
/* BEFORE */
opacity: 0.5;

/* AFTER */
opacity: var(--opacity-50);
```

### Step 2: Explore page

**File**: `apps/web/src/routes/_org/[slug]/(space)/explore/+page.svelte`

#### Filter chip text-transform (line ~487)
```css
/* BEFORE */
text-transform: capitalize;

/* AFTER */
text-transform: var(--text-transform-meta, capitalize);
```

#### Mask gradient (line ~506-512)
Contains `black` in a `mask-image` gradient — this is an alpha mask, NOT a color. **Exception: keep as-is.**

---

## Verification Steps

### V1: ContentCard visual regression

1. Navigate to explore page with a grid of content cards
2. Verify: cards look identical at rest (no spacing, size, or color changes)
3. Hover over a card → verify: lift animation feels the same (scale, timing, easing)
4. Hover over card image → verify: zoom animation feels the same
5. Check badge text (access labels like "FREE", "PREMIUM") → verify: same size, spacing, case

### V2: Scale token override

1. In DevTools, on `.org-layout[data-org-brand]`, set `--brand-card-hover-scale: 1.05`
2. Hover a card → verify: more dramatic lift than default
3. Set `--brand-card-image-hover-scale: 1.15`
4. Hover card image → verify: more dramatic zoom
5. Remove overrides → verify: returns to default

### V3: Text transform token override

1. In DevTools, set `--brand-text-transform-label: none` on `.org-layout`
2. Verify: badge text that was UPPERCASE is now sentence case (e.g., "free" instead of "FREE")
3. Set `--brand-text-transform-label: capitalize`
4. Verify: badge text is now Title Case
5. Remove override → verify: returns to uppercase

### V4: Easing token test

1. Verify no jank or visual change in card hover animation
2. Check the computed transition value matches `cubic-bezier(0.16, 1, 0.3, 1)` (the `--ease-smooth` value)
3. Note: `--ease-smooth` (`cubic-bezier(0.16, 1, 0.3, 1)`) differs slightly from the original `cubic-bezier(0.2, 0, 0, 1)` — verify the animation still feels smooth and natural. If noticeably different, consider creating `--ease-content-card` with the original curve.

### V5: Explore page filter chips

1. Navigate to explore page
2. Verify: category filter chips still show capitalized text
3. In DevTools, set `--brand-text-transform-meta: uppercase`
4. Verify: chips switch to UPPERCASE
5. Remove override → verify: returns to capitalize

### V6: Mobile viewport

1. Resize to mobile width (<768px)
2. Verify: ContentCard renders correctly
3. Verify: hover states don't activate on touch (tap targets work)

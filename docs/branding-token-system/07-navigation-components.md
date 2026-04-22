# WP-07: Navigation Component Cleanup

## Goal

Replace hardcoded easing curves, `black` in color-mix, text-transform, and overlay mix percentages in SidebarRail, MobileBottomNav, MobileBottomSheet, and CommandPaletteSearch.

## Depends On

- WP-01 (Foundation) — `--ease-spring`, `--text-transform-label` must exist

## Background

Navigation components are generally well-tokenized for colors (they use `var(--color-interactive)`, `var(--color-text)`, etc.). The remaining issues are:
- `black` keyword in `color-mix()` calls (should use `var(--color-neutral-900)`)
- Custom `cubic-bezier(0.22, 1.2, 0.36, 1)` easing not tokenized
- `text-transform: uppercase` not using token
- `color-mix()` percentages with token base colors (minor — base color IS branded)

---

## Instructions

### Step 1: SidebarRail.svelte

**File**: `apps/web/src/lib/components/layout/SidebarRail/SidebarRail.svelte`

#### Easing curve (lines ~170-174)
```css
/* BEFORE */
transition: width var(--duration-slow) cubic-bezier(0.22, 1.2, 0.36, 1);

/* AFTER */
transition: width var(--duration-slow) var(--ease-spring);
```

The `color-mix()` calls on lines ~152-153, ~296-297, ~351 use `var(--color-surface)`, `var(--color-border)`, and `var(--color-interactive)` as base colors with literal percentages (50%, 75%, 12%, 25%). These base colors ARE already branded — the percentage controls how subtle the effect is. **Keep percentages as-is** — they are design decisions about intensity, not brand expression.

### Step 2: SidebarRailItem.svelte

**File**: `apps/web/src/lib/components/layout/SidebarRail/SidebarRailItem.svelte`

Same pattern — `color-mix()` uses branded base colors. No changes needed for color-mix.

Transition delay (line ~101):
```css
/* BEFORE */
transition-delay: calc(30ms * var(--item-index, 0));

/* AFTER — keep as-is */
/* 30ms stagger is choreography, not brand expression */
```

### Step 3: MobileBottomNav.svelte

**File**: `apps/web/src/lib/components/layout/MobileNav/MobileBottomNav.svelte`

#### Gradient with `black` (lines ~154-157)
```css
/* BEFORE */
background-image: linear-gradient(135deg, var(--color-interactive) 0%, color-mix(in oklch, var(--color-interactive) 80%, black) 100%);

/* AFTER */
background-image: linear-gradient(135deg, var(--color-interactive) 0%, color-mix(in oklch, var(--color-interactive) 80%, var(--color-neutral-900)) 100%);
```

#### Box-shadow color-mix with branded base (lines ~164, ~172)
These use `var(--color-interactive)` with percentages (20%, 30%). **Keep as-is** — base color is branded.

#### Scale values (lines ~126, ~170)
`scale(0.92)` and `scale(0.88)` — these are tap feedback physics constants. **Exception: keep as-is.**

### Step 4: MobileBottomSheet.svelte

**File**: `apps/web/src/lib/components/layout/MobileNav/MobileBottomSheet.svelte`

Line ~216: `color-mix(in srgb, var(--color-overlay) 50%, transparent)` — base color `--color-overlay` IS already a semantic token. **Keep as-is.**

### Step 5: CommandPaletteSearch.svelte

**File**: `apps/web/src/lib/components/search/CommandPaletteSearch.svelte` (or CommandPalette.svelte)

#### Text-transform (line ~512)
```css
/* BEFORE */
text-transform: uppercase;

/* AFTER */
text-transform: var(--text-transform-label, uppercase);
```

#### Overlay color-mix (line ~352)
`color-mix(in oklch, var(--color-overlay) 50%, transparent)` — base is a semantic token. **Keep as-is.**

---

## Verification Steps

### V1: SidebarRail visual regression

1. Navigate to org page
2. Verify: sidebar rail renders correctly on desktop
3. Hover sidebar to expand → verify: expansion animation feels smooth (spring easing)
4. Hover individual items → verify: highlight states look correct
5. Click items → verify: active states look correct

### V2: MobileBottomNav visual regression

1. Resize to mobile viewport
2. Verify: bottom nav bar renders correctly
3. Verify: gradient on active item looks correct (not pure flat color)
4. Tap items → verify: press feedback scale feels correct
5. Verify: no visual change from before (gradient base color is the same)

### V3: MobileBottomSheet visual regression

1. On mobile, tap "More" button
2. Verify: bottom sheet opens with correct overlay
3. Verify: overlay dimming is correct
4. Close sheet → verify animation is smooth

### V4: CommandPalette text-transform

1. Open command palette (Cmd+K or search icon)
2. Verify: shortcut labels / section headers that were UPPERCASE still display correctly
3. In DevTools, set `--brand-text-transform-label: none` on `.org-layout`
4. Verify: labels change to sentence case
5. Remove override → verify returns to uppercase

### V5: Easing token test

1. On desktop, hover sidebar rail to expand
2. Verify: the spring easing (`--ease-spring`) produces a bouncy, organic feel
3. Compare with the original `cubic-bezier(0.22, 1.2, 0.36, 1)` — should be identical since that IS the token value

### V6: Dark mode

1. Toggle dark theme
2. Repeat V1-V4
3. Verify: all navigation components adapt correctly to dark theme

# WP-09: CSS Injection Pipeline — BRAND_PREFIX_KEYS

## Goal

Register all new token keys in `BRAND_PREFIX_KEYS` so the CSS injection system routes them to `--brand-{key}` instead of `--color-{key}`.

## Depends On

- WP-01 (Foundation) — must be planned alongside WP-01 since both touch `css-injection.ts`

## Background

The CSS injection system in `css-injection.ts` has a routing decision:
- Keys in `BRAND_PREFIX_KEYS` → injected as `--brand-{key}` CSS property
- All other keys → injected as `--color-{key}` CSS property

This matters because:
- `--brand-*` properties are consumed by `org-brand.css` rules (Layer 3 derivation)
- `--color-*` properties directly override semantic tokens (Layer 4 override)

Hero tokens, player tokens, heading color, glass tint, card scales, and text-transform all need `--brand-` prefix because they are consumed by `org-brand.css` (or component CSS) via `var(--brand-{key}, fallback)`.

Standard color overrides (text, border, surface, interactive, focus) stay as `--color-*` because they directly replace the semantic token value.

---

## Instructions

### Step 1: Add new keys to BRAND_PREFIX_KEYS

**File**: `apps/web/src/lib/brand-editor/css-injection.ts`

Add these keys to the `BRAND_PREFIX_KEYS` set. Organize by category with comments:

```typescript
// After the existing 'hero-logo-scale' entry:

// Hero text and color tokens (WP-02)
'hero-text',
'hero-text-muted',
'hero-title-color',
'hero-title-blend',
'hero-cta-bg',
'hero-cta-text',
'hero-glass-tint',
'hero-glass-text',
'hero-border-tint',

// Heading color (WP-01)
'heading-color',

// Player chrome tokens (WP-03)
'player-text',
'player-text-secondary',
'player-text-muted',
'player-surface',
'player-surface-hover',
'player-border',
'player-overlay',
'player-overlay-heavy',

// Glass morphism (WP-01)
'glass-tint',

// Card interaction (WP-05)
'card-hover-scale',
'card-image-hover-scale',

// Typography style (WP-01)
'text-transform-label',
```

### Step 2: Verify key uniqueness

Ensure no new key conflicts with an existing key in `BRAND_PREFIX_KEYS`. The existing set contains:
- `text-scale`, `heading-weight`, `body-weight` (typography fine-tune)
- `shadow-scale`, `shadow-color` (shadow fine-tune)
- `hero-logo-scale` (hero layout)
- `shader-*` (shader presets — 200+ keys)

New keys are all prefixed with `hero-`, `player-`, `heading-`, `glass-`, `card-`, or `text-transform-` which do NOT conflict.

### Step 3: Verify injection routing

The injection logic in `injectBrandVars()` (line ~441-447):
```typescript
const prop = BRAND_PREFIX_KEYS.has(key)
  ? `--brand-${key}`
  : `--color-${key}`;
el.style.setProperty(prop, value);
```

No changes needed to this logic — it already handles any key in the set.

The same routing exists in `injectTokenOverrides()` (line ~482-486) for server-side injection on page load. No changes needed there either.

---

## Verification Steps

### V1: Key count

1. Open `css-injection.ts`
2. Count total keys in `BRAND_PREFIX_KEYS` — should include all existing shader keys + the new ~20 keys
3. Verify no duplicates

### V2: Injection routing — hero tokens

1. Open brand editor
2. Navigate to Fine-tune → Hero group
3. Customize "Content Text" to red (#ff0000)
4. Open DevTools → Elements → `.org-layout`
5. In the inline `style` attribute, verify: `--brand-hero-text: #ff0000` (NOT `--color-hero-text`)
6. Verify the hero description text actually turns red (CSS consumption works)

### V3: Injection routing — standard color tokens

1. Navigate to Fine-tune → Text group
2. Customize "Body Text" to blue (#0000ff)
3. In DevTools, verify: `--color-text: #0000ff` (NOT `--brand-text`)
4. Verify body text turns blue

### V4: Injection routing — player tokens

1. Customize "Player Text" to green
2. In DevTools, verify: `--brand-player-text: #00ff00` (correct prefix)

### V5: Injection routing — non-color tokens

1. Customize "Card Hover Scale" via slider to 1.05
2. In DevTools, verify: `--brand-card-hover-scale: 1.05`
3. Customize "Label Case" to "none"
4. In DevTools, verify: `--brand-text-transform-label: none`

### V6: Server-side injection

1. Save the brand editor with some overrides
2. Close editor → reload page
3. In DevTools, check `.org-layout` inline styles
4. Verify: saved overrides are present with correct `--brand-` or `--color-` prefixes
5. Verify: `injectTokenOverrides()` on page load used the same routing logic

### V7: Clear on discard

1. Open brand editor with saved overrides
2. Customize additional tokens
3. Click Discard
4. Verify: inline styles on `.org-layout` revert to server-saved values (not the discarded edits)
5. Close editor → verify: `clearBrandVars()` removes all editor-injected vars

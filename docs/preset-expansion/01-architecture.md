# WP-01: Architecture — Types, Store, UI Categories

## Goal

Extend the preset system to support tokenOverrides, heroLayout, and darkOverrides. Update the store's `applyPreset()` to handle the new fields. Add 5 new categories to the preset browser UI.

## Depends On

Nothing — this is the first WP.

## Background

Currently `BrandPreset.values` is typed as `BrandEditorPayload` which explicitly omits `tokenOverrides` and `logoUrl`. The `applyPreset()` function copies 8 fields. We need to extend the type and the function without breaking existing presets (backward compatible — tokenOverrides is optional).

---

## Instructions

### Step 1: Extend BrandPreset type

**File**: `apps/web/src/lib/brand-editor/types.ts`

Change the `BrandPreset` interface:

```typescript
/** A preset is a complete brand design system. */
export interface BrandPreset {
  id: string;
  name: string;
  description: string;
  values: BrandEditorPayload;
  /** Optional token overrides bundled with the preset (hero, player, glass, cards, etc.) */
  tokenOverrides?: Record<string, string>;
  /** Optional hero layout variant ('default' | 'centered' | 'logo-hero') */
  heroLayout?: string;
}
```

Note: `darkOverrides` is already part of `BrandEditorPayload` via the `values` field — it just needs to be set to non-null in preset definitions.

### Step 2: Update PresetCategory type

**File**: `apps/web/src/lib/brand-editor/presets.ts`

Change the `PresetCategory` type:

```typescript
export type PresetCategory =
  | 'Professional'
  | 'Creative'
  | 'Bold'
  | 'Minimal'
  | 'Organic'
  | 'Tech'
  | 'Luxury'
  | 'Playful'
  | 'Atmospheric';
```

### Step 3: Update applyPreset() in store

**File**: `apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts`

Replace the current `applyPreset` function:

```typescript
function applyPreset(preset: BrandPreset): void {
  if (!state.pending) return;
  const { values } = preset;

  // Base values (existing behaviour)
  state.pending.primaryColor = values.primaryColor;
  state.pending.secondaryColor = values.secondaryColor;
  state.pending.accentColor = values.accentColor;
  state.pending.backgroundColor = values.backgroundColor;
  state.pending.fontBody = values.fontBody;
  state.pending.fontHeading = values.fontHeading;
  state.pending.radius = values.radius;
  state.pending.density = values.density;

  // Dark overrides (new — presets can bundle dark theme colours)
  state.pending.darkOverrides = values.darkOverrides ?? null;

  // Token overrides (new — presets can bundle hero, player, glass, card tokens etc.)
  // Clear existing overrides first for a clean slate, then apply preset's tokens
  state.pending.tokenOverrides = preset.tokenOverrides
    ? { ...preset.tokenOverrides }
    : {};

  // Hero layout (new — presets can set the hero layout variant)
  if (preset.heroLayout) {
    state.pending.heroLayout = preset.heroLayout;
  }
}
```

**Key behaviour**: Applying a preset CLEARS existing tokenOverrides. This is intentional — a preset is a clean design system, not an additive layer. If a user wants to keep their custom token tweaks, they shouldn't apply a preset.

### Step 4: Update preset browser UI categories

**File**: `apps/web/src/lib/components/brand-editor/levels/BrandEditorPresets.svelte`

Update the categories array:

```typescript
const categories: PresetCategory[] = [
  'Professional', 'Creative', 'Bold', 'Minimal',
  'Organic', 'Tech', 'Luxury', 'Playful', 'Atmospheric',
];
```

Add a shader badge to preset cards — after the description span, add:

```svelte
{#if preset.tokenOverrides?.['shader-preset']}
  <span class="presets-level__shader-badge">
    {preset.tokenOverrides['shader-preset']}
  </span>
{/if}
```

Add the badge style:

```css
.presets-level__shader-badge {
  font-size: calc(var(--text-xs) * 0.85);
  color: var(--color-interactive);
  background: var(--color-interactive-subtle);
  padding: var(--space-0-5) var(--space-1-5);
  border-radius: var(--radius-full);
  width: fit-content;
}
```

### Step 5: Update barrel export

**File**: `apps/web/src/lib/brand-editor/index.ts`

Ensure `PresetCategory` is exported (check if it already is).

---

## Verification Steps

### V1: Type compatibility
1. Run `pnpm typecheck` — no errors
2. Existing presets (which have no `tokenOverrides` field) still compile

### V2: Apply preset with no tokenOverrides
1. Open brand editor → Browse Presets → apply "Corporate"
2. Verify: colours, fonts, radius, density change
3. Verify: tokenOverrides is empty `{}` (not carrying stale overrides from previous state)

### V3: New categories visible
1. Open brand editor → Browse Presets
2. Verify: 9 category headers visible (will be empty for new ones until WP-03-05)

### V4: Shader badge (once presets have shaders)
1. After WP-02+, verify presets with shaders show the shader name badge

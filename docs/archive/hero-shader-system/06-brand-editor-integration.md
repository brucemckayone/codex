# 06 — Brand Editor "Hero Effects" Level

**Purpose**: Design the brand editor UI that lets org admins configure shader presets and interaction settings. Follows the existing brand editor patterns.

---

## 1. Navigation Integration

### New Level Definition

Add to `apps/web/src/lib/brand-editor/levels.ts`:

```typescript
'hero-effects': {
  id: 'hero-effects',
  depth: 1,
  label: 'Hero Effects',
  parent: 'home',
  icon: '✧',
  description: 'Animated backgrounds & interactions',
},
```

Add `'hero-effects'` to the `LevelId` union in `types.ts`:

```typescript
export type LevelId =
  | 'home'
  | 'colors'
  | 'typography'
  | 'shape'
  | 'shadows'
  | 'logo'
  | 'presets'
  | 'hero-effects'        // NEW
  | 'fine-tune-colors'
  | 'fine-tune-typography';
```

### Home Screen Placement

In `BrandEditorHome.svelte`, add to Advanced section:

```typescript
const ADVANCED_CATEGORIES: LevelId[] = ['shadows', 'logo', 'hero-effects'];
```

### Layout Wiring

In `apps/web/src/routes/_org/[slug]/+layout.svelte`, add the conditional:

```svelte
{:else if brandEditor.level === 'hero-effects'}
  <BrandEditorHeroEffects />
```

---

## 2. Component Design: `BrandEditorHeroEffects.svelte`

### Layout

```
┌────────────────────────────────────┐
│ ◀ Hero Effects            ─   ✕   │  ← Standard brand editor header
├────────────────────────────────────┤
│                                    │
│  ─ Shader Effect ─                 │
│  ┌──────┐ ┌──────┐ ┌──────┐      │
│  │ mesh │ │ flow │ │aurora│      │  ← Preset grid (2×4)
│  └──────┘ └──────┘ └──────┘      │
│  ┌──────┐ ┌──────┐ ┌──────┐      │
│  │voronoi│ │ meta │ │waves │      │
│  └──────┘ └──────┘ └──────┘      │
│  ┌──────┐ ┌──────┐ [  None  ]    │
│  │ dots │ │ geo  │                │
│  └──────┘ └──────┘                │
│                                    │
│  ─ Animation ─                     │
│  Speed       [========●====] 0.5  │  ← Slider
│  Intensity   [===========●=] 0.8  │  ← Slider
│  Complexity  [======●======] 0.5  │  ← Slider
│                                    │
│  ─ Interaction ─                   │
│  Mouse tracking     [ON  | off]   │  ← Toggle
│  Scroll fade        [ON  | off]   │  ← Toggle
│                                    │
├────────────────────────────────────┤
│  [Discard]              [Save]     │  ← Standard brand editor footer
└────────────────────────────────────┘
```

### Preset Thumbnail Design

Each preset card in the 3-column grid shows:

```
┌────────────────────┐
│ ┌────────────────┐ │
│ │                │ │  ← Preview area (60×40px)
│ │  [gradient or  │ │     Option A: Static screenshot (PNG, ~2KB each)
│ │   CSS approx]  │ │     Option B: Tiny canvas with preset running (GPU cost: 8 contexts)
│ │                │ │     Recommended: Static screenshot (simpler, no perf concern)
│ └────────────────┘ │
│ Gradient Mesh      │  ← Preset name
│ ● selected         │  ← Selection indicator (or border highlight)
└────────────────────┘
```

**Recommendation: Static screenshots** stored as inline base64 or small PNG files in the component. Avoids the complexity and GPU cost of running 8 simultaneous WebGL contexts in the brand editor panel.

### Interaction with Store

All shader settings read/write to `brandEditor.pending.tokenOverrides`:

```typescript
// Read current preset
const currentPreset = $derived(
  brandEditor.pending?.tokenOverrides?.['shader-preset'] ?? 'none'
);

// Set preset
function selectPreset(presetId: string) {
  const overrides = { ...(brandEditor.pending?.tokenOverrides ?? {}) };
  overrides['shader-preset'] = presetId;
  brandEditor.updateField('tokenOverrides', overrides);
}

// Set speed (slider)
function setSpeed(value: number) {
  const overrides = { ...(brandEditor.pending?.tokenOverrides ?? {}) };
  overrides['shader-speed'] = String(value);
  brandEditor.updateField('tokenOverrides', overrides);
}

// Toggle mouse
function toggleMouse() {
  const overrides = { ...(brandEditor.pending?.tokenOverrides ?? {}) };
  const current = overrides['shader-mouse-enabled'] !== 'false';
  overrides['shader-mouse-enabled'] = String(!current);
  brandEditor.updateField('tokenOverrides', overrides);
}
```

### Live Preview

Changes propagate through the existing pipeline:
1. `brandEditor.updateField('tokenOverrides', overrides)` updates `state.pending`
2. `$effect` in `brand-editor-store.svelte.ts` fires `injectBrandVars(state.pending)`
3. `css-injection.ts` sets `--brand-shader-preset`, `--brand-shader-speed`, etc. on `.org-layout`
4. `ShaderHero` component watches these CSS properties (or the org data directly) via `$derived`
5. `$effect` in `ShaderHero` calls `renderer.updateConfig(newConfig)`
6. Renderer recompiles shader if preset changed, or just updates uniforms

**Result**: Admin clicks a different preset → hero updates live within ~100ms (shader compile time).

---

## 3. CSS Injection Keys

Add to `BRAND_PREFIX_KEYS` in `css-injection.ts`:

```typescript
const BRAND_PREFIX_KEYS = new Set([
  // Existing
  'text-scale', 'heading-weight', 'body-weight',
  'shadow-scale', 'shadow-color',
  // Hero shader (new)
  'shader-preset',
  'shader-speed',
  'shader-intensity',
  'shader-complexity',
  'shader-mouse-enabled',
  'shader-scroll-fade',
]);
```

These become CSS custom properties:
- `--brand-shader-preset: aurora`
- `--brand-shader-speed: 0.5`
- `--brand-shader-intensity: 0.8`
- etc.

---

## 4. Preset Metadata (for UI)

Each preset needs display metadata for the brand editor:

```typescript
// In shader-presets.ts or a separate brand-editor-friendly export
export const SHADER_PRESET_UI: Array<{
  id: ShaderPresetId;
  name: string;
  description: string;
  category: 'Ambient' | 'Dynamic' | 'Organic' | 'Geometric';
  thumbnail: string;  // base64 data URL or import path
}> = [
  {
    id: 'gradient-mesh',
    name: 'Gradient Mesh',
    description: 'Slowly flowing color blobs — Stripe.com style',
    category: 'Ambient',
    thumbnail: '...', // base64 PNG
  },
  {
    id: 'noise-flow',
    name: 'Noise Flow',
    description: 'Organic flowing color field — Linear.dev style',
    category: 'Dynamic',
    thumbnail: '...',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'Shimmering northern lights curtain',
    category: 'Ambient',
    thumbnail: '...',
  },
  {
    id: 'voronoi',
    name: 'Voronoi Cells',
    description: 'Organic cellular pattern, slowly morphing',
    category: 'Organic',
    thumbnail: '...',
  },
  {
    id: 'metaballs',
    name: 'Metaballs',
    description: 'Lava lamp — blobs merging and separating',
    category: 'Organic',
    thumbnail: '...',
  },
  {
    id: 'waves',
    name: 'Waves',
    description: 'Water caustic ripples with interference patterns',
    category: 'Ambient',
    thumbnail: '...',
  },
  {
    id: 'particles',
    name: 'Star Field',
    description: 'Floating particles with parallax depth',
    category: 'Ambient',
    thumbnail: '...',
  },
  {
    id: 'geometric',
    name: 'Geometric',
    description: 'Rotating kaleidoscopic symmetry pattern',
    category: 'Geometric',
    thumbnail: '...',
  },
];
```

---

## 5. Default State

When an org has never configured hero effects:
- `shader-preset` is absent from `tokenOverrides` → defaults to `'none'`
- The hero renders with the current static gradient (zero regression)
- The brand editor "Hero Effects" level shows "None" selected

**First-time flow**: Admin opens brand editor → navigates to Hero Effects → clicks a preset → sees it live on the page → adjusts speed/intensity → saves.

---

## 6. Removing a Shader

If an admin wants to go back to the static gradient:
- Click "None" in the preset grid
- `shader-preset` is set to `'none'` in tokenOverrides
- ShaderHero component reads `'none'` → renders static gradient
- On save, the tokenOverride is persisted as `'none'`

Alternatively, removing all shader keys from tokenOverrides achieves the same result (default is `'none'`).

---

## 7. Brand Preset Interaction

When an admin applies a brand preset (from the existing Presets level), it does NOT change the shader preset. Brand presets control colors, fonts, radius, and density — but `tokenOverrides` is not part of `BrandPreset.values`. This is intentional:

- Brand presets define the visual identity (colors, typography)
- Shader presets define the visual behaviour (animation type)
- They're independent axes of customization

However, changing brand colors immediately changes how the shader looks (because the shader reads brand colors as uniforms). So applying the "Neon" brand preset to an "Aurora" shader preset instantly transforms the aurora from one color palette to another.

---

## 8. Accessibility of the Editor

- All sliders are `<input type="range">` with `aria-label` and visible value
- Preset grid uses `role="radiogroup"` with `role="radio"` on each card
- Toggle buttons use `aria-pressed` attribute
- Keyboard navigation: Arrow keys move between presets, Enter selects
- Preview thumbnails have `alt` text describing the effect

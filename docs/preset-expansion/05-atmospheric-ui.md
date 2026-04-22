# WP-05: Atmospheric Presets + UI Polish (3 New)

## Goal

Add 3 new presets in the Atmospheric category (Midnight, Storm, Zen). Polish the preset browser UI with shader badges and improved card layout for 25 presets.

## Depends On

- WP-01 (Architecture) — new PresetCategory type, shader badge styles

---

## Instructions

### Part 1: Atmospheric Presets

**File**: `apps/web/src/lib/brand-editor/presets.ts`

Add after the Playful category block:

**Midnight**
```typescript
{
  id: 'midnight',
  name: 'Midnight',
  category: 'Atmospheric',
  description: 'Deep blue twilight — silver accents, aurora shimmer',
  heroLayout: 'centered',
  values: {
    primaryColor: '#94A3B8',
    secondaryColor: '#64748B',
    accentColor: '#38BDF8',
    backgroundColor: '#0F172A',
    fontBody: 'Raleway',
    fontHeading: 'Raleway',
    radius: 0.5,
    density: 1,
    darkOverrides: {
      primaryColor: '#CBD5E1',
      backgroundColor: '#0A0F1F',
    },
  },
  tokenOverrides: {
    'shader-preset': 'aurora',
    'shader-aurora-speed': '0.4',
    'shader-aurora-shimmer': '0.6',
    'heading-color': '#CBD5E1',
    'hero-glass-tint': '#38BDF8',
    'hero-border-tint': '#94A3B8',
    'glass-tint': '#94A3B8',
    'card-hover-scale': '1.02',
    'text-transform-label': 'capitalize',
  },
},
```

**Storm**
```typescript
{
  id: 'storm',
  name: 'Storm',
  category: 'Atmospheric',
  description: 'Electric intensity — dark clouds, lightning blue strikes',
  heroLayout: 'default',
  values: {
    primaryColor: '#2563EB',
    secondaryColor: '#1D4ED8',
    accentColor: '#FBBF24',
    backgroundColor: '#1F2937',
    fontBody: 'DM Sans',
    fontHeading: 'DM Sans',
    radius: 0.375,
    density: 1,
    darkOverrides: {
      primaryColor: '#60A5FA',
      backgroundColor: '#111827',
    },
  },
  tokenOverrides: {
    'shader-preset': 'vortex',
    'shader-vortex-speed': '0.5',
    'shader-vortex-twist': '0.6',
    'heading-color': '#93C5FD',
    'hero-title-blend': 'normal',
    'hero-title-color': '#93C5FD',
    'hero-glass-tint': '#2563EB',
    'hero-border-tint': '#60A5FA',
    'glass-tint': '#2563EB',
    'card-hover-scale': '1.04',
    'card-image-hover-scale': '1.06',
    'text-transform-label': 'uppercase',
  },
},
```

**Zen**
```typescript
{
  id: 'zen',
  name: 'Zen',
  category: 'Atmospheric',
  description: 'Gentle calm — warm white, sage green, gentle rain',
  heroLayout: 'default',
  values: {
    primaryColor: '#6B8F71',
    secondaryColor: '#8FAE92',
    accentColor: '#D4A843',
    backgroundColor: '#FEFCE8',
    fontBody: 'Lora',
    fontHeading: 'Lora',
    radius: 0.75,
    density: 1.1,
    darkOverrides: {
      primaryColor: '#8FAE92',
      backgroundColor: '#1A1A0E',
    },
  },
  tokenOverrides: {
    'shader-preset': 'rain',
    'shader-rain-speed': '0.3',
    'shader-rain-density': '0.3',
    'heading-color': '#5F7A63',
    'hero-glass-tint': '#8FAE92',
    'hero-border-tint': '#6B8F71',
    'glass-tint': '#8FAE92',
    'card-hover-scale': '1.01',
    'card-image-hover-scale': '1.02',
    'text-transform-label': 'none',
  },
},
```

### Part 2: UI Polish

**File**: `apps/web/src/lib/components/brand-editor/levels/BrandEditorPresets.svelte`

With 25 presets across 9 categories, the preset browser needs minor improvements:

1. **Background swatch for dark presets** — show a small bg swatch when `preset.values.backgroundColor` is set:

After the existing swatches div, add:
```svelte
{#if preset.values.backgroundColor}
  <span
    class="presets-level__bg-indicator"
    style:background={preset.values.backgroundColor}
    title="Background: {preset.values.backgroundColor}"
  ></span>
{/if}
```

Add style:
```css
.presets-level__bg-indicator {
  width: var(--space-3);
  height: var(--space-3);
  border-radius: var(--radius-xs);
  border: var(--border-width) solid var(--color-border);
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
}
```

And add `position: relative;` to `.presets-level__card`.

2. **Scroll the preset panel** — with 9 categories, ensure the panel content area scrolls. This should already work via the brand editor panel's scroll container.

---

## Verification Steps

### V1: Atmospheric presets appear
1. Browse Presets → verify "Atmospheric" category with 3 presets

### V2: Apply each atmospheric preset
1. "Midnight" → aurora shader, deep blue bg, silver accents, centered hero, capitalize labels
2. "Storm" → vortex shader, gray bg, lightning blue title, dramatic hover
3. "Zen" → rain shader, warm white bg, sage green, Lora serif, minimal hover, no text-transform

### V3: Background indicator
1. Verify presets with explicit bg (Dark, Neon, Ember, Terminal, Onyx, Arcade, Midnight, Storm, etc.) show the small bg swatch in the top-right corner
2. Presets without bg (Corporate, Vibrant, Gradient, etc.) do NOT show the indicator

### V4: Full preset count
1. Count all presets in Browse Presets — should be 25 total across 9 categories
2. Professional (3), Creative (3), Bold (3), Minimal (3), Organic (3), Tech (3), Luxury (3), Playful (3), Atmospheric (3)

### V5: Scroll behaviour
1. With 9 categories visible, scroll through the entire preset list
2. Verify all categories and presets are accessible via scroll

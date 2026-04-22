# WP-03: Organic + Tech Presets (6 New)

## Goal

Add 6 new presets across 2 new categories: Organic (Forest, Desert, Bloom) and Tech (Terminal, Blueprint, Gradient).

## Depends On

- WP-01 (Architecture) — new PresetCategory type and tokenOverrides support

---

## Instructions

**File**: `apps/web/src/lib/brand-editor/presets.ts`

Add after the Minimal category block, before the closing `] as const;`:

### Organic Category

**Forest**
```typescript
{
  id: 'forest',
  name: 'Forest',
  category: 'Organic',
  description: 'Deep greens and earthy tones — nature-inspired calm',
  heroLayout: 'default',
  values: {
    primaryColor: '#14532D',
    secondaryColor: '#854D0E',
    accentColor: '#65A30D',
    backgroundColor: '#FAFDF7',
    fontBody: 'Bitter',
    fontHeading: 'Bitter',
    radius: 0.75,
    density: 1.05,
    darkOverrides: {
      primaryColor: '#22C55E',
      backgroundColor: '#0C1A0F',
    },
  },
  tokenOverrides: {
    'shader-preset': 'growth',
    'shader-growth-speed': '0.3',
    'shader-growth-glow': '0.4',
    'heading-color': '#14532D',
    'hero-glass-tint': '#65A30D',
    'hero-border-tint': '#65A30D',
    'glass-tint': '#65A30D',
    'card-hover-scale': '1.02',
    'text-transform-label': 'capitalize',
  },
},
```

**Desert**
```typescript
{
  id: 'desert',
  name: 'Desert',
  category: 'Organic',
  description: 'Warm sand and terracotta — sun-baked, expansive',
  heroLayout: 'default',
  values: {
    primaryColor: '#A0522D',
    secondaryColor: '#92400E',
    accentColor: '#D97706',
    backgroundColor: '#FDF8F0',
    fontBody: 'Libre Baskerville',
    fontHeading: 'Libre Baskerville',
    radius: 0.5,
    density: 1.1,
    darkOverrides: {
      primaryColor: '#D2956B',
      backgroundColor: '#1A120B',
    },
  },
  tokenOverrides: {
    'shader-preset': 'waves',
    'shader-waves-speed': '0.3',
    'shader-waves-chop': '0.2',
    'heading-color': '#78350F',
    'hero-glass-tint': '#D97706',
    'hero-border-tint': '#D97706',
    'glass-tint': '#D2B48C',
    'card-hover-scale': '1.02',
    'text-transform-label': 'capitalize',
  },
},
```

**Bloom**
```typescript
{
  id: 'bloom',
  name: 'Bloom',
  category: 'Organic',
  description: 'Soft pinks and botanical warmth — delicate, flourishing',
  heroLayout: 'centered',
  values: {
    primaryColor: '#BE185D',
    secondaryColor: '#DB2777',
    accentColor: '#F472B6',
    backgroundColor: '#FDF2F8',
    fontBody: 'Nunito',
    fontHeading: 'Playfair Display',
    radius: 1,
    density: 1.05,
    darkOverrides: {
      primaryColor: '#F472B6',
      backgroundColor: '#1A0A14',
    },
  },
  tokenOverrides: {
    'shader-preset': 'pollen',
    'shader-pollen-density': '0.5',
    'shader-pollen-drift': '0.3',
    'heading-color': '#9D174D',
    'hero-glass-tint': '#F472B6',
    'hero-border-tint': '#F9A8D4',
    'glass-tint': '#F9A8D4',
    'card-hover-scale': '1.02',
    'card-image-hover-scale': '1.04',
    'text-transform-label': 'none',
  },
},
```

### Tech Category

**Terminal**
```typescript
{
  id: 'terminal',
  name: 'Terminal',
  category: 'Tech',
  description: 'Hacker aesthetic — black background, green phosphor glow',
  heroLayout: 'default',
  values: {
    primaryColor: '#4ADE80',
    secondaryColor: '#86EFAC',
    accentColor: '#FDE047',
    backgroundColor: '#0A0A0A',
    fontBody: 'JetBrains Mono',
    fontHeading: 'JetBrains Mono',
    radius: 0.125,
    density: 0.9,
    darkOverrides: {
      primaryColor: '#4ADE80',
      backgroundColor: '#050505',
    },
  },
  tokenOverrides: {
    'shader-preset': 'spore',
    'shader-spore-decay': '0.95',
    'heading-color': '#4ADE80',
    'hero-title-blend': 'normal',
    'hero-title-color': '#4ADE80',
    'hero-glass-tint': '#4ADE80',
    'hero-border-tint': '#4ADE80',
    'player-text': '#4ADE80',
    'glass-tint': '#4ADE80',
    'card-hover-scale': '1.01',
    'text-transform-label': 'uppercase',
  },
},
```

**Blueprint**
```typescript
{
  id: 'blueprint',
  name: 'Blueprint',
  category: 'Tech',
  description: 'Technical precision — blueprint blue, structured grid',
  heroLayout: 'default',
  values: {
    primaryColor: '#1E3A8A',
    secondaryColor: '#3B82F6',
    accentColor: '#60A5FA',
    backgroundColor: '#EFF6FF',
    fontBody: 'IBM Plex Sans',
    fontHeading: 'IBM Plex Sans',
    radius: 0.25,
    density: 0.9,
    darkOverrides: {
      primaryColor: '#60A5FA',
      backgroundColor: '#0A1628',
    },
  },
  tokenOverrides: {
    'shader-preset': 'gyroid',
    'shader-gyroid-speed': '0.3',
    'shader-gyroid-density': '0.5',
    'heading-color': '#1E3A8A',
    'hero-cta-bg': '#1E3A8A',
    'hero-cta-text': '#ffffff',
    'glass-tint': '#BFDBFE',
    'card-hover-scale': '1.015',
    'text-transform-label': 'uppercase',
  },
},
```

**Gradient**
```typescript
{
  id: 'gradient',
  name: 'Gradient',
  category: 'Tech',
  description: 'Purple-to-cyan energy — modern SaaS, fluid motion',
  heroLayout: 'centered',
  values: {
    primaryColor: '#8B5CF6',
    secondaryColor: '#06B6D4',
    accentColor: '#F472B6',
    backgroundColor: null,
    fontBody: 'Inter',
    fontHeading: 'Inter',
    radius: 0.75,
    density: 1,
    darkOverrides: {
      primaryColor: '#A78BFA',
    },
  },
  tokenOverrides: {
    'shader-preset': 'flow',
    'shader-flow-curl': '0.6',
    'shader-flow-contrast': '0.5',
    'heading-color': '#7C3AED',
    'hero-glass-tint': '#06B6D4',
    'hero-border-tint': '#8B5CF6',
    'glass-tint': '#06B6D4',
    'card-hover-scale': '1.04',
    'card-image-hover-scale': '1.08',
    'text-transform-label': 'none',
  },
},
```

---

## Verification Steps

### V1: All 6 presets appear in browser
1. Open brand editor → Browse Presets
2. Verify "Organic" category with 3 presets (Forest, Desert, Bloom)
3. Verify "Tech" category with 3 presets (Terminal, Blueprint, Gradient)

### V2: Apply each, verify shader + tokens
1. Apply "Forest" → verify growth shader, green glass tint, capitalize labels
2. Apply "Terminal" → verify spore shader, green player text, monospace font, black bg
3. Apply "Gradient" → verify flow shader, centered hero layout, dramatic card hover

### V3: Dark mode
1. Apply "Terminal" → toggle dark mode → verify dark overrides (#050505 bg)
2. Apply "Blueprint" → toggle dark mode → verify #60A5FA primary, #0A1628 bg

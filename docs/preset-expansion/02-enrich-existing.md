# WP-02: Enrich Existing 10 Presets

## Goal

Add tokenOverrides (hero, player, glass, cards, text-transform, heading-color), shader-preset, heroLayout, and darkOverrides to all 10 existing presets. Each preset should feel like a complete design system after this change.

## Depends On

- WP-01 (Architecture) — BrandPreset type must support tokenOverrides and heroLayout

## Background

Existing presets only set 9 base fields. With the branding token system complete, we can now bundle shader effects, hero styling, player chrome tints, card interaction scales, glass tints, and typography casing into each preset. The visual result should be dramatically more immersive.

---

## Instructions

**File**: `apps/web/src/lib/brand-editor/presets.ts`

Add `tokenOverrides` and `heroLayout` to each existing preset. Some also get `darkOverrides` in their `values`.

### Professional Category

**Corporate** (id: `corporate`)
```typescript
heroLayout: 'default',
tokenOverrides: {
  'shader-preset': 'topo',
  'shader-topo-line-count': '40',
  'shader-topo-speed': '0.3',
  'heading-color': '#1E3A5F',
  'hero-title-blend': 'normal',
  'hero-title-color': '#ffffff',
  'hero-cta-bg': '#1E40AF',
  'hero-cta-text': '#ffffff',
  'card-hover-scale': '1.01',
  'card-image-hover-scale': '1.02',
  'text-transform-label': 'uppercase',
},
```

**Executive** (id: `executive`)
```typescript
heroLayout: 'default',
tokenOverrides: {
  'shader-preset': 'silk',
  'shader-silk-speed': '0.3',
  'shader-silk-sheen': '0.7',
  'heading-color': '#1E293B',
  'hero-title-blend': 'normal',
  'hero-title-color': '#ffffff',
  'hero-cta-bg': '#D97706',
  'hero-cta-text': '#1E293B',
  'glass-tint': '#D97706',
  'card-hover-scale': '1.015',
  'card-image-hover-scale': '1.03',
  'text-transform-label': 'uppercase',
},
```

**Consulting** (id: `consulting`)
```typescript
heroLayout: 'default',
tokenOverrides: {
  'shader-preset': 'clouds',
  'shader-clouds-speed': '0.4',
  'hero-cta-bg': '#0D9488',
  'hero-cta-text': '#ffffff',
  'card-hover-scale': '1.02',
  'text-transform-label': 'capitalize',
},
```

### Creative Category

**Vibrant** (id: `vibrant`)
```typescript
heroLayout: 'centered',
tokenOverrides: {
  'shader-preset': 'glow',
  'shader-glow-count': '8',
  'shader-glow-size': '0.6',
  'heading-color': '#7C3AED',
  'hero-glass-tint': '#EC4899',
  'hero-border-tint': '#EC4899',
  'glass-tint': '#EC4899',
  'card-hover-scale': '1.04',
  'card-image-hover-scale': '1.08',
  'text-transform-label': 'none',
},
```

**Sunset** (id: `sunset`)
```typescript
heroLayout: 'default',
tokenOverrides: {
  'shader-preset': 'nebula',
  'shader-nebula-speed': '0.3',
  'shader-nebula-density': '0.6',
  'hero-glass-tint': '#FBBF24',
  'hero-border-tint': '#FBBF24',
  'glass-tint': '#FBBF24',
  'card-hover-scale': '1.03',
  'text-transform-label': 'capitalize',
},
```

**Ocean** (id: `ocean`)
```typescript
heroLayout: 'default',
tokenOverrides: {
  'shader-preset': 'caustic',
  'shader-caustic-speed': '0.5',
  'shader-caustic-brightness': '0.6',
  'hero-glass-tint': '#34D399',
  'hero-border-tint': '#0891B2',
  'glass-tint': '#34D399',
  'card-hover-scale': '1.02',
},
```

### Bold Category

**Dark** (id: `dark`)
```typescript
heroLayout: 'centered',
tokenOverrides: {
  'shader-preset': 'ether',
  'shader-intensity': '0.7',
  'heading-color': '#818CF8',
  'hero-title-blend': 'normal',
  'hero-title-color': '#818CF8',
  'hero-glass-tint': '#818CF8',
  'glass-tint': '#A78BFA',
  'card-hover-scale': '1.03',
},
```
Also update `values.darkOverrides`:
```typescript
darkOverrides: {
  primaryColor: '#A78BFA',
  backgroundColor: '#0B1120',
},
```

**Neon** (id: `neon`)
```typescript
heroLayout: 'default',
tokenOverrides: {
  'shader-preset': 'flux',
  'shader-flux-line-density': '0.7',
  'shader-flux-speed': '0.5',
  'heading-color': '#22D3EE',
  'hero-title-blend': 'normal',
  'hero-title-color': '#22D3EE',
  'hero-glass-tint': '#A3E635',
  'hero-border-tint': '#22D3EE',
  'player-text': '#22D3EE',
  'glass-tint': '#A3E635',
  'card-hover-scale': '1.05',
  'card-image-hover-scale': '1.1',
  'text-transform-label': 'uppercase',
},
```
Also update `values.darkOverrides`:
```typescript
darkOverrides: {
  primaryColor: '#67E8F9',
  backgroundColor: '#050505',
},
```

**Ember** (id: `ember`)
```typescript
heroLayout: 'default',
tokenOverrides: {
  'shader-preset': 'lava',
  'shader-lava-glow': '0.7',
  'shader-lava-speed': '0.4',
  'heading-color': '#DC2626',
  'hero-glass-tint': '#EA580C',
  'hero-border-tint': '#DC2626',
  'glass-tint': '#EA580C',
  'card-hover-scale': '1.03',
},
```

### Minimal Category

**Minimal** (id: `minimal`)
```typescript
heroLayout: 'default',
tokenOverrides: {
  'card-hover-scale': '1.0',
  'card-image-hover-scale': '1.0',
  'text-transform-label': 'none',
},
```
No shader.

**Paper** (id: `paper`)
```typescript
heroLayout: 'default',
tokenOverrides: {
  'heading-color': '#78716C',
  'glass-tint': '#D6D3D1',
  'card-hover-scale': '1.015',
  'text-transform-label': 'capitalize',
},
```
No shader.

**Mono** (id: `mono`)
```typescript
heroLayout: 'default',
tokenOverrides: {
  'heading-color': '#000000',
  'hero-title-blend': 'normal',
  'hero-title-color': '#000000',
  'hero-cta-bg': '#000000',
  'hero-cta-text': '#ffffff',
  'card-hover-scale': '1.01',
  'text-transform-label': 'uppercase',
},
```
Also update `values.darkOverrides`:
```typescript
darkOverrides: {
  primaryColor: '#ffffff',
  backgroundColor: '#0A0A0A',
},
```
No shader.

---

## Verification Steps

### V1: Apply each preset, check shader activates
1. For each of the 10 presets, apply → verify shader appears on hero (or no shader for Minimal/Paper/Mono)
2. Check shader name matches expected (Corporate=topo, Executive=silk, etc.)

### V2: Token overrides take effect
1. Apply "Neon" → verify hero title is cyan (#22D3EE), glass buttons have green tint
2. Apply "Vibrant" → verify card hover scale is dramatic (1.04), text-transform is lowercase
3. Apply "Mono" → verify hero title is black (#000000), no blend mode

### V3: Clean switching
1. Apply "Neon" (has shader, cyan player, aggressive hover)
2. Apply "Minimal" (no shader, no hover, no text-transform)
3. Verify: shader disappears, card hover is flat, labels are sentence case
4. No stale cyan/green tokens leaking through

### V4: Dark overrides
1. Apply "Dark" → toggle dark mode
2. Verify: dark background is #0B1120, primary shifts to #A78BFA
3. Apply "Neon" → toggle dark mode → verify dark overrides apply

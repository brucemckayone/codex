# WP-04: Luxury + Playful Presets (6 New)

## Goal

Add 6 new presets across 2 new categories: Luxury (Onyx, Marble, Velvet) and Playful (Bubblegum, Retro, Arcade).

## Depends On

- WP-01 (Architecture) — new PresetCategory type and tokenOverrides support

---

## Instructions

**File**: `apps/web/src/lib/brand-editor/presets.ts`

Add after the Tech category block:

### Luxury Category

**Onyx**
```typescript
{
  id: 'onyx',
  name: 'Onyx',
  category: 'Luxury',
  description: 'Premium dark — gold accents on near-black, crystalline',
  heroLayout: 'centered',
  values: {
    primaryColor: '#B8860B',
    secondaryColor: '#D4A843',
    accentColor: '#F5DEB3',
    backgroundColor: '#0C0A09',
    fontBody: 'DM Sans',
    fontHeading: 'Playfair Display',
    radius: 0.25,
    density: 0.95,
    darkOverrides: {
      primaryColor: '#D4A843',
      backgroundColor: '#080706',
    },
  },
  tokenOverrides: {
    'shader-preset': 'bismuth',
    'shader-bismuth-iridescence': '0.7',
    'shader-bismuth-speed': '0.3',
    'heading-color': '#B8860B',
    'hero-title-blend': 'normal',
    'hero-title-color': '#D4A843',
    'hero-glass-tint': '#B8860B',
    'hero-border-tint': '#D4A843',
    'player-text': '#D4A843',
    'glass-tint': '#B8860B',
    'card-hover-scale': '1.01',
    'text-transform-label': 'uppercase',
  },
},
```

**Marble**
```typescript
{
  id: 'marble',
  name: 'Marble',
  category: 'Luxury',
  description: 'Refined simplicity — off-white, charcoal veins, pearl shimmer',
  heroLayout: 'default',
  values: {
    primaryColor: '#292524',
    secondaryColor: '#57534E',
    accentColor: '#A8A29E',
    backgroundColor: '#FAFAF9',
    fontBody: 'Cormorant Garamond',
    fontHeading: 'Cormorant Garamond',
    radius: 0.375,
    density: 1.05,
    darkOverrides: {
      primaryColor: '#D6D3D1',
      backgroundColor: '#1C1917',
    },
  },
  tokenOverrides: {
    'shader-preset': 'pearl',
    'shader-pearl-speed': '0.3',
    'shader-pearl-fresnel': '0.6',
    'heading-color': '#292524',
    'glass-tint': '#D6D3D1',
    'card-hover-scale': '1.015',
    'text-transform-label': 'capitalize',
  },
},
```

**Velvet**
```typescript
{
  id: 'velvet',
  name: 'Velvet',
  category: 'Luxury',
  description: 'Deep purple opulence — lavender highlights, silk texture',
  heroLayout: 'centered',
  values: {
    primaryColor: '#A78BFA',
    secondaryColor: '#8B5CF6',
    accentColor: '#C4B5FD',
    backgroundColor: '#1E1B4B',
    fontBody: 'DM Sans',
    fontHeading: 'Cormorant Garamond',
    radius: 0.5,
    density: 1,
    darkOverrides: {
      primaryColor: '#C4B5FD',
      backgroundColor: '#0F0D2E',
    },
  },
  tokenOverrides: {
    'shader-preset': 'silk',
    'shader-silk-speed': '0.3',
    'shader-silk-sheen': '0.8',
    'shader-silk-softness': '0.6',
    'heading-color': '#C4B5FD',
    'hero-title-blend': 'normal',
    'hero-title-color': '#C4B5FD',
    'hero-glass-tint': '#A78BFA',
    'hero-border-tint': '#8B5CF6',
    'glass-tint': '#A78BFA',
    'card-hover-scale': '1.02',
    'text-transform-label': 'none',
  },
},
```

### Playful Category

**Bubblegum**
```typescript
{
  id: 'bubblegum',
  name: 'Bubblegum',
  category: 'Playful',
  description: 'Sugar rush — hot pink, bouncy radius, floating orbs',
  heroLayout: 'centered',
  values: {
    primaryColor: '#EC4899',
    secondaryColor: '#F472B6',
    accentColor: '#FBBF24',
    backgroundColor: null,
    fontBody: 'Nunito',
    fontHeading: 'Fredoka',
    radius: 1.5,
    density: 1.05,
    darkOverrides: {
      primaryColor: '#F9A8D4',
    },
  },
  tokenOverrides: {
    'shader-preset': 'glow',
    'shader-glow-count': '12',
    'shader-glow-pulse': '0.5',
    'shader-glow-size': '0.7',
    'hero-glass-tint': '#FBBF24',
    'hero-border-tint': '#EC4899',
    'glass-tint': '#F9A8D4',
    'card-hover-scale': '1.05',
    'card-image-hover-scale': '1.1',
    'text-transform-label': 'none',
  },
},
```

**Retro**
```typescript
{
  id: 'retro',
  name: 'Retro',
  category: 'Playful',
  description: 'Throwback vibes — orange zest, cream canvas, film grain',
  heroLayout: 'default',
  values: {
    primaryColor: '#EA580C',
    secondaryColor: '#DC2626',
    accentColor: '#FBBF24',
    backgroundColor: '#FFFBEB',
    fontBody: 'Space Grotesk',
    fontHeading: 'Archivo Black',
    radius: 0.75,
    density: 1,
    darkOverrides: {
      primaryColor: '#FB923C',
      backgroundColor: '#1A1207',
    },
  },
  tokenOverrides: {
    'shader-preset': 'film',
    'shader-film-speed': '0.3',
    'shader-film-bands': '0.4',
    'heading-color': '#9A3412',
    'hero-glass-tint': '#FBBF24',
    'hero-border-tint': '#EA580C',
    'glass-tint': '#FBBF24',
    'card-hover-scale': '1.03',
    'text-transform-label': 'uppercase',
  },
},
```

**Arcade**
```typescript
{
  id: 'arcade',
  name: 'Arcade',
  category: 'Playful',
  description: 'Game on — bright blue, lime accents, plasma energy',
  heroLayout: 'default',
  values: {
    primaryColor: '#3B82F6',
    secondaryColor: '#A3E635',
    accentColor: '#F472B6',
    backgroundColor: '#0F172A',
    fontBody: 'Space Grotesk',
    fontHeading: 'Space Grotesk',
    radius: 0.5,
    density: 0.95,
    darkOverrides: {
      primaryColor: '#60A5FA',
      backgroundColor: '#080E1F',
    },
  },
  tokenOverrides: {
    'shader-preset': 'plasma',
    'shader-plasma-speed': '0.5',
    'shader-plasma-bands': '0.6',
    'heading-color': '#3B82F6',
    'hero-title-blend': 'normal',
    'hero-title-color': '#60A5FA',
    'hero-glass-tint': '#A3E635',
    'hero-border-tint': '#3B82F6',
    'player-text': '#60A5FA',
    'glass-tint': '#A3E635',
    'card-hover-scale': '1.05',
    'card-image-hover-scale': '1.1',
    'text-transform-label': 'uppercase',
  },
},
```

---

## Verification Steps

### V1: All 6 presets appear
1. Open Browse Presets → verify "Luxury" (3) and "Playful" (3) categories

### V2: Luxury presets
1. Apply "Onyx" → verify bismuth shader, gold hero title, dark bg, Playfair heading
2. Apply "Marble" → verify pearl shader, off-white bg, Cormorant Garamond, subtle hover
3. Apply "Velvet" → verify silk shader, deep purple bg, lavender headings, centered hero

### V3: Playful presets
1. Apply "Bubblegum" → verify glow shader, bouncy 1.5rem radius, Fredoka heading, no text-transform
2. Apply "Retro" → verify film shader, cream bg, Archivo Black heading, orange glass
3. Apply "Arcade" → verify plasma shader, dark bg, lime glass, aggressive hover

### V4: Font loading
1. Verify Google Fonts load for: Playfair Display, Cormorant Garamond, Fredoka, Archivo Black, IBM Plex Sans
2. No FOUT (flash of unstyled text) — fallback fonts should have size-adjust

# Design Tokens

**Warmth encoded as data. The foundation of belonging.**

---

## Foundation

Tokens connect [00. Mission](../00-mission/README.md) to implementation.

Every token asks: **Does this value express warmth and welcome?**

---

## What Tokens Are

Tokens are **design philosophy as structured data**:

```
Mission (belonging over buying)
        ↓
Philosophy (warmth, community)
        ↓
Tokens (cream-50, teal-400, 8px radius)
        ↓
Code (CSS, JS, Figma variables)
```

**Not**: Random values that "look nice"
**Yes**: Philosophy translated into numbers

---

## The Warmth Palette

### Colors

| Token | Value | Purpose |
|-------|-------|---------|
| `color.primary` | Teal (#14B8A6) | Welcoming, not corporate |
| `color.surface.default` | Cream-50 (#FEFDFB) | Warm light, not cold white |
| `color.surface.elevated` | Cream-100 (#FAF8F5) | Subtle lift |
| `color.text.primary` | Cream-900 (#1C1917) | Warm dark, not pure black |
| `color.accent` | Coral (#F97316) | Celebration moments |

### The Warmth Test

```
Cool Gray #9CA3AF → ❌ Spreadsheet feeling
Warm Cream #FAF8F5 → ✅ Studio feeling
```

---

## Token Structure

**Format**: W3C Design Tokens Community Group (JSON)

```json
{
  "color": {
    "surface": {
      "default": {
        "value": "#FEFDFB",
        "type": "color",
        "description": "Primary background - warm cream, welcoming"
      }
    }
  }
}
```

---

## Token Categories

| File | Purpose | Philosophy |
|------|---------|------------|
| [color.tokens.json](./color.tokens.json) | All colors | Warmth first (teal/cream) |
| [typography.tokens.json](./typography.tokens.json) | Type system | Humanist, readable |
| [spacing.tokens.json](./spacing.tokens.json) | Rhythm | Room to breathe |
| [shadow.tokens.json](./shadow.tokens.json) | Elevation | Warm shadows (brown-tinted) |
| [radius.tokens.json](./radius.tokens.json) | Corners | Human touch (8px default) |
| [motion.tokens.json](./motion.tokens.json) | Animation | Smooth, confident |
| [z-index.tokens.json](./z-index.tokens.json) | Stacking | Predictable layers |

---

## Naming Convention

**Format**: `{category}.{semantic}.{variant}.{state}`

**Examples**:
```
color.surface.default           → Warm cream background
color.surface.elevated          → Lifted surface
color.action.primary            → Teal CTA
color.action.primary.hover      → Darker teal on hover
color.text.primary              → Warm dark text
color.text.secondary            → Muted warm text
spacing.component.padding       → Internal component space
shadow.elevation.1              → Subtle warm lift
```

**Rules**:
1. Semantic names (not `gray-100`, but `surface.default`)
2. Intent-based (describes job, not appearance)
3. Consistent hierarchy

---

## Usage

### CSS Variables

```css
:root {
  /* Colors - Warmth First */
  --color-surface-default: #FEFDFB;  /* cream-50 */
  --color-surface-elevated: #FAF8F5; /* cream-100 */
  --color-text-primary: #1C1917;     /* cream-900 */
  --color-action-primary: #14B8A6;   /* teal-500 */

  /* Shadows - Warm, not cool */
  --shadow-sm: 0 1px 2px rgba(45, 42, 37, 0.06);
  --shadow-md: 0 4px 6px rgba(45, 42, 37, 0.08);

  /* Radii - Human touch */
  --radius-default: 8px;
  --radius-full: 9999px;
}

.card {
  background: var(--color-surface-elevated);
  border-radius: var(--radius-default);
  box-shadow: var(--shadow-md);
}
```

### TypeScript

```typescript
import { tokens } from '@codex/design-tokens';

const warmBackground = tokens.color.surface.default;
const primaryAction = tokens.color.action.primary;
```

### Tailwind Config

```javascript
// tailwind.config.js
const tokens = require('@codex/design-tokens');

module.exports = {
  theme: {
    colors: {
      cream: tokens.color.cream,
      teal: tokens.color.teal,
      coral: tokens.color.coral,
    },
    borderRadius: tokens.radius,
    boxShadow: tokens.shadow,
  },
};
```

---

## Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│  GLOBAL TOKENS (Raw Values)                             │
│  teal-500: #14B8A6                                      │
│  cream-50: #FEFDFB                                      │
│  spacing-4: 16px                                        │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│  SEMANTIC TOKENS (Meaning)                              │
│  color-action-primary: {teal-500}                       │
│  color-surface-default: {cream-50}                      │
│  spacing-component-padding: {spacing-4}                 │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│  COMPONENT TOKENS (Usage)                               │
│  button-bg-primary: {color-action-primary}              │
│  card-bg: {color-surface-elevated}                      │
│  card-padding: {spacing-component-padding}              │
└─────────────────────────────────────────────────────────┘
```

**Why three layers?**
- Global → Change once, update everywhere
- Semantic → Communicate intent
- Component → Enable theming without breaking

---

## Collective Customization

Collectives can override brand colors while maintaining warmth:

```json
{
  "collective": {
    "brand": {
      "primary": {
        "value": "#8B5CF6",
        "type": "color",
        "description": "Collective's primary brand color"
      }
    }
  }
}
```

**Validation**: See [10-theming](../10-theming/README.md) for brand color accessibility requirements.

---

## Build Process

**Tool**: Style Dictionary

```bash
pnpm run build:tokens

# Outputs:
# dist/tokens.css     → CSS custom properties
# dist/tokens.js      → JavaScript/TypeScript
# dist/tokens.d.ts    → Type definitions
# dist/tokens.scss    → SCSS variables
# dist/figma.json     → Figma variables format
```

---

## Versioning

Tokens follow semantic versioning:

| Change | Version | Breaking? |
|--------|---------|-----------|
| Value adjustment (color tweak) | Patch | No |
| New token added | Minor | No |
| Token renamed/removed | Major | Yes |

**Current version**: `2.0.0`

---

## Contributing

See [12-governance](../12-governance/README.md) for contribution process.

**Adding tokens**:
1. Check philosophy alignment (warmth, belonging)
2. Add to appropriate `*.tokens.json`
3. Run `pnpm build:tokens`
4. Submit PR with reasoning
5. Core team review

---

## Anti-Patterns

| Anti-Pattern | Why It's Wrong | What Instead |
|--------------|----------------|--------------|
| `gray-100` naming | Appearance-based, not semantic | `surface.default` |
| `#FFFFFF` pure white | Cold, clinical | `cream-50` warm white |
| `#000000` pure black | Harsh, unwelcoming | `cream-900` warm dark |
| Cool blue shadows | Corporate, cold | Brown-tinted shadows |
| Hardcoded values in CSS | Bypasses system | Use token variables |

---

## The Token Test

Before adding or changing any token:

1. **Does it express warmth?** Cream over gray, teal over blue
2. **Is it semantic?** Describes job, not appearance
3. **Does it enable belonging?** Accessible, welcoming

If any answer is no → reconsider the value.

---

*Last updated: 2026-01-04*
*Version: 2.0*
*Status: Foundation document — warmth as data*

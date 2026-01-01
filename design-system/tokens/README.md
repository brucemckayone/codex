# Design Tokens

**Design decisions as data. Single source of truth.**

---

## Purpose

Tokens are **design decisions encoded as structured data** that can be consumed by:
- Design tools (Figma variables)
- Code (CSS, JS, TypeScript)
- Documentation (automated)
- Multiple platforms (web, iOS, Android)

**Not**: Random values in code
**Yes**: Centralized, semantic, versioned design data

---

## Token Structure

**Format**: JSON (W3C Design Tokens Community Group format)

**Example**:
```json
{
  "color": {
    "text": {
      "primary": {
        "value": "#111827",
        "type": "color",
        "description": "Default text color for body content"
      }
    }
  }
}
```

---

## Token Categories

| File | Purpose | Exports |
|------|---------|---------|
| [color.tokens.json](./color.tokens.json) | All colors (text, bg, borders, states) | 200+ tokens |
| [typography.tokens.json](./typography.tokens.json) | Font sizes, weights, line heights | 50+ tokens |
| [spacing.tokens.json](./spacing.tokens.json) | Margins, padding, gaps | 20+ tokens |
| [shadow.tokens.json](./shadow.tokens.json) | Box shadows, elevations | 10+ tokens |
| [radius.tokens.json](./radius.tokens.json) | Border radii | 8 tokens |
| [motion.tokens.json](./motion.tokens.json) | Durations, easing curves | 10+ tokens |
| [z-index.tokens.json](./z-index.tokens.json) | Stacking order | 6 tokens |

---

## Usage

### In Code (TypeScript/JavaScript)

```typescript
import { tokens } from '@codex/design-tokens';

const primaryColor = tokens.color.action.primary.default;
const spacing = tokens.spacing.default;
```

### In CSS (CSS Variables)

```css
:root {
  --color-text-primary: #111827;
  --spacing-default: 1rem;
}

.button {
  color: var(--color-text-primary);
  padding: var(--spacing-default);
}
```

### In Tailwind Config

```javascript
// tailwind.config.js
const tokens = require('@codex/design-tokens');

module.exports = {
  theme: {
    colors: tokens.color,
    spacing: tokens.spacing,
  },
};
```

---

## Build Process

**Tool**: Style Dictionary

**Input**: `*.tokens.json` (design decisions)
**Output**: Platform-specific files (CSS, JS, iOS, Android)

**Example**:
```bash
npm run build:tokens

# Generates:
# - dist/tokens.css (CSS variables)
# - dist/tokens.js (JavaScript object)
# - dist/tokens.d.ts (TypeScript types)
# - dist/tokens.scss (SCSS variables)
```

---

## Naming Convention

**Format**: `{category}.{role}.{variant}.{state}`

**Examples**:
```
color.text.primary                    (category.role.variant)
color.action.primary.hover            (category.role.variant.state)
spacing.section.default               (category.role.variant)
typography.heading.h1.fontSize        (category.role.variant.property)
```

**Rules**:
1. Semantic (not appearance-based)
2. Hierarchical (dot-separated)
3. Consistent (same structure across categories)

---

## Versioning

Tokens follow semantic versioning:
- **Patch**: Value adjustments (color shift, spacing tweak)
- **Minor**: New tokens added
- **Major**: Token names changed/removed (breaking)

**Current version**: `1.0.0`

---

## Extending Tokens

**Organization-specific overrides**:
```json
{
  "color": {
    "brand": {
      "primary": {
        "value": "#8B5CF6",
        "type": "color",
        "override": true
      }
    }
  }
}
```

**Merge with base tokens** → organization-specific theme

---

## Token Files

All token files are in this directory:

- [color.tokens.json](./color.tokens.json)
- [typography.tokens.json](./typography.tokens.json)
- [spacing.tokens.json](./spacing.tokens.json)
- [shadow.tokens.json](./shadow.tokens.json)
- [radius.tokens.json](./radius.tokens.json)
- [motion.tokens.json](./motion.tokens.json)
- [z-index.tokens.json](./z-index.tokens.json)

---

## Contributing

**To add tokens**:
1. Edit relevant `*.tokens.json` file
2. Run `npm run build:tokens` (validate)
3. Create PR (document why new tokens needed)
4. Review by Design System Team
5. Merge → automated publish

**To change tokens**:
- **Value change**: Patch version (safe)
- **Name change**: Major version (breaking, requires migration guide)

---

## Documentation

Full token reference: [Design System → Tokens](../README.md#tokens)

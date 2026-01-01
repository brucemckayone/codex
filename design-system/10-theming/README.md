# 10. Theming & Extensibility

**Future-proofing. Tokens, skins, customization boundaries.**

---

## Purpose

Theming enables:
- **Dark mode** (user preference)
- **Brand customization** (white-labeling for organizations)
- **Accessibility themes** (high contrast, large text)
- **Future evolution** (without breaking existing implementations)

**Key principle**: Design once, theme infinitely.

---

## Token Strategy

### Design Tokens

**Format**: JSON or TypeScript

**Structure**:
```json
{
  "color": {
    "text": {
      "primary": {
        "light": "#111827",
        "dark": "#f3f4f6"
      }
    }
  }
}
```

**Naming convention**: `{category}.{role}.{variant}.{mode}`

---

### Token Categories

1. **Color**: Text, backgrounds, borders, states
2. **Typography**: Sizes, weights, line heights
3. **Spacing**: Margins, padding, gaps
4. **Shadow**: Elevations, glows
5. **Radius**: Border radii
6. **Motion**: Durations, easing curves

**Full tokens**: [/tokens](../tokens/)

---

## Light vs Dark Mode

### Approach: Semantic Tokens

**Don't**: Hard-code colors in components
```jsx
<div style={{ color: '#111827' }}>
```

**Do**: Use semantic tokens
```jsx
<div className="text-primary">
```

**Maps to**:
- Light mode: `#111827` (dark text)
- Dark mode: `#f3f4f6` (light text)

---

### Dark Mode Adjustments

**Backgrounds**: Invert (white → near-black)
```
Light: white, gray-50, gray-100
Dark:  gray-950, gray-900, gray-800
```

**Text**: Reduce contrast (prevent glare)
```
Light: gray-900, gray-700, gray-500
Dark:  gray-100, gray-300, gray-500
```

**Colors**: Desaturate (prevent eye strain)
```
Light: blue-500 (91% saturation)
Dark:  blue-400 (80% saturation)
```

**Shadows**: Lighter, more subtle
```
Light: rgba(0,0,0,0.1)
Dark:  rgba(0,0,0,0.3) (lighter relative to bg)
```

---

### Mode Selection

**User preference** (respected):
```javascript
const theme = useTheme();
// 'light', 'dark', or 'system' (follows OS)
```

**System detection**:
```css
@media (prefers-color-scheme: dark) {
  /* Dark mode styles */
}
```

**Toggle**:
```jsx
<ThemeToggle /> // Light/Dark/System
```

---

## Brand Theming (Organization Customization)

### Customizable Properties

**Allowed**:
- Primary brand color (CTA buttons, links)
- Logo (header, favicon)
- Organization name
- Accent color (secondary elements)

**Not allowed**:
- Spacing, typography (breaks consistency)
- Layout structure (breaks usability)
- Functional colors (error, success, warning)

---

### Token Override

**Organization-specific**:
```javascript
{
  "brandColor": {
    "primary": "#8B5CF6" // Purple instead of blue
  }
}
```

**Applied to**:
- Primary buttons
- Links
- Active nav items
- Focus rings

**Not applied to**:
- Error states (always red)
- Success states (always green)
- Text colors (always gray scale)

---

## Accessibility Themes

### High Contrast Mode

**Purpose**: Low vision users

**Changes**:
- Text contrast: 7:1 → 12:1
- Border thickness: 1px → 2px
- Focus rings: 3px → 4px

**Detection**:
```css
@media (prefers-contrast: more) {
  /* High contrast overrides */
}
```

---

### Large Text Mode

**Purpose**: Low vision, older users

**Changes**:
- Base font size: 16px → 18px
- Spacing: 1.5x scale
- Touch targets: 48px → 56px

**User toggle**: Settings > Accessibility > Large Text

---

## Versioning Strategy

### Semantic Versioning

**Format**: `MAJOR.MINOR.PATCH`

**Examples**:
- `1.0.0` → Initial release
- `1.1.0` → New component added (backwards compatible)
- `1.0.1` → Bug fix (backwards compatible)
- `2.0.0` → Breaking change (new token structure)

---

### Breaking Changes

**Considered breaking**:
- Token name changes
- Component API changes
- Removed components
- Color value shifts > 10%

**Not breaking**:
- New tokens added
- New components added
- Documentation updates

---

### Migration Guides

**Required for** breaking changes:

**Example**: v1 → v2 token migration
```diff
- color.primary.500
+ color.action.primary.default
```

**Includes**:
- What changed
- Why changed
- How to migrate
- Automated migration script (if possible)

---

## Customization Boundaries

### Allowed Customization

**By organizations**:
- Primary brand color
- Logo/favicon
- Organization name

**By users**:
- Light/dark mode
- Accessibility themes (high contrast, large text)

---

### Locked Properties

**Never customizable**:
- Spacing scale (consistency)
- Typography scale (readability)
- Component structure (usability)
- Functional colors (meaning)

**Why?** Maintains usability, accessibility, brand consistency

---

## Token Architecture

### Layers

```
1. Global Tokens (primitives)
   ├─ color.blue.500
   ├─ spacing.4
   └─ fontSize.base

2. Semantic Tokens (roles)
   ├─ color.action.primary → color.blue.500
   ├─ spacing.default → spacing.4
   └─ typography.body → fontSize.base

3. Component Tokens (specific)
   ├─ button.bg → color.action.primary
   ├─ button.padding → spacing.default
   └─ button.fontSize → typography.body
```

**Benefit**: Change `color.blue.500` → propagates everywhere

---

## Token Distribution

### For Developers

**Package**: `@codex/design-tokens`

**Import**:
```javascript
import { tokens } from '@codex/design-tokens';

const primaryColor = tokens.color.action.primary.default;
```

---

### For Designers

**Figma**: Token sync plugin (Tokens Studio)

**Export**: JSON → Figma variables

**Benefit**: Single source of truth

---

## Testing Themes

**Checklist**:

- [ ] Light mode (all components)
- [ ] Dark mode (all components)
- [ ] High contrast mode (functional)
- [ ] Large text mode (no overflow)
- [ ] Brand color override (still accessible)

**Automated**:
- Contrast ratios (all theme combos)
- No hard-coded colors (lint rule)

---

## Living Document

Theming evolves with product needs. Changes require:

1. Token schema updates
2. Migration guide (if breaking)
3. Component audits (verify tokens applied)
4. Documentation updates

**Change log**:

| Date | Change | Reasoning |
|------|--------|-----------|
| 2026-01-01 | Initial theming system | Foundation |

---

Next: [11. Engineering Contract →](../11-engineering/README.md)

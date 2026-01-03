# 10. Theming & Extensibility

**Your community, your colors. How Collectives express identity while maintaining warmth.**

---

## Foundation

This document extends the philosophy from [01. Philosophy](../01-philosophy/README.md) and [03. Color](../03-color/README.md).

Every theming decision must answer: **Does this let communities express themselves while keeping everyone feeling welcome?**

---

## Theming Philosophy

### Community Identity

Collectives are more than brands—they're homes. And homes deserve personality.

Consider how creative studios express identity:

| Space | Expression |
|-------|------------|
| Yoga studio | Earthy tones, natural materials, calm atmosphere |
| Dance company | Bold colors, dynamic energy, expressive forms |
| Music school | Rich, classical, dignified but approachable |
| Art collective | Minimal, gallery-like, letting work speak |

**Each is different, all are welcoming.**

**Codex theming enables:** Community personality without sacrificing warmth.

---

### The Expression Spectrum

```
Rigid ◄──────────────────────────────────────────────► Chaotic

Locked     Minimal    Controlled ║  Codex  ║ Flexible  Wild
No choice  Logo only  Few options ║         ║ Many opts Anything
    │          │           │      ║         ║     │       │
    └──────────┴───────────┴──────╨─────────╨─────┴───────┘
                                  ▲
                            We live here
```

**Codex theming is:**
- Flexible enough for identity (not locked to one look)
- Controlled enough for consistency (not chaotic)
- Always warm (never cold regardless of brand colors)
- Always accessible (never sacrificing readability)

---

### Core Theming Principles

1. **Identity Within Warmth**
   - Collectives express themselves
   - But warmth is non-negotiable
   - A blue brand stays warm through cream backgrounds
   - A purple brand stays warm through soft tones

2. **Consistency Through Constraints**
   - Some things change (brand colors, logo)
   - Some things don't (spacing, typography, warmth)
   - Constraints create coherence

3. **Accessibility Above Expression**
   - Brand colors must pass contrast
   - If a brand color fails, we adjust it
   - Expression never trumps belonging

4. **Warmth in Every Mode**
   - Light mode: Warm and inviting
   - Dark mode: Warm and cozy (not cold)
   - High contrast: Warm and clear

---

## What Collectives Can Customize

### Allowed Customizations

| Property | Why Allowed | Constraints |
|----------|-------------|-------------|
| Primary brand color | Community identity | Must pass 4.5:1 contrast |
| Accent color | Secondary identity | Must pass 3:1 contrast |
| Logo | Brand recognition | Provided with light/dark variants |
| Collective name | Identity | Character limits |
| Banner image | Community atmosphere | Aspect ratio, accessibility |
| Custom welcome message | Personal touch | Character limits |

---

### Protected Properties

| Property | Why Protected | Reason |
|----------|---------------|--------|
| Spacing scale | Consistency | Breaking spacing breaks rhythm |
| Typography | Readability | Custom fonts risk accessibility |
| Cream backgrounds | Warmth foundation | Cold backgrounds = cold community |
| Functional colors | Universal meaning | Red = error, green = success |
| Border radius | Visual cohesion | Sharp corners = cold feel |
| Touch targets | Accessibility | 44px minimum, non-negotiable |

**Philosophy:** Express through color and imagery. Don't express through structure.

---

## Token Architecture

### Three-Layer System

```
Layer 1: Global Tokens (Primitives)
├── Raw values: teal-500, cream-100, 16px
├── Never used directly in components
└── Source of all values

Layer 2: Semantic Tokens (Roles)
├── What values mean: action-primary, surface-elevated
├── Theme-switchable (light → dark)
└── Used by components

Layer 3: Component Tokens (Specific)
├── Component-specific: button-bg, card-border
├── Inherit from semantic tokens
└── Override-able for edge cases
```

**Example flow:**
```
teal-500 (global)
    ↓
color.action.primary (semantic)
    ↓
button.background (component)
```

**Benefit:** Change one place, propagates everywhere.

---

### Token Naming Convention

**Pattern:** `{category}.{role}.{variant}.{state}`

**Examples:**
```javascript
// Color tokens
color.surface.default        // cream-50 (light) or cream-950 (dark)
color.surface.elevated       // cream-100 (light) or cream-900 (dark)
color.text.primary           // cream-900 (light) or cream-100 (dark)
color.text.secondary         // cream-600 (light) or cream-400 (dark)
color.action.primary         // teal-500
color.action.primary.hover   // teal-600

// Spacing tokens
spacing.xs                   // 4px
spacing.sm                   // 8px
spacing.md                   // 16px
spacing.lg                   // 24px

// Typography tokens
typography.body.size         // 16px
typography.body.lineHeight   // 1.5
typography.heading.weight    // 700
```

---

### Collective Brand Token Override

When a Collective sets a brand color, it overrides specific semantic tokens:

```javascript
// Default Codex theme
color.action.primary = teal-500

// Collective override: "Movement Studio" uses purple
collectiveTheme: {
  brandColor: '#8B5CF6'  // Purple
}

// Results in:
color.action.primary = '#8B5CF6'
// Applied to: primary buttons, links, focus rings, progress bars
// Not applied to: backgrounds, text, functional colors
```

**Automatic adjustments:**
- If brand color fails contrast on cream-50, darken it
- If brand color fails contrast on cream-900 (dark mode), lighten it
- Hover/active states auto-generated from brand color

---

## Light Mode

### The Warm Light Philosophy

Light mode isn't just "not dark." It's warm, inviting, like natural daylight through a window.

**Base palette:**
```
Surface default:    cream-50   → warm white, not stark white
Surface elevated:   cream-100  → slight cream tint
Text primary:       cream-900  → warm black, not pure black
Text secondary:     cream-600  → muted, readable
Text tertiary:      cream-500  → hints, timestamps
Borders:            cream-200  → subtle, not harsh
```

**Why cream not white?** Pure white (#FFFFFF) feels clinical. Cream-50 feels like paper in sunlight.

---

### Light Mode Semantic Tokens

```javascript
// Light mode values
{
  color: {
    surface: {
      default: 'cream-50',
      subtle: 'cream-100',
      muted: 'cream-200',
      elevated: 'white',  // Cards pop slightly
    },
    text: {
      primary: 'cream-900',
      secondary: 'cream-600',
      tertiary: 'cream-500',
      inverted: 'cream-50',
    },
    border: {
      default: 'cream-200',
      strong: 'cream-300',
      subtle: 'cream-100',
    },
    action: {
      primary: 'teal-500',
      primaryHover: 'teal-600',
      secondary: 'cream-200',
      secondaryHover: 'cream-300',
    },
    feedback: {
      success: 'green-500',
      error: 'red-500',
      warning: 'amber-500',
      info: 'slate-500',
      celebration: 'coral-500',
    }
  }
}
```

---

## Dark Mode

### The Warm Dark Philosophy

Dark mode isn't "invert everything." It's cozy, like evening in a candlelit studio.

**The problem with cold dark:**
- Pure black (#000000) feels like a void
- Blue-tinted dark feels corporate
- Cool gray feels like a spreadsheet

**Our approach:** Warm dark—cream undertones even in darkness.

---

### Warm Dark Palette

```
Surface default:    cream-950  → warm near-black (#1C1917)
Surface elevated:   cream-900  → warm dark (#292524)
Text primary:       cream-100  → warm off-white (not stark)
Text secondary:     cream-400  → muted, readable
Text tertiary:      cream-500  → hints, timestamps
Borders:            cream-800  → subtle but visible
```

**Why cream-950 not black?** Brown undertones (#1C1917) feel warmer than blue undertones (#0F172A).

---

### Dark Mode Adjustments

**Principle:** Dark mode isn't just light mode inverted.

| Light Mode | Dark Mode | Why Different |
|------------|-----------|---------------|
| teal-500 | teal-400 | Lighter on dark backgrounds for readability |
| cream-900 text | cream-100 text | Inverted for contrast |
| White cards | cream-900 cards | Slightly lighter than background |
| Subtle shadows | Stronger shadows | Need more definition on dark |
| 7:1 contrast | 7:1 contrast | Same standard, different values |

**Color saturation:** Reduce slightly in dark mode (prevents eye strain)
```
Light: teal-500 (91% saturation)
Dark:  teal-400 (85% saturation)
```

---

### Dark Mode Semantic Tokens

```javascript
// Dark mode values
{
  color: {
    surface: {
      default: 'cream-950',
      subtle: 'cream-900',
      muted: 'cream-800',
      elevated: 'cream-900',  // Slightly lighter for cards
    },
    text: {
      primary: 'cream-100',
      secondary: 'cream-400',
      tertiary: 'cream-500',
      inverted: 'cream-900',
    },
    border: {
      default: 'cream-800',
      strong: 'cream-700',
      subtle: 'cream-900',
    },
    action: {
      primary: 'teal-400',  // Lighter for dark backgrounds
      primaryHover: 'teal-300',
      secondary: 'cream-800',
      secondaryHover: 'cream-700',
    },
    feedback: {
      success: 'green-400',  // Lighter variants
      error: 'red-400',
      warning: 'amber-400',
      info: 'slate-400',
      celebration: 'coral-400',
    }
  },
  shadow: {
    // Shadows are more pronounced in dark mode
    sm: '0 1px 2px rgba(0, 0, 0, 0.3)',
    md: '0 4px 6px rgba(0, 0, 0, 0.4)',
    lg: '0 10px 15px rgba(0, 0, 0, 0.5)',
  }
}
```

---

## Mode Selection

### User Control

Users choose their preference:

```
┌─────────────────────────────────────┐
│ Appearance                          │
│                                     │
│ ○ Light      ● System     ○ Dark   │
│                                     │
│ Uses your device's setting to       │
│ automatically switch modes.         │
└─────────────────────────────────────┘
```

**Options:**
- **Light** — Always light mode
- **System** — Follows OS preference (default)
- **Dark** — Always dark mode

---

### Technical Implementation

**CSS approach (prefer):**
```css
:root {
  /* Light mode tokens (default) */
  --color-surface: var(--cream-50);
  --color-text: var(--cream-900);
}

@media (prefers-color-scheme: dark) {
  :root {
    /* Dark mode overrides */
    --color-surface: var(--cream-950);
    --color-text: var(--cream-100);
  }
}

/* User override via data attribute */
[data-theme="dark"] {
  --color-surface: var(--cream-950);
  --color-text: var(--cream-100);
}

[data-theme="light"] {
  --color-surface: var(--cream-50);
  --color-text: var(--cream-900);
}
```

**React context:**
```typescript
const ThemeContext = createContext<{
  mode: 'light' | 'dark' | 'system';
  setMode: (mode: 'light' | 'dark' | 'system') => void;
  resolvedMode: 'light' | 'dark';
}>();
```

---

## Accessibility Themes

### High Contrast Mode

For users who need stronger visual definition.

**Triggered by:**
```css
@media (prefers-contrast: more) {
  /* High contrast overrides */
}
```

**Changes:**
| Property | Default | High Contrast |
|----------|---------|---------------|
| Text contrast | 7:1 | 12:1+ |
| Border width | 1px | 2px |
| Focus ring | 3px | 4px |
| Border contrast | 3:1 | 4.5:1 |

**Implementation:**
```css
@media (prefers-contrast: more) {
  :root {
    --border-width: 2px;
    --focus-ring-width: 4px;
    --color-border: var(--cream-400);  /* Stronger */
  }
}
```

---

### Large Text Mode

For users who need larger text.

**User toggle:** Settings → Accessibility → Large Text

**Changes:**
| Property | Default | Large |
|----------|---------|-------|
| Base font | 16px | 20px |
| Line height | 1.5 | 1.6 |
| Touch targets | 44px | 56px |
| Spacing | 1x | 1.25x |

---

### Reduced Motion Mode

**See:** [09. Accessibility](../09-accessibility/README.md#reduced-motion)

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Collective Theming

### How Creators Customize

When creating a Collective, creators can:

```
┌─────────────────────────────────────┐
│ Collective Branding                 │
│                                     │
│ Primary Color                       │
│ ┌─────────────────────────────────┐ │
│ │ [#8B5CF6] ████████              │ │
│ └─────────────────────────────────┘ │
│ This color will be used for         │
│ buttons and highlights.             │
│                                     │
│ Logo                                │
│ ┌─────────────────────────────────┐ │
│ │ [Upload logo] Light & dark      │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Banner Image                        │
│ ┌─────────────────────────────────┐ │
│ │ [Upload banner] 1920×480        │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

---

### Brand Color Validation

**Automatic checks:**
1. Contrast on light background (cream-50): ≥ 4.5:1
2. Contrast on dark background (cream-950): ≥ 4.5:1
3. Not too similar to functional colors (red, green, amber)

**If validation fails:**
```
┌─────────────────────────────────────┐
│ ⚠ Accessibility Adjustment          │
│                                     │
│ Your color #FFFF00 doesn't have     │
│ enough contrast for readability.    │
│                                     │
│ We've adjusted it to #B8A600 which  │
│ maintains your brand feel while     │
│ ensuring everyone can read it.      │
│                                     │
│ [Keep original] [Use adjusted]      │
└─────────────────────────────────────┘
```

---

### Brand Color Application

When a Collective sets brand color, it applies to:

| Element | Application |
|---------|-------------|
| Primary buttons | Background color |
| Text links | Text color |
| Focus rings | Ring color |
| Progress bars | Fill color |
| Toggles (on) | Background color |
| Selected tabs | Indicator color |
| Active nav | Indicator color |

**Never applies to:**
| Element | Reason |
|---------|--------|
| Backgrounds | Would break warmth |
| Body text | Would break readability |
| Error states | Would confuse meaning |
| Success states | Would confuse meaning |

---

## Token Distribution

### For Developers

**Package:** `@codex/design-tokens`

```typescript
import { tokens, darkTokens } from '@codex/design-tokens';

// Use semantic tokens
const buttonBg = tokens.color.action.primary;

// Access raw values if needed
const teal500 = tokens.primitives.color.teal[500];
```

**CSS custom properties:**
```css
.button {
  background: var(--color-action-primary);
  color: var(--color-text-inverted);
}
```

---

### For Designers

**Figma integration:** Tokens Studio plugin

**Workflow:**
1. Design tokens defined in JSON
2. Synced to Figma via plugin
3. Changes in either direction sync
4. Single source of truth

---

## Versioning

### Semantic Versioning

**Format:** `MAJOR.MINOR.PATCH`

| Change | Type | Example |
|--------|------|---------|
| Token renamed | MAJOR | `color.primary` → `color.action.primary` |
| Token value changed | MINOR | `teal-500` → `teal-600` |
| New token added | MINOR | Added `color.surface.subtle` |
| Bug fix | PATCH | Corrected contrast calculation |

---

### Migration Support

**Breaking changes include:**
- Migration guide
- Codemod (automated transformation)
- Deprecation warnings before removal

**Example migration:**
```diff
// v1 → v2 token migration
- tokens.color.primary
+ tokens.color.action.primary

- tokens.color.gray[500]
+ tokens.color.cream[500]
```

---

## Testing Themes

### Checklist

```
□ Light mode
  □ All components visible
  □ Contrast passes (7:1 body, 4.5:1 large)
  □ Warmth maintained (cream, not white)

□ Dark mode
  □ All components visible
  □ Contrast passes (7:1 body, 4.5:1 large)
  □ Warmth maintained (warm black, not blue-black)

□ High contrast mode
  □ Enhanced borders visible
  □ Focus rings prominent
  □ No information lost

□ Brand color override
  □ Still passes contrast
  □ Still feels warm
  □ Functional colors unchanged

□ Mode transitions
  □ No flash of wrong theme
  □ Smooth or instant (no jarring)
```

---

### Automated Testing

**Lint rules:**
- No hard-coded colors in components
- No raw token values (use semantic)
- Contrast ratio checks

**Visual regression:**
- Screenshot comparison per theme
- Component library renders all modes

---

## Anti-Patterns

| Anti-Pattern | Why It's Wrong | What Instead |
|--------------|----------------|--------------|
| Hard-coded colors | Breaks theming | Semantic tokens |
| Pure black in dark mode | Cold, harsh | cream-950 (warm black) |
| Pure white in light mode | Stark, clinical | cream-50 (warm white) |
| Blue-tinted dark mode | Corporate feel | Brown-tinted (cream) |
| Brand color on backgrounds | Breaks warmth | Brand on accents only |
| Ignoring contrast | Excludes users | Validate all colors |
| Same saturation in dark | Eye strain | Reduce saturation |
| Exposing all customization | Chaos | Controlled customization |

---

## The Warmth Test

Before shipping any theme change:

1. **Does light mode feel warm?** Cream, not stark white
2. **Does dark mode feel cozy?** Warm black, not cold
3. **Does the brand color fit?** Works with cream, passes contrast
4. **Is accessibility maintained?** All modes pass WCAG
5. **Does it still feel like Codex?** Community warmth preserved

If any answer is no → adjust before shipping.

---

## Living Document

Theming evolves with Collective needs. Changes require:

1. Token schema updates
2. Migration guide (if breaking)
3. Figma sync
4. Component audit
5. Documentation update

| Date | Change | Reasoning |
|------|--------|-----------|
| 2026-01-01 | Initial theming system | Foundation |
| 2026-01-03 | Complete rewrite | Alignment with Mission. Added warm dark philosophy, Collective customization, cream-based dark mode, brand color validation. |

---

## Summary

**Codex theming in one breath:**

> Every Collective deserves its own identity—their colors, their logo, their personality. But warmth is non-negotiable. Light mode feels like daylight through a window. Dark mode feels like evening in a candlelit studio. Brand colors express identity while maintaining welcome. The system enables expression within constraints that keep everyone feeling at home.

**The test:**

> Does this Collective feel like their own space, while still feeling like a warm community?

If yes → the theme works.
If cold or unwelcoming → adjust the warmth.

---

**Upstream**: [09. Accessibility](../09-accessibility/README.md)
**Downstream**: [11. Engineering](../11-engineering/README.md)

---

*Last updated: 2026-01-03*
*Version: 2.0*
*Status: Foundation document — your community, your colors*

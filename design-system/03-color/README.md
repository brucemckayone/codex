# 03. Color System

**Semantic color contracts. Every color has a job.**

---

## Purpose

Not a palette. A **color system with roles**.

Colors don't exist for aesthetics. They exist to:
- Communicate state (success, error, warning)
- Establish hierarchy (primary, secondary, tertiary)
- Guide interaction (hover, active, disabled)
- Separate surfaces (background layers, elevation)

---

## Color Philosophy

### Principles

1. **Semantic First**: Color names describe purpose, not appearance
   - ✅ `color.action.primary` (role)
   - ❌ `color.blue.600` (appearance)

2. **Accessible Always**: Minimum contrast ratios non-negotiable
   - Text on bg: 7:1 (AAA)
   - Large text: 4.5:1 (AA)
   - UI components: 3:1 (AA)

3. **Calm Base**: UI chrome should recede, not compete
   - Grays for 80% of interface
   - Brand color for 15% (CTAs, nav highlights)
   - Accent colors for 5% (alerts, status)

4. **Consistent Behavior**: Same color = same meaning across product
   - Red always = error/danger
   - Green always = success
   - Blue always = primary action

---

## Color Scale Strategy

### Approach: 50-950 Scale (11 steps)

Each color has 11 shades from lightest (50) to darkest (950).

**Why 11 steps?**
- Enough granularity for subtle UI
- Not so many that designers pick arbitrary values
- Aligns with Tailwind CSS (interoperability)

**Scale structure**:
```
50  → Backgrounds (very subtle)
100 → Backgrounds (subtle)
200 → Borders (light mode)
300 → Disabled states
400 → Placeholders
500 → Base color (light mode default)
600 → Hover states (light mode)
700 → Active states (light mode)
800 → Text on light backgrounds
900 → Text (high contrast)
950 → Text (maximum contrast, dark mode backgrounds)
```

---

## Brand Colors

**Purpose**: Identity, primary actions, navigation.

### Primary Blue

**Role**: Main brand color, primary CTAs, navigation highlights

**Palette**:
```
blue-50:  #eff6ff  (Hover backgrounds)
blue-100: #dbeafe  (Selected states - light)
blue-200: #bfdbfe  (Borders)
blue-300: #93c5fd  (Disabled)
blue-400: #60a5fa  (Placeholders)
blue-500: #3b82f6  (Base - primary button bg)
blue-600: #2563eb  (Hover - primary button hover)
blue-700: #1d4ed8  (Active - primary button active)
blue-800: #1e40af  (Text on light)
blue-900: #1e3a8a  (Text - high contrast)
blue-950: #172554  (Dark mode backgrounds)
```

**Usage**:
- Primary buttons: `bg-blue-500`, hover `bg-blue-600`
- Links: `text-blue-600`, hover `text-blue-700`
- Active nav: `bg-blue-50`, `text-blue-700`
- Focus rings: `ring-blue-300`

**Accessibility**:
- `blue-500` on white: 4.54:1 (AA large text)
- `blue-600` on white: 5.93:1 (AA text)
- `blue-700` on white: 7.84:1 (AAA)

---

### Secondary Purple (Creator Accent)

**Role**: Creator-specific features, analytics, revenue

**Palette**:
```
purple-50:  #faf5ff
purple-100: #f3e8ff
purple-200: #e9d5ff
purple-300: #d8b4fe
purple-400: #c084fc
purple-500: #a855f7  (Base)
purple-600: #9333ea  (Hover)
purple-700: #7e22ce  (Active)
purple-800: #6b21a8
purple-900: #581c87
purple-950: #3b0764
```

**Usage**:
- Creator dashboard highlights
- Revenue charts
- Earnings badges
- "Pro creator" features

**Do not use for**: Primary CTAs, errors, success states

---

## Functional Colors

**Purpose**: System feedback, states, alerts.

### Success Green

**Role**: Confirmations, completed states, positive outcomes

**Palette**:
```
green-50:  #f0fdf4
green-100: #dcfce7
green-200: #bbf7d0
green-300: #86efac
green-400: #4ade80
green-500: #22c55e  (Base)
green-600: #16a34a  (Hover)
green-700: #15803d  (Active)
green-800: #166534
green-900: #14532d
green-950: #052e16
```

**Usage**:
- Success messages: `bg-green-50`, `text-green-700`, `border-green-200`
- Checkmarks: `text-green-600`
- Positive metrics: `text-green-700` (revenue up)
- Success buttons: `bg-green-500` (rare, only for confirmations)

---

### Error Red

**Role**: Errors, warnings, destructive actions

**Palette**:
```
red-50:  #fef2f2
red-100: #fee2e2
red-200: #fecaca
red-300: #fca5a5
red-400: #f87171
red-500: #ef4444  (Base)
red-600: #dc2626  (Hover)
red-700: #b91c1c  (Active)
red-800: #991b1b
red-900: #7f1d1d
red-950: #450a0a
```

**Usage**:
- Error messages: `bg-red-50`, `text-red-700`, `border-red-200`
- Destructive buttons: `bg-red-600`, hover `bg-red-700`
- Form errors: `border-red-300`, `text-red-600`
- Error icons: `text-red-500`

---

### Warning Amber

**Role**: Warnings, cautions, pending states

**Palette**:
```
amber-50:  #fffbeb
amber-100: #fef3c7
amber-200: #fde68a
amber-300: #fcd34d
amber-400: #fbbf24
amber-500: #f59e0b  (Base)
amber-600: #d97706  (Hover)
amber-700: #b45309  (Active)
amber-800: #92400e
amber-900: #78350f
amber-950: #451a03
```

**Usage**:
- Warning banners: `bg-amber-50`, `text-amber-800`, `border-amber-200`
- Pending states: `text-amber-600`
- "Review required" badges: `bg-amber-100`, `text-amber-700`

**Do not use for**: Errors (use red), success (use green)

---

### Info Blue-Gray

**Role**: Informational messages, neutral alerts

**Palette**:
```
slate-50:  #f8fafc
slate-100: #f1f5f9
slate-200: #e2e8f0
slate-300: #cbd5e1
slate-400: #94a3b8
slate-500: #64748b  (Base)
slate-600: #475569  (Hover)
slate-700: #334155  (Active)
slate-800: #1e293b
slate-900: #0f172a
slate-950: #020617
```

**Usage**:
- Info banners: `bg-slate-50`, `text-slate-700`, `border-slate-200`
- Neutral messages
- System updates

---

## Interactive Colors

**Purpose**: Feedback for user actions.

### Hover States

**Rule**: Darken by 1 shade (500 → 600)

**Examples**:
```
Button (blue):
  Default: bg-blue-500
  Hover:   bg-blue-600

Link (blue):
  Default: text-blue-600
  Hover:   text-blue-700
```

---

### Active States

**Rule**: Darken by 2 shades (500 → 700)

**Examples**:
```
Button (blue):
  Active: bg-blue-700

Toggle switch:
  Active: bg-blue-700
```

---

### Focus States

**Rule**: Use 300-level of same color for focus ring

**Examples**:
```
Input (blue):
  Focus: ring-blue-300 ring-3

Button (red):
  Focus: ring-red-300 ring-3
```

**Why 300?** Light enough to see, dark enough to meet contrast (3:1 vs background)

---

### Disabled States

**Rule**: Use gray-300 for backgrounds, gray-500 for text

**Examples**:
```
Button (disabled):
  bg-gray-300, text-gray-500, cursor-not-allowed

Input (disabled):
  bg-gray-100, text-gray-400, border-gray-300
```

**Never**: Don't use color alone to indicate disabled (add cursor, opacity changes)

---

## Surface Colors

**Purpose**: Layering, elevation, depth.

### Neutral Gray Scale

**Primary gray for UI chrome**:

```
gray-50:  #f9fafb  (Page background)
gray-100: #f3f4f6  (Card background)
gray-200: #e5e7eb  (Borders, dividers)
gray-300: #d1d5db  (Disabled backgrounds)
gray-400: #9ca3af  (Placeholder text)
gray-500: #6b7280  (Body text - light bg)
gray-600: #4b5563  (Headings - light bg)
gray-700: #374151  (High contrast text)
gray-800: #1f2937  (Dark mode body text)
gray-900: #111827  (Dark mode headings)
gray-950: #030712  (Dark mode page bg)
```

**Usage (Light Mode)**:
```
Layer 0 (base):       bg-white or bg-gray-50
Layer 1 (cards):      bg-white, border-gray-200
Layer 2 (modals):     bg-white, shadow
Layer 3 (tooltips):   bg-gray-900, text-white
```

**Usage (Dark Mode)**:
```
Layer 0 (base):       bg-gray-950
Layer 1 (cards):      bg-gray-900, border-gray-800
Layer 2 (modals):     bg-gray-900, shadow
Layer 3 (tooltips):   bg-gray-800, text-gray-100
```

---

## Accessibility Requirements

### Contrast Ratios (WCAG)

**Text**:
- Large text (18px+): 4.5:1 (AA), 7:1 (AAA) ← **Our target**
- Normal text: 7:1 (AAA) ← **Our minimum**

**Non-text (UI components)**:
- Borders, icons: 3:1 (AA) ← **Our minimum**
- Focus indicators: 3:1 (AA)

---

### Color Blindness

**Never use color alone** to convey information.

**Examples**:

❌ **Bad**: Red/green without labels
```
Status: ● (red) or ● (green)
```

✅ **Good**: Color + icon + text
```
Error:   ⚠ Failed (red)
Success: ✓ Complete (green)
```

**Test with**:
- Deuteranopia (red-green)
- Protanopia (red-green)
- Tritanopia (blue-yellow)
- Monochromacy (grayscale)

**Tool**: Stark, Contrast Checker, Who Can Use

---

## Dark Mode Strategy

**Approach**: True inversion, not just gray swap

### Principles

1. **Darker is deeper**: Opposite of light mode elevation
2. **Reduce saturation**: Bright colors are harsh in dark
3. **Maintain contrast**: Same 7:1 ratio for text

---

### Light → Dark Mapping

**Backgrounds**:
```
Light: white → gray-50 → gray-100
Dark:  gray-950 → gray-900 → gray-800
```

**Text**:
```
Light: gray-900 → gray-700 → gray-500
Dark:  gray-100 → gray-300 → gray-500
```

**Brand colors**:
```
Light: blue-500, blue-600, blue-700
Dark:  blue-400, blue-500, blue-600 (lighter, less saturated)
```

**Borders**:
```
Light: gray-200
Dark:  gray-800
```

---

### Dark Mode Color Adjustments

**Desaturate brand colors by 10-15%**:
- Light mode `blue-500`: hsl(217, 91%, 60%)
- Dark mode `blue-500`: hsl(217, 80%, 60%)

**Why?** Bright colors cause eye strain on dark backgrounds

---

## Color Usage Rules

### Do's

✅ Use semantic tokens (`color.action.primary`, not `blue-500`)
✅ Test all color combos for contrast (7:1 text, 3:1 UI)
✅ Provide non-color indicators (icons, labels)
✅ Use gray for 80% of interface
✅ Reserve brand colors for important actions

### Don'ts

❌ Don't use color as only differentiator
❌ Don't use light colors for text on light backgrounds
❌ Don't mix warm and cool grays in same UI
❌ Don't use more than 3 colors in a single component
❌ Don't use gradients unless necessary (adds complexity)

---

## Color Token Structure

**Format**: `{category}.{role}.{variant}.{state}`

**Examples**:
```
color.text.primary            → gray-900 (light) / gray-100 (dark)
color.text.secondary          → gray-600 (light) / gray-400 (dark)
color.text.disabled           → gray-400 (light) / gray-600 (dark)

color.bg.primary              → white (light) / gray-950 (dark)
color.bg.secondary            → gray-50 (light) / gray-900 (dark)
color.bg.tertiary             → gray-100 (light) / gray-800 (dark)

color.border.default          → gray-200 (light) / gray-800 (dark)
color.border.strong           → gray-300 (light) / gray-700 (dark)

color.action.primary.default  → blue-500
color.action.primary.hover    → blue-600
color.action.primary.active   → blue-700
color.action.primary.focus    → blue-300 (ring)

color.feedback.error.bg       → red-50
color.feedback.error.text     → red-700
color.feedback.error.border   → red-200
```

**Full token file**: [/tokens/color.tokens.json](../tokens/color.tokens.json)

---

## Color Palette Reference

### Full System

```
Grays:   gray-{50-950}    (UI chrome, text, backgrounds)
Primary: blue-{50-950}    (Brand, CTAs, links)
Creator: purple-{50-950}  (Creator-specific features)
Success: green-{50-950}   (Positive feedback)
Error:   red-{50-950}     (Errors, destructive actions)
Warning: amber-{50-950}   (Warnings, pending states)
Info:    slate-{50-950}   (Neutral information)
```

---

## Examples

### Primary Button (Light Mode)

```css
background: blue-500
color: white
border: blue-500

hover:
  background: blue-600
  border: blue-600

active:
  background: blue-700
  border: blue-700

focus:
  ring: blue-300 (3px)

disabled:
  background: gray-300
  color: gray-500
  cursor: not-allowed
```

**Contrast check**:
- White text on blue-500: 4.54:1 ✅ (AA large text)
- White text on blue-600: 5.93:1 ✅ (AA)

---

### Error Alert (Light Mode)

```css
background: red-50
border: red-200
text: red-700

icon:
  color: red-500

link:
  color: red-700
  hover: red-800
```

**Contrast check**:
- red-700 text on red-50 bg: 8.2:1 ✅ (AAA)

---

## Living Document

Color system evolves. Changes require:

1. Accessibility audit (contrast ratios)
2. Dark mode compatibility check
3. Token update + documentation
4. Component library update

**Change log**:

| Date | Change | Reasoning |
|------|--------|-----------|
| 2026-01-01 | Initial color system | Foundation |

---

Next: [04. Typography System →](../04-typography/README.md)

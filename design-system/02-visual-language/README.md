# 02. Visual Language

**Aesthetic grammar. How philosophy becomes visual.**

---

## Purpose

Visual language defines **how things feel**, not just how they look.

This is the bridge between philosophy (calm confidence, professional warmth) and implementation (borders, shadows, motion).

---

## Shape Language

### Primary Shape: Rounded Rectangles

**Radius**: Consistent corner rounding across elements

**Philosophy alignment**:
- Rounds = approachable, professional warmth
- Not sharp = not aggressive, not corporate cold
- Consistent = reliable, trustworthy

**Scale**:
```
xs:  2px  → Small elements (badges, tags)
sm:  4px  → Buttons, inputs, cards (small)
md:  8px  → Cards, panels, modals
lg:  12px → Feature cards, sections
xl:  16px → Major containers, overlays
2xl: 24px → Hero elements, branding
```

**Usage rules**:
- Interactive elements: `sm` (4px) minimum for touch targets
- Content containers: `md` (8px) standard
- Modals/overlays: `lg` (12px) for emphasis
- Never mix radii on same component (pick one, stick to it)

**Anti-pattern**:
- ❌ No sharp corners (feels aggressive)
- ❌ No pill shapes (button.radius = 999px) — feels trendy, not timeless
- ❌ No inconsistent radii (4px top, 8px bottom)

---

### Secondary Shapes: Circles

**Use for**:
- Avatars (user identity)
- Icon containers (small, decorative)
- Loading indicators (spinners)

**Don't use for**:
- Buttons (circles are harder to scan)
- Large containers (wasted space)

---

### Tertiary: Organic Shapes

**Use for**:
- Illustrations (empty states, onboarding)
- Background decorations (subtle)

**Don't use for**:
- UI chrome (buttons, inputs, cards)
- Interactive elements

**Philosophy alignment**: Organic = human, but contained to non-critical areas

---

## Density

**Spatial breathing room.**

### Standard Density (Default)

**Spacing ratio**: 1.5x between elements
**Padding**: Generous (16-24px)
**Line height**: 1.6 for body text

**Use for**:
- Creator dashboard (decision-making requires focus)
- Settings pages (avoid errors from cramming)
- Content editing (precision work)

**Example (card)**:
```
Card padding: 24px
Element spacing: 16px
Title margin-bottom: 12px
```

---

### Comfortable Density (Customer-facing)

**Spacing ratio**: 1.3x between elements
**Padding**: Moderate (12-16px)
**Line height**: 1.5 for body text

**Use for**:
- Content browsing (customer portal)
- Course catalogs (see more options)
- Mobile views (screen real estate limited)

**Example (card)**:
```
Card padding: 16px
Element spacing: 12px
Title margin-bottom: 8px
```

---

### Compact Density (Data-heavy)

**Spacing ratio**: 1.2x between elements
**Padding**: Tight (8-12px)
**Line height**: 1.4 for data

**Use for**:
- Analytics tables (see more data)
- Admin dashboards (platform owner views)
- Bulk operations (multi-select lists)

**Example (table row)**:
```
Row padding: 8px 12px
Cell spacing: 8px
```

**Warning**: Never use compact for forms or error-prone tasks

---

## Weight

**Visual heaviness and hierarchy.**

### Principle: Heavy = Important

**Weight hierarchy**:
```
Feather (100-200): Captions, metadata, disabled states
Light (300):        Body text, secondary labels
Regular (400):      Primary text, descriptions
Medium (500):       Buttons, input labels, navigation
Semibold (600):     Subheadings, emphasis, card titles
Bold (700):         Page headings, primary CTAs
Heavy (800-900):    Hero text, branding (rare)
```

**Usage rules**:
1. **Text**: Use weight, not size, for hierarchy where possible
2. **Buttons**: Medium (500) for secondary, Semibold (600) for primary
3. **Headings**: Bold (700) for h1/h2, Semibold (600) for h3-h6

**Anti-pattern**:
- ❌ All text bold (no hierarchy)
- ❌ Light text on light backgrounds (contrast failure)
- ❌ Heavy weights in long-form content (fatigue)

---

### Stroke Weight

**Borders and dividers**:
```
Hairline: 1px  → Subtle dividers, card borders
Thin:     2px  → Input borders, focus states
Regular:  3px  → Emphasized borders, active states
Bold:     4px  → Rare, used for critical emphasis
```

**Default**: 1px for most UI chrome
**Interactive**: 2px on hover/focus

---

## Motion Character

**How things move = how they feel.**

### Personality: Deliberate & Smooth

**Not**:
- ❌ Bouncy (feels playful, wrong tone)
- ❌ Robotic (feels cold, wrong tone)
- ❌ Sluggish (feels broken)

**Yes**:
- ✅ Smooth (professional)
- ✅ Purposeful (calm confidence)
- ✅ Quick but not rushed

---

### Easing Curves

```javascript
// Entering elements (fade in, slide in)
easeOut: cubic-bezier(0.0, 0.0, 0.2, 1)
// Quick start, smooth deceleration

// Exiting elements (fade out, slide out)
easeIn: cubic-bezier(0.4, 0.0, 1, 1)
// Smooth acceleration, quick end

// State changes (hover, active, focus)
easeInOut: cubic-bezier(0.4, 0.0, 0.2, 1)
// Balanced, symmetric

// Snappy interactions (dropdowns, tooltips)
sharp: cubic-bezier(0.4, 0.0, 0.6, 1)
// More pronounced, still smooth
```

**Default**: `easeInOut` for most interactions
**Never**: `linear` (feels robotic), `ease` (browser default, inconsistent)

---

### Duration Scale

```
Instant:   0ms     → Immediate feedback (focus rings)
Snap:      100ms   → Micro-interactions (hover states)
Quick:     200ms   → Standard interactions (buttons, toggles)
Smooth:    300ms   → Moderate complexity (dropdowns, tooltips)
Deliberate: 400ms  → Page transitions, modal open/close
Slow:      600ms   → Large state changes (expanding panels)
```

**Default**: 200ms (quick) for most UI
**Rule**: Larger movements = longer duration, but cap at 600ms

**Anti-pattern**:
- ❌ Everything at 300ms (monotonous)
- ❌ Durations > 600ms (feels broken)
- ❌ Different durations for enter/exit (asymmetric, confusing)

---

## Contrast Philosophy

**How elements separate from each other.**

### High Contrast Where It Matters

**Critical UI**:
- ✅ Text on backgrounds: 7:1 ratio minimum (AAA)
- ✅ Primary buttons: Strong background color
- ✅ Errors/warnings: High visibility
- ✅ Focus indicators: 3:1 ratio minimum

**Supporting UI**:
- 🟡 Borders, dividers: 3:1 ratio (AA)
- 🟡 Disabled states: 2:1 ratio (legible but clearly inactive)

---

### Subtle Contrast for Calm

**UI chrome** (non-critical elements):
- Card borders: Subtle (1-2 steps from background)
- Section dividers: Barely visible until needed
- Hover states: Gentle shift (10-15% opacity change)

**Philosophy alignment**: High contrast for signal, low contrast for noise

---

### Contrast Strategy

1. **Surface layers**: Use subtle background shifts (gray-50 → gray-100 → gray-200)
2. **Text hierarchy**: Use weight + size, not color alone
3. **Interactive states**: Use border weight + background, not just color

**Example (button states)**:
```
Default:  bg-blue-600, border-blue-600, text-white
Hover:    bg-blue-700, border-blue-700, text-white
Active:   bg-blue-800, border-blue-800, text-white
Focus:    bg-blue-600, border-blue-600, ring-blue-300 (3px)
Disabled: bg-gray-300, border-gray-300, text-gray-500
```

**Notice**: State changes use multiple properties, not just color (accessibility)

---

## Use of Negative Space

**What's NOT there is as important as what is.**

### Principle: Space = Clarity

**Breathing room scale**:
```
Cramped:      8px   → Inline elements (icon + text)
Cozy:         12px  → Related items (form label + input)
Comfortable:  16px  → Default spacing
Generous:     24px  → Section padding, card internal spacing
Spacious:     32px  → Between major sections
Expansive:    48px  → Page margins, hero spacing
Luxurious:    64px+ → Major section breaks (rare)
```

**Default**: 16px between unrelated elements

---

### When to Use More Space

- ✅ Around CTAs (make them easy to hit)
- ✅ Between sections (clear separation)
- ✅ In error states (reduce cognitive load)
- ✅ On mobile (larger touch targets)

### When to Use Less Space

- ✅ Inline elements (icon + label)
- ✅ Tightly coupled data (price + currency symbol)
- ✅ Dense tables (data analysis)

---

### White Space Budget

**Screen allocation**:
```
Content:      60-70%  → Actual information
Spacing:      20-30%  → Margins, padding, gaps
Chrome:       10-15%  → Nav, borders, decorations
```

**Anti-pattern**:
- ❌ Content > 80% (cramped, hard to scan)
- ❌ Spacing < 15% (claustrophobic)
- ❌ Chrome > 20% (distracting)

---

## Visual Hierarchy

**How users scan the page.**

### F-Pattern (Western readers)

1. **Top left**: Logo, navigation
2. **Top horizontal**: Primary actions, search
3. **Left vertical**: Navigation, filters
4. **Center**: Primary content

**Alignment**: Left-align text, center-align marketing/heroes

---

### Z-Pattern (Landing pages)

1. **Top left**: Logo
2. **Top right**: CTA or login
3. **Diagonal**: Value prop, features
4. **Bottom right**: Final CTA

**Use for**: Marketing pages, onboarding flows

---

### Visual Weight Hierarchy

```
1. Primary CTA (bold color, large, high contrast)
   ↓
2. Page title (large text, bold weight)
   ↓
3. Section headings (medium text, semibold)
   ↓
4. Body content (regular text, medium contrast)
   ↓
5. Metadata/captions (small text, light weight, low contrast)
```

**Test**: Squint at design. What do you see first? That's your hierarchy.

---

## Composition Rules

### Rule of Thirds

- Important elements at 1/3 and 2/3 marks
- Avoid dead-center unless intentional symmetry

### Alignment

- **Left-align text**: Easier to scan (Western readers)
- **Center-align headers**: Emphasis, symmetry
- **Right-align numbers**: Easier to compare (decimals line up)

### Proximity

- **Related items closer together** (low spacing)
- **Unrelated items farther apart** (high spacing)

**Example**:
```
[Label]
[Input]       ← 4px apart (related)

[Button]      ← 24px apart (unrelated)
```

---

## Consistency Rules

### Same Element, Same Appearance

- All primary buttons look identical (color, padding, radius, weight)
- All cards have same border, shadow, radius
- All inputs have same height, border, focus state

**Exception**: Context-specific variations (danger button = red, but same shape/size)

---

### Repetition = Recognition

- Repeat spacing values (8, 16, 24, 32, 48)
- Repeat radii (4, 8, 12)
- Repeat weights (400, 500, 600, 700)

**Anti-pattern**:
- ❌ Arbitrary values (13px, 19px, 37px)
- ❌ One-off styles

---

## Visual Language Checklist

Every design must answer:

- [ ] **Shape**: Radii consistent? (4, 8, 12)
- [ ] **Density**: Appropriate for task? (standard/comfortable/compact)
- [ ] **Weight**: Hierarchy clear? (bold = important)
- [ ] **Motion**: Smooth and purposeful? (200-400ms, easeInOut)
- [ ] **Contrast**: High where it matters? (text 7:1, borders 3:1)
- [ ] **Space**: Enough breathing room? (16px minimum)

---

## Examples

### Good: Creator Dashboard Card

```
Shape:     8px radius (md), consistent all corners
Density:   24px padding, 16px spacing (standard)
Weight:    Semibold title (600), regular body (400)
Motion:    Hover lifts card (200ms easeOut)
Contrast:  White card on gray-50 bg (subtle separation)
Space:     24px between cards, 16px internal spacing
```

**Result**: Calm, professional, easy to scan

---

### Bad: Overly Trendy Card

```
Shape:     999px radius (pill), inconsistent
Density:   8px padding (cramped)
Weight:    All text bold (no hierarchy)
Motion:    Bouncy spring animation (playful, wrong tone)
Contrast:  Glassmorphism blur (low contrast, accessibility fail)
Space:     4px everywhere (claustrophobic)
```

**Result**: Trendy, inaccessible, exhausting

---

## Living Document

Visual language evolves with design system maturity. Changes require:

1. Proposal with visual examples
2. Accessibility audit (contrast, motion sensitivity)
3. Engineering feasibility review
4. Update to tokens + components

**Change log**:

| Date | Change | Reasoning |
|------|--------|-----------|
| 2026-01-01 | Initial visual language | Foundation |

---

Next: [03. Color System →](../03-color/README.md)

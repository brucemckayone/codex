# 05. Spacing & Layout

**Room to breathe. The invisible architecture of belonging.**

---

## Foundation

This document extends the space philosophy from [Visual Language (02)](../02-visual-language/README.md).

Every spacing decision must answer: **Does this give content room to breathe, or does it feel cramped and stressful?**

---

## Spacing Philosophy

### Space as Intention

In creative studios, space is intentional:
- **Yoga studio**: Mats spaced for movement, walls clear for focus
- **Dance company**: Open floor, room to leap, mirrors at distance
- **Art gallery**: Work has room to exist, viewers can step back
- **Music school**: Practice rooms with acoustic space, not cramped cubicles

**Codex interfaces should feel this way—spacious, intentional, calm.**

---

### The Comfort Spectrum

```
Cramped ◄────────────────────────────────────────► Wasteful

Cluttered   Dense   Standard  ║ Codex ║  Airy    Sparse
    │         │        │      ║       ║    │        │
    └─────────┴────────┴──────╨───────╨────┴────────┘
                              ▲
                        We live here
```

**Codex spacing is:**
- More generous than typical SaaS (not cramped dashboards)
- Not wasteful (every space serves purpose)
- Comfortable like a well-designed studio
- Adjustable for context (density modes)

---

### Core Spacing Principles

1. **Generous by Default**
   - Start with more space, reduce only when needed
   - Cramped feels stressful; generous feels calm
   - Content deserves room to exist

2. **Consistent Rhythm**
   - Use scale values, not arbitrary pixels
   - Vertical rhythm creates harmony
   - Repeated patterns feel intentional

3. **Relationship Through Proximity**
   - Related things close together
   - Unrelated things far apart
   - Space communicates structure

4. **Adaptive to Context**
   - Creator workspace: Standard density (room for decisions)
   - Member browsing: Comfortable density (see more content)
   - Data tables: Compact density (scan large datasets)

---

## The Spacing Scale

### Base Unit: 4px

Everything divisible by 4. Like a musical scale with harmonic intervals.

```
Token    Pixels    Rem       Use Case
────────────────────────────────────────────────────────────
0        0px       0         No space (flush elements)
px       1px       0.0625    Hairline (borders only)
0.5      2px       0.125     Minimal (icon internal spacing)
1        4px       0.25      Tight (inline icon + text)
2        8px       0.5       Related (label + input)
3        12px      0.75      Cozy (form field groups)
4        16px      1         Comfortable (default)
5        20px      1.25      Relaxed
6        24px      1.5       Generous (card padding)
8        32px      2         Spacious (between sections)
10       40px      2.5       Expansive
12       48px      3         Grand (major section breaks)
16       64px      4         Monumental (hero spacing)
20       80px      5         Luxurious (rare)
24       96px      6         Extraordinary (marketing only)
```

**Default: 16px (spacing-4)** — Comfortable, not cramped

---

### Spacing Relationships

```
Related Items      Unrelated Items      Major Sections
    4-8px              16-24px              32-64px
     │                    │                    │
     ▼                    ▼                    ▼
┌─────────┐         ┌─────────┐         ┌─────────────┐
│ Label   │ 4px     │ Field 1 │         │  Section A  │
│ Input   │         │         │ 16px    │             │ 48px
└─────────┘         ├─────────┤         ├─────────────┤
                    │ Field 2 │         │  Section B  │
                    │         │         │             │
                    └─────────┘         └─────────────┘
```

---

## Density Modes

Different contexts need different breathing room.

### Standard Density

**For:** Creator dashboard, settings, content editing

**Philosophy:** Decisions require focus. Focus requires space.

```
Card Padding:       24px (spacing-6)
Element Gap:        16px (spacing-4)
Section Gap:        32px (spacing-8)
Line Height:        1.6
```

**Example:** Creator managing their offerings needs space to read, review, and decide without feeling rushed.

---

### Comfortable Density

**For:** Member library, content browsing, journey view

**Philosophy:** See more content while still breathing.

```
Card Padding:       16px (spacing-4)
Element Gap:        12px (spacing-3)
Section Gap:        24px (spacing-6)
Line Height:        1.5
```

**Example:** Member browsing offerings should see enough options without scrolling forever, but not feel overwhelmed.

---

### Compact Density

**For:** Analytics tables, admin views, bulk operations

**Philosophy:** Information density for scanning patterns.

```
Card Padding:       12px (spacing-3)
Element Gap:        8px (spacing-2)
Section Gap:        16px (spacing-4)
Line Height:        1.4
```

**Warning:** Never use compact for forms, onboarding, or error-prone tasks.

**Example:** Viewing revenue analytics across 50 offerings—need density to spot patterns.

---

## Grid System

### 12-Column Foundation

**Why 12?** Divisible by 2, 3, 4, 6—maximum flexibility.

```
┌─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┐
│1│2│3│4│5│6│7│8│9│10│11│12│
└─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴──┴──┘

Full (12):        ████████████████████████████████████
Half (6+6):       ████████████████  ████████████████
Thirds (4+4+4):   ██████████  ██████████  ██████████
Sidebar (8+4):    ████████████████████████  ██████████
Dashboard (4+4+4):██████████  ██████████  ██████████
```

### Container Widths

```
Token    Width     Use Case
──────────────────────────────────────────
sm       640px     Mobile landscape, narrow content
md       768px     Tablet portrait
lg       1024px    Desktop, main content
xl       1280px    Large desktop, page container
2xl      1536px    Ultra-wide (rare)
```

### Gutters

```
Mobile:     16px (spacing-4)
Tablet:     20px (spacing-5)
Desktop:    24px (spacing-6)
```

---

## Breakpoints

### Mobile-First Approach

Design for smallest screen, enhance upward.

```
Breakpoint   Width     Target
────────────────────────────────────────────
xs           0px       Default (phone portrait)
sm           640px     Large phone / small tablet
md           768px     Tablet portrait
lg           1024px    Desktop / tablet landscape
xl           1280px    Large desktop
2xl          1536px    Ultra-wide monitors
```

### What Changes at Each Breakpoint

```
xs (0px):
├─ Single column layout
├─ Full-width cards
├─ Stacked navigation
└─ Larger touch targets

sm (640px):
├─ Some two-column layouts
├─ Side-by-side form fields
└─ Inline button groups

md (768px):
├─ Two-column layouts common
├─ Sidebar navigation appears
├─ Cards in 2-column grid
└─ Reduced touch target padding

lg (1024px):
├─ Three-column layouts
├─ Full sidebar + content
├─ Cards in 3-column grid
└─ Desktop hover states active

xl (1280px):
├─ Maximum content width
├─ More generous margins
└─ Dashboard-style layouts

2xl (1536px):
├─ Extra margins (content doesn't stretch)
└─ Side-by-side panels
```

---

## Container Patterns

### Page Container

Maximum width for page content with responsive margins.

```css
.page-container {
  max-width: 1280px;  /* xl */
  margin: 0 auto;
  padding: 0 16px;    /* mobile */

  @media (min-width: 768px) {
    padding: 0 24px;  /* tablet */
  }

  @media (min-width: 1024px) {
    padding: 0 32px;  /* desktop */
  }
}
```

### Content Container

For long-form content (descriptions, articles).

```css
.content-container {
  max-width: 65ch;    /* optimal reading width */
  margin: 0 auto;
}
```

### Card Container

For card grids with consistent gaps.

```css
.card-grid {
  display: grid;
  gap: 24px;

  grid-template-columns: 1fr;  /* mobile: 1 column */

  @media (min-width: 768px) {
    grid-template-columns: repeat(2, 1fr);  /* tablet: 2 */
  }

  @media (min-width: 1024px) {
    grid-template-columns: repeat(3, 1fr);  /* desktop: 3 */
  }
}
```

---

## Vertical Rhythm

### Baseline Alignment

All vertical spacing uses the 4px grid.

```
Element Type              Spacing Below
────────────────────────────────────────
Page title (h1)           24px (spacing-6)
Section heading (h2)      16px (spacing-4)
Subsection (h3)           12px (spacing-3)
Paragraph                 16px (spacing-4)
List item                  8px (spacing-2)
Form label                 4px (spacing-1)
Form field                16px (spacing-4)
Button group               8px (spacing-2)
```

### Section Spacing

```
Within section:           16-24px
Between sections:         32-48px
Between major sections:   48-64px
```

---

## Common Layout Patterns

### Stack (Vertical)

Elements stacked vertically with consistent gap.

```
┌────────────────────┐
│     Element 1      │
├────────────────────┤ 16px gap
│     Element 2      │
├────────────────────┤ 16px gap
│     Element 3      │
└────────────────────┘

gap: 16px (spacing-4) for form fields
gap: 24px (spacing-6) for cards
gap: 32px (spacing-8) for sections
```

### Inline (Horizontal)

Elements arranged horizontally.

```
┌──────────┐ 8px ┌──────────┐ 8px ┌──────────┐
│ Button 1 │ ──► │ Button 2 │ ──► │ Button 3 │
└──────────┘     └──────────┘     └──────────┘

gap: 8px (spacing-2) for button groups
gap: 12px (spacing-3) for navigation items
gap: 16px (spacing-4) for larger items
```

### Split (Two Panels)

Content area with sidebar.

```
┌────────────────────────────┬───────────┐
│                            │           │
│      Main Content          │  Sidebar  │
│       (8 columns)          │(4 columns)│
│                            │           │
└────────────────────────────┴───────────┘

Gutter: 24px (spacing-6)
```

### Dashboard Grid

Cards in responsive grid.

```
Desktop (3 columns):
┌────────┐ ┌────────┐ ┌────────┐
│ Card 1 │ │ Card 2 │ │ Card 3 │
└────────┘ └────────┘ └────────┘
┌────────┐ ┌────────┐ ┌────────┐
│ Card 4 │ │ Card 5 │ │ Card 6 │
└────────┘ └────────┘ └────────┘

Gap: 24px (spacing-6)
```

---

## Component Spacing

### Card Anatomy

```
┌──────────────────────────────────────┐
│                                      │ ← 24px padding (standard)
│   ┌──────────────────────────────┐   │   16px padding (comfortable)
│   │          Thumbnail           │   │
│   └──────────────────────────────┘   │
│                                      │ ← 16px gap
│   Card Title                         │
│                                      │ ← 8px gap
│   Card description text here...      │
│                                      │ ← 16px gap
│   ┌────────────┐                     │
│   │  Button    │                     │
│   └────────────┘                     │
│                                      │
└──────────────────────────────────────┘
```

### Form Anatomy

```
┌──────────────────────────────────────┐
│ Form Label                           │ ← 4px gap
│ ┌──────────────────────────────────┐ │
│ │         Input Field              │ │
│ └──────────────────────────────────┘ │
│ Helper text appears here             │ ← 4px gap above
│                                      │
│ ←──────── 16px gap ──────────────→   │
│                                      │
│ Another Label                        │
│ ┌──────────────────────────────────┐ │
│ │         Input Field              │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ←──────── 24px gap ──────────────→   │
│                                      │
│           ┌────────────────────┐     │
│           │    Submit Button   │     │
│           └────────────────────┘     │
└──────────────────────────────────────┘
```

---

## Touch Targets

### Minimum Sizes

For accessibility and usability:

```
Minimum touch target:    44px × 44px
Minimum button height:   44px
Minimum icon button:     44px × 44px
Minimum link tap area:   44px height
```

### Touch Target Spacing

If elements are smaller than 44px, add padding/margins to create sufficient tap area.

```
❌ Wrong: Small icons with no spacing
   ┌───┐ ┌───┐ ┌───┐
   │ x │ │ y │ │ z │  ← Impossible to tap accurately
   └───┘ └───┘ └───┘

✅ Right: Small icons with spacing
   ┌───┐     ┌───┐     ┌───┐
   │ x │     │ y │     │ z │  ← Easy to tap
   └───┘     └───┘     └───┘
         16px    16px
```

---

## Alignment Rules

### Text Alignment

```
Left:     Body text, most UI (Western readers)
Center:   Headings in marketing, modals, empty states
Right:    Numbers in tables, timestamps, prices
Justify:  Never (creates uneven spacing)
```

### Element Alignment

```
Flush Left:    Navigation, forms, content
Centered:      Modals, empty states, marketing heroes
Flush Right:   User menu, close buttons, actions
```

### Edge Alignment

Everything aligns to an invisible grid:

```
✅ Good: Aligned edges
┌──────────────────────────────────────┐
│ Page Title                           │
│                                      │
│ Section heading                      │
│ ┌──────────────────────────────────┐ │
│ │ Card content                     │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Another section                      │
└──────────────────────────────────────┘

❌ Bad: Misaligned edges
┌──────────────────────────────────────┐
│   Page Title                         │
│                                      │
│ Section heading                      │
│   ┌──────────────────────────────┐   │
│   │ Card content                 │   │
│   └──────────────────────────────┘   │
│                                      │
│  Another section                     │
└──────────────────────────────────────┘
```

---

## White Space Budget

### Screen Allocation

```
Content:    55-65%   → The actual information
Spacing:    25-35%   → Margins, padding, gaps
Chrome:     10-15%   → Navigation, borders, decoration
```

### Anti-Patterns

```
❌ Content > 75%:  Cramped, stressful
❌ Spacing < 20%:  Claustrophobic
❌ Chrome > 20%:   Distracting, noisy
```

---

## Spacing Tokens

### Token Structure

```
spacing.{scale-value}
```

### Token Values

```json
{
  "spacing": {
    "0": "0px",
    "px": "1px",
    "0.5": "2px",
    "1": "4px",
    "2": "8px",
    "3": "12px",
    "4": "16px",
    "5": "20px",
    "6": "24px",
    "8": "32px",
    "10": "40px",
    "12": "48px",
    "16": "64px",
    "20": "80px",
    "24": "96px"
  }
}
```

---

## Anti-Patterns

| Anti-Pattern | Why It's Wrong | What Instead |
|--------------|----------------|--------------|
| Arbitrary values (13px, 17px) | Breaks rhythm | Use scale values |
| Cramped forms | Stressful, error-prone | 16px+ between fields |
| Huge gutters on mobile | Wastes precious space | 16px on mobile |
| Inconsistent padding | Feels unprofessional | Consistent per component |
| No responsive adjustments | Broken on mobile | Mobile-first |
| Tiny touch targets | Inaccessible | 44px minimum |

---

## The Breathing Room Test

Before finalizing layout:

1. **Does it feel spacious?** Not cramped, not wasteful
2. **Does it feel intentional?** Space serves purpose
3. **Does it feel calm?** Like a studio, not a spreadsheet
4. **Is it accessible?** Touch targets, readable spacing

If any answer is no → add more breathing room.

---

## Living Document

Spacing system evolves. Changes require:

1. Consistency audit (all values from scale)
2. Responsive testing (mobile → desktop)
3. Accessibility check (touch targets)
4. Component updates

| Date | Change | Reasoning |
|------|--------|-----------|
| 2026-01-01 | Initial spacing system | Foundation |
| 2026-01-03 | Complete rewrite | Alignment with Mission/Philosophy. Added breathing room metaphor, density modes, visual diagrams, touch target requirements. |

---

## Summary

**Codex spacing in one breath:**

> Space is not emptiness—it's intention. Generous defaults give content room to exist. Related things cluster; unrelated things separate. Density adapts to context. Every pixel of white space serves the calm, focused experience of a creative studio.

**The test:**

> Does this layout feel like a yoga studio floor plan, or like a cramped subway car?

If yoga studio → proceed.
If subway car → add space.

---

**Upstream**: [04. Typography](../04-typography/README.md)
**Downstream**: [06. Components](../06-components/README.md)

---

*Last updated: 2026-01-03*
*Version: 2.0*
*Status: Foundation document — invisible architecture*

# 05. Spacing & Layout

**Hidden backbone of quality. Grid, rhythm, alignment.**

---

## Purpose

Spacing is invisible but felt. Bad spacing = amateurish. Good spacing = professional.

Layout system defines:
- How elements relate spatially
- Visual rhythm and breathing room
- Responsive behavior across devices
- Container constraints and alignment

---

## Spacing Scale

**Approach**: 4px base unit (rem-based)

**Why 4px?**
- Divisible by 2 (half increments work)
- Aligns with common screen densities
- Large enough to be visible, small enough for precision

### Scale

```
0:    0px      (0rem)      → No space (flush)
px:   1px      (0.0625rem) → Hairline (borders only)
0.5:  2px      (0.125rem)  → Minimal (icon spacing)
1:    4px      (0.25rem)   → Tight (inline elements)
2:    8px      (0.5rem)    → Cozy (related items)
3:    12px     (0.75rem)   → Comfortable (standard)
4:    16px     (1rem)      → Generous (default)
5:    20px     (1.25rem)   → Spacious
6:    24px     (1.5rem)    → Section padding
8:    32px     (2rem)      → Between sections
10:   40px     (2.5rem)    → Major gaps
12:   48px     (3rem)      → Page margins
16:   64px     (4rem)      → Hero spacing
20:   80px     (5rem)      → Rare, major breaks
24:   96px     (6rem)      → Luxurious spacing
```

**Default**: `16px` (spacing-4) for unrelated elements

---

## Grid System

### 12-Column Grid

**Why 12?** Divisible by 2, 3, 4, 6 (flexible layouts)

**Container widths**:
```
sm:  640px   (mobile landscape)
md:  768px   (tablet)
lg:  1024px  (desktop)
xl:  1280px  (large desktop)
2xl: 1536px  (ultra-wide)
```

**Gutter**: 24px (spacing-6)

---

### Column Spans

Common patterns:

**Full width**: 12 columns
**Half**: 6 columns each
**Thirds**: 4 columns each
**Sidebar**: 8 + 4 (content + sidebar)
**Dashboard**: 3 columns (4 each) for cards

---

## Breakpoints

```
xs:   0px     (default, mobile-first)
sm:   640px   (large mobile / small tablet)
md:   768px   (tablet)
lg:   1024px  (desktop)
xl:   1280px  (large desktop)
2xl:  1536px  (ultra-wide)
```

**Mobile-first**: Design for smallest screen, enhance upward

---

## Container Rules

### Max-Width Containers

**Page container**: 1280px (xl)
**Content container**: 1024px (lg)
**Text container**: 65ch (typography)
**Card container**: 100% (fills grid column)

### Padding

```
Mobile (< 768px):     16px (spacing-4)
Tablet (768-1024px):  24px (spacing-6)
Desktop (> 1024px):   32px (spacing-8)
```

---

## Vertical Rhythm

**Baseline grid**: 4px

**Element spacing**:
```
Inline (icon + text):      4px   (spacing-1)
Related (label + input):   8px   (spacing-2)
Standard (form fields):    16px  (spacing-4)
Sections:                  32px  (spacing-8)
Major sections:            48px  (spacing-12)
Page sections:             64px  (spacing-16)
```

**Rule**: Maintain consistent vertical spacing for rhythm

---

## Alignment

**Text alignment**:
- Left: Default (Western readers)
- Center: Headings, marketing
- Right: Numbers, metadata

**Element alignment**:
- Flush left: Navigation, forms
- Centered: Modals, empty states
- Flush right: User menu, close buttons

---

## Layout Patterns

### Stack (Vertical)

**Usage**: Form fields, lists, content sections

```
gap: 16px (spacing-4)
```

### Inline (Horizontal)

**Usage**: Button groups, navigation, tags

```
gap: 8px (spacing-2)
```

### Grid

**Usage**: Card grids, dashboard widgets

```
gap: 24px (spacing-6)
columns: responsive (1 → 2 → 3)
```

---

## Responsive Behavior

**Mobile**: Single column, full width
**Tablet**: 2 columns, some sidebars
**Desktop**: 3+ columns, sidebars, wide layouts

**Always**: Touch-friendly spacing (44px min tap targets)

---

## Token Structure

```
spacing.0:  0px
spacing.1:  4px
spacing.2:  8px
spacing.4:  16px (default)
spacing.6:  24px
spacing.8:  32px
spacing.12: 48px
spacing.16: 64px
```

**Full token file**: [/tokens/spacing.tokens.json](../tokens/spacing.tokens.json)

---

Next: [06. Components →](../06-components/README.md)

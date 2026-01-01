# 04. Typography System

**Structure, hierarchy, voice. Meaning before decoration.**

---

## Purpose

Typography is not decoration. It's **information architecture made visible**.

Good typography:
- Encodes meaning through scale, weight, spacing
- Guides the eye through content hierarchically
- Communicates tone (professional, approachable, serious)
- Works across devices, screen sizes, languages

---

## Typeface Selection

### Primary: Inter

**Role**: UI text, body copy, data display

**Why Inter?**
- Designed for screens (clarity at small sizes)
- Open-source (no licensing issues)
- Variable font (performance, flexibility)
- Excellent international character support
- Professional but warm (aligns with brand tone)

**Weights used**:
```
300 Light       → Captions, de-emphasized content
400 Regular     → Body text, descriptions
500 Medium      → Button text, labels, navigation
600 Semibold    → Subheadings, card titles
700 Bold        → Page headings, emphasis
```

**Do not use**: 100 (Thin), 200 (ExtraLight), 800+ (too heavy for UI)

---

### Secondary: JetBrains Mono

**Role**: Code, API responses, logs, technical data

**Why JetBrains Mono?**
- Monospace (character alignment)
- High legibility (distinct characters: l vs I, 0 vs O)
- Open-source
- Designed for developers (our creator audience)

**Weights used**:
```
400 Regular     → Code blocks
500 Medium      → Emphasized code
700 Bold        → Highlighted syntax (rare)
```

**Usage**:
- Code snippets in docs
- API keys, webhook URLs
- Log output
- JSON responses

---

### Display (Optional): Inter Display

**Role**: Hero text, marketing headlines (>48px)

**Why Inter Display?**
- Optimized for large sizes (tighter spacing)
- Same family as UI font (consistency)
- Slightly more personality at scale

**Fallback**: Regular Inter works fine; this is enhancement

---

## Type Scale

**Approach**: Modular scale (1.250 ratio — "Major Third")

**Why modular scale?**
- Mathematical harmony (ratios feel "right")
- Predictable sizing (no arbitrary px values)
- Scales proportionally across breakpoints

---

### Desktop Scale (Base: 16px)

```
xs:   12px / 0.75rem   → Captions, meta info, timestamps
sm:   14px / 0.875rem  → Small labels, secondary text
base: 16px / 1rem      → Body text (default)
lg:   18px / 1.125rem  → Emphasized body, intros
xl:   20px / 1.25rem   → Small headings (h5, h6)
2xl:  24px / 1.5rem    → Subheadings (h4)
3xl:  30px / 1.875rem  → Section headings (h3)
4xl:  36px / 2.25rem   → Page headings (h2)
5xl:  48px / 3rem      → Hero headings (h1)
6xl:  60px / 3.75rem   → Display (marketing, rare)
```

**Default body**: 16px (1rem)

---

### Mobile Scale (Base: 16px, adjusted at breakpoints)

**Same sizes**, but reduce large headings for smaller screens:

```
Breakpoint: < 768px (mobile)

3xl: 24px (was 30px)  → h3
4xl: 30px (was 36px)  → h2
5xl: 36px (was 48px)  → h1
6xl: 48px (was 60px)  → Display
```

**Why?** Smaller screens = less vertical space. Big type overwhelms.

---

## Line Height

**Purpose**: Vertical spacing between lines.

### Body Text

```
Tight:       1.25  → Large headings (h1, h2) — reduce space
Normal:      1.5   → Body text (default)
Relaxed:     1.6   → Long-form content (blog posts, docs)
Loose:       1.75  → Very relaxed reading (accessibility)
```

**Default**: 1.5 (normal) for UI text

**Rule**: Longer lines = more line height (helps eye track to next line)

---

### Headings

```
h1: line-height 1.1  (tight, big text doesn't need space)
h2: line-height 1.2
h3: line-height 1.25
h4-h6: line-height 1.3
```

---

## Letter Spacing (Tracking)

**Default**: 0 (Inter is designed with optimal spacing)

**Adjustments**:
```
Tight:     -0.025em  → Large headings (48px+)
Normal:     0em      → Body text, UI (default)
Wide:      +0.05em   → All-caps text, small labels
Wider:     +0.1em    → Buttons (optional, subtle)
```

**Rule**: Larger text = tighter tracking (optical balance)

---

## Text Roles

**Semantic text styles (not just size/weight).**

### Display

**Usage**: Hero sections, marketing headlines

```
font-size: 48px (5xl)
font-weight: 700 (Bold)
line-height: 1.1
letter-spacing: -0.025em
color: gray-900
```

**Mobile**: Reduce to 36px (4xl)

---

### Heading 1 (Page Title)

**Usage**: Main page heading (Dashboard, Settings, Profile)

```
font-size: 36px (4xl)
font-weight: 700 (Bold)
line-height: 1.2
color: gray-900
margin-bottom: 16px
```

**Mobile**: Reduce to 30px (3xl)

---

### Heading 2 (Section)

**Usage**: Major section within page

```
font-size: 30px (3xl)
font-weight: 700 (Bold)
line-height: 1.25
color: gray-900
margin-bottom: 12px
```

**Mobile**: Reduce to 24px (2xl)

---

### Heading 3 (Subsection)

**Usage**: Subsection, card group titles

```
font-size: 24px (2xl)
font-weight: 600 (Semibold)
line-height: 1.3
color: gray-800
margin-bottom: 8px
```

---

### Heading 4-6 (Small Headings)

**Usage**: Card titles, list headers

```
H4:
  font-size: 20px (xl)
  font-weight: 600 (Semibold)

H5:
  font-size: 18px (lg)
  font-weight: 600 (Semibold)

H6:
  font-size: 16px (base)
  font-weight: 600 (Semibold)
  text-transform: uppercase
  letter-spacing: 0.05em
```

---

### Body

**Usage**: Default text (paragraphs, descriptions)

```
font-size: 16px (base)
font-weight: 400 (Regular)
line-height: 1.5
color: gray-700
```

**Long-form variant**:
```
line-height: 1.6 (more space for readability)
max-width: 65ch (optimal line length)
```

---

### Body Large

**Usage**: Intro paragraphs, emphasized content

```
font-size: 18px (lg)
font-weight: 400 (Regular)
line-height: 1.6
color: gray-700
```

---

### Body Small

**Usage**: Secondary information, helper text

```
font-size: 14px (sm)
font-weight: 400 (Regular)
line-height: 1.5
color: gray-600
```

---

### Caption

**Usage**: Meta info, timestamps, footnotes

```
font-size: 12px (xs)
font-weight: 400 (Regular)
line-height: 1.4
color: gray-500
```

---

### Label

**Usage**: Form labels, button text, navigation

```
font-size: 14px (sm)
font-weight: 500 (Medium)
line-height: 1.4
color: gray-700
```

---

### Code

**Usage**: Inline code, technical references

```
font-family: 'JetBrains Mono', monospace
font-size: 14px (sm)
font-weight: 400 (Regular)
background: gray-100
padding: 2px 6px
border-radius: 4px
color: gray-800
```

**Block variant**:
```
font-size: 14px
padding: 16px
background: gray-900
color: gray-100
border-radius: 8px
overflow-x: auto
```

---

## Responsive Typography

**Strategy**: Fluid type (viewport-based scaling) + breakpoint adjustments

### Fluid Type (Optional Enhancement)

**Formula**: `clamp(min, preferred, max)`

**Example (h1)**:
```css
font-size: clamp(30px, 5vw, 48px);
```

**Breakdown**:
- **min**: 30px (mobile minimum)
- **preferred**: 5vw (scales with viewport width)
- **max**: 48px (desktop maximum)

**Result**: Smooth scaling between 30-48px based on screen size

---

### Breakpoint Adjustments

**Mobile (< 768px)**:
```
Display: 36px (was 48px)
H1:      30px (was 36px)
H2:      24px (was 30px)
Body:    16px (unchanged)
```

**Tablet (768px - 1024px)**:
```
Display: 42px
H1:      33px
H2:      27px
```

**Desktop (> 1024px)**:
```
Full scale (as defined)
```

---

## Line Length

**Optimal reading**: 45-75 characters per line (65 is ideal)

### Implementation

**Long-form content**:
```css
max-width: 65ch;  /* 65 characters */
```

**UI text** (not long-form):
```
No max-width (fills container)
```

**Sidebar/narrow columns**:
```css
max-width: 45ch;
```

**Wide layouts** (data tables):
```
No max-width (data needs space)
```

---

## Text Hierarchy Rules

### Visual Weight Progression

```
1. Page title (h1)      → Largest, boldest
   ↓
2. Section heading (h2) → Large, bold
   ↓
3. Subsection (h3)      → Medium, semibold
   ↓
4. Body text            → Base size, regular
   ↓
5. Secondary text       → Small, regular
   ↓
6. Meta text            → Smallest, light color
```

**Test**: Can user scan page and understand structure instantly?

---

### Contrast Through Weight

**Prefer weight over size for hierarchy** (where possible):

❌ **Bad** (size only):
```
Title:       24px Regular
Subtitle:    20px Regular
Body:        16px Regular
```

✅ **Good** (weight + size):
```
Title:       24px Bold
Subtitle:    20px Semibold
Body:        16px Regular
```

**Why?** Weight creates contrast without scaling issues

---

## Accessibility

### Minimum Sizes

**Body text**: 16px minimum (18px preferred)
**Small text**: 14px minimum (only for labels, not paragraphs)
**Never**: < 12px (except in rare cases like dense data tables)

---

### Contrast

See [03-color/README.md](../03-color/README.md) for full requirements.

**Minimum**:
- Large text (18px+): 4.5:1
- Normal text: 7:1 (our standard)

---

### Font Rendering

**Use font-smoothing** for better rendering:

```css
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
```

**Why?** Improves legibility on macOS/iOS

---

## Internationalization

### Character Support

**Inter supports**:
- Latin Extended
- Cyrillic
- Greek
- Vietnamese
- Common symbols

**Test with**: Lorem ipsum, Cyrillic, Arabic (RTL), Japanese (long strings)

---

### RTL (Right-to-Left) Support

**Languages**: Arabic, Hebrew

**Implementation**:
```css
[dir="rtl"] {
  text-align: right;
  /* Flip margins, padding as needed */
}
```

**Test**: All UI components work in RTL mode

---

## Typography Tokens

**Format**: `{category}.{role}.{property}`

**Examples**:
```
typography.display.fontSize: 48px
typography.display.fontWeight: 700
typography.display.lineHeight: 1.1

typography.h1.fontSize: 36px
typography.h1.fontWeight: 700
typography.h1.lineHeight: 1.2

typography.body.fontSize: 16px
typography.body.fontWeight: 400
typography.body.lineHeight: 1.5

typography.caption.fontSize: 12px
typography.caption.fontWeight: 400
typography.caption.lineHeight: 1.4
```

**Full token file**: [/tokens/typography.tokens.json](../tokens/typography.tokens.json)

---

## Usage Examples

### Creator Dashboard Card

```html
<div class="card">
  <h3 class="text-2xl font-semibold text-gray-800 mb-2">
    Your Content
  </h3>
  <p class="text-sm text-gray-600 mb-4">
    Manage your courses and videos
  </p>
  <div class="text-xs text-gray-500">
    Last updated: 2 hours ago
  </div>
</div>
```

**Hierarchy**:
- h3: 24px semibold (primary focus)
- p: 14px regular (supporting info)
- timestamp: 12px light color (meta)

---

### Form Label + Input

```html
<label class="text-sm font-medium text-gray-700 mb-1">
  Content Title
</label>
<input
  type="text"
  class="text-base font-regular text-gray-900"
  placeholder="Enter a descriptive title"
/>
<p class="text-xs text-gray-500 mt-1">
  This will be visible to customers
</p>
```

**Hierarchy**:
- Label: 14px medium (instruction)
- Input: 16px regular (user content)
- Help text: 12px lighter (guidance)

---

## Anti-Patterns

### ❌ Don't: Mix too many sizes

```
h1: 48px
h2: 42px  ← Too close to h1
h3: 38px  ← Arbitrary
p: 16px
```

**Why?** No clear hierarchy

✅ **Do**: Use modular scale
```
h1: 48px
h2: 36px  (1.333x smaller)
h3: 30px  (1.2x smaller)
p: 16px
```

---

### ❌ Don't: All bold or all light

```
<h1 class="font-bold">Title</h1>
<p class="font-bold">Everything is shouting</p>
```

✅ **Do**: Use weight for hierarchy
```
<h1 class="font-bold">Title</h1>
<p class="font-normal">Regular body text</p>
```

---

### ❌ Don't: Tiny, long lines

```
font-size: 12px;
max-width: 100%; /* 150+ characters per line */
```

✅ **Do**: Appropriate size + line length
```
font-size: 16px;
max-width: 65ch; /* ~65 characters */
```

---

## Living Document

Typography evolves. Changes require:

1. Accessibility audit (size, contrast)
2. Responsive testing (mobile → desktop)
3. Internationalization check (RTL, long strings)
4. Token update + documentation

**Change log**:

| Date | Change | Reasoning |
|------|--------|-----------|
| 2026-01-01 | Initial typography system | Foundation |

---

Next: [05. Spacing & Layout →](../05-spacing-layout/README.md)

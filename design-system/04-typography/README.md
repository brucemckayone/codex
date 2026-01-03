# 04. Typography System

**The voice made visible. How type conveys warmth, clarity, and belonging.**

---

## Foundation

This document extends the warmth of [Visual Language (02)](../02-visual-language/README.md) into letterforms.

Every type choice must answer: **Does this feel welcoming and human, or cold and corporate?**

---

## Typography Philosophy

### Type as Character

Typography is not decoration. It's **the voice of the community**.

Consider how different spaces feel through their typography:

| Space | Type Character |
|-------|----------------|
| Yoga studio | Soft, readable, calming—like handwritten schedules on warm wood |
| Dance company | Elegant, dynamic, expressive—movement in letterforms |
| Music school | Rich, classical, authoritative yet approachable |
| Art collective | Clean, intentional, gallery-like—type that recedes for art |

**Common threads:**
- Human, not mechanical
- Readable, not decorative
- Warm, not cold
- Clear, not clever

---

### The Warmth Spectrum

```
Cold ◄──────────────────────────────────────────► Warm

Geometric    Grotesque    Neo-Grotesk  ║ Humanist ║  Script
Sans         Sans         Sans         ║   Sans   ║
  │            │             │         ║          ║    │
  └────────────┴─────────────┴─────────╨──────────╨────┘
                                       ▲
                                 We live here
```

**Codex uses humanist sans-serif** because:
- Humanist = based on human handwriting (calligraphic origins)
- Feels warmer than geometric (which feels cold, mechanical)
- More approachable than grotesque (which feels stark)
- Professional but not corporate

---

### Core Typography Principles

1. **Warmth Through Form**
   - Humanist typefaces with pen-stroke influences
   - Generous x-height (readable, friendly)
   - Open apertures (inviting, not closed off)
   - Slightly rounded terminals (soft, not sharp)

2. **Clarity Over Cleverness**
   - Readable at all sizes
   - Clear hierarchy through weight and size
   - No decorative fonts for UI
   - Function before style

3. **Breathing Room**
   - Generous line height (text needs space)
   - Comfortable letter spacing
   - Optimal line length (not too long, not too short)

4. **Accessible Always**
   - 16px minimum for body text
   - 7:1 contrast ratio (WCAG AAA)
   - Works for dyslexic readers
   - Scales for vision impairments

---

## Typeface Selection

### Primary: Inter

**Role**: All UI text, body copy, headings

**Why Inter for a warm design system?**

Despite being a "tech" font, Inter has humanist qualities:
- Based on traditional letterforms (not purely geometric)
- Tall x-height (readable, friendly)
- Open apertures (welcoming)
- Designed for screens (clarity at small sizes)
- Variable font (performance + flexibility)
- Excellent international support
- Open-source (no licensing friction)

**The alternative consideration:**

If we wanted even more warmth, we'd use:
- **Source Sans Pro** (very humanist, Adobe)
- **Nunito** (softer, rounded)
- **Lato** (warm, semi-rounded)

But Inter's balance of warmth and professionalism aligns with "warm professionalism."

**Weights we use:**
```
400 Regular    → Body text, descriptions, content
500 Medium     → Labels, buttons, navigation, emphasis
600 Semibold   → Subheadings, card titles, strong emphasis
700 Bold       → Page headings, primary emphasis
```

**Weights we avoid:**
- 100-300 (too light, accessibility issues)
- 800-900 (too heavy, aggressive)

---

### Monospace: JetBrains Mono

**Role**: Code, technical content, data

**Why JetBrains Mono?**
- Designed for readability (distinct l/I/1, 0/O)
- Comfortable for extended reading
- Slightly softer than Fira Code or Menlo
- Open-source

**Weights:**
```
400 Regular    → Code blocks, inline code
500 Medium     → Emphasized code
```

**Usage:**
- Code snippets
- API keys, URLs
- Technical data displays
- JSON/logs

---

## Type Scale

### Philosophy: Musical Harmony

Our scale is based on the **Major Third (1.250)** ratio.

Like musical intervals, typographic scales create harmony when proportional.

```
Scale:  1.0   1.25   1.563   1.953   2.441   3.052   3.815
        │      │       │       │       │       │       │
        16    20      25      31      39      49      61
        │      │       │       │       │       │       │
       base   lg     2xl     3xl     4xl     5xl     6xl
```

---

### The Scale (Desktop)

```
Token     Size      Rem       Use Case
──────────────────────────────────────────────────
xs        12px     0.75rem   Captions, timestamps, legal
sm        14px     0.875rem  Secondary text, labels, meta
base      16px     1rem      Body text (default)
lg        18px     1.125rem  Emphasized body, intro text
xl        20px     1.25rem   Small headings (h5, h6)
2xl       24px     1.5rem    Subheadings (h4)
3xl       30px     1.875rem  Section headings (h3)
4xl       36px     2.25rem   Page headings (h2)
5xl       48px     3rem      Major headings (h1)
6xl       60px     3.75rem   Display/hero (marketing)
```

**Base size: 16px** — Comfortable for extended reading

---

### Mobile Adjustments

Large type overwhelms small screens. Scale down gracefully:

```
              Desktop    Mobile (<768px)
──────────────────────────────────────────
6xl (Display)    60px        48px
5xl (h1)         48px        36px
4xl (h2)         36px        30px
3xl (h3)         30px        24px
2xl (h4)         24px        20px
base (body)      16px        16px (unchanged)
```

---

## Line Height

### Philosophy: Room to Breathe

Text needs vertical space. Cramped lines feel stressed. Generous lines feel calm.

**Like a yoga studio has space between mats.**

### Body Text

```
Tight:      1.25    → Only for large headings (48px+)
Snug:       1.375   → Headings, titles
Normal:     1.5     → Default for UI text
Relaxed:    1.625   → Long-form content (articles, docs)
Loose:      1.75    → Maximum accessibility, very relaxed
```

**Default: 1.5** (Normal) — Comfortable for most UI

### Headings

Larger text needs less line height (the letters themselves are big enough):

```
h1 (48px+):   line-height: 1.1
h2 (36px):    line-height: 1.2
h3 (30px):    line-height: 1.25
h4-h6:        line-height: 1.3
```

---

## Letter Spacing

### Philosophy: Let Letters Breathe

**Default: 0** — Inter is designed with optimal spacing

**Adjustments:**
```
Tighter:   -0.025em   → Large display text (48px+)
Normal:     0em       → Body, UI (default)
Wide:      +0.025em   → Small caps, labels
Wider:     +0.05em    → All-caps text
```

**Rule:** Large text → tighter spacing. Small caps → wider spacing.

---

## Text Roles

Semantic styles that combine size, weight, and spacing.

### Display

**For:** Hero sections, marketing headlines, welcome messages

```
font-size:       48-60px (5xl-6xl)
font-weight:     700 (Bold)
line-height:     1.1
letter-spacing:  -0.025em
color:           cream-900
```

**Example:** "Welcome to the Collective"

---

### Page Title (h1)

**For:** Main page heading

```
font-size:       36-48px (4xl-5xl)
font-weight:     700 (Bold)
line-height:     1.2
color:           cream-900
margin-bottom:   16px
```

**Example:** "Your Dashboard", "Content Library"

---

### Section Heading (h2)

**For:** Major sections within a page

```
font-size:       30px (3xl)
font-weight:     700 (Bold)
line-height:     1.25
color:           cream-900
margin-bottom:   12px
```

**Example:** "Your Journey So Far", "Community Highlights"

---

### Subsection (h3)

**For:** Card groups, subsections

```
font-size:       24px (2xl)
font-weight:     600 (Semibold)
line-height:     1.3
color:           cream-800
margin-bottom:   8px
```

**Example:** "Recent Offerings", "Member Progress"

---

### Card Title (h4)

**For:** Individual cards, list headers

```
font-size:       20px (xl)
font-weight:     600 (Semibold)
line-height:     1.3
color:           cream-800
```

---

### Small Heading (h5, h6)

**For:** Minor sections, grouped labels

```
H5:
  font-size:     18px (lg)
  font-weight:   600 (Semibold)
  color:         cream-800

H6:
  font-size:     14px (sm)
  font-weight:   600 (Semibold)
  text-transform: uppercase
  letter-spacing: 0.05em
  color:         cream-700
```

---

### Body

**For:** Paragraphs, descriptions, content

```
font-size:       16px (base)
font-weight:     400 (Regular)
line-height:     1.5
color:           cream-700
```

**Long-form variant:**
```
line-height:     1.625 (relaxed)
max-width:       65ch
```

---

### Body Large

**For:** Intro text, emphasized content, pull quotes

```
font-size:       18px (lg)
font-weight:     400 (Regular)
line-height:     1.6
color:           cream-700
```

**Example:** Opening paragraph of a course description

---

### Body Small

**For:** Secondary information, helper text

```
font-size:       14px (sm)
font-weight:     400 (Regular)
line-height:     1.5
color:           cream-600
```

---

### Caption

**For:** Timestamps, meta info, footnotes, legal

```
font-size:       12px (xs)
font-weight:     400 (Regular)
line-height:     1.4
color:           cream-500
```

---

### Label

**For:** Form labels, button text, navigation items

```
font-size:       14px (sm)
font-weight:     500 (Medium)
line-height:     1.4
color:           cream-700
```

---

### Code (Inline)

**For:** Inline code references, technical terms

```
font-family:     'JetBrains Mono', monospace
font-size:       14px (0.875em relative)
font-weight:     400
background:      cream-200
padding:         2px 6px
border-radius:   4px
color:           cream-800
```

---

### Code Block

**For:** Multi-line code, examples

```
font-family:     'JetBrains Mono', monospace
font-size:       14px
line-height:     1.6
background:      cream-900
padding:         16px 20px
border-radius:   8px
color:           cream-100
overflow-x:      auto
```

---

## Line Length

### The Comfort Zone

Optimal reading: **45-75 characters per line** (65 is ideal)

Too short → choppy, constant line breaks
Too long → eyes lose track returning to start

### Implementation

**Long-form content (articles, descriptions):**
```css
max-width: 65ch;
```

**UI text:**
```
No max-width (fills container naturally)
```

**Narrow contexts (sidebars, cards):**
```css
max-width: 45ch;
```

---

## Hierarchy

### The Squint Test

When you squint at a page, you should clearly see:
1. **One primary element** (biggest, boldest)
2. **2-3 secondary elements** (medium weight)
3. **Supporting details** (smaller, lighter)

If everything looks the same → hierarchy failed.

### Weight > Size for Subtle Hierarchy

**Prefer weight differences over size differences:**

```
❌ Subtle size difference (hard to distinguish):
   Title:     20px Regular
   Subtitle:  18px Regular
   Body:      16px Regular

✅ Clear weight difference:
   Title:     20px Bold
   Subtitle:  18px Medium
   Body:      16px Regular
```

---

## Community-Focused Examples

### Welcome Message (After Joining)

```
Display:    "Welcome to Mindful Movement"
            48px Bold, cream-900

Body Large: "You're now part of our community. Here's how to begin
            your journey."
            18px Regular, cream-700

Body:       "Explore offerings from our creators, track your
            progress, and connect with fellow members."
            16px Regular, cream-600
```

**Note:** Warm, inviting language matches warm typography.

---

### Creator Dashboard Card

```
H4 (Title):     "Your Offerings"
                20px Semibold, cream-800

Body Small:     "3 published, 2 drafts"
                14px Regular, cream-600

Caption:        "Last updated 2 hours ago"
                12px Regular, cream-500
```

**Hierarchy:** Clear primary → secondary → meta

---

### Content Card

```
H4:             "Introduction to Mindful Breathing"
                20px Semibold, cream-800

Body:           "Learn the foundations of breath awareness
                with guided exercises."
                16px Regular, cream-700

Label:          "45 min • Beginner"
                14px Medium, cream-600

Caption:        "By Sarah Chen"
                12px Regular, cream-500
```

---

## Accessibility

### Minimum Sizes

| Context | Minimum | Preferred |
|---------|---------|-----------|
| Body text | 16px | 16-18px |
| Small text | 14px | 14px |
| Captions | 12px | 12px |
| Never | <12px | — |

### Contrast

All text must meet WCAG AAA (7:1 ratio):
- `cream-900` on `cream-50`: ✅ 12.5:1
- `cream-700` on `cream-50`: ✅ 7.8:1
- `cream-600` on `cream-50`: ✅ 5.2:1 (AA for 14px+)

See [03. Color](../03-color/README.md) for full contrast requirements.

### Dyslexia Considerations

Our choices support dyslexic readers:
- ✅ Sans-serif (easier than serif)
- ✅ Good letter spacing (not cramped)
- ✅ Generous line height (1.5+)
- ✅ Left-aligned text (not justified)
- ✅ Distinct letterforms in Inter (b/d, p/q are distinguishable)

---

## Internationalization

### Character Support

Inter supports:
- Latin Extended (Western European, Vietnamese)
- Cyrillic (Russian, Ukrainian)
- Greek
- Common symbols and punctuation

### RTL Languages

For Arabic, Hebrew:
```css
[dir="rtl"] {
  text-align: right;
  direction: rtl;
}
```

### CJK Considerations

For Chinese, Japanese, Korean:
- Consider system fonts or dedicated CJK typeface
- Line height may need adjustment (1.7+)
- No letter-spacing adjustments

---

## Typography Tokens

### Token Structure

```
typography.{role}.{property}
```

### Examples

```json
{
  "typography": {
    "display": {
      "fontSize": "48px",
      "fontWeight": "700",
      "lineHeight": "1.1",
      "letterSpacing": "-0.025em"
    },
    "h1": {
      "fontSize": "36px",
      "fontWeight": "700",
      "lineHeight": "1.2"
    },
    "body": {
      "fontSize": "16px",
      "fontWeight": "400",
      "lineHeight": "1.5"
    },
    "caption": {
      "fontSize": "12px",
      "fontWeight": "400",
      "lineHeight": "1.4"
    }
  }
}
```

---

## Anti-Patterns

| Anti-Pattern | Why It's Wrong | What Instead |
|--------------|----------------|--------------|
| Geometric sans (Futura, Avenir) | Cold, mechanical | Humanist (Inter) |
| Light weights for body | Accessibility issues | Regular (400) minimum |
| All bold text | No hierarchy, fatiguing | Weight variation |
| Justified text | Uneven spacing, harder to read | Left-aligned |
| Long lines (100+ chars) | Eyes lose track | max-width: 65ch |
| Tight line height (1.2) for body | Cramped, stressful | 1.5 minimum |
| Decorative fonts for UI | Unclear, dated | Clean sans-serif |
| Size-only hierarchy | Subtle, unclear | Weight + size |

---

## The Warmth Test

Before finalizing typography:

1. **Does it feel warm?** Humanist, not geometric or grotesque
2. **Does it feel readable?** Comfortable sizes, generous spacing
3. **Does it feel welcoming?** Like a yoga studio schedule, not a spreadsheet
4. **Is it accessible?** Meets contrast, size, spacing requirements

If any answer is no → reconsider the choices.

---

## Living Document

Typography evolves. Changes require:

1. Accessibility audit (size, contrast, spacing)
2. Warmth test (creative studio check)
3. Responsive testing (mobile → desktop)
4. Internationalization verification
5. Token and component updates

| Date | Change | Reasoning |
|------|--------|-----------|
| 2026-01-01 | Initial typography | Foundation |
| 2026-01-03 | Complete rewrite | Alignment with Mission/Philosophy. Added warmth philosophy, humanist type reasoning, community-focused examples, cream color integration. |

---

## Summary

**Codex typography in one breath:**

> Humanist letterforms that feel written by humans, not machines. Generous spacing that lets words breathe like a yoga studio lets bodies stretch. Clear hierarchy that guides without shouting. Every glyph serves readability, warmth, and belonging.

**The test:**

> Does this type feel like a welcome note, or like a terms of service?

If welcome note → proceed.
If terms of service → add warmth.

---

**Upstream**: [03. Color](../03-color/README.md)
**Downstream**: [05. Spacing & Layout](../05-spacing-layout/README.md)

---

*Last updated: 2026-01-03*
*Version: 2.0*
*Status: Foundation document — voice made visible*

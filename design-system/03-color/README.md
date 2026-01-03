# 03. Color System

**Where philosophy becomes pigment. Color as warmth, meaning, and belonging.**

---

## Foundation

This document implements the warmth defined in [Visual Language (02)](../02-visual-language/README.md).

Every color choice must answer: **Does this feel like a creative studio, or a corporate dashboard?**

---

## Color Philosophy

### The Creative Studio Palette

Traditional SaaS uses cool blues and neutral grays—clinical, corporate, cold.

Codex draws from the warmth of creative spaces:

| Space | Color Character |
|-------|-----------------|
| Yoga studio | Warm earth tones, sage greens, soft terracotta |
| Dance company | Rich burgundies, warm woods, dynamic accents |
| Music school | Deep mahoganies, brass accents, warm ivories |
| Art collective | Gallery whites, bold accent moments, natural materials |

**Common threads:**
- Warm neutrals (cream, sand, warm gray—not cool gray)
- Rich accent colors (saturated but not neon)
- Natural palette inspiration (earth, foliage, sky at golden hour)
- Warmth even in darks (charcoal with warmth, not pure black)

---

### The Warmth Principle

```
Cool ◄──────────────────────────────────► Warm

Corporate   Banking   SaaS    ║ Codex ║   Cozy   Rustic
Blue         Blue     Gray    ║       ║   Amber  Brown
    │          │        │     ║       ║     │      │
    └──────────┴────────┴─────╨───────╨─────┴──────┘
                              ▲
                        We live here
```

**Codex colors are:**
- Warmer than typical SaaS (no cold corporate blue)
- More refined than rustic (not farmhouse aesthetic)
- Rich but not loud (saturated but not neon)
- Grounded in nature (earth, sky, foliage, warmth)

---

### Core Color Principles

1. **Warmth First**
   - Warm whites (cream, ivory) not pure #FFFFFF
   - Warm grays not cool slate
   - Primary brand color has warmth
   - Even errors and warnings have human warmth

2. **Semantic Clarity**
   - Color names describe purpose, not appearance
   - Same color = same meaning everywhere
   - Meaning reinforced with icons/text (not color alone)

3. **Accessibility Always**
   - 7:1 contrast for body text (WCAG AAA)
   - 4.5:1 for large text (WCAG AA)
   - 3:1 for UI components and focus rings
   - Never color alone for meaning

4. **Calm Dominance**
   - Neutrals: 80% of interface
   - Primary: 15% (actions, navigation)
   - Accent: 5% (alerts, celebrations)

---

## The Palette

### Warm Neutrals (Foundation)

**The soul of Codex's warmth.** Not cool slate. Not pure gray. Warm.

```
Warm White & Cream
──────────────────
cream-50:   #FDFCFA   ← Page background (light mode)
cream-100:  #FAF8F5   ← Card backgrounds
cream-200:  #F5F2ED   ← Subtle borders, dividers
cream-300:  #E8E4DD   ← Disabled backgrounds
cream-400:  #D4CEC4   ← Placeholder text
cream-500:  #B8B0A3   ← Secondary text
cream-600:  #8F8579   ← Body text
cream-700:  #6B6358   ← Headings
cream-800:  #4A453D   ← High contrast text
cream-900:  #2D2A25   ← Maximum contrast
cream-950:  #1A1816   ← Dark mode background
```

**Usage:**
- Page background: `cream-50` (not white)
- Cards: `cream-100` with subtle `cream-200` border
- Text hierarchy: `cream-900` → `cream-700` → `cream-600`
- Dividers: `cream-200` (barely visible, intentional)

**Why warm neutrals?**
Cool grays feel like spreadsheets. Warm neutrals feel like a yoga studio's bamboo floors.

---

### Primary Brand Color

**The signature of Codex.** Rich, warm, inviting—not corporate blue.

We use a **warm teal** that bridges calm and energy:

```
Teal (Primary)
──────────────
teal-50:   #F0FDFA   ← Hover backgrounds, selected states
teal-100:  #CCFBF1   ← Light accents
teal-200:  #99F6E4   ← Borders (interactive)
teal-300:  #5EEAD4   ← Focus rings
teal-400:  #2DD4BF   ← Icons, decorative
teal-500:  #14B8A6   ← Base - primary buttons
teal-600:  #0D9488   ← Hover state
teal-700:  #0F766E   ← Active state, links
teal-800:  #115E59   ← Text on light
teal-900:  #134E4A   ← High contrast
teal-950:  #042F2E   ← Dark mode accents
```

**Why teal, not blue?**
- Blue = corporate, banking, SaaS
- Teal = natural (ocean, forest), warm, distinctive
- Teal bridges calming (blue) and growth (green)
- Aligns with wellness, creativity, natural spaces

**Usage:**
- Primary buttons: `teal-500`, hover `teal-600`, active `teal-700`
- Links: `teal-700`, hover `teal-800`
- Focus rings: `teal-300` (3px)
- Navigation active: `teal-50` bg, `teal-700` text

**Accessibility:**
- `teal-600` on cream-50: 5.2:1 ✅ (AA)
- `teal-700` on cream-50: 6.8:1 ✅ (AA+)
- `teal-800` on cream-50: 8.9:1 ✅ (AAA)

---

### Secondary: Warm Coral

**For celebration, warmth, and creative energy.**

```
Coral (Secondary/Celebration)
─────────────────────────────
coral-50:   #FFF5F3   ← Celebration backgrounds
coral-100:  #FFE4DE   ← Light accents
coral-200:  #FFCCC2   ← Borders
coral-300:  #FFAB9C   ← Decorative
coral-400:  #FF8A76   ← Icons
coral-500:  #F06449   ← Base - celebration moments
coral-600:  #DC4A2F   ← Hover
coral-700:  #B83A22   ← Active
coral-800:  #972F1C   ← Text
coral-900:  #7D2918   ← High contrast
coral-950:  #441209   ← Dark accents
```

**Usage:**
- Welcome messages, celebrations
- Creator highlights
- Community milestones
- Warm accent moments

**Not for:** Errors (use dedicated error red), primary actions

---

### Creator Accent: Rich Purple

**For creator-specific features, analytics, earnings.**

```
Purple (Creator)
────────────────
purple-50:   #FAF5FF   ← Creator dashboard highlights
purple-100:  #F3E8FF   ← Light accents
purple-200:  #E9D5FF   ← Borders
purple-300:  #D8B4FE   ← Focus rings
purple-400:  #C084FC   ← Icons
purple-500:  #A855F7   ← Base
purple-600:  #9333EA   ← Hover
purple-700:  #7E22CE   ← Active
purple-800:  #6B21A8   ← Text
purple-900:  #581C87   ← High contrast
purple-950:  #3B0764   ← Dark accents
```

**Usage:**
- Creator dashboard accents
- Revenue and earnings displays
- Analytics charts
- "Creator" badges and labels

---

## Functional Colors

### Success: Warm Green

**Positive outcomes, confirmations, growth.**

```
Success Green
─────────────
green-50:   #F0FDF4   ← Success message bg
green-100:  #DCFCE7   ← Light accents
green-200:  #BBF7D0   ← Borders
green-300:  #86EFAC   ← Icons (light)
green-400:  #4ADE80   ← Icons
green-500:  #22C55E   ← Base
green-600:  #16A34A   ← Hover, text
green-700:  #15803D   ← Active, high contrast text
green-800:  #166534
green-900:  #14532D
green-950:  #052E16
```

**Usage:**
- Success messages: `green-50` bg, `green-700` text, `green-200` border
- Checkmarks: `green-600`
- Positive metrics: `green-700`
- Journey completion: `green-500`

---

### Error: Warm Red

**Errors, destructive actions, critical warnings.**

Not cold crimson—a red with warmth.

```
Error Red
─────────
red-50:   #FEF2F2   ← Error message bg
red-100:  #FEE2E2
red-200:  #FECACA   ← Borders
red-300:  #FCA5A5
red-400:  #F87171   ← Icons
red-500:  #EF4444   ← Base
red-600:  #DC2626   ← Destructive buttons
red-700:  #B91C1C   ← Text
red-800:  #991B1B
red-900:  #7F1D1D
red-950:  #450A0A
```

**Usage:**
- Error messages: `red-50` bg, `red-700` text, `red-200` border
- Destructive buttons: `red-600`, hover `red-700`
- Form errors: `red-300` border, `red-600` text
- Error icons: `red-500`

---

### Warning: Rich Amber

**Warnings, pending states, attention needed.**

```
Warning Amber
─────────────
amber-50:   #FFFBEB   ← Warning message bg
amber-100:  #FEF3C7
amber-200:  #FDE68A   ← Borders
amber-300:  #FCD34D
amber-400:  #FBBF24   ← Icons
amber-500:  #F59E0B   ← Base
amber-600:  #D97706   ← Text
amber-700:  #B45309   ← High contrast text
amber-800:  #92400E
amber-900:  #78350F
amber-950:  #451A03
```

**Usage:**
- Warning banners: `amber-50` bg, `amber-700` text, `amber-200` border
- Pending states: `amber-600`
- Review required: `amber-100` bg, `amber-700` text

---

### Info: Warm Slate

**Informational messages, neutral system feedback.**

```
Info Slate
──────────
slate-50:   #F8FAFC   ← Info message bg
slate-100:  #F1F5F9
slate-200:  #E2E8F0   ← Borders
slate-300:  #CBD5E1
slate-400:  #94A3B8   ← Icons
slate-500:  #64748B   ← Base
slate-600:  #475569   ← Text
slate-700:  #334155   ← High contrast
slate-800:  #1E293B
slate-900:  #0F172A
slate-950:  #020617
```

**Usage:**
- Info banners: `slate-50` bg, `slate-700` text, `slate-200` border
- System messages
- Neutral tooltips

---

## Interactive States

### State Progression

**Consistent state changes across all interactive elements:**

```
State       | Change from Base
────────────┼─────────────────────────────────
Default     | Base color (500)
Hover       | +1 shade darker (600)
Active      | +2 shades darker (700)
Focus       | Base + ring at 300 level
Disabled    | cream-300 bg, cream-500 text
```

### Focus States

**Always visible, always accessible:**

```css
/* Focus ring pattern */
focus: {
  outline: none;
  ring: 3px solid {color}-300;
  ring-offset: 2px cream-50;
}
```

**Why 300 level?** Light enough to see against dark buttons, dark enough for 3:1 contrast.

---

## Surface & Elevation

### Light Mode Surfaces

```
Layer 0 (Base):     cream-50      ← Page background
Layer 1 (Raised):   cream-100     ← Cards, panels
Layer 2 (Elevated): white         ← Modals, dropdowns
Layer 3 (Floating): cream-900     ← Tooltips (inverted)
```

**Borders:**
- Default: `cream-200`
- Emphasized: `cream-300`
- Interactive: `teal-200` (on focus/hover)

**Shadows** (warm, not cool):
```css
/* Level 1 */
box-shadow: 0 1px 3px rgba(45, 42, 37, 0.08);

/* Level 2 */
box-shadow: 0 4px 12px rgba(45, 42, 37, 0.12);

/* Level 3 */
box-shadow: 0 8px 24px rgba(45, 42, 37, 0.16);
```

**Notice:** Shadow color is warm brown (`#2D2A25`), not cool gray.

---

### Dark Mode Surfaces

**Evening studio feel—warm lamplight, not cold night.**

```
Layer 0 (Base):     cream-950     ← Page background
Layer 1 (Raised):   cream-900     ← Cards, panels
Layer 2 (Elevated): cream-800     ← Modals, dropdowns
Layer 3 (Floating): cream-200     ← Tooltips (inverted)
```

**Text in dark mode:**
- Primary: `cream-100`
- Secondary: `cream-300`
- Muted: `cream-500`

**Brand colors in dark mode:**
- Shift primary 1 step lighter (teal-500 → teal-400)
- Reduce saturation 10-15% (less eye strain)

---

## Accessibility

### Contrast Requirements

| Element | Minimum Ratio | Our Target |
|---------|---------------|------------|
| Body text | 4.5:1 | 7:1+ (AAA) |
| Large text (18px+) | 3:1 | 4.5:1+ (AA) |
| UI components | 3:1 | 3:1+ (AA) |
| Focus indicators | 3:1 | 3:1+ (AA) |

### Color Blindness

**Never use color alone. Always pair with:**
- Icons (✓ for success, ✕ for error)
- Text labels ("Success", "Error")
- Patterns or shapes

**Test with:**
- Deuteranopia (red-green, most common)
- Protanopia (red-green)
- Tritanopia (blue-yellow)
- Monochromacy (grayscale)

**Example:**
```
❌ Bad:  ● (green) and ● (red) with no labels
✅ Good: ✓ Success (green) and ✕ Error (red)
```

---

## Semantic Token Structure

### Naming Convention

```
color.{category}.{role}.{variant?}.{state?}
```

### Token Examples

**Text:**
```
color.text.primary      → cream-900 (light) / cream-100 (dark)
color.text.secondary    → cream-700 (light) / cream-300 (dark)
color.text.muted        → cream-600 (light) / cream-400 (dark)
color.text.disabled     → cream-500 (light) / cream-600 (dark)
color.text.inverse      → cream-50 (light) / cream-900 (dark)
```

**Backgrounds:**
```
color.bg.primary        → cream-50 (light) / cream-950 (dark)
color.bg.secondary      → cream-100 (light) / cream-900 (dark)
color.bg.tertiary       → cream-200 (light) / cream-800 (dark)
color.bg.inverse        → cream-900 (light) / cream-100 (dark)
```

**Borders:**
```
color.border.default    → cream-200 (light) / cream-800 (dark)
color.border.strong     → cream-300 (light) / cream-700 (dark)
color.border.interactive → teal-300 (focus states)
```

**Actions:**
```
color.action.primary.default  → teal-500
color.action.primary.hover    → teal-600
color.action.primary.active   → teal-700
color.action.primary.focus    → teal-300 (ring)

color.action.secondary.default → cream-200
color.action.secondary.hover   → cream-300
```

**Feedback:**
```
color.feedback.success.bg     → green-50
color.feedback.success.text   → green-700
color.feedback.success.border → green-200

color.feedback.error.bg       → red-50
color.feedback.error.text     → red-700
color.feedback.error.border   → red-200

color.feedback.warning.bg     → amber-50
color.feedback.warning.text   → amber-700
color.feedback.warning.border → amber-200
```

---

## Usage Examples

### Primary Button

```css
/* Light mode */
.btn-primary {
  background: teal-500;
  color: white;
  border: 1px solid teal-500;
}

.btn-primary:hover {
  background: teal-600;
  border-color: teal-600;
}

.btn-primary:active {
  background: teal-700;
  border-color: teal-700;
}

.btn-primary:focus {
  ring: 3px teal-300;
  ring-offset: 2px cream-50;
}

.btn-primary:disabled {
  background: cream-300;
  color: cream-500;
  cursor: not-allowed;
}
```

### Content Card

```css
/* Light mode */
.card {
  background: cream-100;
  border: 1px solid cream-200;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(45, 42, 37, 0.08);
}

.card-title {
  color: cream-900;
}

.card-body {
  color: cream-700;
}

.card-meta {
  color: cream-600;
}
```

### Success Message

```css
.alert-success {
  background: green-50;
  border: 1px solid green-200;
  color: green-700;
}

.alert-success-icon {
  color: green-600;
}
```

---

## Anti-Patterns

| Anti-Pattern | Why It's Wrong | What Instead |
|--------------|----------------|--------------|
| Pure white (#FFFFFF) | Cold, clinical | cream-50 or cream-100 |
| Cool gray | Corporate SaaS | Warm cream scale |
| Saturated blue as primary | Corporate, banking | Warm teal |
| Pure black (#000000) | Harsh, unnatural | cream-950 |
| Neon accents | Attention-seeking | Rich, natural tones |
| Gradient overuse | Distracting | Solid colors, subtle gradients |
| Color-only meaning | Inaccessible | Color + icon + text |

---

## The Warmth Test

Before finalizing any color combination, ask:

1. **Does it feel warm?** Not cold corporate, not sterile clinical
2. **Does it feel natural?** Like materials in a creative studio
3. **Does it feel calm?** Not demanding attention, not anxious
4. **Is it accessible?** Meets contrast ratios, works without color

If any answer is no → reconsider the palette.

---

## Living Document

Color system evolves. Changes require:

1. Accessibility audit (contrast verification)
2. Warmth test (creative studio check)
3. Dark mode compatibility
4. Token and component updates

| Date | Change | Reasoning |
|------|--------|-----------|
| 2026-01-01 | Initial color system | Foundation |
| 2026-01-03 | Complete rewrite | Alignment with Mission/Philosophy. Shifted from corporate blue to warm teal. Added cream neutral scale. Established warmth as core principle. |

---

## Summary

**Codex color system in one breath:**

> Warm neutrals ground everything in comfort. Teal brings natural, calming energy. Coral celebrates community moments. Every color serves meaning, every shade maintains warmth. The palette feels like sunlight through studio windows, not fluorescent office lighting.

**The test:**

> Does this palette feel like a yoga studio, or like a spreadsheet?

If yoga studio → proceed.
If spreadsheet → add warmth.

---

**Upstream**: [02. Visual Language](../02-visual-language/README.md)
**Downstream**: [04. Typography](../04-typography/README.md)

---

*Last updated: 2026-01-03*
*Version: 2.0*
*Status: Foundation document — warmth made visible*

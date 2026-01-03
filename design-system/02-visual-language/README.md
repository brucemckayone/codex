# 02. Visual Language

**Where philosophy becomes visible. How belonging looks.**

---

## Foundation

This document translates [Philosophy (01)](../01-philosophy/README.md) into visual form.

Every visual choice must answer: **Does this feel like walking into a beloved creative studio?**

---

## The Visual North Star

### What We're Evoking

**Physical spaces that inspire us:**

| Space | Visual Character |
|-------|------------------|
| Yoga studio | Natural light, warm wood, plants, soft textures, breathing room |
| Dance company | Open floors, mirrors, movement, grace, dynamic energy |
| Music school | Rich woods, crafted instruments, acoustic warmth, intimate and grand |
| Art collective | Gallery white, work on display, creative energy, collaboration visible |

**Common threads:**
- Natural materials (wood, stone, fabric)
- Warm light (golden hour, not fluorescent)
- Generous space (room to breathe, room to grow)
- Content is the star (chrome recedes)
- Human presence (community visible)
- Craft and intentionality (every detail considered)
- Organic moments (not rigidly mechanical)

**This is what Codex should feel like visually.**

---

### The Aesthetic Spectrum

```
Cold ◄────────────────────────────────────────────► Hot

Banking  Corporate  SaaS   ║ Codex ║  Casual  Playful  Chaotic
   │         │        │    ║       ║     │        │        │
   └─────────┴────────┴────╨───────╨─────┴────────┴────────┘
                           ▲
                     We live here
```

**We are:**
- Warmer than typical SaaS (not cold dashboards)
- More refined than casual (not sloppy)
- More human than corporate (not sterile)
- More intentional than playful (not chaotic)

**Visual expression of warmth:**
- Warm color temperature (cream > pure white, warm grays > cool grays)
- Rounded shapes (approachable, not aggressive)
- Natural-feeling textures (not plastic flat)
- Generous spacing (breathing room)
- Soft shadows (natural light, not harsh drop shadows)

---

## Light Philosophy

**Light is the foundation of visual warmth.**

### Natural Light Metaphor

Codex should feel like a creative studio with large windows on a clear morning.

**Light mode** (primary):
- Warm off-white backgrounds (not pure #FFFFFF)
- Subtle warmth in shadows (not cool blue shadows)
- Gentle gradients that feel like natural light falloff
- Depth through subtle elevation, not harsh shadows

**Dark mode** (secondary):
- Evening studio feel (warm lamplight, not cold night)
- Rich dark backgrounds (not pure #000000)
- Preserved warmth in accent colors
- Soft glows instead of harsh contrasts

### Light Levels (Elevation System)

```
┌─────────────────────────────────────────────────────────┐
│  LEVEL 0: Ground                                        │
│  Base surface. The floor of the studio.                 │
│  Background: primary canvas                             │
│  Shadow: none                                           │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  LEVEL 1: Raised                                  │  │
│  │  Content cards, panels. Furniture on the floor.   │  │
│  │  Shadow: 0 1px 3px rgba(0,0,0,0.08)               │  │
│  │                                                   │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │  LEVEL 2: Elevated                          │  │  │
│  │  │  Dropdowns, popovers. Items being handled.  │  │  │
│  │  │  Shadow: 0 4px 12px rgba(0,0,0,0.12)        │  │  │
│  │  │                                             │  │  │
│  │  │  ┌───────────────────────────────────────┐  │  │  │
│  │  │  │  LEVEL 3: Floating                    │  │  │  │
│  │  │  │  Modals, dialogs. Above everything.   │  │  │  │
│  │  │  │  Shadow: 0 8px 24px rgba(0,0,0,0.16)  │  │  │  │
│  │  │  └───────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Principles:**
- Shadows are soft, not harsh (natural light diffuses)
- Shadows have slight warmth (not cool blue)
- Elevation is subtle (we're not building skyscrapers)
- Most content lives at Level 1 (grounded, stable)

---

## Texture Philosophy

**Digital surfaces can have soul.**

### The Problem with Flat Design

Pure flat design feels:
- Plastic
- Cold
- Mechanical
- Lifeless

Creative studios have texture:
- Wood grain
- Fabric weave
- Paper fiber
- Stone variation

### Texture in Codex

**Not literal** (no wood background images), but **suggested**:

1. **Subtle noise** — Barely perceptible grain on backgrounds
2. **Soft gradients** — Natural light variation, not flat fills
3. **Border variation** — Slight opacity variation on edges
4. **Shadow warmth** — Shadows with slight color, not pure black

**Implementation:**
```css
/* Subtle background texture */
background: linear-gradient(
  135deg,
  var(--surface-warm) 0%,
  var(--surface-warmAlt) 100%
);

/* Optional: very subtle noise overlay */
background-image: url('noise.svg');
background-blend-mode: soft-light;
opacity: 0.03;
```

**The goal**: When a user looks at Codex, they feel warmth and craft without consciously noticing textures.

---

## Shape Language

**Shapes communicate personality.**

### Primary: Rounded Rectangles

Rounded corners = approachable, warm, professional.

**Radius Scale:**
```
xs:   2px   → Micro elements (badges, tiny indicators)
sm:   4px   → Small interactive (buttons, chips, tags)
md:   8px   → Standard containers (cards, inputs, panels)
lg:   12px  → Emphasized containers (feature cards, modals)
xl:   16px  → Major containers (page sections, overlays)
2xl:  24px  → Hero elements (onboarding, marketing)
full: 9999px → Circles (avatars, pips)
```

**Philosophy alignment:**
| Radius | Feeling |
|--------|---------|
| 0px (sharp) | Aggressive, corporate, cold ❌ |
| 2-4px | Professional, refined ✅ |
| 8-12px | Approachable, warm ✅ |
| 16-24px | Friendly, welcoming ✅ |
| 9999px (pill) | Trendy, unstable, childish ❌ |

**Rules:**
- Interactive elements: minimum `sm` (4px)
- Content containers: default `md` (8px)
- Modals/overlays: `lg` (12px)
- Never mix radii on the same component
- Avoid pills (feel trendy, will date quickly)
- Avoid sharp corners (feel aggressive)

### Secondary: Circles

**Use for:**
- Avatars (identity, humanity)
- Status indicators (online/offline pips)
- Icon containers (small, decorative)
- Loading spinners

**Don't use for:**
- Buttons (harder to read labels)
- Large containers (wasted space)
- Navigation items (breaks scanning)

### Tertiary: Organic Shapes

**Use for (sparingly):**
- Illustrations (empty states, onboarding)
- Background decorations (very subtle)
- Brand moments (logo elements)

**Don't use for:**
- UI chrome
- Interactive elements
- Content containers

**Philosophy**: Organic shapes evoke natural, human spaces—but they're decoration, not structure.

---

## Space Philosophy

**Space is not emptiness. It's intention.**

### The Creative Studio Principle

In a yoga studio, there's room to breathe, stretch, move.
In a gallery, art has room to exist, to be contemplated.
In a music school, sound has room to resonate.

**Codex content deserves the same respect.**

### Spacing Scale

```
0:    0px    → Collapsed (rarely used)
1:    4px    → Hairline (inline elements)
2:    8px    → Tight (related items)
3:    12px   → Cozy (form elements)
4:    16px   → Comfortable (default)
5:    20px   → Relaxed
6:    24px   → Generous (section padding)
8:    32px   → Spacious (between sections)
10:   40px   → Expansive
12:   48px   → Grand (page margins)
16:   64px   → Monumental (hero sections)
```

**Default spacing: 16px** (comfortable, like a well-designed room)

### Density Modes

Different contexts need different breathing room:

**Standard Density** — Creator workspace
```
Padding: 24px
Gap: 16px
Line-height: 1.6
```
For: Dashboard, settings, content editing, decision-making
Why: Focus requires space. Mistakes happen when cramped.

**Comfortable Density** — Member experience
```
Padding: 16px
Gap: 12px
Line-height: 1.5
```
For: Content browsing, library, journey view
Why: See more content, but still breathe.

**Compact Density** — Data views
```
Padding: 12px
Gap: 8px
Line-height: 1.4
```
For: Analytics tables, admin views, bulk operations
Why: Information density when scanning large datasets.

**Warning**: Never use compact for forms or error-prone tasks.

### White Space Budget

**Screen allocation:**
```
Content:    60-70%   → The actual information
Spacing:    20-30%   → Margins, padding, gaps
Chrome:     10-15%   → Navigation, borders, decoration
```

**Anti-patterns:**
- ❌ Content > 80% — cramped, hard to scan
- ❌ Spacing < 15% — claustrophobic
- ❌ Chrome > 20% — noisy, distracting

---

## Motion Philosophy

**Motion reveals character.**

### The Studio Metaphor

Think about movement in physical creative spaces:

- A yoga instructor moving between poses: **deliberate, smooth, intentional**
- A dancer demonstrating technique: **graceful, purposeful, controlled**
- A musician's hands on keys: **precise, flowing, natural**

**Not:**
- Bouncy (wrong tone—we're not a game)
- Robotic (wrong tone—we're not a machine)
- Sluggish (broken experience—something's wrong)
- Frantic (wrong tone—we're not urgent)

### Motion Personality

**Codex motion is: Deliberate, Smooth, Confident**

```
Principle          Expression
─────────────      ─────────────────────────────────────
Deliberate         Every animation has purpose
Smooth             Natural easing, no sharp changes
Confident          Quick but not rushed
Respectful         Never blocks user action
```

### Easing Curves

```javascript
// Elements entering (fade in, slide in, expand)
easeOut: cubic-bezier(0.0, 0.0, 0.2, 1)
// Quick start, gentle landing—like setting something down carefully

// Elements exiting (fade out, slide out, collapse)
easeIn: cubic-bezier(0.4, 0.0, 1, 1)
// Gentle start, quick departure—like picking something up

// State changes (hover, focus, toggle)
easeInOut: cubic-bezier(0.4, 0.0, 0.2, 1)
// Balanced, symmetric—like a breathing cycle

// Snappy feedback (dropdown open, tooltip)
sharp: cubic-bezier(0.4, 0.0, 0.6, 1)
// More pronounced, still smooth—like a confident gesture
```

**Default**: `easeInOut`
**Never**: `linear` (robotic), `ease` (browser default, inconsistent)

### Duration Scale

```
Instant:      0ms     → Immediate (focus rings, color changes)
Snap:         100ms   → Micro-feedback (hover states)
Quick:        200ms   → Standard interactions (buttons, toggles)
Smooth:       300ms   → Moderate complexity (dropdowns)
Deliberate:   400ms   → Significant transitions (modals, panels)
Slow:         500ms   → Large changes (page transitions)
```

**Default**: 200ms
**Maximum**: 500ms (anything longer feels broken)

**Rules:**
- Larger movements = longer duration
- Enter and exit should have matching durations
- User-initiated actions should feel instant (< 100ms feedback)
- System-initiated changes can be more deliberate

### Motion Accessibility

**Respect `prefers-reduced-motion`:**
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Essential motion** (can play even with reduced motion):
- Loading indicators
- Progress bars
- Critical state changes

**Decorative motion** (should be disabled):
- Hover effects
- Page transitions
- Micro-interactions

---

## Contrast Philosophy

**Contrast is hierarchy made visible.**

### The Gallery Principle

In an art gallery:
- The walls are neutral (they recede)
- The art is vivid (it commands attention)
- Lighting guides the eye (what matters is illuminated)

**Codex works the same way:**
- UI chrome is subtle (it recedes)
- Content is clear (it commands attention)
- Visual hierarchy guides the eye (important things are emphasized)

### Contrast Hierarchy

```
Level        Ratio      Use For
────────     ─────      ─────────────────────────────────
Maximum      7:1+       Body text, critical UI
High         4.5:1+     Secondary text, important elements
Medium       3:1+       Borders, focus rings, icons
Subtle       2:1+       Disabled states, decorative
Minimal      1.5:1+     Surface layering, hover states
```

**Non-negotiable:**
- Body text: 7:1 minimum (WCAG AAA)
- Interactive elements: 4.5:1 minimum (WCAG AA)
- Focus indicators: 3:1 minimum

### Contrast Strategy

**For critical elements** (text, buttons, errors):
- High contrast
- Multiple visual cues (not color alone)
- Clear boundaries

**For supporting elements** (dividers, borders, backgrounds):
- Subtle contrast
- Barely visible until needed
- Create depth without distraction

**Example: Button states**
```
State       Background    Border         Text       Ring
─────       ──────────    ──────         ────       ────
Default     primary       primary        white      none
Hover       primary+10%   primary+10%    white      none
Active      primary+20%   primary+20%    white      none
Focus       primary       primary        white      3px ring
Disabled    gray-200      gray-200       gray-500   none
```

**Notice**: State changes use multiple properties, not just color (accessibility requirement).

---

## Typography Expression

**Type is the voice made visible.**

Full typography system in [04. Typography](../04-typography/README.md).

### Visual Language Summary

**Warmth through type:**
- Humanist sans-serif (not geometric, not grotesque)
- Generous x-height (readable, approachable)
- Open apertures (friendly, welcoming)
- Comfortable line-height (breathing room)

**Hierarchy through weight:**
```
Weight      Number    Use
──────      ──────    ─────────────────────────────
Regular     400       Body text, descriptions
Medium      500       Labels, navigation, emphasis
Semibold    600       Subheadings, card titles
Bold        700       Headings, primary actions
```

**Avoid:**
- Light weights (< 400) for body text
- Heavy weights (> 700) for long content
- All-caps for more than 2-3 words

---

## Color Expression

**Color is emotion made visible.**

Full color system in [03. Color](../03-color/README.md).

### Visual Language Summary

**Warmth through color:**
- Warm neutrals (cream, sand, warm gray)
- Rich accent colors (not neon, not pastel)
- Natural palette inspiration (earth, sky, foliage)
- Sufficient saturation (not washed out)

**Calm through restraint:**
- Limited palette (don't use every color)
- Semantic colors for meaning (red = error, green = success)
- Neutral dominance (color is accent, not overwhelming)

---

## Composition Principles

**How elements relate to each other.**

### The Ensemble Principle

In a Collective, creators work together. They don't compete for attention.
The interface should reflect this: **elements in harmony, not competition**.

### Visual Hierarchy

Every screen has a story. Users should read it in order:

```
1. Primary Action / Page Purpose
   └── What am I here to do?

2. Main Content
   └── The actual information

3. Supporting Information
   └── Context, metadata, navigation

4. Secondary Actions
   └── Other things I could do
```

**Weight hierarchy (squint test):**
When you squint at a design, you should see:
1. One primary element (boldest)
2. 2-3 secondary elements (medium)
3. Supporting elements (lightest)

If everything is equally prominent, there's no hierarchy.

### Grid Philosophy

**Not rigid, but intentional.**

Base: 8px grid (all spacing divisible by 8)
Layout: 12-column for flexibility
Gutter: 24px (generous)

**When to break the grid:**
- Organic illustrations
- Brand moments
- Full-bleed imagery

**When to follow strictly:**
- Text content
- Forms
- Data tables
- Cards

### Alignment

**The invisible structure:**
- Left-align body text (easier to scan)
- Center-align headings (emphasis, symmetry)
- Right-align numbers (decimals line up)
- Consistent edge alignment (everything lines up)

### Proximity

**Related things are close. Unrelated things are far.**

```
[Form Label]
[Input Field]     ← 4px gap (tightly coupled)
[Helper Text]

                  ← 24px gap (separate elements)

[Submit Button]
```

---

## Imagery Philosophy

**Images show community, not products.**

### Subject Matter

**Show:**
- Real people in community (creators together, members engaged)
- Creative work in progress (the craft, the practice)
- Transformation moments (growth, achievement)
- Authentic settings (real studios, real spaces)

**Don't show:**
- Stock photography (feels fake)
- Solo influencer poses (solo operator aesthetic)
- Product shots (transactional)
- Office/corporate settings (wrong vibe)

### Image Treatment

**Warm:**
- Color grade toward warmth
- Natural lighting preferred
- Avoid cool blue casts

**Human:**
- Show faces (connection)
- Capture genuine moments (not posed)
- Diversity in representation

**Contextual:**
- Images should reinforce belonging
- Show the community context
- Avoid isolated subjects

---

## Three Contexts

The visual language adapts slightly for different users:

### Creator Context

**Dashboard, content management, analytics**

- Standard density (room for decisions)
- Full feature access visible
- Data-rich but organized
- Focus on creation and community health

### Member Context

**Library, content viewing, journey**

- Comfortable density (content-focused)
- Content is the star
- Navigation recedes
- Transformation journey visible

### Collective Context

**Public presence, marketing, community**

- More expressive spacing
- Brand personality comes through
- Community visible
- Purpose prominent

---

## Case Studies

### Case Study: Content Card

**❌ Generic SaaS approach:**
```
- Sharp corners (aggressive)
- Cool gray background (cold)
- Tight padding (cramped)
- Blue accent color (corporate)
- Stock photo thumbnail (fake)
- "Price: $49" label (transactional)
```

**✅ Codex approach:**
```
- 8px radius (approachable)
- Warm off-white background (inviting)
- 24px padding (breathing room)
- Rich accent color from palette (warm)
- Real creator photo or artwork (authentic)
- "Join for access" or just price in context (community-framed)
- Creator avatar visible (human)
- Collective branding subtle (belonging)
```

**The difference**: One feels like shopping on Amazon. The other feels like discovering something at a creative studio.

### Case Study: Empty State

**❌ Generic approach:**
```
- Sad robot illustration
- "No content yet"
- "Create your first course"
- Blue CTA button
```

**✅ Codex approach:**
```
- Warm, organic illustration (growth metaphor)
- "Your creative space awaits"
- "What will you share with your community?"
- Primary action: "Create your first offering"
- Secondary: "See how other creators started"
- Warm, inviting CTA color
```

**The difference**: One feels like an error. The other feels like an invitation.

### Case Study: Success State

**❌ Transactional approach:**
```
- Confetti animation 🎊
- "Payment successful!"
- "Order #12345"
- "Download receipt"
```

**✅ Community approach:**
```
- Subtle, warm glow animation
- "Welcome to [Collective Name]"
- Personal message from creator(s)
- "Here's what to explore first..."
- "Start your journey"
```

**The difference**: One feels like checkout. The other feels like belonging.

---

## Visual Language Checklist

Every design must pass:

### Does it evoke the creative studio?

- [ ] Warm, not cold?
- [ ] Spacious, not cramped?
- [ ] Natural, not mechanical?
- [ ] Human, not sterile?

### Does it follow the principles?

- [ ] Light: Warm, natural, subtle elevation?
- [ ] Shape: Consistent radii, rounded not sharp?
- [ ] Space: Generous, intentional, breathing room?
- [ ] Motion: Smooth, deliberate, purposeful?
- [ ] Contrast: High where it matters, subtle where it doesn't?

### Does it align with philosophy?

- [ ] Belonging over buying?
- [ ] Collaboration visible?
- [ ] Warmth present?
- [ ] Community feeling?

---

## Anti-Patterns

**Visual choices that violate our language:**

| Anti-Pattern | Why It's Wrong | What Instead |
|--------------|----------------|--------------|
| Sharp corners | Aggressive, corporate | 4-12px radius |
| Pure white (#FFF) | Cold, clinical | Warm off-white |
| Cool gray | SaaS aesthetic | Warm gray |
| Pill buttons | Trendy, will date | Rounded rectangle |
| Heavy drop shadows | Harsh, unnatural | Soft, warm shadows |
| Neon colors | Attention-seeking | Rich, natural tones |
| Cramped spacing | Stressful, cheap | Generous padding |
| Bouncy animations | Playful, wrong tone | Smooth, deliberate |
| Stock photography | Fake, corporate | Real community photos |
| Glassmorphism | Low contrast, inaccessible | Solid surfaces with subtle depth |

---

## Living Document

Visual language evolves with the design system. Changes require:

1. Written proposal with visual examples
2. Alignment check against Philosophy (01)
3. Accessibility audit (contrast, motion)
4. Engineering feasibility review
5. Update to tokens and components

| Date | Change | Reasoning |
|------|--------|-----------|
| 2026-01-01 | Initial visual language | Foundation |
| 2026-01-02 | Complete rewrite | Alignment with Mission/Philosophy. Added creative studio metaphor, light philosophy, texture philosophy, composition principles, imagery guidelines, case studies. |

---

## Summary

**Codex visual language in one breath:**

> We create digital spaces that feel like beloved creative studios—warm, spacious, intentional, human. Light is natural, shapes are approachable, space is generous, motion is smooth. Content is the star, chrome recedes, community is visible. Every pixel reflects belonging.

**The test:**

> Does this feel like walking into a yoga studio, a dance company, a music school, an art collective?

If yes → proceed.
If no → reconsider.

---

**Upstream**: [01. Philosophy](../01-philosophy/README.md)
**Downstream**: [03. Color](../03-color/README.md), [04. Typography](../04-typography/README.md)

---

*Last updated: 2026-01-02*
*Version: 2.0*
*Status: Foundation document — visual expression of philosophy*

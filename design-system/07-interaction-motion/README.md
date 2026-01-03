# 07. Interaction & Motion

**Movement with meaning. How animation expresses calm confidence.**

---

## Foundation

This document extends the motion philosophy from [Visual Language (02)](../02-visual-language/README.md).

Every animation must answer: **Does this feel deliberate and calm, or frantic and distracting?**

---

## Motion Philosophy

### Motion as Personality

Motion reveals character. Consider the movement in creative studios:

| Space | Movement Character |
|-------|-------------------|
| Yoga studio | Slow, deliberate, flowing transitions between poses |
| Dance company | Graceful, controlled, purposeful movement |
| Music school | Smooth, rhythmic, in tempo with the music |
| Art gallery | Minimal, still, letting the art command attention |

**Codex motion embodies**: Deliberate, smooth, confident.

---

### The Motion Spectrum

```
Frantic ◄────────────────────────────────────────► Static

Bouncy   Springy   Snappy  ║ Codex ║  Smooth   Slow   Still
Playful  Energetic Quick   ║       ║  Calm     Gentle  None
    │        │        │    ║       ║    │        │       │
    └────────┴────────┴────╨───────╨────┴────────┴───────┘
                           ▲
                     We live here
```

**Codex motion is:**
- Calmer than typical SaaS (not bouncy or springy)
- More alive than static (things still move meaningfully)
- Confident (quick, deliberate, not hesitant)
- Respectful (never blocks user action)

---

### Core Motion Principles

1. **Purposeful Motion**
   - Every animation teaches something
   - No decoration-only movement
   - Answer: "What does this help the user understand?"

2. **Calm Confidence**
   - Smooth, not bouncy
   - Quick, not slow
   - Deliberate, not hesitant
   - Like a yoga instructor demonstrating a pose

3. **Respectful of Attention**
   - One thing animates at a time
   - Never competing for attention
   - User actions feel immediate

4. **Performant Always**
   - 60fps or don't animate
   - Only transform and opacity
   - Reduced motion respected

---

## Motion Purposes

Animation serves exactly three purposes:

### 1. Feedback

**"I hear you."** — Confirming user actions.

```
Action              Feedback
────────────────────────────────────
Button click    →   Slight press, background shift
Form submit     →   Loading indicator, then success
Toggle switch   →   Smooth thumb movement
Checkbox        →   Check appears with subtle scale
```

### 2. Context

**"Here's where things are."** — Showing relationships.

```
Action              Context
────────────────────────────────────
Dropdown open   →   Menu slides from trigger
Modal open      →   Content rises from center
Panel expand    →   Content unfolds in place
Item delete     →   Item slides away, others fill
```

### 3. Direction

**"Look here."** — Guiding attention.

```
Action              Direction
────────────────────────────────────
New content     →   Subtle fade in
Error message   →   Alert slides into view
Success         →   Check appears, draws eye
Progress        →   Bar fills toward goal
```

---

## Duration Scale

Like a musical tempo—consistent, harmonious.

```
Token        Duration   Use Case                           Feel
─────────────────────────────────────────────────────────────────
instant      0ms        Reduced motion, focus states       Immediate
snap         100ms      Hover, micro-feedback              Quick flash
quick        200ms      Standard interactions              Responsive
smooth       300ms      Complex transitions                Noticeable
deliberate   400ms      Major changes (modals)             Significant
slow         500ms      Large state shifts (rare)          Deliberate
```

**Default: 200ms (quick)** — Responsive without being flashy

**Maximum: 500ms** — Anything longer feels broken

---

## Easing Curves

How motion accelerates and decelerates.

### The Curves

```javascript
// Elements entering (appear, slide in)
easeOut: cubic-bezier(0.0, 0.0, 0.2, 1)
// Starts fast, ends gently — like setting something down

// Elements exiting (disappear, slide out)
easeIn: cubic-bezier(0.4, 0.0, 1, 1)
// Starts gently, ends fast — like picking something up

// State changes (toggle, color change)
easeInOut: cubic-bezier(0.4, 0.0, 0.2, 1)
// Gentle start and end — like breathing

// Snappy feedback (dropdown, tooltip)
sharp: cubic-bezier(0.4, 0.0, 0.6, 1)
// More pronounced — confident, decisive
```

### When to Use Each

| Easing | Use When |
|--------|----------|
| easeOut | Something appears, enters view |
| easeIn | Something disappears, exits view |
| easeInOut | Something transforms in place |
| sharp | Quick interactions, dropdowns |

**Never use:**
- `linear` (robotic, mechanical)
- `ease` (browser default, inconsistent)
- Bounce/spring (too playful for Codex)

---

## Interaction Patterns

### Hover (Desktop Only)

**Purpose:** Preview what will happen on click.

| Element | Hover Effect | Duration |
|---------|--------------|----------|
| Button (primary) | teal-500 → teal-600 | 100ms |
| Button (secondary) | cream-200 → cream-300 | 100ms |
| Card | Subtle lift (shadow increase) | 200ms |
| Link | Underline appears | 100ms |
| Icon button | Background appears | 100ms |

**Code pattern:**
```css
.btn-primary {
  background: teal-500;
  transition: background 100ms ease-out;
}
.btn-primary:hover {
  background: teal-600;
}
```

**Mobile:** No hover states. Use active/focus instead.

---

### Active (Press/Tap)

**Purpose:** Confirm the click/tap registered.

| Element | Active Effect | Duration |
|---------|---------------|----------|
| Button | Darker + slight scale down (98%) | 100ms |
| Toggle | Thumb moves, background changes | 200ms |
| Checkbox | Check appears with scale | 150ms |
| Radio | Dot appears with scale | 150ms |

**Code pattern:**
```css
.btn:active {
  background: teal-700;
  transform: scale(0.98);
}
```

---

### Focus (Keyboard Navigation)

**Purpose:** Show where keyboard focus is.

**Focus ring specs:**
- Width: 3px
- Color: teal-300
- Offset: 2px
- Style: Solid (not dashed)

**Focus timing:** Instant (0ms) — never animate focus appearance.

```css
.btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--teal-300);
}
```

**Why instant?** Keyboard users navigate quickly. Animated focus causes disorientation.

---

### Loading States

**Purpose:** Show async operation in progress.

| State | Animation | Duration |
|-------|-----------|----------|
| Button loading | Spinner replaces text | 200ms transition |
| Progress bar | Width grows | 300ms per update |
| Skeleton | Shimmer left-to-right | 1500ms loop |
| Content loading | Fade in when ready | 200ms |

**Spinner specs:**
- Size: 16px (button), 24px (standalone)
- Color: Current text color
- Animation: 750ms rotation, linear, infinite

---

## Transition Patterns

### Fade

**Use for:** Content appearing/disappearing without motion.

```css
/* Appearing */
opacity: 0 → 1
duration: 200ms
easing: ease-out

/* Disappearing */
opacity: 1 → 0
duration: 150ms
easing: ease-in
```

**When:** Tooltips, toasts, overlays, content swaps.

---

### Slide + Fade

**Use for:** Content with directional context.

```css
/* Dropdown (slides down) */
transform: translateY(-8px) → translateY(0)
opacity: 0 → 1
duration: 200ms
easing: ease-out

/* Modal (slides up) */
transform: translateY(16px) → translateY(0)
opacity: 0 → 1
duration: 300ms
easing: ease-out
```

**Direction logic:**
- Dropdowns: Slide down from trigger
- Modals: Rise from center
- Side panels: Slide from edge
- Toasts: Slide from corner

---

### Scale + Fade

**Use for:** Content growing from a point.

```css
/* Modal appearing */
transform: scale(0.95) → scale(1)
opacity: 0 → 1
duration: 200ms
easing: ease-out
```

**When:** Modals, popovers, context menus.

**Caution:** Scale can cause text reflow. Use sparingly.

---

### Collapse/Expand

**Use for:** Accordions, expandable sections.

```css
/* Best approach (grid) */
.expandable {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 300ms ease-out;
}
.expandable.open {
  grid-template-rows: 1fr;
}
.expandable-content {
  overflow: hidden;
}
```

**Why grid?** Avoids jank from animating height.

---

## State Transitions

### Success Flow

```
idle → loading → success
  │        │         │
  │        │         └── Green check fades in (200ms)
  │        └──────────── Spinner fades out (100ms)
  └───────────────────── Button becomes loading (200ms)
```

### Error Flow

```
idle → loading → error
  │        │        │
  │        │        └── Shake animation + error message
  │        └─────────── Spinner fades out (100ms)
  └──────────────────── Button becomes loading (200ms)
```

**Error shake:**
```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}
.error { animation: shake 200ms ease-in-out; }
```

---

## Community-Focused Motion

### Welcome Flow

After joining a Collective, motion expresses warmth:

```
1. Overlay fades in (300ms) — warmth descends
2. Welcome card scales up (200ms) — grows from center
3. Creator message fades in (200ms, delayed 100ms) — personal touch
4. CTA button fades in (200ms, delayed 200ms) — next step clear
```

**Feels like:** A warm greeting, not a transaction receipt.

---

### Journey Progress

Progress animations celebrate transformation:

```
Progress bar:
├── Fills smoothly to new value (300ms ease-out)
├── Subtle pulse at milestone (200ms)
└── Celebration indicator on completion

Milestone reached:
├── Badge scales up with subtle bounce (250ms)
├── Message fades in (200ms)
└── Confetti? (only if user preference allows)
```

**Feels like:** Achievement, not just data changing.

---

### Community Celebration

When collective milestones are reached:

```
Celebration toast:
├── Slides in from corner (300ms)
├── Coral accent color (warm, celebratory)
├── Gentle pulse animation (subtle, not distracting)
└── Auto-dismiss after 5s (fade out 200ms)
```

---

## Reduced Motion

**Respect user preferences absolutely.**

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Essential vs Decorative

**Essential (still plays):**
- Loading spinners (shows system working)
- Progress bars (shows actual progress)
- Focus indicators (accessibility)

**Decorative (removed):**
- Hover effects
- Slide/fade transitions
- Celebration animations
- Page transitions

---

## Performance Requirements

### Only Animate Compositor Properties

```
✅ Animate (GPU-accelerated, 60fps):
   - transform (translate, scale, rotate)
   - opacity

❌ Avoid (triggers layout, causes jank):
   - width, height
   - top, left, bottom, right
   - margin, padding
   - font-size
```

### Testing Checklist

```
□ 60fps on target devices (Chrome DevTools Performance)
□ No layout thrashing (Layers panel)
□ Reduced motion honored
□ Keyboard navigation not blocked
□ Screen reader experience unchanged
```

---

## Motion Tokens

```javascript
// Duration
motion.duration.instant      = '0ms';
motion.duration.snap         = '100ms';
motion.duration.quick        = '200ms';
motion.duration.smooth       = '300ms';
motion.duration.deliberate   = '400ms';
motion.duration.slow         = '500ms';

// Easing
motion.easing.easeOut        = 'cubic-bezier(0.0, 0.0, 0.2, 1)';
motion.easing.easeIn         = 'cubic-bezier(0.4, 0.0, 1, 1)';
motion.easing.easeInOut      = 'cubic-bezier(0.4, 0.0, 0.2, 1)';
motion.easing.sharp          = 'cubic-bezier(0.4, 0.0, 0.6, 1)';
```

---

## Anti-Patterns

| Anti-Pattern | Why It's Wrong | What Instead |
|--------------|----------------|--------------|
| Bounce/spring | Too playful for Codex | Smooth ease-out |
| >500ms duration | Feels broken | Cap at 500ms |
| Multiple simultaneous | Chaotic, overwhelming | One thing at a time |
| Animating layout | Jank, poor performance | Transform/opacity only |
| Linear easing | Robotic, unnatural | Use curved easing |
| Blocking animations | User can't continue | Non-blocking feedback |
| Ignoring reduced-motion | Accessibility violation | Always respect |

---

## The Calm Test

Before shipping any motion:

1. **Is it purposeful?** Does it teach something?
2. **Is it calm?** Smooth, not bouncy?
3. **Is it quick?** Under 500ms?
4. **Is it performant?** 60fps on all devices?
5. **Is it respectful?** Reduced motion works?

If any answer is no → simplify or remove.

---

## Living Document

Motion system evolves. Changes require:

1. Purpose justification
2. Performance testing
3. Reduced motion check
4. Token/component updates

| Date | Change | Reasoning |
|------|--------|-----------|
| 2026-01-01 | Initial motion system | Foundation |
| 2026-01-03 | Complete rewrite | Alignment with Mission/Philosophy. Added creative studio metaphor, community celebration patterns, calm confidence personality. |

---

## Summary

**Codex motion in one breath:**

> Movement is meaning, not decoration. Animations are deliberate, smooth, and confident—like a yoga instructor demonstrating a pose. Quick feedback shows "I hear you." Contextual motion shows "Here's where things are." Every transition respects user preference and maintains 60fps.

**The test:**

> Does this motion feel like a calm yoga class, or like an arcade game?

If yoga class → ship it.
If arcade → remove the bounce.

---

**Upstream**: [06. Components](../06-components/README.md)
**Downstream**: [08. Content & Voice](../08-content-voice/README.md)

---

*Last updated: 2026-01-03*
*Version: 2.0*
*Status: Foundation document — movement with meaning*

# 07. Interaction & Motion

**Motion is meaning, not decoration. Feedback, duration, easing, state changes.**

---

## Purpose

Motion serves **three purposes**:

1. **Feedback**: Confirm user actions (button pressed, form submitted)
2. **Context**: Show relationships (where things come from/go to)
3. **Direction**: Guide attention (what changed, what's next)

**Not decoration**. Not delight. **Communication through movement.**

---

## Motion Principles

### 1. Purposeful

Every animation **must answer**: What is this teaching the user?

- ❌ Animations for "polish"
- ✅ Animations for understanding

---

### 2. Subtle

**Codex motion = calm, professional, deliberate**

- ❌ Bouncy, springy, playful
- ✅ Smooth, controlled, quick

---

### 3. Performant

**60fps or don't animate**

- Animate: `transform`, `opacity` (GPU-accelerated)
- Don't animate: `width`, `height`, `top`, `left` (jank)

---

### 4. Respectful

**Honor user preferences**

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Users who enable this**: vestibular disorders, motion sensitivity, cognitive needs

---

## Duration Scale

```
instant:    0ms     → No animation (reduced-motion)
snap:       100ms   → Micro-feedback (hover state)
quick:      200ms   → Standard interactions (button press)
smooth:     300ms   → Moderate transitions (dropdown open)
deliberate: 400ms   → Complex changes (modal open)
slow:       600ms   → Large state shifts (page transition)
```

**Default**: 200ms (quick) for most UI

**Rule**: Larger movement = longer duration (but cap at 600ms)

---

## Easing Curves

**See [02-visual-language](../02-visual-language/README.md#motion-character) for full details**

**Quick reference**:
```javascript
easeOut:    cubic-bezier(0.0, 0.0, 0.2, 1)   // Entering
easeIn:     cubic-bezier(0.4, 0.0, 1, 1)     // Exiting
easeInOut:  cubic-bezier(0.4, 0.0, 0.2, 1)   // State changes
sharp:      cubic-bezier(0.4, 0.0, 0.6, 1)   // Snappy
```

**Never**: `linear` (robotic), `ease` (inconsistent)

---

## Interaction Feedback

### Hover (Desktop Only)

**Purpose**: Preview interaction

**Examples**:
- Button: Background darkens (100ms snap)
- Card: Lifts with shadow (200ms quick)
- Link: Underline appears (100ms snap)

**Mobile**: No hover states (use active instead)

---

### Active (Press)

**Purpose**: Confirm press/tap

**Examples**:
- Button: Scales down 2% + darkens (100ms snap)
- Toggle: Thumb moves + background changes (200ms quick)

---

### Focus

**Purpose**: Keyboard navigation visibility

**Examples**:
- Input: Border blue + ring appears (instant, 0ms)
- Button: Ring appears (instant, 0ms)

**Never animate focus** (accessibility issue for keyboard users)

---

### Loading

**Purpose**: Async operation in progress

**Examples**:
- Button: Spinner replaces text (200ms quick)
- Progress bar: Width animates (300ms smooth)
- Skeleton: Shimmer animation (1500ms loop)

---

## Transition Types

### Fade

**Usage**: Content swaps, overlays

```css
opacity: 0 → 1
duration: 200ms
easing: easeOut
```

**Examples**: Modal open, tooltip appear

---

### Slide

**Usage**: Panels, dropdowns, drawers

```css
transform: translateY(10px) → translateY(0)
opacity: 0 → 1
duration: 300ms
easing: easeOut
```

**Direction**:
- **Down**: Dropdowns, tooltips
- **Up**: Modals, sheets
- **Left/Right**: Sidebars, drawers

---

### Scale

**Usage**: Small → large (modals), large → small (press feedback)

```css
transform: scale(0.95) → scale(1)
opacity: 0 → 1
duration: 200ms
easing: easeOut
```

**Warning**: Scale can cause text reflow (use sparingly)

---

### Collapse/Expand

**Usage**: Accordions, expanding panels

```css
height: 0 → auto  /* Bad: janky */
max-height: 0 → 500px  /* Better: smoother */
grid-template-rows: 0fr → 1fr  /* Best: no jank */
```

**Duration**: 300ms (smooth)

---

## State Change Transitions

### Success → Error

**Visual change**: Green → red + icon swap

```css
background: green → red (300ms smooth)
icon: checkmark → X (100ms fade out, 100ms fade in)
```

---

### Enabled → Disabled

**Visual change**: Full color → muted

```css
opacity: 1 → 0.5 (200ms quick)
cursor: pointer → not-allowed (instant)
```

---

### Loading → Success

**Visual change**: Spinner → checkmark

```css
spinner fade out: 100ms
checkmark fade in: 100ms (after spinner exits)
```

---

## Page Transitions

**Avoid** unless necessary (slow, disruptive)

**If required**:
```
Exit (old page):  Fade out 200ms
Enter (new page): Fade in 200ms (after exit)
```

**Better**: Instant navigation, let browser handle

---

## Scroll Behavior

### Smooth Scroll (Anchor Links)

```css
scroll-behavior: smooth;
```

**Duration**: Browser default (~500ms)

**Disable for**:
```css
@media (prefers-reduced-motion: reduce) {
  scroll-behavior: auto;
}
```

---

### Scroll-triggered Animations

**Avoid** unless critical (sticky nav, parallax)

**If used**: Subtle, performance-tested

---

## Anti-Patterns

### ❌ Overanimation

Too many things moving at once (chaotic, unprofessional)

✅ **Do**: Animate one thing at a time

---

### ❌ Inconsistent Durations

Random timing (200ms here, 350ms there)

✅ **Do**: Use scale (100, 200, 300, 400, 600ms)

---

### ❌ Slow Animations

Transitions > 600ms (feels broken)

✅ **Do**: Cap at 600ms maximum

---

### ❌ Animating Layout Properties

`width`, `height`, `top`, `left` (jank, reflow)

✅ **Do**: Animate `transform` and `opacity` only

---

## Motion Tokens

```javascript
motion.duration.instant:    0ms
motion.duration.snap:       100ms
motion.duration.quick:      200ms
motion.duration.smooth:     300ms
motion.duration.deliberate: 400ms
motion.duration.slow:       600ms

motion.easing.easeOut:   cubic-bezier(0.0, 0.0, 0.2, 1)
motion.easing.easeIn:    cubic-bezier(0.4, 0.0, 1, 1)
motion.easing.easeInOut: cubic-bezier(0.4, 0.0, 0.2, 1)
motion.easing.sharp:     cubic-bezier(0.4, 0.0, 0.6, 1)
```

**Full token file**: [/tokens/motion.tokens.json](../tokens/motion.tokens.json)

---

## Testing Motion

1. **Visual QA**: Watch at normal speed (60fps?)
2. **Slow motion**: 0.25x speed (smooth curve?)
3. **Reduced motion**: User preference honored?
4. **Performance**: 60fps maintained?

---

Next: [08. Content & Voice →](../08-content-voice/README.md)

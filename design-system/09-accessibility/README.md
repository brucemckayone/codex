# 09. Accessibility & Inclusion

**Everyone belongs. How we ensure no one is left outside the community.**

---

## Foundation

This document extends the mission from [00. Mission](../00-mission/README.md) and [01. Philosophy](../01-philosophy/README.md).

Every accessibility decision must answer: **Does this ensure everyone can belong to our community?**

---

## Accessibility Philosophy

### Everyone Belongs

Accessibility isn't compliance. It isn't a checklist. It isn't a legal requirement we grudgingly meet.

**Accessibility is love.**

If Codex is about belonging—about Collectives where creators and members build together—then excluding anyone is a betrayal of our mission. A yoga studio that only welcomes certain bodies isn't a yoga studio. A music school that excludes deaf musicians isn't truly about music.

**Our standard:** Not "minimum compliance." Not "audit-passing." Our standard is: **Can everyone participate fully?**

---

### The Inclusion Spectrum

```
Exclusive ◄────────────────────────────────────────► Inclusive

Hostile   Ignorant   Compliant  ║  Codex  ║  Welcoming  Celebrating
Blocking  Barriers   Minimum    ║         ║  Accessible  Universal
   │         │           │      ║         ║      │           │
   └─────────┴───────────┴──────╨─────────╨──────┴───────────┘
                                ▲
                          We live here
```

**Codex accessibility is:**
- Beyond compliant (AAA where possible, AA minimum)
- Welcoming by default (not requiring special requests)
- Proactive (designed in, not bolted on)
- Celebratory (disability as diversity, not deficiency)

---

### Who We Design For

In creative studios, everyone finds their place:

| Situation | In Our Community |
|-----------|------------------|
| Blind member | Full participation via screen reader |
| Low vision creator | High contrast, zoom-friendly interfaces |
| Deaf member | Captions, visual feedback, no audio-only |
| Motor impairment | Keyboard/voice navigation, generous targets |
| Cognitive differences | Clear language, calm interfaces, predictable patterns |
| Temporary disability | Works with one hand, in bright sunlight, on slow connection |
| Different contexts | Works while holding baby, commuting, multitasking |

**The insight:** Accessibility features help everyone. Captions help in noisy rooms. High contrast helps in sunlight. Simple language helps non-native speakers.

---

### Core Accessibility Principles

1. **Belonging Over Barriers**
   - Every feature accessible to every person
   - No "accessible version" — the main version is accessible
   - Design for edge cases, not just averages

2. **Perceivable Content**
   - All information conveyable through multiple senses
   - Text alternatives for images
   - Captions for audio
   - Audio descriptions where meaningful

3. **Operable Interfaces**
   - Every function via keyboard
   - Generous touch targets
   - Sufficient time for all actions
   - No timing that excludes slow readers

4. **Understandable Experiences**
   - Clear language (no jargon gatekeeping)
   - Predictable navigation (consistency = comfort)
   - Error prevention and recovery

5. **Robust Implementation**
   - Works with assistive technology
   - Degrades gracefully
   - Future-compatible

---

## Visual Accessibility

### Contrast as Welcome

High contrast isn't just readable—it says "we want you to see this clearly."

**Our Standard (WCAG AAA):**

| Element | Ratio | Why |
|---------|-------|-----|
| Body text (cream-700 on cream-50) | 7.8:1 | Exceeds AAA (7:1) |
| Primary text (cream-900 on cream-50) | 12.5:1 | Maximum readability |
| Secondary text (cream-600 on cream-50) | 5.2:1 | AA for 14px+ |
| UI components (borders, icons) | 3:1 | WCAG requirement |
| Focus ring (teal-300) | 3:1 | Visible on any background |

**Test every combination:**
- Light mode and dark mode
- On cream, white, and teal backgrounds
- At different zoom levels

---

### Color Independence

**Never use color alone.** Color blindness affects 8% of men. But beyond that—color-only information is lazy design.

| Bad | Good | Why Better |
|-----|------|------------|
| Red dot = error | ✕ Error + red + message | Three signals, not one |
| Green dot = success | ✓ Success + green + message | Redundant = robust |
| Blue link = link | Underlined link | Works for everyone |
| Required fields in red | "Required" label | Explicit > implicit |

**The test:** Cover your screen with a red filter. Can you still use everything?

---

### Low Vision Support

Many users zoom browsers to 200% or more. Our layouts must accommodate:

```
At 200% zoom:
├── All text readable (no overflow, no cutoff)
├── Layout adapts (responsive at all zoom levels)
├── Touch targets still reachable (44px still works)
├── No horizontal scrolling for text content
└── Images scale or provide alt text
```

**Implementation:**
- Use `rem` units (scales with browser settings)
- Test at 200%, 300%, 400% zoom
- Never `max-width` on text containers that cuts off content
- Allow browser text size override

---

## Keyboard Navigation

### Why Keyboard Matters

Many users navigate without a mouse:
- Blind users (screen reader + keyboard)
- Motor impairments (keyboard or switch devices)
- Power users (efficiency preference)
- Voice control users (voice → keyboard commands)

**Our commitment:** Every function accessible via keyboard alone.

---

### Keyboard Patterns

| Key | Action |
|-----|--------|
| `Tab` | Move to next focusable element |
| `Shift + Tab` | Move to previous element |
| `Enter` | Activate buttons, links, submit forms |
| `Space` | Toggle checkboxes, activate buttons |
| `Escape` | Close modals, dismiss overlays, cancel |
| `Arrow keys` | Navigate within menus, tabs, lists, sliders |
| `Home` / `End` | First/last item in list |

---

### Focus Management

**Focus indicators are wayfinding.** Like signage in a building, they show where you are.

```css
/* Our focus ring — warm teal, clearly visible */
*:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--teal-300);
}

/* Focus ring offset for buttons */
.btn:focus-visible {
  box-shadow: 0 0 0 3px var(--teal-300);
  outline-offset: 2px;
}
```

**Never:**
- `outline: none` without replacement (removes all focus indication)
- Rely on color change alone (invisible to some)
- Animate focus appearance (disorienting for keyboard users)

**Focus ring specs:**
- Width: 3px (visible but not overwhelming)
- Color: teal-300 (our brand, high contrast)
- Offset: 2px (breathing room from element)
- Timing: Instant (0ms — keyboard users navigate fast)

---

### Focus Trapping (Modals)

When modals open, focus must:
1. Move to modal (usually close button or first interactive element)
2. Stay trapped inside modal (Tab cycles through modal only)
3. Return to trigger element when modal closes

```html
<!-- Focus trap example -->
<div role="dialog" aria-modal="true" aria-labelledby="modal-title">
  <h2 id="modal-title">Welcome to the Community</h2>
  <p>You're now a member...</p>
  <button>Start exploring</button>
  <button>Close</button>
</div>
```

**Why trap?** Without trapping, Tab moves to hidden content behind modal — confusing and disorienting.

---

### Skip Links

For keyboard users navigating long pages:

```html
<a href="#main-content" class="skip-link">
  Skip to main content
</a>

<!-- Later in the page -->
<main id="main-content" tabindex="-1">
  ...
</main>
```

**Skip link styles:**
- Hidden by default
- Visible on focus
- High contrast
- First focusable element

---

## Screen Reader Support

### Semantic HTML First

Native HTML elements have built-in accessibility. Don't reinvent wheels.

| Use This | Not This |
|----------|----------|
| `<button>` | `<div onclick>` |
| `<a href>` | `<span onclick>` |
| `<nav>` | `<div class="nav">` |
| `<main>` | `<div class="main">` |
| `<header>` | `<div class="header">` |
| `<h1>`-`<h6>` | `<div class="heading">` |
| `<ul>` / `<ol>` | `<div>` with styled items |

**Why?** Native elements include:
- Keyboard support (free)
- ARIA roles (automatic)
- Screen reader announcements (correct)
- Mobile accessibility (works)

---

### ARIA: The Last Resort

ARIA (Accessible Rich Internet Applications) is for when HTML isn't enough.

**Rule:** No ARIA is better than bad ARIA.

**When to use ARIA:**

| Scenario | ARIA Needed |
|----------|-------------|
| Icon-only button | `aria-label="Close modal"` |
| Custom component | `role="dialog"`, `role="tablist"` |
| Dynamic content | `aria-live="polite"` |
| Expanded/collapsed | `aria-expanded="true"` |
| Progress indication | `aria-valuenow`, `aria-valuemax` |

**Common patterns:**

```html
<!-- Icon button needs label -->
<button aria-label="Close">
  <svg><!-- X icon --></svg>
</button>

<!-- Expandable section -->
<button aria-expanded="false" aria-controls="faq-1">
  What is a Collective?
</button>
<div id="faq-1" hidden>
  A Collective is a community...
</div>

<!-- Loading state -->
<button aria-busy="true" aria-disabled="true">
  <span class="spinner"></span>
  Joining...
</button>
```

---

### Live Regions

For dynamic content that changes without page reload:

```html
<!-- Polite: announce when user is idle -->
<div aria-live="polite" aria-atomic="true">
  Changes saved
</div>

<!-- Assertive: announce immediately (errors) -->
<div aria-live="assertive" role="alert">
  Upload failed. Please try again.
</div>
```

**When to use:**
- `polite` — Success messages, status updates, non-urgent
- `assertive` — Errors, warnings, time-sensitive

**Never:** Announce every state change (overwhelming)

---

### Heading Structure

Headings are navigation. Screen reader users jump between headings.

```
✅ Good structure:
h1: Dashboard
  h2: Your Journey
    h3: Current Progress
    h3: Next Steps
  h2: Your Offerings
    h3: Published
    h3: Drafts

❌ Bad structure:
h1: Dashboard
h3: Progress (skipped h2)
h4: Next (skipped to h4)
h2: Offerings (back to h2?)
```

**Rules:**
- One `h1` per page (the main topic)
- Never skip levels (h1 → h3)
- Use for structure, not styling (use CSS for size)

---

## Touch & Motor Accessibility

### Touch Targets

Small targets are hostile. They exclude people with:
- Tremors (Parkinson's, essential tremor)
- Large fingers
- Limited fine motor control
- Touchscreen in motion (car, walking)

**Our standard:** 44px minimum, 48px preferred

```css
/* Minimum touch target */
.interactive {
  min-height: 44px;
  min-width: 44px;
}

/* Preferred (more forgiving) */
.btn {
  min-height: 48px;
  padding: 12px 20px;
}
```

**Spacing between targets:** 12px minimum (prevents mis-taps)

---

### Alternative Input Methods

Support beyond touch and mouse:

| Method | Requirements |
|--------|--------------|
| Keyboard | All functions accessible |
| Voice control | Visible labels match spoken commands |
| Switch devices | Focus visible, logical order |
| Eye tracking | Large targets, predictable layout |
| Head tracking | Forgiving targets, no rapid movements |

---

## Cognitive Accessibility

### Clear Language

**Our community speaks many languages.** Even English speakers vary in reading ability, education, cognitive load, and attention.

**Guidelines:**
- 8th-grade reading level (Hemingway Editor)
- Short sentences (< 20 words)
- Common words (no jargon)
- Active voice ("We saved your changes" not "Changes were saved")

**Community language examples:**

| Jargon | Clear |
|--------|-------|
| "Authenticate your credentials" | "Sign in" |
| "Initialize your membership parameters" | "Set up your profile" |
| "Navigate to the resource repository" | "Go to your library" |
| "Transaction processed successfully" | "You're in!" |

---

### Predictable Patterns

Consistency reduces cognitive load. Users shouldn't re-learn navigation on each page.

**Consistent patterns:**
- Navigation: Same location on every page
- Actions: Same buttons in same places
- Language: Same terms for same concepts ("Join" everywhere, not "Join" then "Subscribe" then "Purchase")
- Feedback: Same patterns for success, error, loading

---

### Focus and Attention

**Minimize distractions:**
- One primary action per view
- Progressive disclosure (hide advanced options)
- Calm interfaces (no flashing, no auto-play)
- Clear visual hierarchy

**Error prevention:**
- Confirm destructive actions ("Delete this offering?")
- Auto-save drafts
- Undo where possible
- Validate on blur, not keystroke (don't interrupt typing)

---

### Memory Support

Don't rely on user memory:

| Bad | Good |
|-----|------|
| Placeholder-only fields | Visible labels always |
| "Password must have..." (after submit) | Requirements visible while typing |
| "Enter the code we sent" | Code visible on same screen |
| Multi-page forms without progress | Clear progress indicator |

---

## Motion & Vestibular

### Reduced Motion

Some users experience:
- Vestibular disorders (dizziness from motion)
- Motion sickness
- Seizure triggers (flashing content)
- Sensory processing differences

**Always honor preference:**

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

---

### What Still Works (Essential Motion)

Some motion is functional, not decorative:

| Essential (still plays) | Decorative (removed) |
|------------------------|---------------------|
| Loading spinner | Page transitions |
| Progress bar | Hover effects |
| Focus ring | Parallax scrolling |
| Video playback | Background animations |

---

### Never Use

- **Flashing > 3 times/second** — Seizure risk
- **Parallax scrolling** — Vestibular trigger
- **Auto-playing video with sound** — Startling, inaccessible
- **Infinite looping animations** — Distracting, anxiety-inducing

---

## Forms Accessibility

### Labels

**Always visible.** Placeholders disappear on focus (memory burden).

```html
<!-- ✅ Good: Visible label -->
<label for="email">Your email</label>
<input id="email" type="email" placeholder="name@example.com" />

<!-- ❌ Bad: Placeholder only -->
<input type="email" placeholder="Email" />
```

---

### Error Messages

Errors must be:
1. **Associated** with the field (aria-describedby)
2. **Announced** to screen readers (role="alert")
3. **Actionable** (tell user how to fix)

```html
<label for="email">Your email</label>
<input
  id="email"
  type="email"
  aria-invalid="true"
  aria-describedby="email-error"
/>
<p id="email-error" role="alert">
  Email isn't valid. Try: name@example.com
</p>
```

---

### Required Fields

Indicate before submission:

```html
<!-- Option 1: Explicit text -->
<label for="title">
  Offering title <span class="required">(required)</span>
</label>

<!-- Option 2: Asterisk with explanation -->
<p class="form-instructions">* indicates required field</p>
<label for="title">
  Offering title <span aria-label="required">*</span>
</label>
```

---

### Form Structure

```html
<form>
  <fieldset>
    <legend>Your Information</legend>

    <!-- Grouped related fields -->
    <div class="form-field">
      <label for="name">Full name</label>
      <input id="name" required />
    </div>

    <div class="form-field">
      <label for="email">Email</label>
      <input id="email" type="email" required />
      <p class="helper">We'll send your welcome message here</p>
    </div>
  </fieldset>

  <button type="submit">Join the community</button>
</form>
```

---

## Media Accessibility

### Images

| Image Type | Requirement |
|------------|-------------|
| Meaningful image | Descriptive alt text |
| Decorative image | Empty alt (`alt=""`) |
| Complex image (chart, diagram) | Long description or data table |
| Image of text | Actual text preferred |

**Good alt text:**
- Describes purpose, not just content
- "Creator Sarah Chen teaching breathing exercise" (not "woman sitting")
- Context matters: same image might need different alt in different contexts

---

### Video

| Feature | Purpose |
|---------|---------|
| Captions | Deaf/hard of hearing, noisy environments |
| Transcripts | Deaf, search indexing, preference |
| Audio descriptions | Blind users (describes visual content) |
| No autoplay | Respect user control |

**Captions requirements:**
- Accurate (not auto-generated without review)
- Synchronized (match audio timing)
- Speaker identification (when multiple speakers)
- Sound descriptions ([music playing], [door closes])

---

### Audio

| Feature | Purpose |
|---------|---------|
| Transcripts | Deaf/hard of hearing |
| No autoplay | Respect user control |
| Volume controls | User control |
| Pause/stop controls | User control |

---

## Testing

### Automated Testing

Tools catch ~30% of issues. Use them, but don't rely on them.

**Tools:**
- **axe DevTools** — Browser extension, catches common issues
- **Lighthouse** — Chrome DevTools, accessibility audit
- **WAVE** — Visual feedback on page
- **Contrast checkers** — Verify color combinations

**Run on:**
- [ ] Every component
- [ ] Every page
- [ ] After major changes

---

### Manual Testing

Catches what automation misses.

**Keyboard testing:**
- [ ] Navigate entire page with Tab only
- [ ] Can access all interactive elements?
- [ ] Focus order logical?
- [ ] Focus always visible?
- [ ] Can escape modals with Escape?
- [ ] No keyboard traps?

**Screen reader testing:**
- [ ] Content announced in logical order?
- [ ] All interactive elements have names?
- [ ] State changes announced?
- [ ] Forms navigable and errors clear?

**Visual testing:**
- [ ] 200% zoom still usable?
- [ ] Color not only indicator?
- [ ] Contrast meets standards?
- [ ] Focus visible on all backgrounds?

**Motion testing:**
- [ ] Reduced motion preference honored?
- [ ] No flashing content?
- [ ] Essential animations still work?

---

### Real User Testing

**The ultimate test:** People with disabilities using assistive technology.

Include in testing:
- Blind users (screen readers: VoiceOver, NVDA, JAWS)
- Low vision (magnification, high contrast modes)
- Motor impairments (keyboard-only, voice control, switch devices)
- Cognitive differences (comprehension, navigation patterns)

**Compensate testers fairly.** Their expertise is valuable.

---

## WCAG Compliance

### Our Standards

| Level | Status | Notes |
|-------|--------|-------|
| **A** (Minimum) | ✅ Required | Non-negotiable baseline |
| **AA** (Standard) | ✅ Required | Our minimum standard |
| **AAA** (Enhanced) | 🎯 Goal | Where possible |

### Key Requirements by Level

**Level A:**
- Text alternatives for images
- Captions for video
- Content accessible by keyboard
- No keyboard traps
- Pause/stop for auto-playing content

**Level AA:**
- 4.5:1 contrast for text
- 3:1 contrast for UI components
- Text resizable to 200%
- Multiple ways to find pages
- Consistent navigation

**Level AAA:**
- 7:1 contrast for text
- Sign language for video (ideal)
- Extended audio descriptions
- No timing requirements
- Simple language

---

## Accessibility-First Process

### Design Phase

- [ ] Contrast checked in design
- [ ] Keyboard flow mapped
- [ ] Focus order defined
- [ ] Touch targets sized
- [ ] Color independence verified

### Build Phase

- [ ] Semantic HTML used
- [ ] ARIA only where needed
- [ ] Focus management implemented
- [ ] Reduced motion respected
- [ ] Alt text provided

### Test Phase

- [ ] Automated tests pass
- [ ] Keyboard navigation works
- [ ] Screen reader verified
- [ ] Zoom tested
- [ ] Real users consulted

### Launch Phase

- [ ] Documentation complete
- [ ] Known issues documented
- [ ] Feedback mechanism exists
- [ ] Commitment to fix issues

---

## Anti-Patterns

| Anti-Pattern | Why It's Exclusionary | What Instead |
|--------------|----------------------|--------------|
| `outline: none` | Removes focus for keyboard users | Custom visible focus ring |
| Color-only status | Invisible to colorblind users | Color + icon + text |
| Placeholder-only labels | Disappear on focus | Visible labels always |
| `<div onclick>` | No keyboard support | Native `<button>` |
| Auto-playing video | Startling, bandwidth | User-initiated play |
| Timing requirements | Excludes slow readers | Generous or no timing |
| CAPTCHA | Excludes many disabilities | Alternative verification |
| PDF-only content | Screen reader challenges | HTML primary, PDF optional |
| "Click here" links | Meaningless out of context | Descriptive link text |
| Skipping heading levels | Breaks navigation | Logical h1 → h2 → h3 |

---

## The Belonging Test

Before shipping any feature:

1. **Can a blind user complete this task?** (Screen reader + keyboard)
2. **Can a user with tremors complete this task?** (Keyboard, large targets)
3. **Can a deaf user understand this content?** (Captions, visual feedback)
4. **Can a user with low vision use this?** (Contrast, zoom)
5. **Can a user with cognitive differences navigate this?** (Clear language, predictable patterns)
6. **Does reduced motion preference work?** (Honor user settings)

If any answer is no → **you're excluding community members.**

---

## Living Document

Accessibility evolves. WCAG 2.2 will become 3.0. Assistive technology improves. Our understanding deepens.

Changes require:
1. Standards review (new WCAG)
2. Testing updates (new tools)
3. Component audits
4. User feedback integration

| Date | Change | Reasoning |
|------|--------|-----------|
| 2026-01-01 | Initial accessibility standards | Foundation |
| 2026-01-03 | Complete rewrite | Alignment with Mission. Reframed from compliance to belonging. Added community language, warmth philosophy, expanded testing guidance. |

---

## Summary

**Codex accessibility in one breath:**

> Everyone belongs. Accessibility isn't a checklist or compliance—it's love made visible. We design for blind creators, deaf members, users with tremors, users with cognitive differences. We exceed standards not for legal protection but because excluding anyone from our community is a betrayal of who we are.

**The test:**

> Can every person, regardless of ability, fully participate in our community?

If yes → ship it.
If no → you're leaving someone outside.

---

**Upstream**: [08. Content & Voice](../08-content-voice/README.md)
**Downstream**: [10. Theming](../10-theming/README.md)

---

*Last updated: 2026-01-03*
*Version: 2.0*
*Status: Foundation document — everyone belongs*

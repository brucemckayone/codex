# 09. Accessibility & Inclusion

**Foundational, not a checklist. Contrast, keyboard, screen readers, cognitive load.**

---

## Purpose

Accessibility is not compliance. **It's quality.**

Good design works for:
- Blind users (screen readers)
- Low vision (contrast, zoom)
- Motor impairments (keyboard, voice)
- Cognitive differences (clarity, focus)
- Temporary disabilities (broken arm, bright sunlight)

**Our standard**: WCAG 2.2 Level AAA (where possible), AA minimum.

---

## Contrast Requirements

### Text Contrast

**Minimum** (WCAG AA):
- Normal text (< 18px): 4.5:1
- Large text (≥ 18px or ≥ 14px bold): 3:1

**Our standard** (AAA):
- Normal text: 7:1
- Large text: 4.5:1

**Test with**: Contrast Checker, Stark, Who Can Use

---

### Non-Text Contrast

**UI components** (borders, icons, focus indicators):
- Minimum: 3:1 vs background

**Examples**:
- Input borders: 3:1
- Button borders: 3:1
- Icons: 3:1
- Disabled states: 2:1 (allowed to be lower contrast)

---

## Color Independence

**Never use color alone** to convey information.

### Examples

❌ **Bad**: Status indicator
```
● (red for error)
● (green for success)
```

✅ **Good**: Status with icon + text
```
⚠ Error: Upload failed (red)
✓ Success: Upload complete (green)
```

---

❌ **Bad**: Required fields
```
<label>Email</label> <!-- red text -->
```

✅ **Good**: Required indicator
```
<label>Email <span>(required)</span></label>
```

---

## Keyboard Navigation

### All Interactive Elements

**Must support**:
- `Tab`: Move forward
- `Shift + Tab`: Move backward
- `Enter`/`Space`: Activate
- `Esc`: Close modals, dismiss overlays
- Arrow keys: Navigate lists, menus, tabs

---

### Focus Indicators

**Requirement**: Visible focus ring (3:1 contrast)

```css
*:focus-visible {
  outline: 3px solid blue-300;
  outline-offset: 2px;
}
```

**Never**: `outline: none` (removes focus indicator)

**Only**: Remove outline if custom indicator provided

---

### Tab Order

**Principle**: Logical reading order (top-to-bottom, left-to-right)

**Use**:
```html
<button>First</button>
<button>Second</button>
<button>Third</button>
```

**Don't use**: `tabindex` > 0 (breaks natural order)

**Exception**: `tabindex="-1"` to remove from tab order (rare)

---

## Screen Reader Support

### Semantic HTML

**Use native elements**:

✅ **Good**:
```html
<button>Submit</button>
<nav>...</nav>
<main>...</main>
<header>...</header>
```

❌ **Bad**:
```html
<div onclick="submit()">Submit</div>
<div class="nav">...</div>
```

**Why?** Native elements have built-in ARIA roles, keyboard support

---

### ARIA Labels

**When to use**: Custom components, icon-only buttons

✅ **Good**:
```html
<button aria-label="Close modal">
  <svg>...</svg>
</button>
```

❌ **Bad**:
```html
<button>
  <svg>...</svg> <!-- no text, no label -->
</button>
```

---

### ARIA Roles

**Common roles**:
- `role="alert"` → Important messages
- `role="dialog"` → Modals
- `role="navigation"` → Navigation areas
- `role="search"` → Search forms

**Avoid**: Overusing ARIA when native HTML works

---

### Live Regions

**Purpose**: Announce dynamic changes

```html
<div aria-live="polite" aria-atomic="true">
  Upload complete
</div>
```

**`aria-live` values**:
- `polite`: Announce when user is idle
- `assertive`: Announce immediately (errors)
- `off`: Don't announce (default)

---

## Touch & Motor

### Minimum Touch Targets

**Size**: 44x44px minimum (WCAG 2.5.5)

**Our standard**: 48x48px (more forgiving)

**Example**:
```css
button {
  min-height: 48px;
  min-width: 48px;
  padding: 12px 16px;
}
```

---

### Spacing Between Targets

**Minimum**: 8px between clickable elements (avoid mis-taps)

**Our standard**: 12px

---

## Motion Sensitivity

### Reduced Motion

**Honor user preference**:

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Test with**: Enable in OS settings (macOS: Accessibility > Display > Reduce Motion)

---

### Avoid

- Parallax scrolling (vestibular issues)
- Auto-playing videos with sound
- Infinite looping animations (distracting)
- Flashing content (seizure risk: > 3 flashes/sec)

---

## Cognitive Accessibility

### Clarity

- **Simple language**: 8th-grade reading level
- **Short sentences**: < 20 words
- **Headings**: Clear hierarchy (h1 > h2 > h3)
- **Lists**: Break up long paragraphs

---

### Focus Management

**Minimize distractions**:
- One primary action per screen
- Group related items
- Hide advanced options by default (progressive disclosure)

---

### Error Prevention

- **Confirm destructive actions** (delete, revoke access)
- **Auto-save drafts** (prevent data loss)
- **Undo actions** (where possible)
- **Validate on blur** (not on every keystroke)

---

## Forms Accessibility

### Labels

**Always visible** (not placeholder-only):

✅ **Good**:
```html
<label for="email">Email</label>
<input id="email" type="email" />
```

❌ **Bad**:
```html
<input type="email" placeholder="Email" />
```

**Why?** Placeholders disappear on focus (memory burden)

---

### Error Messages

**Link errors to fields**:

```html
<label for="email">Email</label>
<input
  id="email"
  aria-invalid="true"
  aria-describedby="email-error"
/>
<p id="email-error" role="alert">
  Email is invalid. Use format: name@example.com
</p>
```

**Screen reader announces**: "Email, invalid. Email is invalid..."

---

### Required Fields

**Indicate before form submission**:

```html
<label for="title">
  Content Title
  <span aria-label="required">*</span>
</label>
```

**Or**:
```html
<label for="title">
  Content Title (required)
</label>
```

---

## Testing Checklist

### Automated Tests

- [ ] Color contrast (axe, Lighthouse)
- [ ] ARIA roles (axe DevTools)
- [ ] Alt text present (axe)
- [ ] Heading hierarchy (axe)

**Tools**:
- Lighthouse (Chrome DevTools)
- axe DevTools (browser extension)
- WAVE (web accessibility evaluation tool)

---

### Manual Tests

- [ ] Keyboard-only navigation (no mouse)
- [ ] Screen reader test (VoiceOver, NVDA, JAWS)
- [ ] Zoom to 200% (text still readable, layout intact)
- [ ] Color blindness simulation (Stark)
- [ ] Reduced motion enabled (animations respect preference)

---

### Real Users

**Best test**: Users with disabilities

- Blind users (screen readers)
- Low vision (magnification, high contrast)
- Motor impairments (keyboard, voice control)

---

## WCAG 2.2 Compliance

### Level A (Minimum)

- ✅ Keyboard accessible
- ✅ Text alternatives (alt text)
- ✅ Clear focus indicators
- ✅ Semantic HTML

### Level AA (Standard)

- ✅ 4.5:1 text contrast
- ✅ 3:1 UI component contrast
- ✅ Resizable text (200% zoom)
- ✅ No keyboard traps

### Level AAA (Goal)

- ✅ 7:1 text contrast
- ✅ 4.5:1 large text contrast
- ✅ No timing requirements
- ✅ Clear language (8th-grade level)

**Our target**: AA minimum, AAA where possible

---

## Accessibility First, Not Last

**Process**:

1. **Design**: Contrast checks, keyboard flows, focus order
2. **Build**: Semantic HTML, ARIA where needed
3. **Test**: Automated + manual + real users
4. **Iterate**: Fix issues before launch

**Not**: Build first, audit later (expensive retrofitting)

---

## Living Document

Accessibility standards evolve (WCAG 2.2 → 3.0). Updates require:

1. Standards review (new WCAG guidelines)
2. Testing updates (new tools, techniques)
3. Component audits (verify compliance)

**Change log**:

| Date | Change | Reasoning |
|------|--------|-----------|
| 2026-01-01 | Initial accessibility standards | Foundation |

---

Next: [10. Theming & Extensibility →](../10-theming/README.md)

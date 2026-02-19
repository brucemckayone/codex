# CSS Planning Agent Specification

## Domain
Design tokens, CSS custom properties, responsive design, dark mode, theming, mobile-first approach.

## Purpose
Generate implementation plans for CSS work ensuring compliance with the CSS PR review agent. Focus on design token usage, dark mode support, and responsive design patterns.

## File Patterns to Review
- `apps/web/src/**/*.svelte` - All Svelte component `<style>` blocks
- `apps/web/src/lib/styles/**/*.css` - Global styles and tokens
- `apps/web/src/lib/theme/**/*.css` - Theme definitions

## Compliance Standards (PR Review Agents)

Your plans must comply with:
- **CSS Agent**: `.claude/skills/pr-review-agent-team/agents/css.md`

**CRITICAL Rules**:
- [CRITICAL] **NO Tailwind CSS** - absolutely forbidden in the entire codebase
- [CRITICAL] **NO hardcoded values** - all colors, spacing, fonts must use CSS variables
- [CRITICAL] Use semantic tokens (`--color-primary-500`) not primitives directly
- [CRITICAL] Dark mode required for all color usage
- [CRITICAL] Mobile-first responsive design

## Checklist

### Design Token Usage (CRITICAL)

- [CRITICAL] Use `--color-primary-*` for brand colors
- [CRITICAL] Use `--color-text`, `--color-surface`, `--color-border` for neutrals
- [CRITICAL] Use semantic colors: `--color-success`, `--color-error`, `--color-warning`
- [CRITICAL] Use `--space-*` for spacing (NO hardcoded pixels)
- [CRITICAL] Use `--font-*`, `--text-*` for typography
- [WARN] Follow three-tier architecture: primitives → semantic → component
- [INFO] Document component-specific tokens with comments

### Color System (CRITICAL)

- [CRITICAL] Brand: `--color-primary-500` (terracotta #c24129)
- [CRITICAL] Neutrals: `--color-text`, `--color-surface`, `--color-border`
- [CRITICAL] Semantic: `--color-success`, `--color-error`, `--color-warning`, `--color-info`
- [WARN] Org brand override pattern: `[data-org-brand]`
- [INFO] Color tokens support light and dark themes

### Spacing System (CRITICAL)

- [CRITICAL] Use `--space-*` variables (0-8 scale, 4px base unit)
- [CRITICAL] NO hardcoded pixel values like `padding: 16px`
- [WARN] Use `--space-2` (8px) as base unit for consistency
- [INFO] Spacing scale: 0=0, 1=4px, 2=8px, 3=16px, 4=24px, 5=32px, 6=48px, 7=64px, 8=96px

### Typography (CRITICAL)

- [CRITICAL] Use `--font-sans`, `--font-mono` for font families
- [CRITICAL] Use `--text-*` for font sizes (xs, sm, base, lg, xl, 2xl, etc.)
- [CRITICAL] Use `--font-*` for weights (regular, medium, semibold, bold)
- [WARN] Line heights use `--leading-*` tokens
- [INFO] Use `clamp()` for fluid typography where appropriate

### Responsive Design (CRITICAL)

- [CRITICAL] Mobile-first approach (default = mobile)
- [CRITICAL] Use `@media (min-width: ...)` for desktop overrides
- [WARN] Must work on mobile (640px) and desktop (1024px+)
- [INFO] Breakpoints: sm=640, md=768, lg=1024, xl=1280, 2xl=1536

### Dark Mode (CRITICAL)

- [CRITICAL] Use `[data-theme="dark"]` attribute selector
- [CRITICAL] All colors must have dark mode overrides
- [WARN] Test both themes
- [INFO] Dark mode colors use same token names with different values

## Code Examples

### Correct: Design Token Usage

```css
/* ✅ CORRECT: Using design tokens */
.button {
  background: var(--color-primary-500);
  padding: var(--space-3) var(--space-4);
  font: var(--font-medium) var(--text-base);
  color: var(--color-text-on-primary);
  border-radius: var(--radius-md);
  transition: background var(--duration-fast);

  &:hover {
    background: var(--color-primary-600);
  }

  &:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
  }
}

/* Dark mode override */
[data-theme='dark'] .button {
  background: var(--color-primary-400);
  color: var(--color-text-on-primary-dark);

  &:hover {
    background: var(--color-primary-500);
  }
}
```

### Incorrect: Hardcoded Values

```css
/* ❌ CRITICAL: Hardcoded color and spacing */
.button {
  background: #c24129;
  padding: 16px 24px;
  font-weight: 500;
  font-size: 16px;
  border-radius: 8px;
}

/* ❌ CRITICAL: Tailwind CSS classes (FORBIDDEN) */
<div class="bg-blue-500 p-4 rounded-lg text-white">Content</div>
```

### Correct: Responsive Design

```css
/* ✅ CORRECT: Mobile-first with min-width queries */
.card {
  padding: var(--space-4);
  gap: var(--space-3);
}

/* Tablet overrides */
@media (min-width: 768px) {
  .card {
    padding: var(--space-5);
    gap: var(--space-4);
  }
}

/* Desktop overrides */
@media (min-width: 1024px) {
  .card {
    padding: var(--space-6);
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
}
```

### Correct: Semantic Token Usage

```css
/* ✅ CORRECT: Semantic tokens for UI states */
.status-badge {
  background: var(--color-surface-variant);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border-default);
}

.status-badge.success {
  background: var(--color-success-container);
  color: var(--color-success-on-container);
}

.status-badge.error {
  background: var(--color-error-container);
  color: var(--color-error-on-container);
}
```

## Plan Output Format

```markdown
## CSS Implementation Plan

### Applicable PR Review Agents (Compliance Standards)
- CSS Agent: `.claude/skills/pr-review-agent-team/agents/css.md`

---

## Design Token Requirements (CRITICAL)

**Color Tokens** (from `apps/web/src/lib/styles/tokens/colors.css`):
- Brand: `var(--color-primary-500)` for primary actions
- Text: `var(--color-text)` for body text
- Surfaces: `var(--color-surface)`, `var(--color-surface-variant)`
- Borders: `var(--color-border-default)`

**Spacing Tokens** (from `apps/web/src/lib/styles/tokens/spacing.css`):
- Scale: `var(--space-1)` (4px) through `var(--space-8)` (96px)
- NO hardcoded pixel values

**Typography Tokens** (from `apps/web/src/lib/styles/tokens/typography.css`):
- Fonts: `var(--font-sans)`, `var(--font-mono)`
- Sizes: `var(--text-xs)` through `var(--text-4xl)`
- Weights: `var(--font-regular)`, `var(--font-medium)`, `var(--font-bold)`

---

## Component Styles (CSS Agent Compliance)

### File: [Component path].svelte

**CSS Agent Requirements** (CRITICAL):
- NO Tailwind CSS classes
- NO hardcoded pixel values
- NO hardcoded colors
- Dark mode required

**Style Template**:
```css
.component-name {
  /* Layout */
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);

  /* Colors */
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);

  /* Typography */
  font: var(--font-regular) var(--text-base);
}

/* Dark mode */
[data-theme='dark'] .component-name {
  background: var(--color-surface-dark);
  border-color: var(--color-border-dark);
}

/* Responsive - Tablet */
@media (min-width: 768px) {
  .component-name {
    padding: var(--space-5);
  }
}

/* Responsive - Desktop */
@media (min-width: 1024px) {
  .component-name {
    flex-direction: row;
    padding: var(--space-6);
  }
}
```

**Acceptance Criteria**:
- [ ] All values use CSS variables
- [ ] Dark mode overrides included
- [ ] Mobile-first responsive
- [ ] No Tailwind classes

---

## Responsive Breakpoints

- **Mobile**: Default styles (up to 640px)
- **Tablet**: `@media (min-width: 768px)`
- **Desktop**: `@media (min-width: 1024px)`

---

## Deep Dive References
- Color tokens: `apps/web/src/lib/styles/tokens/colors.css`
- Spacing: `apps/web/src/lib/styles/tokens/spacing.css`
- Typography: `apps/web/src/lib/styles/tokens/typography.css`
- Border radius: `apps/web/src/lib/styles/tokens/radius.css`
- Example component: `apps/web/src/lib/components/ui/Button/Button.svelte`
```

## Handoff Instructions

| Finding | Send To |
|---------|---------|
| New component needs CSS | Add to plan's component section |
| Dark mode issues | Add specific dark mode overrides |
| Responsive design needed | Add breakpoints to plan |
| Org-specific theming | Note `[data-org-brand]` pattern |

## Critical File References

- `apps/web/src/lib/styles/tokens/colors.css` - Color palette definition
- `apps/web/src/lib/styles/tokens/spacing.css` - Spacing scale
- `apps/web/src/lib/styles/tokens/typography.css` - Font system
- `apps/web/src/lib/styles/tokens/radius.css` - Border radius tokens
- `apps/web/src/lib/styles/themes/default.css` - Default theme (light)
- `apps/web/src/lib/styles/themes/dark.css` - Dark theme overrides
- `apps/web/src/lib/components/ui/Button/Button.svelte` - CSS variable usage example
- `apps/web/src/app.css` - Global styles and layer imports

## Anti-Patterns to Watch For

```css
/* ❌ CRITICAL: Tailwind classes - ABSOLUTELY FORBIDDEN */
<div class="flex items-center justify-between p-4 bg-white rounded-lg">
<div class="hover:bg-gray-100 focus:ring-2 focus:ring-blue-500">

/* ❌ CRITICAL: Hardcoded pixel values */
.element {
  width: 300px;
  height: 200px;
  margin: 16px;
  padding: 8px 12px;
}

/* ❌ CRITICAL: Magic numbers */
.element {
  gap: 7px;
  border-radius: 3px;
}

/* ❌ CRITICAL: Hex colors */
.element {
  color: #333333;
  background: #ffffff;
  border: 1px solid #e0e0e0;
}

/* ❌ CRITICAL: Missing dark mode */
.element {
  background: var(--color-surface);
  /* No dark mode override */
}

/* ✅ CORRECT: All design tokens, mobile-first, dark mode ready */
.element {
  width: 100%;
  padding: var(--space-4);
  gap: var(--space-3);
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
}

@media (min-width: 768px) {
  .element {
    width: 300px; /* Fixed width on desktop */
  }
}

[data-theme='dark'] .element {
  background: var(--color-surface-dark);
  border-color: var(--color-border-dark);
}
```

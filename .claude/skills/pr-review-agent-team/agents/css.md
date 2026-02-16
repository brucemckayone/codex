# CSS Agent Specification

## Domain
Design tokens, CSS custom properties, responsive design, dark mode, theming, modern CSS features.

**CRITICAL RULE**: Tailwind CSS is **absolutely forbidden** in this codebase.

## File Patterns to Review
- `apps/web/src/lib/styles/**/*.css`
- `apps/web/src/**/*.svelte` (all `<style>` blocks)
- `apps/web/src/lib/theme/**/*.css`

## Checklist

### CSS Variables Only (CRITICAL - Blocking Violation)

**CRITICAL** = Blocking issue, **WARN** = Should fix, **INFO** = Suggestion

- [CRITICAL] **NO Tailwind CSS classes** - absolutely forbidden in the entire codebase
- [CRITICAL] **NO hardcoded values** - all colors, spacing, fonts must use CSS variables
- [CRITICAL] Use semantic tokens (`--color-primary-500`) not primitives directly
- [WARN] Follow three-tier architecture: primitives → semantic → component
- [INFO] Document component-specific tokens with comments

### Color System

- [CRITICAL] Use `--color-primary-*` for brand colors (terracotta #c24129)
- [CRITICAL] Use `--color-text`, `--color-surface`, `--color-border` for neutrals
- [CRITICAL] Use semantic colors: `--color-success`, `--color-error`, `--color-warning`, `--color-info`
- [WARN] Use org brand override pattern: `[data-org-brand]` for multi-tenancy
- [INFO] Color tokens support both light and dark themes

### Spacing System

- [CRITICAL] Use `--space-*` variables (0-8 scale, 4px base unit)
- [CRITICAL] NO hardcoded pixel values like `padding: 16px`
- [WARN] Use `--space-2` (8px) as base unit for consistency
- [INFO] Spacing scale: 0=0, 1=4px, 2=8px, 3=16px, 4=24px, 5=32px, 6=48px, 7=64px, 8=96px

### Typography

- [CRITICAL] Use `--font-sans`, `--font-mono` for font families
- [CRITICAL] Use `--text-*` for font sizes (xs, sm, base, lg, xl, 2xl, etc.)
- [CRITICAL] Use `--font-*` for weights (regular, medium, semibold, bold)
- [WARN] Line heights use `--leading-*` tokens
- [INFO] Use `clamp()` for fluid typography where appropriate

### Responsive Design

- [CRITICAL] Mobile-first approach (default = mobile, `@media (min-width: ...)` for desktop)
- [WARN] Must work on mobile (640px) and desktop (1024px+)
- [INFO] Breakpoints: sm=640, md=768, lg=1024, xl=1280, 2xl=1536
- [INFO] Use container queries for component-level responsiveness

### Dark Mode

- [CRITICAL] Use `[data-theme="dark"]` attribute selector
- [CRITICAL] All colors must have dark mode overrides
- [WARN] Test both themes
- [INFO] Dark mode colors use same token names with different values

### Modern CSS Features

- [INFO] Use `clamp()` for fluid typography
- [INFO] Use `container-type` and `container-query()` where appropriate
- [INFO] Use CSS cascade layers (`@layer`) for organization
- [INFO] Prefer CSS Grid over Flexbox for 2D layouts

### CSS Organization

- [WARN] Use `@layer` for cascade layers (base, tokens, components, utilities)
- [WARN] Import order: primitives → tokens → components → utilities
- [INFO] Group related styles with comments
- [INFO] Use BEM-ish naming for component-specific classes

## Code Examples

### Correct: CSS Variables
```css
/* apps/web/src/lib/components/ui/Button/Button.svelte */
<style>
  .button {
    /* ✅ CORRECT: Using design tokens */
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
</style>
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

/* Desktop overrides */
@media (min-width: 1024px) {
  .card {
    padding: var(--space-6);
    gap: var(--space-4);
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

### Incorrect: Direct Color Values
```css
/* ❌ CRITICAL: Direct color values */
.button {
  background: #c24129;
  border: 1px solid #e5e7eb;
}

/* ❌ CRITICAL: Missing dark mode */
.button {
  background: var(--color-primary-500);
  /* No dark mode override - won't work in dark theme */
}
```

### Correct: Component Tokens
```css
/* ✅ CORRECT: Component-specific tokens */
@layer tokens {
  :root {
    /* Button-specific tokens derived from design system */
    --button-padding-x: var(--space-4);
    --button-padding-y: var(--space-3);
    --button-radius: var(--radius-md);
    --button-font-weight: var(--font-medium);
  }
}

@layer components {
  .button {
    padding: var(--button-padding-y) var(--button-padding-x);
    border-radius: var(--button-radius);
    font-weight: var(--button-font-weight);
  }
}
```

## Handoff Instructions

| Finding | Send To |
|---------|---------|
| CSS in JavaScript/TypeScript files | `component-reviewer` |
| Missing responsive breakpoints | `component-reviewer` |
| Dark mode issues in components | `component-reviewer` |
| Tailwind usage (major violation) | `coordinator` (blocking) |

## Critical File References

- `apps/web/src/lib/styles/tokens/colors.css` - Color palette definition
- `apps/web/src/lib/styles/tokens/spacing.css` - Spacing scale
- `apps/web/src/lib/styles/tokens/typography.css` - Font system
- `apps/web/src/lib/styles/tokens/radius.css` - Border radius tokens
- `apps/web/src/lib/styles/themes/default.css` - Default theme (light)
- `apps/web/src/lib/styles/themes/dark.css` - Dark theme overrides
- `apps/web/src/lib/components/ui/Button/Button.svelte` - CSS variable usage example
- `apps/web/src/lib/components/ui/Input/Input.svelte` - Form input styling
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

/* ❌ WARN: Missing dark mode */
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

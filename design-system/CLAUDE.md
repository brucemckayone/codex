# Design System Agent Controls

**Building belonging, one component at a time.**

This document provides structured instructions for AI agents producing components from the Codex Design System.

---

## Quick Reference Links

| Document | Purpose | When to Reference |
|----------|---------|-------------------|
| [00-mission](./00-mission/README.md) | Core values | Every component decision |
| [01-philosophy](./01-philosophy/README.md) | Design principles | Before starting any component |
| [02-visual-language](./02-visual-language/README.md) | Aesthetic rules | Visual design decisions |
| [03-color](./03-color/README.md) | Color system | Any color usage |
| [04-typography](./04-typography/README.md) | Type system | Text styling |
| [05-spacing-layout](./05-spacing-layout/README.md) | Spacing rules | Padding, margins, gaps |
| [06-components](./06-components/README.md) | Component patterns | Architecture decisions |
| [07-interaction-motion](./07-interaction-motion/README.md) | Animation | Hover, transitions, feedback |
| [08-content-voice](./08-content-voice/README.md) | Copy guidelines | Labels, messages, microcopy |
| [09-accessibility](./09-accessibility/README.md) | A11y requirements | Every component (mandatory) |
| [10-theming](./10-theming/README.md) | Theme support | Dark mode, customization |
| [11-engineering](./11-engineering/README.md) | Code standards | Implementation |
| [12-governance](./12-governance/README.md) | Review process | Before PR submission |
| [13-documentation](./13-documentation/README.md) | Doc standards | Writing component docs |
| [tokens](./tokens/README.md) | Design tokens | All CSS values |

---

## Component Production Workflow

### Phase 1: Philosophy Alignment

**Before writing any code, verify:**

```
□ Component supports belonging (not transactional)
□ Use case requires community language
□ Visual design expresses warmth
□ Accessibility is planned from start
```

**Questions to answer:**
1. What community need does this component serve?
2. How does it make members feel welcomed?
3. Does it use "member/join/library" language?

---

### Phase 2: Design Token Setup

**Create/verify CSS custom properties:**

```css
/* Core tokens - MUST use these values */
:root {
  /* Colors - Warmth First */
  --color-cream-50: #FEFDFB;
  --color-cream-100: #FAF8F5;
  --color-cream-200: #F5F0E8;
  --color-cream-300: #E8E0D4;
  --color-cream-400: #D4C8B8;
  --color-cream-500: #B8A898;
  --color-cream-600: #968474;
  --color-cream-700: #746454;
  --color-cream-800: #524840;
  --color-cream-900: #1C1917;
  --color-cream-950: #0F0E0D;

  /* Primary - Teal */
  --color-teal-50: #F0FDFA;
  --color-teal-100: #CCFBF1;
  --color-teal-200: #99F6E4;
  --color-teal-300: #5EEAD4;
  --color-teal-400: #2DD4BF;
  --color-teal-500: #14B8A6;
  --color-teal-600: #0D9488;
  --color-teal-700: #0F766E;
  --color-teal-800: #115E59;
  --color-teal-900: #134E4A;

  /* Accent - Coral (celebrations) */
  --color-coral-400: #FB923C;
  --color-coral-500: #F97316;
  --color-coral-600: #EA580C;

  /* Semantic */
  --color-surface: var(--color-cream-50);
  --color-surface-elevated: var(--color-cream-100);
  --color-surface-sunken: var(--color-cream-200);
  --color-text-primary: var(--color-cream-900);
  --color-text-secondary: var(--color-cream-600);
  --color-text-muted: var(--color-cream-500);
  --color-action-primary: var(--color-teal-500);
  --color-action-primary-hover: var(--color-teal-600);
  --color-focus-ring: var(--color-teal-300);
  --color-border: var(--color-cream-300);
  --color-border-subtle: var(--color-cream-200);

  /* Typography */
  --font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;
  --font-size-2xl: 1.5rem;
  --font-size-3xl: 1.875rem;
  --font-size-4xl: 2.25rem;
  --line-height-tight: 1.25;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.625;
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Spacing - 4px base */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;
  --space-16: 4rem;

  /* Radii - Human touch */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;

  /* Shadows - Warm (brown-tinted, not gray) */
  --shadow-sm: 0 1px 2px rgba(45, 42, 37, 0.06);
  --shadow-md: 0 4px 6px rgba(45, 42, 37, 0.08);
  --shadow-lg: 0 10px 15px rgba(45, 42, 37, 0.1);
  --shadow-xl: 0 20px 25px rgba(45, 42, 37, 0.12);

  /* Motion - Smooth, confident */
  --duration-fast: 150ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;
  --easing-default: cubic-bezier(0.4, 0, 0.2, 1);
  --easing-in: cubic-bezier(0.4, 0, 1, 1);
  --easing-out: cubic-bezier(0, 0, 0.2, 1);

  /* Focus */
  --focus-ring: 0 0 0 3px var(--color-focus-ring);
}

/* Dark mode - Warm dark, not cold */
[data-theme="dark"] {
  --color-surface: var(--color-cream-950);
  --color-surface-elevated: var(--color-cream-900);
  --color-surface-sunken: #0A0908;
  --color-text-primary: var(--color-cream-100);
  --color-text-secondary: var(--color-cream-400);
  --color-text-muted: var(--color-cream-500);
  --color-border: var(--color-cream-800);
  --color-border-subtle: var(--color-cream-900);
}
```

---

### Phase 3: Component Implementation

**For each component, follow this checklist:**

#### 3.1 Structure

```svelte
<script lang="ts">
  // 1. Type imports
  import type { Snippet } from 'svelte';

  // 2. Props interface (descriptive names)
  interface Props {
    variant?: 'primary' | 'secondary' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    children: Snippet;
    // ... component-specific props
  }

  // 3. Props with defaults
  let {
    variant = 'primary',
    size = 'md',
    disabled = false,
    children,
    ...rest
  }: Props = $props();
</script>

<!-- 4. Semantic HTML with accessibility -->
<button
  class="button button--{variant} button--{size}"
  {disabled}
  aria-disabled={disabled}
  {...rest}
>
  {@render children()}
</button>

<style>
  /* 5. Styles using tokens */
  .button {
    font-family: var(--font-family);
    border-radius: var(--radius-md);
    transition: all var(--duration-fast) var(--easing-default);
  }

  .button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
```

#### 3.2 Required States

Every interactive component MUST have:

| State | CSS | Notes |
|-------|-----|-------|
| Default | Base styles | Warm, welcoming |
| Hover | `:hover` | Subtle lift or color shift |
| Focus | `:focus-visible` | 3px teal ring, MANDATORY |
| Active | `:active` | Pressed feedback |
| Disabled | `[disabled]`, `[aria-disabled]` | 50% opacity, no pointer |
| Loading | `.loading` state | Skeleton or spinner |

#### 3.3 Accessibility Requirements

**Non-negotiable for every component:**

```
□ Keyboard navigable (Tab, Enter, Space, Escape, Arrows)
□ Focus visible (3px teal-300 ring)
□ Screen reader announced (proper ARIA)
□ Color not only indicator
□ Touch targets 44px minimum
□ Reduced motion respected
```

**ARIA checklist:**
- `aria-label` for icon-only buttons
- `aria-expanded` for collapsibles
- `aria-pressed` for toggles
- `aria-describedby` for error messages
- `role` when semantic HTML insufficient

---

### Phase 4: Variants & Sizes

**Standard variant pattern:**

```css
/* Primary - Main CTA (one per screen) */
.button--primary {
  background: var(--color-action-primary);
  color: white;
}
.button--primary:hover {
  background: var(--color-action-primary-hover);
}

/* Secondary - Supporting actions */
.button--secondary {
  background: transparent;
  color: var(--color-action-primary);
  border: 1px solid var(--color-action-primary);
}

/* Ghost - Tertiary actions */
.button--ghost {
  background: transparent;
  color: var(--color-text-secondary);
}
.button--ghost:hover {
  background: var(--color-surface-elevated);
}
```

**Standard size pattern:**

```css
.button--sm {
  padding: var(--space-2) var(--space-3);
  font-size: var(--font-size-sm);
  min-height: 32px;
}
.button--md {
  padding: var(--space-3) var(--space-4);
  font-size: var(--font-size-base);
  min-height: 40px;
}
.button--lg {
  padding: var(--space-4) var(--space-6);
  font-size: var(--font-size-lg);
  min-height: 48px;
}
```

---

### Phase 5: Community Language

**Before finalizing, replace any transactional language:**

| Wrong | Right |
|-------|-------|
| "Buy now" | "Get access" or "Join" |
| "Purchase" | "Become a member" |
| "Cart" | "Library" |
| "Customer" | "Member" |
| "Subscribe" | "Join the community" |
| "Checkout" | "Complete your journey" |
| "Product" | "Content" or "Offering" |
| "Add to cart" | "Add to library" |

---

### Phase 6: Documentation

**Every component needs:**

1. **README.md** following template in [13-documentation](./13-documentation/README.md)
2. **Storybook stories** with all variants/states
3. **Accessibility notes** in README

**README template:**
```markdown
# ComponentName

**Brief description using community language.**

## Philosophy
Why this component exists. What belonging need it serves.

## When to Use
- ✅ Use case 1
- ✅ Use case 2

## When NOT to Use
- ❌ Anti-use case 1

## Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|

## Accessibility
- Keyboard: [interactions]
- Screen reader: [announcements]
- Focus: [ring behavior]

## Examples
[Code examples with community language]
```

---

### Phase 7: Final Checklist

**Before marking component complete:**

```
Philosophy Alignment
□ Supports belonging
□ Uses community language
□ Expresses warmth (cream/teal, not gray/blue)

Visual Design
□ Uses design tokens (no hardcoded values)
□ Warm shadows (brown-tinted)
□ Rounded corners (8px default)
□ Proper spacing rhythm

Accessibility
□ Keyboard navigation works
□ Focus ring visible (3px teal)
□ Screen reader tested
□ Touch targets 44px+
□ Reduced motion supported

States
□ Default state
□ Hover state
□ Focus state
□ Active state
□ Disabled state
□ Loading state (if applicable)

Dark Mode
□ Works in dark theme
□ Warm dark (cream-950, not cool gray)

Documentation
□ README complete
□ All props documented
□ Examples use community language
□ Accessibility notes included

Code Quality
□ TypeScript strict mode
□ No any types
□ Props have defaults
□ Clean, readable code
```

---

## Component Templates

### Button Component

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    loading?: boolean;
    children: Snippet;
  }

  let {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    children,
    ...rest
  }: Props = $props();
</script>

<button
  class="btn btn--{variant} btn--{size}"
  class:btn--loading={loading}
  disabled={disabled || loading}
  aria-disabled={disabled || loading}
  aria-busy={loading}
  {...rest}
>
  {#if loading}
    <span class="btn__spinner" aria-hidden="true"></span>
  {/if}
  <span class="btn__content" class:sr-only={loading}>
    {@render children()}
  </span>
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    font-family: var(--font-family);
    font-weight: var(--font-weight-medium);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--duration-fast) var(--easing-default);
  }

  .btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Variants */
  .btn--primary {
    background: var(--color-action-primary);
    color: white;
  }
  .btn--primary:hover:not(:disabled) {
    background: var(--color-action-primary-hover);
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }

  .btn--secondary {
    background: transparent;
    color: var(--color-action-primary);
    border: 1px solid var(--color-action-primary);
  }
  .btn--secondary:hover:not(:disabled) {
    background: var(--color-teal-50);
  }

  .btn--ghost {
    background: transparent;
    color: var(--color-text-secondary);
  }
  .btn--ghost:hover:not(:disabled) {
    background: var(--color-surface-elevated);
    color: var(--color-text-primary);
  }

  /* Sizes */
  .btn--sm {
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-size-sm);
    min-height: 32px;
  }
  .btn--md {
    padding: var(--space-3) var(--space-4);
    font-size: var(--font-size-base);
    min-height: 40px;
  }
  .btn--lg {
    padding: var(--space-4) var(--space-6);
    font-size: var(--font-size-lg);
    min-height: 48px;
  }

  /* Loading */
  .btn__spinner {
    width: 1em;
    height: 1em;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: var(--radius-full);
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
```

### Card Component

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'default' | 'elevated' | 'outlined';
    padding?: 'none' | 'sm' | 'md' | 'lg';
    interactive?: boolean;
    children: Snippet;
  }

  let {
    variant = 'default',
    padding = 'md',
    interactive = false,
    children,
    ...rest
  }: Props = $props();
</script>

<article
  class="card card--{variant} card--padding-{padding}"
  class:card--interactive={interactive}
  tabindex={interactive ? 0 : undefined}
  role={interactive ? 'button' : undefined}
  {...rest}
>
  {@render children()}
</article>

<style>
  .card {
    background: var(--color-surface-elevated);
    border-radius: var(--radius-lg);
    transition: all var(--duration-fast) var(--easing-default);
  }

  /* Variants */
  .card--default {
    box-shadow: var(--shadow-sm);
  }
  .card--elevated {
    box-shadow: var(--shadow-md);
  }
  .card--outlined {
    box-shadow: none;
    border: 1px solid var(--color-border);
  }

  /* Padding */
  .card--padding-none { padding: 0; }
  .card--padding-sm { padding: var(--space-3); }
  .card--padding-md { padding: var(--space-4); }
  .card--padding-lg { padding: var(--space-6); }

  /* Interactive */
  .card--interactive {
    cursor: pointer;
  }
  .card--interactive:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-lg);
  }
  .card--interactive:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring), var(--shadow-md);
  }
</style>
```

---

## Iteration Process

When building multiple components:

```
1. Start with primitives (Button, Input, Badge)
      ↓
2. Build compounds (Card, Modal, Dropdown)
      ↓
3. Create patterns (ContentCard, JourneyCard, CreatorCard)
      ↓
4. Assemble templates (Dashboard, Browse, Profile)
```

**For each component:**
1. Read relevant design system docs
2. Create component file
3. Implement base structure
4. Add all states and variants
5. Test accessibility
6. Test dark mode
7. Write documentation
8. Submit for review

---

## Common Mistakes to Avoid

| Mistake | Why It's Wrong | What Instead |
|---------|----------------|--------------|
| Using `#gray-xxx` | Cold, corporate | Use `cream-xxx` |
| Blue primary color | Generic SaaS | Use teal |
| "Buy now" buttons | Transactional | "Join" or "Get access" |
| Cool shadows | Cold feeling | Brown-tinted rgba(45,42,37,x) |
| Skipping focus states | Excludes keyboard users | Always add `:focus-visible` |
| Hardcoded colors | Breaks theming | Use CSS variables |
| `outline: none` without replacement | Accessibility violation | Use `box-shadow: var(--focus-ring)` |

---

## The Warmth Test

Before completing any component:

> Does this component feel like it belongs in a welcoming creative studio, or a corporate spreadsheet?

If studio → ship it.
If spreadsheet → warm it up.

---

*Last updated: 2026-01-04*
*Version: 1.0*
*Status: Agent control document — building belonging*

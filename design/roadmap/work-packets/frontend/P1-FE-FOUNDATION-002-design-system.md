# P1-FE-FOUNDATION-002: Design System

**Priority**: P1
**Status**: 🚧 Not Started
**Estimated Effort**: 5-7 days
**Beads Task**: Codex-vw8.2

---

## Table of Contents

- [Overview](#overview)
- [System Context](#system-context)
- [Token Architecture](#token-architecture)
- [Component Library](#component-library)
- [Storybook Setup](#storybook-setup)
- [Accessibility Patterns](#accessibility-patterns)
- [Visual Testing](#visual-testing)
- [Dependencies](#dependencies)
- [Implementation Checklist](#implementation-checklist)
- [Testing Strategy](#testing-strategy)

---

## Overview

This work packet establishes the visual foundation and component library for the Codex platform. It defines a CSS custom properties (tokens) based design system, integrates Storybook for component development, and sets up visual regression testing with Playwright.

The design system follows a **warmth-first** aesthetic with terracotta as the primary accent, supporting light/dark modes and organization-level branding overrides. All components are built on top of Melt UI primitives for accessibility compliance.

Key principles:
- **Vanilla CSS** with custom properties (no Tailwind, no CSS-in-JS)
- **Melt UI Next-Gen** for accessible headless primitives
- **Storybook** as component workbench and documentation
- **Visual regression testing** to catch CSS regressions
- **WCAG 2.1 AA compliance** from Day 1

---

## System Context

### Upstream Dependencies

| System | What We Consume |
|--------|-----------------|
| **P1-FE-FOUNDATION-001** | Project scaffold, build configuration |
| **Melt UI Next-Gen** | Headless accessible primitives |

### Downstream Consumers

| System | What We Provide |
|--------|-----------------|
| **All frontend work packets** | Token system, component library |
| **Organization theming** | Brand color injection via CSS variables |

### Integration Flow

```
Design Tokens (CSS Custom Properties)
    ↓
Global Styles (reset, typography, layout)
    ↓
Primitive Components (Button, Input, Card)
    ↓
Pattern Components (Header, ContentCard, Toast)
    ↓
Page Layouts
```

---

## Token Architecture

### File Structure

```
src/lib/styles/
├── tokens/
│   ├── colors.css         # Color palette & semantic colors
│   ├── typography.css     # Font stacks, sizes, weights
│   ├── spacing.css        # Spacing scale
│   ├── radius.css         # Border radius values
│   ├── shadows.css        # Elevation system
│   ├── motion.css         # Transition durations & easings
│   ├── z-index.css        # Stacking context
│   └── materials.css      # Texture and glass tokens
│
├── global.css             # Reset, base styles, imports all tokens
├── utilities.css          # Common utility classes
└── themes/
    ├── light.css          # Light mode overrides
    └── dark.css           # Dark mode overrides
```

### Color Tokens

```css
/* colors.css */
:root {
  /* Brand Palette - Warmth First */
  --color-primary-50: #fef2f0;
  --color-primary-100: #fde4df;
  --color-primary-200: #fccac0;
  --color-primary-300: #f9a997;
  --color-primary-400: #f47d67;
  --color-primary-500: #e85a3f;   /* Terracotta primary */
  --color-primary-600: #d54429;
  --color-primary-700: #b23720;
  --color-primary-800: #932f1e;
  --color-primary-900: #792b1e;

  /* Neutral Palette */
  --color-neutral-50: #fafafa;
  --color-neutral-100: #f5f5f5;
  --color-neutral-200: #e5e5e5;
  --color-neutral-300: #d4d4d4;
  --color-neutral-400: #a3a3a3;
  --color-neutral-500: #737373;
  --color-neutral-600: #525252;
  --color-neutral-700: #404040;
  --color-neutral-800: #262626;
  --color-neutral-900: #171717;

  /* Semantic Colors */
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-error: #ef4444;
  --color-info: #3b82f6;

  /* Surface Colors (Light Mode Default) */
  --color-background: var(--color-neutral-50);
  --color-surface: #ffffff;
  --color-surface-secondary: var(--color-neutral-100);
  --color-surface-elevated: #ffffff;

  /* Text Colors */
  --color-text: var(--color-neutral-900);
  --color-text-secondary: var(--color-neutral-600);
  --color-text-muted: var(--color-neutral-400);
  --color-text-inverse: #ffffff;

  /* Border Colors */
  --color-border: var(--color-neutral-200);
  --color-border-focus: var(--color-primary-500);
}

/* Dark Mode */
[data-theme="dark"] {
  --color-background: var(--color-neutral-900);
  --color-surface: var(--color-neutral-800);
  --color-surface-secondary: var(--color-neutral-700);
  --color-surface-elevated: var(--color-neutral-700);

  --color-text: var(--color-neutral-50);
  --color-text-secondary: var(--color-neutral-300);
  --color-text-muted: var(--color-neutral-500);

  --color-border: var(--color-neutral-700);
}

/* Organization Brand Override Pattern */
[data-org-brand] {
  /* Colors */
  --color-primary-500: var(--org-brand-primary, #e85a3f);
  --color-primary-600: var(--org-brand-primary-dark, #d54429);

  /* Typography */
  --brand-font-body: var(--org-brand-font-body, 'Inter');
  --brand-font-heading: var(--org-brand-font-heading, 'Inter');

  /* Shape */
  --brand-radius-base: var(--org-brand-radius, 0.5rem);

  /* Density (0.875 = compact, 1 = normal, 1.125 = spacious) */
  --brand-density-scale: var(--org-brand-density, 1);
}
```

### Typography Tokens

```css
/* typography.css */
:root {
  /* Brand-Configurable Font Stacks */
  --font-sans: var(--brand-font-body, 'Inter'), 'Inter-fallback', system-ui, -apple-system, sans-serif;
  --font-heading: var(--brand-font-heading, 'Inter'), 'Inter-fallback', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  /* Font Sizes (clamp for fluid typography) */
  --text-xs: clamp(0.75rem, 0.7rem + 0.25vw, 0.8125rem);
  --text-sm: clamp(0.875rem, 0.8rem + 0.375vw, 0.9375rem);
  --text-base: clamp(1rem, 0.9rem + 0.5vw, 1.0625rem);
  --text-lg: clamp(1.125rem, 1rem + 0.625vw, 1.25rem);
  --text-xl: clamp(1.25rem, 1.1rem + 0.75vw, 1.5rem);
  --text-2xl: clamp(1.5rem, 1.3rem + 1vw, 1.875rem);
  --text-3xl: clamp(1.875rem, 1.5rem + 1.875vw, 2.5rem);
  --text-4xl: clamp(2.25rem, 1.8rem + 2.25vw, 3rem);

  /* Font Weights */
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;

  /* Line Heights */
  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;

  /* Letter Spacing */
  --tracking-tight: -0.025em;
  --tracking-normal: 0;
  --tracking-wide: 0.025em;
}

/* Size-Adjusted Fallback Font (CLS Prevention) */
@font-face {
  font-family: 'Inter-fallback';
  src: local('Arial');
  ascent-override: 90%;
  descent-override: 22%;
  line-gap-override: 0%;
  size-adjust: 107%;
}
```

### Spacing Tokens

```css
/* spacing.css */
:root {
  /* Base Unit (multiplied by density scale) */
  --space-unit: calc(0.25rem * var(--brand-density-scale, 1));

  --space-0: 0;
  --space-1: var(--space-unit);         /* 4px * density */
  --space-2: calc(var(--space-unit) * 2); /* 8px * density */
  --space-3: calc(var(--space-unit) * 3); /* 12px * density */
  --space-4: calc(var(--space-unit) * 4); /* 16px * density */
  --space-5: calc(var(--space-unit) * 5); /* 20px * density */
  --space-6: calc(var(--space-unit) * 6); /* 24px * density */
  --space-8: calc(var(--space-unit) * 8); /* 32px * density */
  --space-10: calc(var(--space-unit) * 10); /* 40px * density */
  --space-12: calc(var(--space-unit) * 12); /* 48px * density */
  --space-16: calc(var(--space-unit) * 16); /* 64px * density */
  --space-20: calc(var(--space-unit) * 20); /* 80px * density */
  --space-24: calc(var(--space-unit) * 24); /* 96px * density */
}

### Radius Tokens

```css
/* radius.css */
:root {
  /* Configurable base radius (0rem = sharp, 0.5rem = balanced, 1rem = playful) */
  --radius-base: var(--brand-radius-base, 0.5rem);

  --radius-none: 0;
  --radius-xs: calc(var(--radius-base) * 0.25);
  --radius-sm: calc(var(--radius-base) * 0.5);
  --radius-md: var(--radius-base);
  --radius-lg: calc(var(--radius-base) * 1.5);
  --radius-xl: calc(var(--radius-base) * 2);
  --radius-full: 9999px;
}
```

### Motion Tokens

```css
/* motion.css */
:root {
  /* Durations */
  --duration-fast: 100ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;
  --duration-slower: 500ms;

  /* Easings */
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* Standard Transitions */
  --transition-colors: color var(--duration-fast) var(--ease-default),
                       background-color var(--duration-fast) var(--ease-default),
                       border-color var(--duration-fast) var(--ease-default);
  --transition-transform: transform var(--duration-normal) var(--ease-out);
  --transition-opacity: opacity var(--duration-normal) var(--ease-default);
  --transition-shadow: box-shadow var(--duration-normal) var(--ease-default);
}

/* Reduced Motion Support */
@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-fast: 0.01ms;
    --duration-normal: 0.01ms;
    --duration-slow: 0.01ms;
    --duration-slower: 0.01ms;
  }

  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Component Library

### Phase 1 Component List

| Category | Component | Priority | Notes |
|----------|-----------|----------|-------|
| **Primitives** | Button | High | Primary, secondary, ghost, destructive variants |
| | Input | High | Text, email, password, error states |
| | TextArea | High | Auto-resize, character count |
| | Select | High | Melt UI Select primitive |
| | Checkbox | Medium | With labels |
| | Switch | Medium | Toggle control |
| **Display** | Badge | High | Status indicators |
| | Avatar | High | Image with fallback initials |
| | Skeleton | High | Content-aware loading |
| | Card | High | Elevated container |
| **Feedback** | Toast | High | Global toast system |
| | ErrorBanner | High | Page-level errors |
| | ConfirmDialog | High | Action confirmation |
| **Layout** | PageContainer | High | Max-width, padding |
| | Stack | Medium | Vertical spacing |
| | Cluster | Medium | Horizontal wrapping |

### Component Structure Pattern

```
src/lib/components/
├── ui/
│   ├── Button/
│   │   ├── Button.svelte
│   │   ├── Button.stories.svelte
│   │   └── index.ts
│   ├── Input/
│   ├── Card/
│   └── ...
├── feedback/
│   ├── Toast/
│   ├── ErrorBanner/
│   └── ConfirmDialog/
└── layout/
    ├── PageContainer/
    ├── Stack/
    └── Cluster/
```

### Button Component Example

```svelte
<!-- src/lib/components/ui/Button/Button.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    loading?: boolean;
    children: Snippet;
  }

  let {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    children,
    ...restProps
  }: Props = $props();
</script>

<button
  class="button"
  data-variant={variant}
  data-size={size}
  disabled={disabled || loading}
  aria-busy={loading}
  {...restProps}
>
  {#if loading}
    <span class="button-spinner" aria-hidden="true"></span>
  {/if}
  <span class="button-content" class:invisible={loading}>
    {@render children()}
  </span>
</button>

<style>
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    font-family: var(--font-sans);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    transition: var(--transition-colors), var(--transition-shadow);
    cursor: pointer;
    white-space: nowrap;
    position: relative;
  }

  .button:focus-visible {
    outline: 2px solid var(--color-border-focus);
    outline-offset: 2px;
  }

  .button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Size variants */
  .button[data-size="xs"] {
    height: 1.75rem;
    padding-inline: var(--space-2);
    font-size: var(--text-xs);
  }

  .button[data-size="sm"] {
    height: 2rem;
    padding-inline: var(--space-3);
    font-size: var(--text-sm);
  }

  .button[data-size="md"] {
    height: 2.5rem;
    padding-inline: var(--space-4);
    font-size: var(--text-base);
  }

  .button[data-size="lg"] {
    height: 2.75rem;
    padding-inline: var(--space-5);
    font-size: var(--text-lg);
  }

  .button[data-size="xl"] {
    height: 3rem;
    padding-inline: var(--space-6);
    font-size: var(--text-lg);
  }

  /* Variant: Primary */
  .button[data-variant="primary"] {
    background-color: var(--color-primary-500);
    color: var(--color-text-inverse);
    border: none;
  }

  .button[data-variant="primary"]:hover:not(:disabled) {
    background-color: var(--color-primary-600);
  }

  /* Variant: Secondary */
  .button[data-variant="secondary"] {
    background-color: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
  }

  .button[data-variant="secondary"]:hover:not(:disabled) {
    background-color: var(--color-surface-secondary);
  }

  /* Variant: Ghost */
  .button[data-variant="ghost"] {
    background-color: transparent;
    color: var(--color-text);
    border: none;
  }

  .button[data-variant="ghost"]:hover:not(:disabled) {
    background-color: var(--color-surface-secondary);
  }

  /* Variant: Destructive */
  .button[data-variant="destructive"] {
    background-color: var(--color-error);
    color: var(--color-text-inverse);
    border: none;
  }

  .button[data-variant="destructive"]:hover:not(:disabled) {
    background-color: #dc2626;
  }

  /* Loading spinner */
  .button-spinner {
    position: absolute;
    width: 1em;
    height: 1em;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  .invisible {
    visibility: hidden;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
```

---

## Storybook Setup

### Configuration

```typescript
// .storybook/main.ts
import type { StorybookConfig } from '@storybook/sveltekit';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|ts|svelte)'],
  framework: '@storybook/sveltekit',
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-a11y',
    '@storybook/addon-svelte-csf'
  ],
  docs: {
    autodocs: 'tag'
  }
};

export default config;
```

```typescript
// .storybook/preview.ts
import '../src/lib/styles/global.css';

export const parameters = {
  backgrounds: {
    default: 'light',
    values: [
      { name: 'light', value: '#fafafa' },
      { name: 'dark', value: '#171717' }
    ]
  },
  sveltekit_experimental: {
    stores: {
      page: { url: new URL('https://revelations.studio'), params: {} },
      navigating: null
    }
  }
};
```

### Story Format (Svelte 5)

```svelte
<!-- src/lib/components/ui/Button/Button.stories.svelte -->
<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Button from './Button.svelte';

  const { Story } = defineMeta({
    title: 'UI/Button',
    component: Button,
    tags: ['autodocs'],
    argTypes: {
      variant: {
        control: 'select',
        options: ['primary', 'secondary', 'ghost', 'destructive']
      },
      size: {
        control: 'select',
        options: ['xs', 'sm', 'md', 'lg', 'xl']
      }
    }
  });
</script>

<Story name="Primary">
  <Button variant="primary">Primary Button</Button>
</Story>

<Story name="Secondary">
  <Button variant="secondary">Secondary Button</Button>
</Story>

<Story name="Ghost">
  <Button variant="ghost">Ghost Button</Button>
</Story>

<Story name="Destructive">
  <Button variant="destructive">Delete</Button>
</Story>

<Story name="Loading">
  <Button loading>Saving...</Button>
</Story>

<Story name="Disabled">
  <Button disabled>Disabled</Button>
</Story>

<Story name="All Sizes">
  <div style="display: flex; gap: 8px; align-items: center;">
    <Button size="xs">XS</Button>
    <Button size="sm">SM</Button>
    <Button size="md">MD</Button>
    <Button size="lg">LG</Button>
    <Button size="xl">XL</Button>
  </div>
</Story>
```

---

## Accessibility Patterns

### Focus Management

```svelte
<!-- Skip link in root layout -->
<a href="#main-content" class="skip-link">
  Skip to content
</a>

<Header />

<main id="main-content">
  {@render children()}
</main>

<style>
  .skip-link {
    position: absolute;
    top: -100%;
    left: 0;
    padding: var(--space-2) var(--space-4);
    background: var(--color-surface);
    z-index: var(--z-toast);
  }

  .skip-link:focus {
    top: 0;
  }
</style>
```

### Error Boundary

```svelte
<!-- src/lib/components/ErrorBoundary.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    children: Snippet;
    fallback?: Snippet<[Error]>;
  }

  let { children, fallback }: Props = $props();
  let error = $state<Error | null>(null);

  function handleError(e: Error) {
    error = e;
    console.error('[ErrorBoundary]', e);
  }
</script>

{#if error}
  {#if fallback}
    {@render fallback(error)}
  {:else}
    <div class="error-boundary" role="alert">
      <h2>{m.common_error()}</h2>
      <button onclick={() => error = null}>
        {m.common_retry()}
      </button>
    </div>
  {/if}
{:else}
  <svelte:boundary onerror={handleError}>
    {@render children()}
  </svelte:boundary>
{/if}
```

### Automated A11y Testing

```typescript
// tests/a11y/components.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Component Accessibility', () => {
  test('Button has no accessibility violations', async ({ page }) => {
    await page.goto('http://localhost:6006/iframe.html?id=ui-button--primary');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('Input with error has proper ARIA', async ({ page }) => {
    await page.goto('http://localhost:6006/iframe.html?id=ui-input--with-error');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
```

---

## Visual Testing

### Playwright Visual Regression

```typescript
// tests/visual/components.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Visual Regression', () => {
  test('Button variants', async ({ page }) => {
    await page.goto('http://localhost:6006/iframe.html?id=ui-button--all-sizes');
    await expect(page).toHaveScreenshot('button-sizes.png');
  });

  test('Card light mode', async ({ page }) => {
    await page.goto('http://localhost:6006/iframe.html?id=ui-card--default');
    await expect(page).toHaveScreenshot('card-light.png');
  });

  test('Card dark mode', async ({ page }) => {
    await page.goto('http://localhost:6006/iframe.html?id=ui-card--default&globals=backgrounds.value:!hex(171717)');
    await expect(page).toHaveScreenshot('card-dark.png');
  });
});
```

### CI Configuration

```yaml
# .github/workflows/visual.yml
name: Visual Regression

on:
  pull_request:
    paths:
      - 'apps/web/src/lib/components/**'
      - 'apps/web/src/lib/styles/**'

jobs:
  visual:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - run: pnpm install
      - run: pnpm --filter web build-storybook

      - name: Start Storybook
        run: npx http-server storybook-static -p 6006 &

      - name: Run visual tests
        run: pnpm --filter web exec playwright test tests/visual

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: visual-diff
          path: test-results/
```

---

## Dependencies

### Required

| Dependency | Status | Description |
|------------|--------|-------------|
| P1-FE-FOUNDATION-001 | ✅ Available | Project scaffold |
| Melt UI Next-Gen | ✅ Available | Accessible primitives |

### Package Dependencies

```json
{
  "dependencies": {
    "melt": "^0.1.0"
  },
  "devDependencies": {
    "@storybook/sveltekit": "^8.0.0",
    "@storybook/addon-essentials": "^8.0.0",
    "@storybook/addon-a11y": "^8.0.0",
    "@storybook/addon-svelte-csf": "^5.0.0",
    "@axe-core/playwright": "^4.8.0",
    "@playwright/test": "^1.40.0"
  }
}
```

---

## Implementation Checklist

- [ ] **Token System**
  - [ ] Create src/lib/styles/tokens/*.css files
  - [ ] Implement color system with semantic tokens
  - [ ] Set up typography with size-adjusted fallbacks AND brand font variables
  - [ ] Configure spacing with density scale support
  - [ ] Implement radius system with configurable base
  - [ ] Configure shadow, motion scales
  - [ ] Add z-index scale
  - [ ] Implement material tokens (glass/texture support)

- [ ] **Global Styles**
  - [ ] Create CSS reset/normalize
  - [ ] Set up dark mode toggle via data-theme
  - [ ] Add organization brand override pattern
  - [ ] Configure reduced motion support

- [ ] **Core Components**
  - [ ] Button (all variants, sizes)
  - [ ] Input (text, email, password, error)
  - [ ] TextArea
  - [ ] Select (with Melt UI)
  - [ ] Checkbox, Switch
  - [ ] Badge, Avatar
  - [ ] Card
  - [ ] Skeleton

- [ ] **Feedback Components**
  - [ ] Toast global system
  - [ ] ErrorBanner
  - [ ] ConfirmDialog

- [ ] **Layout Components**
  - [ ] PageContainer
  - [ ] Stack, Cluster

- [ ] **Accessibility**
  - [ ] Skip link in root layout
  - [ ] ErrorBoundary component
  - [ ] Focus visible styles
  - [ ] Reduced motion support

- [ ] **Storybook**
  - [ ] Configure .storybook/main.ts
  - [ ] Configure .storybook/preview.ts
  - [ ] Create stories for all components
  - [ ] Add autodocs

- [ ] **Visual Testing**
  - [ ] Set up Playwright visual tests
  - [ ] Add CI workflow
  - [ ] Create baseline screenshots

---

## Testing Strategy

### Unit Tests

```typescript
// Component logic tests
describe('Button', () => {
  it('renders with correct variant class');
  it('disables when loading');
  it('calls onclick handler');
});
```

### Accessibility Tests

- Run axe-core on all component stories
- Verify keyboard navigation works
- Check focus management in dialogs

### Visual Tests

- Screenshot all component states
- Compare across light/dark modes
- Run on PR for style changes

---

## Notes

### Design Decisions

1. **Vanilla CSS over Tailwind**: Better control, smaller bundle, explicit design tokens
2. **Melt UI over Radix/Headless**: Native Svelte, Svelte 5 compatible, active development
3. **Storybook over Histoire**: Broader ecosystem, better addon support
4. **Visual regression over snapshot testing**: Catches visual bugs humans would miss

### Future Enhancements

- Component theming system (beyond org colors)
- Animation library for complex transitions
- Design token documentation site
- Figma token sync

---

**Last Updated**: 2026-01-12
**Template Version**: 1.0

# Codex Web Application - Testing Strategy

This document outlines the testing patterns and infrastructure for the Codex SvelteKit application.

## Test Types

### 1. Unit Tests (Vitest)
Used for testing individual components and utility functions in isolation.
- **Location**: `src/**/*.test.ts` or `src/**/*.svelte.test.ts`
- **Runner**: Vitest
- **Environment**: jsdom
- **API**: Svelte 5 native imperative API (`mount`, `unmount`, `createRawSnippet`)

### 2. E2E & A11y Tests (Playwright)
Used for testing full user flows and accessibility across different browsers.
- **Location**: `tests/**/*.spec.ts`
- **Runner**: Playwright
- **Integration**: Storybook

---

## Unit Testing Patterns

### Test Structure
Follow the **Arrange-Act-Assert** pattern.

```typescript
import { afterEach, describe, expect, test } from 'vitest';
import { mount, unmount, textSnippet } from '$tests/utils/component-test-utils.svelte';
import Button from './Button.svelte';

describe('Button', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
  });

  test('renders with correct label', () => {
    // Arrange
    component = mount(Button, {
      target: document.body,
      props: { children: textSnippet('Click me') }
    });

    // Act
    const button = document.body.querySelector('button');

    // Assert
    expect(button).toBeTruthy();
    expect(button?.textContent).toContain('Click me');
  });
});
```

### Why Svelte's Native API?

We use Svelte 5's native `mount`/`unmount` API instead of `@testing-library/svelte` because:

1. **Runes compatibility**: `@testing-library/svelte-core` contains `.svelte.js` files that use `$state` runes. These files in `node_modules` are not transformed by Vite, causing `rune_outside_svelte` errors.

2. **No external dependencies**: The native API is part of Svelte itself, avoiding version compatibility issues.

3. **Official pattern**: The [Svelte documentation](https://svelte.dev/docs/svelte/testing) recommends this approach for component testing.

### Component Rendering

Use `mount` from Svelte and helper functions from `$tests/utils/component-test-utils.svelte.ts`:

```typescript
import { mount, unmount, textSnippet, htmlSnippet } from '$tests/utils/component-test-utils.svelte';

// For components that accept children snippets:
const component = mount(MyComponent, {
  target: document.body,
  props: {
    children: textSnippet('Some text'),
    // or for HTML content:
    content: htmlSnippet('<strong>Bold</strong>')
  }
});
```

### Working with Snippets

Svelte 5 uses **Snippets** for slot-like content. To pass snippet props in tests, use `createRawSnippet`:

```typescript
import { createRawSnippet } from 'svelte';

const mySnippet = createRawSnippet(() => ({
  render: () => '<div>Custom content</div>',
  // Optional: setup function for event listeners
  setup: (element) => {
    // Called after render, element is the rendered DOM node
    return () => {
      // Cleanup function
    };
  }
}));
```

The utilities provide helpers:
- `textSnippet(text)` - Creates a snippet that renders text in a `<span>`
- `htmlSnippet(html)` - Creates a snippet that renders raw HTML

### Mock Data
Use factories from `src/tests/factories` to generate consistent mock data.

```typescript
import { createMockUser } from '$tests/factories/auth';

const user = createMockUser({ role: 'admin' });
```

### Accessibility Testing

For accessibility testing, use Playwright with axe-core for E2E tests, or add axe-core integration to unit tests:

```typescript
// E2E accessibility tests are in tests/*.spec.ts
// They use @axe-core/playwright

// For unit tests, you can add:
import { checkA11y } from '$tests/utils/a11y-helpers';

test('is accessible', async () => {
  const component = mount(Button, {
    target: document.body,
    props: { children: textSnippet('Accessible Button') }
  });
  await checkA11y(document.body);
  unmount(component);
});
```

---

## Infrastructure

- **Setup File**: `src/tests/setup.ts` - Configures jest-dom matchers and cleanup.
- **Utilities**: `src/tests/utils/` - Contains shared helper functions.
  - `component-test-utils.svelte.ts` - Mount helpers, snippet utilities, screen queries
  - `a11y-helpers.ts` - Accessibility testing utilities
- **Factories**: `src/tests/factories/` - Data generators for tests.

---

## Configuration Files

- **Vitest**: Configured in `vite.config.ts` under the `test` key
- **Playwright**: Configured in `playwright.config.ts`
- **Test aliases**: `$tests` alias points to `src/tests` (defined in `svelte.config.js`)

---

## Running Tests

```bash
# Run unit tests
pnpm test

# Run unit tests in watch mode
pnpm test:watch

# Run unit tests with coverage
pnpm test:coverage

# Run E2E tests
pnpm test:e2e

# Run E2E tests with UI
pnpm test:e2e:ui
```

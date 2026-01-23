# Codex Web Application - Testing Strategy

This document outlines the testing patterns and infrastructure for the Codex SvelteKit application.

## Test Types

### 1. Unit Tests (Vitest)
Used for testing individual components and utility functions in isolation.
- **Location**: `src/**/*.test.ts` or `src/**/*.svelte.test.ts`
- **Runner**: Vitest
- **Environment**: jsdom
- **API**: Svelte 5 native imperative API (`mount`, `unmount`, `createRawSnippet`)

### 2. E2E Tests (Playwright)
Used for testing full user flows across different browsers.
- **Location**: `e2e/**/*.spec.ts`
- **Runner**: Playwright
- **Target**: Running dev server (localhost:3000)

### 3. Accessibility Tests (Playwright + axe-core)
Used for testing component accessibility via Storybook.
- **Location**: `tests/a11y/**/*.spec.ts`
- **Runner**: Playwright with @axe-core/playwright
- **Target**: Storybook (localhost:6006)

### 4. Visual Regression Tests (Playwright)
Used for detecting unintended visual changes in components and pages.
- **Location**: `tests/visual/**/*.spec.ts`
- **Runner**: Playwright
- **Target**: Both Storybook and dev server

### 5. Storybook Interaction Tests
Used for testing component interactions directly in stories.
- **Location**: `src/**/*.stories.svelte` (play functions)
- **Runner**: Storybook addon-interactions
- **Target**: Storybook UI

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

---

## E2E Testing Patterns

### Basic Page Test

```typescript
import { expect, test } from '@playwright/test';

test.describe('Login Flow', () => {
  test('user can log in with valid credentials', async ({ page }) => {
    await page.goto('/login');

    // Fill form
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Password').fill('password123');

    // Submit
    await page.getByRole('button', { name: /sign in/i }).click();

    // Verify redirect
    await expect(page).toHaveURL('/dashboard');
  });
});
```

### Form Validation Testing

```typescript
test('shows validation errors for empty form', async ({ page }) => {
  await page.goto('/register');

  // Submit empty form
  await page.getByRole('button', { name: /create account/i }).click();

  // Verify errors appear
  await expect(page.getByText(/email is required/i)).toBeVisible();
  await expect(page.getByText(/password is required/i)).toBeVisible();
});
```

### Svelte 5 Click Handling

Svelte 5 uses a different event delegation system. For reliable click handling in tests:

```typescript
// Use page.mouse.click for coordinates-based clicking
const button = page.getByRole('button', { name: /submit/i });
const box = await button.boundingBox();
if (box) {
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// Or use force: true for stubborn elements
await page.getByRole('button', { name: /submit/i }).click({ force: true });
```

### Waiting for Hydration

SvelteKit apps need hydration before interactions work:

```typescript
test('waits for hydration', async ({ page }) => {
  await page.goto('/');

  // Wait for hydration marker
  await page.waitForSelector('[data-hydrated="true"]');

  // Or wait for interactive element
  await page.waitForSelector('button:not([disabled])');

  // Now safe to interact
  await page.getByRole('button').click();
});
```

### Selector Patterns

Prefer accessible selectors for robustness:

```typescript
// Good - accessible and stable
page.getByRole('button', { name: /submit/i })
page.getByLabel('Email')
page.getByText('Welcome')

// Acceptable - for test-specific hooks
page.getByTestId('user-menu')

// Avoid - fragile
page.locator('.btn-primary')
page.locator('div > button:first-child')
```

---

## Visual Regression Testing

Visual tests capture screenshots and compare against baselines to detect unintended changes.

### Running Visual Tests

```bash
# Run visual tests (requires dev server + Storybook running)
pnpm test:visual

# Update baselines after intentional changes
pnpm test:visual:update
```

### Writing Component Visual Tests

```typescript
// tests/visual/components.spec.ts
import { expect, test } from '@playwright/test';

test.describe('Button Visual Regression', () => {
  test.use({ baseURL: 'http://localhost:6006' });

  test('Primary button', async ({ page }) => {
    await page.goto('/iframe.html?id=ui-button--primary&viewMode=story');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('Button-Primary.png', {
      maxDiffPixelRatio: 0.01, // Allow 1% pixel difference
      animations: 'disabled',
    });
  });
});
```

### Writing Page Visual Tests

```typescript
// tests/visual/pages.spec.ts
test.describe('Auth Pages', () => {
  test('Login page', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('login-page.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });
});
```

### Best Practices

1. **Disable animations**: Use `animations: 'disabled'` to avoid flaky tests
2. **Wait for stability**: Use `networkidle` and small timeouts for CSS transitions
3. **Use appropriate tolerance**: `maxDiffPixelRatio: 0.01` for most tests
4. **Test states**: Capture hover, focus, and error states separately
5. **Responsive testing**: Test at multiple viewport sizes

---

## Storybook Interaction Tests

Storybook interaction tests use play functions to simulate user interactions directly in stories.

### Adding a Play Function

```svelte
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { expect, userEvent, within } from '@storybook/test';

  const { Story } = defineMeta({
    title: 'UI/Dialog',
    tags: ['autodocs'],
  });
</script>

<Story
  name="Interactive Test"
  play={async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Find and click trigger
    const trigger = canvas.getByRole('button', { name: /open/i });
    await userEvent.click(trigger);

    // Verify dialog opened
    const dialog = await canvas.findByRole('dialog');
    await expect(dialog).toBeVisible();

    // Close with escape
    await userEvent.keyboard('{Escape}');
  }}
>
  <!-- Story content -->
</Story>
```

### Available Testing Utilities

From `@storybook/test`:
- `within(element)` - Scope queries to an element
- `userEvent` - Simulate user interactions (click, type, etc.)
- `expect` - Jest-compatible assertions
- `fn()` - Create mock functions

### Testing Patterns

**Dialog/Modal Testing**:
```typescript
play={async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: /open/i }));
  await expect(canvas.findByRole('dialog')).resolves.toBeVisible();
}}
```

**Form Testing**:
```typescript
play={async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.type(canvas.getByRole('textbox'), 'test input');
  await expect(canvas.getByRole('textbox')).toHaveValue('test input');
}}
```

**Dropdown/Select Testing**:
```typescript
play={async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('combobox'));
  await userEvent.click(canvas.getByRole('option', { name: /option 1/i }));
}}
```

---

## Accessibility Testing

### In Storybook (Playwright + axe-core)

```typescript
// tests/a11y/components.spec.ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('Button has no accessibility violations', async ({ page }) => {
  await page.goto('http://localhost:6006/iframe.html?id=ui-button--primary');

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations).toEqual([]);
});
```

### In Unit Tests

```typescript
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

## Test Organization

### Directory Structure

```
apps/web/
├── src/
│   ├── lib/components/ui/
│   │   └── Button/
│   │       ├── Button.svelte
│   │       ├── Button.svelte.test.ts    # Unit tests
│   │       └── Button.stories.svelte    # Stories + interaction tests
│   └── tests/
│       ├── setup.ts                     # Vitest setup
│       ├── utils/                       # Test utilities
│       └── factories/                   # Mock data factories
├── e2e/
│   ├── auth.spec.ts                     # Auth flow E2E tests
│   └── forms.spec.ts                    # Form E2E tests
├── tests/
│   ├── a11y/
│   │   └── components.spec.ts           # Accessibility tests
│   └── visual/
│       ├── components.spec.ts           # Component screenshots
│       └── pages.spec.ts                # Page screenshots
└── playwright.config.ts
```

### Naming Conventions

| Test Type | File Pattern | Example |
|-----------|--------------|---------|
| Unit | `*.test.ts`, `*.svelte.test.ts` | `Button.svelte.test.ts` |
| E2E | `*.spec.ts` (in e2e/) | `auth.spec.ts` |
| Visual | `*.spec.ts` (in tests/visual/) | `components.spec.ts` |
| A11y | `*.spec.ts` (in tests/a11y/) | `components.spec.ts` |

### Which Test Type to Use

| Scenario | Test Type |
|----------|-----------|
| Component renders correctly | Unit test |
| Component props work as expected | Unit test |
| User can complete a flow | E2E test |
| Form validation works end-to-end | E2E test |
| Component is keyboard accessible | A11y test |
| Component looks correct | Visual test |
| Interactive component behavior | Storybook interaction test |

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
# Unit tests
pnpm test              # Run once
pnpm test:watch        # Watch mode
pnpm test:coverage     # With coverage

# E2E tests
pnpm test:e2e          # Run E2E tests
pnpm test:e2e:ui       # With Playwright UI

# Accessibility tests
pnpm test:a11y         # Requires Storybook running

# Visual regression tests
pnpm test:visual       # Compare against baselines
pnpm test:visual:update # Update baselines

# Storybook interaction tests
pnpm storybook         # Start Storybook, view Interactions panel
```

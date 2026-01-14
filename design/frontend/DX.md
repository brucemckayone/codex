# Developer Experience (DX)

**Status**: Design
**Last Updated**: 2026-01-12

---

## Component Development: Storybook

We use **Storybook** for isolated component development and documentation.

### Why Storybook?

| Benefit | How |
|---------|-----|
| **Isolated Development** | Build components without running full app |
| **State Exploration** | Test loading, error, empty, and edge-case states |
| **Visual Documentation** | Auto-generated component catalog |
| **Visual Regression** | Catch CSS regressions with screenshot testing |

---

## Setup

### Dependencies

```bash
# Required packages
npx storybook@latest init

# Uses @storybook/sveltekit automatically for SvelteKit projects
```

### Configuration

```typescript
// .storybook/main.ts
import type { StorybookConfig } from '@storybook/sveltekit';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|ts|svelte)'],
  framework: '@storybook/sveltekit',
  addons: [
    '@storybook/addon-essentials',    // Controls, docs, actions
    '@storybook/addon-a11y',          // Accessibility checks
    '@storybook/addon-svelte-csf'     // Svelte story format
  ]
};

export default config;
```

---

## Writing Stories (Svelte 5)

Stories use the Svelte CSF format with `defineMeta`:

```svelte
<!-- Button.stories.svelte -->
<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Button from './Button.svelte';

  const { Story } = defineMeta({
    title: 'Components/Button',
    component: Button,
    tags: ['autodocs']
  });
</script>

<Story name="Primary">
  <Button variant="primary">Click Me</Button>
</Story>

<Story name="Secondary">
  <Button variant="secondary">Cancel</Button>
</Story>

<Story name="Loading">
  <Button loading>Saving...</Button>
</Story>

<Story name="Disabled">
  <Button disabled>Cannot Click</Button>
</Story>
```

---

## Mocking SvelteKit Stores

SvelteKit components often use `$app/stores`. Mock these for Storybook:

```typescript
// .storybook/preview.ts
export const parameters = {
  sveltekit_experimental: {
    stores: {
      page: {
        url: new URL('https://revelations.studio'),
        params: {}
      },
      navigating: null
    }
  }
};
```

---

## Visual Regression Testing

Prevent CSS regressions with Playwright visual comparisons.

### Strategy

| Level | Scope | Frequency |
|-------|-------|-----------|
| **Atomic** | Design system primitives (Button, Input, Card) | Every PR |
| **Composite** | Key patterns (ContentCard, VideoPlayer controls) | Every PR |
| **Page** | Critical user journeys | Weekly |

### Implementation

```typescript
// tests/visual/button.spec.ts
import { test, expect } from '@playwright/test';

test('Button variants match snapshots', async ({ page }) => {
  await page.goto('http://localhost:6006/iframe.html?id=components-button--primary');
  await expect(page).toHaveScreenshot('button-primary.png');

  await page.goto('http://localhost:6006/iframe.html?id=components-button--secondary');
  await expect(page).toHaveScreenshot('button-secondary.png');
});
```

### CI Integration

```yaml
# .github/workflows/visual.yml
visual-regression:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - run: npm ci
    - run: npm run build-storybook
    - run: npx playwright test tests/visual --update-snapshots
```

---

## Component Story Requirements

Each design system component should have stories for:

| State | Required | Example |
|-------|----------|---------|
| Default | ✅ | Normal display |
| Loading | ⚠️ If applicable | Skeleton/spinner |
| Error | ⚠️ If applicable | Error message |
| Empty | ⚠️ If applicable | No data state |
| Disabled | ⚠️ If applicable | Non-interactive |
| Sizes | ⚠️ If applicable | xs, sm, md, lg, xl |

---

## Related Documents

- [COMPONENTS.md](./COMPONENTS.md) — Component specifications
- [STYLING.md](./STYLING.md) — Design tokens for theming

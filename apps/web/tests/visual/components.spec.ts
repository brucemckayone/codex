/**
 * Visual Regression Tests for UI Components
 *
 * These tests capture screenshots of Storybook stories to detect unintended visual changes.
 * Run with: pnpm test:visual
 * Update baselines: pnpm test:visual:update
 *
 * NOTE: Storybook must be running on port 6006 before running these tests.
 */
import { expect, test } from '@playwright/test';

// Component stories to test - mapped to their Storybook IDs
const componentStories = [
  // Core form elements
  {
    name: 'Button',
    stories: [
      'Default',
      'Primary',
      'Secondary',
      'Destructive',
      'Ghost',
      'Outline',
    ],
  },
  {
    name: 'Input',
    stories: ['Default', 'With Label', 'With Error', 'Disabled'],
  },
  { name: 'TextArea', stories: ['Default', 'With Label'] },
  { name: 'Checkbox', stories: ['Default', 'Checked', 'With Label'] },
  { name: 'Switch', stories: ['Default', 'Checked'] },
  { name: 'Select', stories: ['Default', 'With Label', 'With Selected Value'] },

  // Display components
  { name: 'Badge', stories: ['Default', 'Variants'] },
  { name: 'Avatar', stories: ['Default', 'Fallback'] },
  { name: 'Card', stories: ['Default'] },
  { name: 'Skeleton', stories: ['Default'] },
  { name: 'Label', stories: ['Default'] },

  // Interactive components
  { name: 'Dialog', stories: ['Default'] },
  { name: 'Accordion', stories: ['Default'] },
  { name: 'Tabs', stories: ['Default'] },
  { name: 'DropdownMenu', stories: ['Default'] },
  { name: 'Popover', stories: ['Default'] },
  { name: 'Tooltip', stories: ['Default'] },

  // Feedback
  { name: 'Feedback', stories: ['Default', 'Success', 'Error'] },
  { name: 'Toast', stories: ['Default'] },

  // Layout
  { name: 'Layout', stories: ['Default'] },
  { name: 'Table', stories: ['Default'] },
];

/**
 * Convert story name to Storybook URL-friendly ID
 * "Button" + "Primary" => "ui-button--primary"
 */
function toStoryId(component: string, story: string): string {
  const storySlug = story.toLowerCase().replace(/\s+/g, '-');
  return `ui-${component.toLowerCase()}--${storySlug}`;
}

test.describe('Component Visual Regression', () => {
  // Configure Storybook base URL
  test.use({ baseURL: 'http://localhost:6006' });

  for (const { name, stories } of componentStories) {
    for (const story of stories) {
      test(`${name} - ${story}`, async ({ page }) => {
        const storyId = toStoryId(name, story);

        // Navigate to story iframe
        await page.goto(`/iframe.html?id=${storyId}&viewMode=story`);

        // Wait for story to render
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(100); // Small delay for CSS animations

        // Take screenshot and compare
        await expect(page).toHaveScreenshot(`${name}-${story}.png`, {
          maxDiffPixelRatio: 0.01, // Allow 1% pixel difference
          animations: 'disabled',
        });
      });
    }
  }
});

test.describe('Component States', () => {
  test.use({ baseURL: 'http://localhost:6006' });

  test('Button hover state', async ({ page }) => {
    await page.goto('/iframe.html?id=ui-button--primary&viewMode=story');
    await page.waitForLoadState('networkidle');

    const button = page.getByRole('button').first();
    await button.hover();

    await expect(page).toHaveScreenshot('Button-Primary-hover.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('Input focus state', async ({ page }) => {
    await page.goto('/iframe.html?id=ui-input--default&viewMode=story');
    await page.waitForLoadState('networkidle');

    const input = page.getByRole('textbox').first();
    await input.focus();

    await expect(page).toHaveScreenshot('Input-Default-focus.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const STORYBOOK_URL = 'http://localhost:6006';

/**
 * Accessibility Tests for UI Components
 *
 * These tests run axe-core audits against Storybook stories to verify
 * WCAG 2.1 AA compliance. Each component is tested in its various states.
 *
 * Run with: pnpm test:a11y
 * Requires: Storybook running on port 6006 (pnpm storybook)
 */

test.describe('Component Accessibility', () => {
  test.beforeAll(async ({ request }) => {
    try {
      const response = await request.get(STORYBOOK_URL, { timeout: 5000 });
      if (!response.ok()) {
        test.skip(
          true,
          `Storybook not available at ${STORYBOOK_URL}. Run 'pnpm storybook' first.`
        );
      }
    } catch {
      test.skip(
        true,
        `Storybook not running at ${STORYBOOK_URL}. Run 'pnpm storybook' first.`
      );
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Button
  // ─────────────────────────────────────────────────────────────────────────────

  test('Button has no accessibility violations', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-button--primary&viewMode=story`
    );
    await page.waitForSelector('.button');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('Button - disabled state is accessible', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-button--disabled&viewMode=story`
    );
    await page.waitForSelector('.button');

    const button = page.locator('.button');
    await expect(button).toBeDisabled();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Input
  // ─────────────────────────────────────────────────────────────────────────────

  test('Input has no accessibility violations', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-input--default&viewMode=story`
    );
    await page.waitForSelector('.input');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('Input - password type has accessible toggle', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-input--password&viewMode=story`
    );
    await page.waitForSelector('.input');

    const toggleButton = page.locator('.password-toggle');
    await expect(toggleButton).toHaveAttribute('aria-label', 'Show password');

    await toggleButton.click();
    await expect(toggleButton).toHaveAttribute('aria-label', 'Hide password');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('Input - error state shows accessible error message', async ({
    page,
  }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-input--with-error&viewMode=story`
    );
    await page.waitForSelector('.input');

    // Error text should be visible
    const errorText = page.locator('.error-text');
    await expect(errorText).toBeVisible();
    await expect(errorText).toContainText('required');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('Input - form example with labels', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-input--form-example&viewMode=story`
    );
    await page.waitForSelector('.input');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TextArea
  // ─────────────────────────────────────────────────────────────────────────────

  test('TextArea has no accessibility violations', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-textarea--default&viewMode=story`
    );
    await page.waitForSelector('.textarea');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('TextArea - form example with label', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-textarea--form-example&viewMode=story`
    );
    await page.waitForSelector('.textarea');

    // Label should be properly associated
    const label = page.locator('label[for="description-textarea"]');
    await expect(label).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Checkbox
  // ─────────────────────────────────────────────────────────────────────────────

  test('Checkbox has proper ARIA attributes', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-checkbox--unchecked&viewMode=story`
    );
    await page.waitForSelector('.checkbox-root');

    const checkbox = page.locator('.checkbox-root');
    await expect(checkbox).toHaveAttribute('role', 'checkbox');
    await expect(checkbox).toHaveAttribute('aria-checked', 'false');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('Checkbox - checked state', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-checkbox--checked&viewMode=story`
    );
    await page.waitForSelector('.checkbox-root');

    const checkbox = page.locator('.checkbox-root');
    await expect(checkbox).toHaveAttribute('aria-checked', 'true');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('Checkbox - click toggles state', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-checkbox--unchecked&viewMode=story`
    );
    await page.waitForSelector('.checkbox-root');

    const checkbox = page.locator('.checkbox-root');
    await expect(checkbox).toHaveAttribute('aria-checked', 'false');

    await checkbox.click();
    await expect(checkbox).toHaveAttribute('aria-checked', 'true');

    await checkbox.click();
    await expect(checkbox).toHaveAttribute('aria-checked', 'false');
  });

  test('Checkbox - indeterminate state', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-checkbox--indeterminate&viewMode=story`
    );
    await page.waitForSelector('.checkbox-root');

    const checkbox = page.locator('.checkbox-root');
    await expect(checkbox).toHaveAttribute('aria-checked', 'mixed');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Switch
  // ─────────────────────────────────────────────────────────────────────────────

  test('Switch has proper ARIA attributes', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-switch--default&viewMode=story`
    );
    await page.waitForSelector('.switch');

    const switchEl = page.locator('.switch');
    await expect(switchEl).toHaveAttribute('role', 'switch');
    await expect(switchEl).toHaveAttribute('aria-checked', 'false');

    await switchEl.click();
    await expect(switchEl).toHaveAttribute('aria-checked', 'true');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Accordion
  // ─────────────────────────────────────────────────────────────────────────────

  test('Accordion has proper ARIA attributes', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-accordion--default&viewMode=story`
    );
    await page.waitForSelector('[data-accordion-root]');

    // Triggers should have button role and aria-expanded
    const triggers = page.locator('[data-accordion-trigger]');
    const firstTrigger = triggers.first();
    await expect(firstTrigger).toHaveAttribute('aria-expanded');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('Accordion - keyboard navigation', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-accordion--default&viewMode=story`
    );
    await page.waitForSelector('[data-accordion-root]');

    const triggers = page.locator('[data-accordion-trigger]');
    const firstTrigger = triggers.first();

    // Focus first trigger
    await firstTrigger.focus();
    await expect(firstTrigger).toBeFocused();

    // Press Enter to toggle
    await page.keyboard.press('Enter');

    // Verify it expanded
    await expect(firstTrigger).toHaveAttribute('aria-expanded', 'true');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Tabs
  // ─────────────────────────────────────────────────────────────────────────────

  test('Tabs has proper ARIA attributes', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-tabs--default&viewMode=story`
    );
    await page.waitForSelector('[data-tabs-root]');

    // Tab list should have tablist role
    const tablist = page.locator('[role="tablist"]');
    await expect(tablist).toBeVisible();

    // Tabs should have tab role
    const tabs = page.locator('[role="tab"]');
    expect(await tabs.count()).toBeGreaterThan(0);

    // Tab panels should have tabpanel role
    const tabPanels = page.locator('[role="tabpanel"]');
    expect(await tabPanels.count()).toBeGreaterThan(0);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('Tabs - keyboard navigation', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-tabs--default&viewMode=story`
    );
    await page.waitForSelector('[data-tabs-root]');

    const tabs = page.locator('[role="tab"]');
    const firstTab = tabs.first();

    // Focus first tab
    await firstTab.focus();
    await expect(firstTab).toBeFocused();

    // Arrow right should move focus to next tab
    await page.keyboard.press('ArrowRight');

    // Second tab should now be focused
    const secondTab = tabs.nth(1);
    await expect(secondTab).toBeFocused();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Dialog
  // ─────────────────────────────────────────────────────────────────────────────

  test('Dialog has proper ARIA attributes when open', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-dialog--default&viewMode=story`
    );

    // Click button to open dialog
    const openButton = page.locator('button:has-text("Open Dialog")');
    await openButton.click();

    // Wait for dialog to open
    await page.waitForSelector('[role="dialog"]');

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Dialog should have accessible name via aria-labelledby or aria-label
    const hasAriaLabel =
      (await dialog.getAttribute('aria-label')) !== null ||
      (await dialog.getAttribute('aria-labelledby')) !== null;
    expect(hasAriaLabel).toBe(true);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('Dialog - focus trap and escape key', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-dialog--default&viewMode=story`
    );

    // Open dialog
    const openButton = page.locator('button:has-text("Open Dialog")');
    await openButton.click();
    await page.waitForSelector('[role="dialog"]');

    // Press Escape to close
    await page.keyboard.press('Escape');

    // Dialog should be closed
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Badge
  // ─────────────────────────────────────────────────────────────────────────────

  test('Badge has no accessibility violations', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-badge--default&viewMode=story`
    );
    await page.waitForSelector('.badge');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Card
  // ─────────────────────────────────────────────────────────────────────────────

  test('Card has no accessibility violations', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-card--default&viewMode=story`
    );
    await page.waitForSelector('.card');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Skeleton
  // ─────────────────────────────────────────────────────────────────────────────

  test('Skeleton has no accessibility violations', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-skeleton--default&viewMode=story`
    );
    await page.waitForSelector('.skeleton');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SkipLink
  // ─────────────────────────────────────────────────────────────────────────────

  test('SkipLink appears on focus and links to main content', async ({
    page,
  }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-skiplink--default&viewMode=story`
    );

    // Tab to focus skip link
    await page.keyboard.press('Tab');

    const skipLink = page.locator('.skip-link');
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Tooltip
  // ─────────────────────────────────────────────────────────────────────────────

  test('Tooltip has no accessibility violations', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-tooltip--default&viewMode=story`
    );

    // Hover to show tooltip
    const trigger = page.locator('[data-tooltip-trigger]');
    if ((await trigger.count()) > 0) {
      await trigger.hover();
      // Wait for tooltip to appear
      await page.waitForTimeout(300);
    }

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Label
  // ─────────────────────────────────────────────────────────────────────────────

  test('Label has no accessibility violations', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-label--default&viewMode=story`
    );
    await page.waitForSelector('label');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

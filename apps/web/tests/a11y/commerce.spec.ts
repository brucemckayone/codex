import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const STORYBOOK_URL = 'http://localhost:6006';

/**
 * Accessibility Tests for Commerce Components
 *
 * These tests run axe-core audits against Storybook stories to verify
 * WCAG 2.1 AA compliance for commerce-related components.
 *
 * Run with: pnpm test:a11y
 * Requires: Storybook running on port 6006 (pnpm storybook)
 */

test.describe('Commerce Component Accessibility', () => {
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
  // PriceDisplay
  // ─────────────────────────────────────────────────────────────────────────────

  test.describe('PriceDisplay', () => {
    test('has no accessibility violations for small size', async ({ page }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-pricedisplay--small&viewMode=story`
      );
      await page.waitForSelector('.price-display');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for medium size', async ({
      page,
    }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-pricedisplay--medium&viewMode=story`
      );
      await page.waitForSelector('.price-display');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for large size', async ({ page }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-pricedisplay--large&viewMode=story`
      );
      await page.waitForSelector('.price-display');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for free state (null price)', async ({
      page,
    }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-pricedisplay--free-null&viewMode=story`
      );
      await page.waitForSelector('.price-display');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for free state (zero price)', async ({
      page,
    }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-pricedisplay--free-zero&viewMode=story`
      );
      await page.waitForSelector('.price-display');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for all sizes grid', async ({
      page,
    }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-pricedisplay--all-sizes&viewMode=story`
      );
      await page.waitForSelector('.price-display');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PurchaseButton
  // ─────────────────────────────────────────────────────────────────────────────

  test.describe('PurchaseButton', () => {
    test('has no accessibility violations for primary variant', async ({
      page,
    }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-purchasebutton--primary&viewMode=story`
      );
      await page.waitForSelector('.purchase-button');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for secondary variant', async ({
      page,
    }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-purchasebutton--secondary&viewMode=story`
      );
      await page.waitForSelector('.purchase-button');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for small size', async ({ page }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-purchasebutton--small-primary&viewMode=story`
      );
      await page.waitForSelector('.purchase-button');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for medium size', async ({
      page,
    }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-purchasebutton--medium-primary&viewMode=story`
      );
      await page.waitForSelector('.purchase-button');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for large size', async ({ page }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-purchasebutton--large-primary&viewMode=story`
      );
      await page.waitForSelector('.purchase-button');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for disabled state', async ({
      page,
    }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-purchasebutton--disabled&viewMode=story`
      );
      await page.waitForSelector('.purchase-button');

      const button = page.locator('.purchase-button');
      await expect(button).toBeDisabled();

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for all variants grid', async ({
      page,
    }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-purchasebutton--all-variants&viewMode=story`
      );
      await page.waitForSelector('.purchase-button');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for all sizes grid', async ({
      page,
    }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-purchasebutton--all-sizes&viewMode=story`
      );
      await page.waitForSelector('.purchase-button');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PurchaseCTA
  // ─────────────────────────────────────────────────────────────────────────────

  test.describe('PurchaseCTA', () => {
    test('has no accessibility violations for paid content state', async ({
      page,
    }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-purchasecta--paid-content&viewMode=story`
      );
      await page.waitForSelector('.purchase-cta');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for paid content with high price', async ({
      page,
    }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-purchasecta--paid-content-high-price&viewMode=story`
      );
      await page.waitForSelector('.purchase-cta');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for purchased state', async ({
      page,
    }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-purchasecta--purchased-content&viewMode=story`
      );
      await page.waitForSelector('.purchase-cta');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for free content state (null price)', async ({
      page,
    }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-purchasecta--free-content&viewMode=story`
      );
      await page.waitForSelector('.purchase-cta');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for free content state (zero price)', async ({
      page,
    }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-purchasecta--free-content-zero-price&viewMode=story`
      );
      await page.waitForSelector('.purchase-cta');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for all states grid', async ({
      page,
    }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-purchasecta--all-states&viewMode=story`
      );
      await page.waitForSelector('.purchase-cta');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for small size', async ({ page }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-purchasecta--small-size&viewMode=story`
      );
      await page.waitForSelector('.purchase-cta');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for large size', async ({ page }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-purchasecta--large-size&viewMode=story`
      );
      await page.waitForSelector('.purchase-cta');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('has no accessibility violations for all sizes grid', async ({
      page,
    }) => {
      await page.goto(
        `${STORYBOOK_URL}/iframe.html?id=commerce-purchasecta--all-sizes&viewMode=story`
      );
      await page.waitForSelector('.purchase-cta');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  });
});

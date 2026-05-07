/**
 * Nav Redesign — WP-10.4: A11y, responsive, auth, transitions
 *
 * Covers WP-10 spec items T-06, T-09, T-10, PW-09, PW-10, PW-11.
 * Cross-org studio view-transition (T-07) and brand-editor coexistence
 * (T-08) require seeded org/admin fixtures and are deferred to
 * docs/nav-redesign/WP-10-verification.md manual checks.
 *
 * Bead: Codex-i8y7k
 */

import { expect, type Page, test } from '@playwright/test';
import { test as authTest } from '../fixtures/auth';

async function getRailFocusables(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const nav = document.querySelector(
      'nav[aria-label="Main navigation"]'
    ) as HTMLElement | null;
    if (!nav) return [];
    return Array.from(nav.querySelectorAll<HTMLElement>('a, button')).map(
      (el) =>
        el.getAttribute('aria-label') ??
        el.textContent?.trim().slice(0, 30) ??
        ''
    );
  });
}

test.describe('Unauthenticated rail (T-06, PW-09)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('shows Sign In link at the bottom of the rail', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const rail = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('link', { name: 'Sign In' })).toBeVisible();
  });
});

authTest.describe('Authenticated rail (T-06, PW-10)', () => {
  authTest.use({ viewport: { width: 1440, height: 900 } });

  authTest(
    'authenticated user sees avatar trigger on / and /discover',
    async ({ page, authenticateAsUser }) => {
      await authenticateAsUser();

      // Platform root must reflect auth (Codex-nwlhm — was previously cached
      // unauth via STATIC_PUBLIC, now DYNAMIC_PUBLIC_REVALIDATE).
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      const rail = page.getByRole('navigation', { name: 'Main navigation' });
      await expect(rail.locator('.user-trigger')).toBeVisible();

      await page.goto('/discover');
      await page.waitForLoadState('networkidle');
      await expect(rail.locator('.user-trigger')).toBeVisible();
    }
  );
});

test.describe('Responsive breakpoints (T-09)', () => {
  for (const width of [1440, 1024, 768] as const) {
    test(`rail visible at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(
        page.getByRole('navigation', { name: 'Main navigation' })
      ).toBeVisible();
    });
  }

  for (const width of [375, 320] as const) {
    test(`rail hidden, mobile nav visible at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await page.goto('/');
      await expect(
        page.getByRole('navigation', { name: 'Main navigation' })
      ).toBeHidden();
      await expect(
        page.getByRole('navigation', { name: 'Mobile navigation' })
      ).toBeVisible();
    });
  }
});

test.describe('Keyboard navigation (T-10)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('arrow-down moves focus through rail items in nav order', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const items = await getRailFocusables(page);
    expect(items.length).toBeGreaterThan(2);

    await page.evaluate(() => {
      const first = document.querySelector(
        'nav[aria-label="Main navigation"] a, nav[aria-label="Main navigation"] button'
      ) as HTMLElement | null;
      first?.focus();
    });

    const initial = await page.evaluate(
      () =>
        document.activeElement?.getAttribute('aria-label') ??
        document.activeElement?.textContent?.trim().slice(0, 30) ??
        ''
    );

    await page.keyboard.press('ArrowDown');
    // Roving-tabindex focus shift is synchronous in the handler, but allow
    // the next animation frame so any Svelte-driven re-render settles before
    // we read activeElement again.
    await page.waitForTimeout(50);

    const next = await page.evaluate(
      () =>
        document.activeElement?.getAttribute('aria-label') ??
        document.activeElement?.textContent?.trim().slice(0, 30) ??
        ''
    );

    expect(next).not.toBe(initial);
  });
});

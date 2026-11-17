/**
 * Studio Breadcrumb Alignment Regression (Codex-iwpj5 — follow-up to Codex-tjfv4)
 *
 * Two breadcrumb components on studio content pages previously had visible
 * alignment bugs that were invisible to unit tests because jsdom has no real
 * layout engine (getComputedStyle returns empty strings and
 * getBoundingClientRect returns zeros). Only a real browser catches them.
 *
 * 1. Shared `Breadcrumb.svelte` (nav.breadcrumb .breadcrumb__list)
 *    Each <li> inherited `margin: 0 0 8px` from a global <li> reset. The
 *    flex algorithm expanded the <ol> to accommodate the bottom margin of
 *    the first item (but not the others — once a separator was inserted on
 *    item 2+, the margin boxes desynced), leaving a ~4px vertical drift
 *    between items. Fix: explicit `margin: 0` on `.breadcrumb__item`.
 *
 * 2. `ContentFormCommandBar.svelte` (a.breadcrumb) was retired with the old
 *    content form (Codex-a6ofh.2.10), and its test with it. The studio's
 *    other command bars (content list, media, analytics) set their uppercase
 *    root on the leaf's baseline by design, so its centring rule never
 *    applied to them.
 *
 * This spec inspects real computed styles and bounding rects inside the
 * browser via page.evaluate, then asserts against the returned measurements.
 */

import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';
import {
  cleanupSharedStudioAuth,
  injectSharedStudioAuth,
  navigateToStudioPage,
  registerSharedStudioUser,
  type SharedStudioAuth,
} from '../helpers/studio';

test.describe('Studio Breadcrumb Alignment', () => {
  test.describe.configure({ mode: 'serial' });

  let sharedAuth: SharedStudioAuth;

  test.beforeAll(async () => {
    sharedAuth = await registerSharedStudioUser({ orgRole: 'owner' });
  });

  test.afterAll(async () => {
    await cleanupSharedStudioAuth(sharedAuth);
  });

  test.beforeEach(async ({ page }) => {
    await injectSharedStudioAuth(page, sharedAuth);
  });

  test('shared Breadcrumb list items have zero margin and identical center-Y', async ({
    page,
  }) => {
    // The edit page shows the shared breadcrumb above every state that is
    // not the editor: loading, a failed read, and a piece that is not there,
    // which is the one a test can hold still (an id no row has).
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content/00000000-0000-4000-8000-000000000000/edit'
    );

    const breadcrumbList = page.locator('nav.breadcrumb .breadcrumb__list');
    await expect(breadcrumbList).toBeVisible();
    await expect(
      page.getByText('This piece was deleted, or isn’t yours to edit.')
    ).toBeVisible({ timeout: 30000 });

    // Collect geometry + computed margins for every <li>, plus the <ol> height,
    // inside the page context so measurements come from a real layout engine.
    const measurements = await page.evaluate(() => {
      const list = document.querySelector<HTMLElement>(
        'nav.breadcrumb .breadcrumb__list'
      );
      if (!list) {
        return null;
      }

      const items = Array.from(
        list.querySelectorAll<HTMLElement>('.breadcrumb__item')
      );

      return {
        listRect: list.getBoundingClientRect().toJSON(),
        items: items.map((el) => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return {
            marginTop: style.marginTop,
            marginRight: style.marginRight,
            marginBottom: style.marginBottom,
            marginLeft: style.marginLeft,
            rect: rect.toJSON(),
            centerY: rect.top + rect.height / 2,
          };
        }),
      };
    });

    expect(
      measurements,
      'shared breadcrumb list should be present'
    ).not.toBeNull();
    // Typechecker narrowing after the null guard above.
    if (!measurements) return;

    expect(
      measurements.items.length,
      'expected two breadcrumb items: Content / Edit'
    ).toBeGreaterThanOrEqual(2);

    // 1) Every <li> must have zero margin on every side.
    for (const [index, item] of measurements.items.entries()) {
      expect(
        item.marginTop,
        `item[${index}] margin-top should be 0px (was ${item.marginTop})`
      ).toBe('0px');
      expect(
        item.marginRight,
        `item[${index}] margin-right should be 0px (was ${item.marginRight})`
      ).toBe('0px');
      expect(
        item.marginBottom,
        `item[${index}] margin-bottom should be 0px (was ${item.marginBottom})`
      ).toBe('0px');
      expect(
        item.marginLeft,
        `item[${index}] margin-left should be 0px (was ${item.marginLeft})`
      ).toBe('0px');
    }

    // 2) <ol> height must not exceed the tallest <li> by more than 0.5px.
    //    Previously the inherited 8px bottom margin bloated the flex container
    //    from ~22.5px (item height) to ~30.5px — this catches any regression.
    const tallestItemHeight = Math.max(
      ...measurements.items.map((i) => i.rect.height)
    );
    expect(
      measurements.listRect.height,
      `<ol> height (${measurements.listRect.height}px) should be ≤ tallest <li> (${tallestItemHeight}px) + 0.5px tolerance`
    ).toBeLessThanOrEqual(tallestItemHeight + 0.5);

    // 3) All <li> center-Y values must agree within 0.5px — catches any drift
    //    whether caused by margin, baseline shift, or font-size mismatch.
    const centerYs = measurements.items.map((i) => i.centerY);
    const minCenterY = Math.min(...centerYs);
    const maxCenterY = Math.max(...centerYs);
    expect(
      maxCenterY - minCenterY,
      `breadcrumb items center-Y spread ${maxCenterY - minCenterY}px should be ≤ 0.5px (centers: ${centerYs.map((c) => c.toFixed(2)).join(', ')})`
    ).toBeLessThanOrEqual(0.5);
  });
});

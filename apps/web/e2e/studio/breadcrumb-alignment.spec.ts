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
 * 2. `ContentFormCommandBar.svelte` (a.breadcrumb)
 *    Baseline alignment plus an uppercase-vs-mixed-case font-size mismatch
 *    drifted the root/separator/leaf spans by a few pixels. Fix:
 *    `align-items: center`, unified `--text-sm`, separator `line-height: 1`.
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
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content/new'
    );

    // The shared breadcrumb is rendered unconditionally at the top of the page;
    // the ContentForm skeleton beneath it does not gate the <nav>. Still wait
    // for it to be attached so the computed styles are valid.
    const breadcrumbList = page.locator('nav.breadcrumb .breadcrumb__list');
    await expect(breadcrumbList).toBeVisible();

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
      'expected two breadcrumb items: Content / New Content'
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

  test('ContentFormCommandBar breadcrumb spans share center-Y, align-items:center, unified font-size', async ({
    page,
  }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content/new'
    );

    // The command-bar breadcrumb lives inside <ContentForm>, which is gated by
    // the mediaQuery skeleton. Wait for the anchor itself — that implies the
    // skeleton has resolved and the form is hydrated.
    const commandBarBreadcrumb = page.locator('.command-bar a.breadcrumb');
    await expect(commandBarBreadcrumb).toBeVisible({ timeout: 30000 });

    const measurements = await page.evaluate(() => {
      const anchor = document.querySelector<HTMLAnchorElement>(
        '.command-bar a.breadcrumb'
      );
      if (!anchor) {
        return null;
      }

      const root = anchor.querySelector<HTMLSpanElement>('.breadcrumb-root');
      const sep = anchor.querySelector<HTMLSpanElement>('.breadcrumb-sep');
      const leaf = anchor.querySelector<HTMLSpanElement>('.breadcrumb-leaf');

      if (!root || !sep || !leaf) {
        return { missing: { root: !root, sep: !sep, leaf: !leaf } } as const;
      }

      const anchorStyle = window.getComputedStyle(anchor);
      const rootStyle = window.getComputedStyle(root);
      const leafStyle = window.getComputedStyle(leaf);

      const rectCenterY = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2;
      };

      return {
        alignItems: anchorStyle.alignItems,
        rootFontSize: rootStyle.fontSize,
        leafFontSize: leafStyle.fontSize,
        centers: {
          root: rectCenterY(root),
          sep: rectCenterY(sep),
          leaf: rectCenterY(leaf),
        },
      } as const;
    });

    expect(
      measurements,
      'command-bar breadcrumb anchor should be present'
    ).not.toBeNull();
    if (!measurements) return;
    expect(
      'missing' in measurements && measurements.missing,
      'command-bar breadcrumb should contain root, sep, and leaf spans'
    ).toBeFalsy();
    if ('missing' in measurements) return;

    // 1) Anchor must use align-items: center (not baseline) — this is what
    //    reconciles the uppercase cap-height root with the mixed-case leaf.
    expect(
      measurements.alignItems,
      `a.breadcrumb align-items should be 'center' (was '${measurements.alignItems}')`
    ).toBe('center');

    // 2) Root and leaf must share the same font-size so case/weight carry
    //    hierarchy without reintroducing optical drift.
    expect(
      measurements.rootFontSize,
      `.breadcrumb-root font-size (${measurements.rootFontSize}) should equal .breadcrumb-leaf font-size (${measurements.leafFontSize})`
    ).toBe(measurements.leafFontSize);

    // 3) All three inner spans must share center-Y within 0.5px.
    const { root, sep, leaf } = measurements.centers;
    const centers = [root, sep, leaf];
    const spread = Math.max(...centers) - Math.min(...centers);
    expect(
      spread,
      `command-bar breadcrumb span center-Y spread ${spread}px should be ≤ 0.5px (root=${root.toFixed(2)}, sep=${sep.toFixed(2)}, leaf=${leaf.toFixed(2)})`
    ).toBeLessThanOrEqual(0.5);
  });
});

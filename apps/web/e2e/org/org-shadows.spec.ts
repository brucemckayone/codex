/**
 * The brand editor's shadow strength and colour reach the org's shadows
 * (Codex-hz5du).
 *
 * The scale (`--shadow-xs` … `--shadow-xl`) was composed on `:root` only, so
 * the org's `--shadow-strength` / `--shadow-color` (`org-brand.css`) changed
 * nothing. It is composed under each org's scope now (`shadows.css`).
 * of-blood-and-bones' seed sets shadow-scale 0.5 and no colour: its shadows
 * keep the theme's colour at half each layer's WHOLE opacity (owner, D19:
 * "Scale the whole shadow (Recommended)"): light 10% / 5% → 5% / 2.5%, dark
 * 34% / 29% → 17% / 14.5%. studio-beta sets no shadow at all, and the
 * platform has no org: both draw exactly the platform's shadows, in either
 * theme.
 *
 * Measured with probes (`box-shadow: var(--shadow-*)`) inside the org's main
 * and on `body`, outside any org scope, and on what paints them: explore's
 * cards and a sales page's floating bar (the org's card, D9).
 */

import { type Browser, expect, type Page, test } from '@playwright/test';

type Theme = 'light' | 'dark';

/** The platform's computed shadows, before and after this change. */
const PLATFORM: Record<Theme, { md: string; xl: string }> = {
  light: {
    md: 'rgba(37, 38, 39, 0.1) 0px 1px 3px 0px, rgba(37, 38, 39, 0.05) 0px 4px 6px -1px',
    xl: 'rgba(37, 38, 39, 0.1) 0px 1px 4px 0px, rgba(37, 38, 39, 0.05) 0px 16px 30px -4px',
  },
  dark: {
    md: 'rgba(3, 4, 7, 0.34) 0px 1px 3px 0px, rgba(3, 4, 7, 0.29) 0px 4px 6px -1px',
    xl: 'rgba(3, 4, 7, 0.34) 0px 1px 4px 0px, rgba(3, 4, 7, 0.29) 0px 16px 30px -4px',
  },
};
/** The seed's alphas: half of each layer's platform opacity (D19). */
const SEED_ALPHAS: Record<Theme, number[]> = {
  light: [0.05, 0.025],
  dark: [0.17, 0.145],
};

async function open(
  browser: Browser,
  url: string,
  theme: Theme
): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: theme,
  });
  await context.addCookies([
    { name: 'theme', value: theme, url: new URL(url).origin },
  ]);
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  return page;
}

/** Runs in the page: the scale inside the org's main and on body, and what
 * the page paints with it. */
function readShadows() {
  const probe = (host: Element, name: string) => {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;box-shadow:var(${name})`;
    host.appendChild(el);
    const value = getComputedStyle(el).boxShadow;
    el.remove();
    return value;
  };
  const main = document.querySelector('main#main-content, .org-main');
  const shadowOf = (sel: string) =>
    [...document.querySelectorAll<HTMLElement>(sel)].map(
      (el) => getComputedStyle(el).boxShadow
    );
  return {
    platform: {
      md: probe(document.body, '--shadow-md'),
      xl: probe(document.body, '--shadow-xl'),
    },
    org: main
      ? { md: probe(main, '--shadow-md'), xl: probe(main, '--shadow-xl') }
      : null,
    cards: shadowOf('.cc__thumb'),
    sticky: shadowOf('.lp-sticky'),
  };
}

const alphas = (shadow: string) =>
  [...shadow.matchAll(/rgba\([^)]*,\s*([\d.]+)\)/g)].map((m) => Number(m[1]));

const origin = (baseURL: string, org: string | null) => {
  const u = new URL(baseURL);
  return `${u.protocol}//${org ? `${org}.` : ''}${u.host}`;
};

for (const theme of ['light', 'dark'] as const) {
  test(`of-blood-and-bones ${theme}: its cards and floating bar take the brand's shadow scale`, async ({
    browser,
    baseURL,
  }) => {
    const host = origin(baseURL as string, 'of-blood-and-bones');
    for (const path of ['/explore', '/journeys/return-to-the-shoreline']) {
      const page = await open(browser, `${host}${path}`, theme);
      const read = await page.evaluate(readShadows);
      await page.context().close();
      const detail = `${path} ${JSON.stringify(read)}`;
      // Nothing outside the org changes.
      expect(read.platform, detail).toEqual(PLATFORM[theme]);
      expect(read.org, detail).not.toBeNull();
      if (!read.org) continue;
      expect(read.org.md, detail).not.toBe(PLATFORM[theme].md);
      const md = alphas(read.org.md);
      expect(md.length, detail).toBe(2);
      // A computed alpha is stored in 8 bits, so it lands on a step of 1/255
      // (0.025 is drawn as 6/255 = 0.0235): allow one step, far finer than
      // the gap between the seed's 0.05 and the platform's 0.1.
      for (const [i, a] of md.entries()) {
        expect(
          Math.abs(a - (SEED_ALPHAS[theme][i] ?? 0)),
          detail
        ).toBeLessThanOrEqual(1 / 255);
      }
      if (path === '/explore') {
        expect(read.cards.length, detail).toBeGreaterThan(0);
        for (const s of read.cards) expect(s, detail).toBe(read.org.md);
      } else {
        expect(read.sticky.length, detail).toBeGreaterThan(0);
        for (const s of read.sticky) expect(s, detail).toBe(read.org.xl);
        expect(read.org.xl, detail).not.toBe(PLATFORM[theme].xl);
      }
    }
  });

  test(`studio-beta and the platform ${theme}: no shadow set, the platform's shadows exactly`, async ({
    browser,
    baseURL,
  }) => {
    for (const host of [
      origin(baseURL as string, 'studio-beta'),
      origin(baseURL as string, null),
    ]) {
      const page = await open(
        browser,
        `${host}${host.includes('studio-beta') ? '/explore' : '/'}`,
        theme
      );
      const read = await page.evaluate(readShadows);
      await page.context().close();
      const detail = `${host} ${JSON.stringify(read)}`;
      expect(read.platform, detail).toEqual(PLATFORM[theme]);
      if (read.org) expect(read.org, detail).toEqual(PLATFORM[theme]);
      for (const s of read.cards) expect(s, detail).toBe(PLATFORM[theme].md);
    }
  });
}

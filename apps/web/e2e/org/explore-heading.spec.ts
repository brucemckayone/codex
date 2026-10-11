/**
 * Explore's page titles in the org's chosen heading colour (Codex-gxbu9).
 *
 * The brand editor's heading colour reaches the org's headings through
 * `--color-heading` (`org-brand.css`, declared under `[data-org-brand]`), the
 * token PageHeader and CardTitle read. Explore's own title, and its portal
 * and browse headings, read `--color-text-primary` instead, and their scoped
 * class beat the org's `[class*='__title']` backstop on source order: the
 * brand's heading colour never reached them. studio-alpha sets one (#E11D48
 * in light mode); measured against the org's own `--color-heading` and its
 * text colour, so the test cannot pass by both being the same.
 */

import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  test(`studio-alpha explore ${theme}: every page title is the org's heading colour`, async ({
    browser,
    baseURL,
  }) => {
    const origin = new URL(baseURL as string);
    const url = `${origin.protocol}//studio-alpha.${origin.host}/explore`;
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: theme,
    });
    await context.addCookies([
      { name: 'theme', value: theme, url: new URL(url).origin },
    ]);
    const page = await context.newPage();
    await page.goto(url);
    await expect(page.locator('.explore__title')).toBeVisible();
    const read = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no 2d context');
      const hex = (css: string) => {
        ctx.globalCompositeOperation = 'copy';
        ctx.fillStyle = '#000000';
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
        return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
      };
      const title = document.querySelector('.explore__title');
      const host = title?.parentElement;
      if (!host) throw new Error('no explore title');
      const token = (name: string) => {
        const probe = document.createElement('span');
        probe.style.cssText = `position:absolute;color:var(${name}, rgb(1, 2, 3))`;
        host.appendChild(probe);
        const value = hex(getComputedStyle(probe).color);
        probe.remove();
        return value;
      };
      return {
        heading: token('--color-heading'),
        text: token('--color-text-primary'),
        titles: [
          ...document.querySelectorAll<HTMLElement>(
            '.explore__title, .explore__journeys-title, .explore__browse-title'
          ),
        ].map((el) => ({
          cls: el.className,
          color: hex(getComputedStyle(el).color),
        })),
      };
    });
    await context.close();
    const detail = JSON.stringify(read);
    // The org sets a heading colour, and it is not its text colour.
    expect(read.heading, detail).not.toBe('#010203');
    expect(read.heading, detail).not.toBe(read.text);
    if (theme === 'light') expect(read.heading, detail).toBe('#e11d48');
    expect(read.titles.length, detail).toBeGreaterThan(0);
    for (const t of read.titles) expect(t.color, detail).toBe(read.heading);
  });
}

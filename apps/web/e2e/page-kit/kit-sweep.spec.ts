/**
 * The page kit's accessibility floor, drawn (Codex-61zsk.11; 01-contract §1):
 * every Style, in each of the gallery's four sample brands and the org's own,
 * in both themes, as a reader gets it (reduced motion: the final state).
 *
 * OPT-IN, LOCAL: `KIT_SWEEP=1 pnpm exec playwright test kit-sweep`. It drives
 * the page kit's gallery (`/studio/page-kit`), a development route that a
 * production build (CI's) does not have. Run it on any change to a Style, a
 * scheme, a brand's derivation or a block's markup.
 *
 * Per page it holds:
 *
 *   axe        no violation of a WCAG 2.2 A or AA rule (`wcag2a` … `wcag22aa`)
 *              inside the page (`.lp`); contrast everywhere but a Moving
 *              background's band, which axe cannot see (`helpers/axe`)
 *   headings   exactly one `<h1>`, and no heading skips a level going down
 *   targets    every kit button at least 44px (`--tap-target-min`) each way
 *   sideways   at 390 the page never scrolls sideways
 *
 * axe cannot read a colour drawn over a picture, a gradient or a
 * pseudo-element's ground: it reports those `incomplete`, counted in the log
 * by reason, not failed. The schemes' contrast is
 * held computationally, every scheme by every brand in both themes, by the
 * contrast matrix (`kit/styles/schemes.test.ts`); this is what only a browser
 * sees: the composed page.
 *
 * `KIT_SWEEP_STYLES=bold,poster`, `KIT_SWEEP_BRANDS=0,org`,
 * `KIT_SWEEP_THEMES=dark` and `KIT_SWEEP_WIDTHS=390` narrow the run.
 */
import { expect, type Page, test } from '@playwright/test';
import { PAGE_STYLE_IDS } from '../../src/lib/page-builder/kit/model/ids';
import { kitAxe } from '../helpers/axe';
import { captureSeededCreatorCookies } from '../helpers/subscription';

test.skip(!process.env.KIT_SWEEP, 'opt-in: KIT_SWEEP=1 (a development route)');
test.setTimeout(60 * 60_000);

const list = (name: string, fallback: readonly string[]) =>
  process.env[name]?.split(',') ?? [...fallback];
const STYLES = list('KIT_SWEEP_STYLES', PAGE_STYLE_IDS);
const BRANDS = list('KIT_SWEEP_BRANDS', ['0', '1', '2', '3', 'org']);
const THEMES = list('KIT_SWEEP_THEMES', ['light', 'dark']);
const WIDTHS = list('KIT_SWEEP_WIDTHS', ['1440', '390']).map(Number);
const TAP_TARGET_MIN = 44;

/** The page's own floor, beyond axe's rules (01-contract §1). */
async function floor(page: Page) {
  return page.evaluate((min) => {
    const lp = document.querySelector('.lp');
    const levels = [...(lp?.querySelectorAll('h1, h2, h3, h4, h5, h6') ?? [])]
      .filter((h) => h.getClientRects().length > 0)
      .map((h) => Number(h.tagName[1]));
    const skips = levels.flatMap((level, i) =>
      i > 0 && level > levels[i - 1] + 1
        ? [`h${levels[i - 1]} -> h${level}`]
        : []
    );
    const small = [...(lp?.querySelectorAll<HTMLElement>('.lp-button') ?? [])]
      .filter((b) => b.getClientRects().length > 0)
      .map((b) => ({ b, r: b.getBoundingClientRect() }))
      .filter(({ r }) => r.width < min - 0.5 || r.height < min - 0.5)
      .map(
        ({ b, r }) =>
          `"${b.textContent?.trim()}" ${Math.round(r.width)}x${Math.round(r.height)}`
      );
    return {
      h1: levels.filter((level) => level === 1).length,
      skips,
      small,
      sideways: document.documentElement.scrollWidth - innerWidth,
    };
  }, TAP_TARGET_MIN);
}

for (const style of STYLES)
  test(`${style}: every brand, both themes`, async ({ browser }) => {
    const cookies = await captureSeededCreatorCookies();
    /** What axe could not judge, by rule and its reason (`bgGradient`, `bgImage` …). */
    const unjudged = new Map<string, number>();
    for (const width of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      });
      await context.addCookies(cookies);
      const page = await context.newPage();
      try {
        for (const brand of BRANDS)
          for (const theme of THEMES) {
            const at = `${style} brand ${brand} ${theme} ${width}`;
            await page.goto(
              `http://studio-alpha.lvh.me:5173/studio/page-kit?style=${style}&brand=${brand}&theme=${theme}&chrome=0`
            );
            await expect(page.locator('.lp .lp-section').first()).toBeVisible({
              timeout: 90_000,
            });
            await page.evaluate(() => document.fonts.ready);
            await page
              .waitForLoadState('networkidle', { timeout: 30_000 })
              .catch(() => {});

            const axe = await kitAxe(page);
            for (const rule of axe.contrast.incomplete)
              for (const node of rule.nodes) {
                const why = `${rule.id}:${node.any[0]?.data?.messageKey ?? node.any[0]?.id ?? '?'}`;
                unjudged.set(why, (unjudged.get(why) ?? 0) + 1);
              }
            expect.soft(axe.violations, `${at}: axe`).toEqual([]);

            const drawn = await floor(page);
            expect.soft(drawn.h1, `${at}: one h1`).toBe(1);
            expect.soft(drawn.skips, `${at}: heading order`).toEqual([]);
            expect.soft(drawn.small, `${at}: buttons under 44px`).toEqual([]);
            if (width < 600)
              expect
                .soft(drawn.sideways, `${at}: scrolls sideways`)
                .toBeLessThanOrEqual(0);
          }
      } finally {
        await context.close();
      }
    }
    const reasons = [...unjudged].sort((a, b) => b[1] - a[1]);
    console.log(
      `${style}: axe could not judge ${reasons.reduce((n, [, c]) => n + c, 0)} node(s): ${reasons.map(([why, c]) => `${why} ${c}`).join(', ')}`
    );
  });

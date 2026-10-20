/**
 * A sales page holds the accessibility floor and keeps still as it loads
 * (Codex-61zsk.11; 01-contract §1). Every seeded page — four Styles across
 * three org brands — signed out, as a buyer meets it:
 *
 *   axe      no violation of a WCAG 2.2 A or AA rule inside the page (`.lp`),
 *            light and dark, at 1440 and 390 (reduced motion: the final state);
 *            contrast everywhere but a Moving background's band (`helpers/axe`)
 *   one h1   exactly one on the whole document, and no heading inside the
 *            page skips a level going down
 *   still    the layout shift as it loads (motion on), at 1440 and 390:
 *            under 0.1 (the "good" band) with its fonts loading, and under
 *            SHIFT_OWN with every font file refused. A face that lands late
 *            re-wraps its lines (the fallback is metric-matched to Inter,
 *            not to every brand face), and how late it lands is the network's;
 *            with fonts refused what moves is the page's own (a late button,
 *            an image without its box), and that is held tight
 *   largest  the largest paint is in the hero, not a late block under it
 *
 * The contrast of every scheme by every brand is held computationally by the
 * contrast matrix (`kit/styles/schemes.test.ts`); the gallery sweep
 * (`page-kit/kit-sweep.spec.ts`, opt-in) draws every Style the same way.
 */
import { type Browser, expect, test } from '@playwright/test';
import { kitAxe } from '../helpers/axe';
import {
  expectSellPageRendered,
  JOURNEY_FIXTURES,
  journeyUrl,
  orgUrl,
} from '../helpers/journeys';

const SHIFT_GOOD = 0.1;
const SHIFT_OWN = 0.01;

/** A buyer's browser: signed out (a fresh context), in one theme. */
async function buyer(
  browser: Browser,
  baseURL: string,
  org: string,
  options: { width: number; theme: string; still: boolean; fonts: boolean }
) {
  const context = await browser.newContext({
    viewport: { width: options.width, height: 900 },
    reducedMotion: options.still ? 'reduce' : 'no-preference',
  });
  await context.addCookies([
    {
      name: 'theme',
      value: options.theme,
      url: new URL(orgUrl(baseURL, org, '/')).origin,
    },
  ]);
  if (!options.fonts)
    await context.route('**/*', (route) =>
      route.request().resourceType() === 'font'
        ? route.abort()
        : route.continue()
    );
  return context;
}

/** Layout shift and the largest paint, from the first byte. */
function observe() {
  const state = {
    shift: 0,
    sources: [] as string[],
    largest: null as Element | null,
  };
  (window as unknown as { __lp: typeof state }).__lp = state;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as (PerformanceEntry & {
      value: number;
      hadRecentInput: boolean;
      sources?: { node?: Node | null }[];
    })[]) {
      if (entry.hadRecentInput) continue;
      state.shift += entry.value;
      for (const source of entry.sources ?? []) {
        const node =
          source.node instanceof Element
            ? source.node
            : source.node?.parentElement;
        const type =
          node?.closest<HTMLElement>('[data-lp-type]')?.dataset.lpType ??
          node?.tagName ??
          '?';
        state.sources.push(`${type} ${entry.value.toFixed(4)}`);
      }
    }
  }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((list) => {
    const last = list.getEntries().at(-1) as
      | (PerformanceEntry & { element?: Element | null })
      | undefined;
    if (last?.element) state.largest = last.element;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
}

for (const fixture of JOURNEY_FIXTURES)
  test.describe(`${fixture.org}/${fixture.pageSlug}`, () => {
    test('holds the accessibility floor, light and dark', async ({
      browser,
      baseURL,
    }) => {
      for (const width of [1440, 390])
        for (const theme of ['light', 'dark']) {
          const context = await buyer(browser, baseURL as string, fixture.org, {
            width,
            theme,
            still: true,
            fonts: true,
          });
          const page = await context.newPage();
          try {
            const at = `${theme} ${width}`;
            await page.goto(journeyUrl(baseURL as string, fixture));
            await expectSellPageRendered(page, fixture);
            await page.evaluate(() => document.fonts.ready);

            expect
              .soft((await kitAxe(page)).violations, `${at}: axe`)
              .toEqual([]);

            const headings = await page.evaluate(() => ({
              h1: document.querySelectorAll('h1').length,
              levels: [
                ...document.querySelectorAll('.lp :is(h1, h2, h3, h4, h5, h6)'),
              ]
                .filter((h) => h.getClientRects().length > 0)
                .map((h) => Number(h.tagName[1])),
            }));
            expect.soft(headings.h1, `${at}: one h1`).toBe(1);
            expect
              .soft(
                headings.levels.flatMap((level, i) =>
                  i > 0 && level > headings.levels[i - 1] + 1
                    ? [`h${headings.levels[i - 1]} -> h${level}`]
                    : []
                ),
                `${at}: heading order`
              )
              .toEqual([]);
          } finally {
            await context.close();
          }
        }
    });

    test('keeps still as it loads', async ({ browser, baseURL }) => {
      for (const width of [1440, 390])
        for (const fonts of [true, false]) {
          const context = await buyer(browser, baseURL as string, fixture.org, {
            width,
            theme: 'light',
            still: false,
            fonts,
          });
          await context.addInitScript(observe);
          const page = await context.newPage();
          try {
            const at = `${width} fonts ${fonts ? 'loading' : 'refused'}`;
            await page.goto(journeyUrl(baseURL as string, fixture));
            await expectSellPageRendered(page, fixture);
            await page.evaluate(() => document.fonts.ready);
            await page
              .waitForLoadState('networkidle', { timeout: 30_000 })
              .catch(() => {});
            await page.waitForTimeout(1500);
            const read = await page.evaluate(() => {
              const state = (
                window as unknown as {
                  __lp: {
                    shift: number;
                    sources: string[];
                    largest: Element | null;
                  };
                }
              ).__lp;
              const first = document.querySelector('.lp .lp-section');
              return {
                shift: state.shift,
                sources: state.sources,
                largest: state.largest
                  ? `${state.largest.closest<HTMLElement>('[data-lp-type]')?.dataset.lpType ?? '-'} ${state.largest.tagName}`
                  : null,
                inHero: Boolean(
                  state.largest && first?.contains(state.largest)
                ),
              };
            });
            console.log(
              `${fixture.org}/${fixture.pageSlug} ${at}: shift ${read.shift.toFixed(4)} [${read.sources.join(', ')}] largest ${read.largest}`
            );
            expect
              .soft(
                read.shift,
                `${at}: layout shift ${read.sources.join(', ')}`
              )
              .toBeLessThan(fonts ? SHIFT_GOOD : SHIFT_OWN);
            if (fonts)
              expect
                .soft(
                  read.inHero,
                  `${at}: the largest paint is ${read.largest}`
                )
                .toBe(true);
          } finally {
            await context.close();
          }
        }
    });
  });

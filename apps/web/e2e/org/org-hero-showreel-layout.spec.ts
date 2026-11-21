/**
 * The Showreel's parts in flow (Codex-1yd58.6, WP-5b): the top bar, the
 * words, the index or the strip, and the pause laid out in a grid the hero
 * grows round when the screen is short, instead of placed on it.
 *
 * - On a tall screen nothing moves: every part's box is where HEAD placed it.
 * - On a short one (a phone held sideways, a small one, a short laptop
 *   window), peek on or off, the hero holds its top bar, words and index or
 *   strip inside it and apart: never clipped by its overflow (owner,
 *   2026-11-21; WCAG 2.4.11, a tabbable index item hidden by it).
 * - The words' slot is the tallest piece's (its sizers), so a hero grown to
 *   hold it keeps its height as the pieces change; and the sizers, hidden
 *   copies of every piece's words, are met by neither axe nor the tab order.
 *
 * Measured on of-blood-and-bones without a DB write, through
 * `helpers/showreel.ts` (see org-hero-showreel.spec.ts).
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { WCAG_TAGS } from '../helpers/axe';
import { openShowreel as open, SHOWREEL_LAUNCH } from '../helpers/showreel';

test.use(SHOWREEL_LAUNCH);

const PARTS = {
  top: '.reel__top',
  window: '.reel__window',
  words: '.reel__words',
  index: '.reel__index',
  strip: '.reel__strip',
  ctl: '.reel__ctl',
} as const;
type Part = keyof typeof PARTS;
/** A box's top, bottom, left and right, in px from the hero's top left. */
type Box = [number, number, number, number];
type Boxes = { hero: { width: number; height: number } } & Partial<
  Record<Part, Box>
>;

/** Each part's box in the hero, or none where it is not laid out. */
function boxes(page: Page): Promise<Boxes> {
  return page.evaluate((parts) => {
    const reel = document.querySelector('.reel');
    const hero = reel?.getBoundingClientRect();
    if (!reel || !hero) throw new Error('no reel');
    const out: Record<string, unknown> = {
      hero: { width: hero.width, height: hero.height },
    };
    for (const [part, selector] of Object.entries(parts)) {
      const r = reel.querySelector(selector)?.getBoundingClientRect();
      if (r && r.width > 1 && r.height > 1) {
        out[part] = [
          r.top - hero.top,
          r.bottom - hero.top,
          r.left - hero.left,
          r.right - hero.left,
        ];
      }
    }
    return out as Boxes;
  }, PARTS);
}

/**
 * The piece numbered `n` on show, its words in: the words come in at the
 * cut's bottom and rise into place, so a box read sooner is mid-rise.
 */
async function onShow(page: Page, n: number) {
  const number = String(n).padStart(2, '0');
  await expect(page.locator('.reel__words .reel__kicker b')).toHaveText(
    number,
    { timeout: 15_000 }
  );
  await expect(page.locator('.reel__words')).not.toHaveAttribute(
    'data-swap',
    'out'
  );
  await page.evaluate(() =>
    Promise.all(
      [...document.querySelectorAll('.reel__words, .reel__words *')]
        .flatMap((el) => el.getAnimations())
        .map((animation) => animation.finished)
    )
  );
}

/** The fit has measured the words (the name window sizes its name). */
const fitted = (page: Page) =>
  expect(page.locator('.reel')).toHaveAttribute('data-fit', /.*/, {
    timeout: 30_000,
  });

test.describe('the Showreel in flow (WP-5b)', () => {
  /**
   * The first piece's parts as HEAD placed them (d4c3b9fb8, the last build
   * with the parts placed on the reel), on the seeded OBB with the peek on,
   * read by `boxes` once its words were in. They follow from the layout's
   * CSS but for the words' and the index's tops, which follow from OBB's
   * first piece and its titles at that width, so a change to OBB's seeded
   * pieces moves those two and nothing else.
   *
   * One part moves on purpose: Corner's pause on a phone. HEAD left it a grid
   * item there, so its `top` was taken from the foot's grid cell, under the
   * words at the bottom right (674 px down); it is now top right, beside the
   * segments, where every other layout keeps it (the mock's), as Wide's is.
   */
  const HEAD: Record<string, Boxes> = {
    'corner 1440x900': {
      hero: { width: 1385.6, height: 772.5 },
      top: [34, 68, 81.6, 1304],
      words: [291.8, 704.5, 81.6, 857.5],
      index: [296.2, 704.5, 920, 1304],
      ctl: [296.2, 326.8, 1273.4, 1304],
    },
    'wide 1440x900': {
      hero: { width: 1385.6, height: 772.5 },
      top: [34, 68, 81.6, 1304],
      words: [426.2, 677.3, 81.6, 1304],
      strip: [700.6, 741.9, 81.6, 1304],
      ctl: [711.3, 741.9, 1273.4, 1304],
    },
    'corner 390x844': {
      hero: { width: 390, height: 731.8 },
      top: [47.6, 81.6, 13.6, 376.4],
      words: [377.5, 657, 13.6, 376.4],
      // HEAD: [674, 704.6, 345.8, 376.4] (see above).
      ctl: [10.2, 40.8, 345.8, 376.4],
    },
    'wide 390x844': {
      hero: { width: 390, height: 731.8 },
      top: [47.6, 81.6, 13.6, 376.4],
      words: [403.5, 657, 13.6, 376.4],
      ctl: [10.2, 40.8, 345.8, 376.4],
    },
  };

  for (const [cell, head] of Object.entries(HEAD)) {
    const [layout, size] = cell.split(' ');
    const [width, height] = size.split('x').map(Number);
    test(`a tall screen: ${layout} at ${size}, every part where HEAD placed it`, async ({
      browser,
      baseURL,
    }) => {
      const page = await open(browser, baseURL, {
        context: { viewport: { width, height } },
        keys: { 'reel-layout': layout },
      });
      await fitted(page);
      await onShow(page, 1);
      const now = await boxes(page);
      expect.soft(now.hero.width, 'hero width').toBeCloseTo(head.hero.width, 0);
      expect
        .soft(now.hero.height, 'hero height')
        .toBeCloseTo(head.hero.height, 0);
      for (const part of Object.keys(PARTS) as Part[]) {
        const was = head[part];
        const is = now[part];
        if (!was) {
          expect
            .soft(is, `${part}: laid out where HEAD had none`)
            .toBeUndefined();
          continue;
        }
        expect.soft(is, `${part}: laid out`).toBeDefined();
        if (!is) continue;
        ['top', 'bottom', 'left', 'right'].forEach((edge, i) => {
          expect
            .soft(
              Math.abs(is[i] - was[i]),
              `${part} ${edge}: ${is[i]} (HEAD ${was[i]})`
            )
            .toBeLessThanOrEqual(1);
        });
      }
      await page.context().close();
    });
  }

  for (const layout of ['corner', 'wide', 'name'] as const) {
    for (const viewport of [
      { width: 844, height: 390 }, // a phone held sideways: the desktop lift
      { width: 667, height: 375 }, // a small phone held sideways: the phone lift
      { width: 1280, height: 560 }, // a short laptop window
    ]) {
      for (const peek of ['on', 'off'] as const) {
        const size = `${viewport.width}x${viewport.height}`;
        test(`a short screen: ${layout} at ${size}, peek ${peek}: the hero's top, words and index fit inside it, apart`, async ({
          browser,
          baseURL,
        }) => {
          test.fixme(
            layout === 'name',
            'owner decision pending: Name height bound'
          );
          const page = await open(browser, baseURL, {
            context: { viewport },
            keys: { 'reel-layout': layout, 'reel-peek': peek },
          });
          await fitted(page);
          await onShow(page, 1);
          const now = await boxes(page);
          // The pause sits over the strip's last column (Wide, Name) and
          // the index's top (Corner), by design: judged inside, not apart.
          const shown = (Object.keys(PARTS) as Part[]).flatMap((part) => {
            const box = now[part];
            return box ? [[part, box] as const] : [];
          });
          expect(shown.map(([part]) => part)).toContain('words');
          for (const [part, [top, bottom]] of shown) {
            expect.soft(top, `${part} top`).toBeGreaterThanOrEqual(-0.5);
            expect
              .soft(bottom, `${part} bottom`)
              .toBeLessThanOrEqual(now.hero.height + 0.5);
          }
          const apart = shown.filter(([part]) => part !== 'ctl');
          for (let i = 0; i < apart.length; i++) {
            for (let j = i + 1; j < apart.length; j++) {
              const [pa, a] = apart[i];
              const [pb, b] = apart[j];
              const overlap =
                a[2] < b[3] && b[2] < a[3] && a[0] < b[1] && b[0] < a[1];
              expect.soft(overlap, `${pa} overlaps ${pb}`).toBe(false);
            }
          }
          await page.context().close();
        });
      }
    }
  }

  for (const layout of ['corner', 'wide', 'name'] as const) {
    test(`the sizers: ${layout} on a short screen keeps its height as the pieces change, each sizer its piece's words to the pixel`, async ({
      browser,
      baseURL,
    }) => {
      const page = await open(browser, baseURL, {
        context: { viewport: { width: 844, height: 390 } },
        keys: { 'reel-layout': layout },
      });
      await fitted(page);
      const pieces = await page.locator('.reel__sizers > .reel__sizer').count();
      expect(pieces).toBeGreaterThan(1);
      const heights: number[] = [];
      for (let n = 1; n <= pieces; n++) {
        if (n > 1)
          await page
            .locator('.reel__item')
            .nth(n - 1)
            .click();
        // Off the words, the index and the strip, so nothing holds the reel.
        await page.mouse.move(10, 10);
        await onShow(page, n);
        const read = await page.evaluate((k) => {
          const reel = document.querySelector('.reel');
          const words = reel?.querySelector('.reel__words');
          const sizer = reel?.querySelectorAll('.reel__sizer')[k];
          const slot = reel?.querySelector('.reel__slot');
          if (!reel || !words || !sizer || !slot) return null;
          const tallest = Math.max(
            ...[...reel.querySelectorAll('.reel__sizer')].map(
              (s) => s.getBoundingClientRect().height
            )
          );
          const w = words.getBoundingClientRect();
          const s = sizer.getBoundingClientRect();
          return {
            hero: reel.getBoundingClientRect().height,
            words: [w.top, w.bottom, w.left, w.right],
            sizer: [s.top, s.bottom, s.left, s.right],
            slot: slot.getBoundingClientRect().height,
            tallest,
            hidden: getComputedStyle(sizer).visibility,
          };
        }, n - 1);
        expect(read).not.toBeNull();
        if (!read) return;
        // The piece's sizer lays its words out as they show: a sizer that
        // drifted from the words would hold the slot at the wrong height.
        read.words.forEach((edge, i) => {
          expect
            .soft(Math.abs(edge - read.sizer[i]), `piece ${n}: sizer edge ${i}`)
            .toBeLessThanOrEqual(0.5);
        });
        expect
          .soft(read.slot, `piece ${n}: the slot`)
          .toBeCloseTo(read.tallest, 1);
        expect(read.hidden).toBe('hidden');
        heights.push(read.hero);
      }
      // The hero's height never changes with the piece (in flow, without the
      // sizers, Wide here went 406 to 444 px and back).
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(
        0.5
      );
      await page.context().close();
    });
  }

  for (const layout of ['corner', 'wide', 'name'] as const) {
    test(`the sizers: ${layout}, axe and the tab order never meet them`, async ({
      browser,
      baseURL,
    }) => {
      const page = await open(browser, baseURL, {
        keys: { 'reel-layout': layout },
      });
      await fitted(page);
      await expect(
        page.locator('.reel__sizers > .reel__sizer')
      ).not.toHaveCount(0);
      // Contrast is the fit's, over a film axe cannot see (a canvas): it
      // has its own tests in org-hero-showreel.spec.ts.
      const axe = await new AxeBuilder({ page })
        .include('.reel')
        .withTags(WCAG_TAGS)
        .disableRules(['color-contrast'])
        .analyze();
      expect(
        axe.violations.flatMap((rule) =>
          rule.nodes.map((node) => `${rule.id}: ${node.target.join(' ')}`)
        )
      ).toEqual([]);
      // What axe judged inside them: only that they hold nothing focusable.
      const inSizers = await new AxeBuilder({ page })
        .include('.reel__sizers')
        .withTags(WCAG_TAGS)
        .analyze();
      expect(
        [
          ...inSizers.violations,
          ...inSizers.incomplete,
          ...inSizers.passes,
        ].flatMap((rule) => rule.nodes.map(() => rule.id))
      ).toEqual(
        inSizers.passes.some((rule) => rule.id === 'aria-hidden-focus')
          ? ['aria-hidden-focus']
          : []
      );

      // Every stop from the pause on, until focus leaves the hero.
      await page.locator('.reel__ctl button').focus();
      const stops: { sizer: boolean; label: string }[] = [];
      for (let i = 0; i < 40; i++) {
        const at = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el?.closest('.reel')) return null;
          return {
            sizer: el.closest('.reel__sizers') !== null,
            label: `${el.tagName.toLowerCase()}.${el.className}`,
          };
        });
        if (!at) break;
        stops.push(at);
        await page.keyboard.press('Tab');
      }
      expect(stops.length).toBeGreaterThan(2);
      expect(stops.filter((stop) => stop.sizer)).toEqual([]);
      // Every stop is one of the hero's own controls, each met once.
      const controls = await page.evaluate(
        () =>
          [
            ...document.querySelectorAll<HTMLElement>(
              '.reel :is(a[href], button, [tabindex]:not([tabindex="-1"]))'
            ),
          ].filter(
            (el) =>
              !el.closest('.reel__sizers') &&
              !el.closest('[inert]') &&
              el.getClientRects().length > 0 &&
              getComputedStyle(el).visibility !== 'hidden'
          ).length
      );
      expect(stops).toHaveLength(controls);
      await page.context().close();
    });
  }
});

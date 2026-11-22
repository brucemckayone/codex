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
   *
   * And the top bar's foot on a phone (WP-5a): the org's name wraps to two
   * lines there, so the bar ends at 103 px, not 81.6; the words, the pause
   * and the hero stay where they were (the 1fr row takes it).
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
      // HEAD: [47.6, 81.6, 13.6, 376.4] (see above).
      top: [47.6, 103, 13.6, 376.4],
      words: [377.5, 657, 13.6, 376.4],
      // HEAD: [674, 704.6, 345.8, 376.4] (see above).
      ctl: [10.2, 40.8, 345.8, 376.4],
    },
    'wide 390x844': {
      hero: { width: 390, height: 731.8 },
      // HEAD: [47.6, 81.6, 13.6, 376.4] (see above).
      top: [47.6, 103, 13.6, 376.4],
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
          const box = (el: Element | null | undefined) => {
            const r = el?.getBoundingClientRect();
            return r ? [r.width, r.height, r.left, r.right, r.bottom] : [];
          };
          const parts = (root: Element) => ({
            kicker: box(root.querySelector('.reel__kicker')),
            title: box(root.querySelector('.reel__title')),
            row: box(root.querySelector('.reel__row')),
            all: box(root),
          });
          const heldTitle = sizer.querySelector('.reel__title');
          return {
            hero: reel.getBoundingClientRect().height,
            words: parts(words),
            sizer: parts(sizer),
            heldSize: heldTitle
              ? Number.parseFloat(getComputedStyle(heldTitle).fontSize)
              : 0,
            slot: slot.getBoundingClientRect().height,
            tallest,
            hidden: getComputedStyle(sizer).visibility,
          };
        }, n - 1);
        expect(read).not.toBeNull();
        if (!read) return;
        // The piece's sizer lays its words out as they show, part by part:
        // one that drifted from the words would hold the slot at the wrong
        // height. Wide's title alone is held at its most, on its one line
        // (WIDE_TITLE.max, review r5 S5), so it is never short of the fit.
        const held = layout === 'wide';
        for (const part of ['kicker', 'title', 'row'] as const) {
          const [ww, wh, wl, wr] = read.words[part];
          const [sw, sh, sl, sr] = read.sizer[part];
          for (const [what, a, b] of [
            ['width', ww, sw],
            ['left', wl, sl],
            ['right', wr, sr],
          ] as const) {
            expect
              .soft(Math.abs(a - b), `piece ${n}: ${part} ${what}`)
              .toBeLessThanOrEqual(0.5);
          }
          if (part === 'title' && held) {
            expect
              .soft(read.heldSize, `piece ${n}: held title`)
              .toBeGreaterThanOrEqual(150);
            expect
              .soft(Math.abs(sh - read.heldSize), `piece ${n}: one line`)
              .toBeLessThanOrEqual(0.5);
            expect
              .soft(sh, `piece ${n}: never short of the title`)
              .toBeGreaterThanOrEqual(wh - 0.5);
          } else {
            expect
              .soft(Math.abs(wh - sh), `piece ${n}: ${part} height`)
              .toBeLessThanOrEqual(0.5);
          }
        }
        // And the whole: the same bottom, the same height but the held title's.
        const titleGap = read.sizer.title[1] - read.words.title[1];
        expect
          .soft(
            Math.abs(read.sizer.all[1] - read.words.all[1] - titleGap),
            `piece ${n}: sizer height`
          )
          .toBeLessThanOrEqual(0.5);
        expect
          .soft(
            Math.abs(read.sizer.all[4] - read.words.all[4]),
            `piece ${n}: sizer bottom`
          )
          .toBeLessThanOrEqual(0.5);
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

  // Review r5 S5: the server paints Wide's titles at their CSS size and the
  // fit sets each its own after hydration. Read the hero as fitted, then with
  // every title in the slot stripped of its inline size (the server's paint),
  // then fitted again: before the sizers held the title at its most, a short
  // screen's hero grew 17-21 px when the fit landed.
  for (const viewport of [
    { width: 844, height: 390 },
    { width: 1280, height: 560 },
  ]) {
    test(`Wide at ${viewport.width}x${viewport.height}: the hero is one height before the title fit and after it (review r5 S5)`, async ({
      browser,
      baseURL,
    }) => {
      const page = await open(browser, baseURL, {
        context: { viewport },
        keys: { 'reel-layout': 'wide' },
      });
      await fitted(page);
      await page.evaluate(() => document.fonts.ready);
      const read = await page.evaluate(() => {
        const reel = document.querySelector('.reel');
        const visible = document.querySelector<HTMLElement>(
          '.reel__words .reel__title'
        );
        if (!reel || !visible) return null;
        const titles = [
          ...document.querySelectorAll<HTMLElement>('.reel__slot .reel__title'),
        ];
        const height = () => reel.getBoundingClientRect().height;
        const fitted = height();
        const fittedSize = getComputedStyle(visible).fontSize;
        const saved = titles.map((t) => t.style.fontSize);
        for (const t of titles) t.style.fontSize = '';
        const painted = height();
        const paintedSize = getComputedStyle(visible).fontSize;
        titles.forEach((t, i) => {
          t.style.fontSize = saved[i];
        });
        return { fitted, painted, again: height(), fittedSize, paintedSize };
      });
      expect(read).not.toBeNull();
      if (!read) return;
      // The instrument: stripping the fit's size changed the title's size,
      // and putting it back restored the hero.
      expect(read.paintedSize).not.toBe(read.fittedSize);
      expect(Math.abs(read.again - read.fitted)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(read.fitted - read.painted)).toBeLessThanOrEqual(0.5);
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

/**
 * The org's name in the top bar (WP-5a, Codex-1yd58.6). On a phone it wraps
 * to balanced lines no longer than 7em, so it stays where the header's left
 * shade carries it: on one line OBB's reached 0.66 of a 390 reel and read
 * 3.2-4.3:1 in 'shadow'. A word longer than the measure keeps its width; one
 * longer than any phone's bar takes a step down and breaks where it must.
 * On a desktop it is as it was, whatever its length.
 */
test.describe("the org's name in the top bar (WP-5a)", () => {
  type Edge = { top: number; bottom: number; left: number; right: number };
  /**
   * The name's lines and box, the logo's, the pause's and the bar's, in the
   * hero: the top bar's `.reel__name`, never the words, which `withOrgName`
   * retitles with it where a film carries the org's name.
   */
  const nameAt = (page: Page) =>
    page.evaluate(() => {
      const reel = document.querySelector('.reel');
      const name = reel?.querySelector<HTMLElement>('.reel__name');
      if (!reel || !name) throw new Error('no name');
      const hero = reel.getBoundingClientRect();
      const box = (r?: DOMRect) =>
        r && {
          top: r.top - hero.top,
          bottom: r.bottom - hero.top,
          left: r.left - hero.left,
          right: r.right - hero.left,
        };
      const range = document.createRange();
      range.selectNodeContents(name);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.5);
      const tops = [...new Set(rects.map((r) => Math.round(r.top)))].sort(
        (a, b) => a - b
      );
      const lines = tops.map((top) => {
        const on = rects.filter((r) => Math.round(r.top) === top);
        return {
          top: Math.min(...on.map((r) => r.top)) - hero.top,
          bottom: Math.max(...on.map((r) => r.bottom)) - hero.top,
          left: Math.min(...on.map((r) => r.left)) - hero.left,
          right: Math.max(...on.map((r) => r.right)) - hero.left,
        };
      });
      const inner = reel.querySelector('.reel__inner') ?? reel;
      return {
        width: hero.width,
        gutter: Number.parseFloat(getComputedStyle(inner).paddingRight),
        size: Number.parseFloat(getComputedStyle(name).fontSize),
        longWord: name.hasAttribute('data-long-word'),
        lines,
        name: box(name.getBoundingClientRect()),
        logo: box(
          reel.querySelector('.reel__sig img')?.getBoundingClientRect()
        ),
        pause: box(reel.querySelector('.reel__ctl')?.getBoundingClientRect()),
        top: box(reel.querySelector('.reel__top')?.getBoundingClientRect()),
      };
    });
  const overlap = (a?: Edge, b?: Edge) =>
    !!a &&
    !!b &&
    a.left < b.right &&
    b.left < a.right &&
    a.top < b.bottom &&
    b.top < a.bottom;
  /** The name as it would lay out with no measure: the rule set aside. */
  const UNRULED =
    '.reel .reel__name { max-inline-size: none !important; min-inline-size: auto !important; text-wrap: wrap !important; }';
  /** Still and filmless, so two shots of the bar differ only where it does. */
  const STILL =
    '.reel *, .reel *::before, .reel *::after { animation: none !important; transition: none !important; } .shader-hero--fullpage, .reel-stage { visibility: hidden !important; } .reel { background: #000 !important; }';
  const frames = (page: Page) =>
    page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done))
        )
    );
  /** Inside the reel and clear of the pause and the logo, every line of it. */
  async function inside(page: Page) {
    const at = await nameAt(page);
    for (const [i, line] of at.lines.entries()) {
      expect
        .soft(line.right, `line ${i + 1} right`)
        .toBeLessThanOrEqual(at.width - at.gutter + 0.5);
      expect
        .soft(overlap(line, at.pause), `line ${i + 1} under the pause`)
        .toBe(false);
      expect
        .soft(overlap(line, at.logo), `line ${i + 1} over the logo`)
        .toBe(false);
    }
    return at;
  }

  for (const layout of ['corner', 'wide'] as const) {
    test(`OBB's name on a phone (${layout}): two balanced lines within the measure, the logo beside the first, inside the reel`, async ({
      browser,
      baseURL,
    }) => {
      const page = await open(browser, baseURL, {
        context: { viewport: { width: 390, height: 844 } },
        keys: { 'reel-layout': layout },
      });
      await fitted(page);
      const at = await inside(page);
      expect(at.lines).toHaveLength(2);
      // OBB's own name, so its own words: the bar, two lines tall, stays
      // clear of them.
      const wordsTop = await page.evaluate(() => {
        const hero = document.querySelector('.reel')?.getBoundingClientRect();
        const words = document
          .querySelector('.reel__words')
          ?.getBoundingClientRect();
        return hero && words ? words.top - hero.top : null;
      });
      expect(wordsTop, 'the words').not.toBeNull();
      expect(at.top?.bottom, 'the bar').toBeDefined();
      expect(at.top?.bottom ?? 0).toBeLessThanOrEqual((wordsTop ?? 0) + 0.5);
      for (const line of at.lines) {
        expect(line.right - line.left).toBeLessThanOrEqual(7 * at.size + 0.5);
      }
      // As the board's (c) shows: the logo beside the first line, centred on
      // the name's two.
      const [first] = at.lines;
      if (!first || !at.logo || !at.name) throw new Error('no logo or name');
      expect(at.logo.top).toBeLessThan(first.bottom);
      expect(at.logo.bottom).toBeGreaterThan(first.top);
      expect(
        Math.abs(
          (at.logo.top + at.logo.bottom) / 2 -
            (at.name.top + at.name.bottom) / 2
        )
      ).toBeLessThanOrEqual(1);
      await page.context().close();
    });
  }

  test('a short name on a phone: one line, pixel-equal to it with no measure', async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL, {
      context: { viewport: { width: 390, height: 844 } },
      name: 'Studio Nine',
    });
    await fitted(page);
    await page.addStyleTag({ content: STILL });
    await frames(page);
    const ruled = await nameAt(page);
    expect(ruled.lines).toHaveLength(1);
    const shot = await page.locator('.reel__sig').screenshot();
    await page.addStyleTag({ content: UNRULED });
    await frames(page);
    expect(await nameAt(page)).toEqual(ruled);
    expect((await page.locator('.reel__sig').screenshot()).equals(shot)).toBe(
      true
    );
    await page.context().close();
  });

  test('a long name on a phone: the lines it needs and no more, inside the reel, clear of the logo and the pause', async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL, {
      context: { viewport: { width: 390, height: 844 } },
      name: 'The Northern Centre for Somatic Movement and Breathwork',
    });
    await fitted(page);
    const at = await inside(page);
    expect(at.lines.length).toBeGreaterThan(2);
    for (const line of at.lines) {
      expect(line.right - line.left).toBeLessThanOrEqual(7 * at.size + 0.5);
    }
    // Balanced, never more lines than the measure filled greedily takes.
    await page.addStyleTag({
      content: '.reel .reel__name { text-wrap: wrap !important; }',
    });
    await frames(page);
    expect(at.lines.length).toBeLessThanOrEqual(
      (await nameAt(page)).lines.length
    );
    await page.context().close();
  });

  for (const [name, broken] of [
    ['Transformationals Studio', false],
    ['Psychoneuroimmunologicalness Studio', true],
  ] as const) {
    test(`a ${broken ? 'word longer than any phone bar' : '17-letter word'} on a 320 phone: ${broken ? 'a step down, broken, never past the reel' : 'whole, inside the reel'}`, async ({
      browser,
      baseURL,
    }) => {
      const page = await open(browser, baseURL, {
        context: { viewport: { width: 320, height: 700 } },
        name,
      });
      await fitted(page);
      const at = await inside(page);
      expect(at.longWord).toBe(broken);
      const word = name.split(' ')[0] ?? '';
      // The word whole is on one line: some line holds it alone or with more.
      const whole = await page.evaluate((w) => {
        const el = document.querySelector('.reel__name');
        const text = el?.firstChild;
        if (!el || !text) return false;
        const at = (el.textContent ?? '').indexOf(w);
        const range = document.createRange();
        range.setStart(text, at);
        range.setEnd(text, at + w.length);
        return (
          new Set([...range.getClientRects()].map((r) => Math.round(r.top)))
            .size === 1
        );
      }, word);
      expect(whole).toBe(!broken);
      await page.context().close();
    });
  }

  test('a long name on a desktop: one line, as it was with no measure', async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL, {
      name: 'The Northern Centre for Somatic Movement',
    });
    await fitted(page);
    const ruled = await nameAt(page);
    expect(ruled.lines).toHaveLength(1);
    expect(ruled.longWord).toBe(false);
    await page.addStyleTag({ content: UNRULED });
    await frames(page);
    expect(await nameAt(page)).toEqual(ruled);
    await page.context().close();
  });
});

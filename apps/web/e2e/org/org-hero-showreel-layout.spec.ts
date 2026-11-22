/**
 * The Showreel's parts in flow (Codex-1yd58.6, WP-5b): the top bar, the
 * words, the index or the strip, and the pause laid out in a grid the hero
 * grows round when the screen is short, instead of placed on it.
 *
 * - On a tall screen the hero stops a lift short of the screen, with the
 *   parts HEAD laid out, each where CSS draws it, the pause where HEAD kept it.
 * - On a short one (a phone held sideways, a small one, a short laptop
 *   window), peek on or off, the hero holds its top bar, words and index or
 *   strip inside it and apart: never clipped by its overflow (owner,
 *   2026-11-21; WCAG 2.4.11, a tabbable index item hidden by it). Its big
 *   type shrinks with the room, never under the floor, and every box is
 *   CSS's from the server's first paint (the owner's floor, 2026-11-22).
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
   * The owner's floor on a short screen (2026-11-22), with no hydration
   * shift: the big type (Corner's and Wide's titles, the Name window's name)
   * shrinks with the room it has, never under TYPE_FLOOR, and the hero grows
   * only as far as the floor needs. It is CSS from the server's first paint,
   * so no box moves when the page hydrates and the fit lands.
   *
   * One page per layout, width and peek, stepped down the floor sweep's
   * heights (a fresh load at six of them read the same as the stepped one).
   * At each height:
   * - R1: every part's box as CSS alone draws it (`drawn`) equals the fitted
   *   one, to 0.5 px: no box moves when the page hydrates and the fit lands.
   * - R3: no part is clipped by the hero or over another, the window's top is
   *   on the screen, and the big type is at the floor at least, or at its own
   *   size where that is under the floor (a phone's).
   * - The hero's height is noted on the test, for the R4 table.
   */
  const FLOOR_HEIGHTS = [900, 844, 768, 650, 560, 450, 390, 375];
  const FLOOR_WIDTHS = [667, 844, 1280, 1440];
  const TYPE_FLOOR = 72;
  /** The parts R1 holds still: the words' slot, not the words, which change with the piece. */
  const HELD = {
    top: '.reel__top',
    slot: '.reel__slot',
    window: '.reel__window',
    index: '.reel__index',
    strip: '.reel__strip',
  } as const;

  /**
   * R1's read. First each part's box as fitted. Then as CSS alone draws it:
   * - every inline property the client set is stripped. On the parts that is
   *   all of them but the still. On the root it is all but those the server's
   *   HTML sets there (`served`);
   * - the window's marks go, all but `data-still`;
   * - the name goes back to the one run of text the server sends.
   * Then everything is put back. `changed` says the strip changed a size the
   * fit set, so equal boxes were not compared blind.
   */
  const drawnAndFitted = (page: Page, served: string[]) =>
    page.evaluate(
      ([held, served]) => {
        const reel = document.querySelector<HTMLElement>('.reel');
        const inner = reel?.querySelector<HTMLElement>('.reel__inner');
        if (!reel || !inner) throw new Error('no reel');
        const read = () => {
          const hero = reel.getBoundingClientRect();
          const out: Record<string, number[]> = { hero: [hero.height] };
          for (const [part, selector] of Object.entries(held)) {
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
          return out;
        };
        const sizes = () =>
          [...reel.querySelectorAll('.reel__title, .reel__window')]
            .map((el) => getComputedStyle(el).fontSize)
            .join(' ');
        const fitted = read();
        const fittedSizes = sizes();
        const styled = [
          reel,
          ...inner.querySelectorAll<HTMLElement>('[style]'),
        ].map((el) => [el, el.getAttribute('style')] as const);
        for (const prop of [...reel.style]) {
          if (prop.startsWith('--') && !served.includes(prop))
            reel.style.removeProperty(prop);
        }
        for (const el of inner.querySelectorAll<HTMLElement>('[style]')) {
          for (const prop of [...el.style])
            if (prop !== '--_still') el.style.removeProperty(prop);
        }
        const win = inner.querySelector<HTMLElement>('.reel__window');
        const kids = win ? [...win.childNodes] : [];
        const marks = win
          ? win
              .getAttributeNames()
              .filter((a) => a.startsWith('data-') && a !== 'data-still')
          : [];
        const marked = marks.map(
          (a) => [a, win?.getAttribute(a) ?? ''] as const
        );
        if (win) {
          for (const a of marks) win.removeAttribute(a);
          const run = document.createElement('span');
          run.dataset.line = '';
          run.textContent = [...win.querySelectorAll('[data-line]')]
            .map((line) => line.textContent)
            .join(' ');
          win.replaceChildren(run);
        }
        const drawn = read();
        const drawnSizes = sizes();
        for (const [el, style] of styled) {
          if (style === null) el.removeAttribute('style');
          else el.setAttribute('style', style);
        }
        if (win) {
          win.replaceChildren(...kids);
          for (const [a, v] of marked) win.setAttribute(a, v);
        }
        return {
          fitted,
          drawn,
          again: read(),
          changed: drawnSizes !== fittedSizes,
        };
      },
      [HELD, served] as const
    );

  /** The custom properties the server's HTML sets on the reel's root. */
  const servedOnRoot = async (page: Page) => {
    const html = await (await page.request.get(page.url())).text();
    const root = /<section class="reel[^"]*"[^>]*\sstyle="([^"]*)"/.exec(html);
    expect(root, "the server's reel and its style").not.toBeNull();
    return [...(root?.[1] ?? '').matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);
  };

  /** The parts, the big type and its own size, once the fit has settled at this height. */
  const settledAt = async (page: Page) => {
    let last = '';
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(300);
      const now = await page.evaluate(() => {
        const reel = document.querySelector('.reel');
        if (!reel) return null;
        const big =
          reel.querySelector<HTMLElement>('.reel__window') ??
          reel.querySelector<HTMLElement>(
            '.reel__words .reel__title:not(.reel__title--line)'
          );
        // A title's own size, uncapped: its `--_size`. The name's is none:
        // the fit sets it, and OBB's at every swept width is over the floor.
        let own: number | null = null;
        if (big?.classList.contains('reel__title')) {
          const probe = document.createElement('span');
          probe.style.cssText =
            'position:absolute;visibility:hidden;font-size:var(--_size)';
          big.append(probe);
          own = Number.parseFloat(getComputedStyle(probe).fontSize);
          probe.remove();
        }
        return {
          fitting: reel.hasAttribute('data-fitting'),
          inFlow: big?.classList.contains('reel__window')
            ? getComputedStyle(big).position !== 'absolute'
            : null,
          type: big ? Number.parseFloat(getComputedStyle(big).fontSize) : null,
          own,
          least: Number.parseFloat(getComputedStyle(reel).minHeight),
        };
      });
      const parts = await boxes(page);
      const key = JSON.stringify([now, parts]);
      if (now && !now.fitting && key === last) return { ...now, parts };
      last = key;
    }
    throw new Error('the fit never settled');
  };

  /**
   * A tall screen as the floor leaves it (1440x900, 390x844), read on the
   * page itself, not as HEAD's px: the brand sets where the parts fall (its
   * density, its fonts, its first piece), and CI's seeded OBB is not the
   * local one these were first measured on.
   * - The hero stops a lift short of the screen: the mock's (150 px, 132 on a
   *   phone) at the org's density, as the peek's own test reads it.
   * - The parts HEAD laid out, and no others (d4c3b9fb8, the last build with
   *   the parts placed on the reel).
   * - R1's read: every part as CSS alone draws it is the fitted one, to
   *   0.5 px, so no box moves when the page hydrates and the fit lands.
   * - The pause where HEAD kept it: over the index's top right on Corner,
   *   over the strip's last column on Wide; on a phone, top right above the
   *   bar, beside the segments. Corner's moved there on purpose: HEAD left it
   *   a grid item on a phone, under the words at the bottom right.
   */
  const TALL = [
    {
      layout: 'corner',
      width: 1440,
      height: 900,
      lift: 150,
      parts: ['top', 'words', 'index', 'ctl'],
    },
    {
      layout: 'wide',
      width: 1440,
      height: 900,
      lift: 150,
      parts: ['top', 'words', 'strip', 'ctl'],
    },
    {
      layout: 'corner',
      width: 390,
      height: 844,
      lift: 132,
      parts: ['top', 'words', 'ctl'],
    },
    {
      layout: 'wide',
      width: 390,
      height: 844,
      lift: 132,
      parts: ['top', 'words', 'ctl'],
    },
  ] as const;

  for (const { layout, width, height, lift, parts } of TALL) {
    test(`a tall screen: ${layout} at ${width}x${height}, the hero a lift short of the screen, the parts HEAD laid out, each where CSS draws it`, async ({
      browser,
      baseURL,
    }) => {
      const page = await open(browser, baseURL, {
        context: { viewport: { width, height } },
        keys: { 'reel-layout': layout },
      });
      await fitted(page);
      await onShow(page, 1);
      // Off the words, the index and the strip, so nothing holds the reel.
      await page.mouse.move(2, 2);
      const density = await page
        .locator('.reel')
        .evaluate(
          (reel) =>
            Number.parseFloat(
              getComputedStyle(reel).getPropertyValue('--brand-density-scale')
            ) || 1
        );
      const now = await boxes(page);
      expect
        .soft(
          now.hero.height,
          `the hero ${lift} x ${density} short of the screen`
        )
        .toBeCloseTo(height - lift * density, 0);
      const laid = (Object.keys(PARTS) as Part[]).filter((part) => now[part]);
      expect.soft(laid, 'the parts laid out').toEqual(parts);

      const read = await drawnAndFitted(page, await servedOnRoot(page));
      for (const [part, was] of Object.entries(read.fitted)) {
        const is = read.drawn[part];
        expect.soft(is, `${part}: drawn by CSS`).toBeDefined();
        if (!is) continue;
        was.forEach((v, i) => {
          expect
            .soft(
              Math.abs((is[i] ?? Number.NaN) - v),
              `${part} [${i}]: CSS ${is[i]}, fitted ${v}`
            )
            .toBeLessThanOrEqual(0.5);
        });
      }

      const { ctl, top, index, strip } = now;
      expect(ctl, 'the pause').toBeDefined();
      if (!ctl) return;
      const near = (a: number | undefined, b: number, what: string) =>
        expect
          .soft(Math.abs((a ?? Number.NaN) - b), what)
          .toBeLessThanOrEqual(0.5);
      if (width < 768) {
        expect
          .soft(ctl[1], 'the pause above the bar')
          .toBeLessThanOrEqual((top?.[0] ?? 0) + 0.5);
        near(top?.[3], ctl[3], "the pause at the bar's right");
      } else if (layout === 'corner') {
        near(index?.[0], ctl[0], "the pause at the index's top");
        near(index?.[3], ctl[3], "the pause at the index's right");
      } else {
        near(strip?.[1], ctl[1], "the pause at the strip's foot");
        near(strip?.[3], ctl[3], "the pause at the strip's right");
      }
      await page.context().close();
    });
  }

  for (const layout of ['corner', 'wide', 'name'] as const) {
    for (const width of FLOOR_WIDTHS) {
      for (const peek of ['on', 'off'] as const) {
        test(`the floor: ${layout} at ${width} wide, peek ${peek}, every swept height: the boxes CSS draws are the fitted ones, nothing clipped or over another, the big type at the floor at least`, async ({
          browser,
          baseURL,
        }) => {
          const page = await open(browser, baseURL, {
            context: { viewport: { width, height: FLOOR_HEIGHTS[0] } },
            keys: { 'reel-layout': layout, 'reel-peek': peek },
          });
          await fitted(page);
          await onShow(page, 1);
          // Off the words, the index and the strip, so nothing holds the reel.
          await page.mouse.move(2, 2);
          const served = await servedOnRoot(page);
          expect(served, "the server's own root properties").toContain(
            '--_wide-max'
          );
          let compared = false;
          const heroes: string[] = [];
          for (const height of FLOOR_HEIGHTS) {
            await page.setViewportSize({ width, height });
            const at = await settledAt(page);
            const cell = `${width}x${height}`;
            heroes.push(`${height}: ${at.parts.hero.height.toFixed(1)}`);

            // R1: what CSS draws is what the fit keeps.
            const read = await drawnAndFitted(page, served);
            compared ||= read.changed;
            for (const [part, was] of Object.entries(read.fitted)) {
              const is = read.drawn[part];
              // Out of flow the window moves nothing, so the fit may size it.
              if (part === 'window' && !at.inFlow) continue;
              expect.soft(is, `${cell}: ${part} drawn`).toBeDefined();
              if (!is) continue;
              was.forEach((edge, i) => {
                expect
                  .soft(
                    Math.abs(is[i] - edge),
                    `${cell}: ${part} [${i}] drawn ${is[i]}, fitted ${edge}`
                  )
                  .toBeLessThanOrEqual(0.5);
              });
            }
            expect(
              JSON.stringify(read.again),
              `${cell}: the read put it all back`
            ).toBe(JSON.stringify(read.fitted));

            // R3: inside the hero and apart (the pause sits over the strip's
            // last column and the index's top, by design).
            const shown = (Object.keys(PARTS) as Part[]).flatMap((part) => {
              const box = at.parts[part];
              return box ? [[part, box] as const] : [];
            });
            expect(shown.map(([part]) => part)).toContain('words');
            for (const [part, [top, bottom]] of shown) {
              expect
                .soft(top, `${cell}: ${part} top`)
                .toBeGreaterThanOrEqual(-0.5);
              expect
                .soft(bottom, `${cell}: ${part} bottom`)
                .toBeLessThanOrEqual(at.parts.hero.height + 0.5);
            }
            const apart = shown.filter(([part]) => part !== 'ctl');
            for (let i = 0; i < apart.length; i++) {
              for (let j = i + 1; j < apart.length; j++) {
                const [pa, a] = apart[i];
                const [pb, b] = apart[j];
                const over =
                  a[2] < b[3] && b[2] < a[3] && a[0] < b[1] && b[0] < a[1];
                expect.soft(over, `${cell}: ${pa} over ${pb}`).toBe(false);
              }
            }
            expect(at.type, `${cell}: the big type`).not.toBeNull();
            expect
              .soft(at.type ?? 0, `${cell}: the big type at the floor at least`)
              .toBeGreaterThanOrEqual(
                Math.min(TYPE_FLOOR, at.own ?? TYPE_FLOOR) - 0.5
              );
          }
          test
            .info()
            .annotations.push({ type: 'hero', description: heroes.join(', ') });
          // The instrument: on Wide and Name the fit sets a size, so the
          // strip changed one at some height.
          if (layout === 'name' || (layout === 'wide' && width >= 768))
            expect(compared, 'the strip changed a size the fit set').toBe(true);
          await page.context().close();
        });
      }
    }
  }

  /**
   * No layout shift on the real path: the hero as OBB stores it (Wide, peek
   * on), so the server's first paint and the client draw the same one, at the
   * short heights where the floor's cap sets the type. Each is loaded fresh,
   * with hydration guarded (a `hydration_mismatch` fails it), and its layout
   * shifts are summed from the first paint through hydration and the fit
   * (`layout-shift`, buffered). The total must be 0, to 0.001. HEAD read
   * 0.0123 at 844x450 and 0.0030 at 1440x560 (the words settling as the fit
   * set the title); the floor reads 0.0001 and 0.0005, the brand font's swap
   * in the top bar.
   *
   * Only the stored options: the payload rewrite (`helpers/showreel.ts`) can't
   * change the server's first paint, so a CLS reading on an injected layout or
   * peek measures the harness's switch from the stored hero, not a shift a
   * visitor sees (rewriting only peek, on to off, read 0.1361 at 844x650
   * against 0.0084 as stored). The injected layouts' proof is R1, above.
   */
  for (const [width, height] of [
    [667, 560],
    [844, 450],
    [1440, 560],
  ] as const) {
    test(`the floor on the stored hero (Wide, peek on) at ${width}x${height}: no layout shift from the first paint through the fit`, async ({
      browser,
      baseURL,
    }) => {
      const page = await open(browser, baseURL, {
        context: { viewport: { width, height } },
        // The stored layout, so the rewrite sets what the server painted.
        keys: { 'reel-layout': 'wide' },
        guardHydration: true,
        init: () => {
          const shifts: { value: number; nodes: string[] }[] = [];
          Object.assign(window, { __shifts: shifts });
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const shift = entry as PerformanceEntry & {
                value: number;
                hadRecentInput: boolean;
                sources?: { node?: Node | null }[];
              };
              if (shift.hadRecentInput) continue;
              shifts.push({
                value: shift.value,
                nodes: (shift.sources ?? []).map((source) => {
                  const node = source.node;
                  return node instanceof Element
                    ? `${node.tagName.toLowerCase()}.${[...node.classList].join('.')}`
                    : String(node?.nodeName);
                }),
              });
            }
          }).observe({ type: 'layout-shift', buffered: true });
        },
      });
      // The server painted the hero the client draws, or the reading would
      // be the harness's.
      const html = await (await page.request.get(page.url())).text();
      const served = /<section class="reel[^"]*"([^>]*)>/.exec(html)?.[1] ?? '';
      expect(served, "the server's own hero is Wide").toContain(
        'data-layout="wide"'
      );
      expect(served, "the server's own hero peeks").toContain('data-peek=""');
      await expect(page.locator('.reel')).toHaveAttribute(
        'data-layout',
        'wide'
      );
      await expect(page.locator('.reel')).toHaveAttribute('data-peek', '');
      await fitted(page);
      await settledAt(page);
      const shifts = await page.evaluate(
        () =>
          (
            window as unknown as {
              __shifts?: { value: number; nodes: string[] }[];
            }
          ).__shifts ?? []
      );
      const total = shifts.reduce((sum, shift) => sum + shift.value, 0);
      test.info().annotations.push({
        type: 'cls',
        description: `${total.toFixed(4)}${shifts.length ? ` (${shifts.flatMap((shift) => shift.nodes).join(' ')})` : ''}`,
      });
      expect(total, 'layout shift').toBeLessThanOrEqual(0.001);
      await page.context().close();
    });
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
            shownSize: Number.parseFloat(
              getComputedStyle(words.querySelector('.reel__title') ?? words)
                .fontSize
            ),
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
        // (WIDE_TITLE.max, review r5 S5), or at the floor's cap where the
        // screen is short (`--_cap`), so it is never short of the fit.
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
            // At its most, or at the floor's cap on this short screen: never
            // under the title on show.
            expect
              .soft(read.heldSize, `piece ${n}: held title`)
              .toBeGreaterThanOrEqual(read.shownSize - 0.5);
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

  /**
   * How far each break of the name is from balanced, in px: the two lines'
   * difference in width, less the width of the word that would cross the
   * break (with its space), from the longer line to the shorter. Moving that
   * word brings the lines closer only when the difference is more than it, so
   * a balanced break reads 0 or less. A line of one word has none to give.
   * Each word's box is read from the text as laid out: no font is assumed.
   */
  const unbalance = (page: Page) =>
    page.evaluate(() => {
      const text = document.querySelector('.reel .reel__name')?.firstChild;
      if (!(text instanceof Text)) throw new Error('no name text');
      const range = document.createRange();
      const words = [...text.data.matchAll(/\S+/g)].map((m) => {
        range.setStart(text, m.index);
        range.setEnd(text, m.index + m[0].length);
        const r = range.getBoundingClientRect();
        return { top: Math.round(r.top), left: r.left, right: r.right };
      });
      const tops = [...new Set(words.map((w) => w.top))].sort((a, b) => a - b);
      const lines = tops.map((top) => words.filter((w) => w.top === top));
      const width = (line: typeof words) =>
        (line.at(-1)?.right ?? 0) - (line[0]?.left ?? 0);
      return lines.slice(1).map((below, i) => {
        const above = lines[i] ?? [];
        const [a, b] = [width(above), width(below)];
        if ((a > b ? above : below).length < 2) return Number.NEGATIVE_INFINITY;
        const crossing =
          a > b
            ? (above.at(-1)?.right ?? 0) - (above.at(-2)?.right ?? 0)
            : (below[1]?.left ?? 0) - (below[0]?.left ?? 0);
        return Math.abs(a - b) - crossing;
      });
    });

  // The lines are the brand's (its heading font and type scale), so they are
  // read against the name's own measure and words, not counted.
  for (const layout of ['corner', 'wide'] as const) {
    test(`OBB's name on a phone (${layout}): the lines it needs within the measure, balanced, the logo beside the first, inside the reel`, async ({
      browser,
      baseURL,
    }) => {
      const page = await open(browser, baseURL, {
        context: { viewport: { width: 390, height: 844 } },
        keys: { 'reel-layout': layout },
      });
      await fitted(page);
      const at = await inside(page);
      test
        .info()
        .annotations.push({ type: 'lines', description: `${at.lines.length}` });
      // On one line (a brand whose font sets the name narrower) there is no
      // break, so the balance check below reads nothing: said on the test,
      // never failed, as the name may fit on any brand.
      if (at.lines.length < 2) {
        test.info().annotations.push({
          type: 'one-line',
          description:
            "the name fits on one line on this brand: no break, so its balance went unchecked here; the long-name cell's name breaks on any brand, its lines held to what the measure needs",
        });
      }
      // Balanced: no word moved across a break brings its lines closer.
      for (const [i, past] of (await unbalance(page)).entries()) {
        expect
          .soft(past, `break ${i + 1}: px past balanced`)
          .toBeLessThanOrEqual(1);
      }
      // OBB's own name, so its own words: the bar stays clear of them.
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
      // the name's lines.
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
      // The lines it needs and no more: never more than the measure filled
      // greedily takes.
      await page.addStyleTag({
        content: '.reel .reel__name { text-wrap: wrap !important; }',
      });
      await frames(page);
      expect(at.lines.length).toBeLessThanOrEqual(
        (await nameAt(page)).lines.length
      );
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

  // A wordmark logo keeps its aspect at the bar's height (`.reel__sig img`),
  // so a 4:1 one is 160 px wide, not the square logo NAME_WORD_MAX (17
  // letters) is set for. Beside it a word the server leaves whole still sits
  // inside the reel. OBB's own logo is the control.
  for (const [width, name] of [
    [320, 'Transformationals Studio'],
    [375, 'Photojournalism Collective'],
  ] as const) {
    test(`a ${name.split(' ')[0]?.length}-letter word beside a 4:1 wordmark on a ${width} phone: inside the reel`, async ({
      browser,
      baseURL,
    }) => {
      const page = await open(browser, baseURL, {
        context: { viewport: { width, height: 760 } },
        name,
      });
      await fitted(page);
      // The control: the logo as OBB ships it.
      const plain = await inside(page);
      expect(plain.longWord).toBe(false);
      // A 4:1 wordmark at the bar's height.
      await page.addStyleTag({
        content: '.reel .reel__sig img { width: 160px !important; }',
      });
      await frames(page);
      await inside(page);
      await page.context().close();
    });
  }

  /**
   * A logo that fails once the page has painted (its CDN down; CI starts no
   * dev CDN, so there every seeded logo fails) keeps its box, unseen: a load
   * failure must keep its box. On a desktop the logo sets the bar's height,
   * so dropping it shortened the bar (68 to 66.4 px) and moved the name
   * into its place. A logo leading alone gets the name as its stand-in, out
   * of flow over its place and held to the run the bar leaves free beside
   * its meta: in sight, and over neither the meta (Follow, the org's action)
   * nor the pause, at the desktop widths where the meta comes nearest. Read with
   * the logo's request held (pending), then failed, and read again once the
   * failure has landed (OrgHero marked it failed, or dropped it).
   */
  for (const [width, height, lead] of [
    [1440, 900, 'both'],
    [390, 844, 'both'],
    [1440, 900, 'logo'],
    [1024, 768, 'logo'],
    [900, 900, 'logo'],
    [820, 900, 'logo'],
    [390, 844, 'logo'],
  ] as const) {
    test(`a logo that fails late at ${width}x${height}, lead ${lead}: its box kept, nothing in the top bar moves`, async ({
      browser,
      baseURL,
    }) => {
      let fail = () => {};
      const page = await open(browser, baseURL, {
        context: { viewport: { width, height } },
        keys: { lead },
        failLogo: new Promise<void>((done) => {
          fail = () => done();
        }),
      });
      await page.evaluate(() => document.fonts.ready);
      const failed = () =>
        page.evaluate(() => {
          const img = document.querySelector('.reel__sig img');
          return !img || img.hasAttribute('data-failed');
        });
      const meta = () =>
        page.evaluate(() => {
          const r = document
            .querySelector('.reel__meta')
            ?.getBoundingClientRect();
          return r ? [r.top, r.bottom, r.left, r.right] : null;
        });
      expect(await failed(), 'the logo still pending at the first read').toBe(
        false
      );
      const before = await nameAt(page);
      const metaBefore = await meta();
      fail();
      await expect.poll(failed, { timeout: 20_000 }).toBe(true);
      await frames(page);
      const after = await nameAt(page);
      for (const part of ['top', 'name'] as const) {
        for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
          const was = before[part]?.[edge] ?? Number.NaN;
          const is = after[part]?.[edge] ?? Number.NaN;
          expect
            .soft(Math.abs(is - was), `${part} ${edge}: ${is} (before ${was})`)
            .toBeLessThanOrEqual(0.5);
        }
      }
      expect(await meta(), 'the meta where it was').toEqual(metaBefore);
      if (lead === 'logo') {
        // The name stands in, in sight, over neither the meta nor the pause
        // (each as laid out: a phone lays out no meta).
        const standIn = await page.evaluate(() => {
          const laid = (selector: string) => {
            const r = document.querySelector(selector)?.getBoundingClientRect();
            return r && r.width > 1 && r.height > 1 ? r : null;
          };
          const el = document.querySelector('.reel__stand-in');
          const r = laid('.reel__stand-in');
          const over = (other: DOMRect | null) =>
            !!r &&
            !!other &&
            r.left < other.right &&
            other.left < r.right &&
            r.top < other.bottom &&
            other.top < r.bottom;
          return {
            shown: !!el && getComputedStyle(el).visibility === 'visible',
            width: r?.width ?? 0,
            overMeta: over(laid('.reel__meta')),
            overPause: over(laid('.reel__ctl')),
          };
        });
        expect(standIn.shown, 'the name stands in, in sight').toBe(true);
        expect(standIn.width, 'the stand-in laid out').toBeGreaterThan(0);
        expect(standIn.overMeta, 'the stand-in over the meta').toBe(false);
        expect(standIn.overPause, 'the stand-in over the pause').toBe(false);
      }
      await page.context().close();
    });
  }
});

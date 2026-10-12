/**
 * The page dials in the browser (docs/design/landing-builder/
 * 03-expressive-contract.md X61, X62), on the seeded reference page a
 * visitor sees, signed out. The corners dial first, then the type dial and
 * the motion dial, whose steps are also cascades jsdom cannot run.
 *
 * `kit.css` draws the dial as one attribute above each Style's own tokens, so
 * it wins by specificity, not by load order: only a real cascade can show
 * that. On the page as served it reads the four corner tokens under the
 * page's own Style, under each step of the dial, under Soft, and under no
 * Style at all, and holds `brand` to the kit's own corners, `rounder` to
 * Soft's, and the page's own button to the dial. The page's corner inputs
 * are set first, so the steps differ whatever radius the seeded brand has.
 *
 * Which corners a page asks for is the renderer's (PageRenderer.svelte.test.ts);
 * colour and spacing are resolved per section and need no browser
 * (resolve.test.ts).
 */
import { expect, test } from '@playwright/test';
import {
  expectSellPageRendered,
  journeyFixture,
  journeyUrl,
} from '../helpers/journeys';

test.use({ viewport: { width: 1440, height: 900 } });

const ANCESTRAL = journeyFixture('of-blood-and-bones', 'ancestral-threads');

test('the corners dial wins over the Style, and the page draws it', async ({
  page,
  baseURL,
}) => {
  await page.goto(journeyUrl(baseURL as string, ANCESTRAL));
  await expectSellPageRendered(page, ANCESTRAL);

  const read = await page.evaluate(() => {
    const root = document.querySelector('.lp') as HTMLElement;
    const button = root.querySelector('.lp-button') as HTMLElement | null;
    const style = root.dataset.lpStyle ?? '';
    root.style.setProperty('--radius-card', '12px');
    root.style.setProperty('--radius-lg', '20px');
    root.style.setProperty('--radius-button', '10px');
    root.style.setProperty('--brand-radius', '0.5rem');
    const probe = document.createElement('div');
    root.appendChild(probe);
    const corners = () =>
      Object.fromEntries(
        ['card', 'media', 'button', 'chip'].map((name) => {
          probe.style.borderTopLeftRadius = `var(--lp-radius-${name})`;
          return [name, getComputedStyle(probe).borderTopLeftRadius];
        })
      );
    const at = (lpStyle: string, step?: string) => {
      root.dataset.lpStyle = lpStyle;
      if (step) root.dataset.lpCorners = step;
      else delete root.dataset.lpCorners;
      return {
        corners: corners(),
        button: button ? getComputedStyle(button).borderTopLeftRadius : null,
      };
    };
    const out = {
      style,
      own: at(style),
      brand: at(style, 'brand'),
      rounder: at(style, 'rounder'),
      soft: at('soft'),
      kit: at('none'),
    };
    at(style);
    probe.remove();
    return out;
  });

  expect(read.style, 'the reference page names its Style').not.toBe('');
  expect(read.style, 'Soft cannot show its own recipe winning').not.toBe(
    'soft'
  );
  expect(read.brand.corners).toEqual(read.kit.corners);
  expect(read.rounder.corners).toEqual(read.soft.corners);
  // The Style bends the org's corners, so the dial's steps are visible here.
  expect(read.own.corners).not.toEqual(read.brand.corners);
  expect(read.own.corners).not.toEqual(read.rounder.corners);
  // And the page's own button follows the dial.
  expect(read.brand.button).toBe(read.brand.corners.button);
  expect(read.rounder.button).toBe(read.rounder.corners.button);
});

// 03 X62. The sizes are probed where a section's words are set, so each
// `cqi` resolves against the same container at every step.
test('the type dial multiplies every headline size by its factor', async ({
  page,
  baseURL,
}) => {
  await page.goto(journeyUrl(baseURL as string, ANCESTRAL));
  await expectSellPageRendered(page, ANCESTRAL);

  const read = await page.evaluate(() => {
    const root = document.querySelector('.lp') as HTMLElement;
    const inner = root.querySelector(
      '.lp-section:not([data-lp-type="hero"]) .lp-inner'
    ) as HTMLElement;
    const heading = inner.querySelector('.lp-heading') as HTMLElement;
    const probe = document.createElement('div');
    inner.appendChild(probe);
    const sizes = (step?: string) => {
      if (step) root.dataset.lpDrama = step;
      else delete root.dataset.lpDrama;
      return {
        ...Object.fromEntries(
          ['display', 'heading', 'cta'].map((kind) => {
            probe.style.fontSize = `var(--lp-size-${kind})`;
            return [kind, Number.parseFloat(getComputedStyle(probe).fontSize)];
          })
        ),
        page: Number.parseFloat(getComputedStyle(heading).fontSize),
      } as Record<'display' | 'heading' | 'cta' | 'page', number>;
    };
    const out = {
      own: sizes(),
      calmer: sizes('calmer'),
      louder: sizes('louder'),
    };
    sizes();
    probe.remove();
    return out;
  });

  const ratio = (
    step: 'calmer' | 'louder',
    kind: 'display' | 'heading' | 'cta'
  ) => read[step][kind] / read.own[kind];
  for (const kind of ['display', 'heading', 'cta'] as const)
    expect(ratio('calmer', kind), kind).toBeCloseTo(0.85, 2);
  expect(ratio('louder', 'heading')).toBeCloseTo(1.15, 2);
  expect(ratio('louder', 'display')).toBe(1);
  expect(ratio('louder', 'cta')).toBe(1);
  // And the page's own section heading is set at that size.
  expect(read.calmer.page).toBeLessThan(read.own.page);
  expect(read.louder.page).toBeGreaterThan(read.own.page);
});

// Path draws a route down the page on the scroll; Soft's tints drift for
// ever. At either step of the motion dial neither runs; at still nothing
// runs, and what answers a hover changes at once.
test('the motion dial: gentle stops what follows the scroll or loops; still stops everything', async ({
  page,
  baseURL,
}) => {
  await page.goto(journeyUrl(baseURL as string, ANCESTRAL));
  await expectSellPageRendered(page, ANCESTRAL);

  const read = await page.evaluate(() => {
    const root = document.querySelector('.lp') as HTMLElement;
    const style = root.dataset.lpStyle ?? '';
    // CSS animations only: switching Styles here starts colour transitions,
    // which no frame finishes inside one evaluate. Transitions are judged by
    // their computed durations instead.
    const moving = () =>
      document.getAnimations().filter((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target;
        return (
          a instanceof CSSAnimation &&
          target instanceof Element &&
          root.contains(target)
        );
      }) as CSSAnimation[];
    const label = (el: Element) =>
      `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`;
    // Every transition token, read where the page uses them: one the still
    // step left to inherit would keep `:root`'s durations.
    const probe = document.createElement('div');
    probe.style.transition = ['colors', 'transform', 'opacity', 'shadow']
      .map((name) => `var(--transition-${name})`)
      .join(', ');
    root.appendChild(probe);
    const tokens = () =>
      getComputedStyle(probe)
        .transitionDuration.split(',')
        .map((d) => Number.parseFloat(d));
    const timed = [...root.querySelectorAll<HTMLElement>('*')].filter((el) =>
      getComputedStyle(el)
        .transitionDuration.split(',')
        .some((d) => Number.parseFloat(d) > 0.001)
    );
    const at = (lpStyle: string, step?: string) => {
      root.dataset.lpStyle = lpStyle;
      if (step) root.dataset.lpMotion = step;
      else delete root.dataset.lpMotion;
      const running = moving();
      return {
        all: running.map(
          (a) =>
            `${a.animationName} on ${label((a.effect as KeyframeEffect).target as Element)}`
        ),
        scrolled: running.filter(
          (a) => a.timeline !== null && a.timeline !== document.timeline
        ).length,
        loops: running.filter(
          (a) =>
            a.effect?.getComputedTiming().iterations ===
            Number.POSITIVE_INFINITY
        ).length,
        tokens: tokens(),
        timed: timed
          .filter((el) =>
            getComputedStyle(el)
              .transitionDuration.split(',')
              .some((d) => Number.parseFloat(d) > 0.001)
          )
          .map(
            (el) => `${label(el)} ${getComputedStyle(el).transitionDuration}`
          ),
      };
    };
    const out = {
      timed: timed.length,
      path: at('path'),
      pathGentle: at('path', 'gentle'),
      pathStill: at('path', 'still'),
      soft: at('soft'),
      softGentle: at('soft', 'gentle'),
      softStill: at('soft', 'still'),
    };
    at(style);
    probe.remove();
    return out;
  });

  // Not vacuous: each Style moves in its own way, and the page has timed transitions.
  expect(read.path.scrolled).toBeGreaterThan(0);
  expect(read.soft.loops).toBeGreaterThan(0);
  expect(read.timed).toBeGreaterThan(0);
  for (const gentle of [read.pathGentle, read.softGentle]) {
    expect(gentle.scrolled).toBe(0);
    expect(gentle.loops).toBe(0);
  }
  expect(read.path.tokens).toHaveLength(6);
  for (const duration of read.path.tokens)
    expect(duration).toBeGreaterThan(0.05);
  for (const still of [read.pathStill, read.softStill]) {
    expect(still.all).toEqual([]);
    expect(still.timed).toEqual([]);
    for (const duration of still.tokens) expect(duration).toBeLessThan(0.001);
  }
});

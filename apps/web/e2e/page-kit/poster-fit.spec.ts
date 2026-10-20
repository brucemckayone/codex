/**
 * The poster hero holds its words (Codex-61zsk.33, Codex-61zsk.36; 03 X60),
 * measured in every Style over a sweep of headlines.
 *
 * OPT-IN, LOCAL: `POSTER_FIT=1 pnpm exec playwright test poster-fit`. It
 * drives the page kit's gallery (`/studio/page-kit`), a development route
 * that a production build (CI's) does not have, and it sets 104 headlines in
 * 8 Styles, 4 faces and 2 widths, which takes about four minutes. Run it on
 * any change to the poster's size or its float.
 *
 * For each headline, 20 to 120 characters with a long word first, between,
 * last or nowhere, set as HeroBlock would set it (its length marks and
 * widths, `model/long-heading.ts`), it reads the drawn glyphs:
 *
 *   no word cut   at 1440 no run of the headline is drawn on two lines
 *                 (Poster hyphenates on a phone, so 390 is not held to it)
 *   nothing over  at both widths no headline or lede glyph, and no button,
 *                 lies over the picture
 *
 * The faces: the gallery's brands 0 and 3 (Archivo Black, Syne), and in Bold
 * and Poster, which draw the largest, Anton and Unbounded, the narrowest and
 * the widest the brand editor offers, set on the page as its own fonts are.
 */
import { expect, test } from '@playwright/test';
import { headingRuns } from '../../src/lib/page-builder/kit/model/long-heading';
import { captureSeededCreatorCookies } from '../helpers/subscription';

test.skip(
  !process.env.POSTER_FIT,
  'opt-in: POSTER_FIT=1 (a development route, ~4 min)'
);
test.describe.configure({ mode: 'serial' });
test.setTimeout(20 * 60_000);

const STYLES = [
  'bold',
  'clean',
  'soft',
  'cinematic',
  'path',
  'poster',
  'studio',
  'quiet',
];
const SHORT = [
  'find',
  'your',
  'calm',
  'and',
  'steady',
  'ground',
  'rest',
  'slow',
  'the',
  'breath',
  'of',
  'quiet',
  'body',
  'home',
  'light',
  'walk',
  'to',
  'sea',
  'each',
  'day',
  'a',
  'new',
  'way',
  'back',
  'for',
  'you',
  'with',
  'care',
  'in',
];
const LONG = [
  'breathwork,',
  'meditation,',
  'mindfulness',
  'transformation',
  'resilience',
  'nourishment',
  'storytelling',
  'photography',
];
const FACES: { brand: string; face?: string }[] = [
  { brand: '0' },
  { brand: '3' },
  { brand: '0', face: 'Anton' },
  { brand: '0', face: 'Unbounded' },
];

function fill(target: number, seed: number): string[] {
  const words: string[] = [];
  for (let i = seed; words.join(' ').length < target; i++)
    words.push(SHORT[i % SHORT.length]);
  return words;
}

function headlines() {
  const out: { id: string; words: string[] }[] = [];
  for (let length = 20; length <= 120; length += 4) {
    out.push({ id: `${length}-plain`, words: fill(length, length) });
    const long = LONG[length % LONG.length];
    const rest = fill(length - long.length - 1, length + 3);
    const mid = Math.floor(rest.length / 2);
    out.push({ id: `${length}-first`, words: [long, ...rest] });
    out.push({
      id: `${length}-mid`,
      words: [...rest.slice(0, mid), long, ...rest.slice(mid)],
    });
    out.push({ id: `${length}-last`, words: [...rest, long] });
  }
  return out.map(({ id, words }) => {
    const text = words.join(' ').replace(/^./, (c) => c.toUpperCase());
    return { id, text, runs: headingRuns(text) };
  });
}

test('the poster hero cuts no word and draws nothing over its picture', async ({
  browser,
}) => {
  const cookies = await captureSeededCreatorCookies();
  const list = headlines();
  const faults: string[] = [];
  let set = 0;
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    await context.addCookies(cookies);
    const page = await context.newPage();
    for (const style of STYLES)
      for (const { brand, face } of FACES) {
        if (face && style !== 'poster' && style !== 'bold') continue;
        await page.goto(
          `http://studio-alpha.lvh.me:5173/studio/page-kit?style=${style}&brand=${brand}&only=hero&layout=poster&theme=light&chrome=0`
        );
        await page
          .locator('.hero-poster[data-pictured]')
          .waitFor({ timeout: 60_000 });
        if (face)
          await page.evaluate(async (family) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@400;700&display=block`;
            document.head.appendChild(link);
            await new Promise((done) => {
              link.onload = done;
              setTimeout(done, 8000);
            });
            const root = document.querySelector('.lp') as HTMLElement;
            root.style.setProperty('--brand-font-heading', `'${family}'`);
            root.style.setProperty('--font-heading', `'${family}'`);
            await document.fonts.load(`700 100px "${family}"`, 'ABC');
          }, face);
        // At rest: the hero's entrance is over.
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (a) =>
                  a.timeline === document.timeline &&
                  Number.isFinite(Number(a.effect?.getComputedTiming().endTime))
              )
              .map((a) => a.finished.catch(() => undefined))
          );
        });
        const found = await page.evaluate(
          ({ list, wide }) => {
            const poster = document.querySelector(
              '.hero-poster'
            ) as HTMLElement;
            const words = poster.querySelector(
              '.hero__headline'
            ) as HTMLElement;
            const heading = words.querySelector('.lp-heading') as HTMLElement;
            const reveal = poster.querySelector(
              '.hero-poster__reveal'
            ) as HTMLElement;
            // Read for each headline once it is set: the picture moves with
            // it (it follows the words on a phone, and the float's top and
            // height follow the headline's size), so a rect read once would
            // hold every later headline to where the first one left it.
            let picture = reveal.getBoundingClientRect();
            const over = (r: DOMRect) =>
              Math.min(r.right, picture.right) -
                Math.max(r.left, picture.left) >
                1 &&
              Math.min(r.bottom, picture.bottom) -
                Math.max(r.top, picture.top) >
                1;
            const glyphs = (root: Element) => {
              const rects: DOMRect[] = [];
              const walker = document.createTreeWalker(
                root,
                NodeFilter.SHOW_TEXT
              );
              const range = document.createRange();
              for (let node = walker.nextNode(); node; node = walker.nextNode())
                for (let i = 0; i < (node.textContent ?? '').length; i++) {
                  if (/\s/.test(node.textContent?.[i] ?? ' ')) continue;
                  range.setStart(node, i);
                  range.setEnd(node, i + 1);
                  const rect = range.getClientRects()[0];
                  if (rect && rect.width > 0) rects.push(rect);
                }
              return rects;
            };
            const faults: string[] = [];
            for (const { id, text, runs } of list) {
              heading.textContent = text;
              words.toggleAttribute(
                'data-medium',
                text.length > 24 && text.length <= 64
              );
              words.toggleAttribute('data-long', text.length > 64);
              poster.style.setProperty(
                '--lp-heading-chars',
                String(text.length)
              );
              for (const [part, size] of Object.entries(runs))
                for (const [key, value] of Object.entries(size))
                  poster.style.setProperty(
                    `--lp-heading-${part}-${key}`,
                    String(value)
                  );
              picture = reveal.getBoundingClientRect();
              const line = Number.parseFloat(
                getComputedStyle(heading).lineHeight
              );
              const node = heading.firstChild as Text;
              const range = document.createRange();
              if (wide) {
                let start = 0;
                for (const word of text.split(' ')) {
                  for (const run of word.split(/(?<=[-‐–—/])/)) {
                    const tops: number[] = [];
                    for (let i = start; i < start + run.length; i++) {
                      range.setStart(node, i);
                      range.setEnd(node, i + 1);
                      const rect = range.getClientRects()[0];
                      if (rect) tops.push(rect.top);
                    }
                    if (Math.max(...tops) - Math.min(...tops) > line / 2)
                      faults.push(`${id}: "${run}" cut`);
                    start += run.length;
                  }
                  start += 1;
                }
              }
              const lede = poster.querySelector('.hero__lede');
              const covered = [
                ...glyphs(heading)
                  .filter(over)
                  .map(() => 'headline'),
                ...(lede
                  ? glyphs(lede)
                      .filter(over)
                      .map(() => 'lede')
                  : []),
                ...[...poster.querySelectorAll('.hero__actions .lp-button')]
                  .filter((button) => over(button.getBoundingClientRect()))
                  .map(() => 'button'),
              ];
              if (covered.length)
                faults.push(
                  `${id}: over the picture: ${[...new Set(covered)].join(', ')}`
                );
            }
            return faults;
          },
          { list, wide: width === 1440 }
        );
        set += list.length;
        for (const fault of found)
          faults.push(`${width} ${style} ${face ?? `brand ${brand}`} ${fault}`);
      }
    await context.close();
  }
  expect(set).toBe(list.length * 2 * 20);
  expect(faults, faults.slice(0, 20).join('\n')).toEqual([]);
});

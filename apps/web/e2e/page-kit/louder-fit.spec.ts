/**
 * The type dial's louder fits every word a Style fits (Codex-61zsk.51; 03
 * X62), measured in every Style over a sweep of headings.
 *
 * OPT-IN, LOCAL: `LOUDER_FIT=1 pnpm exec playwright test louder-fit`. It
 * drives the page kit's gallery (`/studio/page-kit`), a development route
 * that a production build (CI's) does not have, and it sets 60 texts in every
 * section heading of the sample page, in 8 Styles at 5 widths, which takes
 * about thirteen minutes. Run it on any change to louder's fit, to a heading
 * size, or to a layout that gives a head less room than its section's column
 * (that layout names the room, `--lp-heading-column`).
 *
 * Each text, a long word alone or 12 to 60 characters with a long word first
 * or last, is set in every heading but the hero's and weighed as Heading
 * weighs its own (`widestRun`). At the Style's own size and at louder it reads:
 *
 *   nothing over   no run is drawn wider than its heading's line at louder
 *                  that the Style draws within it
 *   never below    louder never draws a heading smaller than the Style does
 *   titles hold    louder never draws a title, or a lifted one, larger
 *   it grows       louder still takes some heading the whole step in each
 *                  Style and face at some width, so the fit cannot pass by
 *                  holding everything (on a phone a Style may rightly hold
 *                  every heading: its own size already fills the column)
 *
 * A run's width is measured once, unbroken, at the heading's own size and
 * scaled: letter-spacing in em inherits as a length, so a ruler at another
 * size keeps the heading's tracking in px and reads every run too wide. Poster
 * hyphenates on a phone (`hyphens: auto` under 32rem), so a line break is not
 * what is held here; a run wider than its line is, which no reflow can hide.
 * The line is the heading's room, not its box: a grid item's `min-width: auto`
 * stretches its box to its longest word, past its track and over whatever
 * sits beside it, so the box is held to the room while it is read.
 *
 * What the Style itself draws too wide is not louder's to hold (a long word
 * in Poster's split heads, Codex-61zsk.60); the spec counts it in its log.
 *
 * The faces: the gallery's brand 0 (Archivo Black, the widest measured), and
 * in Bold and Poster, which draw the largest, Anton and Unbounded, the
 * narrowest and the widest the brand editor offers.
 */
import { expect, test } from '@playwright/test';
import { widestRun } from '../../src/lib/page-builder/kit/model/long-heading';
import { captureSeededCreatorCookies } from '../helpers/subscription';

test.skip(
  !process.env.LOUDER_FIT,
  'opt-in: LOUDER_FIT=1 (a development route, ~13 min)'
);
test.describe.configure({ mode: 'serial' });
test.setTimeout(60 * 60_000);

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
const WIDTHS = [360, 390, 768, 1024, 1440];
const FACES: { brand: string; face?: string }[] = [
  { brand: '0' },
  { brand: '0', face: 'Anton' },
  { brand: '0', face: 'Unbounded' },
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
  'Transformation:',
];
/** The louder step (`kit.css`): what "the whole step" is. */
const LOUDER = 1.15;

function fill(target: number, seed: number): string[] {
  const words: string[] = [];
  let i = seed;
  while (words.join(' ').length < target) words.push(SHORT[i++ % SHORT.length]);
  return words;
}

function corpus(): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  for (const long of LONG) out.push({ id: `alone-${long}`, text: long });
  for (let length = 12; length <= 60; length += 8) {
    out.push({ id: `${length}-plain`, text: fill(length, length).join(' ') });
    const long = LONG[length % LONG.length];
    const rest = fill(length - long.length - 1, length + 3);
    out.push({ id: `${length}-first`, text: [long, ...rest].join(' ') });
    out.push({ id: `${length}-last`, text: [...rest, long].join(' ') });
  }
  return out.map(({ id, text }) => ({
    id,
    text: text[0].toUpperCase() + text.slice(1),
  }));
}

test('louder fits every word the Style fits, and holds what it cannot see', async ({
  browser,
}) => {
  const cookies = await captureSeededCreatorCookies();
  const texts = corpus();
  const runs = texts.map(({ text }) => widestRun(text));
  const faults: string[] = [];
  /** Each Style and face, and whether louder took any heading the whole step. */
  const grew = new Map<string, boolean>();
  let pairs = 0;
  for (const width of WIDTHS) {
    // Reduced motion, so no entrance moves a heading while it is read.
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
    });
    await context.addCookies(cookies);
    const page = await context.newPage();
    for (const style of STYLES)
      for (const { brand, face } of FACES) {
        if (face && style !== 'poster' && style !== 'bold') continue;
        await page.goto(
          `http://studio-alpha.lvh.me:5173/studio/page-kit?style=${style}&brand=${brand}&theme=light&chrome=0`
        );
        await page
          .locator('.lp .lp-section')
          .first()
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
        await page.evaluate(() => document.fonts.ready);
        const read = await page.evaluate(
          async ({ list, weights }) => {
            const root = document.querySelector('.lp') as HTMLElement;
            const headings = [
              ...root.querySelectorAll<HTMLElement>('.lp-section .lp-heading'),
            ].filter(
              (h) =>
                h.closest('.lp-section')?.getAttribute('data-lp-type') !==
                'hero'
            );
            const split = (text: string) =>
              text
                .split(/\s+/)
                .flatMap((w) => w.split(/(?<=[-‐–—/])/))
                .filter(Boolean);
            const RUNS = [...new Set(list.flatMap(({ text }) => split(text)))];
            // Each run's unbroken width per 100px of the heading's own size:
            // every run on its own line of one ruler in every heading, so the
            // whole read costs one layout, not one per run.
            const size0 = headings.map((h) =>
              Number.parseFloat(getComputedStyle(h).fontSize)
            );
            const rulers = headings.map((h) => {
              const ruler = document.createElement('div');
              ruler.style.cssText =
                'position:absolute;visibility:hidden;inset:0 auto auto 0;';
              for (const run of RUNS) {
                const line = document.createElement('div');
                line.style.cssText =
                  'inline-size:max-content;white-space:nowrap;';
                line.textContent = run;
                ruler.appendChild(line);
              }
              h.appendChild(ruler);
              return ruler;
            });
            const per100 = rulers.map(
              (ruler, i) =>
                new Map(
                  [...ruler.children].map((line, k) => [
                    RUNS[k],
                    (line.getBoundingClientRect().width * 100) / size0[i],
                  ])
                )
            );
            for (const ruler of rulers) ruler.remove();
            const over = (i: number, h: HTMLElement, text: string) => {
              const cs = getComputedStyle(h);
              const size = Number.parseFloat(cs.fontSize);
              const line =
                h.clientWidth -
                Number.parseFloat(cs.paddingLeft) -
                Number.parseFloat(cs.paddingRight);
              return split(text).filter(
                (run) => ((per100[i].get(run) ?? 0) * size) / 100 > line + 0.5
              );
            };
            const originals = headings.map((h) => h.innerHTML);
            const styles = headings.map((h) => h.getAttribute('style'));
            // A swapped text carries its own weights, as Heading writes them.
            // The heading's box is held to its room: a grid item's
            // `min-width: auto` grows it to its longest word, past its
            // track, so its own width would never show a run too wide. Its
            // transitions are off while it is read: a transition of any
            // length (reduced motion's was 0.01ms) hands a read straight
            // after the swap the size before it (Codex-1vs02).
            const weigh = (h: HTMLElement, k: number) => {
              h.style.transition = 'none';
              h.style.minInlineSize = '0';
              if (h.dataset.size !== 'heading') return;
              h.style.setProperty(
                '--lp-heading-run-caps',
                String(weights[k].caps)
              );
              h.style.setProperty(
                '--lp-heading-run-text',
                String(weights[k].text)
              );
              h.style.setProperty(
                '--lp-heading-run-chars',
                String(weights[k].chars)
              );
            };
            // Under reduced motion a style change can land a frame late.
            const frame = () =>
              new Promise((done) =>
                requestAnimationFrame(() => requestAnimationFrame(done))
              );
            const measure = async (louder: boolean) => {
              if (louder) root.dataset.lpDrama = 'louder';
              else delete root.dataset.lpDrama;
              await frame();
              const sizes: number[][] = headings.map(() => []);
              const overs: string[][][] = headings.map(() => []);
              for (const [k, { text }] of list.entries()) {
                for (const h of headings) {
                  h.textContent = text;
                  weigh(h, k);
                }
                headings.forEach((h, i) => {
                  sizes[i].push(
                    Number.parseFloat(getComputedStyle(h).fontSize)
                  );
                  overs[i].push(over(i, h, text));
                });
              }
              headings.forEach((h, i) => {
                h.innerHTML = originals[i];
                if (styles[i] === null) h.removeAttribute('style');
                else h.setAttribute('style', styles[i] as string);
              });
              return { sizes, overs };
            };
            const own = await measure(false);
            const louder = await measure(true);
            await measure(false);
            return headings.map((h, i) => ({
              where: `${h.closest('.lp-section')?.getAttribute('data-lp-type')}/${h.closest('.lp-section')?.getAttribute('data-lp-layout')} ${h.dataset.size}`,
              size: h.dataset.size ?? '',
              own: own.sizes[i],
              louder: louder.sizes[i],
              ownOver: own.overs[i],
              louderOver: louder.overs[i],
            }));
          },
          { list: texts, weights: runs }
        );
        const at = `${width} ${style}${face ? ` ${face}` : ''}`;
        const look = `${style}${face ? ` ${face}` : ''}`;
        let wholeStep = false;
        for (const h of read)
          texts.forEach(({ id }, j) => {
            const ratio = h.louder[j] / h.own[j];
            const newly = h.louderOver[j].filter(
              (run) => !h.ownOver[j].includes(run)
            );
            if (newly.length)
              faults.push(
                `${at} ${h.where} "${id}": louder draws ${newly.join(', ')} wider than its line`
              );
            if (ratio < 0.995)
              faults.push(
                `${at} ${h.where} "${id}": louder draws it at ${ratio.toFixed(3)} of its own size`
              );
            if (h.size !== 'heading' && ratio > 1.005)
              faults.push(
                `${at} ${h.where} "${id}": louder lifts a title to ${ratio.toFixed(3)}`
              );
            if (h.size === 'heading' && ratio > LOUDER - 0.005)
              wholeStep = true;
          });
        grew.set(look, (grew.get(look) ?? false) || wholeStep);
        const ownOver = read.flatMap((h) =>
          texts.flatMap(({ id }, j) =>
            h.ownOver[j].length ? [`${h.where} "${id}"`] : []
          )
        );
        if (ownOver.length)
          console.log(
            `${at}: the Style's own size draws ${ownOver.length} too wide, e.g. ${ownOver.slice(0, 3).join('; ')}`
          );
        expect(read.length, `${at} has section headings`).toBeGreaterThan(10);
        pairs++;
      }
    await context.close();
  }
  expect(pairs).toBe(WIDTHS.length * (STYLES.length + 4));
  for (const [look, any] of grew)
    if (!any) faults.push(`${look}: louder took no heading the whole step`);
  expect(faults).toEqual([]);
});

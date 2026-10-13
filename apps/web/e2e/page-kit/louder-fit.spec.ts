/**
 * A section heading's own size fits its widest word (Codex-61zsk.60; 03 X66),
 * and the type dial's louder fits every word a Style fits (Codex-61zsk.51;
 * X62), measured in every Style over a sweep of headings.
 *
 * OPT-IN, LOCAL: `LOUDER_FIT=1 pnpm exec playwright test louder-fit`. It
 * drives the page kit's gallery (`/studio/page-kit`), a development route
 * that a production build (CI's) does not have, and it sets 60 texts in every
 * section heading of the sample page, in 8 Styles at 5 widths, which takes
 * about sixteen minutes. Run it on any change to a heading's fit, to a
 * heading size, or to a layout that gives a head less room than its section's
 * column (that layout names the room, `--lp-heading-column`).
 *
 * Each text, a long word alone or 12 to 60 characters with a long word first
 * or last, is set in every heading but the hero's and weighed as Heading
 * weighs its own (`widestRun`). Held at the Style's size as it was before the
 * own-size fit (`--lp-heading-hold: 1`), at its own size, and at louder it
 * reads:
 *
 *   own fits       at its own size, a section heading whose room is known draws
 *                  no run wider than its line, unless the fit has taken it to
 *                  the title floor (logged); a held one is not fitted
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
 * What the Style's size, unfitted, draws too wide is counted in the log, and
 * with `CENSUS_OUT=<file.json>` every such (heading, text) is written there,
 * with how far its widest run overruns the line, what the fit drew it at and
 * whether a run is still over; so are the headings whose words fit that the
 * fit drew smaller, and by how much (the log gives the median and the most).
 *
 * The faces: the gallery's brand 0 (Archivo Black, the widest measured), and
 * in Bold and Poster, which draw the largest, Anton and Unbounded, the
 * narrowest and the widest the brand editor offers.
 */
import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { widestRun } from '../../src/lib/page-builder/kit/model/long-heading';
import { captureSeededCreatorCookies } from '../helpers/subscription';

test.skip(
  !process.env.LOUDER_FIT,
  'opt-in: LOUDER_FIT=1 (a development route, ~13 min)'
);
test.describe.configure({ mode: 'serial' });
test.setTimeout(60 * 60_000);

/** `LOUDER_FIT_STYLES=poster,bold` narrows the sweep, to calibrate a plant fast. */
const STYLES = [
  'bold',
  'clean',
  'soft',
  'cinematic',
  'path',
  'poster',
  'studio',
  'quiet',
].filter(
  (style) =>
    !process.env.LOUDER_FIT_STYLES ||
    process.env.LOUDER_FIT_STYLES.split(',').includes(style)
);
/** Bold and Poster are also read in the swapped faces. */
const LOOKS =
  STYLES.length +
  2 * STYLES.filter((s) => s === 'bold' || s === 'poster').length;
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

test('a heading fits its widest word at its own size and at louder, and holds what it cannot see', async ({
  browser,
}) => {
  const cookies = await captureSeededCreatorCookies();
  const texts = corpus();
  const runs = texts.map(({ text }) => widestRun(text));
  const faults: string[] = [];
  /** Each Style and face, and whether louder took any heading the whole step. */
  const grew = new Map<string, boolean>();
  let pairs = 0;
  /** CENSUS_OUT: every (heading, text) the Style's size, unfitted, draws too wide. */
  const census: Record<string, unknown>[] = [];
  /** Headings whose words fit at the Style's size that the fit drew smaller. */
  const shrunk: { at: string; where: string; id: string; by: number }[] = [];
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
            // How far its widest run overruns the line (1 is a run that just
            // fits): what an own-size fit would have to take off (CENSUS_OUT).
            const worst = (i: number, h: HTMLElement, text: string) => {
              const cs = getComputedStyle(h);
              const size = Number.parseFloat(cs.fontSize);
              const line =
                h.clientWidth -
                Number.parseFloat(cs.paddingLeft) -
                Number.parseFloat(cs.paddingRight);
              return Math.max(
                ...split(text).map(
                  (run) => ((per100[i].get(run) ?? 0) * size) / 100 / line
                )
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
            // raw: each section heading held at the Style's size
            // (`--lp-heading-hold: 1`), as it was drawn before the own-size
            // fit (03 X66), to see what the fit takes off and where.
            const measure = async (louder: boolean, raw = false) => {
              if (louder) root.dataset.lpDrama = 'louder';
              else delete root.dataset.lpDrama;
              await frame();
              const sizes: number[][] = headings.map(() => []);
              const overs: string[][][] = headings.map(() => []);
              const worsts: number[][] = headings.map(() => []);
              for (const [k, { text }] of list.entries()) {
                for (const h of headings) {
                  h.textContent = text;
                  weigh(h, k);
                  if (raw && h.dataset.size === 'heading')
                    h.style.setProperty('--lp-heading-hold', '1');
                }
                headings.forEach((h, i) => {
                  sizes[i].push(
                    Number.parseFloat(getComputedStyle(h).fontSize)
                  );
                  overs[i].push(over(i, h, text));
                  worsts[i].push(worst(i, h, text));
                });
              }
              headings.forEach((h, i) => {
                h.innerHTML = originals[i];
                if (styles[i] === null) h.removeAttribute('style');
                else h.setAttribute('style', styles[i] as string);
              });
              return { sizes, overs, worsts };
            };
            const rawRead = await measure(false, true);
            const own = await measure(false);
            const louder = await measure(true);
            await measure(false);
            // The title size in px in each heading's own context (a custom
            // property's computed value is its text, not a length).
            const titlePx = headings.map((h) => {
              const probe = document.createElement('span');
              probe.style.fontSize = 'var(--lp-size-title, 0px)';
              h.appendChild(probe);
              const px = Number.parseFloat(getComputedStyle(probe).fontSize);
              probe.remove();
              return px;
            });
            return headings.map((h, i) => ({
              where: `${h.closest('.lp-section')?.getAttribute('data-lp-type')}/${h.closest('.lp-section')?.getAttribute('data-lp-layout')} ${h.dataset.size}`,
              size: h.dataset.size ?? '',
              own: own.sizes[i],
              louder: louder.sizes[i],
              ownOver: own.overs[i],
              louderOver: louder.overs[i],
              raw: rawRead.sizes[i],
              rawOver: rawRead.overs[i],
              rawWorst: rawRead.worsts[i],
              held:
                getComputedStyle(h)
                  .getPropertyValue('--lp-heading-hold')
                  .trim() === '1',
              title: titlePx[i],
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
        // The own-size fit (03 X66): where a section heading's room is known,
        // its own size draws no run wider than its line, unless it is on the
        // title floor; and what it takes off a heading whose words fit.
        let floored = 0;
        for (const h of read)
          texts.forEach(({ id }, j) => {
            if (h.size !== 'heading' || h.held) return;
            const onFloor = h.own[j] <= h.title + 0.5;
            if (h.ownOver[j].length && onFloor) floored++;
            else if (h.ownOver[j].length)
              faults.push(
                `${at} ${h.where} "${id}": its own size draws ${h.ownOver[j].join(', ')} wider than its line`
              );
            if (!h.rawOver[j].length && h.own[j] < h.raw[j] - 0.5)
              shrunk.push({
                at,
                where: h.where,
                id,
                by: 1 - h.own[j] / h.raw[j],
              });
          });
        if (floored)
          console.log(
            `${at}: ${floored} on the title floor still run past their line`
          );
        const rawOver = read.flatMap((h) =>
          texts.flatMap(({ id }, j) =>
            h.rawOver[j].length ? [`${h.where} "${id}"`] : []
          )
        );
        for (const h of read)
          texts.forEach(({ id }, j) => {
            if (h.rawOver[j].length)
              census.push({
                width,
                look,
                where: h.where,
                size: h.size,
                id,
                runs: h.rawOver[j],
                raw: h.raw[j],
                own: h.own[j],
                still: h.ownOver[j],
                held: h.held,
                worst: Number(h.rawWorst[j].toFixed(3)),
              });
          });
        if (rawOver.length)
          console.log(
            `${at}: the Style's size, unfitted, draws ${rawOver.length} too wide, e.g. ${rawOver.slice(0, 3).join('; ')}`
          );
        expect(read.length, `${at} has section headings`).toBeGreaterThan(10);
        pairs++;
      }
    await context.close();
  }
  if (process.env.CENSUS_OUT)
    writeFileSync(
      process.env.CENSUS_OUT,
      JSON.stringify({ census, shrunk }, null, 1)
    );
  const by = shrunk.map((s) => s.by).sort((a, b) => a - b);
  if (by.length)
    console.log(
      `the fit drew ${by.length} headings that fit smaller: median ${(100 * by[Math.floor(by.length / 2)]).toFixed(1)}%, ` +
        `90th ${(100 * by[Math.floor(by.length * 0.9)]).toFixed(1)}%, most ${(100 * by[by.length - 1]).toFixed(1)}%`
    );
  expect(pairs).toBe(WIDTHS.length * LOOKS);
  for (const [look, any] of grew)
    if (!any) faults.push(`${look}: louder took no heading the whole step`);
  expect(faults).toEqual([]);
});

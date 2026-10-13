/**
 * A heading's own size fits its widest word: a section heading's (Codex-61zsk.60;
 * 03 X66), and a title's and a display statement's (Codex-61zsk.62; X71); and
 * the type dial's louder fits every word a Style fits (Codex-61zsk.51; X62),
 * measured in every Style over a sweep of headings.
 *
 * OPT-IN, LOCAL: `LOUDER_FIT=1 pnpm exec playwright test louder-fit`. It
 * drives the page kit's gallery (`/studio/page-kit`), a development route
 * that a production build (CI's) does not have, and it sets 60 texts in every
 * heading of the sample page, and of every layout with titles in every Style
 * (`PAGES`), in 8 Styles at 5 widths. Run it on any change
 * to a heading's fit, to a heading size, or to a layout that gives a head or
 * a title less room than its section's column (that layout names the room,
 * `--lp-heading-column` or `--lp-title-column`).
 *
 * Each text, a long word alone or 12 to 60 characters with a long word first
 * or last, is set in every heading but the hero's and weighed as Heading
 * weighs its own (`widestRun`). Held at its size as it was before the fit
 * (`--lp-heading-hold: 1`), at its own size, and at louder it reads:
 *
 *   own fits       at its own size, a heading draws no run wider than its line,
 *                  unless the fit has taken it to its floor (logged): a title's
 *                  is the body's size, every other's a title's. A held one is
 *                  not fitted
 *   rooms exact    where a card names its title's room, or a strip's heading
 *                  line its heading's, it is the title's line, its parent's
 *                  content box, to half a pixel
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
 * sits beside it, so the box is held to the room while it is read. A flex
 * item's is left as it is, since there that minimum decides what wraps.
 *
 * What the Style's size, unfitted, draws too wide is counted in the log, and
 * with `CENSUS_OUT=<file.json>` every such (heading, text) is written there,
 * with how far its widest run overruns the line, what the fit drew it at and
 * whether a run is still over; so are the headings whose words fit that the
 * fit drew smaller, and by how much (the log gives the median and the most).
 *
 * The faces: the gallery's brand 0 (Archivo Black, the widest measured), and
 * in Bold's and Poster's Type, which draw the largest, Anton and Unbounded,
 * the narrowest and the widest the brand editor offers.
 *
 * `LOUDER_FIT_TYPES=offered` also draws each Style in each Type it may take
 * (03 X73, X74), and `LOUDER_FIT_TYPES=all` in every Type, offered or not,
 * to measure a pair before the allow-list offers it.
 */
import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  TYPE_FACET_BASES,
  TYPE_FACETS,
} from '../../src/lib/page-builder/kit/model/ids';
import { widestRun } from '../../src/lib/page-builder/kit/model/long-heading';
import { captureSeededCreatorCookies } from '../helpers/subscription';

test.skip(
  !process.env.LOUDER_FIT,
  'opt-in: LOUDER_FIT=1 (a development route, ~25 min)'
);
test.describe.configure({ mode: 'serial' });
// Every Type on every base draws about three times the looks.
test.setTimeout((process.env.LOUDER_FIT_TYPES ? 180 : 60) * 60_000);

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
/** The page's own Type (`''`), and with `LOUDER_FIT_TYPES` each it may take. */
function typesOf(style: string): string[] {
  const types = process.env.LOUDER_FIT_TYPES;
  if (!types) return [''];
  return [
    '',
    ...(types === 'all'
      ? TYPE_FACETS.filter((type) => type !== style)
      : TYPE_FACET_BASES[style as keyof typeof TYPE_FACET_BASES]),
  ];
}
/** Each Style in each of its Types, and the Type it draws. */
const DRAWN = STYLES.flatMap((style) =>
  typesOf(style).map((type) => ({ style, type, drawn: type || style }))
);
/** Bold's and Poster's Type are also read in the swapped faces. */
const LOOKS =
  DRAWN.length +
  2 * DRAWN.filter((d) => d.drawn === 'bold' || d.drawn === 'poster').length;
const WIDTHS = [360, 390, 768, 1024, 1440];
/**
 * The sample page draws each section in its Style's own layout, so it reads a
 * layout only in the Styles that choose it. Four more pages draw every layout
 * with titles, and the problem's display statement, in every Style: a page
 * holds a type once, and the course has four (`layout=type:id`, one per type).
 * `LOUDER_FIT_PAGES=3` reads only the pages at those places here, likewise.
 */
const PAGES = [
  '',
  'only=benefits,curriculum,faq,pricing,testimonials,text,problem&offer=tiers&layout=benefits:grid,curriculum:timeline,faq:columns,pricing:cards,testimonials:quote,text:statement,problem:statement',
  'only=benefits,curriculum&layout=benefits:bento,curriculum:cards',
  'only=curriculum&layout=map',
  'only=curriculum&layout=layered',
].filter(
  (_, place) =>
    !process.env.LOUDER_FIT_PAGES ||
    process.env.LOUDER_FIT_PAGES.split(',').includes(String(place))
);
const FACES: { brand: string; face?: string }[] = [
  { brand: '0' },
  { brand: '0', face: 'Anton' },
  { brand: '0', face: 'Unbounded' },
];
/** Each face, on each page. */
const LOADS = FACES.flatMap((face) =>
  PAGES.map((extra) => ({ ...face, extra }))
);
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

test('a heading fits its widest word at its own size and at louder', async ({
  browser,
}) => {
  const cookies = await captureSeededCreatorCookies();
  const texts = corpus();
  const runs = texts.map(({ text }) => widestRun(text));
  const faults: string[] = [];
  /** Faults are printed as they are found, so a run cut short still says. */
  let logged = 0;
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
    for (const { style, type, drawn } of DRAWN)
      for (const { brand, face, extra } of LOADS) {
        if (face && drawn !== 'poster' && drawn !== 'bold') continue;
        const named = `${style}${type ? ` as ${type}` : ''}`;
        // A page that does not load is a fault, not the end of the run: an
        // hour of reading was once lost to one slow worker (a 408 on the
        // studio's membership check). The run still fails; the rest of it
        // still reads.
        try {
          await page.goto(
            `http://studio-alpha.lvh.me:5173/studio/page-kit?style=${style}${type ? `&type=${type}` : ''}&brand=${brand}&theme=light&chrome=0${extra ? `&${extra}` : ''}`
          );
          await page
            .locator('.lp .lp-section')
            .first()
            .waitFor({ timeout: 60_000 });
        } catch (error) {
          faults.push(
            `${width} ${named}${face ? ` ${face}` : ''}${extra ? ` (${extra})` : ''}: the gallery did not load: ${String(error).split('\n')[0]}`
          );
          console.log(`FAULT ${faults[faults.length - 1]}`);
          logged = faults.length;
          continue;
        }
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
            // A grid item's box is held to its room: its `min-width: auto`
            // grows it to its longest word, past its track, so its own width
            // would never show a run too wide. A flex item's is not: there
            // that minimum is the layout, which wraps whatever sits beside a
            // heading under it when the heading's longest word needs the line
            // (the map's count, 03 X71), and zeroing it would read a line the
            // page never draws. Its transitions are off while it is read: a
            // transition of any length (reduced motion's was 0.01ms) hands a
            // read straight after the swap the size before it (Codex-1vs02).
            const inGrid = headings.map((h) =>
              /grid/.test(
                h.parentElement ? getComputedStyle(h.parentElement).display : ''
              )
            );
            const weigh = (h: HTMLElement, k: number) => {
              h.style.transition = 'none';
              if (inGrid[headings.indexOf(h)]) h.style.minInlineSize = '0';
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
            // raw: each heading held at its size (`--lp-heading-hold: 1`), as
            // it was drawn before the fit (03 X66, X71), to see what the fit
            // takes off and where.
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
                  if (raw) h.style.setProperty('--lp-heading-hold', '1');
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
            // Where a card names its title's room (03 X71), or a strip's
            // heading line names its heading's (Codex-61zsk.55), the room is
            // the title's line: its parent's content box, read beside a probe
            // drawn at that room. Too wide and a word runs past its line;
            // too narrow and a name that fits is drawn smaller. A section's
            // `--lp-heading-column` elsewhere is a cap, not a line, so it is
            // read only in a strip's heading line.
            const rooms = headings.map((h) => {
              if (h.dataset.size !== 'title') return null;
              const name = getComputedStyle(h)
                .getPropertyValue('--lp-title-column')
                .trim()
                ? '--lp-title-column'
                : h.closest('.lp-strip__head')
                  ? '--lp-heading-column'
                  : null;
              if (!name) return null;
              const probe = document.createElement('div');
              probe.style.cssText = `position:absolute;visibility:hidden;inline-size:var(${name})`;
              h.appendChild(probe);
              const named = probe.getBoundingClientRect().width;
              probe.remove();
              // Its own width, not `clientWidth`, which rounds to a pixel.
              const parent = h.parentElement as HTMLElement;
              const cs = getComputedStyle(parent);
              const line =
                parent.getBoundingClientRect().width -
                [
                  cs.paddingLeft,
                  cs.paddingRight,
                  cs.borderLeftWidth,
                  cs.borderRightWidth,
                ].reduce((sum, px) => sum + Number.parseFloat(px), 0);
              return { named, line };
            });
            // Each heading's floor in px in its own context (a custom
            // property's computed value is its text, not a length): a
            // title's is the body's size, every other's a title's.
            const floorPx = headings.map((h) => {
              const probe = document.createElement('span');
              probe.style.fontSize =
                h.dataset.size === 'title'
                  ? 'var(--lp-size-body, 0px)'
                  : 'var(--lp-size-title, 0px)';
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
              floor: floorPx[i],
              room: rooms[i],
            }));
          },
          { list: texts, weights: runs }
        );
        const at = `${width} ${named}${face ? ` ${face}` : ''}${extra ? ` (${extra})` : ''}`;
        const look = `${named}${face ? ` ${face}` : ''}`;
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
        for (const h of read)
          if (h.room && Math.abs(h.room.named - h.room.line) > 0.5)
            faults.push(
              `${at} ${h.where}: its layout names a room of ${h.room.named.toFixed(1)}px for a line of ${h.room.line.toFixed(1)}px`
            );
        // The own-size fit (03 X66, X71): a heading's own size draws no run
        // wider than its line, unless it is on its floor; and what it takes
        // off a heading whose words fit.
        let floored = 0;
        for (const h of read)
          texts.forEach(({ id }, j) => {
            if (h.held) return;
            const onFloor = h.own[j] <= h.floor + 0.5;
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
            `${at}: ${floored} on their floor still run past their line`
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
        // A layout's own page reads its titles, so a gallery that drew
        // nothing there could not pass.
        if (extra)
          expect(
            read.some((h) => h.size === 'title'),
            `${at} has titles`
          ).toBe(true);
        else
          expect(read.length, `${at} has section headings`).toBeGreaterThan(10);
        for (const fault of faults.slice(logged)) console.log(`FAULT ${fault}`);
        logged = faults.length;
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
  for (const [look, any] of grew)
    if (!any) faults.push(`${look}: louder took no heading the whole step`);
  expect(faults).toEqual([]);
  expect(pairs).toBe(WIDTHS.length * LOOKS * PAGES.length);
});

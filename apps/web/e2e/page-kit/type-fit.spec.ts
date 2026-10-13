/**
 * A borrowed Type holds its base's hero fit (Codex-61zsk.56; 03 X74, the
 * data design's H3), measured for every pair the Type facet offers.
 *
 * OPT-IN, LOCAL: `TYPE_FIT=1 pnpm exec playwright test type-fit`. It drives
 * the page kit's gallery (`/studio/page-kit`), a development route that a
 * production build (CI's) does not have, with its proof override (`?type=`).
 * Run it on any change to a hero's size, to a Style's column or hero spacing,
 * or to the allow-list (`TYPE_FACET_BASES`).
 *
 * A Type's hero was fitted on its own Style (X34): to its column, its
 * spacing, its eyebrow and its buttons. On another Style's page the line is
 * the base's, so the fit does not carry over. Each pair is held to the base's
 * own page, the control, drawn in the same page load with the root's Type
 * set back to the base. For each hero layout, brand (0 and 3: Archivo Black
 * and Syne) and width, it sets every headline of 20 to 120 characters, plain
 * or with a long word first, between or last, as HeroBlock sets it
 * (`model/long-heading.ts`), and holds the pair to:
 *
 *   the fold       at 1440 × 900 the headline, its lede and its buttons end
 *                  no further past the first screen than the control's do,
 *                  and within it wherever the control's do
 *   no word cut    at 1440 no run is drawn on two lines that the control
 *                  draws on one
 *   nothing over   the poster draws no glyph or button over its picture that
 *                  the control keeps clear
 *   no overflow    at 390 no headline glyph runs past its column, and the
 *                  page never scrolls sideways, where the control's do not
 *
 * The control's own misses are counted in the log, not failed here: they are
 * the base's (X34's) to fix, and a pair is drawn no worse.
 *
 * `TYPE_FIT_SEARCH=1` measures each pair's factor instead (`--lp-type-fit`,
 * set inline on the hero's words): the largest, by bisection, at which the
 * pair holds at 1440 in both brands, written per layout to
 * `TYPE_FIT_OUT=<file.json>` when it is given. The factor declared is 99% of
 * the least, as X34 kept 1% to spare.
 *
 * `TYPE_FIT_PAIRS=bold:poster,soft:bold` (every pair a Style may take, from
 * any Style but Path and Studio, without it), `TYPE_FIT_LAYOUTS`,
 * `TYPE_FIT_BRANDS` and `TYPE_FIT_WIDTHS` narrow the run; `TYPE_FIT_EYEBROW`
 * sets the hero's eyebrow, a chip on Soft and Poster.
 */
import { writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import {
  TYPE_FACET_BASES,
  TYPE_FACETS,
} from '../../src/lib/page-builder/kit/model/ids';
import { headingRuns } from '../../src/lib/page-builder/kit/model/long-heading';
import { captureSeededCreatorCookies } from '../helpers/subscription';

test.skip(!process.env.TYPE_FIT, 'opt-in: TYPE_FIT=1 (a development route)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(240 * 60_000);

const SEARCH = Boolean(process.env.TYPE_FIT_SEARCH);
/** Path and Studio are not bases: their marks read their Type's numbers. */
const BASES = ['bold', 'clean', 'soft', 'cinematic', 'poster', 'quiet'];
const PAIRS: [string, string][] = process.env.TYPE_FIT_PAIRS
  ? process.env.TYPE_FIT_PAIRS.split(',').map(
      (pair) => pair.split(':') as [string, string]
    )
  : BASES.flatMap((base) =>
      (SEARCH
        ? TYPE_FACETS.filter((type) => type !== base)
        : TYPE_FACET_BASES[base as keyof typeof TYPE_FACET_BASES]
      ).map((type) => [base, type] as [string, string])
    );
const LAYOUTS = (
  process.env.TYPE_FIT_LAYOUTS ?? 'statement,split,cover,centered,poster'
).split(',');
const BRANDS = (process.env.TYPE_FIT_BRANDS ?? '0,3').split(',');
const WIDTHS = (process.env.TYPE_FIT_WIDTHS ?? (SEARCH ? '1440' : '1440,390'))
  .split(',')
  .map(Number);
const EYEBROW = process.env.TYPE_FIT_EYEBROW;

const SHORT =
  'find your calm and steady ground rest slow the breath of quiet body home light walk to sea each day a new way back for you with care in'.split(
    ' '
  );
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

function fill(target: number, seed: number): string[] {
  const words: string[] = [];
  for (let i = seed; words.join(' ').length < target; i++)
    words.push(SHORT[i % SHORT.length]);
  return words;
}

/** Every length from 20 to 120: plain, and a long word first, between, last. */
function headlines() {
  const out: { id: string; words: string[] }[] = [];
  for (let length = 20; length <= 120; length++) {
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

type Headline = ReturnType<typeof headlines>[number];

/** What one headline draws: how far past the fold it ends (1440), the runs
 *  it cuts, what lies over the poster's picture, and (390) its glyphs past
 *  the column and whether the page scrolls sideways. */
interface Drawn {
  id: string;
  end: number;
  cuts: string[];
  over: string[];
  past: number;
  sideways: boolean;
}

/** Every headline, drawn with the root's Type set to `facet` and, when
 *  given, the hero's words scaled by `fit`. */
async function draw(
  page: Page,
  list: Headline[],
  facet: string,
  layout: string,
  wide: boolean,
  fit?: number
): Promise<Drawn[]> {
  return page.evaluate(
    ({ list, facet, layout, wide, fit }) => {
      const root = document.querySelector('.lp') as HTMLElement;
      root.dataset.lpTypeFacet = facet;
      const hero = document.querySelector(
        '.lp-section[data-lp-type="hero"]'
      ) as HTMLElement;
      const words = hero.querySelector('.hero__headline') as HTMLElement;
      const heading = words.querySelector('.lp-heading') as HTMLElement;
      const copy = words.parentElement as HTMLElement;
      if (fit === undefined) copy.style.removeProperty('--lp-type-fit');
      else copy.style.setProperty('--lp-type-fit', String(fit));
      const lengthRoot = words.closest(
        '[style*="--lp-heading-chars"]'
      ) as HTMLElement | null;
      const reveal = hero.querySelector(
        '.hero-poster__reveal'
      ) as HTMLElement | null;
      const glyphs = (el: Element) => {
        const rects: DOMRect[] = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
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
      const out: Drawn[] = [];
      for (const { id, text, runs } of list) {
        heading.textContent = text;
        words.toggleAttribute(
          'data-medium',
          text.length > 24 && text.length <= 64
        );
        words.toggleAttribute('data-long', text.length > 64);
        if (lengthRoot) {
          lengthRoot.style.setProperty(
            '--lp-heading-chars',
            String(text.length)
          );
          if (layout === 'poster')
            for (const [part, size] of Object.entries(runs))
              for (const [key, value] of Object.entries(size))
                lengthRoot.style.setProperty(
                  `--lp-heading-${part}-${key}`,
                  String(value)
                );
        }
        const column = (
          hero.querySelector('.lp-inner') as HTMLElement
        ).getBoundingClientRect();
        const lede = hero.querySelector('.hero__lede');
        const buttons = [...hero.querySelectorAll('.hero__actions .lp-button')];
        const ink = glyphs(heading);
        const drawn: Drawn = {
          id,
          end: 0,
          cuts: [],
          over: [],
          past: 0,
          sideways: false,
        };
        if (wide) {
          drawn.end =
            Math.max(
              ...ink.map((r) => r.bottom),
              lede?.getBoundingClientRect().bottom ?? 0,
              ...buttons.map((b) => b.getBoundingClientRect().bottom)
            ) +
            window.scrollY -
            window.innerHeight;
          const node = heading.firstChild as Text;
          const range = document.createRange();
          const line = Number.parseFloat(getComputedStyle(heading).lineHeight);
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
                drawn.cuts.push(run);
              start += run.length;
            }
            start += 1;
          }
        } else {
          drawn.past = ink.filter(
            (r) => r.right > column.right + 1 || r.left < column.left - 1
          ).length;
          drawn.sideways =
            document.documentElement.scrollWidth > window.innerWidth;
        }
        if (reveal) {
          const picture = reveal.getBoundingClientRect();
          const over = (r: DOMRect) =>
            Math.min(r.right, picture.right) - Math.max(r.left, picture.left) >
              1 &&
            Math.min(r.bottom, picture.bottom) - Math.max(r.top, picture.top) >
              1;
          drawn.over = [
            ...new Set([
              ...ink.filter(over).map(() => 'headline'),
              ...(lede
                ? glyphs(lede)
                    .filter(over)
                    .map(() => 'lede')
                : []),
              ...buttons
                .filter((b) => over(b.getBoundingClientRect()))
                .map(() => 'button'),
            ]),
          ];
        }
        out.push(drawn);
      }
      return out;
    },
    { list, facet, layout, wide, fit }
  );
}

/** Where the pair draws worse than its base's own page, headline by headline. */
function worse(control: Drawn[], pair: Drawn[], wide: boolean): string[] {
  const own = new Map(control.map((drawn) => [drawn.id, drawn]));
  const faults: string[] = [];
  for (const drawn of pair) {
    const base = own.get(drawn.id) as Drawn;
    if (wide && drawn.end > Math.max(0, base.end) + 0.5)
      faults.push(
        `${drawn.id}: ends ${Math.round(drawn.end)}px past the fold (its base's own, ${Math.round(base.end)})`
      );
    for (const run of drawn.cuts)
      if (!base.cuts.includes(run)) faults.push(`${drawn.id}: "${run}" cut`);
    for (const kind of drawn.over)
      if (!base.over.includes(kind))
        faults.push(`${drawn.id}: its ${kind} over the picture`);
    if (drawn.past > base.past)
      faults.push(`${drawn.id}: ${drawn.past} glyphs past the column`);
    if (drawn.sideways && !base.sideways)
      faults.push(`${drawn.id}: the page scrolls sideways`);
  }
  return faults;
}

/** The control's own misses, counted for the log. */
function misses(control: Drawn[], wide: boolean): number {
  return control.filter(
    (drawn) =>
      (wide && drawn.end > 0.5) ||
      drawn.cuts.length > 0 ||
      drawn.over.length > 0 ||
      drawn.past > 0 ||
      drawn.sideways
  ).length;
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const pictures = [
      ...document.querySelectorAll<HTMLImageElement>('.lp img'),
    ];
    for (const img of pictures) img.loading = 'eager';
    await Promise.all(
      pictures.map((img) =>
        img.complete
          ? null
          : new Promise((done) => {
              img.addEventListener('load', done, { once: true });
              img.addEventListener('error', done, { once: true });
              setTimeout(done, 5000);
            })
      )
    );
  });
}

test('a borrowed Type holds its base’s hero fit', async ({ browser }) => {
  expect(PAIRS.length, 'no pair to measure').toBeGreaterThan(0);
  const cookies = await captureSeededCreatorCookies();
  const list = headlines();
  const faults: string[] = [];
  const fits: Record<string, number> = {};
  let read = 0;
  for (const width of WIDTHS) {
    const wide = width >= 1024;
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
    });
    await context.addCookies(cookies);
    const page = await context.newPage();
    for (const [base, type] of PAIRS)
      for (const brand of BRANDS)
        for (const layout of LAYOUTS) {
          const name = `${width} ${base} as ${type} brand ${brand} ${layout}`;
          await page.goto(
            `http://studio-alpha.lvh.me:5173/studio/page-kit?style=${base}&type=${type}&brand=${brand}&only=hero&layout=${layout}&theme=light&chrome=0${EYEBROW ? `&eyebrow=${encodeURIComponent(EYEBROW)}` : ''}`
          );
          await page
            .locator('.lp-section[data-lp-type="hero"] .hero__headline')
            .waitFor({ timeout: 60_000 });
          await settle(page);
          const control = await draw(page, list, base, layout, wide);
          const own = misses(control, wide);
          const found = worse(
            control,
            await draw(page, list, type, layout, wide, SEARCH ? 1 : undefined),
            wide
          );
          read++;
          if (SEARCH && found.length > 0) {
            // A smaller hero only ends higher and cuts fewer words, so the
            // bisection reads only the headlines that miss at full size; the
            // factor it finds is then read over every headline, and lowered
            // until it holds there too.
            const missed = new Set(found.map((fault) => fault.split(':')[0]));
            const some = list.filter((headline) => missed.has(headline.id));
            const holds = async (fit: number, over = some) =>
              worse(
                control,
                await draw(page, over, type, layout, wide, fit),
                wide
              ).length === 0;
            // The largest factor that holds: 0.5 is as deep as a Type may go.
            let low = 0.5;
            let high = 1;
            if (!(await holds(low))) low = 0;
            else
              for (let step = 0; step < 7; step++) {
                const mid = (low + high) / 2;
                if (await holds(mid)) low = mid;
                else high = mid;
              }
            while (low > 0 && !(await holds(low, list)))
              low = Math.max(0, low - 0.01);
            const key = `${base}:${type}:${layout}`;
            fits[key] = Math.min(fits[key] ?? 1, low);
            console.log(
              `FIT ${name}: ${low.toFixed(3)} (at 1: ${found.length}, e.g. ${found[0]}; its base's own misses ${own})`
            );
            continue;
          }
          if (SEARCH) {
            const key = `${base}:${type}:${layout}`;
            fits[key] = Math.min(fits[key] ?? 1, 1);
          }
          for (const fault of found) faults.push(`${name} ${fault}`);
          console.log(
            `${found.length ? 'FAULT' : 'ok'} ${name}: ${found.length} worse (${found.slice(0, 2).join(' ; ')}), its base's own misses ${own}`
          );
        }
    await context.close();
  }
  if (SEARCH) {
    const declared = Object.fromEntries(
      Object.entries(fits).map(([key, fit]) => [
        key,
        fit >= 1 ? 1 : Math.floor(fit * 0.99 * 100) / 100,
      ])
    );
    console.log(`FITS ${JSON.stringify(declared)}`);
    if (process.env.TYPE_FIT_OUT)
      writeFileSync(
        process.env.TYPE_FIT_OUT,
        JSON.stringify({ measured: fits, declared }, null, 2)
      );
  }
  expect(read).toBe(
    PAIRS.length * BRANDS.length * LAYOUTS.length * WIDTHS.length
  );
  expect(faults, faults.slice(0, 30).join('\n')).toEqual([]);
});

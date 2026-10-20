/**
 * Each brand face's own fallback (Codex-61zsk.61, 03 X67), measured: how much
 * a page re-wraps when a brand face lands.
 *
 * OPT-IN, LOCAL: `FONT_FALLBACKS=1 pnpm exec playwright test font-fallbacks`
 * checks the table in `lib/brand-editor/font-fallbacks.ts`;
 * `FONT_FALLBACKS=measure` measures every face anew and prints the table's
 * rows, for a face the brand editor adds or a face Google Fonts changes. The
 * corpus loads all 49 faces from Google Fonts (about two minutes); the pages
 * need the local stack and its seed. Measured on macOS: Linux draws each
 * local face's Liberation twin, which has the same widths.
 *
 *   the corpus  each face sets 24 headlines and 8 ledes in boxes 300 to
 *               1100px wide, at 6 of the kit's sizes and weights (864
 *               settings), at a fixed line height and with
 *               `font-synthesis: none`, as the kit draws; then each fallback
 *               it might be drawn in until it lands sets them too. A setting
 *               re-wraps where the line counts differ. The face against
 *               itself is the instrument's zero. Each face is measured anew
 *               on each local face, as the table was. Held: every row of the
 *               table within half a point of size and a point of each line
 *               metric of what is measured now, on the local face that
 *               re-wraps less; and the face's own fallback re-wrapping a
 *               median under 3% and none over 7%, under a quarter of what one
 *               fallback for every face re-wraps (Arial sized for Inter,
 *               'Inter-fallback'; or the browser's default serif, what a face
 *               alone drew)
 *   the pages   each seeded sell page is drawn with every font file refused
 *               (the fallbacks throughout) and again with them loaded, once
 *               everything has settled, so no timing is in it; every text
 *               block is matched by order. Held: no block breaks onto a
 *               different number of lines at the same width, and none
 *               whose own width moved with the font, as a measure in `ch`
 *               did until each counted its face's own `0`s (Codex-61zsk.64:
 *               22 such blocks on the three local sell pages, then 0). A box
 *               sized to its words moves with them too and is counted the
 *               same; telling it from a measure by the box's own
 *               `max-inline-size` misses a measure set on its wrapper (8 of
 *               the 22). Drawing the page twice with the fonts refused is the
 *               instrument's zero.
 */
import { expect, type Page, test } from '@playwright/test';
import {
  getBodyFonts,
  getHeadingFonts,
} from '../../src/lib/brand-editor/font-catalog';
import {
  FACE_FALLBACK,
  FALLBACK_WEIGHTS,
  fallbackRules,
} from '../../src/lib/brand-editor/font-fallbacks';

const MODE = process.env.FONT_FALLBACKS;
test.skip(
  !MODE,
  'opt-in: FONT_FALLBACKS=1 (or =measure); Google Fonts and the local stack, ~4 min'
);
test.describe.configure({ mode: 'serial' });
test.setTimeout(20 * 60_000);

/** One running sentence of mixed case, figures and a price: what a size is fitted to. */
const SAMPLE =
  'Tending the grief: a gentle six-week practice. The quick brown fox jumps over the lazy dog, and nobody minds. Join now for £12 a month.';
const HEADLINES = [
  'Tending the grief',
  'Your mornings, calmer',
  'Back resilience for you',
  'Return to the shoreline',
  'Ancestral threads: a year of making',
  'Six weeks to a steadier mind',
  'Breathwork for anxious beginners',
  'The quiet practice of noticing',
  'Transformation: your calm',
  'Strength, mobility and patience',
  'What you will learn',
  'Questions people ask',
  'Meet your guide',
  'Bone deep: rebuilding from the ground up',
  'A slower way to begin again',
  'Everything inside the course',
  'Find your footing after loss',
  'Morning pages, evening walks',
  'Grief is not a problem to solve',
  'Learn to rest without guilt',
  'Thirty days of gentle movement',
  'Rituals for the turning year',
  'How the practice changes you',
  'Join hundreds of quiet learners',
];
const LEDES = [
  'A six-week course for anyone carrying a loss, with short daily practices you can do in ten minutes before work.',
  'Gentle sessions that rebuild strength from the ground up, recorded in a small studio by the sea and paced for real bodies.',
  'Every lesson is yours to keep. Watch on your phone, your laptop or your television, and come back whenever you need it.',
  'We start with the breath, move to the body, and end each week with a letter you write to yourself and read a month later.',
  'Join a community of people learning to slow down, with live circles every Sunday evening and a recording if you miss one.',
  'No experience needed. Most people find their first week the hardest, and the second the one that changes how they sleep.',
  'Taught by a guide with twenty years of practice, who has walked this road herself and writes to every student by name.',
  'Includes forty-two videos, twelve audio meditations, a printable journal and lifetime access for one simple price.',
];
/** [kind, px, weight, line height]: the kit's display, heading, lede and body. */
const STYLES: [string, number, number, number][] = [
  ['display', 56, 700, 1.05],
  ['heading', 36, 700, 1.15],
  ['heading-600', 36, 600, 1.15],
  ['lede-600', 20, 600, 1.45],
  ['lede-500', 20, 500, 1.45],
  ['body', 17, 400, 1.6],
];
const WIDTHS = [300, 340, 390, 480, 560, 640, 760, 900, 1100];

const FACES = [...getHeadingFonts(), ...getBodyFonts()]
  .filter(
    (font, i, all) => all.findIndex((f) => f.family === font.family) === i
  )
  .map((font) => ({ face: font.family, mono: font.category === 'monospace' }));

async function loadFaces(page: Page) {
  await page.setContent(
    '<!doctype html><html><head></head><body></body></html>'
  );
  for (const { face } of FACES) {
    const family = encodeURIComponent(face);
    // A face with one weight answers a request for four with an error.
    await page
      .addStyleTag({
        url: `https://fonts.googleapis.com/css2?family=${family}:wght@400;500;600;700&display=block`,
      })
      .catch(() =>
        page.addStyleTag({
          url: `https://fonts.googleapis.com/css2?family=${family}&display=block`,
        })
      );
  }
}

type Rates = Record<string, Record<string, { n: number; rewrap: number }>>;

test('each face’s own fallback re-wraps a corpus far less than one fallback for all', async ({
  page,
}) => {
  await loadFaces(page);
  const shipped = Object.keys(FACE_FALLBACK).flatMap(fallbackRules).join('\n');
  const { rates, measured } = await page.evaluate(
    async ({
      faces,
      sample,
      headlines,
      ledes,
      styles,
      widths,
      weights,
      shipped,
    }) => {
      for (const { face } of faces)
        for (const w of weights)
          await document.fonts
            .load(`${w} 100px "${face}"`, sample)
            .catch(() => {});
      const css: string[] = [shipped];
      // Each face measured anew on each local face it might fall back to, as
      // the table was: the size from its width, the line metrics from canvas.
      const measured: Record<string, { local: string; rows: number[][] }[]> =
        {};
      const span = document.createElement('span');
      span.style.cssText =
        'position:absolute;white-space:nowrap;font-synthesis:none;font-size:100px;visibility:hidden';
      span.textContent = sample;
      document.body.appendChild(span);
      const width = (family: string, w: number) => {
        span.style.fontFamily = family;
        span.style.fontWeight = String(w);
        return span.getBoundingClientRect().width;
      };
      const canvas = document
        .createElement('canvas')
        .getContext('2d') as CanvasRenderingContext2D;
      // The weights a face has, and the one CSS font matching draws for each asked.
      const has = (face: string) =>
        [
          ...new Set(
            [...document.fonts]
              .filter(
                (f) =>
                  f.family.replace(/["']/g, '') === face &&
                  f.status === 'loaded'
              )
              .map((f) => Number(f.weight))
          ),
        ].sort((a, b) => a - b);
      const drawn = (avail: number[], w: number) => {
        if (avail.includes(w)) return w;
        const up = avail.filter((a) => a > w);
        const down = avail.filter((a) => a < w).reverse();
        if (w >= 400 && w <= 500)
          return up.find((a) => a <= 500) ?? down[0] ?? up[0];
        return w > 500 ? (up[0] ?? down[0]) : (down[0] ?? up[0]);
      };
      for (const { face, mono } of faces) {
        const avail = has(face);
        measured[face] = [];
        for (const local of mono
          ? ['Courier New']
          : ['Arial', 'Times New Roman']) {
          const rows = weights.map((w) => {
            const u = drawn(avail, w) ?? 400;
            const bold = u >= 600;
            // Rounded as the table was: the size to 4 places, the metrics to 3.
            const size = Number(
              (
                width(`"${face}"`, w) / width(`"${local}"`, bold ? 700 : 400)
              ).toFixed(4)
            );
            canvas.font = `${u} 100px "${face}"`;
            const m = canvas.measureText(sample);
            const ascent = Number((m.fontBoundingBoxAscent / 100).toFixed(3));
            const descent = Number((m.fontBoundingBoxDescent / 100).toFixed(3));
            return [
              bold ? 1 : 0,
              100 * size,
              (100 * ascent) / size,
              (100 * descent) / size,
            ].map((v) => Math.round(v * 100) / 100);
          });
          measured[face].push({ local, rows });
          rows.forEach(([bold, size, ascent, descent], i) => {
            css.push(
              `@font-face { font-family: 'X-${local}-${face}'; src: local('${local}${bold ? ' Bold' : ''}'); font-weight: ${weights[i]}; size-adjust: ${size}%; ascent-override: ${ascent}%; descent-override: ${descent}%; line-gap-override: 0%; }`
            );
          });
        }
      }
      const style = document.createElement('style');
      style.textContent = css.join('\n');
      document.head.appendChild(style);
      const box = document.createElement('div');
      box.style.cssText =
        'position:absolute;left:0;top:0;overflow-wrap:break-word;text-wrap:balance;font-synthesis:none;';
      document.body.appendChild(box);
      const lines = (
        family: string,
        text: string,
        px: number,
        w: number,
        lh: number,
        bw: number
      ) => {
        box.style.fontFamily = family;
        box.style.fontSize = `${px}px`;
        box.style.fontWeight = String(w);
        box.style.lineHeight = `${lh * px}px`;
        box.style.width = `${bw}px`;
        box.textContent = text;
        return Math.round(box.getBoundingClientRect().height / (lh * px));
      };
      // Prime every local face once, so none is still resolving when it is counted.
      for (const name of new Set(
        css.join('\n').match(/font-family: '[^']+'/g) ?? []
      ))
        for (const w of weights)
          lines(name.slice(13), 'prime', 20, w, 1.2, 300);
      const rates: Rates = {};
      for (const { face, mono } of faces) {
        const candidates: Record<string, string> = {
          self: `"${face}"`,
          'default serif': '"Times New Roman"',
          'Inter-fallback': "'Inter-fallback'",
          own: `'${face}-fallback'`,
        };
        for (const local of mono
          ? ['Courier New']
          : ['Arial', 'Times New Roman'])
          candidates[local] = `'X-${local}-${face}'`;
        rates[face] = Object.fromEntries(
          Object.keys(candidates).map((c) => [c, { n: 0, rewrap: 0 }])
        );
        for (const [kind, px, w, lh] of styles) {
          const texts =
            kind.startsWith('lede') || kind === 'body' ? ledes : headlines;
          for (const text of texts)
            for (const bw of widths) {
              const real = lines(`"${face}"`, text, px, w, lh, bw);
              for (const [c, family] of Object.entries(candidates)) {
                const cell = rates[face][c];
                cell.n++;
                if (lines(family, text, px, w, lh, bw) !== real) cell.rewrap++;
              }
            }
        }
      }
      return { rates, measured };
    },
    {
      faces: FACES,
      sample: SAMPLE,
      headlines: HEADLINES,
      ledes: LEDES,
      styles: STYLES,
      widths: WIDTHS,
      weights: [...FALLBACK_WEIGHTS],
      shipped,
    }
  );

  const pct = (c: { n: number; rewrap: number }) => (100 * c.rewrap) / c.n;
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2
      ? s[(s.length - 1) / 2]
      : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  for (const [face, byCandidate] of Object.entries(rates))
    console.log(
      `${face.padEnd(20)} ${Object.entries(byCandidate)
        .map(([c, cell]) => `${c} ${pct(cell).toFixed(1)}%`)
        .join('  ')}`
    );

  // The table anew: each face on the local face that re-wraps less (Arial on a tie).
  const best = (face: string) =>
    measured[face].reduce((a, b) =>
      rates[face][b.local].rewrap < rates[face][a.local].rewrap ? b : a
    );
  if (MODE === 'measure') {
    for (const face of Object.keys(measured)) {
      const { local, rows } = best(face);
      const key = /^[A-Za-z]\w*$/.test(face) ? face : `'${face}'`;
      console.log(
        `  ${key}: ['${local}', [${rows.map((r) => `[${r.join(', ')}]`).join(', ')}]],`
      );
    }
    return;
  }

  for (const [face, [local, rows]] of Object.entries(FACE_FALLBACK)) {
    const now = measured[face].find((m) => m.local === local);
    expect(now, `${face} on ${local}`).toBeDefined();
    expect(
      rates[face][local].rewrap,
      `${face}: ${local} re-wraps more than ${best(face).local}`
    ).toBe(rates[face][best(face).local].rewrap);
    rows.forEach(([bold, size, ascent, descent], i) => {
      const [nowBold, nowSize, nowAscent, nowDescent] = now?.rows[i] ?? [];
      const at = `${face} ${FALLBACK_WEIGHTS[i]}`;
      expect(bold, `${at} draws ${nowBold ? 'Bold' : 'regular'} now`).toBe(
        nowBold
      );
      expect(
        Math.abs(size - (nowSize ?? 0)),
        `${at} size-adjust ${size}% (now ${nowSize}%)`
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(ascent - (nowAscent ?? 0)),
        `${at} ascent ${ascent}% (now ${nowAscent}%)`
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(descent - (nowDescent ?? 0)),
        `${at} descent ${descent}% (now ${nowDescent}%)`
      ).toBeLessThanOrEqual(1);
    });
  }

  const settings =
    HEADLINES.length * 3 * WIDTHS.length + LEDES.length * 3 * WIDTHS.length;
  for (const [face, byCandidate] of Object.entries(rates)) {
    expect(byCandidate.self.n, face).toBe(settings);
    expect(byCandidate.self.rewrap, `${face} against itself`).toBe(0);
  }
  const of = (c: string) => Object.values(rates).map((r) => pct(r[c]));
  const own = of('own');
  expect(median(own), 'median, own fallback').toBeLessThan(3);
  expect(Math.max(...own), 'most, own fallback').toBeLessThan(7);
  for (const one of ['Inter-fallback', 'default serif'])
    expect(median(own), `median, against ${one}`).toBeLessThan(
      median(of(one)) / 4
    );
});

const PAGES = (
  process.env.FONT_FALLBACK_PAGES ??
  'studio-alpha/tending-the-grief,studio-alpha/bone-deep'
)
  .split(',')
  .map((path) => path.split('/') as [string, string]);
const VIEWPORTS = [390, 768, 1024, 1440];

/** Every text block's text, height and width, once the page has settled. */
async function draw(page: Page, org: string, slug: string) {
  await page.goto(`http://${org}.lvh.me:5173/journeys/${slug}`, {
    waitUntil: 'load',
  });
  await page
    .waitForLoadState('networkidle', { timeout: 30_000 })
    .catch(() => {});
  await page.waitForTimeout(3000);
  return page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '.lp :is(h1, h2, h3, h4, p, li, blockquote, figcaption, dt, dd, a.lp-button, button)'
      ),
    ]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          where: `${el.closest('[data-lp-type]')?.getAttribute('data-lp-type') ?? '?'} ${el.tagName.toLowerCase()}`,
          text: (el.textContent ?? '').trim().slice(0, 40),
          h: r.height,
          w: r.width,
        };
      })
  );
}

test('a seeded sell page re-wraps nothing at the swap that its fallback could hold', async ({
  browser,
}) => {
  test.skip(MODE === 'measure', 'the corpus only');
  const drawing = async (
    org: string,
    slug: string,
    width: number,
    refuse: boolean
  ) => {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    if (refuse)
      await context.route('**/*', (route) =>
        route.request().resourceType() === 'font'
          ? route.abort()
          : route.continue()
      );
    const blocks = await draw(await context.newPage(), org, slug);
    await context.close();
    return blocks;
  };
  const compare = (
    a: Awaited<ReturnType<typeof draw>>,
    b: typeof a,
    label: string
  ) => {
    // A page that drew nothing (a worker down) would read as no re-wrap.
    expect(b.length, `${label} drew too little`).toBeGreaterThan(20);
    expect(
      a.map((x) => x.text),
      `${label}: the two drawings hold different text`
    ).toEqual(b.map((x) => x.text));
    const changed = a
      .map((x, i) => ({ ...x, after: b[i] }))
      .filter((x) => x.after && Math.abs(x.h - x.after.h) > 1);
    const moved = (x: (typeof changed)[number]) =>
      Math.abs(x.w - x.after.w) > 1;
    return {
      rewrapped: changed.filter((x) => !moved(x)),
      boxMoved: changed.filter(moved),
    };
  };

  // The zero: the same page drawn twice in its fallbacks.
  const [org, slug] = PAGES[0];
  const zero = compare(
    await drawing(org, slug, 390, true),
    await drawing(org, slug, 390, true),
    'zero'
  );
  expect(
    [...zero.rewrapped, ...zero.boxMoved],
    'the page drawn twice alike'
  ).toEqual([]);

  const rewrapped: string[] = [];
  const moved: string[] = [];
  for (const [org, slug] of PAGES)
    for (const width of VIEWPORTS) {
      const label = `${org}/${slug} @${width}`;
      const swap = compare(
        await drawing(org, slug, width, true),
        await drawing(org, slug, width, false),
        label
      );
      console.log(
        `${label}: ${swap.rewrapped.length} re-wrapped, ${swap.boxMoved.length} whose own width moved`
      );
      for (const x of [...swap.rewrapped, ...swap.boxMoved])
        console.log(
          `    ${x.where} "${x.text}" ${x.h.toFixed(0)} -> ${x.after.h.toFixed(0)}px${
            Math.abs(x.w - x.after.w) > 1
              ? ` (box ${x.w.toFixed(0)} -> ${x.after.w.toFixed(0)})`
              : ''
          }`
        );
      rewrapped.push(
        ...swap.rewrapped.map((x) => `${label} ${x.where} "${x.text}"`)
      );
      moved.push(
        ...swap.boxMoved.map((x) => `${label} ${x.where} "${x.text}"`)
      );
    }
  expect(rewrapped).toEqual([]);
  expect(moved, 'a block whose own width moved with the font').toEqual([]);
});

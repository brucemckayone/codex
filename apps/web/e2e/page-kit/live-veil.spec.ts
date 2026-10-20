/**
 * 03 X54, the live veil: a Style that lets more of the org's shader through
 * than the proven veil (`--lp-atmosphere-show`, Studio's 1.6) is only ever
 * as thin as the shader drawn behind each of its inks allows. So the proof
 * cannot be the black-and-white bound `org-shader.spec.ts` holds the proven
 * veil to: it is the composite the browser actually draws. The words are
 * hidden, the page is captured, and every ink drawn straight on the veil is
 * held to its floor over the pixels under it (a filled button, a ghost
 * button's line and a mark over a ring round them), at the 0.1 percentile.
 *
 * The page is studio-alpha's Tending the Grief, in Quiet, over its 'glow'
 * shader (near-black in the light theme, which a fixed 1.6 left at 3.4:1 for
 * 4.5:1 text). Since 03 X59 every Style but Poster's and Cinematic's takes
 * the hazy look, the multiple included, and each Style's own inks are what is
 * drawn on the veil, so the page is held to it in each of them: its root
 * switched to the Style, which is how a Style restyles a page (its layouts
 * and schemes are the page's own here; its inks, marks and buttons are the
 * Style's). Reduced motion holds the shader on one frame, so one capture is
 * all it draws.
 */

import { type Browser, expect, type Page, test } from '@playwright/test';
import { STYLES } from '../../src/lib/page-builder/kit/model/styles';
import {
  expectSellPageRendered,
  journeyFixture,
  journeyUrl,
} from '../helpers/journeys';

type Theme = 'light' | 'dark';

async function open(
  browser: Browser,
  baseURL: string,
  theme: Theme
): Promise<Page> {
  const fixture = journeyFixture('studio-alpha', 'tending-the-grief');
  const url = journeyUrl(baseURL, fixture);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  await context.addCookies([
    { name: 'theme', value: theme, url: new URL(url).origin },
  ]);
  const page = await context.newPage();
  await page.goto(url);
  await expectSellPageRendered(page, fixture);
  await page.waitForLoadState('networkidle');
  return page;
}

const HERO =
  ".lp-page > .lp-section[data-lp-type='hero'][data-lp-scheme='atmosphere']";

/** Runs in the page: the hero's veil, its two ends, and each ink on it. */
function readHero(selector: string) {
  const ctx = document
    .createElement('canvas')
    .getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  const paint = (css: string) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = 'transparent';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
    return a === 0 ? null : { rgb: [r, g, b], a };
  };
  const section = document.querySelector<HTMLElement>(selector);
  if (!section) return null;
  const cs = getComputedStyle(section);
  const onVeil = (el: Element) => {
    for (let p = el.parentElement; p && p !== section; p = p.parentElement) {
      if (p.hasAttribute('data-lp-on-media')) return false;
      const fill = paint(getComputedStyle(p).backgroundColor);
      if (fill && fill.a >= 250) return false;
    }
    return true;
  };
  const lines: {
    name: string;
    ink: number[];
    floor: number;
    ring: boolean;
    box: number[];
  }[] = [];
  const boxOf = (el: Element) => {
    const r = el.getBoundingClientRect();
    return [r.left, r.top, r.right, r.bottom];
  };
  // The veil is translucent, so its colour comes back a step or two off
  // the ground's (the canvas un-premultiplies it).
  const ground = paint(cs.backgroundColor)?.rgb ?? [-9, -9, -9];
  const isGround = (rgb: number[]) =>
    rgb.every((c, i) => Math.abs(c - (ground[i] ?? -9)) <= 2);
  /** A pseudo-element's own box when it is placed absolutely, else its host's. */
  const markBox = (el: Element, ps: CSSStyleDeclaration) => {
    const at = ['left', 'top', 'width', 'height'].map((k) =>
      ps.getPropertyValue(k)
    );
    if (ps.position !== 'absolute' || !at.every((v) => v.endsWith('px')))
      return boxOf(el);
    let block: Element | null = el;
    while (block && getComputedStyle(block).position === 'static')
      block = block.parentElement;
    if (!block) return boxOf(el);
    const r = block.getBoundingClientRect();
    const [x = 0, y = 0, w = 0, h = 0] = at.map(Number.parseFloat);
    const left = r.left + block.clientLeft + x;
    const top = r.top + block.clientTop + y;
    return [left, top, left + w, top + h];
  };
  /** A Style's marks: their fill, or every opaque stop of the gradients they
   *  are drawn with (Path's route), the ground's own colour aside. */
  const marks = (el: Element) => {
    for (const pseudo of ['::before', '::after']) {
      const ps = getComputedStyle(el, pseudo);
      if (ps.content === 'none' || ps.content === 'normal') continue;
      const fill = paint(ps.backgroundColor);
      const stops = fill
        ? [fill]
        : (
            ps.backgroundImage.match(
              /(?:rgba?|oklch|oklab|lab|lch|hsla?|hwb|color)\([^()]*\)/g
            ) ?? []
          )
            .map(paint)
            .filter(
              (p): p is NonNullable<typeof p> =>
                !!p && p.a >= 250 && !isGround(p.rgb)
            );
      for (const mark of stops)
        lines.push({
          name: `mark ${el.className.split(' ')[0]}${pseudo}`,
          ink: mark.rgb,
          floor: 3,
          ring: true,
          box: markBox(el, ps),
        });
    }
  };
  const holders = new Set<HTMLElement>();
  const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode())
    if (n.textContent?.trim() && n.parentElement) holders.add(n.parentElement);
  for (const el of holders) {
    if (!onVeil(el) || el.getBoundingClientRect().width === 0) continue;
    const style = getComputedStyle(el);
    const ink = paint(style.color);
    if (!ink) continue;
    const px = Number.parseFloat(style.fontSize);
    const weight = Number(style.fontWeight);
    lines.push({
      name: `${el.tagName.toLowerCase()} ${px}px "${el.textContent?.trim().slice(0, 30)}"`,
      ink: ink.rgb,
      floor: px >= 24 || (px >= 18.66 && weight >= 700) ? 3 : 4.5,
      ring: false,
      box: boxOf(el),
    });
  }
  for (const el of section.querySelectorAll<HTMLElement>('*')) {
    if (el.classList.contains('lp-surface') || !onVeil(el)) continue;
    if (el.classList.contains('lp-button')) {
      const style = getComputedStyle(el);
      const fill = paint(style.backgroundColor);
      const edge =
        fill && fill.a >= 250
          ? fill
          : Number.parseFloat(style.borderTopWidth) > 0
            ? paint(style.borderTopColor)
            : null;
      if (edge)
        lines.push({
          name: `button "${el.textContent?.trim()}"`,
          ink: edge.rgb,
          floor: 3,
          ring: true,
          box: boxOf(el),
        });
    }
    marks(el);
  }
  // The section's own marks too: Path draws its walked line on it.
  marks(section);
  return {
    thin: Number.parseFloat(cs.getPropertyValue('--_atmos-thin')),
    floor: Number.parseFloat(cs.getPropertyValue('--_atmos-floor')),
    need: section.style.getPropertyValue('--_atmos-need'),
    bounds: boxOf(section),
    lines,
  };
}

type Lines = NonNullable<ReturnType<typeof readHero>>['lines'];

/**
 * Runs in the page: decodes the capture and holds each line to its floor,
 * over the pixels of its own section (`bounds`): a mark at its foot, as
 * Path's route is, would otherwise be read against the next section.
 */
async function measure({
  png,
  lines,
  bounds,
}: {
  png: string;
  lines: Lines;
  bounds: number[];
}) {
  // From its bytes: the page's own fetch (and its CSP) never sees it.
  const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(
    new Blob([bytes], { type: 'image/png' })
  );
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0);
  const k = bitmap.width / innerWidth;
  const lum = ([r, g, b]: number[]) => {
    const c = (v: number) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * c(r ?? 0) + 0.7152 * c(g ?? 0) + 0.0722 * c(b ?? 0);
  };
  const PAD = 6;
  return lines.map((line) => {
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = line.box.map((v) =>
      Math.round(v * k)
    );
    const p = Math.round(PAD * k);
    const regions = line.ring
      ? [
          [x0 - p, y0 - p, x1 + p, y0],
          [x0 - p, y1, x1 + p, y1 + p],
          [x0 - p, y0, x0, y1],
          [x1, y0, x1 + p, y1],
        ]
      : [[x0, y0, x1, y1]];
    const ink = lum(line.ink);
    const ratios: number[] = [];
    const [bl = 0, bt = 0, br = 0, bb = 0] = bounds.map((v) =>
      Math.round(v * k)
    );
    for (const [a = 0, b = 0, c = 0, d = 0] of regions) {
      const [l, t] = [Math.max(a, bl, 0), Math.max(b, bt, 0)];
      const [w, h] = [
        Math.min(c, br, canvas.width) - l,
        Math.min(d, bb, canvas.height) - t,
      ];
      if (w <= 0 || h <= 0) continue;
      const data = ctx.getImageData(l, t, w, h).data;
      for (let i = 0; i < data.length; i += 4) {
        const back = lum([data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]);
        ratios.push(
          (Math.max(back, ink) + 0.05) / (Math.min(back, ink) + 0.05)
        );
      }
    }
    ratios.sort((x, y) => x - y);
    const worst = ratios[Math.floor(ratios.length * 0.001)] ?? Infinity;
    return {
      name: line.name,
      floor: line.floor,
      worst: Math.round(worst * 100) / 100,
    };
  });
}

/** Every Style that asks for the hazy look, and so for the thinner veil. */
const HAZY = (Object.keys(STYLES) as (keyof typeof STYLES)[]).filter(
  (style) => STYLES[style].atmosphere === 'hazy'
);

test('the page is drawn in a Style that asks for the hazy look', () => {
  expect(HAZY).toContain('quiet');
  expect(HAZY.length).toBeGreaterThan(1);
});

for (const style of HAZY)
  for (const theme of ['light', 'dark'] as const) {
    test(`studio-alpha ('glow') as ${style}, ${theme}: a veil thinner than the proven one holds every ink on it over the shader drawn`, async ({
      browser,
      baseURL,
    }) => {
      const page = await open(browser, baseURL as string, theme);
      await expect(
        page.locator('.org-layout[data-hero-shader-active]')
      ).toHaveCount(1);
      // Its own look, multiple and all, with no stylesheet added.
      await expect(page.locator(".lp[data-lp-atmosphere='hazy']")).toHaveCount(
        1
      );
      // The Style's inks; the live veil reads the page again on a resize.
      await page.evaluate((id) => {
        const root = document.querySelector<HTMLElement>('.lp');
        if (root) root.dataset.lpStyle = id;
        window.dispatchEvent(new Event('resize'));
      }, style);

      // It has measured: a veil between the Style's and the proven one.
      await expect
        .poll(async () => (await page.evaluate(readHero, HERO))?.need, {
          timeout: 15_000,
        })
        .not.toBe('');
      const hero = await page.evaluate(readHero, HERO);
      const detail = JSON.stringify(hero);
      expect(hero, detail).not.toBeNull();
      if (!hero) return;
      expect(hero.thin, detail).toBeLessThan(hero.floor);
      expect(Number(hero.need), detail).toBeGreaterThanOrEqual(hero.thin);
      expect(Number(hero.need), detail).toBeLessThanOrEqual(hero.floor);
      expect(hero.lines.length, detail).toBeGreaterThan(3);

      // The words (and marks, and buttons) hidden, the veil and the shader
      // left: what each ink is seen against.
      await page.addStyleTag({
        content: `${HERO} * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }
        ${HERO}::before, ${HERO}::after, ${HERO} *::before, ${HERO} *::after, ${HERO} .lp-button { visibility: hidden !important; }`,
      });
      await page.evaluate(
        () =>
          new Promise((done) =>
            requestAnimationFrame(() => requestAnimationFrame(done))
          )
      );
      const png = (await page.screenshot()).toString('base64');
      const held = await page.evaluate(measure, {
        png,
        lines: hero.lines,
        bounds: hero.bounds,
      });
      await page.context().close();

      const short = held.filter((l) => l.worst < l.floor);
      expect(short, `veil ${hero.need}: ${JSON.stringify(held)}`).toEqual([]);
    });
  }

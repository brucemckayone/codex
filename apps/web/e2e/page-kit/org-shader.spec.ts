/**
 * B2 (owner, D4: "On by default (Recommended)"; 03 X50): an org with a shader
 * preset other than 'none' has its sales pages open and close on its moving
 * background. Every Style's hero and closing ask default to `atmosphere`; a
 * scheme the page set stays.
 *
 * Measured on the org's own path (no carrier, no DB write): studio-alpha
 * carries the seeded 'glow' preset, of-blood-and-bones none. The words are
 * held to their floors on the veil over the two worst backdrops (pure black
 * and pure white bound every shader frame, 03 §5.1), from the section's live
 * tokens: its ground, the veil's strength and each ink. One shader canvas
 * draws it, the org layout's.
 */

import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  expectSellPageRendered,
  journeyFixture,
  journeyUrl,
} from '../helpers/journeys';

type Theme = 'light' | 'dark';

async function open(
  browser: Browser,
  baseURL: string,
  org: string,
  slug: string,
  theme: Theme
): Promise<Page> {
  const fixture = journeyFixture(org, slug);
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

/** Runs in the page: each section's scheme, and each atmosphere section's
 * ground, veil strength and inks, as the browser resolves them. */
function readAtmosphere() {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  const probe = (host: Element, css: string) => {
    const span = document.createElement('span');
    span.style.cssText = `position:absolute;inline-size:0;block-size:0;${css}`;
    host.appendChild(span);
    const style = getComputedStyle(span);
    const out = { color: style.color, opacity: style.opacity };
    span.remove();
    return out;
  };
  const hex = (css: string) => {
    ctx.globalCompositeOperation = 'copy';
    ctx.fillStyle = '#000000';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  };
  const root = document.querySelector<HTMLElement>('.lp');
  const sections = [
    ...document.querySelectorAll<HTMLElement>('.lp-page > .lp-section'),
  ].map((s) => ({
    type: s.dataset.lpType ?? '',
    scheme: s.dataset.lpScheme ?? '',
  }));
  const atmosphere = [
    ...document.querySelectorAll<HTMLElement>(
      ".lp-page > .lp-section[data-lp-scheme='atmosphere']"
    ),
  ].map((s) => {
    const inner = s.querySelector('.lp-inner') ?? s;
    const token = (name: string) =>
      hex(probe(inner, `color: var(${name})`).color);
    return {
      type: s.dataset.lpType ?? '',
      ground: token('--lp-bg'),
      veil: Number(probe(inner, 'opacity: var(--_atmos-s)').opacity),
      ink: token('--lp-ink'),
      soft: token('--lp-ink-soft'),
      accent: token('--lp-accent'),
      button: token('--lp-button-bg'),
    };
  });
  return {
    atmosphereAttr: root?.dataset.lpAtmosphere ?? null,
    style: root?.dataset.lpStyle ?? null,
    canvases: document.querySelectorAll('canvas').length,
    shaderActive: document
      .querySelector('.org-layout')
      ?.hasAttribute('data-hero-shader-active'),
    sections,
    atmosphere,
  };
}

const linear = (hex: string) =>
  [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
const luminance = (hex: string) => {
  const [r = 0, g = 0, b = 0] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (x: string, y: string) => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((a, b) => b - a);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};
/** The veil over a backdrop: browsers composite in encoded sRGB. */
const over = (ground: string, s: number, backdrop: 0 | 255) =>
  `#${[1, 3, 5]
    .map((i) =>
      Math.round(
        s * Number.parseInt(ground.slice(i, i + 2), 16) + (1 - s) * backdrop
      )
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;

for (const theme of ['light', 'dark'] as const) {
  test(`studio-alpha (a 'glow' shader) ${theme}: the hero and the closing ask are its moving background, and every word holds on the veil`, async ({
    browser,
    baseURL,
  }) => {
    const page = await open(
      browser,
      baseURL as string,
      'studio-alpha',
      'tending-the-grief',
      theme
    );
    const read = await page.evaluate(readAtmosphere);
    await page.context().close();
    const detail = JSON.stringify(read);
    expect(read.shaderActive, detail).toBe(true);
    // The opening and the closing ask, and nothing else by default.
    const schemeOf = (type: string) =>
      read.sections.filter((s) => s.type === type).map((s) => s.scheme);
    expect(schemeOf('hero'), detail).toEqual(['atmosphere']);
    expect(
      schemeOf('cta').every((s) => s === 'atmosphere'),
      detail
    ).toBe(true);
    expect(read.atmosphereAttr, detail).not.toBeNull();
    // One shader canvas: the org layout's.
    expect(read.canvases, detail).toBe(1);
    expect(read.atmosphere.length, detail).toBeGreaterThanOrEqual(2);
    for (const a of read.atmosphere) {
      expect(a.veil, `${a.type} ${detail}`).toBeGreaterThan(0.5);
      expect(a.veil, `${a.type} ${detail}`).toBeLessThan(1);
      for (const backdrop of [0, 255] as const) {
        const seen = over(a.ground, a.veil, backdrop);
        const at = `${a.type} over ${backdrop ? 'white' : 'black'} ${JSON.stringify(a)}`;
        expect(ratio(a.ink, seen), at).toBeGreaterThanOrEqual(4.5);
        expect(ratio(a.soft, seen), at).toBeGreaterThanOrEqual(4.5);
        expect(ratio(a.accent, seen), at).toBeGreaterThanOrEqual(4.5);
        expect(ratio(a.button, seen), at).toBeGreaterThanOrEqual(3);
      }
    }
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`of-blood-and-bones (no shader) ${theme}: its pages keep their Style's schemes`, async ({
    browser,
    baseURL,
  }) => {
    const page = await open(
      browser,
      baseURL as string,
      'of-blood-and-bones',
      'ancestral-threads',
      theme
    );
    const read = await page.evaluate(readAtmosphere);
    await page.context().close();
    const detail = JSON.stringify(read);
    expect(read.shaderActive, detail).toBe(false);
    expect(read.atmosphere, detail).toEqual([]);
    expect(read.atmosphereAttr, detail).toBeNull();
  });
}

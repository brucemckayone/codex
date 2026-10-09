/**
 * BRAND FIDELITY — A SALES PAGE IS DRAWN IN THE ORG'S OWN TOKENS
 * (phase 3a · Codex-61zsk.41, 03 X35).
 *
 * `brand-conformance.test.ts` proves the kit names no literal colour. That is
 * necessary and nowhere near sufficient: the kit used to read the RAW brand
 * inputs and derive a second palette of its own from them, so a page could
 * hold every literal-free rule and still be drawn in colours the org's site
 * never shows. Measured before this change on of-blood-and-bones in dark mode:
 * its explore page stays light parchment (#f3f0e7) and every sales page turned
 * near-black (#211f19) with white ink.
 *
 * So this spec measures what a visitor's browser RESOLVES, not what a
 * stylesheet says. For a base section it reads the kit's ground, ink, soft
 * ink, hairline, heading, focus ring and button (fill and label), and the
 * org's own tokens where the org's pages read them (`.org-main`), and holds
 * them equal. The floating bar draws the org's own button on the org's own
 * ground, and every call to action is the org's button height and weight. A CSS string
 * check cannot do this: one `var()` hop and it is reading a name, not a colour.
 *
 * Colours are normalised through a canvas readback, never parsed by hand;
 * equal means within 1/255 a channel (the two sides take different relative
 * colour paths to the same colour). The kit's floors may move an org colour
 * that fails a contrast floor — that is the safety net, `schemes.test.ts` —
 * and none of the seeded orgs' colours fails one, so here every one is held
 * to the org's exactly.
 *
 * WHAT IS COVERED. The three seeded orgs, light and dark (forced the way the
 * site does it: the `theme` cookie app.html's blocking script reads first),
 * plus the editor's scoped preview in the OTHER theme (`data-lp-theme`, which
 * never touches `<html>`) and a nested brand carrier inside it — where a dark
 * slot used to fall back to the light value. studio-beta's one live page is
 * Cinematic, whose dark room is the Style's deliberate choice and not the
 * org's ground, so it is measured with its root drawn as Quiet: the mapping is
 * CSS, keyed on the Style attribute alone.
 */

import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  expectSellPageRendered,
  journeyFixture,
  journeyUrl,
} from '../helpers/journeys';

type Theme = 'light' | 'dark';

interface Case {
  readonly org: string;
  readonly slug: string;
  /** Draw the page's root as this Style (CSS only) before measuring. */
  readonly drawAs?: string;
  readonly why: string;
}

const CASES: readonly Case[] = [
  {
    org: 'of-blood-and-bones',
    slug: 'return-to-the-shoreline',
    why: 'Path, on an org background with no dark one',
  },
  {
    org: 'of-blood-and-bones',
    slug: 'ancestral-threads',
    why: 'Studio, a decorated page (its paper texture)',
  },
  {
    org: 'studio-alpha',
    slug: 'tending-the-grief',
    why: 'Quiet, on the platform ground, with a heading colour of its own',
  },
  {
    org: 'studio-beta',
    slug: 'bone-deep',
    drawAs: 'quiet',
    why: 'the platform ground and a blue brand (its Cinematic page drawn as Quiet)',
  },
];

/** What the org's own pages read, and what the kit's base section resolves. */
interface Reading {
  readonly org: Record<string, string | null>;
  readonly kit: Record<string, string | null>;
}

/** The kit token, or painted colour, each org token must equal. */
const MAPPING = [
  ['ground', '--color-background'],
  ['ink', '--color-text'],
  ['soft ink', '--color-text-secondary'],
  ['line', '--color-border'],
  ['heading', '--color-heading'],
  ['focus', '--color-focus'],
  ['button', '--color-interactive'],
  ['button label', '--color-on-interactive'],
] as const;

/** The floating bar, where the page has one: the org's ground and button. */
const STICKY_MAPPING = [
  ['bar ground', '--color-background'],
  ['bar button', '--color-interactive'],
  ['bar button label', '--color-on-interactive'],
] as const;

interface Setup {
  /** `data-lp-theme` on the kit root: the editor's scoped preview. */
  readonly preview?: Theme;
  /** Inline brand inputs on the kit root, as a page's own overrides land. */
  readonly carrier?: string;
  readonly drawAs?: string;
}

/**
 * Puts `setup` on the kit root, exactly as PageRenderer renders it, then lets
 * the page settle: sections transition their colours (1e-5s under reduced
 * motion, but still a transition), so a colour read in the same frame as the
 * change is the transition's START — measured: a flipped Style read its old
 * dark room in that frame and its new ground two frames later.
 */
async function apply(page: Page, setup: Setup): Promise<void> {
  await page.evaluate((s: Setup) => {
    const root = document.querySelector<HTMLElement>('.lp');
    if (!root) throw new Error('no .lp root on the page');
    if (s.drawAs) root.dataset.lpStyle = s.drawAs;
    if (s.preview) root.dataset.lpTheme = s.preview;
    if (s.carrier) {
      root.setAttribute('data-org-brand', '');
      root.setAttribute('style', s.carrier);
      // A page that sets a background of its own also carries data-org-bg.
      if (/--brand-bg(-dark)?:/.test(s.carrier))
        root.setAttribute('data-org-bg', '');
    }
  }, setup);
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setTimeout(done, 50))
        )
      )
  );
}

/**
 * Runs in the page. `orgHost` picks where the org tokens are read: `main` (the
 * org's own pages) or the kit root (a page carrier's own derivation).
 */
function readColours(orgHost: 'main' | 'root'): Reading {
  const root = document.querySelector<HTMLElement>('.lp');
  if (!root) throw new Error('no .lp root on the page');

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  const hexOf = (css: string): string => {
    ctx.globalCompositeOperation = 'copy';
    ctx.fillStyle = '#000000';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    const h = (n: number) => n.toString(16).padStart(2, '0');
    return a === 255
      ? `#${h(r)}${h(g)}${h(b)}`
      : `#${h(r)}${h(g)}${h(b)}${h(a)}`;
  };
  /** A token resolved where `host` sits, or null when it is not set there. */
  const token = (host: Element, name: string): string | null => {
    const probe = document.createElement('span');
    probe.style.cssText = `position:absolute;inline-size:0;block-size:0;color:var(${name}, rgb(1, 2, 3))`;
    host.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value === 'rgb(1, 2, 3)' ? null : hexOf(value);
  };

  const host =
    orgHost === 'root'
      ? root
      : document.querySelector('main#main-content, .org-main');
  if (!host) throw new Error('no org main');
  const org: Record<string, string | null> = {};
  for (const name of [
    '--color-background',
    '--color-text',
    '--color-text-secondary',
    '--color-border',
    '--color-heading',
    '--color-focus',
    '--color-interactive',
    '--color-on-interactive',
  ])
    org[name] = token(host, name);

  // A base section on the page's own ground (not over a picture) with a
  // large heading in it.
  const section = [
    ...document.querySelectorAll<HTMLElement>(
      ".lp-page > .lp-section[data-lp-scheme='base']:not([data-lp-on-media])"
    ),
  ].find((s) =>
    s.querySelector(
      ".lp-heading:is([data-size='display'], [data-size='heading'])"
    )
  );
  if (!section) throw new Error('no base section with a large heading');
  const heading = section.querySelector(
    ".lp-heading:is([data-size='display'], [data-size='heading'])"
  );
  const kit: Record<string, string | null> = {
    ground: hexOf(getComputedStyle(section).backgroundColor),
    ink: token(section, '--lp-ink'),
    'soft ink': token(section, '--lp-ink-soft'),
    line: token(section, '--lp-line'),
    heading: heading ? hexOf(getComputedStyle(heading).color) : null,
    focus: token(section, '--lp-focus'),
    button: token(section, '--lp-button-bg'),
    'button label': token(section, '--lp-button-ink'),
  };
  // The bar is rendered, styled and measurable before it is shown.
  const bar = root.querySelector<HTMLElement>('.lp-sticky');
  if (bar) {
    kit['bar ground'] = hexOf(getComputedStyle(bar).backgroundColor);
    kit['bar button'] = token(bar, '--lp-button-bg');
    kit['bar button label'] = token(bar, '--lp-button-ink');
  }
  return { org, kit };
}

/** Each kit colour against the org token it maps to, within 1/255 a channel. */
function mismatches(
  reading: Reading,
  orgSide: Reading['org'] = reading.org,
  mapping: readonly (readonly [string, string])[] = MAPPING
): string[] {
  const channels = (hex: string) =>
    [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const out: string[] = [];
  for (const [kitName, orgName] of mapping) {
    const kit = reading.kit[kitName];
    const org = orgSide[orgName];
    if (!kit || !org) {
      out.push(`${kitName}: kit ${kit} / org ${orgName} ${org}`);
      continue;
    }
    const a = channels(kit);
    const b = channels(org);
    if (a.some((v, i) => Math.abs(v - (b[i] ?? -9)) > 1))
      out.push(`${kitName}: kit ${kit} ≠ org ${orgName} ${org}`);
  }
  return out;
}

async function openAs(
  browser: Browser,
  baseURL: string,
  item: Case,
  theme: Theme
): Promise<Page> {
  const fixture = journeyFixture(item.org, item.slug);
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
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() => document.documentElement.dataset.theme),
    'the theme cookie set the viewer’s theme'
  ).toBe(theme);
  return page;
}

/** `setup` applied and settled, then every colour read; the context closes. */
async function measure(
  page: Page,
  setup: Setup,
  orgHost: 'main' | 'root'
): Promise<Reading> {
  await apply(page, setup);
  const reading = await page.evaluate(readColours, orgHost);
  await page.context().close();
  return reading;
}

for (const item of CASES) {
  test.describe(`brand fidelity · ${item.org}/${item.slug} — ${item.why}`, () => {
    for (const theme of ['light', 'dark'] as const) {
      test(`${theme}: a base section is drawn in the org’s own tokens`, async ({
        browser,
        baseURL,
      }) => {
        const page = await openAs(browser, baseURL as string, item, theme);
        const reading = await measure(page, { drawAs: item.drawAs }, 'main');
        expect(mismatches(reading), JSON.stringify(reading)).toEqual([]);
      });
    }
  });
}

// ── the floating bar, and the button's shape ──────────────────────────────────
// of-blood-and-bones' pages sell, so they carry the bar (the seeded Quiet and
// Cinematic pages have no offer on sale, and so no bar). It used to be a dark
// band, where the rust brand had to turn #ff481b with a black label.
const SELLING = CASES.filter((item) => item.org === 'of-blood-and-bones');

for (const item of SELLING) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${item.org}/${item.slug} ${theme}: the floating bar is the org’s ground and button`, async ({
      browser,
      baseURL,
    }) => {
      const page = await openAs(browser, baseURL as string, item, theme);
      const reading = await measure(page, {}, 'main');
      expect(
        reading.kit['bar button'],
        'the page has a floating bar'
      ).toBeTruthy();
      expect(
        mismatches(reading, reading.org, STICKY_MAPPING),
        JSON.stringify(reading)
      ).toEqual([]);
    });
  }
}

test('every call to action is the org’s button height and weight', async ({
  browser,
  baseURL,
}) => {
  const item = SELLING[0];
  if (!item) throw new Error('no case');
  const page = await openAs(browser, baseURL as string, item, 'light');
  await apply(page, {});
  const found = await page.evaluate(() => {
    const main = document.querySelector('main#main-content, .org-main');
    if (!main) throw new Error('no org main');
    // The org's button tokens, resolved where its pages read them: its
    // large and extra-large heights (never under the tap target) and the
    // weight `ui/Button` sets.
    const probe = (css: string, read: (s: CSSStyleDeclaration) => string) => {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;${css}`;
      main.appendChild(el);
      const value = read(getComputedStyle(el));
      el.remove();
      return value;
    };
    const org = {
      md: probe('block-size: var(--tap-target-min)', (s) => s.blockSize),
      lg: probe(
        'block-size: max(var(--tap-target-min), var(--space-12))',
        (s) => s.blockSize
      ),
      weight: probe('font-weight: var(--font-medium)', (s) => s.fontWeight),
    };
    const kit = [
      ...document.querySelectorAll<HTMLElement>(
        ".lp .lp-button[data-variant='primary']"
      ),
    ].map((el) => ({
      size: el.dataset.size ?? 'md',
      height: `${el.getBoundingClientRect().height}px`,
      weight: getComputedStyle(el).fontWeight,
      text: (el.textContent ?? '').trim(),
    }));
    return { org, kit };
  });
  await page.context().close();
  expect(found.kit.length, 'the page has calls to action').toBeGreaterThan(1);
  expect(found.org.md).toBe('44px');
  for (const button of found.kit) {
    const want = button.size === 'lg' ? found.org.lg : found.org.md;
    expect(
      { height: button.height, weight: button.weight },
      `${button.size} “${button.text}”`
    ).toEqual({ height: want, weight: found.org.weight });
  }
});

// ── the editor's preview in the other theme ───────────────────────────────────
const PREVIEWED = CASES.filter((item) => item.slug !== 'ancestral-threads');

for (const item of PREVIEWED) {
  test.describe(`brand fidelity · preview · ${item.org}/${item.slug}`, () => {
    for (const [viewer, preview] of [
      ['light', 'dark'],
      ['dark', 'light'],
    ] as const) {
      test(`a ${preview} preview on a ${viewer} viewer draws the org’s ${preview} tokens`, async ({
        browser,
        baseURL,
      }) => {
        // The org's own tokens in that theme, where its pages read them…
        const truth = await openAs(browser, baseURL as string, item, preview);
        const expected = await measure(truth, { drawAs: item.drawAs }, 'main');
        // …and the kit previewing that theme inside the other one.
        const page = await openAs(browser, baseURL as string, item, viewer);
        const reading = await measure(
          page,
          { drawAs: item.drawAs, preview },
          'main'
        );
        expect(
          mismatches(reading, expected.org),
          JSON.stringify({ expected, reading })
        ).toEqual([]);
      });
    }
  });
}

// ── a nested brand carrier: its dark slot is the DARK value ───────────────────
// A page's own brand overrides land inline on the kit root, a nested
// `[data-org-brand]`. Its `-dark` values must win in a dark preview, as they
// do under the viewer's own dark theme. The colours are a page's choice in
// the test, never the kit's.
const CARRIER =
  '--brand-color: #1d4ed8; --brand-color-dark: #1e3a8a; ' +
  '--brand-heading-color: #1d4ed8; --brand-heading-color-dark: #1e3a8a';

test('a dark preview on a light viewer resolves a page carrier’s DARK brand tokens', async ({
  browser,
  baseURL,
}) => {
  const item = CASES[0];
  if (!item) throw new Error('no case');
  // The org's own derivation of the carrier, under the viewer's dark theme.
  const truth = await openAs(browser, baseURL as string, item, 'dark');
  const expected = await measure(truth, { carrier: CARRIER }, 'root');
  expect(
    expected.org['--color-focus'],
    'the carrier’s dark slot, under .dark'
  ).toBe('#1e3a8a');

  const page = await openAs(browser, baseURL as string, item, 'light');
  const reading = await measure(
    page,
    { carrier: CARRIER, preview: 'dark' },
    'root'
  );
  expect(
    mismatches(reading, expected.org),
    JSON.stringify({ expected, reading })
  ).toEqual([]);
});

// ── keep white: a mid-tone button darkens a little (owner, D8) ────────────────
// of-blood-and-bones' Tending the Grief sets its own brand, #ef3d0b (Y
// 0.217): a mid-tone the org's label rule gives a black label, though white
// reaches 4.5:1 a little darker. The owner chose white: the fill darkens,
// its lightness only, as far as white needs. That page's sections were
// edited past its seed, so its carrier is put on the org's other Path page,
// as the page renders it. `schemes.test.ts` §11 sweeps every colour.
const MID_TONE_CARRIER = '--brand-color: #ef3d0b; --brand-color-dark: #ef3d0b';

/** sRGB channels of a `#rrggbb`, linearised. */
const linear = (hex: string) =>
  [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
const luminance = (hex: string) => {
  const [r = 0, g = 0, b = 0] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** OKLab hue, in degrees. */
const hueOf = (hex: string) => {
  const [r = 0, g = 0, b = 0] = linear(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return (Math.atan2(bb, a) * 180) / Math.PI;
};

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: Tending the Grief’s mid-tone brand darkens a little and keeps a white label`, async ({
    browser,
    baseURL,
  }) => {
    const item = CASES[0];
    if (!item) throw new Error('no case');
    const page = await openAs(browser, baseURL as string, item, theme);
    // The page's own derivation, on its carrier.
    const reading = await measure(page, { carrier: MID_TONE_CARRIER }, 'root');
    const context = JSON.stringify(reading);
    const own = reading.org['--color-interactive'];
    const fill = reading.kit.button;
    if (!own || !fill) throw new Error(`no button colours: ${context}`);
    expect(own, 'the page’s own brand').toBe('#ef3d0b');
    expect(
      reading.org['--color-on-interactive'],
      'the org’s rule gives it black'
    ).toBe('#000000');
    expect(reading.kit['button label'], context).toBe('#ffffff');
    const white = 1.05 / (luminance(fill) + 0.05);
    expect(white, `${fill}: white holds`).toBeGreaterThanOrEqual(4.5);
    expect(white, `${fill}: darkened only a little`).toBeLessThan(4.6);
    expect(
      Math.abs(hueOf(fill) - hueOf(own)),
      `${fill}: the brand's hue`
    ).toBeLessThan(1.5);
  });
}

// ── a page background with no twin (owner, D7) ───────────────────────────────
// A page's own background applies only to its own theme. One that sets a
// light background and no dark one shows the org's dark mode in dark mode —
// its surfaces, text and border, as if the page had set no background — in
// the viewer's dark theme and in a dark preview; one that sets only a dark
// background shows the org's light mode in light mode. The colours are a
// page's choice in the test, never the kit's.
const LIGHT_ONLY = '--brand-bg: #e9f1ea';
const DARK_ONLY = '--brand-bg-dark: #10202a';
// of-blood-and-bones' dark mode is its light parchment; studio-alpha's is
// the platform's dark theme.
const NO_TWIN = [CASES[0], CASES[2]].filter((c): c is Case => !!c);

/** The org's own tokens as the carrier's root resolves them, exactly. */
const ORG_TOKENS = [
  '--color-background',
  '--color-text',
  '--color-text-secondary',
  '--color-border',
] as const;
const orgTokens = (reading: Reading) =>
  Object.fromEntries(ORG_TOKENS.map((name) => [name, reading.org[name]]));

for (const item of NO_TWIN) {
  test(`${item.org}/${item.slug} dark: a light-only page background gives way to the org’s dark mode`, async ({
    browser,
    baseURL,
  }) => {
    const truth = await openAs(browser, baseURL as string, item, 'dark');
    const expected = await measure(truth, {}, 'main');
    const page = await openAs(browser, baseURL as string, item, 'dark');
    const reading = await measure(page, { carrier: LIGHT_ONLY }, 'root');
    const context = JSON.stringify({ expected, reading });
    expect(mismatches(reading, expected.org), context).toEqual([]);
    expect(orgTokens(reading), context).toEqual(orgTokens(expected));
  });

  test(`${item.org}/${item.slug}: a dark preview on a light viewer gives a light-only page background way to the org’s dark mode`, async ({
    browser,
    baseURL,
  }) => {
    const truth = await openAs(browser, baseURL as string, item, 'dark');
    const expected = await measure(truth, {}, 'main');
    const page = await openAs(browser, baseURL as string, item, 'light');
    const reading = await measure(
      page,
      { carrier: LIGHT_ONLY, preview: 'dark' },
      'root'
    );
    expect(
      mismatches(reading, expected.org),
      JSON.stringify({ expected, reading })
    ).toEqual([]);
  });
}

test('studio-alpha light: a dark-only page background gives way to the org’s light mode', async ({
  browser,
  baseURL,
}) => {
  const item = CASES[2];
  if (!item) throw new Error('no case');
  const truth = await openAs(browser, baseURL as string, item, 'light');
  const expected = await measure(truth, {}, 'main');
  const page = await openAs(browser, baseURL as string, item, 'light');
  const reading = await measure(page, { carrier: DARK_ONLY }, 'root');
  const context = JSON.stringify({ expected, reading });
  expect(mismatches(reading, expected.org), context).toEqual([]);
  expect(orgTokens(reading), context).toEqual(orgTokens(expected));
});

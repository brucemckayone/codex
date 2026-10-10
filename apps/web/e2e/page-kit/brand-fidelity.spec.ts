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

/**
 * The floating bar, where the page has one: a raised card in the org's card
 * colour (checked in its test, against the band), holding the org's button
 * (owner, D9).
 */
const STICKY_MAPPING = [
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
      // A page that sets a background of its own also carries data-org-bg,
      // and names the theme(s) it is for — as PageRenderer derives both
      // from the properties declared, never from the style text.
      const declared = new Set(
        s.carrier.split(';').map((d) => d.split(':')[0]?.trim())
      );
      const light = declared.has('--brand-bg');
      const dark = declared.has('--brand-bg-dark');
      if (light || dark) {
        root.setAttribute('data-org-bg', '');
        root.dataset.pageBg = light && dark ? 'both' : light ? 'light' : 'dark';
      }
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
    '--color-surface-card',
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
    kit['bar card'] = hexOf(getComputedStyle(bar).backgroundColor);
    kit['bar ink'] = hexOf(getComputedStyle(bar).color);
    kit['bar soft ink'] = token(bar, '--lp-ink-soft');
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
  // The server's HTML is on screen at `load`, but hydration runs later, once
  // the client's modules arrive, and sets the root's attributes back to the
  // page's own: measured, a Style drawn on the root 0.5s after it rendered
  // was put back at 0.66s. So nothing is drawn on the page before the
  // network is quiet.
  await page.waitForLoadState('networkidle');
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
// band, where the rust brand had to turn #ff481b with a black label, and then
// the org's ground, where it was flat against the page it floats over. The
// owner chose "Raised card (Recommended)" (D9): the org's card colour, lifted
// by the shadow the org floats its own bar on, holding the org's button. Its
// words and button still hold their floors on that card.
const SELLING = CASES.filter((item) => item.org === 'of-blood-and-bones');

/** WCAG's contrast ratio of two `#rrggbb` colours. */
const ratio = (x: string, y: string) => {
  const [hi = 0, lo = 0] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

for (const item of SELLING) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${item.org}/${item.slug} ${theme}: the floating bar is a raised card in the org’s card colour, with the org’s button`, async ({
      browser,
      baseURL,
    }) => {
      const page = await openAs(browser, baseURL as string, item, theme);
      await apply(page, {});
      const reading = await page.evaluate(readColours, 'main');
      // The org's own floating bar's shadow (`SubscribeStickyBar`), resolved
      // where its pages read it, and the kit bar's.
      const shadow = await page.evaluate(() => {
        const main = document.querySelector('main#main-content, .org-main');
        const bar = document.querySelector('.lp .lp-sticky');
        if (!main || !bar) throw new Error('no org main or bar');
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;box-shadow:var(--shadow-xl)';
        main.appendChild(probe);
        const org = getComputedStyle(probe).boxShadow;
        probe.remove();
        return { org, bar: getComputedStyle(bar).boxShadow };
      });
      await page.context().close();
      const why = JSON.stringify({ reading, shadow });
      expect(
        reading.kit['bar button'],
        'the page has a floating bar'
      ).toBeTruthy();
      expect(mismatches(reading, reading.org, STICKY_MAPPING), why).toEqual([]);
      // The org's card exactly, when it lies in the ground's band; a card
      // outside it (the platform's dark #404040, L 0.37) is held on the
      // band's edge, as the ground would be (Task 1), and the floors are the
      // band's.
      const own = reading.org['--color-surface-card'] ?? '';
      const drawn = reading.kit['bar card'] ?? '';
      const light = oklab(reading.kit.ground ?? '')[0] >= 0.5;
      const ownL = oklab(own)[0];
      if (light ? ownL >= 0.9 : ownL <= 0.24)
        expect(
          mismatches(reading, reading.org, [
            ['bar card', '--color-surface-card'],
          ]),
          why
        ).toEqual([]);
      else
        expect(
          Math.abs(oklab(drawn)[0] - (light ? 0.9 : 0.24)),
          why
        ).toBeLessThan(0.005);
      expect(shadow.org, why).not.toBe('none');
      expect(shadow.bar, why).toContain(shadow.org);
      const { kit } = reading;
      const card = kit['bar card'] ?? '';
      expect(ratio(kit['bar ink'] ?? card, card), why).toBeGreaterThanOrEqual(
        4.5
      );
      expect(
        ratio(kit['bar soft ink'] ?? card, card),
        why
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratio(kit['bar button'] ?? card, card),
        why
      ).toBeGreaterThanOrEqual(3);
      expect(
        ratio(kit['bar button label'] ?? '', kit['bar button'] ?? ''),
        why
      ).toBeGreaterThanOrEqual(4.5);
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
    const why = `${button.size} “${button.text}”: ${button.height}, want ${want}`;
    // Numbers, not strings: at a brand density other than 1 the computed
    // height prints rounded (46.0781px) and the drawn box does not (46.078125px).
    expect(
      Math.abs(Number.parseFloat(button.height) - Number.parseFloat(want)),
      why
    ).toBeLessThan(0.01);
    expect(button.weight, why).toBe(found.org.weight);
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
/** OKLab of a `#rrggbb`. */
const oklab = (hex: string): [number, number, number] => {
  const [r = 0, g = 0, b = 0] = linear(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};
/** OKLab hue, in degrees. */
const hueOf = (hex: string) => {
  const [, a, b] = oklab(hex);
  return (Math.atan2(b, a) * 180) / Math.PI;
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

// ── Path's second colour: a tone of the org's own (owner, D11) ────────────────
// of-blood-and-bones set no second colour, so the kit used to invent one —
// its rust turned 45° (#765821, an ochre). It is a tone of the rust now: the
// same hue, its lightness moved toward the ground, and Path's route is drawn
// in it, visibly apart from the rust of the words beside it.
// `schemes.test.ts` proves both minimums for every brand.
for (const theme of ['light', 'dark'] as const) {
  test(`of-blood-and-bones/return-to-the-shoreline ${theme}: Path's route is a tone of the org's colour`, async ({
    browser,
    baseURL,
  }) => {
    const item = CASES[0];
    if (!item) throw new Error('no case');
    const page = await openAs(browser, baseURL as string, item, theme);
    const read = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no 2d context');
      const hex = (css: string) => {
        ctx.globalCompositeOperation = 'copy';
        ctx.fillStyle = '#000000';
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
        return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
      };
      const token = (host: Element, name: string) => {
        const probe = document.createElement('span');
        probe.style.color = `var(${name})`;
        host.appendChild(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return hex(value);
      };
      const root = document.querySelector('.lp');
      const section = document.querySelector(
        ".lp-page > .lp-section[data-lp-scheme='base']:not([data-lp-on-media])"
      );
      if (!root || !section) throw new Error('no root or base section');
      return {
        style: (root as HTMLElement).dataset.lpStyle,
        brand: token(root, '--lp-brand'),
        second: token(root, '--lp-brand-2'),
        mark: token(section, '--lp-mark-ink'),
        accent: token(section, '--lp-accent'),
      };
    });
    await page.context().close();
    const context = JSON.stringify(read);
    expect(read.style, context).toBe('path');
    expect(read.brand, 'the org’s rust').toBe('#a62b0c');
    const [brand, second, mark, accent] = [
      read.brand,
      read.second,
      read.mark,
      read.accent,
    ].map(oklab) as [number, number, number][];
    const hueGap = (x: string, y: string) => {
      const d = Math.abs(hueOf(x) - hueOf(y)) % 360;
      return Math.min(d, 360 - d);
    };
    // A tone: the rust's hue, its lightness well apart.
    expect(hueGap(read.second, read.brand), context).toBeLessThan(3);
    expect(Math.abs(second[0] - brand[0]), context).toBeGreaterThanOrEqual(
      0.19
    );
    // The route, as drawn, beside the words' rust.
    expect(hueGap(read.mark, read.brand), context).toBeLessThan(3);
    expect(
      Math.hypot(...mark.map((v, i) => v - (accent[i] ?? 0))),
      context
    ).toBeGreaterThanOrEqual(0.08);
  });
}

// ── the hero's main button over a photo is the org's own button (owner, D10) ──
// Tending the Grief's cover hero sets its words over its photo, on 72% of the
// scrim. Its main button used to be the on-media ink (#efefef). The owner
// chose the org's own button there, exactly as the page draws it on its own
// surfaces, with nothing added: WCAG 1.4.11 asks a control with visible text
// for no contrasting edge, only a legible label and a focus ring that holds
// 3:1 where it sits. The secondary controls and the words keep the ink. This
// page's sections were edited past its seed, so it is opened without the
// stored-order check; it is the one live cover hero over a photo.
for (const theme of ['light', 'dark'] as const) {
  test(`of-blood-and-bones/tending-the-grief ${theme}: the hero's main button over its photo is the button its own sections draw`, async ({
    browser,
    baseURL,
  }) => {
    const url = journeyUrl(
      baseURL as string,
      journeyFixture('of-blood-and-bones', 'tending-the-grief')
    );
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
    const copy =
      ".lp-section[data-lp-type='hero'] .hero-cover__copy[data-lp-on-media]";
    const hero = page.locator(`${copy} .lp-button[data-variant='primary']`);
    await expect(hero).toBeVisible();
    await apply(page, {});
    // The ring as a keyboard user sees it (script focus with no pointer
    // interaction matches :focus-visible).
    await hero.focus();
    const read = await page.evaluate((selector) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no 2d context');
      const hex = (css: string) => {
        ctx.globalCompositeOperation = 'copy';
        ctx.fillStyle = '#000000';
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
        return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
      };
      const token = (host: Element, name: string) => {
        const probe = document.createElement('span');
        probe.style.color = `var(${name})`;
        host.appendChild(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return hex(value);
      };
      const host = document.querySelector(selector);
      const button = host?.querySelector<HTMLElement>(
        ".lp-button[data-variant='primary']"
      );
      // The same page's own button: a base section's, not over a picture.
      const own = [
        ...document.querySelectorAll<HTMLElement>(
          ".lp-page > .lp-section[data-lp-scheme='base']:not([data-lp-on-media]) .lp-button[data-variant='primary']"
        ),
      ].find((b) => !b.closest('[data-lp-on-media]'));
      if (!host || !button || !own) throw new Error('no hero or base button');
      const ring = getComputedStyle(button);
      return {
        fill: hex(getComputedStyle(button).backgroundColor),
        label: hex(getComputedStyle(button).color),
        ownFill: hex(getComputedStyle(own).backgroundColor),
        ownLabel: hex(getComputedStyle(own).color),
        focused: button.matches(':focus-visible'),
        ring: ring.outlineStyle === 'none' ? null : hex(ring.outlineColor),
        scrim: token(host, '--_scrim'),
        ink: token(host, '--lp-ink'),
        heading: hex(
          getComputedStyle(host.querySelector('.lp-heading') ?? host).color
        ),
        watch: (() => {
          const icon = host.querySelector('.lp-watch__icon');
          return icon ? hex(getComputedStyle(icon).backgroundColor) : null;
        })(),
      };
    }, copy);
    await context.close();
    const why = JSON.stringify(read);
    // The very button the page's own sections draw…
    expect({ fill: read.fill, label: read.label }, why).toEqual({
      fill: read.ownFill,
      label: read.ownLabel,
    });
    // …which is Tending the Grief's (D8: a little darker, keeping white).
    expect({ fill: read.fill, label: read.label }, why).toEqual({
      fill: '#dd3809',
      label: '#ffffff',
    });
    // Its focus ring holds 3:1 on the lightest surface the scrim allows
    // over any photo: 72% of it over pure white.
    const surface = `#${[1, 3, 5]
      .map((i) => Number.parseInt(read.scrim.slice(i, i + 2), 16))
      .map((c) => Math.round(c * 0.72 + 255 * 0.28))
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')}`;
    const on = (x: string, y: string) => {
      const [hi = 0, lo = 0] = [luminance(x), luminance(y)].sort(
        (p, q) => q - p
      );
      return (hi + 0.05) / (lo + 0.05);
    };
    expect(read.focused, why).toBe(true);
    expect(read.ring, why).not.toBeNull();
    expect(on(read.ring ?? read.scrim, surface), why).toBeGreaterThanOrEqual(3);
    // The words and the watch control keep the on-media ink.
    expect(read.heading, why).toBe(read.ink);
    if (read.watch) expect(read.watch, why).toBe(read.ink);
  });
}

// ── labels: the org's own case and tracking ──────────────────────────────────
// The org sets its labels' case in one token, `--text-transform-label`
// (uppercase unless it chose otherwise), and has no tracking token of its own
// for them: its uppercase labels pair the case with `--tracking-wider` (the
// floating bar's, the pricing page's, the catalogue tile's). The kit's
// eyebrow is its kicker, so on every page it is drawn the same way. On
// explore, Tending the Grief's card reads "FOR THE WEIGHT YOU CARRY"; its
// page's hero must read the same.

/** Each eyebrow's case and tracking beside the org's, resolved in place. */
function readLabels() {
  const main = document.querySelector('main#main-content, .org-main');
  if (!main) throw new Error('no org main');
  const probe = document.createElement('span');
  probe.style.cssText = 'text-transform: var(--text-transform-label)';
  main.appendChild(probe);
  const orgCase = getComputedStyle(probe).textTransform;
  probe.remove();
  return {
    orgCase,
    // The Style's own label tracking, as it sets it on the page root.
    styleTracking: getComputedStyle(
      document.querySelector('.lp') ?? main
    ).getPropertyValue('--lp-tracking-label'),
    eyebrows: [
      ...document.querySelectorAll<HTMLElement>('.lp .lp-eyebrow'),
    ].map((el) => {
      // A tracking token resolved at the eyebrow's own size.
      const at = (value: string) => {
        const span = document.createElement('span');
        span.style.letterSpacing = value;
        el.appendChild(span);
        const px = getComputedStyle(span).letterSpacing;
        span.remove();
        return px;
      };
      const style = getComputedStyle(el);
      return {
        text: el.innerText,
        case: style.textTransform,
        tracking: style.letterSpacing,
        wider: at('var(--tracking-wider)'),
        styleOwn: at(
          getComputedStyle(
            document.querySelector('.lp') ?? el
          ).getPropertyValue('--lp-tracking-label')
        ),
      };
    }),
  };
}

for (const item of CASES) {
  test(`${item.org}/${item.slug}: every eyebrow is in the org's label case and tracking`, async ({
    browser,
    baseURL,
  }) => {
    const page = await openAs(browser, baseURL as string, item, 'light');
    await apply(page, { drawAs: item.drawAs });
    const read = await page.evaluate(readLabels);
    await page.context().close();
    const why = JSON.stringify(read);
    expect(read.orgCase, why).toBe('uppercase');
    expect(read.eyebrows.length, why).toBeGreaterThan(0);
    for (const eyebrow of read.eyebrows)
      expect({ case: eyebrow.case, tracking: eyebrow.tracking }, why).toEqual({
        case: read.orgCase,
        tracking: eyebrow.wider,
      });
  });
}

test('studio-alpha/tending-the-grief: the hero’s eyebrow reads as its explore card’s kicker', async ({
  browser,
  baseURL,
}) => {
  const item = CASES[2];
  if (item?.slug !== 'tending-the-grief') throw new Error('no case');
  const page = await openAs(browser, baseURL as string, item, 'light');
  const eyebrow = page
    .locator(".lp-section[data-lp-type='hero'] .lp-eyebrow")
    .first();
  const onPage = await eyebrow.evaluate((el) => (el as HTMLElement).innerText);
  await page.goto(`${new URL(page.url()).origin}/explore`);
  const kicker = page
    .locator('.jec__kicker')
    .filter({ hasText: /for the weight you carry/i })
    .first();
  await expect(kicker).toBeVisible();
  const onExplore = await kicker.evaluate(
    (el) => (el as HTMLElement).innerText
  );
  await page.context().close();
  expect(onExplore).toBe('FOR THE WEIGHT YOU CARRY');
  expect(onPage).toBe(onExplore);
});

test('studio-alpha/tending-the-grief: a page that sets its labels in sentence case keeps them, at its Style’s tracking', async ({
  browser,
  baseURL,
}) => {
  const item = CASES[2];
  if (!item) throw new Error('no case');
  const page = await openAs(browser, baseURL as string, item, 'light');
  await apply(page, { carrier: '--brand-text-transform-label: none' });
  const read = await page.evaluate(readLabels);
  await page.context().close();
  const why = JSON.stringify(read);
  expect(read.eyebrows.length, why).toBeGreaterThan(0);
  for (const eyebrow of read.eyebrows)
    expect({ case: eyebrow.case, tracking: eyebrow.tracking }, why).toEqual({
      case: 'none',
      tracking: eyebrow.styleOwn,
    });
});

// ── corners: the org's radius tokens, bent by the Style ──────────────────────
// A card's corner is the org's `--radius-card`, a picture's its `--radius-lg`
// and a button's its `--radius-button`, each times the Style's bend (03
// §4.2). They used to be the raw brand radius times the bend, which drew
// every card and picture at two thirds of the org's own card corner. The
// floors and ceilings bind on none of the seeded brands.

/** Each Style's bend: its cards' and pictures', then its buttons' ('pill': round). */
const BENDS: Record<string, readonly [number, number | 'pill']> = {
  bold: [0.25, 0.25],
  poster: [0.25, 0.25],
  studio: [0.5, 0.5],
  quiet: [0.5, 0.5],
  clean: [1, 1],
  path: [1, 1],
  soft: [2, 'pill'],
  cinematic: [1, 'pill'],
};

/** The org's three corners and the kit's, in px, resolved where each is read. */
function readCorners() {
  const main = document.querySelector('main#main-content, .org-main');
  const section = document.querySelector('.lp-page > .lp-section');
  if (!main || !section) throw new Error('no org main or section');
  const px = (host: Element, name: string) => {
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;border-top-left-radius:var(${name})`;
    host.appendChild(probe);
    const value = Number.parseFloat(
      getComputedStyle(probe).borderTopLeftRadius
    );
    probe.remove();
    return value;
  };
  return {
    style: document.querySelector<HTMLElement>('.lp')?.dataset.lpStyle,
    org: {
      card: px(main, '--radius-card'),
      media: px(main, '--radius-lg'),
      button: px(main, '--radius-button'),
    },
    kit: {
      card: px(section, '--lp-radius-card'),
      media: px(section, '--lp-radius-media'),
      button: px(section, '--lp-radius-button'),
    },
  };
}

for (const item of [CASES[0], CASES[2], CASES[3]].filter(
  (c): c is Case => !!c
)) {
  test(`${item.org}: every Style's corners are the org's radius tokens, bent`, async ({
    browser,
    baseURL,
  }) => {
    const page = await openAs(browser, baseURL as string, item, 'light');
    const off: string[] = [];
    for (const [style, [bend, button]] of Object.entries(BENDS)) {
      await apply(page, { drawAs: style });
      const { org, kit, style: drawn } = await page.evaluate(readCorners);
      expect(drawn, 'the root is still drawn as the Style set').toBe(style);
      const want = {
        card: org.card * bend,
        media: org.media * bend,
        button: button === 'pill' ? null : org.button * button,
      };
      for (const role of ['card', 'media', 'button'] as const) {
        const target = want[role];
        const ok =
          target === null
            ? kit[role] >= 1000
            : Math.abs(kit[role] - target) < 0.02;
        if (!ok)
          off.push(
            `${style} ${role}: ${kit[role]}px, want ${target ?? 'pill'}`
          );
      }
    }
    await page.context().close();
    expect(off).toEqual([]);
  });
}

// ── a card that a Style lifts rests on the org's card shadow ─────────────────
// Soft lifts the one filled card in a band (the featured offer, the lead
// voice, a panel). The org's cards rest on `--shadow-md` (explore's, measured
// on all three orgs), so Soft's does too: it used to be a shadow of its own,
// the card's ground deepened. Drawn as Soft on a page whose offer is a
// filled card.
for (const theme of ['light', 'dark'] as const) {
  test(`of-blood-and-bones/return-to-the-shoreline ${theme}: Soft's filled card rests on the org's card shadow`, async ({
    browser,
    baseURL,
  }) => {
    const item = CASES[0];
    if (!item) throw new Error('no case');
    const page = await openAs(browser, baseURL as string, item, theme);
    await apply(page, { drawAs: 'soft' });
    const read = await page.evaluate(() => {
      const main = document.querySelector('main#main-content, .org-main');
      if (!main) throw new Error('no org main');
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;box-shadow:var(--shadow-md)';
      main.appendChild(probe);
      const org = getComputedStyle(probe).boxShadow;
      probe.remove();
      return {
        org,
        cards: [
          ...document.querySelectorAll<HTMLElement>(
            '.lp-page .lp-section[data-lp-type] [data-lp-scheme]'
          ),
        ].map((el) => getComputedStyle(el).boxShadow),
      };
    });
    await page.context().close();
    expect(read.org, JSON.stringify(read)).not.toBe('none');
    expect(read.cards.length, 'the page has a filled card').toBeGreaterThan(0);
    for (const shadow of read.cards) expect(shadow).toBe(read.org);
  });
}

// ── the soft band keeps the ground's warmth (owner, D14) ──────────────────────
// The kit's alternate band (`soft`: its sections, and the panels a base
// section fills with it, such as Studio's tabs card and the featured offer)
// was the org's secondary surface. `org-brand.css` makes that for small
// controls (its search box), at half the ground's chroma, and as a
// full-width band on parchment it read grey: #e7e6e2 against #f3f0e7. In dark
// mode, where this org keeps its light ground, it was the dark theme's
// secondary surface, a step LIGHTER than the parchment (#fffdf9). The owner
// chose "Warm step of the parchment (Recommended)": the org's ground a step
// darker, its chroma kept. The expectation is computed in the browser from
// the ground it measures.

/**
 * Runs in the page: the ground (a base section's), every soft surface, the
 * org's secondary surface, and the ground stepped by `step` in OKLCH
 * lightness. Each colour is read twice: as sRGB (a canvas readback) and as
 * the browser's own OKLCH, forced through `oklch(from X l c h)` so only that
 * one serialisation comes back, and calibrated before it is trusted.
 */
function readSoft(step: number) {
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
    const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
    const h = (n: number) => n.toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  };
  // A fresh probe per colour, styled before it is inserted: the page
  // transitions colours, and a probe whose colour changes reads the
  // transition's start.
  const resolve = (css: string): string => {
    const probe = document.createElement('span');
    probe.style.cssText = `position:absolute;inline-size:0;block-size:0;color:${css}`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  };
  const lchOf = (css: string): [number, number, number] => {
    const value = resolve(`oklch(from ${css} l c h)`);
    const m = value.match(
      /^oklch\(([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+|none)\)$/
    );
    if (!m) throw new Error(`not an oklch() serialisation: ${value} (${css})`);
    return [Number(m[1]), Number(m[2]), m[3] === 'none' ? 0 : Number(m[3])];
  };
  const read = (css: string) => ({ hex: hexOf(css), lch: lchOf(css) });

  const main = document.querySelector('main#main-content, .org-main');
  if (!main) throw new Error('no org main');
  const base = document.querySelector<HTMLElement>(
    ".lp-page > .lp-section[data-lp-scheme='base']:not([data-lp-on-media])"
  );
  if (!base) throw new Error('no base section');
  const ground = getComputedStyle(base).backgroundColor;
  const secondary = document.createElement('span');
  secondary.style.cssText =
    'position:absolute;color:var(--color-surface-secondary)';
  main.appendChild(secondary);
  const orgSecondary = getComputedStyle(secondary).color;
  secondary.remove();
  return {
    calibration: {
      white: lchOf('#ffffff'),
      known: lchOf('oklch(0.5 0.1 30)'),
    },
    ground: read(ground),
    orgSecondary: read(orgSecondary),
    expected: read(`oklch(from ${ground} calc(l + ${step}) c h)`),
    surfaces: [
      ...document.querySelectorAll<HTMLElement>(
        ".lp-page [data-lp-scheme='soft']:not([data-lp-on-media])"
      ),
    ].map((el) => ({
      at: `${el.closest<HTMLElement>('[data-lp-type]')?.dataset.lpType}: ${el.className.split(' ')[0]}`,
      ...read(getComputedStyle(el).backgroundColor),
    })),
  };
}

/** The largest channel difference of two `#rrggbb`, in 1/255 steps. */
const apart = (x: string, y: string) =>
  Math.max(
    ...[1, 3, 5].map((i) =>
      Math.abs(
        Number.parseInt(x.slice(i, i + 2), 16) -
          Number.parseInt(y.slice(i, i + 2), 16)
      )
    )
  );

/** The readback is trusted only once it reads two known colours exactly. */
function expectCalibrated(read: ReturnType<typeof readSoft>) {
  const [l, c] = read.calibration.white;
  expect(Math.abs(l - 1), 'white reads L 1').toBeLessThan(0.001);
  expect(c, 'white reads no chroma').toBeLessThan(0.001);
  expect(read.calibration.known).toEqual([0.5, 0.1, 30]);
}

for (const theme of ['light', 'dark'] as const) {
  test(`of-blood-and-bones/ancestral-threads ${theme}: the soft band is the org's ground a step darker, its warmth kept`, async ({
    browser,
    baseURL,
  }) => {
    const item = CASES[1];
    if (!item) throw new Error('no case');
    const page = await openAs(browser, baseURL as string, item, theme);
    const read = await page.evaluate(readSoft, -0.03);
    await page.context().close();
    const detail = JSON.stringify(read);
    expectCalibrated(read);
    // This org keeps its light ground in dark mode, so both themes are on
    // the light pole, where the step is darker.
    expect(read.ground.lch[0], detail).toBeGreaterThan(0.9);
    expect(read.ground.lch[1], 'a warm ground').toBeGreaterThan(0.01);
    // Its bands, its tabs card and its featured offer.
    expect(read.surfaces.length, detail).toBeGreaterThanOrEqual(5);
    for (const surface of read.surfaces) {
      expect(
        apart(surface.hex, read.expected.hex),
        `${surface.at} ${detail}`
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(surface.lch[1] - read.ground.lch[1]),
        `${surface.at}: the ground's chroma ${detail}`
      ).toBeLessThanOrEqual(0.002);
    }
  });
}

// On the platform's neutral ground, nothing changes: the soft band is still
// the platform's own secondary surface (#f5f5f5 on #fafafa), with no chroma
// to keep. Tending the Grief has no soft section, so its benefits section is
// drawn as one (the attribute alone: the mapping is CSS).
test('studio-alpha/tending-the-grief light: on the platform’s neutral ground the soft band is the platform’s own, unchanged', async ({
  browser,
  baseURL,
}) => {
  const item = CASES[2];
  if (!item) throw new Error('no case');
  const page = await openAs(browser, baseURL as string, item, 'light');
  await page.evaluate(() => {
    const section = document.querySelector(
      ".lp-page > .lp-section[data-lp-type='benefits']"
    );
    if (!section) throw new Error('no benefits section');
    section.setAttribute('data-lp-scheme', 'soft');
  });
  await apply(page, {});
  const read = await page.evaluate(readSoft, -0.03);
  await page.context().close();
  const detail = JSON.stringify(read);
  expectCalibrated(read);
  expect(read.ground.lch[1], 'a neutral ground').toBeLessThan(0.002);
  expect(read.surfaces.length, detail).toBe(1);
  for (const surface of read.surfaces) {
    expect(
      apart(surface.hex, read.orgSecondary.hex),
      detail
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(surface.lch[1] - read.ground.lch[1]),
      detail
    ).toBeLessThanOrEqual(0.002);
  }
});

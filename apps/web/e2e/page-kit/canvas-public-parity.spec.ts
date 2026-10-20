/**
 * The editor's canvas draws the page the public route publishes
 * (Codex-61zsk.15). The legacy builder's parity spec went with it (WP-9a);
 * the intent stands: the canvas must render the same sections, in the same
 * order, laid out the same, as the published page.
 *
 * `kit/PageRenderer.svelte.test.ts` holds the markup per Style in jsdom,
 * which lays nothing out. This is the live pair: the studio's reads feed the
 * canvas and the public loaders feed the page, through different code, and
 * the kit sizes everything from its container (`cqi`, container queries, the
 * heading fit), so a section given a different width draws differently. So:
 *
 *   the sections   the same, in order, each with the same type, layout,
 *                  colour scheme and spacing as the page resolves them, on a
 *                  root with the same Style, Type and dials;
 *   the layout     at each device the canvas offers, the public page at the
 *                  SAME section width (its viewport matched to the canvas's
 *                  section, the container every query reads), then every
 *                  heading's size and lines, and every measure's width.
 *
 * What differs by design is not compared: the canvas is editing and still
 * (`data-lp-editing`, `data-lp-still`, no entrance, no sticky bar), it names
 * the theme its toggle previews where a live page follows the site's
 * (`data-lp-theme`; both are read in light here), only a live page clears its
 * shader's cover (`data-lp-atmosphere`), and the canvas
 * always draws the SELL state (`builder-context.ts` pins `purchasable:
 * true`): on a page nobody can buy, the canvas draws the buttons the public
 * page replaces with its notice. So only headings and measures are read,
 * never the buttons or notices around them.
 *
 * A negative control first: the public page at two widths must read
 * differently, so a fingerprint too coarse to see a width is a failure here,
 * not a quiet pass. The fixtures are studio-alpha's (the seeded creator's):
 * the canvas never writes on open (the loaded page is the saved baseline),
 * but no other org's pages are opened in an editor.
 */
import { type Browser, expect, type Page, test } from '@playwright/test';
import type { BrowserCookie } from '../helpers/auth-cookies';
import { journeyFixture, journeyUrl, orgUrl } from '../helpers/journeys';
import { captureSeededCreatorCookies } from '../helpers/subscription';

const FIXTURES = [
  journeyFixture('studio-alpha', 'bone-deep'),
  journeyFixture('studio-alpha', 'tending-the-grief'),
];
const HEIGHT = 900;
/** The page root's attributes both trees share (the rest differ by design). */
const ROOT_ATTRS = [
  'data-lp-style',
  'data-lp-type-facet',
  'data-lp-corners',
  'data-lp-drama',
  'data-lp-motion',
  'data-ground-light',
  'data-ground-dark',
];
/**
 * The text the kit draws only while the page sells (`selling` in CtaBlock and
 * PricingBlock: a closing note beside the ask), so on a page nobody can buy
 * only the canvas draws it. Skipped on the canvas, for such a page only.
 */
const SELL_ONLY = [
  ".lp-section[data-lp-type='cta'] .lp-text[data-field='note']",
  ".lp-section[data-lp-type='pricing'] .lp-text[data-field='note']",
];
const SECTION_ATTRS = [
  'data-lp-type',
  'data-lp-layout',
  'data-lp-scheme',
  'data-lp-spacing',
  'data-lp-on-media',
  'data-lp-continues',
];

test.describe.configure({ mode: 'serial', timeout: 240_000 });

interface Drawn {
  root: Record<string, string | null>;
  sections: {
    attrs: Record<string, string | null>;
    width: number;
    /** The section's exact width: what `cqi` and container queries read. */
    exact: number;
    /** [text, font size, lines, width] per heading, in order. */
    headings: [string, string, number, number][];
    /** [text, width] per measured text block, in order. */
    measures: [string, number][];
  }[];
}

/** What the comparison reads, below `scope`'s page root. */
function read(page: Page, scope: string, skip: string[] = []): Promise<Drawn> {
  return page.evaluate(
    ({ scope, rootAttrs, sectionAttrs, skip }) => {
      const skipped = new Set(
        skip.flatMap((selector) => [
          ...document.querySelectorAll(`${scope} ${selector}`),
        ])
      );
      const root = document.querySelector<HTMLElement>(`${scope} .lp`);
      const attrs = (el: Element, names: string[]) =>
        Object.fromEntries(names.map((n) => [n, el.getAttribute(n)]));
      const text = (el: Element) =>
        (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 48);
      return {
        root: root ? attrs(root, rootAttrs) : {},
        sections: [
          ...(root?.querySelectorAll<HTMLElement>('.lp-section') ?? []),
        ].map((section) => ({
          attrs: attrs(section, sectionAttrs),
          width: section.offsetWidth,
          exact: section.getBoundingClientRect().width,
          headings: [
            ...section.querySelectorAll<HTMLElement>('.lp-heading'),
          ].map((h) => {
            const cs = getComputedStyle(h);
            const lh = Number.parseFloat(cs.lineHeight);
            return [
              text(h),
              cs.fontSize,
              lh > 0 ? Math.round(h.offsetHeight / lh) : -1,
              h.offsetWidth,
            ];
          }),
          measures: [...section.querySelectorAll<HTMLElement>('.lp-text')]
            .filter((t) => !skipped.has(t))
            .map((t) => [text(t), t.offsetWidth]),
        })),
      };
    },
    { scope, rootAttrs: ROOT_ATTRS, sectionAttrs: SECTION_ATTRS, skip }
  );
}

/** Every read answered, the faces in, and the tree quiet for a second. */
async function settle(page: Page, scope: string): Promise<void> {
  await page
    .waitForLoadState('networkidle', { timeout: 45_000 })
    .catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate(
    (scope) =>
      new Promise<void>((resolve) => {
        const target = document.querySelector(scope) ?? document.body;
        let timer = setTimeout(done, 1000);
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(done, 1000);
        });
        function done() {
          observer.disconnect();
          resolve();
        }
        observer.observe(target, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        setTimeout(done, 20_000);
      }),
    scope
  );
}

/** The public page's viewport, resized until its section is `width` wide. */
async function matchWidth(page: Page, width: number): Promise<number> {
  let drawn = -1;
  for (let i = 0; i < 4; i++) {
    drawn = await page.evaluate(
      () =>
        document.querySelector<HTMLElement>('.lp .lp-section')?.offsetWidth ??
        -1
    );
    if (drawn === width) return drawn;
    const current = page.viewportSize()?.width ?? width;
    await page.setViewportSize({
      width: current + (width - drawn),
      height: HEIGHT,
    });
    await settle(page, '.lp');
  }
  return drawn;
}

async function openPublic(
  browser: Browser,
  org: string,
  slug: string,
  width: number
) {
  const fixture = journeyFixture(org, slug);
  const context = await browser.newContext({
    viewport: { width, height: HEIGHT },
    reducedMotion: 'reduce',
  });
  const url = journeyUrl(test.info().project.use.baseURL as string, fixture);
  await context.addCookies([
    { name: 'theme', value: 'light', url: new URL(url).origin },
  ]);
  const page = await context.newPage();
  await page.goto(url);
  await expect(page.locator('.lp .lp-section').first()).toBeVisible({
    timeout: 60_000,
  });
  await settle(page, '.lp');
  return { context, page };
}

let cookies: BrowserCookie[] = [];

test.beforeAll(async () => {
  cookies = await captureSeededCreatorCookies();
});

test('the fingerprint sees a width (negative control)', async ({ browser }) => {
  const [fixture] = FIXTURES;
  const { context, page } = await openPublic(
    browser,
    fixture.org,
    fixture.pageSlug,
    1280
  );
  try {
    const wide = await read(page, '');
    await page.setViewportSize({ width: 820, height: HEIGHT });
    await settle(page, '.lp');
    const narrow = await read(page, '');
    expect(wide.sections.length).toBeGreaterThan(0);
    expect(narrow.sections.map((s) => s.attrs)).toEqual(
      wide.sections.map((s) => s.attrs)
    );
    expect(
      JSON.stringify(narrow.sections.map((s) => [s.headings, s.measures])),
      'the same page at 1280 and 820 read alike: the fingerprint cannot see a layout'
    ).not.toBe(
      JSON.stringify(wide.sections.map((s) => [s.headings, s.measures]))
    );
  } finally {
    await context.close();
  }
});

for (const fixture of FIXTURES)
  test(`${fixture.org}/${fixture.pageSlug}: the canvas draws what the page publishes`, async ({
    browser,
    baseURL,
  }) => {
    const studioContext = await browser.newContext({
      viewport: { width: 1440, height: HEIGHT },
      reducedMotion: 'reduce',
    });
    await studioContext.addCookies(cookies);
    await studioContext.addCookies([
      {
        name: 'theme',
        value: 'light',
        url: new URL(orgUrl(baseURL as string, fixture.org, '/')).origin,
      },
    ]);
    const studio = await studioContext.newPage();
    try {
      // The editor's own id, from the portal's row (the public slug is not it).
      await studio.goto(
        orgUrl(baseURL as string, fixture.org, '/studio/journeys')
      );
      const edit = studio
        .locator('li.journey-row')
        .filter({
          has: studio.locator(
            `a[href="/journeys/${fixture.pageSlug}?preview=1"]`
          ),
        })
        .getByRole('link', { name: 'Edit page' });
      const href = await edit.getAttribute('href', { timeout: 60_000 });
      expect(href, `no Edit page link for ${fixture.pageSlug}`).toMatch(
        /^\/studio\/journeys\/[^/]+\/page$/
      );
      await studio.goto(orgUrl(baseURL as string, fixture.org, href as string));
      const canvas = '.canvas__page';
      await expect(studio.locator(`${canvas} .lp .lp-section`)).toHaveCount(
        fixture.sections.length,
        {
          timeout: 90_000,
        }
      );
      await settle(studio, canvas);

      const { context: publicContext, page: published } = await openPublic(
        browser,
        fixture.org,
        fixture.pageSlug,
        1440
      );
      try {
        for (const device of ['Desktop', 'Tablet', 'Mobile']) {
          await studio
            .getByRole('group', { name: 'Device' })
            .getByRole('button', { name: device, exact: true })
            .click();
          await settle(studio, canvas);
          const drawn = await read(
            studio,
            canvas,
            fixture.purchasable ? [] : SELL_ONLY
          );
          const width = drawn.sections[0]?.width ?? -1;
          expect(
            width,
            `${device}: the canvas drew no section`
          ).toBeGreaterThan(0);
          for (const section of drawn.sections)
            expect(section.width, `${device}: every section is one width`).toBe(
              width
            );

          expect(
            await matchWidth(published, width),
            `${device}: the public section never matched ${width}px`
          ).toBe(width);
          const live = await read(published, '');

          // The sections, in order, as the page stores and resolves them.
          expect(drawn.sections.map((s) => s.attrs['data-lp-type'])).toEqual([
            ...fixture.sections,
          ]);
          expect(drawn.root, `${device}: the page root`).toEqual(live.root);
          expect(
            drawn.sections.map((s) => s.attrs),
            `${device}: the sections`
          ).toEqual(live.sections.map((s) => s.attrs));
          // Laid out alike at one width. A device frame is a whole number of
          // pixels (820 less its borders) and the public section is the window
          // less the org's own chrome, which is not (817.5625 at a tablet's
          // width), so the two can differ by less than a pixel, and every size
          // the kit takes from its container moves with it. Text and lines are
          // held exactly; a width within that gap and a pixel; a size within
          // twice its share of the width (a size fitted to the column, the
          // width less two gutters, moves a little faster than the width).
          drawn.sections.forEach((section, i) => {
            const other = live.sections[i];
            const at = `${device} @${section.exact} vs ${other?.exact} ${section.attrs['data-lp-type']}`;
            expect(other, at).toBeDefined();
            if (!other) return;
            const gap = Math.abs(section.exact - other.exact);
            expect(gap, `${at}: the sections are not one width`).toBeLessThan(
              1
            );
            const share = (2 * gap) / other.exact + 1e-4;
            const near = (a: number, b: number, by: number) =>
              Math.abs(a - b) <= by;
            expect(
              section.headings.map(([t, , lines]) => [t, lines]),
              `${at}: headings and their lines`
            ).toEqual(other.headings.map(([t, , lines]) => [t, lines]));
            section.headings.forEach(([t, size, , w], j) => {
              const [, otherSize = '0', , otherW = 0] = other.headings[j] ?? [];
              const [a, b] = [
                Number.parseFloat(size),
                Number.parseFloat(otherSize),
              ];
              expect(
                near(a, b, b * share),
                `${at}: "${t}" is ${size} here, ${otherSize} live`
              ).toBe(true);
              expect(
                near(w, otherW, gap + 1),
                `${at}: "${t}" is ${w}px wide here, ${otherW}px live`
              ).toBe(true);
            });
            expect(
              section.measures.map(([t]) => t),
              `${at}: measured text`
            ).toEqual(other.measures.map(([t]) => t));
            section.measures.forEach(([t, w], j) => {
              const otherW = other.measures[j]?.[1] ?? 0;
              expect(
                near(w, otherW, gap + 1),
                `${at}: "${t}" is ${w}px wide here, ${otherW}px live`
              ).toBe(true);
            });
          });
        }
      } finally {
        await publicContext.close();
      }
    } finally {
      await studioContext.close();
    }
  });

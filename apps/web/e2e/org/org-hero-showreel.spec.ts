/**
 * The Showreel (Codex-1yd58.6) on a real landing, in a real browser: it moves
 * on by itself and holds while paused (WCAG 2.2.2) or while keyboard focus is
 * inside (owner Q1), never for a click's focus; reduced motion draws stills
 * that never move on by themselves; Save-Data draws stills that still move on
 * (owner Q3); with no WebGL2 the page's own copy of the film shows, and with
 * it the film is hidden there only while the window's canvas draws it
 * (`data-film`); the film button opens the film and the reel holds for it,
 * on a phone too, where focus comes back to the button when the pop-up
 * closes; on a phone a tap moves on, or back on the left third.
 *
 * Measured on of-blood-and-bones without a DB write: the landing's HTML is
 * rewritten in the browser to set the hero options the brand editor would
 * save (`brandFineTune.tokenOverrides`, the keys set last so they win). The
 * server rendered the org's stored hero; hydration redraws it as the
 * Showreel, as a saved change would draw on the next load.
 *
 * A fulfilled document has no address, so Chrome's Local Network Access
 * counts it public and blocks its requests to the local servers: the flags
 * below lift that for this file only.
 */

import {
  type Browser,
  type BrowserContextOptions,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { E2E_BASE_URL } from '../helpers/origin';

const ORG = 'of-blood-and-bones';
/** `PIECE_MS` in reel-clock.svelte.ts: how long each piece plays. */
const PIECE_MS = 7000;
/** A piece, plus the words' swap and a slow CI frame. */
const MOVES_ON = PIECE_MS + 5000;

test.use({
  launchOptions: {
    args: [
      '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
});

const origin = (baseURL: string) => {
  const u = new URL(baseURL);
  return `${u.protocol}//${ORG}.${u.host}`;
};

/** The brand's stored overrides in the page's data: a JSON string, or null. */
const PAYLOAD = /brandFineTune:\{tokenOverrides:("(?:[^"\\]|\\.)*"|null)/;

/**
 * The landing's HTML with these hero options set as the editor saves them,
 * or null when it carries no brand payload to set them on.
 */
function withHeroOptions(
  html: string,
  keys: Record<string, string>
): string | null {
  const match = PAYLOAD.exec(html);
  if (!match) return null;
  const stored: Record<string, string> =
    match[1] === 'null' ? {} : JSON.parse(JSON.parse(match[1]));
  const set = Object.fromEntries(
    Object.entries(keys).map(([key, value]) => [`hero-opt-${key}`, value])
  );
  const literal = JSON.stringify(JSON.stringify({ ...stored, ...set })).replace(
    /</g,
    '\\u003C'
  );
  return html.replace(
    match[0],
    () => `brandFineTune:{tokenOverrides:${literal}`
  );
}

async function open(
  browser: Browser,
  baseURL: string | undefined,
  {
    context: contextOptions = {},
    keys = {},
    init,
  }: {
    context?: BrowserContextOptions;
    keys?: Record<string, string>;
    init?: () => void;
  } = {}
): Promise<Page> {
  const url = `${origin(baseURL ?? E2E_BASE_URL)}/`;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...contextOptions,
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  let rewritten = false;
  await page.route(url, async (route) => {
    const response = await route.fetch();
    const body = withHeroOptions(await response.text(), {
      purpose: 'consume',
      comp: 'showreel',
      'reel-layout': 'corner',
      ...keys,
    });
    rewritten = body !== null;
    await route.fulfill({ response, body: body ?? undefined });
  });
  await page.goto(url);
  test.skip(
    !rewritten,
    `${ORG}'s landing has no brand payload to set the Showreel on`
  );
  await expect(page.locator('.reel')).toBeVisible({ timeout: 30_000 });
  // The server draws the Showreel too (the consume default), so in sight is
  // not yet hydrated, and a click then does nothing. The bar's first write
  // (`--_progress`) is the browser's own: the reel is live from there.
  await expect(page.locator('.reel')).toHaveAttribute('style', /--_progress/, {
    timeout: 30_000,
  });
  return page;
}

/** The piece the index says is playing. */
const current = (page: Page) =>
  page.locator('.reel [aria-current="true"] .reel__t');

/** Somewhere over the frame, off the words, the index and the strip. */
const offTheWords = (page: Page) => page.mouse.move(720, 220);

test.describe('the Showreel on a landing', () => {
  test('moves on by itself, holds while paused, and plays again (WCAG 2.2.2)', async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL);
    const first = (await current(page).textContent()) ?? '';
    await expect(current(page)).not.toHaveText(first, { timeout: MOVES_ON });

    // One pause, its label saying what a press does next (no aria-pressed).
    const pause = page.locator('.reel__ctl .reel__round');
    await expect(pause).toHaveAttribute('aria-label', 'Pause the reel');
    await pause.click();
    await offTheWords(page);
    await expect(pause).toHaveAttribute('aria-label', 'Play the reel');
    await expect(pause).not.toHaveAttribute('aria-pressed', /.*/);
    const held = (await current(page).textContent()) ?? '';
    await page.waitForTimeout(PIECE_MS + 1500);
    await expect(current(page)).toHaveText(held);

    // Focus stays on Play after the click: a click's focus never holds.
    await pause.click();
    await offTheWords(page);
    await expect(pause).toHaveAttribute('aria-label', 'Pause the reel');
    await expect(current(page)).not.toHaveText(held, { timeout: MOVES_ON });
    await page.context().close();
  });

  test('holds while keyboard focus is inside the reel', async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL);
    const item = page.locator('.reel__index .reel__item').first();
    await item.focus();
    expect(await item.evaluate((el) => el.matches(':focus-visible'))).toBe(
      true
    );
    const held = (await current(page).textContent()) ?? '';
    await page.waitForTimeout(PIECE_MS + 1500);
    await expect(current(page)).toHaveText(held);

    // Focus leaves: a click on the frame, nothing there to focus.
    await page.mouse.click(720, 220);
    await expect(current(page)).not.toHaveText(held, { timeout: MOVES_ON });
    await page.context().close();
  });

  test("the focus ring: none for a click; for keys, the brand's colour solved over film, rounded, off the row's words", async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL);
    const item = page.locator('.reel__index .reel__item').first();
    await item.click();
    await offTheWords(page);
    await expect(item).toHaveCSS('outline-style', 'none');

    // Keyboard focus: away and back.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(item).toBeFocused();
    const ring = await item.evaluate((el) => {
      const reel = el.closest<HTMLElement>('.reel');
      const probe = document.createElement('canvas').getContext('2d', {
        willReadFrequently: true,
      });
      if (!reel?.parentElement || !probe) return null;
      const rgb = (css: string) => {
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = css;
        probe.fillRect(0, 0, 1, 1);
        return [...probe.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      };
      const lum = (c: number[]) =>
        c
          .map((v) => {
            const s = v / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const ratio = (a: number[], b: number[]) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const style = getComputedStyle(el);
      const reelStyle = getComputedStyle(reel);
      const color = rgb(style.outlineColor);
      // The ring sits on its own band of the solid scrim (a two-tone
      // indicator), so that is its ground, whatever the frame.
      const ground = rgb(reelStyle.getPropertyValue('--_scrim'));
      const band = /(\d+(?:\.\d+)?)px\s*$/.exec(
        style.boxShadow.split(') ').pop() ?? ''
      );
      const brand = rgb(
        getComputedStyle(reel.parentElement).getPropertyValue('--color-focus')
      );
      return {
        visible: el.matches(':focus-visible'),
        style: style.outlineStyle,
        offset: Number.parseFloat(style.outlineOffset),
        width: Number.parseFloat(style.outlineWidth),
        band: band ? Number(band[1]) : 0,
        radius: Number.parseFloat(style.borderTopLeftRadius),
        ratio: ratio(color, ground),
        brandPasses: ratio(brand, ground) >= 3,
        isBrand: color.every((v, i) => v === brand[i]),
      };
    });
    expect(ring).not.toBeNull();
    expect(ring).toMatchObject({ visible: true, style: 'solid' });
    // Rounded, and clear of "01" and "Film", which sit on the row's edges.
    expect(ring?.radius).toBeGreaterThan(0);
    expect(ring?.offset).toBeGreaterThanOrEqual(4);
    // Its band reaches past the whole ring, so the ring is drawn on the scrim.
    expect(ring?.band ?? 0).toBeGreaterThanOrEqual(
      (ring?.offset ?? 0) + (ring?.width ?? 0)
    );
    // 3:1 against that band (WCAG 1.4.11); the brand's own focus colour when
    // it reaches that as it is (OBB's red does: 3.75:1 on its dark).
    expect(ring?.ratio).toBeGreaterThanOrEqual(3);
    if (ring?.brandPasses) expect(ring.isBrand).toBe(true);
    await page.context().close();
  });

  test('no band over the film: the shades are soft radials anchored off the reel (owner)', async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL);
    // fitScrims has drawn the solved shades.
    await expect(page.locator('.reel')).toHaveAttribute(
      'style',
      /--_foot-0: ellipse/
    );
    const shades = await page.locator('.reel').evaluate((reel) =>
      ['.reel__scrim-top', '.reel__scrim-foot'].map((sel) => {
        const el = reel.querySelector(sel);
        return el ? getComputedStyle(el).backgroundImage : '';
      })
    );
    for (const image of shades) {
      expect(image).toContain('radial-gradient');
      // No band: no linear gradient across the film.
      expect(image).not.toContain('linear-gradient');
    }
    const anchors = await page.locator('.reel').evaluate((reel) =>
      ['--_top-0', '--_top-1', '--_foot-0', '--_foot-1'].map((name) => {
        const m = / at (-?[\d.]+)% (-?[\d.]+)%/.exec(
          reel.style.getPropertyValue(name)
        );
        return m ? Number(m[2]) : Number.NaN;
      })
    );
    // Each ellipse's centre lies off the reel, above it or below it, so only
    // its soft falloff ever crosses the film: no edge.
    const [top0, top1, foot0, foot1] = anchors;
    for (const y of [top0, top1]) expect(y).toBeLessThan(0);
    for (const y of [foot0, foot1]) expect(y).toBeGreaterThan(100);
    await page.context().close();
  });

  test("'shadow' (the default) glows each word with no outline and grows the shades; 'outline' keeps them as drawn and outlines the words", async ({
    browser,
    baseURL,
  }) => {
    const read = async (keys: Record<string, string>) => {
      const page = await open(browser, baseURL, { keys });
      await expect(page.locator('.reel')).toHaveAttribute(
        'style',
        /--_foot-0: ellipse/
      );
      const out = await page.locator('.reel').evaluate((reel) => ({
        edge: reel.getAttribute('data-edge'),
        // Each word's text-shadow layers as [x, y, blur] in px, colours dropped.
        shadows: [...reel.querySelectorAll<HTMLElement>('[data-ink]')]
          .filter((el) => el.getBoundingClientRect().width > 1)
          .map((el) =>
            getComputedStyle(el)
              .textShadow.replace(/(rgba?|color)\([^)]*\)/g, '')
              .split(',')
              .map((layer) =>
                (layer.match(/-?[\d.]+px/g) ?? []).map(parseFloat)
              )
              .filter((layer) => layer.length >= 2)
          ),
        foot: reel.style.getPropertyValue('--_foot-0'),
        peakTop: Number(reel.style.getPropertyValue('--_peak-top')),
      }));
      await page.context().close();
      return out;
    };
    const radius = (shape: string) =>
      Number(/ellipse ([\d.]+)%/.exec(shape)?.[1] ?? Number.NaN);
    const shadow = await read({});
    expect(shadow.edge).toBe('shadow');
    expect(shadow.shadows.length).toBeGreaterThan(0);
    // A soft glow: blurred layers centred on the glyphs, never a ring.
    for (const layers of shadow.shadows) {
      expect(layers.length).toBeGreaterThan(0);
      for (const [x, y, blur] of layers) {
        expect([x, y]).toEqual([0, 0]);
        expect(blur).toBeGreaterThan(0);
      }
    }
    const outline = await read({ 'reel-edge': 'outline' });
    expect(outline.edge).toBe('outline');
    // An outline: every word has its 1 px ring, offset and unblurred.
    for (const layers of outline.shadows) {
      expect(
        layers.some(
          ([x = 0, y = 0, blur = 0]) => Math.hypot(x, y) > 0 && blur === 0
        )
      ).toBe(true);
    }
    // Outline draws the shades as they are (HEADER_SHADE, FOOT_SHADE); shadow
    // grows them, never smaller: OBB's bright film needs more than they lay.
    expect(radius(outline.foot)).toBe(78);
    expect(outline.peakTop).toBe(0.6);
    expect(radius(shadow.foot)).toBeGreaterThanOrEqual(78);
    expect(shadow.peakTop).toBeGreaterThanOrEqual(0.6);
    expect(radius(shadow.foot) > 78 || shadow.peakTop > 0.6).toBe(true);
  });

  test('reduced motion: stills, no film playing, no moving on by itself; the index still changes piece', async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL, {
      context: { reducedMotion: 'reduce' },
    });
    await expect(page.locator('.reel')).toHaveAttribute('data-mode', 'static');
    await expect(page.locator('.reel-stage video')).toHaveCount(0);
    const first = (await current(page).textContent()) ?? '';
    await page.waitForTimeout(PIECE_MS + 1500);
    await expect(current(page)).toHaveText(first);

    const second = page.locator('.reel__index .reel__item').nth(1);
    await second.click();
    await expect(current(page)).toHaveText(
      (await second.locator('.reel__t').textContent()) ?? ''
    );
    await page.context().close();
  });

  test('Save-Data: stills that still move on (owner Q3)', async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL, {
      init: () => {
        Object.defineProperty(Navigator.prototype, 'connection', {
          configurable: true,
          get: () => ({
            saveData: true,
            addEventListener: () => {},
            removeEventListener: () => {},
          }),
        });
      },
    });
    await expect(page.locator('.reel')).toHaveAttribute('data-mode', 'stills');
    await expect(page.locator('.reel-stage video')).toHaveCount(0);
    const first = (await current(page).textContent()) ?? '';
    await expect(current(page)).not.toHaveText(first, { timeout: MOVES_ON });
    await page.context().close();
  });

  test("with no WebGL2, the page's own copy of the film shows", async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL, {
      init: () => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
          configurable: true,
          value(
            this: HTMLCanvasElement,
            ...args: Parameters<typeof getContext>
          ) {
            return args[0] === 'webgl2' ? null : getContext.apply(this, args);
          },
        });
      },
    });
    await page.waitForTimeout(3000);
    await expect(page.locator('.shader-hero--fullpage[data-film]')).toHaveCount(
      0
    );
    await expect(page.locator('.reel-stage')).toHaveCSS('opacity', '1');
    await expect(page.locator('.reel-stage__item[data-on] img')).toBeVisible();
    await page.context().close();
  });

  test("with WebGL2, the film is hidden in the page only while the window's canvas draws it", async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL);
    const video = page.locator('.reel-stage__item[data-on] video');
    const footage =
      (await video.count()) > 0 &&
      (await video
        .evaluate(
          (el: HTMLVideoElement) =>
            new Promise<boolean>((resolve) => {
              if (el.readyState >= 2) return resolve(true);
              el.addEventListener('loadeddata', () => resolve(true), {
                once: true,
              });
              setTimeout(() => resolve(false), 15_000);
            })
        )
        .catch(() => false));
    const webgl2 = await page.evaluate(
      () => !!document.createElement('canvas').getContext('webgl2')
    );
    if (footage && webgl2) {
      await expect(
        page.locator('.shader-hero--fullpage[data-film]')
      ).toHaveCount(1, {
        timeout: 5000,
      });
    } else {
      test.info().annotations.push({
        type: 'note',
        description: `no composited film to prove here (footage ${footage}, WebGL2 ${webgl2}): only the rule is held`,
      });
    }
    // Hidden in the page exactly while the canvas draws it, never otherwise.
    const film =
      (await page.locator('.shader-hero--fullpage[data-film]').count()) > 0;
    await expect(page.locator('.reel-stage')).toHaveCSS(
      'opacity',
      film ? '0' : '1'
    );
    await page.context().close();
  });

  test('the film button opens the film, and the reel holds for it', async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL);
    const button = page.locator('.reel__btn');
    const label = (await button.textContent())?.trim() ?? '';
    test.skip(
      !/^(Play the preview|Watch our film)/.test(label),
      `${ORG}'s reel opens on no film here ("${label}")`
    );
    await button.click();
    await expect(page.locator('.hero-film')).toBeVisible();
    await expect(page.locator('.reel__inner')).toHaveAttribute('inert', '');
    const held = (await current(page).textContent()) ?? '';
    await page.waitForTimeout(PIECE_MS + 1500);
    await expect(current(page)).toHaveText(held);

    await page
      .locator('.hero-film')
      .getByRole('button', { name: 'Close video' })
      .click();
    await expect(page.locator('.hero-film')).toHaveCount(0);
    await expect(page.locator('.reel__inner')).not.toHaveAttribute('inert', '');
    await page.context().close();
  });

  test('on a phone, the reel holds while the film plays in the pop-up, and focus comes back to its button', async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL, {
      context: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    });
    const button = page.locator('.reel__words .reel__btn');
    const label = (await button.textContent())?.trim() ?? '';
    test.skip(
      !/^(Play the preview|Watch our film)/.test(label),
      `${ORG}'s reel opens on no film here ("${label}")`
    );
    await button.click();
    const modal = page.locator('.intro-modal');
    await expect(modal).toBeVisible();
    const held = (await current(page).textContent()) ?? '';
    await page.waitForTimeout(PIECE_MS + 1500);
    await expect(current(page)).toHaveText(held);

    await modal.getByRole('button', { name: 'Close video' }).click();
    await expect(modal).toHaveCount(0);
    // The page hands focus back to the button that opened the film (WCAG 2.4.3).
    await expect(button).toBeFocused();
    await page.context().close();
  });

  test('on a phone, a tap moves on, and one on the left third goes back', async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL, {
      context: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    });
    const first = (await current(page).textContent()) ?? '';
    await page.touchscreen.tap(300, 380);
    await expect(current(page)).not.toHaveText(first);
    await page.touchscreen.tap(60, 380);
    await expect(current(page)).toHaveText(first);
    await page.context().close();
  });
});

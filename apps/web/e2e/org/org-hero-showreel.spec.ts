/**
 * The Showreel (Codex-1yd58.6) on a real landing, in a real browser: it moves
 * on by itself and holds while paused (WCAG 2.2.2) or while keyboard focus is
 * inside (owner Q1), never for a click's focus; reduced motion draws stills
 * that never move on by themselves; Save-Data draws stills that still move on
 * (owner Q3); with no WebGL2 the page's own copy of the film shows, and with
 * it the film is hidden there only while the window's canvas draws it
 * (`data-film`); a full film's button opens the film and the reel holds for
 * it, on a phone too, where focus comes back to the button when the pop-up
 * closes (a preview opens the reel's theatre: org-hero-theatre.spec.ts); on a
 * phone a tap moves on, or back on the left third. With no WebGL2 the page's
 * still pushes in on the reel's clock and holds while paused (none under
 * reduced motion), and the peek stops the hero short of the screen so the
 * first section shows above the fold (WP-5b, owner 2026-11-21).
 *
 * Measured on of-blood-and-bones without a DB write, through
 * `helpers/showreel.ts`: the landing's HTML is rewritten in the browser to set
 * the hero options the brand editor would save, and `SHOWREEL_LAUNCH` lifts
 * Chrome's Local Network Access block on the fulfilled document for this file
 * only.
 */

import { expect, test } from '@playwright/test';
import {
  currentPiece as current,
  MOVES_ON,
  ORG,
  offTheWords,
  openShowreel as open,
  PIECE_MS,
  SHOWREEL_LAUNCH,
} from '../helpers/showreel';

test.use(SHOWREEL_LAUNCH);

/** No WebGL2: the page's own copy of the film is the film. Self-contained (an init script). */
function withoutWebGL2() {
  const getContext = HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value(this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      return args[0] === 'webgl2' ? null : getContext.apply(this, args);
    },
  });
}

/** No WebGL2 and Save-Data: every piece the page's own still, moving on. Self-contained. */
function stillsWithoutWebGL2() {
  const getContext = HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value(this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      return args[0] === 'webgl2' ? null : getContext.apply(this, args);
    },
  });
  Object.defineProperty(Navigator.prototype, 'connection', {
    configurable: true,
    get: () => ({
      saveData: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

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

  test("before the fit, the ring is the pole's ink, never a creator's dark player text (review R3)", async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL);
    const ring = await page.locator('.reel').evaluate((reel) => {
      // The first paint, as it stands before the fit: no solved ring, no
      // `data-fit`, and a player text set dark on OBB's dark.
      reel.style.removeProperty('--color-focus');
      reel.removeAttribute('data-fit');
      reel.style.setProperty('--color-player-text', '#8B1A2B');
      const probe = document.createElement('span');
      probe.style.color = 'var(--color-focus)';
      reel.append(probe);
      const canvas = document.createElement('canvas').getContext('2d', {
        willReadFrequently: true,
      });
      if (!canvas) return null;
      canvas.fillStyle = getComputedStyle(probe).color;
      canvas.fillRect(0, 0, 1, 1);
      probe.remove();
      return [...canvas.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    });
    // OBB is dark: its pole's ink is white.
    expect(ring).toEqual([255, 255, 255]);
    await page.context().close();
  });

  test('no band over the film: the shades are soft radials anchored off the reel (owner)', async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL);
    // fitScrims has drawn the solved shades: the server's first paint (the
    // cap) carries `--_foot-0` too, so wait for the fit's own mark.
    await expect(page.locator('.reel')).toHaveAttribute('data-fit', '');
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
      await expect(page.locator('.reel')).toHaveAttribute('data-fit', '');
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
    const page = await open(browser, baseURL, { init: withoutWebGL2 });
    await page.waitForTimeout(3000);
    await expect(page.locator('.shader-hero--fullpage[data-film]')).toHaveCount(
      0
    );
    await expect(page.locator('.reel-stage')).toHaveCSS('opacity', '1');
    await expect(page.locator('.reel-stage__item[data-on] img')).toBeVisible();
    await page.context().close();
  });

  test("with no WebGL2, the page's still pushes in over its piece on the reel's clock, and holds while paused (WP-5b)", async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL, { init: stillsWithoutWebGL2 });
    await expect(page.locator('.reel')).toHaveAttribute('data-mode', 'stills');
    await expect(page.locator('.reel-stage[data-push]')).toHaveCount(1);
    const img = page.locator('.reel-stage__item[data-on] img');
    const scale = () =>
      img.evaluate((el) => {
        const t = getComputedStyle(el).transform;
        return t === 'none' ? 1 : new DOMMatrixReadOnly(t).a;
      });
    // Drawn in about its centre as the piece plays, never past 8%.
    await expect.poll(scale, { timeout: 6000 }).toBeGreaterThan(1.02);
    expect(await scale()).toBeLessThanOrEqual(1.0801);
    // Paused, the move holds where it is (WCAG 2.2.2).
    await page.locator('.reel__ctl .reel__round').click();
    await page.waitForTimeout(200);
    const held = await scale();
    await page.waitForTimeout(1200);
    expect(await scale()).toBe(held);
    await page.context().close();
  });

  test("with no WebGL2, the page's still never draws back out before its cut: the push reads the piece on show (WP-5b review M1r2)", async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL, { init: stillsWithoutWebGL2 });
    await expect(page.locator('.reel')).toHaveAttribute('data-mode', 'stills');
    // Every frame through a piece's end and the beat the stage takes to cut:
    // the still on show and its scale.
    const { backwards, cuts } = await page.evaluate(
      (ms) =>
        new Promise<{ backwards: string[]; cuts: number }>((done) => {
          const backwards: string[] = [];
          let cuts = 0;
          let last: { src: string; scale: number } | null = null;
          const start = performance.now();
          const look = (now: number) => {
            const img = document.querySelector<HTMLImageElement>(
              '.reel-stage__item[data-on] img'
            );
            const t = img ? getComputedStyle(img).transform : 'none';
            const scale = t === 'none' ? 1 : new DOMMatrixReadOnly(t).a;
            const src = img?.currentSrc ?? '';
            if (last && last.src === src && scale < last.scale - 1e-6) {
              backwards.push(
                `${Math.round(now - start)} ms: ${last.scale.toFixed(4)} -> ${scale.toFixed(4)}`
              );
            }
            if (last && last.src !== src) cuts += 1;
            last = { src, scale };
            if (now - start < ms) requestAnimationFrame(look);
            else done({ backwards, cuts });
          };
          requestAnimationFrame(look);
        }),
      PIECE_MS + 1500
    );
    expect(cuts).toBeGreaterThan(0);
    expect(backwards).toEqual([]);
    await page.context().close();
  });

  test('with no WebGL2 and reduced motion, no still pushes in', async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL, {
      init: withoutWebGL2,
      context: { reducedMotion: 'reduce' },
    });
    await expect(page.locator('.reel-stage[data-push]')).toHaveCount(0);
    expect(
      await page
        .locator('.reel-stage__item[data-on] img')
        .evaluate((el) => getComputedStyle(el).transform)
    ).toBe('none');
    await page.context().close();
  });

  for (const [viewport, lift] of [
    [{ width: 1440, height: 900 }, 150],
    [{ width: 390, height: 844 }, 132],
  ] as const) {
    test(`the peek at ${viewport.width}: the hero stops the mock's ${lift} px short of the screen, at the org's density, and the first section shows above the fold (owner)`, async ({
      browser,
      baseURL,
    }) => {
      const page = await open(browser, baseURL, { context: { viewport } });
      await expect(page.locator('.reel')).toHaveAttribute('data-peek', '');
      // The lift is spacing, so it follows the brand's density (OBB's 0.85: 127.5 px).
      const density = await page
        .locator('.reel')
        .evaluate(
          (reel) =>
            Number.parseFloat(
              getComputedStyle(reel).getPropertyValue('--brand-density-scale')
            ) || 1
        );
      const short = lift * density;
      const hero = await page.locator('.reel').boundingBox();
      expect(
        Math.abs(viewport.height - (hero?.height ?? 0) - short)
      ).toBeLessThan(1);
      // Just under the hero's foot, the page's next section, in sight.
      const under = await page.evaluate(
        ([x, y]) => {
          const at = document.elementFromPoint(x, y);
          return at ? !at.closest('.reel') : false;
        },
        [viewport.width / 2, viewport.height - short + 8] as const
      );
      expect(under).toBe(true);
      await page.context().close();
    });
  }

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
    // Only the full film plays in the page's own player: a preview opens the
    // reel's own theatre (Codex-1yd58.8, org-hero-theatre.spec.ts).
    test.skip(
      !/^Watch our film/.test(label),
      `${ORG}'s reel plays no full film here ("${label}")`
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
    // Only the full film plays in the page's pop-up: a preview opens the
    // reel's own theatre (Codex-1yd58.8, org-hero-theatre.spec.ts).
    test.skip(
      !/^Watch our film/.test(label),
      `${ORG}'s reel plays no full film here ("${label}")`
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

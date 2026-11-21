/**
 * The Showreel's theatre (Codex-1yd58.8, WP-7) on a real landing, in a real
 * browser. With no full film, the reel's "Play the preview" opens the
 * theatre: a preview with sound inside the hero. On a desktop it fills the
 * hero and the page still scrolls; on a phone it takes the whole screen and
 * the page behind holds still. Its bar gives pause, the time, sound and
 * close; the reel behind it is inert and Tab stays inside; Escape closes it
 * on the same piece and focus goes back to what opened it (or to the index's
 * current piece when that is gone).
 * While it plays, the reel's own stage footage holds (a page never decodes
 * two films at once) and the reel holds on its piece; at the preview's end it
 * closes and the reel moves on. A recording shows its cover, and with no
 * analyser to read its sound the bars rest.
 *
 * Keyed on roles and labels, not classes: the theatre is the dialog whose bar
 * has the Pause/Play button. Lane A re-cut the hook that opens it while this
 * was written, so the spec names what a visitor sees.
 *
 * Measured on of-blood-and-bones without a DB write, through the Showreel's
 * own spec's setup (`helpers/showreel.ts`): the landing's HTML is rewritten in
 * the browser to set the hero options the brand editor would save
 * (`brandFineTune.tokenOverrides`).
 *
 * Needs (WP-11 checklist §1.2 and §1.3): the dev CDN for the previews, and a
 * browser that decodes H.264/AAC (system Chrome, `channel: 'chrome'`; the
 * bundled Chromium ships without them). Every test that needs a playing
 * preview skips, saying why, when none plays here; count that skip as NOT
 * PROVEN. A fulfilled document has no address, so Chrome's Local Network
 * Access counts it public: `SHOWREEL_LAUNCH` lifts that for this file only.
 * Its flags also let every start keep its sound, so a muted start here is the
 * theatre's own doing (a refused one is ReelTheatre.svelte.test.ts's).
 */

import {
  type BrowserContextOptions,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test';
import {
  MOVES_ON,
  ORG,
  openShowreel as open,
  PIECE_MS,
  SHOWREEL_LAUNCH,
} from '../helpers/showreel';

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
};

test.use(SHOWREEL_LAUNCH);

const showreel = (page: Page) => page.getByRole('region', { name: 'Showreel' });

/** The index's piece now playing (desktop: the Corner layout's index). */
const currentItem = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Showreel' })
    .locator('[aria-current="true"]');

/** The theatre: the dialog whose bar pauses and plays. */
const theatreOf = (page: Page) =>
  page.getByRole('dialog').filter({
    has: page.getByRole('button', { name: /^(Pause|Play)$/ }),
  });

const bar = (theatre: Locator) => ({
  pause: theatre.getByRole('button', { name: /^(Pause|Play)$/ }),
  sound: theatre.getByRole('button', {
    name: /^(Mute|Unmute|Tap for sound)$/,
  }),
  close: theatre.getByRole('button', { name: /close/i }),
  /** The time as a screen reader reads it: "0:04 of 0:30". */
  time: theatre.getByText(/^\d+:\d{2} of \d+:\d{2}$/),
  media: theatre.locator('video, audio'),
});

/**
 * Press the reel's film button and wait for the theatre. Skips, saying why,
 * when the reel opens on no film, or on a full film (whose button opens the
 * full-film player, not the theatre).
 */
async function openTheatre(page: Page): Promise<{
  opener: Locator;
  theatre: Locator;
}> {
  const opener = showreel(page).getByRole('button', {
    name: /^(Play the preview|Watch our film)/,
  });
  const label =
    (await opener.count()) > 0
      ? ((await opener.first().textContent())?.trim() ?? '')
      : '';
  test.skip(
    !label.startsWith('Play the preview'),
    label
      ? `${ORG}'s film is a full film ("${label}"): its button opens the full-film player, not the theatre`
      : `${ORG}'s reel opens on no film here`
  );
  await opener.first().click();
  const theatre = theatreOf(page);
  await expect(theatre).toBeVisible({ timeout: 15_000 });
  return { opener: opener.first(), theatre };
}

/** Whether the theatre's preview gets going here (codecs, the dev CDN). */
async function playsHere(media: Locator): Promise<boolean> {
  return media
    .first()
    .evaluate(
      (el: HTMLMediaElement) =>
        new Promise<boolean>((resolve) => {
          const check = () => el.currentTime > 0.2 && !el.paused;
          if (check()) return resolve(true);
          const timer = setInterval(() => {
            if (!check()) return;
            clearInterval(timer);
            resolve(true);
          }, 100);
          setTimeout(() => {
            clearInterval(timer);
            resolve(false);
          }, 15_000);
        }),
      undefined,
      // The player mounts once its code is in: wait for it, not forever.
      { timeout: 15_000 }
    )
    .catch(() => false);
}

async function requirePlaying(theatre: Locator): Promise<void> {
  test.skip(
    !(await playsHere(bar(theatre).media)),
    'the preview never played here: run under system Chrome with the dev CDN up'
  );
}

/** True when focus is on the opener or, the opener gone, the index's current piece. */
async function focusCameBack(page: Page, opener: Locator): Promise<boolean> {
  const onOpener = await opener
    .evaluate((el) => el === document.activeElement, undefined, {
      timeout: 500,
    })
    .catch(() => false);
  if (onOpener) return true;
  return onIndexItem(page);
}

/**
 * True when focus is on exactly the index's button for the piece on show:
 * never the reel's pause, which comes before it (WP-7 review r2).
 */
const onIndexItem = (page: Page) =>
  page.evaluate(
    () =>
      document.activeElement ===
      document.querySelector('.reel__index .reel__item[aria-current="true"]')
  );

/** Videos outside every dialog that are playing: the reel's stage footage. */
const stagePlaying = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll('video')].filter(
        (el) =>
          !el.closest('[role="dialog"]') &&
          !el.paused &&
          el.readyState >= 2 &&
          el.currentTime > 0
      ).length
  );

test.describe('the Showreel theatre', () => {
  test('"Play the preview" opens it over the hero: it fills the hero, its bar works, and the page still scrolls', async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL);
    const { opener, theatre } = await openTheatre(page);
    const controls = bar(theatre);
    // Focus goes in, to the bar's first control.
    await expect(controls.pause).toBeFocused();

    // It fills the hero, and the film fills it.
    const hero = await showreel(page).boundingBox();
    const box = await theatre.boundingBox();
    expect(hero).not.toBeNull();
    expect(box).not.toBeNull();
    if (hero && box) {
      for (const edge of ['x', 'y', 'width', 'height'] as const) {
        expect(Math.abs(box[edge] - hero[edge]), edge).toBeLessThanOrEqual(2);
      }
    }
    await requirePlaying(theatre);
    const film = await controls.media.first().boundingBox();
    if (film && box) {
      expect(film.width).toBeGreaterThanOrEqual(box.width - 2);
      expect(film.height).toBeGreaterThanOrEqual(box.height - 2);
    }

    // The time runs while it plays, and holds while it is paused.
    const started = (await controls.time.textContent()) ?? '';
    await expect(controls.time).not.toHaveText(started, { timeout: 5000 });
    await expect(controls.pause).toHaveAccessibleName('Pause');
    await controls.pause.click();
    await expect(controls.pause).toHaveAccessibleName('Play');
    expect(
      await controls.media.first().evaluate((el: HTMLMediaElement) => el.paused)
    ).toBe(true);
    const held = (await controls.time.textContent()) ?? '';
    await page.waitForTimeout(1500);
    await expect(controls.time).toHaveText(held);
    await controls.pause.click();
    await expect(controls.pause).toHaveAccessibleName('Pause');

    // Sound: the press started it with its sound (nothing here refuses a
    // start), and it mutes and back.
    await expect(controls.sound).toHaveAccessibleName('Mute');
    expect(
      await controls.media.first().evaluate((el: HTMLMediaElement) => el.muted)
    ).toBe(false);
    await controls.sound.click();
    await expect(controls.sound).toHaveAccessibleName('Unmute');
    expect(
      await controls.media.first().evaluate((el: HTMLMediaElement) => el.muted)
    ).toBe(true);
    await controls.sound.click();
    await expect(controls.sound).toHaveAccessibleName('Mute');

    // A desktop's theatre locks nothing: the wheel still scrolls the page.
    const top = await page.evaluate(() => window.scrollY);
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, 400);
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(top);
    await page.evaluate(() => window.scrollTo(0, 0));

    await controls.close.click();
    await expect(theatre).toHaveCount(0);
    await expect.poll(() => focusCameBack(page, opener)).toBe(true);
    await page.context().close();
  });

  test('Tab stays inside; Escape closes it on the same piece, and focus goes back to what opened it', async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL);
    const piece = (await currentItem(page).textContent()) ?? '';
    // Behind it, the reel takes no focus and no press: inert while it is open.
    const behindInert = () =>
      currentItem(page).evaluate((el) => el.closest('[inert]') !== null);
    expect(await behindInert()).toBe(false);
    const { opener, theatre } = await openTheatre(page);
    expect(await behindInert()).toBe(true);
    // Round the bar's three controls and past either end, both ways.
    for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      await expect(theatre.locator(':focus')).toHaveCount(1);
    }
    await page.keyboard.press('Escape');
    await expect(theatre).toHaveCount(0);
    expect(await behindInert()).toBe(false);
    await expect(currentItem(page)).toHaveText(piece);
    await expect.poll(() => focusCameBack(page, opener)).toBe(true);
    await page.context().close();
  });

  test("while it plays, the reel's stage footage holds and the reel stays on its piece; closed, the footage plays again", async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL);
    // Footage needs the dev CDN and the codecs: without it the hold has
    // nothing to hold, and only the rule is checked.
    const footage = await expect
      .poll(() => stagePlaying(page), { timeout: 15_000 })
      .toBeGreaterThan(0)
      .then(
        () => true,
        () => false
      );
    if (!footage) {
      test.info().annotations.push({
        type: 'note',
        description:
          'no stage footage played before the theatre opened: the hold is NOT PROVEN here, only that nothing plays behind it',
      });
    }
    const piece = (await currentItem(page).textContent()) ?? '';
    const { theatre } = await openTheatre(page);
    await requirePlaying(theatre);

    await expect.poll(() => stagePlaying(page), { timeout: 3000 }).toBe(0);
    await page.waitForTimeout(PIECE_MS + 1500);
    await expect(currentItem(page)).toHaveText(piece);
    expect(await stagePlaying(page)).toBe(0);

    await page.keyboard.press('Escape');
    await expect(theatre).toHaveCount(0);
    if (footage) {
      await expect
        .poll(() => stagePlaying(page), { timeout: 10_000 })
        .toBeGreaterThan(0);
    }
    await page.context().close();
  });

  test('at the end of the preview the theatre closes and the reel moves on', async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL);
    const piece = (await currentItem(page).textContent()) ?? '';
    const { theatre } = await openTheatre(page);
    await requirePlaying(theatre);
    // To its last half second, rather than waiting the preview out.
    await bar(theatre)
      .media.first()
      .evaluate(
        (el: HTMLMediaElement) =>
          new Promise<void>((resolve) => {
            const seek = () => {
              el.currentTime = Math.max(0, el.duration - 0.5);
              resolve();
            };
            if (Number.isFinite(el.duration) && el.duration > 1) seek();
            else el.addEventListener('durationchange', seek, { once: true });
          })
      );
    await expect(theatre).toHaveCount(0, { timeout: 10_000 });
    await expect(currentItem(page)).not.toHaveText(piece, {
      timeout: MOVES_ON,
    });
    // Its button went with the piece: focus is on the next piece's in the
    // index, never the reel's pause (owner, Codex-1yd58.8; WP-7 review r2).
    await expect.poll(() => onIndexItem(page)).toBe(true);
    await page.context().close();
  });

  // WP-7 review r3: with Loop off the reel never moves on by itself
  // (playback.ts `static`), a preview's end included, so the piece stays and
  // focus goes back to the button that opened it. On OBB the last piece is a
  // portal, which has no preview, so this ends the film's; the wrap from the
  // last piece round to the first is Showreel.theatre.svelte.test.ts's.
  test('with Loop off, at the end of the preview the theatre closes, the piece stays, and focus goes back to its opener', async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL, { keys: { 'reel-loop': 'off' } });
    const piece = (await currentItem(page).textContent()) ?? '';
    const { opener, theatre } = await openTheatre(page);
    await requirePlaying(theatre);
    await bar(theatre)
      .media.first()
      .evaluate(
        (el: HTMLMediaElement) =>
          new Promise<void>((resolve) => {
            const seek = () => {
              el.currentTime = Math.max(0, el.duration - 0.5);
              resolve();
            };
            if (Number.isFinite(el.duration) && el.duration > 1) seek();
            else el.addEventListener('durationchange', seek, { once: true });
          })
      );
    await expect(theatre).toHaveCount(0, { timeout: 10_000 });
    await expect
      .poll(() =>
        opener
          .evaluate((el) => el === document.activeElement)
          .catch(() => false)
      )
      .toBe(true);
    // Well past the words' beat (OUT_MS) a move would take: the same piece.
    await page.waitForTimeout(1500);
    await expect(currentItem(page)).toHaveText(piece);
    await page.context().close();
  });

  test('on a phone it takes the whole screen and the page behind holds still', async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL, { context: PHONE });
    const { opener, theatre } = await openTheatre(page);
    const box = await theatre.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeLessThanOrEqual(1);
      expect(box.y).toBeLessThanOrEqual(1);
      expect(box.width).toBeGreaterThanOrEqual(389);
      expect(box.height).toBeGreaterThanOrEqual(843);
    }
    // Nothing of the page paints over its foot: the tab bar steps aside, so
    // the bar's second row is the theatre's, and Search is out of reach
    // (review M2).
    expect(
      await page.evaluate(
        () => !!document.elementFromPoint(195, 820)?.closest('[role="dialog"]')
      )
    ).toBe(true);
    await expect(
      page.getByRole('navigation', { name: 'Mobile navigation' })
    ).toBeHidden();

    // Held: the wheel moves nothing behind it.
    const top = await page.evaluate(() => window.scrollY);
    await page.mouse.move(195, 600);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.scrollY)).toBe(top);

    await bar(theatre).close.click();
    await expect(theatre).toHaveCount(0);
    await expect.poll(() => focusCameBack(page, opener)).toBe(true);
    // Let go: the same wheel scrolls now, so the hold above was the theatre's.
    await page.mouse.wheel(0, 600);
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(top);
    await page.context().close();
  });

  test('a recording shows its cover, and with no analyser its bars rest', async ({
    browser,
    baseURL,
  }) => {
    // No AudioContext, so nothing can read the sound: the theatre's state
    // with no CORS analyser, made certain.
    const page = await open(browser, baseURL, {
      init: () => {
        Object.defineProperty(window, 'AudioContext', {
          configurable: true,
          value: undefined,
        });
        Object.defineProperty(window, 'webkitAudioContext', {
          configurable: true,
          value: undefined,
        });
      },
    });
    const reel = showreel(page);
    const items = page
      .getByRole('navigation', { name: 'Showreel' })
      .getByRole('button');
    const slide = reel
      .locator('[aria-roledescription="slide"]:visible')
      .first();
    let opener: Locator | null = null;
    for (let i = 0; i < (await items.count()); i++) {
      await items.nth(i).click();
      const preview = slide.getByRole('button', { name: /preview/i });
      if (
        /recording/i.test((await slide.textContent()) ?? '') &&
        (await preview.count()) > 0
      ) {
        opener = preview.first();
        break;
      }
    }
    test.skip(
      opener === null,
      `no recording on ${ORG}'s reel offers its preview here`
    );
    if (!opener) return;
    await opener.click();
    const theatre = theatreOf(page);
    await expect(theatre).toBeVisible({ timeout: 15_000 });
    await expect(theatre.locator('img').first()).toBeVisible();
    await requirePlaying(theatre);

    const bars = () =>
      theatre.evaluate((root) => {
        const wave = [...root.querySelectorAll('[aria-hidden="true"]')].find(
          (el) =>
            el.children.length >= 8 &&
            [...el.children].every((child) => child.tagName === 'SPAN')
        );
        return wave
          ? [...wave.children].map(
              (child) =>
                Math.round(child.getBoundingClientRect().height * 10) / 10
            )
          : null;
      });
    const first = await bars();
    expect(first, 'the waveform is drawn').not.toBeNull();
    // At rest every bar has the same height, and keeps it.
    expect(new Set(first).size).toBe(1);
    await page.waitForTimeout(1500);
    expect(await bars()).toEqual(first);
    await page.context().close();
  });
});

/**
 * A film that plays where its poster is (owner P1, P3, P8, P10): a press
 * unlocks the player's `<video>` first, then asks the page for the full film
 * when the server allows one, falling back to the 30-second preview whenever
 * asking cannot give one, and asks again when the full film's links run
 * out; the canvas never plays or asks; one film at a time.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  type MockInstance,
  test,
  vi,
} from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { PreviewMedia } from '../../render/types';

const attached: string[] = [];
/** The latest stream's 403 hand-off (`onUrlExpired`), if it was given one. */
let expire: (() => void) | undefined;

vi.mock('$lib/components/VideoPlayer/hls', () => ({
  createHlsPlayer: vi.fn(
    async ({
      src,
      onUrlExpired,
    }: {
      src: string;
      onUrlExpired?: () => void;
    }) => {
      attached.push(src);
      expire = onUrlExpired;
      return { hls: null, cleanup: () => {} };
    }
  ),
}));

import { loadPlayerCore } from '$lib/components/player/load-core';
import * as m from '$paraglide/messages';
import { FILM_COPY } from './film-copy';
import Harness from './InlineFilmHarness.test.svelte';

const PREVIEW = '/m1/hls/preview/preview.m3u8';
const FULL = '/films/m1/master.m3u8?token=t';
const ALLOWED: PreviewMedia = {
  playlistUrl: PREVIEW,
  posterUrl: '/m1/poster.jpg',
  fullFilm: true,
};

let app: ReturnType<typeof mount> | null = null;
let play: MockInstance;
let pause: MockInstance;

// Fetched ahead, as the page's first sight of a play button does.
beforeAll(async () => {
  await loadPlayerCore();
});

beforeEach(() => {
  attached.length = 0;
  expire = undefined;
  play = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockResolvedValue(undefined);
  pause = vi
    .spyOn(HTMLMediaElement.prototype, 'pause')
    .mockImplementation(() => {});
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/**
 * Ten minutes on, a fresh link's life (fake timers): a 403 now is an
 * expiry. Within two minutes of the press's own ask it would be a refusal.
 */
const tenMinutesOn = () => vi.advanceTimersByTime(600_000);

function render(props: Record<string, unknown>) {
  app = mount(Harness, {
    target: document.body,
    props: { clips: [ALLOWED], ...props },
  });
  flushSync();
}

const press = (n = 1) =>
  [...document.body.querySelectorAll('button')]
    .find((button) => button.textContent?.trim() === `Watch film ${n}`)
    ?.click();

/** The film's own polite words over the frame (the core has its own region). */
const status = () => document.body.querySelector('.lp-film > [role="status"]');

/** Let the page's answer and the stream's attach settle. */
async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flushSync();
}

describe('which film a press plays (P10)', () => {
  test('the full film the page asks for, the video unlocked before the answer', async () => {
    let answer: (value: { playlistUrl: string } | null) => void = () => {};
    const requestFilm = vi.fn(
      () =>
        new Promise<{ playlistUrl: string } | null>((resolve) => {
          answer = resolve;
        })
    );
    render({ film: 'intro', requestFilm });
    press();
    expect(requestFilm).toHaveBeenCalledWith('intro');
    expect(play).toHaveBeenCalledTimes(1);
    expect(attached).toEqual([]);
    answer({ playlistUrl: FULL });
    await settle();
    expect(attached).toEqual([FULL]);
  });

  test('the page says it may not play in full: the 30-second preview, and the film says so', async () => {
    render({ film: 'reel', requestFilm: vi.fn(async () => null) });
    press();
    await settle();
    expect(attached).toEqual([PREVIEW]);
    // The line promised the full film: the frame owns up to the preview.
    expect(status()?.textContent?.trim()).toBe(FILM_COPY.fellBack);
  });

  test('asking fails: the preview, never nothing, and the film says so', async () => {
    render({
      film: 'guide',
      requestFilm: vi.fn(() => Promise.reject(new Error('503'))),
    });
    press();
    await settle();
    expect(attached).toEqual([PREVIEW]);
    expect(status()?.textContent?.trim()).toBe(FILM_COPY.fellBack);
  });

  test('the full film, or a clip that never asked, says nothing of the kind', async () => {
    render({
      clips: [ALLOWED, { playlistUrl: '/m2/preview.m3u8' }],
      film: 'intro',
      requestFilm: vi.fn(async () => ({ playlistUrl: FULL })),
    });
    press(1);
    press(2);
    await settle();
    expect(new Set(attached)).toEqual(new Set([FULL, '/m2/preview.m3u8']));
    const regions = document.body.querySelectorAll(
      '.lp-film > [role="status"]'
    );
    expect(regions).toHaveLength(2);
    for (const region of regions) expect(region.textContent?.trim()).toBe('');
  });

  test('the full film runs out (a 403): the page is asked once more, and the film carries on', async () => {
    vi.useFakeTimers();
    const requestFilm = vi
      .fn<() => Promise<{ playlistUrl: string } | null>>()
      .mockResolvedValueOnce({ playlistUrl: FULL })
      .mockResolvedValueOnce({ playlistUrl: `${FULL}2` });
    render({ film: 'intro', requestFilm });
    press();
    await settle();
    const video = document.body.querySelector('video');
    if (!video) throw new Error('no player');
    // It plays, ten minutes in: its links were good.
    video.dispatchEvent(new Event('loadeddata'));
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      writable: true,
      value: 612,
    });
    video.dispatchEvent(new Event('timeupdate'));

    tenMinutesOn();
    expire?.();
    await settle();
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(requestFilm).toHaveBeenCalledTimes(2);
    expect(requestFilm).toHaveBeenLastCalledWith('intro');
    expect(attached).toEqual([FULL, `${FULL}2`]);
    expect(video.currentTime).toBe(612);
  });

  // A lapse is no end (the core's `onended` with `lapsed`): the poster
  // returns saying why, never "Watch again", and a press asks afresh.
  test('the full film runs out and the page will not renew it: the poster says so, never the preview', async () => {
    vi.useFakeTimers();
    const requestFilm = vi
      .fn<() => Promise<{ playlistUrl: string } | null>>()
      .mockResolvedValueOnce({ playlistUrl: FULL })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ playlistUrl: `${FULL}2` });
    render({ film: 'intro', requestFilm });
    press();
    await settle();
    document.body
      .querySelector('video')
      ?.dispatchEvent(new Event('loadeddata'));

    tenMinutesOn();
    expire?.();
    await settle();
    expect(requestFilm).toHaveBeenCalledTimes(2);
    expect(attached).toEqual([FULL]);
    expect(document.body.querySelector('video')).toBeNull();
    const labels = [...document.body.querySelectorAll('button')].map((button) =>
      button.textContent?.trim()
    );
    expect(labels).not.toContain(FILM_COPY.again);
    expect(labels).toContain('Watch film 1');
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      FILM_COPY.lapsed
    );

    press();
    await settle();
    expect(requestFilm).toHaveBeenCalledTimes(3);
    expect(attached).toEqual([FULL, `${FULL}2`]);
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
  });

  test('the film cannot play: the poster returns, saying why, and a press tries again', async () => {
    const requestFilm = vi.fn(async () => ({ playlistUrl: FULL }));
    render({ film: 'intro', requestFilm });
    press();
    await settle();

    // Refused before its first frame: it could not play.
    expire?.();
    await settle();
    expect(document.body.querySelector('video')).toBeNull();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      m.player_error()
    );

    press();
    await settle();
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
    expect(document.body.querySelectorAll('.lp-film video')).toHaveLength(1);
    expect(requestFilm).toHaveBeenCalledTimes(2);
  });

  test('a clip the server did not mark never asks', () => {
    const requestFilm = vi.fn(async () => ({ playlistUrl: FULL }));
    render({
      clips: [{ playlistUrl: PREVIEW }],
      film: 'intro',
      requestFilm,
    });
    press();
    expect(requestFilm).not.toHaveBeenCalled();
    expect(attached).toEqual([PREVIEW]);
  });
});

describe('the canvas (P8)', () => {
  test('draws the poster and the button, and never plays or asks', () => {
    const requestFilm = vi.fn(async () => ({ playlistUrl: FULL }));
    render({ film: 'intro', requestFilm, edit: { commit: () => {} } });
    press();
    flushSync();
    expect(document.body.querySelector('img')?.getAttribute('src')).toBe(
      ALLOWED.posterUrl
    );
    expect(document.body.querySelector('video')).toBeNull();
    expect(requestFilm).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(attached).toEqual([]);
  });
});

describe('one film at a time (P3)', () => {
  test('starting the second film pauses the first, which stays in its frame', () => {
    render({
      clips: [ALLOWED, { ...ALLOWED, playlistUrl: '/m2/preview.m3u8' }],
    });
    press(1);
    const [first] = document.body.querySelectorAll('.lp-film video');
    first.dispatchEvent(new Event('play'));
    press(2);
    const films = document.body.querySelectorAll('.lp-film video');
    expect(films).toHaveLength(2);
    films[1].dispatchEvent(new Event('play'));
    expect(pause.mock.contexts).toEqual([first]);
  });
});

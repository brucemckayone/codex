/**
 * The player core (owner P1, P3, P7, P11): it starts with sound from a press,
 * plays muted and asks for sound when the browser refuses, keeps one film
 * playing at a time and pauses out of view, shows the stream's own time,
 * draws a captions button only for a film with caption tracks, and renews a
 * full film's signed stream as its links run out.
 *
 * jsdom has no media pipeline: `play` and `pause` are spied, and the
 * element's events and figures are set by hand.
 */
import { type ComponentProps, createRawSnippet } from 'svelte';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type MockInstance,
  test,
  vi,
} from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const attached: string[] = [];
/** The latest stream's 403 hand-off (`onUrlExpired`), if it was given one. */
let expire: (() => void) | undefined;
/** The latest stream's fatal error report (`onError`), in the helper's words. */
let broke: ((message: string) => void) | undefined;

vi.mock('$lib/components/VideoPlayer/hls', () => ({
  createHlsPlayer: vi.fn(
    async ({
      src,
      onError,
      onUrlExpired,
    }: {
      src: string;
      onError?: (message: string) => void;
      onUrlExpired?: () => void;
    }) => {
      attached.push(src);
      expire = onUrlExpired;
      broke = onError;
      return { hls: null, cleanup: () => {} };
    }
  ),
}));

import { filmInView } from './now-playing.svelte';
import PreviewPlayerCore from './PreviewPlayerCore.svelte';

const SRC = '/films/f1/preview/preview.m3u8';
const ENGLISH = { src: '/films/f1/en.vtt', srclang: 'en', label: 'English' };

let apps: ReturnType<typeof mount>[] = [];
let play: MockInstance;
let pause: MockInstance;

beforeEach(() => {
  attached.length = 0;
  expire = undefined;
  broke = undefined;
  play = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockResolvedValue(undefined);
  pause = vi
    .spyOn(HTMLMediaElement.prototype, 'pause')
    .mockImplementation(() => {});
});

afterEach(() => {
  for (const app of apps) unmount(app);
  apps = [];
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function film(props: Partial<ComponentProps<typeof PreviewPlayerCore>> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  apps.push(
    mount(PreviewPlayerCore, {
      target,
      props: { src: SRC, title: 'Slow Mornings', ...props },
    })
  );
  flushSync();
  const video = target.querySelector('video');
  if (!video) throw new Error('no video drawn');
  return { root: target, video };
}

const button = (root: HTMLElement, label: string) =>
  root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

/** Let the press's play() and the stream's attach settle. */
async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flushSync();
}

describe('captions (P11)', () => {
  test('no CC button for a film with no caption tracks', () => {
    const { root, video } = film();
    expect(button(root, m.player_captions())).toBeNull();
    expect(video.querySelector('track')).toBeNull();
  });

  test('a CC button, and the track, for a film that has one', () => {
    const { root, video } = film({ captions: [ENGLISH] });
    expect(button(root, m.player_captions())).not.toBeNull();
    expect(video.querySelector('track')?.getAttribute('srclang')).toBe('en');
  });
});

describe('sound from the press (P7)', () => {
  test('play() runs unmuted as it mounts, before the stream it awaits is attached', async () => {
    let answer: (url: string) => void = () => {};
    const src = new Promise<string>((resolve) => {
      answer = resolve;
    });
    const { video } = film({ src, start: 'sound' });
    expect(play).toHaveBeenCalledTimes(1);
    expect(video.muted).toBe(false);
    expect(attached).toEqual([]);
    answer('/films/f1/full.m3u8');
    await settle();
    expect(attached).toEqual(['/films/f1/full.m3u8']);
  });

  test('refused sound: it plays muted, and the mute button reads "Tap for sound"', async () => {
    play.mockRejectedValueOnce(new DOMException('No sound', 'NotAllowedError'));
    const { root, video } = film({ start: 'sound' });
    await vi.waitFor(() =>
      expect(button(root, m.player_tap_for_sound())).not.toBeNull()
    );
    expect(video.muted).toBe(true);
    expect(play).toHaveBeenCalledTimes(2);
    expect(button(root, m.player_tap_for_sound())?.textContent).toContain(
      m.player_tap_for_sound()
    );
    // One tap and it is a plain mute button again.
    button(root, m.player_tap_for_sound())?.click();
    video.dispatchEvent(new Event('volumechange'));
    flushSync();
    expect(video.muted).toBe(false);
    expect(button(root, m.player_tap_for_sound())).toBeNull();
    expect(button(root, m.player_mute())).not.toBeNull();
  });

  test('a paused player waits for its play button', () => {
    film({ start: 'paused' });
    expect(play).not.toHaveBeenCalled();
  });
});

describe('one film at a time (P3)', () => {
  test('starting one pauses the one that was playing', () => {
    const first = film();
    const second = film();
    first.video.dispatchEvent(new Event('play'));
    expect(pause).not.toHaveBeenCalled();
    second.video.dispatchEvent(new Event('play'));
    expect(pause.mock.contexts).toEqual([first.video]);
  });

  test('scrolled out of view, a playing film pauses; on screen, the page knows', () => {
    const observers: {
      callback: IntersectionObserverCallback;
      target?: Element;
    }[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        readonly entry: (typeof observers)[number];
        constructor(callback: IntersectionObserverCallback) {
          this.entry = { callback };
          observers.push(this.entry);
        }
        observe(target: Element) {
          this.entry.target = target;
        }
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
      }
    );
    const { video } = film();
    Object.defineProperty(video, 'paused', {
      configurable: true,
      get: () => false,
    });
    const [watcher] = observers;
    const report = (isIntersecting: boolean) =>
      watcher.callback(
        [
          {
            isIntersecting,
            target: watcher.target,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver
      );
    report(true);
    expect(filmInView()).toBe(true);
    expect(pause).not.toHaveBeenCalled();
    report(false);
    expect(filmInView()).toBe(false);
    expect(pause.mock.contexts).toEqual([video]);
  });
});

describe('the time (the stream’s, never the source’s)', () => {
  test('elapsed and total as the stream reports them, and the scrubber says so', () => {
    const { root, video } = film();
    const time = () =>
      root
        .querySelector('.player__time')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim();
    expect(time()).toBe('0:00');
    Object.defineProperty(video, 'duration', {
      configurable: true,
      get: () => 124,
    });
    video.dispatchEvent(new Event('durationchange'));
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => 12,
    });
    video.dispatchEvent(new Event('timeupdate'));
    flushSync();
    expect(time()).toBe('0:12 / 2:04');
    expect(
      root.querySelector('input[type="range"]')?.getAttribute('aria-valuetext')
    ).toBe(m.player_time({ time: '0:12', duration: '2:04' }));
  });

  test('a preview limit counts as the end', () => {
    const onended = vi.fn();
    const { video } = film({ limit: 30, onended });
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => 30.2,
    });
    video.dispatchEvent(new Event('timeupdate'));
    expect(pause).toHaveBeenCalled();
    expect(onended).toHaveBeenCalledTimes(1);
  });
});

describe('keyboard', () => {
  test('M mutes from anywhere inside the player', () => {
    const { root, video } = film();
    const toggle = button(root, m.player_play());
    toggle?.focus();
    toggle?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'm', bubbles: true })
    );
    expect(video.muted).toBe(true);
  });

  test('K plays from anywhere inside; a focused button keeps its own Space', () => {
    const { root } = film();
    const toggle = button(root, m.player_play());
    toggle?.focus();
    toggle?.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true })
    );
    expect(play).not.toHaveBeenCalled();
    toggle?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', bubbles: true })
    );
    expect(play).toHaveBeenCalledTimes(1);
  });
});

// The brand studio's Player lens draws this very chrome at a fixed moment,
// so it cannot drift from what a visitor sees (Codex-cijzb.17).
describe('demo', () => {
  const MOMENT = { time: 12, duration: 124, loaded: 46, askSound: true };

  test('draws its moment: playing, the time, the loaded and played bands, "Tap for sound", full screen', () => {
    const { root } = film({ src: '', demo: MOMENT });
    expect(
      root
        .querySelector('.player__time')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim()
    ).toBe('0:12 / 2:04');
    expect(button(root, m.player_pause())).not.toBeNull();
    expect(button(root, m.player_tap_for_sound())?.textContent).toContain(
      m.player_tap_for_sound()
    );
    expect(button(root, m.player_fullscreen())).not.toBeNull();
    expect(button(root, m.player_captions())).toBeNull();
    const band = (name: string) =>
      root
        .querySelector<HTMLElement>(`.player__${name}`)
        ?.style.getPropertyValue('--_to');
    expect(Number(band('played'))).toBeCloseTo(12 / 124);
    expect(Number(band('loaded'))).toBeCloseTo(46 / 124);
  });

  test('attaches no stream, plays nothing, and answers no press or key', async () => {
    const { root, video } = film({ src: '', demo: MOMENT });
    button(root, m.player_pause())?.click();
    button(root, m.player_tap_for_sound())?.click();
    root.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', bubbles: true })
    );
    await settle();
    expect(attached).toEqual([]);
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(video.muted).toBe(false);
    expect(button(root, m.player_tap_for_sound())).not.toBeNull();
    expect(filmInView()).toBe(false);
  });
});

// A full film's signed links run out in about ten minutes (RENEWAL).
describe('renewal', () => {
  const FULL = '/films/f1/master.m3u8?token=one';
  const RENEWED = '/films/f1/master.m3u8?token=two';
  const signed = (expiresAt?: string) =>
    Promise.resolve({ playlistUrl: FULL, expiresAt });

  /** A playhead jsdom lacks, read and written as a browser's is. */
  function playhead(video: HTMLVideoElement, at: number) {
    let now = at;
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => now,
      set: (to: number) => {
        now = to;
      },
    });
    video.dispatchEvent(new Event('timeupdate'));
    // What the helper's teardown does before it hands off a 403: the
    // element, detached, is back at 0.
    return () => {
      now = 0;
    };
  }

  /** What a browser's element does as it plays or pauses; jsdom's never does. */
  function state(video: HTMLVideoElement, playing: boolean) {
    Object.defineProperty(video, 'paused', {
      configurable: true,
      get: () => !playing,
    });
    video.dispatchEvent(new Event(playing ? 'play' : 'pause'));
  }

  /** The attached stream's first frame: its links have proved good. */
  const loads = (video: HTMLVideoElement) =>
    video.dispatchEvent(new Event('loadeddata'));

  const inTen = () => new Date(Date.now() + 600_000).toISOString();

  const errorText = (root: HTMLElement) =>
    root.querySelector('.player__error')?.textContent;

  // "Watch again", as the theatre draws it.
  const again = createRawSnippet((replay: () => () => void) => ({
    render: () => '<button type="button" class="again">Watch again</button>',
    setup: (node: Element) => {
      node.addEventListener('click', () => replay()());
    },
  }));

  test('a 403 asks again once, swaps the stream, and carries on from the same moment, playing', async () => {
    const renew = vi.fn(async () => ({ playlistUrl: RENEWED }));
    const { video } = film({ src: signed(), renew, start: 'sound' });
    await settle();
    expect(attached).toEqual([FULL]);
    loads(video);
    const detach = playhead(video, 200);
    play.mockClear();

    detach();
    expire?.();
    await settle();
    expect(renew).toHaveBeenCalledTimes(1);
    expect(attached).toEqual([FULL, RENEWED]);
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBe(200);
    expect(play).toHaveBeenCalledTimes(1);
  });

  test('a paused film stays paused at its moment', async () => {
    const renew = vi.fn(async () => ({ playlistUrl: RENEWED }));
    const { video } = film({ src: signed(), renew });
    await settle();
    loads(video);
    const detach = playhead(video, 75);

    detach();
    expire?.();
    await settle();
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(attached).toEqual([FULL, RENEWED]);
    expect(video.currentTime).toBe(75);
    expect(play).not.toHaveBeenCalled();
  });

  test.each([
    ['answers null', () => Promise.resolve(null)],
    ['fails', () => Promise.reject(new Error('503'))],
  ])('the renewal %s: the film ends where it stands, never on the preview', async (_label, answer) => {
    const renew = vi.fn(answer);
    const onended = vi.fn();
    const { root, video } = film({
      src: signed(),
      renew,
      start: 'sound',
      onended,
      ended: again,
    });
    await settle();
    loads(video);

    expire?.();
    await settle();
    expect(renew).toHaveBeenCalledTimes(1);
    expect(onended).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalled();
    expect(root.querySelector('.again')).not.toBeNull();
    expect(attached).toEqual([FULL]);
  });

  test('"Watch again" after the links ran out asks afresh, from the start', async () => {
    const renew = vi
      .fn<() => Promise<{ playlistUrl: string } | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ playlistUrl: RENEWED });
    const { root, video } = film({
      src: signed(),
      renew,
      start: 'sound',
      ended: again,
    });
    await settle();
    loads(video);
    playhead(video, 200);
    expire?.();
    await settle();
    play.mockClear();

    root.querySelector<HTMLButtonElement>('.again')?.click();
    await settle();
    expect(renew).toHaveBeenCalledTimes(2);
    expect(attached).toEqual([FULL, RENEWED]);
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBe(0);
    expect(play).toHaveBeenCalled();
  });

  test('once per expiry: shortly before it, a one-shot timer asks; if that fails, the 403 ends the film', async () => {
    vi.useFakeTimers();
    const renew = vi.fn(async () => null);
    const onended = vi.fn();
    const { video } = film({
      src: signed(inTen()),
      renew,
      start: 'sound',
      onended,
    });
    await settle();
    loads(video);
    state(video, true);

    vi.advanceTimersByTime(600_000 - 30_000 - 1);
    expect(renew).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await settle();
    expect(renew).toHaveBeenCalledTimes(1);
    // It plays on: the links still hold until they run out.
    expect(onended).not.toHaveBeenCalled();

    expire?.();
    await settle();
    expect(renew).toHaveBeenCalledTimes(1);
    expect(onended).toHaveBeenCalledTimes(1);
    expect(attached).toEqual([FULL]);
  });

  test('a renewed stream runs out in its own time: its expiry gets its own one ask', async () => {
    vi.useFakeTimers();
    const later = new Date(Date.now() + 1_200_000).toISOString();
    const renew = vi.fn(async () => ({
      playlistUrl: RENEWED,
      expiresAt: later,
    }));
    const { video } = film({ src: signed(inTen()), renew, start: 'sound' });
    await settle();
    loads(video);
    state(video, true);
    playhead(video, 300);

    vi.advanceTimersByTime(570_000);
    await settle();
    expect(attached).toEqual([FULL, RENEWED]);
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBe(300);
    loads(video);

    vi.advanceTimersByTime(600_000);
    await settle();
    expect(renew).toHaveBeenCalledTimes(2);
  });

  test('a preview is public: never renewed, nor is a full film with no way to ask', async () => {
    const renew = vi.fn(async () => ({ playlistUrl: RENEWED }));
    film({ src: SRC, renew });
    await settle();
    expect(expire).toBeUndefined();
    film({ src: signed() });
    await settle();
    expect(expire).toBeUndefined();
  });

  test('gone before the timer: the timer goes with it, and it never asks', async () => {
    vi.useFakeTimers();
    const renew = vi.fn(async () => ({ playlistUrl: RENEWED }));
    const { video } = film({ src: signed(inTen()), renew, start: 'sound' });
    await settle();
    loads(video);
    state(video, true);
    expect(vi.getTimerCount()).toBe(1);
    for (const app of apps) unmount(app);
    apps = [];
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(600_000);
    expect(renew).not.toHaveBeenCalled();
  });

  // Only while it plays: a paused or forgotten tab never calls the minter,
  // and each call wakes the database (the owner's cost rule).
  describe('only while it plays', () => {
    /** Each answer good for another ten minutes from when it is asked. */
    const fresh = () =>
      vi.fn(async () => ({ playlistUrl: RENEWED, expiresAt: inTen() }));

    test('paused before the timer would fire: no renewal', async () => {
      vi.useFakeTimers();
      const renew = fresh();
      const { root, video } = film({
        src: signed(inTen()),
        renew,
        start: 'sound',
      });
      await settle();
      loads(video);
      state(video, true);
      vi.advanceTimersByTime(500_000);

      button(root, m.player_pause())?.click();
      state(video, false);
      vi.advanceTimersByTime(100_000);
      await settle();
      expect(renew).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    test('left paused for three lifetimes of its links: not one call', async () => {
      vi.useFakeTimers();
      const renew = fresh();
      const { root, video } = film({
        src: signed(inTen()),
        renew,
        start: 'sound',
      });
      await settle();
      loads(video);
      state(video, true);
      button(root, m.player_pause())?.click();
      state(video, false);

      for (let lifetime = 0; lifetime < 3; lifetime++) {
        vi.advanceTimersByTime(600_000);
        await settle();
      }
      expect(renew).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    test('a 403 while paused (HLS.js buffers ahead) renews once, and the new stream arms nothing', async () => {
      vi.useFakeTimers();
      const renew = fresh();
      const { root, video } = film({
        src: signed(inTen()),
        renew,
        start: 'sound',
      });
      await settle();
      loads(video);
      state(video, true);
      button(root, m.player_pause())?.click();
      state(video, false);

      expire?.();
      await settle();
      expect(attached).toEqual([FULL, RENEWED]);
      // The new stream loads while the film stays paused.
      loads(video);
      expect(vi.getTimerCount()).toBe(0);
      for (let lifetime = 0; lifetime < 3; lifetime++) {
        vi.advanceTimersByTime(600_000);
        await settle();
      }
      expect(renew).toHaveBeenCalledTimes(1);
    });

    test('resumed after its links ran out: renews once, then plays from where it was', async () => {
      vi.useFakeTimers();
      const renew = fresh();
      const { root, video } = film({
        src: signed(inTen()),
        renew,
        start: 'sound',
      });
      await settle();
      loads(video);
      state(video, true);
      playhead(video, 300);
      button(root, m.player_pause())?.click();
      state(video, false);
      vi.advanceTimersByTime(700_000);
      play.mockClear();

      button(root, m.player_play())?.click();
      await settle();
      expect(renew).toHaveBeenCalledTimes(1);
      expect(attached).toEqual([FULL, RENEWED]);
      // Not on the dead links: it plays once the new stream knows its length.
      expect(play).not.toHaveBeenCalled();
      video.dispatchEvent(new Event('loadedmetadata'));
      expect(video.currentTime).toBe(300);
      expect(play).toHaveBeenCalledTimes(1);
      loads(video);
      state(video, true);
      expect(renew).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);
    });

    test('resumed before the lead: no call, the timer re-armed for the time left', async () => {
      vi.useFakeTimers();
      const renew = fresh();
      const { root, video } = film({
        src: signed(inTen()),
        renew,
        start: 'sound',
      });
      await settle();
      loads(video);
      state(video, true);
      vi.advanceTimersByTime(100_000);
      button(root, m.player_pause())?.click();
      state(video, false);
      vi.advanceTimersByTime(200_000);

      button(root, m.player_play())?.click();
      state(video, true);
      expect(renew).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(270_000 - 1);
      expect(renew).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      await settle();
      expect(renew).toHaveBeenCalledTimes(1);
    });
  });

  // Bounded per playback: a 403 before the stream's first frame is a
  // refusal (a variant it will not serve, a token it will not take), and
  // asking again would loop — ask, attach, 403 — with the film stuck loading.
  describe('a refusal is not an expiry', () => {
    test('a 403 on the first load: no ask, and the film says it could not play', async () => {
      const renew = vi.fn(async () => ({ playlistUrl: RENEWED }));
      const { root } = film({ src: signed(), renew, start: 'sound' });
      await settle();

      expire?.();
      await settle();
      expect(renew).not.toHaveBeenCalled();
      expect(attached).toEqual([FULL]);
      expect(errorText(root)).toBe(m.player_error());
    });

    test('a renewed stream that 403s before its first frame: no second ask, an error, and no resume left to fire', async () => {
      const renew = vi.fn(async () => ({ playlistUrl: RENEWED }));
      const { root, video } = film({ src: signed(), renew, start: 'sound' });
      await settle();
      loads(video);
      playhead(video, 200);
      expire?.();
      await settle();
      expect(attached).toEqual([FULL, RENEWED]);

      expire?.();
      await settle();
      expect(renew).toHaveBeenCalledTimes(1);
      expect(attached).toEqual([FULL, RENEWED]);
      expect(errorText(root)).toBe(m.player_error());
      // The refused stream's resume went with it.
      play.mockClear();
      video.dispatchEvent(new Event('loadedmetadata'));
      expect(play).not.toHaveBeenCalled();
      expect(video.currentTime).toBe(200);
    });

    test('a stream stuck loading never asks, however long it is left', async () => {
      vi.useFakeTimers();
      const renew = vi.fn(async () => ({
        playlistUrl: RENEWED,
        expiresAt: inTen(),
      }));
      const { video } = film({ src: signed(inTen()), renew, start: 'sound' });
      await settle();
      state(video, true);

      for (let lifetime = 0; lifetime < 3; lifetime++) {
        vi.advanceTimersByTime(600_000);
        await settle();
      }
      expect(renew).not.toHaveBeenCalled();
    });
  });

  describe('an error stops it', () => {
    test('after a fatal error nothing renews: not the timer, not a later 403', async () => {
      vi.useFakeTimers();
      const renew = vi.fn(async () => ({ playlistUrl: RENEWED }));
      const { root, video } = film({
        src: signed(inTen()),
        renew,
        start: 'sound',
      });
      await settle();
      loads(video);
      state(video, true);
      expect(vi.getTimerCount()).toBe(1);

      broke?.('An unexpected playback error occurred.');
      flushSync();
      expect(errorText(root)).toBe(m.player_error());
      expect(vi.getTimerCount()).toBe(0);
      expire?.();
      vi.advanceTimersByTime(600_000);
      await settle();
      expect(renew).not.toHaveBeenCalled();
    });

    test.each([
      ['This browser cannot play this video format.', m.player_error_format()],
      [
        'Playback error. The video format may not be supported.',
        m.player_error_format(),
      ],
      ['An unexpected playback error occurred.', m.player_error()],
      ['Playback error. Please try again.', m.player_error()],
    ])('the helper says "%s": the film says so in its own words', async (cause, said) => {
      const { root } = film();
      await settle();
      broke?.(cause);
      flushSync();
      expect(errorText(root)).toBe(said);
    });
  });
});

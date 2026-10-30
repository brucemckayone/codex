/**
 * The listening card on a page that can ask for the full recording
 * (Codex-61zsk.73): what its button says, what it shows while the stream
 * loads or stalls, a full recording whose links run out mid-play (no end),
 * and a press that asked for the full recording and got the preview.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import { loadPlayerCore } from '$lib/components/player/load-core';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { PreviewMedia } from '../../../render/types';
import { PREVIEW_COPY } from './copy';
import Harness from './ListenCardHarness.test.svelte';

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

const PREVIEW = '/media/reel-audio/preview.m3u8';
const FULL = '/films/reel-audio/master.m3u8?token=t';
const AUDIO: PreviewMedia = {
  playlistUrl: PREVIEW,
  posterUrl: null,
  mediaType: 'audio',
  durationSeconds: 300,
  previewSeconds: 30,
  fullFilm: true,
};

let app: ReturnType<typeof mount> | null = null;

beforeAll(async () => {
  await loadPlayerCore();
});

beforeEach(() => {
  attached.length = 0;
  expire = undefined;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function render(props: Record<string, unknown>) {
  app = mount(Harness, {
    target: document.body,
    props: { clip: AUDIO, full: true, seconds: 300, ...props },
  });
  flushSync();
}

const button = () =>
  document.body.querySelector<HTMLButtonElement>('.listen__play');
const label = () => button()?.getAttribute('aria-label');
const time = () => document.body.querySelector('.listen__time')?.textContent;
const audio = () => document.body.querySelector('video');
const note = () => document.body.querySelector('.listen__note')?.textContent;
/** The card's own polite live region (the hidden core has its own). */
const status = () =>
  document.body.querySelector('.listen__text [role="status"]');

/** Let the page's answer and the stream's attach settle. */
async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flushSync();
}

function press() {
  button()?.click();
  flushSync();
}

/** The stream's first sound: it has loaded and plays. */
function sounds(element: HTMLVideoElement, seconds = 6) {
  Object.defineProperty(element, 'currentTime', {
    configurable: true,
    writable: true,
    value: seconds,
  });
  for (const name of ['loadeddata', 'timeupdate', 'play', 'playing'])
    element.dispatchEvent(new Event(name));
  flushSync();
}

describe('what its button says (Codex-61zsk.73)', () => {
  test('a clip that plays in full is "Play", never "the preview"; paused partway, "Resume"', async () => {
    render({ requestFilm: vi.fn(async () => ({ playlistUrl: FULL })) });
    expect(label()).toBe(PREVIEW_COPY.play);
    press();
    await settle();
    const element = audio();
    if (!element) throw new Error('no player');
    sounds(element);
    expect(label()).toBe(PREVIEW_COPY.pause);
    element.dispatchEvent(new Event('pause'));
    flushSync();
    expect(label()).toBe(PREVIEW_COPY.resume);
  });

  test('a clip that plays its preview says so', () => {
    render({ full: false, seconds: 30 });
    expect(label()).toBe(PREVIEW_COPY.watch);
  });
});

describe('while it loads or stalls, the card says so', () => {
  test('busy from the press to the first sound, and again through a stall', async () => {
    let answer: (value: { playlistUrl: string }) => void = () => {};
    render({
      requestFilm: vi.fn(
        () =>
          new Promise<{ playlistUrl: string }>((resolve) => {
            answer = resolve;
          })
      ),
    });
    expect(button()?.getAttribute('aria-busy')).toBe('false');
    expect(status()?.textContent?.trim()).toBe('');

    // Pressed: the page is still asking, nothing has sounded.
    press();
    expect(button()?.getAttribute('aria-busy')).toBe('true');
    expect(time()).toBe(PREVIEW_COPY.loading);
    expect(status()?.getAttribute('aria-busy')).toBe('true');
    expect(status()?.textContent).toContain(PREVIEW_COPY.loading);

    answer({ playlistUrl: FULL });
    await settle();
    const element = audio();
    if (!element) throw new Error('no player');
    sounds(element);
    expect(button()?.getAttribute('aria-busy')).toBe('false');
    expect(time()).toBe('0:06 / 5:00');
    expect(status()?.textContent?.trim()).toBe('');

    // It stalls while it should play, then plays on.
    element.dispatchEvent(new Event('waiting'));
    flushSync();
    expect(button()?.getAttribute('aria-busy')).toBe('true');
    expect(time()).toBe(PREVIEW_COPY.loading);
    element.dispatchEvent(new Event('playing'));
    flushSync();
    expect(time()).toBe('0:06 / 5:00');
  });
});

describe('a full recording whose links run out mid-play has not ended', () => {
  test('the card says so, never "Play again", and a press asks afresh', async () => {
    vi.useFakeTimers();
    const requestFilm = vi
      .fn<() => Promise<{ playlistUrl: string } | null>>()
      .mockResolvedValueOnce({ playlistUrl: FULL })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ playlistUrl: `${FULL}2` });
    render({ requestFilm });
    press();
    await settle();
    const element = audio();
    if (!element) throw new Error('no player');
    sounds(element, 240);

    // Ten minutes on its links run out, and the page will not renew them.
    vi.advanceTimersByTime(600_000);
    expire?.();
    await settle();
    expect(requestFilm).toHaveBeenCalledTimes(2);
    expect(label()).not.toBe(PREVIEW_COPY.again);
    expect(label()).toBe(PREVIEW_COPY.play);
    expect(note()).toBe(PREVIEW_COPY.lapsed);
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      PREVIEW_COPY.lapsed
    );
    expect(audio()).toBeNull();

    press();
    await settle();
    expect(requestFilm).toHaveBeenCalledTimes(3);
    expect(attached).toEqual([FULL, `${FULL}2`]);
    expect(note()).toBeUndefined();
  });
});

describe('a press that asked for the full recording and got the preview', () => {
  test.each([
    ['refuses', () => Promise.resolve(null)],
    ['fails', () => Promise.reject(new Error('503'))],
  ])('when the page %s, the card says the preview plays', async (_, answer) => {
    render({ requestFilm: vi.fn(answer) });
    press();
    await settle();
    expect(attached).toEqual([PREVIEW]);
    expect(status()?.textContent).toContain(PREVIEW_COPY.fellBack);
  });

  test('the full recording says nothing of the kind', async () => {
    render({ requestFilm: vi.fn(async () => ({ playlistUrl: FULL })) });
    press();
    await settle();
    expect(attached).toEqual([FULL]);
    expect(status()?.textContent).not.toContain(PREVIEW_COPY.fellBack);
  });
});

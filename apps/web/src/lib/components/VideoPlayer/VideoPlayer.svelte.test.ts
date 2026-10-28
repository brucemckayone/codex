import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { refreshStreamingUrl } from '$lib/remote/library.remote';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import VideoPlayer from './VideoPlayer.svelte';

/**
 * `VideoPlayer` source-swap tests (Codex-1g5lh.12).
 *
 * `VideoPlayer` already reacted to `src` changes, but it treated EVERY change
 * the same way — `hlsInstance.loadSource(newUrl)` under a still-playing
 * element. That is right for one case and wrong for the other:
 *
 *   • same item, freshly signed URL (follow / subscribe unlock) → swapping
 *     under the playhead is exactly what you want;
 *   • DIFFERENT item (in-course navigation between two course sessions on the
 *     same component instance) → the outgoing video must STOP. Instead it
 *     rolled straight on into the next lesson with no gesture, and the
 *     progress tracker — which reads the LIVE `contentId` — kept writing the
 *     old playhead against the new item's id.
 *
 * `contentId` is the discriminator, so these tests drive both.
 *
 * jsdom has no media pipeline (`play`/`pause`/`load` are inert stubs and
 * nothing decodes), so "the old video goes silent" is verified as the
 * mechanism that causes it — `pause()` called, `src` gone from the element
 * before the new player is built, `load()` called, HLS.js destroyed — not as
 * measured silence.
 */

type HlsMode = 'native' | 'mse';
let hlsMode: HlsMode = 'native';

interface RecordedCall {
  src: string;
  srcAttrAtCall: string | null;
  pauseCountAtCall: number;
  /** What `hls.ts` calls when the stream fails for good, or expires. */
  onError?: (message: string, kind: string, at: number) => void;
  onUrlExpired?: (at: number) => void;
}
let recorded: RecordedCall[] = [];
const destroyedInstances: string[] = [];
const loadSourceCalls: string[] = [];

const pauseSpy = vi.fn();
const loadSpy = vi.fn();

vi.mock('./hls', () => ({
  createHlsPlayer: vi.fn(
    async ({
      media,
      src,
      onError,
      onUrlExpired,
    }: Pick<RecordedCall, 'onError' | 'onUrlExpired'> & {
      media: HTMLMediaElement;
      src: string;
    }) => {
      recorded.push({
        src,
        srcAttrAtCall: media.getAttribute('src'),
        pauseCountAtCall: pauseSpy.mock.calls.length,
        onError,
        onUrlExpired,
      });
      if (hlsMode === 'native') {
        media.setAttribute('src', src);
        return { hls: null, cleanup: vi.fn() };
      }
      const hls = {
        destroy: vi.fn(() => destroyedInstances.push(src)),
        loadSource: vi.fn((next: string) => loadSourceCalls.push(next)),
        levels: [],
        on: vi.fn(),
        get nextLevel() {
          return -1;
        },
        set nextLevel(_v: number) {},
      };
      return { hls, cleanup: vi.fn() };
    }
  ),
}));

// media-chrome registers a tree of custom elements on import; the player only
// needs the import to resolve, and jsdom renders unknown tags fine without it.
vi.mock('media-chrome', () => ({}));

vi.mock('$lib/remote/library.remote', () => ({
  refreshStreamingUrl: vi.fn(async () => ({
    streamingUrl: 'https://cdn.test/refreshed/index.m3u8',
    waveformUrl: null,
  })),
}));

const updateLocalProgress = vi.fn();
vi.mock('$lib/collections/progress', () => ({
  updateLocalProgress: (...args: unknown[]) => updateLocalProgress(...args),
}));

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const SRC_A = 'https://cdn.test/lesson-a/index.m3u8';
const SRC_B = 'https://cdn.test/lesson-b/index.m3u8';

interface PlayerProps {
  src: string;
  contentId: string;
  contentTitle: string;
  initialProgress: number;
}

function videoElement(): HTMLVideoElement {
  const el = document.body.querySelector('video');
  if (!el) throw new Error('no <video> element rendered');
  return el as HTMLVideoElement;
}

async function mountPlayer() {
  const props = $state<PlayerProps>({
    src: SRC_A,
    contentId: 'lesson-a',
    contentTitle: 'Lesson one',
    initialProgress: 0,
  });
  const component = mount(VideoPlayer, { target: document.body, props });
  flushSync();
  await vi.waitFor(() => expect(recorded).toHaveLength(1));
  return { component, props };
}

beforeEach(() => {
  hlsMode = 'native';
  recorded = [];
  destroyedInstances.length = 0;
  loadSourceCalls.length = 0;
  pauseSpy.mockClear();
  loadSpy.mockClear();
  updateLocalProgress.mockClear();

  vi.stubGlobal('ResizeObserver', NoopObserver);
  vi.stubGlobal('IntersectionObserver', NoopObserver);

  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {
    pauseSpy();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {
    loadSpy();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(
    async () => undefined
  );
});

describe('VideoPlayer — moving between course items', () => {
  test('hard-stops the outgoing lesson and rebuilds for the new one', async () => {
    hlsMode = 'mse';
    const { component, props } = await mountPlayer();

    props.src = SRC_B;
    props.contentId = 'lesson-b';
    flushSync();
    await vi.waitFor(() => expect(recorded).toHaveLength(2));

    // A different item is a REBUILD, never a loadSource() under a live
    // element — that is what let the old lesson play on into the new one.
    expect(loadSourceCalls).not.toContain(SRC_B);
    expect(destroyedInstances).toContain(SRC_A);
    expect(recorded[1].src).toBe(SRC_B);
    expect(recorded[1].pauseCountAtCall).toBeGreaterThan(0);
    expect(loadSpy).toHaveBeenCalled();

    unmount(component);
  });

  test('clears the previous source before building the new player', async () => {
    const { component, props } = await mountPlayer();
    expect(videoElement().getAttribute('src')).toBe(SRC_A);

    props.src = SRC_B;
    props.contentId = 'lesson-b';
    flushSync();
    await vi.waitFor(() => expect(recorded).toHaveLength(2));

    expect(recorded[1].srcAttrAtCall).toBeNull();
    expect(videoElement().getAttribute('src')).toBe(SRC_B);

    unmount(component);
  });

  test('files the outgoing position against the OUTGOING item id', async () => {
    const { component, props } = await mountPlayer();
    const el = videoElement();
    Object.defineProperty(el, 'duration', { configurable: true, value: 900 });
    Object.defineProperty(el, 'currentTime', {
      configurable: true,
      writable: true,
      value: 120,
    });

    props.src = SRC_B;
    props.contentId = 'lesson-b';
    flushSync();
    await vi.waitFor(() => expect(recorded).toHaveLength(2));

    expect(updateLocalProgress).toHaveBeenCalledWith('lesson-a', 120, 900);
    for (const call of updateLocalProgress.mock.calls) {
      expect(call[0]).toBe('lesson-a');
    }

    unmount(component);
  });
});

/**
 * The content page's access load re-runs on every tab return and on the org
 * layout's version poll, and each run signs the same item again. hls.js
 * 1.6.15's `loadSource()` re-creates the MediaSource for a new URL, which
 * puts the element back at 0:00, paused, with no `pause` event; the mock here
 * cannot show that, so the rule is pinned as "the live stream is not touched".
 */
describe('VideoPlayer — same item, freshly signed URL', () => {
  test('leaves a live stream alone: no loadSource, no rebuild, no pause', async () => {
    hlsMode = 'mse';
    const { component, props } = await mountPlayer();

    props.src = 'https://cdn.test/lesson-a/resigned.m3u8';
    flushSync();
    await Promise.resolve();

    expect(loadSourceCalls).toHaveLength(0);
    expect(recorded).toHaveLength(1);
    expect(destroyedInstances).toHaveLength(0);
    expect(pauseSpy).not.toHaveBeenCalled();

    unmount(component);
  });

  test('rebuilds an errored player at the place it kept', async () => {
    hlsMode = 'mse';
    const { component, props } = await mountPlayer();
    const el = videoElement();
    Object.defineProperty(el, 'duration', { configurable: true, value: 5400 });
    Object.defineProperty(el, 'currentTime', {
      configurable: true,
      writable: true,
      value: 0,
    });

    recorded[0]?.onError?.(
      'This could not be loaded. Please try again.',
      'network',
      3012
    );
    flushSync();
    props.src = 'https://cdn.test/lesson-a/resigned.m3u8';
    flushSync();
    await vi.waitFor(() => expect(recorded).toHaveLength(2));
    el.dispatchEvent(new Event('loadedmetadata'));

    expect(el.currentTime).toBe(3012);
    // The kept place is consumed: a later save writes the live playhead.
    el.currentTime = 3100;
    el.dispatchEvent(new Event('pause'));
    expect(updateLocalProgress).toHaveBeenLastCalledWith(
      'lesson-a',
      3100,
      5400
    );

    unmount(component);
  });
});

/**
 * A rebuilt stream keeps the viewer's place. `hls.ts` destroys a failed or
 * expired stream, and the destroy resets the element to 0, so it reads the
 * playhead first and passes it on (`at`). Without it a paid viewer 50
 * minutes in who lost the network pressed Retry, the film started at 0:00,
 * and the progress tracker saved that over their resume point.
 */
describe('VideoPlayer — a rebuilt stream keeps the viewer’s place', () => {
  /** The element after the helper's destroy: back at 0, its length known again once rebuilt. */
  function resetElement(el: HTMLVideoElement) {
    Object.defineProperty(el, 'duration', { configurable: true, value: 5400 });
    Object.defineProperty(el, 'currentTime', {
      configurable: true,
      writable: true,
      value: 0,
    });
  }

  test('Retry after a network failure resumes where it failed; no save writes 0 meanwhile', async () => {
    const { component } = await mountPlayer();
    const el = videoElement();
    resetElement(el);

    recorded[0]?.onError?.(
      'This could not be loaded. Please try again.',
      'network',
      3012
    );
    flushSync();
    document.body
      .querySelector<HTMLButtonElement>('.video-player-error-retry')
      ?.click();
    await vi.waitFor(() => expect(recorded).toHaveLength(2));

    // The new stream reads 0 until it knows its length: a save now keeps the place.
    el.dispatchEvent(new Event('pause'));
    expect(updateLocalProgress).toHaveBeenLastCalledWith(
      'lesson-a',
      3012,
      5400
    );
    expect(updateLocalProgress).not.toHaveBeenCalledWith('lesson-a', 0, 5400);
    el.dispatchEvent(new Event('loadedmetadata'));
    expect(el.currentTime).toBe(3012);

    unmount(component);
  });

  test('an expiry resumes where the helper read the playhead, not the reset 0', async () => {
    const { component } = await mountPlayer();
    const el = videoElement();
    resetElement(el);

    recorded[0]?.onUrlExpired?.(612);
    await vi.waitFor(() => expect(recorded).toHaveLength(2));
    el.dispatchEvent(new Event('loadedmetadata'));
    expect(el.currentTime).toBe(612);

    unmount(component);
  });

  test('a renewal of a PLAYING film plays on once it lands; a paused one stays paused', async () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    const { component } = await mountPlayer();
    const el = videoElement();
    resetElement(el);

    // The destroy that came with the expiry fired no pause: the mirror
    // still says the viewer was watching.
    el.dispatchEvent(new Event('play'));
    play.mockClear();
    recorded[0]?.onUrlExpired?.(612);
    await vi.waitFor(() => expect(recorded).toHaveLength(2));
    expect(play).not.toHaveBeenCalled();
    el.dispatchEvent(new Event('loadedmetadata'));
    expect(el.currentTime).toBe(612);
    expect(play).toHaveBeenCalledTimes(1);

    el.dispatchEvent(new Event('pause'));
    play.mockClear();
    recorded[1]?.onUrlExpired?.(700);
    await vi.waitFor(() => expect(recorded).toHaveLength(3));
    el.dispatchEvent(new Event('loadedmetadata'));
    expect(el.currentTime).toBe(700);
    expect(play).not.toHaveBeenCalled();

    unmount(component);
  });

  test('an element error on a live hls.js stream destroys it and keeps the place for Retry', async () => {
    hlsMode = 'mse';
    const { component } = await mountPlayer();
    const el = videoElement();
    resetElement(el);
    el.currentTime = 1500;

    // A decode failure reaches the element before hls.js notices it.
    el.dispatchEvent(new Event('error'));
    flushSync();
    expect(destroyedInstances).toContain(SRC_A);

    document.body
      .querySelector<HTMLButtonElement>('.video-player-error-retry')
      ?.click();
    await vi.waitFor(() => expect(recorded).toHaveLength(2));
    el.currentTime = 0;
    el.dispatchEvent(new Event('loadedmetadata'));
    expect(el.currentTime).toBe(1500);

    unmount(component);
  });
});

/**
 * The renewal timer runs only while the film plays (owner cost rule: no
 * open-ended polling). A paused tab never asks; a playing film renews the
 * link it is actually using, a minute before it expires.
 */
describe('VideoPlayer — renewing the link', () => {
  const refresh = vi.mocked(refreshStreamingUrl);

  beforeEach(() => {
    refresh.mockClear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function mountExpiring(inMs: number) {
    const props = $state({
      src: SRC_A,
      contentId: 'lesson-a',
      contentTitle: 'Lesson one',
      initialProgress: 0,
      expiresAt: new Date(Date.now() + inMs).toISOString(),
    });
    const component = mount(VideoPlayer, { target: document.body, props });
    flushSync();
    await vi.waitFor(() => expect(recorded).toHaveLength(1));
    return { component, props };
  }

  function setPlaying(el: HTMLVideoElement, playing: boolean) {
    Object.defineProperty(el, 'paused', {
      configurable: true,
      value: !playing,
    });
    el.dispatchEvent(new Event(playing ? 'play' : 'pause'));
  }

  test('a paused film never renews, however long the tab stays open', async () => {
    const { component } = await mountExpiring(10 * 60_000);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
    unmount(component);
  });

  test('a playing film renews a minute before expiry, and pausing stops the timer', async () => {
    const { component } = await mountExpiring(10 * 60_000);
    const el = videoElement();

    setPlaying(el, true);
    await vi.advanceTimersByTimeAsync(9 * 60_000 + 1000);
    expect(refresh).toHaveBeenCalledTimes(1);

    setPlaying(el, false);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    unmount(component);
  });

  test('pausing before the renewal is due disarms it', async () => {
    const { component } = await mountExpiring(10 * 60_000);
    const el = videoElement();

    setPlaying(el, true);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    setPlaying(el, false);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
    unmount(component);
  });

  test('a re-signed src prop does not move the timer off the link in use', async () => {
    const { component, props } = await mountExpiring(10 * 60_000);
    const el = videoElement();
    setPlaying(el, true);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    // The page signs the same item again for another ten minutes. The
    // player keeps its own link, which still expires on the first clock.
    props.src = 'https://cdn.test/lesson-a/resigned.m3u8';
    props.expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    flushSync();
    await vi.advanceTimersByTimeAsync(4 * 60_000 + 1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveLength(2);
    expect(recorded[1].src).toBe('https://cdn.test/refreshed/index.m3u8');
    unmount(component);
  });
});

describe('VideoPlayer — unmount', () => {
  test('clears a natively-attached source so nothing survives navigation', async () => {
    const { component } = await mountPlayer();
    const el = videoElement();
    expect(el.getAttribute('src')).toBe(SRC_A);

    unmount(component);

    expect(el.getAttribute('src')).toBeNull();
    expect(pauseSpy).toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, test, vi } from 'vitest';
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
}
let recorded: RecordedCall[] = [];
const destroyedInstances: string[] = [];
const loadSourceCalls: string[] = [];

const pauseSpy = vi.fn();
const loadSpy = vi.fn();

vi.mock('./hls', () => ({
  createHlsPlayer: vi.fn(
    async ({ media, src }: { media: HTMLMediaElement; src: string }) => {
      recorded.push({
        src,
        srcAttrAtCall: media.getAttribute('src'),
        pauseCountAtCall: pauseSpy.mock.calls.length,
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

describe('VideoPlayer — same item, freshly signed URL', () => {
  test('keeps the loadSource fast path so the playhead survives', async () => {
    hlsMode = 'mse';
    const { component, props } = await mountPlayer();

    props.src = 'https://cdn.test/lesson-a/resigned.m3u8';
    flushSync();
    await vi.waitFor(() =>
      expect(loadSourceCalls).toContain(
        'https://cdn.test/lesson-a/resigned.m3u8'
      )
    );

    expect(recorded).toHaveLength(1); // no rebuild
    expect(destroyedInstances).toHaveLength(0);
    expect(pauseSpy).not.toHaveBeenCalled();

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

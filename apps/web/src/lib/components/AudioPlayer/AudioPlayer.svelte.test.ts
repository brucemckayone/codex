import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import AudioPlayer from './AudioPlayer.svelte';

/**
 * `AudioPlayer` source-swap tests (Codex-1g5lh.12).
 *
 * THE BUG: on a course page the in-course player route
 * (`/journeys/[journeySlug]/practice/[contentSlug]`) keeps the SAME component
 * instance across sessions — SvelteKit reuses the page and its children when
 * only the route params change. `AudioPlayer.initPlayer()` ran once in
 * `onMount` and nothing re-ran it, so moving to the next session left the
 * previous track playing and never loaded the new manifest. `VideoPlayer` had
 * a src-change `$effect`; `AudioPlayer` never did.
 *
 * WHAT IS AND IS NOT VERIFIED HERE. jsdom has no media pipeline:
 * `HTMLMediaElement.play/pause/load` are stubs and nothing decodes, so "the
 * old audio goes silent" cannot be observed directly. What IS observable, and
 * is what these tests assert, is the mechanism that produces silence:
 *
 *   • `pause()` is called on the element that held the OUTGOING source,
 *   • its `src` attribute is gone by the time the new source is built (read
 *     inside the `createHlsPlayer` mock at call time, not after the fact),
 *   • `load()` is called, so any in-flight fetch is aborted,
 *   • the outgoing HLS.js instance is `destroy()`ed (a leaked instance keeps
 *     pulling segments forever — an audio bug and a bandwidth bug),
 *   • and the NEW manifest URL actually reaches `createHlsPlayer`.
 *
 * Audible silence in a real browser is therefore reasoned, not measured.
 *
 * `createHlsPlayer` is mocked because it is the seam between the component and
 * the two playback paths. The default mock emulates the NATIVE branch
 * (`attachNative` in hls.ts, which assigns `media.src` directly) — which is
 * also the branch jsdom would genuinely take, since `Hls.isSupported()` is
 * false without MSE. `hlsMode = 'mse'` switches it to the HLS.js branch so the
 * `destroy()` / `loadSource()` behaviour of that path is covered too.
 */

// --- test doubles ---------------------------------------------------------

type HlsMode = 'native' | 'mse';
let hlsMode: HlsMode = 'native';

interface RecordedCall {
  src: string;
  /** `src` attribute on the element AT THE MOMENT the player was built. */
  srcAttrAtCall: string | null;
  /** How many times `pause()` had been called by then. */
  pauseCountAtCall: number;
}
let recorded: RecordedCall[] = [];
const destroyedInstances: string[] = [];
const loadSourceCalls: string[] = [];

const pauseSpy = vi.fn();
const loadSpy = vi.fn();

vi.mock('$lib/components/VideoPlayer/hls', () => ({
  createHlsPlayer: vi.fn(
    async ({ media, src }: { media: HTMLMediaElement; src: string }) => {
      recorded.push({
        src,
        srcAttrAtCall: media.getAttribute('src'),
        pauseCountAtCall: pauseSpy.mock.calls.length,
      });
      if (hlsMode === 'native') {
        // Mirrors attachNative(): the manifest goes straight on the element.
        media.setAttribute('src', src);
        return { hls: null, cleanup: vi.fn() };
      }
      const hls = {
        destroy: vi.fn(() => destroyedInstances.push(src)),
        loadSource: vi.fn((next: string) => loadSourceCalls.push(next)),
      };
      return { hls, cleanup: vi.fn() };
    }
  ),
}));

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

vi.mock('./audio-analyser', () => ({
  createAudioAnalyser: vi.fn(() => ({
    getAnalysis: () => ({
      bass: 0,
      mids: 0,
      treble: 0,
      amplitude: 0,
      bassSmooth: 0,
      midsSmooth: 0,
      trebleSmooth: 0,
      amplitudeSmooth: 0,
      beatPulse: 0,
      active: true,
    }),
    getFrequencyData: () => new Uint8Array(0),
    resume: vi.fn(),
    destroy: vi.fn(),
  })),
}));

// jsdom implements neither observer; both players' shells construct them.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

// --- harness -------------------------------------------------------------

const SRC_A = 'https://cdn.test/item-a/index.m3u8';
const SRC_B = 'https://cdn.test/item-b/index.m3u8';

interface PlayerProps {
  src: string;
  contentId: string;
  initialProgress: number;
  waveformUrl: string | null;
  title: string;
}

function audioElement(): HTMLAudioElement {
  const el = document.body.querySelector('audio');
  if (!el) throw new Error('no <audio> element rendered');
  return el as HTMLAudioElement;
}

/**
 * Make the element look like it is mid-playback: a non-`true` `paused` (jsdom
 * hard-codes `true`) plus a real `play` event so the component's own handlers
 * flip into the playing state, and a finite duration so the progress tracker
 * is willing to save.
 */
function simulatePlaying(el: HTMLAudioElement, atSeconds: number) {
  Object.defineProperty(el, 'paused', { configurable: true, value: false });
  Object.defineProperty(el, 'duration', { configurable: true, value: 600 });
  Object.defineProperty(el, 'currentTime', {
    configurable: true,
    writable: true,
    value: atSeconds,
  });
  el.dispatchEvent(new Event('play'));
}

async function mountPlayer(overrides: Partial<PlayerProps> = {}) {
  const props = $state<PlayerProps>({
    src: SRC_A,
    contentId: 'item-a',
    initialProgress: 0,
    waveformUrl: null,
    title: 'Session one',
    ...overrides,
  });
  const component = mount(AudioPlayer, { target: document.body, props });
  flushSync();
  await vi.waitFor(() => expect(recorded).toHaveLength(1));
  return { component, props };
}

/** Move to the next course item: both `src` and `contentId` change together. */
async function navigateToNextItem(props: PlayerProps) {
  props.src = SRC_B;
  props.contentId = 'item-b';
  flushSync();
  await vi.waitFor(() => expect(recorded).toHaveLength(2));
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

  // Spy rather than assume: jsdom's media methods are inert stubs, so the only
  // thing an assertion can honestly claim is that they were CALLED.
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

// --- tests ---------------------------------------------------------------

describe('AudioPlayer — moving between course items', () => {
  test('adopts the new item’s manifest instead of staying on the old one', async () => {
    const { component, props } = await mountPlayer();
    expect(recorded[0].src).toBe(SRC_A);

    await navigateToNextItem(props);

    // The regression: only ever one call, always the first item's URL.
    expect(recorded[1].src).toBe(SRC_B);
    expect(audioElement().getAttribute('src')).toBe(SRC_B);

    unmount(component);
  });

  test('releases the previous source before the new one is built', async () => {
    const { component, props } = await mountPlayer();
    const el = audioElement();
    expect(el.getAttribute('src')).toBe(SRC_A);

    await navigateToNextItem(props);

    // Read at call time, so this proves ORDER: the old source was gone from
    // the element before the new player was constructed. Asserting after the
    // fact would pass even if the old source had never been cleared.
    expect(recorded[1].srcAttrAtCall).toBeNull();
    expect(recorded[1].pauseCountAtCall).toBeGreaterThan(0);
    expect(loadSpy).toHaveBeenCalled();

    unmount(component);
  });

  test('stops a PLAYING item — the bead’s first state', async () => {
    const { component, props } = await mountPlayer();
    simulatePlaying(audioElement(), 42);
    flushSync();

    await navigateToNextItem(props);

    expect(recorded[1].pauseCountAtCall).toBeGreaterThan(0);
    expect(recorded[1].srcAttrAtCall).toBeNull();
    expect(recorded[1].src).toBe(SRC_B);

    unmount(component);
  });

  test('stops a PAUSED item too — the owner ruled out a play-state race', async () => {
    const { component, props } = await mountPlayer();
    // Untouched after mount: jsdom reports `paused === true`.
    expect(audioElement().paused).toBe(true);

    await navigateToNextItem(props);

    expect(recorded[1].pauseCountAtCall).toBeGreaterThan(0);
    expect(recorded[1].srcAttrAtCall).toBeNull();
    expect(recorded[1].src).toBe(SRC_B);

    unmount(component);
  });

  test('destroys the outgoing HLS.js instance rather than leaking it', async () => {
    hlsMode = 'mse';
    const { component, props } = await mountPlayer();

    await navigateToNextItem(props);

    // A leaked instance keeps fetching segments forever.
    expect(destroyedInstances).toContain(SRC_A);
    // And the new item is a fresh build, not a loadSource() on the old one:
    // the outgoing instance is dead, so loadSource would silently drop it.
    expect(loadSourceCalls).not.toContain(SRC_B);
    expect(recorded[1].src).toBe(SRC_B);

    unmount(component);
  });

  test('files the outgoing position against the OUTGOING item id', async () => {
    const { component, props } = await mountPlayer();
    simulatePlaying(audioElement(), 42);
    flushSync();

    await navigateToNextItem(props);

    // Both props change in the same update, so a save that reads the live
    // `contentId` writes item A's playhead onto item B and corrupts B's
    // resume point. Every save triggered by the swap must name item A.
    expect(updateLocalProgress).toHaveBeenCalled();
    for (const call of updateLocalProgress.mock.calls) {
      expect(call[0]).toBe('item-a');
    }
    expect(updateLocalProgress).toHaveBeenCalledWith('item-a', 42, 600);

    unmount(component);
  });
});

describe('AudioPlayer — same item, freshly signed URL', () => {
  test('swaps the manifest under the playhead instead of restarting', async () => {
    hlsMode = 'mse';
    const { component, props } = await mountPlayer();

    // Follow / subscribe unlock: the access flow re-runs and returns a new
    // signed URL for the SAME content. This must NOT stop playback.
    props.src = 'https://cdn.test/item-a/resigned.m3u8';
    flushSync();
    await vi.waitFor(() =>
      expect(loadSourceCalls).toContain('https://cdn.test/item-a/resigned.m3u8')
    );

    expect(recorded).toHaveLength(1); // no rebuild
    expect(destroyedInstances).toHaveLength(0);
    expect(pauseSpy).not.toHaveBeenCalled();

    unmount(component);
  });
});

describe('AudioPlayer — unmount', () => {
  test('pauses, clears the source and destroys HLS.js', async () => {
    hlsMode = 'mse';
    const { component } = await mountPlayer();
    const el = audioElement();

    unmount(component);

    expect(pauseSpy).toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalled();
    expect(el.getAttribute('src')).toBeNull();
    expect(destroyedInstances).toContain(SRC_A);
  });

  test('clears a natively-attached source on unmount', async () => {
    // The native branch has no HLS.js instance to destroy, so `teardownHls()`
    // alone leaves a detached element holding a live URL — which can keep
    // playing. This is the case a `{#key}` remount would NOT have fixed.
    const { component } = await mountPlayer();
    const el = audioElement();
    expect(el.getAttribute('src')).toBe(SRC_A);

    unmount(component);

    expect(el.getAttribute('src')).toBeNull();
    expect(pauseSpy).toHaveBeenCalled();
  });
});

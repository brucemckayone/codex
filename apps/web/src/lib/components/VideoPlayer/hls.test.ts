/**
 * `createHlsPlayer` picks its playback path by CAPABILITY, not by the browser's
 * opinion of a MIME string.
 *
 * THE BUG THIS EXISTS FOR. `supportsNativeHls()` used to test
 * `canPlayType('application/vnd.apple.mpegurl') !== ''`, and it was consulted
 * FIRST. Modern Chrome answers `'maybe'` for that type — it recognises the MIME
 * type and cannot play it — so `!== ''` read Chrome as having native HLS. The
 * factory assigned the manifest straight to `video.src`, Chrome failed with
 * `MEDIA_ERR_SRC_NOT_SUPPORTED` (code 4), and hls.js — fully supported, MSE and
 * codecs available — was never constructed.
 *
 * It broke every video and audio surface in the app on every Chromium browser,
 * for all media, and it looked like a media problem: "error on valid media",
 * `NotSupportedError: The element has no supported sources`. Measured in
 * Chrome 151 on the real page: `canPlayType` → `'maybe'`,
 * `Hls.isSupported()` → `true`, `MediaSource.isTypeSupported('video/mp2t')` →
 * `true`.
 *
 * The three cases below are the whole decision table. The first is the
 * regression: it FAILS against the old ordering, because `media.src` would hold
 * the manifest and `loadSource` would never be called.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadSource = vi.fn();
const attachMedia = vi.fn();
const on = vi.fn();
const destroy = vi.fn();
const startLoad = vi.fn();
const isSupported = vi.fn(() => true);

vi.mock('hls.js', () => {
  class FakeHls {
    static isSupported = () => isSupported();
    static Events = { ERROR: 'hlsError', FRAG_LOADED: 'hlsFragLoaded' };
    static ErrorTypes = {
      NETWORK_ERROR: 'networkError',
      MEDIA_ERROR: 'mediaError',
    };
    static ErrorDetails = {
      FRAG_LOAD_ERROR: 'fragLoadError',
      FRAG_LOAD_TIMEOUT: 'fragLoadTimeOut',
    };
    loadSource = loadSource;
    attachMedia = attachMedia;
    on = on;
    destroy = destroy;
    startLoad = startLoad;
    recoverMediaError = vi.fn();
    swapAudioCodec = vi.fn();
  }
  return { default: FakeHls };
});

/** A stand-in for the `<video>` element the factory is handed. */
function fakeMedia() {
  return {
    src: '',
    error: null,
    currentTime: 0,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLMediaElement;
}

/**
 * Force `canPlayType` for the HLS MIME type.
 *
 * The factory builds a throwaway `<video>` via `document.createElement`, so the
 * probe is stubbed at that seam rather than on any element we own.
 */
function stubCanPlayType(value: string) {
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((
    tag: string,
    ...rest: unknown[]
  ) => {
    const el = original(tag, ...(rest as []));
    if (tag === 'video') {
      (el as HTMLVideoElement).canPlayType = () => value as CanPlayTypeResult;
    }
    return el;
  }) as typeof document.createElement);
}

const MANIFEST = 'https://cdn.example/x/preview.m3u8';

describe('createHlsPlayer — path selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    isSupported.mockReturnValue(true);
  });

  it('uses hls.js even when canPlayType says "maybe" (the Chrome regression)', async () => {
    // Chrome's exact answer. Under the old `!== ''` check this took the native
    // branch and set `media.src` to the manifest, which Chrome cannot play.
    stubCanPlayType('maybe');
    const media = fakeMedia();
    const { createHlsPlayer } = await import('./hls');

    const handle = await createHlsPlayer({ media, src: MANIFEST });

    expect(loadSource).toHaveBeenCalledWith(MANIFEST);
    expect(attachMedia).toHaveBeenCalledWith(media);
    expect(
      media.src,
      'the manifest was assigned to the element instead of being given to hls.js'
    ).toBe('');
    expect(handle.hls).not.toBeNull();
  });

  it('still uses hls.js when the element claims full native support', async () => {
    // Safari's answer. hls.js gives precise per-segment status (a 403 is
    // distinguishable from a flaky network), which the native path can only
    // guess at, so capability wins here too.
    stubCanPlayType('probably');
    const media = fakeMedia();
    const { createHlsPlayer } = await import('./hls');

    await createHlsPlayer({ media, src: MANIFEST });

    expect(loadSource).toHaveBeenCalledWith(MANIFEST);
    expect(media.src).toBe('');
  });

  it('falls back to the element only when MSE is unavailable', async () => {
    // iOS Safari before managed Media Source: `isSupported()` is false and
    // native HLS is the only way to play anything.
    isSupported.mockReturnValue(false);
    stubCanPlayType('probably');
    const media = fakeMedia();
    const { createHlsPlayer } = await import('./hls');

    const handle = await createHlsPlayer({ media, src: MANIFEST });

    expect(loadSource).not.toHaveBeenCalled();
    expect(media.src).toBe(MANIFEST);
    expect(handle.hls).toBeNull();
    // The native branch watches the element's own error event, which is the
    // only expiry signal it gets.
    expect(media.addEventListener).toHaveBeenCalledWith(
      'error',
      expect.any(Function)
    );
  });

  it('reports an unplayable manifest when neither path can work', async () => {
    // No MSE and no native HLS. Assigning an .m3u8 to `src` cannot work, so the
    // caller is told rather than left with a dead element and no explanation.
    isSupported.mockReturnValue(false);
    stubCanPlayType('');
    const media = fakeMedia();
    const onError = vi.fn();
    const { createHlsPlayer } = await import('./hls');

    await createHlsPlayer({ media, src: MANIFEST, onError });

    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('cannot play this format'),
      'unsupported',
      0
    );
  });

  it('stays silent for a plain mp4 on a browser with no HLS at all', async () => {
    // Same last resort, different source: most browsers play an mp4 from `src`
    // perfectly well, so the warning above must not fire here.
    isSupported.mockReturnValue(false);
    stubCanPlayType('');
    const media = fakeMedia();
    const onError = vi.fn();
    const { createHlsPlayer } = await import('./hls');

    await createHlsPlayer({
      media,
      src: 'https://cdn.example/x/video.mp4',
      onError,
    });

    expect(onError).not.toHaveBeenCalled();
    expect(media.src).toBe('https://cdn.example/x/video.mp4');
  });
});

/**
 * Recovery is bounded, and a stream that cannot recover says so. In hls.js
 * 1.6 `startLoad()` never reloads a playlist (`PlaylistLoader.startLoad` is
 * a no-op), so the old "retry every network error" left a master answering
 * 404, 429 or 5xx on a loading sheen for good, and a failing variant
 * reloading without end.
 */
describe('createHlsPlayer — recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    isSupported.mockReturnValue(true);
  });

  /** Start a player, and hand back what hls.js would call on each event. */
  async function player(options: { onUrlExpired?: (at: number) => void } = {}) {
    const onError = vi.fn();
    const media = fakeMedia();
    // What hls.js's detach does: `src` removed, `load()`, the playhead at 0.
    destroy.mockImplementation(() => {
      media.currentTime = 0;
    });
    const { createHlsPlayer } = await import('./hls');
    await createHlsPlayer({ media, src: MANIFEST, onError, ...options });
    const handler = (event: string) => {
      const call = on.mock.calls.find(([name]) => name === event);
      if (!call) throw new Error(`no ${event} handler`);
      return call[1] as (event: string, data?: unknown) => void;
    };
    const report = (data: Record<string, unknown>) =>
      handler('hlsError')('hlsError', { fatal: true, ...data });
    const fail = (details: string, code?: number) =>
      report({
        type: 'networkError',
        details,
        response: code === undefined ? undefined : { code },
      });
    const fragmentLoaded = () => handler('hlsFragLoaded')('hlsFragLoaded');
    return { media, onError, report, fail, fragmentLoaded };
  }

  it.each([
    ['the master answers 404', 'manifestLoadError', 404],
    ['the master is rate-limited', 'manifestLoadError', 429],
    ['the master times out', 'manifestLoadTimeOut', undefined],
    ['a variant answers 500', 'levelLoadError', 500],
  ])('%s: gives up at once and says so, never startLoad()', async (_label, details, code) => {
    const { onError, fail } = await player();
    fail(details, code);
    expect(startLoad).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.any(String),
      'network',
      expect.any(Number)
    );
  });

  // A paid viewer 50 minutes in loses the network: the Retry resumes there,
  // and the progress tracker never writes the reset 0 over their place.
  it('says where the playhead stood, read before the destroy reset it', async () => {
    const onUrlExpired = vi.fn();
    const expiring = await player({ onUrlExpired });
    expiring.media.currentTime = 3012;
    expiring.fail('fragLoadError', 403);
    expect(onUrlExpired).toHaveBeenCalledWith(3012);
    expect(expiring.media.currentTime).toBe(0);

    vi.clearAllMocks();
    const failing = await player();
    failing.media.currentTime = 2996;
    failing.fail('manifestLoadError', 404);
    expect(failing.onError).toHaveBeenCalledWith(
      expect.any(String),
      'network',
      2996
    );
    expect(failing.media.currentTime).toBe(0);
  });

  it('a failing fragment loads again twice, then gives up', async () => {
    const { onError, fail } = await player();
    fail('fragLoadError');
    fail('fragLoadTimeOut');
    expect(startLoad).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
    fail('fragLoadError');
    expect(startLoad).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.any(String),
      'network',
      expect.any(Number)
    );
  });

  it('a fragment that loads earns the next failure its retries again', async () => {
    const { onError, fail, fragmentLoaded } = await player();
    fail('fragLoadError');
    fail('fragLoadError');
    fragmentLoaded();
    fail('fragLoadError');
    expect(startLoad).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
  });

  it('a 403 still hands off to the caller to renew, unretried', async () => {
    const onUrlExpired = vi.fn();
    const { onError, fail } = await player({ onUrlExpired });
    fail('fragLoadError', 403);
    expect(onUrlExpired).toHaveBeenCalledTimes(1);
    expect(startLoad).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('a media error past recovery is a media fault, not a browser gap', async () => {
    const { onError, report } = await player();
    for (let i = 0; i < 3; i++) {
      report({ type: 'mediaError', details: 'bufferAppendError' });
    }
    expect(onError).toHaveBeenCalledWith(
      expect.any(String),
      'media',
      expect.any(Number)
    );
  });
});

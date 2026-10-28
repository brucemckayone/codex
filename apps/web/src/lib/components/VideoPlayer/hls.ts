/**
 * HLS Player Factory
 *
 * Creates an HLS.js instance wherever Media Source Extensions are available —
 * which is every current desktop browser, Safari included. The <video>
 * element's own HLS support is the FALLBACK, for iOS Safari before managed
 * Media Source. Do not reorder these: see `supportsNativeHls`, where Chrome
 * reporting `'maybe'` for the HLS MIME type broke every player in the app.
 *
 * Error handling (each `onError` names its `HlsErrorKind`):
 * - Network 403 (signed URL expired): hand off to `onUrlExpired` — caller
 *   is expected to fetch a fresh signed URL and rebuild the source. Looping
 *   `startLoad()` against an expired URL only produces cascading 403s.
 * - A fragment that fails to load: `startLoad()` tries again, at most
 *   FRAGMENT_RETRIES times in a row (a fragment that loads resets the count),
 *   then destroys the instance and calls onError (`network`).
 * - A playlist that fails to load (master or variant: 404, 429, 5xx, a
 *   timeout): destroys the instance and calls onError (`network`) at once. In
 *   hls.js 1.6 `startLoad()` never reloads a manifest, so "recovering" one
 *   left the player loading for good, and a failing variant reloaded without
 *   end.
 * - Media errors: attempts recoverMediaError, then swapAudioCodec on second
 *   failure, then destroys the instance and calls onError (`media`)
 * - Fatal unknown errors: destroys instance, calls onError (`unknown`)
 *
 * Safari native HLS path:
 *   Native HLS on Safari/iOS swallows the individual segment response status,
 *   so there's no reliable way to distinguish an expired-URL 403 from any
 *   other network fault. We listen for MediaError.MEDIA_ERR_NETWORK and call
 *   `onUrlExpired` — the caller can refresh the URL and retry. The `cleanup`
 *   function returned from `createHlsPlayer` tears down the listener so it
 *   doesn't leak on unmount.
 */

import type Hls from 'hls.js';
import type { ErrorData } from 'hls.js';

/**
 * Return type of `createHlsPlayer`.
 *
 * - HLS.js branch: `hls` is the HLS.js instance, `cleanup` is a no-op.
 *   (Destroying HLS.js automatically removes its internal listeners.)
 * - Native Safari branch: `hls` is null, `cleanup` detaches the `'error'`
 *   listener the factory attached to the `<video>` element.
 */
interface HlsPlayerHandle {
  hls: Hls | null;
  cleanup: () => void;
}

/**
 * Why a stream failed, for a caller that words it for the visitor:
 * - `unsupported`: this browser has neither MSE nor native HLS — a capability
 *   fact, so another browser may play it.
 * - `media`: decoding failed, even after recovery — as often a broken
 *   rendition as a browser gap.
 * - `network`: a playlist would not load, or fragments kept failing.
 * - `unknown`: anything else fatal.
 */
export type HlsErrorKind = 'unsupported' | 'media' | 'network' | 'unknown';

/** A failed fragment is loaded again at most this many times in a row. */
const FRAGMENT_RETRIES = 2;

interface HlsPlayerOptions {
  media: HTMLMediaElement;
  src: string;
  /**
   * The stream has failed for good. `at` is the playhead as it failed, read
   * BEFORE the instance was destroyed: the destroy detaches the element and
   * resets its `currentTime` to 0, so a caller that rebuilds (a Retry)
   * resumes from `at`, never from the reset.
   */
  onError?: (message: string, kind: HlsErrorKind, at: number) => void;
  /**
   * Fired when the current signed URL has (almost certainly) expired — HLS.js
   * saw a 403 from a segment fetch, or Safari native HLS surfaced
   * MEDIA_ERR_NETWORK. Callers should fetch a fresh URL via
   * `refreshStreamingUrl(contentId)` and swap the player's source, resuming
   * from `at` (read before the destroy, as for `onError`).
   *
   * HLS.js path: the instance has already been destroyed by the time this
   * fires — the caller must rebuild a new instance with the refreshed URL.
   * Safari path: the `<video>` element is still attached; calling
   * `media.src = newUrl; media.load()` is the expected recovery.
   */
  onUrlExpired?: (at: number) => void;
}

/**
 * Whether the browser claims it can play an HLS manifest natively.
 *
 * ONLY CONSULTED AS A FALLBACK, and the reason is a trap worth stating.
 * `canPlayType` returns `''`, `'maybe'` or `'probably'`, and modern Chrome
 * answers **`'maybe'`** for `application/vnd.apple.mpegurl` — it recognises the
 * MIME type and cannot play it. An earlier version of this file tested
 * `!== ''`, which read Chrome's `'maybe'` as support: it assigned the manifest
 * straight to `video.src`, Chrome failed with `MEDIA_ERR_SRC_NOT_SUPPORTED`
 * (code 4), and hls.js — fully supported, MSE and all — was never given a
 * chance. Every video and audio surface in the app was affected on every
 * Chromium browser, whatever the media.
 *
 * Measured in Chrome 151: `canPlayType` → `'maybe'`, `Hls.isSupported()` →
 * `true`, `MediaSource.isTypeSupported('video/mp2t')` → `true`.
 *
 * So support is decided by CAPABILITY (`Hls.isSupported()`, which probes MSE and
 * the codecs) rather than by a browser's opinion of a MIME string. This function
 * survives only for the case where MSE is genuinely absent — iOS Safari before
 * managed Media Source — where native HLS is the only way to play anything.
 */
function supportsNativeHls(): boolean {
  if (typeof document === 'undefined') return false;
  const video = document.createElement('video');
  return video.canPlayType('application/vnd.apple.mpegurl') !== '';
}

/**
 * Create an HLS player for the given video element.
 *
 * Returns a handle containing the HLS.js instance (or null for native) and a
 * cleanup callback. The caller is responsible for calling `cleanup()` on
 * unmount AND calling `hls?.destroy()` when re-creating a player.
 */
export async function createHlsPlayer(
  options: HlsPlayerOptions
): Promise<HlsPlayerHandle> {
  const { media, src, onError, onUrlExpired } = options;

  /**
   * Native HLS: hand the manifest to the element and watch for its error event.
   *
   * Native HLS does not expose per-segment error status, so the best
   * granularity we get is the HTMLMediaElement 'error' event with a
   * MediaError code. MEDIA_ERR_NETWORK is a best-effort proxy for
   * "signed URL expired" — callers can refresh and retry.
   *
   * Reached only when MSE is unavailable (iOS Safari before managed Media
   * Source). See `supportsNativeHls` for why this is the fallback and not the
   * first choice.
   */
  const attachNative = (): HlsPlayerHandle => {
    media.src = src;

    // Neither MSE nor native HLS, and the source IS a manifest: assigning it to
    // `src` cannot work, so say so instead of leaving a dead element and no
    // explanation. Guarded on the extension because this same last resort is
    // correct for a plain mp4 URL, which most browsers play fine.
    if (!supportsNativeHls() && /\.m3u8(\?|$)/.test(src)) {
      onError?.(
        'This browser cannot play this video format.',
        'unsupported',
        media.currentTime
      );
    }

    let handled = false;
    const handleError = () => {
      // One-shot — once we've handed off to `onUrlExpired`, the caller owns
      // the recovery path. Re-firing on every subsequent error would cause
      // a refresh storm.
      if (handled) return;
      const mediaError = media.error;
      if (
        mediaError &&
        mediaError.code === MediaError.MEDIA_ERR_NETWORK &&
        onUrlExpired
      ) {
        handled = true;
        onUrlExpired(media.currentTime);
        return;
      }
      // Non-network or no-callback: surface as a generic playback error.
      if (mediaError && onError) {
        handled = true;
        onError(
          'Playback error. Please try again.',
          'media',
          media.currentTime
        );
      }
    };
    media.addEventListener('error', handleError);
    return {
      hls: null,
      cleanup: () => {
        media.removeEventListener('error', handleError);
      },
    };
  };

  const { default: HlsJs } = await import('hls.js');

  // CAPABILITY FIRST. When hls.js can run we use it everywhere, including
  // Safari: it gives precise per-segment status (so a 403 is distinguishable
  // from a flaky network, which the native path can only guess at). Only when
  // MSE is missing do we fall back to the element's own HLS support — and if it
  // has none either, `attachNative` still assigns `src` as a last resort, which
  // is the right behaviour for a plain mp4 URL.
  if (!HlsJs.isSupported()) {
    return attachNative();
  }

  // RunPod encodes ~6s HLS segments; a 30s forward buffer holds ~5 segments, which balances
  // mobile-data friendliness (we don't pre-fetch the whole movie) against keeping enough ahead
  // of the playhead to ride out a 5–10s network dip. `maxMaxBufferLength` is the hard ceiling
  // HLS.js may grow to under backpressure; capping at 60s prevents unbounded RAM on long
  // sessions. See ref 05 §"Media elements" buffer tuning.
  const hls = new HlsJs({
    enableWorker: true,
    startLevel: -1, // auto quality
    lowLatencyMode: false,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
  });

  let mediaErrorRecoveryAttempts = 0;
  let fragmentRetries = 0;

  hls.on(HlsJs.Events.FRAG_LOADED, () => {
    fragmentRetries = 0;
  });

  /**
   * Destroy the instance and say where the playhead stood. Read first: the
   * destroy detaches the element and resets it to 0, and a caller that
   * rebuilds resumes from here (a paid viewer's place in a long film).
   */
  const stop = () => {
    const at = media.currentTime;
    hls.destroy();
    return at;
  };

  hls.on(HlsJs.Events.ERROR, (_event: string, data: ErrorData) => {
    if (!data.fatal) return;

    switch (data.type) {
      case HlsJs.ErrorTypes.NETWORK_ERROR: {
        // Signed URL expired: the R2 endpoint returns 403 on the segment
        // (or manifest) request. Looping `startLoad()` produces cascading
        // 403s because the signature is stale, not the network. Destroy
        // the instance, hand off to the caller to refresh the URL and
        // rebuild the player.
        const responseCode = data.response?.code;
        if (responseCode === 403 && onUrlExpired) {
          onUrlExpired(stop());
          return;
        }
        // A fragment (a timeout, a dropped connection) may load again, a
        // few times in a row. A playlist cannot: `startLoad()` never reloads
        // one, so it gives up and says so.
        const fragment =
          data.details === HlsJs.ErrorDetails.FRAG_LOAD_ERROR ||
          data.details === HlsJs.ErrorDetails.FRAG_LOAD_TIMEOUT;
        if (fragment && fragmentRetries < FRAGMENT_RETRIES) {
          fragmentRetries++;
          hls.startLoad();
          break;
        }
        const at = stop();
        // Media-neutral: AudioPlayer shows it as it stands.
        onError?.('This could not be loaded. Please try again.', 'network', at);
        break;
      }

      case HlsJs.ErrorTypes.MEDIA_ERROR:
        if (mediaErrorRecoveryAttempts === 0) {
          hls.recoverMediaError();
        } else if (mediaErrorRecoveryAttempts === 1) {
          hls.swapAudioCodec();
          hls.recoverMediaError();
        } else {
          const at = stop();
          onError?.(
            'Playback error. The video format may not be supported.',
            'media',
            at
          );
        }
        mediaErrorRecoveryAttempts++;
        break;

      default: {
        const at = stop();
        onError?.('An unexpected playback error occurred.', 'unknown', at);
        break;
      }
    }
  });

  hls.loadSource(src);
  hls.attachMedia(media);

  return {
    hls,
    cleanup: () => {
      // HLS.js internal listeners are torn down by destroy(); nothing
      // additional to detach here. The no-op is retained so callers can
      // call `cleanup()` unconditionally regardless of path.
    },
  };
}

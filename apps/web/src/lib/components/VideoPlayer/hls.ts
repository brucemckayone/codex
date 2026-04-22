/**
 * HLS Player Factory
 *
 * Creates an HLS.js instance for browsers without native HLS support.
 * Safari uses native HLS via the <video> element directly.
 *
 * Error handling:
 * - Network 403 (signed URL expired): hand off to `onUrlExpired` — caller
 *   is expected to fetch a fresh signed URL and rebuild the source. Looping
 *   `startLoad()` against an expired URL only produces cascading 403s.
 * - Other network errors: retries via HLS.js built-in recovery
 * - Media errors: attempts recoverMediaError, then swapAudioCodec on second failure
 * - Fatal unknown errors: destroys instance, calls onError callback
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
export interface HlsPlayerHandle {
  hls: Hls | null;
  cleanup: () => void;
}

export interface HlsPlayerOptions {
  media: HTMLMediaElement;
  src: string;
  onError?: (message: string) => void;
  /**
   * Fired when the current signed URL has (almost certainly) expired — HLS.js
   * saw a 403 from a segment fetch, or Safari native HLS surfaced
   * MEDIA_ERR_NETWORK. Callers should fetch a fresh URL via
   * `refreshStreamingUrl(contentId)` and swap the player's source.
   *
   * HLS.js path: the instance has already been destroyed by the time this
   * fires — the caller must rebuild a new instance with the refreshed URL.
   * Safari path: the `<video>` element is still attached; calling
   * `media.src = newUrl; media.load()` is the expected recovery.
   */
  onUrlExpired?: () => void;
}

/**
 * Check if the browser supports native HLS playback (Safari, iOS)
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

  // Safari / iOS: use native HLS.
  //
  // Native HLS does not expose per-segment error status, so the best
  // granularity we get is the HTMLMediaElement 'error' event with a
  // MediaError code. MEDIA_ERR_NETWORK is a best-effort proxy for
  // "signed URL expired" — callers can refresh and retry.
  if (supportsNativeHls()) {
    media.src = src;
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
        onUrlExpired();
        return;
      }
      // Non-network or no-callback: surface as a generic playback error.
      if (mediaError && onError) {
        handled = true;
        onError('Playback error. Please try again.');
      }
    };
    media.addEventListener('error', handleError);
    return {
      hls: null,
      cleanup: () => {
        media.removeEventListener('error', handleError);
      },
    };
  }

  const { default: HlsJs } = await import('hls.js');

  if (!HlsJs.isSupported()) {
    // Fallback: try direct source (may work for mp4 URLs). No recovery hook
    // here — if the browser can't do HLS and can't play mp4 either, there
    // is no reasonable retry path.
    media.src = src;
    return { hls: null, cleanup: () => {} };
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
          hls.destroy();
          onUrlExpired();
          return;
        }
        // Other network errors (timeouts, genuine connectivity loss):
        // HLS.js's built-in backoff gives us a reasonable recovery.
        hls.startLoad();
        break;
      }

      case HlsJs.ErrorTypes.MEDIA_ERROR:
        if (mediaErrorRecoveryAttempts === 0) {
          hls.recoverMediaError();
        } else if (mediaErrorRecoveryAttempts === 1) {
          hls.swapAudioCodec();
          hls.recoverMediaError();
        } else {
          hls.destroy();
          onError?.('Playback error. The video format may not be supported.');
        }
        mediaErrorRecoveryAttempts++;
        break;

      default:
        hls.destroy();
        onError?.('An unexpected playback error occurred.');
        break;
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

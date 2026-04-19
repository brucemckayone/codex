/**
 * HLS Player Factory
 *
 * Creates an HLS.js instance for browsers without native HLS support.
 * Safari uses native HLS via the <video> element directly.
 *
 * Error handling:
 * - Network errors: retries via HLS.js built-in recovery
 * - Media errors: attempts recoverMediaError, then swapAudioCodec on second failure
 * - Fatal unknown errors: destroys instance, calls onError callback
 */

import type Hls from 'hls.js';
import type { ErrorData } from 'hls.js';

export interface HlsPlayerOptions {
  media: HTMLMediaElement;
  src: string;
  onError?: (message: string) => void;
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
 * Returns the HLS.js instance if created, or null if native HLS is used.
 * The caller is responsible for calling `destroy()` on the returned instance.
 */
export async function createHlsPlayer(
  options: HlsPlayerOptions
): Promise<Hls | null> {
  const { media, src, onError } = options;

  // Safari / iOS: use native HLS
  if (supportsNativeHls()) {
    media.src = src;
    return null;
  }

  const { default: HlsJs } = await import('hls.js');

  if (!HlsJs.isSupported()) {
    // Fallback: try direct source (may work for mp4 URLs)
    media.src = src;
    return null;
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
      case HlsJs.ErrorTypes.NETWORK_ERROR:
        // Network errors: HLS.js will retry automatically via startLoad
        hls.startLoad();
        break;

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

  return hls;
}

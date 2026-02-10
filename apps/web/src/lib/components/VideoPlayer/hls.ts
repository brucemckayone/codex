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
  video: HTMLVideoElement;
  src: string;
  onError?: (message: string) => void;
}

/**
 * Check if the browser supports native HLS playback (Safari, iOS)
 */
function supportsNativeHls(): boolean {
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
  const { video, src, onError } = options;

  // Safari / iOS: use native HLS
  if (supportsNativeHls()) {
    video.src = src;
    return null;
  }

  const { default: HlsJs } = await import('hls.js');

  if (!HlsJs.isSupported()) {
    // Fallback: try direct source (may work for mp4 URLs)
    video.src = src;
    return null;
  }

  const hls = new HlsJs({
    enableWorker: true,
    startLevel: -1, // auto quality
    lowLatencyMode: false,
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
  hls.attachMedia(video);

  return hls;
}

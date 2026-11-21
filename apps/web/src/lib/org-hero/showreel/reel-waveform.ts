/**
 * The theatre's waveform for a recording (Codex-1yd58.8): its sound read
 * through an AnalyserNode, drawn as bars under the cover.
 *
 * A MediaElementAudioSource TAKES the element's sound: from then on it is
 * heard only through the audio graph. Fed by a cross-origin source the page
 * may not read (no CORS), the browser hands the graph zeros, and the
 * visitor hears nothing at all. hls.js plays from a same-origin MediaSource
 * (`blob:`), which the page may read, so only that path is tapped; a native
 * HLS manifest (Safari without MSE) is not, and its bars rest. A context
 * that is not running would hold the sound back until it resumed, so it is
 * not tapped either: the theatre makes its context in the press's own tick,
 * where it starts running.
 */

/** Bars across the cover, desktop and phone (the mock's). */
export const WAVE_BARS = { desk: 48, phone: 30 } as const;

/** The share of the analyser's bins the bars read: above it is mostly hiss. */
const HEARD = 0.7;

/**
 * Each bar's level, 0 to 1: the frequency bins pooled into bands, the
 * lowest band in the middle and the highest at the ends, mirrored, so a
 * voice or a drum swells from the centre out. Silence is all zeros.
 */
export function barLevels(bins: Uint8Array, count: number): number[] {
  if (count <= 0) return [];
  const half = Math.ceil(count / 2);
  // Bin 0 is the signal's offset, not a sound.
  const heard = Math.max(half + 1, Math.floor(bins.length * HEARD));
  const width = (heard - 1) / half;
  const bands: number[] = [];
  for (let band = 0; band < half; band++) {
    const from = 1 + Math.floor(band * width);
    const to = Math.max(from + 1, 1 + Math.floor((band + 1) * width));
    let sum = 0;
    for (let bin = from; bin < to; bin++) sum += bins[bin] ?? 0;
    bands.push(sum / ((to - from) * 255));
  }
  const outward = count % 2 === 0 ? bands : bands.slice(1);
  return [...[...outward].reverse(), ...bands];
}

/** Whether the element's sound may go through `context` (above). */
export function canTap(
  media: HTMLMediaElement,
  context: BaseAudioContext
): boolean {
  if (context.state !== 'running') return false;
  if (media.currentSrc.startsWith('blob:')) return true;
  return (
    typeof MediaSource !== 'undefined' && media.srcObject instanceof MediaSource
  );
}

export interface WaveTap {
  /** The analyser's frequency bins now, in one buffer it refills. */
  read(): Uint8Array;
  /** Let go of the graph; the element's sound goes with its context. */
  close(): void;
}

/**
 * Tap `media` for its waveform, or null when it may not be (`canTap`). The
 * sound is wired to the speakers BEFORE the analyser joins, so the visitor
 * keeps hearing it whatever happens to the analyser.
 */
export function tapWaveform(
  media: HTMLMediaElement,
  context: AudioContext
): WaveTap | null {
  if (!canTap(media, context)) return null;
  const source = context.createMediaElementSource(media);
  source.connect(context.destination);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;
  source.connect(analyser);
  const bins = new Uint8Array(analyser.frequencyBinCount);
  return {
    read() {
      analyser.getByteFrequencyData(bins);
      return bins;
    },
    close() {
      source.disconnect();
      analyser.disconnect();
    },
  };
}

export interface AudioAnalysis {
  /** Low-frequency energy, normalised 0-1 (bins 0-10 of ~256) */
  bass: number;
  /** Mid-frequency energy, normalised 0-1 (bins 10-100) */
  mids: number;
  /** High-frequency energy, normalised 0-1 (bins 100-256) */
  treble: number;
  /** Overall amplitude, normalised 0-1 */
  amplitude: number;
  /** Whether audio is currently playing */
  active: boolean;
}

export interface AudioAnalyserHandle {
  /** Get current frequency analysis (call once per frame in render loop) */
  getAnalysis(): AudioAnalysis;
  /** Resume AudioContext — MUST be called within a user gesture handler */
  resume(): Promise<void>;
  /** Clean up AudioContext and disconnect nodes */
  destroy(): void;
}

/**
 * Track which audio elements already have a MediaElementSource created.
 * createMediaElementSource can only be called once per element — subsequent
 * calls throw. We keep a WeakMap so entries are GC'd when the element is.
 */
const sourceCache = new WeakMap<
  HTMLAudioElement,
  { source: MediaElementAudioSourceNode; ctx: AudioContext }
>();

/** Compute the average value for a sub-range of a Uint8Array, normalised to 0-1. */
function averageRange(data: Uint8Array, start: number, end: number): number {
  const clampedEnd = Math.min(end, data.length);
  if (clampedEnd <= start) return 0;

  let sum = 0;
  for (let i = start; i < clampedEnd; i++) {
    sum += data[i];
  }
  return sum / ((clampedEnd - start) * 255);
}

export function createAudioAnalyser(
  audioElement: HTMLAudioElement,
  fftSize: number = 512
): AudioAnalyserHandle {
  let ctx: AudioContext;
  let source: MediaElementAudioSourceNode;

  const cached = sourceCache.get(audioElement);
  if (cached) {
    ctx = cached.ctx;
    source = cached.source;
  } else {
    ctx = new AudioContext();
    source = ctx.createMediaElementSource(audioElement);
    sourceCache.set(audioElement, { source, ctx });
  }

  const analyser = ctx.createAnalyser();
  analyser.fftSize = fftSize;

  source.connect(analyser);
  analyser.connect(ctx.destination);

  const frequencyData = new Uint8Array(analyser.frequencyBinCount);

  function getAnalysis(): AudioAnalysis {
    analyser.getByteFrequencyData(frequencyData);

    const binCount = analyser.frequencyBinCount;

    return {
      bass: averageRange(frequencyData, 0, 10),
      mids: averageRange(frequencyData, 10, 100),
      treble: averageRange(frequencyData, 100, binCount),
      amplitude: averageRange(frequencyData, 0, binCount),
      active: !audioElement.paused,
    };
  }

  async function resume(): Promise<void> {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  }

  function destroy(): void {
    try {
      source.disconnect(analyser);
    } catch {
      // Already disconnected
    }
    try {
      analyser.disconnect(ctx.destination);
    } catch {
      // Already disconnected
    }
    void ctx.close();
    sourceCache.delete(audioElement);
  }

  return { getAnalysis, resume, destroy };
}

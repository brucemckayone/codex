export interface AudioAnalysis {
  /** Low-frequency energy, raw instantaneous 0-1 (bins 0-10 of ~256) */
  bass: number;
  /** Mid-frequency energy, raw 0-1 (bins 10-100) */
  mids: number;
  /** High-frequency energy, raw 0-1 (bins 100-256) */
  treble: number;
  /** Overall amplitude, raw 0-1 */
  amplitude: number;
  /** Bass smoothed with asymmetric EMA — fast attack, slow release. Jitter-free. */
  bassSmooth: number;
  /** Mids smoothed. */
  midsSmooth: number;
  /** Treble smoothed (snappier than bass — transients matter more). */
  trebleSmooth: number;
  /** Amplitude smoothed. */
  amplitudeSmooth: number;
  /**
   * Transient pulse (0-1). Spikes to ~1 when bass exceeds its recent rolling
   * mean by a threshold, then decays exponentially with ~400ms half-life.
   * Stays near 0 on sustained tones — fires only on real onsets. Use this
   * instead of hard-coded `bass > X` gates.
   */
  beatPulse: number;
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

// ── Smoothing + onset detection tunables ────────────────────────
/** Generic EMA attack (seconds) — time to mostly-follow a rising signal. */
const ATTACK_SEC = 0.08;
/** Generic EMA release (seconds) — time to mostly-follow a falling signal. */
const RELEASE_SEC = 0.35;
/** Treble attack — snappier so bright transients read. */
const TREBLE_ATTACK_SEC = 0.05;
/** Treble release — slightly faster too, bright sounds are naturally shorter. */
const TREBLE_RELEASE_SEC = 0.25;
/** Rolling-mean history size for onset baseline (~0.5s at 60fps). */
const ONSET_HISTORY_SIZE = 30;
/** How much current bass must exceed rolling mean to count as an onset. */
const ONSET_THRESHOLD = 0.08;
/** Refractory period (s) — minimum gap between consecutive onset firings. */
const MIN_ONSET_INTERVAL = 0.18;
/** Beat pulse half-life (s) — after an onset, pulse decays by half every X seconds. */
const BEAT_HALF_LIFE = 0.4;
/** Cap dt to avoid massive jumps when a tab wakes from background. */
const MAX_DT = 0.1;

/**
 * Frame-rate-independent EMA with asymmetric attack/release.
 * `alpha = 1 - exp(-dt / tau)` converges correctly regardless of frame pacing.
 */
function ema(
  prev: number,
  target: number,
  dt: number,
  attackSec: number,
  releaseSec: number
): number {
  const tau = target > prev ? attackSec : releaseSec;
  const alpha = 1 - Math.exp(-dt / tau);
  return prev + alpha * (target - prev);
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

  // Smoothed state (EMAs)
  let bassSm = 0;
  let midsSm = 0;
  let trebleSm = 0;
  let ampSm = 0;

  // Onset detection state
  const bassHistory = new Array<number>(ONSET_HISTORY_SIZE).fill(0);
  let historyIdx = 0;
  let beatPulse = 0;
  let lastBeatTime = -Infinity;
  let lastFrameTime = 0;

  function getAnalysis(): AudioAnalysis {
    analyser.getByteFrequencyData(frequencyData);

    const binCount = analyser.frequencyBinCount;
    const bass = averageRange(frequencyData, 0, 10);
    const mids = averageRange(frequencyData, 10, 100);
    const treble = averageRange(frequencyData, 100, binCount);
    const amplitude = averageRange(frequencyData, 0, binCount);

    // Frame-rate-independent dt. First call: assume 60fps to seed smoothly.
    const now = performance.now() / 1000;
    const dt =
      lastFrameTime === 0 ? 1 / 60 : Math.min(MAX_DT, now - lastFrameTime);
    lastFrameTime = now;

    // EMA smoothing (asymmetric attack/release)
    bassSm = ema(bassSm, bass, dt, ATTACK_SEC, RELEASE_SEC);
    midsSm = ema(midsSm, mids, dt, ATTACK_SEC, RELEASE_SEC);
    trebleSm = ema(trebleSm, treble, dt, TREBLE_ATTACK_SEC, TREBLE_RELEASE_SEC);
    ampSm = ema(ampSm, amplitude, dt, ATTACK_SEC, RELEASE_SEC);

    // Onset detection: current bass vs rolling mean of recent history.
    // (Classical spectral-flux approach, simplified to bass band only.)
    const playing = !audioElement.paused;
    if (playing) {
      let sum = 0;
      for (let i = 0; i < ONSET_HISTORY_SIZE; i++) sum += bassHistory[i];
      const rollingMean = sum / ONSET_HISTORY_SIZE;
      const excess = bass - rollingMean;
      if (excess > ONSET_THRESHOLD && now - lastBeatTime > MIN_ONSET_INTERVAL) {
        beatPulse = 1;
        lastBeatTime = now;
      }
    }

    // Exponential decay of the beat pulse.
    beatPulse *= Math.exp((-dt * Math.LN2) / BEAT_HALF_LIFE);

    // Roll the history buffer.
    bassHistory[historyIdx] = bass;
    historyIdx = (historyIdx + 1) % ONSET_HISTORY_SIZE;

    return {
      bass,
      mids,
      treble,
      amplitude,
      bassSmooth: bassSm,
      midsSmooth: midsSm,
      trebleSmooth: trebleSm,
      amplitudeSmooth: ampSm,
      beatPulse,
      active: playing,
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

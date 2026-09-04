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
  /**
   * Very slow amplitude envelope (0-1, tau ~4s). Tracks *musical sections*
   * rather than notes — a build swells it, a breakdown drains it. Use for
   * macro-scale modulation (bloom, density, palette temperature) where
   * per-note movement would read as twitchy.
   */
  energy: number;
  /**
   * Positive spectral flux (0-1). Sum of per-bin increases since the last
   * frame, normalised. High during dense/percussive passages, near zero on
   * sustained pads. Use for detail density, sparkle, and grain — NOT for
   * geometry, since it is inherently noisy frame-to-frame.
   */
  flux: number;
  /**
   * Spectral centroid (0-1) — the "brightness" of the current spectrum, i.e.
   * the amplitude-weighted mean bin position. Dark/bassy material sits near
   * 0.1-0.2, bright/airy material near 0.5+. Smoothed. Use for hue and
   * temperature shifts, which should track timbre rather than loudness.
   */
  centroid: number;
  /**
   * Monotonic musical clock, in beats-ish units. Advances at a rate governed
   * by `energy`, so it *stops* when the music stops and speeds up when the
   * track opens out.
   *
   * This is the single most important field for calm audio-reactivity: drive
   * a shader's internal motion from `beatPhase` instead of wall-clock `time`
   * and the whole preset breathes with the music instead of running at a
   * constant rate with a wobble bolted on.
   */
  beatPhase: number;
  /**
   * Count of onsets detected since the analyser was created. Increments at
   * most once per `MIN_ONSET_INTERVAL`. Use as a seed for per-beat random
   * choices (a new drift direction, a new hue target) — sampling randomness
   * from this instead of per-frame keeps a choice stable between beats.
   */
  onsetCount: number;
  /** Whether audio is currently playing */
  active: boolean;
}

export interface AudioAnalyserHandle {
  /** Get current frequency analysis (call once per frame in render loop) */
  getAnalysis(): AudioAnalysis;
  /**
   * Raw byte frequency bins (length = `fftSize / 2`). The returned buffer is
   * shared — treat as read-only. Refreshed lazily: callers must invoke
   * `getAnalysis()` first in the same frame, or the bins reflect the previous
   * sample. Exposed so render loops that want per-bar FFT mapping (rather
   * than the aggregated bass/mids/treble bands) can avoid a duplicate
   * `getByteFrequencyData()` call.
   */
  getFrequencyData(): Uint8Array;
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
 * Macro-envelope time constant (s). Deliberately long: this tracks sections,
 * not notes. Symmetric — a swell and a drain should feel equally gradual.
 */
const ENERGY_TAU_SEC = 4.0;
/** Spectral-flux smoothing (s) — short, flux is meant to stay lively. */
const FLUX_TAU_SEC = 0.12;
/** Spectral-centroid smoothing (s) — timbre shifts slower than loudness. */
const CENTROID_TAU_SEC = 0.6;
/**
 * Beats per second the musical clock ticks at when `energy` is 0, and the
 * extra rate at full energy. 0.35 + 1.15 spans roughly 21-90 "bpm" — slow
 * enough for meditation content at rest, lively at peak.
 */
const PHASE_RATE_BASE = 0.35;
const PHASE_RATE_GAIN = 1.15;
/**
 * Flux normalisation divisor. Raw positive flux over a 256-bin spectrum can
 * reach several thousand byte-units on a hard transient; this maps typical
 * musical material into 0-1 without clipping constantly.
 */
const FLUX_SCALE = 2600;

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

  // Musical-signal state
  let energySm = 0;
  let fluxSm = 0;
  let centroidSm = 0;
  let beatPhase = 0;
  let onsetCount = 0;
  /** Previous frame's bins, for positive spectral flux. */
  const prevBins = new Uint8Array(analyser.frequencyBinCount);

  function getAnalysis(): AudioAnalysis {
    analyser.getByteFrequencyData(frequencyData);

    const binCount = analyser.frequencyBinCount;
    const bass = averageRange(frequencyData, 0, 10);
    const mids = averageRange(frequencyData, 10, 100);
    const treble = averageRange(frequencyData, 100, binCount);
    const amplitude = averageRange(frequencyData, 0, binCount);

    // Single fused pass for positive spectral flux + spectral centroid, then
    // roll `prevBins`. Fused because both need every bin and the spectrum is
    // walked once per frame at 60fps — two extra passes would be wasteful.
    let positiveFlux = 0;
    let weightedSum = 0;
    let magnitudeSum = 0;
    for (let i = 0; i < binCount; i++) {
      const v = frequencyData[i];
      const rise = v - prevBins[i];
      if (rise > 0) positiveFlux += rise;
      weightedSum += v * i;
      magnitudeSum += v;
      prevBins[i] = v;
    }
    const fluxRaw = Math.min(1, positiveFlux / FLUX_SCALE);
    // Guard the silent case: with no energy the centroid is undefined, and
    // returning 0 would read as "very dark" rather than "no information".
    // Hold the previous smoothed value instead so silence doesn't yank hue.
    const centroidRaw =
      magnitudeSum > 0 ? weightedSum / (magnitudeSum * binCount) : centroidSm;

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

    // Macro/timbre envelopes. Symmetric tau — these describe how the music
    // *is*, not how hard it just hit, so an asymmetric attack would make them
    // ratchet upward and never settle.
    const playing = !audioElement.paused;
    energySm = ema(
      energySm,
      playing ? amplitude : 0,
      dt,
      ENERGY_TAU_SEC,
      ENERGY_TAU_SEC
    );
    fluxSm = ema(fluxSm, playing ? fluxRaw : 0, dt, FLUX_TAU_SEC, FLUX_TAU_SEC);
    centroidSm = ema(
      centroidSm,
      centroidRaw,
      dt,
      CENTROID_TAU_SEC,
      CENTROID_TAU_SEC
    );

    // Musical clock. Advances only while playing, at a rate set by the macro
    // envelope — so a preset driven by `beatPhase` freezes on pause and eases
    // back in rather than teleporting to wherever wall-clock time had run to.
    if (playing) {
      beatPhase += dt * (PHASE_RATE_BASE + PHASE_RATE_GAIN * energySm);
    }

    // Onset detection: current bass vs rolling mean of recent history.
    // (Classical spectral-flux approach, simplified to bass band only.)
    if (playing) {
      let sum = 0;
      for (let i = 0; i < ONSET_HISTORY_SIZE; i++) sum += bassHistory[i];
      const rollingMean = sum / ONSET_HISTORY_SIZE;
      const excess = bass - rollingMean;
      if (excess > ONSET_THRESHOLD && now - lastBeatTime > MIN_ONSET_INTERVAL) {
        beatPulse = 1;
        lastBeatTime = now;
        onsetCount++;
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
      energy: energySm,
      flux: fluxSm,
      centroid: centroidSm,
      beatPhase,
      onsetCount,
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

  function getFrequencyData(): Uint8Array {
    return frequencyData;
  }

  return { getAnalysis, getFrequencyData, resume, destroy };
}

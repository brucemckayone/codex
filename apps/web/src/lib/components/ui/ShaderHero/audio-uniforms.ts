/**
 * Shared audio uniform plumbing — the TS half of the contract declared in
 * `./audio-glsl`.
 *
 * A renderer spreads `AUDIO_UNIFORM_NAMES` into its own uniform-name tuple,
 * keeps one `createAudioFade()` per program, and calls `uploadAudioUniforms()`
 * once per frame. That is the whole integration; nothing else is needed to
 * make a preset audio-reactive at the plumbing level.
 *
 * ```ts
 * const UNIFORM_NAMES = ['u_time', 'u_resolution', ...AUDIO_UNIFORM_NAMES] as const;
 * const fade = createAudioFade();
 * // per frame, after gl.useProgram(program):
 * const a = fade.update(audio, dtSeconds);
 * uploadAudioUniforms(gl, uniforms, a);
 * ```
 */

import type { AudioState } from './renderer-types';

/**
 * Canonical audio uniform names, matching `AUDIO_UNIFORMS` in `audio-glsl.ts`
 * one-for-one. Spread into a renderer's `UNIFORM_NAMES` tuple so
 * `getUniforms()` resolves them and the `Record` key type includes them.
 */
export const AUDIO_UNIFORM_NAMES = [
  'u_audioActive',
  'u_bass',
  'u_mids',
  'u_treble',
  'u_level',
  'u_beatPulse',
  'u_energy',
  'u_flux',
  'u_centroid',
  'u_beatPhase',
  'u_beatSeed',
] as const;

export type AudioUniformName = (typeof AUDIO_UNIFORM_NAMES)[number];

/**
 * Time constant (s) for the audio-active ramp. Long enough that entering and
 * leaving immersive mode is a fade rather than a cut, short enough that the
 * first beat still lands inside the transition.
 */
const FADE_TAU_SEC = 0.9;

/**
 * How long a `beatSeed` re-roll takes to slew to its new value (s). A hard
 * jump would make anything driven by the seed teleport on every onset; the
 * slew turns it into a quick glide that still reads as "changed on the beat".
 */
const SEED_SLEW_TAU_SEC = 0.25;

/** Cap dt so a backgrounded tab waking up doesn't snap the fade to its target. */
const MAX_DT = 0.1;

/** Frame-rate-independent exponential approach. */
function approach(prev: number, target: number, dt: number, tau: number) {
  return prev + (1 - Math.exp(-dt / tau)) * (target - prev);
}

/** Deterministic 0..1 hash of an integer — stable for a given onset index. */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Per-frame audio values already conditioned for direct upload: fades applied,
 * every field defined, safe to use when `audio` is undefined.
 */
export interface ResolvedAudio {
  /** Smooth 0..1 ramp. 0 means "render exactly the silent look". */
  active: number;
  bass: number;
  mids: number;
  treble: number;
  level: number;
  beatPulse: number;
  energy: number;
  flux: number;
  centroid: number;
  beatPhase: number;
  beatSeed: number;
  /**
   * True once the ramp has fully reached zero. Renderers can use this to skip
   * audio-only work (extra passes, deposits) entirely while silent — but must
   * NOT use it to branch the *look*, or the transition will pop.
   */
  silent: boolean;
}

/** All-zero audio, i.e. the exact pre-audio look. */
const SILENT: ResolvedAudio = {
  active: 0,
  bass: 0,
  mids: 0,
  treble: 0,
  level: 0,
  beatPulse: 0,
  energy: 0,
  flux: 0,
  centroid: 0.25,
  beatPhase: 0,
  beatSeed: 0.5,
  silent: true,
};

export interface AudioFade {
  /**
   * Advance the fade and resolve this frame's audio values.
   * @param audio - state from the render loop, may be undefined (hero mode)
   * @param dt - seconds since the previous call
   */
  update(audio: AudioState | undefined, dt: number): ResolvedAudio;
}

/**
 * Create the per-renderer audio fade state.
 *
 * Each renderer instance owns one of these. It holds the ramp and the slewed
 * beat seed, which is why it cannot be a module-level singleton: two live
 * renderers (a hero and an immersive overlay) would share and fight over it.
 */
export function createAudioFade(): AudioFade {
  let active = 0;
  let seed = 0.5;
  let seedTarget = 0.5;
  let lastOnset = -1;

  return {
    update(audio: AudioState | undefined, dt: number): ResolvedAudio {
      const step = Math.min(MAX_DT, Math.max(0, dt));

      // Ramp toward 1 while audio plays, toward 0 otherwise. Note this tracks
      // `audio.active` (playback), not merely `audio !== undefined` — a paused
      // immersive player still supplies state, and should fade back to silent.
      const target = audio?.active ? 1 : 0;
      active = approach(active, target, step, FADE_TAU_SEC);

      // Below this the ramp is visually indistinguishable from zero; snapping
      // lets renderers actually skip audio work rather than asymptote forever.
      if (active < 0.002 && target === 0) active = 0;

      if (!audio || active === 0) return SILENT;

      // Re-roll the seed on each new onset, then slew toward it.
      if (audio.onsetCount !== lastOnset) {
        lastOnset = audio.onsetCount;
        seedTarget = hash01(audio.onsetCount);
      }
      seed = approach(seed, seedTarget, step, SEED_SLEW_TAU_SEC);

      return {
        active,
        bass: audio.bassSmooth,
        mids: audio.midsSmooth,
        treble: audio.trebleSmooth,
        level: audio.amplitudeSmooth,
        beatPulse: audio.beatPulse,
        energy: audio.energy,
        flux: audio.flux,
        centroid: audio.centroid,
        beatPhase: audio.beatPhase,
        beatSeed: seed,
        silent: false,
      };
    },
  };
}

/**
 * Upload the resolved audio block. Tolerates null locations, so a renderer
 * that only declares some of the uniforms in its GLSL still calls this
 * unchanged — the compiler strips what it doesn't reference and `getUniforms`
 * yields null for those.
 */
export function uploadAudioUniforms(
  gl: WebGL2RenderingContext,
  uniforms: Partial<Record<AudioUniformName, WebGLUniformLocation | null>>,
  a: ResolvedAudio
): void {
  gl.uniform1f(uniforms.u_audioActive ?? null, a.active);
  gl.uniform1f(uniforms.u_bass ?? null, a.bass);
  gl.uniform1f(uniforms.u_mids ?? null, a.mids);
  gl.uniform1f(uniforms.u_treble ?? null, a.treble);
  gl.uniform1f(uniforms.u_level ?? null, a.level);
  gl.uniform1f(uniforms.u_beatPulse ?? null, a.beatPulse);
  gl.uniform1f(uniforms.u_energy ?? null, a.energy);
  gl.uniform1f(uniforms.u_flux ?? null, a.flux);
  gl.uniform1f(uniforms.u_centroid ?? null, a.centroid);
  gl.uniform1f(uniforms.u_beatPhase ?? null, a.beatPhase);
  gl.uniform1f(uniforms.u_beatSeed ?? null, a.beatSeed);
}

/**
 * Frame-time tracker. Renderers receive absolute `time`, but the fade and any
 * damped motion need `dt` — and the render loop pauses (hidden tab, preset
 * switch), so a naive difference can be a large spike.
 *
 * Returns 1/60 on the first call and clamps thereafter.
 */
export function createDeltaClock(): (time: number) => number {
  let prev = -1;
  return (time: number) => {
    if (prev < 0) {
      prev = time;
      return 1 / 60;
    }
    const dt = time - prev;
    prev = time;
    // Negative dt is possible if a renderer is reused across a time reset.
    return dt > 0 ? Math.min(MAX_DT, dt) : 1 / 60;
  };
}

/**
 * Plasma renderer — PIC fluid with slime-mould sensors, iridescent density
 * banding (2-pass FBO).
 *
 * Ping-pong FBO at 512x512: RG = velocity in texels per step, B = mass,
 * A = smoothed mass. Two substeps per rendered frame, each scaled to a
 * 60Hz-equivalent step. Mouse injects a vortex; a click injects a vortex plus a
 * mass spike; on each detected beat the renderer ignites a fireball at a
 * beat-chosen position through the same burst channel.
 *
 * Display maps mass cubed through four sine bands to iridescent colour,
 * remapped onto the brand palette.
 *
 * ## What changed and why
 *
 * See `shaders/plasma-sim.frag.ts` for the substantive work: 78 texture fetches
 * per pixel per step became 49, ~50 transcendentals became 2, a dead projection
 * was removed, and `uDiffusion` — declared, uploaded, and never read — now
 * controls the smoothing kernel width. This file supplies what that needed.
 *
 * **Frame-rate independence.** Velocity is in texels per STEP and every rate in
 * the sim was per step, so the plasma flowed twice as fast on a 120Hz display.
 * `uDtScale = dt * 60` carries the frame's share of a 60Hz step, clamped to
 * 1.4: the PIC gather reaches 2 texels, so a parcel travelling further than
 * that in one step lands in no cell's gather window and its mass is silently
 * dropped. Travel per step is (velocity <= 1) * speed * uDtScale * beat pace,
 * and all three factors have ceilings: 1 * 1.05 * 1.4 * 1.25 = 1.84 texels,
 * inside the window. The beat pace is the factor that makes this tight — an
 * earlier bound of 1.8 on uDtScale omitted it and allowed 2.36.
 *
 * **The musical clock.** Integrated here from a blended RATE, never crossfaded
 * in the shader: `u_beatPhase` starts at zero while `uTime` may be at 60s, so
 * `mix(uTime * k, u_beatPhase, u_audioActive)` sweeps the clock backwards as
 * the ramp eases in and the band sheen visibly reverses when playback starts.
 *
 * **Beat-ignited fireballs.** One per detected onset, keyed on `onsetCount`
 * changing rather than on `beatPulse > x` (true on every frame of its ~400ms
 * decay) or a raw band (true through a whole sustained note). Either would
 * inject a mass spike every frame; since the burst does
 * `M = mix(M, 0.5, ...)`, that pins mass at 0.5 across a wide disc and the
 * density normalisation then drags the rest of the field down to compensate —
 * the visible result is the whole plasma dimming while one blob glows.
 *
 * **The audio hacks are gone.** `speed + amplitude * 0.2` used the RAW
 * amplitude, which is noisy at frame rate, to drive advection — jitter, not
 * music. Band count was `+ mids * 0.1` on a base of 25, a 0.4% change, i.e.
 * invisible. Both now come from `u_energy` at meaningful depth. The colour
 * cycling switch was also a boolean branch on the LOOK, so the palette jumped
 * on the first frame of playback; it is removed rather than smoothed, because
 * the three stops encode which sine band a pixel is in and drifting them
 * destroys the iridescence they exist to produce.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  type ResolvedAudio,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { PlasmaConfig, ShaderConfig } from '../shader-config';
import { PLASMA_DISPLAY_FRAG } from '../shaders/plasma-display.frag';
import { PLASMA_SIM_FRAG } from '../shaders/plasma-sim.frag';
import {
  createDoubleFBO,
  createProgram,
  createQuad,
  type DoubleFBO,
  destroyDoubleFBO,
  drawQuad,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

const SIM_RES = 512;

/**
 * Bounds on the 60Hz-equivalent step scale. The upper bound is load-bearing:
 * see the header note on the 2-texel PIC gather radius.
 */
const DT_SCALE_MIN = 0.5;
const DT_SCALE_MAX = 1.4;

/** Radians of band-sheen phase per second while silent. */
const IDLE_CLOCK_RATE = 0.35;
/** Radians of phase per musical beat once audio is playing. */
const RAD_PER_BEAT = 2.0;
/**
 * Ceiling on the differentiated musical rate. The render loop pauses (hidden
 * tab, preset switch, reduced motion) while the analyser clamps its own dt
 * rather than freezing, so the first frame after a long pause can carry a large
 * phase jump; differentiating that unclamped is one visible lurch.
 */
const MAX_CLOCK_RATE = 2.0;

/**
 * Init shader: two counter-rotating vortices, random grid kicks, and a faint
 * density gradient. Velocity is in TEXEL units per step, not UV units.
 */
const PLASMA_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

#define PI 3.14159265
#define R 512.0

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 pos = v_uv * R;

  // Two counter-rotating vortices: V = 0.5 * Rot(PI/2) * dx * gauss(dx / 30)
  vec2 dx0 = pos - vec2(R * 0.3);
  vec2 dx1 = pos - vec2(R * 0.7);
  vec2 V = 0.5 * vec2(-dx0.y, dx0.x) * exp(-dot(dx0, dx0) / 900.0)
         - 0.5 * vec2(-dx1.y, dx1.x) * exp(-dot(dx1, dx1) / 900.0);

  // Random grid kicks so the vortices have something asymmetric to fold.
  float h = hash21(floor(pos / 20.0));
  V += 0.2 * vec2(cos(2.0 * PI * h), sin(2.0 * PI * h));

  // Same CFL cap the sim enforces.
  float spd = length(V);
  if (spd > 1.0) V /= spd;

  // Faint mass gradient, and the same value in the smoothed channel so the
  // first step's sensors read something sane rather than zero.
  float M = 0.1 + v_uv.x * 0.01 + v_uv.y * 0.01;
  fragColor = vec4(V, M, M);
}
`;

const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uMouse',
  'uMouseActive',
  'uBurst',
  'uSpeed',
  'uPressure',
  'uTurn',
  'uDiffusion',
  'uDtScale',
  ...AUDIO_UNIFORM_NAMES,
] as const;

const DISPLAY_UNIFORM_NAMES = [
  'uState',
  'uColorPrimary',
  'uColorSecondary',
  'uColorAccent',
  'uBgColor',
  'uIntensity',
  'uGrain',
  'uVignette',
  'uTime',
  'uBands',
  'uClock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

const DEFAULTS = {
  speed: 0.8,
  bands: 25.0,
  pressure: 0.9,
  turn: 0.11,
  diffusion: 1.2,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/**
 * Ceiling on the audio-lifted advection speed. With DT_SCALE_MAX, the sim's
 * 1-texel velocity cap and the sim's 1.25x beat-pace ceiling, this bounds
 * parcel travel at 1.84 texels per step — inside the 2-texel PIC gather radius,
 * past which a parcel's mass is dropped by every cell.
 */
const MAX_SPEED = 1.05;

export function createPlasmaRenderer(): ShaderRenderer {
  let initProg: WebGLProgram | null = null;
  let simProg: WebGLProgram | null = null;
  let displayProg: WebGLProgram | null = null;

  let simU: Record<
    (typeof SIM_UNIFORM_NAMES)[number],
    WebGLUniformLocation | null
  > | null = null;
  let displayU: Record<
    (typeof DISPLAY_UNIFORM_NAMES)[number],
    WebGLUniformLocation | null
  > | null = null;

  let quad: ReturnType<typeof createQuad> | null = null;
  let simBuf: DoubleFBO | null = null;

  // Per-instance, never module-level: two live renderers (a hero and an
  // immersive overlay) would otherwise share and fight over this state.
  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  /** Accumulated band-sheen phase, monotone by construction. */
  let clock = 0;
  /** Previous beatPhase sample, or -1 when there is none to difference. */
  let prevBeatPhase = -1;
  /** Last onset acted on, so a beat ignites exactly one fireball. */
  let lastOnsetSeen = -1;

  // ── Sim step helper ────────────────────────────────────────
  function stepSim(
    gl: WebGL2RenderingContext,
    mouseX: number,
    mouseY: number,
    mouseOn: boolean,
    burst: number,
    speed: number,
    dtScale: number,
    cfg: PlasmaConfig,
    audio: ResolvedAudio
  ): void {
    if (!simProg || !simU || !simBuf || !quad) return;

    gl.viewport(0, 0, SIM_RES, SIM_RES);
    gl.useProgram(simProg);
    quad.bind(simProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
    gl.uniform1i(simU.uState, 0);

    const tx = 1.0 / SIM_RES;
    gl.uniform2f(simU.uTexel, tx, tx);
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uBurst, burst);
    gl.uniform1f(simU.uSpeed, speed);
    gl.uniform1f(simU.uPressure, cfg.pressure ?? DEFAULTS.pressure);
    gl.uniform1f(simU.uTurn, cfg.turn ?? DEFAULTS.turn);
    gl.uniform1f(simU.uDiffusion, cfg.diffusion ?? DEFAULTS.diffusion);
    gl.uniform1f(simU.uDtScale, dtScale);

    // The sim pass reads u_energy (sensor force, pressure, mass target) and
    // u_beatPhase (advection pace), so the block must be uploaded here as well
    // as on the display pass — uniforms are per-program state.
    uploadAudioUniforms(gl, simU, audio);

    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
    drawQuad(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    simBuf.swap();
  }

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      if (!gl.getExtension('EXT_color_buffer_float')) return false;
      gl.getExtension('OES_texture_float_linear');

      initProg = createProgram(gl, VERTEX_SHADER, PLASMA_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, PLASMA_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, PLASMA_DISPLAY_FRAG);

      if (!initProg || !simProg || !displayProg) return false;

      simU = getUniforms(gl, simProg, SIM_UNIFORM_NAMES);
      displayU = getUniforms(gl, displayProg, DISPLAY_UNIFORM_NAMES);

      quad = createQuad(gl);
      simBuf = createDoubleFBO(gl, SIM_RES, SIM_RES);

      this.reset(gl);

      return true;
    },

    render(
      gl: WebGL2RenderingContext,
      time: number,
      mouse: MouseState,
      config: ShaderConfig,
      width: number,
      height: number,
      audio?: AudioState
    ): void {
      if (!simProg || !displayProg || !simU || !displayU || !simBuf || !quad)
        return;

      const cfg = config as PlasmaConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // ── Musical clock: blend RATES, then integrate ─────────
      let musicalRate = IDLE_CLOCK_RATE;
      if (!a.silent) {
        musicalRate =
          prevBeatPhase < 0
            ? IDLE_CLOCK_RATE
            : Math.min(
                MAX_CLOCK_RATE,
                Math.max(0, ((a.beatPhase - prevBeatPhase) / dt) * RAD_PER_BEAT)
              );
        prevBeatPhase = a.beatPhase;
      } else {
        prevBeatPhase = -1;
      }
      clock +=
        dt * (IDLE_CLOCK_RATE + (musicalRate - IDLE_CLOCK_RATE) * a.active);

      const dtScale = Math.min(DT_SCALE_MAX, Math.max(DT_SCALE_MIN, dt * 60));

      // Advection speed rides the slow envelope, and is capped so parcel travel
      // stays inside the PIC gather radius (see MAX_SPEED).
      const speed = Math.min(
        MAX_SPEED,
        (cfg.speed ?? DEFAULTS.speed) * (1 + a.energy * 0.25 * a.active)
      );

      // ── Beat-ignited fireball — one per detected onset ─────
      // Reuses the burst channel with the mouse parked inactive, so the beat
      // gets the mass spike and vortex kick but not the continuous mouse
      // vortex. Position comes from `beatSeed`, re-rolled per onset, so
      // consecutive beats ignite in different places.
      if (!a.silent && a.onsetCount !== lastOnsetSeen) {
        lastOnsetSeen = a.onsetCount;
        stepSim(
          gl,
          0.15 + a.beatSeed * 0.7,
          0.15 + ((a.beatSeed * 7.31) % 1.0) * 0.7,
          false,
          0.4 + a.bass * 0.6,
          speed,
          dtScale,
          cfg,
          a
        );
      }

      // ── Substep 1: with mouse input ───────────────────────
      stepSim(
        gl,
        mouse.active ? mouse.x : -10.0,
        mouse.active ? mouse.y : -10.0,
        mouse.active,
        mouse.burstStrength ?? 0.0,
        speed,
        dtScale,
        cfg,
        a
      );

      // ── Substep 2: coast (no input) ───────────────────────
      stepSim(gl, -10.0, -10.0, false, 0.0, speed, dtScale, cfg, a);

      // ── Display pass ──────────────────────────────────────
      gl.viewport(0, 0, width, height);
      gl.useProgram(displayProg);
      quad.bind(displayProg);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
      gl.uniform1i(displayU.uState, 0);

      // Brand colours pass through unmodified — see the header note on why the
      // immersive colour cycling was removed rather than smoothed.
      gl.uniform3fv(displayU.uColorPrimary, cfg.colors.primary);
      gl.uniform3fv(displayU.uColorSecondary, cfg.colors.secondary);
      gl.uniform3fv(displayU.uColorAccent, cfg.colors.accent);
      gl.uniform3fv(displayU.uBgColor, cfg.colors.bg);
      gl.uniform1f(displayU.uIntensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(displayU.uGrain, cfg.grain ?? DEFAULTS.grain);
      // Faded by the audio ramp rather than switched off, so entering immersive
      // mode is a glide instead of the vignette popping on the first beat.
      gl.uniform1f(
        displayU.uVignette,
        (cfg.vignette ?? DEFAULTS.vignette) * (1 - a.active)
      );
      gl.uniform1f(displayU.uTime, time);
      // Raw config value: the audio lift on the band count is applied in the
      // shader, where it can be gated on u_audioActive.
      gl.uniform1f(displayU.uBands, cfg.bands ?? DEFAULTS.bands);
      gl.uniform1f(displayU.uClock, clock);

      uploadAudioUniforms(gl, displayU, a);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // FBO sim resolution is fixed at 512x512.
      // Display pass viewport is set each frame in render().
    },

    reset(gl: WebGL2RenderingContext): void {
      if (!initProg || !simBuf || !quad) return;

      clock = 0;
      prevBeatPhase = -1;
      lastOnsetSeen = -1;

      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);

      // Seed both FBO sides
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    destroy(gl: WebGL2RenderingContext): void {
      if (simBuf) {
        destroyDoubleFBO(gl, simBuf);
        simBuf = null;
      }
      if (initProg) {
        gl.deleteProgram(initProg);
        initProg = null;
      }
      if (simProg) {
        gl.deleteProgram(simProg);
        simProg = null;
      }
      if (displayProg) {
        gl.deleteProgram(displayProg);
        displayProg = null;
      }
      if (quad) {
        gl.deleteBuffer(quad.buffer);
        quad = null;
      }
      simU = null;
      displayU = null;
    },
  };
}

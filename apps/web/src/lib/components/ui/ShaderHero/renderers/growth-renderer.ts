/**
 * Growth (differential growth) renderer — implements ShaderRenderer.
 *
 * SDF-based differential growth on a 512x512 ping-pong FBO. Three programs:
 * init (circular SDF seed), sim (expansion + buckling + Eikonal + senescence),
 * display (contour line, interior depth gradient, halo). Two substeps per
 * rendered frame, each scaled to a 60Hz-equivalent step.
 *
 * CRITICAL: reset() MUST write a circular SDF seed. Growth needs an initial
 * zero-contour to expand from; from an all-positive field nothing is visible
 * and nothing ever happens.
 *
 * ## What changed and why
 *
 * **Frame-rate independence.** Two substeps of fixed per-step increments meant
 * the contour advanced twice as fast on a 120Hz display. `uDtScale = dt * 60`
 * carries the frame's share of a 60Hz step. It is clamped: the sim's Eikonal
 * correction is a relaxation with coefficient 0.3 per step, so the scale must
 * stay below 1/0.3 = 3.33 for that step not to overshoot into oscillation.
 *
 * **The musical clock.** Integrated here from a blended RATE, never crossfaded
 * in the shader. `u_beatPhase` starts at zero while `uTime` may be at 60s, so
 * `mix(uTime * k, u_beatPhase, u_audioActive)` sweeps the clock backwards as
 * the ramp eases in — the buckling field would visibly reverse and the nutrient
 * wave run backwards at the exact moment playback starts.
 *
 * **Beat-seeded growth centres.** One new SDF seed per detected onset, keyed on
 * `onsetCount` changing rather than on `beatPulse > x` (true on every frame of
 * its ~400ms decay) or a raw band (true through a whole sustained note). Either
 * of those would plant dozens of seeds a second, and since seeds union into the
 * field, that fills the canvas in about a second.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  type ResolvedAudio,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { GrowthConfig, ShaderConfig } from '../shader-config';
import { GROWTH_DISPLAY_FRAG } from '../shaders/growth-display.frag';
import { GROWTH_SIM_FRAG } from '../shaders/growth-sim.frag';
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
 * Bounds on the 60Hz-equivalent step scale. The upper bound is set by the
 * sim's Eikonal relaxation (coefficient 0.3 per step, unstable at 1.0), with
 * headroom; the lower bound means a 144Hz display runs about 20% slow rather
 * than the simulation running 2.4x fast, which is the defect being fixed.
 */
const DT_SCALE_MIN = 0.4;
const DT_SCALE_MAX = 2.5;

/** Radians of nutrient-wave phase per second while silent. */
const IDLE_CLOCK_RATE = 0.3;
/** Radians of phase per musical beat once audio is playing. */
const RAD_PER_BEAT = 2.0;
/**
 * Ceiling on the differentiated musical rate. The render loop pauses (hidden
 * tab, preset switch, reduced motion) while the analyser clamps its own dt
 * rather than freezing, so one frame after a long pause can carry a large phase
 * jump; differentiating that unclamped spikes the rate for exactly one frame,
 * which is one visible lurch.
 */
const MAX_CLOCK_RATE = 1.8;

/** Init fragment shader — circular SDF seed at centre. */
const GROWTH_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  // Signed distance to a circle at the centre: negative inside, positive out.
  float dist = length(v_uv - vec2(0.5)) - 0.08;
  fragColor = vec4(dist, 0.0, 0.0, 1.0);
}
`;

/** Sim uniform names. */
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uSpeed',
  'uNoise',
  'uScale',
  'uClock',
  'uDtScale',
  'uMouse',
  'uMouseActive',
  'uSeedPos',
  'uSeedRadius',
  ...AUDIO_UNIFORM_NAMES,
] as const;

/** Display uniform names. */
const DISPLAY_UNIFORM_NAMES = [
  'uState',
  'uColorPrimary',
  'uColorSecondary',
  'uColorAccent',
  'uBgColor',
  'uIntensity',
  'uGrain',
  'uVignette',
  'uWidth',
  'uGlow',
  'uTime',
  'uClock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

export function createGrowthRenderer(): ShaderRenderer {
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

  /** Timestamp of last ambient seed. */
  let lastSeedTime = 0;
  /** Next ambient seed interval (8-15s). */
  let nextSeedInterval = 8.0 + Math.random() * 7.0;

  // Per-instance, never module-level: two live renderers (a hero and an
  // immersive overlay) would otherwise share and fight over this state.
  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  /** Accumulated wave/drift phase, monotone by construction. */
  let clock = 0;
  /** Previous beatPhase sample, or -1 when there is none to difference. */
  let prevBeatPhase = -1;
  /** Last onset acted on, so a beat plants exactly one seed. */
  let lastOnsetSeen = -1;

  // ── Sim step helper ────────────────────────────────────────
  function stepSim(
    gl: WebGL2RenderingContext,
    mouseX: number,
    mouseY: number,
    mouseOn: boolean,
    seedX: number,
    seedY: number,
    seedRadius: number,
    dtScale: number,
    cfg: GrowthConfig,
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
    gl.uniform1f(simU.uSpeed, cfg.speed);
    gl.uniform1f(simU.uNoise, cfg.noise);
    gl.uniform1f(simU.uScale, cfg.scale);
    gl.uniform1f(simU.uClock, clock);
    gl.uniform1f(simU.uDtScale, dtScale);
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform2f(simU.uSeedPos, seedX, seedY);
    gl.uniform1f(simU.uSeedRadius, seedRadius);

    // The sim pass reads u_energy and u_mids (expansion rate, buckling
    // amplitude) and u_beatPulse (the growth kick), so the block must be
    // uploaded here as well as on the display pass — uniforms are per-program.
    uploadAudioUniforms(gl, simU, audio);

    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
    drawQuad(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    simBuf.swap();
  }

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      // Check required extensions for RGBA16F FBO
      if (!gl.getExtension('EXT_color_buffer_float')) return false;
      gl.getExtension('OES_texture_float_linear');

      initProg = createProgram(gl, VERTEX_SHADER, GROWTH_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, GROWTH_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, GROWTH_DISPLAY_FRAG);

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

      const cfg = config as GrowthConfig;
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

      // ── Ambient seed (every 8-15s) ──────────────────────────
      let seedX = -10.0;
      let seedY = -10.0;
      let seedRadius = 0.08;
      if (time - lastSeedTime > nextSeedInterval) {
        lastSeedTime = time;
        nextSeedInterval = 8.0 + Math.random() * 7.0;
        seedX = 0.15 + Math.random() * 0.7;
        seedY = 0.15 + Math.random() * 0.7;
        seedRadius = 0.05 + Math.random() * 0.04;
      }

      // ── Click seed — takes precedence over the ambient one ──
      if (mouse.burstStrength > 0) {
        seedX = mouse.x;
        seedY = mouse.y;
        seedRadius = 0.05 + Math.random() * 0.04;
      }

      // ── Beat-seeded growth centre — one per detected onset ──
      // Position comes from `beatSeed` (re-rolled per onset) rather than
      // Math.random(), so consecutive beats walk around the canvas and the
      // placement is musically determined. Its own substep, so it does not
      // displace the ambient seed on the same frame.
      if (!a.silent && a.onsetCount !== lastOnsetSeen) {
        lastOnsetSeen = a.onsetCount;
        stepSim(
          gl,
          -10.0,
          -10.0,
          false,
          0.18 + a.beatSeed * 0.64,
          0.18 + ((a.beatSeed * 7.31) % 1.0) * 0.64,
          // Scaled by bass so a heavy beat plants a larger centre. Kept small:
          // a seed larger than about 0.06 reads as a disc appearing rather than
          // as growth starting.
          0.02 + a.bass * 0.025,
          dtScale,
          cfg,
          a
        );
      }

      // ── Substep 1: with input (mouse acceleration + seed) ──
      stepSim(
        gl,
        mouse.active ? mouse.x : -10.0,
        mouse.active ? mouse.y : -10.0,
        mouse.active,
        seedX,
        seedY,
        seedRadius,
        dtScale,
        cfg,
        a
      );

      // ── Substep 2: coast (no input, no seed) ───────────────
      stepSim(gl, -10.0, -10.0, false, -10.0, -10.0, 0.08, dtScale, cfg, a);

      // ── Display pass ────────────────────────────────────────
      gl.viewport(0, 0, width, height);
      gl.useProgram(displayProg);
      quad.bind(displayProg);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
      gl.uniform1i(displayU.uState, 0);

      // No immersive colour cycling: primary→secondary IS the interior depth
      // cue here, so drifting the stops would fight the shading that makes the
      // shape read as solid. Timbre reaches the accent via audioHueShift().
      gl.uniform3fv(displayU.uColorPrimary, cfg.colors.primary);
      gl.uniform3fv(displayU.uColorSecondary, cfg.colors.secondary);
      gl.uniform3fv(displayU.uColorAccent, cfg.colors.accent);
      gl.uniform3fv(displayU.uBgColor, cfg.colors.bg);
      gl.uniform1f(displayU.uIntensity, cfg.intensity);
      gl.uniform1f(displayU.uGrain, cfg.grain);
      // Faded by the audio ramp rather than switched, so entering immersive
      // mode is a glide instead of the vignette popping off on the first beat.
      gl.uniform1f(displayU.uVignette, cfg.vignette * (1 - a.active));
      gl.uniform1f(displayU.uWidth, cfg.width);
      gl.uniform1f(displayU.uGlow, cfg.glow);
      gl.uniform1f(displayU.uTime, time);
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

      lastSeedTime = 0;
      nextSeedInterval = 8.0 + Math.random() * 7.0;
      clock = 0;
      prevBeatPhase = -1;
      lastOnsetSeen = -1;

      // Write the initial circular SDF to both FBO sides
      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);

      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // No warm-up steps: the init pass already writes a valid distance field
      // and growth from a clean circle is the intended opening state. Any
      // warm-up added later must run with SILENT_AUDIO, or whatever was playing
      // at reset gets baked into the initial condition.
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

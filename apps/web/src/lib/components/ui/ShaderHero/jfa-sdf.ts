/**
 * Jump Flood Algorithm (JFA) SDF generator.
 *
 * Converts a logo alpha-mask texture into a normalized signed distance
 * field (SDF) entirely on the GPU. The SDF is reusable across frames
 * and only needs regeneration when the logo changes.
 *
 * Pipeline: seed pass → log2(N) flood passes → distance finalization
 * Total: ~11 draw calls at 512×512, well under 3ms on modern GPUs.
 *
 * The three shader programs are compiled once and cached at module scope
 * so they can be reused across preset renderers without recompilation.
 */

import { JFA_DISTANCE_FRAG } from './shaders/jfa-distance.frag';
import { JFA_SEED_FRAG } from './shaders/jfa-seed.frag';
import { JFA_STEP_FRAG } from './shaders/jfa-step.frag';
import {
  createFBOWithFormat,
  createProgram,
  destroyFBO,
  drawQuad,
  type FBO,
  getUniforms,
  VERTEX_SHADER,
} from './webgl-utils';

// ── Module-scoped program cache ───────────────────────────────────
// Compiled once per GL context, reused across all presets that need SDFs.
let cachedGL: WebGL2RenderingContext | null = null;
let seedProg: WebGLProgram | null = null;
let stepProg: WebGLProgram | null = null;
let distProg: WebGLProgram | null = null;

let seedU: Record<string, WebGLUniformLocation | null> | null = null;
let stepU: Record<string, WebGLUniformLocation | null> | null = null;
let distU: Record<string, WebGLUniformLocation | null> | null = null;

function ensurePrograms(gl: WebGL2RenderingContext): boolean {
  // Cache hit: validate handles are still live. An external `gl.deleteProgram`
  // (e.g. explicit teardown or GPU context loss recovery) doesn't null out
  // our module-scoped refs, so a stale handle could silently reach drawQuad
  // and fail with no fail-fast. `gl.isProgram(null)` is false, so the
  // nullability guard above short-circuits before we call it.
  if (
    cachedGL === gl &&
    seedProg &&
    stepProg &&
    distProg &&
    gl.isProgram(seedProg) &&
    gl.isProgram(stepProg) &&
    gl.isProgram(distProg)
  ) {
    return true;
  }

  // Context changed, first call, or any cached handle was invalidated — recompile.
  seedProg = createProgram(gl, VERTEX_SHADER, JFA_SEED_FRAG);
  stepProg = createProgram(gl, VERTEX_SHADER, JFA_STEP_FRAG);
  distProg = createProgram(gl, VERTEX_SHADER, JFA_DISTANCE_FRAG);

  if (!seedProg || !stepProg || !distProg) {
    console.warn('[JFA-SDF] Failed to compile JFA programs');
    return false;
  }

  seedU = getUniforms(gl, seedProg, ['u_logo'] as const);
  stepU = getUniforms(gl, stepProg, [
    'u_state',
    'u_stepSize',
    'u_texel',
  ] as const);
  distU = getUniforms(gl, distProg, ['u_jfa', 'u_logo'] as const);

  cachedGL = gl;
  return true;
}

/**
 * Dispose all cached JFA programs for this GL context.
 *
 * Call from ShaderHero teardown (unmount) — the cache is intentionally warm
 * across preset switches so pulse activations don't pay the ~3ms compile
 * cost every time. On actual subsystem unmount the cache would otherwise
 * leak across SPA navigations (context persists on the canvas element,
 * module stays loaded, programs orphan). Idempotent: safe to call more than
 * once or after context teardown.
 */
export function destroyJFACache(gl: WebGL2RenderingContext): void {
  if (cachedGL !== gl) return; // Cache belongs to a different context (or empty).

  if (seedProg && gl.isProgram(seedProg)) gl.deleteProgram(seedProg);
  if (stepProg && gl.isProgram(stepProg)) gl.deleteProgram(stepProg);
  if (distProg && gl.isProgram(distProg)) gl.deleteProgram(distProg);

  seedProg = null;
  stepProg = null;
  distProg = null;
  seedU = null;
  stepU = null;
  distU = null;
  cachedGL = null;
}

export interface SDFResult {
  /** The signed distance field texture (R8, single channel). */
  sdfTexture: WebGLTexture;
  /** Call to free all GPU resources associated with this SDF. */
  destroy: () => void;
}

/**
 * Generate a signed distance field from a logo alpha-mask texture.
 *
 * @param gl - WebGL2 context
 * @param logoTexture - RGBA texture where alpha=1 is inside the logo
 * @param size - Resolution (should match simulation resolution, e.g. 512)
 * @param quad - Shared fullscreen quad (from the renderer's createQuad)
 * @returns The SDF texture and a cleanup function
 */
export function generateSDF(
  gl: WebGL2RenderingContext,
  logoTexture: WebGLTexture,
  size: number,
  quad: { bind: (prog: WebGLProgram) => void }
): SDFResult {
  if (!ensurePrograms(gl)) {
    throw new Error('JFA program compilation failed');
  }

  const tx = 1.0 / size;

  // Intermediate ping-pong FBOs (RGBA16F for float UV precision)
  const fboA = createFBOWithFormat(
    gl,
    size,
    size,
    gl.RGBA16F,
    gl.RGBA,
    gl.HALF_FLOAT
  );
  const fboB = createFBOWithFormat(
    gl,
    size,
    size,
    gl.RGBA16F,
    gl.RGBA,
    gl.HALF_FLOAT
  );

  // Output SDF FBO (R8 — single channel distance, memory efficient)
  const sdfFBO = createFBOWithFormat(
    gl,
    size,
    size,
    gl.R8,
    gl.RED,
    gl.UNSIGNED_BYTE
  );

  gl.viewport(0, 0, size, size);

  // ── Pass 1: Seed initialization ───────────────────────────────
  gl.useProgram(seedProg!);
  quad.bind(seedProg!);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, logoTexture);
  gl.uniform1i(seedU!.u_logo, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboA.fbo);
  drawQuad(gl);

  // ── Passes 2..N: Jump flood steps ─────────────────────────────
  const passes = Math.ceil(Math.log2(size));
  let readFBO = fboA;
  let writeFBO = fboB;

  for (let i = 0; i < passes; i++) {
    const stepSize = 2 ** (passes - 1 - i); // size/2, size/4, ..., 1

    gl.useProgram(stepProg!);
    quad.bind(stepProg!);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, readFBO.tex);
    gl.uniform1i(stepU!.u_state, 0);
    gl.uniform1f(stepU!.u_stepSize, stepSize);
    gl.uniform2f(stepU!.u_texel, tx, tx);
    gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO.fbo);
    drawQuad(gl);

    // Swap read/write
    const tmp = readFBO;
    readFBO = writeFBO;
    writeFBO = tmp;
  }

  // ── Pass N+1: Distance finalization ───────────────────────────
  gl.useProgram(distProg!);
  quad.bind(distProg!);

  // u_jfa = final JFA result (readFBO after last swap)
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, readFBO.tex);
  gl.uniform1i(distU!.u_jfa, 0);

  // u_logo = original logo mask (for inside/outside determination)
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, logoTexture);
  gl.uniform1i(distU!.u_logo, 1);

  gl.bindFramebuffer(gl.FRAMEBUFFER, sdfFBO.fbo);
  drawQuad(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Clean up intermediate FBOs — only the SDF texture persists
  destroyFBO(gl, fboA);
  destroyFBO(gl, fboB);

  return {
    sdfTexture: sdfFBO.tex,
    destroy() {
      gl.deleteTexture(sdfFBO.tex);
      gl.deleteFramebuffer(sdfFBO.fbo);
    },
  };
}

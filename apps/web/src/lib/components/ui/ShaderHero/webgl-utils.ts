/**
 * Shared WebGL utilities for shader hero presets.
 *
 * Provides: shader compilation, program linking, fullscreen quad geometry,
 * FBO creation (single + ping-pong double), and uniform location helpers.
 * All presets use WebGL2 (GLSL ES 3.0).
 */

import { logger } from '$lib/observability';
import { bindOutput } from './output-target';

/** How much of a driver's info log a record keeps. */
const INFO_LOG_MAX = 2000;

/**
 * Who is building programs right now (`surface:preset`), for the compile and
 * link events. The renderers call `createProgram` themselves, inside their
 * `init()`, so a caller that starts one labels the whole init with
 * `withProgramLabel` instead of threading a label through every renderer.
 * An explicit `label` passed to `createProgram` wins.
 */
let programLabel: string | undefined;

/** Run `build` (a renderer's `init()`) with its programs labelled `label`. */
export function withProgramLabel<T>(label: string, build: () => T): T {
  const outer = programLabel;
  programLabel = label;
  try {
    return build();
  } finally {
    programLabel = outer;
  }
}

/** What every compile/link event carries besides the driver's log. */
function programContext(gl: WebGL2RenderingContext, label: string | undefined) {
  return {
    ...(label === undefined ? {} : { label }),
    // A lost context fails every compile; that is a different story.
    contextLost: gl.isContextLost(),
  };
}

/** A single framebuffer object with its backing texture. */
export interface FBO {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

/** A ping-pong double FBO for feedback-based simulations. */
export interface DoubleFBO {
  readonly read: FBO;
  readonly write: FBO;
  swap(): void;
}

/**
 * WebGL allocators return `null` only when the context is lost or the driver
 * is out of memory — at which point nothing downstream can work. Asserting
 * here names the failing allocation instead of letting `null` flow into
 * `bindBuffer`/`bindTexture`, where it is a LEGAL no-op that unbinds and the
 * real error surfaces much later as a blank canvas.
 */
function mustAllocate<T>(value: T | null, what: string): T {
  if (value === null) {
    throw new Error(`[ShaderHero] WebGL could not allocate ${what}`);
  }
  return value;
}

/** Compile a GLSL shader. Returns null on failure (logs error). */
function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  src: string,
  label: string | undefined
): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    // Through the app logger, so a compile failure on a visitor's GPU reaches
    // the server logs rather than only their devtools.
    logger.error('shader_hero.shader_compile_failed', {
      ...programContext(gl, label),
      stage: type === gl.VERTEX_SHADER ? 'vertex' : 'fragment',
      info: (gl.getShaderInfoLog(s) ?? '').slice(0, INFO_LOG_MAX),
    });
    gl.deleteShader(s);
    return null;
  }
  return s;
}

/**
 * Create and link a WebGL program from vertex + fragment source. `label`
 * names it in a compile or link failure; unset, the label of the init it runs
 * in (`withProgramLabel`) is used, if any.
 */
export function createProgram(
  gl: WebGL2RenderingContext,
  vSrc: string,
  fSrc: string,
  label: string | undefined = programLabel
): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vSrc, label);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fSrc, label);
  // Whichever stage did compile is freed with the failure, not leaked.
  const dropShaders = () => {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
  };
  if (!vs || !fs) {
    dropShaders();
    return null;
  }

  const p = gl.createProgram();
  if (!p) {
    dropShaders();
    return null;
  }
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);

  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    logger.error('shader_hero.program_link_failed', {
      ...programContext(gl, label),
      info: (gl.getProgramInfoLog(p) ?? '').slice(0, INFO_LOG_MAX),
    });
    gl.deleteProgram(p);
    dropShaders();
    return null;
  }

  // Shaders can be detached after linking — frees driver memory
  gl.detachShader(p, vs);
  gl.detachShader(p, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  return p;
}

/** Get uniform locations for a list of names. */
export function getUniforms<T extends string>(
  gl: WebGL2RenderingContext,
  prog: WebGLProgram,
  names: readonly T[]
): Record<T, WebGLUniformLocation | null> {
  const u = {} as Record<T, WebGLUniformLocation | null>;
  for (const n of names) {
    u[n] = gl.getUniformLocation(prog, n);
  }
  return u;
}

/** Create a fullscreen quad vertex buffer and return a bind function. */
export function createQuad(gl: WebGL2RenderingContext): {
  buffer: WebGLBuffer;
  bind: (prog: WebGLProgram) => void;
} {
  const buffer = mustAllocate(gl.createBuffer(), 'a vertex buffer');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );

  return {
    buffer,
    bind(prog: WebGLProgram) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const a = gl.getAttribLocation(prog, 'a_position');
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    },
  };
}

/** Draw the fullscreen quad (4 vertices, TRIANGLE_STRIP). */
export function drawQuad(gl: WebGL2RenderingContext): void {
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/**
 * Create an FBO with a specific internal format.
 * Generalizes createFBO for use cases beyond RGBA16F (e.g., R8 for SDFs).
 */
export function createFBOWithFormat(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  internalFormat: number,
  format: number,
  type: number,
  filter: number = gl.LINEAR
): FBO {
  const tex = mustAllocate(gl.createTexture(), 'a texture');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = mustAllocate(gl.createFramebuffer(), 'a framebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    tex,
    0
  );
  bindOutput(gl);

  return { fbo, tex, w, h };
}

/** Create a single RGBA16F FBO at the given resolution. */
function createFBO(gl: WebGL2RenderingContext, w: number, h: number): FBO {
  return createFBOWithFormat(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
}

/** Create a ping-pong double FBO for feedback simulations. */
export function createDoubleFBO(
  gl: WebGL2RenderingContext,
  w: number,
  h: number
): DoubleFBO {
  let a = createFBO(gl, w, h);
  let b = createFBO(gl, w, h);
  return {
    get read() {
      return a;
    },
    get write() {
      return b;
    },
    swap() {
      [a, b] = [b, a];
    },
  };
}

/** Shared vertex shader — fullscreen quad with UV output. */
export const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() { v_uv = a_position * 0.5 + 0.5; gl_Position = vec4(a_position, 0, 1); }`;

/** Destroy WebGL resources for a single FBO. */
export function destroyFBO(gl: WebGL2RenderingContext, fbo: FBO): void {
  gl.deleteTexture(fbo.tex);
  gl.deleteFramebuffer(fbo.fbo);
}

/** Destroy WebGL resources for a double FBO. */
export function destroyDoubleFBO(
  gl: WebGL2RenderingContext,
  dfbo: DoubleFBO
): void {
  destroyFBO(gl, dfbo.read);
  destroyFBO(gl, dfbo.write);
}

/**
 * What the single-pass presets share: one program over the full-screen quad,
 * drawn straight onto the output, the brand palette they all upload alike,
 * and the pointer they ease toward. Each preset keeps its own clocks, its own
 * uniforms and the order it sets them in.
 */
import { bindOutput } from '../output-target';
import type { MouseState } from '../renderer-types';
import {
  createProgram,
  createQuad,
  drawQuad,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

type Locations<U extends string> = Readonly<
  Record<U, WebGLUniformLocation | null>
>;

export interface SinglePass<U extends string> {
  /** Build the program and find the uniforms; false when it will not build. */
  init(gl: WebGL2RenderingContext): boolean;
  /**
   * Ready this frame's draw at `width` x `height` (viewport, program, quad)
   * and hand back the uniforms; null, touching nothing, before `init` or
   * after `destroy`.
   */
  begin(
    gl: WebGL2RenderingContext,
    width: number,
    height: number
  ): Locations<U> | null;
  /** The quad, onto the output. */
  draw(gl: WebGL2RenderingContext): void;
  destroy(gl: WebGL2RenderingContext): void;
}

export function createSinglePass<U extends string>(
  fragment: string,
  names: readonly U[]
): SinglePass<U> {
  // Held apart, not as one object: a quad that fails to allocate throws
  // after the program is built, and destroy must still free that program.
  let program: WebGLProgram | null = null;
  let uniforms: Locations<U> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;
  return {
    init(gl) {
      program = createProgram(gl, VERTEX_SHADER, fragment);
      if (!program) return false;
      uniforms = getUniforms(gl, program, names);
      quad = createQuad(gl);
      return true;
    },
    begin(gl, width, height) {
      if (!program || !uniforms || !quad) return null;
      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);
      return uniforms;
    },
    draw(gl) {
      bindOutput(gl);
      drawQuad(gl);
    },
    destroy(gl) {
      if (program) {
        gl.deleteProgram(program);
        program = null;
      }
      if (quad) {
        gl.deleteBuffer(quad.buffer);
        quad = null;
      }
      uniforms = null;
    },
  };
}

type PaletteUniform =
  | 'u_brandPrimary'
  | 'u_brandSecondary'
  | 'u_brandAccent'
  | 'u_bgColor';

/** The brand's four colours, under the names every single-pass shader reads. */
export function setPalette(
  gl: WebGL2RenderingContext,
  uniforms: Locations<PaletteUniform>,
  colours: {
    readonly primary: Float32List;
    readonly secondary: Float32List;
    readonly accent: Float32List;
    readonly bg: Float32List;
  }
): void {
  gl.uniform3fv(uniforms.u_brandPrimary, colours.primary);
  gl.uniform3fv(uniforms.u_brandSecondary, colours.secondary);
  gl.uniform3fv(uniforms.u_brandAccent, colours.accent);
  gl.uniform3fv(uniforms.u_bgColor, colours.bg);
}

/**
 * The pointer as a preset eases toward it: where it is, or the centre while
 * it is off the canvas, and how present it is (0 off, 1 on).
 */
export interface EasedPointer {
  x: number;
  y: number;
  active: number;
}

/** At rest: centred and absent. */
export const restingPointer = (): EasedPointer => ({
  x: 0.5,
  y: 0.5,
  active: 0,
});

/** Move `at` `k` (0-1) of the way to where the pointer is now. */
export function easePointer(
  at: EasedPointer,
  mouse: MouseState,
  k: number
): void {
  at.x += ((mouse.active ? mouse.x : 0.5) - at.x) * k;
  at.y += ((mouse.active ? mouse.y : 0.5) - at.y) * k;
  at.active += ((mouse.active ? 1 : 0) - at.active) * k;
}

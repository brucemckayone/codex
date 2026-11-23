/**
 * A WebGL2 stand-in for renderer tests: constants are stable numbers, creators
 * return objects, and every call a test does not name is a no-op. It counts
 * every draw made while a framebuffer is bound (a simulation pass) apart from
 * the screen draws (the display pass), and keeps the last value each named
 * uniform was set to.
 */

export interface FakeGl {
  gl: WebGL2RenderingContext;
  counts: { sim: number; screen: number };
  /** The last value set for each uniform, by name (uniform1f/1i/2f/3fv). */
  uniforms: Map<string, unknown>;
  /** Every uniform set, in order. */
  log: Array<{ name: string; value: unknown }>;
}

export function fakeGl(width = 1440, height = 900): FakeGl {
  const counts = { sim: 0, screen: 0 };
  const uniforms = new Map<string, unknown>();
  const log: Array<{ name: string; value: unknown }> = [];
  const consts = new Map<string, number>();
  let bound: unknown = null;
  const draw = () => {
    if (bound) counts.sim++;
    else counts.screen++;
  };
  const setUniform = (loc: unknown, ...value: unknown[]) => {
    if (loc && typeof loc === 'object' && 'uniform' in loc) {
      const name = String(loc.uniform);
      const v = value.length === 1 ? value[0] : value;
      uniforms.set(name, v);
      log.push({ name, value: v });
    }
  };
  const target: Record<string, unknown> = {
    drawingBufferWidth: width,
    drawingBufferHeight: height,
    getExtension: () => ({}),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    getUniformLocation: (_program: unknown, name: string) => ({
      uniform: name,
    }),
    getAttribLocation: () => 0,
    isContextLost: () => false,
    getError: () => 0,
    bindFramebuffer: (_target: number, fbo: unknown) => {
      bound = fbo;
    },
    drawArrays: draw,
    drawElements: draw,
    uniform1f: setUniform,
    uniform1i: setUniform,
    uniform2f: setUniform,
    uniform3fv: setUniform,
  };
  for (const name of [
    'createShader',
    'createProgram',
    'createBuffer',
    'createTexture',
    'createFramebuffer',
    'createVertexArray',
    'createRenderbuffer',
  ]) {
    target[name] = () => ({ name });
  }
  const gl: WebGL2RenderingContext = new Proxy(target, {
    get(t, key) {
      if (typeof key !== 'string') return undefined;
      if (key === 'checkFramebufferStatus')
        return () => gl.FRAMEBUFFER_COMPLETE;
      if (key in t) return t[key];
      if (/^[A-Z0-9_]+$/.test(key)) {
        if (!consts.has(key)) consts.set(key, 0x1000 + consts.size);
        return consts.get(key);
      }
      return () => undefined;
    },
  }) as unknown as WebGL2RenderingContext;
  return { gl, counts, uniforms, log };
}

/** A fixed Math.random sequence, for renderers with random intervals. */
export function seededRandom(seed = 7): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

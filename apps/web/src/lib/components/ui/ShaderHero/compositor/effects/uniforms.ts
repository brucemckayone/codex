/**
 * Every uniform a compositor pass may declare, with its GLSL type.
 *
 * This table is the contract between the effects and the compositor. An
 * effect lists the names it reads (`Effect.uniforms`); `assembleEffect`
 * generates the declarations from that list; the compositor sets every name
 * in the table, the samplers to their fixed texture units (`SAMPLER_UNITS`)
 * and the rest from a `UniformValues` record that TypeScript makes it fill in
 * full. `shaders:check` then proves each assembled pass declares nothing
 * outside the table. A uniform that is declared but never set reads zero,
 * legal GLSL that nothing else would catch.
 *
 * Adding a uniform: add it here, and the compositor's `frameValues` stops
 * compiling until it sets it.
 */
export const UNIFORMS = {
  /** The picture so far: the base, the blend, or the last layer's output. */
  u_scene: 'sampler2D',
  /** The second preset (blends only). */
  u_second: 'sampler2D',
  /** The name mask, red channel (`setNameMask`). */
  u_mask: 'sampler2D',
  /** The piece's video frame or image (`setMedia`, for the film frames). */
  u_media: 'sampler2D',
  /** The size, in pixels, of the target this pass draws into. */
  u_resolution: 'vec2',
  /** Seconds; stepped by the flash governor for an effect that flashes. */
  u_time: 'float',
  /** The pass's strength, 0-1. */
  u_amount: 'float',
  /** The pointer, 0-1, origin bottom left. */
  u_pointer: 'vec2',
  u_brandPrimary: 'vec3',
  u_brandSecondary: 'vec3',
  u_brandAccent: 'vec3',
  u_bgColor: 'vec3',
  /** The stage (the film's frame) in output pixels, origin bottom left. */
  u_rect: 'vec4',
  /** How much of the stage shows as the hero scrolls away, 0-1. */
  u_fade: 'float',
  /** How much of the name mask's letters show as the page scrolls, 0-1 (`nameFade`). */
  u_nameFade: 'float',
  /** The media's own size in pixels (for `coverUv`). */
  u_mediaSize: 'vec2',
  /** A placed portrait piece (`../portrait.ts` `placedRect`): x the width
   *  it is drawn at, a share of the stage's; y the share of its height that
   *  shows, 1 - its crop. (1, 1) for a piece that is not placed. */
  u_placed: 'vec2',
  /** 1 once a media frame is uploaded, else 0. */
  u_hasMedia: 'float',
  /** The Showreel's band (`FilmLook.band`): 0 none, 1 the film gives way. */
  u_band: 'float',
  /** Where the band gives way: from x to y of the stage, measured down. */
  u_ramp: 'vec2',
  /** The stills' push-in: how far the piece's picture is drawn in; 1 for none. */
  u_zoom: 'float',
  /** The surfaces' tint: the brand's OWN primary, from its
   *  tokens, never the shader's custom palette (`u_brandPrimary`). */
  u_tint: 'vec3',
  /** The duotone's dark, middle and pale (`../duotone.ts`), from the brand's
   *  own primary and ground; none at black or white. */
  u_toneDeep: 'vec3',
  u_toneMid: 'vec3',
  u_tonePale: 'vec3',
} as const;

export type UniformName = keyof typeof UNIFORMS;

/** The texture unit each sampler is bound to, the same for every pass. */
export const SAMPLER_UNITS = {
  u_scene: 0,
  u_second: 1,
  u_mask: 2,
  u_media: 3,
} as const;

export type SamplerName = keyof typeof SAMPLER_UNITS;
type ValueName = Exclude<UniformName, SamplerName>;

interface GlslValue {
  float: number;
  vec2: readonly [number, number];
  vec3: readonly [number, number, number];
  vec4: readonly [number, number, number, number];
}

/** One value per non-sampler uniform, shaped as its GLSL type. */
export type UniformValues = {
  [K in ValueName]: GlslValue[Exclude<(typeof UNIFORMS)[K], 'sampler2D'>];
};

const isSampler = (name: string): name is SamplerName => name in SAMPLER_UNITS;

/** A uniform's value: a float, a vec2, vec3 or vec4, or a packed vec4 array. */
type UniformValue = number | Float32Array | readonly number[];

/** Set one uniform by its value's shape (a packed array: `uniform4fv`). */
function uploadUniform(
  gl: WebGL2RenderingContext,
  loc: WebGLUniformLocation,
  v: UniformValue
): void {
  if (typeof v === 'number') gl.uniform1f(loc, v);
  else if (v instanceof Float32Array) gl.uniform4fv(loc, v);
  else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
  else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
  else gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
}

/**
 * Set each of a pass's uniforms: a sampler to its fixed unit, the rest from
 * `values` by their shape. A location the driver dropped (null) is skipped.
 * `values` must hold every non-sampler name the locations can name, so a
 * declared uniform is never left unset (reading zero).
 */
export function setPassUniforms<N extends string>(
  gl: WebGL2RenderingContext,
  locations: readonly (readonly [N, WebGLUniformLocation | null])[],
  values: { readonly [K in Exclude<N, SamplerName>]: UniformValue }
): void {
  for (const [name, loc] of locations) {
    if (loc === null) continue;
    if (isSampler(name)) gl.uniform1i(loc, SAMPLER_UNITS[name]);
    else uploadUniform(gl, loc, values[name]);
  }
}

/** The GLSL declarations for a pass that reads `names`. */
export function declareUniforms(names: readonly UniformName[]): string {
  return names.map((name) => `uniform ${UNIFORMS[name]} ${name};`).join('\n');
}

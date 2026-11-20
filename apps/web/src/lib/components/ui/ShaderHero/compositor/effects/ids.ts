/**
 * The ids a brand's shader stack can name, per axis (Codex-1yd58.4).
 *
 * Kept apart from the effects themselves so the stack parse
 * (`stack-config.ts`), which ShaderHero runs on every brand poll, never pulls
 * the GLSL into the hero's own chunk: a bare stack loads no compositor code.
 * The registry test pins that the registry holds exactly these ids, axis by
 * axis, so the two cannot drift.
 *
 * WP-3 ships the five blends, three frames and one layer (grain) as the
 * registry's proof. WP-8 adds the other layers, WP-5 the film frames.
 */

/** How a second preset meets the base. */
export const BLEND_IDS = [
  'mix',
  'screen',
  'multiply',
  'difference',
  'smoke-key',
] as const;
export type BlendId = (typeof BLEND_IDS)[number];

/**
 * Passes run over the picture, in order, after the blend. The ids are the
 * WP-1b lab's, so the owner's saved combos read as they were saved (WP-8).
 */
export const LAYER_IDS = [
  'grain',
  'halftone',
  'crt',
  'chroma',
  'glitch',
  'leak',
  'duotone',
  'dither',
  'ink',
  'glow',
  'mosaic',
  'liquid',
  'reeded',
  'monotone',
  'shader-light',
] as const;
export type LayerId = (typeof LAYER_IDS)[number];

/**
 * Layers only the Showreel's surface slot runs (WP-5b), never a brand's
 * stack: they read the brand shader's picture as `u_second` beside the one
 * they treat, which only that slot binds.
 */
export const SURFACE_ONLY_LAYER_IDS: readonly LayerId[] = ['shader-light'];

/** What the picture is seen through: the last pass, drawn to the canvas. */
export const FRAME_IDS = ['shader-only', 'through-name', 'name-glows'] as const;
export type FrameId = (typeof FRAME_IDS)[number];

/** The frame that draws the picture as it is: every other frame's last resort. */
export const PASSTHROUGH_FRAME: FrameId = 'shader-only';

const has = <T extends string>(ids: readonly T[], id: string): id is T =>
  (ids as readonly string[]).includes(id);

export const isBlendId = (id: string): id is BlendId => has(BLEND_IDS, id);
export const isLayerId = (id: string): id is LayerId => has(LAYER_IDS, id);
export const isFrameId = (id: string): id is FrameId => has(FRAME_IDS, id);

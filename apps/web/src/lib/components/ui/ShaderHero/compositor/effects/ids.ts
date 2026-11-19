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

/** Passes run over the picture, in order, after the blend. */
export const LAYER_IDS = ['grain'] as const;
export type LayerId = (typeof LAYER_IDS)[number];

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

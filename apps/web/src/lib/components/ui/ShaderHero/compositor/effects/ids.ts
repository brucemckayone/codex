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
 * registry's proof. WP-8 adds the other layers, WP-5 the film frames, and
 * WP-5b the portrait frame and the passes over the piece's own picture.
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

/**
 * What the picture is seen through: the last pass, drawn to the canvas. These
 * are the frames a brand's stack may name: the brand editor offers these.
 */
export const BRAND_FRAME_IDS = [
  'shader-only',
  'through-name',
  'name-glows',
] as const;
/**
 * The Showreel's film frames (WP-5, Codex-1yd58.6): the piece's film over the
 * picture, inside the stage. Only the Showreel's look names one
 * (`showreelFeed.setLook`). A brand's `shader-frame` never can: with no film
 * attached, a film frame would draw the picture and nothing of its own.
 */
const FILM_FRAME_IDS = ['film-fill', 'film-name', 'film-portrait'] as const;
export const FRAME_IDS = [...BRAND_FRAME_IDS, ...FILM_FRAME_IDS] as const;
export type FrameId = (typeof FRAME_IDS)[number];
export type FilmFrameId = (typeof FILM_FRAME_IDS)[number];
export type BrandFrameId = (typeof BRAND_FRAME_IDS)[number];

/** The frame that draws the picture as it is: every other frame's last resort. */
export const PASSTHROUGH_FRAME: BrandFrameId = 'shader-only';
/** The film filling its stage: a film frame's fallback with no name mask. */
export const FILM_FILL_FRAME: FilmFrameId = 'film-fill';
/**
 * A portrait film or picture flush right at the stage's full height, its left
 * edge fading into the brand's picture (owner, 2026-11-21). No look names it:
 * the compositor puts it in `film-fill`'s place on a landscape stage when
 * filling would crop too much of the piece (`../portrait.ts`).
 */
export const FILM_PORTRAIT_FRAME: FilmFrameId = 'film-portrait';

/**
 * The surfaces over the footage a Showreel can name: the hero option
 * `reel-surface`, beside 'none'. No halftone.
 */
export type ReelSurface = 'duotone' | 'colour' | 'grain';

/**
 * The passes run on the piece's OWN picture before a film frame samples it
 * (`../media-pass.ts`): the stills' push-in, then the look's surface. They
 * treat the film alone, so the brand's picture round it is untouched. Their
 * ids are unique across every axis (the compositor caches a pass by its id).
 */
export const MEDIA_PASS_IDS = [
  'media-push',
  'surface-duotone',
  'surface-colour',
  'surface-grain',
] as const;
export type MediaPassId = (typeof MEDIA_PASS_IDS)[number];
/** The pass that draws each surface. */
export const SURFACE_PASS: Readonly<Record<ReelSurface, MediaPassId>> = {
  duotone: 'surface-duotone',
  colour: 'surface-colour',
  grain: 'surface-grain',
};

const has = <T extends string>(ids: readonly T[], id: string): id is T =>
  (ids as readonly string[]).includes(id);

export const isBlendId = (id: string): id is BlendId => has(BLEND_IDS, id);
export const isLayerId = (id: string): id is LayerId => has(LAYER_IDS, id);
/** A frame a brand's stack may name: any but the Showreel's film frames. */
export const isBrandFrameId = (id: string): id is BrandFrameId =>
  has(BRAND_FRAME_IDS, id);

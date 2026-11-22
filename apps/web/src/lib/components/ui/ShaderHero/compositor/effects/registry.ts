/**
 * The effect registry: every blend, layer and frame a brand's shader stack can
 * name, the Showreel's passes over the piece's own picture (`MEDIA`), and how a
 * pass's source is assembled.
 *
 * Plain data and strings, importing nothing from the app, so
 * `scripts/validate-shaders.mjs` can bundle it in Node, compile every pass
 * with glslang and check its uniforms (`shaders:check`).
 */
import { blendDifference } from './blend-difference';
import { blendMix } from './blend-mix';
import { blendMultiply } from './blend-multiply';
import { blendScreen } from './blend-screen';
import { blendSmokeKey } from './blend-smoke-key';
import type {
  BlendEffect,
  Effect,
  FrameEffect,
  LayerEffect,
  MediaEffect,
} from './effect';
import { frameFilmFill } from './frame-film-fill';
import { frameFilmName } from './frame-film-name';
import { frameFilmPortrait } from './frame-film-portrait';
import { frameNameGlows } from './frame-name-glows';
import { frameShaderOnly } from './frame-shader-only';
import { frameThroughName } from './frame-through-name';
import { HEADER } from './header';
import type { BlendId, FrameId, LayerId, MediaPassId } from './ids';
import { layerChroma } from './layer-chroma';
import { layerCrt } from './layer-crt';
import { layerDither } from './layer-dither';
import { layerDuotone } from './layer-duotone';
import { layerGlitch } from './layer-glitch';
import { layerGlow } from './layer-glow';
import { layerGrain } from './layer-grain';
import { layerHalftone } from './layer-halftone';
import { layerInk } from './layer-ink';
import { layerLeak } from './layer-leak';
import { layerLiquid } from './layer-liquid';
import { layerMonotone } from './layer-monotone';
import { layerMosaic } from './layer-mosaic';
import { layerReeded } from './layer-reeded';
import { layerShaderLight } from './layer-shader-light';
import { mediaPush } from './media-push';
import { surfaceColour } from './surface-colour';
import { surfaceDuotone } from './surface-duotone';
import { surfaceGrain } from './surface-grain';
import { declareUniforms, UNIFORMS } from './uniforms';

export const BLENDS: Record<BlendId, BlendEffect> = {
  mix: blendMix,
  screen: blendScreen,
  multiply: blendMultiply,
  difference: blendDifference,
  'smoke-key': blendSmokeKey,
};

export const LAYERS: Record<LayerId, LayerEffect> = {
  grain: layerGrain,
  halftone: layerHalftone,
  crt: layerCrt,
  chroma: layerChroma,
  glitch: layerGlitch,
  leak: layerLeak,
  duotone: layerDuotone,
  dither: layerDither,
  ink: layerInk,
  glow: layerGlow,
  mosaic: layerMosaic,
  liquid: layerLiquid,
  reeded: layerReeded,
  monotone: layerMonotone,
  'shader-light': layerShaderLight,
};

export const FRAMES: Record<FrameId, FrameEffect> = {
  'shader-only': frameShaderOnly,
  'through-name': frameThroughName,
  'name-glows': frameNameGlows,
  'film-fill': frameFilmFill,
  'film-name': frameFilmName,
  'film-portrait': frameFilmPortrait,
};

/** The passes over the piece's own picture, in the order they run. */
export const MEDIA: Record<MediaPassId, MediaEffect> = {
  'media-push': mediaPush,
  'surface-duotone': surfaceDuotone,
  'surface-colour': surfaceColour,
  'surface-grain': surfaceGrain,
};

/** Every effect, for the gate and the tests. */
export const EFFECTS: readonly Effect[] = [
  ...Object.values(BLENDS),
  ...Object.values(LAYERS),
  ...Object.values(FRAMES),
  ...Object.values(MEDIA),
];

/** The fragment source of one pass: header, its uniforms, its body. */
export function assembleEffect(effect: Effect): string {
  return `${HEADER}${declareUniforms(effect.uniforms)}\n${effect.glsl}\n`;
}

/** Every uniform name the compositor can set (for `shaders:check`). */
export const SETTABLE_UNIFORMS: readonly string[] = Object.keys(UNIFORMS);

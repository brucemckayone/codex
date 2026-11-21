/**
 * The effect registry (Codex-1yd58.4, plan §5.5): every blend, layer and frame
 * a brand's shader stack can name, and how a pass's source is assembled.
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
import type { BlendEffect, Effect, FrameEffect, LayerEffect } from './effect';
import { frameFilmFill } from './frame-film-fill';
import { frameFilmName } from './frame-film-name';
import { frameNameGlows } from './frame-name-glows';
import { frameShaderOnly } from './frame-shader-only';
import { frameThroughName } from './frame-through-name';
import { HEADER } from './header';
import type { BlendId, FrameId, LayerId } from './ids';
import { layerGrain } from './layer-grain';
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
};

export const FRAMES: Record<FrameId, FrameEffect> = {
  'shader-only': frameShaderOnly,
  'through-name': frameThroughName,
  'name-glows': frameNameGlows,
  'film-fill': frameFilmFill,
  'film-name': frameFilmName,
};

/** Every effect, for the gate and the tests. */
export const EFFECTS: readonly Effect[] = [
  ...Object.values(BLENDS),
  ...Object.values(LAYERS),
  ...Object.values(FRAMES),
];

/** The fragment source of one pass: header, its uniforms, its body. */
export function assembleEffect(effect: Effect): string {
  return `${HEADER}${declareUniforms(effect.uniforms)}\n${effect.glsl}\n`;
}

/** Every uniform name the compositor can set (for `shaders:check`). */
export const SETTABLE_UNIFORMS: readonly string[] = Object.keys(UNIFORMS);

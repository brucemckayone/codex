/**
 * One compositor effect (Codex-1yd58.4, plan §5.5). A new effect is one file
 * exporting one of these, listed in `registry.ts` and its id in `ids.ts`.
 *
 * Every pass reads `u_scene` (the picture so far) at `v_uv` and writes
 * `fragColor`. A blend also reads `u_second`; a frame is the last pass and
 * draws to the canvas at the output size.
 */
import type { BlendId, FrameId, LayerId, MediaPassId } from './ids';
import type { UniformName } from './uniforms';

interface EffectBase<Axis extends string, Id extends string> {
  id: Id;
  axis: Axis;
  /** What the brand editor calls it (WP-9). */
  label: string;
  /**
   * The pass body after the shared header and the generated uniform block:
   * helper functions, then `void main()`. It declares no uniform itself;
   * `shaders:check` fails one that does.
   */
  glsl: string;
  /** Every uniform the body reads. Its declarations are generated from this. */
  uniforms: readonly UniformName[];
  /** Its strength when the stack names it without one, 0-1. */
  amount: number;
  /**
   * What runs instead on a phone (under 768 CSS px): its own id to keep it,
   * another effect of the same axis, or (a layer only) null to drop it.
   */
  phoneFallback: Id | null;
  /** The same, under `prefers-reduced-motion` (the stack draws one still). */
  reducedMotionFallback: Id | null;
  /**
   * The effect can change the picture's brightness over time. Its clock is
   * stepped by the flash governor, so it changes at most 3 times a second
   * (WCAG 2.3.1, `../flash.ts`).
   */
  flashes?: boolean;
}

export interface BlendEffect extends EffectBase<'blend', BlendId> {
  phoneFallback: BlendId;
  reducedMotionFallback: BlendId;
}
export type LayerEffect = EffectBase<'layer', LayerId>;
export interface FrameEffect extends EffectBase<'frame', FrameId> {
  phoneFallback: FrameId;
  reducedMotionFallback: FrameId;
}

/**
 * A pass over the piece's own picture, before its film frame (WP-5b,
 * `../media-pass.ts`): `u_scene` is the film or still, and it draws into a
 * target the frame then samples as `u_media`. Like a layer it may be dropped
 * (null): the push-in, under reduced motion.
 */
export type MediaEffect = EffectBase<'media', MediaPassId>;

export type Effect = BlendEffect | LayerEffect | FrameEffect | MediaEffect;

/**
 * The Showreel's motion effects (Codex-1yd58.7, plan §3 and §6): what the
 * film does between pieces, under the pointer, as the reel opens and on the
 * way into the full film.
 *
 * A motion effect is no pass of its own. Each one is a GLSL hook that the
 * Showreel's film frame calls (`film-pass.ts`), so a film with all its
 * motion is still one pass at the output size, as the v4 mock draws it. A
 * hook adds its part to a `Motion`: where the film is sampled (`warp`), how
 * much of it shows (`shows`), how torn it is (`glitch`), and light laid over
 * the frame (`glow`).
 *
 * Every hook is identity at its uniforms' REST (`restMotion`): it adds no
 * warp, multiplies `shows` by exactly 1 and adds no glow. So a frame drawn
 * at rest is the WP-5 film frame, pixel for pixel. A transition is also
 * exact at its ends: at `u_reveal` 1 the piece shows, at 0 the brand's
 * picture alone (the light leak alone adds its light there).
 */
import type {
  IntoId,
  MotionAxis,
  OpeningId,
  PointerId,
  TransId,
} from './motion-ids';
import type { FilmPassUniform } from './motion-uniforms';

interface MotionEffectBase<Axis extends MotionAxis, Id extends string> {
  id: Id;
  axis: Axis;
  /** What the brand editor calls it. */
  label: string;
  /**
   * The hook, `void <MOTION_HOOKS[axis]>(inout Motion mo, vec2 uv)`, after
   * any helper of its own (named for the effect, so no two clash). It
   * declares no uniform: the pass's declarations are generated.
   */
  glsl: string;
  /** Every uniform its own GLSL reads (the shared helpers list theirs). */
  uniforms: readonly FilmPassUniform[];
  /** What runs instead on a phone: its own id to keep it. */
  phoneFallback: Id;
  /** What runs instead under `prefers-reduced-motion`. */
  reducedMotionFallback: Id;
  /**
   * It changes the picture's brightness. It reads only the governed clock
   * (`u_flashTime`, 3 changes a second), never `u_time`, and the reveal
   * clock never turns its cut round half way (WCAG 2.3.1).
   */
  flashes?: boolean;
  /** It plays the film through the org's name: the pass needs the mask. */
  throughName?: boolean;
}

export type TransEffect = MotionEffectBase<'reel-trans', TransId>;
export type PointerEffect = MotionEffectBase<'reel-pointer', PointerId>;
export type OpeningEffect = MotionEffectBase<'reel-opening', OpeningId>;
export type IntoEffect = MotionEffectBase<'reel-film', IntoId>;
export type MotionEffect =
  | TransEffect
  | PointerEffect
  | OpeningEffect
  | IntoEffect;

/** The four effects one film frame runs. */
export interface MotionSet {
  readonly trans: TransEffect;
  readonly pointer: PointerEffect;
  readonly opening: OpeningEffect;
  readonly into: IntoEffect;
}

/** The hook each axis's effect defines. */
export const MOTION_HOOKS: Record<MotionAxis, string> = {
  'reel-trans': 'reelTrans',
  'reel-pointer': 'reelPointer',
  'reel-opening': 'reelOpening',
  'reel-film': 'reelInto',
};

/** Every uniform the shared helpers below read. */
export const MOTION_GLSL_UNIFORMS: readonly FilmPassUniform[] = [
  'u_scene',
  'u_mask',
  'u_resolution',
  'u_rect',
  'u_bgColor',
  'u_brandPrimary',
  'u_flashTime',
  'u_nameZoom',
  'u_nameCentre',
  'u_nameAlpha',
  'u_dive',
];

/**
 * What the hooks share, placed after `FILM_GLSL` (whose `film`, `inStage`
 * and `coverUv` they use) and before the hooks.
 */
export const MOTION_GLSL = `// What one frame's motion adds up to.
struct Motion {
  vec2 warp;    // added to where the film is sampled, in output uv
  float shows;  // how much of the film shows, multiplied in
  float glitch; // how torn the film is: slices and a colour split
  vec3 glow;    // light laid over the frame (screen)
};
// Output uv to aspect-true units (1 = the output's height).
vec2 aspectScale() {
  return vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
}
// Any point's place in the stage (stageLocal, for a moved point).
vec2 stageAt(vec2 uv) {
  return (uv * u_resolution - u_rect.xy) / max(u_rect.zw, vec2(1.0));
}
// The brand picture's smoke here, blurred: 0 the ground, 1 the primary.
float smokeLight(vec2 uv, float spread) {
  vec2 texel = vec2(0.0049, 0.0078) * spread;
  float sum = 0.0;
  for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++)
      sum += luma(texture(u_scene, uv + vec2(float(i), float(j)) * texel).rgb);
  float ground = luma(u_bgColor);
  float range = max(abs(luma(u_brandPrimary) - ground), 0.02);
  return clamp(abs(sum / 9.0 - ground) / range, 0.0, 1.3);
}
// The smoke burn: all of the film at level 1, none at 0; between, the
// brightest smoke shows it first (the v4 mock's burn).
float burnShows(float light, float level) {
  float t = mix(2.3, 0.5, level);
  float w = mix(0.12, 0.26, level * level * level);
  return smoothstep(t - w, t + w, 1.3 + (light - 0.5) * 0.9);
}
// The film torn into slices, its colours split, as strong as k. Its rows
// change with the governed clock only.
vec3 glitchedFilm(vec2 at, float k) {
  float row = floor(v_uv.y * 90.0);
  float h = hash12(vec2(row * 7.13, floor(u_flashTime * 14.0)));
  vec2 g = at + vec2(step(0.62, h) * (h - 0.62) * 0.3 * k, 0.0);
  vec2 split = vec2(0.007 * k, 0.0);
  vec3 c = vec3(frameFilm(stageAt(g + split)).r, frameFilm(stageAt(g)).g, frameFilm(stageAt(g - split)).b);
  if (hash12(vec2(row, floor(u_flashTime * 9.0) * 3.1)) > 1.0 - 0.05 * k) c = mix(c, u_brandPrimary, 0.4);
  return c;
}
// A point zoomed about the name's deepest point: itself at zoom 1.
vec2 nameAt(vec2 uv, float zoom) {
  return uv + (u_nameCentre - uv) * (1.0 - 1.0 / zoom);
}
// How much the letters of the name let the film through here.
float nameVeil(vec2 uv, vec2 warp) {
  vec2 nv = nameAt(uv + warp * 0.7, u_nameZoom);
  return texture(u_mask, nv).r * inStage(nv) * u_nameAlpha;
}
// A dive's rim: the letters' edges streak outward, in the brand's primary,
// as the view falls through them; strongest half way.
vec3 nameStreak(vec2 uv) {
  float sharp = texture(u_mask, nameAt(uv, u_nameZoom)).r;
  float smear = 0.0;
  for (int i = 1; i <= 8; i++)
    smear += texture(u_mask, nameAt(uv, u_nameZoom * (1.0 + 0.035 * float(i) * u_dive))).r;
  float rim = max(smear / 8.0 - sharp, 0.0);
  return u_brandPrimary * rim * sin(3.14159265 * u_dive) * 1.4;
}`;

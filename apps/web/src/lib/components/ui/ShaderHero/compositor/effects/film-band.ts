/**
 * Where a film frame's film gives way to the brand's picture: the Showreel's
 * band (`stage.ts` `FilmBand`), shared by every frame that fills its stage with
 * the film, so 'film-fill' and 'film-portrait' give way alike. GLSL text placed
 * after `FILM_GLSL` and `SMOKE_GLSL`.
 */
import type { UniformName } from './uniforms';

/** What the band reads, beside the film's and the smoke's own uniforms. */
export const BAND_UNIFORMS: readonly UniformName[] = ['u_band', 'u_ramp'];

export const BAND_GLSL = `// How much of the film the band lets through here: 1 with none.
float bandShows(vec2 local) {
  if (u_band < 0.5) return 1.0;
  float ramp = smoothstep(u_ramp.x, u_ramp.y, 1.0 - local.y);
  // under: the smoke takes the foot, the brightest smoke last
  if (u_band < 1.5)
    return smoothstep(0.24, 0.76, mix(1.3, -0.5, ramp) + (smokeLight(v_uv) - 0.5) * 0.9);
  float foot = 1.0 - ramp;
  if (u_band < 2.5) return foot;
  // edges: the sides and the top give way through the same smoke edge,
  // a band as deep as a fifth of the stage's height
  float aspect = u_rect.z / max(u_rect.w, 1.0);
  float edge = min(min(local.x, 1.0 - local.x) * aspect, 1.0 - local.y);
  float inward = smoothstep(0.0, 0.2, edge);
  return foot * smoothstep(0.24, 0.76, mix(-0.5, 1.3, inward) + (smokeLight(v_uv) - 0.5) * 0.9);
}`;

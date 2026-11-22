/**
 * What every compositor pass starts with (ported from the shader lab's HEADER,
 * `shader-lab/src/passes.ts`): the version, the varyings the shared
 * `VERTEX_SHADER` writes, and the helpers the effects share.
 *
 * No uniform is declared here. Each pass's uniform block is generated from
 * its effect's `uniforms` list (`registry.ts` `assembleEffect`), so a pass
 * declares exactly what the compositor sets for it, and `shaders:check` can
 * prove both sides agree.
 */
export const HEADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
/** Cover-map a point inside a rect (0-1) onto media of the given size. */
vec2 coverUv(vec2 local, vec2 rectPx, vec2 mediaPx) {
  float ra = rectPx.x / max(rectPx.y, 1.0), ma = mediaPx.x / max(mediaPx.y, 1.0);
  if (ra <= 0.0 || ma <= 0.0) return local;
  vec2 uv = local;
  if (ma > ra) uv.x = 0.5 + (local.x - 0.5) * ra / ma;
  else uv.y = 0.5 + (local.y - 0.5) * ma / ra;
  return uv;
}
`;

import type { LayerEffect } from './effect';

/**
 * A curved glass screen with scanlines and a slight colour fringe: archive
 * footage, a broadcast. The curve leaves the corners in the brand's
 * background, never black, so a light brand keeps its ground. Still: no clock.
 */
export const layerCrt: LayerEffect = {
  id: 'crt',
  axis: 'layer',
  label: 'Scanlines',
  uniforms: ['u_scene', 'u_amount', 'u_bgColor'],
  amount: 0.8,
  phoneFallback: 'crt',
  reducedMotionFallback: 'crt',
  glsl: `void main() {
  vec2 uv = v_uv - 0.5;
  uv *= 1.0 + 0.09 * u_amount * dot(uv, uv);
  uv += 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(u_bgColor, 1.0);
    return;
  }
  float off = 0.0018 * u_amount;
  vec3 c = vec3(
    texture(u_scene, uv + vec2(off, 0.0)).r,
    texture(u_scene, uv).g,
    texture(u_scene, uv - vec2(off, 0.0)).b
  );
  float line = 0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159 * 0.5);
  c *= mix(1.0, 0.62 + 0.38 * line, u_amount);
  float m = mod(gl_FragCoord.x, 3.0);
  vec3 trip = vec3(
    m < 1.0 ? 1.0 : 0.72,
    (m >= 1.0 && m < 2.0) ? 1.0 : 0.72,
    m >= 2.0 ? 1.0 : 0.72
  );
  c *= mix(vec3(1.0), trip, 0.55 * u_amount);
  fragColor = vec4(c * (1.0 + 0.18 * u_amount), 1.0);
}`,
};

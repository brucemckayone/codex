import type { LayerEffect } from './effect';

/**
 * Slow warm leaks of the brand's accent and primary drifting in from the
 * edges, screen-blended like light on film. It adds light, so it is marked
 * as FLASHING and its clock is governed to 3 steps a second (WCAG 2.3.1);
 * its drift is slow enough that each step moves it by a few thousandths of
 * the frame. Under reduced motion the one still frame keeps the leak.
 *
 * Each leak falls off as `1 - smoothstep(0, r, d)`, never the lab's
 * `smoothstep(r, 0, d)`: GLSL ES 3.00 (§8.3) leaves a smoothstep whose first
 * edge is not below its second undefined, and `shaders:check` fails one.
 */
export const layerLeak: LayerEffect = {
  id: 'leak',
  axis: 'layer',
  label: 'Light leak',
  uniforms: [
    'u_scene',
    'u_time',
    'u_amount',
    'u_brandPrimary',
    'u_brandAccent',
  ],
  amount: 0.7,
  phoneFallback: 'leak',
  reducedMotionFallback: 'leak',
  flashes: true,
  glsl: `void main() {
  vec3 c = texture(u_scene, v_uv).rgb;
  float t = u_time * 0.05;
  vec2 p = v_uv;
  float l = 1.0 - smoothstep(0.0, 0.95, length((p - vec2(0.08 + 0.3 * sin(t * 1.3), 0.82)) * vec2(1.0, 1.8)));
  l += 0.6 * (1.0 - smoothstep(0.0, 0.7, length((p - vec2(0.97, 0.22 + 0.2 * sin(t * 0.9 + 1.0))) * vec2(1.6, 1.0))));
  vec3 leak = mix(u_brandAccent, u_brandPrimary, p.y) * l * 0.9 * u_amount;
  fragColor = vec4(1.0 - (1.0 - c) * (1.0 - leak), 1.0);
}`,
};

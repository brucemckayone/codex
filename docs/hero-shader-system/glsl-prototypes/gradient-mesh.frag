/**
 * gradient-mesh.frag — Preset 1: Stripe-style Gradient Mesh (FIXED v2)
 *
 * V1 Bug: Screen-blending 3 layers washed out to near-white.
 * Screen always lightens — cascading 3 layers produces values near 1.0.
 *
 * V2 Fix: Use WEIGHTED PALETTE MAPPING instead of Screen compositing.
 * A single composite noise value maps through the 3-color brand palette
 * via oklabPalette() for perceptually uniform transitions. This matches
 * how Stripe's gradient actually works — vertex colors interpolated through
 * space, not layered on top of each other.
 *
 * Additional V2 fixes:
 * - Wider frequency spread (0.4, 0.8, 1.4 instead of 0.6, 0.7, 0.8)
 * - Gentler blob shaping (smoothstep instead of pow)
 * - Stronger vignette (30% not 15%)
 * - Film grain + color grading via postProcess()
 *
 * GPU cost: ~60 ALU ops/fragment (3 noise evals × ~20 ops each)
 * Estimated: 0.2ms desktop, 0.4ms mobile at DPR 1
 *
 * Mouse: Blobs gently shift toward cursor (displacement).
 * Scroll: Alpha fade from 30-90% scroll progress.
 *
 * Requires: common.glsl prepended
 */

void main() {
  vec2 uv = v_uv;

  // ── Mouse displacement ──────────────────────────────────────
  vec2 mouseOffset = (u_mouse - 0.5) * u_mouse_influence * 0.15;
  uv += mouseOffset;

  // ── Aspect-corrected coordinates ────────────────────────────
  vec2 p = uv * 2.0 - 1.0;
  p.x *= u_resolution.x / u_resolution.y;

  // ── Time ────────────────────────────────────────────────────
  float t = u_time * 0.1;

  // ── 3 noise fields at SPREAD frequencies ────────────────────
  // V2: frequencies 0.4/0.8/1.4 (wider spread = less simultaneous overlap)
  // Speeds: 1x/2.5x/5x ratio (creates visual depth hierarchy)
  float n1 = snoise3(vec3(p * 0.4, t * 0.15)) * 0.5 + 0.5;  // Large, slow (background)
  float n2 = snoise3(vec3(p * 0.8 + 3.7, t * 0.35)) * 0.5 + 0.5;  // Medium (midground)
  float n3 = snoise3(vec3(p * 1.4 + 7.3, t * 0.65)) * 0.5 + 0.5;  // Small, fast (foreground)

  // ── Soft blob shaping ───────────────────────────────────────
  // V2: smoothstep instead of pow — softer edges, no dead zones
  float softness = 0.25 + (1.0 - u_intensity) * 0.2; // Wider at low intensity
  n1 = smoothstep(softness, 1.0 - softness, n1);
  n2 = smoothstep(softness, 1.0 - softness, n2);
  n3 = smoothstep(softness, 1.0 - softness, n3);

  // ── Composite to single value for palette mapping ───────────
  // V2: Weighted blend into a 0-1 value, then map through palette.
  // This prevents washout because the output stays within the
  // color range of the brand palette — no additive brightening.
  //
  // Weight each layer with different influence for depth:
  // n1 dominates (0.5), n2 adds variation (0.3), n3 adds detail (0.2)
  float composite = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;

  // Add a spatial gradient bias so color distribution isn't symmetric
  composite += (uv.x * 0.15 + uv.y * 0.1 - 0.125);
  composite = clamp(composite, 0.0, 1.0);

  // ── Map through brand color palette (OKLAB for dark palettes) ─
  vec3 color = oklabPalette(composite, u_color_primary, u_color_secondary, u_color_accent);

  // ── Subtle highlight at blob peaks ──────────────────────────
  // Where the dominant blob (n1) is at max, add a gentle brightness boost
  float highlight = smoothstep(0.7, 1.0, n1) * u_intensity * 0.12;
  color += highlight;

  // ── Mouse proximity glow ────────────────────────────────────
  float mouseDist = distance(v_uv, u_mouse);
  float mouseGlow = smoothstep(0.3, 0.0, mouseDist) * u_mouse_influence * 0.08;
  color += mouseGlow;

  // ── Intensity blend ─────────────────────────────────────────
  // At intensity 0, show a flat gradient (like current CSS)
  // At intensity 1, show the full animated mesh
  vec3 flatGradient = oklabMix(u_color_primary, u_color_secondary, uv.x * 0.7 + uv.y * 0.3);
  color = mix(flatGradient, color, u_intensity);

  // ── Post-processing (film grain, contrast, vignette) ────────
  color = postProcess(color, v_uv, u_time);

  // ── Scroll fade ─────────────────────────────────────────────
  float alpha = scrollFade();

  gl_FragColor = vec4(color, alpha);
}

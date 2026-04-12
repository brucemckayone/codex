/**
 * geometric.frag — Preset 8: Kaleidoscopic Geometry
 *
 * Visual: Slowly rotating geometric patterns with N-fold symmetry.
 * Sacred geometry / mandala / Penrose feel. Sharp mathematical lines
 * that move with organic fluidity via noise modulation.
 *
 * Math: Convert to polar coordinates, apply modular symmetry
 * (repeat angle N times), draw lines via fract() and smoothstep().
 * Noise displacement adds organic movement to the geometric skeleton.
 *
 * GPU cost: ~50-70 ALU ops/fragment (atan2 + length + mod + fract + noise)
 * Estimated: 0.4ms desktop, 0.9ms mobile (0.5ms reduced)
 *
 * Mouse: Pattern center shifts toward cursor, creating a "following" effect.
 * Scroll: Alpha fade from 30-90% scroll progress.
 *
 * Requires: common.glsl prepended
 */

#define PI 3.14159265359
#define TAU 6.28318530718

void main() {
  vec2 uv = v_uv;

  // ── Center and aspect correction ────────────────────────
  vec2 p = uv * 2.0 - 1.0;
  p.x *= u_resolution.x / u_resolution.y;

  // ── Mouse influence: shift center toward cursor ─────────
  vec2 mouseCenter = (u_mouse * 2.0 - 1.0) * u_mouse_influence * 0.2;
  mouseCenter.x *= u_resolution.x / u_resolution.y;
  p -= mouseCenter;

  float t = u_time * 0.15;

  // ── Polar coordinates ───────────────────────────────────
  float radius = length(p);
  float angle = atan(p.y, p.x);

  // ── Symmetry order (complexity-driven) ──────────────────
  // complexity 0 = 4-fold, complexity 1 = 12-fold
  float symmetryFloat = 4.0 + u_complexity * 8.0; // 4-12
  float symmetry = floor(symmetryFloat);
  float segmentAngle = TAU / symmetry;

  // ── Apply rotational symmetry ───────────────────────────
  // Fold the angle into one segment, then mirror
  float foldedAngle = mod(angle + t * 0.3, segmentAngle);
  if (foldedAngle > segmentAngle * 0.5) {
    foldedAngle = segmentAngle - foldedAngle; // Mirror
  }

  // Reconstruct cartesian from folded polar
  vec2 symP = vec2(cos(foldedAngle), sin(foldedAngle)) * radius;

  // ── Noise distortion (organic movement) ─────────────────
  // Subtle noise displaces the geometric grid
  float noiseAmt = 0.1 + u_intensity * 0.15;
  float noiseX = snoise2(vec2(symP.x * 3.0 + t * 0.4, symP.y * 3.0)) * noiseAmt;
  float noiseY = snoise2(vec2(symP.y * 3.0 + t * 0.3, symP.x * 3.0 + 5.0)) * noiseAmt;
  vec2 distorted = symP + vec2(noiseX, noiseY);

  // ── Line pattern generation ─────────────────────────────
  // Multiple line sets at different angles create the geometric mesh

  // Radial lines (spokes from center)
  float radialFreq = 3.0 + u_complexity * 4.0; // 3-7 rings
  float radialLines = fract(radius * radialFreq + t * 0.1);
  radialLines = smoothstep(0.02, 0.04, radialLines) * smoothstep(0.98, 0.96, radialLines);
  radialLines = 1.0 - radialLines; // Invert: lines are bright

  // Concentric rings
  float ringFreq = 4.0 + u_complexity * 6.0;
  float rings = fract(length(distorted) * ringFreq - t * 0.15);
  rings = smoothstep(0.02, 0.05, rings) * smoothstep(0.98, 0.95, rings);
  rings = 1.0 - rings;

  // Angular spokes (in folded space)
  float spokeFreq = symmetry * 0.5;
  float spokes = fract(foldedAngle / segmentAngle * spokeFreq);
  spokes = smoothstep(0.02, 0.06, spokes) * smoothstep(0.98, 0.94, spokes);
  spokes = 1.0 - spokes;

  // ── Composite line pattern ──────────────────────────────
  // Combine line types with different weights
  float pattern = max(radialLines * 0.4, rings * 0.6);
  pattern = max(pattern, spokes * 0.3);

  // ── Radial fade (dimmer at edges) ───────────────────────
  float radialFade = smoothstep(1.5, 0.2, radius);
  pattern *= radialFade;

  // ── Color mapping ───────────────────────────────────────
  // Lines colored based on distance from center + angle
  float colorParam = fract(radius * 2.0 + foldedAngle / segmentAngle);
  vec3 lineColor = brandPalette(colorParam, u_color_primary, u_color_secondary, u_color_accent);

  // Background: very dark version of background color
  vec3 bg = u_color_bg * 0.08;

  // Combine: lines glow over dark background
  vec3 color = mix(bg, lineColor, pattern * u_intensity);

  // ── Center jewel (bright focal point) ───────────────────
  float centerGlow = smoothstep(0.15, 0.0, radius) * u_intensity * 0.5;
  vec3 centerColor = mix(u_color_primary, u_color_accent, 0.5);
  color += centerColor * centerGlow;

  // ── Rotation shimmer ────────────────────────────────────
  // Subtle brightness modulation that rotates with the pattern
  float shimmer = sin(angle * symmetry + t * 2.0) * 0.05 + 0.95;
  color *= shimmer;

  // ── Mouse proximity glow ────────────────────────────────
  float mouseDist = distance(uv, u_mouse);
  float mouseGlow = smoothstep(0.3, 0.0, mouseDist) * u_mouse_influence * 0.1;
  color += u_color_accent * mouseGlow;

  // ── Scroll fade ─────────────────────────────────────────
  float alpha = scrollFade();

  gl_FragColor = vec4(color, alpha);
}

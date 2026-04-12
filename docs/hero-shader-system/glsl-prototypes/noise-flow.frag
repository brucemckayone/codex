/**
 * noise-flow.frag — Preset 2: Linear-style Flowing Noise Field
 *
 * Visual: Organic flowing color field, like paint mixing in slow motion.
 * More dynamic and detailed than gradient-mesh. Domain warping gives the
 * characteristic "fluid" look.
 *
 * Math: FBM (1-5 octaves) + domain warping (noise of noise).
 * Time in the Z dimension of 3D noise for temporal coherence.
 * u_complexity controls octave count directly.
 *
 * GPU cost: ~100-240 ALU ops/fragment depending on complexity
 * Estimated: 0.3ms desktop, 0.8ms mobile (0.4ms at reduced complexity)
 *
 * Mouse: Cursor creates localized domain warp (field bends toward cursor).
 * Scroll: Alpha fade from 30-90% scroll progress.
 *
 * Requires: common.glsl prepended
 */

void main() {
  vec2 uv = v_uv;

  // ── Aspect-corrected, scaled coordinates ────────────────
  vec2 p = uv * 3.0;
  p.x *= u_resolution.x / u_resolution.y;

  float t = u_time * 0.15;
  int octaves = int(u_complexity * 4.0) + 1; // 1-5 octaves

  // ── Domain warping pass 1 ───────────────────────────────
  // Warp the UV coordinates with noise before the final sample.
  // This creates the characteristic fluid/paint-mixing look.
  float warp1 = fbm2(p + vec2(t * 0.3, t * 0.2), octaves);
  float warp2 = fbm2(p + vec2(-t * 0.2, t * 0.35) + 5.2, octaves);

  // Warp strength modulated by intensity
  float warpStrength = 0.3 + u_intensity * 0.4; // 0.3 to 0.7
  vec2 warped = p + vec2(warp1, warp2) * warpStrength;

  // ── Mouse interaction: localized domain warp ────────────
  // Cursor creates a "pull" in the noise field
  float mouseDist = distance(uv, u_mouse);
  float mouseWarp = smoothstep(0.35, 0.0, mouseDist) * u_mouse_influence;
  warped += (u_mouse - uv) * mouseWarp * 0.6;

  // ── Domain warping pass 2 (optional, high complexity) ───
  // Second warp pass adds finer detail at higher complexity
  if (octaves >= 3) {
    float warp3 = fbm2(warped * 0.5 + vec2(t * 0.1, -t * 0.15) + 9.8, max(octaves - 2, 1));
    warped += vec2(warp3) * 0.15;
  }

  // ── Final noise sample for color mapping ────────────────
  float n = fbm2(warped + vec2(t * 0.08), octaves);

  // Normalize to 0-1 range (fbm output is roughly -0.5 to 0.5)
  n = n * 0.5 + 0.5;

  // ── Apply contrast curve based on intensity ─────────────
  // Higher intensity = more contrast between color regions
  float contrast = 0.5 + u_intensity * 1.0; // 0.5 to 1.5
  n = pow(n, contrast);
  n = clamp(n, 0.0, 1.0);

  // ── Map noise to 3-color brand palette ──────────────────
  vec3 color = brandPalette(n, u_color_primary, u_color_secondary, u_color_accent);

  // ── Add subtle highlights at noise peaks ────────────────
  // Bright spots where all warp layers converge
  float highlight = smoothstep(0.75, 0.95, n) * u_intensity * 0.3;
  color += highlight;

  // ── Mouse glow effect ───────────────────────────────────
  // Subtle brightness increase near cursor
  float mouseGlow = smoothstep(0.3, 0.0, mouseDist) * u_mouse_influence * 0.15;
  color += mouseGlow;

  // ── Edge softening ──────────────────────────────────────
  vec2 edgeUV = v_uv * 2.0 - 1.0;
  float edgeFade = 1.0 - dot(edgeUV, edgeUV) * 0.08;
  color *= edgeFade;

  // ── Scroll fade ─────────────────────────────────────────
  float alpha = scrollFade();

  gl_FragColor = vec4(color, alpha);
}

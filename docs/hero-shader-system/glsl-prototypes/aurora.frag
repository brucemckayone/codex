/**
 * aurora.frag — Preset 3: Northern Lights / Aurora Borealis
 *
 * Visual: Horizontal luminous bands with vertical shimmer, like the northern
 * lights. Layered sine waves create curtain-like ripples. Colors flow along
 * the vertical axis: primary → secondary → accent.
 *
 * Math: 3-7 layered sin() waves at different frequencies and phases, with
 * noise displacement on X for organic movement. Vertical gradient mask
 * concentrates brightness in horizontal bands. High-frequency noise adds
 * shimmer/sparkle.
 *
 * GPU cost: ~60-80 ALU ops/fragment (5-8 sin + 2-3 noise)
 * Estimated: 0.15ms desktop, 0.3ms mobile at DPR 1
 * This is the LIGHTEST preset — ideal for mobile-first deployment.
 *
 * Mouse: Aurora bands shift vertically toward cursor. Brightness intensifies
 *        near cursor position.
 * Scroll: Alpha fade from 30-90% scroll progress.
 *
 * Requires: common.glsl prepended
 */

void main() {
  vec2 uv = v_uv;
  float t = u_time * 0.25;

  // ── Aspect correction ───────────────────────────────────────
  float aspect = u_resolution.x / u_resolution.y;

  // ── Mouse influence ─────────────────────────────────────────
  // Aurora bands shift vertically toward cursor
  float mouseShiftY = (u_mouse.y - 0.5) * u_mouse_influence * 0.2;
  // Brightness focus near cursor
  float mouseDist = distance(uv, u_mouse);
  float mouseBrightness = smoothstep(0.4, 0.0, mouseDist) * u_mouse_influence * 0.4;

  // ── Vertical position (drives color and band placement) ─────
  float yPos = uv.y + mouseShiftY;

  // ── Aurora wave layers ──────────────────────────────────────
  // Each layer has a different frequency, speed, and amplitude.
  // Noise displacement on X gives organic, non-repeating movement.
  int layers = int(u_complexity * 5.0) + 2; // 2-7 layers based on complexity

  float wave = 0.0;

  // Layer 0 — wide, slow base wave
  float noiseX0 = snoise2(vec2(uv.x * 1.5, t * 0.2)) * 0.4;
  wave += sin(uv.x * aspect * 2.0 + t * 0.3 + noiseX0) * 0.18;

  // Layer 1 — medium frequency
  if (layers >= 2) {
    float noiseX1 = snoise2(vec2(uv.x * 2.0 + 3.7, t * 0.25)) * 0.35;
    wave += sin(uv.x * aspect * 3.5 + t * 0.4 + noiseX1) * 0.14;
  }

  // Layer 2 — higher frequency curtain ripple
  if (layers >= 3) {
    float noiseX2 = snoise2(vec2(uv.x * 2.5 + 7.1, t * 0.3)) * 0.3;
    wave += sin(uv.x * aspect * 5.0 + t * 0.5 + noiseX2) * 0.10;
  }

  // Layer 3 — fine detail
  if (layers >= 4) {
    float noiseX3 = snoise2(vec2(uv.x * 3.0 + 11.3, t * 0.35)) * 0.25;
    wave += sin(uv.x * aspect * 7.0 + t * 0.55 + noiseX3) * 0.07;
  }

  // Layer 4 — very fine shimmer
  if (layers >= 5) {
    float noiseX4 = snoise2(vec2(uv.x * 3.5 + 15.7, t * 0.4)) * 0.2;
    wave += sin(uv.x * aspect * 9.0 + t * 0.65 + noiseX4) * 0.05;
  }

  // Layer 5-6 — ultra-fine (high complexity only)
  if (layers >= 6) {
    wave += sin(uv.x * aspect * 12.0 + t * 0.75) * 0.03;
  }
  if (layers >= 7) {
    wave += sin(uv.x * aspect * 15.0 + t * 0.85) * 0.02;
  }

  // ── Horizontal brightness bands ─────────────────────────────
  // Two overlapping bands of light, offset vertically
  float band1Center = 0.45 + wave;
  float band2Center = 0.60 + wave * 0.7;

  float brightness1 = smoothstep(0.25, 0.0, abs(yPos - band1Center));
  float brightness2 = smoothstep(0.20, 0.0, abs(yPos - band2Center)) * 0.7;

  float brightness = brightness1 + brightness2;

  // ── Shimmer (high-frequency noise sparkle) ──────────────────
  float shimmerNoise = snoise2(vec2(uv.x * 8.0, uv.y * 5.0 + t * 1.5));
  float shimmer = shimmerNoise * 0.12 + 0.88; // Range: 0.76 to 1.0
  brightness *= shimmer;

  // ── Vertical curtain lines (subtle) ─────────────────────────
  // Thin bright lines that move horizontally, like aurora curtain folds
  float curtain = snoise2(vec2(uv.x * 15.0 + t * 0.5, uv.y * 0.5));
  curtain = smoothstep(0.6, 0.8, curtain) * 0.15;
  brightness += curtain * brightness; // Only visible where aurora is bright

  // ── Mouse brightness boost ──────────────────────────────────
  brightness += mouseBrightness;

  // ── Color mapping ───────────────────────────────────────────
  // Map vertical position to brand color palette
  // Bottom: primary, Middle: secondary, Top: accent
  vec3 auroraColor = brandPalette(yPos, u_color_primary, u_color_secondary, u_color_accent);

  // ── Compositing ─────────────────────────────────────────────
  // Aurora rendered as additive light over a dark base
  // Use the background color (darkened) as the base
  vec3 base = u_color_bg * 0.08; // Very dark base
  vec3 glow = auroraColor * brightness * u_intensity;

  // Additive blend with soft clamping
  vec3 color = base + glow;
  color = min(color, vec3(1.0)); // Prevent overflow

  // ── Edge softening ──────────────────────────────────────────
  // Fade aurora at top and bottom edges for natural boundary
  float edgeFade = smoothstep(0.0, 0.15, uv.y) * smoothstep(1.0, 0.85, uv.y);
  color = mix(base, color, edgeFade);

  // ── Scroll fade ─────────────────────────────────────────────
  float alpha = scrollFade();

  gl_FragColor = vec4(color, alpha);
}

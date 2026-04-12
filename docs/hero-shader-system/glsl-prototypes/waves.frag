/**
 * waves.frag — Preset 6: Water Caustics / Ripple Interference
 *
 * Visual: Overlapping concentric ripples creating interference patterns.
 * Like sunlight through water — shimmering bright network of lines.
 * Click/tap adds new ripple sources.
 *
 * Math: Sum of sin waves from 3-5 origin points. Distance from each
 * origin drives the phase. Where waves constructively interfere,
 * bright caustic lines appear. Simple and very lightweight.
 *
 * GPU cost: ~50-80 ALU ops/fragment (4-6 sin + distance)
 * Estimated: 0.25ms desktop, 0.5ms mobile
 *
 * Mouse: Primary wave source follows cursor position.
 * Scroll: Alpha fade from 30-90% scroll progress.
 *
 * Requires: common.glsl prepended
 */

void main() {
  vec2 uv = v_uv;

  // ── Aspect correction ───────────────────────────────────
  vec2 p = uv;
  p.x *= u_resolution.x / u_resolution.y;

  float t = u_time * 0.4;
  int waveCount = int(u_complexity * 3.0) + 2; // 2-5 wave sources

  // ── Wave source positions ───────────────────────────────
  // Fixed sources + one mouse-following source
  vec2 sources[5];
  sources[0] = vec2(0.3 * u_resolution.x / u_resolution.y, 0.3);
  sources[1] = vec2(0.7 * u_resolution.x / u_resolution.y, 0.6);
  sources[2] = vec2(0.5 * u_resolution.x / u_resolution.y, 0.8);
  sources[3] = vec2(0.2 * u_resolution.x / u_resolution.y, 0.7);

  // Source 4: follows mouse (or slow drift if no mouse)
  sources[4] = vec2(
    mix(0.5 * u_resolution.x / u_resolution.y + sin(t * 0.2) * 0.2,
        u_mouse.x * u_resolution.x / u_resolution.y,
        u_mouse_influence),
    mix(0.5 + cos(t * 0.15) * 0.2, u_mouse.y, u_mouse_influence)
  );

  // Animate source positions slowly
  sources[0] += vec2(sin(t * 0.11) * 0.08, cos(t * 0.13) * 0.06);
  sources[1] += vec2(cos(t * 0.09) * 0.07, sin(t * 0.12) * 0.08);
  sources[2] += vec2(sin(t * 0.14) * 0.05, cos(t * 0.08) * 0.07);
  sources[3] += vec2(cos(t * 0.07) * 0.09, sin(t * 0.10) * 0.05);

  // ── Wave interference calculation ───────────────────────
  float waveSum = 0.0;
  float frequency = 12.0 + u_intensity * 8.0; // 12-20 ripples per unit
  float speed = t * 2.0;

  for (int i = 0; i < 5; i++) {
    if (i >= waveCount) break;

    float dist = distance(p, sources[i]);

    // Expanding concentric waves: sin(distance * freq - time)
    // Amplitude decays with distance (inverse sqrt for realism)
    float wave = sin(dist * frequency - speed + float(i) * 1.3);
    float amplitude = 1.0 / (1.0 + dist * 3.0); // Decay with distance

    waveSum += wave * amplitude;
  }

  // Normalize to 0-1 range
  waveSum = waveSum / float(waveCount) * 0.5 + 0.5;

  // ── Caustic brightness ──────────────────────────────────
  // Caustics appear where waves converge (bright spots)
  // Use abs and pow to create bright line network
  float caustic = pow(abs(waveSum - 0.5) * 2.0, 0.6);
  caustic = 1.0 - caustic; // Invert: bright where waves align

  // Boost contrast
  caustic = pow(caustic, 1.5 + u_intensity * 1.0);

  // ── Color mapping ───────────────────────────────────────
  // Deep water base color + bright caustic highlights
  vec3 deepColor = mix(u_color_primary, u_color_secondary, 0.3);
  deepColor *= 0.4; // Darken for depth

  vec3 brightColor = mix(u_color_secondary, u_color_accent, caustic);

  // Fresnel-like edge glow: brighter at caustic peaks
  vec3 color = mix(deepColor, brightColor, caustic * u_intensity);

  // ── Subtle surface shimmer ──────────────────────────────
  float shimmer = snoise2(vec2(p.x * 20.0, p.y * 15.0 + t * 0.8)) * 0.05;
  color += shimmer;

  // ── Mouse proximity glow ────────────────────────────────
  float mouseDist = distance(uv, u_mouse);
  float mouseGlow = smoothstep(0.25, 0.0, mouseDist) * u_mouse_influence * 0.12;
  color += u_color_accent * mouseGlow;

  // ── Scroll fade ─────────────────────────────────────────
  float alpha = scrollFade();

  gl_FragColor = vec4(color, alpha);
}

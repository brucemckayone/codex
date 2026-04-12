/**
 * particles.frag — Preset 7: Star Field / Floating Particles
 *
 * Visual: Floating dots at multiple depth layers with parallax effect.
 * Like stars, dust, or fireflies. Mouse creates a gentle wind effect.
 * NOT vertex-shader driven — uses hash-based particle placement for
 * a pure fragment shader approach (no geometry instancing needed).
 *
 * Math: Tile UV space into a grid at 3 depth layers. Hash each cell to
 * determine: particle position within cell, brightness, and size.
 * Each layer scrolls at a different speed for parallax depth.
 *
 * GPU cost: ~60-90 ALU ops/fragment (3 layers × hash + smoothstep)
 * Estimated: 0.2ms desktop, 0.4ms mobile
 *
 * Mouse: Particles shift away from cursor (wind effect).
 * Scroll: Alpha fade from 30-90% scroll progress.
 *
 * Requires: common.glsl prepended
 */

// Hash function for consistent randomness per grid cell
float cellHash(vec2 cell) {
  return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
}

// Particle at a specific cell position
// Returns brightness (0 = no particle, >0 = particle)
float particle(vec2 uv, vec2 cell, float size) {
  // Random position within cell (0-1)
  float rx = cellHash(cell);
  float ry = cellHash(cell + 17.3);

  // Particle center within this cell
  vec2 center = vec2(rx, ry);

  // Distance from fragment to particle center (in cell-local coords)
  float dist = length(uv - center);

  // Soft circle with glow
  float core = smoothstep(size, size * 0.3, dist);
  float glow = smoothstep(size * 3.0, 0.0, dist) * 0.2;

  return core + glow;
}

void main() {
  vec2 uv = v_uv;
  float t = u_time * 0.15;

  // ── Aspect correction ───────────────────────────────────
  float aspect = u_resolution.x / u_resolution.y;

  // ── Mouse wind effect ───────────────────────────────────
  // Particles shift away from cursor
  vec2 mouseWind = (uv - u_mouse) * u_mouse_influence * 0.04;

  // ── Layer parameters ────────────────────────────────────
  int layerCount = int(u_complexity * 2.0) + 1; // 1-3 layers

  float totalBrightness = 0.0;
  vec3 totalColor = vec3(0.0);

  // ── Layer 0: Background stars (small, many, slow) ───────
  {
    float density = 12.0; // Grid cells per unit
    float speed = 0.05;
    float size = 0.06;

    vec2 layerUV = uv;
    layerUV.x *= aspect;
    layerUV += mouseWind * 0.5; // Less wind on far layer
    layerUV += vec2(t * speed, t * speed * 0.3);

    vec2 grid = layerUV * density;
    vec2 cell = floor(grid);
    vec2 local = fract(grid);

    // Check this cell and neighbors for particles
    float brightness = 0.0;
    for (int dx = -1; dx <= 1; dx++) {
      for (int dy = -1; dy <= 1; dy++) {
        vec2 neighbor = cell + vec2(float(dx), float(dy));
        float p = particle(local - vec2(float(dx), float(dy)), neighbor, size);

        // Random brightness per particle
        float starBright = cellHash(neighbor + 100.0);
        starBright = pow(starBright, 2.0); // Most stars dim, few bright

        // Twinkle effect
        float twinkle = sin(t * 3.0 + cellHash(neighbor + 200.0) * 6.28) * 0.3 + 0.7;

        brightness += p * starBright * twinkle;
      }
    }

    totalBrightness += brightness * 0.4; // Layer 0 contributes 40%
    totalColor += u_color_secondary * brightness * 0.4;
  }

  // ── Layer 1: Mid-depth particles (medium, fewer, medium speed) ──
  if (layerCount >= 2) {
    float density = 7.0;
    float speed = 0.1;
    float size = 0.09;

    vec2 layerUV = uv;
    layerUV.x *= aspect;
    layerUV += mouseWind * 1.0; // Medium wind
    layerUV += vec2(t * speed, t * speed * -0.2);

    vec2 grid = layerUV * density;
    vec2 cell = floor(grid);
    vec2 local = fract(grid);

    float brightness = 0.0;
    for (int dx = -1; dx <= 1; dx++) {
      for (int dy = -1; dy <= 1; dy++) {
        vec2 neighbor = cell + vec2(float(dx), float(dy));
        float p = particle(local - vec2(float(dx), float(dy)), neighbor, size);
        float starBright = cellHash(neighbor + 300.0);
        starBright = pow(starBright, 1.5);
        float twinkle = sin(t * 2.0 + cellHash(neighbor + 400.0) * 6.28) * 0.2 + 0.8;
        brightness += p * starBright * twinkle;
      }
    }

    totalBrightness += brightness * 0.35;
    totalColor += u_color_primary * brightness * 0.35;
  }

  // ── Layer 2: Foreground particles (large, few, fast) ────
  if (layerCount >= 3) {
    float density = 4.0;
    float speed = 0.18;
    float size = 0.12;

    vec2 layerUV = uv;
    layerUV.x *= aspect;
    layerUV += mouseWind * 2.0; // Most wind on near layer
    layerUV += vec2(t * speed, t * speed * 0.15);

    vec2 grid = layerUV * density;
    vec2 cell = floor(grid);
    vec2 local = fract(grid);

    float brightness = 0.0;
    for (int dx = -1; dx <= 1; dx++) {
      for (int dy = -1; dy <= 1; dy++) {
        vec2 neighbor = cell + vec2(float(dx), float(dy));
        float p = particle(local - vec2(float(dx), float(dy)), neighbor, size);
        float starBright = cellHash(neighbor + 500.0);
        float twinkle = sin(t * 1.5 + cellHash(neighbor + 600.0) * 6.28) * 0.15 + 0.85;
        brightness += p * starBright * twinkle;
      }
    }

    totalBrightness += brightness * 0.25;
    totalColor += u_color_accent * brightness * 0.25;
  }

  // ── Compositing ─────────────────────────────────────────
  // Dark background with bright particles
  vec3 bg = u_color_bg * 0.06;

  // Additive blend: particles glow on dark background
  vec3 color = bg + totalColor * u_intensity * 2.0;
  color = min(color, vec3(1.0)); // Prevent overflow

  // ── Subtle background noise for texture ─────────────────
  float bgNoise = snoise2(uv * 5.0 + t * 0.1) * 0.015;
  color += bgNoise;

  // ── Scroll fade ─────────────────────────────────────────
  float alpha = scrollFade();

  gl_FragColor = vec4(color, alpha);
}

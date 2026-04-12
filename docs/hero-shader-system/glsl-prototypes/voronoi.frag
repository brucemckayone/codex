/**
 * voronoi.frag — Preset 4: Organic Voronoi Cells
 *
 * Visual: Organic cellular pattern like soap bubbles, honeycomb, or
 * biological cells. Cells slowly morph as seed points drift. Color
 * fills each cell based on the nearest seed's identity. Soft glowing
 * edges between cells.
 *
 * Math: Per-fragment tile-based Voronoi. Space divided into tiles, each
 * fragment checks its tile + 8 neighbors (9 distance calculations).
 * Nearest seed → cell color. Distance to 2nd nearest - nearest → edge.
 * Seeds animated with sin/cos for organic drift.
 *
 * GPU cost: ~120-150 ALU ops/fragment (9 iterations × distance + hash)
 * Estimated: 0.5ms desktop, 1.2ms mobile (0.6ms reduced)
 * This is the HEAVIEST preset — consider mobile fallback.
 *
 * Mouse: Nearest Voronoi seed follows cursor (gravity attraction).
 * Scroll: Alpha fade from 30-90% scroll progress.
 *
 * Requires: common.glsl prepended
 */

void main() {
  vec2 uv = v_uv;

  // ── Aspect correction and scaling ───────────────────────
  vec2 p = uv;
  p.x *= u_resolution.x / u_resolution.y;

  float t = u_time * 0.2;

  // Cell density: more complexity = more cells
  float density = 3.0 + u_complexity * 4.0; // 3-7 cells per unit
  p *= density;

  // ── Tile-based Voronoi ──────────────────────────────────
  vec2 tile = floor(p);
  vec2 local = fract(p);

  float minDist1 = 10.0;  // Nearest seed distance
  float minDist2 = 10.0;  // Second nearest
  vec2 nearestSeed = vec2(0.0);
  float nearestId = 0.0;

  // Check 3x3 neighborhood (current tile + 8 neighbors)
  for (int dx = -1; dx <= 1; dx++) {
    for (int dy = -1; dy <= 1; dy++) {
      vec2 neighbor = vec2(float(dx), float(dy));
      vec2 neighborTile = tile + neighbor;

      // Random seed position within this tile (animated)
      vec2 seed = hash2(neighborTile);

      // Animate seed positions with sin/cos for organic drift
      float seedHash = fract(sin(dot(neighborTile, vec2(53.7, 91.3))) * 43758.5453);
      seed += vec2(
        sin(t * (0.5 + seedHash * 0.5) + seedHash * 6.28) * 0.3,
        cos(t * (0.4 + seedHash * 0.4) + seedHash * 3.14) * 0.3
      );
      seed = 0.5 + 0.5 * seed; // Remap to 0-1 within tile

      // Mouse attraction: shift nearest seed toward mouse
      vec2 worldSeed = (neighborTile + seed) / density;
      worldSeed.x /= u_resolution.x / u_resolution.y; // Un-aspect-correct for mouse comparison
      float mouseProximity = distance(worldSeed, u_mouse);
      float attraction = smoothstep(0.25, 0.0, mouseProximity) * u_mouse_influence * 0.3;
      vec2 toMouse = (u_mouse * density * vec2(u_resolution.x / u_resolution.y, 1.0) - neighborTile - seed);
      seed += toMouse * attraction;

      // Distance from fragment to this seed
      vec2 diff = neighbor + seed - local;
      float dist = length(diff);

      // Track nearest and second nearest
      if (dist < minDist1) {
        minDist2 = minDist1;
        minDist1 = dist;
        nearestSeed = neighborTile;
        nearestId = seedHash;
      } else if (dist < minDist2) {
        minDist2 = dist;
      }
    }
  }

  // ── Edge detection ──────────────────────────────────────
  // Edge thickness: difference between 2nd and 1st nearest distance
  float edge = minDist2 - minDist1;

  // Soft edge with configurable width
  float edgeWidth = 0.05 + (1.0 - u_intensity) * 0.1; // Thinner at high intensity
  float edgeMask = smoothstep(0.0, edgeWidth, edge);

  // ── Cell coloring ───────────────────────────────────────
  // Color based on nearest seed identity (hash-derived)
  vec3 cellColor = brandPalette(nearestId, u_color_primary, u_color_secondary, u_color_accent);

  // Subtle variation within each cell based on distance to seed
  float innerGlow = 1.0 - minDist1 * 0.8; // Brighter near center
  cellColor *= 0.7 + innerGlow * 0.3;

  // ── Edge glow ───────────────────────────────────────────
  // Bright edges between cells (the "membrane" look)
  vec3 edgeColor = mix(u_color_accent, u_color_primary, edge * 5.0);
  edgeColor *= 1.3; // Brighten edges

  // ── Compositing ─────────────────────────────────────────
  vec3 color = mix(edgeColor, cellColor, edgeMask);

  // Background bleed: darken cells slightly for contrast against edges
  color = mix(u_color_bg * 0.1, color, 0.85 + u_intensity * 0.15);

  // ── Scroll fade ─────────────────────────────────────────
  float alpha = scrollFade();

  gl_FragColor = vec4(color, alpha);
}

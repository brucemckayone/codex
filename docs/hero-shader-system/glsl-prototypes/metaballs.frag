/**
 * metaballs.frag — Preset 5: Lava Lamp / Gooey Blobs
 *
 * Visual: Smooth blobby shapes that merge and separate, like a lava lamp.
 * Uses SDF (signed distance field) summation for mathematically perfect
 * smooth merging. Color derived from nearest blob center.
 *
 * Math: N blob centers animated along Lissajous curves (sin/cos paths).
 * For each fragment, sum potential = 1/distance² for all blobs.
 * Threshold the sum → inside blob. smoothstep at boundary → smooth edge.
 * One blob follows the mouse when mouse interaction is enabled.
 *
 * GPU cost: ~80-120 ALU ops/fragment (5-8 distance calculations)
 * Estimated: 0.3ms desktop, 0.7ms mobile (0.4ms reduced)
 *
 * Mouse: One blob orbits/follows the cursor position.
 * Scroll: Alpha fade from 30-90% scroll progress.
 *
 * Requires: common.glsl prepended
 */

// Maximum blob count (GLSL ES 1.0 requires constant loop bounds)
#define MAX_BLOBS 8

void main() {
  vec2 uv = v_uv;

  // ── Aspect correction ───────────────────────────────────
  vec2 p = uv;
  p.x *= u_resolution.x / u_resolution.y;

  float t = u_time * 0.3;
  int blobCount = int(u_complexity * 5.0) + 3; // 3-8 blobs

  // ── Blob center positions (Lissajous curves) ────────────
  // Each blob has unique frequency ratios for organic, non-repeating paths
  vec2 centers[MAX_BLOBS];
  float radii[MAX_BLOBS];

  // Blob 0: slow, wide orbit
  centers[0] = vec2(
    0.5 + sin(t * 0.23) * 0.3,
    0.5 + cos(t * 0.19) * 0.25
  );
  radii[0] = 0.12;

  // Blob 1: medium orbit, offset phase
  centers[1] = vec2(
    0.5 + sin(t * 0.31 + 1.7) * 0.25,
    0.5 + cos(t * 0.27 + 2.3) * 0.3
  );
  radii[1] = 0.10;

  // Blob 2: fast, tight orbit
  centers[2] = vec2(
    0.5 + sin(t * 0.41 + 3.1) * 0.2,
    0.5 + cos(t * 0.37 + 0.7) * 0.2
  );
  radii[2] = 0.09;

  // Blob 3: diagonal path
  centers[3] = vec2(
    0.5 + sin(t * 0.17 + 5.3) * 0.35,
    0.5 + sin(t * 0.23 + 4.1) * 0.28
  );
  radii[3] = 0.11;

  // Blob 4: figure-8 path
  centers[4] = vec2(
    0.5 + sin(t * 0.29) * 0.25,
    0.5 + sin(t * 0.29 * 2.0 + 1.0) * 0.15
  );
  radii[4] = 0.08;

  // Blob 5: slow ellipse
  centers[5] = vec2(
    0.5 + cos(t * 0.13 + 2.7) * 0.3,
    0.5 + sin(t * 0.11 + 1.3) * 0.25
  );
  radii[5] = 0.10;

  // Blob 6: bouncing path
  centers[6] = vec2(
    0.5 + sin(t * 0.37 + 4.7) * 0.22,
    0.5 + abs(sin(t * 0.43 + 3.1)) * 0.3 - 0.15
  );
  radii[6] = 0.07;

  // Blob 7: mouse-following blob (or slow orbit if no mouse)
  centers[7] = vec2(
    mix(0.5 + sin(t * 0.19 + 6.1) * 0.2, u_mouse.x, u_mouse_influence),
    mix(0.5 + cos(t * 0.23 + 5.7) * 0.2, u_mouse.y, u_mouse_influence)
  );
  centers[7].x *= u_resolution.x / u_resolution.y; // Aspect correct mouse blob
  radii[7] = 0.09;

  // Aspect-correct all blob centers
  for (int i = 0; i < MAX_BLOBS - 1; i++) {
    centers[i].x *= u_resolution.x / u_resolution.y;
  }

  // ── Potential field calculation ──────────────────────────
  // Sum 1/(distance² / radius²) for all active blobs
  float potential = 0.0;
  vec3 weightedColor = vec3(0.0);
  float totalWeight = 0.0;

  for (int i = 0; i < MAX_BLOBS; i++) {
    if (i >= blobCount) break;

    float dist = distance(p, centers[i]);
    float r = radii[i] * (0.8 + u_intensity * 0.4); // Radius scales with intensity

    // Inverse square falloff: creates smooth merging at overlap
    float contribution = (r * r) / (dist * dist + 0.001);
    potential += contribution;

    // Color weight based on proximity (nearest blob dominates)
    float colorWeight = contribution * contribution; // Sharpen color boundaries
    totalWeight += colorWeight;

    // Assign color based on blob index
    // Cycle through brand colors: primary, secondary, accent
    vec3 blobColor;
    int colorIdx = i - (i / 3) * 3; // mod 3 without mod()
    if (colorIdx == 0) blobColor = u_color_primary;
    else if (colorIdx == 1) blobColor = u_color_secondary;
    else blobColor = u_color_accent;

    weightedColor += blobColor * colorWeight;
  }

  // ── Threshold and anti-alias ────────────────────────────
  float threshold = 1.2; // Sum threshold for "inside blob"
  float edge = smoothstep(threshold - 0.3, threshold + 0.1, potential);

  // ── Color mixing ────────────────────────────────────────
  vec3 blobColor = weightedColor / (totalWeight + 0.001);

  // Add a subtle glow at blob edges
  float edgeGlow = smoothstep(threshold + 0.1, threshold - 0.1, potential)
                 * smoothstep(threshold - 0.8, threshold - 0.1, potential);
  vec3 glowColor = blobColor * 1.3; // Brighter at edges

  vec3 color = mix(blobColor, glowColor, edgeGlow * 0.3);

  // ── Background ──────────────────────────────────────────
  // Outside blobs: show darkened background
  vec3 bg = u_color_bg * 0.15;
  color = mix(bg, color, edge);

  // ── Scroll fade ─────────────────────────────────────────
  float alpha = scrollFade();

  // Fade out edges of canvas for soft boundary
  float canvasEdge = smoothstep(0.0, 0.05, uv.x) * smoothstep(1.0, 0.95, uv.x)
                   * smoothstep(0.0, 0.05, uv.y) * smoothstep(1.0, 0.95, uv.y);
  alpha *= canvasEdge;

  gl_FragColor = vec4(color, alpha);
}

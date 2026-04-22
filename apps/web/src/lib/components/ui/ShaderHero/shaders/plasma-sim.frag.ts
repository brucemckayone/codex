/**
 * Plasma simulation fragment shader (GLSL ES 3.0).
 *
 * Ping-pong at 512x512.
 * Buffer: RG = velocity, B = density (mass), A = smoothed density.
 *
 * Faithful to Shadertoy Wt2BR1 "Emergence of life" by michael0884.
 * Combines Buffer A (PIC transport) + Buffer B (forces) + Buffer C
 * (density smoothing) into a single pass.
 *
 * CRITICAL: The slime sensors sample SMOOTHED DENSITY (A channel),
 * NOT a trail field. The self-organization comes from agents being
 * attracted to density peaks created by their own mass — a positive
 * feedback loop. There is no pheromone/trail in the original.
 *
 * Original parameters (from Common tab):
 *   distribution_size = 1.7
 *   sense_num = 12, sense_ang = 0.2, sense_dis = 40
 *   sense_force = 0.11, force_scale = 2.0
 *   sense_oscil = 0.0 (disabled), distance_scale = 0.0
 *   density_target = 0.24, density_normalization_speed = 0.25
 *   Pressure(rho) = 0.9 * rho.z
 *   acceleration = 0.0, vorticity_confinement = 0.0
 */
export const PLASMA_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uBurst;
uniform float uSpeed;
uniform float uPressure;
uniform float uTurn;
uniform float uDiffusion;

#define PI 3.14159265

// ═══ Original parameters (hardcoded to match convergent behavior) ═══
#define DIST_SIZE 1.7        // particle distribution box width (texels)
#define SENSE_NUM 12         // sensors per side (24 total)
#define SENSE_ANG 0.2        // angular spread factor
#define SENSE_DIS 41.0       // sensor distance (1 + 40) in texels
#define SENSE_FORCE 0.11     // base sensor force magnitude
#define FORCE_SCALE 2.0      // pow(density, force_scale) response
#define DENSITY_TARGET 0.24  // normalization target
#define DENSITY_NORM_SPEED 0.25 // normalization rate

void main() {
  // ════════════════════════════════════════════════════════════
  // PHASE 1: PIC Gather Transport (Buffer A logic)
  //
  // For each neighbor in [-2,+2], check if its particle (advected
  // by velocity) overlaps this cell via AABB test. Mass-weighted
  // gather ensures conservation.
  // ════════════════════════════════════════════════════════════

  float M = 0.0;
  vec2 sumV = vec2(0.0);
  float K = DIST_SIZE;

  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 nbUV = v_uv + vec2(float(i), float(j)) * uTexel;
      vec4 data = texture(uState, nbUV);

      vec2 V0 = data.rg;
      float M0 = data.b;

      // Advect: neighbor's particle moves by V0 (in texel units)
      vec2 advPos = vec2(float(i), float(j)) + V0 * uSpeed;

      // AABB overlap between particle box and this cell [-0.5, 0.5]
      vec2 oMin = max(vec2(-0.5), advPos - K * 0.5);
      vec2 oMax = min(vec2( 0.5), advPos + K * 0.5);
      vec2 oSize = max(oMax - oMin, vec2(0.0));

      float m = M0 * oSize.x * oSize.y / (K * K);

      sumV += V0 * m;
      M += m;
    }
  }

  // Normalize velocity by total gathered mass
  vec2 V = vec2(0.0);
  if (M > 0.001) {
    V = sumV / M;
  }

  // Mass renormalization (prevents runaway density or extinction)
  float prevM = M;
  M = mix(M, DENSITY_TARGET, DENSITY_NORM_SPEED);
  V = V * prevM / max(M, 0.001);

  // ════════════════════════════════════════════════════════════
  // PHASE 2: Compute smoothed density (Buffer C logic)
  //
  // SPH-like kernel smoothing over 5x5 neighborhood.
  // Stored in A channel for sensors to read next frame.
  // ════════════════════════════════════════════════════════════

  float smoothRho = 0.001;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 nbUV = v_uv + vec2(float(i), float(j)) * uTexel;
      vec4 data = texture(uState, nbUV);
      float M0 = data.b;
      // Gaussian kernel (radius=2 texels, like original's radius=2)
      float d2 = float(i * i + j * j);
      float w = exp(-d2 / 4.0) / 2.0;
      smoothRho += M0 * w;
    }
  }

  // ════════════════════════════════════════════════════════════
  // PHASE 3: Force computation (Buffer B logic)
  // ════════════════════════════════════════════════════════════

  if (M > 0.001) {
    vec2 F = vec2(0.0);

    // ── Neighbor data for pressure ────────────────────────
    vec4 d_n = texture(uState, v_uv + vec2(0.0, uTexel.y));
    vec4 d_s = texture(uState, v_uv - vec2(0.0, uTexel.y));
    vec4 d_e = texture(uState, v_uv + vec2(uTexel.x, 0.0));
    vec4 d_w = texture(uState, v_uv - vec2(uTexel.x, 0.0));

    // ── Pressure gradient: F -= M * grad(P) ──────────────
    // Pressure(rho) = 0.9 * rho (ideal gas law from original)
    vec2 pGrad = vec2(
      0.9 * d_e.b - 0.9 * d_w.b,
      0.9 * d_n.b - 0.9 * d_s.b
    );
    F -= uPressure * M * pGrad;

    // ── Slime mold sensors ───────────────────────────────
    // Original: range(i, -sense_num, sense_num) = 24 sensors
    // Sensors sample SMOOTHED DENSITY (A channel = previous
    // frame's smoothed output), NOT trail/pheromone.
    float ang = atan(V.y, V.x);
    float dAng = SENSE_ANG * PI / float(SENSE_NUM);
    float sR = SENSE_DIS * uTexel.x; // 41 texels in UV units
    vec2 slimeF = vec2(0.0);

    for (int si = -SENSE_NUM; si <= SENSE_NUM; si++) {
      if (si == 0) continue;
      float cang = ang + float(si) * dAng;
      vec2 dir = sR * vec2(cos(cang), sin(cang));

      // *** CRITICAL: sample SMOOTHED DENSITY (A channel) ***
      float s0z = texture(uState, v_uv + dir).a;

      // Force: sense_force * Dir(ang ± PI/2) * pow(density, force_scale)
      float fs = pow(s0z, FORCE_SCALE);
      slimeF += SENSE_FORCE * vec2(
        cos(ang + sign(float(si)) * PI * 0.5),
        sin(ang + sign(float(si)) * PI * 0.5)
      ) * fs;
    }

    // Remove acceleration component, keep rotation only
    // (original: slimeF -= dot(slimeF, normalize(V)) * normalize(V))
    vec2 Vn = normalize(V + vec2(1e-6));
    slimeF -= dot(slimeF, Vn) * Vn;
    F += uTurn * slimeF / float(2 * SENSE_NUM);

    // ── Mouse: vortex force (original: Rot(PI/2)*dx*GS(dx/30)) ─
    if (uMouseActive > 0.5) {
      vec2 d = (v_uv - uMouse) * 512.0; // pixel space
      float g = exp(-dot(d, d) / 900.0);
      F += 0.1 * vec2(-d.y, d.x) * g / 512.0;
    }

    // ── Click burst ──────────────────────────────────────
    if (uBurst > 0.01) {
      vec2 d = (v_uv - uMouse) * 512.0;
      float g = exp(-dot(d, d) / 400.0);
      F += uBurst * 0.15 * vec2(-d.y, d.x) * g / 512.0;
      M = mix(M, 0.5, uBurst * g * 0.3);
    }

    // ── Integrate velocity: V += F/M ─────────────────────
    V += F / M;

    // ── Velocity limit (original caps at 1.0 pixel/frame) ─
    float spd = length(V);
    if (spd > 1.0) V /= spd;
  }

  // Output: RG = velocity, B = density, A = smoothed density
  fragColor = vec4(V, clamp(M, 0.0, 1.5), clamp(smoothRho, 0.0, 2.0));
}
`;

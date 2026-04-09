/**
 * Suture Fluid simulation fragment shader (GLSL ES 3.0).
 *
 * Faithful port of XddSRX by cornusammonis.
 * Single feedback buffer: vec3(velocity.x, velocity.y, divergence).
 * Self-sustaining via curl-rotation + divergence-pressure feedback.
 *
 * Uniforms:
 *   uState       — ping-pong simulation texture
 *   uTexel       — 1.0 / simResolution
 *   uCurlScale   — curl rotation scale (negative, e.g. -0.6)
 *   uAdvDist     — advection distance (default 6.0)
 *   uMouse       — mouse position in sim-pixel space (0..512)
 *   uMouseActive — 1.0 if mouse is over canvas, 0.0 otherwise
 *   uForce       — mouse force multiplier
 */
export const SUTURE_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uCurlScale;
uniform float uAdvDist;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uForce;

// Safe normalize: returns zero for zero-length vectors
vec2 normz(vec2 x) {
  return x == vec2(0.0) ? vec2(0.0) : normalize(x);
}

void main() {
  // Original algorithm constants (from cornusammonis XddSRX)
  const float _K0 = -20.0/6.0;  // Laplacian center weight
  const float _K1 = 4.0/6.0;    // Laplacian edge weight
  const float _K2 = 1.0/6.0;    // Laplacian corner weight
  const float ls = 0.05;         // Laplacian velocity scale
  const float ps = -0.8;         // Laplacian-of-divergence -> pressure
  const float ds = -0.05;        // divergence feedback to velocity
  const float dp = -0.04;        // divergence update from div
  const float pl = 0.3;          // divergence smoothing (Laplacian of div)
  const float pwr = 1.0;         // curl power (linear)
  const float amp = 1.0;         // self-amplification
  const float upd = 0.8;         // blend: 80% old, 20% new
  const float sq2 = 0.6;         // diagonal weight

  vec2 tx = uTexel;

  // 8-neighbor offsets
  vec2 n  = vec2(0, tx.y);
  vec2 ne = vec2(tx.x, tx.y);
  vec2 e  = vec2(tx.x, 0);
  vec2 se = vec2(tx.x, -tx.y);
  vec2 s  = vec2(0, -tx.y);
  vec2 sw = vec2(-tx.x, -tx.y);
  vec2 w  = vec2(-tx.x, 0);
  vec2 nw = vec2(-tx.x, tx.y);

  // Sample 3x3 neighborhood
  vec3 uv    = texture(uState, v_uv).xyz;
  vec3 uv_n  = texture(uState, v_uv + n).xyz;
  vec3 uv_e  = texture(uState, v_uv + e).xyz;
  vec3 uv_s  = texture(uState, v_uv + s).xyz;
  vec3 uv_w  = texture(uState, v_uv + w).xyz;
  vec3 uv_nw = texture(uState, v_uv + nw).xyz;
  vec3 uv_sw = texture(uState, v_uv + sw).xyz;
  vec3 uv_ne = texture(uState, v_uv + ne).xyz;
  vec3 uv_se = texture(uState, v_uv + se).xyz;

  // Laplacian (9-point isotropic stencil)
  vec3 lapl = _K0*uv + _K1*(uv_n + uv_e + uv_w + uv_s) + _K2*(uv_nw + uv_sw + uv_ne + uv_se);
  float sp = ps * lapl.z;  // pressure from Laplacian of divergence

  // Curl (with diagonal contributions, weight sq2=0.6)
  float curl = uv_n.x - uv_s.x - uv_e.y + uv_w.y
    + sq2 * (uv_nw.x + uv_nw.y + uv_ne.x - uv_ne.y
           + uv_sw.y - uv_sw.x - uv_se.y - uv_se.x);

  // Rotation angle from curl
  float sc = uCurlScale * sign(curl) * pow(abs(curl), pwr);

  // Divergence (with diagonal contributions)
  float div = uv_s.y - uv_n.y - uv_e.x + uv_w.x
    + sq2 * (uv_nw.x - uv_nw.y - uv_ne.x - uv_ne.y
           + uv_sw.x + uv_sw.y + uv_se.y - uv_se.x);

  // Update divergence channel
  float sd = uv.z + dp * div + pl * lapl.z;

  // Normalized velocity direction
  vec2 norm = normz(uv.xy);

  // Reverse advection with Gaussian blur
  vec2 aUv = v_uv - uv.xy * uAdvDist * tx;
  const float _G0 = 0.25;
  const float _G1 = 0.125;
  const float _G2 = 0.0625;
  vec3 ab = _G0 * texture(uState, aUv).xyz
          + _G1 * (texture(uState, aUv + n).xyz + texture(uState, aUv + e).xyz
                 + texture(uState, aUv + s).xyz + texture(uState, aUv + w).xyz)
          + _G2 * (texture(uState, aUv + nw).xyz + texture(uState, aUv + ne).xyz
                 + texture(uState, aUv + sw).xyz + texture(uState, aUv + se).xyz);

  // Velocity update: advected + Laplacian viscosity + pressure + div feedback
  float ta = amp * ab.x + ls * lapl.x + norm.x * sp + uv.x * ds * sd;
  float tb = amp * ab.y + ls * lapl.y + norm.y * sp + uv.y * ds * sd;

  // Rotate by curl
  float a = ta * cos(sc) - tb * sin(sc);
  float b = ta * sin(sc) + tb * cos(sc);

  // Blend: 80% old state, 20% new (conservative update)
  vec3 abd = upd * uv + (1.0 - upd) * vec3(a, b, sd);

  // Mouse force: Gaussian falloff in pixel space
  if (uMouseActive > 0.5) {
    vec2 pixelPos = v_uv / tx;  // current pixel position
    vec2 d = pixelPos - uMouse;
    float m = exp(-length(d) / (10.0 * uForce));
    abd.xy += m * normz(d);
  }

  // Clamp for stability (critical!)
  abd.z = clamp(abd.z, -1.0, 1.0);
  abd.xy = clamp(length(abd.xy) > 1.0 ? normz(abd.xy) : abd.xy, -1.0, 1.0);

  fragColor = vec4(abd, 0.0);
}
`;

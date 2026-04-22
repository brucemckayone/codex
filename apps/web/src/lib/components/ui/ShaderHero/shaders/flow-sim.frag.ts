/**
 * Flow simulation fragment shader (GLSL ES 3.0).
 *
 * Ping-pong at 512x512.
 * Buffer format: RG = vector field, B = divergence, A = trail accumulator.
 *
 * Self-organising curl-noise dynamical system:
 * 1. Self-advect the vector field with 3x3 Gaussian blur
 * 2. Compute curl → derive rotation angle → rotate field
 * 3. Track divergence with Laplacian smoothing
 * 4. Normalize to prevent magnitude blowup
 *
 * Adapted from Flexi's vector field dynamical system (Shadertoy XddSRX).
 */
export const FLOW_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uBurst;
uniform float uCurl;
uniform float uAdvection;
uniform float uSmoothing;
uniform float uFieldSpeed;

// ── 9-point stencil weights ─────────────────────────────────
const float _K0 = -20.0 / 6.0; // center
const float _K1 =   4.0 / 6.0; // edge neighbors
const float _K2 =   1.0 / 6.0; // corner neighbors

// ── Gaussian blur weights for advection ─────────────────────
const float _G0 = 0.25;   // center
const float _G1 = 0.125;  // edges
const float _G2 = 0.0625; // corners

const float SQ2 = 0.6;    // diagonal weight for curl/div

vec2 normz(vec2 x) {
  return length(x) < 0.0001 ? vec2(0.0) : normalize(x);
}

// Reverse advect with 3x3 Gaussian blur
vec3 advect(vec2 ab, vec2 uv, vec2 tx, float sc) {
  vec2 aUv = uv - ab * sc * tx;

  vec2 n  = vec2(0.0, tx.y);
  vec2 ne = vec2(tx.x, tx.y);
  vec2 e  = vec2(tx.x, 0.0);
  vec2 se = vec2(tx.x, -tx.y);
  vec2 s  = vec2(0.0, -tx.y);
  vec2 sw = vec2(-tx.x, -tx.y);
  vec2 w  = vec2(-tx.x, 0.0);
  vec2 nw = vec2(-tx.x, tx.y);

  vec3 c   = texture(uState, fract(aUv)).xyz;
  vec3 cN  = texture(uState, fract(aUv + n)).xyz;
  vec3 cE  = texture(uState, fract(aUv + e)).xyz;
  vec3 cS  = texture(uState, fract(aUv + s)).xyz;
  vec3 cW  = texture(uState, fract(aUv + w)).xyz;
  vec3 cNW = texture(uState, fract(aUv + nw)).xyz;
  vec3 cSW = texture(uState, fract(aUv + sw)).xyz;
  vec3 cNE = texture(uState, fract(aUv + ne)).xyz;
  vec3 cSE = texture(uState, fract(aUv + se)).xyz;

  return _G0 * c + _G1 * (cN + cE + cW + cS) + _G2 * (cNW + cSW + cNE + cSE);
}

void main() {
  vec2 tx = uTexel;

  // ── 3x3 neighborhood offsets ──────────────────────────────
  vec2 n  = vec2(0.0, tx.y);
  vec2 ne = vec2(tx.x, tx.y);
  vec2 e  = vec2(tx.x, 0.0);
  vec2 se = vec2(tx.x, -tx.y);
  vec2 s  = vec2(0.0, -tx.y);
  vec2 sw = vec2(-tx.x, -tx.y);
  vec2 w  = vec2(-tx.x, 0.0);
  vec2 nw = vec2(-tx.x, tx.y);

  // ── Sample 3x3 neighborhood ───────────────────────────────
  vec3 c   = texture(uState, fract(v_uv)).xyz;
  vec3 cN  = texture(uState, fract(v_uv + n)).xyz;
  vec3 cE  = texture(uState, fract(v_uv + e)).xyz;
  vec3 cS  = texture(uState, fract(v_uv + s)).xyz;
  vec3 cW  = texture(uState, fract(v_uv + w)).xyz;
  vec3 cNW = texture(uState, fract(v_uv + nw)).xyz;
  vec3 cSW = texture(uState, fract(v_uv + sw)).xyz;
  vec3 cNE = texture(uState, fract(v_uv + ne)).xyz;
  vec3 cSE = texture(uState, fract(v_uv + se)).xyz;

  // ── 9-point Laplacian ─────────────────────────────────────
  vec3 lapl = _K0 * c
            + _K1 * (cN + cE + cW + cS)
            + _K2 * (cNW + cSW + cNE + cSE);

  float sp = -0.8 * lapl.z; // Laplacian of divergence → pressure

  // ── Curl (vorticity) ──────────────────────────────────────
  float curl = cN.x - cS.x - cE.y + cW.y
    + SQ2 * (cNW.x + cNW.y + cNE.x - cNE.y
           + cSW.y - cSW.x - cSE.y - cSE.x);

  // Rotation angle from curl
  float sc = -uCurl * sign(curl) * pow(abs(curl), 1.0);

  // ── Divergence ────────────────────────────────────────────
  float div = cS.y - cN.y - cE.x + cW.x
    + SQ2 * (cNW.x - cNW.y - cNE.x - cNE.y
           + cSW.x + cSW.y + cSE.y - cSE.x);

  float sd = c.z + (-0.04) * div + 0.3 * lapl.z;

  // ── Self-advection ────────────────────────────────────────
  vec2 norm = normz(c.xy);
  vec3 ab = advect(c.xy, v_uv, tx, uAdvection * uFieldSpeed);

  // Update rule: advected + Laplacian smoothing + pressure correction
  float ta = ab.x + 0.05 * lapl.x + norm.x * sp + c.x * (-0.05) * sd;
  float tb = ab.y + 0.05 * lapl.y + norm.y * sp + c.y * (-0.05) * sd;

  // ── Curl rotation ─────────────────────────────────────────
  float a = ta * cos(sc) - tb * sin(sc);
  float b = ta * sin(sc) + tb * cos(sc);

  // ── Smooth update ─────────────────────────────────────────
  vec3 result = uSmoothing * c + (1.0 - uSmoothing) * vec3(a, b, sd);

  // ── Mouse interaction ─────────────────────────────────────
  if (uMouseActive > 0.5) {
    vec2 d = v_uv - uMouse;
    float m = exp(-length(d) / (20.0 * tx.x));
    result.xy += m * normz(d) * 0.5;
  }

  // ── Click burst: strong radial push + curl injection ──────
  if (uBurst > 0.01) {
    vec2 d = v_uv - uMouse;
    float m = exp(-length(d) / (15.0 * tx.x));
    result.xy += uBurst * m * normz(d);
    // Inject some curl at burst point
    result.xy += uBurst * 0.3 * m * vec2(-d.y, d.x) / max(length(d), 0.001);
  }

  // ── Clamp and normalize ───────────────────────────────────
  result.z = clamp(result.z, -1.0, 1.0);
  result.xy = length(result.xy) > 1.0 ? normz(result.xy) : result.xy;
  result.xy = clamp(result.xy, -1.0, 1.0);

  fragColor = vec4(result, 1.0);
}
`;

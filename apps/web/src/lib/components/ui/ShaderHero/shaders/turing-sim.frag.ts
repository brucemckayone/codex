/**
 * Turing Pattern simulation fragment shader (GLSL ES 3.0).
 *
 * Gray-Scott reaction-diffusion on a 512x512 ping-pong FBO.
 * RG channels = chemical concentrations A and B.
 *
 *   dA/dt = Da * lap(A) - A*B^2 + f*(1-A)
 *   dB/dt = Db * lap(B) + A*B^2 - (k+f)*B
 *
 * Uniforms:
 *   uState         — ping-pong simulation texture (RG = chemicals A, B)
 *   uTexel         — 1.0 / simResolution
 *   uFeed          — feed rate f (0.01-0.10)
 *   uKill          — kill rate k (0.04-0.07)
 *   uDa            — diffusion rate of A (0.5-2.0)
 *   uDb            — diffusion rate of B (0.1-1.0)
 *   uTime          — elapsed time in seconds
 *   uMouse         — mouse position normalized 0..1
 *   uMouseActive   — 1.0 if mouse is over canvas, 0.0 otherwise
 *   uMouseStrength — impulse strength
 *   uSeedPos       — ambient seed position (-10 if none)
 */
export const TURING_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uFeed;
uniform float uKill;
uniform float uDa;
uniform float uDb;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uMouseStrength;
uniform vec2 uSeedPos;

// ── Gaussian seed helper ────────────────────────────────────────────
float seedB(vec2 center, float radius) {
  vec2 d = v_uv - center;
  return exp(-dot(d, d) / (radius * radius));
}

void main() {
  // ── 1. Sample center + 4 neighbors ───────────────────────────────
  vec2 center = texture(uState, v_uv).rg;
  vec2 hN = texture(uState, v_uv + vec2(0.0, uTexel.y)).rg;
  vec2 hS = texture(uState, v_uv - vec2(0.0, uTexel.y)).rg;
  vec2 hE = texture(uState, v_uv + vec2(uTexel.x, 0.0)).rg;
  vec2 hW = texture(uState, v_uv - vec2(uTexel.x, 0.0)).rg;

  float A = center.r;
  float B = center.g;

  // ── 2. Laplacian for both chemicals ──────────────────────────────
  float lapA = hN.r + hS.r + hE.r + hW.r - 4.0 * A;
  float lapB = hN.g + hS.g + hE.g + hW.g - 4.0 * B;

  // ── 3. Gray-Scott reaction-diffusion ─────────────────────────────
  // Scale factor: 4-point Laplacian is ~5x stronger than the canonical
  // 9-point stencil used in standard Gray-Scott. 0.21 maps Da=1.0 to
  // the physically correct diffusion rate of ~0.2097.
  float scl = 0.21;
  float reaction = A * B * B;
  float newA = A + uDa * scl * lapA - reaction + uFeed * (1.0 - A);
  float newB = B + uDb * scl * lapB + reaction - (uKill + uFeed) * B;

  // ── 4. Mouse seeds chemical B ────────────────────────────────────
  if (uMouseActive > 0.5) {
    newB += uMouseStrength * 0.3 * seedB(uMouse, 0.025);
  }

  // ── 5. Ambient seed injection ────────────────────────────────────
  if (uSeedPos.x > -5.0) {
    newB += 0.4 * seedB(uSeedPos, 0.02);
  }

  // ── 6. Dirichlet boundary (A=1, B=0 at edges) ───────────────────
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 3.0), v_uv) *
              smoothstep(vec2(0.0), vec2(uTexel * 3.0), 1.0 - v_uv);
  float edgeMask = edge.x * edge.y;
  newA = mix(1.0, newA, edgeMask);
  newB = mix(0.0, newB, edgeMask);

  // ── 7. Clamp [0,1] ──────────────────────────────────────────────
  fragColor = vec4(clamp(newA, 0.0, 1.0), clamp(newB, 0.0, 1.0), 0.0, 1.0);
}
`;

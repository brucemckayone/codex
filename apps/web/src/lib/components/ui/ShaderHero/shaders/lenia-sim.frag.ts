/**
 * Lenia (Advanced Continuous Cellular Automata) simulation fragment shader.
 *
 * Bump-function kernel convolution + Gaussian growth function.
 * Unlike SmoothLife's ring-shaped kernel, Lenia uses a smooth bell curve peaked
 * at half the kernel radius, producing creatures with concentric internal structure.
 *
 * R channel = cell state (continuous float, 0.0 = dead, 1.0 = fully alive).
 * Concentric ring sampling for kernel convolution (~120 samples at default radius 13).
 * 256x256 sim resolution due to expensive kernel.
 */
export const LENIA_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uRadius;
uniform float uGrowth;
uniform float uWidth;
uniform float uDt;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uMouseStrength;
uniform vec2 uDropPos;

// -- Bump function kernel --
// Bell-shaped: peaked at distance r=0.5 (half radius), zero at r=0 and r=1.
// K(r) = exp(alpha - alpha / (4*r*(1-r))) for r in (0,1), K(0)=K(1)=0
// Standard Lenia kernel -- NOT a ring like SmoothLife.
float bumpKernel(float normalizedDist) {
  if (normalizedDist <= 0.0 || normalizedDist >= 1.0) return 0.0;
  float r = normalizedDist;
  float rr = 4.0 * r * (1.0 - r);
  if (rr < 0.001) return 0.0;
  float alpha = 4.0;
  return exp(alpha - alpha / rr);
}

// -- Growth function: Gaussian centred at uGrowth with width uWidth --
// G(u) = 2.0 * exp(-((u - mu)^2) / (2 * sigma^2)) - 1.0
// Returns [-1, 1]: positive near target (growth), negative far (decay)
float growthFunction(float convolution) {
  float diff = convolution - uGrowth;
  return 2.0 * exp(-(diff * diff) / (2.0 * uWidth * uWidth)) - 1.0;
}

void main() {
  float state = texture(uState, v_uv).r;

  // -- 1. Compute bump-kernel weighted convolution --
  // Sum K(|d|/R) * state(x+d) over all texels within radius R.
  // Sample in concentric rings to reduce sample count.
  float kernelSum = 0.0;
  float weightSum = 0.0;
  float R = uRadius * uTexel.x;  // radius in UV space

  for (float r = uTexel.x; r <= R; r += uTexel.x * 1.4) {
    float normalizedR = r / R;
    float w = bumpKernel(normalizedR);
    if (w < 0.001) continue;

    // Number of samples on this ring proportional to circumference
    float circumference = max(1.0, 6.2832 * r / (uTexel.x * 1.4));
    float angleStep = 6.2832 / circumference;

    for (float a = 0.0; a < 6.2832; a += angleStep) {
      vec2 offset = vec2(cos(a), sin(a)) * r;
      float s = texture(uState, v_uv + offset).r;
      kernelSum += w * s;
      weightSum += w;
    }
  }

  float convolution = kernelSum / max(weightSum, 0.001);

  // -- 2. Apply growth function (wider width for stability) --
  // Clamp uWidth to minimum 0.03 to prevent ultra-narrow growth band
  float effectiveWidth = max(uWidth, 0.03);
  float diff = convolution - uGrowth;
  float growth = 2.0 * exp(-(diff * diff) / (2.0 * effectiveWidth * effectiveWidth)) - 1.0;

  // -- 3. Integrate: smooth transition toward growth target --
  float newState = state + uDt * growth;

  // -- 4. Mouse life deposit (seed pattern) --
  if (uMouseActive > 0.5) {
    vec2 d = v_uv - uMouse;
    float radius = 0.04;
    float deposit = uMouseStrength * 0.5 * exp(-dot(d, d) / (radius * radius));
    newState += deposit;
  }

  // -- 5. Ambient deposit (keep the simulation alive) --
  if (uDropPos.x > -5.0) {
    vec2 d = v_uv - uDropPos;
    float radius = 0.06;
    newState += 0.4 * exp(-dot(d, d) / (radius * radius));
  }

  // -- 6. Clamp + edge damping --
  newState = clamp(newState, 0.0, 1.0);

  // Edge damping: smoothstep fade near boundaries (wider due to large kernel radius)
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 8.0), v_uv)
            * smoothstep(vec2(0.0), vec2(uTexel * 8.0), 1.0 - v_uv);
  newState *= edge.x * edge.y;

  fragColor = vec4(newState, 0.0, 0.0, 1.0);
}
`;

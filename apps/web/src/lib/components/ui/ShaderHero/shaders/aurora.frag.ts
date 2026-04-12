/**
 * Aurora Borealis fragment shader (GLSL ES 3.0).
 *
 * Single-pass: layered sine wave curtains with triNoise displacement.
 * Multiple translucent curtain layers at different speeds create depth.
 * Vertical Gaussian envelope concentrates brightness in horizontal bands.
 * Bottom edge shimmer via high-frequency triNoise.
 * Mouse shifts aurora position and phase. Click brightens and widens.
 * Optional star field behind the aurora curtains.
 */
export const AURORA_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_mouseActive;
uniform float u_burst;
uniform vec3 u_brandPrimary;
uniform vec3 u_brandSecondary;
uniform vec3 u_brandAccent;
uniform vec3 u_bgColor;
uniform int u_layers;
uniform float u_speed;
uniform float u_height;
uniform float u_spread;
uniform float u_shimmer;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

// -- Hash for film grain + stars --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- triNoise (nimitz-inspired non-smooth organic noise) --
float triNoise(vec2 p, float t) {
  float z = 1.5;
  float rz = 0.0;
  const mat2 triRot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 3; i++) {
    float val = abs(sin(p.x * z + t) + sin(p.y * z + t));
    rz += val / z;
    p = triRot * p * 1.45;
    z *= 2.0;
    t *= 1.3;
  }
  return rz;
}

void main() {
  float t = u_time;
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);

  // Mouse interaction
  float mouseYOffset = u_mouseActive * (u_mouse.y - 0.5) * 0.15;
  float phaseShift = u_mouseActive * (u_mouse.x - 0.5) * 1.5;

  // Optional star field (behind aurora)
  float starDensity = 300.0;
  vec2 starUV = floor(p * starDensity);
  float star = step(0.998, hash(starUV)) * (0.3 + 0.2 * sin(t * 2.0 + hash(starUV + 1.0) * 6.28));
  vec3 color = u_bgColor + vec3(star * 0.15);

  // Accumulate curtain layers (additive)
  for (int i = 0; i < 7; i++) {
    if (i >= u_layers) break;

    float layerF = float(i);
    float freq = 1.5 + layerF * 0.5;
    float phase = layerF * 2.399;
    float speedMul = 0.7 + layerF * 0.1;

    // Horizontal displacement with triNoise wobble
    float disp = sin(p.x * freq + (t + phaseShift) * speedMul * u_speed + phase)
               + triNoise(vec2(p.x * 0.5, t * 0.3 + layerF), t) * 0.3;

    // Vertical Gaussian envelope
    float centre = u_height + layerF * 0.03 + mouseYOffset;
    float env = exp(-pow((uv.y - centre) / u_spread, 2.0));

    // Bottom edge shimmer
    float bottomEdge = smoothstep(centre - u_spread, centre - u_spread * 0.5, uv.y);
    float shimmerNoise = triNoise(uv * 8.0 + vec2(t * 2.0, layerF), t * 3.0);
    float shimmerVal = (1.0 - bottomEdge) * shimmerNoise * u_shimmer * env;

    float c = env * (0.3 + 0.7 * abs(disp) * 0.5) + shimmerVal;

    // Colour blend based on layer index
    float blend = float(i) / max(float(u_layers - 1), 1.0);
    vec3 layerColor;
    if (blend < 0.5) {
      layerColor = mix(u_brandPrimary, u_brandSecondary, blend * 2.0);
    } else {
      layerColor = mix(u_brandSecondary, u_brandAccent, (blend - 0.5) * 2.0);
    }

    // Burst brightening
    c += u_burst * 0.3 * exp(-pow((uv.y - u_height) / (u_spread + u_burst * 0.1), 2.0));

    color += layerColor * c * (0.25 / float(u_layers));
  }

  // Post-process
  color = color / (1.0 + color);                    // Reinhard
  color = min(color, vec3(0.75));                    // Brightness cap
  color = mix(u_bgColor, color, u_intensity);        // Intensity blend

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;

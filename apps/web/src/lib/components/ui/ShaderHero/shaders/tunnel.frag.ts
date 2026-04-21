/**
 * Tunnel fragment shader — Apollonian fractal tunnel flythrough.
 *
 * Shadertoy-grade polish pass:
 *  - Direct brand-palette mix on the volumetric accumulation (replaces the
 *    `dot(color, vec3(1.0))` luminance-offset trick, which only sampled
 *    the *brightness* of each brand colour and threw away hue information)
 *  - ACES filmic tone map replaces min(x, 0.7) clip — the 128-step raymarch
 *    accumulates lots of HDR energy that deserves proper rolloff
 *  - Bloom-adjacent highlight boost on brightest raymarch regions
 *  - Radial background gradient (deep primary-tinted centre) instead of
 *    flat bgColor composite
 *  - Luminance-aware filmic grain
 */
export const TUNNEL_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_burstStrength;
uniform vec3 u_brandPrimary;
uniform vec3 u_brandSecondary;
uniform vec3 u_brandAccent;
uniform vec3 u_bgColor;
uniform float u_speed;
uniform int u_fractal;
uniform float u_radius;
uniform float u_brightness;
uniform float u_twist;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

vec3 cameraPath(float z) {
  return vec3(cos(z * u_twist) * 16.0, 0.0, z);
}

float apollonian(vec3 p) {
  float b = u_radius;
  float s;
  float w = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= u_fractal) break;
    p = mod(p + b, 2.0 * b) - b;
    s = 2.0 / max(dot(p, p), 0.001);
    p *= s;
    w *= s;
  }
  return length(p) / w - 0.01;
}

float tunnelSDF(vec3 p) {
  vec3 q = p - cameraPath(p.z);
  float tunnel = -(length(q.xy) - u_radius * 1.5);
  float fractal = apollonian(p);
  return max(tunnel, fractal);
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// -- Smooth palette for tunnel depth --
vec3 tunnelPalette(float t) {
  t = fract(t);
  float w0 = smoothstep(0.6, 0.0, t);
  float w1 = 1.0 - smoothstep(0.0, 0.5, abs(t - 0.5) * 2.0);
  float w2 = smoothstep(0.4, 1.0, t);
  float total = w0 + w1 + w2;
  return (u_brandPrimary * w0 + u_brandSecondary * w1 + u_brandAccent * w2) / max(total, 0.001);
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  float z = u_time * u_speed + u_burstStrength * 5.0;
  vec3 ro = cameraPath(z);
  vec3 target = cameraPath(z + 1.0);

  vec3 fwd = normalize(target - ro);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, right);

  vec2 mouseOffset = (u_mouse - 0.5) * 0.5;
  vec3 rd = normalize(fwd + (uv.x + mouseOffset.x) * right + (uv.y + mouseOffset.y) * up);

  vec3 color = vec3(0.0);
  float t = 0.0;

  for (int i = 0; i < 128; i++) {
    vec3 p = ro + rd * t;
    float d = tunnelSDF(p);

    if (d < 0.001) break;
    if (t > 50.0) break;

    // ── Brand-palette lookup by accumulated depth + step-based phase ──
    // Much richer than dot(color, vec3(1.0)) which discarded hue.
    float palT = fract(0.04 * float(i) + 0.12 * p.z);
    vec3 marchColor = tunnelPalette(palT);

    // Cos-based luminance oscillation for tunnel "ribs" — keep a floor
    // of 0.5 so we don't lose samples entirely in dark ribs (the old
    // 0.5 + 0.5*cos version dipped to 0.0 which killed accumulation).
    float rib = 0.75 + 0.25 * cos(0.05 * float(i) + 0.5 * p.z);
    marchColor *= rib;

    // Slower falloff + stronger accumulation so the tunnel reads as
    // luminous rather than dark (old 0.02 * 1.0 × 128 steps with heavy
    // exp falloff totalled ~0.3 before Reinhard, which then clipped flat).
    float falloff = exp(-0.08 * t);
    color += marchColor * falloff * 0.05 * u_brightness;

    t += max(d, 0.01);
  }

  // ── Bloom boost on brightest accumulated cores ──
  float tunnelLum = dot(color, vec3(0.299, 0.587, 0.114));
  color += pow(tunnelLum, 2.3) * mix(u_brandSecondary, u_brandAccent, 0.5) * 0.3;

  // ── Radial bg with primary tint at centre ──
  vec2 vc = v_uv * 2.0 - 1.0;
  float r2 = dot(vc, vc);
  vec3 bgGrad = mix(
    u_bgColor + u_brandPrimary * 0.03,
    u_bgColor * 0.8,
    smoothstep(0.0, 1.4, r2)
  );

  // ── Post-process ───────────────────────────────────────────
  color = aces(color);
  color = mix(bgGrad, color, u_intensity);

  color *= clamp(1.0 - r2 * u_vignette, 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

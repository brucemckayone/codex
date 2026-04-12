/**
 * Waves fragment shader — Gerstner ocean surface.
 *
 * Realistic ocean surface viewed from above/oblique, built on 5 superposed
 * Gerstner waves with proper wave physics. Ray-surface intersection finds
 * the water height at each pixel via iterative convergence, finite-difference
 * normals drive Fresnel reflection, subsurface scattering, specular sun
 * highlights, and foam at wave crests.
 *
 * Single-pass fragment shader. No FBOs needed.
 * Mouse changes effective wind direction (shifts wave propagation angles).
 * Click creates a splash disturbance that radiates outward.
 * Brand colors: primary=wave body, secondary=subsurface scatter, accent=foam.
 */
export const WAVES_FRAG = `#version 300 es
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
uniform float u_height;
uniform float u_speed;
uniform float u_chop;
uniform float u_foam;
uniform float u_depth;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

// -- Hash for film grain --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- Wind rotation from mouse --
mat2 getWindRotation() {
  float angle = u_mouseActive * (u_mouse.x - 0.5) * 1.5;
  float c = cos(angle), s = sin(angle);
  return mat2(c, -s, s, c);
}

// -- Gerstner displacement: 5 superposed waves --
vec3 gerstnerDisplacement(vec2 pos, float t) {
  mat2 windRot = getWindRotation();
  vec3 result = vec3(0.0);
  float Q = clamp(u_chop, 0.0, 1.0);

  // Wave 1 (dominant)
  vec2 d1 = windRot * normalize(vec2(1.0, 0.3));
  float f1 = 1.0;
  float a1 = 0.25 * u_height;
  float phase1 = dot(d1, pos) * f1 + t * 1.0;
  result.z += a1 * sin(phase1);
  result.xy += Q * a1 * d1 * cos(phase1);

  // Wave 2
  vec2 d2 = windRot * normalize(vec2(0.8, -0.5));
  float f2 = 1.8;
  float a2 = 0.15 * u_height;
  float phase2 = dot(d2, pos) * f2 + t * 1.2;
  result.z += a2 * sin(phase2);
  result.xy += Q * a2 * d2 * cos(phase2);

  // Wave 3
  vec2 d3 = windRot * normalize(vec2(-0.3, 1.0));
  float f3 = 2.6;
  float a3 = 0.10 * u_height;
  float phase3 = dot(d3, pos) * f3 + t * 0.9;
  result.z += a3 * sin(phase3);
  result.xy += Q * a3 * d3 * cos(phase3);

  // Wave 4
  vec2 d4 = windRot * normalize(vec2(0.5, 0.8));
  float f4 = 3.2;
  float a4 = 0.06 * u_height;
  float phase4 = dot(d4, pos) * f4 + t * 1.4;
  result.z += a4 * sin(phase4);
  result.xy += Q * a4 * d4 * cos(phase4);

  // Wave 5
  vec2 d5 = windRot * normalize(vec2(-0.7, -0.4));
  float f5 = 4.1;
  float a5 = 0.04 * u_height;
  float phase5 = dot(d5, pos) * f5 + t * 0.8;
  result.z += a5 * sin(phase5);
  result.xy += Q * a5 * d5 * cos(phase5);

  return result;
}

// -- Iterative height solve (4 iterations for Gerstner convergence) --
float getWaveHeight(vec2 pos, float t) {
  vec2 p = pos;
  for (int i = 0; i < 4; i++) {
    vec3 disp = gerstnerDisplacement(p, t);
    p = pos - disp.xy;
  }
  return gerstnerDisplacement(p, t).z;
}

// -- Finite difference normal --
vec3 getNormal(vec2 pos, float t) {
  float eps = 0.01;
  float hL = getWaveHeight(pos - vec2(eps, 0.0), t);
  float hR = getWaveHeight(pos + vec2(eps, 0.0), t);
  float hD = getWaveHeight(pos - vec2(0.0, eps), t);
  float hU = getWaveHeight(pos + vec2(0.0, eps), t);
  return normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
}

void main() {
  float t = u_time * u_speed;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv;

  // Scale to world space
  vec2 pos = vec2(uv.x * aspect, uv.y) * 4.0;

  // -- Wave height + mouse splash --
  float waveH = getWaveHeight(pos, t);

  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
  vec2 fragUV = vec2(uv.x * aspect, uv.y);
  float splashDist = distance(fragUV, mouseUV);
  float splash = u_burst * 0.3 * sin(splashDist * 30.0 - u_time * 8.0) * exp(-splashDist * 5.0);
  waveH += splash;

  // -- Surface normal --
  vec3 normal = getNormal(pos, t);

  // -- Fresnel (Schlick approximation) --
  vec3 viewDir = normalize(vec3(0.0, 1.0, 0.5));
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);
  fresnel = mix(0.02, 1.0, fresnel);

  // -- Sky reflection (brand palette gradient) --
  vec3 skyColor = mix(u_bgColor * 1.5, u_brandPrimary * 0.8, normal.y * 0.5 + 0.5);

  // -- Deep water + wave body --
  vec3 deepWater = u_bgColor * 0.5;
  vec3 waterBody = mix(deepWater, u_brandPrimary, clamp(waveH * 2.0 + 0.5, 0.0, 1.0));

  // -- Composite --
  vec3 color = mix(waterBody, skyColor, fresnel * 0.4);

  // Subsurface scattering
  float sss = pow(max(dot(viewDir, -normal), 0.0), 3.0) * u_depth;
  color += u_brandSecondary * sss * 0.6;

  // Specular sun highlight
  vec3 sunDir = normalize(vec3(0.5, 0.8, 0.3));
  vec3 halfVec = normalize(sunDir + viewDir);
  float spec = pow(max(dot(normal, halfVec), 0.0), 128.0);
  color += vec3(1.0) * spec * 0.8;

  // Foam at crests
  float foamMask = smoothstep(0.15, 0.35, waveH) * u_foam;
  foamMask *= hash(pos * 30.0 + t * 2.0) * 0.5 + 0.5;
  color += u_brandAccent * foamMask;

  // -- Post-processing --
  // 1. Reinhard tone map
  color = color / (1.0 + color);

  // 2. Brightness cap at 75%
  color = min(color, vec3(0.75));

  // 3. Mix with background by intensity
  color = mix(u_bgColor, color, u_intensity);

  // 4. Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // 5. Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  // 6. Final clamp
  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;

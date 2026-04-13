/**
 * Pulse display fragment shader (GLSL ES 3.0).
 *
 * Raymarches the wave simulation heightfield from a 3D perspective camera,
 * producing a dramatic liquid surface effect. Based on the Shadertoy
 * "4sKGWw" image pass with brand-aware coloring.
 *
 * Rendering pipeline:
 * 1. Camera ray generation (configurable height + target)
 * 2. Heightfield raymarching with secant method for precision
 * 3. Finite-difference surface normals
 * 4. Flat surface color via uPulseColor override (default: blood red)
 * 5. Diffuse + specular (sharp, liquid-like) + ambient occlusion
 * 6. Reinhard tone mapping, vignette, film grain
 */
export const PULSE_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform vec3 uPulseColor;
uniform float uIntensity, uGrain, uVignette, uTime;
uniform float uWaveScale, uCamHeight, uCamTarget, uSpecular;
uniform vec2 uResolution;

// Logo SDF (optional — guarded by uHasLogo)
uniform sampler2D uSdf;
uniform float uHasLogo;

// Audio reactivity (0.0 when no audio active)
uniform float uAudioBass;
uniform float uAudioMids;
uniform float uAudioTreble;
uniform float uAudioAmplitude;

#define HEIGHTMAPSCALE 90.0
#define MARCHSTEPS 10

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// ── Camera ────────────────────────────────────────────────────────
vec3 cam(in vec2 p, out vec3 cameraPos) {
  float camRadius = 50.0;
  float theta = -3.141592653 / 2.0;
  cameraPos = vec3(camRadius * cos(theta), uCamHeight, camRadius * sin(theta));

  vec3 target = vec3(0.0, 0.0, uCamTarget);
  vec3 fo = normalize(target - cameraPos);
  vec3 ri = normalize(vec3(fo.z, 0.0, -fo.x));
  vec3 up = normalize(cross(fo, ri));

  float fov = 0.5;
  return normalize(fo + fov * p.x * ri + fov * p.y * up);
}

// ── Heightfield ───────────────────────────────────────────────────
float h(vec3 p) {
  // Audio: bass amplifies wave height for more dramatic surface
  float audioScale = 1.0 + uAudioBass * 1.5 + uAudioAmplitude * 0.5;
  return uWaveScale * audioScale * texture(uState, p.xz / HEIGHTMAPSCALE + 0.5).x;
}

float DE(vec3 p) { return 1.2 * (p.y - h(p)); }

void main() {
  vec2 qq = v_uv * 2.0 - 1.0;
  qq.x *= uResolution.x / uResolution.y;

  vec3 L = normalize(vec3(0.3, 0.9, 1.0));

  // ── Raymarch the heightfield ──────────────────────────────────
  vec3 ro;
  vec3 rd = cam(qq, ro);
  float t = 0.0;
  float d = DE(ro + t * rd);

  for (int i = 0; i < MARCHSTEPS; i++) {
    if (abs(d) < 0.1 || t > 200.0) break;

    float dNext = DE(ro + (t + d) * rd);

    float ratio = dNext / d;
    if (ratio < 0.0) {
      d /= 1.0 - ratio;
      dNext = DE(ro + rd * (t + d));
    }

    t += d;
    d = dNext;
  }

  // ── Background for missed / distant rays ──────────────────────
  if (t > 200.0) {
    vec3 bg = uBgColor * (0.25 + 0.15 * v_uv.y);
    bg += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;
    fragColor = vec4(clamp(bg, 0.0, 1.0), 1.0);
    return;
  }

  // ── Surface shading ───────────────────────────────────────────
  vec3 p = ro + t * rd;

  float h0 = h(p);
  vec2 dd = vec2(0.01, 0.0);
  vec3 n = normalize(vec3(h0 - h(p + dd.xyy), dd.x, h0 - h(p + dd.yyx)));

  float ndotL = clamp(dot(n, L), 0.0, 1.0);
  float dif = 1.52 * (0.7 + 0.3 * ndotL);
  float ao = mix(0.6, 0.64, smoothstep(0.0, 1.0, (h0 + 1.5) / 6.0));

  // Audio: blend accent color in on mids/treble, boost intensity with amplitude
  vec3 surfaceColor = mix(uPulseColor, uColorAccent, uAudioTreble * 0.4);
  float audioIntensity = uIntensity * (1.0 + uAudioAmplitude * 0.6);
  vec3 col = surfaceColor * dif * ao * audioIntensity;

  // Audio: specular sharpens and brightens with amplitude
  float specPower = mix(4000.0, 2000.0, uAudioBass);
  float s = uSpecular * (1.0 + uAudioAmplitude * 2.0) * pow(clamp(dot(L, reflect(rd, n)), 0.0, 1.0), specPower);
  col += s;

  // ── Logo edge glow on the raymarched surface ──────────────────
  if (uHasLogo > 0.5) {
    vec2 logoUV = p.xz / HEIGHTMAPSCALE + 0.5;
    if (logoUV.x > 0.0 && logoUV.x < 1.0 && logoUV.y > 0.0 && logoUV.y < 1.0) {
      float sdf = texture(uSdf, logoUV).r;
      float edgeGlow = exp(-abs(sdf - 0.5) * 50.0) * 0.25;
      col += uPulseColor * edgeGlow;
    }
  }

  // ── Post-processing ───────────────────────────────────────────
  col = col / (1.0 + col);

  vec2 vc = v_uv - 0.5;
  col *= clamp(1.0 - dot(vc, vc) * uVignette * 4.0, 0.0, 1.0);

  col += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  fragColor = vec4(clamp(col, 0.0, 0.85), 1.0);
}
`;

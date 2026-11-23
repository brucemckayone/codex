/**
 * Pulse display fragment shader (GLSL ES 3.0).
 *
 * Raymarches the wave simulation heightfield from a 3D perspective camera,
 * producing a liquid surface. Based on the Shadertoy "4sKGWw" image pass.
 *
 * The form:
 *  - The LOGO is a raised liquid form: its SDF lifts the surface into a
 *    plateau with rounded shoulders, and the waves ride over it. It holds
 *    still: only waves move, and only the pointer and the sound make
 *    them. It used to steer the waves with a pulsing force (and glow a thin
 *    outline). No logo, no form: the plain surface.
 *  - Brand colours: the surface is the palette (primary in the troughs,
 *    secondary on the crests, accent on the logo), mixed from the ground by
 *    intensity, and the sky is the brand ground. It painted a separate
 *    picker (#d10000 for every org) over a ground darkened to a quarter.
 *  - Fitted to the canvas's SHORT side, so a phone sees the whole form.
 *  - Stronger relief light (a wider diffuse range, a broad sheen lobe under
 *    the sharp specular, a fresnel reflection of the sky) and distance fog
 *    into the sky, so the form reads as 3D.
 *
 * Rendering pipeline:
 * 1. Camera ray generation (configurable height + target)
 * 2. Heightfield raymarching with secant method for precision
 * 3. Finite-difference surface normals
 * 4. Palette surface over the ground (intensity), logo in accent
 * 5. Diffuse + sheen + specular + fresnel, fog into the sky
 * 6. Vignette, film grain
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';

export const PULSE_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;
uniform float uWaveScale, uCamHeight, uCamTarget, uSpecular;
uniform float uLogoHeight;
uniform vec2 uResolution;

// Logo SDF (optional — guarded by uHasLogo)
uniform sampler2D uSdf;
uniform float uHasLogo;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}

// Audio reactivity (0.0 when no audio active)

#define HEIGHTMAPSCALE 90.0
#define MARCHSTEPS 14
/**
 * The logo's ridge profile, in world units of signed distance to its edge
 * (a texel is 0.18): full height this far inside, falling to nothing this
 * far outside. A logo's strokes are thin on the 90-unit plane (OBB's are
 * ~0.3 inside at most), so the rise sits mostly OUTSIDE the edge: each
 * stroke reads as a rounded ridge of liquid, not a sliver.
 */
#define LOGO_IN 0.3
#define LOGO_OUT 1.1

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
vec2 mapUV(vec3 p) { return p.xz / HEIGHTMAPSCALE + 0.5; }

/** The waves alone. Bass and level amplify them. */
float waves(vec3 p) {
  float audioScale = 1.0 + u_bass * 1.5 + u_level * 0.5;
  return uWaveScale * audioScale * texture(uState, mapUV(p)).x;
}

/**
 * The logo's lift, 0..1. The SDF stores 0.5 at the edge, less inside, in
 * quarter-uv units: (s - 0.5) / 4 * HEIGHTMAPSCALE is the signed distance.
 */
float logoMask(vec3 p) {
  if (uHasLogo < 0.5) return 0.0;
  float d = (texture(uSdf, mapUV(p)).r - 0.5) * 0.25 * HEIGHTMAPSCALE;
  return 1.0 - smoothstep(-LOGO_IN, LOGO_OUT, d);
}

float h(vec3 p) { return waves(p) + uLogoHeight * logoMask(p); }

float DE(vec3 p) { return 1.2 * (p.y - h(p)); }

void main() {
  // Fitted to the SHORT side: landscape keeps its framing (height spans 2),
  // and a portrait phone sees the full width instead of a slice of it.
  vec2 qq = (v_uv * 2.0 - 1.0) * uResolution / min(uResolution.x, uResolution.y);

  vec3 L = normalize(vec3(0.3, 0.9, 1.0));
  vec3 sky = uBgColor * (0.94 + 0.06 * v_uv.y);

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

  vec3 col;
  if (t > 200.0) {
    // ── Missed rays: the brand ground as sky ────────────────────
    col = sky;
  } else {
    // ── Surface shading ─────────────────────────────────────────
    vec3 p = ro + t * rd;

    // Normals over ~1.5 texels: a finer step falls inside one texel's
    // linear filter and facets the logo's shoulders.
    float h0 = h(p);
    vec2 dd = vec2(0.25, 0.0);
    vec3 n = normalize(vec3(h0 - h(p + dd.xyy), dd.x, h0 - h(p + dd.yyx)));

    // The palette: primary in the troughs, secondary on the crests, the logo in
    // accent; mixed from the ground by intensity, from a floor of 30% so the
    // form keeps its colour at the default 0.1.
    float crest = smoothstep(-0.5, 0.8, waves(p) / max(uWaveScale, 0.001));
    float logo = logoMask(p);
    vec3 palette = mix(uColorPrimary, uColorSecondary, crest);
    palette = mix(palette, uColorAccent, logo * 0.8);
    // Treble blends the accent in, as before.
    palette = mix(palette, uColorAccent, u_treble * 0.4);
    float amount = clamp(0.3 + 0.7 * uIntensity * (1.0 + u_level * 0.6), 0.0, 1.0);
    vec3 albedo = mix(uBgColor, palette, amount);

    float ndotL = clamp(dot(n, L), 0.0, 1.0);
    col = albedo * (0.45 + 0.75 * ndotL);

    // Sheen: the sharp liquid specular plus a broad lobe that shapes the
    // form; amplitude sharpens and brightens it.
    vec3 R = reflect(rd, n);
    float rl = clamp(dot(L, R), 0.0, 1.0);
    float specPower = mix(4000.0, 2000.0, u_bass);
    float s = uSpecular * (1.0 + u_level * 2.0)
            * (pow(rl, specPower) + 0.1 * pow(rl, 40.0));
    // Fresnel: grazing slopes reflect the sky.
    float fres = pow(1.0 - clamp(dot(-rd, n), 0.0, 1.0), 5.0);
    col = mix(col, sky, fres * 0.6);
    col += s * mix(vec3(1.0), uColorAccent, 0.2);

    // Distance fog into the sky, so the horizon is soft.
    col = mix(col, sky, smoothstep(70.0, 170.0, t));
  }

  // ── Post-processing ───────────────────────────────────────────
  vec2 vc = v_uv - 0.5;
  col *= clamp(1.0 - dot(vc, vc) * uVignette * 4.0, 0.0, 1.0);

  col += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

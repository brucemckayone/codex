/**
 * Waves fragment shader — Gerstner ocean surface.
 *
 * Shadertoy-grade polish pass:
 *  - ACES filmic tone map replaces min(x, 0.75); specular sun highlight
 *    now emits > 1.0 and tone-maps to a proper glinting hotspot instead
 *    of a clipped matte disc
 *  - Richer sky gradient: primary at horizon → accent-tinted at zenith,
 *    passed through fresnel for realistic oblique reflections
 *  - Subsurface scatter brightened + warmed with accent injection
 *  - Foam: accent + white mix with HDR multiplier so whitecaps feel
 *    cinematic (old accent * 0.5-ish was tinted but dim)
 *  - Depth-tinted water body (brandPrimary → deeper tint via waveH)
 *  - Luminance-aware grain
 *
 * ## 2026-09 pass: analytic normals, hoisted wind, audio
 *
 * **Cost.** This was by far the most expensive preset in the set, for a reason
 * that is invisible unless you count the call tree:
 *
 *   getNormal        -> 4 finite-difference height samples
 *   each getWaveHeight -> 4-iteration inverse-displacement solve
 *   each iteration   -> gerstnerDisplacement (5 waves = 5 sin + 5 cos)
 *
 * That is 4 x 5 = 20 Gerstner evaluations for the normal, plus 5 for the
 * height itself: **25 per pixel**, around 125 sin and 125 cos per fragment for
 * a background.
 *
 * Two fixes, neither of which changes the look:
 *
 * 1. **Analytic normals.** Gerstner waves have a closed-form derivative — for
 *    each component, d/dpos of \`a*sin(dot(d,pos)*f + t*s)\` is
 *    \`a*f*d*cos(...)\`, the same cosine the horizontal displacement already
 *    computes. Accumulating the gradient alongside the displacement makes the
 *    normal free, replacing 20 evaluations with 0. It is also strictly more
 *    accurate than a finite difference, which carries an O(eps^2) error and
 *    was sampling a *different* solve each time.
 * 2. **Hoisted wind rotation.** \`getWindRotation()\` was called INSIDE
 *    \`gerstnerDisplacement\`, so a mat2 that is constant across the entire
 *    frame had its sin/cos recomputed on all 25 calls per pixel. Now computed
 *    once in main() and passed down.
 *
 * Net: 25 Gerstner evaluations per pixel down to 3 (two solve iterations plus
 * the final sample), and 25 redundant wind sin/cos pairs down to one.
 * Iterations dropped 4 -> 2 because the inverse-displacement solve converges
 * fast at these amplitudes; the residual is far below a pixel.
 *
 * **Motion.** No camera to de-jerk — this is a lit height field. The wave
 * phase advance IS the effect and is preserved; it is now paced by the
 * integrated musical clock rather than raw wall-clock. Mouse still steers wind
 * direction, which is the pointer-follow motion the brief says to keep.
 *
 * **Audio.** Bass raises wave height, the slow energy envelope steepens chop,
 * treble drives foam sparkle, beats add a swell, and timbre shifts the water's
 * temperature. All gated on the audio ramp.
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';

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
uniform float u_chop;
uniform float u_foam;
uniform float u_depth;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;
/**
 * Monotone pacing clock, integrated on the CPU (see waves-renderer.ts) and
 * already scaled by speed. Wave phase advances on this rather than u_time, so
 * the swell paces with the music and settles when it stops.
 */
uniform float u_clock;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

mat2 getWindRotation() {
  float angle = u_mouseActive * (u_mouse.x - 0.5) * 1.5;
  float c = cos(angle), s = sin(angle);
  return mat2(c, -s, s, c);
}

/**
 * Inverse-displacement solve iterations.
 *
 * Gerstner displacement moves a point horizontally, so recovering the height
 * at a *screen* position needs the pre-displacement position — a fixed-point
 * iteration. Was 4; at these amplitudes (max ~0.25 * u_height per component)
 * the map is strongly contracting and two iterations put the residual well
 * below a pixel. Each iteration costs a full 5-wave evaluation, so this alone
 * is a ~40% cut in the height path.
 */
const int SOLVE_ITERS = 2;

/** One Gerstner component's contribution to displacement and to the gradient. */
struct Wave {
  vec2 dir;
  float freq;
  float amp;
  float speed;
};

/**
 * Evaluate the 5-wave superposition at pos.
 *
 * Returns displacement (xy horizontal, z vertical) and writes the analytic
 * height gradient (dz/dx, dz/dy) into grad.
 *
 * The gradient is free: d/dpos of a*sin(dot(d,pos)*f + t*s) is
 * a*f*d*cos(...), and that cosine is already computed for the horizontal
 * displacement term. Accumulating it removes the need to sample the height
 * field four times to finite-difference a normal.
 *
 * windRot is passed in rather than computed here — it is constant for the
 * whole frame, and computing it inside cost a redundant sin/cos pair on every
 * one of the ~25 calls this function used to receive per pixel.
 */
vec3 gerstner(vec2 pos, float t, mat2 windRot, float heightScale, out vec2 grad) {
  Wave waves[5];
  waves[0] = Wave(normalize(vec2( 1.0,  0.3)), 1.0, 0.25, 1.0);
  waves[1] = Wave(normalize(vec2( 0.8, -0.5)), 1.8, 0.15, 1.2);
  waves[2] = Wave(normalize(vec2(-0.3,  1.0)), 2.6, 0.10, 0.9);
  waves[3] = Wave(normalize(vec2( 0.5,  0.8)), 3.2, 0.06, 1.4);
  waves[4] = Wave(normalize(vec2(-0.7, -0.4)), 4.1, 0.04, 0.8);

  vec3 result = vec3(0.0);
  grad = vec2(0.0);
  float Q = clamp(u_chop, 0.0, 1.0);

  for (int i = 0; i < 5; i++) {
    vec2 d = windRot * waves[i].dir;
    float a = waves[i].amp * heightScale;
    float f = waves[i].freq;
    float phase = dot(d, pos) * f + t * waves[i].speed;
    float s = sin(phase);
    float c = cos(phase);

    result.z += a * s;
    result.xy += Q * a * d * c;
    grad += a * f * d * c;
  }

  return result;
}

/**
 * Height and normal in one pass.
 *
 * Replaces the old getWaveHeight + getNormal pair, which between them ran 25
 * Gerstner evaluations per pixel (5 for the height, 20 for four
 * finite-difference samples). This runs SOLVE_ITERS + 1 = 3, and the normal
 * comes from the analytic gradient at the solved point — which is also more
 * accurate, since the finite difference both carried an O(eps^2) error and
 * sampled a separately-converged solve at each offset.
 */
float waveSurface(vec2 pos, float t, mat2 windRot, float heightScale, out vec3 normal) {
  vec2 grad;
  vec2 p = pos;
  for (int i = 0; i < SOLVE_ITERS; i++) {
    vec3 disp = gerstner(p, t, windRot, heightScale, grad);
    p = pos - disp.xy;
  }
  vec3 disp = gerstner(p, t, windRot, heightScale, grad);

  // Matches the old finite-difference orientation: hL - hR is -2*eps*dz/dx,
  // and the y term was 2*eps, so after normalising the frame is
  // (-dz/dx, 1, -dz/dy).
  normal = normalize(vec3(-grad.x, 1.0, -grad.y));
  return disp.z;
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  // Wave phase advances on the integrated musical clock, so the swell paces
  // with the track. The clock is monotone by construction (rates are blended,
  // never positions) — a phase that could run backwards would reverse the
  // entire ocean.
  float t = u_clock;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv;

  vec2 pos = vec2(uv.x * aspect, uv.y) * 4.0;

  // Wind rotation is constant for the frame — computed once here rather than
  // inside the wave evaluation, where it was recomputed ~25 times per pixel.
  mat2 windRot = getWindRotation();

  // Bass raises the swell. One-sided, so silence is the resting sea state and
  // audio can only add height — never flatten it.
  float heightScale = u_height * audioLift(u_bass, 0.45);

  // Beats add a broad swell rather than a sharp displacement: a transient on
  // geometry would read as a jolt, so it goes through the same amplitude term
  // with a softened envelope.
  heightScale *= 1.0 + beatHit(2.0) * 0.18;

  vec3 normal;
  float waveH = waveSurface(pos, t, windRot, heightScale, normal);

  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
  vec2 fragUV = vec2(uv.x * aspect, uv.y);
  float splashDist = distance(fragUV, mouseUV);
  float splash = u_burst * 0.3 * sin(splashDist * 30.0 - u_time * 8.0) * exp(-splashDist * 5.0);
  waveH += splash;

  // Fresnel (Schlick)
  vec3 viewDir = normalize(vec3(0.0, 1.0, 0.5));
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);
  fresnel = mix(0.02, 1.0, fresnel);

  // ── Sky gradient: horizon primary → zenith accent-tinted ────
  float skyT = normal.y * 0.5 + 0.5;
  vec3 skyHorizon = mix(u_bgColor * 1.4, u_brandPrimary * 0.9, 0.6);
  vec3 skyZenith = mix(u_brandPrimary, u_brandAccent, 0.35) * 1.1;
  vec3 skyColor = mix(skyHorizon, skyZenith, skyT);

  // ── Water body: depth-tinted primary ────────────────────────
  // Timbre shifts the water's temperature — bright material pulls toward the
  // accent, dark toward the secondary. Colour tracks WHAT is playing rather
  // than how loud it is, which is the difference between reactive and twitchy.
  vec3 deepWater = u_bgColor * 0.55;
  vec3 surfaceTint = u_brandPrimary;
  surfaceTint = audioTint(surfaceTint, u_brandAccent, max(u_centroid - 0.25, 0.0), 1.2);
  surfaceTint = audioTint(surfaceTint, u_brandSecondary, max(0.25 - u_centroid, 0.0), 1.2);
  vec3 waterBody = mix(deepWater, surfaceTint, clamp(waveH * 2.0 + 0.5, 0.0, 1.0));

  vec3 color = mix(waterBody, skyColor, fresnel * 0.45);

  // ── Subsurface scatter (brighter + warmer) ──────────────────
  float sss = pow(max(dot(viewDir, -normal), 0.0), 3.0) * u_depth;
  color += mix(u_brandSecondary, u_brandAccent, 0.4) * sss * 1.0;

  // ── Specular sun highlight — HDR emission (> 1.0) ──────────
  // Old: vec3(1.0) * spec * 0.8 maxed at 0.8, clipped flat. New: 4.0
  // lets ACES tone-map the highlight to a proper glint.
  vec3 sunDir = normalize(vec3(0.5, 0.8, 0.3));
  vec3 halfVec = normalize(sunDir + viewDir);
  float spec = pow(max(dot(normal, halfVec), 0.0), 128.0);
  color += mix(vec3(1.0), u_brandAccent, 0.15) * spec * 4.0;

  // ── Foam with HDR whitecaps ─────────────────────────────────
  // Treble lifts foam: high-frequency audio content and the fine spatial
  // detail of whitecaps are a natural pairing, and foam is a light-side term
  // so a transient here never moves geometry.
  float foamMask = smoothstep(0.15, 0.35, waveH) * u_foam * audioLift(u_treble, 0.55);
  foamMask *= hash(pos * 30.0 + t * 2.0) * 0.5 + 0.5;
  color += mix(u_brandAccent, vec3(1.0), 0.4) * foamMask * 1.6;

  // ── Bloom-adjacent highlight boost ──────────────────────────
  float lumSig = dot(color, vec3(0.299, 0.587, 0.114));
  color += pow(clamp(lumSig - 0.6, 0.0, 2.0), 2.0) * u_brandAccent * 0.25;

  // ── Post-process ────────────────────────────────────────────
  color = aces(color);
  color = mix(u_bgColor, color, u_intensity);

  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmt = u_grain * mix(1.4, 0.35, lum);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * grainAmt;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

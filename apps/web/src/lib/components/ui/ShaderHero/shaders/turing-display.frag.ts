/**
 * Turing Pattern display fragment shader (GLSL ES 3.0).
 *
 * Maps Gray-Scott chemical concentrations to brand colors:
 *   B concentration (pattern) → primary color
 *   Deep B regions            → secondary color
 *   Edges (dFdx/dFdy of B)   → accent color
 *   Background where A dominates
 *
 * ## What changed and why
 *
 * **Light backgrounds.** The chain was `Reinhard(colour)` then
 * `clamp(colour, 0, 0.75)`, both absolute. A light `uBgColor` of 0.96 tonemaps
 * to 0.49 and then survives the cap, so a white brand palette rendered as mid
 * grey — the shader assumed a dark ground. Both are now expressed relative to
 * `uBgColor`: the tonemap rolls off the *excursion* either side of the
 * background (leaving the background itself exact), and the cap floors at the
 * background. `highlight()` does the same job for the additive glows, which on
 * a near-white ground would otherwise clip to grey instead of reading as
 * emphasis.
 *
 * **Audio.** Previously none. `u_energy` widens the deep-B band so busy
 * passages show more of the secondary colour, `beatHit()` blooms the contour
 * accent, `u_treble` adds fine sparkle confined to the pattern (never the
 * background, where it would read as dirt), `audioHueShift()` warms the accent
 * with timbre, and a `u_beatPhase`-paced sheen travels across the field. The
 * sheen is the one added *motion*: it is driven by the beat clock rather than
 * wall time, so it exists only while a track plays and stops when it stops.
 *
 * Uniforms:
 *   uState          — simulation texture (RG = chemicals A, B)
 *   uColorPrimary   — primary brand color (pattern body)
 *   uColorSecondary — secondary brand color (deep B)
 *   uColorAccent    — accent brand color (edges)
 *   uBgColor        — background color (A-dominated areas)
 *   uIntensity      — brightness multiplier
 *   uGrain          — film grain strength
 *   uVignette       — vignette strength
 *   uTime           — elapsed time in seconds (for grain animation)
 */
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const TURING_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

/**
 * Emphasis that survives a light palette.
 *
 * On a dark ground this is the usual additive HDR lift and is bit-identical to
 * what the preset did before. On a light ground adding a saturated brand colour
 * to something already near white only desaturates it toward grey, so the same
 * emphasis is applied as a blend *toward* the tint — the one direction that
 * still has contrast left. \`darkBg\` crossfades the two, so a mid-grey
 * background gets half of each rather than a switch.
 */
vec3 highlight(vec3 base, vec3 tint, float amount, float darkBg) {
  vec3 additive = base + tint * amount;
  vec3 blended = mix(base, tint, clamp(amount, 0.0, 1.0));
  return mix(blended, additive, darkBg);
}

/**
 * Reinhard applied to the excursion either side of the background rather than
 * to the absolute colour, so \`uBgColor\` maps to itself exactly. The absolute
 * form pulled a light background down by half; this form leaves it alone and
 * still rolls off highlights.
 */
vec3 toneOverBg(vec3 c, vec3 bg) {
  vec3 over = max(c - bg, 0.0);
  vec3 under = max(bg - c, 0.0);
  return bg + over / (1.0 + over) - under / (1.0 + under);
}

void main() {
  // ── 1. Read chemical concentrations ──────────────────────────────
  vec2 chem = texture(uState, v_uv).rg;
  float B = chem.g;

  // 1 for a dark palette, 0 for a light one. Every additive term below routes
  // through this so the preset works on either.
  float bgLum = dot(uBgColor, vec3(0.299, 0.587, 0.114));
  float darkBg = 1.0 - smootherstep(0.35, 0.62, bgLum);

  // ── 2. Pattern body: B concentration → primary ───────────────────
  float patternStrength = smoothstep(0.05, 0.35, B);
  vec3 color = mix(uBgColor, uColorPrimary * uIntensity, patternStrength);

  // ── 3. Deep B regions → secondary ────────────────────────────────
  // The slow envelope widens the deep band downward, so a loud section shows
  // more of the secondary colour through the pattern without moving any edge.
  float deepLo = 0.25 - u_energy * u_audioActive * 0.06;
  float deepB = smoothstep(deepLo, 0.50, B);
  color = mix(color, uColorSecondary * uIntensity, deepB * 0.6);

  // ── 4. Beat-paced sheen travelling across the pattern ────────────
  // Gated on u_audioActive and clocked by u_beatPhase, so it is absent in hero
  // mode and freezes with the track rather than running on wall time.
  float sheen = sin((v_uv.x + v_uv.y * 0.6) * 2.2 - u_beatPhase * 1.4);
  color = mix(
    color,
    color * mix(0.92, 1.14, sheen * 0.5 + 0.5),
    patternStrength * u_audioActive * 0.5
  );

  // ── 5. Edge detection via screen-space derivatives → accent ──────
  float edgeStrength = smoothstep(0.002, 0.025, abs(dFdx(B)) + abs(dFdy(B)));
  // Timbre warms the contour; the beat blooms it. Both are light-side terms —
  // nothing here moves the chemistry, which lives in the sim pass.
  vec3 edgeTint = uColorAccent * (1.0 + audioHueShift(0.3));
  float edgeGain = 0.12 * audioLift(u_mids, 0.35) + beatHit(1.6) * 0.16;
  color = highlight(color, edgeTint * uIntensity, edgeStrength * edgeGain, darkBg);

  // ── 6. Treble sparkle, confined to the pattern ───────────────────
  // High-frequency audio content is spatially high-frequency too. Masked by
  // patternStrength so it never speckles the empty background.
  float sparkle = hash(gl_FragCoord.xy * 1.9 + fract(uTime * 3.7) * 71.0);
  sparkle = pow(sparkle, 11.0) * u_treble * u_audioActive * patternStrength;
  color = highlight(color, mix(uColorAccent, vec3(1.0), 0.5), sparkle * 1.6, darkBg);

  // ── 7. Tone mapping, relative to the background ──────────────────
  color = toneOverBg(color, uBgColor);

  // ── 8. Vignette ──────────────────────────────────────────────────
  // Reads as a frame around a hero but as a tunnel in fullscreen immersive
  // mode, so it fades out with the audio ramp instead of being switched off
  // (which would pop on the first beat). The renderer applies the ramp.
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // ── 9. Film grain ────────────────────────────────────────────────
  // u_flux is noisy by design, which is exactly right for grain.
  float grainAmt = uGrain * audioLift(u_flux, 0.5);
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * grainAmt;

  // ── 10. Brightness cap, floored at the background ────────────────
  vec3 cap = max(vec3(0.75), uBgColor);
  fragColor = vec4(clamp(color, vec3(0.0), cap), 1.0);
}
`;

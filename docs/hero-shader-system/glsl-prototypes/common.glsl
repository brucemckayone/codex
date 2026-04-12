/**
 * common.glsl — Shared GLSL Library for Codex Shader Hero
 *
 * Prepended to every preset fragment shader at compile time.
 * All functions are GLSL ES 1.0 compatible (WebGL 1).
 *
 * Based on ashima/webgl-noise (MIT License)
 * https://github.com/ashima/webgl-noise
 *
 * Includes:
 *   - 2D Simplex noise (snoise2)
 *   - 3D Simplex noise (snoise3)
 *   - FBM (fractional brownian motion)
 *   - Utility: smoothmin, hash, palette mixing, ripple effect
 */

precision mediump float;

// ═══════════════════════════════════════════════════════════════════
// UNIFORMS (shared contract — every preset receives these)
// ═══════════════════════════════════════════════════════════════════

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_speed;
uniform float u_intensity;
uniform float u_complexity;
uniform vec2 u_mouse;
uniform float u_mouse_influence;
uniform float u_scroll;
uniform vec3 u_color_primary;
uniform vec3 u_color_secondary;
uniform vec3 u_color_accent;
uniform vec3 u_color_bg;

varying vec2 v_uv;

// ═══════════════════════════════════════════════════════════════════
// 2D SIMPLEX NOISE (Ashima / Ian McEwan — MIT License)
// ═══════════════════════════════════════════════════════════════════
//
// Compact, no texture lookups, mediump safe.
// Returns value in range [-1, 1].

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec2 mod289v2(vec2 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec3 permute(vec3 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

float snoise2(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187,   // (3.0 - sqrt(3.0)) / 6.0
    0.366025403784439,   // 0.5 * (sqrt(3.0) - 1.0)
   -0.577350269189626,   // -1.0 + 2.0 * C.x
    0.024390243902439    // 1.0 / 41.0
  );

  // First corner
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);

  // Other corners
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;

  // Permutations
  i = mod289v2(i);
  vec3 p = permute(
    permute(i.y + vec3(0.0, i1.y, 1.0))
          + i.x + vec3(0.0, i1.x, 1.0)
  );

  vec3 m = max(0.5 - vec3(
    dot(x0, x0),
    dot(x12.xy, x12.xy),
    dot(x12.zw, x12.zw)
  ), 0.0);
  m = m * m;
  m = m * m;

  // Gradients
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;

  // Normalise gradients implicitly by scaling m
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);

  // Compute final noise value at P
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;

  return 130.0 * dot(m, g);
}

// ═══════════════════════════════════════════════════════════════════
// 3D SIMPLEX NOISE (Ashima / Ian McEwan — MIT License)
// ═══════════════════════════════════════════════════════════════════
//
// Used for time-based animation (z = time).
// Returns value in range [-1, 1].

vec4 mod289v4(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute4(vec4 x) {
  return mod289v4(((x * 34.0) + 1.0) * x);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise3(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  // First corner
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  // Other corners
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  // Permutations
  i = mod289(i);
  vec4 p = permute4(
    permute4(
      permute4(i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0)
  );

  // Gradients: 7x7 points over a square, mapped onto an octahedron.
  float n_ = 0.142857142857;  // 1.0 / 7.0
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  // Normalise gradients
  vec4 norm = taylorInvSqrt(vec4(
    dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)
  ));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  // Mix contributions from the four corners
  vec4 m = max(0.6 - vec4(
    dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)
  ), 0.0);
  m = m * m;

  return 42.0 * dot(m * m, vec4(
    dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)
  ));
}

// ═══════════════════════════════════════════════════════════════════
// FRACTIONAL BROWNIAN MOTION (FBM)
// ═══════════════════════════════════════════════════════════════════
//
// Layers multiple noise octaves for natural-looking detail.
// `octaves` parameter controlled by u_complexity.
// Loop limit is 8 (GLSL ES 1.0 requires constant loop bounds).

float fbm2(vec2 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;

  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    value += amplitude * snoise2(p * frequency);
    amplitude *= 0.5;
    frequency *= 2.0;
  }

  return value;
}

float fbm3(vec3 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;

  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    value += amplitude * snoise3(p * frequency);
    amplitude *= 0.5;
    frequency *= 2.0;
  }

  return value;
}

// ═══════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

// Smooth minimum — blends two distance fields (used by metaballs)
float smoothmin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Hash function for Voronoi cell randomization
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

// 3-color palette interpolation (t = 0..1)
// Maps noise output to brand colors: primary → secondary → accent
vec3 brandPalette(float t, vec3 c1, vec3 c2, vec3 c3) {
  t = clamp(t, 0.0, 1.0);
  return t < 0.5
    ? mix(c1, c2, t * 2.0)
    : mix(c2, c3, (t - 0.5) * 2.0);
}

// Scroll-linked alpha fade: starts fading at 30% scroll, fully transparent at 90%
float scrollFade() {
  return 1.0 - smoothstep(0.3, 0.9, u_scroll);
}

// Aspect-corrected UV (prevents stretching on non-square canvases)
vec2 aspectUV(vec2 uv) {
  vec2 p = uv * 2.0 - 1.0;
  p.x *= u_resolution.x / u_resolution.y;
  return p;
}

// ═══════════════════════════════════════════════════════════════════
// OKLAB COLOR SPACE (Perceptually Uniform Blending)
// ═══════════════════════════════════════════════════════════════════
//
// sRGB mix() produces muddy mid-tones on dark palettes because sRGB
// is not perceptually uniform. OKLAB blending produces clean transitions
// without hue shifts or saturation dips — critical for dark brand palettes.
//
// Based on Björn Ottosson's OKLAB (2020): https://bottosson.github.io/posts/oklab/
// GLSL port adapted from yum-food/HLSL_OKLAB (MIT License).

// sRGB → linear (remove gamma)
vec3 srgbToLinear(vec3 c) {
  // Simplified: use pow(c, 2.2) approximation (exact would use piecewise function)
  return pow(max(c, 0.0), vec3(2.2));
}

// linear → sRGB (apply gamma)
vec3 linearToSrgb(vec3 c) {
  return pow(max(c, 0.0), vec3(1.0 / 2.2));
}

// Linear RGB → OKLAB
vec3 linearToOklab(vec3 c) {
  // RGB → LMS (cone response)
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2220049171 * c.g + 0.6896926210 * c.b;

  // Cube root (approximation of perceptual response)
  float l_ = pow(l, 1.0 / 3.0);
  float m_ = pow(m, 1.0 / 3.0);
  float s_ = pow(s, 1.0 / 3.0);

  // LMS → OKLAB
  return vec3(
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
  );
}

// OKLAB → Linear RGB
vec3 oklabToLinear(vec3 lab) {
  // OKLAB → LMS (inverse of above)
  float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;

  // Cube (undo cube root)
  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;

  // LMS → RGB
  return vec3(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

// Perceptually uniform color mix (replacement for sRGB mix)
// Use this instead of mix(c1, c2, t) when blending brand colors
vec3 oklabMix(vec3 c1, vec3 c2, float t) {
  vec3 lab1 = linearToOklab(srgbToLinear(c1));
  vec3 lab2 = linearToOklab(srgbToLinear(c2));
  vec3 mixed = mix(lab1, lab2, t);
  return linearToSrgb(oklabToLinear(mixed));
}

// 3-color OKLAB palette (perceptually uniform version of brandPalette)
vec3 oklabPalette(float t, vec3 c1, vec3 c2, vec3 c3) {
  t = clamp(t, 0.0, 1.0);
  return t < 0.5
    ? oklabMix(c1, c2, t * 2.0)
    : oklabMix(c2, c3, (t - 0.5) * 2.0);
}

// ═══════════════════════════════════════════════════════════════════
// BLEND MODES (Photoshop-style, per-channel)
// ═══════════════════════════════════════════════════════════════════
//
// Stripe's minigl uses these for richer layer compositing.
// Each mode operates on values in [0, 1]. ~3-5 ALU ops per channel.
// Total cost for vec3: ~10-15 ops — negligible vs noise (~20 ops).
//
// Usage: replace mix(base, blend, t) with blendScreen(base, blend) etc.
// when you want nonlinear compositing (glow, contrast, depth).

// Multiply: Always darkens. White is identity. Black absorbs.
// Use for: Voronoi cell edges, shadow overlays
vec3 blendMultiply(vec3 base, vec3 blend) {
  return base * blend;
}

// Screen: Always lightens. Inverse of multiply. Overlapping lights glow.
// Use for: Gradient mesh blob overlap, aurora glow, additive compositing
vec3 blendScreen(vec3 base, vec3 blend) {
  return 1.0 - (1.0 - base) * (1.0 - blend);
}

// Overlay: Multiply darks, screen lights. Increases contrast.
// Use for: Noise-flow contrast depth, dramatic color transitions
vec3 blendOverlay(vec3 base, vec3 blend) {
  return vec3(
    base.r < 0.5 ? 2.0 * base.r * blend.r : 1.0 - 2.0 * (1.0 - base.r) * (1.0 - blend.r),
    base.g < 0.5 ? 2.0 * base.g * blend.g : 1.0 - 2.0 * (1.0 - base.g) * (1.0 - blend.g),
    base.b < 0.5 ? 2.0 * base.b * blend.b : 1.0 - 2.0 * (1.0 - base.b) * (1.0 - blend.b)
  );
}

// Soft Light: Gentler overlay. No harsh transitions.
// Use for: Metaball edge contrast, subtle depth
vec3 blendSoftLight(vec3 base, vec3 blend) {
  return vec3(
    blend.r < 0.5 ? 2.0 * base.r * blend.r + base.r * base.r * (1.0 - 2.0 * blend.r) : sqrt(base.r) * (2.0 * blend.r - 1.0) + 2.0 * base.r * (1.0 - blend.r),
    blend.g < 0.5 ? 2.0 * base.g * blend.g + base.g * base.g * (1.0 - 2.0 * blend.g) : sqrt(base.g) * (2.0 * blend.g - 1.0) + 2.0 * base.g * (1.0 - blend.g),
    blend.b < 0.5 ? 2.0 * base.b * blend.b + base.b * base.b * (1.0 - 2.0 * blend.b) : sqrt(base.b) * (2.0 * blend.b - 1.0) + 2.0 * base.b * (1.0 - blend.b)
  );
}

// Color Dodge: Brightens base by decreasing contrast. Division-based.
// Use for: Intense glow highlights, light bloom
vec3 blendColorDodge(vec3 base, vec3 blend) {
  return vec3(
    blend.r >= 1.0 ? 1.0 : min(base.r / (1.0 - blend.r), 1.0),
    blend.g >= 1.0 ? 1.0 : min(base.g / (1.0 - blend.g), 1.0),
    blend.b >= 1.0 ? 1.0 : min(base.b / (1.0 - blend.b), 1.0)
  );
}

// ═══════════════════════════════════════════════════════════════════
// MEDIUMP-SAFE 3D ANIMATION
// ═══════════════════════════════════════════════════════════════════
//
// Problem: snoise3 uses mod(289) which overflows mediump (max 16384).
// Some Android/iOS devices have mediump-only fragment shaders.
//
// Solution: Use 2D noise with animated UV offset for time-based motion.
// This avoids 3D noise entirely while producing visually similar results.
//
// For devices that support highp, snoise3 is preferred (smoother).
// The renderer detects this via GL_FRAGMENT_PRECISION_HIGH and selects
// the appropriate code path at compile time.
//
// Future: When Gustavson releases mpsrdnoise3 (mediump 3D), switch to that.
// Or use psrdnoise2 with alpha flow parameter for organic evolution.

// Animated 2D noise: simulates 3D by offsetting UV with sin(time)
// Produces smooth evolution without 3D precision requirements
float animatedNoise2D(vec2 p, float time) {
  // Offset UV in two directions based on time (creates swirling motion)
  vec2 offset = vec2(
    sin(time * 0.3) * 0.5 + cos(time * 0.17) * 0.3,
    cos(time * 0.23) * 0.4 + sin(time * 0.13) * 0.35
  );
  return snoise2(p + offset);
}

// Animated 2D FBM: multi-octave version of above
float animatedFbm2D(vec2 p, float time, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;

  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    value += amplitude * animatedNoise2D(p * frequency, time + float(i) * 1.7);
    amplitude *= 0.5;
    frequency *= 2.0;
  }

  return value;
}

// ═══════════════════════════════════════════════════════════════════
// POST-PROCESSING (Production Polish)
// ═══════════════════════════════════════════════════════════════════
//
// These 6 functions transform "programmer art" into "designed."
// Apply as a chain at the end of every preset's main().
// Research source: Codrops, Awwwards analysis, mattdesl/glsl-film-grain

// Film grain: 1-3% noise overlay. Breaks banding, adds analog warmth.
// Blended via soft-light so it's barely perceptible but prevents "CG" look.
vec3 applyFilmGrain(vec3 color, vec2 uv, float time) {
  float grain = fract(sin(dot(uv * time * 0.5 + vec2(12.9898, 78.233), vec2(12.9898, 78.233))) * 43758.5453);
  // Luminance-aware: less grain in bright areas, more in dark
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  float grainAmount = mix(0.04, 0.015, luma); // 4% in darks, 1.5% in lights
  return color + (grain - 0.5) * grainAmount;
}

// Contrast S-curve: darkens darks, brightens brights. Adds punch.
vec3 applyContrastCurve(vec3 color) {
  return smoothstep(vec3(0.0), vec3(1.0), color);
}

// Saturation boost: prevents washed-out look from additive blending.
vec3 applySaturation(vec3 color, float amount) {
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  return mix(vec3(luma), color, amount);
}

// Vignette: 20-40% edge darkening. Frames content, draws eye to center.
vec3 applyVignette(vec3 color, vec2 uv, float strength) {
  vec2 v = uv * 2.0 - 1.0;
  float d = dot(v, v);
  float vignette = 1.0 - d * strength;
  return color * max(vignette, 0.0);
}

// Tone mapping (Reinhard): prevents HDR clipping from additive blending.
// Preserves color while softly compressing highlights.
vec3 applyToneMap(vec3 color) {
  return color / (1.0 + color);
}

// Combined post-process pass: apply all polish in correct order.
// Call this as the last step before gl_FragColor in every preset.
vec3 postProcess(vec3 color, vec2 uv, float time) {
  color = applyToneMap(color);
  color = applyContrastCurve(color);
  color = applySaturation(color, 1.15); // 15% boost
  color = applyVignette(color, uv, 0.3); // 30% edge darkening
  color = applyFilmGrain(color, uv, time);
  return clamp(color, 0.0, 1.0);
}

// Click ripple effect — expanding ring from a point
// position: normalized click position (0-1)
// clickTime: time of click
// currentTime: u_time
float rippleRing(vec2 uv, vec2 position, float clickTime, float currentTime) {
  float timeSince = currentTime - clickTime;
  if (timeSince < 0.0 || timeSince > 2.0) return 0.0;

  float dist = distance(uv, position);
  float radius = timeSince * 0.4;
  float ringWidth = 0.03;
  float ring = smoothstep(radius - ringWidth, radius, dist)
             - smoothstep(radius, radius + ringWidth, dist);
  float fade = 1.0 - timeSince * 0.5;

  return ring * fade;
}

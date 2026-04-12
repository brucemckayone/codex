# 03 — Shader Preset Catalog

**Purpose**: Technical specification for each of the 8 shader presets — visual description, mathematical basis, GLSL approach, GPU cost analysis, configuration knobs, and mouse interaction behavior.

---

## Shared Foundation

### Common GLSL (`common.glsl`)

All presets share a common GLSL library prepended at compile time. This contains:

```glsl
precision mediump float;

// ─── Simplex Noise (2D) ────────────────────────────
// Based on Stefan Gustavson's implementation (MIT license)
// Compact, no texture lookups, GLSL ES 1.0 compatible
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                          + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                           dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);  // Returns -1 to 1
}

// ─── Simplex Noise (3D) ────────────────────────────
// For time-based animation (z = time)
// [Full implementation ~60 lines — abbreviated here, will include Gustavson's full 3D version]

// ─── Fractional Brownian Motion ────────────────────
float fbm(vec2 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  for (int i = 0; i < 8; i++) {  // Loop limit must be constant in GLSL ES 1.0
    if (i >= octaves) break;
    value += amplitude * snoise(p * frequency);
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return value;
}

// ─── Utility Functions ─────────────────────────────
float smoothmin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Hash functions for Voronoi
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

// Color mixing (lerp 3 colors by position)
vec3 palette(float t, vec3 c1, vec3 c2, vec3 c3) {
  return t < 0.5
    ? mix(c1, c2, t * 2.0)
    : mix(c2, c3, (t - 0.5) * 2.0);
}
```

### Uniform Block (All Presets Receive)

```glsl
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
```

---

## Preset 1: `gradient-mesh`

### Visual Description

3-5 large, soft color blobs slowly drifting across the surface, blending where they overlap. The effect used by Stripe.com's homepage — organic, professional, and subtle.

### Mathematical Basis

- Sample 2D simplex noise at 3 different offset positions (one per brand color)
- Each noise value drives the mix factor for one color
- Very low frequency (0.5-1.0) for large blobs
- Time animation via slow `u_time` offset to noise coordinates

### GLSL Approach

```glsl
void main() {
  vec2 uv = v_uv;
  
  // Mouse displacement
  vec2 mouseOffset = (u_mouse - 0.5) * u_mouse_influence * 0.15;
  uv += mouseOffset;
  
  // Scale UV for blob size
  vec2 p = uv * 2.0 - 1.0;
  p.x *= u_resolution.x / u_resolution.y; // Aspect ratio correction
  
  float t = u_time * 0.15;
  
  // 3 noise fields, one per color, with different offsets
  float n1 = snoise(p * 0.8 + vec2(t * 0.3, t * 0.2)) * 0.5 + 0.5;
  float n2 = snoise(p * 0.6 + vec2(-t * 0.2, t * 0.35) + 3.7) * 0.5 + 0.5;
  float n3 = snoise(p * 0.7 + vec2(t * 0.25, -t * 0.15) + 7.3) * 0.5 + 0.5;
  
  // Blend colors based on noise
  vec3 color = u_color_primary * n1 + u_color_secondary * n2 + u_color_accent * n3;
  color /= (n1 + n2 + n3 + 0.001); // Normalize
  
  // Intensity control
  color = mix(mix(u_color_primary, u_color_secondary, 0.5), color, u_intensity);
  
  // Scroll fade
  float alpha = 1.0 - smoothstep(0.3, 0.9, u_scroll);
  
  gl_FragColor = vec4(color, alpha);
}
```

### GPU Cost

- 3 × 2D simplex noise evaluations (~20 ops each) = ~60 ops/fragment
- At 1080p DPR 1: ~2M fragments × 60 ops = trivial
- **Estimated frame time**: 0.2ms desktop, 0.4ms mobile

### Configuration Knobs

| Knob | Maps To | Range | Effect |
|------|---------|-------|--------|
| `u_speed` | Blob drift rate | 0.1 - 2.0 | Slower = more meditative |
| `u_intensity` | Color blend strength | 0 - 1 | 0 = flat gradient, 1 = full blobs |
| `u_complexity` | Not used (single octave) | — | Could add octaves for finer detail |
| `u_mouse` | Blob displacement | — | Blobs shift toward cursor |

### Mouse Interaction

Blobs gently shift toward the cursor. The displacement is subtle (15% of cursor offset) to avoid making the effect feel like a toy.

---

## Preset 2: `noise-flow`

### Visual Description

Flowing, organic color field — like paint mixing in slow motion. More dynamic and detailed than gradient-mesh. Inspired by Linear.dev's aesthetic.

### Mathematical Basis

- FBM (Fractional Brownian Motion) with 3-6 octaves of simplex noise
- Domain warping: noise of noise creates the fluid/liquid appearance
- Time in the Z dimension of 3D noise for temporal coherence

### GLSL Approach

```glsl
void main() {
  vec2 uv = v_uv;
  vec2 p = uv * 3.0; // Scale
  p.x *= u_resolution.x / u_resolution.y;
  
  float t = u_time * 0.2;
  int octaves = int(u_complexity * 4.0) + 1; // 1-5 octaves
  
  // Domain warping: warp the UV coords with noise before sampling
  float warp1 = fbm(p + vec2(t * 0.3, t * 0.2), octaves);
  float warp2 = fbm(p + vec2(t * -0.2, t * 0.35) + 5.2, octaves);
  vec2 warped = p + vec2(warp1, warp2) * 0.5;
  
  // Mouse adds localized warp
  float mouseDist = distance(uv, u_mouse);
  float mouseWarp = smoothstep(0.3, 0.0, mouseDist) * u_mouse_influence;
  warped += (u_mouse - uv) * mouseWarp * 0.5;
  
  // Final noise sample for color
  float n = fbm(warped + vec2(t * 0.1), octaves) * 0.5 + 0.5;
  
  // Map noise to 3-color palette
  vec3 color = palette(n, u_color_primary, u_color_secondary, u_color_accent);
  color = mix(u_color_primary, color, u_intensity);
  
  float alpha = 1.0 - smoothstep(0.3, 0.9, u_scroll);
  gl_FragColor = vec4(color, alpha);
}
```

### GPU Cost

- FBM with 4 octaves = 4 noise evals per call, 2 calls for domain warp + 1 final = ~12 noise evals
- Each noise eval ~20 ops = ~240 ops/fragment
- **Estimated frame time**: 0.3ms desktop, 0.8ms mobile (reduced to 0.4ms with complexity × 0.5)

### Configuration Knobs

| Knob | Effect |
|------|--------|
| `u_speed` | Flow rate — how fast the field evolves |
| `u_intensity` | Warp strength and color variation |
| `u_complexity` | Octave count: 1 = smooth blobs, 5 = fine detail |
| `u_mouse` | Localized domain warp (field bends toward cursor) |

---

## Preset 3: `aurora`

### Visual Description

Northern lights — horizontal bands of colored light with vertical shimmer. The most visually striking preset with minimal GPU cost.

### Mathematical Basis

- 3-5 layered sine waves with different frequencies, phases, and amplitudes
- Vertical gradient mask (strongest in center, fading at top/bottom)
- Noise displacement on the X axis for organic movement
- Color interpolation along vertical axis: primary → secondary → accent

### GLSL Approach

```glsl
void main() {
  vec2 uv = v_uv;
  float t = u_time * 0.3;
  
  // Vertical position drives base color
  float yPos = uv.y;
  
  // Mouse shifts the aurora's center
  float mouseShift = (u_mouse.y - 0.5) * u_mouse_influence * 0.2;
  yPos += mouseShift;
  
  // Layered sine waves create the aurora curtain
  float wave = 0.0;
  int layers = int(u_complexity * 5.0) + 2; // 2-7 layers
  
  for (int i = 0; i < 7; i++) {
    if (i >= layers) break;
    float fi = float(i);
    float freq = 2.0 + fi * 1.5;
    float speed = 0.3 + fi * 0.1;
    float amp = 0.15 / (1.0 + fi * 0.5);
    
    // Noise displacement for organic movement
    float noiseOffset = snoise(vec2(uv.x * 2.0 + fi * 3.7, t * speed)) * 0.3;
    wave += sin(uv.x * freq + t * speed + noiseOffset) * amp;
  }
  
  // Brightness concentrated around horizontal bands
  float brightness = smoothstep(0.3, 0.0, abs(yPos - 0.5 + wave - 0.1));
  brightness += smoothstep(0.25, 0.0, abs(yPos - 0.5 + wave + 0.15)) * 0.6;
  
  // Shimmer (high-frequency noise)
  float shimmer = snoise(vec2(uv.x * 8.0, uv.y * 4.0 + t * 2.0)) * 0.15 + 0.85;
  brightness *= shimmer;
  
  // Color from brand palette, mapped by vertical position
  vec3 color = palette(yPos, u_color_primary, u_color_secondary, u_color_accent);
  
  // Apply intensity
  color *= brightness * u_intensity;
  
  // Add subtle glow on top of background
  vec3 final = mix(u_color_bg * 0.1, color, brightness * u_intensity);
  
  float alpha = 1.0 - smoothstep(0.3, 0.9, u_scroll);
  gl_FragColor = vec4(final, alpha);
}
```

### GPU Cost

- 2-7 `sin()` calls + 2 noise evaluations + 1 noise for shimmer = ~8-15 ops
- **Estimated frame time**: 0.15ms desktop, 0.3ms mobile
- This is the most efficient preset — ideal for mobile-first deployment

### Configuration Knobs

| Knob | Effect |
|------|--------|
| `u_speed` | Wave movement speed |
| `u_intensity` | Brightness and saturation |
| `u_complexity` | Wave count: 2 = simple curtain, 7 = intricate layers |
| `u_mouse` | Aurora center shifts vertically toward cursor |

---

## Preset 4: `voronoi`

### Visual Description

Organic cellular pattern — like soap bubbles, honeycomb, or biological cells. Cells slowly morph as seed points drift. Each cell is tinted with a brand color.

### Mathematical Basis

- N seed points (12-20) with animated positions (sine/cosine paths)
- For each fragment, find the nearest seed → color by seed identity
- Second-nearest distance minus nearest = cell border detection

### GPU Cost

- O(N) distance calculations per fragment, N = 12-20
- ~50 distance ops + ~10 `sin`/`cos` ops = ~60-100 ops/fragment
- **Estimated frame time**: 0.5ms desktop, 1.2ms mobile (0.6ms at reduced complexity)

---

## Preset 5: `metaballs`

### Visual Description

Smooth blobby shapes merging and separating — like a lava lamp. High-quality SDF rendering gives perfectly smooth edges.

### Mathematical Basis

- 5-8 circle centers animated along Lissajous curves
- For each fragment, sum `radius² / distance²` for all circles
- Threshold the sum: above threshold = inside blob
- `smoothstep` at threshold boundary = smooth edges
- Color based on dominant blob (nearest center)

### GPU Cost

- O(N) per fragment, N = 5-8
- ~20-30 distance + division operations
- **Estimated frame time**: 0.3ms desktop, 0.7ms mobile (0.4ms reduced)

---

## Preset 6: `waves`

### Visual Description

Concentric ripples and water caustic patterns. When multiple wave sources interfere, complex patterns emerge.

### Mathematical Basis

- 3-5 wave sources with fixed positions + 1 source following mouse
- For each source: `sin(distance * frequency - time) / distance`
- Sum all wave contributions = interference pattern
- Color modulation based on wave height

### GPU Cost

- 4-6 distance + sin operations = ~20-30 ops/fragment
- Very efficient
- **Estimated frame time**: 0.25ms desktop, 0.5ms mobile

---

## Preset 7: `particles`

### Visual Description

Floating dots / dust / starfield with parallax depth layers. Not a vertex shader approach — this uses a hash-based technique to place particles in a tiled grid.

### Mathematical Basis

- Tile UV space into a grid
- Hash each cell to determine if it contains a particle and its properties
- 3 depth layers with different speeds (parallax)
- Each particle is a soft circle (smoothstep on distance from cell center)

### GPU Cost

- 3 layers × (hash + distance + smoothstep) = ~30 ops/fragment
- **Estimated frame time**: 0.2ms desktop, 0.4ms mobile

---

## Preset 8: `geometric`

### Visual Description

Slowly rotating kaleidoscopic pattern — sacred geometry, Penrose-like tiling, mandala feel. Sharp lines and mathematical precision.

### Mathematical Basis

- Convert to polar coordinates (angle, radius)
- Apply rotational symmetry: `angle = mod(angle, TWO_PI / symmetryOrder)`
- Apply noise distortion for organic movement
- Draw lines using `fract()` and `step()` with smooth anti-aliasing

### GPU Cost

- 2 `atan` + 2 `length` + 2 noise + ~10 `fract`/`step` = ~40-50 ops
- **Estimated frame time**: 0.4ms desktop, 0.9ms mobile (0.5ms reduced)

---

## Preset Comparison Summary

| Preset | Category | GPU Cost | Best For | Mood |
|--------|----------|----------|----------|------|
| gradient-mesh | Ambient | Very Low | Professional brands, subtle elegance | Calm, trustworthy |
| noise-flow | Dynamic | Low | Tech brands, modern feel | Fluid, dynamic |
| aurora | Ambient | Very Low | Bold brands, dramatic impact | Majestic, impressive |
| voronoi | Organic | Medium | Wellness, nature, biology | Organic, alive |
| metaballs | Organic | Low | Playful brands, creative studios | Fun, approachable |
| waves | Ambient | Low | Water/ocean themes, meditation apps | Calm, rhythmic |
| particles | Ambient | Low | Tech, space, network themes | Cosmic, expansive |
| geometric | Geometric | Medium | Design studios, architecture, minimal | Precise, mathematical |

---

## Color Handling Across Presets

All presets receive the same 3 brand colors as uniforms. How they use them varies:

| Preset | Primary | Secondary | Accent |
|--------|---------|-----------|--------|
| gradient-mesh | Blob 1 color | Blob 2 color | Blob 3 color |
| noise-flow | Low noise value | Mid noise value | High noise value |
| aurora | Bottom band | Middle band | Top band |
| voronoi | Cells near left | Cells near center | Cells near right |
| metaballs | Blob 1 | Blob 2-3 | Blob edge glow |
| waves | Wave peaks | Wave troughs | Interference highlights |
| particles | Layer 1 dots | Layer 2 dots | Layer 3 dots |
| geometric | Primary lines | Secondary fill | Accent highlights |

### Handling Missing Colors

If secondary or accent is null (not set by org), the shader falls back:
- Missing secondary → darker shade of primary (`u_color_primary * 0.6`)
- Missing accent → complementary of primary (rotate hue ~120deg in shader)

This is handled in `shader-renderer.ts` before uploading uniforms:
```typescript
const secondary = colors.secondary !== '#6B7280'  // Default gray = not explicitly set
  ? hexToVec3(colors.secondary)
  : [primaryVec[0] * 0.6, primaryVec[1] * 0.6, primaryVec[2] * 0.6];
```

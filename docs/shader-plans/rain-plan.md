# Rain on Glass Shader Preset — Implementation Plan

## Overview

Add a "rain" shader preset: single-pass raindrops trickling down a window pane, leaving trails, refracting a brand-colored background scene behind the glass. Uses the BigWings "Heartfelt" layered-grid technique — no FBOs needed. Mouse creates a "wiper" effect that smears/pushes drops aside. Lerped mouse (MOUSE_LERP = 0.04) for smooth wiper motion.

The effect composites three visual layers:
1. **Background scene** — soft procedural gradient of all brand colors (layered noise blobs), simulating an out-of-focus city/landscape behind glass
2. **Glass surface** — subtle tint from primary color, slight ambient reflection
3. **Raindrops** — multiple grid layers at different scales, each drop with a body circle + elongated trail with sub-drops, computing normal vectors from SDF gradients to refract the background through each drop

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify — add `RainConfig`, union entry, `'rain'` to `ShaderPresetId`, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/rain.frag.ts` | Create — rain-on-glass fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/rain-renderer.ts` | Create — single-pass renderer with lerped mouse |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify — add `'rain'` case to `loadRenderer()` |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify — add 5 keys to `BRAND_PREFIX_KEYS` |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify — preset card + 5 sliders + $derived bindings + DEFAULTS entries |

## Config Interface

```typescript
export interface RainConfig extends ShaderConfigBase {
  preset: 'rain';
  density: number;     // 0.3-1.0, default 0.6 — drop density (grid subdivision)
  speed: number;       // 0.5-2.0, default 1.0 — fall speed multiplier
  size: number;        // 0.5-2.0, default 1.0 — drop size multiplier
  refraction: number;  // 0.1-0.5, default 0.3 — refraction distortion strength
  blur: number;        // 0.5-2.0, default 1.0 — background blur/softness
}
```

## Defaults

```typescript
// In DEFAULTS object (shader-config.ts)
rainDensity: 0.6,
rainSpeed: 1.0,
rainSize: 1.0,
rainRefraction: 0.3,
rainBlur: 1.0,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

All 5 keys must be added to the `BRAND_PREFIX_KEYS` set in `css-injection.ts`:

```
shader-rain-density
shader-rain-speed
shader-rain-size
shader-rain-refraction
shader-rain-blur
```

## Fragment Shader (rain.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `u_time` | `float` | Elapsed seconds |
| `u_resolution` | `vec2` | Canvas dimensions |
| `u_mouse` | `vec2` | Normalized mouse (0-1), lerped |
| `u_burstStrength` | `float` | Click burst (decays) — creates splash ripple |
| `u_brandPrimary` | `vec3` | Glass tint / warm background glow |
| `u_brandSecondary` | `vec3` | Background mid-tone blobs |
| `u_brandAccent` | `vec3` | Drop highlight / rim light / bright background blobs |
| `u_bgColor` | `vec3` | Deep base tone behind scene |
| `u_density` | `float` | Drop density (grid subdivision count) |
| `u_speed` | `float` | Fall speed multiplier |
| `u_size` | `float` | Drop size multiplier |
| `u_refraction` | `float` | Refraction distortion strength |
| `u_blur` | `float` | Background blur/softness |
| `u_intensity` | `float` | Overall blend |
| `u_grain` | `float` | Film grain |
| `u_vignette` | `float` | Vignette |

### Algorithm (BigWins "Heartfelt" Technique)

The core technique tiles the screen into a grid where each cell hosts one raindrop. Multiple grid layers at different scales create varied drop sizes. The key insight: computing a smooth SDF for each drop body + trail, then using the SDF gradient as a normal vector to refract/distort the UV lookup into the background.

#### Step 1: Background Scene (Procedural Blurred Gradient)

Generate a soft, out-of-focus scene behind the glass using layered FBM noise blobs colored with brand colors:

```glsl
vec3 backgroundScene(vec2 uv, float blur) {
  // Base: dark bg color
  vec3 bg = u_bgColor * 0.4;

  // Layer 1: large primary-colored blob (warm glow)
  float n1 = fbm(uv * 1.5 * blur + vec2(0.3, 0.7));
  bg += u_brandPrimary * smoothstep(0.1, 0.6, n1) * 0.4;

  // Layer 2: medium secondary-colored blobs
  float n2 = fbm(uv * 2.5 * blur + vec2(1.7, 0.2));
  bg += u_brandSecondary * smoothstep(0.2, 0.7, n2) * 0.3;

  // Layer 3: small accent highlights (streetlights / neon)
  float n3 = fbm(uv * 4.0 * blur + vec2(0.9, 1.4));
  bg += u_brandAccent * smoothstep(0.4, 0.8, n3) * 0.25;

  return bg;
}
```

This creates the illusion of a blurred cityscape / landscape with the brand's color palette shining through. The `blur` uniform scales the frequency — lower blur = sharper details, higher blur = softer (more out-of-focus).

#### Step 2: Raindrop Grid Layer

For each grid layer (3 layers at different scales for depth):

```glsl
// Returns vec2: xy = refraction normal, w (encoded in length) = drop mask
vec3 rainLayer(vec2 uv, float gridScale, float t) {
  vec2 aspect = vec2(1.0, 2.0);  // Cells taller than wide (drops fall vertically)
  vec2 st = uv * gridScale * aspect;

  // Per-cell random offset and phase
  vec2 id = floor(st);
  vec2 frac = fract(st) - 0.5;

  // Hash for random properties per cell
  float h = hash(id);
  float h2 = hash(id + vec2(127.1, 311.7));

  // Skip some cells based on density
  if (h > u_density) return vec3(0.0);

  // ── Main drop body ──
  // Random horizontal wobble as drop falls
  float wobble = sin(t * u_speed + h * 6.28) * 0.3;
  // Vertical position: slowly descending with time
  float dropY = fract(t * u_speed * (0.5 + h * 0.5) + h2) * 2.0 - 1.0;

  vec2 dropPos = vec2(wobble * 0.2, dropY);
  vec2 toCenter = frac - dropPos;

  // Elliptical SDF (wider than tall for natural drop shape)
  float dropRadius = (0.03 + h * 0.02) * u_size;
  float sdf = length(toCenter / vec2(1.0, 1.5)) - dropRadius;

  // ── Trail behind the drop ──
  // Trail is a thin elongated shape above the main drop
  float trailMask = 0.0;
  float trailLen = 0.3 + h * 0.3;
  for (int i = 0; i < 4; i++) {
    float fi = float(i) / 4.0;
    float subH = hash(id + vec2(float(i) * 13.0, 0.0));
    vec2 subPos = dropPos + vec2(sin(fi * 3.14 + h) * 0.05, fi * trailLen);
    float subR = dropRadius * (0.3 - fi * 0.06) * (subH * 0.5 + 0.5);
    float subSdf = length(frac - subPos) - subR;
    trailMask = max(trailMask, smoothstep(0.01, 0.0, subSdf));
  }

  // Combine main drop + trail into a single mask
  float dropMask = smoothstep(0.01, 0.0, sdf);
  float totalMask = max(dropMask, trailMask * 0.6);

  // ── Normal from SDF gradient ──
  // Approximate gradient via finite differences (or use dFdx/dFdy)
  // n = normalize(vec2(dFdx(sdf), dFdy(sdf)))
  // This creates the refraction lens effect
  vec2 normal = toCenter / (length(toCenter) + 0.001);
  normal *= smoothstep(dropRadius * 2.0, 0.0, length(toCenter));

  return vec3(normal * totalMask, totalMask);
}
```

#### Step 3: Wiper Effect (Mouse Interaction)

The mouse acts as a windshield wiper — drops near the cursor are pushed aside:

```glsl
// In main():
vec2 wiperCenter = u_mouse;
float wiperRadius = 0.15;
float wiperDist = length(v_uv - wiperCenter);
float wiperMask = smoothstep(wiperRadius, wiperRadius * 0.3, wiperDist);

// Reduce drop visibility near wiper
totalMask *= (1.0 - wiperMask * 0.8);

// Push refraction normals away from wiper center
vec2 wiperPush = normalize(v_uv - wiperCenter) * wiperMask * 0.1;
refractionNormal += wiperPush;
```

The lerped mouse (MOUSE_LERP = 0.04) ensures the wiper sweeps smoothly rather than teleporting, creating a satisfying dragging motion.

#### Step 4: Click Burst (Splash)

Click creates a radial splash that temporarily scatters drops:

```glsl
if (u_burstStrength > 0.01) {
  vec2 burstUv = v_uv - u_mouse;
  float burstDist = length(burstUv);
  // Expanding ring
  float ring = abs(burstDist - u_burstStrength * 0.3) - 0.01;
  float splash = smoothstep(0.02, 0.0, ring) * u_burstStrength;
  // Add outward refraction from splash point
  refractionNormal += normalize(burstUv) * splash * 0.3;
}
```

#### Step 5: Composite

```glsl
void main() {
  float t = u_time;
  vec2 uv = v_uv;

  // 1. Accumulate drops from 3 grid layers (small, medium, large)
  vec3 layer1 = rainLayer(uv, 8.0, t);
  vec3 layer2 = rainLayer(uv + vec2(0.37, 0.13), 5.0, t * 0.8);
  vec3 layer3 = rainLayer(uv + vec2(0.71, 0.59), 3.0, t * 0.6);

  vec2 totalNormal = layer1.xy + layer2.xy * 0.7 + layer3.xy * 0.5;
  float totalMask = max(max(layer1.z, layer2.z), layer3.z);

  // 2. Apply wiper + burst modifications
  // ... (see steps 3-4 above)

  // 3. Refracted background lookup
  vec2 refractedUv = uv + totalNormal * u_refraction;
  vec3 refractedBg = backgroundScene(refractedUv, u_blur);

  // 4. Non-refracted background (seen through plain glass)
  vec3 plainBg = backgroundScene(uv, u_blur);

  // 5. Glass tint
  vec3 glassTint = mix(plainBg, u_brandPrimary * 0.1, 0.05);

  // 6. Drop highlights (Fresnel-like rim on drops)
  float rim = pow(1.0 - abs(dot(normalize(vec3(totalNormal, 1.0)), vec3(0, 0, 1))), 3.0);
  vec3 highlight = u_brandAccent * rim * totalMask * 0.3;

  // 7. Final composite
  vec3 color = mix(glassTint, refractedBg, totalMask) + highlight;

  // ── Post-processing (must match all other presets) ──

  // Reinhard tone mapping
  color = color / (1.0 + color);

  // Cap maximum brightness
  color = min(color, vec3(0.7));

  // Intensity blend
  color = mix(u_bgColor, color, u_intensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  // Final clamp
  fragColor = vec4(clamp(color, 0.0, 0.7), 1.0);
}
```

### Noise Functions

```glsl
// Hash — stable across platforms (fract(sin(dot)) pattern)
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Smooth value noise
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);  // smoothstep interpolation
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// FBM for background blobs — 3 octaves
const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);
float fbm(vec2 p) {
  float f = 0.0;
  f += 0.500 * noise(p); p = octaveRot * p * 2.02;
  f += 0.250 * noise(p); p = octaveRot * p * 2.03;
  f += 0.125 * noise(p);
  return f / 0.875;
}
```

### Brand Color Mapping

| Visual Element | Brand Color | Effect |
|---|---|---|
| Glass tint / warm glow behind glass | `u_brandPrimary` | Warm tone cast on glass surface |
| Background mid-tone blobs | `u_brandSecondary` | Mid-frequency bokeh/city lights |
| Drop highlight / rim light / bright blobs | `u_brandAccent` | Specular highlights on drop edges, neon lights behind glass |
| Deep base tone | `u_bgColor` | Darkest regions, night sky feeling |

**Mood adaptation:**
- Very dark brands (low luminance bg) = night rain, moody, neon reflections through drops
- Bright brands (high luminance bg) = spring rain, warm window, diffuse daylight
- High saturation accent = vivid neon refracted through drops
- Desaturated palette = gentle misty rain

### Performance

- 3 grid layers x ~12 cells visible per layer = ~36 drop evaluations per pixel
- Trail sub-drops: 4 per drop = ~144 SDF evaluations (but most cells are skipped via density check)
- Background FBM: 3 octaves x 3 layers = 9 noise evals (but only 2 lookups: refracted + plain)
- **Estimated**: ~2-4ms desktop, ~3-6ms mobile at DPR 1
- Density slider directly reduces work (fewer cells pass the threshold)
- Grid-based: no dependent texture reads, no FBOs, fully parallelizable

## Renderer (rain-renderer.ts)

Single-pass, follows nebula-renderer pattern exactly:

```typescript
export function createRainRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<RainUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal lerped mouse state for smooth wiper
  let lerpedMouse = { x: 0.5, y: 0.5 };
  const MOUSE_LERP = 0.04;

  return {
    init(gl, width, height): boolean {
      program = createProgram(gl, VERTEX_SHADER, RAIN_FRAG);
      if (!program) return false;
      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);
      lerpedMouse = { x: 0.5, y: 0.5 };
      return true;
    },

    render(gl, time, mouse, config, width, height): void {
      if (!program || !uniforms || !quad) return;
      const cfg = config as RainConfig;

      // Lerp mouse for smooth wiper
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      lerpedMouse.x += (targetX - lerpedMouse.x) * MOUSE_LERP;
      lerpedMouse.y += (targetY - lerpedMouse.y) * MOUSE_LERP;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);
      gl.uniform1f(uniforms.u_burstStrength, mouse.burstStrength);

      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      gl.uniform1f(uniforms.u_density, cfg.density ?? 0.6);
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? 1.0);
      gl.uniform1f(uniforms.u_size, cfg.size ?? 1.0);
      gl.uniform1f(uniforms.u_refraction, cfg.refraction ?? 0.3);
      gl.uniform1f(uniforms.u_blur, cfg.blur ?? 1.0);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? 0.65);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? 0.025);
      gl.uniform1f(uniforms.u_vignette, cfg.vignette ?? 0.2);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl, _width, _height): void {
      // Single-pass: no FBOs to resize. Viewport set in render().
    },

    reset(_gl): void {
      lerpedMouse = { x: 0.5, y: 0.5 };
    },

    destroy(gl): void {
      if (program) { gl.deleteProgram(program); program = null; }
      if (quad) { gl.deleteBuffer(quad.buffer); quad = null; }
      uniforms = null;
    },
  };
}
```

### Uniform List

```typescript
const UNIFORM_NAMES = [
  'u_time',
  'u_resolution',
  'u_mouse',
  'u_burstStrength',
  'u_brandPrimary',
  'u_brandSecondary',
  'u_brandAccent',
  'u_bgColor',
  'u_density',
  'u_speed',
  'u_size',
  'u_refraction',
  'u_blur',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;
```

## Brand Editor Sliders

### DEFAULTS entries (BrandEditorHeroEffects.svelte)

```typescript
'shader-rain-density': '0.60',
'shader-rain-speed': '1.00',
'shader-rain-size': '1.00',
'shader-rain-refraction': '0.30',
'shader-rain-blur': '1.00',
```

### $derived bindings

```typescript
const rainDensity = $derived(readNum('shader-rain-density'));
const rainSpeed = $derived(readNum('shader-rain-speed'));
const rainSize = $derived(readNum('shader-rain-size'));
const rainRefraction = $derived(readNum('shader-rain-refraction'));
const rainBlur = $derived(readNum('shader-rain-blur'));
```

### Preset card

```typescript
{ id: 'rain', label: 'Rain', description: 'Raindrops on glass' },
```

### Slider definitions

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| `shader-rain-density` | Drop Density | 0.30 | 1.00 | 0.05 | 0.60 | Sparse | Dense |
| `shader-rain-speed` | Fall Speed | 0.50 | 2.00 | 0.05 | 1.00 | Drizzle | Downpour |
| `shader-rain-size` | Drop Size | 0.50 | 2.00 | 0.05 | 1.00 | Fine | Heavy |
| `shader-rain-refraction` | Refraction | 0.10 | 0.50 | 0.01 | 0.30 | Subtle | Warped |
| `shader-rain-blur` | Background Blur | 0.50 | 2.00 | 0.05 | 1.00 | Sharp | Dreamy |

## Shader Config Switch Case

```typescript
case 'rain':
  return {
    ...base,
    preset: 'rain',
    density: rv('shader-rain-density', DEFAULTS.rainDensity),
    speed: rv('shader-rain-speed', DEFAULTS.rainSpeed),
    size: rv('shader-rain-size', DEFAULTS.rainSize),
    refraction: rv('shader-rain-refraction', DEFAULTS.rainRefraction),
    blur: rv('shader-rain-blur', DEFAULTS.rainBlur),
  };
```

## Gotchas

1. **BRAND_PREFIX_KEYS registration is CRITICAL** — all 5 keys (`shader-rain-density`, `shader-rain-speed`, `shader-rain-size`, `shader-rain-refraction`, `shader-rain-blur`) must be added to the set in `css-injection.ts`, otherwise the values will get `--color-` prefix instead of `--brand-` prefix and `readBrandVar()` will never find them.

2. **Lerped mouse (MOUSE_LERP = 0.04)** — the wiper effect must use internally lerped mouse coordinates, NOT the raw mouse position. This creates the satisfying drag/sweep motion. When mouse is inactive, lerp target returns to center (0.5, 0.5) so the wiper "parks" in the middle.

3. **Hash stability** — the `fract(sin(dot))` pattern can produce different results on different GPUs. Use the safer `fract(vec3(...) * 0.1031)` hash from nebula (already battle-tested in this codebase) for all cell randomization.

4. **Post-processing chain must match exactly** — Reinhard -> cap 0.7 -> intensity blend -> vignette -> grain -> final clamp(0, 0.7). Deviating from this order or changing the cap will make this preset look inconsistent with all others.

5. **v_uv vs gl_FragCoord** — use `v_uv` (0-1 range) for the rain grid since drops should tile uniformly across the screen. Use `gl_FragCoord` only if aspect correction is needed for background scene elements. The wiper uses `v_uv` coordinates since mouse input is already 0-1 normalized.

6. **Mouse Y direction** — per `renderer-types.ts`, Y is bottom-to-top (0=bottom, 1=top). Rain falls top-to-bottom visually, so `dropY` animation goes from high fract values to low, or equivalently, use `fract(-t * speed + phase)` for downward motion.

7. **Grid cell aspect ratio** — rain cells should be taller than wide (aspect `vec2(1.0, 2.0)`) because drops travel vertically. Without this, drops would appear to fall diagonally or have unnaturally wide trails.

8. **Density as skip threshold** — cells with `hash(cellId) > u_density` are skipped entirely (return zero normal + zero mask). This is both a visual control AND a performance optimization since skipped cells avoid all SDF/trail computation.

9. **Trail sub-drops loop** — the `for (int i = 0; i < 4; i++)` loop for trail sub-drops uses a compile-time constant upper bound (WebGL2 requires it). 4 sub-drops is a good balance of visual quality vs cost.

10. **ShaderPresetId union** — must add `'rain'` to the union type in `shader-config.ts`. Currently 15 values (including 'none'); this becomes 16.

11. **Preset grid layout** — adding rain as the 16th preset (after lava) gives 8 rows in a 2-column grid (even), which fills cleanly.

12. **Background FBM reuse** — the background scene function is called twice per pixel (plain + refracted UV). Consider caching the plain lookup and only re-evaluating at the refracted UV, or accept the cost since FBM is relatively cheap (3 octaves of hash-based noise).

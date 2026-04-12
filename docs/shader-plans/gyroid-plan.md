# Gyroid (Organic Gyroid Volumetric) Shader Preset — Implementation Plan

## Overview

Add a "gyroid" shader preset: an inverted-sphere volumetric with layered gyroid SDFs and density-based accumulation. Single-pass (no FBO). Two nested gyroids at different frequencies create an intricate organic lattice. Space inversion (`p = p * k / dot(p,p)`) bends the gyroid into a spherical topology. Volumetric raymarching accumulates density at the gyroid surface with brand-colored depth gradients. Mouse rotates the structure; click creates a brightness pulse. ACES tonemapping for richer color.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify — add `GyroidConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/gyroid.frag.ts` | Create — single-pass fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/gyroid-renderer.ts` | Create — single-pass renderer |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify — add `'gyroid'` to loadRenderer |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify — add 5 keys to BRAND_PREFIX_KEYS |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify — preset card + sliders |

## Config Interface

```typescript
export interface GyroidConfig extends ShaderConfigBase {
  preset: 'gyroid';
  scale1: number;      // 3.0-8.0, default 5.23 — Primary gyroid frequency
  scale2: number;      // 8.0-15.0, default 10.76 — Secondary gyroid frequency
  speed: number;       // 0.1-0.4, default 0.2 — Animation/rotation speed
  density: number;     // 1.0-5.0, default 3.5 — Volumetric density multiplier
  thickness: number;   // 0.01-0.05, default 0.03 — Gyroid surface thickness
}
```

## Defaults

```typescript
// Gyroid
gyroidScale1: 5.23,
gyroidScale2: 10.76,
gyroidSpeed: 0.2,
gyroidDensity: 3.5,
gyroidThickness: 0.03,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

```
shader-gyroid-scale1
shader-gyroid-scale2
shader-gyroid-speed
shader-gyroid-density
shader-gyroid-thickness
```

## Fragment Shader (gyroid.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `u_time` | `float` | Elapsed seconds |
| `u_resolution` | `vec2` | Canvas pixel dimensions |
| `u_mouse` | `vec2` | Normalized mouse (0-1), lerped |
| `u_burstStrength` | `float` | Click burst strength (decays) |
| `u_brandPrimary` | `vec3` | Brand primary color |
| `u_brandSecondary` | `vec3` | Brand secondary color |
| `u_brandAccent` | `vec3` | Brand accent color |
| `u_bgColor` | `vec3` | Background color |
| `u_scale1` | `float` | Primary gyroid frequency |
| `u_scale2` | `float` | Secondary gyroid frequency |
| `u_speed` | `float` | Animation speed |
| `u_density` | `float` | Volumetric density multiplier |
| `u_thickness` | `float` | Gyroid surface thickness |
| `u_intensity` | `float` | Overall blend |
| `u_grain` | `float` | Film grain |
| `u_vignette` | `float` | Vignette strength |

### Algorithm

1. **Ray setup**: Camera at `vec3(0, 0, 3.0)`, look direction from UV. Mouse rotates the view: apply Y-axis rotation `(u_mouse.x - 0.5) * PI` and X-axis rotation `(u_mouse.y - 0.5) * PI * 0.5` to the ray direction.
2. **Gyroid SDF function**: `sdGyroid(p, scale, thickness, bias) = abs(dot(sin(p * scale), cos(p.zxy * scale)) - bias) / scale - thickness`. This evaluates the triply-periodic minimal surface. The `abs()` creates a shell, `thickness` controls the wall width.
3. **Two nested gyroids**: `g1 = sdGyroid(p, u_scale1, u_thickness, 0.0)` (coarse lattice) and `g2 = sdGyroid(p, u_scale2, u_thickness * 0.5, 0.0)` (fine detail). The combined SDF is `min(g1, g2)` or a smooth union `smin(g1, g2, 0.1)`.
4. **Space inversion**: Before evaluating the gyroid, apply `p = p * 2.5 / dot(p, p)`. This maps the infinite periodic gyroid into a finite spherical volume — the gyroid wraps around like an inverted sphere. Points near the origin become far-field, creating intricate central detail.
5. **Time evolution**: Slowly rotate the gyroid space: `p.xz *= mat2(cos(t), -sin(t), sin(t), cos(t))` where `t = u_time * u_speed`. Also slowly shift the bias: `bias = sin(t * 0.3) * 0.2` to create organic breathing.
6. **Volumetric raymarching**: ~80 steps (reduced from reference 100 for hero performance). Step size 0.04. At each step:
   - Evaluate combined SDF
   - Compute density: `d = smoothstep(0.05, 0.0, abs(s)) * u_density / 80.0`
   - Accumulate color weighted by density and depth
7. **Depth coloring**: Color varies with march depth (0=near, 1=far):
   - Near (depth < 0.33): `mix(u_brandPrimary, u_brandSecondary, depth / 0.33)`
   - Mid (0.33-0.66): `mix(u_brandSecondary, u_brandAccent, (depth - 0.33) / 0.33)`
   - Far (> 0.66): `mix(u_brandAccent, u_brandPrimary * 0.5, (depth - 0.66) / 0.34)`
8. **Click brightness pulse**: When `u_burstStrength > 0`, multiply accumulated density by `1.0 + u_burstStrength * 3.0`. Also add a brief increase to the gyroid `thickness` (`u_thickness + u_burstStrength * 0.02`) to make the structure momentarily thicker/brighter.
9. **Background glow**: Volumetric secondary-colored glow using `exp(-length(uv) * 2.0) * u_brandSecondary * 0.15` behind the structure.
10. **Post-processing**: ACES tonemapping (replaces Reinhard for richer color) -> min(0.75) cap -> mix(bgColor, color, intensity) -> vignette -> grain -> clamp(0.75).

### ACES Tonemapping (replaces Reinhard for this preset)

```glsl
vec3 ACESFilm(vec3 x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
```

ACES gives better color separation in the highlights and richer darks than Reinhard, which matters for the gyroid's complex overlapping semi-transparent layers. The 0.75 cap after ACES ensures consistency with other presets.

### Key GLSL Notes

- Export as `export const GYROID_FRAG = \`#version 300 es...`
- No int uniforms — all config values are floats
- The gyroid function `dot(sin(p), cos(p.zxy))` is the standard triply-periodic minimal surface approximation
- Space inversion `p * k / dot(p,p)` can produce very large values near the origin — add `p += vec3(0.001)` epsilon to avoid division by zero
- 80 steps at step size 0.04 covers a total ray distance of 3.2 units — sufficient for the inverted sphere which maps to roughly a 2.5-unit radius
- Hash for grain: same `hash(vec2)` function as nebula/topo

### GLSL Pseudocode

```glsl
// Gyroid SDF
float sdGyroid(vec3 p, float scale, float thickness, float bias) {
  p *= scale;
  return abs(dot(sin(p), cos(p.zxy)) - bias) / scale - thickness;
}

void main() {
  float t = u_time * u_speed;

  // Aspect-correct UVs
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  // Camera
  vec3 ro = vec3(0.0, 0.0, 3.0);
  vec3 rd = normalize(vec3(uv, -1.5));

  // Mouse rotation
  float mx = (u_mouse.x - 0.5) * 3.14159;
  float my = (u_mouse.y - 0.5) * 1.5708;
  // Rotate rd by mouse
  rd.xz = mat2(cos(mx), -sin(mx), sin(mx), cos(mx)) * rd.xz;
  rd.yz = mat2(cos(my), -sin(my), sin(my), cos(my)) * rd.yz;

  // Volumetric accumulation
  vec3 acc = vec3(0.0);
  float accAlpha = 0.0;
  float stepSize = 0.04;
  float bias = sin(t * 0.3) * 0.2;

  for (int i = 0; i < 80; i++) {
    if (accAlpha > 0.95) break;

    vec3 p = ro + rd * float(i) * stepSize;
    float depth = float(i) / 80.0;

    // Time rotation
    float ct = cos(t), st = sin(t);
    p.xz = mat2(ct, -st, st, ct) * p.xz;

    // Space inversion
    p = p * 2.5 / (dot(p, p) + 0.001);

    // Two-frequency gyroid
    float thk = u_thickness + u_burstStrength * 0.02;
    float g1 = sdGyroid(p, u_scale1, thk, bias);
    float g2 = sdGyroid(p, u_scale2, thk * 0.5, bias * 0.5);
    float s = min(g1, g2);

    // Density estimation
    float d = smoothstep(0.05, 0.0, abs(s)) * u_density / 80.0;

    // Depth-based color
    vec3 col;
    if (depth < 0.33) {
      col = mix(u_brandPrimary, u_brandSecondary, depth / 0.33);
    } else if (depth < 0.66) {
      col = mix(u_brandSecondary, u_brandAccent, (depth - 0.33) / 0.33);
    } else {
      col = mix(u_brandAccent, u_brandPrimary * 0.5, (depth - 0.66) / 0.34);
    }

    // Brightness pulse
    d *= 1.0 + u_burstStrength * 3.0;

    // Front-to-back compositing
    acc += col * d * (1.0 - accAlpha);
    accAlpha += d * (1.0 - accAlpha);
  }

  // Background glow
  vec3 bgGlow = u_brandSecondary * exp(-dot(uv, uv) * 2.0) * 0.15;
  vec3 color = u_bgColor * 0.3 * (1.0 - accAlpha) + bgGlow * (1.0 - accAlpha) + acc;

  // ACES tonemapping
  color = ACESFilm(color);

  // Cap maximum brightness
  color = min(color, vec3(0.75));

  // Intensity blend
  color = mix(u_bgColor, color, u_intensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  // Final clamp
  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
```

## Renderer (gyroid-renderer.ts)

Single-pass, follows nebula-renderer pattern exactly:
- One program (no FBOs)
- Internal lerped mouse state (`MOUSE_LERP = 0.04`) for smooth rotation
- Pass all uniforms each frame
- All uniforms are `float` — no `gl.uniform1i()` needed for this preset
- `resize()` and `reset()` are no-ops; reset resets lerpedMouse to center
- `destroy()` deletes program + quad buffer

### Uniform List (UNIFORM_NAMES array)

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
  'u_scale1',
  'u_scale2',
  'u_speed',
  'u_density',
  'u_thickness',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;
```

## shader-config.ts Changes

### ShaderPresetId

Add `'gyroid'` to the union:
```typescript
export type ShaderPresetId = '...' | 'gyroid' | '...' | 'none';
```

### GyroidConfig

```typescript
export interface GyroidConfig extends ShaderConfigBase {
  preset: 'gyroid';
  scale1: number;
  scale2: number;
  speed: number;
  density: number;
  thickness: number;
}
```

### ShaderConfig union

Add `| GyroidConfig` to the union type.

### DEFAULTS

```typescript
// Gyroid
gyroidScale1: 5.23,
gyroidScale2: 10.76,
gyroidSpeed: 0.2,
gyroidDensity: 3.5,
gyroidThickness: 0.03,
```

### Switch case

```typescript
case 'gyroid':
  return {
    ...base,
    preset: 'gyroid',
    scale1: rv('shader-gyroid-scale1', DEFAULTS.gyroidScale1),
    scale2: rv('shader-gyroid-scale2', DEFAULTS.gyroidScale2),
    speed: rv('shader-gyroid-speed', DEFAULTS.gyroidSpeed),
    density: rv('shader-gyroid-density', DEFAULTS.gyroidDensity),
    thickness: rv('shader-gyroid-thickness', DEFAULTS.gyroidThickness),
  };
```

## ShaderHero.svelte Changes

Add to `loadRenderer()` switch:

```typescript
case 'gyroid': {
  const { createGyroidRenderer } = await import('./renderers/gyroid-renderer');
  return createGyroidRenderer();
}
```

## Brand Editor Changes

### BrandEditorHeroEffects.svelte

**PRESETS array**: Add entry:
```typescript
{ id: 'gyroid', label: 'Gyroid', description: 'Organic gyroid volumetric' },
```

**DEFAULTS record**: Add entries:
```typescript
'shader-gyroid-scale1': '5.23',
'shader-gyroid-scale2': '10.76',
'shader-gyroid-speed': '0.20',
'shader-gyroid-density': '3.50',
'shader-gyroid-thickness': '0.030',
```

**Derived state**: Add:
```typescript
// Gyroid
const gyroidScale1 = $derived(readNum('shader-gyroid-scale1'));
const gyroidScale2 = $derived(readNum('shader-gyroid-scale2'));
const gyroidSpeed = $derived(readNum('shader-gyroid-speed'));
const gyroidDensity = $derived(readNum('shader-gyroid-density'));
const gyroidThickness = $derived(readNum('shader-gyroid-thickness'));
```

**Slider section**: Add `{:else if activePreset === 'gyroid'}` block.

### Brand Editor Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| `shader-gyroid-scale1` | Primary Frequency | 3.0 | 8.0 | 0.1 | 5.23 | Coarse | Fine |
| `shader-gyroid-scale2` | Detail Frequency | 8.0 | 15.0 | 0.1 | 10.76 | Sparse | Dense |
| `shader-gyroid-speed` | Animation Speed | 0.1 | 0.4 | 0.01 | 0.20 | Slow | Fast |
| `shader-gyroid-density` | Volume Density | 1.0 | 5.0 | 0.1 | 3.50 | Faint | Thick |
| `shader-gyroid-thickness` | Surface Thickness | 0.01 | 0.05 | 0.005 | 0.030 | Thin | Thick |

## Brand Color Mapping

| Visual Element | Color Source | Notes |
|----------------|-------------|-------|
| Near gyroid surfaces | `u_brandPrimary` | Front-facing volumetric color |
| Mid-depth surfaces | `u_brandSecondary` | Transition zone |
| Far/deep surfaces + background glow | `u_brandAccent` | Deep structure color |
| Background base | `u_bgColor` darkened (0.3x) | Dark space behind volume |
| Volumetric background glow | `u_brandSecondary` | Soft radial glow behind structure |

Depth-to-color mapping (3-segment with wraparound):
```glsl
vec3 depthColor(float depth) {
  if (depth < 0.33) {
    return mix(u_brandPrimary, u_brandSecondary, depth / 0.33);
  } else if (depth < 0.66) {
    return mix(u_brandSecondary, u_brandAccent, (depth - 0.33) / 0.33);
  } else {
    return mix(u_brandAccent, u_brandPrimary * 0.5, (depth - 0.66) / 0.34);
  }
}
```

## Gotchas

1. **BRAND_PREFIX_KEYS** — all 5 keys MUST be registered in `css-injection.ts` or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and ShaderHero never reads them)
2. **Space inversion singularity** — `p * k / dot(p, p)` explodes at `p = vec3(0)`. Add epsilon: `dot(p, p) + 0.001` to prevent NaN/Inf. This is the most common bug in inverted-sphere shaders.
3. **Performance: 80 steps** — more expensive than most presets but necessary for volumetric detail. The `accAlpha > 0.95` early-exit significantly helps. On low-end GPUs, reducing `density` slider makes the structure more transparent, effectively reducing work per step.
4. **ACES vs Reinhard** — this preset uses ACES tonemapping instead of Reinhard for richer color in the overlapping semi-transparent layers. The 0.75 brightness cap after ACES ensures visual consistency with other presets. This is a deliberate deviation documented here.
5. **Gyroid scale relationship** — `scale2` should generally be ~2x `scale1` for pleasing visual results. The slider ranges (3-8 and 8-15) encourage this but don't enforce it. Document in the UI tooltip if possible.
6. **No int uniforms** — all Gyroid config values are floats, so no `gl.uniform1i()` needed. Simpler than presets with int params.
7. **Export pattern** — shader string exported as `export const GYROID_FRAG = \`#version 300 es...`
8. **Post-processing chain** — MUST follow: ACES tonemap -> `min(color, 0.75)` brightness cap -> `mix(u_bgColor, color, u_intensity)` intensity blend -> vignette -> grain -> `clamp(color, 0.0, 0.75)` final cap
9. **Bias breathing** — `bias = sin(t * 0.3) * 0.2` makes the gyroid surface oscillate between thicker and thinner states, creating an organic breathing effect. This uses the same time `t` as the rotation, so the two effects are synchronized.
10. **Mouse lerp** — use internal `lerpedMouse` state with `MOUSE_LERP = 0.04` for smooth rotation, same pattern as nebula-renderer
11. **Front-to-back compositing** — same pattern as nebula: accumulate `color * density * (1.0 - accAlpha)` and `accAlpha += density * (1.0 - accAlpha)`. This prevents energy blowup and gives natural depth ordering.

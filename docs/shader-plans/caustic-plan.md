# Caustic (Underwater Caustics) Shader Preset — Implementation Plan

## Overview

Add a "caustic" shader preset: dancing light patterns on the sea floor from sunlight refracted through rippling water. Single-pass (no FBO). Iterative sin/cos UV warping creates caustic convergence lines. Mouse creates a localized ripple disturbance; click propagates an outward ring. Slow, dreamlike animation driven by brand colors.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify — add `CausticConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/caustic.frag.ts` | Create — single-pass fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/caustic-renderer.ts` | Create — single-pass renderer |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify — add `'caustic'` to loadRenderer |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify — add 5 keys to BRAND_PREFIX_KEYS |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify — preset card + sliders |

## Config Interface

```typescript
export interface CausticConfig extends ShaderConfigBase {
  preset: 'caustic';
  scale: number;        // 1.0-5.0, default 2.5 — Pattern scale
  speed: number;        // 0.05-0.30, default 0.10 — Animation speed
  iterations: number;   // 2-5, default 3 (int) — Detail/quality layers
  brightness: number;   // 0.5-2.0, default 1.2 — Highlight intensity
  ripple: number;       // 0.5-3.0, default 1.5 — Mouse ripple strength
}
```

## Defaults

```typescript
// Caustic
causticScale: 2.5,
causticSpeed: 0.10,
causticIterations: 3,
causticBrightness: 1.2,
causticRipple: 1.5,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

```
shader-caustic-scale
shader-caustic-speed
shader-caustic-iterations
shader-caustic-brightness
shader-caustic-ripple
```

## Fragment Shader (caustic.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `u_time` | `float` | Elapsed seconds |
| `u_resolution` | `vec2` | Canvas pixel dimensions |
| `u_mouse` | `vec2` | Normalized mouse (0-1) |
| `u_mouseActive` | `float` | 1.0 when hovering |
| `u_burst` | `float` | Click burst strength |
| `u_brandPrimary` | `vec3` | Brand primary |
| `u_brandSecondary` | `vec3` | Brand secondary |
| `u_brandAccent` | `vec3` | Brand accent |
| `u_bgColor` | `vec3` | Background |
| `u_scale` | `float` | Caustic pattern scale |
| `u_speed` | `float` | Animation speed |
| `u_iterations` | `int` | Warp iteration count |
| `u_brightness` | `float` | Highlight intensity |
| `u_ripple` | `float` | Mouse ripple strength |
| `u_intensity` | `float` | Overall blend |
| `u_grain` | `float` | Film grain |
| `u_vignette` | `float` | Vignette strength |

### Algorithm

1. **Caustic pattern via iterative UV warping**: For N iterations (2-5), warp UV by `sin(uv * freq + time) / freq` — accumulate where rays converge. Each iteration doubles the frequency and rotates the warp axis, producing nested interference fringes.
2. **Two-layer accumulation**: Compute caustic function twice with offset time seeds, average the two for smoother, more complex patterns (technique from Shadertoy).
3. **Mouse ripple**: At cursor position, warp the UV field with `sin(dist * rippleFreq - time * rippleSpeed)` scaled by proximity. Creates localized pattern disturbance that feels like touching water surface.
4. **Click burst**: Propagating ring `sin(dist - time)` that adds a large-radius ripple outward from click point, decaying over frames.
5. **Color mapping**: Caustic brightness drives a 3-segment gradient:
   - Low caustic (deep water) = bg color darkened
   - Mid caustic = primary -> secondary gradient (water tint)
   - High caustic (bright convergence lines) = accent color (hot highlights)
6. **Post-process**: Reinhard tone map -> min(0.75) cap -> mix(bg, color, intensity) -> vignette -> grain -> clamp(0.75)

### Key GLSL Notes

- Export as `export const CAUSTIC_FRAG = \`#version 300 es...`
- For-loop with `if (i >= u_iterations) break;` needs constant upper bound (5)
- Aspect ratio correction: `vec2 p = vec2(uv.x * aspect, uv.y) * u_scale;`
- Two-layer technique: call caustic function with `time` and `time + 0.5`, average results
- Noise hash for grain: same `hash(vec2)` as topo shader
- The `sin(p.x + sin(p.y))` layered pattern naturally creates bright convergence points where wave fronts overlap — this IS the caustic

### GLSL Pseudocode

```glsl
// Core caustic function
float caustic(vec2 uv, float t) {
  vec2 p = uv * u_scale;
  float c = 0.0;
  float freq = 1.0;
  for (int i = 0; i < 5; i++) {
    if (i >= u_iterations) break;
    p += vec2(sin(p.y * freq + t), cos(p.x * freq + t)) / freq;
    c += 1.0 / (1.0 + pow(length(sin(p * 3.14159)), 2.0) * u_brightness);
    freq *= 2.0;
    p = mat2(0.8, 0.6, -0.6, 0.8) * p; // rotate between iterations
  }
  return c / float(u_iterations);
}

// main():
float t = u_time * u_speed;
vec2 uv = v_uv;
// Mouse ripple warp
vec2 mouseUV = ...;
float mouseDist = distance(fragUV, mouseUV);
uv += u_mouseActive * u_ripple * 0.02 * sin(mouseDist * 30.0 - t * 5.0) * exp(-mouseDist * 8.0) * normalize(fragUV - mouseUV);
// Click burst ring
uv += u_burst * 0.03 * sin(mouseDist * 20.0 - t * 8.0) * exp(-mouseDist * 4.0) * normalize(fragUV - mouseUV);
// Two-layer caustic
float c1 = caustic(uv, t);
float c2 = caustic(uv, t + 0.5);
float c = (c1 + c2) * 0.5;
// Color map -> post-process
```

## Renderer (caustic-renderer.ts)

Single-pass, follows topo-renderer pattern exactly:
- One program (no FBOs)
- Pass all uniforms each frame
- `u_iterations` via `gl.uniform1i()` with `Math.round()` (not float)
- `u_mouseActive` and `u_burst` as separate uniforms
- `resize()` and `reset()` are no-ops (single-pass preset)
- `destroy()` deletes program + quad buffer

### Uniform List (UNIFORM_NAMES array)

```typescript
const UNIFORM_NAMES = [
  'u_time',
  'u_resolution',
  'u_mouse',
  'u_mouseActive',
  'u_burst',
  'u_brandPrimary',
  'u_brandSecondary',
  'u_brandAccent',
  'u_bgColor',
  'u_scale',
  'u_speed',
  'u_iterations',
  'u_brightness',
  'u_ripple',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;
```

## shader-config.ts Changes

### ShaderPresetId

Add `'caustic'` to the union:
```typescript
export type ShaderPresetId = '...' | 'caustic' | 'none';
```

### CausticConfig

```typescript
export interface CausticConfig extends ShaderConfigBase {
  preset: 'caustic';
  scale: number;
  speed: number;
  iterations: number;
  brightness: number;
  ripple: number;
}
```

### ShaderConfig union

Add `| CausticConfig` to the union type.

### DEFAULTS

```typescript
// Caustic
causticScale: 2.5,
causticSpeed: 0.10,
causticIterations: 3,
causticBrightness: 1.2,
causticRipple: 1.5,
```

### Switch case

```typescript
case 'caustic':
  return {
    ...base,
    preset: 'caustic',
    scale: rv('shader-caustic-scale', DEFAULTS.causticScale),
    speed: rv('shader-caustic-speed', DEFAULTS.causticSpeed),
    iterations: Math.round(rv('shader-caustic-iterations', DEFAULTS.causticIterations)),
    brightness: rv('shader-caustic-brightness', DEFAULTS.causticBrightness),
    ripple: rv('shader-caustic-ripple', DEFAULTS.causticRipple),
  };
```

## ShaderHero.svelte Changes

Add to `loadRenderer()` switch:

```typescript
case 'caustic': {
  const { createCausticRenderer } = await import('./renderers/caustic-renderer');
  return createCausticRenderer();
}
```

## Brand Editor Changes

### BrandEditorHeroEffects.svelte

**PRESETS array**: Add entry:
```typescript
{ id: 'caustic', label: 'Caustic', description: 'Underwater light patterns' },
```

**DEFAULTS record**: Add entries:
```typescript
'shader-caustic-scale': '2.5',
'shader-caustic-speed': '0.10',
'shader-caustic-iterations': '3',
'shader-caustic-brightness': '1.20',
'shader-caustic-ripple': '1.50',
```

**Derived state**: Add:
```typescript
// Caustic
const causticScale = $derived(readNum('shader-caustic-scale'));
const causticSpeed = $derived(readNum('shader-caustic-speed'));
const causticIterations = $derived(readNum('shader-caustic-iterations'));
const causticBrightness = $derived(readNum('shader-caustic-brightness'));
const causticRipple = $derived(readNum('shader-caustic-ripple'));
```

**Slider section**: Add `{:else if activePreset === 'caustic'}` block.

### Brand Editor Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| `shader-caustic-scale` | Pattern Scale | 1.0 | 5.0 | 0.5 | 2.5 | Fine | Coarse |
| `shader-caustic-speed` | Animation Speed | 0.05 | 0.30 | 0.01 | 0.10 | Slow | Fast |
| `shader-caustic-iterations` | Detail Layers | 2 | 5 | 1 | 3 | Simple | Complex |
| `shader-caustic-brightness` | Highlight Power | 0.5 | 2.0 | 0.1 | 1.2 | Dim | Bright |
| `shader-caustic-ripple` | Mouse Ripple | 0.5 | 3.0 | 0.1 | 1.5 | Gentle | Strong |

## Brand Color Mapping

| Visual Element | Color Source | Notes |
|----------------|-------------|-------|
| Bright caustic convergence lines | `u_brandAccent` | Hot highlights where light focuses |
| Water body mid-tones | `u_brandPrimary` -> `u_brandSecondary` gradient | Main water color |
| Deep areas (low caustic) | `u_bgColor` darkened | Dark sea floor |
| Overall water tint | `u_brandPrimary` | Modulates entire scene |

Height-to-color function (same 3-segment approach as topo):
```glsl
vec3 causticColor(float c) {
  if (c < 0.33) {
    return mix(u_bgColor * 0.5, u_brandPrimary, c / 0.33);
  } else if (c < 0.66) {
    return mix(u_brandPrimary, u_brandSecondary, (c - 0.33) / 0.33);
  } else {
    return mix(u_brandSecondary, u_brandAccent, (c - 0.66) / 0.34);
  }
}
```

## Gotchas

1. **BRAND_PREFIX_KEYS** — all 5 keys MUST be registered in `css-injection.ts` or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and ShaderHero never reads them)
2. **For-loop dynamic bound** — constant upper bound of 5 required for GLSL ES 3.0 compliance. Use `if (i >= u_iterations) break;` pattern.
3. **`iterations` as int uniform** — use `Math.round()` in config parsing, `gl.uniform1i()` in renderer (not `uniform1f`)
4. **No naming collisions** — all keys namespaced as `shader-caustic-*` to avoid collision with existing `shader-scale`, `shader-speed` etc.
5. **Export pattern** — shader string exported as `export const CAUSTIC_FRAG = \`#version 300 es...`
6. **Post-processing chain** — MUST follow: Reinhard tone map -> `min(color, 0.75)` brightness cap -> `mix(u_bgColor, color, u_intensity)` intensity blend -> vignette -> grain -> `clamp(color, 0.0, 0.75)` final cap
7. **Mouse ripple normalization** — `normalize(fragUV - mouseUV)` needs guard for zero-distance: `max(mouseDist, 0.001)` or use `mouseDist > 0.001` conditional
8. **Aspect correction** — UV and mouse coordinates must use same aspect-corrected space for ripple to be circular, not elliptical
9. **Two-layer averaging** — calling the caustic function twice doubles the loop work. With max 5 iterations x 2 layers = 10 sin/cos pairs per fragment. Still very cheap for single-pass.
10. **Preset grid** — 16th card (including 'none') in 2-col grid = 8 rows, all full (even layout)

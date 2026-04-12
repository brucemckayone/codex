# Julia (Animated Julia Set Fractal) Shader Preset -- Implementation Plan

## Overview

Add a "julia" shader preset: animated Julia set fractal with cosine palette colouring derived from brand colours. The c parameter orbits slowly in the complex plane, creating continuously morphing fractal shapes. Escape-time colouring maps iteration count through a brand-derived cosine palette. Single-pass (no FBO). Mouse shifts the c parameter directly, letting the user explore different fractal shapes. Click recentres c to the orbit path.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify -- add `JuliaConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/julia.frag.ts` | Create -- single-pass fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/julia-renderer.ts` | Create -- single-pass renderer |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify -- add `'julia'` to loadRenderer switch |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify -- add 5 keys to BRAND_PREFIX_KEYS |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify -- preset card + sliders |

## Config Interface

```typescript
export interface JuliaConfig extends ShaderConfigBase {
  preset: 'julia';
  zoom: number;        // 1.0-2.0, default 1.3 -- Zoom level into the fractal
  speed: number;       // 0.2-0.6, default 0.33 -- Orbit speed of c parameter
  iterations: number;  // 30-100, default 75 (int) -- Max iteration count
  radius: number;      // 0.6-0.95, default 0.79 -- Orbit radius of c in complex plane
  saturation: number;  // 0.3-0.7, default 0.5 -- Palette intensity/saturation
}
```

## Defaults

```typescript
// Julia
juliaZoom: 1.3,
juliaSpeed: 0.33,
juliaIterations: 75,
juliaRadius: 0.79,
juliaSaturation: 0.5,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

```
shader-julia-zoom
shader-julia-speed
shader-julia-iterations
shader-julia-radius
shader-julia-saturation
```

All 5 keys MUST be registered in `css-injection.ts` BRAND_PREFIX_KEYS or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and ShaderHero never reads them via `getComputedStyle`).

## Fragment Shader (julia.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `u_time` | `float` | Elapsed seconds |
| `u_resolution` | `vec2` | Canvas pixel dimensions |
| `u_mouse` | `vec2` | Normalized mouse (0-1), lerped |
| `u_burstStrength` | `float` | Click burst strength (decays) |
| `u_brandPrimary` | `vec3` | Brand primary colour |
| `u_brandSecondary` | `vec3` | Brand secondary colour |
| `u_brandAccent` | `vec3` | Brand accent colour |
| `u_bgColor` | `vec3` | Background / core colour |
| `u_zoom` | `float` | Fractal zoom level |
| `u_speed` | `float` | c orbit speed |
| `u_iterations` | `int` | Max iteration count |
| `u_radius` | `float` | c orbit radius |
| `u_saturation` | `float` | Palette intensity |
| `u_intensity` | `float` | Overall blend |
| `u_grain` | `float` | Film grain |
| `u_vignette` | `float` | Vignette strength |

### Algorithm

1. **Julia set iteration**: For each pixel, map screen coordinates to complex plane z = (x, y) scaled by `u_zoom`. Iterate `z = z*z + c` up to `u_iterations` times. Track escape iteration count and final |z|^2 for smooth colouring.

2. **c parameter orbit**: The Julia constant c orbits in the complex plane:
   ```glsl
   float t = u_time * u_speed;
   float r = u_radius + 0.05 * sin(t * 0.7);  // slight radius oscillation
   vec2 c_base = r * vec2(cos(t / 3.0), sin(t / 3.0));
   ```
   The radius oscillation prevents the orbit from being a perfect circle, creating more variety in fractal shapes.

3. **Mouse interaction on c**: Mouse shifts the c parameter directly:
   ```glsl
   vec2 mouseOffset = (u_mouse - 0.5) * 0.4;
   vec2 c = c_base + mouseOffset;
   ```
   This lets the user explore entirely different fractal shapes by moving the mouse. The 0.4 multiplier keeps changes within interesting parameter space.

4. **Click recentre**: On click burst, smoothly lerp c back toward the orbit path:
   ```glsl
   c = mix(c, c_base, u_burstStrength * 0.8);
   ```
   This creates a snap-back effect that briefly reveals the "default" fractal before the user's mouse position takes over again.

5. **Smooth escape-time colouring**: Use the standard smooth iteration count:
   ```glsl
   float smoothIter = float(i) - log2(log2(dot(z, z))) + 4.0;
   float t_color = smoothIter / float(u_iterations);
   ```

6. **Brand-derived cosine palette**: The classic `palette(t) = a + b * cos(6.28318 * (c*t + d))` where `a, b, c, d` are vec3 vectors derived from brand colours:
   ```glsl
   // Derive palette vectors from brand colours
   vec3 a = mix(u_brandPrimary, u_brandSecondary, 0.5) * u_saturation;
   vec3 b = (u_brandAccent - u_bgColor * 0.5) * u_saturation;
   vec3 c_pal = vec3(1.0, 1.0, 1.0);  // full cycle per band
   vec3 d = vec3(
     dot(u_brandPrimary, vec3(0.299, 0.587, 0.114)),    // luminance offset
     dot(u_brandSecondary, vec3(0.299, 0.587, 0.114)),
     dot(u_brandAccent, vec3(0.299, 0.587, 0.114))
   );
   
   vec3 color = a + b * cos(6.28318 * (c_pal * t_color + d));
   ```
   This naturally maps the brand's colour palette across the fractal bands. Primary dominates inner bands, accent appears at transition points, and secondary fills the mid-range.

7. **Core (non-escaped) colouring**: Pixels that never escape are coloured with a darkened background:
   ```glsl
   if (i >= u_iterations) {
     color = u_bgColor * 0.15;  // deep core
   }
   ```

8. **Post-processing**: Reinhard tone map -> `min(color, 0.7)` brightness cap -> `mix(u_bgColor, color, u_intensity)` intensity blend -> vignette -> grain -> `clamp(color, 0.0, 0.7)` final cap

### Key GLSL Notes

- Export as `export const JULIA_FRAG = \`#version 300 es...`
- For-loop with `if (i >= u_iterations) break;` needs constant upper bound (100)
- Aspect ratio correction: `vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;`
- `u_iterations` is an int uniform -- use `uniform int u_iterations;`
- The cosine palette naturally wraps, creating smooth colour banding without discontinuities
- Escape radius: use 256.0 (large escape radius improves smooth colouring quality)
- Hash for grain: same `hash(vec2)` as nebula shader

### GLSL Pseudocode

```glsl
// --- Cosine palette ---
vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

// --- Hash for film grain ---
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // Aspect-correct UVs
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;
  uv /= u_zoom;

  // c parameter: orbit + mouse offset
  float t = u_time * u_speed;
  float r = u_radius + 0.05 * sin(t * 0.7);
  vec2 c_base = r * vec2(cos(t / 3.0), sin(t / 3.0));
  vec2 mouseOffset = (u_mouse - 0.5) * 0.4;
  vec2 c = mix(c_base + mouseOffset, c_base, u_burstStrength * 0.8);

  // Julia iteration
  vec2 z = uv;
  int i;
  for (i = 0; i < 100; i++) {
    if (i >= u_iterations) break;
    if (dot(z, z) > 256.0) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
  }

  // Colour
  vec3 color;
  if (i >= u_iterations) {
    color = u_bgColor * 0.15;
  } else {
    float smoothIter = float(i) - log2(log2(dot(z, z))) + 4.0;
    float t_color = smoothIter / float(u_iterations);

    // Brand-derived cosine palette vectors
    vec3 pa = mix(u_brandPrimary, u_brandSecondary, 0.5) * u_saturation + 0.3;
    vec3 pb = (u_brandAccent - u_bgColor * 0.3) * u_saturation + 0.2;
    vec3 pc = vec3(1.0, 1.0, 1.0);
    vec3 pd = vec3(
      dot(u_brandPrimary, vec3(0.299, 0.587, 0.114)),
      dot(u_brandSecondary, vec3(0.299, 0.587, 0.114)),
      dot(u_brandAccent, vec3(0.299, 0.587, 0.114))
    );

    color = palette(t_color, pa, pb, pc, pd);
  }

  // Post-processing
  color = color / (1.0 + color);                    // Reinhard
  color = min(color, vec3(0.7));                     // Brightness cap
  color = mix(u_bgColor, color, u_intensity);        // Intensity blend

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  fragColor = vec4(clamp(color, 0.0, 0.7), 1.0);
}
```

## Renderer (julia-renderer.ts)

Single-pass, follows nebula-renderer pattern exactly:
- One program (no FBOs)
- Internal lerped mouse state (MOUSE_LERP = 0.04) for smooth c parameter exploration
- Pass all uniforms each frame
- `u_iterations` via `gl.uniform1i()` with `Math.round()` (NOT uniform1f -- int uniform)
- `u_burstStrength` passed directly from mouse state
- `resize()` and `reset()` are near no-ops (single-pass preset)
- `reset()` resets lerped mouse to centre
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
  'u_zoom',
  'u_speed',
  'u_iterations',
  'u_radius',
  'u_saturation',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;
```

### Renderer Template

```typescript
import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, JuliaConfig } from '../shader-config';
import { JULIA_FRAG } from '../shaders/julia.frag';
import {
  createProgram,
  createQuad,
  drawQuad,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

// ... UNIFORM_NAMES as above ...

type JuliaUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  zoom: 1.3,
  speed: 0.33,
  iterations: 75,
  radius: 0.79,
  saturation: 0.5,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createJuliaRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<JuliaUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal lerped mouse state for smooth c exploration
  let lerpedMouse = { x: 0.5, y: 0.5 };
  const MOUSE_LERP = 0.04;

  return {
    init(gl, _width, _height) {
      program = createProgram(gl, VERTEX_SHADER, JULIA_FRAG);
      if (!program) return false;
      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);
      lerpedMouse = { x: 0.5, y: 0.5 };
      return true;
    },

    render(gl, time, mouse, config, width, height) {
      if (!program || !uniforms || !quad) return;
      const cfg = config as JuliaConfig;

      // Lerp mouse for smooth fractal exploration
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

      // Burst strength (click recentre)
      gl.uniform1f(uniforms.u_burstStrength, mouse.burstStrength);

      // Brand colors
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // CRITICAL: u_iterations is int -- use uniform1i, NOT uniform1f
      gl.uniform1f(uniforms.u_zoom, cfg.zoom ?? DEFAULTS.zoom);
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      gl.uniform1i(uniforms.u_iterations, Math.round(cfg.iterations ?? DEFAULTS.iterations));
      gl.uniform1f(uniforms.u_radius, cfg.radius ?? DEFAULTS.radius);
      gl.uniform1f(uniforms.u_saturation, cfg.saturation ?? DEFAULTS.saturation);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(uniforms.u_vignette, cfg.vignette ?? DEFAULTS.vignette);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize() { /* Single-pass: no FBOs to resize */ },

    reset() {
      lerpedMouse = { x: 0.5, y: 0.5 };
    },

    destroy(gl) {
      if (program) { gl.deleteProgram(program); program = null; }
      if (quad) { gl.deleteBuffer(quad.buffer); quad = null; }
      uniforms = null;
    },
  };
}
```

## shader-config.ts Changes

### ShaderPresetId

Add `'julia'` to the union:
```typescript
export type ShaderPresetId = '...' | 'julia' | '...' | 'none';
```

### JuliaConfig

```typescript
export interface JuliaConfig extends ShaderConfigBase {
  preset: 'julia';
  zoom: number;
  speed: number;
  iterations: number;
  radius: number;
  saturation: number;
}
```

### ShaderConfig union

Add `| JuliaConfig` to the union type.

### DEFAULTS

```typescript
// Julia
juliaZoom: 1.3,
juliaSpeed: 0.33,
juliaIterations: 75,
juliaRadius: 0.79,
juliaSaturation: 0.5,
```

### Switch case

```typescript
case 'julia':
  return {
    ...base,
    preset: 'julia',
    zoom: rv('shader-julia-zoom', DEFAULTS.juliaZoom),
    speed: rv('shader-julia-speed', DEFAULTS.juliaSpeed),
    iterations: Math.round(rv('shader-julia-iterations', DEFAULTS.juliaIterations)),
    radius: rv('shader-julia-radius', DEFAULTS.juliaRadius),
    saturation: rv('shader-julia-saturation', DEFAULTS.juliaSaturation),
  };
```

Note: `iterations` MUST use `Math.round()` because it is an int uniform.

## ShaderHero.svelte Changes

Add to `loadRenderer()` switch:

```typescript
case 'julia': {
  const { createJuliaRenderer } = await import('./renderers/julia-renderer');
  return createJuliaRenderer();
}
```

## Brand Editor Changes

### BrandEditorHeroEffects.svelte

**PRESETS array**: Add entry:
```typescript
{ id: 'julia', label: 'Julia Fractal', description: 'Animated fractal exploration' },
```

**DEFAULTS record**: Add entries:
```typescript
'shader-julia-zoom': '1.3',
'shader-julia-speed': '0.33',
'shader-julia-iterations': '75',
'shader-julia-radius': '0.79',
'shader-julia-saturation': '0.50',
```

**Derived state**: Add:
```typescript
// Julia
const juliaZoom = $derived(readNum('shader-julia-zoom'));
const juliaSpeed = $derived(readNum('shader-julia-speed'));
const juliaIterations = $derived(readNum('shader-julia-iterations'));
const juliaRadius = $derived(readNum('shader-julia-radius'));
const juliaSaturation = $derived(readNum('shader-julia-saturation'));
```

**Slider section**: Add `{:else if activePreset === 'julia'}` block with 5 sliders.

### Brand Editor Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| `shader-julia-zoom` | Zoom Level | 1.0 | 2.0 | 0.1 | 1.3 | Close | Far |
| `shader-julia-speed` | Orbit Speed | 0.2 | 0.6 | 0.01 | 0.33 | Slow | Fast |
| `shader-julia-iterations` | Detail | 30 | 100 | 5 | 75 | Smooth | Sharp |
| `shader-julia-radius` | Orbit Radius | 0.60 | 0.95 | 0.01 | 0.79 | Tight | Wide |
| `shader-julia-saturation` | Palette Intensity | 0.30 | 0.70 | 0.05 | 0.50 | Muted | Vivid |

## Brand Color Mapping

| Visual Element | Color Source | Notes |
|----------------|-------------|-------|
| Non-escaped core | `u_bgColor * 0.15` | Deep dark centre, very subtle |
| Inner fractal bands | `u_brandPrimary` dominant | Cosine palette a vector derived from primary+secondary |
| Mid fractal bands | `u_brandSecondary` | Contributes to palette offset d vector |
| Outer fractal bands / transitions | `u_brandAccent` | Cosine palette b vector creates accent highlights |
| Background (deep escape) | `u_bgColor` | Intensity blend target |

Cosine palette derivation from brand colours:
```glsl
// a = base brightness, derived from primary+secondary mix
vec3 a = mix(u_brandPrimary, u_brandSecondary, 0.5) * u_saturation + 0.3;

// b = amplitude, derived from accent contrast against bg
vec3 b = (u_brandAccent - u_bgColor * 0.3) * u_saturation + 0.2;

// c = frequency (1.0 = one full cycle per band group)
vec3 c = vec3(1.0);

// d = phase offset, derived from per-channel luminance of each brand colour
vec3 d = vec3(
  dot(u_brandPrimary, vec3(0.299, 0.587, 0.114)),
  dot(u_brandSecondary, vec3(0.299, 0.587, 0.114)),
  dot(u_brandAccent, vec3(0.299, 0.587, 0.114))
);
```

This approach ensures that:
- Different brand palettes produce visually distinct fractal colourings
- The cosine palette wraps smoothly, avoiding hard colour transitions
- Primary colour dominates the base, secondary shifts the mid-tones, accent provides highlights
- The `u_saturation` slider controls how strongly brand colours influence the palette

## Mouse Interaction Detail

| Input | Effect | Strength |
|-------|--------|----------|
| Mouse X | Shifts c parameter real component | `(mouse.x - 0.5) * 0.4` |
| Mouse Y | Shifts c parameter imaginary component | `(mouse.y - 0.5) * 0.4` |
| Click burst | Recentres c to orbit path (snap-back) | `mix(c_offset, c_base, burst * 0.8)` |
| Touch start | Same as click burst (mobile) | Same |
| Touch move | Same as mouse move | Same |
| No interaction | c follows its natural orbit | `c_base = r * (cos(t/3), sin(t/3))` |

The mouse interaction is the key differentiator for this preset -- moving the mouse actually changes the Julia set being displayed, creating an exploration experience. The lerped mouse (MOUSE_LERP = 0.04) ensures the fractal morphs smoothly rather than jumping between shapes.

## Performance Budget

Target: 0.3-0.8ms per frame depending on iteration count.

| Operation | Cost | Notes |
|-----------|------|-------|
| Julia iteration (75 default) | ~75 * (4 mul + 2 add + 1 dot) | Main cost, per pixel |
| Smooth colouring | ~2 log2 + 1 div | Once per pixel after escape |
| Cosine palette | ~3 cos + dot products | Once per pixel |
| Post-process | ~10 ops | Standard pipeline |
| **Total per fragment** | ~600-800 ops at 75 iterations | Medium cost shader |

At max iterations (100), cost increases proportionally but remains well within 1ms budget for modern GPUs. The early-exit on `dot(z,z) > 256.0` means most exterior pixels escape much earlier than the max.

No FBOs, no texture reads, no branching beyond the iteration loop. This is a medium-weight shader.

## Gotchas

1. **BRAND_PREFIX_KEYS** -- all 5 keys MUST be registered in `css-injection.ts` or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and ShaderHero never reads them)
2. **For-loop dynamic bound** -- constant upper bound of 100 required for GLSL ES 3.0 compliance. Use `if (i >= u_iterations) break;` pattern.
3. **`iterations` as int uniform** -- use `Math.round()` in config parsing (`shader-config.ts` switch case), `gl.uniform1i()` in renderer (NOT `uniform1f`). GLSL declares `uniform int u_iterations;`.
4. **No naming collisions** -- all keys namespaced as `shader-julia-*` to avoid collision with existing `shader-zoom`, `shader-speed` etc.
5. **Export pattern** -- shader string exported as `export const JULIA_FRAG = \`#version 300 es...`
6. **Post-processing chain** -- MUST follow established order: Reinhard tone map -> `min(color, 0.7)` brightness cap -> `mix(u_bgColor, color, u_intensity)` intensity blend -> vignette -> grain -> `clamp(color, 0.0, 0.7)` final cap
7. **Smooth iteration count** -- the `log2(log2(dot(z,z)))` formula requires escape radius >= 4.0 (we use 256.0). Using a small escape radius produces banding artefacts.
8. **Aspect correction** -- must use `(2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y` (divide by Y only) to maintain aspect ratio.
9. **c parameter range** -- the 0.4 mouse multiplier keeps c within the visually interesting region (-0.8 to 0.8 roughly). Larger offsets produce boring solid-colour fractals.
10. **Lerped mouse** -- MOUSE_LERP = 0.04 (same as nebula) gives smooth fractal morphing. Higher values make the fractal jump between shapes distractingly.
11. **Guard log2(0)** -- when `dot(z,z)` is exactly 0 or very small (non-escaped point), `log2(log2(...))` is undefined. The `if (i >= u_iterations)` branch catches this before the smooth colouring path.
12. **Cosine palette clamping** -- the cosine palette can produce negative values (e.g. `a - b`). The final `clamp(color, 0.0, 0.7)` handles this, but the `+ 0.3` and `+ 0.2` offsets in the `a` and `b` vectors reduce the likelihood.

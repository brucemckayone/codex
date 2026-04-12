# Vapor (Volumetric Clouds/Aurora) Shader Preset -- Implementation Plan

## Overview

Add a "vapor" shader preset: ethereal volumetric clouds of colour based on Frostbyte's volumetric shader technique using dot noise and ACES tonemapping. Simple raymarching accumulates colour from organic cloud-like density fields. Brand colours map to depth -- primary near, secondary mid, accent far. The result is a soothing, meditative cloudscape. Single-pass (no FBO). Mouse shifts the camera viewing angle. Click creates a brightness pulse.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify -- add `VaporConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/vapor.frag.ts` | Create -- single-pass fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/vapor-renderer.ts` | Create -- single-pass renderer |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify -- add `'vapor'` to loadRenderer switch |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify -- add 5 keys to BRAND_PREFIX_KEYS |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify -- preset card + sliders |

## Config Interface

```typescript
export interface VaporConfig extends ShaderConfigBase {
  preset: 'vapor';
  density: number;   // 0.5-2.0, default 1.0 -- Cloud density/opacity
  speed: number;     // 0.5-2.5, default 1.5 -- Animation speed
  scale: number;     // 3.0-8.0, default 5.0 -- Noise frequency/scale
  warmth: number;    // 0.0-1.0, default 0.5 -- Colour temperature shift
  glow: number;      // 0.3-1.5, default 0.8 -- Bloom/glow intensity
}
```

## Defaults

```typescript
// Vapor
vaporDensity: 1.0,
vaporSpeed: 1.5,
vaporScale: 5.0,
vaporWarmth: 0.5,
vaporGlow: 0.8,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

```
shader-vapor-density
shader-vapor-speed
shader-vapor-scale
shader-vapor-warmth
shader-vapor-glow
```

All 5 keys MUST be registered in `css-injection.ts` BRAND_PREFIX_KEYS or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and ShaderHero never reads them via `getComputedStyle`).

## Fragment Shader (vapor.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `u_time` | `float` | Elapsed seconds |
| `u_resolution` | `vec2` | Canvas pixel dimensions |
| `u_mouse` | `vec2` | Normalized mouse (0-1), lerped |
| `u_burstStrength` | `float` | Click burst strength (decays) |
| `u_brandPrimary` | `vec3` | Brand primary colour (near clouds) |
| `u_brandSecondary` | `vec3` | Brand secondary colour (mid-depth) |
| `u_brandAccent` | `vec3` | Brand accent colour (far/glow) |
| `u_bgColor` | `vec3` | Background / void colour |
| `u_density` | `float` | Cloud density |
| `u_speed` | `float` | Animation speed |
| `u_scale` | `float` | Noise frequency |
| `u_warmth` | `float` | Colour temperature shift |
| `u_glow` | `float` | Bloom intensity |
| `u_intensity` | `float` | Overall blend |
| `u_grain` | `float` | Film grain |
| `u_vignette` | `float` | Vignette strength |

### Algorithm

1. **Ray setup**: For each pixel, construct a ray from the camera through the screen plane. Camera positioned at origin, looking forward along Z. Mouse shifts the look-at direction for subtle camera rotation:
   ```glsl
   vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;
   
   // Mouse shifts view angle
   vec2 mouseOffset = (u_mouse - 0.5) * 0.3;
   vec3 rd = normalize(vec3(uv + mouseOffset, 2.0));
   ```

2. **Dot noise function**: The core noise uses the Frostbyte dot-product technique -- a pseudo-random field from the dot product of cosine and sine of scaled coordinates:
   ```glsl
   // G is the golden ratio matrix for decorrelation
   const mat3 G = mat3(
     0.618, 0.0, 0.0,
     0.0, 0.618, 0.0,
     0.0, 0.0, 0.618
   );
   
   float dotNoise(vec3 p) {
     return dot(cos(G * p), sin(1.6 * p * G));
   }
   ```
   This produces smooth, organic volumetric fields that look like real clouds.

3. **Raymarching (~80 steps)**: March along the ray, sampling the dot noise at each step to determine local density. Accumulate colour using front-to-back compositing:
   ```glsl
   vec3 color = vec3(0.0);
   float alpha = 0.0;
   float stepSize = 0.08;
   
   for (int i = 0; i < 80; i++) {
     if (alpha > 0.95) break;
     
     vec3 p = ro + rd * float(i) * stepSize;
     p *= u_scale * 0.1;
     
     // Animate
     p.z += u_time * u_speed * 0.1;
     p.x += sin(u_time * u_speed * 0.05) * 0.5;
     
     // Density from dot noise
     float d = dotNoise(p) * 0.5 + 0.5;
     d = smoothstep(0.3, 0.7, d) * u_density;
     
     // Depth fraction for colour
     float depthFrac = float(i) / 80.0;
     
     // Colour by depth: near=primary, mid=secondary, far=accent
     vec3 layerColor;
     if (depthFrac < 0.5) {
       layerColor = mix(u_brandPrimary, u_brandSecondary, depthFrac * 2.0);
     } else {
       layerColor = mix(u_brandSecondary, u_brandAccent, (depthFrac - 0.5) * 2.0);
     }
     
     // Warmth shift
     layerColor = mix(layerColor, layerColor * vec3(1.1, 1.0, 0.9), u_warmth);
     
     // Accumulate
     float a = d * (1.0 - alpha) * 0.15;
     color += layerColor * a * u_glow;
     alpha += a;
   }
   ```

4. **ACES tonemapping**: Rather than standard Reinhard, use the ACES filmic curve for richer, more cinematic colour:
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
   ACES preserves rich colour in the highlights and has a natural filmic rolloff that makes the clouds look cinematic.

5. **Click brightness pulse**: On burst, increase the glow multiplier and add a soft screen-wide flash:
   ```glsl
   color += u_burstStrength * mix(u_brandAccent, vec3(1.0), 0.5) * 0.3;
   ```

6. **Post-processing**: ACES tone map -> `min(color, 0.7)` brightness cap -> `mix(u_bgColor, color, u_intensity)` intensity blend -> vignette -> grain -> `clamp(color, 0.0, 0.7)` final cap

### Key GLSL Notes

- Export as `export const VAPOR_FRAG = \`#version 300 es...`
- No int uniforms -- all config values are floats
- The golden ratio (0.618) matrix decorrelates the noise octaves
- Aspect ratio correction: `(2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y`
- The `dotNoise` function returns values in ~[-3, 3] range -- remap with `* 0.5 + 0.5` and `smoothstep`
- Hash for grain: same `hash(vec2)` as nebula shader
- Raymarch step count (80) is hardcoded -- not configurable (performance-sensitive)

### GLSL Pseudocode

```glsl
// --- Golden ratio decorrelation matrix ---
const mat3 G = mat3(
  0.618, 0.324, 0.0,
  0.0, 0.618, 0.324,
  0.324, 0.0, 0.618
);

// --- Dot noise (Frostbyte-inspired) ---
float dotNoise(vec3 p) {
  return dot(cos(G * p), sin(1.6 * p * G));
}

// --- ACES filmic tonemapping ---
vec3 ACESFilm(vec3 x) {
  float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// --- Hash for film grain ---
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;
  
  // Camera: mouse shifts viewing angle
  vec2 mouseOffset = (u_mouse - 0.5) * 0.3;
  vec3 ro = vec3(0.0, 0.0, -3.0);
  vec3 rd = normalize(vec3(uv + mouseOffset, 2.0));
  
  // Raymarch
  vec3 color = vec3(0.0);
  float alpha = 0.0;
  float stepSize = 0.08;
  
  for (int i = 0; i < 80; i++) {
    if (alpha > 0.95) break;
    
    vec3 p = ro + rd * float(i) * stepSize;
    p *= u_scale * 0.1;
    p.z += u_time * u_speed * 0.1;
    p.x += sin(u_time * u_speed * 0.05) * 0.5;
    
    float d = dotNoise(p) * 0.5 + 0.5;
    d = smoothstep(0.3, 0.7, d) * u_density;
    
    float depthFrac = float(i) / 80.0;
    vec3 layerColor;
    if (depthFrac < 0.5) {
      layerColor = mix(u_brandPrimary, u_brandSecondary, depthFrac * 2.0);
    } else {
      layerColor = mix(u_brandSecondary, u_brandAccent, (depthFrac - 0.5) * 2.0);
    }
    
    // Warmth shift
    layerColor = mix(layerColor, layerColor * vec3(1.1, 1.0, 0.9), u_warmth);
    
    float a = d * (1.0 - alpha) * 0.15;
    color += layerColor * a * u_glow;
    alpha += a;
  }
  
  // Click pulse
  color += u_burstStrength * mix(u_brandAccent, vec3(1.0), 0.5) * 0.3;
  
  // Base: composite over background
  color = mix(u_bgColor * 0.2, color, min(alpha + 0.1, 1.0));
  
  // Post-processing
  color = ACESFilm(color);                            // ACES tone map
  color = min(color, vec3(0.7));                      // Brightness cap
  color = mix(u_bgColor, color, u_intensity);         // Intensity blend
  
  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);
  
  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;
  
  fragColor = vec4(clamp(color, 0.0, 0.7), 1.0);
}
```

## Renderer (vapor-renderer.ts)

Single-pass, follows nebula-renderer pattern exactly:
- One program (no FBOs)
- Internal lerped mouse state (MOUSE_LERP = 0.04) for smooth camera movement
- Pass all uniforms each frame
- No int uniforms -- all config values are floats
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
  'u_density',
  'u_speed',
  'u_scale',
  'u_warmth',
  'u_glow',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;
```

### Renderer Template

```typescript
import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, VaporConfig } from '../shader-config';
import { VAPOR_FRAG } from '../shaders/vapor.frag';
import {
  createProgram,
  createQuad,
  drawQuad,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

// ... UNIFORM_NAMES as above ...

type VaporUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  density: 1.0,
  speed: 1.5,
  scale: 5.0,
  warmth: 0.5,
  glow: 0.8,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createVaporRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<VaporUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal lerped mouse state for smooth camera
  let lerpedMouse = { x: 0.5, y: 0.5 };
  const MOUSE_LERP = 0.04;

  return {
    init(gl, _width, _height) {
      program = createProgram(gl, VERTEX_SHADER, VAPOR_FRAG);
      if (!program) return false;
      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);
      lerpedMouse = { x: 0.5, y: 0.5 };
      return true;
    },

    render(gl, time, mouse, config, width, height) {
      if (!program || !uniforms || !quad) return;
      const cfg = config as VaporConfig;

      // Lerp mouse for smooth camera movement
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

      // Brand colors
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // All float uniforms
      gl.uniform1f(uniforms.u_density, cfg.density ?? DEFAULTS.density);
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      gl.uniform1f(uniforms.u_scale, cfg.scale ?? DEFAULTS.scale);
      gl.uniform1f(uniforms.u_warmth, cfg.warmth ?? DEFAULTS.warmth);
      gl.uniform1f(uniforms.u_glow, cfg.glow ?? DEFAULTS.glow);
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

Add `'vapor'` to the union:
```typescript
export type ShaderPresetId = '...' | 'vapor' | '...' | 'none';
```

### VaporConfig

```typescript
export interface VaporConfig extends ShaderConfigBase {
  preset: 'vapor';
  density: number;
  speed: number;
  scale: number;
  warmth: number;
  glow: number;
}
```

### ShaderConfig union

Add `| VaporConfig` to the union type.

### DEFAULTS

```typescript
// Vapor
vaporDensity: 1.0,
vaporSpeed: 1.5,
vaporScale: 5.0,
vaporWarmth: 0.5,
vaporGlow: 0.8,
```

### Switch case

```typescript
case 'vapor':
  return {
    ...base,
    preset: 'vapor',
    density: rv('shader-vapor-density', DEFAULTS.vaporDensity),
    speed: rv('shader-vapor-speed', DEFAULTS.vaporSpeed),
    scale: rv('shader-vapor-scale', DEFAULTS.vaporScale),
    warmth: rv('shader-vapor-warmth', DEFAULTS.vaporWarmth),
    glow: rv('shader-vapor-glow', DEFAULTS.vaporGlow),
  };
```

Note: No int uniforms in this preset -- all values are floats, so no `Math.round()` needed.

## ShaderHero.svelte Changes

Add to `loadRenderer()` switch:

```typescript
case 'vapor': {
  const { createVaporRenderer } = await import('./renderers/vapor-renderer');
  return createVaporRenderer();
}
```

## Brand Editor Changes

### BrandEditorHeroEffects.svelte

**PRESETS array**: Add entry:
```typescript
{ id: 'vapor', label: 'Vapor', description: 'Ethereal volumetric clouds' },
```

**DEFAULTS record**: Add entries:
```typescript
'shader-vapor-density': '1.00',
'shader-vapor-speed': '1.50',
'shader-vapor-scale': '5.0',
'shader-vapor-warmth': '0.50',
'shader-vapor-glow': '0.80',
```

**Derived state**: Add:
```typescript
// Vapor
const vaporDensity = $derived(readNum('shader-vapor-density'));
const vaporSpeed = $derived(readNum('shader-vapor-speed'));
const vaporScale = $derived(readNum('shader-vapor-scale'));
const vaporWarmth = $derived(readNum('shader-vapor-warmth'));
const vaporGlow = $derived(readNum('shader-vapor-glow'));
```

**Slider section**: Add `{:else if activePreset === 'vapor'}` block with 5 sliders.

### Brand Editor Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| `shader-vapor-density` | Cloud Density | 0.50 | 2.00 | 0.10 | 1.00 | Thin | Thick |
| `shader-vapor-speed` | Animation Speed | 0.50 | 2.50 | 0.10 | 1.50 | Slow | Fast |
| `shader-vapor-scale` | Cloud Scale | 3.0 | 8.0 | 0.5 | 5.0 | Fine | Coarse |
| `shader-vapor-warmth` | Warmth | 0.00 | 1.00 | 0.05 | 0.50 | Cool | Warm |
| `shader-vapor-glow` | Glow Intensity | 0.30 | 1.50 | 0.10 | 0.80 | Dim | Bright |

## Brand Color Mapping

| Visual Element | Color Source | Notes |
|----------------|-------------|-------|
| Near clouds (foreground) | `u_brandPrimary` | Closest density accumulation |
| Mid-depth clouds | `u_brandPrimary` -> `u_brandSecondary` gradient | Blend via `depthFrac` |
| Far clouds (background) | `u_brandSecondary` -> `u_brandAccent` gradient | Distant accumulation |
| Void / empty space | `u_bgColor * 0.2` | Very dark base behind clouds |
| Click pulse flash | `u_brandAccent` mixed with white | Brief brightening |
| Warmth shift | Per-channel multiplier `vec3(1.1, 1.0, 0.9)` | Shifts red up, blue down |

Depth-based colour blending (3-segment via raymarch step):
```glsl
float depthFrac = float(i) / 80.0;
vec3 layerColor;
if (depthFrac < 0.5) {
  layerColor = mix(u_brandPrimary, u_brandSecondary, depthFrac * 2.0);
} else {
  layerColor = mix(u_brandSecondary, u_brandAccent, (depthFrac - 0.5) * 2.0);
}
```

This creates a natural depth-based colour gradient through the cloud volume. The warmth slider adds a subtle warm/cool bias by shifting red and blue channels independently, giving the clouds a sunset or moonlit feel.

## Mouse Interaction Detail

| Input | Effect | Strength |
|-------|--------|----------|
| Mouse X | Shifts camera look-at X | `(mouse.x - 0.5) * 0.3` |
| Mouse Y | Shifts camera look-at Y | `(mouse.y - 0.5) * 0.3` |
| Click burst | Screen-wide brightness pulse | `burstStrength * accent * 0.3` |
| Touch start | Same as click burst (mobile) | Same |
| Touch move | Same as mouse move | Same |
| No interaction | Camera at centre, clouds drift autonomously | Default view |

The mouse interaction should feel like gently tilting your head to look around inside a cloud formation. The 0.3 multiplier keeps the camera shift subtle -- this is a meditative preset, not an action one. The lerped mouse (MOUSE_LERP = 0.04) ensures smooth camera panning.

## Performance Budget

Target: 0.5-1.0ms per frame (80-step raymarch is the main cost).

| Operation | Cost | Notes |
|-----------|------|-------|
| dotNoise per step | ~6 cos + 6 sin + 2 dot + 1 mat3*vec3 | Core noise |
| Raymarch (80 steps) | ~80 * (dotNoise + smoothstep + colour mix) | Main cost |
| ACES tonemapping | ~10 ops | Slightly more than Reinhard |
| Post-process | ~10 ops | Standard pipeline |
| **Total per fragment** | ~1600-2000 ops | Medium-high cost |

The early-exit on `alpha > 0.95` means dense configurations terminate early (fewer steps needed). Sparse configurations use more steps but each step is cheap. The 80-step limit is a good balance.

No FBOs, no texture reads. The main cost is the dot noise evaluation per step. On modern GPUs this is well within budget.

## Gotchas

1. **BRAND_PREFIX_KEYS** -- all 5 keys MUST be registered in `css-injection.ts` or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and ShaderHero never reads them)
2. **No naming collisions** -- all keys namespaced as `shader-vapor-*` to avoid collision with existing `shader-density`, `shader-speed`, `shader-scale`, `shader-glow` etc.
3. **Export pattern** -- shader string exported as `export const VAPOR_FRAG = \`#version 300 es...`
4. **Post-processing chain** -- MUST follow established order: tone map -> brightness cap -> intensity blend -> vignette -> grain -> final cap. Note: this preset uses ACES instead of Reinhard, but the rest of the chain is identical.
5. **ACES vs Reinhard** -- ACES produces slightly different brightness characteristics. The `min(color, 0.7)` cap and `clamp(color, 0.0, 0.7)` final cap still apply to keep visual consistency with other presets.
6. **Dot noise range** -- `dot(cos(...), sin(...))` with 3-component vectors returns values in ~[-3, 3]. The `* 0.5 + 0.5` remap and `smoothstep(0.3, 0.7, ...)` threshold are both needed to get usable density values.
7. **Step size tuning** -- `stepSize = 0.08` with 80 steps gives a total ray depth of 6.4 units. Increasing step size makes clouds coarser; decreasing it reduces the visible depth. This is intentionally not configurable.
8. **Accumulation alpha** -- the `* 0.15` factor on each step's alpha prevents clouds from becoming opaque too quickly. Combined with `u_density`, this gives good control over cloud opacity.
9. **mat3 in GLSL ES 3.0** -- the golden ratio matrix `G` must be declared as `const mat3` (not a uniform) for GLSL ES 3.0 compliance. Column-major order.
10. **No int uniforms** -- unlike nebula (which has `u_depth` as int) or julia (which has `u_iterations` as int), vapor has all-float uniforms. No `Math.round()` or `gl.uniform1i()` needed.
11. **Camera origin** -- `ro = vec3(0.0, 0.0, -3.0)` places the camera behind the cloud volume. Moving ro forward produces a "inside the clouds" effect; moving it back gives a "watching from afar" effect. This is baked in, not configurable.
12. **Warmth as colour shift** -- the warmth slider multiplies by `vec3(1.1, 1.0, 0.9)` at max, slightly boosting red and reducing blue. At `warmth = 0`, no shift occurs. This is subtle by design -- aggressive warmth shifts clash with some brand palettes.

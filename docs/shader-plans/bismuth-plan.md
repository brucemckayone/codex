# Bismuth (Crystal Terraces) Shader Preset — Implementation Plan

## Overview

Add a "bismuth" shader preset: geometric stepped terraces like a bismuth crystal cross-section -- rectangular/square spiralling structures with iridescent edges. Perfectly geometric staircase-like hopper crystals. The iridescence comes from thin-film interference on oxide layers, but instead of a rainbow spectrum, the colour shift maps through the brand palette (primary -> secondary -> accent) based on viewing angle -- like a hologram in brand colours. Unique, striking, unlike anything else in the catalog. Single-pass (no FBO).

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify -- add `BismuthConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/bismuth.frag.ts` | Create -- single-pass fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/bismuth-renderer.ts` | Create -- single-pass renderer |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify -- add `'bismuth'` to loadRenderer switch |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify -- add 5 keys to BRAND_PREFIX_KEYS |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify -- preset card + sliders + defaults + derived state |

## Config Interface

```typescript
export interface BismuthConfig extends ShaderConfigBase {
  preset: 'bismuth';
  terraces: number;      // 4-12, default 8 (int) -- Number of terrace levels
  warp: number;          // 0.3-1.5, default 0.8 -- Domain warp strength
  iridescence: number;   // 0.3-1.5, default 0.8 -- Colour shift intensity
  speed: number;         // 0.03-0.15, default 0.06 -- Morphing speed
  edge: number;          // 0.3-1.5, default 0.8 -- Edge highlight intensity
}
```

## Defaults

```typescript
// Bismuth
bismuthTerraces: 8,
bismuthWarp: 0.8,
bismuthIridescence: 0.8,
bismuthSpeed: 0.06,
bismuthEdge: 0.8,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

These 5 keys MUST be added to the `BRAND_PREFIX_KEYS` set in `css-injection.ts`:

```
shader-bismuth-terraces
shader-bismuth-warp
shader-bismuth-iridescence
shader-bismuth-speed
shader-bismuth-edge
```

Without these entries, the brand editor sliders will silently fail -- values get `--color-` prefix instead of `--brand-` prefix and `getShaderConfig()` never reads them.

## Fragment Shader (bismuth.frag.ts)

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
| `u_terraces` | `int` | Number of terrace levels |
| `u_warp` | `float` | Domain warp strength |
| `u_iridescence` | `float` | Colour shift intensity |
| `u_speed` | `float` | Morphing speed |
| `u_edge` | `float` | Edge highlight intensity |
| `u_intensity` | `float` | Overall blend |
| `u_grain` | `float` | Film grain |
| `u_vignette` | `float` | Vignette strength |

### Algorithm

1. **Aspect-corrected UV setup**: Map fragment UV to aspect-corrected coordinates centred at (0, 0). Scale to fill canvas. Bismuth structures are roughly centred and should not stretch on wide viewports.

2. **Procedural height field with domain warping**: Generate a smooth height field using multi-octave FBM noise (2-3 octaves, sin-based, inter-octave rotation matching the topo pattern). Before sampling, warp the input coordinates using a second FBM pass -- this creates the irregular, organic-looking terrace boundaries that mimic real bismuth crystal step patterns rather than perfect concentric shapes. Warp strength controlled by `u_warp`.

3. **Terrace quantisation (stepped height)**: Apply `floor(height * float(u_terraces)) / float(u_terraces)` to the smooth height field. This snaps the continuous field to discrete levels, creating flat terraces with sharp step edges -- the hallmark bismuth hopper crystal geometry. The number of levels is controlled by `u_terraces` (int uniform).

4. **Edge detection via gradient magnitude**: Compute the gradient of the stepped height field using screen-space partial derivatives (`dFdx`, `dFdy` on the stepped value). The gradient magnitude is large at terrace edges (where the step discontinuity lives) and near-zero on flat terrace faces. This gives a clean edge mask. Alternatively, compare the stepped height at the current pixel vs a small offset to detect jumps. Scale the edge brightness by `u_edge`.

5. **Iridescent colour shift from viewing angle**: The key visual feature. Instead of a fixed colour per terrace, compute a "viewing angle" that shifts across the surface based on:
   - The local terrace normal (derived from the pre-stepping height gradient)
   - The mouse position as a pseudo-view direction: `vec3(u_mouse.x - 0.5, u_mouse.y - 0.5, 0.5)`
   - `dot(normal, viewDir)` gives a Fresnel-like angle factor in [0, 1]
   
   Map this angle factor through the brand palette: `0.0 = primary`, `0.5 = secondary`, `1.0 = accent`, using smooth `mix()` interpolation. Scale the colour shift range by `u_iridescence`. At low iridescence, terraces stay mostly primary-coloured; at high iridescence, the full primary -> secondary -> accent spectrum sweeps across the surface.

6. **Slow morphing animation**: Offset the noise sampling coordinates by `u_time * u_speed`, causing the underlying height field to evolve slowly. The terrace pattern morphs and shifts -- new terraces emerge, old ones merge. This creates a living, breathing crystal structure rather than a static image.

7. **Mouse interaction -- viewing angle shift**: The mouse position directly controls the apparent viewing angle for the iridescent colour calculation (step 5). Moving the mouse smoothly shifts which colours appear on which terraces -- a satisfying prismatic effect like tilting a bismuth crystal under light. The `u_mouseActive` flag ensures a neutral default angle when the mouse is not over the canvas.

8. **Click rotation impulse**: On click, `u_burst` adds a rotation to the underlying coordinate space (similar to geode), causing the entire terrace pattern to spin briefly. The burst decays via existing `burstStrength *= 0.85` in ShaderHero.svelte.

9. **Terrace face colouring**: Each terrace face gets its iridescent colour (from step 5) mixed with the brand background. The face colour is attenuated by the stepped height level -- lower terraces are darker (closer to `u_bgColor`), upper terraces are brighter and more saturated. This creates depth.

10. **Edge glow with accent**: Terrace edges glow with `u_brandAccent`, blended with the iridescent colour. Edge brightness is `edgeMask * u_edge * accentColor`. This makes the characteristic bright edges of bismuth crystals -- the oxide interference layer that creates their signature look.

11. **Post-processing chain** (MUST follow this order -- matches all other presets):
    - Reinhard tone map: `color = color / (1.0 + color)`
    - Brightness cap: `color = min(color, vec3(0.75))`
    - Intensity mix: `color = mix(u_bgColor, color, u_intensity)`
    - Vignette: `color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0)`
    - Film grain: `color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain`
    - Final clamp: `fragColor = vec4(clamp(color, 0.0, 0.75), 1.0)`

### Key GLSL Functions

```glsl
// -- Hash for film grain --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// -- Noise (sin-based, same as topo) --
float noise(vec2 p) {
  return sin(p.x) * sin(p.y);
}

// -- FBM with rotation (2-3 octaves) --
const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

float fbm(vec2 p) {
  float f = 0.0;
  float amp = 0.5;
  float total = 0.0;
  for (int i = 0; i < 3; i++) {
    f += amp * noise(p);
    total += amp;
    p = octaveRot * p * 2.02;
    amp *= 0.5;
  }
  return total > 0.0 ? f / total : 0.0;
}

// -- Iridescent brand palette mapping --
// Maps a 0..1 angle factor through primary -> secondary -> accent
vec3 iridescent(float angle, float strength) {
  float t = clamp(angle * strength, 0.0, 1.0);
  if (t < 0.5) {
    return mix(u_brandPrimary, u_brandSecondary, t * 2.0);
  } else {
    return mix(u_brandSecondary, u_brandAccent, (t - 0.5) * 2.0);
  }
}
```

### GLSL Pseudocode (main)

```glsl
void main() {
  float t = u_time * u_speed;
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;

  // Centre and aspect-correct
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) * 3.0;

  // Click rotation impulse
  float angle = u_burst * 0.5;
  float ca = cos(angle), sa = sin(angle);
  p = mat2(ca, sa, -sa, ca) * p;

  // Animate noise field
  vec2 pAnim = p + vec2(t * 0.3, t * 0.2);

  // Domain warp
  vec2 warpOffset = u_warp * 0.4 * vec2(
    fbm(pAnim * 2.0 + 10.0),
    fbm(pAnim * 2.0 + 20.0)
  );
  vec2 pWarped = pAnim + warpOffset;

  // Smooth height field
  float heightSmooth = fbm(pWarped);
  heightSmooth = clamp(heightSmooth * 0.5 + 0.5, 0.0, 1.0);

  // Terrace quantisation: floor(h * N) / N
  float N = float(u_terraces);
  float heightStepped = floor(heightSmooth * N) / N;

  // Edge detection via gradient of stepped field
  float dHdx = dFdx(heightStepped);
  float dHdy = dFdy(heightStepped);
  float edgeMask = length(vec2(dHdx, dHdy)) * 40.0;
  edgeMask = clamp(edgeMask, 0.0, 1.0);

  // Iridescent colour from viewing angle
  // Pre-step gradient gives a smooth normal for lighting
  float gx = dFdx(heightSmooth);
  float gy = dFdy(heightSmooth);
  vec3 normal = normalize(vec3(gx * 8.0, gy * 8.0, 1.0));

  // View direction from mouse (or default centre when inactive)
  float mx = u_mouseActive > 0.5 ? u_mouse.x : 0.5;
  float my = u_mouseActive > 0.5 ? u_mouse.y : 0.5;
  vec3 viewDir = normalize(vec3(mx - 0.5, my - 0.5, 0.5));

  // Fresnel-like angle factor
  float angleFactor = 1.0 - abs(dot(normal, viewDir));

  // Map through brand palette
  vec3 iriColor = iridescent(angleFactor, u_iridescence);

  // Terrace face colour: iridescent, darkened by depth level
  float depthFade = 0.4 + 0.6 * heightStepped;
  vec3 faceColor = mix(u_bgColor, iriColor, depthFade);

  // Edge glow with accent
  vec3 edgeColor = u_brandAccent * (0.8 + 0.4 * angleFactor);
  vec3 color = mix(faceColor, edgeColor, edgeMask * u_edge);

  // -- Post-processing --
  // Reinhard tone map
  color = color / (1.0 + color);
  color = min(color, vec3(0.75));
  color = mix(u_bgColor, color, u_intensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
```

## Renderer (bismuth-renderer.ts)

Single-pass, follows topo-renderer pattern exactly:
- One program (no FBOs)
- Pass all uniforms each frame
- `u_terraces` via `gl.uniform1i()` with `Math.round()` (CRITICAL -- int uniform, not float)
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
  'u_terraces',
  'u_warp',
  'u_iridescence',
  'u_speed',
  'u_edge',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;
```

### Renderer Structure

```typescript
import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, BismuthConfig } from '../shader-config';
import { BISMUTH_FRAG } from '../shaders/bismuth.frag';
import {
  createProgram,
  createQuad,
  drawQuad,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

const DEFAULTS = {
  terraces: 8,
  warp: 0.8,
  iridescence: 0.8,
  speed: 0.06,
  edge: 0.8,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createBismuthRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<...> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  return {
    init(gl, _w, _h) { /* createProgram + getUniforms + createQuad */ },

    render(gl, time, mouse, config, width, height) {
      const cfg = config as BismuthConfig;
      // ... set viewport, useProgram, bind quad ...

      // CRITICAL: u_terraces is int -- use uniform1i, not uniform1f
      gl.uniform1i(uniforms.u_terraces, Math.round(cfg.terraces ?? DEFAULTS.terraces));

      // All other config uniforms via uniform1f
      gl.uniform1f(uniforms.u_warp, cfg.warp ?? DEFAULTS.warp);
      gl.uniform1f(uniforms.u_iridescence, cfg.iridescence ?? DEFAULTS.iridescence);
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      gl.uniform1f(uniforms.u_edge, cfg.edge ?? DEFAULTS.edge);
      // ... standard uniforms (time, resolution, mouse, colors, intensity, grain, vignette) ...

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize() { /* no-op for single-pass */ },
    reset() { /* no-op for single-pass */ },
    destroy(gl) { /* deleteProgram + deleteBuffer */ },
  };
}
```

## shader-config.ts Changes

### ShaderPresetId

Add `'bismuth'` to the union:
```typescript
export type ShaderPresetId = '...' | 'lava' | 'bismuth' | 'none';
```

### BismuthConfig

```typescript
export interface BismuthConfig extends ShaderConfigBase {
  preset: 'bismuth';
  terraces: number;
  warp: number;
  iridescence: number;
  speed: number;
  edge: number;
}
```

### ShaderConfig union

Add `| BismuthConfig` to the union type.

### DEFAULTS

```typescript
// Bismuth
bismuthTerraces: 8,
bismuthWarp: 0.8,
bismuthIridescence: 0.8,
bismuthSpeed: 0.06,
bismuthEdge: 0.8,
```

### Switch case

```typescript
case 'bismuth':
  return {
    ...base,
    preset: 'bismuth',
    terraces: Math.round(rv('shader-bismuth-terraces', DEFAULTS.bismuthTerraces)),
    warp: rv('shader-bismuth-warp', DEFAULTS.bismuthWarp),
    iridescence: rv('shader-bismuth-iridescence', DEFAULTS.bismuthIridescence),
    speed: rv('shader-bismuth-speed', DEFAULTS.bismuthSpeed),
    edge: rv('shader-bismuth-edge', DEFAULTS.bismuthEdge),
  };
```

Note: `terraces` MUST use `Math.round()` because it maps to `uniform int` in the shader.

## ShaderHero.svelte Changes

Add to `loadRenderer()` switch:

```typescript
case 'bismuth': {
  const { createBismuthRenderer } = await import('./renderers/bismuth-renderer');
  return createBismuthRenderer();
}
```

## Brand Editor Changes

### BrandEditorHeroEffects.svelte

**PRESETS array**: Add entry:
```typescript
{ id: 'bismuth', label: 'Bismuth', description: 'Crystal terrace iridescence' },
```

**DEFAULTS record**: Add entries:
```typescript
// Bismuth
'shader-bismuth-terraces': '8',
'shader-bismuth-warp': '0.80',
'shader-bismuth-iridescence': '0.80',
'shader-bismuth-speed': '0.06',
'shader-bismuth-edge': '0.80',
```

**Derived state**: Add:
```typescript
// Bismuth
const bismuthTerraces = $derived(readNum('shader-bismuth-terraces'));
const bismuthWarp = $derived(readNum('shader-bismuth-warp'));
const bismuthIridescence = $derived(readNum('shader-bismuth-iridescence'));
const bismuthSpeed = $derived(readNum('shader-bismuth-speed'));
const bismuthEdge = $derived(readNum('shader-bismuth-edge'));
```

**Slider section**: Add `{:else if activePreset === 'bismuth'}` block with 5 sliders.

### Brand Editor Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| `shader-bismuth-terraces` | Terrace Levels | 4 | 12 | 1 | 8 | Few | Many |
| `shader-bismuth-warp` | Domain Warp | 0.30 | 1.50 | 0.05 | 0.80 | Smooth | Warped |
| `shader-bismuth-iridescence` | Iridescence | 0.30 | 1.50 | 0.05 | 0.80 | Subtle | Vivid |
| `shader-bismuth-speed` | Morph Speed | 0.03 | 0.15 | 0.01 | 0.06 | Slow | Fast |
| `shader-bismuth-edge` | Edge Glow | 0.30 | 1.50 | 0.05 | 0.80 | Faint | Bright |

## Brand Color Mapping

| Visual Element | Color Source | Notes |
|----------------|-------------|-------|
| Terrace face base | `u_bgColor` | Mixed in via depthFade -- lower terraces closer to bg |
| Terrace iridescent tint (shallow angle) | `u_brandPrimary` | Dominant when viewing head-on |
| Terrace iridescent mid (mid angle) | `u_brandSecondary` | Appears at medium viewing angles |
| Terrace iridescent shift (steep angle) | `u_brandAccent` | Appears at grazing angles |
| Edge glow | `u_brandAccent * (0.8 + 0.4 * angle)` | Bright edges with angle-dependent warmth |
| Deep terrace faces (low height) | `mix(u_bgColor, iriColor, 0.4)` | Darkened, receding into background |
| Top terrace faces (high height) | `mix(u_bgColor, iriColor, 1.0)` | Full iridescent colour, most prominent |

The iridescent colour cycles through the brand palette using a Fresnel-like angle factor: `1.0 - abs(dot(normal, viewDir))`. At head-on viewing the surface shows primary; as the surface tilts away from the viewer the colour shifts through secondary to accent. Moving the mouse changes the apparent view direction, sweeping colours across all terraces simultaneously -- the prismatic holographic effect.

## Mouse Interaction

| Action | Effect |
|--------|--------|
| **Hover (move)** | Changes the apparent viewing angle used for iridescent colour calculation. View direction = `normalize(vec3(mouse.x - 0.5, mouse.y - 0.5, 0.5))`. Sweeps brand colours across terraces -- very satisfying prismatic shift. Moving mouse left-to-right creates a wave of colour change. |
| **Click (burst)** | Adds rotation impulse `u_burst * 0.5` to the coordinate space, spinning the terrace pattern briefly. Decays via existing `burstStrength *= 0.85`. |
| **Touch (mobile)** | Touch start = burst (rotation impulse) + iridescent shift. Touch move = continuous iridescent colour sweep. Same as mouse but via touch events. |

## Gotchas

1. **BRAND_PREFIX_KEYS** -- all 5 keys MUST be registered in `css-injection.ts` or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and `getShaderConfig()` never reads them)
2. **`terraces` as int uniform** -- MUST use `Math.round()` in config parsing AND `gl.uniform1i()` in the renderer (not `uniform1f`). Passing a float to an `int` uniform produces undefined behaviour in GLSL ES 3.0.
3. **No naming collisions** -- all keys namespaced as `shader-bismuth-*` to avoid collision with existing `shader-speed`, `shader-scale` etc.
4. **Export pattern** -- shader string exported as `export const BISMUTH_FRAG = \`#version 300 es...`
5. **Post-processing chain** -- MUST follow: Reinhard tone map -> `min(color, 0.75)` brightness cap -> `mix(u_bgColor, color, u_intensity)` intensity blend -> vignette -> grain -> `clamp(color, 0.0, 0.75)` final cap
6. **`dFdx`/`dFdy` for edge detection** -- these screen-space derivative functions are available in GLSL ES 3.0 (WebGL2) without extension. They detect the step discontinuities in the quantised height field. Apply the derivatives to the *stepped* height for edge detection and to the *smooth* height for surface normal computation -- using the wrong one gives incorrect results.
7. **Smooth vs stepped height separation** -- the shader MUST maintain both `heightSmooth` (pre-step, for surface normals and iridescent angle) and `heightStepped` (post-step, for terrace colouring and edge detection). Mixing these up produces wrong normals or blurry edges.
8. **Zero-distance guard on view direction** -- the `normalize(vec3(mx - 0.5, my - 0.5, 0.5))` has a minimum Z component of 0.5, so it never degenerates to zero-length. Safe as-is.
9. **Aspect correction** -- the centred coordinate `p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) * 3.0` ensures square-proportioned terraces, not stretched on wide viewports. The `* 3.0` zoom factor ensures terraces fill the viewport well at default settings.
10. **Iridescence at low values** -- when `u_iridescence` is low (0.3), the `angleFactor * strength` product stays near zero, so all terraces appear primary-coloured. This gives a "muted metal" look. At high values (1.5), the colour range overshoots and gets clamped, producing saturated accent edges -- intentional dramatic effect.
11. **Preset grid** -- 16th card (including 'none') in 2-col grid = 8 rows, layout remains clean.

# Aurora (Aurora Borealis) Shader Preset -- Implementation Plan

## Overview

Add an "aurora" shader preset: majestic vertical curtains of coloured light swaying horizontally, with shimmer along the bottom edge. Multiple translucent layers at different speeds create depth. Single-pass (no FBO). Layered sine waves with triNoise displacement create curtain shapes. Vertical gradient mask concentrates brightness in horizontal bands. 4-6 curtain layers tinted with blends of brand colours. Slow, ethereal, northern-lights feel.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify -- add `AuroraConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/aurora.frag.ts` | Create -- single-pass fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/aurora-renderer.ts` | Create -- single-pass renderer |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify -- add `'aurora'` to loadRenderer switch |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify -- add 5 keys to BRAND_PREFIX_KEYS |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify -- preset card + sliders |

## Config Interface

```typescript
export interface AuroraConfig extends ShaderConfigBase {
  preset: 'aurora';
  layers: number;     // 3-7, default 5 (int) -- Number of curtain layers
  speed: number;      // 0.05-0.30, default 0.10 -- Sway speed
  height: number;     // 0.2-0.6, default 0.40 -- Vertical band position (0=bottom, 1=top)
  spread: number;     // 0.1-0.5, default 0.25 -- Vertical spread/thickness
  shimmer: number;    // 0.3-1.5, default 0.80 -- Bottom edge shimmer intensity
}
```

## Defaults

```typescript
// Aurora
auroraLayers: 5,
auroraSpeed: 0.10,
auroraHeight: 0.40,
auroraSpread: 0.25,
auroraShimmer: 0.80,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

```
shader-aurora-layers
shader-aurora-speed
shader-aurora-height
shader-aurora-spread
shader-aurora-shimmer
```

All 5 keys MUST be registered in `css-injection.ts` BRAND_PREFIX_KEYS or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and ShaderHero never reads them via `getComputedStyle`).

## Fragment Shader (aurora.frag.ts)

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
| `u_bgColor` | `vec3` | Background (night sky) |
| `u_layers` | `int` | Number of curtain layers |
| `u_speed` | `float` | Sway speed |
| `u_height` | `float` | Vertical band centre position |
| `u_spread` | `float` | Vertical spread/thickness |
| `u_shimmer` | `float` | Bottom edge shimmer intensity |
| `u_intensity` | `float` | Overall blend |
| `u_grain` | `float` | Film grain |
| `u_vignette` | `float` | Vignette strength |

### Algorithm

1. **triNoise (nimitz technique)**: A non-smooth organic noise built from layered `sin/cos` combinations with rotation matrices between octaves. Unlike standard smooth FBM, triNoise creates organic crinkly variation perfect for aurora curtain edges. Three octaves with halving amplitude and doubling frequency, rotated by 37-degree increments between octaves.

2. **Curtain shape per layer**: Each of the N layers (3-7) produces a vertical curtain:
   - Horizontal displacement via `sin(x * layerFreq + time * layerSpeed + layerPhaseOffset)` with triNoise modulation
   - Vertical Gaussian envelope centred at `u_height`, spread by `u_spread`: `exp(-pow((y - centre) / u_spread, 2.0))`
   - Each layer offset vertically by `layerIndex * 0.03` to create depth layering
   - Each layer has different frequency (1.5-4.0), phase offset (golden angle: i * 2.399), and speed multiplier (0.7-1.3)

3. **Bottom edge shimmer**: Along the lower edge of each curtain's Gaussian envelope, add high-frequency triNoise modulated by `u_shimmer` to create sparkling fine detail that mimics the rapid flickering visible at the bottom of real auroras.

4. **Colour per layer**: Layers blend between adjacent brand colours:
   - Bottom layers: `u_bgColor` -> `u_brandPrimary` (deep green/teal zone)
   - Middle layers: `u_brandPrimary` -> `u_brandSecondary` (main body)
   - Top layers: `u_brandSecondary` -> `u_brandAccent` (crown highlights)
   - Blend factor: `float(layerIndex) / float(u_layers - 1)`

5. **Compositing**: Layers are blended additively with `alpha = curtainBrightness * layerAlpha`. Lower layers render first (painter's algorithm in the loop). Additive blending naturally creates bright intersections where curtain folds overlap.

6. **Optional star field**: Behind the aurora curtains, sparse dot noise (thresholded hash) at very low brightness. Tied to `u_bgColor` -- only visible when bg is very dark. Stars twinkle by multiplying with `sin(time * starFreq + hash(pos))`.

7. **Mouse interaction**:
   - Vertical mouse (Y) shifts aurora centre: `adjustedHeight = u_height + (mouse.y - 0.5) * 0.15 * mouseActive`
   - Horizontal mouse (X) adds phase offset to all curtains: `phaseShift = (mouse.x - 0.5) * 1.5 * mouseActive`, making curtains sway toward the pointer
   - Click burst creates a brief brightening/widening pulse: `spread += burst * 0.1`, `brightness += burst * 0.3`

8. **Post-processing**: Reinhard tone map -> `min(color, 0.75)` brightness cap -> `mix(u_bgColor, color, u_intensity)` intensity blend -> vignette -> grain -> `clamp(color, 0.0, 0.75)` final cap

### Key GLSL Notes

- Export as `export const AURORA_FRAG = \`#version 300 es...`
- For-loop with `if (i >= u_layers) break;` needs constant upper bound (7)
- Aspect ratio correction: `vec2 p = vec2(uv.x * aspect, uv.y);`
- triNoise hash for organic variation: same `hash(vec2)` as topo shader reused
- Noise hash for grain: same `hash(vec2)` reused
- Star field threshold: `step(0.998, hash(floor(uv * starDensity)))` for sparse dots

### GLSL Pseudocode

```glsl
// --- triNoise (nimitz-inspired) ---
float triNoise(vec2 p, float t) {
  float z = 1.5;
  float rz = 0.0;
  const mat2 triRot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 3; i++) {
    // Triangle wave: abs(fract) gives non-smooth crinkle
    float val = abs(sin(p.x * z + t) + sin(p.y * z + t));
    rz += val / z;
    p = triRot * p * 1.45;
    z *= 2.0;
    t *= 1.3;
  }
  return rz;
}

// --- Per-layer curtain ---
float curtain(vec2 uv, float t, int layer) {
  float layerF = float(layer);
  float freq = 1.5 + layerF * 0.5;
  float phase = layerF * 2.399; // golden angle spacing
  float speedMul = 0.7 + layerF * 0.1;

  // Horizontal displacement with triNoise wobble
  float disp = sin(uv.x * freq + t * speedMul * u_speed + phase)
             + triNoise(vec2(uv.x * 0.5, t * 0.3 + layerF), t) * 0.3;

  // Vertical Gaussian envelope
  float centre = u_height + layerF * 0.03 + mouseYOffset;
  float env = exp(-pow((uv.y - centre) / u_spread, 2.0));

  // Bottom edge shimmer
  float bottomEdge = smoothstep(centre - u_spread, centre - u_spread * 0.5, uv.y);
  float shimmerNoise = triNoise(uv * 8.0 + vec2(t * 2.0, layerF), t * 3.0);
  float shimmer = (1.0 - bottomEdge) * shimmerNoise * u_shimmer * env;

  return env * (0.3 + 0.7 * abs(disp) * 0.5) + shimmer;
}

// --- main() ---
void main() {
  float t = u_time;
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);

  // Mouse interaction
  float mouseYOffset = u_mouseActive * (u_mouse.y - 0.5) * 0.15;
  float phaseShift = u_mouseActive * (u_mouse.x - 0.5) * 1.5;

  // Optional star field (behind aurora)
  float starDensity = 300.0;
  vec2 starUV = floor(p * starDensity);
  float star = step(0.998, hash(starUV)) * (0.3 + 0.2 * sin(t * 2.0 + hash(starUV + 1.0) * 6.28));
  vec3 color = u_bgColor + vec3(star * 0.15);

  // Accumulate curtain layers (additive)
  for (int i = 0; i < 7; i++) {
    if (i >= u_layers) break;
    float c = curtain(p, t + phaseShift, i);

    // Colour blend based on layer index
    float blend = float(i) / max(float(u_layers - 1), 1.0);
    vec3 layerColor;
    if (blend < 0.5) {
      layerColor = mix(u_brandPrimary, u_brandSecondary, blend * 2.0);
    } else {
      layerColor = mix(u_brandSecondary, u_brandAccent, (blend - 0.5) * 2.0);
    }

    // Burst brightening
    c += u_burst * 0.3 * exp(-pow((uv.y - u_height) / (u_spread + u_burst * 0.1), 2.0));

    color += layerColor * c * (0.25 / float(u_layers));
  }

  // Post-process
  color = color / (1.0 + color);                    // Reinhard
  color = min(color, vec3(0.75));                    // Brightness cap
  color = mix(u_bgColor, color, u_intensity);        // Intensity blend

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
```

## Renderer (aurora-renderer.ts)

Single-pass, follows topo-renderer pattern exactly:
- One program (no FBOs)
- Pass all uniforms each frame
- `u_layers` via `gl.uniform1i()` with `Math.round()` (NOT uniform1f -- int uniform)
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
  'u_layers',
  'u_speed',
  'u_height',
  'u_spread',
  'u_shimmer',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;
```

### Renderer Template

```typescript
import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, AuroraConfig } from '../shader-config';
import { AURORA_FRAG } from '../shaders/aurora.frag';
import {
  createProgram,
  createQuad,
  drawQuad,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

// ... UNIFORM_NAMES as above ...

type AuroraUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  layers: 5,
  speed: 0.10,
  height: 0.40,
  spread: 0.25,
  shimmer: 0.80,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createAuroraRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<AuroraUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  return {
    init(gl, _width, _height) {
      program = createProgram(gl, VERTEX_SHADER, AURORA_FRAG);
      if (!program) return false;
      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);
      return true;
    },

    render(gl, time, mouse, config, width, height) {
      if (!program || !uniforms || !quad) return;
      const cfg = config as AuroraConfig;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);

      const mx = mouse.active ? mouse.x : 0.5;
      const my = mouse.active ? mouse.y : 0.5;
      gl.uniform2f(uniforms.u_mouse, mx, my);
      gl.uniform1f(uniforms.u_mouseActive, mouse.active ? 1.0 : 0.0);
      gl.uniform1f(uniforms.u_burst, mouse.burstStrength ?? 0.0);

      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // CRITICAL: u_layers is int -- use uniform1i, NOT uniform1f
      gl.uniform1i(uniforms.u_layers, Math.round(cfg.layers ?? DEFAULTS.layers));
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      gl.uniform1f(uniforms.u_height, cfg.height ?? DEFAULTS.height);
      gl.uniform1f(uniforms.u_spread, cfg.spread ?? DEFAULTS.spread);
      gl.uniform1f(uniforms.u_shimmer, cfg.shimmer ?? DEFAULTS.shimmer);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(uniforms.u_vignette, cfg.vignette ?? DEFAULTS.vignette);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize() { /* Single-pass: no FBOs to resize */ },
    reset() { /* No simulation state */ },

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

Add `'aurora'` to the union:
```typescript
export type ShaderPresetId = '...' | 'aurora' | '...' | 'none';
```

### AuroraConfig

```typescript
export interface AuroraConfig extends ShaderConfigBase {
  preset: 'aurora';
  layers: number;
  speed: number;
  height: number;
  spread: number;
  shimmer: number;
}
```

### ShaderConfig union

Add `| AuroraConfig` to the union type.

### DEFAULTS

```typescript
// Aurora
auroraLayers: 5,
auroraSpeed: 0.10,
auroraHeight: 0.40,
auroraSpread: 0.25,
auroraShimmer: 0.80,
```

### Switch case

```typescript
case 'aurora':
  return {
    ...base,
    preset: 'aurora',
    layers: Math.round(rv('shader-aurora-layers', DEFAULTS.auroraLayers)),
    speed: rv('shader-aurora-speed', DEFAULTS.auroraSpeed),
    height: rv('shader-aurora-height', DEFAULTS.auroraHeight),
    spread: rv('shader-aurora-spread', DEFAULTS.auroraSpread),
    shimmer: rv('shader-aurora-shimmer', DEFAULTS.auroraShimmer),
  };
```

Note: `layers` MUST use `Math.round()` because it is an int uniform.

## ShaderHero.svelte Changes

Add to `loadRenderer()` switch:

```typescript
case 'aurora': {
  const { createAuroraRenderer } = await import('./renderers/aurora-renderer');
  return createAuroraRenderer();
}
```

## Brand Editor Changes

### BrandEditorHeroEffects.svelte

**PRESETS array**: Add entry:
```typescript
{ id: 'aurora', label: 'Aurora', description: 'Northern lights curtains' },
```

**DEFAULTS record**: Add entries:
```typescript
'shader-aurora-layers': '5',
'shader-aurora-speed': '0.10',
'shader-aurora-height': '0.40',
'shader-aurora-spread': '0.25',
'shader-aurora-shimmer': '0.80',
```

**Derived state**: Add:
```typescript
// Aurora
const auroraLayers = $derived(readNum('shader-aurora-layers'));
const auroraSpeed = $derived(readNum('shader-aurora-speed'));
const auroraHeight = $derived(readNum('shader-aurora-height'));
const auroraSpread = $derived(readNum('shader-aurora-spread'));
const auroraShimmer = $derived(readNum('shader-aurora-shimmer'));
```

**Slider section**: Add `{:else if activePreset === 'aurora'}` block with 5 sliders.

### Brand Editor Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| `shader-aurora-layers` | Curtain Layers | 3 | 7 | 1 | 5 | Few | Many |
| `shader-aurora-speed` | Sway Speed | 0.05 | 0.30 | 0.01 | 0.10 | Slow | Fast |
| `shader-aurora-height` | Band Position | 0.20 | 0.60 | 0.05 | 0.40 | Low | High |
| `shader-aurora-spread` | Vertical Spread | 0.10 | 0.50 | 0.05 | 0.25 | Narrow | Wide |
| `shader-aurora-shimmer` | Edge Shimmer | 0.30 | 1.50 | 0.10 | 0.80 | Subtle | Intense |

## Brand Color Mapping

| Visual Element | Color Source | Notes |
|----------------|-------------|-------|
| Night sky background | `u_bgColor` | Should be very dark for best effect |
| Bottom curtain layers | `u_brandPrimary` | Dominant aurora body colour |
| Middle curtain layers | `u_brandPrimary` -> `u_brandSecondary` gradient | Transition zone |
| Top/crown curtain layers | `u_brandSecondary` -> `u_brandAccent` | Bright crown highlights |
| Bottom edge shimmer | Same as owning layer colour, boosted | Inherits from layer |
| Star field (optional) | `u_bgColor` + 0.15 | Very subtle white dots |

Layer colour blending (3-segment via layer index):
```glsl
float blend = float(layerIndex) / max(float(u_layers - 1), 1.0);
vec3 layerColor;
if (blend < 0.5) {
  layerColor = mix(u_brandPrimary, u_brandSecondary, blend * 2.0);
} else {
  layerColor = mix(u_brandSecondary, u_brandAccent, (blend - 0.5) * 2.0);
}
```

This means the aurora naturally transitions from the brand's primary colour at the bottom through secondary in the middle to accent at the top -- a perfect natural fit since real auroras exhibit this kind of colour banding.

## Mouse Interaction Detail

| Input | Effect | Strength |
|-------|--------|----------|
| Mouse Y (vertical) | Shifts aurora vertical centre up/down | `(mouse.y - 0.5) * 0.15` |
| Mouse X (horizontal) | Phase offset on all curtains (sway toward pointer) | `(mouse.x - 0.5) * 1.5` |
| Click burst | Brief brightening + spread widening | `spread += burst * 0.1`, `brightness += burst * 0.3` |
| Touch start | Same as click burst (mobile) | Same |
| Touch move | Same as mouse move | Same |
| No interaction | `mouseActive = 0.0`, aurora at default position | Neutral centre |

The mouse interaction should feel like the aurora is gently responding to the viewer's gaze -- not a direct 1:1 mapping, but a subtle drift that creates a sense of being present in the scene.

## Performance Budget

Target: 0.3-0.6ms per frame (matching topo-class single-pass shaders).

| Operation | Cost | Notes |
|-----------|------|-------|
| triNoise (3 octaves) | ~6 sin/cos | Called per layer per shimmer |
| Curtain loop (5 layers default) | ~5 * (2 sin + 1 triNoise + 1 exp) | Main cost |
| Star field | ~1 hash + 1 step + 1 sin | Negligible |
| Post-process | ~10 ops | Standard pipeline |
| **Total per fragment** | ~60-80 ops | Well within budget |

No FBOs, no texture reads, no branching beyond the loop break. This is a very cheap shader.

## Gotchas

1. **BRAND_PREFIX_KEYS** -- all 5 keys MUST be registered in `css-injection.ts` or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and ShaderHero never reads them)
2. **For-loop dynamic bound** -- constant upper bound of 7 required for GLSL ES 3.0 compliance. Use `if (i >= u_layers) break;` pattern.
3. **`layers` as int uniform** -- use `Math.round()` in config parsing (`shader-config.ts` switch case), `gl.uniform1i()` in renderer (NOT `uniform1f`). GLSL declares `uniform int u_layers;`.
4. **No naming collisions** -- all keys namespaced as `shader-aurora-*` to avoid collision with existing `shader-speed`, `shader-scale` etc.
5. **Export pattern** -- shader string exported as `export const AURORA_FRAG = \`#version 300 es...`
6. **Post-processing chain** -- MUST follow established order: Reinhard tone map -> `min(color, 0.75)` brightness cap -> `mix(u_bgColor, color, u_intensity)` intensity blend -> vignette -> grain -> `clamp(color, 0.0, 0.75)` final cap
7. **triNoise vs smooth FBM** -- triNoise uses `abs(sin(...))` (triangle wave) not `sin(...)`, giving non-smooth crinkly variation essential for realistic aurora curtain edges. Standard smooth FBM would look too blobby.
8. **Aspect correction** -- UV and mouse coordinates must use same aspect-corrected space for mouse interaction to feel correct
9. **Additive compositing** -- curtain layers are additive (`color += layerColor * c * alpha`), NOT alpha-blended. This creates natural bright intersections.
10. **Guard division by zero** -- `max(float(u_layers - 1), 1.0)` in layer colour blend prevents NaN when layers=1
11. **Gaussian envelope symmetry** -- the `exp(-pow(...))` envelope is symmetric, so `u_height` at 0.4 means the aurora spans roughly from `0.4 - spread` to `0.4 + spread`. Shimmer is concentrated at the lower edge via `smoothstep`.
12. **Preset grid** -- adding aurora makes 16 presets (including 'none') in the 2-col grid = 8 rows, all full (even layout). If caustic is also added before aurora, this becomes 17 = 9 rows with one orphan card.

# Glow Shader Preset (Bioluminescent Deep Sea) -- Implementation Plan

## Overview

Add a "glow" shader preset: single-pass bioluminescent deep-sea organisms that pulse, bloom, and drift across a dark ocean background. Multiple depth layers create parallax. Each organism glows with a hash-selected brand colour (primary/secondary/accent). Fading light trails follow organisms. Mouse gently attracts nearby organisms; click creates a bright flash that startles them.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify -- add `GlowConfig`, union entry, `ShaderPresetId`, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/glow.frag.ts` | Create -- bioluminescent fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/glow-renderer.ts` | Create -- single-pass renderer |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify -- add `'glow'` case to loadRenderer switch |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify -- add 6 keys to BRAND_PREFIX_KEYS |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify -- preset card + derived values + sliders |

## Config Interface

```typescript
export interface GlowConfig extends ShaderConfigBase {
  preset: 'glow';
  count: number;     // 5-20, default 10 (int) -- organisms per layer
  pulse: number;     // 0.3-1.5, default 0.7 -- pulse speed
  size: number;      // 0.5-2.0, default 1.0 -- organism size
  drift: number;     // 0.05-0.30, default 0.10 -- drift speed
  trail: number;     // 0.0-1.0, default 0.4 -- trail length/opacity
  depth: number;     // 2-4, default 3 (int) -- depth layers
}
```

## Defaults

```typescript
// In DEFAULTS object in shader-config.ts
glowCount: 10,
glowPulse: 0.7,
glowSize: 1.0,
glowDrift: 0.10,
glowTrail: 0.4,
glowDepth: 3,
```

## ShaderPresetId Update

```typescript
// Add 'glow' to the union
export type ShaderPresetId = 'suture' | 'ether' | 'warp' | 'ripple' | 'pulse' | 'ink' | 'topo' | 'nebula' | 'turing' | 'silk' | 'glass' | 'film' | 'flux' | 'lava' | 'glow' | 'none';
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

All 6 keys must be registered in the `BRAND_PREFIX_KEYS` Set in `css-injection.ts`:

```
shader-glow-count
shader-glow-pulse
shader-glow-size
shader-glow-drift
shader-glow-trail
shader-glow-depth
```

## Config Switch Case (shader-config.ts)

```typescript
case 'glow':
  return {
    ...base,
    preset: 'glow',
    count: Math.round(rv('shader-glow-count', DEFAULTS.glowCount)),
    pulse: rv('shader-glow-pulse', DEFAULTS.glowPulse),
    size: rv('shader-glow-size', DEFAULTS.glowSize),
    drift: rv('shader-glow-drift', DEFAULTS.glowDrift),
    trail: rv('shader-glow-trail', DEFAULTS.glowTrail),
    depth: Math.round(rv('shader-glow-depth', DEFAULTS.glowDepth)),
  };
```

Note: `count` and `depth` are integers -- use `Math.round()`.

## Fragment Shader (glow.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `u_time` | `float` | Elapsed seconds |
| `u_resolution` | `vec2` | Canvas pixel dimensions |
| `u_mouse` | `vec2` | Normalized mouse position (0-1), lerped |
| `u_burstStrength` | `float` | Click burst intensity (decays) |
| `u_brandPrimary` | `vec3` | Brand primary colour |
| `u_brandSecondary` | `vec3` | Brand secondary colour |
| `u_brandAccent` | `vec3` | Brand accent colour |
| `u_bgColor` | `vec3` | Background colour |
| `u_count` | `int` | Organisms per layer (5-20) |
| `u_pulse` | `float` | Pulse speed |
| `u_size` | `float` | Organism size multiplier |
| `u_drift` | `float` | Drift speed |
| `u_trail` | `float` | Trail length/opacity |
| `u_depth` | `int` | Number of depth layers (2-4) |
| `u_intensity` | `float` | Overall blend with background |
| `u_grain` | `float` | Film grain amount |
| `u_vignette` | `float` | Vignette strength |

### GLSL Algorithm (Pseudocode)

```glsl
#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

// -- All uniforms listed above --

// Hash function: stable per-cell random (fract(sin(dot(...))) pattern)
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
vec2 hash2(vec2 p) {
  return vec2(hash(p), hash(p + vec2(37.0, 59.0)));
}

// Film grain hash (different seed)
float grainHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // Aspect-correct UVs
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  // Deep ocean background (very dark version of bg)
  vec3 bgDark = u_bgColor * 0.15;

  // Brand colours array for per-organism selection
  // Each organism picks one via: hash mod 3 -> primary/secondary/accent
  vec3 brandColors[3] = vec3[3](u_brandPrimary, u_brandSecondary, u_brandAccent);

  // Accumulate glow from all organisms across all layers
  vec3 glowAccum = vec3(0.0);

  for (int layer = 0; layer < 4; layer++) {
    if (layer >= u_depth) break;

    // Layer properties: deeper layers are dimmer, slower, smaller parallax
    float layerFrac = float(layer) / float(u_depth - 1);
    float layerScale = 1.0 - layerFrac * 0.3;     // near=1.0, far=0.7
    float layerBright = 1.0 - layerFrac * 0.4;     // near=1.0, far=0.6

    // Mouse parallax: nearer layers move more with mouse
    float parallaxStr = (1.0 - layerFrac) * 0.15;
    vec2 mouseOffset = (u_mouse - 0.5) * parallaxStr;

    // Effective UV for this layer
    vec2 layerUv = uv * layerScale + mouseOffset;

    // Tiled grid: organisms are placed via hash in cells
    float gridSize = float(u_count);  // cells per axis
    // Slow drift over time per layer
    float driftTime = u_time * u_drift * (0.8 + layerFrac * 0.4);

    for (int cx = -1; cx <= int(gridSize) + 1; cx++) {
      for (int cy = -1; cy <= int(gridSize) + 1; cy++) {
        vec2 cell = vec2(float(cx), float(cy));
        vec2 cellSeed = cell + vec2(float(layer) * 100.0);

        // Random base position within cell (0-1)
        vec2 basePos = hash2(cellSeed);

        // Drift: slow sinusoidal wander
        float driftPhase = hash(cellSeed + vec2(99.0)) * 6.28;
        vec2 driftOffset = vec2(
          sin(driftTime + driftPhase) * 0.3,
          cos(driftTime * 0.7 + driftPhase) * 0.3
        );

        // Organism world position
        vec2 orgPos = (cell + basePos + driftOffset) / gridSize;
        // Map to UV space: [-aspect, aspect] x [-1, 1]
        vec2 orgUv = orgPos * 2.0 - 1.0;
        orgUv.x *= u_resolution.x / u_resolution.y;

        // Distance from pixel to organism
        float dist = length(layerUv - orgUv);

        // Pulsing radius: breathing rhythm
        float pulsePhase = hash(cellSeed + vec2(42.0)) * 6.28;
        float pulseFactor = sin(u_time * u_pulse + pulsePhase) * 0.3 + 0.7;
        float radius = 0.04 * u_size * pulseFactor * layerScale;

        // Soft exponential glow body
        float glow = exp(-dist * dist / (radius * radius + 0.0001));

        // Trail: sample "past position" (offset by -velocity * trailLength)
        if (u_trail > 0.0) {
          vec2 velocity = vec2(
            cos(driftTime + driftPhase) * 0.3,
            -sin(driftTime * 0.7 + driftPhase) * 0.3 * 0.7
          ) / gridSize * 2.0;
          vec2 trailPos = orgUv - velocity * u_trail * 2.0;
          float trailDist = length(layerUv - trailPos);
          float trailRadius = radius * 1.5;
          float trailGlow = exp(-trailDist * trailDist / (trailRadius * trailRadius + 0.0001));
          glow += trailGlow * 0.3 * u_trail;
        }

        // Colour: hash-selected brand colour
        int colorIdx = int(floor(hash(cellSeed + vec2(7.0)) * 3.0));
        vec3 orgColor = brandColors[colorIdx] * layerBright;

        // Click burst: scatter organisms momentarily
        if (u_burstStrength > 0.01) {
          vec2 burstUv = (2.0 * u_mouse - 1.0);
          burstUv.x *= u_resolution.x / u_resolution.y;
          float burstDist = length(orgUv - burstUv);
          // Flash: bright white-ish glow near click point
          float flash = u_burstStrength * exp(-burstDist * burstDist * 4.0);
          orgColor += vec3(flash * 0.5);
        }

        glowAccum += orgColor * glow;
      }
    }
  }

  // Composite: dark bg + accumulated glow
  vec3 color = bgDark + glowAccum;

  // --- Post-processing (same pipeline as all presets) ---

  // Reinhard tone mapping
  color = color / (1.0 + color);

  // Cap maximum brightness (lower for dark scene so glow reads well)
  color = min(color, vec3(0.65));

  // Intensity blend with background
  color = mix(bgDark, color, u_intensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (grainHash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  // Final clamp
  fragColor = vec4(clamp(color, 0.0, 0.65), 1.0);
}
```

### Performance Note: Nested Loops

The above pseudocode uses nested loops (layers x cells). To keep this mobile-friendly:

- **Grid approach**: Rather than iterating all N*N cells, each pixel only checks its nearest 2x2 neighbourhood cells in a tiled hash grid. This reduces the inner loop from `O(count^2)` to `O(4)` per layer.
- **Actual implementation** should use: `vec2 cellId = floor(layerUv * gridSize)` then check `cellId + offsets` for `[-1,0], [0,0], [1,0], [0,-1], [0,1], [1,1], [-1,-1], [-1,1], [1,-1]` (9 neighbours max).
- With 3 layers, 9 neighbours each = 27 distance evaluations per pixel -- cheap.
- With 4 layers = 36 evaluations per pixel -- still well within budget.
- The `u_count` parameter controls grid density (how many cells), NOT the number of full-screen iterations.

**Estimated cost**: ~2-4ms desktop, ~3-6ms mobile at DPR 1.

## Renderer (glow-renderer.ts)

Single-pass, follows nebula-renderer pattern exactly:

```typescript
import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { GlowConfig, ShaderConfig } from '../shader-config';
import { GLOW_FRAG } from '../shaders/glow.frag';
import {
  createProgram,
  createQuad,
  drawQuad,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

const UNIFORM_NAMES = [
  'u_time',
  'u_resolution',
  'u_mouse',
  'u_burstStrength',
  'u_brandPrimary',
  'u_brandSecondary',
  'u_brandAccent',
  'u_bgColor',
  'u_count',       // int -- gl.uniform1i()
  'u_pulse',
  'u_size',
  'u_drift',
  'u_trail',
  'u_depth',       // int -- gl.uniform1i()
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type GlowUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  count: 10,
  pulse: 0.7,
  size: 1.0,
  drift: 0.10,
  trail: 0.4,
  depth: 3,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;
```

**Key implementation details:**

- Internal lerped mouse state: `MOUSE_LERP = 0.04` for smooth organism attraction
- `u_count` and `u_depth` are **int uniforms** -- use `gl.uniform1i()` with `Math.round()`
- `u_burstStrength` passed directly from `mouse.burstStrength` (click flash)
- `resize()` is no-op (single-pass, viewport set in render)
- `reset()` resets lerped mouse to centre `{ x: 0.5, y: 0.5 }`
- `destroy()` deletes program + quad buffer, nulls uniforms

**Lifecycle:**
```
init()   -> createProgram(gl, VERTEX_SHADER, GLOW_FRAG)
          -> getUniforms(gl, program, UNIFORM_NAMES)
          -> createQuad(gl)
render() -> lerp mouse, set all uniforms, drawQuad()
resize() -> no-op
reset()  -> lerpedMouse = { x: 0.5, y: 0.5 }
destroy()-> gl.deleteProgram, gl.deleteBuffer, null refs
```

## ShaderHero.svelte loadRenderer Case

```typescript
case 'glow': {
  const { createGlowRenderer } = await import('./renderers/glow-renderer');
  return createGlowRenderer();
}
```

## Brand Editor: BrandEditorHeroEffects.svelte

### Preset Card

Add to the `PRESETS` array:
```typescript
{ id: 'glow', label: 'Glow', description: 'Bioluminescent deep sea' },
```

### Defaults

Add to the `DEFAULTS` record:
```typescript
// Glow
'shader-glow-count': '10',
'shader-glow-pulse': '0.70',
'shader-glow-size': '1.00',
'shader-glow-drift': '0.10',
'shader-glow-trail': '0.40',
'shader-glow-depth': '3',
```

### Derived Values

```typescript
// Glow
const glowCount = $derived(readNum('shader-glow-count'));
const glowPulse = $derived(readNum('shader-glow-pulse'));
const glowSize = $derived(readNum('shader-glow-size'));
const glowDrift = $derived(readNum('shader-glow-drift'));
const glowTrail = $derived(readNum('shader-glow-trail'));
const glowDepth = $derived(readNum('shader-glow-depth'));
```

### Slider Definitions

| id | label | min | max | step | default | value format | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|-------------|----------|----------|
| `shader-glow-count` | Organisms | 5 | 20 | 1 | 10 | `String(Math.round(...))` | Sparse | Teeming |
| `shader-glow-pulse` | Pulse Speed | 0.30 | 1.50 | 0.05 | 0.70 | `.toFixed(2)` | Slow | Rapid |
| `shader-glow-size` | Organism Size | 0.50 | 2.00 | 0.10 | 1.00 | `.toFixed(2)` | Tiny | Large |
| `shader-glow-drift` | Drift Speed | 0.05 | 0.30 | 0.01 | 0.10 | `.toFixed(2)` | Still | Flowing |
| `shader-glow-trail` | Trail Length | 0.00 | 1.00 | 0.05 | 0.40 | `.toFixed(2)` | None | Long |
| `shader-glow-depth` | Depth Layers | 2 | 4 | 1 | 3 | `String(Math.round(...))` | Flat | Deep |

### Template Block

```svelte
{:else if activePreset === 'glow'}
  <section class="hero-fx__section">
    <span class="hero-fx__section-label">Bioluminescent Glow</span>
    <BrandSliderField id="shader-glow-count" label="Organisms" value={String(Math.round(glowCount))} min={5} max={20} step={1} current={glowCount} minLabel="Sparse" maxLabel="Teeming" oninput={handleSliderInput('shader-glow-count')} />
    <BrandSliderField id="shader-glow-pulse" label="Pulse Speed" value={glowPulse.toFixed(2)} min={0.30} max={1.50} step={0.05} current={glowPulse} minLabel="Slow" maxLabel="Rapid" oninput={handleSliderInput('shader-glow-pulse')} />
    <BrandSliderField id="shader-glow-size" label="Organism Size" value={glowSize.toFixed(2)} min={0.50} max={2.00} step={0.10} current={glowSize} minLabel="Tiny" maxLabel="Large" oninput={handleSliderInput('shader-glow-size')} />
    <BrandSliderField id="shader-glow-drift" label="Drift Speed" value={glowDrift.toFixed(2)} min={0.05} max={0.30} step={0.01} current={glowDrift} minLabel="Still" maxLabel="Flowing" oninput={handleSliderInput('shader-glow-drift')} />
    <BrandSliderField id="shader-glow-trail" label="Trail Length" value={glowTrail.toFixed(2)} min={0.00} max={1.00} step={0.05} current={glowTrail} minLabel="None" maxLabel="Long" oninput={handleSliderInput('shader-glow-trail')} />
    <BrandSliderField id="shader-glow-depth" label="Depth Layers" value={String(Math.round(glowDepth))} min={2} max={4} step={1} current={glowDepth} minLabel="Flat" maxLabel="Deep" oninput={handleSliderInput('shader-glow-depth')} />
  </section>
```

## Brand Colour Mapping

| Visual element | Colour source |
|----------------|---------------|
| Background | `u_bgColor * 0.15` -- very dark ocean |
| Organism body glow | Hash-selected from `[primary, secondary, accent]` via `hash mod 3` |
| Organism bloom overlap | Additive mixing where glows overlap -- creates natural colour blending |
| Trail fade | Same organism colour, attenuated by distance (fades toward background) |
| Click flash | White-ish burst (`orgColor + vec3(flash)`) near click point |
| Overall palette feel | Dark canvas with jewel-like points of brand colour |

## Gotchas

1. **BRAND_PREFIX_KEYS** -- all 6 keys (`shader-glow-count`, `shader-glow-pulse`, `shader-glow-size`, `shader-glow-drift`, `shader-glow-trail`, `shader-glow-depth`) MUST be registered in `css-injection.ts`. Without this, `getShaderConfig()` cannot read the values via `getComputedStyle` because they will be injected with `--color-` prefix instead of `--brand-`.

2. **Two int uniforms** -- `u_count` and `u_depth` both need `gl.uniform1i()` with `Math.round()` in the renderer AND `Math.round()` in the config parser. Float uniforms sent to int uniforms in GLSL cause silent failures.

3. **`u_burstStrength`** -- already wired in ShaderHero.svelte's MouseState. Just pass `mouse.burstStrength` to the uniform. ShaderHero decays it at `*= 0.85` per frame.

4. **Grid loop performance** -- the fragment shader must NOT loop over all `count*count` organisms globally. Use a tiled hash grid: `floor(uv * gridSize)` and check 9 neighbour cells. This keeps the loop count constant regardless of `u_count`.

5. **Mouse Y direction** -- bottom-to-top (0=bottom, 1=top) per `renderer-types.ts`, matching `gl_FragCoord.y`. The lerped mouse in the renderer already handles this.

6. **Brightness cap** -- use `0.65` (lower than nebula's `0.7`) because glow organisms on a very dark background need the highlights to not clip. Final clamp should also use `0.65`.

7. **`v_uv` vs `gl_FragCoord`** -- use `gl_FragCoord` for aspect-correct main UVs, `v_uv` only for post-processing (vignette) -- same as nebula convention.

8. **Preset grid layout** -- this is the 16th preset card (including "none"). 2-column grid: 16 cards = 8 rows. Even, so no orphan card.

9. **Hash function stability** -- use `fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453)` for cell hashing (stable across frames). Use a different hash for film grain to avoid correlation.

10. **Trail requires velocity** -- the trail is computed by sampling the organism's "past position" (offset from current by `-velocity * trailLength`). Velocity is the derivative of the drift sinusoidal motion.

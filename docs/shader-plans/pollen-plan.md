# Pollen Shader Preset (Floating Organic Spore Drift) -- Implementation Plan

## Overview

Add a "pollen" shader preset: delicate, softly glowing organic particles -- like pollen grains, spores, or dandelion seeds -- drifting in a gentle breeze. Each particle has procedural internal structure (radial fibres, translucent membranes) via polar-coordinate SDF modulation. Multiple depth layers create parallax and depth-of-field bokeh blur. Slow curl-noise drift displaces positions over time. Mouse gently blows particles away like breath parting a curtain.

Distinctly different from "glow" (bioluminescent point-like organisms with trails) because pollen particles have **visible organic structure** (radial symmetry, fibre arms) and **depth-of-field blur** (near particles sharp, far particles soft bokeh discs).

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify -- add `PollenConfig`, union entry, `ShaderPresetId`, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/pollen.frag.ts` | Create -- organic spore fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/pollen-renderer.ts` | Create -- single-pass renderer |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify -- add `'pollen'` case to loadRenderer switch |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify -- add 6 keys to BRAND_PREFIX_KEYS |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify -- preset card + defaults + derived values + sliders |

## Config Interface

```typescript
export interface PollenConfig extends ShaderConfigBase {
  preset: 'pollen';
  density: number;   // 0.3-1.0, default 0.6 -- particle density per layer
  size: number;      // 0.5-2.0, default 1.0 -- base particle size
  fibres: number;    // 3-8, default 5 (int) -- radial fibre count per spore
  drift: number;     // 0.05-0.25, default 0.10 -- drift speed
  depth: number;     // 2-4, default 3 (int) -- depth layers
  bokeh: number;     // 0.3-1.0, default 0.5 -- background layer blur amount
}
```

## Defaults

```typescript
// In DEFAULTS object in shader-config.ts
pollenDensity: 0.6,
pollenSize: 1.0,
pollenFibres: 5,
pollenDrift: 0.10,
pollenDepth: 3,
pollenBokeh: 0.5,
```

## ShaderPresetId Update

```typescript
// Add 'pollen' to the union
export type ShaderPresetId = 'suture' | 'ether' | 'warp' | 'ripple' | 'pulse' | 'ink' | 'topo' | 'nebula' | 'turing' | 'silk' | 'glass' | 'film' | 'flux' | 'lava' | 'pollen' | 'none';
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

All 6 keys must be registered in the `BRAND_PREFIX_KEYS` Set in `css-injection.ts`:

```
shader-pollen-density
shader-pollen-size
shader-pollen-fibres
shader-pollen-drift
shader-pollen-depth
shader-pollen-bokeh
```

## Config Switch Case (shader-config.ts)

```typescript
case 'pollen':
  return {
    ...base,
    preset: 'pollen',
    density: rv('shader-pollen-density', DEFAULTS.pollenDensity),
    size: rv('shader-pollen-size', DEFAULTS.pollenSize),
    fibres: Math.round(rv('shader-pollen-fibres', DEFAULTS.pollenFibres)),
    drift: rv('shader-pollen-drift', DEFAULTS.pollenDrift),
    depth: Math.round(rv('shader-pollen-depth', DEFAULTS.pollenDepth)),
    bokeh: rv('shader-pollen-bokeh', DEFAULTS.pollenBokeh),
  };
```

Note: `fibres` and `depth` are integers -- use `Math.round()`.

## Fragment Shader (pollen.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `u_time` | `float` | Elapsed seconds |
| `u_resolution` | `vec2` | Canvas pixel dimensions |
| `u_mouse` | `vec2` | Normalized mouse position (0-1), lerped |
| `u_burstStrength` | `float` | Click burst intensity (decays) |
| `u_brandPrimary` | `vec3` | Brand primary colour -- spore core |
| `u_brandSecondary` | `vec3` | Brand secondary colour -- fibres/membrane |
| `u_brandAccent` | `vec3` | Brand accent colour -- bokeh highlights |
| `u_bgColor` | `vec3` | Background colour |
| `u_density` | `float` | Particle density per layer (0.3-1.0) |
| `u_size` | `float` | Base particle size multiplier (0.5-2.0) |
| `u_fibres` | `int` | Radial fibre count per spore (3-8) |
| `u_drift` | `float` | Drift speed (0.05-0.25) |
| `u_depth` | `int` | Number of depth layers (2-4) |
| `u_bokeh` | `float` | Background layer blur amount (0.3-1.0) |
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

// ---- Hash functions ----

// Stable per-cell random
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash2(vec2 p) {
  return vec2(hash(p), hash(p + vec2(37.0, 59.0)));
}

// Film grain hash (different seed)
float grainHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.2031);
  p3 += dot(p3, p3.yzx + 43.33);
  return fract((p3.x + p3.y) * p3.z);
}

// ---- Curl noise for drift displacement ----

// Simple 2D noise for curl computation
float noise2d(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f); // smoothstep
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Curl noise: returns 2D displacement from scalar noise field
vec2 curlNoise(vec2 p) {
  float eps = 0.01;
  float n  = noise2d(p);
  float nx = noise2d(p + vec2(eps, 0.0));
  float ny = noise2d(p + vec2(0.0, eps));
  // Curl: perpendicular gradient
  return vec2((ny - n) / eps, -(nx - n) / eps);
}

// ---- Spore SDF: radial fibres via polar modulation ----

// Returns alpha for a single spore particle.
// p: offset from spore centre (in local UV space)
// baseRadius: base radius of the spore
// fibreCount: number of radial fibres
// fibreAmp: amplitude of fibre modulation
// fibreSeed: per-spore random offset for fibre rotation
// bokehFactor: 0=sharp (near), 1=full bokeh (far)
float sporeSDF(vec2 p, float baseRadius, int fibreCount, float fibreAmp,
               float fibreSeed, float bokehFactor) {
  float dist = length(p);
  float angle = atan(p.y, p.x);

  // Modulated radius: core circle + radial fibre arms
  float fibreR = baseRadius + fibreAmp * sin(angle * float(fibreCount) + fibreSeed);

  // Sharp spore: structured falloff with visible fibre edges
  float sharpAlpha = smoothstep(fibreR, fibreR * 0.4, dist);

  // Add inner core glow (brighter centre)
  float coreGlow = exp(-dist * dist / (baseRadius * baseRadius * 0.15 + 0.0001));

  // Sharp result: structured spore with core
  float sharp = sharpAlpha * 0.6 + coreGlow * 0.4;

  // Bokeh: soft Gaussian disc (no structure visible)
  float bokehRadius = baseRadius * (1.0 + bokehFactor * 1.5);
  float bokehAlpha = exp(-dist * dist / (bokehRadius * bokehRadius + 0.0001));

  // Blend between sharp and bokeh based on depth
  return mix(sharp, bokehAlpha, bokehFactor);
}

void main() {
  float t = u_time * u_drift;

  // --- Aspect-correct UVs ---
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;
  float aspect = u_resolution.x / u_resolution.y;

  // --- Background: subtle depth gradient ---
  vec3 bgTop = u_bgColor * 0.4;
  vec3 bgBot = u_bgColor * 0.25;
  vec3 bgGrad = mix(bgBot, bgTop, v_uv.y);

  // --- Mouse avoidance position (in aspect-correct UV space) ---
  vec2 mouseUv = (2.0 * u_mouse - 1.0);
  mouseUv.x *= aspect;

  // --- Accumulate particle contributions across all layers ---
  vec3 colorAccum = vec3(0.0);
  float alphaAccum = 0.0;

  for (int layer = 0; layer < 4; layer++) {
    if (layer >= u_depth) break;

    // Depth fraction: 0=nearest (sharpest), 1=furthest (most bokeh)
    float depthFrac = float(layer) / max(float(u_depth - 1), 1.0);

    // Layer properties
    float layerScale = 1.0 - depthFrac * 0.25;       // near=1.0, far=0.75
    float layerBright = 1.0 - depthFrac * 0.35;       // near=1.0, far=0.65
    float bokehFactor = depthFrac * u_bokeh;           // 0 near, u_bokeh far
    float layerDriftSpeed = 0.8 + depthFrac * 0.4;    // far layers drift slightly faster (parallax)

    // Mouse parallax: nearer layers displaced more
    float parallaxStr = (1.0 - depthFrac) * 0.12;
    vec2 mouseParallax = (u_mouse - 0.5) * parallaxStr;

    // Grid density based on u_density and layer
    float gridSize = floor(6.0 + u_density * 8.0);    // 6-14 cells per axis
    float driftTime = u_time * u_drift * layerDriftSpeed;

    // Effective UV for this layer
    vec2 layerUv = uv * layerScale + mouseParallax;

    // Tiled hash grid: find which cell this pixel is in
    vec2 cellId = floor(layerUv * gridSize * 0.5 + 0.5);

    // Check 3x3 neighbourhood of cells (9 checks per layer)
    for (int dx = -1; dx <= 1; dx++) {
      for (int dy = -1; dy <= 1; dy++) {
        vec2 cell = cellId + vec2(float(dx), float(dy));
        vec2 cellSeed = cell + vec2(float(layer) * 137.0);

        // Skip cell probabilistically based on density (hash threshold)
        float cellPresence = hash(cellSeed + vec2(99.0, 77.0));
        if (cellPresence > u_density) continue;

        // Random base position within cell (0-1)
        vec2 basePos = hash2(cellSeed);

        // Curl noise drift displacement
        vec2 curlOffset = curlNoise(cell * 0.3 + driftTime * 0.5) * 0.4;

        // Sinusoidal gentle wander on top of curl
        float wanderPhase = hash(cellSeed + vec2(42.0)) * 6.2831;
        vec2 wander = vec2(
          sin(driftTime * 0.7 + wanderPhase) * 0.15,
          cos(driftTime * 0.5 + wanderPhase * 1.3) * 0.15
        );

        // Spore world position in layer UV space
        vec2 sporePos = (cell + basePos + curlOffset + wander) / (gridSize * 0.5);

        // Mouse avoidance: push particles away from cursor
        vec2 toMouse = sporePos - mouseUv / layerScale;
        float mouseDist = length(toMouse);
        float avoidRadius = 0.35;
        float avoidStrength = smoothstep(avoidRadius, 0.0, mouseDist) * 0.15 * (1.0 - depthFrac * 0.5);
        vec2 avoidOffset = normalize(toMouse + vec2(0.001)) * avoidStrength;
        sporePos += avoidOffset;

        // Click burst: stronger push away
        if (u_burstStrength > 0.01) {
          float burstPush = u_burstStrength * smoothstep(0.5, 0.0, mouseDist) * 0.3;
          sporePos += normalize(toMouse + vec2(0.001)) * burstPush;
        }

        // Distance from pixel to spore centre
        vec2 delta = layerUv - sporePos;
        float dist = length(delta);

        // Early out: skip if too far (performance)
        float maxRadius = 0.12 * u_size * (1.0 + bokehFactor * 1.5);
        if (dist > maxRadius * 2.5) continue;

        // Spore rendering parameters
        float baseRadius = 0.04 * u_size * layerScale;
        float fibreAmp = baseRadius * 0.35;
        float fibreSeed = hash(cellSeed + vec2(13.0, 7.0)) * 6.2831;

        // Compute spore alpha via SDF
        float sporeAlpha = sporeSDF(delta, baseRadius, u_fibres, fibreAmp,
                                     fibreSeed, bokehFactor);

        // Colour by depth layer:
        // Near=primary (core), mid=secondary (fibres), far=accent (bokeh)
        vec3 sporeColor;
        if (depthFrac < 0.4) {
          // Near: primary core + secondary fibre tint
          float fibreMix = smoothstep(baseRadius * 0.5, baseRadius, dist);
          sporeColor = mix(u_brandPrimary, u_brandSecondary, fibreMix * 0.6);
        } else if (depthFrac < 0.7) {
          // Mid: secondary dominant with slight primary
          sporeColor = mix(u_brandSecondary, u_brandPrimary, 0.2);
        } else {
          // Far: accent-tinted bokeh highlights
          sporeColor = mix(u_brandSecondary, u_brandAccent, 0.5);
        }

        // Slight colour temperature shift per layer (warmer far, cooler near)
        sporeColor *= vec3(1.0 - depthFrac * 0.05, 1.0, 1.0 + depthFrac * 0.08);

        // Apply brightness falloff
        sporeColor *= layerBright;

        // Additive blending between layers (semi-transparent particles)
        colorAccum += sporeColor * sporeAlpha * 0.7;
        alphaAccum += sporeAlpha * 0.3;
      }
    }
  }

  // --- Click burst: bright flash at cursor position ---
  if (u_burstStrength > 0.01) {
    float burstDist = length(uv - mouseUv);
    float burst = u_burstStrength * exp(-burstDist * burstDist * 6.0);
    colorAccum += mix(u_brandAccent, vec3(1.0), 0.5) * burst * 1.5;
  }

  // --- Composite: background gradient + accumulated particles ---
  vec3 color = bgGrad + colorAccum;

  // --- Post-processing (same pipeline as all presets) ---

  // Reinhard tone mapping
  color = color / (1.0 + color);

  // Cap maximum brightness
  color = min(color, vec3(0.7));

  // Intensity blend with background
  color = mix(bgGrad, color, u_intensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (grainHash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  // Final clamp
  fragColor = vec4(clamp(color, 0.0, 0.7), 1.0);
}
```

### Key Shader Techniques

**Spore SDF with radial fibres:**
The organic shape is created by modulating a circle SDF in polar coordinates. The radius becomes `r = baseRadius + fibreAmp * sin(angle * fibreCount + seed)`, producing a flower/spore silhouette with N arms. The `fibreCount` uniform (int) controls how many arms appear. The `seed` per-spore hash rotates the arms randomly so each spore looks different.

**Depth-of-field bokeh:**
Near-layer particles use the structured SDF (sharp edges, visible fibres). Far-layer particles use a soft Gaussian disc (bokeh). The `bokehFactor` (0=near, u_bokeh=far) blends between the two via `mix(sharp, bokehAlpha, bokehFactor)`. This creates a natural depth-of-field effect without any FBO/blur pass.

**Curl noise drift:**
Particle positions are offset by a 2D curl noise field that evolves slowly over time. Curl noise produces divergence-free flow -- particles follow swirling paths that never converge or diverge, giving a natural "breeze" feel. A sinusoidal wander is added on top for gentle bobbing.

**Mouse avoidance ("breath"):**
Each particle checks its distance to the cursor. Within an avoidance radius, particles are pushed away from the cursor proportional to proximity. The push strength is stronger for near layers (they're "closer to the viewer's breath"). Particles naturally return as they drift back into position. Click creates a stronger burst push.

### Performance Note: Tiled Hash Grid

Same optimisation as the glow preset. Each pixel only checks its nearest 3x3 neighbourhood cells in a tiled hash grid, NOT all particles globally.

- Grid density controlled by `u_density`: 6-14 cells per axis
- Probabilistic cell skip: `hash(cell) > u_density` -- sparser at low density
- Per pixel: 3 layers x 9 cells = 27 SDF evaluations max (with early-out distance check)
- At 4 layers: 36 evaluations max
- The `sporeSDF` function is slightly more expensive than glow's simple Gaussian due to the `atan()` + `sin()` for fibre modulation, but still well within budget

**Estimated cost**: ~3-5ms desktop, ~4-8ms mobile at DPR 1.

## Renderer (pollen-renderer.ts)

Single-pass, follows nebula-renderer pattern exactly:

```typescript
import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { PollenConfig, ShaderConfig } from '../shader-config';
import { POLLEN_FRAG } from '../shaders/pollen.frag';
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
  'u_density',
  'u_size',
  'u_fibres',      // int -- gl.uniform1i()
  'u_drift',
  'u_depth',       // int -- gl.uniform1i()
  'u_bokeh',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type PollenUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  density: 0.6,
  size: 1.0,
  fibres: 5,
  drift: 0.10,
  depth: 3,
  bokeh: 0.5,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;
```

**Key implementation details:**

- Internal lerped mouse state: `MOUSE_LERP = 0.04` for smooth breath avoidance
- `u_fibres` and `u_depth` are **int uniforms** -- use `gl.uniform1i()` with `Math.round()`
- All other preset-specific uniforms (`u_density`, `u_size`, `u_drift`, `u_bokeh`) use `gl.uniform1f()`
- `u_burstStrength` passed directly from `mouse.burstStrength` (click push)
- `resize()` is no-op (single-pass, viewport set in render)
- `reset()` resets lerped mouse to centre `{ x: 0.5, y: 0.5 }`
- `destroy()` deletes program + quad buffer, nulls uniforms

**Lifecycle:**
```
init()   -> createProgram(gl, VERTEX_SHADER, POLLEN_FRAG)
          -> getUniforms(gl, program, UNIFORM_NAMES)
          -> createQuad(gl)
render() -> lerp mouse, set all uniforms, drawQuad()
resize() -> no-op
reset()  -> lerpedMouse = { x: 0.5, y: 0.5 }
destroy()-> gl.deleteProgram, gl.deleteBuffer, null refs
```

**Uniform upload order in render():**
```typescript
// Time + resolution
gl.uniform1f(uniforms.u_time, time);
gl.uniform2f(uniforms.u_resolution, width, height);
gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);
gl.uniform1f(uniforms.u_burstStrength, mouse.burstStrength);

// Brand colors
gl.uniform3fv(uniforms.u_brandPrimary, cfg.colors.primary);
gl.uniform3fv(uniforms.u_brandSecondary, cfg.colors.secondary);
gl.uniform3fv(uniforms.u_brandAccent, cfg.colors.accent);
gl.uniform3fv(uniforms.u_bgColor, cfg.colors.bg);

// Preset-specific (NOTE: fibres and depth are INT uniforms)
gl.uniform1f(uniforms.u_density, cfg.density ?? DEFAULTS.density);
gl.uniform1f(uniforms.u_size, cfg.size ?? DEFAULTS.size);
gl.uniform1i(uniforms.u_fibres, Math.round(cfg.fibres ?? DEFAULTS.fibres));   // INT!
gl.uniform1f(uniforms.u_drift, cfg.drift ?? DEFAULTS.drift);
gl.uniform1i(uniforms.u_depth, Math.round(cfg.depth ?? DEFAULTS.depth));       // INT!
gl.uniform1f(uniforms.u_bokeh, cfg.bokeh ?? DEFAULTS.bokeh);

// Post-processing
gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
gl.uniform1f(uniforms.u_vignette, cfg.vignette ?? DEFAULTS.vignette);
```

## ShaderHero.svelte loadRenderer Case

```typescript
case 'pollen': {
  const { createPollenRenderer } = await import('./renderers/pollen-renderer');
  return createPollenRenderer();
}
```

## Brand Editor: BrandEditorHeroEffects.svelte

### Preset Card

Add to the `PRESETS` array:
```typescript
{ id: 'pollen', label: 'Pollen', description: 'Floating organic spore drift' },
```

### Defaults

Add to the `DEFAULTS` record:
```typescript
// Pollen
'shader-pollen-density': '0.60',
'shader-pollen-size': '1.00',
'shader-pollen-fibres': '5',
'shader-pollen-drift': '0.10',
'shader-pollen-depth': '3',
'shader-pollen-bokeh': '0.50',
```

### Derived Values

```typescript
// Pollen
const pollenDensity = $derived(readNum('shader-pollen-density'));
const pollenSize = $derived(readNum('shader-pollen-size'));
const pollenFibres = $derived(readNum('shader-pollen-fibres'));
const pollenDrift = $derived(readNum('shader-pollen-drift'));
const pollenDepth = $derived(readNum('shader-pollen-depth'));
const pollenBokeh = $derived(readNum('shader-pollen-bokeh'));
```

### Slider Definitions

| id | label | min | max | step | default | value format | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|-------------|----------|----------|
| `shader-pollen-density` | Density | 0.30 | 1.00 | 0.05 | 0.60 | `.toFixed(2)` | Sparse | Dense |
| `shader-pollen-size` | Particle Size | 0.50 | 2.00 | 0.10 | 1.00 | `.toFixed(2)` | Tiny | Large |
| `shader-pollen-fibres` | Fibre Count | 3 | 8 | 1 | 5 | `String(Math.round(...))` | Simple | Complex |
| `shader-pollen-drift` | Drift Speed | 0.05 | 0.25 | 0.01 | 0.10 | `.toFixed(2)` | Still | Breezy |
| `shader-pollen-depth` | Depth Layers | 2 | 4 | 1 | 3 | `String(Math.round(...))` | Flat | Deep |
| `shader-pollen-bokeh` | Bokeh Blur | 0.30 | 1.00 | 0.05 | 0.50 | `.toFixed(2)` | Sharp | Soft |

### Template Block

```svelte
{:else if activePreset === 'pollen'}
  <section class="hero-fx__section">
    <span class="hero-fx__section-label">Pollen Drift</span>
    <BrandSliderField id="shader-pollen-density" label="Density" value={pollenDensity.toFixed(2)} min={0.30} max={1.00} step={0.05} current={pollenDensity} minLabel="Sparse" maxLabel="Dense" oninput={handleSliderInput('shader-pollen-density')} />
    <BrandSliderField id="shader-pollen-size" label="Particle Size" value={pollenSize.toFixed(2)} min={0.50} max={2.00} step={0.10} current={pollenSize} minLabel="Tiny" maxLabel="Large" oninput={handleSliderInput('shader-pollen-size')} />
    <BrandSliderField id="shader-pollen-fibres" label="Fibre Count" value={String(Math.round(pollenFibres))} min={3} max={8} step={1} current={pollenFibres} minLabel="Simple" maxLabel="Complex" oninput={handleSliderInput('shader-pollen-fibres')} />
    <BrandSliderField id="shader-pollen-drift" label="Drift Speed" value={pollenDrift.toFixed(2)} min={0.05} max={0.25} step={0.01} current={pollenDrift} minLabel="Still" maxLabel="Breezy" oninput={handleSliderInput('shader-pollen-drift')} />
    <BrandSliderField id="shader-pollen-depth" label="Depth Layers" value={String(Math.round(pollenDepth))} min={2} max={4} step={1} current={pollenDepth} minLabel="Flat" maxLabel="Deep" oninput={handleSliderInput('shader-pollen-depth')} />
    <BrandSliderField id="shader-pollen-bokeh" label="Bokeh Blur" value={pollenBokeh.toFixed(2)} min={0.30} max={1.00} step={0.05} current={pollenBokeh} minLabel="Sharp" maxLabel="Soft" oninput={handleSliderInput('shader-pollen-bokeh')} />
  </section>
```

## Brand Colour Mapping

| Visual element | Colour source |
|----------------|---------------|
| Background | `u_bgColor * 0.25-0.4` -- subtle depth gradient (darker bottom, lighter top) |
| Spore core | `u_brandPrimary` -- bright centre glow of near particles |
| Spore fibres/membrane | `u_brandSecondary` -- radial arms, semi-transparent |
| Bokeh highlights (far) | `u_brandAccent` blended with secondary -- soft out-of-focus discs |
| Mid-layer particles | `u_brandSecondary` dominant with slight primary tint |
| Colour temperature shift | Cooler (bluer) near, warmer (redder) far -- via per-layer RGB multiplier |
| Click burst flash | `u_brandAccent` mixed toward white -- bright push effect |
| Additive overlap | Where particles overlap, colours blend additively (natural glow mixing) |

## Gotchas

1. **BRAND_PREFIX_KEYS** -- all 6 keys (`shader-pollen-density`, `shader-pollen-size`, `shader-pollen-fibres`, `shader-pollen-drift`, `shader-pollen-depth`, `shader-pollen-bokeh`) MUST be registered in `css-injection.ts`. Without this, `getShaderConfig()` cannot read the values via `getComputedStyle` because they will be injected with `--color-` prefix instead of `--brand-`.

2. **Two int uniforms** -- `u_fibres` and `u_depth` both need `gl.uniform1i()` with `Math.round()` in the renderer AND `Math.round()` in the config parser (`shader-config.ts`). Float uniforms sent to int uniforms in GLSL cause silent failures (uniform value stays 0).

3. **`u_burstStrength`** -- already wired in ShaderHero.svelte's MouseState. Just pass `mouse.burstStrength` to the uniform. ShaderHero decays it at `*= 0.85` per frame.

4. **Grid loop performance** -- the fragment shader must NOT loop over all cells globally. Use a tiled hash grid: `floor(layerUv * gridSize * 0.5)` and check 3x3 neighbour cells. This keeps the loop count constant (9 per layer) regardless of `u_density`. The `u_density` parameter controls cell presence probability (hash threshold), NOT the number of iterations.

5. **`atan()` cost** -- the spore SDF uses `atan(p.y, p.x)` for polar angle computation. This is slightly more expensive than a simple `length()` but still cheap per evaluation. The early-out distance check (`if dist > maxRadius * 2.5 continue`) prevents calling `atan()` on distant particles.

6. **Mouse Y direction** -- bottom-to-top (0=bottom, 1=top) per `renderer-types.ts`, matching `gl_FragCoord.y`. The lerped mouse in the renderer already handles this.

7. **Brightness cap** -- use `0.7` (same as nebula) because the additive blending of multiple spores can accumulate brightness. Final clamp should also use `0.7`.

8. **`v_uv` vs `gl_FragCoord`** -- use `gl_FragCoord` for aspect-correct main UVs, `v_uv` only for post-processing (vignette, background gradient) -- same as nebula convention.

9. **Preset grid layout** -- this will be the 16th or 17th preset card (depending on whether glow has been implemented). The 2-column grid handles any count. If glow is already present, this is card 17 = 9 rows with one orphan. Consider adding another preset to pair it, or the grid handles orphans gracefully.

10. **Distinct from "glow"** -- glow uses point-like Gaussian organisms with trails. Pollen uses structured polar SDFs with visible fibre arms and depth-of-field bokeh. If both are present, users see clearly different aesthetics: glow = dark ocean with jewel points, pollen = airy atmosphere with structured snowflake-like particles.

11. **Curl noise divergence-free** -- the curl noise implementation computes the curl (perpendicular gradient) of a scalar noise field. This ensures particles flow in swirling paths that never converge to a point or diverge from one, producing natural-looking breeze behaviour.

12. **Additive blending** -- particles use additive colour accumulation (`colorAccum +=`), not alpha compositing. This means overlapping particles create brighter regions naturally, which is correct for glowing translucent objects. The Reinhard tone map prevents blowout.

13. **Mouse avoidance vs attraction** -- unlike glow (which attracts organisms toward cursor), pollen PUSHES particles AWAY from cursor. The "parting the curtain" / "blown by breath" metaphor requires avoidance, not attraction. The avoidance strength is modulated by depth (near particles pushed more) for parallax realism.

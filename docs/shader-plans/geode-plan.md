# Geode (Agate Cross-Section) Shader Preset — Implementation Plan

## Overview

Add a "geode" shader preset: concentric irregular rings of colour like a sliced geode or agate stone. Layers of mineral bands with noisy, organic boundaries. Centre cavity contains crystalline Voronoi facets with specular highlights. Slow rotation reveals depth. Single-pass (no FBO). Deeply satisfying layered composition that maps perfectly to brand colour palettes.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify — add `GeodeConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/geode.frag.ts` | Create — single-pass fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/geode-renderer.ts` | Create — single-pass renderer |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify — add `'geode'` to loadRenderer switch |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify — add 5 keys to BRAND_PREFIX_KEYS |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify — preset card + sliders + defaults + derived state |

## Config Interface

```typescript
export interface GeodeConfig extends ShaderConfigBase {
  preset: 'geode';
  bands: number;       // 4-12, default 8 (int) — Number of mineral bands
  warp: number;        // 0.3-1.5, default 0.8 — Band irregularity (domain warp strength)
  cavity: number;      // 0.1-0.4, default 0.2 — Crystal cavity size (inner radius fraction)
  speed: number;       // 0.03-0.15, default 0.06 — Rotation/evolution speed
  sparkle: number;     // 0.3-1.5, default 0.8 — Crystal specular intensity
}
```

## Defaults

```typescript
// Geode
geodeBands: 8,
geodeWarp: 0.8,
geodeCavity: 0.2,
geodeSpeed: 0.06,
geodeSparkle: 0.8,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

These 5 keys MUST be added to the `BRAND_PREFIX_KEYS` set in `css-injection.ts`:

```
shader-geode-bands
shader-geode-warp
shader-geode-cavity
shader-geode-speed
shader-geode-sparkle
```

Without these entries, the brand editor sliders will silently fail — values get `--color-` prefix instead of `--brand-` prefix and `getShaderConfig()` never reads them.

## Fragment Shader (geode.frag.ts)

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
| `u_bands` | `int` | Number of mineral bands |
| `u_warp` | `float` | Domain warp strength |
| `u_cavity` | `float` | Crystal cavity inner radius fraction |
| `u_speed` | `float` | Rotation/evolution speed |
| `u_sparkle` | `float` | Crystal specular intensity |
| `u_intensity` | `float` | Overall blend |
| `u_grain` | `float` | Film grain |
| `u_vignette` | `float` | Vignette strength |

### Algorithm

1. **Aspect-corrected centring**: Map fragment UV to aspect-corrected coordinates centred at (0, 0). This makes the geode formation roughly circular, centred on the canvas.

2. **Distance field with FBM domain warping**: Compute the distance from centre. Before quantising into bands, warp the coordinates using multi-octave FBM noise (2-3 octaves, sin-based, with inter-octave rotation matching the topo pattern). The warp displaces the position used for the distance calculation, creating irregular, organic band boundaries instead of perfect circles. Warp strength controlled by `u_warp`.

3. **Slow rotation**: Rotate the coordinate space by `u_time * u_speed`, so the entire cross-section slowly turns — revealing different angles of the warped boundaries. This creates a sense of depth, as if the viewer is rotating the stone specimen.

4. **Band quantisation via smoothstepped thresholds**: Divide the warped distance (0 to ~1) into `u_bands` discrete bands using `floor(warpedDist * float(u_bands))`. Use `smoothstep` at band boundaries (with a narrow transition width) to create soft anti-aliased edges between bands. Each band index maps to a colour from the brand palette.

5. **Band colour cycling**: Cycle through brand colours per band:
   - Outermost bands (high index) = `u_bgColor` — the rough exterior stone
   - Major interior bands = `u_brandPrimary` — dominant mineral colour
   - Minor interior bands = `u_brandSecondary` — secondary mineral veining
   - Near-cavity bands = mix of primary/accent — transition zone
   - The colour assignment uses `mod(bandIndex, 4)` to cycle: bg, primary, secondary, primary, bg, primary, secondary... with the accent reserved for cavity highlights. Adjacent bands should have slightly different luminance to read as distinct layers.

6. **Crystal cavity (Voronoi facets)**: When `warpedDist < u_cavity`, switch to a Voronoi pattern. Use a simple 2D Voronoi (9-cell search with hash-based cell centres, time-animated so facets slowly shift). Each Voronoi cell gets a slightly different colour derived from `u_brandAccent` (vary hue/brightness per cell ID using a hash). Cell edges are highlighted with a bright line (the "crack" between crystals).

7. **Specular highlights on crystals**: For each Voronoi cell, compute a pseudo-normal from the cell's gradient (distance-to-edge direction). Use a light direction derived from the mouse position (`u_mouse`). Compute `max(dot(normal, lightDir), 0.0)^16` for a tight specular highlight. Scale by `u_sparkle`. This makes the crystals glint as the user moves the mouse — the "light source" shifts.

8. **Mouse interaction**:
   - **Hover**: Mouse position shifts the specular light source direction for the crystal cavity. The `u_mouse` XY directly maps to a light vector `normalize(vec3(mouse.x - 0.5, mouse.y - 0.5, 0.5))`.
   - **Click (burst)**: Triggers a slow rotation impulse. Apply `u_burst * 0.5` to the rotation angle, so clicking "turns" the cross-section. The burst decays naturally via the existing `burstStrength *= 0.85` in ShaderHero.svelte.

9. **Post-processing chain** (MUST follow this order — matches all other presets):
   - Reinhard tone map: `color = color / (1.0 + color)`
   - Brightness cap: `color = min(color, vec3(0.75))`
   - Intensity mix: `color = mix(u_bgColor, color, u_intensity)`
   - Vignette: `color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0)`
   - Film grain: `color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain`
   - Final clamp: `fragColor = vec4(clamp(color, 0.0, 0.75), 1.0)`

### Key GLSL Functions

```glsl
// -- Hash for grain + Voronoi cell IDs --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zx);
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

// -- Voronoi (9-cell, returns (dist-to-edge, cell-id-hash)) --
vec2 voronoi(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float minDist = 8.0;
  float minDist2 = 8.0;
  float cellId = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash2(n + g);
      o = 0.5 + 0.4 * sin(u_time * u_speed * 0.5 + 6.2831 * o); // animate
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < minDist) {
        minDist2 = minDist;
        minDist = d;
        cellId = hash(n + g);
      } else if (d < minDist2) {
        minDist2 = d;
      }
    }
  }
  float edge = minDist2 - minDist; // distance to nearest edge
  return vec2(edge, cellId);
}
```

### GLSL Pseudocode (main)

```glsl
void main() {
  float t = u_time * u_speed;
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;

  // Centre and aspect-correct
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

  // Slow rotation (+ burst rotation impulse)
  float angle = t * 0.5 + u_burst * 0.5;
  float ca = cos(angle), sa = sin(angle);
  p = mat2(ca, sa, -sa, ca) * p;

  // Distance from centre
  float rawDist = length(p);

  // Domain warp the distance field
  vec2 warpedP = p + u_warp * 0.3 * vec2(fbm(p * 3.0 + t * 0.2), fbm(p * 3.0 + 100.0 + t * 0.15));
  float dist = length(warpedP);

  // Normalise to 0..1 range (clamp at radius ~0.8)
  float normDist = clamp(dist / 0.8, 0.0, 1.0);

  if (normDist < u_cavity) {
    // ── Crystal cavity ──
    vec2 vor = voronoi(warpedP * 12.0);
    float edge = vor.x;
    float id = vor.y;

    // Base crystal colour: accent with per-cell variation
    vec3 crystalCol = u_brandAccent * (0.7 + 0.6 * id);

    // Crystal edge highlight (bright crack lines)
    float edgeLine = 1.0 - smoothstep(0.0, 0.08, edge);
    crystalCol = mix(crystalCol, vec3(1.0), edgeLine * 0.4);

    // Specular from mouse light source
    vec3 lightDir = normalize(vec3(u_mouse.x - 0.5, u_mouse.y - 0.5, 0.5));
    // Pseudo-normal from local gradient (edge direction)
    vec3 normal = normalize(vec3(
      dFdx(edge) * 10.0,
      dFdy(edge) * 10.0,
      1.0
    ));
    float spec = pow(max(dot(normal, lightDir), 0.0), 16.0) * u_sparkle;
    crystalCol += spec * u_mouseActive;

    color = crystalCol;
  } else {
    // ── Mineral bands ──
    float bandF = normDist * float(u_bands);
    float bandIdx = floor(bandF);
    float bandFrac = fract(bandF);

    // Smooth anti-aliased band edges
    float fw = fwidth(bandF);
    float edge = smoothstep(0.5 - fw, 0.5 + fw, bandFrac);

    // Colour cycling: bg(0), primary(1), secondary(2), primary(3), repeat
    int idx = int(mod(bandIdx, 4.0));
    vec3 bandColor;
    if (idx == 0) bandColor = u_bgColor * 1.3;
    else if (idx == 1) bandColor = u_brandPrimary;
    else if (idx == 2) bandColor = u_brandSecondary;
    else bandColor = u_brandPrimary * 0.8;

    // Next band colour for smooth transition
    int nextIdx = int(mod(bandIdx + 1.0, 4.0));
    vec3 nextColor;
    if (nextIdx == 0) nextColor = u_bgColor * 1.3;
    else if (nextIdx == 1) nextColor = u_brandPrimary;
    else if (nextIdx == 2) nextColor = u_brandSecondary;
    else nextColor = u_brandPrimary * 0.8;

    // Slight luminance variation per band (geological variation)
    float variation = 0.85 + 0.3 * hash(vec2(bandIdx, 0.0));
    bandColor *= variation;
    nextColor *= (0.85 + 0.3 * hash(vec2(bandIdx + 1.0, 0.0)));

    color = mix(bandColor, nextColor, edge);

    // Darken outermost bands more (rough stone exterior)
    color *= smoothstep(1.0, 0.7, normDist);
  }

  // ── Post-processing ──
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

## Renderer (geode-renderer.ts)

Single-pass, follows topo-renderer pattern exactly:
- One program (no FBOs)
- Pass all uniforms each frame
- `u_bands` via `gl.uniform1i()` with `Math.round()` (CRITICAL — int uniform, not float)
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
  'u_bands',
  'u_warp',
  'u_cavity',
  'u_speed',
  'u_sparkle',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;
```

### Renderer Structure

```typescript
import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, GeodeConfig } from '../shader-config';
import { GEODE_FRAG } from '../shaders/geode.frag';
import {
  createProgram,
  createQuad,
  drawQuad,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

const DEFAULTS = {
  bands: 8,
  warp: 0.8,
  cavity: 0.2,
  speed: 0.06,
  sparkle: 0.8,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createGeodeRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<...> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  return {
    init(gl, _w, _h) { /* createProgram + getUniforms + createQuad */ },

    render(gl, time, mouse, config, width, height) {
      const cfg = config as GeodeConfig;
      // ... set viewport, useProgram, bind quad ...

      // CRITICAL: u_bands is int — use uniform1i, not uniform1f
      gl.uniform1i(uniforms.u_bands, Math.round(cfg.bands ?? DEFAULTS.bands));

      // All other config uniforms via uniform1f
      gl.uniform1f(uniforms.u_warp, cfg.warp ?? DEFAULTS.warp);
      gl.uniform1f(uniforms.u_cavity, cfg.cavity ?? DEFAULTS.cavity);
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      gl.uniform1f(uniforms.u_sparkle, cfg.sparkle ?? DEFAULTS.sparkle);
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

Add `'geode'` to the union:
```typescript
export type ShaderPresetId = '...' | 'lava' | 'geode' | 'none';
```

### GeodeConfig

```typescript
export interface GeodeConfig extends ShaderConfigBase {
  preset: 'geode';
  bands: number;
  warp: number;
  cavity: number;
  speed: number;
  sparkle: number;
}
```

### ShaderConfig union

Add `| GeodeConfig` to the union type.

### DEFAULTS

```typescript
// Geode
geodeBands: 8,
geodeWarp: 0.8,
geodeCavity: 0.2,
geodeSpeed: 0.06,
geodeSparkle: 0.8,
```

### Switch case

```typescript
case 'geode':
  return {
    ...base,
    preset: 'geode',
    bands: Math.round(rv('shader-geode-bands', DEFAULTS.geodeBands)),
    warp: rv('shader-geode-warp', DEFAULTS.geodeWarp),
    cavity: rv('shader-geode-cavity', DEFAULTS.geodeCavity),
    speed: rv('shader-geode-speed', DEFAULTS.geodeSpeed),
    sparkle: rv('shader-geode-sparkle', DEFAULTS.geodeSparkle),
  };
```

Note: `bands` MUST use `Math.round()` because it maps to `uniform int` in the shader.

## ShaderHero.svelte Changes

Add to `loadRenderer()` switch:

```typescript
case 'geode': {
  const { createGeodeRenderer } = await import('./renderers/geode-renderer');
  return createGeodeRenderer();
}
```

## Brand Editor Changes

### BrandEditorHeroEffects.svelte

**PRESETS array**: Add entry:
```typescript
{ id: 'geode', label: 'Geode', description: 'Crystal geode cross-section' },
```

**DEFAULTS record**: Add entries:
```typescript
// Geode
'shader-geode-bands': '8',
'shader-geode-warp': '0.80',
'shader-geode-cavity': '0.20',
'shader-geode-speed': '0.06',
'shader-geode-sparkle': '0.80',
```

**Derived state**: Add:
```typescript
// Geode
const geodeBands = $derived(readNum('shader-geode-bands'));
const geodeWarp = $derived(readNum('shader-geode-warp'));
const geodeCavity = $derived(readNum('shader-geode-cavity'));
const geodeSpeed = $derived(readNum('shader-geode-speed'));
const geodeSparkle = $derived(readNum('shader-geode-sparkle'));
```

**Slider section**: Add `{:else if activePreset === 'geode'}` block with 5 sliders.

### Brand Editor Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| `shader-geode-bands` | Mineral Bands | 4 | 12 | 1 | 8 | Few | Many |
| `shader-geode-warp` | Band Irregularity | 0.30 | 1.50 | 0.05 | 0.80 | Smooth | Jagged |
| `shader-geode-cavity` | Crystal Cavity | 0.10 | 0.40 | 0.01 | 0.20 | Small | Large |
| `shader-geode-speed` | Rotation Speed | 0.03 | 0.15 | 0.01 | 0.06 | Slow | Fast |
| `shader-geode-sparkle` | Crystal Sparkle | 0.30 | 1.50 | 0.05 | 0.80 | Matte | Brilliant |

## Brand Color Mapping

| Visual Element | Color Source | Notes |
|----------------|-------------|-------|
| Outermost bands (rough stone) | `u_bgColor * 1.3` | Slightly brightened background — worn exterior |
| Major mineral bands | `u_brandPrimary` | Dominant banding colour |
| Minor mineral bands | `u_brandSecondary` | Alternating secondary veins |
| Accent mineral bands | `u_brandPrimary * 0.8` | Darker primary variant for depth |
| Crystal cavity base | `u_brandAccent` | Crystalline facet colour |
| Crystal cavity per-cell variation | `u_brandAccent * (0.7 + 0.6 * cellId)` | Each facet slightly different |
| Crystal edge cracks | `vec3(1.0)` mixed at 40% | Bright white crack lines between crystals |
| Specular highlights | Additive white, scaled by `u_sparkle` | Mouse-driven light glint |

Band colours cycle through the palette using `mod(bandIndex, 4)`: bg, primary, secondary, primary. This creates the characteristic repeating banding pattern of real agates while ensuring every brand colour appears prominently.

## Mouse Interaction

| Action | Effect |
|--------|--------|
| **Hover (move)** | Shifts light source direction for crystal cavity specular highlights. Light vector = `normalize(vec3(mouse.x - 0.5, mouse.y - 0.5, 0.5))`. Only affects the cavity zone — bands are unlit. |
| **Click (burst)** | Adds rotation impulse `u_burst * 0.5` to the cross-section angle. Creates the sensation of turning the geode specimen to see another angle. Decays via existing `burstStrength *= 0.85`. |
| **Touch (mobile)** | Touch start = burst (rotation impulse). Touch move = specular light shift. Same as mouse but via touch events. |

## Gotchas

1. **BRAND_PREFIX_KEYS** — all 5 keys MUST be registered in `css-injection.ts` or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and `getShaderConfig()` never reads them)
2. **`bands` as int uniform** — MUST use `Math.round()` in config parsing AND `gl.uniform1i()` in the renderer (not `uniform1f`). Passing a float to an `int` uniform produces undefined behaviour in GLSL ES 3.0.
3. **No naming collisions** — all keys namespaced as `shader-geode-*` to avoid collision with existing `shader-speed`, `shader-scale` etc.
4. **Export pattern** — shader string exported as `export const GEODE_FRAG = \`#version 300 es...`
5. **Post-processing chain** — MUST follow: Reinhard tone map -> `min(color, 0.75)` brightness cap -> `mix(u_bgColor, color, u_intensity)` intensity blend -> vignette -> grain -> `clamp(color, 0.0, 0.75)` final cap
6. **Voronoi cell animation** — cell centres must animate slowly (via `u_time * u_speed * 0.5`) so crystal facets shift subtly over time without being distracting
7. **`dFdx`/`dFdy` for specular normals** — these screen-space derivative functions are available in GLSL ES 3.0 (WebGL2) without extension. They produce the pseudo-normal for the specular calculation on crystal facets.
8. **Zero-distance guard on specular** — the `normalize(vec3(mouse.x - 0.5, mouse.y - 0.5, 0.5))` light direction has a minimum Z component of 0.5, so it never degenerates to zero-length. Safe as-is.
9. **Aspect correction** — the centred coordinate `p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5)` ensures the geode is circular, not stretched on wide viewports.
10. **Cavity/band transition** — the `normDist < u_cavity` threshold should use a narrow smoothstep transition (~0.02 width) to avoid a hard seam between the crystal cavity and the first mineral band.
11. **Preset grid** — 17th card (including 'none') in 2-col grid = 9 rows, one incomplete row (layout still works)

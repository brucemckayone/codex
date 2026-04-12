# Fracture (Geometric Polygon Subdivision) Shader Preset — Implementation Plan

## Overview

Add a "fracture" shader preset: animated recursive polygon subdivision that cuts a rectangle into geometric shards. Starting with the full screen rectangle, the shader recursively applies animated cutting lines. Each cut divides a polygon into two halves; the shader tracks which half contains the current pixel. After 8 iterations, each pixel belongs to a unique polygon cell that gets a color from the brand palette (hash-based selection). SDF-based anti-aliased edges and shadow offsets add depth. Clean, geometric, modernist aesthetic. Single-pass (no FBO). Mouse influences cut angle direction. Click triggers a new random cut pattern.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify — add `FractureConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/fracture.frag.ts` | Create — single-pass fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/fracture-renderer.ts` | Create — single-pass renderer |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify — add `'fracture'` to loadRenderer |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify — add 5 keys to BRAND_PREFIX_KEYS |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify — preset card + sliders |

## Config Interface

```typescript
export interface FractureConfig extends ShaderConfigBase {
  preset: 'fracture';
  cuts: number;        // 4-9, default 8 (int) — Subdivision depth (number of recursive cuts)
  speed: number;       // 0.1-0.5, default 0.17 — Animation speed of cut line rotation
  border: number;      // 0.005-0.020, default 0.01 — Edge border width
  shadow: number;      // 0.02-0.10, default 0.05 — Shadow offset for depth
  fill: number;        // 0.5-1.0, default 0.85 — Fill opacity of polygon cells
}
```

## Defaults

```typescript
// Fracture
fractureCuts: 8,
fractureSpeed: 0.17,
fractureBorder: 0.01,
fractureShadow: 0.05,
fractureFill: 0.85,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

```
shader-fracture-cuts
shader-fracture-speed
shader-fracture-border
shader-fracture-shadow
shader-fracture-fill
```

All 5 keys MUST be added to the `BRAND_PREFIX_KEYS` Set in `apps/web/src/lib/brand-editor/css-injection.ts`. Without this, the brand editor injects them with `--color-` prefix instead of `--brand-` prefix, and `getShaderConfig()` (which reads `--brand-shader-*`) will never see them.

## Fragment Shader (fracture.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `u_time` | `float` | Elapsed seconds |
| `u_resolution` | `vec2` | Canvas pixel dimensions |
| `u_mouse` | `vec2` | Normalized mouse (0-1) |
| `u_mouseActive` | `float` | 1.0 when hovering |
| `u_burst` | `float` | Click burst strength |
| `u_brandPrimary` | `vec3` | Brand primary (polygon fill color 1) |
| `u_brandSecondary` | `vec3` | Brand secondary (polygon fill color 2) |
| `u_brandAccent` | `vec3` | Brand accent (polygon fill color 3) |
| `u_bgColor` | `vec3` | Background (dark, visible through gaps + shadows) |
| `u_cuts` | `int` | Subdivision depth |
| `u_speed` | `float` | Animation speed |
| `u_border` | `float` | Edge border width |
| `u_shadow` | `float` | Shadow offset |
| `u_fill` | `float` | Fill opacity |
| `u_intensity` | `float` | Overall blend |
| `u_grain` | `float` | Film grain |
| `u_vignette` | `float` | Vignette strength |

### Algorithm — Recursive Line Cutting

#### Core Concept

Each pixel starts in the full rectangle. A series of animated cutting lines subdivides space recursively. For each cut:

1. Generate a cutting line (point + normal) using a hash-based seed animated by time
2. Determine which side of the line the pixel is on (dot product sign)
3. The pixel "stays" on its side; the other half is discarded for this pixel
4. Accumulate a cell ID based on which side was chosen at each step

After all cuts, each pixel has a unique cell ID that determines its color.

#### Cutting Line Generation

Each cut uses a deterministic hash seed (based on cut index + time) to generate:
- A point through which the line passes (biased toward the center for visual balance)
- A normal direction (the angle animated over time)

```glsl
// Hash for deterministic pseudo-random per cut
float hashFloat(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

vec2 hashVec2(float n) {
  return vec2(hashFloat(n), hashFloat(n + 57.3));
}

// Generate a cutting line for cut index i at time t
// Returns: linePoint (vec2) and lineNormal (vec2)
void getCutLine(int i, float t, vec2 mouseInfluence, out vec2 point, out vec2 normal) {
  float seed = float(i) * 13.37;

  // Line passes through a random point (biased to center region)
  point = hashVec2(seed) * 0.6 + 0.2; // Range [0.2, 0.8]

  // Animated angle
  float baseAngle = hashFloat(seed + 7.0) * 3.14159 * 2.0;
  float animAngle = baseAngle + t * (hashFloat(seed + 11.0) * 2.0 - 1.0);

  // Mouse influence on angle
  animAngle += dot(mouseInfluence, vec2(cos(baseAngle), sin(baseAngle))) * 0.5;

  // Click randomization: burst shifts the seed, creating new pattern
  animAngle += u_burst * hashFloat(seed + 23.0) * 6.28;

  normal = vec2(cos(animAngle), sin(animAngle));
}
```

#### Recursive Subdivision Loop

```glsl
void main() {
  float t = u_time * u_speed;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv;

  // Aspect-corrected coordinates (so cuts are uniform, not stretched)
  vec2 p = vec2(uv.x * aspect, uv.y);

  // Mouse influence vector
  vec2 mouseInfluence = u_mouseActive * (u_mouse - vec2(0.5)) * 2.0;

  // -- Recursive cuts --
  float cellId = 0.0;       // Accumulated cell identity
  float minEdgeDist = 1.0;  // Distance to nearest cut edge (for border rendering)

  // Fixed upper bound of 9, dynamic early exit via u_cuts
  for (int i = 0; i < 9; i++) {
    if (i >= u_cuts) break;

    vec2 linePoint, lineNormal;
    getCutLine(i, t, mouseInfluence, linePoint, lineNormal);

    // Aspect-correct the line point
    linePoint.x *= aspect;

    // Signed distance from pixel to cutting line
    float d = dot(p - linePoint, lineNormal);

    // Which side? Accumulate into cell ID
    float side = step(0.0, d); // 0.0 or 1.0
    cellId += side * pow(2.0, float(i)); // Binary encoding: each cut = 1 bit

    // Track nearest edge distance (for border rendering)
    minEdgeDist = min(minEdgeDist, abs(d));
  }

  // -- Cell color from hash (mod 3 into brand palette) --
  float colorSeed = hashFloat(cellId * 17.31 + 0.5);

  // Three-way split: primary, secondary, accent
  vec3 cellColor;
  if (colorSeed < 0.33) {
    cellColor = u_brandPrimary;
  } else if (colorSeed < 0.66) {
    cellColor = u_brandSecondary;
  } else {
    cellColor = u_brandAccent;
  }

  // Slight brightness variation per cell for visual interest
  float brightnessVar = hashFloat(cellId * 31.7 + 3.0) * 0.2 - 0.1;
  cellColor += brightnessVar;

  // -- Border (anti-aliased edge using fwidth) --
  float fw = fwidth(minEdgeDist);
  float borderMask = 1.0 - smoothstep(u_border - fw, u_border + fw, minEdgeDist);
  vec3 borderColor = u_bgColor * 0.5; // Dark border

  // -- Shadow --
  // Sample the same cuts but at an offset position (simulates drop shadow)
  vec2 shadowOffset = vec2(u_shadow, -u_shadow);
  float shadowCellId = 0.0;
  float shadowEdgeDist = 1.0;

  for (int i = 0; i < 9; i++) {
    if (i >= u_cuts) break;

    vec2 linePoint, lineNormal;
    getCutLine(i, t, mouseInfluence, linePoint, lineNormal);
    linePoint.x *= aspect;

    float d = dot((p + shadowOffset) - linePoint, lineNormal);
    float side = step(0.0, d);
    shadowCellId += side * pow(2.0, float(i));
    shadowEdgeDist = min(shadowEdgeDist, abs(d));
  }

  // Shadow appears where the shadow-offset cell differs from the original cell
  float shadowMask = (shadowCellId != cellId) ? 1.0 : 0.0;
  shadowMask *= smoothstep(0.0, u_shadow * 2.0, u_shadow - shadowEdgeDist + u_shadow);
  shadowMask = clamp(shadowMask, 0.0, 0.5);

  // -- Composite --
  // Start with cell fill
  vec3 color = mix(u_bgColor, cellColor, u_fill);

  // Apply shadow (darken)
  color = mix(color, u_bgColor * 0.3, shadowMask);

  // Apply border on top
  color = mix(color, borderColor, borderMask);

  // -- Post-processing --
  color = color / (1.0 + color);
  color = min(color, vec3(0.75));
  color = mix(u_bgColor, color, u_intensity);
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;
  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
```

### Mouse Interaction

**Hover**: Mouse position (normalized to [-1, 1] from center) creates a directional bias on all cut angles. Moving the mouse rotates the cutting plane angles, causing the polygon pattern to shift and reform. The effect is subtle — a 0.5 radian maximum influence — so it augments the pattern rather than dominating it.

**Click**: The `u_burst` value adds a hash-seeded random offset to each cut angle, effectively creating a new random subdivision pattern that smoothly transitions as burst decays. Feels like the glass shattering into a new arrangement.

```glsl
// Mouse influence on cut angle
animAngle += dot(mouseInfluence, vec2(cos(baseAngle), sin(baseAngle))) * 0.5;

// Click randomization
animAngle += u_burst * hashFloat(seed + 23.0) * 6.28; // Full rotation range
```

### Post-Processing Chain

MUST follow the established pipeline (same as all other presets):

```glsl
// 1. Reinhard tone map
color = color / (1.0 + color);

// 2. Brightness cap at 75%
color = min(color, vec3(0.75));

// 3. Mix with background by intensity
color = mix(u_bgColor, color, u_intensity);

// 4. Vignette
vec2 vc = v_uv * 2.0 - 1.0;
color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

// 5. Film grain
color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

// 6. Final clamp
fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
```

### Key GLSL Notes

- Export as `export const FRACTURE_FRAG = \`#version 300 es...`
- Max 9 cuts (fixed loop upper bound), dynamically controlled by `u_cuts` int uniform
- Cell ID encoded as a binary number (each cut contributes one bit): `cellId += side * pow(2.0, float(i))`
- Shadow computed by re-running the same cuts at an offset position — doubles the loop cost but produces convincing depth
- Anti-aliased borders via `fwidth()` + `smoothstep()` — same technique as topo contour lines
- Hash for grain: same `hash(vec2)` function as topo/ocean shaders
- `hashFloat()` for per-cut deterministic randomness — the seed is `float(i) * 13.37` to decorrelate cuts
- Total fragment cost: ~18 dot products per fragment (9 cuts x 2 for shadow) + hash evaluations. Very cheap — this is one of the lightest presets

### Full GLSL Pseudocode

```glsl
#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_mouseActive;
uniform float u_burst;
uniform vec3 u_brandPrimary;
uniform vec3 u_brandSecondary;
uniform vec3 u_brandAccent;
uniform vec3 u_bgColor;
uniform int u_cuts;
uniform float u_speed;
uniform float u_border;
uniform float u_shadow;
uniform float u_fill;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

float hash(vec2 p) { /* same as topo */ }

float hashFloat(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

vec2 hashVec2(float n) {
  return vec2(hashFloat(n), hashFloat(n + 57.3));
}

void getCutLine(int i, float t, vec2 mouseInfl, out vec2 pt, out vec2 norm) {
  float seed = float(i) * 13.37;
  pt = hashVec2(seed) * 0.6 + 0.2;
  float baseAngle = hashFloat(seed + 7.0) * 6.28318;
  float animAngle = baseAngle + t * (hashFloat(seed + 11.0) * 2.0 - 1.0);
  animAngle += dot(mouseInfl, vec2(cos(baseAngle), sin(baseAngle))) * 0.5;
  animAngle += u_burst * hashFloat(seed + 23.0) * 6.28318;
  norm = vec2(cos(animAngle), sin(animAngle));
}

void main() {
  float t = u_time * u_speed;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(v_uv.x * aspect, v_uv.y);
  vec2 mouseInfl = u_mouseActive * (u_mouse - vec2(0.5)) * 2.0;

  // Recursive cuts
  float cellId = 0.0;
  float minEdge = 1.0;
  for (int i = 0; i < 9; i++) {
    if (i >= u_cuts) break;
    vec2 pt, nm;
    getCutLine(i, t, mouseInfl, pt, nm);
    pt.x *= aspect;
    float d = dot(p - pt, nm);
    cellId += step(0.0, d) * pow(2.0, float(i));
    minEdge = min(minEdge, abs(d));
  }

  // Cell color (3-way palette)
  float cs = hashFloat(cellId * 17.31 + 0.5);
  vec3 cellColor = cs < 0.33 ? u_brandPrimary : cs < 0.66 ? u_brandSecondary : u_brandAccent;
  cellColor += hashFloat(cellId * 31.7 + 3.0) * 0.2 - 0.1;

  // Border
  float fw = fwidth(minEdge);
  float borderMask = 1.0 - smoothstep(u_border - fw, u_border + fw, minEdge);

  // Shadow (offset re-cut)
  vec2 sOff = vec2(u_shadow, -u_shadow);
  float sCellId = 0.0;
  float sEdge = 1.0;
  for (int i = 0; i < 9; i++) {
    if (i >= u_cuts) break;
    vec2 pt, nm;
    getCutLine(i, t, mouseInfl, pt, nm);
    pt.x *= aspect;
    float d = dot((p + sOff) - pt, nm);
    sCellId += step(0.0, d) * pow(2.0, float(i));
    sEdge = min(sEdge, abs(d));
  }
  float shadowMask = (sCellId != cellId) ? 1.0 : 0.0;
  shadowMask *= smoothstep(0.0, u_shadow * 2.0, u_shadow - sEdge + u_shadow);
  shadowMask = clamp(shadowMask, 0.0, 0.5);

  // Composite
  vec3 color = mix(u_bgColor, cellColor, u_fill);
  color = mix(color, u_bgColor * 0.3, shadowMask);
  color = mix(color, u_bgColor * 0.5, borderMask);

  // Post-processing
  color = color / (1.0 + color);
  color = min(color, vec3(0.75));
  color = mix(u_bgColor, color, u_intensity);
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;
  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
```

## Renderer (fracture-renderer.ts)

Single-pass, follows topo-renderer pattern exactly:
- One program (no FBOs)
- Pass all uniforms each frame
- `u_cuts` uses `gl.uniform1i()` (integer uniform for loop bound)
- All other preset uniforms use `gl.uniform1f()`
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
  'u_cuts',
  'u_speed',
  'u_border',
  'u_shadow',
  'u_fill',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;
```

### Renderer Structure

```typescript
import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, FractureConfig } from '../shader-config';
import { FRACTURE_FRAG } from '../shaders/fracture.frag';
import { createProgram, createQuad, drawQuad, getUniforms, VERTEX_SHADER } from '../webgl-utils';

const DEFAULTS = {
  cuts: 8,
  speed: 0.17,
  border: 0.01,
  shadow: 0.05,
  fill: 0.85,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createFractureRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<...> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  return {
    init(gl, width, height) {
      program = createProgram(gl, VERTEX_SHADER, FRACTURE_FRAG);
      if (!program) return false;
      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);
      return true;
    },

    render(gl, time, mouse, config, width, height) {
      if (!program || !uniforms || !quad) return;
      const cfg = config as FractureConfig;

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

      gl.uniform3fv(uniforms.u_brandPrimary, cfg.colors.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, cfg.colors.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, cfg.colors.accent);
      gl.uniform3fv(uniforms.u_bgColor, cfg.colors.bg);

      // u_cuts is an int uniform
      gl.uniform1i(uniforms.u_cuts, Math.round(cfg.cuts ?? DEFAULTS.cuts));
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      gl.uniform1f(uniforms.u_border, cfg.border ?? DEFAULTS.border);
      gl.uniform1f(uniforms.u_shadow, cfg.shadow ?? DEFAULTS.shadow);
      gl.uniform1f(uniforms.u_fill, cfg.fill ?? DEFAULTS.fill);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(uniforms.u_vignette, cfg.vignette ?? DEFAULTS.vignette);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize() {},   // Single-pass: no FBOs to resize
    reset() {},    // No simulation state to reset
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

Add `'fracture'` to the union:
```typescript
export type ShaderPresetId = '...' | 'fracture' | 'none';
```

### FractureConfig

```typescript
export interface FractureConfig extends ShaderConfigBase {
  preset: 'fracture';
  cuts: number;
  speed: number;
  border: number;
  shadow: number;
  fill: number;
}
```

### ShaderConfig union

Add `| FractureConfig` to the union type.

### DEFAULTS

```typescript
// Fracture
fractureCuts: 8,
fractureSpeed: 0.17,
fractureBorder: 0.01,
fractureShadow: 0.05,
fractureFill: 0.85,
```

### Switch case

```typescript
case 'fracture':
  return {
    ...base,
    preset: 'fracture',
    cuts: Math.round(rv('shader-fracture-cuts', DEFAULTS.fractureCuts)),
    speed: rv('shader-fracture-speed', DEFAULTS.fractureSpeed),
    border: rv('shader-fracture-border', DEFAULTS.fractureBorder),
    shadow: rv('shader-fracture-shadow', DEFAULTS.fractureShadow),
    fill: rv('shader-fracture-fill', DEFAULTS.fractureFill),
  };
```

## ShaderHero.svelte Changes

Add to `loadRenderer()` switch:

```typescript
case 'fracture': {
  const { createFractureRenderer } = await import('./renderers/fracture-renderer');
  return createFractureRenderer();
}
```

## Brand Editor Changes

### BrandEditorHeroEffects.svelte

**PRESETS array**: Add entry:
```typescript
{ id: 'fracture', label: 'Fracture', description: 'Geometric polygon shards' },
```

**DEFAULTS record**: Add entries:
```typescript
'shader-fracture-cuts': '8',
'shader-fracture-speed': '0.17',
'shader-fracture-border': '0.010',
'shader-fracture-shadow': '0.05',
'shader-fracture-fill': '0.85',
```

**Derived state**: Add:
```typescript
// Fracture
const fractureCuts = $derived(readNum('shader-fracture-cuts'));
const fractureSpeed = $derived(readNum('shader-fracture-speed'));
const fractureBorder = $derived(readNum('shader-fracture-border'));
const fractureShadow = $derived(readNum('shader-fracture-shadow'));
const fractureFill = $derived(readNum('shader-fracture-fill'));
```

**Slider section**: Add `{:else if activePreset === 'fracture'}` block before the `{/if}`.

### Brand Editor Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| `shader-fracture-cuts` | Subdivision Depth | 4 | 9 | 1 | 8 | Few | Many |
| `shader-fracture-speed` | Animation Speed | 0.1 | 0.5 | 0.01 | 0.17 | Slow | Fast |
| `shader-fracture-border` | Edge Width | 0.005 | 0.020 | 0.001 | 0.010 | Thin | Thick |
| `shader-fracture-shadow` | Shadow Depth | 0.02 | 0.10 | 0.01 | 0.05 | Flat | Deep |
| `shader-fracture-fill` | Fill Opacity | 0.5 | 1.0 | 0.05 | 0.85 | Faded | Solid |

### Slider Section Template

```svelte
{:else if activePreset === 'fracture'}
  <section class="hero-fx__section">
    <span class="hero-fx__section-label">Fracture</span>
    <BrandSliderField id="shader-fracture-cuts" label="Subdivision Depth" value={String(Math.round(fractureCuts))} min={4} max={9} step={1} current={fractureCuts} minLabel="Few" maxLabel="Many" oninput={handleSliderInput('shader-fracture-cuts')} />
    <BrandSliderField id="shader-fracture-speed" label="Animation Speed" value={fractureSpeed.toFixed(2)} min={0.1} max={0.5} step={0.01} current={fractureSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-fracture-speed')} />
    <BrandSliderField id="shader-fracture-border" label="Edge Width" value={fractureBorder.toFixed(3)} min={0.005} max={0.020} step={0.001} current={fractureBorder} minLabel="Thin" maxLabel="Thick" oninput={handleSliderInput('shader-fracture-border')} />
    <BrandSliderField id="shader-fracture-shadow" label="Shadow Depth" value={fractureShadow.toFixed(2)} min={0.02} max={0.10} step={0.01} current={fractureShadow} minLabel="Flat" maxLabel="Deep" oninput={handleSliderInput('shader-fracture-shadow')} />
    <BrandSliderField id="shader-fracture-fill" label="Fill Opacity" value={fractureFill.toFixed(2)} min={0.5} max={1.0} step={0.05} current={fractureFill} minLabel="Faded" maxLabel="Solid" oninput={handleSliderInput('shader-fracture-fill')} />
  </section>
```

## Brand Color Mapping

| Visual Element | Color Source | Notes |
|----------------|-------------|-------|
| Polygon cells (1/3 each) | `u_brandPrimary`, `u_brandSecondary`, `u_brandAccent` | Hash-based assignment, ~33% each |
| Background (visible through gaps) | `u_bgColor` | Dark — seen through borders and shadow |
| Edge borders | `u_bgColor * 0.5` | Darkened background for contrast |
| Shadow areas | `u_bgColor * 0.3` | Even darker for depth |

The three-way palette distribution ensures all three brand colors are equally represented. The hash-based selection decorrelates adjacent cells, so neighboring polygons rarely share the same color. This creates a stained-glass or mosaic effect that showcases the full brand palette.

## Performance Notes

- **Single-pass, no FBO** — cheapest possible architecture
- **Max 9 cuts** with fixed loop upper bound — GLSL compilers unroll effectively
- **Shadow doubles the loop** (cuts are re-evaluated at offset) — total of ~18 dot products per fragment. Still extremely cheap
- **No noise functions** — purely geometric (hash + dot product). This is one of the lightest presets
- **fwidth() for anti-aliasing** — automatic screen-space derivative, no additional cost
- **No additional textures** — all procedural
- **Mobile DPR capped at 1** by ShaderHero.svelte (existing behaviour)
- **Binary cell ID encoding** — `pow(2.0, float(i))` creates unique IDs for up to 2^9 = 512 possible cells. This is sufficient since the actual number of visible cells with 8 cuts is typically 30-80

## Gotchas

1. **BRAND_PREFIX_KEYS** — all 5 keys MUST be registered in `css-injection.ts` or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and ShaderHero never reads them)
2. **No naming collisions** — all keys namespaced as `shader-fracture-*` to avoid collision with existing `shader-speed`, `shader-border` (glass), etc.
3. **Export pattern** — shader string exported as `export const FRACTURE_FRAG = \`#version 300 es...`
4. **Post-processing chain** — MUST follow: Reinhard tone map -> `min(color, 0.75)` brightness cap -> `mix(u_bgColor, color, u_intensity)` intensity blend -> vignette -> grain -> `clamp(color, 0.0, 0.75)` final cap
5. **u_cuts is an int uniform** — MUST use `gl.uniform1i()` in the renderer, not `gl.uniform1f()`. Also MUST use `Math.round()` in shader-config.ts to ensure integer value
6. **Cell ID float precision** — `pow(2.0, float(i))` works accurately up to i=23 in float32. Since max cuts = 9, we are well within safe range (2^9 = 512)
7. **Shadow cell comparison** — `sCellId != cellId` is a float equality check. This works because both are sums of `step()` * `pow(2,i)` which produce exact integer-valued floats. Do NOT introduce any fractional arithmetic into cell ID computation
8. **Hash decorrelation** — the multiplier `13.37` for per-cut seeding must be irrational-ish to decorrelate adjacent cuts. Using integer multipliers (13, 14, 15...) would create visible patterns
9. **Aspect correction for line points** — the line point X must be multiplied by aspect ratio AFTER generation (not before), matching the fragment coordinate space. Otherwise cuts would be offset on non-square viewports
10. **Border rendering** — `fwidth(minEdgeDist)` gives the screen-space derivative for anti-aliasing. This automatically handles different DPR values. Do NOT use a fixed pixel-space border width — it would scale wrong on different resolutions
11. **Click burst interaction** — `u_burst * hashFloat(seed + 23.0) * 6.28` adds a full-rotation random offset per cut. As burst decays to 0, the pattern smoothly returns to its base animation. The `seed + 23.0` offset must differ from other seed offsets to avoid correlation

# Vortex (Polar Volumetric Spirals) Shader Preset — Implementation Plan

## Overview

Add a "vortex" shader preset: polar-coordinate volumetric spirals with concentric rings, spiral glow, and radial brightness. Single-pass (no FBO). Multiple volumetric layers are accumulated via ray stepping in polar space, with each step rotating by depth + angle. Cell repetition via `mod` creates periodic radial patterns. Spiral glow and ring edge highlights are driven by brand colors. Mouse shifts the polar centre; click creates a twist distortion.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify — add `VortexConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/vortex.frag.ts` | Create — single-pass fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/vortex-renderer.ts` | Create — single-pass renderer |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify — add `'vortex'` to loadRenderer |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify — add 5 keys to BRAND_PREFIX_KEYS |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify — preset card + sliders |

## Config Interface

```typescript
export interface VortexConfig extends ShaderConfigBase {
  preset: 'vortex';
  speed: number;       // 0.1-0.5, default 0.2 — Rotation/evolution speed
  density: number;     // 20-60, default 40 (int) — Volumetric ray steps
  twist: number;       // 0.5-2.0, default 1.0 — Spiral twist amount
  rings: number;       // 0.5-2.0, default 1.0 — Ring repetition scale
  spiral: number;      // 0.3-1.0, default 0.6 — Spiral arm brightness
}
```

## Defaults

```typescript
// Vortex
vortexSpeed: 0.2,
vortexDensity: 40,
vortexTwist: 1.0,
vortexRings: 1.0,
vortexSpiral: 0.6,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

```
shader-vortex-speed
shader-vortex-density
shader-vortex-twist
shader-vortex-rings
shader-vortex-spiral
```

## Fragment Shader (vortex.frag.ts)

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
| `u_speed` | `float` | Rotation speed |
| `u_density` | `int` | Ray step count |
| `u_twist` | `float` | Spiral twist amount |
| `u_rings` | `float` | Ring repetition scale |
| `u_spiral` | `float` | Spiral arm brightness |
| `u_intensity` | `float` | Overall blend |
| `u_grain` | `float` | Film grain |
| `u_vignette` | `float` | Vignette strength |

### Algorithm

1. **Polar UV setup**: Convert aspect-corrected UV to polar coordinates `(r, theta)`. Mouse offset shifts the polar centre: `uv += (u_mouse - 0.5) * 0.5`. This creates an off-centre vortex feel.
2. **Click twist distortion**: When `u_burstStrength > 0`, add a localized angular twist: `theta += u_burstStrength * 3.0 * exp(-r * 2.0)`. This creates a momentary swirl concentrated at the centre.
3. **Volumetric ray stepping**: For N steps (up to 60, controlled by `u_density`):
   - Compute depth fraction `d = float(i) / float(u_density)`
   - Per-step rotation angle: `angle = d * 6.283 * u_twist + theta + t`
   - Apply rotation matrix to create spiraling sample coordinates
   - Cell repetition via `mod(p, cellSize)` with period based on `u_rings`
   - Compute SDF blend: combine sphere, line, and ring shapes at the cell centre
   - Accumulate color with exponential brightness falloff by depth
4. **Spiral glow**: For each step, compute spiral arm alignment: `spiralPhase = fract(theta / 6.283 * 3.0 + d * u_twist)`. When the sample point is near a spiral arm (narrow band), multiply brightness by `u_spiral`. This creates defined spiral arms.
5. **Ring edge highlights**: At cell boundaries (`abs(fract(r * u_rings * 4.0) - 0.5) < 0.05`), add edge glow using accent color. Creates visible concentric ring structure.
6. **Central core glow**: Gaussian falloff from centre: `exp(-r*r * 4.0)`. Core glows with secondary color, creating a bright vortex eye.
7. **Color mapping by angle + depth**:
   - Polar hue shifts use `mix(primary, secondary, fract(theta / 6.283 + d))` based on angular position and depth
   - Ring edges colored with accent
   - Central core uses secondary
   - Spiral arm highlights use `mix(primary, accent, d)`
8. **Post-processing**: Reinhard tone map -> min(0.75) cap -> mix(bgColor, color, intensity) -> vignette -> grain -> clamp(0.75)

### Key GLSL Notes

- Export as `export const VORTEX_FRAG = \`#version 300 es...`
- For-loop with `if (i >= u_density) break;` needs constant upper bound (60)
- `u_density` is an int uniform — use `gl.uniform1i()` in renderer
- Polar coordinates: `float r = length(uv); float theta = atan(uv.y, uv.x);`
- Cell repetition: `vec2 cell = mod(p + 0.5 * cellSize, cellSize) - 0.5 * cellSize;`
- Exponential brightness accumulation: `acc += color * exp(-d * 3.0) / float(u_density)` prevents energy blowup
- `atan(y, x)` returns [-PI, PI] — normalize to [0, 1] for hue mapping

### GLSL Pseudocode

```glsl
void main() {
  float t = u_time * u_speed;

  // Aspect-correct UVs
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  // Mouse offset shifts vortex centre
  uv += (u_mouse - 0.5) * 0.5;

  // Polar coordinates
  float r = length(uv);
  float theta = atan(uv.y, uv.x);

  // Click twist
  theta += u_burstStrength * 3.0 * exp(-r * 2.0);

  // Volumetric accumulation
  vec3 acc = vec3(0.0);

  for (int i = 0; i < 60; i++) {
    if (i >= u_density) break;

    float d = float(i) / float(u_density - 1);

    // Per-step rotation
    float angle = d * 6.283 * u_twist + theta + t;
    float c = cos(angle), s = sin(angle);
    vec2 p = mat2(c, -s, s, c) * uv * (1.0 + d * 2.0);

    // Cell repetition
    float cellSize = 1.0 / u_rings;
    vec2 cell = mod(p + 0.5 * cellSize, cellSize) - 0.5 * cellSize;
    float shape = length(cell);

    // SDF: blended sphere + ring
    float sdfVal = smoothstep(0.2, 0.0, shape) + smoothstep(0.02, 0.0, abs(shape - 0.15));

    // Spiral arm alignment
    float spiralPhase = fract(theta / 6.283 * 3.0 + d * u_twist + t * 0.5);
    float spiralBright = smoothstep(0.35, 0.15, abs(spiralPhase - 0.5)) * u_spiral;

    // Color by angle + depth
    float hue = fract(theta / 6.283 + d * 0.5 + t * 0.2);
    vec3 layerColor;
    if (hue < 0.33) {
      layerColor = mix(u_brandPrimary, u_brandSecondary, hue / 0.33);
    } else if (hue < 0.66) {
      layerColor = mix(u_brandSecondary, u_brandAccent, (hue - 0.33) / 0.33);
    } else {
      layerColor = mix(u_brandAccent, u_brandPrimary, (hue - 0.66) / 0.34);
    }

    // Ring edge highlight
    float ringEdge = smoothstep(0.03, 0.0, abs(fract(r * u_rings * 4.0) - 0.5));
    layerColor += u_brandAccent * ringEdge * 0.3;

    // Accumulate with depth falloff
    float brightness = (sdfVal + spiralBright) * exp(-d * 3.0);
    acc += layerColor * brightness / float(u_density);
  }

  // Central core glow
  acc += u_brandSecondary * exp(-r * r * 4.0) * 0.5;

  // Post-processing...
}
```

## Renderer (vortex-renderer.ts)

Single-pass, follows nebula-renderer pattern exactly:
- One program (no FBOs)
- Internal lerped mouse state (`MOUSE_LERP = 0.04`) for smooth polar centre shifts
- Pass all uniforms each frame
- `u_density` via `gl.uniform1i()` with `Math.round()` (not float)
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
  'u_speed',
  'u_density',
  'u_twist',
  'u_rings',
  'u_spiral',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;
```

## shader-config.ts Changes

### ShaderPresetId

Add `'vortex'` to the union:
```typescript
export type ShaderPresetId = '...' | 'vortex' | '...' | 'none';
```

### VortexConfig

```typescript
export interface VortexConfig extends ShaderConfigBase {
  preset: 'vortex';
  speed: number;
  density: number;
  twist: number;
  rings: number;
  spiral: number;
}
```

### ShaderConfig union

Add `| VortexConfig` to the union type.

### DEFAULTS

```typescript
// Vortex
vortexSpeed: 0.2,
vortexDensity: 40,
vortexTwist: 1.0,
vortexRings: 1.0,
vortexSpiral: 0.6,
```

### Switch case

```typescript
case 'vortex':
  return {
    ...base,
    preset: 'vortex',
    speed: rv('shader-vortex-speed', DEFAULTS.vortexSpeed),
    density: Math.round(rv('shader-vortex-density', DEFAULTS.vortexDensity)),
    twist: rv('shader-vortex-twist', DEFAULTS.vortexTwist),
    rings: rv('shader-vortex-rings', DEFAULTS.vortexRings),
    spiral: rv('shader-vortex-spiral', DEFAULTS.vortexSpiral),
  };
```

## ShaderHero.svelte Changes

Add to `loadRenderer()` switch:

```typescript
case 'vortex': {
  const { createVortexRenderer } = await import('./renderers/vortex-renderer');
  return createVortexRenderer();
}
```

## Brand Editor Changes

### BrandEditorHeroEffects.svelte

**PRESETS array**: Add entry:
```typescript
{ id: 'vortex', label: 'Vortex', description: 'Polar volumetric spirals' },
```

**DEFAULTS record**: Add entries:
```typescript
'shader-vortex-speed': '0.20',
'shader-vortex-density': '40',
'shader-vortex-twist': '1.00',
'shader-vortex-rings': '1.00',
'shader-vortex-spiral': '0.60',
```

**Derived state**: Add:
```typescript
// Vortex
const vortexSpeed = $derived(readNum('shader-vortex-speed'));
const vortexDensity = $derived(readNum('shader-vortex-density'));
const vortexTwist = $derived(readNum('shader-vortex-twist'));
const vortexRings = $derived(readNum('shader-vortex-rings'));
const vortexSpiral = $derived(readNum('shader-vortex-spiral'));
```

**Slider section**: Add `{:else if activePreset === 'vortex'}` block.

### Brand Editor Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| `shader-vortex-speed` | Rotation Speed | 0.1 | 0.5 | 0.01 | 0.20 | Slow | Fast |
| `shader-vortex-density` | Ray Steps | 20 | 60 | 1 | 40 | Sparse | Dense |
| `shader-vortex-twist` | Spiral Twist | 0.5 | 2.0 | 0.1 | 1.0 | Loose | Tight |
| `shader-vortex-rings` | Ring Scale | 0.5 | 2.0 | 0.1 | 1.0 | Few | Many |
| `shader-vortex-spiral` | Arm Brightness | 0.3 | 1.0 | 0.05 | 0.60 | Dim | Bright |

## Brand Color Mapping

| Visual Element | Color Source | Notes |
|----------------|-------------|-------|
| Spiral arm color (near) | `u_brandPrimary` | Base spiral coloring |
| Spiral arm color (transition) | `u_brandSecondary` | Mid-angle hue |
| Spiral arm color (far) / ring edges | `u_brandAccent` | Ring edge highlights |
| Central core glow | `u_brandSecondary` | Vortex eye brightness |
| Background / deep space | `u_bgColor` | Dark base behind volumetric layers |

Polar hue mapping (3-segment cyclic):
```glsl
vec3 polarColor(float hue) {
  if (hue < 0.33) {
    return mix(u_brandPrimary, u_brandSecondary, hue / 0.33);
  } else if (hue < 0.66) {
    return mix(u_brandSecondary, u_brandAccent, (hue - 0.33) / 0.33);
  } else {
    return mix(u_brandAccent, u_brandPrimary, (hue - 0.66) / 0.34);
  }
}
```

## Gotchas

1. **BRAND_PREFIX_KEYS** — all 5 keys MUST be registered in `css-injection.ts` or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and ShaderHero never reads them)
2. **For-loop dynamic bound** — constant upper bound of 60 required for GLSL ES 3.0 compliance. Use `if (i >= u_density) break;` pattern.
3. **`density` as int uniform** — use `Math.round()` in config parsing, `gl.uniform1i()` in renderer (not `uniform1f`)
4. **Performance at high density** — 60 steps with trig per step is moderately expensive. The exponential falloff ensures far layers contribute little, so the visual difference between 40 and 60 steps is subtle. Default of 40 is a good balance.
5. **Polar centre singularity** — at `r = 0`, `atan(0, 0)` is undefined. The central core glow covers this with a Gaussian, and the cell repetition works fine at small r. No special handling needed.
6. **Cell repetition alignment** — `mod(p + 0.5 * cellSize, cellSize) - 0.5 * cellSize` centres cells at the origin. Without the centering offset, cells are asymmetric.
7. **Export pattern** — shader string exported as `export const VORTEX_FRAG = \`#version 300 es...`
8. **Post-processing chain** — MUST follow: Reinhard tone map -> `min(color, 0.75)` brightness cap -> `mix(u_bgColor, color, u_intensity)` intensity blend -> vignette -> grain -> `clamp(color, 0.0, 0.75)` final cap
9. **Energy normalization** — accumulating over N steps requires dividing by `float(u_density)` to prevent brighter results at higher step counts
10. **Mouse lerp** — use internal `lerpedMouse` state with `MOUSE_LERP = 0.04` for smooth polar centre shifts, same pattern as nebula-renderer

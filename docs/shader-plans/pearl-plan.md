# Pearl (Iridescent Raymarched Sphere) Shader Preset — Implementation Plan

## Overview

Add a "pearl" shader preset: a raymarched displaced sphere with iridescent fresnel coloring and pearlescent cosine-palette tinting. Single-pass (no FBO). The sphere surface is displaced with layered sin functions, and the fresnel rim cycles through brand colors instead of a hardcoded rainbow. Soft diffuse + specular + rim lighting on a light background. Mouse shifts the light direction; click adds a rotation impulse that decays.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify — add `PearlConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/pearl.frag.ts` | Create — single-pass fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/pearl-renderer.ts` | Create — single-pass renderer |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify — add `'pearl'` to loadRenderer |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify — add 4 keys to BRAND_PREFIX_KEYS |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify — preset card + sliders |

## Config Interface

```typescript
export interface PearlConfig extends ShaderConfigBase {
  preset: 'pearl';
  displacement: number;  // 0.05-0.30, default 0.15 — Surface bump amplitude
  speed: number;         // 0.3-1.5, default 0.7 — Animation speed
  fresnel: number;       // 1.0-5.0, default 3.0 — Fresnel iridescence power
  specular: number;      // 0.5-2.0, default 1.25 — Specular highlight intensity
}
```

## Defaults

```typescript
// Pearl
pearlDisplacement: 0.15,
pearlSpeed: 0.7,
pearlFresnel: 3.0,
pearlSpecular: 1.25,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

```
shader-pearl-displacement
shader-pearl-speed
shader-pearl-fresnel
shader-pearl-specular
```

## Fragment Shader (pearl.frag.ts)

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
| `u_displacement` | `float` | Surface displacement amplitude |
| `u_speed` | `float` | Animation speed |
| `u_fresnel` | `float` | Fresnel exponent |
| `u_specular` | `float` | Specular intensity |
| `u_intensity` | `float` | Overall blend |
| `u_grain` | `float` | Film grain |
| `u_vignette` | `float` | Vignette strength |

### Algorithm

1. **Raymarching setup**: Camera positioned at `vec3(0, 0, 3.5)`, looking at origin. Ray direction from UV with aspect correction. 64 max steps, threshold 0.001.
2. **SDF with displacement**: Base sphere SDF `length(p) - 1.0` displaced by `sin(p.x*2+t)*sin(p.y*3)*sin(p.z*2)*u_displacement` where `t = u_time * u_speed`. Additional octaves at higher frequency for fine detail.
3. **Normal estimation**: Central differences with small epsilon (0.001). Re-evaluate the displaced SDF at 6 offset points.
4. **Mouse light direction**: Base light at `normalize(vec3(0.5, 0.8, 1.0))`. Mouse shifts this: `lightDir.xz += (u_mouse - 0.5) * 1.5`. Click burst adds a rotation impulse to the sphere displacement (offset `t` term by `u_burstStrength * 2.0`).
5. **Fresnel iridescence**: `fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), u_fresnel)`. Instead of a rainbow, map fresnel through brand colors via cosine palette: `mix(u_brandPrimary, u_brandSecondary, fresnel)` for low fresnel, `mix(u_brandSecondary, u_brandAccent, (fresnel - 0.5) * 2.0)` for high fresnel.
6. **Pearl tint via cosine palette**: `vec3 pearlTint = u_brandPrimary + u_brandSecondary * cos(6.283 * (u_brandAccent * fresnel + vec3(0.0, 0.33, 0.67)))`. This replaces the hardcoded `vec3(1.0)` base with brand-driven pearlescence.
7. **Lighting**: Soft diffuse (`max(dot(n, l), 0.0)` * 0.6), specular (`pow(max(dot(reflect, viewDir), 0.0), 32.0) * u_specular`), ambient (0.15), rim light (`pow(1.0 - max(dot(n, viewDir), 0.0), 2.0) * 0.4`).
8. **Background**: Light base `mix(u_bgColor, vec3(1.0), 0.85)` to simulate a light pearlescent environment. Soft gradient from center.
9. **Post-processing**: Reinhard tone map -> min(0.75) cap -> mix(bgLight, color, intensity) -> vignette -> grain -> clamp(0.75).

### Key GLSL Notes

- Export as `export const PEARL_FRAG = \`#version 300 es...`
- Raymarch loop: `for (int i = 0; i < 64; i++)` — fixed upper bound, no dynamic break needed since step count is constant
- The displacement function must be evaluated identically in both the SDF and the normal calculation
- Background rendered when raymarch misses (accumulated distance > 10.0)
- Cosine palette formula: `a + b * cos(2*PI * (c*t + d))` — use brand colors for a, b, c coefficients

### GLSL Pseudocode

```glsl
// Displacement function
float displace(vec3 p, float t) {
  return sin(p.x * 2.0 + t) * sin(p.y * 3.0) * sin(p.z * 2.0 + t * 0.7) * u_displacement
       + sin(p.x * 5.0 - t * 0.5) * sin(p.y * 4.0 + t) * sin(p.z * 6.0) * u_displacement * 0.3;
}

// SDF: sphere + displacement
float sdf(vec3 p, float t) {
  return length(p) - 1.0 + displace(p, t);
}

// Normal via central differences
vec3 calcNormal(vec3 p, float t) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    sdf(p + e.xyy, t) - sdf(p - e.xyy, t),
    sdf(p + e.yxy, t) - sdf(p - e.yxy, t),
    sdf(p + e.yyx, t) - sdf(p - e.yyx, t)
  ));
}

// Fresnel -> brand iridescence
float fr = pow(1.0 - max(dot(n, rd), 0.0), u_fresnel);
vec3 iriColor;
if (fr < 0.5) {
  iriColor = mix(u_brandPrimary, u_brandSecondary, fr * 2.0);
} else {
  iriColor = mix(u_brandSecondary, u_brandAccent, (fr - 0.5) * 2.0);
}

// Pearl cosine palette tint
vec3 pearl = u_brandPrimary * 0.3 + 0.7 * (0.5 + 0.5 * cos(6.283 * (fr * 1.5 + vec3(0.0, 0.33, 0.67))));
vec3 surfaceColor = mix(pearl, iriColor, 0.6);

// Lighting
float diff = max(dot(n, lightDir), 0.0) * 0.6;
vec3 refl = reflect(-lightDir, n);
float spec = pow(max(dot(refl, -rd), 0.0), 32.0) * u_specular;
float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.0) * 0.4;
vec3 color = surfaceColor * (0.15 + diff) + vec3(1.0) * spec + iriColor * rim;
```

## Renderer (pearl-renderer.ts)

Single-pass, follows nebula-renderer pattern exactly:
- One program (no FBOs)
- Internal lerped mouse state (`MOUSE_LERP = 0.04`) for smooth light direction
- Pass all uniforms each frame
- All uniforms are `float` — no `gl.uniform1i()` needed for this preset
- `resize()` and `reset()` are no-ops (single-pass preset); reset resets lerpedMouse to center
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
  'u_displacement',
  'u_speed',
  'u_fresnel',
  'u_specular',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;
```

## shader-config.ts Changes

### ShaderPresetId

Add `'pearl'` to the union:
```typescript
export type ShaderPresetId = '...' | 'pearl' | '...' | 'none';
```

### PearlConfig

```typescript
export interface PearlConfig extends ShaderConfigBase {
  preset: 'pearl';
  displacement: number;
  speed: number;
  fresnel: number;
  specular: number;
}
```

### ShaderConfig union

Add `| PearlConfig` to the union type.

### DEFAULTS

```typescript
// Pearl
pearlDisplacement: 0.15,
pearlSpeed: 0.7,
pearlFresnel: 3.0,
pearlSpecular: 1.25,
```

### Switch case

```typescript
case 'pearl':
  return {
    ...base,
    preset: 'pearl',
    displacement: rv('shader-pearl-displacement', DEFAULTS.pearlDisplacement),
    speed: rv('shader-pearl-speed', DEFAULTS.pearlSpeed),
    fresnel: rv('shader-pearl-fresnel', DEFAULTS.pearlFresnel),
    specular: rv('shader-pearl-specular', DEFAULTS.pearlSpecular),
  };
```

## ShaderHero.svelte Changes

Add to `loadRenderer()` switch:

```typescript
case 'pearl': {
  const { createPearlRenderer } = await import('./renderers/pearl-renderer');
  return createPearlRenderer();
}
```

## Brand Editor Changes

### BrandEditorHeroEffects.svelte

**PRESETS array**: Add entry:
```typescript
{ id: 'pearl', label: 'Pearl', description: 'Iridescent raymarched sphere' },
```

**DEFAULTS record**: Add entries:
```typescript
'shader-pearl-displacement': '0.15',
'shader-pearl-speed': '0.70',
'shader-pearl-fresnel': '3.00',
'shader-pearl-specular': '1.25',
```

**Derived state**: Add:
```typescript
// Pearl
const pearlDisplacement = $derived(readNum('shader-pearl-displacement'));
const pearlSpeed = $derived(readNum('shader-pearl-speed'));
const pearlFresnel = $derived(readNum('shader-pearl-fresnel'));
const pearlSpecular = $derived(readNum('shader-pearl-specular'));
```

**Slider section**: Add `{:else if activePreset === 'pearl'}` block.

### Brand Editor Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| `shader-pearl-displacement` | Surface Displacement | 0.05 | 0.30 | 0.01 | 0.15 | Smooth | Rough |
| `shader-pearl-speed` | Animation Speed | 0.3 | 1.5 | 0.1 | 0.7 | Slow | Fast |
| `shader-pearl-fresnel` | Iridescence Power | 1.0 | 5.0 | 0.1 | 3.0 | Subtle | Strong |
| `shader-pearl-specular` | Specular Highlight | 0.5 | 2.0 | 0.05 | 1.25 | Matte | Glossy |

## Brand Color Mapping

| Visual Element | Color Source | Notes |
|----------------|-------------|-------|
| Sphere base tint / pearl body | `u_brandPrimary` | Cosine palette base coefficient |
| Mid-fresnel iridescence | `u_brandSecondary` | Middle of the fresnel gradient |
| Rim/edge iridescence + highlights | `u_brandAccent` | High-fresnel outer edge color |
| Background | `u_bgColor` lightened (`mix(bg, white, 0.85)`) | Bright pearlescent environment |
| Specular highlights | `vec3(1.0)` (white) | Pure white specular, not tinted |
| Rim light | `u_brandAccent` | Rim glow matches accent color |

Fresnel-to-brand mapping (3-segment gradient):
```glsl
vec3 fresnelColor(float fr) {
  if (fr < 0.5) {
    return mix(u_brandPrimary, u_brandSecondary, fr * 2.0);
  } else {
    return mix(u_brandSecondary, u_brandAccent, (fr - 0.5) * 2.0);
  }
}
```

## Gotchas

1. **BRAND_PREFIX_KEYS** — all 4 keys MUST be registered in `css-injection.ts` or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and ShaderHero never reads them)
2. **Raymarch step count** — 64 steps is generous but needed for displaced sphere accuracy. The displacement means the sphere surface can be significantly offset from the base radius, so early-exit (`if (d < 0.001) break`) is essential for performance.
3. **Normal epsilon consistency** — the displacement function used in `calcNormal()` must be identical to the one in `sdf()`. Extract it as a separate function to avoid divergence bugs.
4. **Light background** — unlike most presets which use a dark background, pearl uses a light background (`mix(u_bgColor, vec3(1.0), 0.85)`). The post-processing cap and intensity blend must account for this — the Reinhard tone map and 0.75 cap work correctly on both light and dark scenes.
5. **Click rotation impulse** — `u_burstStrength` offsets the time parameter in the displacement function, creating a momentary acceleration of the surface animation. This is simpler than actual rotation and avoids needing to track rotation state.
6. **No int uniforms** — all Pearl config values are floats, so no `gl.uniform1i()` needed. This is simpler than presets with int params.
7. **Export pattern** — shader string exported as `export const PEARL_FRAG = \`#version 300 es...`
8. **Post-processing chain** — MUST follow: Reinhard tone map -> `min(color, 0.75)` brightness cap -> `mix(bgLight, color, u_intensity)` intensity blend -> vignette -> grain -> `clamp(color, 0.0, 0.75)` final cap
9. **Aspect correction** — ray direction must use `uv.x * aspect` for circular sphere, not elliptical
10. **Mouse lerp** — use internal `lerpedMouse` state with `MOUSE_LERP = 0.04` for smooth light direction changes, same pattern as nebula-renderer

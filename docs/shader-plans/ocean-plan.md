# Ocean (Underwater Caustics + Sand Ripples) Shader Preset — Implementation Plan

## Overview

Add an "ocean" shader preset: a full underwater scene combining shimmering caustic light networks with slowly undulating sand ripple patterns underneath. Ripples cast soft shadows that interact with caustic highlights. Like looking down at shallow tropical water over a sandy seabed — more immersive than caustics alone. Single-pass (no FBO). Three composited layers: sand ripples, caustic light, and soft shadows. Mouse creates a ripple disturbance in both water and sand simultaneously — as if dipping a finger in the water.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify — add `OceanConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/ocean.frag.ts` | Create — single-pass fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/ocean-renderer.ts` | Create — single-pass renderer |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify — add `'ocean'` to loadRenderer |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify — add 5 keys to BRAND_PREFIX_KEYS |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify — preset card + sliders |

## Config Interface

```typescript
export interface OceanConfig extends ShaderConfigBase {
  preset: 'ocean';
  causticScale: number;   // 1.0-4.0, default 2.0 — Caustic pattern scale
  sandScale: number;      // 1.0-5.0, default 3.0 — Sand ripple scale
  speed: number;          // 0.05-0.25, default 0.10 — Animation speed
  shadow: number;         // 0.1-0.5, default 0.25 — Shadow depth on ripple troughs
  ripple: number;         // 0.5-2.0, default 1.0 — Mouse ripple strength
}
```

## Defaults

```typescript
// Ocean
oceanCausticScale: 2.0,
oceanSandScale: 3.0,
oceanSpeed: 0.10,
oceanShadow: 0.25,
oceanRipple: 1.0,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

```
shader-ocean-caustic-scale
shader-ocean-sand-scale
shader-ocean-speed
shader-ocean-shadow
shader-ocean-ripple
```

All 5 keys MUST be added to the `BRAND_PREFIX_KEYS` Set in `apps/web/src/lib/brand-editor/css-injection.ts`. Without this, the brand editor injects them with `--color-` prefix instead of `--brand-` prefix, and `getShaderConfig()` (which reads `--brand-shader-*`) will never see them.

## Fragment Shader (ocean.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `u_time` | `float` | Elapsed seconds |
| `u_resolution` | `vec2` | Canvas pixel dimensions |
| `u_mouse` | `vec2` | Normalized mouse (0-1) |
| `u_mouseActive` | `float` | 1.0 when hovering |
| `u_burst` | `float` | Click burst strength |
| `u_brandPrimary` | `vec3` | Brand primary (warm sand tone) |
| `u_brandSecondary` | `vec3` | Brand secondary (water tint) |
| `u_brandAccent` | `vec3` | Brand accent (caustic highlights) |
| `u_bgColor` | `vec3` | Background (dark shadow) |
| `u_causticScale` | `float` | Caustic pattern scale |
| `u_sandScale` | `float` | Sand ripple scale |
| `u_speed` | `float` | Animation speed |
| `u_shadow` | `float` | Shadow depth |
| `u_ripple` | `float` | Mouse ripple strength |
| `u_intensity` | `float` | Overall blend |
| `u_grain` | `float` | Film grain |
| `u_vignette` | `float` | Vignette strength |

### Algorithm — Three Composited Layers

#### Layer 1: Sand Ripples (Base Surface)

Directional domain-warped sine waves with FBM noise for irregularity, producing a height field that resembles a sandy seabed with slow undulations.

```glsl
// Sand ripple height field
float sandHeight(vec2 p, float t) {
  // Primary ripple direction (diagonal)
  float angle = 0.4;
  vec2 dir = vec2(cos(angle), sin(angle));

  // Domain warp with slow noise
  vec2 warp = vec2(
    sin(dot(p, dir) * 2.0 + t * 0.3),
    cos(dot(p, dir.yx) * 1.5 + t * 0.2)
  ) * 0.3;

  vec2 wp = p + warp;

  // Layered sine waves for ripple pattern
  float h = 0.0;
  h += sin(dot(wp, dir) * u_sandScale * 3.0 + t * 0.5) * 0.5;
  h += sin(dot(wp, dir * 1.7) * u_sandScale * 5.0 + t * 0.3) * 0.25;
  h += sin(dot(wp, vec2(-dir.y, dir.x)) * u_sandScale * 2.0 + t * 0.15) * 0.15;

  // FBM noise for irregularity (2-3 octaves)
  h += fbmNoise(wp * u_sandScale) * 0.3;

  return h * 0.5 + 0.5; // Normalize to 0..1
}
```

The sand height field is the base that receives caustic light. Ripple crests catch highlights, troughs accumulate shadow.

#### Layer 2: Caustics (Light Network)

Iterative sin/cos UV warping (same proven technique as the "caustic" preset but tuned for overlay compositing). Computes where refracted light rays converge to form bright caustic lines.

```glsl
// Caustic pattern (iterative UV warp convergence)
float caustic(vec2 uv, float t) {
  vec2 p = uv * u_causticScale;
  float c = 0.0;
  float freq = 1.0;

  // 3 fixed iterations for ocean (balanced quality/perf)
  for (int i = 0; i < 3; i++) {
    p += vec2(sin(p.y * freq + t), cos(p.x * freq + t)) / freq;
    c += 1.0 / (1.0 + pow(length(sin(p * 3.14159)), 2.0));
    freq *= 2.0;
    p = mat2(0.8, 0.6, -0.6, 0.8) * p; // rotate between iterations
  }

  // Two-layer averaging for smoother patterns
  // (call twice with offset time seeds)
  return c / 3.0;
}

// main(): two-layer composite
float c1 = caustic(uv, t);
float c2 = caustic(uv, t + 0.5);
float causticVal = (c1 + c2) * 0.5;
```

#### Layer 3: Soft Shadow (Height-Derived)

The sand ripple height field casts soft directional shadows. Computed by sampling the height field at an offset position (simulating oblique light) and comparing with the local height — troughs appear darker.

```glsl
// Soft shadow from ripple height field
vec2 lightDir = normalize(vec2(0.5, 0.7)); // Oblique overhead light
float shadowSample = sandHeight(p + lightDir * 0.05, t);
float localHeight = sandHeight(p, t);
float shadowMask = smoothstep(0.0, 0.15, localHeight - shadowSample);
// shadowMask: 0 = in shadow (trough), 1 = lit (crest)
float shadowDarken = mix(1.0 - u_shadow, 1.0, shadowMask);
```

#### Compositing

The three layers composite together to produce the final color:

1. **Sand color** — height-mapped to a warm gradient using brand primary
2. **Caustic brightening** — caustic value additively brightens the surface (accent color)
3. **Shadow darkening** — shadow mask multiplicatively darkens the troughs (bg color)

```glsl
// Sand base color (warm gradient: bgColor -> primary)
vec3 sandColor = mix(u_bgColor * 0.6, u_brandPrimary, sandH * 0.8 + 0.1);

// Water tint overlay (secondary color)
vec3 waterTint = u_brandSecondary * 0.3;
sandColor = mix(sandColor, sandColor + waterTint, 0.5);

// Caustic highlights (accent color, additive)
vec3 causticColor = u_brandAccent * causticVal * causticVal * 0.8;
vec3 color = sandColor + causticColor;

// Shadow darkening (multiplicative)
color *= shadowDarken;
```

### Mouse Interaction

Lerped mouse position for smooth wave motion. Creates a ripple disturbance in BOTH water caustics and sand surface simultaneously — as if dipping a finger in the water. The ripple warps the UV space that both the sand height and caustic functions sample from.

```glsl
// Mouse ripple — affects both sand and caustic layers
vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
vec2 fragUV = vec2(uv.x * aspect, uv.y);
float mouseDist = distance(fragUV, mouseUV);
vec2 mouseDir = mouseDist > 0.001 ? normalize(fragUV - mouseUV) : vec2(0.0);

// Hover ripple: concentric waves emanating from cursor
vec2 hoverWarp = u_mouseActive * u_ripple * 0.015 *
  sin(mouseDist * 25.0 - t * 5.0) *
  exp(-mouseDist * 6.0) * mouseDir;

// Click burst: larger, stronger outward ring
vec2 burstWarp = u_burst * 0.025 *
  sin(mouseDist * 18.0 - t * 8.0) *
  exp(-mouseDist * 3.0) * mouseDir;

// Apply warp to UV BEFORE sampling both layers
vec2 warpedUV = uv + hoverWarp + burstWarp;
// Now use warpedUV for both sandHeight() and caustic() calls
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

- Export as `export const OCEAN_FRAG = \`#version 300 es...`
- Fixed 3 iterations for caustic loop (no dynamic count — keeps it simple and fast for a composite shader)
- Aspect ratio correction: `vec2 p = vec2(uv.x * aspect, uv.y) * scale;`
- Two-layer caustic technique: call function with `time` and `time + 0.5`, average results
- Noise hash for grain: same `hash(vec2)` function as topo/caustic shaders
- FBM noise for sand irregularity: 2-octave sin-based noise with rotation (same pattern as topo's fbm)
- Total fragment cost: ~15 sin/cos pairs per fragment (sand FBM + 2x caustic layers) — still cheap for single-pass, comparable to existing presets

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
uniform float u_causticScale;
uniform float u_sandScale;
uniform float u_speed;
uniform float u_shadow;
uniform float u_ripple;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

float hash(vec2 p) { /* same as topo */ }

// 2-octave FBM for sand irregularity
const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);
float fbmNoise(vec2 p) {
  float f = sin(p.x) * sin(p.y) * 0.5;
  p = octaveRot * p * 2.02;
  f += sin(p.x) * sin(p.y) * 0.25;
  return f / 0.75;
}

float sandHeight(vec2 p, float t) {
  // Directional domain-warped sine waves + FBM
  // Returns 0..1 height
}

float caustic(vec2 uv, float t) {
  // 3-iteration sin/cos UV warp convergence
  // Returns brightness 0..~1
}

void main() {
  float t = u_time * u_speed;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv;

  // -- Mouse ripple warp (applied to both layers) --
  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
  vec2 fragUV = vec2(uv.x * aspect, uv.y);
  float mouseDist = distance(fragUV, mouseUV);
  vec2 mouseDir = mouseDist > 0.001 ? normalize(fragUV - mouseUV) : vec2(0.0);
  vec2 warp = vec2(0.0);
  warp += u_mouseActive * u_ripple * 0.015 * sin(mouseDist * 25.0 - t * 5.0) * exp(-mouseDist * 6.0) * mouseDir;
  warp += u_burst * 0.025 * sin(mouseDist * 18.0 - t * 8.0) * exp(-mouseDist * 3.0) * mouseDir;
  vec2 warpedUV = uv + warp;

  // Aspect-corrected coordinates
  vec2 p = vec2(warpedUV.x * aspect, warpedUV.y);

  // -- Layer 1: Sand ripples --
  float sandH = sandHeight(p * u_sandScale, t);

  // -- Layer 2: Caustics (two-layer average) --
  float c1 = caustic(p, t);
  float c2 = caustic(p, t + 0.5);
  float causticVal = (c1 + c2) * 0.5;

  // -- Layer 3: Soft shadow --
  vec2 lightDir = normalize(vec2(0.5, 0.7));
  float shadowSample = sandHeight((p + lightDir * 0.05) * u_sandScale, t);
  float shadowMask = smoothstep(0.0, 0.15, sandH - shadowSample);
  float shadowDarken = mix(1.0 - u_shadow, 1.0, shadowMask);

  // -- Composite --
  vec3 sandColor = mix(u_bgColor * 0.6, u_brandPrimary, sandH * 0.8 + 0.1);
  sandColor = mix(sandColor, sandColor + u_brandSecondary * 0.3, 0.5);
  vec3 color = sandColor + u_brandAccent * causticVal * causticVal * 0.8;
  color *= shadowDarken;

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

## Renderer (ocean-renderer.ts)

Single-pass, follows topo-renderer pattern exactly:
- One program (no FBOs)
- Pass all uniforms each frame
- All uniforms are `gl.uniform1f()` (no int uniforms needed for ocean — caustic iteration count is fixed at 3 in the shader)
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
  'u_causticScale',
  'u_sandScale',
  'u_speed',
  'u_shadow',
  'u_ripple',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;
```

### Renderer Structure

```typescript
import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, OceanConfig } from '../shader-config';
import { OCEAN_FRAG } from '../shaders/ocean.frag';
import { createProgram, createQuad, drawQuad, getUniforms, VERTEX_SHADER } from '../webgl-utils';

const DEFAULTS = {
  causticScale: 2.0,
  sandScale: 3.0,
  speed: 0.10,
  shadow: 0.25,
  ripple: 1.0,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createOceanRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<...> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  return {
    init(gl, width, height) {
      program = createProgram(gl, VERTEX_SHADER, OCEAN_FRAG);
      if (!program) return false;
      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);
      return true;
    },

    render(gl, time, mouse, config, width, height) {
      if (!program || !uniforms || !quad) return;
      const cfg = config as OceanConfig;

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

      gl.uniform1f(uniforms.u_causticScale, cfg.causticScale ?? DEFAULTS.causticScale);
      gl.uniform1f(uniforms.u_sandScale, cfg.sandScale ?? DEFAULTS.sandScale);
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      gl.uniform1f(uniforms.u_shadow, cfg.shadow ?? DEFAULTS.shadow);
      gl.uniform1f(uniforms.u_ripple, cfg.ripple ?? DEFAULTS.ripple);
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

Add `'ocean'` to the union:
```typescript
export type ShaderPresetId = '...' | 'ocean' | 'none';
```

### OceanConfig

```typescript
export interface OceanConfig extends ShaderConfigBase {
  preset: 'ocean';
  causticScale: number;
  sandScale: number;
  speed: number;
  shadow: number;
  ripple: number;
}
```

### ShaderConfig union

Add `| OceanConfig` to the union type.

### DEFAULTS

```typescript
// Ocean
oceanCausticScale: 2.0,
oceanSandScale: 3.0,
oceanSpeed: 0.10,
oceanShadow: 0.25,
oceanRipple: 1.0,
```

### Switch case

```typescript
case 'ocean':
  return {
    ...base,
    preset: 'ocean',
    causticScale: rv('shader-ocean-caustic-scale', DEFAULTS.oceanCausticScale),
    sandScale: rv('shader-ocean-sand-scale', DEFAULTS.oceanSandScale),
    speed: rv('shader-ocean-speed', DEFAULTS.oceanSpeed),
    shadow: rv('shader-ocean-shadow', DEFAULTS.oceanShadow),
    ripple: rv('shader-ocean-ripple', DEFAULTS.oceanRipple),
  };
```

## ShaderHero.svelte Changes

Add to `loadRenderer()` switch:

```typescript
case 'ocean': {
  const { createOceanRenderer } = await import('./renderers/ocean-renderer');
  return createOceanRenderer();
}
```

## Brand Editor Changes

### BrandEditorHeroEffects.svelte

**PRESETS array**: Add entry:
```typescript
{ id: 'ocean', label: 'Ocean', description: 'Underwater caustics + sand ripples' },
```

**DEFAULTS record**: Add entries:
```typescript
'shader-ocean-caustic-scale': '2.0',
'shader-ocean-sand-scale': '3.0',
'shader-ocean-speed': '0.10',
'shader-ocean-shadow': '0.25',
'shader-ocean-ripple': '1.00',
```

**Derived state**: Add:
```typescript
// Ocean
const oceanCausticScale = $derived(readNum('shader-ocean-caustic-scale'));
const oceanSandScale = $derived(readNum('shader-ocean-sand-scale'));
const oceanSpeed = $derived(readNum('shader-ocean-speed'));
const oceanShadow = $derived(readNum('shader-ocean-shadow'));
const oceanRipple = $derived(readNum('shader-ocean-ripple'));
```

**Slider section**: Add `{:else if activePreset === 'ocean'}` block before the `{/if}`.

### Brand Editor Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| `shader-ocean-caustic-scale` | Caustic Scale | 1.0 | 4.0 | 0.5 | 2.0 | Fine | Coarse |
| `shader-ocean-sand-scale` | Sand Scale | 1.0 | 5.0 | 0.5 | 3.0 | Smooth | Rough |
| `shader-ocean-speed` | Animation Speed | 0.05 | 0.25 | 0.01 | 0.10 | Slow | Fast |
| `shader-ocean-shadow` | Shadow Depth | 0.1 | 0.5 | 0.05 | 0.25 | Subtle | Deep |
| `shader-ocean-ripple` | Mouse Ripple | 0.5 | 2.0 | 0.1 | 1.0 | Gentle | Strong |

### Slider Section Template

```svelte
{:else if activePreset === 'ocean'}
  <section class="hero-fx__section">
    <span class="hero-fx__section-label">Ocean</span>
    <BrandSliderField id="shader-ocean-caustic-scale" label="Caustic Scale" value={oceanCausticScale.toFixed(1)} min={1.0} max={4.0} step={0.5} current={oceanCausticScale} minLabel="Fine" maxLabel="Coarse" oninput={handleSliderInput('shader-ocean-caustic-scale')} />
    <BrandSliderField id="shader-ocean-sand-scale" label="Sand Scale" value={oceanSandScale.toFixed(1)} min={1.0} max={5.0} step={0.5} current={oceanSandScale} minLabel="Smooth" maxLabel="Rough" oninput={handleSliderInput('shader-ocean-sand-scale')} />
    <BrandSliderField id="shader-ocean-speed" label="Animation Speed" value={oceanSpeed.toFixed(2)} min={0.05} max={0.25} step={0.01} current={oceanSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-ocean-speed')} />
    <BrandSliderField id="shader-ocean-shadow" label="Shadow Depth" value={oceanShadow.toFixed(2)} min={0.1} max={0.5} step={0.05} current={oceanShadow} minLabel="Subtle" maxLabel="Deep" oninput={handleSliderInput('shader-ocean-shadow')} />
    <BrandSliderField id="shader-ocean-ripple" label="Mouse Ripple" value={oceanRipple.toFixed(1)} min={0.5} max={2.0} step={0.1} current={oceanRipple} minLabel="Gentle" maxLabel="Strong" oninput={handleSliderInput('shader-ocean-ripple')} />
  </section>
```

## Brand Color Mapping

| Visual Element | Color Source | Notes |
|----------------|-------------|-------|
| Sand base (warm ripple surface) | `u_brandPrimary` | Warm tones — sandy, golden |
| Water tint overlay | `u_brandSecondary` | Cool tones — blue-green water |
| Caustic convergence highlights | `u_brandAccent` | Hot bright highlights where light focuses |
| Shadow / deep areas | `u_bgColor` | Dark tones for ripple troughs and shadow |

The warm/cool contrast between sand (primary) and water (secondary) creates a natural colour distribution. Caustic highlights (accent) dance on top as bright convergence points. Shadow (bg darkened) fills the ripple troughs. This means org brand palettes with warm primary + cool secondary work especially well, but any palette produces a coherent result because the four-role system is self-balancing.

## Performance Notes

- **Single-pass, no FBO** — cheapest possible architecture
- **Fixed 3 caustic iterations** (not configurable) — avoids dynamic loop branching, keeps fragment cost predictable
- **2-octave FBM** for sand irregularity — minimal noise cost
- **Two-layer caustic averaging** doubles the caustic computation but produces much smoother patterns
- **Total fragment cost**: ~15 sin/cos pairs per fragment — comparable to existing single-pass presets (topo, silk, glass)
- **No additional textures** — all procedural
- **Mobile DPR capped at 1** by ShaderHero.svelte (existing behaviour)

## Gotchas

1. **BRAND_PREFIX_KEYS** — all 5 keys MUST be registered in `css-injection.ts` or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and ShaderHero never reads them)
2. **No naming collisions** — all keys namespaced as `shader-ocean-*` to avoid collision with existing `shader-speed`, `shader-scale`, `shader-ripple` etc.
3. **Export pattern** — shader string exported as `export const OCEAN_FRAG = \`#version 300 es...`
4. **Post-processing chain** — MUST follow: Reinhard tone map -> `min(color, 0.75)` brightness cap -> `mix(u_bgColor, color, u_intensity)` intensity blend -> vignette -> grain -> `clamp(color, 0.0, 0.75)` final cap
5. **Mouse ripple normalization** — `normalize(fragUV - mouseUV)` needs guard for zero-distance: `mouseDist > 0.001` conditional
6. **Aspect correction** — UV and mouse coordinates must use same aspect-corrected space for ripple to be circular, not elliptical
7. **Shadow offset direction** — the `lightDir` for shadow sampling should be normalized and consistent; changing it per-frame would cause flicker
8. **Sand height sampled twice for shadow** — once at `p` and once at `p + offset`. Both calls must use the same `warpedUV` base, or the shadow will not align with the ripples
9. **Caustic squared for colour mapping** — `causticVal * causticVal` concentrates highlights into narrower bright lines, giving a more realistic light convergence appearance
10. **Preset grid** — adding ocean makes 17 entries (16 presets + none) in 2-col grid = 8.5 rows (odd card at bottom-left). This is fine — existing CSS handles odd counts with the 2-col grid layout.

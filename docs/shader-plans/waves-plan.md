# Waves (Gerstner Ocean Surface) Shader Preset — Implementation Plan

## Overview

Add a "waves" shader preset: a realistic ocean surface viewed from above/oblique, built on superposed Gerstner waves with proper wave physics. Ray-surface intersection finds the water height at each pixel, finite-difference normals drive Fresnel reflection, subsurface scattering color, specular sun highlights, and foam at wave crests. Single-pass (no FBO). Mouse changes the effective wind direction (shifts wave propagation angles); click creates a splash disturbance that radiates outward.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify — add `WavesConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/waves.frag.ts` | Create — single-pass fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/waves-renderer.ts` | Create — single-pass renderer |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify — add `'waves'` to loadRenderer |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify — add 5 keys to BRAND_PREFIX_KEYS |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify — preset card + sliders |

## Config Interface

```typescript
export interface WavesConfig extends ShaderConfigBase {
  preset: 'waves';
  height: number;     // 0.5-2.0, default 1.0 — Wave amplitude multiplier
  speed: number;      // 0.5-2.0, default 1.0 — Animation speed multiplier
  chop: number;       // 0.3-1.0, default 0.7 — Steepness/choppiness (Gerstner Q parameter)
  foam: number;       // 0.0-1.0, default 0.3 — Foam intensity at crests
  depth: number;      // 0.3-1.0, default 0.6 — Water clarity / subsurface scattering strength
}
```

## Defaults

```typescript
// Waves
wavesHeight: 1.0,
wavesSpeed: 1.0,
wavesChop: 0.7,
wavesFoam: 0.3,
wavesDepth: 0.6,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

```
shader-waves-height
shader-waves-speed
shader-waves-chop
shader-waves-foam
shader-waves-depth
```

All 5 keys MUST be added to the `BRAND_PREFIX_KEYS` Set in `apps/web/src/lib/brand-editor/css-injection.ts`. Without this, the brand editor injects them with `--color-` prefix instead of `--brand-` prefix, and `getShaderConfig()` (which reads `--brand-shader-*`) will never see them.

## Fragment Shader (waves.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `u_time` | `float` | Elapsed seconds |
| `u_resolution` | `vec2` | Canvas pixel dimensions |
| `u_mouse` | `vec2` | Normalized mouse (0-1) |
| `u_mouseActive` | `float` | 1.0 when hovering |
| `u_burst` | `float` | Click burst strength |
| `u_brandPrimary` | `vec3` | Brand primary (wave body color) |
| `u_brandSecondary` | `vec3` | Brand secondary (subsurface scatter warm tint) |
| `u_brandAccent` | `vec3` | Brand accent (foam/crest highlights) |
| `u_bgColor` | `vec3` | Background (deep water, darkened) |
| `u_height` | `float` | Wave amplitude multiplier |
| `u_speed` | `float` | Animation speed |
| `u_chop` | `float` | Steepness / Gerstner Q |
| `u_foam` | `float` | Foam intensity |
| `u_depth` | `float` | Subsurface scattering / water clarity |
| `u_intensity` | `float` | Overall blend |
| `u_grain` | `float` | Film grain |
| `u_vignette` | `float` | Vignette strength |

### Algorithm — Gerstner Wave Surface

#### Core: Gerstner Wave Function

A single Gerstner wave displaces a surface point horizontally and vertically. For 5 superposed waves, the total displacement accumulates:

```glsl
// Single Gerstner wave contribution
// dir: wave direction (normalized), freq: 2pi/wavelength, amp: amplitude
// Q: steepness (0..1), phase: speed * time
struct GerstnerWave {
  vec2 dir;
  float freq;
  float amp;
  float speed;
  float steep;
};

// 5 waves with different directions, frequencies, amplitudes
const int NUM_WAVES = 5;

vec3 gerstnerDisplacement(vec2 pos, float t, float Q) {
  // Define 5 wave components (hardcoded for GPU-friendliness)
  // Directions spread around a dominant wind direction
  // Frequencies: 1.0, 1.8, 2.6, 3.2, 4.1 (increasing)
  // Amplitudes:  0.25, 0.15, 0.10, 0.06, 0.04 (decreasing)
  // Speeds:      1.0, 1.2, 0.9, 1.4, 0.8

  vec3 result = vec3(0.0);

  // Wave 1 (dominant)
  vec2 d1 = normalize(vec2(1.0, 0.3));
  float f1 = 1.0;
  float a1 = 0.25 * u_height;
  float phase1 = dot(d1, pos) * f1 + t * 1.0;
  result.z += a1 * sin(phase1);
  result.xy += Q * a1 * d1 * cos(phase1);

  // Wave 2
  vec2 d2 = normalize(vec2(0.8, -0.5));
  float f2 = 1.8;
  float a2 = 0.15 * u_height;
  float phase2 = dot(d2, pos) * f2 + t * 1.2;
  result.z += a2 * sin(phase2);
  result.xy += Q * a2 * d2 * cos(phase2);

  // Wave 3
  vec2 d3 = normalize(vec2(-0.3, 1.0));
  float f3 = 2.6;
  float a3 = 0.10 * u_height;
  float phase3 = dot(d3, pos) * f3 + t * 0.9;
  result.z += a3 * sin(phase3);
  result.xy += Q * a3 * d3 * cos(phase3);

  // Wave 4
  vec2 d4 = normalize(vec2(0.5, 0.8));
  float f4 = 3.2;
  float a4 = 0.06 * u_height;
  float phase4 = dot(d4, pos) * f4 + t * 1.4;
  result.z += a4 * sin(phase4);
  result.xy += Q * a4 * d4 * cos(phase4);

  // Wave 5
  vec2 d5 = normalize(vec2(-0.7, -0.4));
  float f5 = 4.1;
  float a5 = 0.04 * u_height;
  float phase5 = dot(d5, pos) * f5 + t * 0.8;
  result.z += a5 * sin(phase5);
  result.xy += Q * a5 * d5 * cos(phase5);

  return result;
}
```

#### Ray-Surface Intersection (Iterative)

Since the Gerstner surface displaces horizontally, the height at a given screen position requires iterative convergence (the surface point that projects to this pixel is NOT directly below it):

```glsl
// Camera: looking down at oblique angle
// For each fragment, project a ray from camera to water plane
// Iterate to find where the ray meets the displaced surface

float getWaveHeight(vec2 pos, float t) {
  vec2 p = pos;
  // 4 iterations to converge (Gerstner horizontal displacement feedback)
  for (int i = 0; i < 4; i++) {
    vec3 disp = gerstnerDisplacement(p, t, u_chop);
    p = pos - disp.xy; // Undo horizontal displacement
  }
  return gerstnerDisplacement(p, t, u_chop).z;
}
```

#### Surface Normals via Finite Differences

```glsl
vec3 getNormal(vec2 pos, float t) {
  float eps = 0.01;
  float hL = getWaveHeight(pos - vec2(eps, 0.0), t);
  float hR = getWaveHeight(pos + vec2(eps, 0.0), t);
  float hD = getWaveHeight(pos - vec2(0.0, eps), t);
  float hU = getWaveHeight(pos + vec2(0.0, eps), t);
  return normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
}
```

#### Fresnel Reflection

```glsl
// View direction (camera looking down at angle)
vec3 viewDir = normalize(vec3(0.0, 1.0, 0.5));

// Fresnel: Schlick approximation
float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);
fresnel = mix(0.02, 1.0, fresnel); // Water has low base reflectance

// Sky reflection color: blend brand palette for sky gradient
vec3 skyColor = mix(u_bgColor * 1.5, u_brandPrimary * 0.8, normal.y * 0.5 + 0.5);
```

#### Subsurface Scattering

```glsl
// SSS: light passing through wave crests (warm tint from secondary color)
float sss = pow(max(dot(viewDir, -normal), 0.0), 3.0) * u_depth;
vec3 sssColor = u_brandSecondary * sss * 0.6;
```

#### Specular Sun Highlight

```glsl
vec3 sunDir = normalize(vec3(0.5, 0.8, 0.3)); // Sun position
vec3 halfVec = normalize(sunDir + viewDir);
float spec = pow(max(dot(normal, halfVec), 0.0), 128.0);
vec3 specColor = vec3(1.0) * spec * 0.8; // White specular
```

#### Foam at Crests

```glsl
// Foam: appears at wave crests (high height values)
float waveH = getWaveHeight(pos, t);
float foamMask = smoothstep(0.15, 0.35, waveH) * u_foam;

// Noise-based foam texture (cheap hash noise)
float foamNoise = hash(pos * 30.0 + t * 2.0) * 0.5 + 0.5;
foamMask *= foamNoise;

vec3 foamColor = u_brandAccent * foamMask;
```

#### Compositing

```glsl
// Deep water base
vec3 deepWater = u_bgColor * 0.5;

// Wave body color (primary, modulated by height)
vec3 waterBody = mix(deepWater, u_brandPrimary, clamp(waveH * 2.0 + 0.5, 0.0, 1.0));

// Apply Fresnel reflection
vec3 color = mix(waterBody, skyColor, fresnel * 0.4);

// Add subsurface scattering
color += sssColor;

// Add specular highlight
color += specColor;

// Add foam
color += foamColor;
```

### Mouse Interaction

Mouse position shifts the effective wind direction, rotating all 5 wave direction vectors toward the cursor. This creates a subtle but visible change in wave pattern orientation as the cursor moves.

Click creates a splash disturbance — a radial displacement added to the wave height that decays with distance from the click point:

```glsl
// Wind direction shift from mouse position
float windAngle = (u_mouse.x - 0.5) * 1.5; // +/- 0.75 radians
mat2 windRot = mat2(cos(windAngle), -sin(windAngle), sin(windAngle), cos(windAngle));
// Apply windRot to each wave direction in gerstnerDisplacement when mouseActive

// Click splash
vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
vec2 fragUV = vec2(uv.x * aspect, uv.y);
float splashDist = distance(fragUV, mouseUV);
float splash = u_burst * 0.3 * sin(splashDist * 30.0 - u_time * 8.0) * exp(-splashDist * 5.0);
waveH += splash;
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

- Export as `export const WAVES_FRAG = \`#version 300 es...`
- 5 hardcoded waves (no dynamic loop count) — all parameters inlined for GPU friendliness
- 4 iterations for ray-surface convergence — fixed count, no branching
- Finite difference epsilon = 0.01 for normal computation
- Aspect ratio correction: `vec2 p = vec2(uv.x * aspect, uv.y) * scale;`
- Wind rotation applied via `u_mouseActive` gate so static scene is stable when mouse absent
- Hash for grain: same `hash(vec2)` function as topo/ocean shaders
- Total fragment cost: ~40 sin/cos pairs per fragment (5 waves x 4 convergence iterations + 4 finite difference samples). This is heavier than simple single-pass presets but still well within budget for a single-pass shader — comparable to multi-layer presets like physarum/turing display passes

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
uniform float u_height;
uniform float u_speed;
uniform float u_chop;
uniform float u_foam;
uniform float u_depth;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

float hash(vec2 p) { /* same as topo */ }

// Wind rotation from mouse
mat2 getWindRotation() {
  float angle = u_mouseActive * (u_mouse.x - 0.5) * 1.5;
  float c = cos(angle), s = sin(angle);
  return mat2(c, -s, s, c);
}

// Gerstner displacement: 5 superposed waves
vec3 gerstnerDisplacement(vec2 pos, float t) {
  mat2 windRot = getWindRotation();
  vec3 result = vec3(0.0);
  float Q = u_chop;

  // Wave 1-5 (inlined, directions rotated by windRot)
  // ...
  return result;
}

// Iterative height solve (4 iterations)
float getWaveHeight(vec2 pos, float t) {
  vec2 p = pos;
  for (int i = 0; i < 4; i++) {
    vec3 d = gerstnerDisplacement(p, t);
    p = pos - d.xy;
  }
  return gerstnerDisplacement(p, t).z;
}

// Finite difference normal
vec3 getNormal(vec2 pos, float t) {
  float eps = 0.01;
  float hL = getWaveHeight(pos - vec2(eps, 0.0), t);
  float hR = getWaveHeight(pos + vec2(eps, 0.0), t);
  float hD = getWaveHeight(pos - vec2(0.0, eps), t);
  float hU = getWaveHeight(pos + vec2(0.0, eps), t);
  return normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
}

void main() {
  float t = u_time * u_speed;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv;

  // Scale to world space
  vec2 pos = vec2(uv.x * aspect, uv.y) * 4.0; // 4.0 = world scale

  // -- Wave height + mouse splash --
  float waveH = getWaveHeight(pos, t);

  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
  vec2 fragUV = vec2(uv.x * aspect, uv.y);
  float splashDist = distance(fragUV, mouseUV);
  float splash = u_burst * 0.3 * sin(splashDist * 30.0 - u_time * 8.0) * exp(-splashDist * 5.0);
  waveH += splash;

  // -- Surface normal --
  vec3 normal = getNormal(pos, t);

  // -- Fresnel --
  vec3 viewDir = normalize(vec3(0.0, 1.0, 0.5));
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);
  fresnel = mix(0.02, 1.0, fresnel);

  // -- Sky reflection --
  vec3 skyColor = mix(u_bgColor * 1.5, u_brandPrimary * 0.8, normal.y * 0.5 + 0.5);

  // -- Deep water + wave body --
  vec3 deepWater = u_bgColor * 0.5;
  vec3 waterBody = mix(deepWater, u_brandPrimary, clamp(waveH * 2.0 + 0.5, 0.0, 1.0));

  // -- Composite --
  vec3 color = mix(waterBody, skyColor, fresnel * 0.4);

  // Subsurface scattering
  float sss = pow(max(dot(viewDir, -normal), 0.0), 3.0) * u_depth;
  color += u_brandSecondary * sss * 0.6;

  // Specular
  vec3 sunDir = normalize(vec3(0.5, 0.8, 0.3));
  vec3 halfVec = normalize(sunDir + viewDir);
  float spec = pow(max(dot(normal, halfVec), 0.0), 128.0);
  color += vec3(1.0) * spec * 0.8;

  // Foam
  float foamMask = smoothstep(0.15, 0.35, waveH) * u_foam;
  foamMask *= hash(pos * 30.0 + t * 2.0) * 0.5 + 0.5;
  color += u_brandAccent * foamMask;

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

## Renderer (waves-renderer.ts)

Single-pass, follows topo-renderer pattern exactly:
- One program (no FBOs)
- Pass all uniforms each frame
- All uniforms are `gl.uniform1f()` (no int uniforms needed — wave count and iteration count are fixed in the shader)
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
  'u_height',
  'u_speed',
  'u_chop',
  'u_foam',
  'u_depth',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;
```

### Renderer Structure

```typescript
import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, WavesConfig } from '../shader-config';
import { WAVES_FRAG } from '../shaders/waves.frag';
import { createProgram, createQuad, drawQuad, getUniforms, VERTEX_SHADER } from '../webgl-utils';

const DEFAULTS = {
  height: 1.0,
  speed: 1.0,
  chop: 0.7,
  foam: 0.3,
  depth: 0.6,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createWavesRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<...> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  return {
    init(gl, width, height) {
      program = createProgram(gl, VERTEX_SHADER, WAVES_FRAG);
      if (!program) return false;
      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);
      return true;
    },

    render(gl, time, mouse, config, width, height) {
      if (!program || !uniforms || !quad) return;
      const cfg = config as WavesConfig;

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

      gl.uniform1f(uniforms.u_height, cfg.height ?? DEFAULTS.height);
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      gl.uniform1f(uniforms.u_chop, cfg.chop ?? DEFAULTS.chop);
      gl.uniform1f(uniforms.u_foam, cfg.foam ?? DEFAULTS.foam);
      gl.uniform1f(uniforms.u_depth, cfg.depth ?? DEFAULTS.depth);
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

Add `'waves'` to the union:
```typescript
export type ShaderPresetId = '...' | 'waves' | 'none';
```

### WavesConfig

```typescript
export interface WavesConfig extends ShaderConfigBase {
  preset: 'waves';
  height: number;
  speed: number;
  chop: number;
  foam: number;
  depth: number;
}
```

### ShaderConfig union

Add `| WavesConfig` to the union type.

### DEFAULTS

```typescript
// Waves
wavesHeight: 1.0,
wavesSpeed: 1.0,
wavesChop: 0.7,
wavesFoam: 0.3,
wavesDepth: 0.6,
```

### Switch case

```typescript
case 'waves':
  return {
    ...base,
    preset: 'waves',
    height: rv('shader-waves-height', DEFAULTS.wavesHeight),
    speed: rv('shader-waves-speed', DEFAULTS.wavesSpeed),
    chop: rv('shader-waves-chop', DEFAULTS.wavesChop),
    foam: rv('shader-waves-foam', DEFAULTS.wavesFoam),
    depth: rv('shader-waves-depth', DEFAULTS.wavesDepth),
  };
```

## ShaderHero.svelte Changes

Add to `loadRenderer()` switch:

```typescript
case 'waves': {
  const { createWavesRenderer } = await import('./renderers/waves-renderer');
  return createWavesRenderer();
}
```

## Brand Editor Changes

### BrandEditorHeroEffects.svelte

**PRESETS array**: Add entry:
```typescript
{ id: 'waves', label: 'Waves', description: 'Gerstner ocean surface' },
```

**DEFAULTS record**: Add entries:
```typescript
'shader-waves-height': '1.0',
'shader-waves-speed': '1.0',
'shader-waves-chop': '0.70',
'shader-waves-foam': '0.30',
'shader-waves-depth': '0.60',
```

**Derived state**: Add:
```typescript
// Waves
const wavesHeight = $derived(readNum('shader-waves-height'));
const wavesSpeed = $derived(readNum('shader-waves-speed'));
const wavesChop = $derived(readNum('shader-waves-chop'));
const wavesFoam = $derived(readNum('shader-waves-foam'));
const wavesDepth = $derived(readNum('shader-waves-depth'));
```

**Slider section**: Add `{:else if activePreset === 'waves'}` block before the `{/if}`.

### Brand Editor Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| `shader-waves-height` | Wave Height | 0.5 | 2.0 | 0.1 | 1.0 | Flat | Tall |
| `shader-waves-speed` | Wave Speed | 0.5 | 2.0 | 0.1 | 1.0 | Slow | Fast |
| `shader-waves-chop` | Choppiness | 0.3 | 1.0 | 0.05 | 0.70 | Smooth | Choppy |
| `shader-waves-foam` | Foam Amount | 0.0 | 1.0 | 0.05 | 0.30 | None | Heavy |
| `shader-waves-depth` | Water Depth | 0.3 | 1.0 | 0.05 | 0.60 | Murky | Clear |

### Slider Section Template

```svelte
{:else if activePreset === 'waves'}
  <section class="hero-fx__section">
    <span class="hero-fx__section-label">Waves</span>
    <BrandSliderField id="shader-waves-height" label="Wave Height" value={wavesHeight.toFixed(1)} min={0.5} max={2.0} step={0.1} current={wavesHeight} minLabel="Flat" maxLabel="Tall" oninput={handleSliderInput('shader-waves-height')} />
    <BrandSliderField id="shader-waves-speed" label="Wave Speed" value={wavesSpeed.toFixed(1)} min={0.5} max={2.0} step={0.1} current={wavesSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-waves-speed')} />
    <BrandSliderField id="shader-waves-chop" label="Choppiness" value={wavesChop.toFixed(2)} min={0.3} max={1.0} step={0.05} current={wavesChop} minLabel="Smooth" maxLabel="Choppy" oninput={handleSliderInput('shader-waves-chop')} />
    <BrandSliderField id="shader-waves-foam" label="Foam Amount" value={wavesFoam.toFixed(2)} min={0.0} max={1.0} step={0.05} current={wavesFoam} minLabel="None" maxLabel="Heavy" oninput={handleSliderInput('shader-waves-foam')} />
    <BrandSliderField id="shader-waves-depth" label="Water Depth" value={wavesDepth.toFixed(2)} min={0.3} max={1.0} step={0.05} current={wavesDepth} minLabel="Murky" maxLabel="Clear" oninput={handleSliderInput('shader-waves-depth')} />
  </section>
```

## Brand Color Mapping

| Visual Element | Color Source | Notes |
|----------------|-------------|-------|
| Deep water / background | `u_bgColor` darkened | Dark ocean depths |
| Wave body (surface) | `u_brandPrimary` | Main water color — blue, teal, green |
| Subsurface scatter (light through waves) | `u_brandSecondary` | Warm tint — light passing through thin crests |
| Foam / crest highlights | `u_brandAccent` | Bright white-ish highlights at breaking crests |
| Specular sun | White (`vec3(1.0)`) | Sun reflection is always white |
| Sky reflection gradient | `u_bgColor` to `u_brandPrimary` | Reflected sky uses brand palette |

Ocean-themed brand palettes (blues, teals, greens) look spectacular, but any palette produces coherent results because the four-role system maps naturally to the visual hierarchy: dark depths → colored water → warm transmitted light → bright foam.

## Performance Notes

- **Single-pass, no FBO** — cheapest possible architecture
- **5 fixed waves** (not configurable) — avoids dynamic loop branching
- **4 convergence iterations** for ray-surface intersection — fixed count
- **4 finite difference samples** for normals — each calls getWaveHeight (which internally does 4 convergence iterations)
- **Total fragment cost**: ~40 sin/cos pairs per fragment. This is the heaviest single-pass preset but still well within budget. For comparison, suture's display pass is similar cost, and multi-pass presets (turing, physarum) do far more per frame
- **No additional textures** — all procedural
- **Mobile DPR capped at 1** by ShaderHero.svelte (existing behaviour)
- **Optimization path**: If too heavy on low-end mobile, reduce convergence iterations from 4 to 2 (visible quality loss but acceptable) or reduce wave count from 5 to 3

## Gotchas

1. **BRAND_PREFIX_KEYS** — all 5 keys MUST be registered in `css-injection.ts` or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and ShaderHero never reads them)
2. **No naming collisions** — all keys namespaced as `shader-waves-*` to avoid collision with existing `shader-wave-speed` (ripple), `shader-speed` (warp), etc.
3. **Export pattern** — shader string exported as `export const WAVES_FRAG = \`#version 300 es...`
4. **Post-processing chain** — MUST follow: Reinhard tone map -> `min(color, 0.75)` brightness cap -> `mix(u_bgColor, color, u_intensity)` intensity blend -> vignette -> grain -> `clamp(color, 0.0, 0.75)` final cap
5. **Gerstner convergence** — the iterative solve `p = pos - disp.xy` MUST use 4 iterations. Fewer causes visible swimming/jitter artifacts. More is wasted GPU time
6. **Normal epsilon** — 0.01 is the sweet spot for finite differences. Too small = noise from float precision. Too large = smooth normals (loses detail)
7. **Wind rotation stability** — when `u_mouseActive` is 0.0, wind angle must be 0.0 (no rotation). Use `u_mouseActive *` as a gate so the wave pattern is stable when the mouse is not hovering
8. **Foam noise coherence** — the hash-based foam noise must include time offset (`+ t * 2.0`) for animated sparkle, but keep the spatial frequency high (`pos * 30.0`) so individual foam patches are small
9. **Aspect correction** — both mouse UV and fragment UV must use the same aspect-corrected space for splash to be circular
10. **Chop parameter range** — Gerstner Q > 1.0 causes wave profile self-intersection (loops). Clamped to 0.3-1.0 in the slider to stay safe. The shader itself should also clamp: `float Q = clamp(u_chop, 0.0, 1.0);`

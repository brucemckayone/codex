# Clouds (Procedural Sky Clouds) Shader Preset — Implementation Plan

## Overview

Add a "clouds" shader preset: procedural sky with volumetric-looking clouds using simplex FBM with ridged noise. Two-layer approach — ridged noise for cloud shape, regular noise for cloud density — composited over a sky gradient background. Very cheap and beautiful: 8 octaves of FBM but using simple 2D simplex noise. Single-pass (no FBO). Mouse shifts wind direction/speed. Click clears clouds near cursor momentarily.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify — add `CloudsConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/clouds.frag.ts` | Create — single-pass fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/clouds-renderer.ts` | Create — single-pass renderer |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify — add `'clouds'` to loadRenderer |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify — add 5 keys to BRAND_PREFIX_KEYS |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify — preset card + sliders |

## Config Interface

```typescript
export interface CloudsConfig extends ShaderConfigBase {
  preset: 'clouds';
  cover: number;      // 0.0-0.5, default 0.2 — Cloud coverage amount
  speed: number;      // 0.01-0.06, default 0.03 — Wind/drift speed
  scale: number;      // 0.5-2.0, default 1.1 — Cloud pattern scale
  dark: number;       // 0.2-0.8, default 0.5 — Cloud shadow depth
  light: number;      // 0.1-0.5, default 0.3 — Cloud highlight brightness
}
```

## Defaults

```typescript
// Clouds
cloudsCover: 0.2,
cloudsSpeed: 0.03,
cloudsScale: 1.1,
cloudsDark: 0.5,
cloudsLight: 0.3,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

```
shader-clouds-cover
shader-clouds-speed
shader-clouds-scale
shader-clouds-dark
shader-clouds-light
```

All 5 keys MUST be added to the `BRAND_PREFIX_KEYS` Set in `apps/web/src/lib/brand-editor/css-injection.ts`. Without this, the brand editor injects them with `--color-` prefix instead of `--brand-` prefix, and `getShaderConfig()` (which reads `--brand-shader-*`) will never see them.

## Fragment Shader (clouds.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `u_time` | `float` | Elapsed seconds |
| `u_resolution` | `vec2` | Canvas pixel dimensions |
| `u_mouse` | `vec2` | Normalized mouse (0-1) |
| `u_mouseActive` | `float` | 1.0 when hovering |
| `u_burst` | `float` | Click burst strength |
| `u_brandPrimary` | `vec3` | Brand primary (cloud highlights) |
| `u_brandSecondary` | `vec3` | Brand secondary (sky gradient top) |
| `u_brandAccent` | `vec3` | Brand accent (cloud ridges / sunlit edges) |
| `u_bgColor` | `vec3` | Background (sky gradient bottom) |
| `u_cover` | `float` | Cloud coverage amount |
| `u_speed` | `float` | Wind/drift speed |
| `u_scale` | `float` | Cloud pattern scale |
| `u_dark` | `float` | Cloud shadow depth |
| `u_light` | `float` | Cloud highlight brightness |
| `u_intensity` | `float` | Overall blend |
| `u_grain` | `float` | Film grain |
| `u_vignette` | `float` | Vignette strength |

### Algorithm — Two-Layer FBM Cloud System

#### Core: 2D Simplex Noise

A fast 2D simplex noise function — the building block for all FBM:

```glsl
// Permutation hash
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289((x * 34.0 + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187,   // (3.0-sqrt(3.0))/6.0
                       0.366025403784439,   // 0.5*(sqrt(3.0)-1.0)
                      -0.577350269189626,   // -1.0 + 2.0 * C.x
                       0.024390243902439);  // 1.0 / 41.0

  // First corner
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);

  // Other corners
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;

  // Permutations
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));

  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m * m;
  m = m * m;

  // Gradients
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;

  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);

  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;

  return 130.0 * dot(m, g);
}
```

#### Layer 1: Ridged Noise FBM (Cloud Shape)

Ridged noise inverts the absolute value of noise, creating sharp ridges that look like cloud edges:

```glsl
// Ridged noise: abs(noise) inverted = sharp ridges
float ridgedNoise(vec2 p) {
  return 1.0 - abs(snoise(p));
}

// 4 octaves of ridged FBM for cloud shape
float cloudShape(vec2 p, float t) {
  float f = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  float totalAmp = 0.0;

  // Wind drift
  vec2 drift = vec2(t * 0.6, t * 0.3);

  const mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);

  for (int i = 0; i < 4; i++) {
    f += amp * ridgedNoise(p * freq + drift);
    totalAmp += amp;
    freq *= 2.0;
    amp *= 0.5;
    p = rot * p;
    drift *= 1.3;
  }

  return f / totalAmp;
}
```

#### Layer 2: Regular Noise FBM (Cloud Density)

Standard smooth FBM for soft density variations within the cloud body:

```glsl
// 4 octaves of smooth FBM for density detail
float cloudDensity(vec2 p, float t) {
  float f = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  float totalAmp = 0.0;

  vec2 drift = vec2(t * 0.4, t * 0.2);
  const mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);

  for (int i = 0; i < 4; i++) {
    f += amp * snoise(p * freq + drift);
    totalAmp += amp;
    freq *= 2.0;
    amp *= 0.5;
    p = rot * p;
    drift *= 1.2;
  }

  return (f / totalAmp) * 0.5 + 0.5; // Remap to 0..1
}
```

#### Cloud Compositing

```glsl
void main() {
  float t = u_time * u_speed;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv;

  // -- Sky gradient (bottom to top: bg -> secondary) --
  vec3 skyBottom = u_bgColor;
  vec3 skyTop = u_brandSecondary;
  vec3 skyColor = mix(skyBottom, skyTop, uv.y * 0.8 + 0.1);

  // -- Aspect-corrected cloud coordinates --
  vec2 p = vec2(uv.x * aspect, uv.y) * u_scale;

  // -- Mouse wind shift --
  // Mouse X shifts wind direction, giving apparent control over cloud drift
  vec2 windShift = u_mouseActive * vec2(
    (u_mouse.x - 0.5) * 0.3,
    (u_mouse.y - 0.5) * 0.15
  );
  p += windShift * t * 10.0;

  // -- Click clears clouds near cursor --
  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
  vec2 fragUV = vec2(uv.x * aspect, uv.y);
  float mouseDist = distance(fragUV, mouseUV);
  float clearMask = 1.0 - u_burst * exp(-mouseDist * mouseDist * 10.0);

  // -- Cloud shape (ridged FBM) --
  float shape = cloudShape(p, t);

  // -- Cloud density (smooth FBM) --
  float density = cloudDensity(p * 1.5, t * 0.7);

  // -- Combine: shape determines presence, density modulates --
  float cloud = shape * density;

  // -- Coverage threshold (controls how much sky is covered) --
  cloud = smoothstep(u_cover, u_cover + 0.3, cloud);

  // -- Apply click clear mask --
  cloud *= clearMask;

  // -- Cloud coloring --
  // Dark undersides
  vec3 cloudDarkColor = u_brandPrimary * (1.0 - u_dark);

  // Bright tops (primary lightened)
  vec3 cloudLightColor = u_brandPrimary * (1.0 + u_light) + vec3(u_light * 0.5);

  // Ridge accent glow (accent color on ridged edges)
  float ridgeGlow = pow(shape, 3.0) * 0.5;
  vec3 ridgeColor = u_brandAccent * ridgeGlow;

  // Cloud brightness from density (dark undersides, bright tops)
  float brightness = density * 0.7 + 0.3;
  vec3 cloudColor = mix(cloudDarkColor, cloudLightColor, brightness);
  cloudColor += ridgeColor;

  // -- Composite cloud over sky --
  vec3 color = mix(skyColor, cloudColor, cloud);

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

**Hover**: Mouse X/Y position offsets the wind direction vector applied to the cloud UV coordinates. Moving the mouse left/right and up/down subtly shifts where clouds appear, creating the impression of controlling wind direction. The shift is proportional to time so the drift accumulates naturally.

**Click**: Creates a circular clear zone around the cursor that dissipates clouds momentarily. Uses an exponential falloff from the click point (`exp(-dist^2 * 10.0)`), multiplied with the `u_burst` value that decays over frames. The result feels like blowing clouds away from the cursor.

```glsl
// Click clear mask
float clearMask = 1.0 - u_burst * exp(-mouseDist * mouseDist * 10.0);
cloud *= clearMask; // Multiplies cloud density, so 0 = clear sky
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

- Export as `export const CLOUDS_FRAG = \`#version 300 es...`
- Total 8 octaves of FBM across both layers (4 ridged + 4 smooth) — but each is cheap 2D simplex noise, not volumetric
- Ridged noise: `1.0 - abs(snoise(p))` — the inversion creates sharp cloud edges
- Coverage threshold via `smoothstep(cover, cover + 0.3, cloud)` — the 0.3 transition width ensures soft cloud boundaries
- Wind drift: each octave drifts at a different speed (via `drift *= 1.3`) for parallax effect between cloud layers
- Rotation between octaves (`mat2(0.8, 0.6, -0.6, 0.8)`) prevents directional artifacts
- Hash for grain: same `hash(vec2)` function as topo/ocean shaders
- Total fragment cost: ~20 snoise calls per fragment (8 octaves x 2 layers + some reuse). Simplex noise is very cheap — comparable to existing presets

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
uniform float u_cover;
uniform float u_speed;
uniform float u_scale;
uniform float u_dark;
uniform float u_light;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

float hash(vec2 p) { /* same as topo */ }

// Simplex noise (full implementation)
float snoise(vec2 v) { /* ... see above ... */ }

// Ridged noise
float ridgedNoise(vec2 p) {
  return 1.0 - abs(snoise(p));
}

// Ridged FBM — cloud shape (4 octaves)
float cloudShape(vec2 p, float t) { /* ... see above ... */ }

// Smooth FBM — cloud density (4 octaves)
float cloudDensity(vec2 p, float t) { /* ... see above ... */ }

void main() {
  float t = u_time * u_speed;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv;

  // Sky gradient
  vec3 skyColor = mix(u_bgColor, u_brandSecondary, uv.y * 0.8 + 0.1);

  // Cloud coordinates
  vec2 p = vec2(uv.x * aspect, uv.y) * u_scale;

  // Mouse wind shift
  p += u_mouseActive * vec2((u_mouse.x - 0.5) * 0.3, (u_mouse.y - 0.5) * 0.15) * t * 10.0;

  // Click clear mask
  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
  vec2 fragUV = vec2(uv.x * aspect, uv.y);
  float mouseDist = distance(fragUV, mouseUV);
  float clearMask = 1.0 - u_burst * exp(-mouseDist * mouseDist * 10.0);

  // Cloud layers
  float shape = cloudShape(p, t);
  float density = cloudDensity(p * 1.5, t * 0.7);
  float cloud = shape * density;
  cloud = smoothstep(u_cover, u_cover + 0.3, cloud);
  cloud *= clearMask;

  // Cloud color
  vec3 cloudDarkColor = u_brandPrimary * (1.0 - u_dark);
  vec3 cloudLightColor = u_brandPrimary * (1.0 + u_light) + vec3(u_light * 0.5);
  float ridgeGlow = pow(shape, 3.0) * 0.5;
  float brightness = density * 0.7 + 0.3;
  vec3 cloudColor = mix(cloudDarkColor, cloudLightColor, brightness);
  cloudColor += u_brandAccent * ridgeGlow;

  // Composite
  vec3 color = mix(skyColor, cloudColor, cloud);

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

## Renderer (clouds-renderer.ts)

Single-pass, follows topo-renderer pattern exactly:
- One program (no FBOs)
- Pass all uniforms each frame
- All uniforms are `gl.uniform1f()` (no int uniforms needed — octave counts are fixed in the shader)
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
  'u_cover',
  'u_speed',
  'u_scale',
  'u_dark',
  'u_light',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;
```

### Renderer Structure

```typescript
import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, CloudsConfig } from '../shader-config';
import { CLOUDS_FRAG } from '../shaders/clouds.frag';
import { createProgram, createQuad, drawQuad, getUniforms, VERTEX_SHADER } from '../webgl-utils';

const DEFAULTS = {
  cover: 0.2,
  speed: 0.03,
  scale: 1.1,
  dark: 0.5,
  light: 0.3,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createCloudsRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<...> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  return {
    init(gl, width, height) {
      program = createProgram(gl, VERTEX_SHADER, CLOUDS_FRAG);
      if (!program) return false;
      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);
      return true;
    },

    render(gl, time, mouse, config, width, height) {
      if (!program || !uniforms || !quad) return;
      const cfg = config as CloudsConfig;

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

      gl.uniform1f(uniforms.u_cover, cfg.cover ?? DEFAULTS.cover);
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      gl.uniform1f(uniforms.u_scale, cfg.scale ?? DEFAULTS.scale);
      gl.uniform1f(uniforms.u_dark, cfg.dark ?? DEFAULTS.dark);
      gl.uniform1f(uniforms.u_light, cfg.light ?? DEFAULTS.light);
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

Add `'clouds'` to the union:
```typescript
export type ShaderPresetId = '...' | 'clouds' | 'none';
```

### CloudsConfig

```typescript
export interface CloudsConfig extends ShaderConfigBase {
  preset: 'clouds';
  cover: number;
  speed: number;
  scale: number;
  dark: number;
  light: number;
}
```

### ShaderConfig union

Add `| CloudsConfig` to the union type.

### DEFAULTS

```typescript
// Clouds
cloudsCover: 0.2,
cloudsSpeed: 0.03,
cloudsScale: 1.1,
cloudsDark: 0.5,
cloudsLight: 0.3,
```

### Switch case

```typescript
case 'clouds':
  return {
    ...base,
    preset: 'clouds',
    cover: rv('shader-clouds-cover', DEFAULTS.cloudsCover),
    speed: rv('shader-clouds-speed', DEFAULTS.cloudsSpeed),
    scale: rv('shader-clouds-scale', DEFAULTS.cloudsScale),
    dark: rv('shader-clouds-dark', DEFAULTS.cloudsDark),
    light: rv('shader-clouds-light', DEFAULTS.cloudsLight),
  };
```

## ShaderHero.svelte Changes

Add to `loadRenderer()` switch:

```typescript
case 'clouds': {
  const { createCloudsRenderer } = await import('./renderers/clouds-renderer');
  return createCloudsRenderer();
}
```

## Brand Editor Changes

### BrandEditorHeroEffects.svelte

**PRESETS array**: Add entry:
```typescript
{ id: 'clouds', label: 'Clouds', description: 'Procedural sky clouds' },
```

**DEFAULTS record**: Add entries:
```typescript
'shader-clouds-cover': '0.20',
'shader-clouds-speed': '0.03',
'shader-clouds-scale': '1.10',
'shader-clouds-dark': '0.50',
'shader-clouds-light': '0.30',
```

**Derived state**: Add:
```typescript
// Clouds
const cloudsCover = $derived(readNum('shader-clouds-cover'));
const cloudsSpeed = $derived(readNum('shader-clouds-speed'));
const cloudsScale = $derived(readNum('shader-clouds-scale'));
const cloudsDark = $derived(readNum('shader-clouds-dark'));
const cloudsLight = $derived(readNum('shader-clouds-light'));
```

**Slider section**: Add `{:else if activePreset === 'clouds'}` block before the `{/if}`.

### Brand Editor Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| `shader-clouds-cover` | Cloud Cover | 0.0 | 0.5 | 0.02 | 0.20 | Clear | Overcast |
| `shader-clouds-speed` | Wind Speed | 0.01 | 0.06 | 0.005 | 0.03 | Still | Breezy |
| `shader-clouds-scale` | Cloud Scale | 0.5 | 2.0 | 0.1 | 1.10 | Small | Large |
| `shader-clouds-dark` | Shadow Depth | 0.2 | 0.8 | 0.05 | 0.50 | Flat | Deep |
| `shader-clouds-light` | Highlight | 0.1 | 0.5 | 0.05 | 0.30 | Dim | Bright |

### Slider Section Template

```svelte
{:else if activePreset === 'clouds'}
  <section class="hero-fx__section">
    <span class="hero-fx__section-label">Clouds</span>
    <BrandSliderField id="shader-clouds-cover" label="Cloud Cover" value={cloudsCover.toFixed(2)} min={0.0} max={0.5} step={0.02} current={cloudsCover} minLabel="Clear" maxLabel="Overcast" oninput={handleSliderInput('shader-clouds-cover')} />
    <BrandSliderField id="shader-clouds-speed" label="Wind Speed" value={cloudsSpeed.toFixed(3)} min={0.01} max={0.06} step={0.005} current={cloudsSpeed} minLabel="Still" maxLabel="Breezy" oninput={handleSliderInput('shader-clouds-speed')} />
    <BrandSliderField id="shader-clouds-scale" label="Cloud Scale" value={cloudsScale.toFixed(1)} min={0.5} max={2.0} step={0.1} current={cloudsScale} minLabel="Small" maxLabel="Large" oninput={handleSliderInput('shader-clouds-scale')} />
    <BrandSliderField id="shader-clouds-dark" label="Shadow Depth" value={cloudsDark.toFixed(2)} min={0.2} max={0.8} step={0.05} current={cloudsDark} minLabel="Flat" maxLabel="Deep" oninput={handleSliderInput('shader-clouds-dark')} />
    <BrandSliderField id="shader-clouds-light" label="Highlight" value={cloudsLight.toFixed(2)} min={0.1} max={0.5} step={0.05} current={cloudsLight} minLabel="Dim" maxLabel="Bright" oninput={handleSliderInput('shader-clouds-light')} />
  </section>
```

## Brand Color Mapping

| Visual Element | Color Source | Notes |
|----------------|-------------|-------|
| Sky gradient bottom | `u_bgColor` | Horizon / lower sky |
| Sky gradient top | `u_brandSecondary` | Upper sky — blue, teal, or any palette color |
| Cloud body (highlights + shadows) | `u_brandPrimary` | Main cloud mass — lightened for tops, darkened for undersides |
| Cloud ridge glow / sunlit edges | `u_brandAccent` | Bright edge highlights from ridged noise peaks |
| Cloud dark undersides | `u_brandPrimary * (1.0 - dark)` | Shadow within cloud volume |

Warm palettes (sunset) produce golden clouds over warm skies. Cool palettes (ocean) produce silvery clouds over blue gradients. Any palette works because the sky gradient and cloud body are naturally separated — sky is secondary+bg, clouds are primary+accent.

## Performance Notes

- **Single-pass, no FBO** — cheapest possible architecture
- **8 total FBM octaves** (4 ridged + 4 smooth) — but each is a 2D simplex noise evaluation, which is very cheap (~10 ALU ops per noise call)
- **No raymarching** — this is a 2D cloud sheet, not volumetric. Height is implicit via brightness
- **Fixed octave counts** — no dynamic loops
- **Total fragment cost**: ~20 simplex noise evaluations per fragment. This is cheaper than most existing presets (nebula does 8-octave FBM in 3D, for comparison)
- **No additional textures** — all procedural
- **Mobile DPR capped at 1** by ShaderHero.svelte (existing behaviour)

## Gotchas

1. **BRAND_PREFIX_KEYS** — all 5 keys MUST be registered in `css-injection.ts` or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and ShaderHero never reads them)
2. **No naming collisions** — all keys namespaced as `shader-clouds-*` to avoid collision with existing `shader-speed`, `shader-scale`, etc.
3. **Export pattern** — shader string exported as `export const CLOUDS_FRAG = \`#version 300 es...`
4. **Post-processing chain** — MUST follow: Reinhard tone map -> `min(color, 0.75)` brightness cap -> `mix(u_bgColor, color, u_intensity)` intensity blend -> vignette -> grain -> `clamp(color, 0.0, 0.75)` final cap
5. **Coverage smoothstep transition** — the transition width (`u_cover + 0.3`) is critical. Too narrow = hard cloud edges. Too wide = no clear sky at all. 0.3 is a good default that gives soft, natural-looking boundaries
6. **Wind drift per octave** — each FBM octave must drift at a slightly different rate (`drift *= 1.3` between octaves) to create the illusion of depth. Without this, clouds look like a flat texture scrolling uniformly
7. **Ridged noise power curve** — `pow(shape, 3.0)` for ridge glow concentrates the accent color onto the sharpest ridges. Without the power curve, accent would bleed into the entire cloud body
8. **Mouse wind shift accumulates with time** — the `* t * 10.0` factor means mouse position has a growing effect. This is intentional: it makes the wind feel like it is being redirected, not just displacing the cloud pattern. However, the 0.3 and 0.15 multipliers must stay small to prevent wild jumps
9. **Click clear must use burst decay** — the `u_burst` value decays over frames (handled by ShaderHero's mouse state), so the clear zone naturally fills back in. No manual decay needed in the shader
10. **Simplex noise precision** — the `mod289` operations prevent floating-point overflow for large input values. Without them, the noise breaks down at high coordinate values (which happens when time accumulates)

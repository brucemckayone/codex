# Tendrils (Curl Noise Tendrils) Shader Preset -- Implementation Plan

## Overview

Add a "tendrils" shader preset: soft flowing tendrils of light drifting and curling like jellyfish tentacles or smoke plumes. A continuous density field driven by curl noise. Tendrils never cross or bunch up (divergence-free). Ethereal, deep-sea bioluminescent quality. Single-pass (no FBO). Generate 2D curl noise field from the cross-product of the gradient of 3D noise. Use this velocity field to advect UV coordinates backward in time (Euler, 3-5 steps). Accumulate density along the advected path. Smooth flowing streamlines create tendril shapes naturally.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify -- add `TendrilsConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/tendrils.frag.ts` | Create -- single-pass fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/tendrils-renderer.ts` | Create -- single-pass renderer |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify -- add `'tendrils'` to loadRenderer switch |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify -- add 5 keys to BRAND_PREFIX_KEYS |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify -- preset card + sliders |

## Config Interface

```typescript
export interface TendrilsConfig extends ShaderConfigBase {
  preset: 'tendrils';
  scale: number;    // 1.0-5.0, default 2.5 -- Noise scale (tendril size)
  speed: number;    // 0.05-0.30, default 0.12 -- Flow speed
  steps: number;    // 3-7, default 5 (int) -- Advection steps (quality vs perf)
  curl: number;     // 0.5-2.0, default 1.0 -- Curl field strength
  fade: number;     // 0.3-1.0, default 0.6 -- Tendril opacity/thickness
}
```

## Defaults

```typescript
// Tendrils
tendrilsScale: 2.5,
tendrilsSpeed: 0.12,
tendrilsSteps: 5,
tendrilsCurl: 1.0,
tendrilsFade: 0.6,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

```
shader-tendrils-scale
shader-tendrils-speed
shader-tendrils-steps
shader-tendrils-curl
shader-tendrils-fade
```

All 5 keys MUST be registered in `css-injection.ts` BRAND_PREFIX_KEYS or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and ShaderHero never reads them via `getComputedStyle`).

## Fragment Shader (tendrils.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `u_time` | `float` | Elapsed seconds |
| `u_resolution` | `vec2` | Canvas pixel dimensions |
| `u_mouse` | `vec2` | Normalized mouse (0-1), lerped |
| `u_burstStrength` | `float` | Click burst strength (decays) |
| `u_brandPrimary` | `vec3` | Brand primary (medium density) |
| `u_brandSecondary` | `vec3` | Brand secondary (high density) |
| `u_brandAccent` | `vec3` | Brand accent (peak density) |
| `u_bgColor` | `vec3` | Background (low density base) |
| `u_scale` | `float` | Noise scale |
| `u_speed` | `float` | Flow speed |
| `u_steps` | `int` | Advection steps |
| `u_curl` | `float` | Curl field strength |
| `u_fade` | `float` | Tendril opacity/thickness |
| `u_intensity` | `float` | Overall blend |
| `u_grain` | `float` | Film grain |
| `u_vignette` | `float` | Vignette strength |

### Algorithm

1. **3D Noise basis**: Implement a smooth 3D noise function `snoise3(vec3 p)` using a layered sine-hash approach. The noise is evaluated in 3D (x, y, time) to produce a scalar potential field that evolves over time. Three octaves with inter-octave rotation (same `mat2(0.8, 0.6, -0.6, 0.8)` convention as nebula) and halving amplitude per octave.

2. **Curl noise field (2D)**: Compute the curl of the 3D noise to obtain a divergence-free 2D velocity field. For a scalar potential field P(x, y):
   - `vel.x = dP/dy` (partial derivative w.r.t. y)
   - `vel.y = -dP/dx` (partial derivative w.r.t. x)

   Approximate the partial derivatives via central finite differences with small epsilon (e.g., 0.01):
   ```glsl
   float eps = 0.01;
   float dPdy = (noise3(vec3(p.x, p.y + eps, t)) - noise3(vec3(p.x, p.y - eps, t))) / (2.0 * eps);
   float dPdx = (noise3(vec3(p.x + eps, p.y, t)) - noise3(vec3(p.x - eps, p.y, t))) / (2.0 * eps);
   vec2 vel = vec2(dPdy, -dPdx) * u_curl;
   ```

   This produces a velocity field where streamlines never converge or diverge -- they flow in smooth, non-intersecting curves. This is what creates the tendril shapes.

3. **Backward advection (Euler integration)**: Starting from the fragment's UV coordinate, trace backward along the curl noise velocity field for `u_steps` iterations:
   ```glsl
   vec2 pos = uv * u_scale;
   float dt = 0.15; // advection step size
   float density = 0.0;
   for (int i = 0; i < 7; i++) {
     if (i >= u_steps) break;
     vec2 vel = curlNoise(pos, time);
     pos -= vel * dt;  // backward advection
     // Accumulate density at each step position
     float n = noise3(vec3(pos, time * 0.5));
     density += smoothstep(-0.1, 0.3, n) * (1.0 - float(i) / float(u_steps));
   }
   density /= float(u_steps);
   ```

   Each advection step traces back along the flow, and accumulating noise samples at each position creates visible streamline density. Earlier steps (closer to the fragment) contribute more via the `(1.0 - float(i) / float(u_steps))` falloff. This naturally reveals the tendril shapes as the noise field's streamlines.

4. **Brand colour mapping (density-based)**: Map the accumulated density to brand colours using a 4-stop gradient:
   - `density < 0.25`: `u_bgColor` (background, void between tendrils)
   - `density 0.25-0.50`: `mix(u_bgColor, u_brandPrimary, ...)` (faint tendril edges)
   - `density 0.50-0.75`: `mix(u_brandPrimary, u_brandSecondary, ...)` (tendril body)
   - `density 0.75-1.0`: `mix(u_brandSecondary, u_brandAccent, ...)` (tendril core, brightest)

   ```glsl
   vec3 tendrilColor;
   if (density < 0.25) {
     tendrilColor = mix(u_bgColor, u_brandPrimary, density * 4.0);
   } else if (density < 0.5) {
     tendrilColor = mix(u_brandPrimary, u_brandSecondary, (density - 0.25) * 4.0);
   } else if (density < 0.75) {
     tendrilColor = mix(u_brandSecondary, u_brandAccent, (density - 0.5) * 4.0);
   } else {
     tendrilColor = mix(u_brandAccent, vec3(1.0), (density - 0.75) * 2.0);
   }
   ```

   As density varies smoothly along the advected streamlines, this creates natural colour gradients within each tendril -- dark edges fading to bright cores.

5. **Opacity/thickness control**: The `u_fade` parameter scales the density before colour mapping, controlling how opaque/thick the tendrils appear:
   ```glsl
   density = clamp(density * u_fade * 2.0, 0.0, 1.0);
   ```
   Low fade = wispy, transparent tendrils. High fade = thick, opaque plumes.

6. **Mouse interaction -- radial vortex force**: The mouse injects a radial swirling force into the curl noise field. Moving the mouse fast creates vortex spirals around the pointer:
   ```glsl
   vec2 mousePos = (u_mouse - 0.5) * 2.0;
   mousePos.x *= u_resolution.x / u_resolution.y; // aspect correct
   vec2 toMouse = pos - mousePos;
   float dist = length(toMouse);
   float falloff = exp(-dist * dist * 4.0); // Gaussian falloff
   // Perpendicular force (swirl) + radial force (attract)
   vec2 perp = vec2(-toMouse.y, toMouse.x);
   vel += (perp * 0.8 + normalize(toMouse) * 0.2) * falloff * u_curl * 0.5;
   ```
   Lerped mouse (MOUSE_LERP = 0.04) in the renderer ensures smooth response. Tendrils swirl around the pointer creating a vortex, and moving fast amplifies the spiral because the lerped position lags behind the actual position.

7. **Click burst**: On click, a bright Gaussian flash at the cursor position boosts local density:
   ```glsl
   if (u_burstStrength > 0.01) {
     vec2 burstUv = (2.0 * u_mouse - 1.0);
     burstUv.x *= u_resolution.x / u_resolution.y;
     float burstDist = dot(uv - burstUv, uv - burstUv);
     float burst = u_burstStrength * exp(-burstDist * 6.0);
     density += burst * 0.5;
     tendrilColor += mix(u_brandAccent, vec3(1.0), 0.5) * burst * 1.5;
   }
   ```

8. **Post-processing**: Follow the established pipeline:
   - Reinhard tone mapping: `color = color / (1.0 + color);`
   - Brightness cap: `color = min(color, vec3(0.7));`
   - Intensity blend: `color = mix(u_bgColor, color, u_intensity);`
   - Vignette: `vec2 vc = v_uv * 2.0 - 1.0; color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);`
   - Film grain: `color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;`
   - Final clamp: `fragColor = vec4(clamp(color, 0.0, 0.7), 1.0);`

### Key GLSL Notes

- Export as `export const TENDRILS_FRAG = \`#version 300 es...`
- For-loop with `if (i >= u_steps) break;` needs constant upper bound (7)
- Aspect ratio correction: `vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;` (same as nebula)
- 3D noise hash: `fract(sin(dot(...)) * 43758.5453)` style or layered sin product
- Noise hash for grain: same `hash(vec2)` as nebula/topo
- Central finite differences for curl: epsilon = 0.01, requires 4 extra noise evaluations per curl sample
- Advection step size `dt` is fixed at 0.15 -- not a uniform (internal detail)

### GLSL Pseudocode

```glsl
// --- 3D noise (smooth, layered sin-hash) ---
float hash31(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f); // smoothstep
  // Trilinear interpolation of 8 corner hashes
  float a = hash31(i);
  float b = hash31(i + vec3(1, 0, 0));
  float c = hash31(i + vec3(0, 1, 0));
  float d = hash31(i + vec3(1, 1, 0));
  float e = hash31(i + vec3(0, 0, 1));
  float f1 = hash31(i + vec3(1, 0, 1));
  float g = hash31(i + vec3(0, 1, 1));
  float h = hash31(i + vec3(1, 1, 1));
  return mix(
    mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
    mix(mix(e, f1, f.x), mix(g, h, f.x), f.y),
    f.z
  );
}

// --- FBM 3 octaves with rotation ---
const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);

float fbm3d(vec3 p) {
  float f = 0.0;
  f += 0.500 * noise3(p); p.xy = octaveRot * p.xy * 2.02; p.z *= 1.03;
  f += 0.250 * noise3(p); p.xy = octaveRot * p.xy * 2.03; p.z *= 1.04;
  f += 0.125 * noise3(p);
  return f / 0.875;
}

// --- Curl noise: gradient of scalar potential ---
vec2 curlNoise(vec2 p, float t) {
  float eps = 0.01;
  vec3 p3 = vec3(p, t);
  float dPdy = (fbm3d(p3 + vec3(0, eps, 0)) - fbm3d(p3 - vec3(0, eps, 0))) / (2.0 * eps);
  float dPdx = (fbm3d(p3 + vec3(eps, 0, 0)) - fbm3d(p3 - vec3(eps, 0, 0))) / (2.0 * eps);
  return vec2(dPdy, -dPdx) * u_curl;
}

// --- main() ---
void main() {
  float t = u_time * u_speed;
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;

  // Mouse influence (aspect-corrected)
  vec2 mouseUv = (u_mouse - 0.5) * 2.0;
  mouseUv.x *= u_resolution.x / u_resolution.y;

  // Backward advection along curl noise field
  vec2 pos = uv * u_scale;
  float density = 0.0;
  float dt = 0.15;

  for (int i = 0; i < 7; i++) {
    if (i >= u_steps) break;

    // Curl noise velocity at current position
    vec2 vel = curlNoise(pos, t);

    // Mouse vortex force
    vec2 toMouse = pos - mouseUv * u_scale;
    float mouseDist = length(toMouse);
    float mouseFalloff = exp(-mouseDist * mouseDist * 4.0);
    vec2 perp = vec2(-toMouse.y, toMouse.x);
    vel += (perp * 0.8 + normalize(toMouse + 0.001) * 0.2) * mouseFalloff * u_curl * 0.5;

    // Advect backward
    pos -= vel * dt;

    // Sample density at advected position
    float n = fbm3d(vec3(pos, t * 0.5));
    float weight = 1.0 - float(i) / float(u_steps);
    density += smoothstep(-0.1, 0.3, n) * weight;
  }
  density /= float(u_steps);

  // Apply fade (thickness control)
  density = clamp(density * u_fade * 2.0, 0.0, 1.0);

  // Brand colour mapping: bg -> primary -> secondary -> accent
  vec3 color;
  if (density < 0.25) {
    color = mix(u_bgColor, u_brandPrimary, density * 4.0);
  } else if (density < 0.5) {
    color = mix(u_brandPrimary, u_brandSecondary, (density - 0.25) * 4.0);
  } else if (density < 0.75) {
    color = mix(u_brandSecondary, u_brandAccent, (density - 0.5) * 4.0);
  } else {
    color = mix(u_brandAccent, vec3(1.0), (density - 0.75) * 2.0);
  }

  // Click burst
  if (u_burstStrength > 0.01) {
    vec2 burstUv = (2.0 * u_mouse - 1.0);
    burstUv.x *= u_resolution.x / u_resolution.y;
    float burstDist = dot(uv - burstUv, uv - burstUv);
    float burst = u_burstStrength * exp(-burstDist * 6.0);
    color += mix(u_brandAccent, vec3(1.0), 0.5) * burst * 1.5;
  }

  // Post-process
  color = color / (1.0 + color);                    // Reinhard
  color = min(color, vec3(0.7));                     // Brightness cap
  color = mix(u_bgColor, color, u_intensity);        // Intensity blend

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  fragColor = vec4(clamp(color, 0.0, 0.7), 1.0);
}
```

## Renderer (tendrils-renderer.ts)

Single-pass, follows nebula-renderer pattern exactly:
- One program (no FBOs)
- Internal lerped mouse state (MOUSE_LERP = 0.04) for smooth vortex response
- Pass all uniforms each frame
- `u_steps` via `gl.uniform1i()` with `Math.round()` (NOT uniform1f -- int uniform)
- `u_burstStrength` for click flash
- `resize()` is a no-op (single-pass preset, viewport set in render)
- `reset()` resets lerped mouse to centre
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
  'u_scale',
  'u_speed',
  'u_steps',
  'u_curl',
  'u_fade',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;
```

### Renderer Template

```typescript
import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, TendrilsConfig } from '../shader-config';
import { TENDRILS_FRAG } from '../shaders/tendrils.frag';
import {
  createProgram,
  createQuad,
  drawQuad,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

// ... UNIFORM_NAMES as above ...

type TendrilsUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  scale: 2.5,
  speed: 0.12,
  steps: 5,
  curl: 1.0,
  fade: 0.6,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createTendrilsRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<TendrilsUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal lerped mouse state for smooth vortex response
  let lerpedMouse = { x: 0.5, y: 0.5 };
  const MOUSE_LERP = 0.04;

  return {
    init(gl, _width, _height) {
      program = createProgram(gl, VERTEX_SHADER, TENDRILS_FRAG);
      if (!program) return false;
      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);
      lerpedMouse = { x: 0.5, y: 0.5 };
      return true;
    },

    render(gl, time, mouse, config, width, height) {
      if (!program || !uniforms || !quad) return;
      const cfg = config as TendrilsConfig;

      // Lerp mouse for smooth vortex
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      lerpedMouse.x += (targetX - lerpedMouse.x) * MOUSE_LERP;
      lerpedMouse.y += (targetY - lerpedMouse.y) * MOUSE_LERP;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);
      gl.uniform1f(uniforms.u_burstStrength, mouse.burstStrength);

      // Brand colors
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // Preset-specific config with defaults
      gl.uniform1f(uniforms.u_scale, cfg.scale ?? DEFAULTS.scale);
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      // CRITICAL: u_steps is int -- use uniform1i, NOT uniform1f
      gl.uniform1i(uniforms.u_steps, Math.round(cfg.steps ?? DEFAULTS.steps));
      gl.uniform1f(uniforms.u_curl, cfg.curl ?? DEFAULTS.curl);
      gl.uniform1f(uniforms.u_fade, cfg.fade ?? DEFAULTS.fade);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(uniforms.u_vignette, cfg.vignette ?? DEFAULTS.vignette);

      // Draw to screen (no FBO)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl, _width, _height) {
      // Single-pass preset: no FBOs to resize. Viewport set in render().
    },

    reset(_gl) {
      // No simulation state to reset for single-pass presets.
      lerpedMouse = { x: 0.5, y: 0.5 };
    },

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

Add `'tendrils'` to the union:
```typescript
export type ShaderPresetId = '...' | 'tendrils' | '...' | 'none';
```

### TendrilsConfig

```typescript
export interface TendrilsConfig extends ShaderConfigBase {
  preset: 'tendrils';
  scale: number;
  speed: number;
  steps: number;
  curl: number;
  fade: number;
}
```

### ShaderConfig union

Add `| TendrilsConfig` to the union type.

### DEFAULTS

```typescript
// Tendrils
tendrilsScale: 2.5,
tendrilsSpeed: 0.12,
tendrilsSteps: 5,
tendrilsCurl: 1.0,
tendrilsFade: 0.6,
```

### Switch case

```typescript
case 'tendrils':
  return {
    ...base,
    preset: 'tendrils',
    scale: rv('shader-tendrils-scale', DEFAULTS.tendrilsScale),
    speed: rv('shader-tendrils-speed', DEFAULTS.tendrilsSpeed),
    steps: Math.round(rv('shader-tendrils-steps', DEFAULTS.tendrilsSteps)),
    curl: rv('shader-tendrils-curl', DEFAULTS.tendrilsCurl),
    fade: rv('shader-tendrils-fade', DEFAULTS.tendrilsFade),
  };
```

Note: `steps` MUST use `Math.round()` because it is an int uniform.

## ShaderHero.svelte Changes

Add to `loadRenderer()` switch:

```typescript
case 'tendrils': {
  const { createTendrilsRenderer } = await import('./renderers/tendrils-renderer');
  return createTendrilsRenderer();
}
```

## Brand Editor Changes

### BrandEditorHeroEffects.svelte

**PRESETS array**: Add entry:
```typescript
{ id: 'tendrils', label: 'Tendrils', description: 'Curl noise light tendrils' },
```

**DEFAULTS record**: Add entries:
```typescript
'shader-tendrils-scale': '2.5',
'shader-tendrils-speed': '0.12',
'shader-tendrils-steps': '5',
'shader-tendrils-curl': '1.0',
'shader-tendrils-fade': '0.6',
```

**Derived state**: Add:
```typescript
// Tendrils
const tendrilsScale = $derived(readNum('shader-tendrils-scale'));
const tendrilsSpeed = $derived(readNum('shader-tendrils-speed'));
const tendrilsSteps = $derived(readNum('shader-tendrils-steps'));
const tendrilsCurl = $derived(readNum('shader-tendrils-curl'));
const tendrilsFade = $derived(readNum('shader-tendrils-fade'));
```

**Slider section**: Add `{:else if activePreset === 'tendrils'}` block with 5 sliders.

### Brand Editor Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| `shader-tendrils-scale` | Noise Scale | 1.0 | 5.0 | 0.25 | 2.5 | Fine | Coarse |
| `shader-tendrils-speed` | Flow Speed | 0.05 | 0.30 | 0.01 | 0.12 | Slow | Fast |
| `shader-tendrils-steps` | Advection Steps | 3 | 7 | 1 | 5 | Fast | Smooth |
| `shader-tendrils-curl` | Curl Strength | 0.5 | 2.0 | 0.10 | 1.0 | Gentle | Tight |
| `shader-tendrils-fade` | Tendril Density | 0.3 | 1.0 | 0.05 | 0.6 | Wispy | Dense |

## Brand Color Mapping

| Visual Element | Color Source | Notes |
|----------------|-------------|-------|
| Void between tendrils | `u_bgColor` | Dark background for depth |
| Tendril edges (low density) | `u_bgColor` -> `u_brandPrimary` gradient | Faint, emerging from background |
| Tendril body (medium density) | `u_brandPrimary` -> `u_brandSecondary` gradient | Main visible structure |
| Tendril core (high density) | `u_brandSecondary` -> `u_brandAccent` gradient | Brightest, bioluminescent glow |
| Peak density highlights | `u_brandAccent` -> `vec3(1.0)` | Hottest points, white-tipped |
| Click burst flash | `u_brandAccent` + white | Same as nebula pattern |

Density-to-colour mapping (4-segment):
```glsl
vec3 color;
if (density < 0.25) {
  color = mix(u_bgColor, u_brandPrimary, density * 4.0);
} else if (density < 0.5) {
  color = mix(u_brandPrimary, u_brandSecondary, (density - 0.25) * 4.0);
} else if (density < 0.75) {
  color = mix(u_brandSecondary, u_brandAccent, (density - 0.5) * 4.0);
} else {
  color = mix(u_brandAccent, vec3(1.0), (density - 0.75) * 2.0);
}
```

This creates a natural bioluminescent gradient: dark void fades into coloured tendrils that brighten toward their cores. The density varies smoothly along the advected streamlines, so each tendril shows a natural cross-section gradient from edge to centre.

## Mouse Interaction Detail

| Input | Effect | Strength |
|-------|--------|----------|
| Mouse move (lerped) | Radial vortex -- tendrils swirl around pointer | Gaussian falloff, `exp(-dist^2 * 4.0)` |
| Fast mouse | Stronger spirals (lerp lag creates offset) | MOUSE_LERP = 0.04 |
| Click burst | Gaussian density flash at cursor | `burstStrength * exp(-dist * 6.0)` |
| Touch start | Same as click burst | Same |
| Touch move | Same as mouse move (lerped) | Same |
| No interaction | Lerped mouse drifts to centre (0.5, 0.5) | Neutral -- natural curl flow |

The mouse interaction uses the same lerped mouse pattern as nebula. The vortex effect comes from injecting perpendicular (swirl) and radial (attract) force components at the mouse position. Fast mouse movement creates a visible lag between the actual pointer and the lerped position, which produces a trailing vortex spiral effect.

## Performance Budget

Target: 0.5-0.8ms per frame at default settings (5 steps). This is slightly more expensive than nebula due to the curl noise finite differences (4 extra noise evaluations per advection step) but still well within single-pass budget.

| Operation | Cost | Notes |
|-----------|------|-------|
| 3D noise (value noise, trilinear) | ~20 ops per call | Hash + lerp |
| FBM 3D (3 octaves) | ~60 ops per call | 3x noise3 + mat2 rotation |
| Curl noise (central differences) | ~4 fbm3d calls = ~240 ops | Finite difference requires 4 noise evaluations |
| Per advection step | ~240 (curl) + 60 (density sample) + 30 (mouse) = ~330 ops | Dominant cost |
| Total advection loop (5 steps default) | ~1650 ops | 5 * 330 |
| Colour mapping | ~20 ops | Branch + mix |
| Post-process | ~10 ops | Standard pipeline |
| **Total per fragment** | ~1700 ops | Acceptable for single-pass |

The `u_steps` parameter directly controls the main cost. At 3 steps: ~1000 ops (cheap). At 7 steps: ~2300 ops (still within budget). Users on slower GPUs can reduce steps from the brand editor.

No FBOs, no texture reads beyond the fullscreen quad. The main cost is the repeated 3D FBM evaluations for curl noise, which is unavoidable for the curl noise technique.

## Gotchas

1. **BRAND_PREFIX_KEYS** -- all 5 keys MUST be registered in `css-injection.ts` or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and ShaderHero never reads them)
2. **For-loop dynamic bound** -- constant upper bound of 7 required for GLSL ES 3.0 compliance. Use `if (i >= u_steps) break;` pattern.
3. **`steps` as int uniform** -- use `Math.round()` in config parsing (`shader-config.ts` switch case), `gl.uniform1i()` in renderer (NOT `uniform1f`). GLSL declares `uniform int u_steps;`.
4. **No naming collisions** -- all keys namespaced as `shader-tendrils-*` to avoid collision with existing `shader-speed`, `shader-scale`, `shader-curl` (suture) etc. The config fields `scale`, `speed`, `curl` are safe because the CSS keys are `shader-tendrils-scale` etc.
5. **Export pattern** -- shader string exported as `export const TENDRILS_FRAG = \`#version 300 es...`
6. **Post-processing chain** -- MUST follow established order: Reinhard tone map -> `min(color, 0.7)` brightness cap -> `mix(u_bgColor, color, u_intensity)` intensity blend -> vignette -> grain -> `clamp(color, 0.0, 0.7)` final cap
7. **Curl noise epsilon** -- epsilon of 0.01 for central differences. Too small = floating point noise. Too large = loses fine detail. 0.01 is the sweet spot for scale values 1.0-5.0.
8. **Backward advection** -- the advection is BACKWARD (pos -= vel * dt), tracing where each fragment's colour came FROM. Forward advection would require a separate simulation buffer (FBO). Backward advection is the key to keeping this single-pass.
9. **Divergence-free property** -- curl noise is inherently divergence-free (curl of gradient of scalar field). This means streamlines never converge to points or diverge from points -- they form smooth closed loops. This is what gives the tendril shapes their organic, non-bunching quality.
10. **Lerped mouse vs direct mouse** -- uses internal lerped mouse (like nebula), NOT direct mouse pass-through (like aurora). The lerp creates the smooth vortex trail effect essential for the jellyfish-tentacle aesthetic.
11. **Aspect correction** -- UV coordinates use aspect-corrected `(2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y` (same as nebula). Mouse position must be aspect-corrected identically in the shader for the vortex to appear at the correct screen position.
12. **normalize() guard** -- `normalize(toMouse + 0.001)` prevents NaN when mouse is exactly at the fragment position (length = 0). The small offset is invisible but prevents the division-by-zero.
13. **Preset grid** -- adding tendrils increases the preset count in the 2-col grid by one card. Check the grid remains visually balanced.

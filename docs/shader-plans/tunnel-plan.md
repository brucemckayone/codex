# Tunnel (Apollonian Fractal Tunnel) Shader Preset -- Implementation Plan

## Overview

Add a "tunnel" shader preset: camera flies through an Apollonian gasket fractal tunnel. The fractal structure is created by iterated sphere inversions forming a self-similar tunnel geometry. Colour accumulates during the raymarch based on position and depth, creating brand-coloured fractal patterns that flow past as the camera moves forward. Single-pass (no FBO). Mouse shifts the camera look direction. Click creates a speed burst.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify -- add `TunnelConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/tunnel.frag.ts` | Create -- single-pass fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/tunnel-renderer.ts` | Create -- single-pass renderer |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify -- add `'tunnel'` to loadRenderer switch |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify -- add 5 keys to BRAND_PREFIX_KEYS |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify -- preset card + sliders |

## Config Interface

```typescript
export interface TunnelConfig extends ShaderConfigBase {
  preset: 'tunnel';
  speed: number;      // 1.0-4.0, default 2.0 -- Camera flight speed
  fractal: number;    // 4-8, default 6 (int) -- Apollonian iterations
  radius: number;     // 1.0-3.0, default 2.0 -- Tunnel radius
  brightness: number; // 0.5-2.0, default 1.0 -- Colour brightness multiplier
  twist: number;      // 0.03-0.10, default 0.07 -- Path curvature/twist
}
```

## Defaults

```typescript
// Tunnel
tunnelSpeed: 2.0,
tunnelFractal: 6,
tunnelRadius: 2.0,
tunnelBrightness: 1.0,
tunnelTwist: 0.07,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

```
shader-tunnel-speed
shader-tunnel-fractal
shader-tunnel-radius
shader-tunnel-brightness
shader-tunnel-twist
```

All 5 keys MUST be registered in `css-injection.ts` BRAND_PREFIX_KEYS or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and ShaderHero never reads them via `getComputedStyle`).

## Fragment Shader (tunnel.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `u_time` | `float` | Elapsed seconds |
| `u_resolution` | `vec2` | Canvas pixel dimensions |
| `u_mouse` | `vec2` | Normalized mouse (0-1), lerped |
| `u_burstStrength` | `float` | Click burst strength (decays) |
| `u_brandPrimary` | `vec3` | Brand primary colour (near) |
| `u_brandSecondary` | `vec3` | Brand secondary colour (mid) |
| `u_brandAccent` | `vec3` | Brand accent colour (far) |
| `u_bgColor` | `vec3` | Background / void colour |
| `u_speed` | `float` | Camera flight speed |
| `u_fractal` | `int` | Apollonian iterations |
| `u_radius` | `float` | Tunnel radius |
| `u_brightness` | `float` | Colour brightness multiplier |
| `u_twist` | `float` | Path curvature |
| `u_intensity` | `float` | Overall blend |
| `u_grain` | `float` | Film grain |
| `u_vignette` | `float` | Vignette strength |

### Algorithm

1. **Camera path**: The camera follows a curved path through 3D space. The path function determines the camera position at depth z:
   ```glsl
   vec3 cameraPath(float z) {
     return vec3(cos(z * u_twist) * 16.0, 0.0, z);
   }
   ```
   The `u_twist` parameter controls how much the tunnel curves. Camera advances at `u_speed * u_time`.

2. **Ray construction**: From the camera position, construct a ray through each pixel. The camera look-at target is slightly ahead on the path. Mouse shifts the ray direction:
   ```glsl
   float z = u_time * u_speed;
   // Click burst: brief speed increase
   float burstZ = u_burstStrength * 5.0;
   z += burstZ;
   
   vec3 ro = cameraPath(z);
   vec3 target = cameraPath(z + 1.0);
   
   // Camera frame
   vec3 fwd = normalize(target - ro);
   vec3 right = normalize(cross(vec3(0, 1, 0), fwd));
   vec3 up = cross(fwd, right);
   
   // Mouse shifts look direction
   vec2 mouseOffset = (u_mouse - 0.5) * 0.5;
   vec3 rd = normalize(fwd + uv.x * right + uv.y * up + mouseOffset.x * right + mouseOffset.y * up);
   ```

3. **Apollonian fractal SDF**: The fractal distance field is created by iterated sphere inversions. This produces a self-similar structure of nested spheres that forms the tunnel walls:
   ```glsl
   float apollonian(vec3 p) {
     float b = u_radius;  // cell size / tunnel radius
     float s;
     float w = 1.0;
     
     for (int i = 0; i < 8; i++) {
       if (i >= u_fractal) break;
       p = mod(p + b, 2.0 * b) - b;       // fold space
       s = 2.0 / max(dot(p, p), 0.001);    // sphere inversion
       p *= s;
       w *= s;
     }
     
     // Return distance estimate
     return length(p) / w - 0.01;
   }
   ```
   Each iteration folds space and inverts through a sphere, creating self-similar structure at multiple scales.

4. **Tunnel SDF**: Combine the Apollonian fractal with a cylindrical tunnel:
   ```glsl
   float tunnelSDF(vec3 p) {
     // Offset by camera path to keep tunnel centered
     vec3 q = p - cameraPath(p.z);
     float tunnel = -(length(q.xy) - u_radius * 1.5);  // inside of cylinder
     float fractal = apollonian(p);
     return max(tunnel, fractal);  // intersection: fractal inside tunnel
   }
   ```

5. **Raymarching with colour accumulation (128 steps)**: Rather than just finding the surface, accumulate colour during the march. This creates a volumetric glow effect through the fractal:
   ```glsl
   vec3 color = vec3(0.0);
   float t = 0.0;
   
   for (int i = 0; i < 128; i++) {
     vec3 p = ro + rd * t;
     float d = tunnelSDF(p);
     
     if (d < 0.001) break;
     if (t > 50.0) break;
     
     // Colour accumulation during march
     // Brand-derived colour offset based on position
     vec3 brandOffset = vec3(
       dot(u_brandPrimary, vec3(1.0)) * 2.0,
       dot(u_brandSecondary, vec3(1.0)) * 1.5,
       dot(u_brandAccent, vec3(1.0)) * 1.0
     );
     
     vec3 marchColor = 1.0 + cos(0.05 * float(i) + 0.5 * p.z + brandOffset);
     marchColor *= 0.5;  // normalize to 0-1 range
     
     // Exponential depth falloff
     float falloff = exp(-0.15 * t);
     color += marchColor * falloff * 0.02 * u_brightness;
     
     t += max(d, 0.01);  // minimum step to avoid getting stuck
   }
   ```

6. **Brand colour mapping in the accumulation**: Replace the generic `vec4(6,4,2,0)` colour offsets from the original Shadertoy with brand-derived offsets:
   ```glsl
   vec3 brandOffset = vec3(
     dot(u_brandPrimary, vec3(1.0)) * 2.0,    // primary luminance -> channel 0 offset
     dot(u_brandSecondary, vec3(1.0)) * 1.5,   // secondary luminance -> channel 1 offset
     dot(u_brandAccent, vec3(1.0)) * 1.0        // accent luminance -> channel 2 offset
   );
   ```
   The `1 + cos(offset + position)` pattern creates oscillating colour bands that naturally pick up the brand's colour character:
   - Near surfaces: primary dominates (fastest oscillation)
   - Mid-depth: secondary appears
   - Far surfaces: accent shows through

7. **Post-processing**: Reinhard tone map -> `min(color, 0.7)` brightness cap -> `mix(u_bgColor, color, u_intensity)` intensity blend -> vignette -> grain -> `clamp(color, 0.0, 0.7)` final cap

### Key GLSL Notes

- Export as `export const TUNNEL_FRAG = \`#version 300 es...`
- For-loop for Apollonian: constant upper bound of 8, `if (i >= u_fractal) break;`
- For-loop for raymarch: constant upper bound of 128, no dynamic break on `u_fractal`
- `u_fractal` is an int uniform -- use `uniform int u_fractal;`
- Aspect ratio correction: `vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;`
- The `mod(p + b, 2.0 * b) - b` pattern creates the folding -- this is the standard domain repetition technique
- Guard `dot(p, p)` against zero with `max(..., 0.001)` to prevent division by zero in sphere inversion
- Hash for grain: same `hash(vec2)` as nebula shader
- Camera path uses `cos` only (not `sin`) for horizontal displacement to keep the path smooth

### GLSL Pseudocode

```glsl
// --- Camera path ---
vec3 cameraPath(float z) {
  return vec3(cos(z * u_twist) * 16.0, 0.0, z);
}

// --- Apollonian fractal SDF ---
float apollonian(vec3 p) {
  float b = u_radius;
  float s;
  float w = 1.0;
  
  for (int i = 0; i < 8; i++) {
    if (i >= u_fractal) break;
    p = mod(p + b, 2.0 * b) - b;
    s = 2.0 / max(dot(p, p), 0.001);
    p *= s;
    w *= s;
  }
  
  return length(p) / w - 0.01;
}

// --- Tunnel SDF ---
float tunnelSDF(vec3 p) {
  vec3 q = p - cameraPath(p.z);
  float tunnel = -(length(q.xy) - u_radius * 1.5);
  float fractal = apollonian(p);
  return max(tunnel, fractal);
}

// --- Hash for film grain ---
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;
  
  // Camera
  float z = u_time * u_speed + u_burstStrength * 5.0;
  vec3 ro = cameraPath(z);
  vec3 target = cameraPath(z + 1.0);
  
  vec3 fwd = normalize(target - ro);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, right);
  
  vec2 mouseOffset = (u_mouse - 0.5) * 0.5;
  vec3 rd = normalize(fwd + (uv.x + mouseOffset.x) * right + (uv.y + mouseOffset.y) * up);
  
  // Raymarch with colour accumulation
  vec3 color = vec3(0.0);
  float t = 0.0;
  
  // Brand-derived colour offsets
  vec3 brandOffset = vec3(
    dot(u_brandPrimary, vec3(1.0)) * 2.0,
    dot(u_brandSecondary, vec3(1.0)) * 1.5,
    dot(u_brandAccent, vec3(1.0)) * 1.0
  );
  
  for (int i = 0; i < 128; i++) {
    vec3 p = ro + rd * t;
    float d = tunnelSDF(p);
    
    if (d < 0.001) break;
    if (t > 50.0) break;
    
    // Volumetric colour accumulation
    vec3 marchColor = 0.5 + 0.5 * cos(0.05 * float(i) + 0.5 * p.z + brandOffset);
    float falloff = exp(-0.15 * t);
    color += marchColor * falloff * 0.02 * u_brightness;
    
    t += max(d, 0.01);
  }
  
  // Post-processing
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

## Renderer (tunnel-renderer.ts)

Single-pass, follows nebula-renderer pattern:
- One program (no FBOs)
- Internal lerped mouse state (MOUSE_LERP = 0.04) for smooth camera look
- Pass all uniforms each frame
- `u_fractal` via `gl.uniform1i()` with `Math.round()` (NOT uniform1f -- int uniform)
- `u_burstStrength` passed directly from mouse state (speed burst on click)
- `resize()` and `reset()` are near no-ops (single-pass preset)
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
  'u_speed',
  'u_fractal',
  'u_radius',
  'u_brightness',
  'u_twist',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;
```

### Renderer Template

```typescript
import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, TunnelConfig } from '../shader-config';
import { TUNNEL_FRAG } from '../shaders/tunnel.frag';
import {
  createProgram,
  createQuad,
  drawQuad,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

// ... UNIFORM_NAMES as above ...

type TunnelUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  speed: 2.0,
  fractal: 6,
  radius: 2.0,
  brightness: 1.0,
  twist: 0.07,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createTunnelRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<TunnelUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal lerped mouse state for smooth camera look
  let lerpedMouse = { x: 0.5, y: 0.5 };
  const MOUSE_LERP = 0.04;

  return {
    init(gl, _width, _height) {
      program = createProgram(gl, VERTEX_SHADER, TUNNEL_FRAG);
      if (!program) return false;
      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);
      lerpedMouse = { x: 0.5, y: 0.5 };
      return true;
    },

    render(gl, time, mouse, config, width, height) {
      if (!program || !uniforms || !quad) return;
      const cfg = config as TunnelConfig;

      // Lerp mouse for smooth camera look
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

      // Config uniforms
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      // CRITICAL: u_fractal is int -- use uniform1i, NOT uniform1f
      gl.uniform1i(uniforms.u_fractal, Math.round(cfg.fractal ?? DEFAULTS.fractal));
      gl.uniform1f(uniforms.u_radius, cfg.radius ?? DEFAULTS.radius);
      gl.uniform1f(uniforms.u_brightness, cfg.brightness ?? DEFAULTS.brightness);
      gl.uniform1f(uniforms.u_twist, cfg.twist ?? DEFAULTS.twist);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(uniforms.u_vignette, cfg.vignette ?? DEFAULTS.vignette);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize() { /* Single-pass: no FBOs to resize */ },

    reset() {
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

Add `'tunnel'` to the union:
```typescript
export type ShaderPresetId = '...' | 'tunnel' | '...' | 'none';
```

### TunnelConfig

```typescript
export interface TunnelConfig extends ShaderConfigBase {
  preset: 'tunnel';
  speed: number;
  fractal: number;
  radius: number;
  brightness: number;
  twist: number;
}
```

### ShaderConfig union

Add `| TunnelConfig` to the union type.

### DEFAULTS

```typescript
// Tunnel
tunnelSpeed: 2.0,
tunnelFractal: 6,
tunnelRadius: 2.0,
tunnelBrightness: 1.0,
tunnelTwist: 0.07,
```

### Switch case

```typescript
case 'tunnel':
  return {
    ...base,
    preset: 'tunnel',
    speed: rv('shader-tunnel-speed', DEFAULTS.tunnelSpeed),
    fractal: Math.round(rv('shader-tunnel-fractal', DEFAULTS.tunnelFractal)),
    radius: rv('shader-tunnel-radius', DEFAULTS.tunnelRadius),
    brightness: rv('shader-tunnel-brightness', DEFAULTS.tunnelBrightness),
    twist: rv('shader-tunnel-twist', DEFAULTS.tunnelTwist),
  };
```

Note: `fractal` MUST use `Math.round()` because it is an int uniform.

## ShaderHero.svelte Changes

Add to `loadRenderer()` switch:

```typescript
case 'tunnel': {
  const { createTunnelRenderer } = await import('./renderers/tunnel-renderer');
  return createTunnelRenderer();
}
```

## Brand Editor Changes

### BrandEditorHeroEffects.svelte

**PRESETS array**: Add entry:
```typescript
{ id: 'tunnel', label: 'Tunnel', description: 'Apollonian fractal flythrough' },
```

**DEFAULTS record**: Add entries:
```typescript
'shader-tunnel-speed': '2.0',
'shader-tunnel-fractal': '6',
'shader-tunnel-radius': '2.0',
'shader-tunnel-brightness': '1.00',
'shader-tunnel-twist': '0.07',
```

**Derived state**: Add:
```typescript
// Tunnel
const tunnelSpeed = $derived(readNum('shader-tunnel-speed'));
const tunnelFractal = $derived(readNum('shader-tunnel-fractal'));
const tunnelRadius = $derived(readNum('shader-tunnel-radius'));
const tunnelBrightness = $derived(readNum('shader-tunnel-brightness'));
const tunnelTwist = $derived(readNum('shader-tunnel-twist'));
```

**Slider section**: Add `{:else if activePreset === 'tunnel'}` block with 5 sliders.

### Brand Editor Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| `shader-tunnel-speed` | Flight Speed | 1.0 | 4.0 | 0.5 | 2.0 | Slow | Fast |
| `shader-tunnel-fractal` | Fractal Detail | 4 | 8 | 1 | 6 | Simple | Complex |
| `shader-tunnel-radius` | Tunnel Width | 1.0 | 3.0 | 0.5 | 2.0 | Narrow | Wide |
| `shader-tunnel-brightness` | Brightness | 0.50 | 2.00 | 0.10 | 1.00 | Dim | Bright |
| `shader-tunnel-twist` | Path Curvature | 0.03 | 0.10 | 0.01 | 0.07 | Gentle | Winding |

## Brand Color Mapping

| Visual Element | Color Source | Notes |
|----------------|-------------|-------|
| Near fractal surfaces | `u_brandPrimary` | Highest luminance offset, fastest oscillation |
| Mid-depth structures | `u_brandSecondary` | Medium luminance offset |
| Far fractal surfaces | `u_brandAccent` | Lowest luminance offset |
| Void / deep background | `u_bgColor` | Intensity blend target |
| Click speed burst | Time acceleration | Not a colour effect, shifts camera forward |

Brand colour mapping via `1 + cos(offset + position)`:
```glsl
vec3 brandOffset = vec3(
  dot(u_brandPrimary, vec3(1.0)) * 2.0,    // R channel: primary luminance
  dot(u_brandSecondary, vec3(1.0)) * 1.5,   // G channel: secondary luminance
  dot(u_brandAccent, vec3(1.0)) * 1.0        // B channel: accent luminance
);

// Oscillating colour per step
vec3 marchColor = 0.5 + 0.5 * cos(0.05 * float(i) + 0.5 * p.z + brandOffset);
```

The `cos` oscillation with per-channel offsets derived from brand luminance means:
- Different brand palettes produce different colour rhythms in the tunnel
- The fractal structure naturally picks up primary at close range
- Secondary appears at mid-distance as the cosine phase shifts
- Accent emerges at far distance
- The `0.5 + 0.5 * cos(...)` maps to [0, 1] range cleanly

## Mouse Interaction Detail

| Input | Effect | Strength |
|-------|--------|----------|
| Mouse X | Shifts camera look direction left/right | `(mouse.x - 0.5) * 0.5` added to ray direction |
| Mouse Y | Shifts camera look direction up/down | `(mouse.y - 0.5) * 0.5` added to ray direction |
| Click burst | Speed burst (camera jumps forward) | `burstStrength * 5.0` added to camera z |
| Touch start | Same as click burst (mobile) | Same |
| Touch move | Same as mouse move | Same |
| No interaction | Camera flies straight ahead, following the curved path | Default look direction |

The mouse shifts the look direction, not the camera position. This means the user can look around inside the tunnel while the camera continues to follow its path. The speed burst on click creates a brief jump forward, revealing new fractal structures before settling back to normal speed.

## Performance Budget

Target: 0.8-1.5ms per frame (128-step raymarch + 6-iteration fractal SDF).

| Operation | Cost | Notes |
|-----------|------|-------|
| Apollonian SDF (6 iterations) | ~6 * (mod + dot + mul) ~36 ops | Per raymarch step |
| tunnelSDF | apollonian + length + max ~40 ops | Per step |
| Raymarch (128 steps) | ~128 * (SDF + colour accum) ~6400 ops | Main cost |
| Post-process | ~10 ops | Standard pipeline |
| **Total per fragment** | ~6400-7000 ops | Higher cost shader |

This is the most expensive of the three new presets. The 128 raymarch steps each calling the 6-iteration Apollonian SDF add up. However:
- Early exit on `d < 0.001` and `t > 50.0` means many rays terminate early
- The `max(d, 0.01)` minimum step prevents infinite loops but keeps march efficient
- On modern discrete GPUs, 7000 ops per fragment is comfortably within budget
- On integrated GPUs, may need to reduce `u_fractal` to 4 for smooth performance

No FBOs, no texture reads. The cost is purely ALU-bound.

## Gotchas

1. **BRAND_PREFIX_KEYS** -- all 5 keys MUST be registered in `css-injection.ts` or sliders silently fail (values get `--color-` prefix instead of `--brand-` prefix and ShaderHero never reads them)
2. **Two for-loops with dynamic bounds** -- Apollonian loop needs constant upper bound of 8 with `if (i >= u_fractal) break;`. Raymarch loop uses constant 128.
3. **`fractal` as int uniform** -- use `Math.round()` in config parsing (`shader-config.ts` switch case), `gl.uniform1i()` in renderer (NOT `uniform1f`). GLSL declares `uniform int u_fractal;`.
4. **No naming collisions** -- all keys namespaced as `shader-tunnel-*` to avoid collision with existing `shader-speed`, `shader-radius` etc.
5. **Export pattern** -- shader string exported as `export const TUNNEL_FRAG = \`#version 300 es...`
6. **Post-processing chain** -- MUST follow established order: Reinhard tone map -> `min(color, 0.7)` brightness cap -> `mix(u_bgColor, color, u_intensity)` intensity blend -> vignette -> grain -> `clamp(color, 0.0, 0.7)` final cap
7. **Division by zero in Apollonian** -- `2.0 / dot(p, p)` can explode when p is near origin. The `max(dot(p, p), 0.001)` guard is critical.
8. **Minimum raymarch step** -- `max(d, 0.01)` prevents the ray from getting stuck at the fractal surface where the SDF returns very small values. Without this, the loop can waste all 128 steps at a single point.
9. **Camera path continuity** -- `cameraPath(z)` must be smooth (C1 continuous) or the camera will jitter. Using `cos` ensures smoothness. The `u_twist` parameter must not be too large or the camera path becomes erratic.
10. **Cross product degeneracy** -- when `fwd` is parallel to `(0, 1, 0)`, the `cross(vec3(0,1,0), fwd)` produces zero. This happens when the tunnel path goes straight up. The cosine-only horizontal displacement in `cameraPath` prevents this.
11. **Speed burst accumulation** -- `u_burstStrength * 5.0` is added to the camera z position. Since burstStrength decays per frame (handled by ShaderHero.svelte), this creates a smooth forward jump, not a teleport.
12. **Colour accumulation vs surface rendering** -- this shader accumulates colour along the entire ray path, not just at the surface hit point. This creates a volumetric glow effect. The `0.02` multiplier and `exp(-0.15 * t)` falloff prevent oversaturation.
13. **Higher GPU cost** -- at 128 steps x 6 Apollonian iterations, this is roughly 3-4x more expensive per fragment than nebula or aurora. The `fractal` slider (min 4) lets users reduce cost on weaker hardware.

# Ink Dispersion Shader Preset — Implementation Plan

## Overview

Add an "ink" shader preset: drops of brand-colored ink spreading through clear liquid using 3-channel advection-diffusion on a 512x512 ping-pong FBO. RGB channels represent concentrations of primary/secondary/accent ink, diffusing independently with curl noise advection.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify — add `InkConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/ink-sim.frag.ts` | Create — simulation shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/shaders/ink-display.frag.ts` | Create — display shader |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/renderers/ink-renderer.ts` | Create — ShaderRenderer impl |
| 5 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify — add `'ink'` to loadRenderer |
| 6 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify — add 5 keys to BRAND_PREFIX_KEYS |
| 7 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify — preset card + sliders |

## Config Interface

```typescript
export interface InkConfig extends ShaderConfigBase {
  preset: 'ink';
  diffusion: number;    // 0.5-3.0, default 1.5
  advection: number;    // 0.0-2.0, default 0.8
  dropSize: number;     // 0.02-0.10, default 0.05
  evaporation: number;  // 0.990-0.999, default 0.997
  curl: number;         // 5-40, default 15
}
```

## Defaults

```typescript
inkDiffusion: 1.5,
inkAdvection: 0.8,
inkDropSize: 0.05,
inkEvaporation: 0.997,
inkCurl: 15,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

```
shader-ink-diffusion
shader-ink-advection
shader-ink-drop-size
shader-ink-evaporation
shader-ink-curl
```

## Simulation Shader (ink-sim.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `uState` | `sampler2D` | Ping-pong sim texture. RGB = ink concentrations |
| `uTexel` | `vec2` | 1.0 / simResolution |
| `uDiffusion` | `float` | Diffusion rate multiplier |
| `uAdvection` | `float` | Curl noise flow strength |
| `uDropSize` | `float` | Gaussian radius of ink deposits |
| `uEvaporation` | `float` | Per-frame decay multiplier |
| `uCurl` | `float` | Curl noise frequency |
| `uTime` | `float` | Elapsed time in seconds |
| `uMouse` | `vec2` | Mouse position (0-1) |
| `uMouseActive` | `float` | 1.0 if active |
| `uMouseStrength` | `float` | Impulse magnitude |
| `uInkChannel` | `float` | Which channel (0=R/primary, 1=G/secondary, 2=B/accent) |
| `uDropPos` | `vec2` | Ambient drop position (-10 if none) |
| `uDropChannel` | `float` | Channel for ambient drop |

### Algorithm

1. Sample center + 4 neighbors (per-channel)
2. Laplacian diffusion: `diffused = center + diffusion * 0.2 * laplacian`
3. Curl noise advection: compute curl velocity from finite-difference noise gradient, sample state at reverse-advected position
4. Blend diffusion and advection: `mix(diffused, advected, 0.4)`
5. Per-frame evaporation: `result *= evaporation`
6. Mouse ink injection: Gaussian deposit into selected channel
7. Ambient drop injection: same but from uDropPos/uDropChannel
8. Clamp + edge damping

### Noise

Include inline simplex/value noise (no built-in noise in GLSL ES 3.0). Use hash-based or sin-based noise. Curl = perpendicular gradient of scalar noise: `velocity = (dn/dy, -dn/dx)` via finite differences.

## Display Shader (ink-display.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `uState` | `sampler2D` | Sim texture (RGB = concentrations) |
| `uColorPrimary` | `vec3` | Maps to R channel |
| `uColorSecondary` | `vec3` | Maps to G channel |
| `uColorAccent` | `vec3` | Maps to B channel |
| `uBgColor` | `vec3` | Background (zero-concentration areas) |
| `uIntensity` | `float` | Brightness multiplier |
| `uGrain` | `float` | Film grain |
| `uVignette` | `float` | Vignette strength |
| `uTime` | `float` | For grain animation |

### Algorithm

1. Read RGB ink concentrations
2. Additive blending: `color = bg + ink.r * primary + ink.g * secondary + ink.b * accent`
3. Overlap darkening: where total > 1.0, subtract to simulate subtractive mixing
4. Optional wet-edge highlight via `dFdx`/`dFdy` screen-space derivatives
5. Reinhard tone map, vignette, grain, brightness cap (0.75)

## Renderer (ink-renderer.ts)

Follows ripple-renderer pattern exactly:
- Ping-pong DoubleFBO at 512x512
- Init/sim/display programs
- `stepSim()` helper
- Ambient drops every 2-3.5s, rotating through channels (0→1→2→0)
- Mouse hover injects into rotating channel
- Click burst: 3 offset deposits (one per channel) over 4-6 frames
- Two substeps per frame (one with input, one coast)

## Brand Editor Sliders

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| `shader-ink-diffusion` | Diffusion Rate | 0.50 | 3.00 | 0.10 | 1.50 | Slow | Fast |
| `shader-ink-advection` | Flow Strength | 0.00 | 2.00 | 0.10 | 0.80 | Still | Swirling |
| `shader-ink-drop-size` | Drop Size | 0.020 | 0.100 | 0.005 | 0.050 | Tiny | Wide |
| `shader-ink-evaporation` | Persistence | 0.990 | 0.999 | 0.001 | 0.997 | Fleeting | Lasting |
| `shader-ink-curl` | Swirl Detail | 5 | 40 | 1 | 15 | Broad | Fine |

## Gotchas

1. **BRAND_PREFIX_KEYS** — every shader-ink-* key must be registered or sliders silently do nothing
2. **Noise function** — must be inlined (no built-in noise in GLSL ES 3.0). Adapt from suture's noise
3. **Curl noise** — compute from finite differences, not analytically
4. **uInkChannel as float** — compare with `< 0.5`, `< 1.5` thresholds (not int)
5. **Click burst** — inject 3 offset deposits (one per channel) for colorful burst
6. **Evaporation sensitivity** — 0.990 = ~3s fade, 0.999 = ~30s. Step of 0.001 gives meaningful control
7. **Edge damping** — same smoothstep pattern as ripple to prevent boundary artifacts
8. **EXT_color_buffer_float** — required for RGBA16F FBO, check in init()

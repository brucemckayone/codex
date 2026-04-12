# Nebula Shader Preset — Implementation Plan

## Overview

Add a "nebula" shader preset: single-pass raymarched volumetric cosmic dust where each depth layer is tinted with a different brand color. Primary gas foreground, secondary dust mid-ground, accent stars/highlights deep. Mouse creates "stellar wind" displacement.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify — add `NebulaConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/nebula.frag.ts` | Create — volumetric fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/nebula-renderer.ts` | Create — single-pass renderer |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify — add `'nebula'` to loadRenderer |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify — add 6 keys to BRAND_PREFIX_KEYS |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify — preset card + sliders |

## Config Interface

```typescript
export interface NebulaConfig extends ShaderConfigBase {
  preset: 'nebula';
  density: number;   // 0.3-2.0, default 0.8
  speed: number;     // 0.05-0.50, default 0.12
  scale: number;     // 1.0-5.0, default 2.0
  depth: number;     // 4-16, default 8
  wind: number;      // 0.0-2.0, default 0.5
  stars: number;     // 0.0-1.0, default 0.3
}
```

## Defaults

```typescript
nebulaDensity: 0.8,
nebulaSpeed: 0.12,
nebulaScale: 2.0,
nebulaDepth: 8,
nebulaWind: 0.5,
nebulaStars: 0.3,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

```
shader-nebula-density
shader-nebula-speed
shader-nebula-scale
shader-nebula-depth
shader-nebula-wind
shader-nebula-stars
```

## Fragment Shader (nebula.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `u_time` | `float` | Elapsed seconds |
| `u_resolution` | `vec2` | Canvas dimensions |
| `u_mouse` | `vec2` | Normalized mouse (0-1) |
| `u_burstStrength` | `float` | Click burst (decays) |
| `u_brandPrimary` | `vec3` | Near gas color |
| `u_brandSecondary` | `vec3` | Mid dust color |
| `u_brandAccent` | `vec3` | Far/highlight color |
| `u_bgColor` | `vec3` | Deep space base |
| `u_density` | `float` | Gas opacity |
| `u_speed` | `float` | Evolution speed |
| `u_scale` | `float` | Cloud scale |
| `u_depth` | `int` | Ray steps (quality) |
| `u_wind` | `float` | Mouse wind strength |
| `u_stars` | `float` | Background star density |
| `u_intensity` | `float` | Overall blend |
| `u_grain` | `float` | Film grain |
| `u_vignette` | `float` | Vignette |

### Algorithm

1. **UVs**: `(2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y` for aspect-correct coords
2. **Stellar wind**: offset UVs by `(u_mouse - 0.5) * u_wind`
3. **Star field**: grid-based random stars behind gas, twinkling via time modulation
4. **Raymarch** (front-to-back compositing, u_depth steps):
   - At each step, compute depth fraction (0=near, 1=far)
   - Sample FBM noise at depth-scaled position with per-layer rotation
   - Near layers: higher frequency, primary color
   - Mid layers: medium frequency, secondary color
   - Far layers: lower frequency, accent color
   - Accumulate color/alpha with `accum += layerColor * density * (1.0 - accAlpha)`
   - Early exit when alpha > 0.95
5. **Click burst**: bright star flash at cursor via Gaussian
6. **Composite**: stars behind gas, gas on deep space background
7. **Post-process**: Reinhard, cap at 0.7, intensity blend, vignette, grain

### Noise

- `sin(p.x)*sin(p.y)` noise consistent with warp convention
- 3-octave FBM with `mat2(0.8, 0.6, -0.6, 0.8)` inter-octave rotation
- Per-step: noise sampled at scaled+rotated+time-offset position

### Performance

- 8 steps default × 3 octaves = 24 noise evals per pixel
- 4 steps (min) = 12 evals — suitable for mobile
- 16 steps (max) = 48 evals — desktop only
- DPR cap at 1 on mobile already reduces fragment count by up to 9x
- Early exit at alpha > 0.95 saves 2-4 steps on dense regions
- Estimated: ~3-6ms desktop, ~4-8ms mobile at DPR 1

## Renderer (nebula-renderer.ts)

Single-pass, follows ether-renderer pattern:
- One program (no FBOs)
- Internal lerped mouse state (MOUSE_LERP ≈ 0.04) for smooth wind
- Passes `mouse.burstStrength` to `u_burstStrength` (first single-pass preset to use it)
- `u_depth` via `gl.uniform1i()` (int uniform)
- `resize()` is no-op, `reset()` resets lerped mouse to center
- `destroy()` deletes program + quad

## Brand Editor Sliders

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| `shader-nebula-density` | Gas Density | 0.30 | 2.00 | 0.05 | 0.80 | Thin | Thick |
| `shader-nebula-speed` | Evolution Speed | 0.05 | 0.50 | 0.01 | 0.12 | Frozen | Flowing |
| `shader-nebula-scale` | Cloud Scale | 1.0 | 5.0 | 0.5 | 2.0 | Fine | Vast |
| `shader-nebula-depth` | Depth Quality | 4 | 16 | 1 | 8 | Fast | Rich |
| `shader-nebula-wind` | Stellar Wind | 0.00 | 2.00 | 0.05 | 0.50 | Still | Gale |
| `shader-nebula-stars` | Star Density | 0.00 | 1.00 | 0.05 | 0.30 | Dark | Milky |

## Gotchas

1. **BRAND_PREFIX_KEYS** — all 6 keys must be registered
2. **`u_depth` as int** — use `gl.uniform1i()`, `Math.round()` in config
3. **`u_burstStrength`** — first single-pass preset to use it. MouseState already has it, ShaderHero already decays it
4. **Mouse Y** — bottom-to-top (0=bottom, 1=top) per renderer-types.ts, matches gl_FragCoord.y
5. **`v_uv` vs `gl_FragCoord`** — use gl_FragCoord for main UVs (aspect-correct), v_uv only for post-processing (vignette)
6. **Star field** — use v_uv (not warped uv) so stars stay fixed while gas drifts
7. **sin-based noise periodicity** — u_scale keeps visible region within one period; rotation masks tiling
8. **Preset grid** — 8th card in 2-col grid = 4 rows (even)

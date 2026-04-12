# Topographic Contour Shader Preset — Implementation Plan

## Overview

Add a "topo" shader preset: animated contour lines on a procedural heightfield, colored by the full brand gradient. Single-pass (no FBO). Mouse creates elevation hills that generate new contour rings. Clean, minimal aesthetic.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify — add `TopoConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/topo.frag.ts` | Create — single-pass fragment shader |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/renderers/topo-renderer.ts` | Create — single-pass renderer |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify — add `'topo'` to loadRenderer |
| 5 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify — add 6 keys to BRAND_PREFIX_KEYS |
| 6 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify — preset card + sliders |

## Config Interface

```typescript
export interface TopoConfig extends ShaderConfigBase {
  preset: 'topo';
  lineCount: number;   // 5-30, default 12
  lineWidth: number;   // 0.5-3.0, default 1.2
  speed: number;       // 0.05-0.50, default 0.15
  scale: number;       // 1.0-5.0, default 2.5
  elevation: number;   // 0.5-3.0, default 1.0
  octaves: number;     // 2-5, default 3
}
```

## Defaults

```typescript
topoLineCount: 12,
topoLineWidth: 1.2,
topoSpeed: 0.15,
topoScale: 2.5,
topoElevation: 1.0,
topoOctaves: 3,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

```
shader-topo-line-count
shader-topo-line-width
shader-topo-speed
shader-topo-scale
shader-topo-elevation
shader-topo-octaves
```

## Fragment Shader (topo.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `u_time` | `float` | Elapsed seconds |
| `u_resolution` | `vec2` | Canvas pixel dimensions |
| `u_mouse` | `vec2` | Normalized mouse (0-1) |
| `u_mouseActive` | `float` | 1.0 when hovering |
| `u_burst` | `float` | Click burst strength |
| `u_brandPrimary` | `vec3` | Brand primary |
| `u_brandSecondary` | `vec3` | Brand secondary |
| `u_brandAccent` | `vec3` | Brand accent |
| `u_bgColor` | `vec3` | Background |
| `u_lineCount` | `int` | Contour levels |
| `u_lineWidth` | `float` | Line thickness |
| `u_speed` | `float` | Noise animation speed |
| `u_scale` | `float` | Noise zoom |
| `u_elevation` | `float` | Mouse hill height |
| `u_octaves` | `int` | FBM octave count |
| `u_intensity` | `float` | Overall blend |
| `u_grain` | `float` | Film grain |
| `u_vignette` | `float` | Vignette strength |

### Algorithm

1. **Heightfield**: Layered FBM noise (2-5 octaves, sin-based like warp, inter-octave rotation)
2. **Mouse hill**: Gaussian added to heightfield at cursor. Burst creates larger hill.
3. **Contour lines**: `fract(height * lineCount)` with anti-aliased rendering via `fwidth()`
4. **Color by height**: Map height → brand gradient (bg → primary → secondary → accent) using 3-segment mix
5. **Fill**: Darkened subtle gradient between lines on dark bg
6. **Composite**: Bright gradient-colored lines on dark fill
7. **Post-process**: Reinhard, intensity blend, vignette, grain, clamp to 0.75

### Key GLSL Notes

- `fwidth()` is built-in to GLSL ES 3.0 (no extension needed)
- For-loop with `if (i >= u_octaves) break;` needs constant upper bound (5)
- Aspect ratio correction for mouse hill: use `u_resolution.x / u_resolution.y`
- Height remap: `clamp(h * 0.5 + 0.5, 0.0, 1.0)` before gradient mapping

## Renderer (topo-renderer.ts)

Single-pass, follows warp-renderer pattern:
- One program (no FBOs)
- Pass all uniforms each frame
- `u_lineCount` and `u_octaves` via `gl.uniform1i()` (not float)
- `u_mouseActive` and `u_burst` as separate uniforms (unlike warp/ether)
- `resize()` and `reset()` are no-ops
- `destroy()` deletes program + quad

## Brand Editor Sliders

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| `shader-topo-line-count` | Contour Lines | 5 | 30 | 1 | 12 | Few | Dense |
| `shader-topo-line-width` | Line Width | 0.5 | 3.0 | 0.1 | 1.2 | Thin | Thick |
| `shader-topo-speed` | Animation Speed | 0.05 | 0.50 | 0.05 | 0.15 | Slow | Fast |
| `shader-topo-scale` | Noise Scale | 1.0 | 5.0 | 0.5 | 2.5 | Zoomed | Wide |
| `shader-topo-elevation` | Mouse Elevation | 0.5 | 3.0 | 0.1 | 1.0 | Flat | Tall |
| `shader-topo-octaves` | Detail (octaves) | 2 | 5 | 1 | 3 | Smooth | Detailed |

## Gotchas

1. **BRAND_PREFIX_KEYS** — all 6 keys must be registered
2. **`fwidth()` on mobile** — may produce noisy derivatives. `u_lineWidth` gives user control
3. **For-loop dynamic bound** — constant upper bound of 5 required for GLSL ES 3.0
4. **No naming collisions** — `shader-topo-speed` vs warp's `shader-speed`, `shader-topo-scale` vs ether's `shader-scale` — all properly namespaced
5. **`lineCount` and `octaves` as int** — use `Math.round()` in config, `gl.uniform1i()` in renderer
6. **Height normalization** — clamp after remap to handle mouse hill overflow
7. **Preset grid** — 7th card in 2-col grid = 4 rows, last row has 1 card (fine)

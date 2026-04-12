# 14 — Final Preset Catalog (Approved)

**Status**: All 4 presets approved by user. Ready for production integration.
**Date**: 2026-04-09

---

## Approved Presets

### 1. Suture Fluid

| Property | Value |
|----------|-------|
| **File** | `preview/preset-suture.html` |
| **Reference** | Shadertoy XddSRX by cornusammonis |
| **Architecture** | 2-pass (ping-pong FBO, 512x512 sim) |
| **Technique** | Reaction-diffusion-advection in single buffer |
| **Visual** | Organic viscous fingering — marble veins, bacterial growth, flowing silk |
| **Interaction** | Hover paints fluid, click bursts, self-sustaining patterns |
| **GPU Cost** | ~2ms/frame (2 passes at 512x512) |
| **User Feedback** | "Excellent" |

**Key GLSL**: 3x3 Laplacian stencil, curl-driven rotation, divergence pressure feedback, reverse advection with Gaussian smoothing. Mouse force: `exp(-dist²/radius²) * normalize(dir)`.

**Configurable**: Curl strength, dissipation, force, intensity, grain, vignette.

---

### 2. Ether

| Property | Value |
|----------|-------|
| **File** | `preview/preset-ether.html` |
| **Reference** | Shadertoy MsjSW3 by nimitz |
| **Architecture** | Single-pass (no FBOs) |
| **Technique** | Raymarching through 3D signed distance field |
| **Visual** | Ethereal glowing organic 3D forms floating in branded space |
| **Interaction** | Mouse parallax (view shift), scroll to zoom |
| **GPU Cost** | ~3-5ms/frame (6 raymarch steps × 2 map evaluations) |
| **User Feedback** | Delivered, approved in catalog |

**Key GLSL**: `map(p)` = `length(p+sin(t)) * log(length(p)+1) + sin(q.x+sin(q.z+sin(q.y))) - 1`. Multiplicative color accumulation in raymarch loop.

**Configurable**: Rotation speed, complexity (raymarch steps), glow intensity, scale, zoom, intensity, grain, vignette.

---

### 3. Domain Warp

| Property | Value |
|----------|-------|
| **File** | `preview/preset-warp.html` |
| **Reference** | lsl3RH technique (domain warping, implemented from scratch) |
| **Architecture** | Single-pass (no FBOs) |
| **Technique** | Recursive FBM domain warping with bump-mapped lighting |
| **Visual** | Organic marble, cloud, and lava textures with 3D depth |
| **Interaction** | View parallax, time distortion, warp magnification near cursor |
| **GPU Cost** | ~4-8ms/frame (3 warp evaluations for bump normals) |
| **User Feedback** | Approved in catalog |

**Key GLSL**: `noise(p) = sin(p.x)*sin(p.y)` (CRITICAL — must use this, not hash noise). FBM with inter-octave rotation matrix `mat2(0.8, 0.6, -0.6, 0.8)`. Two-stage warp: `fbm4 → fbm6 → fbm4`. 4-layer brand color mixing from intermediate warp vectors.

**Configurable**: Warp strength, detail (octaves), animation speed, light angle, contrast, invert toggle, intensity, grain, vignette.

**License note**: Technique is public domain (mathematical concept). Our implementation is original — no code from IQ's copyrighted shader.

---

### 4. Water Ripple

| Property | Value |
|----------|-------|
| **File** | `preview/preset-ripple.html` |
| **Reference** | Shadertoy Mt33DH |
| **Architecture** | 2-pass (ping-pong FBO, 512x512 sim) |
| **Technique** | 2D wave equation with normal-mapped surface |
| **Visual** | Gently rippling water with brand-colored reflections and caustics |
| **Interaction** | Hover creates continuous soft ripples, click for splashes |
| **GPU Cost** | ~2ms/frame (2 passes at 512x512) |
| **User Feedback** | "Beautiful, really great, loving them all" |

**Key GLSL**: Wave equation `next = 2*current - previous + c²*laplacian`. Surface normals from height gradient. Fresnel reflection (Schlick approximation). Caustic highlights from gradient magnitude.

**Configurable**: Wave speed, damping, ripple size, refraction strength, intensity, grain, vignette.

---

## Production Integration Plan

### tokenOverrides Schema

Each preset is selected via `tokenOverrides['shader-preset']`:

```typescript
type ShaderPresetId = 'suture' | 'ether' | 'warp' | 'ripple' | 'none';
```

Additional per-preset config stored as `tokenOverrides` entries:

| Key | Type | Default | Used By |
|-----|------|---------|---------|
| `shader-preset` | string | `'none'` | All |
| `shader-intensity` | string (0-1) | `'0.40'` | All |
| `shader-grain` | string (0-0.08) | `'0.025'` | All |
| `shader-vignette` | string (0-0.5) | `'0.20'` | All |
| `shader-curl` | string (1-80) | `'30'` | Suture |
| `shader-dissipation` | string (0.9-0.999) | `'0.985'` | Suture |
| `shader-rotation-speed` | string (0.1-1) | `'0.40'` | Ether |
| `shader-complexity` | string (3-8) | `'6'` | Ether |
| `shader-zoom` | string (1-8) | `'5.0'` | Ether |
| `shader-warp-strength` | string (0.5-3) | `'1.5'` | Warp |
| `shader-light-angle` | string (0-360) | `'135'` | Warp |
| `shader-wave-speed` | string (0.1-2) | `'0.80'` | Ripple |
| `shader-damping` | string (0.98-0.999) | `'0.995'` | Ripple |

### Component Structure

```
apps/web/src/lib/components/ui/ShaderHero/
├── ShaderHero.svelte           # Main component
├── index.ts                    # Barrel export
├── shader-config.ts            # Parse tokenOverrides → config
├── renderers/
│   ├── suture-renderer.ts      # 2-pass RDA engine
│   ├── ether-renderer.ts       # Single-pass raymarch
│   ├── warp-renderer.ts        # Single-pass FBM warp
│   └── ripple-renderer.ts      # 2-pass wave equation
└── shaders/                    # GLSL source strings
    ├── suture-sim.frag
    ├── suture-display.frag
    ├── ether.frag
    ├── warp.frag
    ├── ripple-sim.frag
    ├── ripple-display.frag
    └── shared.vert
```

### Brand Editor Level

Add `'hero-effects'` to the brand editor with:
- Preset selector (4 cards with static thumbnails)
- Per-preset parameter sliders (shown/hidden based on selected preset)
- Overall intensity, grain, vignette controls
- "None" option to disable shader

### Migration Path

1. **WP-00**: Add `shader-*` keys to `BRAND_PREFIX_KEYS` in `css-injection.ts`
2. **WP-01**: Port shared WebGL infrastructure (FBO, compile, quad, uniforms)
3. **WP-02**: Port each preset renderer (4 files, one per preset)
4. **WP-03**: Build `ShaderHero.svelte` component
5. **WP-04**: Wire into `+page.svelte` (replace hero section)
6. **WP-05**: Build `BrandEditorHeroEffects.svelte`
7. **WP-06**: CSS fallback for non-WebGL browsers
8. **WP-07**: Mobile optimization (DPR cap, reduced sim resolution, idle pause)
9. **WP-08**: Testing (brand palette × preset matrix, cross-browser, mobile)

# Plasma Shader Preset Plan

**Source**: [Shadertoy Wt2BR1](https://www.shadertoy.com/view/Wt2BR1) — PIC fluid + slime mold sensors
**Type**: FBO-based (ping-pong 512x512 sim + display pass)
**Preset ID**: `plasma`

## Algorithm

Simplified from a 4-buffer Particle-in-Cell fluid into a single ping-pong FBO:

1. **Semi-Lagrangian advection**: Read state at `pos - velocity * dt` (replaces conservative PIC transport)
2. **Pressure gradient**: `F = -pressure * ∇ρ` using ideal gas law (`P ∝ ρ`)
3. **Slime mold turning**: 8 angular sensors sample trail density at offsets from velocity heading; net lateral force rotates velocity toward higher concentrations
4. **Diffusion**: 5-point Laplacian blur spreads density/trail
5. **Density normalization**: `ρ = mix(ρ, target, rate)` prevents blowup/extinction
6. **Mouse interaction**: Hover injects vortex force; click burst adds density spike

### Buffer Format (RGBA16F)
- R: velocity.x
- G: velocity.y
- B: density (mass field)
- A: trail (chemical pheromone for slime sensors)

### Display Pass
Maps density to brand colors: `sin(vec3(1,2,3) * bands * ρ³)` creates iridescent banding, then remapped to brand palette via weighted mix.

## Config Interface

```typescript
export interface PlasmaConfig extends ShaderConfigBase {
  preset: 'plasma';
  speed: number;      // 0.2-2.0, default 0.80 — sim time scale
  bands: number;      // 5.0-40.0, default 25.0 — color band frequency
  pressure: number;   // 0.2-2.0, default 0.90 — pressure force strength
  turn: number;       // 0.02-0.25, default 0.11 — slime turning force
  diffusion: number;  // 0.5-2.0, default 1.20 — diffusion spread
}
```

## CSS Keys (BRAND_PREFIX_KEYS)
- `shader-plasma-speed`
- `shader-plasma-bands`
- `shader-plasma-pressure`
- `shader-plasma-turn`
- `shader-plasma-diffusion`

## DEFAULTS (shader-config.ts)
```
plasmaSpeed: 0.80
plasmaBands: 25.0
plasmaPressure: 0.90
plasmaTurn: 0.11
plasmaDiffusion: 1.20
```

## Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| shader-plasma-speed | Flow Speed | 0.20 | 2.00 | 0.10 | 0.80 | Slow | Fast |
| shader-plasma-bands | Color Bands | 5.0 | 40.0 | 1.0 | 25.0 | Few | Many |
| shader-plasma-pressure | Pressure | 0.20 | 2.00 | 0.10 | 0.90 | Soft | Strong |
| shader-plasma-turn | Slime Turn | 0.02 | 0.25 | 0.01 | 0.11 | Gentle | Sharp |
| shader-plasma-diffusion | Diffusion | 0.50 | 2.00 | 0.10 | 1.20 | Tight | Spread |

## Brand Color Mapping
- **Primary**: dominant color in high-density bands
- **Secondary**: mid-density regions
- **Accent**: density peaks/edges where curl is high
- **Background**: vacuum/low-density regions

## Mouse Interaction
- **Hover**: injects rotational vortex force (perpendicular to mouse-to-fragment vector)
- **Click burst**: deposits density spike + radial impulse

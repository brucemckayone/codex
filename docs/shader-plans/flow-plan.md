# Flow Shader Preset Plan

**Source**: Shadertoy curl-noise vector field painting (Flexi's dynamical system, XddSRX derivative)
**Type**: FBO-based (ping-pong 512x512 sim + display pass)
**Preset ID**: `flow`

## Algorithm

A self-organising vector field that creates flowing paint-streak patterns:

### Sim Pass (vector field evolution)
1. **Self-advection**: Advect the vector field along itself using reverse advection with 3x3 Gaussian filter
2. **Laplacian**: Compute 9-point Laplacian of the field using weighted stencil (center -20/6, edges 4/6, corners 1/6)
3. **Curl rotation**: Compute curl from cross-derivatives, derive rotation angle (`sc = -curl_strength * sign(curl) * |curl|^power`), rotate the advected vector
4. **Divergence tracking**: Track and smooth divergence in the Z channel, feed back as pressure correction
5. **Update smoothing**: Blend new state with previous (`upd * old + (1-upd) * new`)
6. **Normalisation**: Normalize vector magnitude to prevent blowup

### Display Pass (flow-aligned color mapping)
Since we don't have a separate image buffer, the display creates color from the vector field itself:
1. **Line Integral Convolution (LIC)**: Sample ~8 points along the flow direction, accumulate weighted color
2. **Direction-to-hue**: Map vector angle to blend between brand colors
3. **Magnitude-to-brightness**: Stronger vectors = brighter
4. **Sigmoid contrast**: Apply sigmoid contrast for punchy output
5. Standard post-processing chain

## Buffer Format (RGBA16F)
- R: vector field X component (-1 to 1)
- G: vector field Y component (-1 to 1)
- B: divergence (-1 to 1)
- A: age/trail accumulator

## Config Interface

```typescript
export interface FlowConfig extends ShaderConfigBase {
  preset: 'flow';
  curl: number;      // 0.1-1.5, default 0.60 — curl rotation strength
  advection: number;  // 1.0-12.0, default 6.0 — advection distance
  smoothing: number;  // 0.3-0.95, default 0.80 — update blend factor
  contrast: number;   // 4.0-20.0, default 12.0 — sigmoid contrast
  fieldSpeed: number; // 0.2-2.0, default 1.0 — overall time scale
}
```

## CSS Keys
- `shader-flow-curl`
- `shader-flow-advection`
- `shader-flow-smoothing`
- `shader-flow-contrast`
- `shader-flow-field-speed`

## DEFAULTS (shader-config.ts)
```
flowCurl: 0.6
flowAdvection: 6.0
flowSmoothing: 0.8
flowContrast: 12.0
flowFieldSpeed: 1.0
```

## Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| shader-flow-curl | Curl Strength | 0.10 | 1.50 | 0.05 | 0.60 | Gentle | Tight |
| shader-flow-advection | Advection | 1.0 | 12.0 | 0.5 | 6.0 | Short | Long |
| shader-flow-smoothing | Smoothing | 0.30 | 0.95 | 0.05 | 0.80 | Crisp | Smooth |
| shader-flow-contrast | Contrast | 4.0 | 20.0 | 1.0 | 12.0 | Soft | Punchy |
| shader-flow-field-speed | Field Speed | 0.20 | 2.00 | 0.10 | 1.00 | Slow | Fast |

## Brand Color Mapping
- **Primary**: Dominant flow direction (positive curl regions)
- **Secondary**: Opposite flow direction (negative curl regions)
- **Accent**: High divergence areas (source/sink points)
- **Background**: Low magnitude / quiescent regions

## Mouse Interaction
- **Hover**: Pushes vectors radially outward from cursor (like the original `iMouse.z` interaction)
- **Click burst**: Strong radial push + curl injection

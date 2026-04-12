# Lenia (Advanced Continuous Cellular Automata) Shader Preset -- Implementation Plan

## Overview

Add a "lenia" shader preset: an advanced continuous cellular automaton that produces complex artificial lifeforms which crawl, pulsate, and morph across the canvas. Unlike SmoothLife's ring-shaped kernel (binary inner/outer disc split), Lenia uses a smooth bump-function kernel peaked at a configurable radius, producing creatures with distinct internal structure -- concentric rings, radial symmetry, and genuinely biological-looking morphology. State is a continuous float in [0,1]. A Gaussian-shaped growth function maps the kernel convolution result to a growth rate, determining whether material grows or decays.

Uses a 2-pass FBO ping-pong at **256x256** (lower resolution because the kernel convolution is the most expensive operation -- every fragment must sum contributions from all texels within the kernel radius). Each frame runs `speed` simulation steps, each computing the bump-kernel convolution and applying the growth function to evolve the state.

The mouse deposits "seed" patterns -- tapping creates a blob that may grow into a creature; dragging trails life material. Lerped mouse from ShaderHero.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify -- add `LeniaConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/lenia-sim.frag.ts` | Create -- simulation shader (bump-kernel convolution + Gaussian growth function) |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/shaders/lenia-display.frag.ts` | Create -- display shader (state value to brand colour gradient with concentric zone mapping) |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/renderers/lenia-renderer.ts` | Create -- ShaderRenderer impl (FBO ping-pong, multi-substep, seed init + warm-up) |
| 5 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify -- add `'lenia'` to `loadRenderer` switch |
| 6 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify -- add 5 keys to `BRAND_PREFIX_KEYS` |
| 7 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify -- add preset card + slider state + slider UI |

## Config Interface

```typescript
export interface LeniaConfig extends ShaderConfigBase {
  preset: 'lenia';
  radius: number;   // 8.0-20.0, default 13.0 -- Kernel radius (determines creature size)
  growth: number;    // 0.10-0.20, default 0.14 -- Growth centre (target convolution value for the Gaussian growth function)
  width: number;     // 0.01-0.05, default 0.015 -- Growth function width (sharpness of the Gaussian; narrower = more selective, sharper creatures)
  speed: number;     // 1-4, default 2 (int) -- Sim steps per frame
  dt: number;        // 0.1-0.5, default 0.2 -- Integration timestep (how fast state tracks the growth function)
}
```

## Defaults

```typescript
// In DEFAULTS object in shader-config.ts:
leniaRadius: 13.0,
leniaGrowth: 0.14,
leniaWidth: 0.015,
leniaSpeed: 2,
leniaDt: 0.2,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

All 5 keys must be added to the `BRAND_PREFIX_KEYS` Set in `css-injection.ts`:

```
shader-lenia-radius
shader-lenia-growth
shader-lenia-width
shader-lenia-speed
shader-lenia-dt
```

## ShaderPresetId Update

Update the type union in `shader-config.ts`:

```typescript
export type ShaderPresetId = 'suture' | 'ether' | 'warp' | 'ripple' | 'pulse' | 'ink' | 'topo' | 'nebula' | 'turing' | 'silk' | 'glass' | 'film' | 'flux' | 'lava' | 'lenia' | 'none';
```

## Simulation Shader (lenia-sim.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `uState` | `sampler2D` | Ping-pong simulation texture. R = cell state (0.0 = dead, 1.0 = fully alive, continuous) |
| `uTexel` | `vec2` | 1.0 / simResolution (1/256) |
| `uRadius` | `float` | Kernel radius in texels (8-20) |
| `uGrowth` | `float` | Growth function centre / target convolution value (0.10-0.20) |
| `uWidth` | `float` | Growth function Gaussian width (0.01-0.05) |
| `uDt` | `float` | Integration timestep (0.1-0.5) |
| `uTime` | `float` | Elapsed time in seconds |
| `uMouse` | `vec2` | Mouse position (0-1) |
| `uMouseActive` | `float` | 1.0 if mouse is over canvas |
| `uMouseStrength` | `float` | Mouse deposit impulse strength |
| `uDropPos` | `vec2` | Ambient deposit position (-10 if none) |

### Buffer Format

```
R channel: cell state (continuous float, 0.0 = dead, 1.0 = fully alive)
G channel: reserved (0.0)
B channel: reserved (0.0)
A channel: 1.0
```

### Algorithm (GLSL Pseudocode)

```glsl
#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uRadius;    // kernel radius in texels
uniform float uGrowth;    // growth centre (target convolution value)
uniform float uWidth;     // growth function Gaussian width
uniform float uDt;        // integration timestep
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uMouseStrength;
uniform vec2 uDropPos;

// ---- Bump function kernel ----
// Bell-shaped / bump kernel: peaked at distance r=radius/2, zero at r=0 and r=radius.
// K(r) = exp(alpha - alpha / (4*r*(1-r))) for r in (0,1), K(0)=K(1)=0
// where r is normalized distance (d/radius), alpha controls peakiness.
// This is the standard Lenia kernel -- NOT a ring like SmoothLife.
// The bump shape means creatures develop concentric internal structure.
float bumpKernel(float normalizedDist) {
  // normalizedDist = actual_distance / radius, in [0, 1]
  if (normalizedDist <= 0.0 || normalizedDist >= 1.0) return 0.0;
  float r = normalizedDist;
  float rr = 4.0 * r * (1.0 - r);  // peaks at r=0.5, zero at r=0,1
  // Avoid division by zero at edges
  if (rr < 0.001) return 0.0;
  float alpha = 4.0;  // Controls kernel shape peakiness
  return exp(alpha - alpha / rr);
}

// ---- Growth function: Gaussian centred at uGrowth with width uWidth ----
// G(u) = 2.0 * exp(-((u - mu)^2) / (2 * sigma^2)) - 1.0
// Returns values in [-1, 1]:
//   G > 0 when convolution is near the target (growth)
//   G < 0 when convolution is far from the target (decay)
float growthFunction(float convolution) {
  float diff = convolution - uGrowth;
  return 2.0 * exp(-(diff * diff) / (2.0 * uWidth * uWidth)) - 1.0;
}

void main() {
  float state = texture(uState, v_uv).r;

  // ---- 1. Compute bump-kernel weighted convolution ----
  // Sum K(|d|/R) * state(x+d) over all texels within radius R.
  // Normalize by sum of kernel weights (integral of K).
  //
  // PERFORMANCE: This is the most expensive operation.
  // At radius=13 on a 256x256 grid, the kernel covers a ~26x26 texel area.
  // We sample in concentric rings with spacing ~1.5 texels to reduce
  // the sample count from ~676 (full grid) to ~120 (ring sampling).
  // This is comparable to SmoothLife's ~64 samples but with a wider kernel.

  float kernelSum = 0.0;
  float weightSum = 0.0;
  float R = uRadius * uTexel.x;  // radius in UV space

  // Sample in concentric rings from center outward
  for (float r = uTexel.x; r <= R; r += uTexel.x * 1.4) {
    float normalizedR = r / R;
    float w = bumpKernel(normalizedR);
    if (w < 0.001) continue;  // Skip negligible weights

    // Number of samples on this ring proportional to circumference
    float circumference = max(1.0, 6.2832 * r / (uTexel.x * 1.4));
    float angleStep = 6.2832 / circumference;

    for (float a = 0.0; a < 6.2832; a += angleStep) {
      vec2 offset = vec2(cos(a), sin(a)) * r;
      float s = texture(uState, v_uv + offset).r;
      kernelSum += w * s;
      weightSum += w;
    }
  }

  float convolution = kernelSum / max(weightSum, 0.001);

  // ---- 2. Apply growth function ----
  float growth = growthFunction(convolution);

  // ---- 3. Integrate: smooth transition toward growth target ----
  // state += dt * G(U) where G is in [-1, 1]
  float newState = state + uDt * growth;

  // ---- 4. Mouse life deposit (seed pattern) ----
  if (uMouseActive > 0.5) {
    vec2 d = v_uv - uMouse;
    float r = 0.04;  // deposit radius
    float deposit = uMouseStrength * 0.5 * exp(-dot(d, d) / (r * r));
    newState += deposit;
  }

  // ---- 5. Ambient deposit (keep the simulation alive) ----
  if (uDropPos.x > -5.0) {
    vec2 d = v_uv - uDropPos;
    float r = 0.06;  // slightly larger than mouse for ambient
    newState += 0.4 * exp(-dot(d, d) / (r * r));
  }

  // ---- 6. Clamp + edge damping ----
  newState = clamp(newState, 0.0, 1.0);

  // Edge damping: smoothstep fade near boundaries (wider than ink/turing
  // because the kernel radius extends up to 20 texels from each fragment)
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 8.0), v_uv)
            * smoothstep(vec2(0.0), vec2(uTexel * 8.0), 1.0 - v_uv);
  newState *= edge.x * edge.y;

  fragColor = vec4(newState, 0.0, 0.0, 1.0);
}
```

### Key Design Decisions

1. **256x256 sim resolution**: The bump-kernel convolution is expensive -- at radius 13, each fragment samples from a ~26-diameter circle. Using ring sampling reduces from ~676 grid samples to ~120, but this is still ~2x more than SmoothLife's ~64. At 256x256 with 2 steps/frame: 256*256*120*2 = ~15.7M texture reads per frame. At 512x512 this would be ~62.9M -- far too heavy. 256x256 keeps it under budget.

2. **Bump-function kernel (NOT ring-shaped)**: This is the fundamental difference from SmoothLife. The Lenia kernel is a smooth bell curve peaked at half the radius, dropping to zero at center and edge. This produces creatures with concentric internal structure (dense core, lighter corona) rather than SmoothLife's uniform blobs. The `bumpKernel()` function uses the standard Lenia formulation: `exp(alpha - alpha/(4r(1-r)))`.

3. **Gaussian growth function**: Maps convolution result to growth rate via `G(u) = 2*exp(-(u-mu)^2 / (2*sigma^2)) - 1`. When the local neighbourhood density matches the target (`uGrowth`), growth is positive (material accumulates). When it deviates, growth is negative (material decays). The width (`uWidth`) controls selectivity -- narrower = more specific creature morphologies, wider = more tolerant/blobby.

4. **Concentric ring sampling**: Sample at radial increments of 1.4 texels (not 1.5 as in SmoothLife) because the bump kernel has more fine structure that benefits from slightly denser sampling. On each ring, angular samples are proportional to circumference, giving approximately uniform spatial coverage.

5. **Integration timestep `dt`**: Unlike SmoothLife's fixed dt=0.12, Lenia exposes `dt` as a configurable parameter (0.1-0.5, default 0.2). Lower dt = smoother, more stable creatures that evolve slowly. Higher dt = faster, more dynamic, but risk of instability (oscillation/explosion). The default 0.2 balances visual interest with stability.

6. **Edge damping extends to 8 texels**: Wider than SmoothLife (6 texels) because the Lenia kernel radius can be up to 20 texels, meaning boundary artifacts extend further. 8 texels provides sufficient fade without excessive visible border.

7. **Growth function output range [-1, 1]**: The Gaussian peaks at +1.0 (perfect match) and approaches -1.0 (far from target). Multiplied by dt, a single step changes state by at most +/-0.2 (at default dt), ensuring smooth evolution.

## Display Shader (lenia-display.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `uState` | `sampler2D` | Sim texture (R = cell state 0-1) |
| `uColorPrimary` | `vec3` | Brand primary (low-density fading zones) |
| `uColorSecondary` | `vec3` | Brand secondary (mid-density body) |
| `uColorAccent` | `vec3` | Brand accent (peak-density core) |
| `uBgColor` | `vec3` | Background colour (dead cells / void) |
| `uIntensity` | `float` | Brightness multiplier |
| `uGrain` | `float` | Film grain strength |
| `uVignette` | `float` | Vignette strength |
| `uTime` | `float` | For grain animation |

### Algorithm (GLSL Pseudocode)

```glsl
#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // ---- 1. Read cell state ----
  float state = texture(uState, v_uv).r;

  // ---- 2. Multi-stop colour ramp: bg -> primary -> secondary -> accent ----
  // Maps concentric creature structure to brand colours:
  //   0.0 = void (bg)
  //   0.0-0.25 = outermost corona / fading trails (bg -> primary)
  //   0.25-0.55 = outer body ring (primary -> secondary)
  //   0.55-1.0 = inner core / dense centre (secondary -> accent)
  // These thresholds create visible colour bands in the concentric ring structure.
  vec3 color;
  float t = clamp(state * uIntensity, 0.0, 1.0);

  if (t < 0.25) {
    color = mix(uBgColor, uColorPrimary, t / 0.25);
  } else if (t < 0.55) {
    color = mix(uColorPrimary, uColorSecondary, (t - 0.25) / 0.30);
  } else {
    color = mix(uColorSecondary, uColorAccent, (t - 0.55) / 0.45);
  }

  // ---- 3. Concentric ring highlight (screen-space derivatives) ----
  // The bump kernel creates natural concentric zones within creatures.
  // Highlight zone boundaries with a subtle edge glow.
  float dSdx = dFdx(state);
  float dSdy = dFdy(state);
  float edgeMag = abs(dSdx) + abs(dSdy);
  float edgeGlow = smoothstep(0.003, 0.05, edgeMag);
  color += edgeGlow * 0.04 * uColorAccent * uIntensity;

  // ---- 4. Core pulsing (alive creatures subtly breathe) ----
  float pulse = 0.5 + 0.5 * sin(uTime * 1.2 + state * 10.0);
  float coreGlow = smoothstep(0.65, 1.0, state) * pulse * 0.05;
  color += coreGlow * uColorAccent;

  // ---- 5. Reinhard tone mapping ----
  color = color / (1.0 + color);

  // ---- 6. Vignette ----
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // ---- 7. Film grain ----
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  // ---- 8. Brightness cap ----
  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
```

### Brand Colour Mapping

The concentric ring structure of Lenia creatures creates natural colour bands:

| State Value | Colour | Visual Role |
|-------------|--------|-------------|
| 0.0 (dead) | `bg` | Void / empty space between creatures |
| 0.0-0.25 | `bg` -> `primary` | Outermost corona, fading trails, thin edges |
| 0.25-0.55 | `primary` -> `secondary` | Outer body ring, main creature mass |
| 0.55-1.0 | `secondary` -> `accent` | Dense inner core, centre of organisms |

The 3-stop ramp is shifted compared to SmoothLife (which uses 0.3/0.7 breakpoints) because Lenia creatures have denser cores with more gradual falloff. The wider primary band (0-0.25) captures the fine corona/trail structure, while the wider accent band (0.55-1.0) emphasizes the dense internal structure that distinguishes Lenia from simpler CAs.

## Renderer (lenia-renderer.ts)

Follows the turing-renderer / life-renderer pattern (FBO ping-pong with configurable steps per frame).

### Structure

```typescript
import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { LeniaConfig, ShaderConfig } from '../shader-config';
import { LENIA_DISPLAY_FRAG } from '../shaders/lenia-display.frag';
import { LENIA_SIM_FRAG } from '../shaders/lenia-sim.frag';
import {
  createDoubleFBO,
  createProgram,
  createQuad,
  type DoubleFBO,
  destroyDoubleFBO,
  drawQuad,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

const SIM_RES = 256;  // Lower res than ink/turing (512) due to expensive kernel
```

### Init Shader

The init shader must seed Lenia-appropriate initial state -- smooth circular blobs of varying size. Unlike SmoothLife which needs coarse grid hash patches, Lenia creatures emerge from smoother, rounder initial seeds because the bump kernel is sensitive to radial symmetry. Multiple overlapping Gaussian blobs at random positions provide the best starting conditions.

```glsl
const LENIA_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  float alive = 0.0;

  // Place ~12 smooth Gaussian blobs at pseudo-random positions
  // Each blob has a random radius between 0.03-0.08 in UV space
  for (float i = 0.0; i < 12.0; i += 1.0) {
    vec2 center = vec2(
      0.15 + hash21(vec2(i * 7.3, 13.1)) * 0.7,
      0.15 + hash21(vec2(i * 13.1 + 100.0, i * 3.7)) * 0.7
    );
    float blobRadius = 0.03 + hash21(vec2(i * 29.3, i * 17.7)) * 0.05;
    vec2 d = v_uv - center;
    float g = exp(-dot(d, d) / (blobRadius * blobRadius));
    alive += g;
  }

  // Clamp to [0, 1] -- overlapping blobs can exceed 1.0
  alive = clamp(alive, 0.0, 1.0);

  fragColor = vec4(alive, 0.0, 0.0, 1.0);
}
`;
```

### Sim Uniform Names

```typescript
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uRadius',
  'uGrowth',
  'uWidth',
  'uDt',
  'uTime',
  'uMouse',
  'uMouseActive',
  'uMouseStrength',
  'uDropPos',
] as const;
```

### Display Uniform Names

```typescript
const DISPLAY_UNIFORM_NAMES = [
  'uState',
  'uColorPrimary',
  'uColorSecondary',
  'uColorAccent',
  'uBgColor',
  'uIntensity',
  'uGrain',
  'uVignette',
  'uTime',
] as const;
```

### Render Loop

- **`speed` steps per frame** (1-4, default 2): configurable via the `shader-lenia-speed` slider. More steps per frame = faster evolution. At 256x256 with ~120 texture samples per fragment, 2 steps per frame = ~15.7M reads, which should run at 60fps on most GPUs.
- **Ambient deposits every 4-7s** at random positions to keep the simulation alive. Lenia creatures are more self-sustaining than SmoothLife (the growth function produces stable soliton-like organisms), but ambient deposits prevent the rare case of total extinction and inject fresh diversity.
- **Click bursts**: deposit a large smooth blob of life material at the click position over 5 frames with decaying strength. The blob may grow into a new creature if it's near enough to existing life or large enough to self-sustain.
- **Mouse hover**: continuous life deposit at the cursor. Uses the ShaderHero built-in lerped mouse position.

### stepSim Helper

```typescript
function stepSim(
  gl: WebGL2RenderingContext,
  time: number,
  mouseX: number,
  mouseY: number,
  mouseOn: boolean,
  mouseStr: number,
  dropX: number,
  dropY: number,
  cfg: LeniaConfig
): void {
  if (!simProg || !simU || !simBuf || !quad) return;

  gl.viewport(0, 0, SIM_RES, SIM_RES);
  gl.useProgram(simProg);
  quad.bind(simProg);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
  gl.uniform1i(simU.uState, 0);

  const tx = 1.0 / SIM_RES;
  gl.uniform2f(simU.uTexel, tx, tx);
  gl.uniform1f(simU.uRadius, cfg.radius);
  gl.uniform1f(simU.uGrowth, cfg.growth);
  gl.uniform1f(simU.uWidth, cfg.width);
  gl.uniform1f(simU.uDt, cfg.dt);
  gl.uniform1f(simU.uTime, time);
  gl.uniform2f(simU.uMouse, mouseX, mouseY);
  gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
  gl.uniform1f(simU.uMouseStrength, mouseStr);
  gl.uniform2f(simU.uDropPos, dropX, dropY);

  gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
  drawQuad(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  simBuf.swap();
}
```

### reset() Implementation

```typescript
reset(gl: WebGL2RenderingContext): void {
  if (!initProg || !simBuf || !quad) return;

  lastAmbientTime = 0;
  nextAmbientInterval = 4.0 + Math.random() * 3.0;
  clickBursts = [];

  gl.viewport(0, 0, SIM_RES, SIM_RES);
  gl.useProgram(initProg);
  quad.bind(initProg);

  // Seed both FBO sides with initial Gaussian blobs
  gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
  drawQuad(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
  drawQuad(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Warm-up: run 50 coast steps to let organisms form
  // Lenia needs slightly more warm-up than SmoothLife (40 steps) because
  // the bump kernel takes longer to shape initial blobs into stable creatures.
  if (!simProg || !simU) return;

  for (let w = 0; w < 50; w++) {
    gl.viewport(0, 0, SIM_RES, SIM_RES);
    gl.useProgram(simProg);
    quad.bind(simProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
    gl.uniform1i(simU.uState, 0);

    const tx = 1.0 / SIM_RES;
    gl.uniform2f(simU.uTexel, tx, tx);
    gl.uniform1f(simU.uRadius, 13.0);   // default radius
    gl.uniform1f(simU.uGrowth, 0.14);   // default growth centre
    gl.uniform1f(simU.uWidth, 0.015);   // default width
    gl.uniform1f(simU.uDt, 0.2);        // default dt
    gl.uniform1f(simU.uTime, 0.0);
    gl.uniform2f(simU.uMouse, -10.0, -10.0);
    gl.uniform1f(simU.uMouseActive, 0.0);
    gl.uniform1f(simU.uMouseStrength, 0.0);
    gl.uniform2f(simU.uDropPos, -10.0, -10.0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
    drawQuad(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    simBuf.swap();
  }
}
```

**CRITICAL**: The init shader must seed smooth circular Gaussian blobs, not hash noise. Lenia's bump kernel responds to radial symmetry -- jagged or noisy initial conditions produce chaotic transients before settling. Smooth blobs converge to stable creatures much faster, reducing the needed warm-up iterations. The warm-up runs 50 steps to let initial blobs reshape into recognizable Lenia organisms (gliders, pulsators, crawlers) before the first visible frame.

## Brand Editor Sliders

### DEFAULTS entries in BrandEditorHeroEffects.svelte

```typescript
'shader-lenia-radius': '13.0',
'shader-lenia-growth': '0.14',
'shader-lenia-width': '0.015',
'shader-lenia-speed': '2',
'shader-lenia-dt': '0.2',
```

### Derived state variables

```typescript
const leniaRadius = $derived(readNum('shader-lenia-radius'));
const leniaGrowth = $derived(readNum('shader-lenia-growth'));
const leniaWidth = $derived(readNum('shader-lenia-width'));
const leniaSpeed = $derived(readNum('shader-lenia-speed'));
const leniaDt = $derived(readNum('shader-lenia-dt'));
```

### PRESETS entry

```typescript
{ id: 'lenia', label: 'Lenia', description: 'Complex artificial lifeforms' },
```

### Slider UI

| id | label | min | max | step | default | minLabel | maxLabel | format |
|----|-------|-----|-----|------|---------|----------|----------|--------|
| `shader-lenia-radius` | Creature Size | 8.0 | 20.0 | 0.5 | 13.0 | Small | Large | `.toFixed(1)` |
| `shader-lenia-growth` | Growth Target | 0.10 | 0.20 | 0.005 | 0.14 | Sparse | Dense | `.toFixed(3)` |
| `shader-lenia-width` | Selectivity | 0.01 | 0.05 | 0.005 | 0.015 | Sharp | Soft | `.toFixed(3)` |
| `shader-lenia-speed` | Sim Speed | 1 | 4 | 1 | 2 | Slow | Fast | `Math.round()` |
| `shader-lenia-dt` | Timestep | 0.1 | 0.5 | 0.05 | 0.2 | Smooth | Rapid | `.toFixed(2)` |

### Template block (insert after lava section)

```svelte
{:else if activePreset === 'lenia'}
  <section class="hero-fx__section">
    <span class="hero-fx__section-label">Lenia</span>
    <BrandSliderField id="shader-lenia-radius" label="Creature Size" value={leniaRadius.toFixed(1)} min={8.0} max={20.0} step={0.5} current={leniaRadius} minLabel="Small" maxLabel="Large" oninput={handleSliderInput('shader-lenia-radius')} />
    <BrandSliderField id="shader-lenia-growth" label="Growth Target" value={leniaGrowth.toFixed(3)} min={0.10} max={0.20} step={0.005} current={leniaGrowth} minLabel="Sparse" maxLabel="Dense" oninput={handleSliderInput('shader-lenia-growth')} />
    <BrandSliderField id="shader-lenia-width" label="Selectivity" value={leniaWidth.toFixed(3)} min={0.01} max={0.05} step={0.005} current={leniaWidth} minLabel="Sharp" maxLabel="Soft" oninput={handleSliderInput('shader-lenia-width')} />
    <BrandSliderField id="shader-lenia-speed" label="Sim Speed" value={String(Math.round(leniaSpeed))} min={1} max={4} step={1} current={leniaSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-lenia-speed')} />
    <BrandSliderField id="shader-lenia-dt" label="Timestep" value={leniaDt.toFixed(2)} min={0.1} max={0.5} step={0.05} current={leniaDt} minLabel="Smooth" maxLabel="Rapid" oninput={handleSliderInput('shader-lenia-dt')} />
  </section>
```

## shader-config.ts Switch Case

```typescript
case 'lenia':
  return {
    ...base,
    preset: 'lenia',
    radius: rv('shader-lenia-radius', DEFAULTS.leniaRadius),
    growth: rv('shader-lenia-growth', DEFAULTS.leniaGrowth),
    width: rv('shader-lenia-width', DEFAULTS.leniaWidth),
    speed: Math.round(rv('shader-lenia-speed', DEFAULTS.leniaSpeed)),
    dt: rv('shader-lenia-dt', DEFAULTS.leniaDt),
  };
```

## ShaderHero.svelte loadRenderer Case

```typescript
case 'lenia': {
  const { createLeniaRenderer } = await import('./renderers/lenia-renderer');
  return createLeniaRenderer();
}
```

## Performance Considerations

### Kernel Convolution Cost Analysis

The bump-kernel convolution is by far the most expensive operation in this shader. Here is the detailed cost analysis:

| Radius | Diameter | Ring count | Samples/ring (avg) | Total samples/fragment | At 256x256, 2 steps | Total tex reads/frame |
|--------|----------|------------|--------------------|-----------------------|---------------------|----------------------|
| 8 | 16 | ~11 | ~7 | ~77 | 256*256*77*2 | ~10.1M |
| 13 (default) | 26 | ~18 | ~7 | ~120 | 256*256*120*2 | ~15.7M |
| 20 | 40 | ~28 | ~8 | ~190 | 256*256*190*2 | ~24.9M |

**Comparison to other presets:**
- Turing (512x512, 9-tap Laplacian, 4 steps): 512*512*9*4 = ~9.4M
- Ink (512x512, 5-tap + curl, 2 steps): 512*512*7*2 = ~3.7M
- SmoothLife (256x256, ~64 samples, 2 steps): 256*256*64*2 = ~8.4M
- **Lenia at default (256x256, ~120 samples, 2 steps): ~15.7M** -- heavier than SmoothLife but manageable

At the maximum radius (20) with maximum speed (4 steps), total reads reach ~49.8M per frame, which is heavy. The slider UI labels the high end clearly ("Large" / "Fast") to signal performance impact. In practice, users rarely push both to maximum simultaneously.

### Why 256x256, Not 512x512

At 512x512 with the default kernel (radius 13, ~120 samples, 2 steps):
- 512*512*120*2 = **62.9M texture reads per frame**
- This exceeds the ~20M budget for smooth 60fps on integrated GPUs
- 256x256 keeps the default at ~15.7M, well within budget
- LINEAR texture filtering on the display pass upscales to full canvas resolution without visible blockiness (the organic shapes have smooth gradients)

### Optimization: Ring Spacing and Early Termination

1. **Ring spacing 1.4 texels**: Denser than SmoothLife (1.5/1.8) because the bump kernel has a peaked shape where small radial changes matter more. But not 1.0 (full resolution) because that doubles sample count for minimal quality improvement.

2. **`if (w < 0.001) continue`**: The bump kernel approaches zero at both center and edge. Skipping negligible-weight rings saves ~10% of samples near the boundaries.

3. **No kernel precomputation**: In theory, the kernel weights could be precomputed into a 1D texture. In practice, the `bumpKernel()` function is cheap (a few multiplies + one exp) and called per-ring, not per-sample-on-ring. The texture read is the bottleneck, not the weight calculation.

### Mobile Performance

The ShaderHero component already caps DPR at 1 on mobile (< 768px). At DPR 1 on mobile:
- Display pass is cheap (single texture read per canvas pixel)
- Sim resolution is fixed at 256x256 regardless of DPR
- At radius 13, 2 steps: ~15.7M reads -- should be 30fps+ on A12/Mali-G76 class GPUs
- If users report mobile lag, reducing default speed to 1 step would halve the cost

## Gotchas

1. **BRAND_PREFIX_KEYS registration is CRITICAL** -- every `shader-lenia-*` key must be added to the Set in `css-injection.ts` or the sliders will silently have no effect (values get `--color-` prefix instead of `--brand-` prefix, and `readBrandVar` looks for `--brand-`).

2. **EXT_color_buffer_float** -- required for RGBA16F FBO. Must check in `init()` and return `false` if not available (same as ink/turing/ripple).

3. **256x256 sim resolution, NOT 512x512** -- see performance section above. The kernel convolution makes this the most expensive per-fragment operation of any preset.

4. **Init shader must seed smooth Gaussian blobs** -- unlike SmoothLife (which can use hash-based coarse patches), Lenia's bump kernel is sensitive to initial shape. Hash noise produces chaotic transients. Smooth circular blobs converge cleanly to stable creatures.

5. **Warm-up is essential (50 steps)** -- the initial Gaussian blobs need to be reshaped by the kernel convolution and growth function into recognizable Lenia creatures. Without warm-up, the first visible frames show amorphous blobs before creature structure emerges. 50 steps (vs 40 for SmoothLife) accounts for the bump kernel's slower convergence.

6. **Growth target must match kernel normalization** -- the convolution result is normalized by kernel weight sum (not raw sum). The growth function's centre (`uGrowth`, default 0.14) is calibrated for this normalized value. If the kernel computation changes (e.g., different spacing), the growth centre must be recalibrated or creatures won't form.

7. **`width` parameter sensitivity** -- the growth function width (`uWidth`, default 0.015) is the most sensitive parameter. Too narrow (< 0.008) and the system is so selective that no creature can sustain itself. Too wide (> 0.06) and everything either floods to 1.0 or decays to 0.0. The slider range (0.01-0.05) is designed to stay within the viable band.

8. **`speed` is an integer** -- must `Math.round()` in both shader-config.ts and the slider display. Fractional steps make no sense.

9. **`dt` interacts with `speed`** -- effective time advancement per frame is `dt * speed`. At max (dt=0.5, speed=4), each frame advances state by up to 2.0, which can cause instability (state oscillating between 0 and 1 each frame). The slider labels warn about this ("Rapid" for high dt).

10. **Ambient deposits are less critical than SmoothLife** -- Lenia creatures are more self-sustaining (the bump kernel produces stable soliton-like organisms that persist indefinitely). Ambient deposits every 4-7s (longer interval than SmoothLife's 3-5s) inject diversity rather than preventing extinction. They create fresh seeds that may develop into new creature morphologies.

11. **Edge damping is wider (8 texels)** -- the kernel can sample up to 20 texels from each fragment (at max radius). With 8-texel edge damping, fragments near the boundary have incomplete kernel coverage, which naturally causes edge decay. The 8-texel fade ensures this is gradual rather than abrupt.

12. **Bump kernel `alpha` parameter is hardcoded at 4.0** -- this controls the peakiness of the kernel shape. Lower alpha (2-3) produces wider, flatter kernels. Higher alpha (5-8) produces sharper peaks. 4.0 is the standard Lenia value that produces the classic concentric-ring creature morphology. Could be exposed as a parameter in a future iteration, but keeping it fixed simplifies the initial implementation.

13. **Performance budget at max radius**: At radius 20, samples jump to ~190/fragment. With 4 steps at 256x256: ~49.8M reads, approaching the budget ceiling. The brand editor UI should make it clear that larger radius = heavier. Consider adding a warning tooltip at radius > 16 in a future iteration.

14. **GLSL loop bounds**: The sim shader uses `uRadius * uTexel.x` (a uniform expression) as the loop bound. GLSL ES 3.0 / WebGL2 supports this, but some mobile GPU drivers may unroll conservatively. The max outer loop iterations at radius 20 with spacing 1.4 is ~28 rings, well within typical unroll limits (~256 iterations).

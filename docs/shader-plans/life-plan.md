# SmoothLife (Continuous Game of Life) Shader Preset -- Implementation Plan

## Overview

Add a "life" shader preset: a continuous-state cellular automaton where soft blob-like organisms form, move, split, merge, and leave ribbons. Looks like microscopic organisms under a microscope -- amoeba-like pulsing shapes with smooth, rounded edges. Everything is continuous (float state [0,1] per pixel), not binary, producing naturally beautiful organic gradients.

Uses a 2-pass FBO ping-pong at **256x256** (lower resolution for performance since the convolution kernel is expensive). Each frame computes ring-shaped kernel convolutions (inner disc for "alive" neighbours, outer annulus for "neighbourhood"), then applies a smooth sigmoid transition function to determine the next state.

The mouse deposits "life" material. Click creates a large deposit. Hover continuously paints life at the cursor. The `speed` parameter controls sim steps per frame (1-4).

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify -- add `LifeConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/life-sim.frag.ts` | Create -- simulation shader (SmoothLife kernel convolution + sigmoid transition) |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/shaders/life-display.frag.ts` | Create -- display shader (state value to brand colour gradient) |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/renderers/life-renderer.ts` | Create -- ShaderRenderer impl (FBO ping-pong, multi-substep) |
| 5 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify -- add `'life'` to `loadRenderer` switch |
| 6 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify -- add 5 keys to `BRAND_PREFIX_KEYS` |
| 7 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify -- add preset card + slider state + slider UI |

## Config Interface

```typescript
export interface LifeConfig extends ShaderConfigBase {
  preset: 'life';
  inner: number;    // 3.0-8.0, default 5.0 -- Inner kernel radius (disc for "alive" neighbour count)
  outer: number;    // 8.0-15.0, default 12.0 -- Outer kernel radius (annulus for "neighbourhood")
  birth: number;    // 0.25-0.40, default 0.28 -- Birth threshold (sigmoid center for dead->alive)
  death: number;    // 0.35-0.55, default 0.45 -- Death threshold (sigmoid center for alive->dead)
  speed: number;    // 1-4, default 2 (int) -- Sim steps per frame
}
```

## Defaults

```typescript
// In DEFAULTS object in shader-config.ts:
lifeInner: 5.0,
lifeOuter: 12.0,
lifeBirth: 0.28,
lifeDeath: 0.45,
lifeSpeed: 2,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

All 5 keys must be added to the `BRAND_PREFIX_KEYS` Set in `css-injection.ts`:

```
shader-life-inner
shader-life-outer
shader-life-birth
shader-life-death
shader-life-speed
```

## ShaderPresetId Update

Update the type union in `shader-config.ts`:

```typescript
export type ShaderPresetId = 'suture' | 'ether' | 'warp' | 'ripple' | 'pulse' | 'ink' | 'topo' | 'nebula' | 'turing' | 'silk' | 'glass' | 'film' | 'flux' | 'lava' | 'life' | 'none';
```

## Simulation Shader (life-sim.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `uState` | `sampler2D` | Ping-pong simulation texture. R = cell state (0.0 = dead, 1.0 = alive, continuous) |
| `uTexel` | `vec2` | 1.0 / simResolution (1/256) |
| `uInner` | `float` | Inner disc radius in texels (3-8) |
| `uOuter` | `float` | Outer annulus radius in texels (8-15) |
| `uBirth` | `float` | Birth sigmoid center threshold (0.25-0.40) |
| `uDeath` | `float` | Death sigmoid center threshold (0.35-0.55) |
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
uniform float uInner;    // inner disc radius in texels
uniform float uOuter;    // outer annulus radius in texels
uniform float uBirth;    // birth threshold
uniform float uDeath;    // death threshold
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uMouseStrength;
uniform vec2 uDropPos;

// ---- SmoothLife sigmoid transition function ----
// Smooth step between 0 and 1, centered at `center` with width `width`.
// This replaces the hard binary thresholds of classic Game of Life.
float sigma(float x, float center, float width) {
  return 1.0 / (1.0 + exp(-(x - center) / width));
}

// ---- Transition function: S(n, m) ----
// n = neighbourhood density (outer annulus), m = inner disc density (self-state)
// Returns target state based on SmoothLife rules:
//   - If alive (m high): survive if n is in the survival range
//   - If dead (m low): birth if n is in the birth range
// The smooth sigmoid blends these continuously.
float transition(float n, float m) {
  float sigWidth = 0.028;  // Sigmoid steepness (narrower = sharper threshold)

  // Birth and survival thresholds define viable neighbourhood density ranges
  float birthLow = uBirth;
  float birthHigh = uBirth + 0.07;
  float deathLow = uDeath - 0.07;
  float deathHigh = uDeath;

  // Smooth birth window: high when n is in [birthLow, birthHigh]
  float birthWindow = sigma(n, birthLow, sigWidth) * (1.0 - sigma(n, birthHigh, sigWidth));

  // Smooth survival window: high when n is in [deathLow, deathHigh]
  float surviveWindow = sigma(n, deathLow, sigWidth) * (1.0 - sigma(n, deathHigh, sigWidth));

  // Blend between birth and survival based on current state m
  return mix(birthWindow, surviveWindow, sigma(m, 0.5, sigWidth));
}

void main() {
  float state = texture(uState, v_uv).r;

  // ---- 1. Compute inner disc average (self + immediate neighbours) ----
  // Spiral sampling pattern for performance: ~24 samples inside inner radius
  float innerSum = 0.0;
  float innerCount = 0.0;
  float ri = uInner * uTexel.x;   // inner radius in UV space

  // Sample in concentric rings inside inner disc
  for (float r = 0.0; r <= ri; r += uTexel.x * 1.5) {
    float circumference = max(1.0, 6.2832 * r / (uTexel.x * 1.5));
    float angleStep = 6.2832 / circumference;
    for (float a = 0.0; a < 6.2832; a += angleStep) {
      vec2 offset = vec2(cos(a), sin(a)) * r;
      innerSum += texture(uState, v_uv + offset).r;
      innerCount += 1.0;
    }
  }
  float m = innerSum / max(innerCount, 1.0);  // inner disc density

  // ---- 2. Compute outer annulus average (neighbourhood ring) ----
  // Sample ring between inner and outer radius: ~40 samples
  float outerSum = 0.0;
  float outerCount = 0.0;
  float ro = uOuter * uTexel.x;   // outer radius in UV space

  for (float r = ri + uTexel.x; r <= ro; r += uTexel.x * 1.8) {
    float circumference = max(1.0, 6.2832 * r / (uTexel.x * 1.8));
    float angleStep = 6.2832 / circumference;
    for (float a = 0.0; a < 6.2832; a += angleStep) {
      vec2 offset = vec2(cos(a), sin(a)) * r;
      outerSum += texture(uState, v_uv + offset).r;
      outerCount += 1.0;
    }
  }
  float n = outerSum / max(outerCount, 1.0);  // outer annulus density

  // ---- 3. Apply SmoothLife transition ----
  float target = transition(n, m);

  // Smooth integration toward target state (not instant snap)
  // dt controls how fast the state tracks the target (0.1 = smooth, 1.0 = instant)
  float dt = 0.12;
  float newState = state + dt * (target - state);

  // ---- 4. Mouse life deposit ----
  if (uMouseActive > 0.5) {
    vec2 d = v_uv - uMouse;
    float r = 0.04;
    float deposit = uMouseStrength * 0.6 * exp(-dot(d, d) / (r * r));
    newState += deposit;
  }

  // ---- 5. Ambient deposit (keep the simulation alive) ----
  if (uDropPos.x > -5.0) {
    vec2 d = v_uv - uDropPos;
    float r = 0.05;
    newState += 0.5 * exp(-dot(d, d) / (r * r));
  }

  // ---- 6. Clamp + edge damping ----
  newState = clamp(newState, 0.0, 1.0);

  // Edge damping: smoothstep fade near boundaries (prevents wall accumulation)
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 6.0), v_uv)
            * smoothstep(vec2(0.0), vec2(uTexel * 6.0), 1.0 - v_uv);
  newState *= edge.x * edge.y;

  fragColor = vec4(newState, 0.0, 0.0, 1.0);
}
```

### Key Design Decisions

1. **256x256 sim resolution**: The SmoothLife kernel is expensive because it samples ~60+ texels per pixel (inner disc + outer annulus). At 512x512 this would be too heavy. 256x256 keeps the fragment count manageable while still producing smooth, detailed organic forms thanks to the large kernel radii.

2. **Spiral sampling pattern**: Rather than exhaustively sampling every pixel in the disc/annulus (which would be O(r^2) per fragment), we sample in concentric rings with angular spacing proportional to circumference. This gives approximately uniform coverage with ~24 inner + ~40 outer samples -- about 64 texture samples per fragment.

3. **Continuous state**: Unlike classic GoL (binary 0/1), every pixel holds a float in [0,1]. The transition function uses smooth sigmoids instead of hard thresholds. This produces the characteristic smooth, rounded blob shapes of SmoothLife rather than blocky pixels.

4. **Smooth integration (dt=0.12)**: The state doesn't snap to the target instantly. Instead, `newState = state + dt * (target - state)` smoothly tracks the transition function output. This creates the organic pulsing, flowing quality.

5. **Transition function**: The SmoothLife transition function `S(n, m)` uses two sigmoid windows (birth and survival) blended by the current state `m`. When `m` is low (dead), birth window determines whether the cell comes alive. When `m` is high (alive), survival window determines whether it stays alive. The sigmoid blending makes the transition continuous.

6. **Kernel radii as parameters**: Inner (3-8) and outer (8-15) radii are configurable. Larger radii produce larger, slower-moving organisms. Smaller radii produce faster, smaller creatures. The ratio between inner and outer affects organism shape (close ratio = thick blobs, wide ratio = thin filaments).

7. **Edge damping extends to 6 texels** (vs 4 for ink/turing) because the larger kernel radii mean boundary effects extend further.

## Display Shader (life-display.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `uState` | `sampler2D` | Sim texture (R = cell state 0-1) |
| `uColorPrimary` | `vec3` | Brand primary (low-density fading organisms) |
| `uColorSecondary` | `vec3` | Brand secondary (mid-density blobs) |
| `uColorAccent` | `vec3` | Brand accent (high-density cores) |
| `uBgColor` | `vec3` | Background colour (dead cells) |
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
  // 0.0 = dead (bg), 0.0-0.3 = fading primary, 0.3-0.7 = secondary, 0.7-1.0 = accent
  vec3 color;
  float t = clamp(state * uIntensity, 0.0, 1.0);

  if (t < 0.3) {
    color = mix(uBgColor, uColorPrimary, t / 0.3);
  } else if (t < 0.7) {
    color = mix(uColorPrimary, uColorSecondary, (t - 0.3) / 0.4);
  } else {
    color = mix(uColorSecondary, uColorAccent, (t - 0.7) / 0.3);
  }

  // ---- 3. Organism edge glow (screen-space derivatives) ----
  // Edges of organisms get a subtle accent highlight
  float dSdx = dFdx(state);
  float dSdy = dFdy(state);
  float edgeStrength = smoothstep(0.002, 0.04, abs(dSdx) + abs(dSdy));
  color += edgeStrength * 0.05 * uColorAccent * uIntensity;

  // ---- 4. Internal pulsing (alive organisms subtly breathe) ----
  float pulse = 0.5 + 0.5 * sin(uTime * 1.5 + state * 8.0);
  float coreGlow = smoothstep(0.6, 1.0, state) * pulse * 0.06;
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

| State Value | Colour | Visual Role |
|-------------|--------|-------------|
| 0.0 (dead) | `bg` | Background / empty space |
| 0.0-0.3 | `bg` -> `primary` | Fading organisms, thin trails, ribbons left behind |
| 0.3-0.7 | `primary` -> `secondary` | Active organism bodies, blob interiors |
| 0.7-1.0 | `secondary` -> `accent` | Dense organism cores, splitting/merging hotspots |

## Renderer (life-renderer.ts)

Follows the turing-renderer pattern (FBO ping-pong with configurable steps per frame).

### Structure

```typescript
import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { LifeConfig, ShaderConfig } from '../shader-config';
import { LIFE_DISPLAY_FRAG } from '../shaders/life-display.frag';
import { LIFE_SIM_FRAG } from '../shaders/life-sim.frag';
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

The init shader must seed meaningful initial state -- random blobs of life to bootstrap the simulation:

```glsl
const LIFE_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // Seed with smooth random blobs using layered noise
  // Use coarse grid hash to create blob-sized patches
  vec2 cell = floor(v_uv * 16.0);
  float h = hash21(cell);

  // ~20% of coarse cells get initial life, with Gaussian falloff within each cell
  float alive = step(0.80, h);

  // Add finer detail -- smaller scattered seeds
  float h2 = hash21(v_uv * 64.0);
  alive = max(alive, step(0.92, h2) * 0.7);

  // Smooth the initial state slightly using distance from cell center
  vec2 cellUV = fract(v_uv * 16.0);
  float dist = length(cellUV - 0.5);
  alive *= smoothstep(0.5, 0.2, dist);

  fragColor = vec4(alive, 0.0, 0.0, 1.0);
}
`;
```

### Sim Uniform Names

```typescript
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uInner',
  'uOuter',
  'uBirth',
  'uDeath',
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

- **`speed` steps per frame** (1-4, default 2): configurable via the `shader-life-speed` slider. More steps per frame = faster evolution. At 256x256 with ~64 texture samples per fragment, 2 steps per frame should run at 60fps on most GPUs.
- **Ambient deposits every 3-5s** at random positions to keep the simulation alive. Without them, the system can settle into a static equilibrium or die out entirely.
- **Click bursts**: deposit a large blob of life material (state = 1.0) at the click position over 5 frames with decaying strength.
- **Mouse hover**: continuous life deposit at the cursor with lerped position (uses the ShaderHero built-in mouse lerp).

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
  cfg: LifeConfig
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
  gl.uniform1f(simU.uInner, cfg.inner);
  gl.uniform1f(simU.uOuter, cfg.outer);
  gl.uniform1f(simU.uBirth, cfg.birth);
  gl.uniform1f(simU.uDeath, cfg.death);
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
  nextAmbientInterval = 3.0 + Math.random() * 2.0;
  clickBursts = [];

  gl.viewport(0, 0, SIM_RES, SIM_RES);
  gl.useProgram(initProg);
  quad.bind(initProg);

  // Seed both FBO sides with initial life blobs
  gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
  drawQuad(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
  drawQuad(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Warm-up: run 40 coast steps to let organisms form
  if (!simProg || !simU) return;

  for (let w = 0; w < 40; w++) {
    gl.viewport(0, 0, SIM_RES, SIM_RES);
    gl.useProgram(simProg);
    quad.bind(simProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
    gl.uniform1i(simU.uState, 0);

    const tx = 1.0 / SIM_RES;
    gl.uniform2f(simU.uTexel, tx, tx);
    gl.uniform1f(simU.uInner, 5.0);
    gl.uniform1f(simU.uOuter, 12.0);
    gl.uniform1f(simU.uBirth, 0.28);
    gl.uniform1f(simU.uDeath, 0.45);
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

**CRITICAL**: The init shader must seed blob-shaped initial state so organisms begin forming immediately. An empty field (all zeros) will remain dead because SmoothLife needs existing alive cells in the neighbourhood to trigger births. The warm-up runs 40 coast steps to let initial seeds coalesce into recognizable organism shapes before the first visible frame.

## Brand Editor Sliders

### DEFAULTS entries in BrandEditorHeroEffects.svelte

```typescript
'shader-life-inner': '5.0',
'shader-life-outer': '12.0',
'shader-life-birth': '0.28',
'shader-life-death': '0.45',
'shader-life-speed': '2',
```

### Derived state variables

```typescript
const lifeInner = $derived(readNum('shader-life-inner'));
const lifeOuter = $derived(readNum('shader-life-outer'));
const lifeBirth = $derived(readNum('shader-life-birth'));
const lifeDeath = $derived(readNum('shader-life-death'));
const lifeSpeed = $derived(readNum('shader-life-speed'));
```

### PRESETS entry

```typescript
{ id: 'life', label: 'SmoothLife', description: 'Microscopic blob organisms' },
```

### Slider UI

| id | label | min | max | step | default | minLabel | maxLabel | format |
|----|-------|-----|-----|------|---------|----------|----------|--------|
| `shader-life-inner` | Organism Size | 3.0 | 8.0 | 0.5 | 5.0 | Small | Large | `.toFixed(1)` |
| `shader-life-outer` | Neighbourhood | 8.0 | 15.0 | 0.5 | 12.0 | Tight | Wide | `.toFixed(1)` |
| `shader-life-birth` | Birth Threshold | 0.25 | 0.40 | 0.01 | 0.28 | Easy | Hard | `.toFixed(2)` |
| `shader-life-death` | Death Threshold | 0.35 | 0.55 | 0.01 | 0.45 | Fragile | Tough | `.toFixed(2)` |
| `shader-life-speed` | Sim Speed | 1 | 4 | 1 | 2 | Slow | Fast | `Math.round()` |

### Template block (insert after lava section)

```svelte
{:else if activePreset === 'life'}
  <section class="hero-fx__section">
    <span class="hero-fx__section-label">SmoothLife</span>
    <BrandSliderField id="shader-life-inner" label="Organism Size" value={lifeInner.toFixed(1)} min={3.0} max={8.0} step={0.5} current={lifeInner} minLabel="Small" maxLabel="Large" oninput={handleSliderInput('shader-life-inner')} />
    <BrandSliderField id="shader-life-outer" label="Neighbourhood" value={lifeOuter.toFixed(1)} min={8.0} max={15.0} step={0.5} current={lifeOuter} minLabel="Tight" maxLabel="Wide" oninput={handleSliderInput('shader-life-outer')} />
    <BrandSliderField id="shader-life-birth" label="Birth Threshold" value={lifeBirth.toFixed(2)} min={0.25} max={0.40} step={0.01} current={lifeBirth} minLabel="Easy" maxLabel="Hard" oninput={handleSliderInput('shader-life-birth')} />
    <BrandSliderField id="shader-life-death" label="Death Threshold" value={lifeDeath.toFixed(2)} min={0.35} max={0.55} step={0.01} current={lifeDeath} minLabel="Fragile" maxLabel="Tough" oninput={handleSliderInput('shader-life-death')} />
    <BrandSliderField id="shader-life-speed" label="Sim Speed" value={String(Math.round(lifeSpeed))} min={1} max={4} step={1} current={lifeSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-life-speed')} />
  </section>
```

## shader-config.ts Switch Case

```typescript
case 'life':
  return {
    ...base,
    preset: 'life',
    inner: rv('shader-life-inner', DEFAULTS.lifeInner),
    outer: rv('shader-life-outer', DEFAULTS.lifeOuter),
    birth: rv('shader-life-birth', DEFAULTS.lifeBirth),
    death: rv('shader-life-death', DEFAULTS.lifeDeath),
    speed: Math.round(rv('shader-life-speed', DEFAULTS.lifeSpeed)),
  };
```

## ShaderHero.svelte loadRenderer Case

```typescript
case 'life': {
  const { createLifeRenderer } = await import('./renderers/life-renderer');
  return createLifeRenderer();
}
```

## Gotchas

1. **BRAND_PREFIX_KEYS registration is CRITICAL** -- every `shader-life-*` key must be added to the Set in `css-injection.ts` or the sliders will silently have no effect (values get `--color-` prefix instead of `--brand-` prefix, and `readBrandVar` looks for `--brand-`).

2. **EXT_color_buffer_float** -- required for RGBA16F FBO. Must check in `init()` and return `false` if not available (same as ink/turing/ripple).

3. **256x256 sim resolution, NOT 512x512** -- the SmoothLife kernel requires ~64 texture samples per fragment (inner disc ~24 + outer annulus ~40). At 512x512 this would be 512*512*64 = ~16.7M texture reads per step, per frame. At 256x256 it's ~4.2M, which is manageable. Two steps per frame = ~8.4M reads. Display pass upscales from 256 to full canvas via LINEAR texture filtering.

4. **Init shader must seed blobs** -- unlike turing (which starts homogeneous and seeds points of B), SmoothLife needs existing blob-shaped regions of state=1.0 for the kernel convolution to produce meaningful neighbourhood densities. Scattered point seeds won't work because a single texel at 1.0 surrounded by zeros gives near-zero disc/annulus averages. Blob-shaped patches of ~16x16 texels work well.

5. **Warm-up is essential** -- the initial hash-seeded blobs need ~40 sim steps to smooth into recognizable SmoothLife organisms. Without warm-up, the first visible frames show hash-noise artifacts before coalescing.

6. **Birth must be less than death** -- `uBirth` (default 0.28) must be meaningfully lower than `uDeath` (default 0.45) for stable organisms to exist. If birth >= death, the simulation either floods to all-alive or collapses to all-dead. The slider ranges are designed to prevent this (birth max 0.40 < death min 0.35 allows overlap only at the extreme, which creates interesting edge-of-chaos behaviour).

7. **Inner radius must be less than outer radius** -- enforced by the slider ranges (inner max 8.0 < outer min 8.0). At the boundary case (inner=8, outer=8), the annulus has zero area, which kills the simulation. In practice, a gap of at least 3-4 texels is needed for good behaviour.

8. **Spiral sampling loop count** -- GLSL ES 3.0 allows runtime loop bounds with certain constraints. The `for` loops in the sim shader use `uInner` and `uOuter` (uniforms) as bounds, which is supported in WebGL2/GLSL ES 3.0. However, the driver may unroll conservatively. Keep max outer radius at 15 to avoid hitting unroll limits on mobile GPUs.

9. **Edge damping is wider (6 texels)** -- because the kernel samples up to 15 texels away from each fragment, boundary artifacts extend further than in ink/turing (which use 4 texels). 6 texels provides enough fade zone without eating too much of the visible area.

10. **Ambient deposits are CRITICAL for longevity** -- SmoothLife simulations can settle into static equilibria or die out entirely once the initial organisms stabilize. Regular ambient deposits (every 3-5s) inject fresh life material that disrupts equilibria and triggers new growth, keeping the visual interesting indefinitely.

11. **Performance budget**: At 256x256, 2 steps/frame, ~64 samples/fragment: 256*256*64*2 = ~8.4M texture reads per frame. This is comparable to turing at 512x512 with its 9-tap Laplacian at 4 steps (512*512*9*4 = ~9.4M). The display pass is cheap (single texture read per fragment at full canvas resolution). Target: 60fps on integrated GPUs, verified via Chrome DevTools performance panel.

12. **`speed` is an integer** -- must `Math.round()` in both shader-config.ts and the slider display. Fractional steps make no sense (you can't run half a sim step).

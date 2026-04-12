# Physarum (Slime Mould Network) Shader Preset -- Implementation Plan

## Overview

Add a "physarum" shader preset: invisible agents leave glowing pheromone trails that self-organise into pulsing, branching mycelial networks. Uses a 2-pass FBO (ping-pong, 512x512) where the buffer stores trail density. Agents are simulated implicitly via the trail field itself -- high-concentration areas attract more deposits, creating self-reinforcing paths that produce the characteristic Physarum polycephalum network patterns.

The mouse acts as a pheromone attractor, depositing high-concentration trail at the cursor. Ambient deposits arrive every few seconds to keep the network alive and evolving.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify -- add `PhysarumConfig`, union entry, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/physarum-sim.frag.ts` | Create -- simulation shader (trail diffusion + agent sensing + deposit) |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/shaders/physarum-display.frag.ts` | Create -- display shader (trail intensity to brand colour gradient) |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/renderers/physarum-renderer.ts` | Create -- ShaderRenderer impl (FBO ping-pong, 2 substeps) |
| 5 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify -- add `'physarum'` to `ShaderPresetId` union and `loadRenderer` switch |
| 6 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify -- add 5 keys to `BRAND_PREFIX_KEYS` |
| 7 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify -- add preset card + slider state + slider UI |

## Config Interface

```typescript
export interface PhysarumConfig extends ShaderConfigBase {
  preset: 'physarum';
  diffusion: number;   // 0.5-2.0, default 1.0 -- Trail spread rate (3x3 blur kernel strength)
  decay: number;       // 0.95-0.999, default 0.98 -- Trail persistence per frame
  deposit: number;     // 0.5-2.0, default 1.0 -- Trail deposit strength
  sensor: number;      // 0.01-0.05, default 0.03 -- Agent sensor distance (normalised)
  turn: number;        // 0.1-0.5, default 0.25 -- Agent turn speed (radians per step)
}
```

## Defaults

```typescript
// In DEFAULTS object in shader-config.ts:
physarumDiffusion: 1.0,
physarumDecay: 0.98,
physarumDeposit: 1.0,
physarumSensor: 0.03,
physarumTurn: 0.25,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

All 5 keys must be added to the `BRAND_PREFIX_KEYS` Set in `css-injection.ts`:

```
shader-physarum-diffusion
shader-physarum-decay
shader-physarum-deposit
shader-physarum-sensor
shader-physarum-turn
```

## ShaderPresetId Update

Update the type union in `shader-config.ts`:

```typescript
export type ShaderPresetId = 'suture' | 'ether' | 'warp' | 'ripple' | 'pulse' | 'ink' | 'topo' | 'nebula' | 'turing' | 'silk' | 'glass' | 'film' | 'flux' | 'lava' | 'physarum' | 'none';
```

## Simulation Shader (physarum-sim.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `uState` | `sampler2D` | Ping-pong sim texture. R = trail density, G = agent heading (encoded 0-1 = 0-2pi) |
| `uTexel` | `vec2` | 1.0 / simResolution |
| `uDiffusion` | `float` | Trail spread rate (controls 3x3 blur kernel weight) |
| `uDecay` | `float` | Per-frame trail decay multiplier |
| `uDeposit` | `float` | Trail deposit strength |
| `uSensor` | `float` | Agent sensor distance in UV space |
| `uTurn` | `float` | Agent turn speed in radians |
| `uTime` | `float` | Elapsed time in seconds |
| `uMouse` | `vec2` | Mouse position (0-1) |
| `uMouseActive` | `float` | 1.0 if mouse is over canvas |
| `uMouseStrength` | `float` | Mouse deposit impulse strength |
| `uDropPos` | `vec2` | Ambient deposit position (-10 if none) |

### Buffer Format

```
R channel: trail density (0.0 = empty, 1.0+ = saturated trail)
G channel: agent heading angle (encoded: value * 2*PI = angle in radians)
B channel: reserved (0.0)
A channel: 1.0
```

### Algorithm (GLSL Pseudocode)

```glsl
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uDiffusion, uDecay, uDeposit, uSensor, uTurn;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive, uMouseStrength;
uniform vec2 uDropPos;

// ---- Hash-based pseudo-random ----
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 state = texture(uState, v_uv);
  float trail = state.r;
  float heading = state.g * 6.28318; // decode heading from 0-1 to 0-2pi

  // ---- 1. Trail diffusion: 3x3 mean filter (weighted) ----
  float sum = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 offset = vec2(float(dx), float(dy)) * uTexel;
      sum += texture(uState, v_uv + offset).r;
    }
  }
  float blurred = sum / 9.0;
  float diffused = mix(trail, blurred, uDiffusion * 0.5);

  // ---- 2. Trail decay ----
  diffused *= uDecay;

  // ---- 3. Agent sensing (implicit -- each texel acts as potential agent) ----
  // Use hash to determine if this texel hosts an agent (~25% density)
  float agentProb = hash21(v_uv * 512.0 + floor(uTime * 0.5));
  bool isAgent = agentProb < 0.25;

  if (isAgent) {
    // Use a time-varying hash to vary heading per texel
    float h = hash21(v_uv * 256.0 + uTime * 0.1);
    heading = mix(heading, h * 6.28318, 0.02); // gentle random drift

    // Sense trail at 3 forward positions
    vec2 dir = vec2(cos(heading), sin(heading));
    vec2 dirLeft = vec2(cos(heading + uTurn), sin(heading + uTurn));
    vec2 dirRight = vec2(cos(heading - uTurn), sin(heading - uTurn));

    float senseF = texture(uState, v_uv + dir * uSensor).r;
    float senseL = texture(uState, v_uv + dirLeft * uSensor).r;
    float senseR = texture(uState, v_uv + dirRight * uSensor).r;

    // Turn toward highest trail concentration
    if (senseL > senseF && senseL > senseR) {
      heading += uTurn * 0.5;
    } else if (senseR > senseF && senseR > senseL) {
      heading -= uTurn * 0.5;
    }
    // If senseF is highest, keep going straight (no change)

    // Deposit trail at this texel
    diffused += uDeposit * 0.15;
  }

  // ---- 4. Mouse pheromone attractor ----
  if (uMouseActive > 0.5) {
    vec2 d = v_uv - uMouse;
    float r = 0.06; // mouse influence radius
    float mouseDeposit = uMouseStrength * 0.5 * exp(-dot(d, d) / (r * r));
    diffused += mouseDeposit;
  }

  // ---- 5. Ambient deposit (random food source) ----
  if (uDropPos.x > -5.0) {
    vec2 d = v_uv - uDropPos;
    float r = 0.04;
    diffused += 0.4 * exp(-dot(d, d) / (r * r));
  }

  // ---- 6. Clamp + edge damping ----
  diffused = clamp(diffused, 0.0, 3.0);
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 4.0), v_uv)
            * smoothstep(vec2(0.0), vec2(uTexel * 4.0), 1.0 - v_uv);
  diffused *= edge.x * edge.y;

  // Encode heading back to 0-1 range
  float encodedHeading = fract(heading / 6.28318);

  fragColor = vec4(diffused, encodedHeading, 0.0, 1.0);
}
```

### Key Design Decisions

1. **Implicit agent simulation**: Rather than tracking individual particles (which would require a separate agent texture or compute shader), each texel has a probability of acting as an agent based on a hash function. This creates a population of "virtual agents" that sense and deposit without particle tracking overhead.

2. **Heading stored in G channel**: Agent headings persist across frames via the G channel, encoded as `heading / (2*PI)` to fit in the 0-1 range. This allows agents to maintain direction continuity.

3. **Agent density controlled by hash threshold**: The `agentProb < 0.25` threshold means roughly 25% of texels act as agents each frame. This is dense enough to form networks but sparse enough for GPU performance.

4. **Self-reinforcing paths**: Agents deposit trail and sense trail. Where multiple agents walk, trail builds up, attracting more agents -- producing the characteristic branching network topology.

## Display Shader (physarum-display.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `uState` | `sampler2D` | Sim texture (R = trail density) |
| `uColorPrimary` | `vec3` | Brand primary (low density veins) |
| `uColorSecondary` | `vec3` | Brand secondary (medium density) |
| `uColorAccent` | `vec3` | Brand accent (high density nodes/junctions) |
| `uBgColor` | `vec3` | Background colour (zero density) |
| `uIntensity` | `float` | Brightness multiplier |
| `uGrain` | `float` | Film grain strength |
| `uVignette` | `float` | Vignette strength |
| `uTime` | `float` | For grain animation |

### Algorithm (GLSL Pseudocode)

```glsl
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // ---- 1. Read trail density ----
  float trail = texture(uState, v_uv).r;

  // ---- 2. Multi-stop colour ramp: bg -> primary -> secondary -> accent ----
  // Low density: bg -> primary (veins)
  // Medium density: primary -> secondary (thicker paths)
  // High density: secondary -> accent (nodes, junctions, glow)
  vec3 color;
  float t = clamp(trail * uIntensity, 0.0, 1.0);

  if (t < 0.33) {
    color = mix(uBgColor, uColorPrimary, t / 0.33);
  } else if (t < 0.66) {
    color = mix(uColorPrimary, uColorSecondary, (t - 0.33) / 0.33);
  } else {
    color = mix(uColorSecondary, uColorAccent, (t - 0.66) / 0.34);
  }

  // ---- 3. Network edge glow (screen-space derivatives) ----
  float dTdx = dFdx(trail);
  float dTdy = dFdy(trail);
  float edgeStrength = smoothstep(0.001, 0.02, abs(dTdx) + abs(dTdy));
  color += edgeStrength * 0.06 * uColorAccent * uIntensity;

  // ---- 4. Pulsing glow on dense nodes ----
  float pulse = 0.5 + 0.5 * sin(uTime * 2.0 + trail * 10.0);
  float nodeGlow = smoothstep(0.5, 1.0, trail) * pulse * 0.08;
  color += nodeGlow * uColorAccent;

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

| Trail Density | Colour | Visual Role |
|---------------|--------|-------------|
| 0.0 (empty) | `bg` | Background |
| 0.0-0.33 | `bg` -> `primary` | Faint trail wisps, thin veins |
| 0.33-0.66 | `primary` -> `secondary` | Established network paths |
| 0.66-1.0 | `secondary` -> `accent` | Dense junction nodes, glowing hubs |

## Renderer (physarum-renderer.ts)

Follows the ink-renderer pattern exactly:

### Structure

```typescript
import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { PhysarumConfig, ShaderConfig } from '../shader-config';
import { PHYSARUM_DISPLAY_FRAG } from '../shaders/physarum-display.frag';
import { PHYSARUM_SIM_FRAG } from '../shaders/physarum-sim.frag';
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

const SIM_RES = 512;
```

### Init Shader

The init shader must seed meaningful initial state -- NOT all zeros (which would produce a dead simulation). Seed random trail patches and agent headings:

```glsl
const PHYSARUM_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // Seed trail with scattered food sources to kick-start network formation
  float h = hash21(v_uv * 64.0);
  float trail = step(0.85, h) * 0.5; // ~15% of texels get initial trail deposit

  // Random heading for each texel-agent
  float heading = hash21(v_uv * 128.0 + 42.0);

  fragColor = vec4(trail, heading, 0.0, 1.0);
}
`;
```

### Sim Uniform Names

```typescript
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uDiffusion',
  'uDecay',
  'uDeposit',
  'uSensor',
  'uTurn',
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

- **Two substeps per frame** (same as ink): first with mouse + ambient input, second coasting (no input). This produces smoother evolution.
- **Ambient drops** every 2-4s at random positions to simulate food sources that attract the network.
- **Click bursts**: deposit a large concentrated trail blob that the network will quickly colonise.
- **Mouse hover**: continuous high-concentration deposit that agents flow toward.

### reset() Implementation

```typescript
reset(gl: WebGL2RenderingContext): void {
  if (!initProg || !simBuf || !quad) return;

  lastAmbientTime = 0;
  nextAmbientInterval = 2.0 + Math.random() * 2.0;

  gl.viewport(0, 0, SIM_RES, SIM_RES);
  gl.useProgram(initProg);
  quad.bind(initProg);

  // Seed both FBO sides with initial trail + headings
  gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
  drawQuad(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
  drawQuad(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
```

**CRITICAL**: The init shader must set non-zero trail values so patterns begin forming immediately. Unlike ink (which starts empty and waits for user interaction), Physarum needs initial "food sources" to bootstrap the self-organising network.

## Brand Editor Sliders

### DEFAULTS entries in BrandEditorHeroEffects.svelte

```typescript
'shader-physarum-diffusion': '1.00',
'shader-physarum-decay': '0.980',
'shader-physarum-deposit': '1.00',
'shader-physarum-sensor': '0.030',
'shader-physarum-turn': '0.25',
```

### Derived state variables

```typescript
const physarumDiffusion = $derived(readNum('shader-physarum-diffusion'));
const physarumDecay = $derived(readNum('shader-physarum-decay'));
const physarumDeposit = $derived(readNum('shader-physarum-deposit'));
const physarumSensor = $derived(readNum('shader-physarum-sensor'));
const physarumTurn = $derived(readNum('shader-physarum-turn'));
```

### PRESETS entry

```typescript
{ id: 'physarum', label: 'Physarum', description: 'Slime mould pheromone networks' },
```

### Slider UI

| id | label | min | max | step | default | minLabel | maxLabel | format |
|----|-------|-----|-----|------|---------|----------|----------|--------|
| `shader-physarum-diffusion` | Trail Spread | 0.50 | 2.00 | 0.05 | 1.00 | Tight | Wide | `.toFixed(2)` |
| `shader-physarum-decay` | Trail Persistence | 0.950 | 0.999 | 0.001 | 0.980 | Fleeting | Lasting | `.toFixed(3)` |
| `shader-physarum-deposit` | Deposit Strength | 0.50 | 2.00 | 0.05 | 1.00 | Faint | Strong | `.toFixed(2)` |
| `shader-physarum-sensor` | Sensor Distance | 0.010 | 0.050 | 0.005 | 0.030 | Near | Far | `.toFixed(3)` |
| `shader-physarum-turn` | Turn Speed | 0.10 | 0.50 | 0.05 | 0.25 | Gradual | Sharp | `.toFixed(2)` |

### Template block (insert after lava section)

```svelte
{:else if activePreset === 'physarum'}
  <section class="hero-fx__section">
    <span class="hero-fx__section-label">Physarum Network</span>
    <BrandSliderField id="shader-physarum-diffusion" label="Trail Spread" value={physarumDiffusion.toFixed(2)} min={0.50} max={2.00} step={0.05} current={physarumDiffusion} minLabel="Tight" maxLabel="Wide" oninput={handleSliderInput('shader-physarum-diffusion')} />
    <BrandSliderField id="shader-physarum-decay" label="Trail Persistence" value={physarumDecay.toFixed(3)} min={0.950} max={0.999} step={0.001} current={physarumDecay} minLabel="Fleeting" maxLabel="Lasting" oninput={handleSliderInput('shader-physarum-decay')} />
    <BrandSliderField id="shader-physarum-deposit" label="Deposit Strength" value={physarumDeposit.toFixed(2)} min={0.50} max={2.00} step={0.05} current={physarumDeposit} minLabel="Faint" maxLabel="Strong" oninput={handleSliderInput('shader-physarum-deposit')} />
    <BrandSliderField id="shader-physarum-sensor" label="Sensor Distance" value={physarumSensor.toFixed(3)} min={0.010} max={0.050} step={0.005} current={physarumSensor} minLabel="Near" maxLabel="Far" oninput={handleSliderInput('shader-physarum-sensor')} />
    <BrandSliderField id="shader-physarum-turn" label="Turn Speed" value={physarumTurn.toFixed(2)} min={0.10} max={0.50} step={0.05} current={physarumTurn} minLabel="Gradual" maxLabel="Sharp" oninput={handleSliderInput('shader-physarum-turn')} />
  </section>
```

## shader-config.ts Switch Case

```typescript
case 'physarum':
  return {
    ...base,
    preset: 'physarum',
    diffusion: rv('shader-physarum-diffusion', DEFAULTS.physarumDiffusion),
    decay: rv('shader-physarum-decay', DEFAULTS.physarumDecay),
    deposit: rv('shader-physarum-deposit', DEFAULTS.physarumDeposit),
    sensor: rv('shader-physarum-sensor', DEFAULTS.physarumSensor),
    turn: rv('shader-physarum-turn', DEFAULTS.physarumTurn),
  };
```

## ShaderHero.svelte loadRenderer Case

```typescript
case 'physarum': {
  const { createPhysarumRenderer } = await import('./renderers/physarum-renderer');
  return createPhysarumRenderer();
}
```

## Gotchas

1. **BRAND_PREFIX_KEYS registration is CRITICAL** -- every `shader-physarum-*` key must be added to the Set in `css-injection.ts` or the sliders will silently have no effect (values get `--color-` prefix instead of `--brand-` prefix, and `readBrandVar` looks for `--brand-`).

2. **EXT_color_buffer_float** -- required for RGBA16F FBO. Must check in `init()` and return `false` if not available (same as ink/turing/ripple).

3. **Init shader must seed trail** -- unlike ink (starts empty) or turing (starts with A=1, B=0 homogeneous), Physarum needs scattered initial trail deposits. An empty field produces no patterns because agents need existing trail to sense and follow. Seed ~15% of texels with trail values.

4. **Two substeps per frame** -- same pattern as ink-renderer. First step includes mouse + ambient input, second step coasts. This doubles simulation speed and produces smoother network evolution.

5. **Agent heading persistence** -- the G channel stores heading across frames. The hash-based agent selection means different texels may be "active" on different frames, but the heading field provides continuity. This is an approximation that produces visually convincing results.

6. **Decay sensitivity** -- 0.95 = very fast fade (trails vanish in ~20 frames), 0.999 = extremely persistent (trails linger for ~1000 frames). Default 0.98 gives a good balance where established paths glow steadily while abandoned paths fade in ~2-3 seconds.

7. **Edge damping** -- same `smoothstep` boundary pattern as ink. Prevents trail accumulation at FBO edges.

8. **Mouse radius** -- slightly larger than ink drops (0.06 vs 0.05 for ink) because Physarum benefits from wider influence zones that agents can sense from further away.

9. **Ambient deposits serve as "food sources"** -- without them, the network can collapse once all trail decays. Regular ambient deposits (every 2-4s) act as new food sources that the network extends toward, producing the characteristic exploratory growth seen in real slime moulds.

10. **Performance** -- the 3x3 blur kernel (9 texture samples) + 3 sensor samples (3 texture samples) = 12 texture samples per fragment. At 512x512 this is comfortable. Do NOT increase sim resolution without profiling.

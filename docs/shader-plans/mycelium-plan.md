# Mycelium (Fungal Network Growth) Shader Preset — Implementation Plan

## Overview

Add a "mycelium" shader preset: thin branching lines growing slowly outward from seed points, forking and spreading like root systems or fungal mycelium. A web-like network with organic spacing, where nodes form where branches meet. The network pulses slowly as if nutrients flow through it. Uses a 2-pass ping-pong FBO (512x512) to simulate frontier-driven growth with noise-biased direction, branching probability, and repulsion from existing nearby branches. Mouse acts as a nutrient source — branches grow toward the cursor; click accelerates nearby growth.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify — add `MyceliumConfig`, union entry, `'mycelium'` to `ShaderPresetId`, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/mycelium-sim.frag.ts` | Create — simulation fragment shader (network growth + branching + repulsion) |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/shaders/mycelium-display.frag.ts` | Create — display fragment shader (network coloring + glow + nutrient pulse) |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/renderers/mycelium-renderer.ts` | Create — ShaderRenderer implementation (ping-pong FBO, seed logic, mouse nutrient attraction) |
| 5 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify — add `'mycelium'` case to `loadRenderer()` |
| 6 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify — add 5 keys to `BRAND_PREFIX_KEYS` |
| 7 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify — add preset card + sliders + defaults + `$derived` bindings |

## Config Interface

```typescript
export interface MyceliumConfig extends ShaderConfigBase {
  preset: 'mycelium';
  growth: number;      // 0.3-1.0, default 0.5 — Growth speed (frontier extension rate)
  branch: number;      // 0.1-0.5, default 0.25 — Branching probability
  spread: number;      // 0.5-2.0, default 1.0 — How far branches spread from seed
  pulse: number;       // 0.3-1.5, default 0.7 — Nutrient pulse speed along branches
  thickness: number;   // 0.5-2.0, default 1.0 — Branch line thickness multiplier
}
```

## Defaults (in DEFAULTS object)

```typescript
// Mycelium
myceliumGrowth: 0.5,
myceliumBranch: 0.25,
myceliumSpread: 1.0,
myceliumPulse: 0.7,
myceliumThickness: 1.0,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

All 5 keys must be registered in the `BRAND_PREFIX_KEYS` Set in `css-injection.ts`:

```
shader-mycelium-growth
shader-mycelium-branch
shader-mycelium-spread
shader-mycelium-pulse
shader-mycelium-thickness
```

## ShaderPresetId Update

```typescript
// Before:
export type ShaderPresetId = 'suture' | 'ether' | 'warp' | 'ripple' | 'pulse' | 'ink' | 'topo' | 'nebula' | 'turing' | 'silk' | 'glass' | 'film' | 'flux' | 'lava' | 'none';

// After:
export type ShaderPresetId = 'suture' | 'ether' | 'warp' | 'ripple' | 'pulse' | 'ink' | 'topo' | 'nebula' | 'turing' | 'silk' | 'glass' | 'film' | 'flux' | 'lava' | 'mycelium' | 'none';
```

## ShaderConfig Union Update

```typescript
export type ShaderConfig =
  | SutureConfig
  | EtherConfig
  | WarpConfig
  | RippleConfig
  | PulseConfig
  | InkConfig
  | TopoConfig
  | NebulaConfig
  | TuringConfig
  | SilkConfig
  | GlassConfig
  | FilmConfig
  | FluxConfig
  | LavaConfig
  | MyceliumConfig  // <-- ADD
  | NoneConfig;
```

## getShaderConfig Switch Case

```typescript
case 'mycelium':
  return {
    ...base,
    preset: 'mycelium',
    growth: rv('shader-mycelium-growth', DEFAULTS.myceliumGrowth),
    branch: rv('shader-mycelium-branch', DEFAULTS.myceliumBranch),
    spread: rv('shader-mycelium-spread', DEFAULTS.myceliumSpread),
    pulse: rv('shader-mycelium-pulse', DEFAULTS.myceliumPulse),
    thickness: rv('shader-mycelium-thickness', DEFAULTS.myceliumThickness),
  };
```

## Simulation Shader (mycelium-sim.frag.ts)

### Buffer Format

```
R = network density   (0.0 = empty, 1.0 = branch present)
G = growth direction  (encoded angle: 0.0-1.0 maps to 0-2*PI)
B = age               (0.0 = newly grown, increases toward 1.0 over ~600 frames)
A = 1.0               (unused, required for FBO)
```

### Design Rationale

The simulation models frontier-driven growth, not diffusion. Each frame, "frontier" pixels (network density > 0 with empty neighbors) attempt to extend by 1 pixel in a noise-biased direction. This produces the characteristic organic branching of real mycelium networks:

1. **Frontier detection** — pixels with R > 0.5 that border at least one empty neighbor are growth candidates.
2. **Direction bias** — growth direction is influenced by value noise (organic randomness) plus attraction toward the mouse position (nutrient source).
3. **Branching** — at each frontier pixel, there is a probability of spawning a second growth direction. This probability increases with distance from the last branch point (tracked implicitly via age difference between neighbors).
4. **Repulsion** — before extending, check the density of existing branches in a small radius (~3-4 texels). If too dense, growth is suppressed. This prevents self-intersection and produces the airy, web-like spacing of real mycelium.
5. **Nutrient pulse** — a travelling wave (sin function of age + time) modulates the brightness of existing branches, creating the illusion of nutrients flowing through the network.

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `uState` | `sampler2D` | Ping-pong simulation texture (RGB = density + direction + age) |
| `uTexel` | `vec2` | 1.0 / simResolution (1/512) |
| `uGrowth` | `float` | Growth speed — probability of frontier extension per frame (0.3-1.0) |
| `uBranch` | `float` | Branching probability per frontier pixel per frame (0.1-0.5) |
| `uSpread` | `float` | Spread factor — scales the repulsion radius (0.5-2.0) |
| `uPulse` | `float` | Nutrient pulse animation speed (0.3-1.5) |
| `uThickness` | `float` | Branch thickness multiplier (affects growth cone width) |
| `uTime` | `float` | Elapsed time in seconds |
| `uMouse` | `vec2` | Mouse position (0-1) |
| `uMouseActive` | `float` | 1.0 if mouse over canvas |
| `uMouseClick` | `float` | 1.0 on click frame, decays to 0 (burst growth trigger) |
| `uSeedPos` | `vec2` | New seed point position (-10 if none this frame) |

### GLSL Pseudocode

```glsl
#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uGrowth;
uniform float uBranch;
uniform float uSpread;
uniform float uPulse;
uniform float uThickness;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uMouseClick;
uniform vec2 uSeedPos;

// ── Hash noise (same pattern as ink-sim) ──────────────────────────
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// ── Decode/encode angle in [0,1] range ───────────────────────────
float decodeAngle(float encoded) {
  return encoded * 6.2831853; // 0-1 -> 0-2PI
}

float encodeAngle(float angle) {
  return fract(angle / 6.2831853); // 0-2PI -> 0-1
}

// ── Sample neighborhood density (repulsion check) ────────────────
float neighborhoodDensity(vec2 uv, float radius) {
  float total = 0.0;
  float samples = 0.0;
  float step = uTexel.x;
  float r = radius * step * uSpread;
  for (float dy = -3.0; dy <= 3.0; dy += 1.0) {
    for (float dx = -3.0; dx <= 3.0; dx += 1.0) {
      vec2 offset = vec2(dx, dy) * step;
      if (length(offset) <= r && length(offset) > step * 0.5) {
        total += texture(uState, uv + offset).r;
        samples += 1.0;
      }
    }
  }
  return samples > 0.0 ? total / samples : 0.0;
}

void main() {
  vec4 state = texture(uState, v_uv);
  float density = state.r;
  float direction = state.g;
  float age = state.b;

  // ── 1. Existing branch — age it, pass through ──────────────────
  if (density > 0.5) {
    age = min(age + 0.0017, 1.0); // ~600 frames to reach 1.0 (~10s at 60fps)
    fragColor = vec4(density, direction, age, 1.0);
    return;
  }

  // ── 2. Empty pixel — check if any neighbor is a frontier ───────
  // Read 8-connected neighbors
  float nN  = texture(uState, v_uv + vec2(0.0, uTexel.y)).r;
  float nS  = texture(uState, v_uv - vec2(0.0, uTexel.y)).r;
  float nE  = texture(uState, v_uv + vec2(uTexel.x, 0.0)).r;
  float nW  = texture(uState, v_uv - vec2(uTexel.x, 0.0)).r;
  float nNE = texture(uState, v_uv + vec2(uTexel.x, uTexel.y)).r;
  float nNW = texture(uState, v_uv + vec2(-uTexel.x, uTexel.y)).r;
  float nSE = texture(uState, v_uv + vec2(uTexel.x, -uTexel.y)).r;
  float nSW = texture(uState, v_uv + vec2(-uTexel.x, -uTexel.y)).r;

  // Count how many neighbors are occupied (frontier detection)
  float occupied = step(0.5, nN) + step(0.5, nS) + step(0.5, nE) + step(0.5, nW)
                 + step(0.5, nNE) + step(0.5, nNW) + step(0.5, nSE) + step(0.5, nSW);

  if (occupied < 0.5) {
    // No adjacent branches — check for new seed placement
    if (uSeedPos.x > -5.0) {
      float seedDist = length(v_uv - uSeedPos);
      if (seedDist < 0.006) {
        // Seed: place initial growth point with random direction
        float seedAngle = hash21(v_uv * 100.0 + uTime) * 6.2831853;
        fragColor = vec4(1.0, encodeAngle(seedAngle), 0.0, 1.0);
        return;
      }
    }
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // ── 3. Adjacent to a branch — attempt growth ───────────────────
  // Compute direction from occupied neighbors toward this pixel
  vec2 growDir = vec2(0.0);
  growDir += vec2(0.0, -1.0) * step(0.5, nN);   // N neighbor means growth came from above
  growDir += vec2(0.0, 1.0) * step(0.5, nS);
  growDir += vec2(-1.0, 0.0) * step(0.5, nE);
  growDir += vec2(1.0, 0.0) * step(0.5, nW);
  growDir += vec2(-1.0, -1.0) * step(0.5, nNE) * 0.707;
  growDir += vec2(1.0, -1.0) * step(0.5, nNW) * 0.707;
  growDir += vec2(-1.0, 1.0) * step(0.5, nSE) * 0.707;
  growDir += vec2(1.0, 1.0) * step(0.5, nSW) * 0.707;

  // Read the dominant neighbor's direction (inherit growth direction)
  float parentDir = 0.0;
  float maxParent = 0.0;
  // Pick the cardinal neighbor with the youngest age as the "parent"
  float ageN = texture(uState, v_uv + vec2(0.0, uTexel.y)).b;
  float ageS = texture(uState, v_uv - vec2(0.0, uTexel.y)).b;
  float ageE = texture(uState, v_uv + vec2(uTexel.x, 0.0)).b;
  float ageW = texture(uState, v_uv - vec2(uTexel.x, 0.0)).b;

  float dirN = texture(uState, v_uv + vec2(0.0, uTexel.y)).g;
  float dirS = texture(uState, v_uv - vec2(0.0, uTexel.y)).g;
  float dirE = texture(uState, v_uv + vec2(uTexel.x, 0.0)).g;
  float dirW = texture(uState, v_uv - vec2(uTexel.x, 0.0)).g;

  // Youngest neighbor is most recently grown — best parent candidate
  if (nN > 0.5 && (1.0 - ageN) > maxParent) { maxParent = 1.0 - ageN; parentDir = dirN; }
  if (nS > 0.5 && (1.0 - ageS) > maxParent) { maxParent = 1.0 - ageS; parentDir = dirS; }
  if (nE > 0.5 && (1.0 - ageE) > maxParent) { maxParent = 1.0 - ageE; parentDir = dirE; }
  if (nW > 0.5 && (1.0 - ageW) > maxParent) { maxParent = 1.0 - ageW; parentDir = dirW; }

  float inheritedAngle = decodeAngle(parentDir);

  // ── 4. Noise-biased growth direction ───────────────────────────
  float noiseVal = valueNoise(v_uv * 40.0 + uTime * 0.03);
  float noiseAngle = noiseVal * 6.2831853;

  // Blend inherited direction with noise for organic variation
  float finalAngle = inheritedAngle + (noiseAngle - 3.14159) * 0.3;

  // ── 5. Mouse attraction — bias growth toward cursor ────────────
  if (uMouseActive > 0.5) {
    vec2 toMouse = uMouse - v_uv;
    float mouseDist = length(toMouse);
    if (mouseDist > 0.001) {
      float mouseAngle = atan(toMouse.y, toMouse.x);
      // Attraction strength falls off with distance
      float attraction = smoothstep(0.4, 0.0, mouseDist) * 0.5;
      // Blend toward mouse direction
      finalAngle = mix(finalAngle, mouseAngle, attraction);
    }
  }

  // ── 6. Check if this pixel is in the growth cone of the parent ─
  // The parent's direction must roughly point toward this pixel
  vec2 parentToHere = normalize(growDir + vec2(0.001));
  vec2 growVec = vec2(cos(finalAngle), sin(finalAngle));
  float alignment = dot(parentToHere, growVec);

  // Thickness widens the acceptance cone
  float coneThreshold = 0.3 / uThickness;

  // ── 7. Repulsion — prevent self-intersection ───────────────────
  float localDensity = neighborhoodDensity(v_uv, 3.0);
  float repulsionPenalty = smoothstep(0.15, 0.4, localDensity);

  // ── 8. Growth probability ──────────────────────────────────────
  float growthChance = uGrowth * 0.15; // Base probability per frame
  // Click boost: temporarily increase growth speed near cursor
  if (uMouseClick > 0.1) {
    float clickDist = length(v_uv - uMouse);
    growthChance += uMouseClick * smoothstep(0.15, 0.0, clickDist) * 0.4;
  }

  // Stochastic growth decision
  float rng = hash21(v_uv * 512.0 + fract(uTime * 17.31));

  // Only grow if: aligned with growth direction, not too dense, and RNG passes
  if (alignment > coneThreshold && repulsionPenalty < 0.7 && rng < growthChance) {
    // ── 9. Branching decision ──────────────────────────────────
    // Check if this should be a branch point (new direction)
    float branchRng = hash21(v_uv * 256.0 + fract(uTime * 23.17));
    if (branchRng < uBranch * 0.3) {
      // Fork: rotate direction by ~30-60 degrees
      float forkAngle = (hash21(v_uv * 789.0 + uTime) - 0.5) * 1.5;
      finalAngle += forkAngle;
    }

    density = 1.0;
    direction = encodeAngle(finalAngle);
    age = 0.0;
  }

  // ── 10. New seed placement ─────────────────────────────────────
  if (uSeedPos.x > -5.0) {
    float seedDist = length(v_uv - uSeedPos);
    if (seedDist < 0.006) {
      float seedAngle = hash21(v_uv * 100.0 + uTime) * 6.2831853;
      density = 1.0;
      direction = encodeAngle(seedAngle);
      age = 0.0;
    }
  }

  // ── 11. Edge damping ───────────────────────────────────────────
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 6.0), v_uv) *
              smoothstep(vec2(0.0), vec2(uTexel * 6.0), 1.0 - v_uv);
  density *= edge.x * edge.y;

  fragColor = vec4(density, direction, age, 1.0);
}
```

## Display Shader (mycelium-display.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `uState` | `sampler2D` | Simulation texture (R=density, G=direction, B=age) |
| `uColorPrimary` | `vec3` | Branch body color (with glow) |
| `uColorSecondary` | `vec3` | Node/junction color |
| `uColorAccent` | `vec3` | Growth tip color (bright) |
| `uBgColor` | `vec3` | Background (empty regions) |
| `uIntensity` | `float` | Brightness multiplier |
| `uGrain` | `float` | Film grain strength |
| `uVignette` | `float` | Vignette strength |
| `uPulse` | `float` | Nutrient pulse speed |
| `uTime` | `float` | Elapsed time (for pulse animation + grain) |

### GLSL Pseudocode

```glsl
#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uPulse, uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // ── 1. Read simulation state ────────────────────────────────────
  vec4 state = texture(uState, v_uv);
  float density = state.r;
  float direction = state.g;
  float age = state.b;

  // ── 2. Base color: background for empty, branch for occupied ───
  vec3 color = uBgColor;

  if (density > 0.5) {
    // ── 3. Nutrient pulse — travelling wave along branches ───────
    // Wave travels as a function of age (older = already pulsed) and time
    float pulsePhase = age * 10.0 - uTime * uPulse;
    float pulseWave = 0.5 + 0.5 * sin(pulsePhase * 3.14159);

    // Pulse cycles between primary and accent
    vec3 branchColor = mix(uColorPrimary, uColorAccent, pulseWave * 0.4);

    // ── 4. Junction detection — pixels with many occupied neighbors
    // Use screen-space derivatives to detect branch intersections
    float dDx = abs(dFdx(density));
    float dDy = abs(dFdy(density));
    float edgeness = smoothstep(0.0, 0.2, dDx + dDy);

    // Junctions: high density neighborhood = node point
    // Approximate by checking if 3+ neighbors are occupied
    // (done via the derivative approach — high density variation = junction)
    float junctionFactor = smoothstep(0.1, 0.3, edgeness) * 0.5;
    branchColor = mix(branchColor, uColorSecondary, junctionFactor);

    // ── 5. Growth tips — newly grown pixels (very low age) ───────
    float youthFactor = 1.0 - smoothstep(0.0, 0.08, age);
    branchColor = mix(branchColor, uColorAccent, youthFactor * 0.7);

    // ── 6. Glow — soft bloom around branches ─────────────────────
    color = branchColor * uIntensity;

    // Add subtle glow proportional to pulse
    color += uColorPrimary * pulseWave * 0.15 * uIntensity;
  } else {
    // ── 7. Nearby branch glow (ambient glow in empty space) ──────
    // Sample neighbors to detect proximity to a branch
    float nearby = 0.0;
    float tx = 1.0 / 512.0;
    for (float dy = -2.0; dy <= 2.0; dy += 1.0) {
      for (float dx = -2.0; dx <= 2.0; dx += 1.0) {
        nearby += texture(uState, v_uv + vec2(dx, dy) * tx).r;
      }
    }
    nearby /= 25.0;

    // Very subtle glow from nearby branches
    color += nearby * uColorPrimary * 0.08 * uIntensity;
  }

  // ── 8. Reinhard tone mapping ────────────────────────────────────
  color = color / (1.0 + color);

  // ── 9. Brightness cap ───────────────────────────────────────────
  color = min(color, vec3(0.75));

  // ── 10. Intensity blend (mix with bg to control overall strength)
  color = mix(uBgColor / (1.0 + uBgColor), color, uIntensity);

  // ── 11. Vignette ────────────────────────────────────────────────
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // ── 12. Film grain ──────────────────────────────────────────────
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
```

## Renderer (mycelium-renderer.ts)

### Structure

Follows the ink-renderer pattern exactly:
- Ping-pong `DoubleFBO` at 512x512
- 3 programs: `initProg`, `simProg`, `displayProg`
- `stepSim()` helper function
- Two substeps per frame for smoother growth evolution

### Init Fragment Shader

```glsl
#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
void main() { fragColor = vec4(0.0, 0.0, 0.0, 1.0); } // All empty, no network
```

### Seed Logic

**reset()** — must seed initial growth points so the network starts immediately:
- Place 3-5 random seed points (density=1.0 with random directions)
- Seeds are placed by running sim steps with `uSeedPos` set to random positions
- This ensures visible growth begins within the first few frames

**Ambient seeds** — every 4-8 seconds, spawn a new seed point:
- Randomize position within inner 70% of canvas (avoid edges)
- Track `lastSeedTime` and `nextSeedInterval` (same pattern as ink ambient drops)
- Interval is longer than ink (2-3.5s) but shorter than frost (5-10s) because mycelium networks are expansive and benefit from multiple origin points

**Click seeds** — `mouse.burstStrength > 0` triggers accelerated growth near click:
- Pass `uMouseClick = burstStrength` to the sim shader
- The sim shader increases growth probability near the click position
- Does NOT plant a new seed — instead accelerates existing frontiers

### Mouse Interaction

- **Hover (active):** Nutrient source. The sim shader biases growth direction toward the cursor. Branches that are growing will subtly curve toward the mouse. The attraction strength falls off with distance (smoothstep from 0 to 0.4 UV distance).
- **Click:** Growth acceleration burst. `mouse.burstStrength` is passed as `uMouseClick`, which temporarily increases the growth probability for frontier pixels near the click position. The burst decays over frames (handled by ShaderHero.svelte's existing `burstStrength *= 0.85` decay).
- No channel rotation (single network state, not multi-channel like ink).

### Sim Uniform Names

```typescript
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uGrowth',
  'uBranch',
  'uSpread',
  'uPulse',
  'uThickness',
  'uTime',
  'uMouse',
  'uMouseActive',
  'uMouseClick',
  'uSeedPos',
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
  'uPulse',
  'uTime',
] as const;
```

### reset() Implementation

```typescript
reset(gl: WebGL2RenderingContext): void {
  if (!initProg || !simBuf || !quad) return;

  lastSeedTime = 0;
  nextSeedInterval = 4.0 + Math.random() * 4.0;
  clickStrength = 0;

  // Clear both FBO sides to empty
  gl.viewport(0, 0, SIM_RES, SIM_RES);
  gl.useProgram(initProg);
  quad.bind(initProg);
  gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
  drawQuad(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
  drawQuad(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Seed initial growth points for immediate visual interest
  // Place 3-5 seeds scattered across the canvas
  const seedCount = 3 + Math.floor(Math.random() * 3);
  const defaultCfg: MyceliumConfig = {
    preset: 'mycelium',
    intensity: 0.65,
    grain: 0.025,
    vignette: 0.2,
    colors: { primary: [0.5,0.5,0.5], secondary: [0.5,0.5,0.5], accent: [0.5,0.5,0.5], bg: [0.05,0.05,0.05] },
    growth: 0.5,
    branch: 0.25,
    spread: 1.0,
    pulse: 0.7,
    thickness: 1.0,
  };
  for (let i = 0; i < seedCount; i++) {
    const sx = 0.2 + Math.random() * 0.6;
    const sy = 0.2 + Math.random() * 0.6;
    stepSim(gl, 0, -10, -10, false, 0, sx, sy, defaultCfg);
  }
}
```

### render() Frame Logic

```typescript
render(gl, time, mouse, config, width, height): void {
  const cfg = config as MyceliumConfig;

  // ── Track click burst strength ──────────────────────────────
  if (mouse.burstStrength > 0.01) {
    clickStrength = mouse.burstStrength;
  } else {
    clickStrength *= 0.9; // Smooth decay
    if (clickStrength < 0.01) clickStrength = 0;
  }

  // ── Ambient seed (every 4-8s) ───────────────────────────────
  let seedX = -10.0, seedY = -10.0;
  if (time - lastSeedTime > nextSeedInterval) {
    lastSeedTime = time;
    nextSeedInterval = 4.0 + Math.random() * 4.0;
    seedX = 0.15 + Math.random() * 0.7;
    seedY = 0.15 + Math.random() * 0.7;
  }

  // ── Substep 1: with mouse input + seed ──────────────────────
  stepSim(gl, time,
    mouse.active ? mouse.x : -10,
    mouse.active ? mouse.y : -10,
    mouse.active,
    clickStrength,
    seedX, seedY,
    cfg
  );

  // ── Substep 2: coast (no input, no seed) ────────────────────
  stepSim(gl, time,
    mouse.active ? mouse.x : -10,
    mouse.active ? mouse.y : -10,
    mouse.active,
    0, // No click boost on coast step
    -10, -10,
    cfg
  );

  // ── Display pass ────────────────────────────────────────────
  gl.viewport(0, 0, width, height);
  gl.useProgram(displayProg);
  quad.bind(displayProg);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
  gl.uniform1i(displayU.uState, 0);

  gl.uniform3fv(displayU.uColorPrimary, cfg.colors.primary);
  gl.uniform3fv(displayU.uColorSecondary, cfg.colors.secondary);
  gl.uniform3fv(displayU.uColorAccent, cfg.colors.accent);
  gl.uniform3fv(displayU.uBgColor, cfg.colors.bg);
  gl.uniform1f(displayU.uIntensity, cfg.intensity);
  gl.uniform1f(displayU.uGrain, cfg.grain);
  gl.uniform1f(displayU.uVignette, cfg.vignette);
  gl.uniform1f(displayU.uPulse, cfg.pulse);
  gl.uniform1f(displayU.uTime, time);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  drawQuad(gl);
}
```

## Brand Editor Sliders (BrandEditorHeroEffects.svelte)

### Preset Card

```typescript
{ id: 'mycelium', label: 'Mycelium', description: 'Fungal network growth' },
```

### DEFAULTS entries

```typescript
'shader-mycelium-growth': '0.50',
'shader-mycelium-branch': '0.25',
'shader-mycelium-spread': '1.00',
'shader-mycelium-pulse': '0.70',
'shader-mycelium-thickness': '1.00',
```

### $derived bindings

```typescript
// Mycelium
const myceliumGrowth = $derived(readNum('shader-mycelium-growth'));
const myceliumBranch = $derived(readNum('shader-mycelium-branch'));
const myceliumSpread = $derived(readNum('shader-mycelium-spread'));
const myceliumPulse = $derived(readNum('shader-mycelium-pulse'));
const myceliumThickness = $derived(readNum('shader-mycelium-thickness'));
```

### Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel | value format |
|----|-------|-----|-----|------|---------|----------|----------|--------------|
| `shader-mycelium-growth` | Growth Speed | 0.30 | 1.00 | 0.05 | 0.50 | Slow | Fast | `.toFixed(2)` |
| `shader-mycelium-branch` | Branching | 0.10 | 0.50 | 0.05 | 0.25 | Sparse | Dense | `.toFixed(2)` |
| `shader-mycelium-spread` | Spread | 0.50 | 2.00 | 0.10 | 1.00 | Tight | Wide | `.toFixed(2)` |
| `shader-mycelium-pulse` | Pulse Speed | 0.30 | 1.50 | 0.10 | 0.70 | Slow | Fast | `.toFixed(2)` |
| `shader-mycelium-thickness` | Thickness | 0.50 | 2.00 | 0.10 | 1.00 | Thin | Thick | `.toFixed(2)` |

### Svelte Template (per-preset section)

```svelte
{:else if activePreset === 'mycelium'}
  <section class="hero-fx__section">
    <span class="hero-fx__section-label">Mycelium</span>

    <BrandSliderField
      id="shader-mycelium-growth"
      label="Growth Speed"
      value={myceliumGrowth.toFixed(2)}
      min={0.30}
      max={1.00}
      step={0.05}
      current={myceliumGrowth}
      minLabel="Slow"
      maxLabel="Fast"
      oninput={handleSliderInput('shader-mycelium-growth')}
    />

    <BrandSliderField
      id="shader-mycelium-branch"
      label="Branching"
      value={myceliumBranch.toFixed(2)}
      min={0.10}
      max={0.50}
      step={0.05}
      current={myceliumBranch}
      minLabel="Sparse"
      maxLabel="Dense"
      oninput={handleSliderInput('shader-mycelium-branch')}
    />

    <BrandSliderField
      id="shader-mycelium-spread"
      label="Spread"
      value={myceliumSpread.toFixed(2)}
      min={0.50}
      max={2.00}
      step={0.10}
      current={myceliumSpread}
      minLabel="Tight"
      maxLabel="Wide"
      oninput={handleSliderInput('shader-mycelium-spread')}
    />

    <BrandSliderField
      id="shader-mycelium-pulse"
      label="Pulse Speed"
      value={myceliumPulse.toFixed(2)}
      min={0.30}
      max={1.50}
      step={0.10}
      current={myceliumPulse}
      minLabel="Slow"
      maxLabel="Fast"
      oninput={handleSliderInput('shader-mycelium-pulse')}
    />

    <BrandSliderField
      id="shader-mycelium-thickness"
      label="Thickness"
      value={myceliumThickness.toFixed(2)}
      min={0.50}
      max={2.00}
      step={0.10}
      current={myceliumThickness}
      minLabel="Thin"
      maxLabel="Thick"
      oninput={handleSliderInput('shader-mycelium-thickness')}
    />
  </section>
```

## ShaderHero.svelte loadRenderer Update

```typescript
case 'mycelium': {
  const { createMyceliumRenderer } = await import('./renderers/mycelium-renderer');
  return createMyceliumRenderer();
}
```

## Brand Color Mapping

| Visual Element | Source | Description |
|---|---|---|
| Branch body + glow | `colors.primary` | Main branch color, plus soft glow halo around branches |
| Growth tips | `colors.accent` | Bright tips on newly grown pixels (youth factor) |
| Nodes/junctions | `colors.secondary` | Where multiple branches meet, detected via derivative analysis |
| Background | `colors.bg` | Empty regions |
| Nutrient pulse wave | `primary` <-> `accent` | Travelling sine wave cycles branch color between primary and accent |
| Nearby glow (ambient) | `colors.primary` at 8% | Very subtle glow in empty space near branches |

## Post-Processing Pipeline

Same pipeline as all other presets:
1. **Reinhard tone mapping** -- `color / (1.0 + color)`
2. **Brightness cap** -- `min(color, 0.75)`
3. **Intensity blend** -- `mix(tonemapped_bg, color, intensity)`
4. **Vignette** -- `1.0 - dot(vc, vc) * vignette`
5. **Film grain** -- hash-based per-pixel noise animated by time

## Gotchas

1. **BRAND_PREFIX_KEYS registration is CRITICAL** -- all 5 `shader-mycelium-*` keys must be added to the Set in `css-injection.ts`. Missing keys cause sliders to silently do nothing (CSS vars get `--color-` prefix instead of `--brand-` prefix, so `readBrandVar()` never finds them).

2. **EXT_color_buffer_float check in init()** -- required for RGBA16F FBO. Must check and return `false` if unavailable:
   ```typescript
   if (!gl.getExtension('EXT_color_buffer_float')) return false;
   gl.getExtension('OES_texture_float_linear');
   ```

3. **reset() must seed initial growth points** -- unlike ink (which starts empty and waits for ambient drops), mycelium MUST have seed points on reset so the network begins growing immediately. Without seeds, the screen stays blank indefinitely. Place 3-5 seeds scattered across the inner 60% of the canvas.

4. **Two substeps per frame** -- one with full input (mouse attraction + click boost + seed), one coast (mouse attraction only, no click boost, no seed). This produces smoother network evolution, matching the pattern from ink-renderer.

5. **Growth rate is intentionally SLOW** -- the beauty of this effect is watching thin filaments creep outward and fork over seconds. The growth param at default 0.5 should produce about 1-2 pixels of new network per frame. If growth appears instant or fills the screen within seconds, the base probability in the sim shader is too high.

6. **Neighborhood density loop performance** -- the 7x7 neighborhood sample in the repulsion check (49 texture reads) is expensive. At 512x512 sim resolution with 2 substeps this is acceptable, but do NOT increase the sample radius beyond 3-4 texels. If performance is an issue on mobile, consider reducing to a 5x5 (25 reads) kernel.

7. **Direction encoding precision** -- angles are encoded as floats in [0,1] mapping to [0,2PI]. With RGBA16F (half-float, ~3 decimal digits of precision), this gives ~11-bit angular resolution (~0.18 degree steps), which is more than sufficient. Do NOT use RGBA8 FBOs — the 8-bit precision would cause visible angular quantization artifacts in growth direction.

8. **Age normalization** -- age increments at 0.0017 per frame (~600 frames to reach 1.0 at 60fps = ~10 seconds). This gives the nutrient pulse visible time to cycle along branch segments before they fully age. Branches never disappear (no evaporation unlike ink) — age just controls the pulse animation phase.

9. **Ambient seed interval (4-8s)** -- between ink's 2-3.5s and frost's 5-10s. Mycelium networks spread continuously from seeds, so new seeds add new growth origins that eventually merge with existing network. Too-frequent seeds would produce many small disconnected clusters instead of one large network.

10. **Mouse as nutrient source (NOT deposit/melt)** -- the mouse does not deposit material (unlike ink) or destroy material (unlike frost). Instead, it biases growth direction. Branches curve toward the cursor as if attracted by a nutrient gradient. Click bursts temporarily increase growth speed near the cursor without planting new seeds.

11. **No channel rotation** -- unlike ink (3 independent channels), mycelium has a single binary state per pixel (empty/occupied). There is no concept of rotating channels.

12. **ShaderPresetId type must be updated** -- add `'mycelium'` to the union type before `'none'`. If forgotten, TypeScript rejects `preset: 'mycelium'` in config objects.

13. **Branching probability scaling** -- the raw `uBranch` value (0.1-0.5) is multiplied by 0.3 in the shader to keep effective branching probability low (~3-15% per frontier pixel per frame). Without this scaling, high branch values would produce immediate explosive growth in all directions.

14. **Edge damping radius** -- uses `uTexel * 6.0` (wider than ink's `4.0`) because mycelium networks need more runway to avoid branches growing into the edge and creating hard cutoff artifacts.

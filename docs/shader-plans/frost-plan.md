# Frost (Ice Crystal Growth) Shader Preset — Implementation Plan

## Overview

Add a "frost" shader preset: delicate crystalline dendrites growing slowly outward from seed points, branching like frost on a window or snowflake arms. Uses a 2-pass ping-pong FBO (512x512) to simulate diffusion-limited aggregation (DLA) with anisotropic bias for branching. Mouse acts as a heat source that melts frozen regions; click plants a new seed crystal. Ambient seeds spawn every 5-10 seconds.

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify — add `FrostConfig`, union entry, `'frost'` to `ShaderPresetId`, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/frost-sim.frag.ts` | Create — simulation fragment shader (diffusion + freezing + anisotropy) |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/shaders/frost-display.frag.ts` | Create — display fragment shader (crystal coloring + growth front glow) |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/renderers/frost-renderer.ts` | Create — ShaderRenderer implementation (ping-pong FBO, seed logic, mouse melt) |
| 5 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify — add `'frost'` case to `loadRenderer()` |
| 6 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify — add 5 keys to `BRAND_PREFIX_KEYS` |
| 7 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify — add preset card + sliders + defaults + `$derived` bindings |

## Config Interface

```typescript
export interface FrostConfig extends ShaderConfigBase {
  preset: 'frost';
  growth: number;      // 0.3-1.0, default 0.6 — Growth speed (threshold bias)
  branch: number;      // 0.1-0.5, default 0.3 — Branching tendency (anisotropy strength)
  symmetry: number;    // 4-8, default 6, int — Symmetry fold count for anisotropic bias
  melt: number;        // 0.5-2.0, default 1.0 — Mouse melt radius (UV units * 0.1)
  glow: number;        // 0.3-1.5, default 0.8 — Growth front glow intensity
}
```

## Defaults (in DEFAULTS object)

```typescript
// Frost
frostGrowth: 0.6,
frostBranch: 0.3,
frostSymmetry: 6,
frostMelt: 1.0,
frostGlow: 0.8,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

All 5 keys must be registered in the `BRAND_PREFIX_KEYS` Set in `css-injection.ts`:

```
shader-frost-growth
shader-frost-branch
shader-frost-symmetry
shader-frost-melt
shader-frost-glow
```

## ShaderPresetId Update

```typescript
// Before:
export type ShaderPresetId = 'suture' | 'ether' | 'warp' | 'ripple' | 'pulse' | 'ink' | 'topo' | 'nebula' | 'turing' | 'silk' | 'glass' | 'film' | 'flux' | 'lava' | 'none';

// After:
export type ShaderPresetId = 'suture' | 'ether' | 'warp' | 'ripple' | 'pulse' | 'ink' | 'topo' | 'nebula' | 'turing' | 'silk' | 'glass' | 'film' | 'flux' | 'lava' | 'frost' | 'none';
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
  | FrostConfig  // ← ADD
  | NoneConfig;
```

## getShaderConfig Switch Case

```typescript
case 'frost':
  return {
    ...base,
    preset: 'frost',
    growth: rv('shader-frost-growth', DEFAULTS.frostGrowth),
    branch: rv('shader-frost-branch', DEFAULTS.frostBranch),
    symmetry: Math.round(rv('shader-frost-symmetry', DEFAULTS.frostSymmetry)),
    melt: rv('shader-frost-melt', DEFAULTS.frostMelt),
    glow: rv('shader-frost-glow', DEFAULTS.frostGlow),
  };
```

Note: `symmetry` uses `Math.round()` because it is an integer uniform (fold count).

## Simulation Shader (frost-sim.frag.ts)

### Buffer Format

```
R = frozen state    (0.0 = liquid, 1.0 = frozen)
G = diffusion field (concentration of "freezing potential", 0.0-1.0)
B = freeze age      (frames since frozen, normalized 0.0-1.0 over ~500 frames)
A = 1.0             (unused, required for FBO)
```

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `uState` | `sampler2D` | Ping-pong simulation texture (RG = frozen + diffusion) |
| `uTexel` | `vec2` | 1.0 / simResolution (1/512) |
| `uGrowth` | `float` | Growth speed — threshold for freezing (0.3-1.0) |
| `uBranch` | `float` | Anisotropy strength — branching tendency (0.1-0.5) |
| `uSymmetry` | `int` | Symmetry fold count (4-8) — **use gl.uniform1i()** |
| `uMelt` | `float` | Mouse melt radius in UV units * 0.1 |
| `uTime` | `float` | Elapsed time in seconds |
| `uMouse` | `vec2` | Mouse position (0-1) |
| `uMouseActive` | `float` | 1.0 if mouse over canvas |
| `uSeedPos` | `vec2` | New seed crystal position (-10 if none) |

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
uniform int uSymmetry;
uniform float uMelt;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
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

// ── Anisotropic freezing bias ─────────────────────────────────────
// Returns a value in [0,1] that is highest along preferred growth
// directions (N-fold symmetry). Uses atan2 of the direction from
// the nearest frozen neighbor to create directional preference.
float anisotropyBias(vec2 dir, int sym) {
  float angle = atan(dir.y, dir.x);
  float fold = float(sym);
  // cos(fold * angle) gives N-fold symmetry lobes
  // Range [-1,1] → remap to [0,1]
  return 0.5 + 0.5 * cos(fold * angle);
}

void main() {
  vec4 state = texture(uState, v_uv);
  float frozen = state.r;
  float diffuse = state.g;
  float age = state.b;

  // ── 1. Already frozen — just age it ─────────────────────────────
  if (frozen > 0.5) {
    age = min(age + 0.002, 1.0); // age slowly to 1.0

    // ── Mouse melt: frozen pixels within melt radius revert to liquid
    if (uMouseActive > 0.5) {
      float dist = length(v_uv - uMouse);
      float meltRadius = uMelt * 0.1;
      if (dist < meltRadius) {
        float meltStrength = smoothstep(meltRadius, meltRadius * 0.3, dist);
        frozen = mix(frozen, 0.0, meltStrength);
        age = 0.0;
      }
    }

    fragColor = vec4(frozen, diffuse, age, 1.0);
    return;
  }

  // ── 2. Diffusion step: blur the G channel (3x3 kernel) ─────────
  float gN = texture(uState, v_uv + vec2(0.0, uTexel.y)).g;
  float gS = texture(uState, v_uv - vec2(0.0, uTexel.y)).g;
  float gE = texture(uState, v_uv + vec2(uTexel.x, 0.0)).g;
  float gW = texture(uState, v_uv - vec2(uTexel.x, 0.0)).g;

  // 5-point Laplacian diffusion
  float laplacian = gN + gS + gE + gW - 4.0 * diffuse;
  diffuse += 0.2 * laplacian;

  // Ambient diffusion source — slowly increases everywhere
  // This ensures growth potential gradually fills the field
  diffuse += 0.001;
  diffuse = clamp(diffuse, 0.0, 1.0);

  // ── 3. Freezing check: adjacent to frozen + diffusion > threshold
  float fN = texture(uState, v_uv + vec2(0.0, uTexel.y)).r;
  float fS = texture(uState, v_uv - vec2(0.0, uTexel.y)).r;
  float fE = texture(uState, v_uv + vec2(uTexel.x, 0.0)).r;
  float fW = texture(uState, v_uv - vec2(uTexel.x, 0.0)).r;

  // Also check diagonals for smoother growth
  float fNE = texture(uState, v_uv + vec2(uTexel.x, uTexel.y)).r;
  float fNW = texture(uState, v_uv + vec2(-uTexel.x, uTexel.y)).r;
  float fSE = texture(uState, v_uv + vec2(uTexel.x, -uTexel.y)).r;
  float fSW = texture(uState, v_uv + vec2(-uTexel.x, -uTexel.y)).r;

  float frozenNeighbors = step(0.5, fN) + step(0.5, fS) +
                          step(0.5, fE) + step(0.5, fW);
  float frozenDiags = step(0.5, fNE) + step(0.5, fNW) +
                      step(0.5, fSE) + step(0.5, fSW);

  // Cardinal neighbors count more (direct adjacency)
  float adjacency = frozenNeighbors + frozenDiags * 0.5;

  if (adjacency > 0.5) {
    // ── 4. Anisotropic bias for branching ─────────────────────────
    // Compute direction to center of mass of frozen neighbors
    vec2 frozenDir = vec2(0.0);
    frozenDir += vec2(0.0, 1.0) * fN;
    frozenDir += vec2(0.0, -1.0) * fS;
    frozenDir += vec2(1.0, 0.0) * fE;
    frozenDir += vec2(-1.0, 0.0) * fW;
    frozenDir = normalize(frozenDir + vec2(0.001));

    // Add noise-based perturbation to direction
    float noise = valueNoise(v_uv * 50.0 + uTime * 0.05);
    float aBias = anisotropyBias(frozenDir, uSymmetry);

    // Threshold: lower = easier to freeze = faster growth
    // Growth param (0.3-1.0) maps inversely to threshold
    float threshold = 1.0 - uGrowth * 0.7;

    // Branching tendency modulates how much anisotropy affects the threshold
    // High branch = big difference between preferred/non-preferred directions
    float modulated = mix(1.0, aBias, uBranch);

    // Noise adds stochastic variation (prevents perfectly regular patterns)
    float noiseModulation = mix(0.8, 1.2, noise);

    if (diffuse * modulated * noiseModulation > threshold) {
      frozen = 1.0;
      diffuse *= 0.3; // Consume some diffusion potential on freezing
      age = 0.0;      // Newly frozen — age starts at 0
    }
  }

  // ── 5. New seed crystal ─────────────────────────────────────────
  if (uSeedPos.x > -5.0) {
    float seedDist = length(v_uv - uSeedPos);
    if (seedDist < 0.005) {
      frozen = 1.0;
      age = 0.0;
    }
  }

  // ── 6. Edge damping ─────────────────────────────────────────────
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 4.0), v_uv) *
              smoothstep(vec2(0.0), vec2(uTexel * 4.0), 1.0 - v_uv);
  diffuse *= edge.x * edge.y;

  fragColor = vec4(frozen, diffuse, age, 1.0);
}
```

## Display Shader (frost-display.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `uState` | `sampler2D` | Simulation texture (R=frozen, G=diffusion, B=age) |
| `uColorPrimary` | `vec3` | Crystal body color (frozen regions) |
| `uColorSecondary` | `vec3` | Aged crystal tint (old frozen regions) |
| `uColorAccent` | `vec3` | Growth front glow color |
| `uBgColor` | `vec3` | Background (unfrozen areas) |
| `uIntensity` | `float` | Brightness multiplier |
| `uGrain` | `float` | Film grain strength |
| `uVignette` | `float` | Vignette strength |
| `uGlow` | `float` | Growth front glow intensity |
| `uTime` | `float` | Elapsed time (for grain animation) |

### GLSL Pseudocode

```glsl
#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uGlow, uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // ── 1. Read simulation state ────────────────────────────────────
  vec4 state = texture(uState, v_uv);
  float frozen = state.r;
  float diffuse = state.g;
  float age = state.b;

  // ── 2. Base color: bg for liquid, primary for frozen ────────────
  vec3 color = uBgColor;

  if (frozen > 0.5) {
    // Mix primary → secondary as crystal ages
    vec3 crystalColor = mix(uColorPrimary, uColorSecondary, age * 0.4);
    color = crystalColor * uIntensity;

    // ── 3. Growth front glow — newly frozen pixels (low age) ──────
    // Detect growth front via screen-space derivatives of frozen state
    float dFx = abs(dFdx(frozen));
    float dFy = abs(dFdy(frozen));
    float edgeness = smoothstep(0.0, 0.3, dFx + dFy);

    // Young crystals at edges get accent glow
    float youthFactor = 1.0 - smoothstep(0.0, 0.15, age);
    color += edgeness * youthFactor * uColorAccent * uGlow * uIntensity;
  } else {
    // ── 4. Diffusion field subtle glow ────────────────────────────
    // Show faint diffusion potential as very subtle background modulation
    color += diffuse * 0.05 * uColorPrimary * uIntensity;
  }

  // ── 5. Reinhard tone mapping ────────────────────────────────────
  color = color / (1.0 + color);

  // ── 6. Brightness cap ───────────────────────────────────────────
  color = min(color, vec3(0.75));

  // ── 7. Intensity blend (mix with bg to control overall strength)
  color = mix(uBgColor / (1.0 + uBgColor), color, uIntensity);

  // ── 8. Vignette ─────────────────────────────────────────────────
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // ── 9. Film grain ───────────────────────────────────────────────
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
```

## Renderer (frost-renderer.ts)

### Structure

Follows the ink-renderer pattern exactly:
- Ping-pong `DoubleFBO` at 512x512
- 3 programs: `initProg`, `simProg`, `displayProg`
- `stepSim()` helper function
- Two substeps per frame for smoother evolution

### Init Fragment Shader

```glsl
#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
void main() { fragColor = vec4(0.0, 0.0, 0.0, 1.0); } // All liquid, no diffusion
```

### Seed Logic

**reset()** — must seed initial crystal points so growth starts immediately:
- Place 3-5 random seed points (frozen=1.0 in R channel at specific pixels)
- Initialize G channel with low ambient diffusion (0.1-0.2) everywhere
- This ensures visible growth begins within the first few frames

**Ambient seeds** — every 5-10 seconds, spawn a new seed point:
- Randomize position within inner 70% of canvas (avoid edges)
- Track `lastSeedTime` and `nextSeedInterval` (same pattern as ink ambient drops)

**Click seeds** — `mouse.burstStrength > 0` plants a new seed at click position

### Mouse Interaction

- **Hover (active):** Mouse acts as heat source. Pass `uMouseActive = 1.0` and `uMouse` position. The sim shader melts frozen pixels within `uMelt * 0.1` UV radius.
- **Click:** Plant a new seed crystal at `uSeedPos`. Growth radiates outward from this point.
- No channel rotation needed (unlike ink — frost is single-state, not multi-channel).

### Sim Uniform Names

```typescript
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uGrowth',
  'uBranch',
  'uSymmetry',   // ← int uniform, use gl.uniform1i()
  'uMelt',
  'uTime',
  'uMouse',
  'uMouseActive',
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
  'uGlow',
  'uTime',
] as const;
```

### stepSim() Key Detail

```typescript
// uSymmetry is an INTEGER uniform — must use gl.uniform1i with Math.round()
gl.uniform1i(simU.uSymmetry, Math.round(cfg.symmetry));
```

All other uniforms use `gl.uniform1f()` or `gl.uniform2f()` as normal.

### reset() Implementation

```typescript
reset(gl: WebGL2RenderingContext): void {
  if (!initProg || !simBuf || !quad) return;

  lastSeedTime = 0;
  nextSeedInterval = 5.0 + Math.random() * 5.0;

  // Clear both FBO sides
  gl.viewport(0, 0, SIM_RES, SIM_RES);
  gl.useProgram(initProg);
  quad.bind(initProg);
  gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
  drawQuad(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
  drawQuad(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Seed initial crystal points by running sim steps with seed positions
  // Place 3-5 seeds for immediate visual interest
  const seedCount = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < seedCount; i++) {
    const sx = 0.2 + Math.random() * 0.6;
    const sy = 0.2 + Math.random() * 0.6;
    stepSim(gl, 0, -10, -10, false, sx, sy, cfg_defaults);
    // Each seed step writes one seed point via uSeedPos
  }
}
```

### render() Frame Logic

```typescript
render(gl, time, mouse, config, width, height): void {
  const cfg = config as FrostConfig;

  // ── Ambient seed (every 5-10s) ──────────────────────────────
  let seedX = -10.0, seedY = -10.0;
  if (time - lastSeedTime > nextSeedInterval) {
    lastSeedTime = time;
    nextSeedInterval = 5.0 + Math.random() * 5.0;
    seedX = 0.15 + Math.random() * 0.7;
    seedY = 0.15 + Math.random() * 0.7;
  }

  // ── Click seed ──────────────────────────────────────────────
  if (mouse.burstStrength > 0) {
    seedX = mouse.x;
    seedY = mouse.y;
  }

  // ── Substep 1: with input (mouse melt + seed) ──────────────
  stepSim(gl, time, mouse, seedX, seedY, cfg);

  // ── Substep 2: coast (no input, no seed) ────────────────────
  stepSim(gl, time, noMouse, -10, -10, cfg);

  // ── Display pass ────────────────────────────────────────────
  // (standard: viewport, bind display prog, set uniforms, draw)
}
```

## Brand Editor Sliders (BrandEditorHeroEffects.svelte)

### Preset Card

```typescript
{ id: 'frost', label: 'Frost Crystal', description: 'Ice crystal dendrite growth' },
```

### DEFAULTS entries

```typescript
'shader-frost-growth': '0.60',
'shader-frost-branch': '0.30',
'shader-frost-symmetry': '6',
'shader-frost-melt': '1.00',
'shader-frost-glow': '0.80',
```

### $derived bindings

```typescript
// Frost
const frostGrowth = $derived(readNum('shader-frost-growth'));
const frostBranch = $derived(readNum('shader-frost-branch'));
const frostSymmetry = $derived(readNum('shader-frost-symmetry'));
const frostMelt = $derived(readNum('shader-frost-melt'));
const frostGlow = $derived(readNum('shader-frost-glow'));
```

### Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel | value format |
|----|-------|-----|-----|------|---------|----------|----------|--------------|
| `shader-frost-growth` | Growth Speed | 0.30 | 1.00 | 0.05 | 0.60 | Slow | Fast | `.toFixed(2)` |
| `shader-frost-branch` | Branching | 0.10 | 0.50 | 0.05 | 0.30 | Linear | Dendritic | `.toFixed(2)` |
| `shader-frost-symmetry` | Symmetry | 4 | 8 | 1 | 6 | 4-fold | 8-fold | `Math.round()` |
| `shader-frost-melt` | Melt Radius | 0.50 | 2.00 | 0.10 | 1.00 | Small | Wide | `.toFixed(2)` |
| `shader-frost-glow` | Growth Glow | 0.30 | 1.50 | 0.10 | 0.80 | Subtle | Bright | `.toFixed(2)` |

### Svelte Template (per-preset section)

```svelte
{:else if activePreset === 'frost'}
  <section class="hero-fx__section">
    <span class="hero-fx__section-label">Frost Crystal</span>

    <BrandSliderField
      id="shader-frost-growth"
      label="Growth Speed"
      value={frostGrowth.toFixed(2)}
      min={0.30}
      max={1.00}
      step={0.05}
      current={frostGrowth}
      minLabel="Slow"
      maxLabel="Fast"
      oninput={handleSliderInput('shader-frost-growth')}
    />

    <BrandSliderField
      id="shader-frost-branch"
      label="Branching"
      value={frostBranch.toFixed(2)}
      min={0.10}
      max={0.50}
      step={0.05}
      current={frostBranch}
      minLabel="Linear"
      maxLabel="Dendritic"
      oninput={handleSliderInput('shader-frost-branch')}
    />

    <BrandSliderField
      id="shader-frost-symmetry"
      label="Symmetry"
      value={String(Math.round(frostSymmetry))}
      min={4}
      max={8}
      step={1}
      current={frostSymmetry}
      minLabel="4-fold"
      maxLabel="8-fold"
      oninput={handleSliderInput('shader-frost-symmetry')}
    />

    <BrandSliderField
      id="shader-frost-melt"
      label="Melt Radius"
      value={frostMelt.toFixed(2)}
      min={0.50}
      max={2.00}
      step={0.10}
      current={frostMelt}
      minLabel="Small"
      maxLabel="Wide"
      oninput={handleSliderInput('shader-frost-melt')}
    />

    <BrandSliderField
      id="shader-frost-glow"
      label="Growth Glow"
      value={frostGlow.toFixed(2)}
      min={0.30}
      max={1.50}
      step={0.10}
      current={frostGlow}
      minLabel="Subtle"
      maxLabel="Bright"
      oninput={handleSliderInput('shader-frost-glow')}
    />
  </section>
```

## ShaderHero.svelte loadRenderer Update

```typescript
case 'frost': {
  const { createFrostRenderer } = await import('./renderers/frost-renderer');
  return createFrostRenderer();
}
```

## Brand Color Mapping

| Visual Element | Source | Description |
|---|---|---|
| Frozen crystal body | `colors.primary` | Opaque crystal structure |
| Aged crystal regions | `colors.secondary` | Subtle tint as crystals age (mix at 40% over time) |
| Growth front glow | `colors.accent` | Bright edge glow on newly frozen pixels |
| Background (unfrozen) | `colors.bg` | Liquid/empty regions |
| Diffusion field | `colors.primary` at 5% | Very subtle glow showing freezing potential |

## Post-Processing Pipeline

Same pipeline as all other presets:
1. **Reinhard tone mapping** — `color / (1.0 + color)`
2. **Brightness cap** — `min(color, 0.75)`
3. **Intensity blend** — `mix(tonemapped_bg, color, intensity)`
4. **Vignette** — `1.0 - dot(vc, vc) * vignette`
5. **Film grain** — hash-based per-pixel noise animated by time

## Gotchas

1. **BRAND_PREFIX_KEYS registration is CRITICAL** — all 5 `shader-frost-*` keys must be added to the Set in `css-injection.ts`. Missing keys cause sliders to silently do nothing (CSS vars get `--color-` prefix instead of `--brand-` prefix, so `readBrandVar()` never finds them).

2. **EXT_color_buffer_float check in init()** — required for RGBA16F FBO. Must check and return `false` if unavailable:
   ```typescript
   if (!gl.getExtension('EXT_color_buffer_float')) return false;
   gl.getExtension('OES_texture_float_linear');
   ```

3. **reset() must seed initial crystals** — unlike ink (which starts empty and waits for ambient drops), frost MUST have seed points on reset so growth begins immediately. Without seeds, the screen stays blank indefinitely.

4. **Two substeps per frame** — one with input (mouse melt + seed), one coast (no input). This produces smoother crystal evolution, matching the pattern from ink-renderer.

5. **Int uniform for symmetry** — `uSymmetry` is declared as `int` in GLSL. MUST use `gl.uniform1i(loc, Math.round(value))` in the renderer. Using `gl.uniform1f()` for an int uniform causes a WebGL error.

6. **Anisotropy direction computation** — the frozen neighbor direction vector must include a small epsilon (`vec2(0.001)`) before normalize to avoid NaN when no neighbors are found.

7. **Growth rate is intentionally SLOW** — the beauty of this effect is watching dendrites creep outward over seconds. The growth param at default 0.6 should produce about 1-3 pixels of new crystal per frame. If growth appears instant, the threshold is too low.

8. **Freeze age normalization** — age increments at 0.002 per frame (500 frames to reach 1.0 at 60fps = ~8.3 seconds). This gives the secondary color tint time to gradually appear.

9. **Ambient seed interval (5-10s)** — longer than ink's 2-3.5s because crystals persist (no evaporation). Too-frequent seeds would fill the screen too quickly.

10. **Mouse as heat source (NOT ink)** — this is the opposite of ink's mouse behavior. Ink deposits material; frost melts it. The mouse.active state drives melting, not deposition.

11. **No channel rotation** — unlike ink (3 independent channels), frost has a single binary state (frozen/liquid). There is no concept of rotating channels.

12. **ShaderPresetId type must be updated** — add `'frost'` to the union type before `'none'`. If forgotten, TypeScript rejects `preset: 'frost'` in config objects.

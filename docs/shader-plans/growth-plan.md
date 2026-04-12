# Growth (Differential Growth) Shader Preset — Implementation Plan

## Overview

Add a "growth" shader preset: a closed curve/border that grows, buckles, and undulates like the edge of a leaf, brain coral, or intestinal lining. The line gets longer but is constrained, folding into increasingly complex wrinkled shapes. Slow, organic, mesmerising. Uses a 2-pass ping-pong FBO (512x512) storing a signed distance field (SDF). Each frame: expand the zero-contour outward slightly, add curvature-dependent noise for buckling, then perform an SDF redistribution step to keep distances valid. Mouse acts as a growth accelerator near the cursor — the edge grows faster toward the pointer, creating localised folding. Click plants a new growth seed (a small circular SDF).

## Files

| # | File | Action |
|---|------|--------|
| 1 | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Modify — add `GrowthConfig`, union entry, `'growth'` to `ShaderPresetId`, defaults, switch case |
| 2 | `apps/web/src/lib/components/ui/ShaderHero/shaders/growth-sim.frag.ts` | Create — simulation fragment shader (SDF expansion + buckling + redistribution) |
| 3 | `apps/web/src/lib/components/ui/ShaderHero/shaders/growth-display.frag.ts` | Create — display fragment shader (edge coloring + interior gradient + glow) |
| 4 | `apps/web/src/lib/components/ui/ShaderHero/renderers/growth-renderer.ts` | Create — ShaderRenderer implementation (ping-pong FBO, seed logic, mouse acceleration) |
| 5 | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Modify — add `'growth'` case to `loadRenderer()` |
| 6 | `apps/web/src/lib/brand-editor/css-injection.ts` | Modify — add 5 keys to `BRAND_PREFIX_KEYS` |
| 7 | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | Modify — add preset card + sliders + defaults + `$derived` bindings |

## Config Interface

```typescript
export interface GrowthConfig extends ShaderConfigBase {
  preset: 'growth';
  speed: number;      // 0.1-0.5, default 0.2 — Expansion rate of the zero-contour
  noise: number;      // 0.3-1.5, default 0.8 — Buckling noise strength (curvature-dependent)
  scale: number;      // 1.0-4.0, default 2.0 — Noise scale controlling wrinkle frequency
  width: number;      // 0.5-2.0, default 1.0 — Visible edge line width (in UV units * 0.01)
  glow: number;       // 0.3-1.5, default 0.8 — Edge glow intensity
}
```

## Defaults (in DEFAULTS object)

```typescript
// Growth
growthSpeed: 0.2,
growthNoise: 0.8,
growthScale: 2.0,
growthWidth: 1.0,
growthGlow: 0.8,
```

## CSS Injection Keys (BRAND_PREFIX_KEYS)

All 5 keys must be registered in the `BRAND_PREFIX_KEYS` Set in `css-injection.ts`:

```
shader-growth-speed
shader-growth-noise
shader-growth-scale
shader-growth-width
shader-growth-glow
```

## ShaderPresetId Update

```typescript
// Before:
export type ShaderPresetId = 'suture' | 'ether' | 'warp' | 'ripple' | 'pulse' | 'ink' | 'topo' | 'nebula' | 'turing' | 'silk' | 'glass' | 'film' | 'flux' | 'lava' | 'none';

// After:
export type ShaderPresetId = 'suture' | 'ether' | 'warp' | 'ripple' | 'pulse' | 'ink' | 'topo' | 'nebula' | 'turing' | 'silk' | 'glass' | 'film' | 'flux' | 'lava' | 'growth' | 'none';
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
  | GrowthConfig  // <-- ADD
  | NoneConfig;
```

## getShaderConfig Switch Case

```typescript
case 'growth':
  return {
    ...base,
    preset: 'growth',
    speed: rv('shader-growth-speed', DEFAULTS.growthSpeed),
    noise: rv('shader-growth-noise', DEFAULTS.growthNoise),
    scale: rv('shader-growth-scale', DEFAULTS.growthScale),
    width: rv('shader-growth-width', DEFAULTS.growthWidth),
    glow: rv('shader-growth-glow', DEFAULTS.growthGlow),
  };
```

## Simulation Shader (growth-sim.frag.ts)

### Concept: SDF-Based Differential Growth

The simulation stores a signed distance field (SDF) in a ping-pong FBO. The zero-contour of the SDF represents the growing edge. Each frame:

1. **Expand** — Subtract a small value from the SDF everywhere, pushing the zero-contour outward.
2. **Buckle** — Add curvature-dependent noise that perturbs the SDF unevenly, causing the initially smooth contour to wrinkle and fold.
3. **Redistribute** — Apply an Eikonal-like redistribution step to keep |grad(SDF)| close to 1.0, preserving valid distance values. Without this, the SDF degrades into meaningless mush after a few hundred frames.
4. **Clamp** — Keep the SDF within a bounded range to prevent runaway values.

### Buffer Format

```
R = signed distance field (negative = inside, positive = outside, 0.0 = edge)
G = curvature estimate (Laplacian of SDF, used for display coloring)
B = growth age (time since this pixel was last crossed by the zero-contour)
A = 1.0 (unused, required for FBO)
```

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `uState` | `sampler2D` | Ping-pong simulation texture (RGB = SDF + curvature + age) |
| `uTexel` | `vec2` | 1.0 / simResolution (1/512) |
| `uSpeed` | `float` | Expansion rate — how fast the zero-contour expands outward (0.1-0.5) |
| `uNoise` | `float` | Buckling noise strength (0.3-1.5) |
| `uScale` | `float` | Noise scale for wrinkle frequency (1.0-4.0) |
| `uTime` | `float` | Elapsed time in seconds |
| `uMouse` | `vec2` | Mouse position (0-1) |
| `uMouseActive` | `float` | 1.0 if mouse over canvas |
| `uSeedPos` | `vec2` | New seed position (-10 if none) |
| `uSeedRadius` | `float` | Seed circle radius (0.08 default) |

### GLSL Pseudocode

```glsl
#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uSpeed;
uniform float uNoise;
uniform float uScale;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform vec2 uSeedPos;
uniform float uSeedRadius;

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

// ── FBM noise for multi-scale buckling ───────────────────────────
float fbm(vec2 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  for (int i = 0; i < 4; i++) {
    if (i >= octaves) break;
    value += amplitude * valueNoise(p * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec4 state = texture(uState, v_uv);
  float sdf = state.r;
  float curvature = state.g;
  float age = state.b;

  // ── 1. Sample neighbors for gradient and Laplacian ──────────────
  float sN = texture(uState, v_uv + vec2(0.0, uTexel.y)).r;
  float sS = texture(uState, v_uv - vec2(0.0, uTexel.y)).r;
  float sE = texture(uState, v_uv + vec2(uTexel.x, 0.0)).r;
  float sW = texture(uState, v_uv - vec2(uTexel.x, 0.0)).r;

  // Gradient (central differences)
  vec2 grad = vec2(sE - sW, sN - sS) / (2.0 * uTexel.x);
  float gradLen = length(grad) + 0.0001; // avoid division by zero

  // Laplacian (curvature of the SDF — high at folds)
  float laplacian = sN + sS + sE + sW - 4.0 * sdf;
  curvature = laplacian;

  // ── 2. Expansion — push zero-contour outward ───────────────────
  // Only expand near the zero-contour (within a narrow band)
  float band = smoothstep(0.06, 0.0, abs(sdf));
  float expansion = uSpeed * 0.001 * band;

  // Mouse acceleration: grow faster near cursor
  if (uMouseActive > 0.5) {
    float mouseDist = length(v_uv - uMouse);
    float mouseInfluence = smoothstep(0.15, 0.0, mouseDist);
    expansion += uSpeed * 0.003 * mouseInfluence * band;
  }

  sdf -= expansion;

  // ── 3. Curvature-dependent buckling noise ──────────────────────
  // Noise is strongest near the zero-contour and scales with curvature
  vec2 noiseCoord = v_uv * uScale * 15.0 + uTime * 0.03;
  float buckle = (fbm(noiseCoord, 3) - 0.5) * 2.0; // range [-1, 1]

  // Curvature factor: more folded regions buckle more (positive feedback)
  float curvFactor = 1.0 + abs(curvature) * 2.0;

  // Apply buckling only near the zero-contour
  sdf += buckle * uNoise * 0.0005 * band * curvFactor;

  // ── 4. SDF redistribution (Eikonal correction) ─────────────────
  // Push |grad(SDF)| toward 1.0 to maintain valid distances.
  // This is a single relaxation step of the redistancing equation:
  //   sdf_new = sdf - dt * sign(sdf) * (|grad(sdf)| - 1)
  float sign_sdf = sign(sdf);
  float redistance = sign_sdf * (gradLen - 1.0);
  sdf -= 0.3 * redistance * uTexel.x; // conservative step

  // ── 5. Age tracking — pixels near the zero-contour reset age ───
  if (abs(sdf) < 0.02) {
    age = 0.0; // recently crossed by the edge
  } else {
    age = min(age + 0.002, 1.0); // age slowly
  }

  // ── 6. New seed: plant a circular SDF ──────────────────────────
  if (uSeedPos.x > -5.0) {
    float seedDist = length(v_uv - uSeedPos) - uSeedRadius;
    // Merge seed with existing SDF via smooth min (union)
    // sdf = min(sdf, seedDist) but with smooth transition
    float h = clamp(0.5 + 0.5 * (seedDist - sdf) / 0.02, 0.0, 1.0);
    sdf = mix(seedDist, sdf, h) - 0.02 * h * (1.0 - h);
    if (abs(seedDist) < 0.01) age = 0.0;
  }

  // ── 7. Clamp SDF range ─────────────────────────────────────────
  sdf = clamp(sdf, -0.5, 0.5);

  // ── 8. Edge damping ────────────────────────────────────────────
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 8.0), v_uv) *
              smoothstep(vec2(0.0), vec2(uTexel * 8.0), 1.0 - v_uv);
  float edgeDamp = edge.x * edge.y;
  // Push SDF positive (outside) near canvas edges to prevent growth overflow
  sdf = mix(0.3, sdf, edgeDamp);

  fragColor = vec4(sdf, curvature, age, 1.0);
}
```

## Display Shader (growth-display.frag.ts)

### Uniforms

| Uniform | Type | Purpose |
|---------|------|---------|
| `uState` | `sampler2D` | Simulation texture (R=SDF, G=curvature, B=age) |
| `uColorPrimary` | `vec3` | Interior gradient start color (near edge) |
| `uColorSecondary` | `vec3` | Interior gradient end color (deep inside) |
| `uColorAccent` | `vec3` | Edge glow color (the growing contour itself) |
| `uBgColor` | `vec3` | Background (outside the contour) |
| `uIntensity` | `float` | Brightness multiplier |
| `uGrain` | `float` | Film grain strength |
| `uVignette` | `float` | Vignette strength |
| `uWidth` | `float` | Edge line width (0.5-2.0) |
| `uGlow` | `float` | Edge glow intensity |
| `uTime` | `float` | Elapsed time (for grain animation) |

### GLSL Pseudocode

```glsl
#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uWidth, uGlow, uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // ── 1. Read simulation state ────────────────────────────────────
  vec4 state = texture(uState, v_uv);
  float sdf = state.r;
  float curvature = state.g;
  float age = state.b;

  // ── 2. Base layer: interior gradient based on distance from edge ─
  vec3 color = uBgColor;

  if (sdf < 0.0) {
    // Inside the contour — gradient from primary (near edge) to secondary (deep)
    float depth = clamp(-sdf / 0.3, 0.0, 1.0); // normalize depth
    vec3 interior = mix(uColorPrimary, uColorSecondary, depth);

    // Folded regions (high curvature) create natural shadows
    float shadow = 1.0 - clamp(abs(curvature) * 0.8, 0.0, 0.4);
    interior *= shadow;

    color = interior * uIntensity;
  }

  // ── 3. Edge line — the growing contour ─────────────────────────
  float edgeWidth = uWidth * 0.01;
  float edgeFactor = smoothstep(edgeWidth, 0.0, abs(sdf));

  // Edge color: accent glow
  color = mix(color, uColorAccent * uIntensity, edgeFactor * 0.8);

  // ── 4. Edge glow — soft halo around the contour ────────────────
  float glowWidth = edgeWidth * 4.0;
  float glowFactor = smoothstep(glowWidth, 0.0, abs(sdf));
  color += uColorAccent * glowFactor * uGlow * 0.3 * uIntensity;

  // ── 5. Fresh growth glow — newly expanded areas glow brighter ──
  float freshness = 1.0 - smoothstep(0.0, 0.15, age);
  if (sdf < 0.0) {
    color += uColorAccent * freshness * 0.15 * uIntensity;
  }

  // ── 6. Reinhard tone mapping ────────────────────────────────────
  color = color / (1.0 + color);

  // ── 7. Brightness cap ───────────────────────────────────────────
  color = min(color, vec3(0.75));

  // ── 8. Intensity blend (mix with bg to control overall strength)
  color = mix(uBgColor / (1.0 + uBgColor), color, uIntensity);

  // ── 9. Vignette ─────────────────────────────────────────────────
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // ── 10. Film grain ──────────────────────────────────────────────
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
```

## Renderer (growth-renderer.ts)

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
void main() {
  // Initialise SDF as a circle at center: negative inside, positive outside
  // This provides the initial growth seed
  float dist = length(v_uv - vec2(0.5)) - 0.08;
  fragColor = vec4(dist, 0.0, 0.0, 1.0);
}
```

This is **critical** — `reset()` must initialise a circular SDF seed so growth begins immediately. Without it, the screen shows nothing (the SDF is uniformly positive = all outside = no edge visible).

### Seed Logic

**reset()** — initialises a circular SDF centered on screen:
- Uses the init fragment shader to write a signed distance field for a circle of radius 0.08
- R channel = `length(uv - 0.5) - 0.08` (negative inside, positive outside)
- G channel = 0.0 (no curvature yet)
- B channel = 0.0 (fresh age)
- Growth begins immediately as the expansion step pushes the zero-contour outward

**Ambient seeds** — every 8-15 seconds, spawn a new growth seed:
- Randomize position within inner 70% of canvas (avoid edges)
- Track `lastSeedTime` and `nextSeedInterval` (same pattern as ink ambient drops)
- Seeds are merged with the existing SDF via smooth-minimum union (preserves existing growth)

**Click seeds** — `mouse.burstStrength > 0` plants a new circular SDF seed at click position

### Mouse Interaction

- **Hover (active):** Growth accelerator. Edge grows faster toward the pointer, creating localised folding. The sim shader increases the expansion rate within a radius of the mouse, which causes preferential growth toward the cursor and increased buckling.
- **Click:** Plant a new growth seed (circular SDF) at the click position. The new circle merges with the existing contour via smooth-min, creating organic connections.

### Sim Uniform Names

```typescript
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uSpeed',
  'uNoise',
  'uScale',
  'uTime',
  'uMouse',
  'uMouseActive',
  'uSeedPos',
  'uSeedRadius',
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
  'uWidth',
  'uGlow',
  'uTime',
] as const;
```

### stepSim() Signature

```typescript
function stepSim(
  gl: WebGL2RenderingContext,
  time: number,
  mouseX: number,
  mouseY: number,
  mouseOn: boolean,
  seedX: number,
  seedY: number,
  seedRadius: number,
  cfg: GrowthConfig
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
  gl.uniform1f(simU.uSpeed, cfg.speed);
  gl.uniform1f(simU.uNoise, cfg.noise);
  gl.uniform1f(simU.uScale, cfg.scale);
  gl.uniform1f(simU.uTime, time);
  gl.uniform2f(simU.uMouse, mouseX, mouseY);
  gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
  gl.uniform2f(simU.uSeedPos, seedX, seedY);
  gl.uniform1f(simU.uSeedRadius, seedRadius);

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

  lastSeedTime = 0;
  nextSeedInterval = 8.0 + Math.random() * 7.0;

  // Write the initial circular SDF to both FBO sides
  gl.viewport(0, 0, SIM_RES, SIM_RES);
  gl.useProgram(initProg);
  quad.bind(initProg);

  gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
  drawQuad(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
  drawQuad(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
```

The init shader writes `vec4(length(uv - 0.5) - 0.08, 0.0, 0.0, 1.0)` — a signed distance field for a circle of radius 0.08 at center. This ensures the edge is immediately visible and growth begins from the first frame.

### render() Frame Logic

```typescript
render(gl, time, mouse, config, width, height): void {
  const cfg = config as GrowthConfig;

  // ── Ambient seed (every 8-15s) ──────────────────────────────
  let seedX = -10.0, seedY = -10.0;
  const seedRadius = 0.05 + Math.random() * 0.04; // 0.05-0.09
  if (time - lastSeedTime > nextSeedInterval) {
    lastSeedTime = time;
    nextSeedInterval = 8.0 + Math.random() * 7.0;
    seedX = 0.15 + Math.random() * 0.7;
    seedY = 0.15 + Math.random() * 0.7;
  }

  // ── Click seed ──────────────────────────────────────────────
  if (mouse.burstStrength > 0) {
    seedX = mouse.x;
    seedY = mouse.y;
  }

  // ── Substep 1: with input (mouse acceleration + seed) ──────
  stepSim(gl, time,
    mouse.active ? mouse.x : -10.0,
    mouse.active ? mouse.y : -10.0,
    mouse.active,
    seedX, seedY, seedRadius,
    cfg
  );

  // ── Substep 2: coast (no input, no seed) ────────────────────
  stepSim(gl, time, -10.0, -10.0, false, -10.0, -10.0, 0.08, cfg);

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
  gl.uniform1f(displayU.uWidth, cfg.width);
  gl.uniform1f(displayU.uGlow, cfg.glow);
  gl.uniform1f(displayU.uTime, time);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  drawQuad(gl);
}
```

## Brand Editor Sliders (BrandEditorHeroEffects.svelte)

### Preset Card

```typescript
{ id: 'growth', label: 'Differential Growth', description: 'Organic edge expansion' },
```

### DEFAULTS entries

```typescript
'shader-growth-speed': '0.20',
'shader-growth-noise': '0.80',
'shader-growth-scale': '2.00',
'shader-growth-width': '1.00',
'shader-growth-glow': '0.80',
```

### $derived bindings

```typescript
// Growth
const growthSpeed = $derived(readNum('shader-growth-speed'));
const growthNoise = $derived(readNum('shader-growth-noise'));
const growthScale = $derived(readNum('shader-growth-scale'));
const growthWidth = $derived(readNum('shader-growth-width'));
const growthGlow = $derived(readNum('shader-growth-glow'));
```

### Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel | value format |
|----|-------|-----|-----|------|---------|----------|----------|--------------|
| `shader-growth-speed` | Growth Speed | 0.10 | 0.50 | 0.05 | 0.20 | Slow | Fast | `.toFixed(2)` |
| `shader-growth-noise` | Buckling | 0.30 | 1.50 | 0.10 | 0.80 | Smooth | Wrinkled | `.toFixed(2)` |
| `shader-growth-scale` | Wrinkle Scale | 1.00 | 4.00 | 0.25 | 2.00 | Fine | Coarse | `.toFixed(2)` |
| `shader-growth-width` | Edge Width | 0.50 | 2.00 | 0.10 | 1.00 | Thin | Thick | `.toFixed(2)` |
| `shader-growth-glow` | Edge Glow | 0.30 | 1.50 | 0.10 | 0.80 | Subtle | Bright | `.toFixed(2)` |

### Svelte Template (per-preset section)

```svelte
{:else if activePreset === 'growth'}
  <section class="hero-fx__section">
    <span class="hero-fx__section-label">Differential Growth</span>

    <BrandSliderField
      id="shader-growth-speed"
      label="Growth Speed"
      value={growthSpeed.toFixed(2)}
      min={0.10}
      max={0.50}
      step={0.05}
      current={growthSpeed}
      minLabel="Slow"
      maxLabel="Fast"
      oninput={handleSliderInput('shader-growth-speed')}
    />

    <BrandSliderField
      id="shader-growth-noise"
      label="Buckling"
      value={growthNoise.toFixed(2)}
      min={0.30}
      max={1.50}
      step={0.10}
      current={growthNoise}
      minLabel="Smooth"
      maxLabel="Wrinkled"
      oninput={handleSliderInput('shader-growth-noise')}
    />

    <BrandSliderField
      id="shader-growth-scale"
      label="Wrinkle Scale"
      value={growthScale.toFixed(2)}
      min={1.00}
      max={4.00}
      step={0.25}
      current={growthScale}
      minLabel="Fine"
      maxLabel="Coarse"
      oninput={handleSliderInput('shader-growth-scale')}
    />

    <BrandSliderField
      id="shader-growth-width"
      label="Edge Width"
      value={growthWidth.toFixed(2)}
      min={0.50}
      max={2.00}
      step={0.10}
      current={growthWidth}
      minLabel="Thin"
      maxLabel="Thick"
      oninput={handleSliderInput('shader-growth-width')}
    />

    <BrandSliderField
      id="shader-growth-glow"
      label="Edge Glow"
      value={growthGlow.toFixed(2)}
      min={0.30}
      max={1.50}
      step={0.10}
      current={growthGlow}
      minLabel="Subtle"
      maxLabel="Bright"
      oninput={handleSliderInput('shader-growth-glow')}
    />
  </section>
```

## ShaderHero.svelte loadRenderer Update

```typescript
case 'growth': {
  const { createGrowthRenderer } = await import('./renderers/growth-renderer');
  return createGrowthRenderer();
}
```

## Brand Color Mapping

| Visual Element | Source | Description |
|---|---|---|
| Interior near edge | `colors.primary` | Gradient start — visible in shallow interior regions |
| Interior deep | `colors.secondary` | Gradient end — deep inside the grown form, natural shadow regions |
| Growing edge + glow | `colors.accent` | Bright contour line and its soft halo |
| Background (outside contour) | `colors.bg` | Everything beyond the zero-contour |
| Fold shadows | `colors.secondary` (darkened) | High-curvature regions darken via curvature modulation |
| Fresh growth areas | `colors.accent` at 15% | Faint bloom on recently expanded interior |

## Post-Processing Pipeline

Same pipeline as all other presets:
1. **Reinhard tone mapping** — `color / (1.0 + color)`
2. **Brightness cap** — `min(color, 0.75)`
3. **Intensity blend** — `mix(tonemapped_bg, color, intensity)`
4. **Vignette** — `1.0 - dot(vc, vc) * vignette`
5. **Film grain** — hash-based per-pixel noise animated by time

## Gotchas

1. **BRAND_PREFIX_KEYS registration is CRITICAL** — all 5 `shader-growth-*` keys must be added to the Set in `css-injection.ts`. Missing keys cause sliders to silently do nothing (CSS vars get `--color-` prefix instead of `--brand-` prefix, so `readBrandVar()` never finds them).

2. **EXT_color_buffer_float check in init()** — required for RGBA16F FBO. Must check and return `false` if unavailable:
   ```typescript
   if (!gl.getExtension('EXT_color_buffer_float')) return false;
   gl.getExtension('OES_texture_float_linear');
   ```

3. **reset() MUST initialise a circular SDF seed** — unlike presets that start blank, growth requires an initial zero-contour to expand from. The init shader computes `length(uv - 0.5) - 0.08` so there is a visible circle from frame one. Without this, the SDF is uniformly positive (all outside), there is no edge, and nothing ever grows.

4. **SDF redistribution is essential** — without the Eikonal correction step (`sdf -= dt * sign(sdf) * (|grad| - 1)`), the SDF degrades within ~100 frames. Distances become meaningless, the edge rendering breaks, and you get visual noise instead of a clean contour. The redistribution step in every frame maintains `|grad(SDF)| ≈ 1.0`.

5. **Two substeps per frame** — one with input (mouse acceleration + seed), one coast (no input). This produces smoother contour evolution, matching the pattern from ink-renderer.

6. **Growth rate is intentionally SLOW** — the beauty is in watching folds emerge over 10-30 seconds. At default speed 0.2, expansion is `0.2 * 0.001 = 0.0002` SDF units per step, meaning it takes hundreds of frames for visible growth. The wrinkles and folds are the visual interest, not the expansion itself.

7. **Smooth-min for seed merging** — when a new seed is planted (click or ambient), its SDF must merge with the existing field using smooth minimum (`smin`), not hard `min()`. Hard min creates sharp corners at the junction; smooth min creates organic connections that look natural.

8. **Ambient seed interval (8-15s)** — longer than ink's 2-3.5s because growth is additive (no evaporation). Each seed adds a new growing region that persists forever. Too-frequent seeds would fill the screen into a solid blob.

9. **Edge damping pushes SDF positive** — near canvas edges, the SDF is forced toward positive values (outside), preventing the contour from reaching the canvas border. This avoids rendering artifacts at edges.

10. **Curvature-dependent buckling creates positive feedback** — folded regions (high curvature) buckle more, creating more folds, creating even more curvature. This is the core of differential growth. The noise scale param controls the spatial frequency of initial perturbations; the noise strength controls how aggressively folds form.

11. **No channel rotation** — unlike ink (3 independent channels), growth has a single SDF state. There is no concept of rotating channels.

12. **ShaderPresetId type must be updated** — add `'growth'` to the union type before `'none'`. If forgotten, TypeScript rejects `preset: 'growth'` in config objects.

13. **FBM octave count** — the shader uses a fixed 3-octave FBM for buckling noise. This is hardcoded in the shader (not a uniform) because varying octave count at runtime causes visible pops. The `uScale` uniform controls the base frequency, which effectively controls wrinkle density.

14. **Init shader differs from ink** — ink's init shader writes all zeros (clear liquid). Growth's init shader MUST compute a signed distance function for a circle. This is the one case where the init shader has non-trivial logic.

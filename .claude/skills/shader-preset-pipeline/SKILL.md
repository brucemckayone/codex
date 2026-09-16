---
name: shader-preset-pipeline
description: >
  Implementation pipeline for WebGL2 shader presets in the ShaderHero system.
  Covers single-pass and FBO-based presets, GLSL ES 3.0 shaders, renderer
  setup, and brand editor configuration. Use when creating or modifying shader presets.
---

# Shader Preset Implementation Pipeline

Use this skill when implementing new shader presets for the ShaderHero system in the Codex web app. This document contains everything needed to go from zero context to a working preset.

---

## 1. Overview

The ShaderHero system renders animated WebGL2 shader backgrounds for organization hero sections. Each org can select a shader preset and configure it via the brand editor. The system reads configuration from CSS custom properties (`--brand-shader-*`) injected by the brand editor, and passes them as uniforms to GLSL ES 3.0 fragment shaders.

**Current presets (36 + none):** suture, ether, warp, ripple, pulse, ink, topo, nebula, turing, silk, glass, film, flux, lava, caustic, physarum, rain, frost, glow, life, mycelium, aurora, tendrils, pollen, growth, geode, lenia, ocean, bismuth, pearl, vortex, gyroid, waves, clouds, fracture, julia, vapor, tunnel.

**Two types of presets:**

| Type | Description | Files per preset | FBO? | Example |
|------|-------------|-----------------|------|---------|
| **Single-pass** | One fragment shader, fullscreen quad, no simulation state | 1 `.frag.ts` + 1 `-renderer.ts` | No | topo, caustic, silk, glass |
| **FBO-based** | Ping-pong simulation buffer (512x512) + display pass | 1 `-sim.frag.ts` + 1 `-display.frag.ts` + 1 `-renderer.ts` | Yes | ink, turing, ripple, lenia, life |

**File locations:**

| Content | Path |
|---------|------|
| Shader strings (GLSL) | `apps/web/src/lib/components/ui/ShaderHero/shaders/` |
| Renderer implementations | `apps/web/src/lib/components/ui/ShaderHero/renderers/` |
| Config types & parsing | `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` |
| Renderer interface | `apps/web/src/lib/components/ui/ShaderHero/renderer-types.ts` |
| WebGL helpers | `apps/web/src/lib/components/ui/ShaderHero/webgl-utils.ts` |
| Main component | `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` |
| CSS injection | `apps/web/src/lib/brand-editor/css-injection.ts` |
| Brand editor UI | `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` |
| Plan docs | `docs/shader-plans/` |

---

## 2. Complete File List Per Preset

### Files to CREATE

**Single-pass preset:**
- `apps/web/src/lib/components/ui/ShaderHero/shaders/{name}.frag.ts`
- `apps/web/src/lib/components/ui/ShaderHero/renderers/{name}-renderer.ts`

**FBO-based preset:**
- `apps/web/src/lib/components/ui/ShaderHero/shaders/{name}-sim.frag.ts`
- `apps/web/src/lib/components/ui/ShaderHero/shaders/{name}-display.frag.ts`
- `apps/web/src/lib/components/ui/ShaderHero/renderers/{name}-renderer.ts`

### Files to MODIFY (4 files, every preset)

1. **`shader-config.ts`** -- Add to ShaderPresetId union, add Config interface, add to ShaderConfig union, add DEFAULTS, add getShaderConfig switch case
2. **`css-injection.ts`** -- Add ALL new `shader-{name}-*` keys to BRAND_PREFIX_KEYS set
3. **`ShaderHero.svelte`** -- Add case to `loadRenderer()` switch
4. **`BrandEditorHeroEffects.svelte`** -- Add preset card to PRESETS array, add DEFAULTS entries, add `$derived` values, add slider section

---

## 3. Step-by-Step Implementation Pipeline

### Phase 1: Planning

1. Create a plan doc at `docs/shader-plans/{name}-plan.md` following the caustic-plan.md format.
2. Create a beads issue: `bd create --title="Implement {Name} shader preset" --type=feature --priority=2`
3. The plan MUST include:
   - Config interface with field types, ranges, and defaults
   - DEFAULTS object entries (camelCase, prefixed with preset name)
   - CSS keys for BRAND_PREFIX_KEYS (kebab-case: `shader-{name}-{param}`)
   - GLSL algorithm description with pseudocode
   - Slider definitions table (id, label, min, max, step, default, minLabel, maxLabel)
   - Brand color mapping (which visual element uses which color)
   - Gotchas specific to this preset

### Phase 2: Update shared files (4 files)

These 4 modifications can be done in parallel by separate agents since they touch different files.

**File 1: `shader-config.ts`**

Four changes required:

(a) Add to `ShaderPresetId` union:
```typescript
export type ShaderPresetId = '...' | '{name}' | 'none';
```

(b) Add config interface:
```typescript
export interface {Name}Config extends ShaderConfigBase {
  preset: '{name}';
  paramA: number;
  paramB: number;
  // ...
}
```

(c) Add to `ShaderConfig` union:
```typescript
export type ShaderConfig =
  | ...
  | {Name}Config
  | NoneConfig;
```

(d) Add DEFAULTS (camelCase, prefixed with preset name to avoid collisions):
```typescript
const DEFAULTS = {
  // ...existing...
  // {Name}
  {name}ParamA: 1.0,
  {name}ParamB: 0.5,
};
```

(e) Add switch case in `getShaderConfig()`:
```typescript
case '{name}':
  return {
    ...base,
    preset: '{name}',
    paramA: rv('shader-{name}-param-a', DEFAULTS.{name}ParamA),
    paramB: rv('shader-{name}-param-b', DEFAULTS.{name}ParamB),
    // For int params: Math.round(rv('shader-{name}-count', DEFAULTS.{name}Count)),
  };
```

**File 2: `css-injection.ts`**

Add ALL new shader keys to the `BRAND_PREFIX_KEYS` set:
```typescript
const BRAND_PREFIX_KEYS = new Set([
  // ...existing...
  // {Name}
  'shader-{name}-param-a',
  'shader-{name}-param-b',
]);
```

**File 3: `ShaderHero.svelte`**

Add case to `loadRenderer()` switch (inside the `<script>` block):
```typescript
case '{name}': {
  const { create{Name}Renderer } = await import('./renderers/{name}-renderer');
  return create{Name}Renderer();
}
```

**File 4: `BrandEditorHeroEffects.svelte`**

Four additions required:

(a) Add to PRESETS array:
```typescript
{ id: '{name}', label: '{Label}', description: '{Short description}' },
```

(b) Add to DEFAULTS record (string values, kebab-case keys):
```typescript
'shader-{name}-param-a': '1.00',
'shader-{name}-param-b': '0.50',
```

(c) Add `$derived` values:
```typescript
// {Name}
const {name}ParamA = $derived(readNum('shader-{name}-param-a'));
const {name}ParamB = $derived(readNum('shader-{name}-param-b'));
```

(d) Add slider section in the template (after the last `{:else if}` block, before the closing `{/if}`):
```svelte
{:else if activePreset === '{name}'}
  <section class="hero-fx__section">
    <span class="hero-fx__section-label">{Label}</span>

    <BrandSliderField
      id="shader-{name}-param-a"
      label="Param A"
      value={{name}ParamA.toFixed(2)}
      min={0.00}
      max={2.00}
      step={0.10}
      current={{name}ParamA}
      minLabel="Low"
      maxLabel="High"
      oninput={handleSliderInput('shader-{name}-param-a')}
    />

    <!-- For int params: value={String(Math.round({name}ParamB))} -->
  </section>
```

### Phase 3: Implement shader + renderer files

See template code in Section 5 below.

### Phase 4: Merge + verify

1. Copy from worktrees if applicable
2. Run typecheck: `npx tsc --noEmit --project apps/web/tsconfig.json` -- zero errors required
3. Run dev server: `pnpm dev` (from monorepo root, NEVER cd into individual workers)
4. Navigate to an org subdomain, open brand editor, select the new preset
5. Verify: preset renders, all sliders update the shader in real-time, mouse interaction works
6. Close beads issue: `bd close {issue-id}`

---

## 4. Critical Rules and Gotchas

### 1. BRAND_PREFIX_KEYS registration

EVERY `shader-*` CSS key MUST be registered in the `BRAND_PREFIX_KEYS` set in `css-injection.ts`. Without this, the injection system writes `--color-shader-{name}-*` instead of `--brand-shader-{name}-*`, and `getShaderConfig()` reads from `--brand-*`, so sliders silently do nothing. This is the #1 most common bug.

The injection logic in `css-injection.ts`:
```typescript
const prop = BRAND_PREFIX_KEYS.has(key)
  ? `--brand-${key}`
  : `--color-${key}`;
```

And `shader-config.ts` reads:
```typescript
function readBrandVar(el: Element, key: string): string | null {
  const val = getComputedStyle(el).getPropertyValue(`--brand-${key}`).trim();
  return val || null;
}
```

### 2. Uniform naming conventions

- **Single-pass shaders:** Use `u_camelCase` (e.g., `u_brandPrimary`, `u_lineCount`, `u_speed`)
- **FBO sim shaders:** Use `uCamelCase` without underscore (e.g., `uState`, `uTexel`, `uDiffusion`)
- **FBO display shaders:** Use `uCamelCase` (e.g., `uState`, `uColorPrimary`, `uBgColor`)

### 3. Integer uniforms

Integer uniforms require special handling at three levels:
- **shader-config.ts:** Wrap with `Math.round()` in the switch case
- **Renderer:** Use `gl.uniform1i()` (NOT `gl.uniform1f()`)
- **GLSL:** Declare as `uniform int u_param;`
- **For-loops:** Need constant upper bound with early exit: `for (int i = 0; i < 5; i++) { if (i >= u_param) break; ... }`

### 4. Post-processing chain

EVERY shader (single-pass display or FBO display) MUST end with this exact post-processing chain:

```glsl
// Reinhard tonemapping
color = color / (1.0 + color);

// Brightness cap (75%)
color = min(color, vec3(0.75));

// Intensity blend with background
color = mix(u_bgColor, color, u_intensity);

// Vignette
vec2 vc = v_uv * 2.0 - 1.0;
color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

// Film grain
color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

// Final clamp
fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
```

### 5. GLSL ES 3.0 requirements

All shaders MUST use:
```glsl
#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
```

### 6. Export patterns

**Shader strings:**
```typescript
export const {NAME}_FRAG = `#version 300 es
precision highp float;
...
`;
```

**Renderer:**
```typescript
export function create{Name}Renderer(): ShaderRenderer { ... }
```

### 7. FBO renderer requirements

FBO-based renderers MUST:
- Check `gl.getExtension('EXT_color_buffer_float')` in `init()` and return false if missing
- Also get `gl.getExtension('OES_texture_float_linear')` for linear filtering
- Use `createDoubleFBO(gl, SIM_RES, SIM_RES)` where `SIM_RES = 512`
- Run two substeps per frame (one with input, one coasting)
- Seed initial state in `reset()` by rendering the init shader into both FBO sides
- Have a separate init program (simple clear shader)

### 8. No stubs

Renderers MUST be real, complete implementations -- not no-op stubs that render nothing. This was a recurring bug in batch shader creation. Every renderer must produce visible output.

### 9. Brand colors as uniforms

Available as vec3 uniforms (normalized RGB, 0.0-1.0):
- `u_brandPrimary` / `uColorPrimary` -- org's primary brand color
- `u_brandSecondary` / `uColorSecondary` -- org's secondary color
- `u_brandAccent` / `uColorAccent` -- org's accent color
- `u_bgColor` / `uBgColor` -- org's background color

Every preset MUST use these meaningfully to ensure the shader reflects the org's brand.

### 10. Mouse state

The `MouseState` interface:
```typescript
interface MouseState {
  x: number;      // 0-1 left to right
  y: number;      // 0-1 bottom to top
  active: boolean; // mouse is over canvas
  burstStrength: number; // 0-1, decays at 0.85/frame
}
```

The ShaderHero component handles lerped mouse smoothing internally. Mouse x/y are updated on `mousemove` and `touchmove` events. `burstStrength` is set to 1.0 on click/touchstart and decays each frame.

### 11. Design tokens in brand editor

All CSS in `BrandEditorHeroEffects.svelte` MUST use design tokens. Never hardcode px, hex colors, or raw values:
- Spacing: `--space-1` through `--space-24`
- Colors: `--color-text`, `--color-surface`, `--color-border`, etc.
- Borders: `--border-width`, `--border-style`, `--radius-md`
- Typography: `--text-sm`, `--text-xs`, `--font-medium`
- Transitions: `--transition-colors`, `--duration-normal`, `--ease-default`

### 12. Noise conventions

**Sin-based noise (smooth, suitable for heightfields):**
```glsl
float noise(vec2 p) {
  return sin(p.x) * sin(p.y);
}
```

**FBM with inter-octave rotation:**
```glsl
const mat2 octaveRot = mat2(0.8, 0.6, -0.6, 0.8);
// Each octave: p = octaveRot * p * 2.02; amp *= 0.5;
```

**Hash-based noise (grain, randomness):**
```glsl
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
```

### 13. Shared vertex shader

Import from `webgl-utils.ts` -- never write your own:
```typescript
import { VERTEX_SHADER } from '../webgl-utils';
```

It outputs `v_uv` in [0,1] range:
```glsl
#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() { v_uv = a_position * 0.5 + 0.5; gl_Position = vec4(a_position, 0, 1); }
```

---

## 5. Template Code Snippets

### Single-Pass Renderer Template (based on topo-renderer)

```typescript
/**
 * {Name} renderer -- {brief description}.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Mouse interaction: {describe mouse behavior}.
 * Configurable: {list params}.
 * Brand colors: {describe color mapping}.
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, {Name}Config } from '../shader-config';
import { {NAME}_FRAG } from '../shaders/{name}.frag';
import {
  createProgram,
  createQuad,
  drawQuad,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

const UNIFORM_NAMES = [
  'u_time',
  'u_resolution',
  'u_mouse',
  'u_mouseActive',
  'u_burst',
  'u_brandPrimary',
  'u_brandSecondary',
  'u_brandAccent',
  'u_bgColor',
  // Preset-specific:
  'u_paramA',
  'u_paramB',
  // Shared post-process:
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type {Name}Uniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  paramA: 1.0,
  paramB: 0.5,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function create{Name}Renderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<{Name}Uniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, {NAME}_FRAG);
      if (!program) return false;

      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);

      return true;
    },

    render(
      gl: WebGL2RenderingContext,
      time: number,
      mouse: MouseState,
      config: ShaderConfig,
      width: number,
      height: number
    ): void {
      if (!program || !uniforms || !quad) return;

      const cfg = config as {Name}Config;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      // Time & resolution
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);

      // Mouse state
      const mx = mouse.active ? mouse.x : 0.5;
      const my = mouse.active ? mouse.y : 0.5;
      gl.uniform2f(uniforms.u_mouse, mx, my);
      gl.uniform1f(uniforms.u_mouseActive, mouse.active ? 1.0 : 0.0);
      gl.uniform1f(uniforms.u_burst, mouse.burstStrength ?? 0.0);

      // Brand colors
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // Preset-specific config (float params)
      gl.uniform1f(uniforms.u_paramA, cfg.paramA ?? DEFAULTS.paramA);
      gl.uniform1f(uniforms.u_paramB, cfg.paramB ?? DEFAULTS.paramB);
      // For int params: gl.uniform1i(uniforms.u_paramInt, Math.round(cfg.paramInt ?? DEFAULTS.paramInt));

      // Shared post-process uniforms
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(uniforms.u_vignette, cfg.vignette ?? DEFAULTS.vignette);

      // Draw to screen (no FBO)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // Single-pass preset: no FBOs to resize. Viewport set in render().
    },

    reset(_gl: WebGL2RenderingContext): void {
      // No simulation state to reset for single-pass presets.
    },

    destroy(gl: WebGL2RenderingContext): void {
      if (program) {
        gl.deleteProgram(program);
        program = null;
      }
      if (quad) {
        gl.deleteBuffer(quad.buffer);
        quad = null;
      }
      uniforms = null;
    },
  };
}
```

### Single-Pass Fragment Shader Skeleton

```typescript
/**
 * {Name} fragment shader -- {brief description}.
 *
 * Technique: {describe the algorithm}.
 * Single-pass fragment shader. No FBOs needed.
 * Mouse: {describe mouse interaction}.
 * Brand colors: {describe color mapping}.
 */
export const {NAME}_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_mouseActive;
uniform float u_burst;
uniform vec3 u_brandPrimary;
uniform vec3 u_brandSecondary;
uniform vec3 u_brandAccent;
uniform vec3 u_bgColor;
// Preset-specific:
uniform float u_paramA;
uniform float u_paramB;
// uniform int u_paramInt;  // for integer params
// Shared post-process:
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;

// -- Hash for film grain --
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  float t = u_time * 0.1; // scaled time
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);

  // ── Mouse interaction ────────────────────────────────
  vec2 mouseUV = vec2(u_mouse.x * aspect, u_mouse.y);
  vec2 fragUV = vec2(uv.x * aspect, uv.y);
  float mouseDist = distance(fragUV, mouseUV);

  // Hover effect
  // ...

  // Click burst effect
  // ...

  // ── Core algorithm ───────────────────────────────────
  vec3 color = vec3(0.0);
  // ... your shader logic here ...

  // ── Post-processing (MANDATORY) ──────────────────────

  // Reinhard tone map
  color = color / (1.0 + color);

  // Brightness cap at 75%
  color = min(color, vec3(0.75));

  // Mix with background by intensity
  color = mix(u_bgColor, color, u_intensity);

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * u_vignette, 0.0, 1.0);

  // Film grain
  color += (hash(gl_FragCoord.xy + fract(u_time * 7.13)) - 0.5) * u_grain;

  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
```

### FBO Renderer Template (based on ink-renderer)

```typescript
/**
 * {Name} renderer -- {brief description}.
 *
 * Ping-pong FBO simulation at 512x512 + display pass.
 * Buffer format: {describe what RGBA channels store}.
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { {Name}Config, ShaderConfig } from '../shader-config';
import { {NAME}_DISPLAY_FRAG } from '../shaders/{name}-display.frag';
import { {NAME}_SIM_FRAG } from '../shaders/{name}-sim.frag';
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

/** Init fragment shader -- seeds the initial state. */
const {NAME}_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  // Seed initial state here (e.g., random noise, or zeros for clear)
  fragColor = vec4(0.0);
}
`;

const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uTime',
  'uMouse',
  'uMouseActive',
  'uBurst',
  // Preset-specific sim params:
  'uParamA',
  'uParamB',
] as const;

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

export function create{Name}Renderer(): ShaderRenderer {
  let initProg: WebGLProgram | null = null;
  let simProg: WebGLProgram | null = null;
  let displayProg: WebGLProgram | null = null;

  let simU: Record<(typeof SIM_UNIFORM_NAMES)[number], WebGLUniformLocation | null> | null = null;
  let displayU: Record<(typeof DISPLAY_UNIFORM_NAMES)[number], WebGLUniformLocation | null> | null = null;

  let quad: ReturnType<typeof createQuad> | null = null;
  let simBuf: DoubleFBO | null = null;

  // ── Sim step helper ────────────────────────────────
  function stepSim(
    gl: WebGL2RenderingContext,
    time: number,
    mouseX: number,
    mouseY: number,
    mouseOn: boolean,
    burst: number,
    cfg: {Name}Config
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
    gl.uniform1f(simU.uTime, time);
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uBurst, burst);

    // Preset-specific uniforms
    gl.uniform1f(simU.uParamA, cfg.paramA);
    gl.uniform1f(simU.uParamB, cfg.paramB);

    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
    drawQuad(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    simBuf.swap();
  }

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      // Check required extensions
      if (!gl.getExtension('EXT_color_buffer_float')) return false;
      gl.getExtension('OES_texture_float_linear');

      // Compile programs
      initProg = createProgram(gl, VERTEX_SHADER, {NAME}_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, {NAME}_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, {NAME}_DISPLAY_FRAG);

      if (!initProg || !simProg || !displayProg) return false;

      // Get uniform locations
      simU = getUniforms(gl, simProg, SIM_UNIFORM_NAMES);
      displayU = getUniforms(gl, displayProg, DISPLAY_UNIFORM_NAMES);

      // Create geometry and FBOs
      quad = createQuad(gl);
      simBuf = createDoubleFBO(gl, SIM_RES, SIM_RES);

      // Initialize simulation state
      this.reset(gl);

      return true;
    },

    render(
      gl: WebGL2RenderingContext,
      time: number,
      mouse: MouseState,
      config: ShaderConfig,
      width: number,
      height: number
    ): void {
      if (!simProg || !displayProg || !simU || !displayU || !simBuf || !quad) return;

      const cfg = config as {Name}Config;

      // ── Substep 1: with mouse input ───────────────
      stepSim(
        gl, time,
        mouse.active ? mouse.x : -10.0,
        mouse.active ? mouse.y : -10.0,
        mouse.active,
        mouse.burstStrength ?? 0.0,
        cfg
      );

      // ── Substep 2: coast (no input) ───────────────
      stepSim(gl, time, -10.0, -10.0, false, 0.0, cfg);

      // ── Display pass ──────────────────────────────
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
      gl.uniform1f(displayU.uTime, time);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // FBO sim resolution is fixed at 512x512.
      // Display pass viewport is set each frame in render().
    },

    reset(gl: WebGL2RenderingContext): void {
      if (!initProg || !simBuf || !quad) return;

      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);

      // Seed BOTH FBO sides
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    destroy(gl: WebGL2RenderingContext): void {
      if (simBuf) {
        destroyDoubleFBO(gl, simBuf);
        simBuf = null;
      }
      if (initProg) { gl.deleteProgram(initProg); initProg = null; }
      if (simProg) { gl.deleteProgram(simProg); simProg = null; }
      if (displayProg) { gl.deleteProgram(displayProg); displayProg = null; }
      if (quad) { gl.deleteBuffer(quad.buffer); quad = null; }
      simU = null;
      displayU = null;
    },
  };
}
```

### FBO Simulation Fragment Shader Skeleton

```typescript
/**
 * {Name} simulation fragment shader (GLSL ES 3.0).
 *
 * Ping-pong at 512x512.
 * Buffer format: {describe RGBA channels}.
 */
export const {NAME}_SIM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uBurst;
uniform float uParamA;
uniform float uParamB;

void main() {
  // 1. Sample center + 4 neighbors
  vec4 center = texture(uState, v_uv);
  vec4 north = texture(uState, v_uv + vec2(0.0, uTexel.y));
  vec4 south = texture(uState, v_uv - vec2(0.0, uTexel.y));
  vec4 east = texture(uState, v_uv + vec2(uTexel.x, 0.0));
  vec4 west = texture(uState, v_uv - vec2(uTexel.x, 0.0));

  // 2. Simulation logic here...
  vec4 result = center;

  // 3. Mouse interaction
  if (uMouseActive > 0.5) {
    float d = distance(v_uv, uMouse);
    // ... add mouse effect ...
  }

  // 4. Click burst
  if (uBurst > 0.01) {
    float d = distance(v_uv, uMouse);
    // ... add burst effect ...
  }

  // 5. Edge damping (optional)
  vec2 edge = smoothstep(vec2(0.0), vec2(uTexel * 4.0), v_uv) *
              smoothstep(vec2(0.0), vec2(uTexel * 4.0), 1.0 - v_uv);
  result *= edge.x * edge.y;

  fragColor = clamp(result, vec4(0.0), vec4(2.0));
}
`;
```

### FBO Display Fragment Shader Skeleton

```typescript
/**
 * {Name} display fragment shader (GLSL ES 3.0).
 *
 * Maps simulation buffer to brand colors with post-processing.
 */
export const {NAME}_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec3 uColorPrimary, uColorSecondary, uColorAccent, uBgColor;
uniform float uIntensity, uGrain, uVignette, uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // 1. Read simulation state
  vec4 state = texture(uState, v_uv);

  // 2. Map state to color using brand palette
  vec3 color = uBgColor;
  // ... map state channels to brand colors ...

  // 3. Post-processing (MANDATORY)

  // Reinhard tone map
  color = color / (1.0 + color);

  // Brightness cap
  color = min(color, vec3(0.75));

  // Intensity blend -- NOTE: for FBO display, the mix is already done
  // via the color mapping above, but include if needed for consistency

  // Vignette
  vec2 vc = v_uv * 2.0 - 1.0;
  color *= clamp(1.0 - dot(vc, vc) * uVignette, 0.0, 1.0);

  // Film grain
  color += (hash(v_uv * 512.0 + fract(uTime * 7.13)) - 0.5) * uGrain;

  // Final clamp
  fragColor = vec4(clamp(color, 0.0, 0.75), 1.0);
}
`;
```

### Config Interface Template

```typescript
export interface {Name}Config extends ShaderConfigBase {
  preset: '{name}';
  paramA: number;   // range: 0.0-2.0, default 1.0 -- Description
  paramB: number;   // range: 0.0-1.0, default 0.5 -- Description
  // paramInt: number; // range: 2-8, default 4 (int) -- Description
}
```

### getShaderConfig Switch Case Template

```typescript
case '{name}':
  return {
    ...base,
    preset: '{name}',
    paramA: rv('shader-{name}-param-a', DEFAULTS.{name}ParamA),
    paramB: rv('shader-{name}-param-b', DEFAULTS.{name}ParamB),
    // For int params:
    // paramInt: Math.round(rv('shader-{name}-param-int', DEFAULTS.{name}ParamInt)),
  };
```

### BrandEditorHeroEffects Slider Section Template

```svelte
{:else if activePreset === '{name}'}
  <section class="hero-fx__section">
    <span class="hero-fx__section-label">{Display Label}</span>

    <BrandSliderField
      id="shader-{name}-param-a"
      label="Param A Label"
      value={{name}ParamA.toFixed(2)}
      min={0.00}
      max={2.00}
      step={0.10}
      current={{name}ParamA}
      minLabel="Low"
      maxLabel="High"
      oninput={handleSliderInput('shader-{name}-param-a')}
    />

    <BrandSliderField
      id="shader-{name}-param-b"
      label="Param B Label"
      value={{name}ParamB.toFixed(2)}
      min={0.00}
      max={1.00}
      step={0.05}
      current={{name}ParamB}
      minLabel="Subtle"
      maxLabel="Strong"
      oninput={handleSliderInput('shader-{name}-param-b')}
    />

    <!-- For int params: value={String(Math.round({name}ParamInt))} -->
  </section>
```

### BRAND_PREFIX_KEYS Entry Template

```typescript
// {Name}
'shader-{name}-param-a',
'shader-{name}-param-b',
```

---

## 6. Agent Orchestration Pattern

### Phase 1: Shared file modifications (3 parallel agents)

Since the 4 modified files are independent, split across agents:

- **Agent A:** `shader-config.ts` (types, defaults, switch case)
- **Agent B:** `css-injection.ts` (BRAND_PREFIX_KEYS) + `ShaderHero.svelte` (loadRenderer case) -- these are small changes in different files, one agent handles both
- **Agent C:** `BrandEditorHeroEffects.svelte` (PRESETS, DEFAULTS, $derived, sliders)

### Phase 2: Shader + renderer implementation (isolated worktree agents)

For batch implementation of multiple presets:
- Create worktrees: one per agent batch (2-5 shaders per agent)
- Each agent gets a list of preset names and their plan docs
- Agents work in isolation on `shaders/` and `renderers/` directories only (new files, no conflicts)

### Phase 3: Merge + typecheck

1. Copy new shader/renderer files from worktrees to main tree
2. Ensure all Phase 1 shared-file modifications are in place
3. Run `npx tsc --noEmit --project apps/web/tsconfig.json` -- must be zero errors
4. Run `pnpm dev` and visually verify each new preset
5. Close beads issues

---

## 7. Common Failure Modes and Fixes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Sliders don't update shader | `BRAND_PREFIX_KEYS` missing entries in `css-injection.ts` | Add all `shader-{name}-*` keys to the Set |
| Shader doesn't render (black/no output) | Renderer is a stub with no-op methods | Write real GLSL and WebGL code -- no stubs allowed |
| Shader compiles but nothing visible | Fragment shader outputs `vec4(0.0)` or near-zero values | Check that the algorithm produces values in visible range before post-processing |
| Pixelated FBO output | FBO texture displayed at sim resolution without interpolation | Ensure FBO textures use `gl.LINEAR` filtering (default in `createFBO`), and add 3x3 smoothing kernel in display shader if needed |
| FBO simulation doesn't start / stays black | `reset()` not seeding initial state | Seed both FBO sides in `reset()` using the init program |
| Gray-Scott / Turing patterns wrong | Laplacian needs specific scaling factor | Use `0.21` scaling for Gray-Scott Laplacian: `laplacian = (n+s+e+w + 0.05*(ne+nw+se+sw) - (4.0+0.2)*center) * 0.21` |
| Everything looks uniform/flat | Density threshold too wide | Use narrow band for pattern visibility (e.g., `smoothstep(0.2, 0.25, value)`) |
| Sliders exist but default values differ | DEFAULTS mismatch between shader-config.ts and BrandEditorHeroEffects.svelte | Ensure both files use the same numeric values (one in camelCase, one as string in kebab-case) |
| TypeScript error: type not in union | Config interface not added to `ShaderConfig` union type | Add `\| {Name}Config` to the union in shader-config.ts |
| TypeScript error: property missing | Switch case doesn't return all fields from the config interface | Ensure every field in the interface has a corresponding `rv()` call in the switch case |
| `uniform1f` used for int uniform | Renderer uses wrong GL call | Use `gl.uniform1i()` for `uniform int` declarations, `gl.uniform1f()` for `uniform float` |
| For-loop doesn't execute all iterations | GLSL ES 3.0 requires constant loop bounds | Use pattern: `for (int i = 0; i < MAX; i++) { if (i >= u_count) break; ... }` |
| Mouse interaction feels wrong | Aspect ratio not corrected for mouse coordinates | Apply same aspect correction to both mouse UV and fragment UV before distance calculation |
| Brand editor changes don't take effect | Config polling cadence too slow for testing | Config is polled every 30 frames (~0.5s). Changes will appear within half a second. |
| Preset not appearing in dropdown | Not added to PRESETS array in BrandEditorHeroEffects.svelte | Add `{ id: '{name}', label: '{Label}', description: '{desc}' }` to the array |
| loadRenderer returns null | Missing case in ShaderHero.svelte switch | Add the dynamic import case for the new preset |

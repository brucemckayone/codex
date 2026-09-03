# 02 — Shader System Architecture

**Purpose**: Complete technical specification for the WebGL rendering system — from context creation to frame teardown.

---

## 1. Library Decision: Raw WebGL

**Choice**: No library. Raw WebGL 1 (GLSL ES 1.0).

**Rationale**:

| Library | Bundle Size | What We Need | What We'd Use |
|---------|------------|-------------|---------------|
| Three.js | ~150KB min | ShaderMaterial, WebGLRenderer | ~5% of API surface |
| OGL | ~24KB min | Mesh, Program, Renderer | ~10% of API surface |
| regl | ~73KB min | draw commands, uniforms | ~15% of API surface |
| TWGL | ~12KB min | program creation, uniforms | ~30% of API surface |
| **Raw WebGL** | **0KB** | fullscreen quad + shader | **100%** |

A shader hero is exactly **one fullscreen quad** (2 triangles) with **one fragment shader**. The WebGL boilerplate for this is ~80 lines:
- Create context (2 lines)
- Compile vertex + fragment shader (15 lines)
- Link program (5 lines)
- Create quad geometry (10 lines)
- Resolve uniform locations (5 lines)
- Render loop (15 lines)
- Resize handler (10 lines)
- Cleanup (8 lines)

Adding a library adds bundle size, API surface to learn, version maintenance, and an abstraction layer between us and the GL calls — all for saving ~80 lines that we write once and never touch again.

**When to reconsider**: If we add 3D elements, particle systems with geometry instancing, or multiple render targets — then OGL or Three.js becomes worthwhile.

---

## 2. File Structure

```
apps/web/src/lib/components/ui/ShaderHero/
├── ShaderHero.svelte            # Svelte component (canvas + overlay)
├── index.ts                     # Barrel export
├── shader-renderer.ts           # WebGL context, compile, render loop
├── shader-presets.ts            # Preset registry (ID → shader source)
├── shader-config.ts             # Config parsing from tokenOverrides
├── shader-utils.ts              # Color conversion, feature detection
└── shaders/
    ├── fullscreen-quad.vert     # Shared vertex shader
    ├── common.glsl              # Shared GLSL functions (noise, hash, etc.)
    ├── gradient-mesh.frag       # Preset 1: Stripe-style color blobs
    ├── noise-flow.frag          # Preset 2: Linear-style flowing field
    ├── aurora.frag              # Preset 3: Northern lights
    ├── voronoi.frag             # Preset 4: Organic cells
    ├── metaballs.frag           # Preset 5: Lava lamp blobs
    ├── waves.frag               # Preset 6: Water caustics
    ├── particles.frag           # Preset 7: Starfield / dust
    └── geometric.frag           # Preset 8: Kaleidoscopic geometry
```

---

## 3. Uniform Contract

Every preset receives the same set of uniforms. This standardized interface means `ShaderHero` and `shader-renderer.ts` are preset-agnostic — they set the same uniforms regardless of which shader is active.

```glsl
// ─── Resolution & Time ────────────────────────────────
uniform vec2 u_resolution;         // Canvas pixel dimensions
uniform float u_time;              // Seconds since start (affected by speed)
uniform float u_delta;             // Delta time (seconds since last frame)

// ─── Configuration ────────────────────────────────────
uniform float u_speed;             // Animation speed multiplier (0.1 - 2.0)
uniform float u_intensity;         // Effect strength (0.0 = invisible, 1.0 = full)
uniform float u_complexity;        // Detail level / octave count (0.0 - 1.0)

// ─── Interaction ──────────────────────────────────────
uniform vec2 u_mouse;              // Normalized cursor position (0-1, lerped)
uniform float u_mouse_influence;   // Mouse effect radius (0.0 = disabled)
uniform float u_scroll;            // Scroll progress (0 = hero visible, 1 = off-screen)

// ─── Brand Colors ─────────────────────────────────────
uniform vec3 u_color_primary;      // RGB 0-1, from --color-brand-primary
uniform vec3 u_color_secondary;    // RGB 0-1, from --color-brand-secondary
uniform vec3 u_color_accent;       // RGB 0-1, from --color-brand-accent
uniform vec3 u_color_bg;           // RGB 0-1, from --color-background
```

### Vertex Shader (Shared)

```glsl
// fullscreen-quad.vert
attribute vec2 a_position;  // -1 to 1
varying vec2 v_uv;          // 0 to 1

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
```

### Color Uniform Extraction

Colors are extracted from hex strings (from CSS or org data) and converted to `vec3` (RGB 0-1):

```typescript
// shader-utils.ts
export function hexToVec3(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}
```

### Color Blending: OKLAB, Not sRGB

**Critical finding from Loop 2**: sRGB `mix()` produces muddy, desaturated mid-tones when blending between light and dark colors (e.g., `#22D3EE` cyan on `#09090B` background). This is because sRGB is not perceptually uniform.

**Solution**: `common.glsl` includes OKLAB conversion functions (`oklabMix`, `oklabPalette`) that perform color blending in OKLAB space — a perceptually uniform color space designed by Björn Ottosson (2020). Linear interpolation in OKLAB produces clean transitions without hue shifts.

Presets should use `oklabPalette()` instead of `brandPalette()` when brand palettes include dark colors. The cost is ~10 extra ALU ops per pixel per blend (matrix multiplies + pow), which is negligible for our workloads.

### Dark Mode Handling

**No shader-side dark-mode logic needed.** The CSS cascade (`org-brand.css`) resolves brand colors into their final values before they reach the shader as uniforms. When dark mode toggles or brand colors change, the shader automatically receives updated inputs. This is the same pattern Stripe uses — theme-awareness lives in CSS variable resolution, not in GLSL.

### Stripe minigl Pattern (Validated)

Our renderer design was independently validated against Stripe's minigl (521 lines, ~10KB). Key parallels:

| Stripe minigl | Our shader-renderer.ts |
|--------------|----------------------|
| `MiniGl` context wrapper | `createShaderRenderer()` factory |
| `Material` (compile + uniforms) | `linkProgram()` + `cacheUniformLocations()` |
| `Uniform` (typed value wrapper) | Typed `UniformLocations` interface |
| `PlaneGeometry` (subdivided quad) | `QUAD_VERTICES` (simple 4-vertex strip) |
| `Mesh.draw()` | Render loop `gl.drawArrays()` |
| `Gradient` (rAF controller + color uniforms) | Renderer's `start()`/`stop()` + `updateColors()` |
| `ScrollObserver` (IntersectionObserver) | `IntersectionObserver` with same threshold pattern |

Source: Kevin Hufnagl's reverse engineering (2021), preserved gist by jordienr.

### Mediump Precision Strategy

**Problem**: The standard Ashima `snoise3` uses `mod(289)` whose intermediates reach ~2.8 million — far beyond mediump's max of 16,384. On mediump-only devices (some Android, pre-A12 iPhones), this produces grid banding, flat plateaus, and NaN pixels.

**Solution**: Dual code path selected at compile time:

```glsl
#ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  // Use snoise3 (full 3D noise with mod(289))
#else
  precision mediump float;
  // Use animatedNoise2D (2D noise with sin/cos UV offset for time-based motion)
  // Or psrdnoise2 with alpha flow parameter (Gustavson's designed solution)
#endif
```

The `animatedNoise2D` function in `common.glsl` offsets UV coordinates with `sin(time)` / `cos(time)` to simulate temporal evolution without 3D precision requirements. For even higher quality, Gustavson's `psrdnoise2` with its `alpha` flow parameter rotates simplex gradients in-place — designed specifically as a 3D noise alternative for animation.

**Device scope** (2026): ~2-3% of mobile devices are mediump-only. WebGL 2 mandates highp, so this shrinks yearly. The dual path is low-cost insurance.

### GLSL Blend Modes

**Finding from Loop 3 research**: Stripe's minigl composites noise layers using Photoshop-style blend modes (Screen, Multiply, Overlay) rather than linear `mix()`. This creates richer visual depth:

- **Screen**: Overlapping bright areas glow (additive without overflow). Best for `gradient-mesh`, `aurora`.
- **Overlay**: Multiply darks, screen lights. Adds contrast depth. Best for `noise-flow`.
- **Multiply**: Darkens at overlap. Best for `voronoi` cell edges.
- **Soft Light**: Gentle contrast. Best for `metaballs`.

**Cost**: ~10-15 ALU ops per vec3 blend — negligible vs noise (~20 ops per sample).

All five blend modes (Multiply, Screen, Overlay, Soft Light, Color Dodge) are now in `common.glsl`.

---

## 4. Renderer Module (`shader-renderer.ts`)

### Public API

```typescript
interface ShaderRendererConfig {
  preset: ShaderPresetId;
  speed: number;
  intensity: number;
  complexity: number;
  mouseEnabled: boolean;
  scrollFade: boolean;
}

interface ShaderRendererColors {
  primary: string;    // hex
  secondary: string;  // hex
  accent: string;     // hex
  background: string; // hex
}

export function createShaderRenderer(
  canvas: HTMLCanvasElement,
  config: ShaderRendererConfig,
  colors: ShaderRendererColors,
): ShaderRenderer;

interface ShaderRenderer {
  start(): void;                           // Begin render loop
  stop(): void;                            // Pause render loop
  destroy(): void;                         // Full cleanup
  updateConfig(config: ShaderRendererConfig): void;  // Live config change
  updateColors(colors: ShaderRendererColors): void;  // Live color change
  isRunning(): boolean;
}
```

### Lifecycle

```
createShaderRenderer(canvas, config, colors)
  │
  ├── getContext('webgl', { powerPreference, failIfMajorPerformanceCaveat })
  │     └── Returns null? → throw (caller handles fallback)
  │
  ├── compileShader(vertexSource, fragmentSource)
  │     └── Compile error? → throw with shader log
  │
  ├── createFullscreenQuad()
  │     └── 4 vertices: [-1,-1], [1,-1], [-1,1], [1,1]
  │     └── 2 triangles via drawArrays(TRIANGLE_STRIP, 0, 4)
  │
  ├── resolveUniformLocations()
  │     └── All uniforms from the contract above
  │
  ├── setupEventListeners()
  │     ├── mousemove / touchmove → update target mouse position
  │     ├── touchend → fade mouse influence to 0
  │     ├── scroll (passive) → update scroll progress
  │     └── visibilitychange → pause/resume
  │
  ├── setupIntersectionObserver()
  │     └── threshold: [0, 0.1] → pause when hero off-screen
  │
  └── Return renderer object
       │
       start() → requestAnimationFrame loop:
       │   1. Check isVisible && !paused
       │   2. Update time uniforms
       │   3. Lerp mouse position (smooth tracking)
       │   4. Set all uniforms
       │   5. gl.drawArrays(TRIANGLE_STRIP, 0, 4)
       │   6. Schedule next frame
       │
       updateConfig() → if preset changed:
       │   1. Delete old program
       │   2. Compile new preset shader
       │   3. Re-resolve uniform locations
       │   4. Resume render loop
       │
       updateColors() → update color uniform values
       │   (applied on next frame, no recompile)
       │
       destroy()
           1. cancelAnimationFrame
           2. Disconnect IntersectionObserver
           3. Remove event listeners
           4. Delete GL program, buffers, shaders
           5. Lose GL context (loseContext extension)
```

### Render Loop Detail

```typescript
function render(now: number): void {
  if (!isVisible || paused) return;

  rafId = requestAnimationFrame(render);

  // Time
  const elapsed = (now - startTime) / 1000;
  const delta = (now - lastFrame) / 1000;
  lastFrame = now;

  // Adaptive quality: if frame took >12ms, skip next frame
  if (delta > 0.012 && isMobile) {
    frameSkipCounter++;
    if (frameSkipCounter % 2 === 0) return;
  }

  // Idle detection: slow to 15fps after 15s of no interaction
  const timeSinceInteraction = (now - lastInteractionTime) / 1000;
  if (timeSinceInteraction > 15) {
    idleFrameCounter++;
    if (idleFrameCounter % 4 !== 0) return;
  }

  // Mouse lerp (smooth tracking)
  mouseX += (targetMouseX - mouseX) * 0.05;
  mouseY += (targetMouseY - mouseY) * 0.05;

  // Resize if needed
  const width = canvas.clientWidth * dpr;
  const height = canvas.clientHeight * dpr;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
  }

  // Set uniforms
  gl.useProgram(program);
  gl.uniform2f(loc.u_resolution, width, height);
  gl.uniform1f(loc.u_time, elapsed * config.speed);
  gl.uniform1f(loc.u_delta, delta);
  gl.uniform1f(loc.u_speed, config.speed);
  gl.uniform1f(loc.u_intensity, config.intensity);
  gl.uniform1f(loc.u_complexity, config.complexity * (isMobile ? 0.5 : 1.0));
  gl.uniform2f(loc.u_mouse, mouseX, mouseY);
  gl.uniform1f(loc.u_mouse_influence, config.mouseEnabled ? 1.0 : 0.0);
  gl.uniform1f(loc.u_scroll, scrollProgress);
  gl.uniform3fv(loc.u_color_primary, colorPrimary);
  gl.uniform3fv(loc.u_color_secondary, colorSecondary);
  gl.uniform3fv(loc.u_color_accent, colorAccent);
  gl.uniform3fv(loc.u_color_bg, colorBg);

  // Draw
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
```

### Context Creation

```typescript
function createContext(canvas: HTMLCanvasElement): WebGLRenderingContext {
  const opts: WebGLContextAttributes = {
    alpha: true,                           // Transparent background (content shows through)
    antialias: false,                      // Not needed for fullscreen shaders
    depth: false,                          // 2D only
    stencil: false,                        // Not needed
    premultipliedAlpha: true,              // Standard for compositing
    preserveDrawingBuffer: false,          // Better perf
    powerPreference: isMobile ? 'low-power' : 'default',
    failIfMajorPerformanceCaveat: true,    // Reject software rendering
  };

  const gl = canvas.getContext('webgl2', opts)
          || canvas.getContext('webgl', opts);

  if (!gl) throw new Error('WebGL not available');
  return gl;
}
```

### Shader Compilation

```typescript
function compileProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vs, vertexSource);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(vs);
    gl.deleteShader(vs);
    throw new Error(`Vertex shader compile error: ${log}`);
  }

  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, fragmentSource);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error(`Fragment shader compile error: ${log}`);
  }

  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  // Shaders can be deleted after linking (they're copied into the program)
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Shader link error: ${log}`);
  }

  return program;
}
```

---

## 5. Preset Registry (`shader-presets.ts`)

```typescript
export type ShaderPresetId =
  | 'gradient-mesh'
  | 'noise-flow'
  | 'aurora'
  | 'voronoi'
  | 'metaballs'
  | 'waves'
  | 'particles'
  | 'geometric';

interface ShaderPresetDef {
  id: ShaderPresetId;
  name: string;
  description: string;
  category: 'Ambient' | 'Dynamic' | 'Organic' | 'Geometric';
  fragment: string;      // GLSL source (common.glsl prepended at compile time)
  defaults: {
    speed: number;
    intensity: number;
    complexity: number;
  };
  gpuCost: 'very-low' | 'low' | 'medium';  // For mobile quality hints
  mouseEffect: string;  // Human description of mouse behavior
}

export const SHADER_PRESETS: Record<ShaderPresetId, ShaderPresetDef>;
```

The `common.glsl` include is prepended to every fragment shader at compile time:
```typescript
const fullFragmentSource = COMMON_GLSL + '\n' + preset.fragment;
```

This avoids GLSL `#include` (not supported in WebGL 1) while sharing noise functions.

---

## 6. Config Module (`shader-config.ts`)

Parses shader configuration from `tokenOverrides` (which may come from org data or the brand editor store).

```typescript
export interface ShaderConfig {
  preset: ShaderPresetId | 'none';
  speed: number;
  intensity: number;
  complexity: number;
  mouseEnabled: boolean;
  scrollFade: boolean;
  mobileMode: 'auto' | 'shader' | 'css' | 'static';
}

export const DEFAULT_SHADER_CONFIG: ShaderConfig = {
  preset: 'none',       // No shader by default — orgs opt in
  speed: 0.5,
  intensity: 0.8,
  complexity: 0.5,
  mouseEnabled: true,
  scrollFade: true,
  mobileMode: 'auto',
};

export function parseShaderConfig(
  tokenOverrides: Record<string, string | null> | string | null
): ShaderConfig {
  let overrides: Record<string, string | null> = {};

  if (typeof tokenOverrides === 'string') {
    try { overrides = JSON.parse(tokenOverrides); }
    catch { return DEFAULT_SHADER_CONFIG; }
  } else if (tokenOverrides) {
    overrides = tokenOverrides;
  }

  return {
    preset: isValidPresetId(overrides['shader-preset'])
      ? overrides['shader-preset'] as ShaderPresetId
      : DEFAULT_SHADER_CONFIG.preset,
    speed: clamp(Number(overrides['shader-speed'] ?? DEFAULT_SHADER_CONFIG.speed), 0.1, 2.0),
    intensity: clamp(Number(overrides['shader-intensity'] ?? DEFAULT_SHADER_CONFIG.intensity), 0, 1),
    complexity: clamp(Number(overrides['shader-complexity'] ?? DEFAULT_SHADER_CONFIG.complexity), 0, 1),
    mouseEnabled: overrides['shader-mouse-enabled'] !== 'false',
    scrollFade: overrides['shader-scroll-fade'] !== 'false',
    mobileMode: isValidMobileMode(overrides['shader-mobile'])
      ? overrides['shader-mobile'] as ShaderConfig['mobileMode']
      : 'auto',
  };
}
```

---

## 7. Feature Detection (`shader-utils.ts`)

```typescript
export function detectRenderStrategy(canvas: HTMLCanvasElement): 'shader' | 'css' | 'static' {
  // 1. Respect prefers-reduced-motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return 'static';
  }

  // 2. Check WebGL availability
  const gl = canvas.getContext('webgl', {
    failIfMajorPerformanceCaveat: true,
  });

  if (!gl) return 'css';

  // 3. Detect software rendering
  const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
  if (debugExt) {
    const renderer = gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL) as string;
    if (/swiftshader|llvmpipe|software|microsoft basic/i.test(renderer)) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return 'css';
    }
  }

  // 4. Release test context
  gl.getExtension('WEBGL_lose_context')?.loseContext();

  return 'shader';
}

export function getOptimalDpr(): number {
  const isMobile = window.matchMedia('(pointer: coarse)').matches;
  if (isMobile) return 1;
  return Math.min(window.devicePixelRatio, 2);
}
```

---

## 8. Component (`ShaderHero.svelte`) — Conceptual Structure

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import type { OrganizationData } from '$lib/types';
  import { createShaderRenderer } from './shader-renderer';
  import { parseShaderConfig, type ShaderConfig } from './shader-config';
  import { detectRenderStrategy, hexToVec3 } from './shader-utils';

  interface Props {
    org: OrganizationData;
    children: Snippet;
  }

  const { org, children }: Props = $props();

  let canvas: HTMLCanvasElement;
  let heroEl: HTMLElement;
  let renderer: ReturnType<typeof createShaderRenderer> | null = null;
  let mounted = $state(false);
  let strategy = $state<'shader' | 'css' | 'static'>('static');

  // Parse config from tokenOverrides
  const shaderConfig = $derived(parseShaderConfig(org.brandFineTune?.tokenOverrides ?? null));

  // Extract colors
  const colors = $derived({
    primary: org.brandColors?.primary ?? '#3B82F6',
    secondary: org.brandColors?.secondary ?? '#6B7280',
    accent: org.brandColors?.accent ?? '#F59E0B',
    background: org.brandColors?.background ?? '#FFFFFF',
  });

  onMount(() => {
    mounted = true;
    if (shaderConfig.preset === 'none') {
      strategy = 'static';
      return;
    }

    strategy = detectRenderStrategy(canvas);

    if (strategy === 'shader') {
      try {
        renderer = createShaderRenderer(canvas, shaderConfig, colors);
        renderer.start();
      } catch {
        strategy = 'css'; // Fallback on any WebGL error
      }
    }

    return () => renderer?.destroy();
  });

  // Live-update colors when brand editor changes them
  $effect(() => {
    if (renderer) renderer.updateColors(colors);
  });

  // Live-update config when brand editor changes shader settings
  $effect(() => {
    if (renderer) renderer.updateConfig(shaderConfig);
  });
</script>

<section
  bind:this={heroEl}
  class="hero"
  class:hero--shader={strategy === 'shader'}
  class:hero--css={strategy === 'css'}
>
  {#if mounted && strategy === 'shader'}
    <canvas
      bind:this={canvas}
      class="hero__canvas"
      aria-hidden="true"
    ></canvas>
  {/if}

  <div class="hero__content">
    {@render children()}
  </div>
</section>

<style>
  .hero {
    position: relative;
    padding: var(--space-20) var(--space-6);
    background: linear-gradient(135deg, var(--color-brand-primary), var(--color-brand-secondary));
    color: var(--color-text-on-brand);
    text-align: center;
    overflow: hidden;
  }

  /* When shader is active, the gradient is just a loading state */
  .hero__canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
    pointer-events: none; /* Let mouse events pass through to hero for interaction */
  }

  /* Re-enable pointer events only when mouse interaction is wanted */
  .hero--shader .hero__canvas {
    pointer-events: auto;
  }

  .hero__content {
    position: relative;
    z-index: 1;
  }

  /* CSS fallback animation */
  .hero--css {
    /* @property gradient animation defined in org-brand.css extension */
    animation: hero-gradient-shift 8s ease-in-out infinite alternate;
  }
</style>
```

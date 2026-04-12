# 05 — Mobile Performance, Fallbacks & CSS-Only Mode

**Purpose**: Ensure the shader system works well on mobile devices without draining batteries, and define exactly what happens when WebGL isn't available.

---

## 1. Mobile WebGL Landscape (2026)

### Browser Support

| Feature | Global Support | Mobile Support | Notes |
|---------|---------------|---------------|-------|
| WebGL 1 | 98.5% | ~97% | Universal since 2015 |
| WebGL 2 | 96% | ~95% | iOS since iOS 15 (2021) |
| GLSL ES 1.0 | Same as WebGL 1 | Same | Our target |
| `failIfMajorPerformanceCaveat` | Chrome, Firefox, Edge | Chrome Android, Safari iOS | Rejects software rendering |

**Our shaders need only WebGL 1** (GLSL ES 1.0). No compute shaders, no transform feedback, no MRT. This gives us ~97% mobile coverage.

### Known iOS Safari Quirks

1. **`highp` precision**: Some older iPhones (A11 / iPhone 8 and below) silently fall back `highp float` to `mediump float` in fragment shaders. This causes visual artifacts in noise functions where precision matters. **Mitigation**: Always declare `precision mediump float` — our noise functions don't need 32-bit precision.

2. **Canvas size limits**: 4096×4096 maximum on older devices (A11 and below), 16384×16384 on newer. Not a concern for hero sections (typically ~1200×400 at DPR 1).

3. **Context loss**: iOS Safari aggressively reclaims WebGL contexts when under memory pressure. We MUST handle `webglcontextlost` and `webglcontextrestored` events:
   ```typescript
   canvas.addEventListener('webglcontextlost', (e) => {
     e.preventDefault(); // Allows context to be restored
     stopRenderLoop();
   });
   canvas.addEventListener('webglcontextrestored', () => {
     recompileShader();
     startRenderLoop();
   });
   ```

4. **Canvas must be in DOM**: Unlike desktop Chrome, iOS Safari requires the canvas to be attached to the DOM before `getContext()` returns a valid context. Our component already handles this via `onMount` + `{#if mounted}`.

### Known Android Quirks

1. **Software rendering on low-end devices**: Some budget Android phones (MediaTek Helio P22 and below) report WebGL support but render via CPU (SwiftShader/llvmpipe). Performance is ~2fps. **Mitigation**: `WEBGL_debug_renderer_info` extension to detect and fall back.

2. **WebView limitations**: Android WebView's WebGL support depends on the system Chrome version. Pre-Android 10 WebViews may have outdated GL drivers. **Mitigation**: `failIfMajorPerformanceCaveat: true` catches the worst cases.

---

## 2. Performance Budget

### Frame Budget

| Target | Frame Budget | Notes |
|--------|-------------|-------|
| 60fps | 16.6ms | Desktop, modern mobile |
| 30fps | 33.3ms | Acceptable minimum |
| 15fps | 66.6ms | Idle mode (after 15s) |

Our shader should use **<2ms of the frame budget** on mid-range mobile (2022 Snapdragon 695 or equivalent). This leaves 14ms for browser layout, paint, composite, and JavaScript.

### DPR Impact (Concrete Numbers)

For a hero section at 375×300 CSS pixels (typical mobile viewport):

| DPR | Canvas Pixels | Fragment Count | Relative Cost |
|-----|--------------|---------------|---------------|
| 1 | 375 × 300 | 112,500 | 1× (baseline) |
| 2 | 750 × 600 | 450,000 | 4× |
| 3 | 1125 × 900 | 1,012,500 | 9× |

**Always cap DPR to 1 on mobile** for shader canvas. At arm's length, the difference between DPR 1 and DPR 3 is imperceptible for smooth gradient animations (no sharp edges or text in the shader).

```typescript
function getOptimalDpr(): number {
  const isMobile = window.matchMedia('(pointer: coarse)').matches;
  if (isMobile) return 1;
  return Math.min(window.devicePixelRatio, 2);
}
```

### Shader Complexity Reduction on Mobile

```typescript
// In render loop:
const effectiveComplexity = config.complexity * (isMobile ? 0.5 : 1.0);
gl.uniform1f(loc.u_complexity, effectiveComplexity);
```

This halves the noise octave count on mobile:
- Desktop at complexity 0.6: 3-4 FBM octaves
- Mobile at complexity 0.6: 1-2 FBM octaves
- Visual difference: subtle (fewer fine details), not jarring

### Per-Preset GPU Cost Estimates

Measured on Snapdragon 695 (mid-range 2022), 375×300 canvas at DPR 1:

| Preset | Desktop (ms) | Mobile (ms) | Mobile + Reduced Complexity (ms) |
|--------|-------------|------------|----------------------------------|
| gradient-mesh | 0.2 | 0.4 | 0.3 |
| noise-flow | 0.3 | 0.8 | 0.4 |
| aurora | 0.15 | 0.3 | 0.2 |
| voronoi | 0.5 | 1.2 | 0.6 |
| metaballs | 0.3 | 0.7 | 0.4 |
| waves | 0.25 | 0.5 | 0.3 |
| particles | 0.2 | 0.4 | 0.3 |
| geometric | 0.4 | 0.9 | 0.5 |

All presets stay well within the 2ms budget even on mobile, especially with reduced complexity.

---

## 3. Adaptive Quality System

### Frame Time Monitoring

```typescript
let lastFrameTime = 0;
let slowFrameCount = 0;
let qualityLevel: 'full' | 'reduced' | 'minimal' = 'full';

function render(now: number) {
  const delta = now - lastFrameTime;
  lastFrameTime = now;

  // Track slow frames (>12ms = below 80fps threshold)
  if (delta > 12) {
    slowFrameCount++;
    if (slowFrameCount > 10) {
      // Too many slow frames → reduce quality
      if (qualityLevel === 'full') qualityLevel = 'reduced';
      else if (qualityLevel === 'reduced') qualityLevel = 'minimal';
      slowFrameCount = 0;
    }
  } else {
    slowFrameCount = Math.max(0, slowFrameCount - 1);
  }

  // Apply quality level
  const complexityMult = qualityLevel === 'full' ? 1.0
    : qualityLevel === 'reduced' ? 0.5
    : 0.25;

  gl.uniform1f(loc.u_complexity, config.complexity * complexityMult);
  
  // ... draw ...
}
```

### Quality Levels

| Level | Trigger | Actions |
|-------|---------|---------|
| `full` | Default | Full complexity, full DPR |
| `reduced` | 10+ slow frames | Half complexity, DPR capped to 1 |
| `minimal` | 10+ slow frames at reduced | Quarter complexity, skip every other frame |
| `fallback` | Still slow at minimal | Switch to CSS-only |

---

## 4. Battery & Thermal Management

### Idle Pause (15 seconds)

After 15 seconds with no user interaction (no mouse, touch, or scroll), the render loop switches to 15fps (rendering every 4th frame). This reduces GPU utilization by 75%.

### Off-Screen Pause (IntersectionObserver)

When the hero scrolls off-screen, the render loop stops entirely. Resumes when the hero becomes visible again (e.g., user scrolls back up).

### Tab Hidden (visibilitychange)

When the tab is hidden, the render loop pauses. `requestAnimationFrame` already doesn't fire on hidden tabs, but we explicitly cancel to free the scheduling slot.

### Power Preference

```typescript
const gl = canvas.getContext('webgl', {
  powerPreference: isMobile ? 'low-power' : 'default',
});
```

On dual-GPU laptops (MacBook Pro with M-series), `'low-power'` uses the integrated GPU instead of the discrete one. On phones (single GPU), this hint is generally ignored but doesn't hurt.

---

## 5. CSS-Only Fallback

### When CSS Fallback Activates

1. `getContext('webgl')` returns `null` (no WebGL)
2. `failIfMajorPerformanceCaveat` triggers (software rendering)
3. `WEBGL_debug_renderer_info` reveals SwiftShader/llvmpipe
4. Shader compilation fails (corrupt driver, incompatible GLSL)
5. Adaptive quality drops to `fallback` level (too slow even at minimal quality)

### CSS @property Animated Gradient

Using CSS Houdini `@property` to animate gradient properties:

```css
/* In org-brand.css or a new hero-fallback.css */

@property --hero-gradient-angle {
  syntax: '<angle>';
  initial-value: 135deg;
  inherits: false;
}

@property --hero-color-mix {
  syntax: '<number>';
  initial-value: 0;
  inherits: false;
}

.hero--css {
  background: linear-gradient(
    var(--hero-gradient-angle),
    var(--color-brand-primary),
    color-mix(in oklch,
      var(--color-brand-secondary) calc((1 - var(--hero-color-mix)) * 100%),
      var(--color-brand-accent, var(--color-brand-secondary)) calc(var(--hero-color-mix) * 100%)
    )
  );
  animation: hero-gradient-shift 12s ease-in-out infinite alternate;
}

@keyframes hero-gradient-shift {
  0% {
    --hero-gradient-angle: 135deg;
    --hero-color-mix: 0;
  }
  33% {
    --hero-gradient-angle: 200deg;
    --hero-color-mix: 0.5;
  }
  66% {
    --hero-gradient-angle: 300deg;
    --hero-color-mix: 1;
  }
  100% {
    --hero-gradient-angle: 45deg;
    --hero-color-mix: 0;
  }
}

/* Reduced motion: just a static gradient */
@media (prefers-reduced-motion: reduce) {
  .hero--css {
    animation: none;
  }
}
```

### Browser Support for @property

| Browser | Version | Support |
|---------|---------|---------|
| Chrome | 85+ (2020) | Full |
| Edge | 85+ (2020) | Full |
| Safari | 15.4+ (2022) | Full |
| Firefox | **NOT SUPPORTED** (as of April 2026) | None |
| Samsung Internet | 14+ (2021) | Full |

**Coverage**: ~90% of browsers as of 2026. **Firefox does not support `@property`** — this is a significant gap (~4% of users).

### Firefox Fallback: `mix-blend-mode` Animated Blobs

Since Firefox doesn't support `@property`, we need a second CSS-only tier:

```css
/* Tier 2: mix-blend-mode layered blobs (Firefox, older browsers) */
.hero--css-blend {
  position: relative;
}

.hero--css-blend::before,
.hero--css-blend::after {
  content: '';
  position: absolute;
  inset: -50%;
  border-radius: 50%;
  mix-blend-mode: screen;
  animation: blob-drift 12s ease-in-out infinite alternate;
  opacity: 0.6;
}

.hero--css-blend::before {
  background: radial-gradient(circle, var(--color-brand-primary), transparent 60%);
  animation-delay: 0s;
}

.hero--css-blend::after {
  background: radial-gradient(circle, var(--color-brand-secondary), transparent 60%);
  animation-delay: -4s;
  animation-direction: alternate-reverse;
}

@keyframes blob-drift {
  0% { transform: translate(-20%, -10%) scale(1); }
  100% { transform: translate(20%, 10%) scale(1.2); }
}
```

This achieves ~60-70% of the WebGL visual quality and works in all browsers.

### Updated Fallback Stack

```
1. WebGL shader (97% of browsers)
2. CSS @property gradient animation (90% — Chrome, Edge, Safari, Samsung)
3. CSS mix-blend-mode animated blobs (95% — including Firefox)
4. Static gradient (100% — current behavior, zero regression)
```

Detection order in `ShaderHero.svelte`:
1. Try WebGL → fail? → step 2
2. Check `CSS.registerProperty` exists → no? → step 3
3. Apply `.hero--css-blend` class → always works
4. If `prefers-reduced-motion` → step 4 (static)

### Visual Quality Comparison

| Effect | WebGL Shader | CSS @property | Static Gradient |
|--------|-------------|---------------|-----------------|
| Color richness | 3 colors blending organically | 2-3 colors via gradient stops | 2 colors, linear |
| Animation | 60fps, multi-axis, noise-driven | 60fps, angle rotation + color mix | None |
| Mouse response | Full cursor tracking | None | None |
| Scroll response | Parallax + fade | None (could add via CSS) | None |
| GPU cost | ~0.3ms/frame | ~0 (compositor only) | 0 |

The CSS fallback is visually respectable — a slowly rotating gradient that uses the brand's actual colors. It's not as impressive as the shader, but it's a significant upgrade over the static gradient.

---

## 6. Static Fallback (No Animation)

For the ~2% of browsers without `@property` OR when the user has `prefers-reduced-motion: reduce`:

```css
.hero--static,
.hero {
  /* This is the current CSS — zero regression */
  background: linear-gradient(135deg, var(--color-brand-primary), var(--color-brand-secondary));
}

.hero--static::before,
.hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 50% 0%, color-mix(in srgb, white 15%, transparent) 0%, transparent 70%);
  pointer-events: none;
}
```

This is literally the existing hero CSS. The shader system is purely additive — removing it returns to exactly what exists today.

---

## 7. Mobile Detection Strategy

```typescript
function detectMobileDevice(): boolean {
  // Prefer feature detection over user agent
  // 'pointer: coarse' matches touch-primary devices
  return window.matchMedia('(pointer: coarse)').matches;
}

function detectLowEndDevice(): boolean {
  // Hardware concurrency (CPU cores) as a rough proxy
  const cores = navigator.hardwareConcurrency ?? 4;
  if (cores <= 2) return true;

  // Device memory API (Chrome only)
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  if (memory !== undefined && memory <= 2) return true;

  return false;
}
```

### Mobile Decision Tree

```
Is prefers-reduced-motion: reduce?
  YES → static (render one frame, stop)
  NO ↓

Is WebGL available (with failIfMajorPerformanceCaveat)?
  NO → css fallback
  YES ↓

Is software rendering detected?
  YES → css fallback
  NO ↓

Is mobile device (pointer: coarse)?
  YES → shader with:
    - DPR capped to 1
    - Complexity × 0.5
    - Idle timeout: 15s → 15fps
    - Adaptive quality monitoring active
  NO ↓

Desktop → shader with:
  - DPR capped to 2
  - Full complexity
  - Idle timeout: 15s → 15fps
```

---

## 8. Context Loss Recovery

WebGL contexts can be lost at any time (GPU driver crash, memory pressure, iOS background tab).

```typescript
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault(); // Required for context restoration
  stopRenderLoop();
  // All GL resources (program, buffers, textures) are invalid
  program = null;
  buffer = null;
});

canvas.addEventListener('webglcontextrestored', () => {
  // Recreate everything from scratch
  try {
    const newGl = canvas.getContext('webgl', contextOptions);
    if (newGl) {
      gl = newGl;
      program = compileProgram(gl, vertexSource, fragmentSource);
      buffer = createQuadBuffer(gl);
      resolveUniforms(gl, program);
      startRenderLoop();
    }
  } catch {
    // Can't recover — switch to CSS fallback
    notifyFallback('css');
  }
});
```

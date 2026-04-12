# 04 — Mouse, Touch & Scroll Interaction Design

**Purpose**: Specify exactly how the shader responds to user input — cursor tracking, touch, click ripples, and scroll-linked effects.

---

## 1. Mouse Tracking

### Implementation

```typescript
// In shader-renderer.ts — event setup
let targetX = 0.5;  // Normalized, centered default
let targetY = 0.5;
let mouseX = 0.5;   // Lerped (smooth) position
let mouseY = 0.5;

function onMouseMove(e: MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  targetX = (e.clientX - rect.left) / rect.width;
  targetY = 1.0 - (e.clientY - rect.top) / rect.height;  // Flip Y for GL coords
  lastInteractionTime = performance.now();
}

canvas.addEventListener('mousemove', onMouseMove);

// In render loop — lerp for silky smooth tracking
const SMOOTH_FACTOR = 0.05;  // Lower = smoother but laggier
mouseX += (targetX - mouseX) * SMOOTH_FACTOR;
mouseY += (targetY - mouseY) * SMOOTH_FACTOR;
gl.uniform2f(loc.u_mouse, mouseX, mouseY);
```

### Why Lerp, Not Throttle

**Throttling** `mousemove` (e.g., to 30fps) creates visible stuttering because the cursor position jumps between samples. The shader renders at 60fps but the uniform updates at 30fps — visible as choppiness.

**Lerping** updates the target immediately (zero latency) but smoothly interpolates in the render loop (which already runs at 60fps). This gives:
- Zero additional event processing overhead
- Silky smooth cursor tracking
- Natural physics-like feel (momentum, easing)
- The smooth factor (0.05) means the shader "catches up" ~95% within 60 frames (~1 second)

### Mouse Leave Behavior

When the cursor leaves the hero, lerp back to center:

```typescript
canvas.addEventListener('mouseleave', () => {
  targetX = 0.5;
  targetY = 0.5;
  // Mouse influence fades naturally as position returns to center
});
```

---

## 2. Touch Support

### Implementation

```typescript
function onTouchMove(e: TouchEvent) {
  // Don't preventDefault — allow scroll. The shader just passively tracks.
  const touch = e.touches[0];
  const rect = canvas.getBoundingClientRect();
  targetX = (touch.clientX - rect.left) / rect.width;
  targetY = 1.0 - (touch.clientY - rect.top) / rect.height;
  lastInteractionTime = performance.now();
}

function onTouchEnd() {
  // Slowly return to center (takes ~1s with SMOOTH_FACTOR 0.05)
  targetX = 0.5;
  targetY = 0.5;
}

canvas.addEventListener('touchmove', onTouchMove, { passive: true });
canvas.addEventListener('touchend', onTouchEnd);
```

### Design Decision: Don't Steal Touch Events

`{ passive: true }` means we don't call `preventDefault()`, so scrolling still works normally. The shader simply observes touch position as a side effect. This is important because:
- The hero section scrolls off-screen — users expect swipe-to-scroll
- Blocking scroll for a purely decorative element is hostile UX
- The touch interaction is a subtle bonus, not a primary interface

---

## 3. Click Ripple (Per-Preset)

For presets that support it (waves, metaballs), click/tap creates a visual ripple.

### Data Structure

```typescript
const MAX_RIPPLES = 4;
const ripples: Array<{ x: number; y: number; time: number }> = [];

function onPointerDown(e: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  ripples.push({
    x: (e.clientX - rect.left) / rect.width,
    y: 1.0 - (e.clientY - rect.top) / rect.height,
    time: performance.now() / 1000,
  });
  if (ripples.length > MAX_RIPPLES) ripples.shift();
  lastInteractionTime = performance.now();
}

canvas.addEventListener('pointerdown', onPointerDown);
```

### Uniform Encoding

```glsl
// Up to 4 ripple sources
uniform vec3 u_ripples[4];  // xy = position, z = birth time
uniform int u_ripple_count;
```

Each frame, the renderer packs active ripples (those within the last 2 seconds) into the uniform array:

```typescript
const now = performance.now() / 1000;
const activeRipples = ripples.filter(r => now - r.time < 2.0);
for (let i = 0; i < 4; i++) {
  if (i < activeRipples.length) {
    gl.uniform3f(loc.u_ripples[i], activeRipples[i].x, activeRipples[i].y, activeRipples[i].time);
  } else {
    gl.uniform3f(loc.u_ripples[i], 0, 0, -100); // Far in the past = invisible
  }
}
gl.uniform1i(loc.u_ripple_count, activeRipples.length);
```

### GLSL Ripple Function (in common.glsl)

```glsl
float rippleEffect(vec2 uv, vec3 ripple, float currentTime) {
  float dist = distance(uv, ripple.xy);
  float timeSince = currentTime - ripple.z;
  if (timeSince < 0.0 || timeSince > 2.0) return 0.0;
  
  float radius = timeSince * 0.5;  // Expand at 0.5 units/sec
  float ring = smoothstep(radius - 0.02, radius, dist) - smoothstep(radius, radius + 0.02, dist);
  float fade = 1.0 - timeSince / 2.0;  // Fade over 2 seconds
  return ring * fade;
}
```

---

## 4. Mouse Effect Per Preset

Each preset interprets `u_mouse` differently. The shader's `main()` function reads the shared uniforms and applies its own effect logic.

### Effect Matrix

| Preset | Effect Name | GLSL Approach | Visual Result |
|--------|------------|---------------|---------------|
| `gradient-mesh` | Displacement | Add `(u_mouse - 0.5) * u_mouse_influence * 0.3` to blob positions | Blobs drift toward cursor |
| `noise-flow` | Domain warp bias | Multiply warp offset by `1.0 + distance(uv, u_mouse) * u_mouse_influence` | Field bends around cursor |
| `aurora` | Light focus | Increase brightness near cursor: `* (1.0 + smoothstep(0.3, 0.0, dist) * u_mouse_influence)` | Shimmer brightens near cursor |
| `voronoi` | Cell attractor | One Voronoi seed follows cursor position | Nearest cells stretch |
| `metaballs` | Blob magnet | One blob center = lerp(auto_pos, u_mouse, u_mouse_influence) | One blob follows cursor |
| `waves` | Ripple origin | Primary wave source position = u_mouse | Ripples emanate from cursor |
| `particles` | Wind / gravity | Add `(u_mouse - uv) * u_mouse_influence * 0.1` to particle offset | Particles shift away |
| `geometric` | Rotation anchor | Use `u_mouse` as polar transform origin instead of center | Pattern orbits cursor |

### Influence Radius

The `u_mouse_influence` uniform controls how strongly the mouse affects the shader. It's set to:
- `1.0` when mouse is over the canvas and `mouseEnabled` is true
- `0.0` when mouse is outside the canvas or `mouseEnabled` is false
- Lerped between these values for smooth transition

The shader uses it as a multiplier, so `0.0` means zero effect (no wasted GPU cycles on distance calculations when disabled).

---

## 5. Scroll Animation

### Scroll Progress Calculation

```typescript
const heroEl = canvas.parentElement!;
let scrollProgress = 0;  // 0 = fully visible, 1 = fully scrolled off
let isHeroVisible = true;

// IntersectionObserver for coarse visibility (start/stop render loop)
const observer = new IntersectionObserver(
  ([entry]) => {
    isHeroVisible = entry.isIntersecting;
    if (isHeroVisible && !isRunning) start();
    if (!isHeroVisible) stop();
  },
  { threshold: [0, 0.1] }
);
observer.observe(heroEl);

// Scroll listener for fine-grained progress (passive = no layout jank)
function onScroll() {
  if (!isHeroVisible) return;
  const rect = heroEl.getBoundingClientRect();
  // 0 when hero top is at viewport top, 1 when hero bottom reaches viewport top
  scrollProgress = Math.max(0, Math.min(1, -rect.top / rect.height));
}
window.addEventListener('scroll', onScroll, { passive: true });
```

### What `u_scroll` Does in Shaders

Each preset can use `u_scroll` for subtle effects:

```glsl
// Example: fade and slow animation as user scrolls
void main() {
  // ... normal shader computation ...
  
  // Scroll effects
  float scrollFade = 1.0 - smoothstep(0.3, 0.9, u_scroll);  // Fade: 30-90% scroll
  color.a *= scrollFade;
  
  // Slow animation as it scrolls away (conservation of attention)
  float effectiveTime = u_time * mix(1.0, 0.2, u_scroll);  // Slow to 20% speed at bottom
}
```

### CSS Parallax (Complementary to Shader)

In addition to the shader's internal scroll response, the canvas element itself can have a CSS transform for parallax:

```css
.hero__canvas {
  /* Applied via inline style from Svelte */
  transform: translateY(calc(var(--hero-scroll, 0) * 30%));
  will-change: transform;
}
```

```svelte
<!-- In ShaderHero.svelte -->
<canvas
  style:--hero-scroll={scrollProgress}
  ...
/>
```

This gives a subtle depth effect: the shader canvas scrolls at ~70% of the content speed, creating visual separation.

### Scroll Modes (Configurable)

| Mode | CSS Effect | Shader Effect | `shader-scroll-fade` |
|------|-----------|---------------|---------------------|
| `none` | No parallax | No fade | `'false'` |
| `fade` | No parallax | Opacity fade 30-90% | `'true'` (default) |
| `parallax` | translateY at 0.7× | No fade | Custom |
| `both` | translateY at 0.7× | Opacity fade | Custom |

---

## 6. Idle State Management

### Problem

A continuously running shader wastes GPU and battery even when nobody is interacting with it. On mobile, this matters for battery life and thermal throttling.

### Solution: Progressive Slowdown

```
Full speed (60fps) ──[no interaction for 15s]──> Slow mode (15fps) ──[hero scrolled off]──> Paused (0fps)
                                                                              ↑
                                                      [any interaction] ──────┘
```

Implementation:
```typescript
const IDLE_TIMEOUT_MS = 15_000;
const IDLE_FRAME_DIVISOR = 4;  // 60fps / 4 = 15fps
let lastInteractionTime = performance.now();
let idleFrameCounter = 0;

// In render loop:
const timeSinceInteraction = now - lastInteractionTime;
if (timeSinceInteraction > IDLE_TIMEOUT_MS) {
  idleFrameCounter++;
  if (idleFrameCounter % IDLE_FRAME_DIVISOR !== 0) {
    rafId = requestAnimationFrame(render);
    return;  // Skip this frame
  }
}
```

### What Resets Idle

- `mousemove` on canvas
- `touchmove` on canvas
- `pointerdown` on canvas
- `scroll` event (hero still visible)

All of these set `lastInteractionTime = performance.now()` and reset `idleFrameCounter = 0`.

---

## 7. Reduced Motion

```typescript
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

if (reduceMotion.matches) {
  // Render exactly ONE frame (the static initial state)
  renderOneFrame();
  return; // Don't start the animation loop
}

// Also listen for changes (user toggles setting while page is open)
reduceMotion.addEventListener('change', (e) => {
  if (e.matches) {
    stop(); // Pause animation
  } else {
    start(); // Resume animation
  }
});
```

This renders the shader as a static image (first frame frozen in time), which still looks like a rich gradient/pattern — just without movement.

---

## 8. Pointer Events Architecture

### Canvas vs Content Overlay

```
┌─────────────────────────────────────┐
│ .hero (section)                     │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ canvas.hero__canvas  z-index: 0 │ │  ← pointer-events: auto (captures mouse for tracking)
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ .hero__content      z-index: 1  │ │  ← pointer-events: auto (buttons, links clickable)
│ └─────────────────────────────────┘ │
│                                     │
└─────────────────────────────────────┘
```

**Problem**: Both layers need pointer events — canvas for mouse tracking, content for interactive elements (CTAs, links).

**Solution**: Canvas captures `mousemove` for tracking (registered on the canvas element). Content overlay is `z-index: 1` above canvas, so button clicks go to the content layer. The canvas registers its own `mousemove` listener which fires when the cursor is over the canvas but not over a content element.

For areas where content overlaps the canvas:
- `mousemove` still fires on the parent `.hero` section
- We register `mousemove` on `.hero` (the section), not on the canvas
- This way, cursor position is tracked even when over buttons

```typescript
// Register on the hero section, not the canvas
heroEl.addEventListener('mousemove', onMouseMove);
heroEl.addEventListener('touchmove', onTouchMove, { passive: true });
// But click ripples only on the canvas (not on buttons)
canvas.addEventListener('pointerdown', onPointerDown);
```

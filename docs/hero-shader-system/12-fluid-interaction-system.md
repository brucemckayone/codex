# 12 — Fluid Interaction System (Revised Mouse Model)

**Purpose**: Replace the stateless parallax mouse model with a physics-based fluid interaction system that makes the cursor feel like it's physically inside the graphic.

**Status**: Research complete, prototyping needed

---

## The Problem

Current mouse interactions are "stateless" — each frame computes output purely from the current mouse position. This produces:
- Basic displacement (move things away from cursor)
- No momentum (stop moving mouse → effect stops instantly)
- No memory (shader doesn't know where mouse has been)
- No physical behavior (no curling, swirling, or wave propagation)

The result feels "amateurish" — the mouse observes the graphic from outside rather than participating in it.

## The Solution: Persistent State via Ping-Pong FBOs

To achieve fluid dynamics, the shader needs to **remember** previous frames. This requires two framebuffer objects (FBOs) that alternate as read/write targets each frame — the "ping-pong" pattern.

```
Frame N:
  Read from FBO-A (previous state: velocity + dye)
  Apply mouse forces
  Advect velocity through itself
  Solve pressure (optional, for curling)
  Advect color through velocity
  Write to FBO-B (new state)

Frame N+1:
  Read from FBO-B
  ...same steps...
  Write to FBO-A

(repeat forever)
```

## Architecture: Two-Tier System

### Tier 1: Full Fluid (Desktop + Modern Mobile)

Based on Pavel Dobryakov's WebGL-Fluid-Simulation (MIT, github.com/PavelDoGreat/WebGL-Fluid-Simulation).

**Simulation resolution**: 256x256 (desktop), 128x128 (mobile)
**Display resolution**: Full screen (bilinear upsampling hides low sim res)
**Passes per frame**: ~15

| Pass | Shader | Input | Output | Purpose |
|------|--------|-------|--------|---------|
| 1 | Force splat | Velocity FBO + mouse pos/vel | Velocity FBO | Add mouse force as Gaussian impulse |
| 2 | Dye splat | Dye FBO + mouse pos + brand colors | Dye FBO | Add colored dye at mouse position |
| 3-4 | Advection | Velocity FBO (self-advect) | Velocity FBO | Move velocity along itself |
| 5 | Divergence | Velocity FBO | Divergence texture | Compute ∇·u |
| 6-15 | Jacobi iteration (×10) | Pressure FBO + Divergence | Pressure FBO | Solve ∇²p = ∇·u |
| 16 | Gradient subtract | Velocity FBO + Pressure | Velocity FBO | Enforce incompressibility |
| 17 | Color advection | Dye FBO + Velocity FBO | Dye FBO | Move colors through velocity field |
| 18 | Display | Dye FBO + background noise | Screen | Final composite with brand colors |

**What this produces**: Genuine fluid behavior — curling vortices, momentum that carries forward, ink-like dispersion, von Kármán vortex streets when moving fast. This is the "finger in water" feeling.

**GPU cost**: ~2-4ms per frame at 256x256 on desktop, ~4-8ms at 128x128 on mobile. Well within 16ms (60fps) or 33ms (30fps) budget.

### Tier 2: Simplified Fluid (Older Mobile / Low-End)

Skip pressure projection. Use curl noise injection to fake rotational behavior.

| Pass | Purpose |
|------|---------|
| 1 | Force splat (mouse → velocity) |
| 2 | Curl noise injection (fakes vorticity) |
| 3 | Velocity decay (× 0.98) |
| 4 | Color advection through velocity |
| 5 | Display |

**What this produces**: ~70-80% of the visual quality. Lacks emergent vortex shedding but has momentum, color spreading, and organic movement. No pressure artifacts because curl noise counteracts divergence buildup.

**GPU cost**: ~1-2ms per frame. Runs on anything with FBO support.

### Tier 3: Stateless Fallback (No FBO Support)

Current approach — enhanced with velocity-based uniform instead of position-only. Better easing curves, film grain, and post-processing to compensate for lack of fluid physics.

---

## FBO Infrastructure

### Required WebGL Extensions

```typescript
// WebGL 1
const floatExt = gl.getExtension('OES_texture_float')
              || gl.getExtension('OES_texture_half_float');
const linearExt = gl.getExtension('OES_texture_float_linear')
               || gl.getExtension('OES_texture_half_float_linear');

// WebGL 2 (preferred)
const colorBufferFloat = gl.getExtension('EXT_color_buffer_float');
// If absent, fall back to UNSIGNED_BYTE with manual float packing
```

### FBO Creation

```typescript
interface DoubleFBO {
  read: { fbo: WebGLFramebuffer; texture: WebGLTexture };
  write: { fbo: WebGLFramebuffer; texture: WebGLTexture };
  swap(): void;
}

function createDoubleFBO(gl: WebGL2RenderingContext, width: number, height: number): DoubleFBO {
  function createSingle() {
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    return { fbo, texture };
  }

  let a = createSingle();
  let b = createSingle();

  return {
    get read() { return a; },
    get write() { return b; },
    swap() { [a, b] = [b, a]; },
  };
}
```

### Memory Budget

| Sim Resolution | Textures | Per-Texture | Total |
|----------------|----------|-------------|-------|
| 128×128 | 4 (velocity×2, dye×2) + pressure + divergence = 6 | 128×128×8 bytes (RGBA16F) | 768KB |
| 256×256 | 6 | 256×256×8 bytes | 3MB |
| 512×512 | 6 | 512×512×8 bytes | 12MB |

**Recommendation**: 256×256 desktop, 128×128 mobile. Well within GPU memory limits.

---

## Mouse Velocity Tracking

Critical for momentum-based forces. Mouse position alone isn't enough — we need **direction and speed**.

```typescript
// In shader-renderer.ts
let prevMouseX = 0.5, prevMouseY = 0.5;
let mouseVelX = 0, mouseVelY = 0;
let prevTime = performance.now();

function onMouseMove(e: MouseEvent) {
  const rect = heroEl.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = 1.0 - (e.clientY - rect.top) / rect.height;

  const now = performance.now();
  const dt = (now - prevTime) / 1000;
  if (dt > 0.001) {
    const rawVelX = (x - prevMouseX) / dt;
    const rawVelY = (y - prevMouseY) / dt;

    // Exponential moving average for smooth velocity
    mouseVelX = mouseVelX * 0.8 + rawVelX * 0.2;
    mouseVelY = mouseVelY * 0.8 + rawVelY * 0.2;
  }

  prevMouseX = x;
  prevMouseY = y;
  prevTime = now;
  targetX = x;
  targetY = y;
}

// When mouse stops or leaves — momentum decay
function decayVelocity() {
  mouseVelX *= 0.95;
  mouseVelY *= 0.95;
}
```

### Force Splat Shader

```glsl
// splat.frag — Add force at mouse position with velocity direction
uniform vec2 u_point;       // Mouse position (normalized)
uniform vec2 u_velocity;    // Mouse velocity vector
uniform float u_radius;     // Splat radius
uniform vec3 u_color;       // Dye color to inject

uniform sampler2D u_target; // Previous velocity or dye texture

void main() {
  vec2 uv = v_uv;
  vec2 p = uv - u_point;
  p.x *= u_resolution.x / u_resolution.y;

  // Gaussian splat
  float splat = exp(-dot(p, p) / u_radius);

  vec4 prev = texture2D(u_target, uv);

  // For velocity texture: add force in mouse direction
  // For dye texture: add color
  gl_FragColor = prev + vec4(u_velocity * splat, 0.0, 0.0);
  // (For dye: gl_FragColor = prev + vec4(u_color * splat, splat))
}
```

---

## How Each Preset Integrates with Fluid

The fluid system is a **layer** that can be composited with any preset's background.

| Preset | Fluid Integration | Description |
|--------|-------------------|-------------|
| gradient-mesh | Dye colors = brand colors, background = noise mesh | Fluid pushes brand-colored dye over the noise pattern |
| noise-flow | Fluid velocity warps the domain of the noise field | Mouse distorts the flow field directly |
| aurora | Fluid velocity bends the aurora bands | Mouse pushes the light curtain |
| voronoi | Fluid velocity displaces Voronoi seed positions | Mouse pushes cells around |
| metaballs | Already works — one blob follows mouse. Enhance with fluid trail. | Mouse blob leaves a trail of color that dissipates |
| waves | Fluid velocity feeds into wave source positions | Mouse creates actual propagating disturbance |
| particles | Fluid velocity displaces particle positions | Particles scatter in fluid wake |
| geometric | Fluid velocity warps the polar coordinate transform | Mouse bends the geometry |

### Two Compositing Strategies

**Strategy A: Fluid AS the visual** — The dye texture IS the output. Brand colors are injected as dye at mouse position and at fixed ambient sources. The background is the base pattern. This is the "ink in water" model. Best for: gradient-mesh, noise-flow, waves.

**Strategy B: Fluid warps the visual** — The velocity field from the fluid sim is used to displace the UVs of the existing preset shader. The fluid sim runs in the background, and its velocity texture is sampled as an offset map. Best for: aurora, voronoi, geometric, particles.

Both strategies use the same FBO infrastructure. The only difference is what gets advected through the velocity field.

---

## Additional Shader Configuration Keys

New `tokenOverrides` entries for fluid configuration:

```
'fluid-enabled': 'true' | 'false'          // Enable fluid interaction (default: true when shader active)
'fluid-force': '0.5'                       // Mouse force multiplier (0.1 - 2.0)
'fluid-dissipation': '0.97'                // How fast dye/velocity fades (0.9 = fast, 0.999 = slow)
'fluid-curl': '30'                         // Curl intensity for vortex behavior (0 - 100)
'fluid-radius': '0.3'                      // Mouse splat radius (0.1 - 1.0)
'fluid-ambient': 'true' | 'false'          // Ambient dye injection even without mouse
```

These add to `BRAND_PREFIX_KEYS` as `--brand-fluid-*` CSS properties.

---

## Performance Characteristics

| Configuration | Passes/Frame | Desktop (ms) | Mobile (ms) | Visual Quality |
|---------------|-------------|-------------|-------------|----------------|
| Full fluid (256×256, 10 Jacobi) | ~18 | 2-4ms | 4-8ms | Excellent — real curling, vortices |
| Simplified (128×128, curl noise) | ~5 | 0.5-1ms | 1-2ms | Good — momentum, spreading, no vortices |
| Stateless (current model) | 1 | 0.2-0.5ms | 0.3-0.8ms | Basic — displacement only |

**Mobile target**: Simplified fluid at 128×128 = ~2ms per frame = well within 30fps budget.

---

## Reference Implementation

Primary reference: **Pavel Dobryakov's WebGL-Fluid-Simulation**
- GitHub: github.com/PavelDoGreat/WebGL-Fluid-Simulation
- License: MIT
- Architecture: WebGL2 with WebGL1 fallback, configurable sim resolution, bloom post-processing
- Key shaders to study: `splatShader`, `advectionShader`, `divergenceShader`, `pressureShader`, `gradientSubtractShader`

This implementation can be adapted directly for our renderer. The main integration point is replacing Dobryakov's standalone color injection with our brand-color-driven preset system.

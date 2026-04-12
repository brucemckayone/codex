# 13 — Revised Shader Approach (Post-Shadertoy Research)

**Purpose**: Fundamentally rethink the shader system based on user feedback and Shadertoy reference analysis. The current presets are broken and the interaction model needs a complete rebuild.

**Status**: Research complete, prototype rebuild needed

---

## What Changed

The user provided 11 Shadertoy references and rated the current prototypes as "totally broken" and "amateurish." Analysis of the references reveals:

1. **The best interactive shaders use 2 passes, not 25.** XddSRX (Suture Fluid) achieves stunning fluid interaction with a single feedback buffer + display pass. Our 25-pass Navier-Stokes is over-engineered.

2. **Reaction-Diffusion-Advection (RDA) looks more organic than Navier-Stokes.** The viscous fingering, branching, and self-organizing patterns from RDA are more visually interesting than standard fluid flow.

3. **Domain warping (IQ's lsl3RH) is the gold standard for brandable procedural texture.** `fbm(p + fbm(p + fbm(p)))` with brand palette injection. Single-pass, ~80 lines, beautiful output.

4. **The mouse interaction should be hover-based, not click-based.** Website heroes respond to cursor movement, not clicks. The `exp(-length(d)/radius) * normalize(d)` force model from XddSRX is the pattern.

5. **Logo-as-SDF is a new feature possibility.** The ssjyWc reference shows shapes rendered via signed distance fields — an org's logo could be fed as an SDF texture and rendered with fluid effects.

---

## New Architecture: 2-Pass Hybrid

### Pass 1: Simulation Buffer (feedback loop)

A single RGBA16F texture stores `vec4(velocityX, velocityY, divergence, dye)` per pixel at simulation resolution (256×256).

Each frame:
1. Read previous state
2. Compute Laplacian (3×3 stencil)
3. Compute curl and divergence
4. Reverse-advect (sample upstream)
5. Apply curl-driven rotation
6. Apply divergence pressure feedback
7. Apply mouse force (Gaussian splat in velocity direction)
8. Blend old and new state

All in **one shader**, one draw call, one FBO ping-pong.

### Pass 2: Display (to screen)

Read the simulation buffer + brand colors → produce final output.

Options for display:
- **Pure fluid colorization**: Map velocity field direction/magnitude to brand palette via `cross()` product (XddSRX approach)
- **Fluid-warped domain noise**: Use velocity field to distort IQ-style domain warping with brand palette (lsl3RH approach)
- **Fluid + procedural hybrid**: Background is domain-warped noise, fluid distorts it in real-time

### Total: 2 render passes per frame, ~3 FBOs (2 for ping-pong sim + 1 display)

---

## Revised Preset Categories

Based on Shadertoy analysis, the presets should be:

### Category 1: Fluid Painting (reaction-diffusion-advection)

Based on XddSRX. The simulation IS the visual. Mouse paints fluid.

| Preset | Variation | Visual |
|--------|-----------|--------|
| `fluid-marble` | Low curl, high divergence feedback | Marble/veined stone patterns |
| `fluid-organic` | High curl, low divergence | Bacterial growth, coral branching |
| `fluid-silk` | Balanced, high advection smoothing | Flowing silk fabric |

### Category 2: Interactive Textures (domain warping + fluid distortion)

Based on lsl3RH. Background is procedural, fluid distorts it.

| Preset | Variation | Visual |
|--------|-----------|--------|
| `warp-clouds` | FBM domain warping, soft colors | Moving cloudscape |
| `warp-fire` | High-frequency warp, warm palette | Molten lava / fire |
| `warp-water` | Low frequency, blue palette, caustic highlights | Deep water |

### Category 3: Geometric + Fluid

Based on WdB3Dw + XddSRX. Geometric patterns distorted by fluid field.

| Preset | Variation | Visual |
|--------|-----------|--------|
| `geo-mandala` | Polar symmetry + fluid bend | Sacred geometry in motion |
| `geo-grid` | Cartesian grid + fluid warp | Distorted wireframe |

### Category 4: Ambient (minimal, text-friendly)

Based on ltj3Wc and user's "really simple beautiful" feedback.

| Preset | Variation | Visual |
|--------|-----------|--------|
| `ambient-glow` | Soft color gradients, very slow | Subtle brand color shifts |
| `ambient-mist` | Low-opacity noise, fog-like | Atmospheric depth |

---

## Mouse Interaction Model (Revised)

### Always-on Hover (Not Click-Based)

```javascript
// Track mouse position continuously (hover, not click)
canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  prevMX = mouseX;
  prevMY = mouseY;
  mouseX = (e.clientX - r.left) / r.width;
  mouseY = 1.0 - (e.clientY - r.top) / r.height;
  
  // Compute velocity for directional force
  mouseVelX = (mouseX - prevMX) * forceMultiplier;
  mouseVelY = (mouseY - prevMY) * forceMultiplier;
});
```

### GLSL Force Application (from XddSRX)

```glsl
// In simulation buffer shader
vec2 mouseForce(vec2 uv, vec2 mousePos, vec2 mouseVel, float radius) {
  vec2 d = uv - mousePos;
  float m = exp(-dot(d, d) / (radius * radius));
  
  // Directional force: push in mouse movement direction
  vec2 force = mouseVel * m;
  
  // Radial force: also push outward from cursor (subtle)
  force += normalize(d + 0.0001) * m * 0.3;
  
  return force;
}
```

### Click for Burst

Click adds a large-radius dye burst + radial velocity explosion:
```glsl
if (clickActive) {
  float burst = exp(-dot(d, d) / (burstRadius * burstRadius));
  velocity += normalize(d + 0.0001) * burst * burstStrength;
  dye += brandColor * burst;
}
```

---

## Colorization Strategies

### Strategy A: Vector Field → Color (XddSRX approach)

```glsl
// Map velocity direction to hue, magnitude to brightness
vec3 velColor = cross(normalize(vec3(velocity, 0.0)), vec3(brandVector, 1.0));
vec3 color = mix(brandPrimary, brandAccent, velColor.z * 0.5 + 0.5);
color *= 0.5 + length(velocity) * 2.0; // Brightness from magnitude
```

### Strategy B: Domain Warp → Palette (lsl3RH approach)

```glsl
// Use velocity field to offset domain warping input
vec2 warpedUV = uv + velocity * warpStrength;
float n = fbm(warpedUV + fbm(warpedUV + time));
vec3 color = oklabPalette(n, brandPrimary, brandSecondary, brandAccent);
```

### Strategy C: Hybrid (Fluid dye + Procedural background)

```glsl
// Background: domain-warped noise
vec3 bg = oklabPalette(fbm(uv + time), brandPrimary, brandSecondary, brandAccent);
// Overlay: fluid dye from simulation
vec3 fluidColor = dyeValue * brandAccent;
// Composite: screen blend
vec3 color = blendScreen(bg * 0.6, fluidColor);
```

---

## Key References

| Shadertoy | Technique | What We Take |
|-----------|-----------|-------------|
| **XddSRX** (Suture Fluid) | RDA in single buffer | The entire simulation approach + mouse force pattern |
| **lsl3RH** (Warping procedural 2) | Domain warping FBM | Brandable procedural texture generation |
| **4dcGW2** (Expansive R-D) | Vortex pair mouse + bump lighting | Mouse velocity tracking, directional forces |
| **ltj3Wc** (Brush Experiment) | Procedural brush strokes | Ink/calligraphy aesthetic, noise-based fiber rendering |
| **Mt33DH** (Rain Water Ripple) | Analytical ripples + refraction | Water surface effect, normal-based refraction |
| **MsjSW3** | Metaball SDF rendering | Interactive blob following cursor |
| **ssjyWc** | Shape SDF drawing | Logo-as-SDF rendering (future feature) |
| **WdVXWy** | Fluid overlay | Subtlety control — "too intense" feedback |
| **XddSRX** (again) | 2-pass architecture | Proof that 2 passes suffice for premium quality |

---

## Implementation Priority

### Phase 1: Core Engine Rebuild (2-pass RDA)
- Replace 25-pass Navier-Stokes with 2-pass RDA based on XddSRX
- Implement hover-based mouse force with velocity tracking
- Single simulation buffer: `vec4(velX, velY, divergence, dye)`
- Verify on mobile at 128×128 sim resolution

### Phase 2: Display Presets (using the shared sim buffer)
- 3-4 display presets that read the sim buffer differently
- Each preset is just a different display pass shader (1 draw call)
- All share the same simulation — switching presets is instant

### Phase 3: Domain Warp Integration
- Add IQ-style domain warping to display presets
- Fluid velocity warps the noise field for "interactive texture" presets

### Phase 4: Polish
- Film grain, vignette, tone mapping in display pass
- OKLAB color blending for dark palettes
- Ambient mode for subtle, text-friendly backgrounds

---

## Logo-as-SDF (Future Feature)

From ssjyWc research — an org's logo could be rendered as a signed distance field with fluid effects:

**Pipeline**: SVG upload → `webgl-sdf-generator` (GPU-accelerated, accepts SVG path commands) → SDF texture → shader reads SDF for boundary rendering with fluid distortion

**Tools**: 
- `webgl-sdf-generator` by lojjic (GPU-accelerated, accepts M/L/Q/C/Z path commands)
- `msdfgen` by Chlumsky (multi-channel SDF for sharp corners)
- `SDFMaker` by jobtalle (SVG → raster → SDF PNG)

**Approach**: Render org logo as SDF texture. In the display shader, use the SDF boundary (distance = 0 contour) as a constraint for fluid effects — fluid flows along/around the logo shape. The logo feels "alive" with organic wobble.

This is a Phase 5+ feature — requires logo texture upload infrastructure. But the technique is proven and the tools exist.

## Overlay Subtlety (from WdVXWy feedback)

The user said the WdVXWy fluid overlay was "too intense." Three solutions for production:

1. **Alpha compositing**: Render to FBO, composite over content at 15-30% opacity
2. **Color clamping**: Multiply output RGB by 0.15-0.3, use brand colors as dye palette
3. **CSS blend mode**: Canvas with `mix-blend-mode: soft-light` behind content

For hero section: use strategy 2 (color clamping in the display shader). The brand colors are already muted relative to saturated primaries. The `postProcess` pipeline (vignette, tone mapping) further tames intensity.

## What Gets Deleted

The current `unified.html` with its 25-pass Navier-Stokes and 8 broken presets should be replaced with a clean rebuild based on this architecture. The RDA approach from XddSRX is both simpler AND produces more interesting patterns than full NS.

# Immersive Audio-Reactive Shader Mode

## Vision

When a creator assigns a shader preset to their audio content, listeners can enter a fullscreen immersive mode where the shader responds in real-time to the audio's frequency spectrum. Bass pulses drive wave heights, mids modulate colour shifts, treble adds shimmer — the listener is inside the graphic, not just hearing the audio.

---

## Audio Analyser

### Module: `audio-analyser.ts`

**Location**: `apps/web/src/lib/components/AudioPlayer/audio-analyser.ts`

### Interface

```typescript
export interface AudioAnalysis {
  /** Low-frequency energy, normalised 0-1 (bins 0-10) */
  bass: number;
  /** Mid-frequency energy, normalised 0-1 (bins 10-100) */
  mids: number;
  /** High-frequency energy, normalised 0-1 (bins 100-256) */
  treble: number;
  /** Overall amplitude, normalised 0-1 */
  amplitude: number;
  /** Whether audio is currently playing */
  active: boolean;
}

export interface AudioAnalyserHandle {
  /** Get current frequency analysis (call per frame) */
  getAnalysis(): AudioAnalysis;
  /** Resume AudioContext after user gesture */
  resume(): Promise<void>;
  /** Clean up AudioContext and nodes */
  destroy(): void;
}

export function createAudioAnalyser(
  audioElement: HTMLAudioElement,
  fftSize?: number
): AudioAnalyserHandle;
```

### Implementation Notes

1. **Lazy initialisation**: Created only when user clicks "Immersive Mode". No Web Audio overhead during standard playback.

2. **Single MediaElementSource**: `createMediaElementSource()` can only be called once per `<audio>` element. The analyser handle must be stored at the `AudioPlayer` level and reused across immersive mode enter/exit cycles.

3. **User gesture requirement**: `AudioContext` starts in `suspended` state. `resume()` must be called within the click handler that enters immersive mode.

4. **CORS**: The `<audio>` element must have `crossorigin="anonymous"`. R2 signed URLs already include CORS headers.

5. **Pass-through**: Audio routes through `AnalyserNode` → `ctx.destination` (speakers). The analyser is a passive tap — no effect on audio quality.

### Frequency Band Calculation

```typescript
function computeBands(frequencyData: Uint8Array): { bass: number; mids: number; treble: number; amplitude: number } {
  const binCount = frequencyData.length; // fftSize / 2 = 256 for fftSize=512
  
  // Bass: bins 0-10 (~0-860Hz at 44.1kHz)
  const bass = averageRange(frequencyData, 0, 10) / 255;
  
  // Mids: bins 10-100 (~860-8600Hz)
  const mids = averageRange(frequencyData, 10, 100) / 255;
  
  // Treble: bins 100-256 (~8600-22050Hz)
  const treble = averageRange(frequencyData, 100, binCount) / 255;
  
  // Overall amplitude
  const amplitude = averageRange(frequencyData, 0, binCount) / 255;
  
  return { bass, mids, treble, amplitude };
}
```

---

## Renderer Integration

### AudioState Interface

**File**: `apps/web/src/lib/components/ui/ShaderHero/renderer-types.ts`

```typescript
export interface AudioState {
  /** Bass energy, normalised 0-1 */
  bass: number;
  /** Mid-range energy, normalised 0-1 */
  mids: number;
  /** Treble energy, normalised 0-1 */
  treble: number;
  /** Overall amplitude, normalised 0-1 */
  amplitude: number;
  /** Whether audio is actively playing */
  active: boolean;
}
```

### Extended `render()` Signature

```typescript
render(
  gl: WebGL2RenderingContext,
  time: number,
  mouse: MouseState,
  config: ShaderConfig,
  width: number,
  height: number,
  audio?: AudioState  // NEW — optional, backward-compatible
): void;
```

All 40 existing renderers ignore the extra parameter (JavaScript ignores surplus arguments). Renderers opt in to audio reactivity by reading `audio?.bass ?? 0` etc.

---

## ImmersiveShaderPlayer Component

**Location**: `apps/web/src/lib/components/AudioPlayer/ImmersiveShaderPlayer.svelte`

### Props

```typescript
interface Props {
  audioElement: HTMLAudioElement;
  analyser: AudioAnalyserHandle;
  shaderPreset: ShaderPresetId;
  shaderConfig?: Record<string, number | boolean> | null;
  onclose: () => void;
}
```

### Layout

```
┌─────────────────────────────────────────────┐
│                                             │
│                                             │
│          Fullscreen Shader Canvas           │
│          (driven by audio + mouse)          │
│                                             │
│                                             │
│                                     [✕]     │
│                                             │
│  ━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  ▶  2:34 / 5:12           🔊 ━━━━  1.0x    │
└─────────────────────────────────────────────┘
```

### Behaviour

1. **Mount**: Create own `<canvas>` + `WebGL2RenderingContext`
2. **Load renderer**: Same `loadRenderer(preset)` factory used by ShaderHero (dynamic import)
3. **Render loop** (requestAnimationFrame):
   ```
   analyser.getAnalysis() → AudioAnalysis
   Construct AudioState from analysis
   Track mouse from pointermove/pointerdown on canvas
   renderer.render(gl, time, mouse, config, w, h, audioState)
   ```
4. **Fullscreen**: Use `document.documentElement.requestFullscreen()` on mount. Fallback to fixed overlay if Fullscreen API denied.
5. **Controls**: Overlay at bottom with semi-transparent background. Fade out after 3s of no interaction. Show on mouse move.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Escape | Exit immersive mode |
| Space | Toggle play/pause |
| Arrow Left/Right | Seek ±10s |
| M | Toggle mute |

### Resource Management

- **WebGL context**: Created fresh for the immersive canvas. Destroyed on exit.
- **AudioContext**: NOT destroyed on exit — reused if user re-enters immersive mode (single MediaElementSource constraint).
- **Background ShaderHero**: Auto-pauses via its existing visibility detection when the fullscreen overlay covers the page.
- **Memory**: Renderer `destroy()` called on exit to free programs, FBOs, textures.

---

## Audio-Reactive Shader Presets (Initial Set)

8 presets with natural audio mappings. Each gets `uAudioBass`, `uAudioMids`, `uAudioTreble`, `uAudioAmplitude` uniforms.

### pulse
**Mapping**: Bass → wave surface height amplitude, mids → ripple propagation frequency
**Effect**: The liquid surface surges with bass hits, faster ripples on vocal/instrument mids

### aurora
**Mapping**: Bass → curtain sway intensity, treble → shimmer speed
**Effect**: Northern lights billow with low-end, sparkle with high-frequency detail

### nebula
**Mapping**: Amplitude → cloud density/brightness, bass → colour shift toward accent
**Effect**: Cosmic dust brightens with volume, colour-shifts on bass drops

### plasma
**Mapping**: Bass → R channel intensity, mids → G channel, treble → B channel
**Effect**: RGB fluid streams respond independently to frequency bands

### ripple
**Mapping**: Bass → wave impulses (replaces mouse click bursts), amplitude → damping reduction
**Effect**: Water surface ripples autonomously with every bass hit

### silk
**Mapping**: Amplitude → fabric flow speed, mids → fold complexity
**Effect**: Silk flows faster and more complex with louder, richer audio

### caustic
**Mapping**: Bass → refraction intensity, treble → caustic pattern speed
**Effect**: Underwater light patterns intensify with bass, shimmer with treble

### flux
**Mapping**: Mids → field line speed, bass → line thickness/glow
**Effect**: Magnetic field lines accelerate with mids, thicken with bass energy

### GLSL Example (pulse-sim.frag.ts)

```glsl
// Existing uniforms
uniform float uForce;
uniform vec2 uMouse;
uniform float uMouseActive;

// NEW audio uniforms
uniform float uAudioBass;
uniform float uAudioMids;
uniform float uAudioTreble;
uniform float uAudioAmplitude;

void main() {
  // ... existing simulation code ...
  
  // Modulate wave height with bass
  float heightScale = 1.0 + uAudioBass * 2.5;
  waveHeight *= heightScale;
  
  // Add bass-driven impulse at centre (like a virtual click)
  if (uAudioBass > 0.6) {
    float dist = length(v_uv - vec2(0.5));
    float impulse = smoothstep(0.3, 0.0, dist) * uAudioBass * 0.5;
    state.r += impulse;
  }
  
  // Ripple frequency from mids
  float rippleSpeed = baseSpeed * (1.0 + uAudioMids * 1.5);
}
```

---

## Lifecycle Summary

```
Standard Playback
  │
  └── User clicks "Immersive Mode" button
        │
        ├── AudioPlayer creates AudioAnalyser (lazy, first time only)
        │   └── AudioContext + MediaElementSource + AnalyserNode
        │
        ├── AudioPlayer sets showImmersive = true
        │
        └── ImmersiveShaderPlayer mounts
              ├── Creates canvas + WebGL2 context
              ├── Loads shader renderer
              ├── Enters Fullscreen API
              └── Render loop (audio + mouse → shader)
                    │
                    └── User presses Escape / clicks Close
                          ├── Exits fullscreen
                          ├── Destroys renderer + WebGL context
                          ├── AudioAnalyser kept alive (reusable)
                          └── AudioPlayer sets showImmersive = false
                                └── Standard playback continues
```

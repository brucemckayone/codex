# Shader Improvement Brief

**Read this before touching any shader.** It is the shared contract for the
2026-09 shader overhaul. Every agent working on a preset family follows it.

---

## 1. What we are fixing

Three defects, present across most of the 41 presets.

### 1.1 Jerky motion

The dominant defect, and the one the owner called out by name: *"the ones that
sort of have this really jerky camera movement are no good."*

The cause is nearly always the same shape:

```glsl
// BAD — the mechanical sweep
p.x += sin(u_time * u_speed * 0.05) * 0.5;
ro.xz += vec2(sin(u_time), cos(u_time)) * 3.0;
mat3 rot = rotateY(u_time * 0.3);
```

A single sine at a visible frequency has no acceleration profile, so the eye
reads each turnaround as a stop-and-reverse. Worse, a `speed` slider multiplies
the *frequency*, so turning it up converts drift into a lurch.

**The fix** is `drift3()` / `driftAxis()` from `motion-glsl.ts`: three
incommensurate low-frequency components per axis. Their sum has an analytically
bounded derivative and an effectively unbounded period, so there is no visible
loop and no choice of amplitude can make it snap.

```glsl
// GOOD
vec3 wander = drift3(clock, 3.1) * 1.4;
```

For raymarched presets, use `orbitCamera()`. It rebuilds the basis from a
look-at every frame, so drift in position can never become drift in aim — the
classic cause of a shot sliding off its subject.

**Angular velocity, not position, is what reads as jerk.** For `A*sin(w*t)` the
peak rate is `A*w`. Keep the sum of `A*w` across components under ~0.25 rad/s
for a background. Above ~0.6 rad/s it reads as a camera move and starts
competing with the hero text sitting on top of it.

### 1.2 Motion that is GOOD — do not remove it

The owner was specific: *"the ones that follow the most are pretty good, like
the ones that affect the outline of the shader in some way. That's good."*

**Keep and strengthen:**

- Mouse/pointer follow — the one motion the viewer causes directly. It reads as
  responsive. If it is missing, consider adding it.
- Click/tap burst (`u_burstStrength`).
- Motion that deforms an outline, edge, or silhouette.
- Internal flow (fluid advection, curl noise, growth fronts) — that is the
  effect itself, not camera movement.

**Remove or tame:** whole-frame translation, rotation, and zoom driven by
wall-clock time. That is what the owner is objecting to.

Fix any per-frame damping constant you find, too:
`lerped += (target - lerped) * 0.04` converges twice as fast at 120Hz as at
60Hz. Use `createDeltaClock()` and `1 - Math.exp(-dt / tau)`.

### 1.3 No audio reactivity

Only 5 of 41 presets upload audio uniforms. The other 36 accept
`audio?: AudioState` in `render()` and silently discard it — so nothing errors,
the shader just sits inert while music plays. A handful do
`speed + amplitude * 0.15`, which uses the *raw* noisy amplitude and reads as
jitter rather than music.

---

## 2. The shared substrate

Three files. **You may read them. You may NOT edit them.** They are shared by
every preset; a change breaks all of them at once.

| File | Provides |
|---|---|
| `ShaderHero/audio-glsl.ts` | `AUDIO_UNIFORMS`, `AUDIO_HELPERS` — GLSL |
| `ShaderHero/motion-glsl.ts` | `MOTION_HELPERS` — GLSL drift/camera/easing |
| `ShaderHero/audio-uniforms.ts` | `AUDIO_UNIFORM_NAMES`, `createAudioFade()`, `createDeltaClock()`, `uploadAudioUniforms()` — TypeScript |

### 2.1 Reference implementation

**Read these two files first.** They are the worked example and they are known
to compile and to follow every rule in this brief:

- `ShaderHero/shaders/vapor.frag.ts`
- `ShaderHero/renderers/vapor-renderer.ts`

Vapor had all three defects and now has none. Follow its shape.

### 2.2 Renderer integration — the whole thing

```ts
import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';

const UNIFORM_NAMES = [
  'u_time', 'u_resolution', /* ...yours... */
  ...AUDIO_UNIFORM_NAMES,
] as const;

export function createFooRenderer(): ShaderRenderer {
  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  return {
    render(gl, time, mouse, config, width, height, audio?: AudioState) {
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      gl.useProgram(program);
      // ...your uniforms...
      uploadAudioUniforms(gl, uniforms, a);
      drawQuad(gl);
    },
  };
}
```

`createAudioFade()` and `createDeltaClock()` must be **per renderer instance**,
created inside `createFooRenderer()` — never module-level. Two live renderers (a
hero and an immersive overlay) would otherwise share and fight over the state.

### 2.3 Shader integration

```ts
import { AUDIO_HELPERS, AUDIO_UNIFORMS } from '../audio-glsl';
import { MOTION_HELPERS } from '../motion-glsl';

export const FOO_FRAG = `#version 300 es
precision highp float;
// ...your uniforms...
${AUDIO_UNIFORMS}
${AUDIO_HELPERS}
${MOTION_HELPERS}
// ...your code...
`;
```

Order matters: `AUDIO_UNIFORMS` before `AUDIO_HELPERS` (the helpers reference the
uniforms). Declare the whole uniform block even if you use three of them —
unused uniforms are stripped by the compiler at zero cost, and a conditionally
declared uniform would make `uploadAudioUniforms` a per-preset special case.

### 2.4 Available audio signals

| Uniform | Range | Character | Use for |
|---|---|---|---|
| `u_audioActive` | 0..1 | smooth ramp | **gate every audio term on this** |
| `u_bass` | 0..1 | smoothed, fast attack | body, weight, thickness |
| `u_mids` | 0..1 | smoothed | mid detail |
| `u_treble` | 0..1 | smoothed, snappy | sparkle, fine detail |
| `u_level` | 0..1 | smoothed amplitude | overall presence |
| `u_beatPulse` | 0..1 | spike, 400ms half-life | beat-synced hits |
| `u_energy` | 0..1 | **very slow** (tau 4s) | macro: bloom, density, palette |
| `u_flux` | 0..1 | noisy by design | grain, sparkle — **colour only** |
| `u_centroid` | 0..1 | timbral brightness | hue, warmth, temperature |
| `u_beatPhase` | unbounded | musical clock | **internal motion** |
| `u_beatSeed` | 0..1 | re-rolled per onset | per-beat random choices |

Helpers: `audioMod(sig, depth)` (bounded around 1.0), `audioLift(sig, depth)`
(one-sided, never dips below resting), `beatHit(sharpness)`,
`audioHueShift(depth)`, `audioTint(base, target, sig, depth)`,
`audioBreath(phase)`.

### 2.5 The four rules of good audio reactivity

1. **Never drive geometry from a raw band.** `u_flux` and instantaneous band
   energy go on colour, brightness, grain, detail density. Shape, camera and
   flow direction come from `u_energy` (slow) or `u_beatPhase` (integrated) —
   both C1-continuous by construction.

2. **`u_beatPhase` REPLACES `u_time` for internal motion, not adds to it.** This
   is the single biggest quality lever. A preset driven by `u_beatPhase` freezes
   when the music stops and eases back in; one driven by `u_time` runs at a
   constant rate with a wobble bolted on. Crossfade so hero mode still moves:

   ```glsl
   float clock = mix(u_time * 0.5, u_beatPhase, u_audioActive) * u_speed;
   ```

3. **Gate on `u_audioActive`, which is a smooth 0..1 ramp, not a boolean.** At 0
   the render must be exactly the silent look. Never branch the *look* on a
   boolean — it pops on the first beat.

4. **Budget ±25%.** Audio modulates an existing look; it does not redefine it.
   If audio can double a value, the silent state was too timid — raise the base
   instead.

---

## 3. Performance

Measured per-pixel march budgets, worst first: `tunnel` 128 steps, `julia` 100,
`gyroid` 80, `pearl` 64, `vortex` 60, `nebula` 16.

Techniques that buy real quality per cycle:

- **Dither the march start offset** by a per-pixel hash. Converts stair-step
  banding into fine noise, which the existing film grain masks. This routinely
  lets you cut step count 30% at equal or better appearance — it is how vapor
  went 80 → 56.
- **Early exit** on accumulated alpha/opacity, and on distance for SDFs.
- **Hoist loop-invariant work** out of the march. Anything not depending on the
  step index belongs above the loop.
- **Avoid divides in the hot loop.** vapor's per-step normalised 3-weight
  palette blend became two nested `smootherstep` mixes: cheaper *and* monotone.
- **No dynamic branches in the inner loop** where a `mix`/`step` will do.
- Prefer `smootherstep` over `smoothstep` where the result drives a position —
  smoothstep's acceleration discontinuity is visible on slow moves.

Do not trade correctness for speed. A preset that renders a black frame fast is
worse than one that renders beautifully at 45fps.

---

## 4. Colour

Every preset gets four colour slots — `u_brandPrimary`, `u_brandSecondary`,
`u_brandAccent`, `u_bgColor` — resolved by `getShaderConfig()`. As of this epic
a creator can either match their brand palette (the default) or set a separate
shader palette in the brand editor. **Nothing for you to wire**: the uniforms
arrive already resolved.

What this means for you: the palette is *user-chosen*, so
- never hardcode a hue that fights the brand colours;
- keep all three brand stops visibly distinguishable in the output — if two of
  them land on top of each other, a creator's palette choice does nothing;
- `u_bgColor` may be light or dark. Test both. A shader that assumes a dark
  background breaks on a light brand.

`computeImmersiveColours()` exists for palette cycling under audio, but skip it
where the preset derives a depth or structural cue from the three stops —
cycling them then fights the cue. vapor documents that call.

---

## 5. Territory and hard rules

**You own exactly the files listed in your task prompt** — normally
`shaders/{name}*.frag.ts` and `renderers/{name}-renderer.ts` for each preset in
your family.

**Do NOT edit, for any reason:**

- `audio-glsl.ts`, `motion-glsl.ts`, `audio-uniforms.ts`, `renderer-types.ts`,
  `webgl-utils.ts`, `immersive-colours.ts`
- `shader-config.ts`, `css-injection.ts`, `hero-fx-presets.ts`, `defaults.ts`,
  `BrandEditorHeroEffects.svelte`, `ShaderHero.svelte`, `load-renderer.ts`
- any file belonging to a preset outside your family
- `package.json`, any lockfile, any CI config

If your work needs a change in one of those, **describe it under `handoffs` in
your report and move on.** Do not edit it. A stated boundary is not enforced by
anything but you, and a silent clobber of a shared file breaks every other
agent's work. This rule is the load-bearing one.

**Do NOT add new config keys.** Audio is runtime state, not brand
configuration. Adding a key means touching four shared files. If a preset truly
needs a new slider, hand it off.

**Do NOT run:** any `git` command, `pnpm install`, `pnpm build`, `pnpm dev`,
root `pnpm test` (it points at the shared dev database), or any repo-wide gate.
The orchestrator owns all of those.

---

## 6. Your gate — non-negotiable

```bash
cd apps/web && node scripts/validate-shaders.mjs <preset-name>
```

This compiles your GLSL with `glslangValidator`. **It must pass before you
report done.** A GLSL error is invisible to `tsc`, `biome`, `svelte-check` and
the unit tests — the shader is just a string until a browser compiles it, where
failure surfaces as a silent black canvas.

This is not hypothetical: `spore-sim.frag.ts` declared `bool active`, and
`active` is a **reserved word** in GLSL ES 3.00. That preset had never compiled
and rendered nothing in production. Nobody noticed.

Watch for reserved words. GLSL ES 3.00 §3.7 reserves, among others: `active`,
`common`, `partition`, `asm`, `class`, `union`, `enum`, `typedef`, `template`,
`this`, `packed`, `goto`, `inline`, `noinline`, `public`, `static`, `extern`,
`external`, `interface`, `long`, `short`, `double`, `half`, `fixed`,
`unsigned`, `input`, `output`, `filter`, `sizeof`, `cast`, `namespace`, `using`.

Also verify your shader cannot render an all-black frame: check that the base
(silent, no-mouse, `t=0`) path produces visible output.

---

## 7. Research

You may look at published techniques for inspiration — Shadertoy, Inigo
Quilez's articles, GPU Gems, papers. **Write your own implementation.** Do not
copy code, and do not paste licensed source into the repo. Take the *idea*
(a distance estimator, a tonemap curve, a noise construction) and implement it
in the idiom of this codebase. Do not add attribution comments naming a source
you did not copy from — describe the technique instead.

---

## 8. Report format

```
## <preset name>
motion:   what jerk you removed, what follow-motion you kept or added
audio:    which signals drive what, and why that mapping
perf:     step counts / ALU before → after, and what bought it
colour:   how the four brand slots map, light-bg behaviour
gate:     output of validate-shaders.mjs
risks:    anything you are unsure of
handoffs: changes needed OUTSIDE your territory (do not make them)
```

Be concrete. "Improved the motion" is not a report; "replaced a single
0.05Hz sine on p.x with drift3 at amplitude 1.4, peak rate 0.087 rad/s" is.

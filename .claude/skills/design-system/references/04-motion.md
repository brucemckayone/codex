# Reference 04 — Motion

Disney's 12 Animation Principles mapped to CSS + Svelte patterns available in this codebase.
How to build motion that feels alive without breaking accessibility, performance, or brand
consistency.

## 1. Motion Tokens (Source of Truth)

From `apps/web/src/lib/styles/tokens/motion.css`:

| Token | Value | When to use |
|---|---|---|
| `--duration-fast` | `100ms` | Micro-interactions (hover colour change, focus ring) |
| `--duration-normal` | `200ms` | Standard transforms (scale, translate), opacity fades |
| `--duration-slow` | `300ms` | Card lifts, reveal animations |
| `--duration-slower` | `500ms` | Large reveals, page-level transitions, image zoom |
| `--ease-default` | `cubic-bezier(0.4, 0, 0.2, 1)` | Material Design standard — safe default |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Accelerating out (element leaving) |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Decelerating in (element arriving) |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Symmetric — state changes in both directions |
| `--ease-bounce` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Overshoot + settle — playful |
| `--ease-smooth` | `cubic-bezier(0.16, 1, 0.3, 1)` | Custom brand curve — premium feel |
| `--ease-spring` | `cubic-bezier(0.22, 1.2, 0.36, 1)` | Strong overshoot — "boing" |
| `--transition-colors` | `color, background-color, border-color var(--duration-fast) var(--ease-default)` | Interactive hover states |
| `--transition-transform` | `transform var(--duration-normal) var(--ease-out)` | Arrival motion |
| `--transition-opacity` | `opacity var(--duration-normal) var(--ease-default)` | Fades |
| `--transition-shadow` | `box-shadow var(--duration-normal) var(--ease-default)` | Elevation changes |

## 2. Reduced Motion — Inviolable

`motion.css` already collapses all duration tokens to `0.01ms` inside
`@media (prefers-reduced-motion: reduce)`. You **never** need to write reduced-motion
branches yourself — as long as you use the tokens.

```css
/* CORRECT — token-driven, reduced-motion automatic */
.card {
  transition: transform var(--duration-normal) var(--ease-spring);
}

/* WRONG — hardcoded, bypasses the reduced-motion collapse */
.card {
  transition: transform 200ms cubic-bezier(0.22, 1.2, 0.36, 1);
}
```

If you genuinely need a non-reduced effect to still play (e.g., a critical UX signal), wrap
*that* rule in its own `@media (prefers-reduced-motion: no-preference)` — never bypass the
global collapse.

### 🚨 Svelte transition directives bypass the token collapse

**Caught in iter-01 (FontPicker), iter-03 (pricing page), iter-04 (BrandEditorPanel × 3) — this is the single most recurrent a11y regression in the repo.**

The reduced-motion collapse in `motion.css` only affects **CSS** transitions/animations.
Svelte's `transition:` directives (`transition:fly`, `transition:fade`, `transition:scale`,
`transition:slide`, `transition:blur`, custom transitions) take **raw JS numbers** for
duration and are NOT affected by the token override:

```svelte
<!-- WRONG — 150ms plays even when user has prefers-reduced-motion: reduce -->
<div transition:fly={{ y: -5, duration: 150 }}>…</div>
```

**Fix options (in preference order):**

1. **Skip the directive entirely** when Melt UI / CSS handles the transition. Most dropdowns,
   dialogs, popovers can use `@starting-style` + CSS instead.
2. **Gate the directive** with a reduced-motion check. No shared utility exists today — use
   a local `$effect`-backed `matchMedia` binding (or extract to `$lib/utils/motion.ts` once
   the pattern has 2+ consumers):
   ```svelte
   <script>
     let rm = $state(false);
     $effect(() => {
       const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
       rm = mq.matches;
       const handler = (e: MediaQueryListEvent) => { rm = e.matches; };
       mq.addEventListener('change', handler);
       return () => mq.removeEventListener('change', handler);
     });
   </script>
   {#if !rm}
     <div transition:fly={{ y: -5, duration: 150 }}>…</div>
   {:else}
     <div>…</div>
   {/if}
   ```
3. **Read the token at runtime** (last resort — non-reactive to OS pref changes during the session):
   ```ts
   const duration = parseFloat(getComputedStyle(document.documentElement)
     .getPropertyValue('--duration-fast')) || 100;
   ```

`animate:flip` for list reorder is similarly unguarded — wrap it in the same
`reducedMotion()` gate if list reorders are frequent enough to matter.

## 3. The 12 Disney Animation Principles → Web Patterns

Not every principle applies to every interaction, but most can be evoked in 1–3 lines of CSS.
Knowing them by name lets you reach for the right feeling deliberately.

### 1. Squash & Stretch — weight and elasticity

Asymmetric scale communicates mass and impact. Scale one axis more than the other.

```css
@keyframes press {
  0%   { transform: scale(1, 1); }
  50%  { transform: scale(1.05, 0.95); }      /* squash on press */
  100% { transform: scale(1, 1); }
}
.button:active { animation: press var(--duration-fast) var(--ease-default); }
```

**Token**: `--ease-default`, `--duration-fast`.
**When**: button presses, physical-feeling interactions.

### 2. Anticipation — prepare the eye

A tiny reverse-direction motion before the main motion. Signals "something is about to happen."

```css
@keyframes jump {
  0%   { transform: translateY(0); }
  20%  { transform: translateY(4px); }         /* crouch */
  100% { transform: translateY(-12px); }       /* leap */
}
.notify-indicator { animation: jump var(--duration-slow) var(--ease-spring); }
```

**Token**: `--ease-spring` amplifies the anticipation feel.
**When**: unread badges, "hey look at me" moments, error shakes.

### 3. Staging — guide attention

Contrast, layering, and backdrop dim draw the eye. In CSS: z-index tokens + `backdrop-filter`.

```css
.modal-overlay {
  background: var(--color-overlay);
  backdrop-filter: blur(var(--blur-sm));
  z-index: var(--z-modal-backdrop);
}
.modal-content { z-index: var(--z-modal); }
```

**When**: modals, tooltips, any moment where focal hierarchy matters.
**Reference**: [02-css-architecture.md §9](02-css-architecture.md#9-backdrop-filter-with-fallback).

### 4. Straight Ahead vs Pose-to-Pose — keyframes vs transitions

- **Straight ahead** = `@keyframes` with multiple steps. The animation traces a specific path.
- **Pose-to-pose** = `transition` between two states. Browser interpolates.

```css
/* Pose-to-pose — for state changes */
.card {
  transform: translateY(0);
  transition: transform var(--duration-slow) var(--ease-smooth);
}
.card:hover { transform: translateY(-2px); }

/* Straight ahead — for defined choreography */
@keyframes confetti-arc {
  0%   { transform: translate(0, 0) rotate(0deg); }
  50%  { transform: translate(20px, -30px) rotate(180deg); }
  100% { transform: translate(40px, 40px) rotate(360deg); }
}
```

**When**: pose-to-pose is the default. Reach for `@keyframes` when the path matters.

### 5. Follow-Through & Overlapping Action — things settle at different rates

Different parts finish at different times. The last thing to settle is the one with the most
mass/importance.

```css
.drawer {
  transform: translateX(-100%);
  transition: transform var(--duration-slow) var(--ease-smooth);
}
.drawer[data-open="true"] { transform: translateX(0); }

.drawer__content {                                /* settles after the drawer arrives */
  opacity: 0;
  transform: translateX(-8px);
  transition: all var(--duration-slow) var(--ease-smooth);
  transition-delay: calc(var(--duration-slow) * 0.3);
}
.drawer[data-open="true"] .drawer__content {
  opacity: 1;
  transform: translateX(0);
}
```

**Token**: `--ease-spring` for overshoot that continues past target; `--ease-smooth` for
heavy settles.
**When**: drawers, reveal animations, list stagger.

### 6. Slow In & Slow Out — the default curve

Never use `linear` for human-perceived motion. Objects in the real world accelerate and
decelerate. `--ease-default` (Material Design curve) is the baseline; `--ease-smooth` is
the brand-tuned upgrade.

```css
.element { transition: transform var(--duration-normal) var(--ease-smooth); }
```

**When**: everywhere. If you're tempted to use `linear`, you're wrong unless it's a looping
animation (spinner, progress bar).

### 7. Arcs — natural paths

Things in nature don't move in straight lines. Combine translate + rotate, or use
`offset-path`.

```css
@keyframes swoop {
  0%   { offset-distance: 0%; }
  100% { offset-distance: 100%; }
}
.notification {
  offset-path: path("M 0,0 Q 100,-40 200,0");
  animation: swoop var(--duration-slower) var(--ease-smooth);
}
```

For simpler cases, chain translate + rotate:
```css
@keyframes tilt-in {
  0%   { transform: translateY(20px) rotate(-8deg); opacity: 0; }
  100% { transform: translateY(0)    rotate(0deg);  opacity: 1; }
}
```

**When**: organic reveals, notifications, celebration moments.

### 8. Secondary Action — support, don't compete

A main action plus a smaller supporting action. In CSS: child animates on parent `[data-state]`.

```css
.accordion-content {
  max-height: 0;
  transition: max-height var(--duration-slow) var(--ease-smooth);
}
.accordion:global([data-state="open"]) .accordion-content { max-height: 500px; }

.accordion-icon {
  transform: rotate(0deg);
  transition: transform var(--duration-normal) var(--ease-smooth);
}
.accordion:global([data-state="open"]) .accordion-icon { transform: rotate(180deg); }
```

The chevron spinning is secondary — it supports the accordion's open state, doesn't compete.

**When**: Melt UI stateful components, any parent-child animated pair.

### 9. Timing — perceived speed ≠ actual speed

Speed tells you about weight and urgency.

| Feeling | Duration token | Typical use |
|---|---|---|
| Crisp, responsive | `--duration-fast` (100ms) | Colour/opacity hover |
| Smooth, natural | `--duration-normal` (200ms) | Transforms, common transitions |
| Deliberate, heavy | `--duration-slow` (300ms) | Card elevation, medium reveals |
| Cinematic | `--duration-slower` (500ms) | Page-level, image zooms |

**Rule**: pick from the tokens. "Feels slow" usually means you picked the wrong easing, not
the wrong duration.

### 10. Exaggeration — overshoot signals personality

Go past the target, then settle back. That's what `--ease-bounce` and `--ease-spring` do.

```css
.celebrate {
  transform: scale(0);
  transition: transform var(--duration-slower) var(--ease-spring);
}
.celebrate[data-active] { transform: scale(1); }    /* overshoots to ~1.12, settles to 1 */
```

**When**: positive reinforcement (success states, "like" buttons, confetti), brand moments.
**Don't**: use exaggeration on every transition. It loses its power.

### 11. Solid Drawing (3D) — give depth

Rotate in 3D space for a physical feel.

```css
.card {
  transform-style: preserve-3d;
  transition: transform var(--duration-slow) var(--ease-smooth);
}
.card__inner { perspective: 1000px; }
.card:hover { transform: rotateY(8deg) rotateX(-4deg); }
```

**When**: hero cards, premium visual moments, flip interactions.
**Don't**: abuse 3D. Two axes is usually enough; three is almost always too much.

### 12. Appeal — character through detail

The cumulative effect of all the above. The small touches that make something feel designed.
A successful "appeal" moment combines: anticipation + follow-through + well-chosen easing +
secondary action.

`@starting-style` (Baseline-Widely propose) unlocks entrance animations for elements that
just appeared:

```css
/* Propose in PR — see 02-css-architecture.md §6 */
dialog:popover-open {
  opacity: 1;
  @starting-style { opacity: 0; }
}
```

**When**: first-impression moments (onboarding, hero reveals, empty states).

## 4. Frame-Rate-Independent Motion (JS-driven physics)

CSS `transition` / `animation` are time-based by default — they honour whatever refresh rate
the display runs at. **JS-driven motion in a `requestAnimationFrame` loop is not** — writing
`value *= 0.85` per frame decays twice as fast on a 120Hz display as on 60Hz, and at half
speed on a 30Hz throttled background tab. Disney "Timing" (principle 9) only works when
perceived speed is consistent across devices.

The canonical pattern:

```ts
let lastTime = performance.now();

function frame() {
  const now = performance.now();
  const dt = (now - lastTime) / 1000;        // seconds since last frame
  lastTime = now;

  // WRONG — per-frame multiplier; frame-rate dependent
  // mouse.burstStrength *= 0.85;

  // CORRECT — exponential decay per second; frame-rate independent
  // Pick decayPerSecond so that Math.pow(decayPerSecond, 1/60) ≈ your old per-frame multiplier
  mouse.burstStrength *= Math.pow(decayPerSecond, dt);

  // For linear motion (velocity):
  // position += velocity * dt;

  if (shouldKeepRendering) requestAnimationFrame(frame);
}
```

**Rules:**
- Any numeric state updated per frame in a RAF loop MUST scale by `dt`
- Cap `dt` at ~0.1s if you care about correctness across long pauses (tab switch, debugger breakpoint)
- Tune constants against `dt` in seconds, not "per frame" — the name documents the unit

Applies to: shader uniforms updated over time, spring/damping systems, mouse-burst decay,
particle velocities, any canvas-based interaction that decays or accumulates.

**RAF loop hygiene** (a related rule, same concern):
- Call `requestAnimationFrame(frame)` at the **end** of the render branch, not the top of `frame()`
- Short-circuit returns (reduced-motion, visibility hidden, not initialised) must skip the re-schedule
- Re-prime the loop from state transitions (`visibilitychange`, `prefers-reduced-motion` change, renderer (re-)init), not from the short-circuited frame callback
- This matters most for `prefers-reduced-motion: reduce` — a naive "schedule first, exit early" pattern re-primes 60×/sec for users who asked for silence

<!-- added from iter-08: pointer-move coalescing surfaced via OklchColorArea RAF spam -->
**Pointer event coalescing in RAF** (discovered iter-08):

`pointermove` fires at device-input rate — 60Hz on most desktops, **120Hz+ on modern
displays**, often faster on trackpads and precision pens. Wrapping each `pointermove` in a
fresh `requestAnimationFrame` call (e.g. `handlePointerMove = (e) => rAF(() => update(e))`)
queues one RAF *per pointer event* — so a single drag fires 120 RAFs/sec, each scheduling a
render. The browser coalesces them to one paint per frame, but your state mutation and
pointer-math runs 120 times regardless.

The coalescing pattern:

```ts
let rafPending = false;
let latestPointer: { x: number; y: number } | null = null;

function handlePointerMove(e: PointerEvent) {
  latestPointer = { x: e.clientX, y: e.clientY };
  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (latestPointer) updateFromPosition(latestPointer);
    });
  }
}
```

Now at most one RAF is in flight at any moment; later `pointermove` events just update the
"what to render" state. Applies to: color pickers, drag handles, canvas-based interaction,
any touch/pointer widget that reads `clientX/Y` per event.

**Also**: if you `setPointerCapture` on `pointerdown`, add an `$effect` cleanup that releases
it — unmount during a drag leaves the capture dangling on the element (and can fire a
`lostpointercapture` event on a torn-down listener).

## 5. View Transitions API

Codex uses **named view transitions** in `apps/web/src/lib/styles/view-transitions.css`:

```css
::view-transition-old(sidebar-nav) {
  animation: sidebar-morph-out var(--duration-slow) var(--ease-out) both;
}
::view-transition-new(sidebar-nav) {
  animation: sidebar-morph-in var(--duration-slow) var(--ease-out) both;
}

::view-transition-old(page-content) {
  animation: content-dissolve-out 600ms var(--ease-out) both;
}
::view-transition-new(page-content) {
  animation: content-dissolve-in 600ms var(--ease-out) 100ms both;
}

@media (prefers-reduced-motion: reduce) {
  /* instant swaps when user opts out */
}
```

**Rules:**
- Assign `view-transition-name: <unique-identity>` per element that should share transition identity across navigations (e.g. a card that persists from list → detail)
- Never name-attach to dynamic lists without a stable per-identity name — you'll get cross-faded wrong pairs
- Keep transition animations under ~500ms — view transitions block the whole page; long ones feel broken

## 6. CSS vs Svelte Transition Directive vs View Transition — Decision Tree

```
Is it a state change on a persistent element (hover, open/close, data-state flip)?
├─ YES → CSS transition with motion tokens
│
Is it a list element entering/leaving (added/removed from DOM)?
├─ YES → Svelte transition directive (fade, fly, scale) — clean binding, handles unmount
│
Is it a cross-page navigation where elements should morph/dissolve?
├─ YES → View Transition with view-transition-name
│
Is it frame-by-frame scroll-driven animation?
└─ YES → Scroll-driven animations (animation-timeline: scroll/view) — Baseline-Widely propose

Consider WAAPI (element.animate()) only when you need runtime dynamic values. Prefer declarative.
```

## 7. `will-change` Discipline

```ts
// Apply at animation start, remove after settle
const el = $state.raw<HTMLElement>();
$effect(() => {
  if (!el || !isOpen) return;
  el.style.willChange = 'transform, opacity';
  const cleanup = () => (el.style.willChange = 'auto');
  el.addEventListener('transitionend', cleanup, { once: true });
  return () => el.removeEventListener('transitionend', cleanup);
});
```

**Never** set `will-change` globally in CSS. It costs memory (creates a compositor layer).
Set it when the animation starts; remove it when it ends.

## 8. Gotchas / Anti-patterns

- **Don't** hardcode `ms` or cubic-bezier values. Use the tokens — reduced-motion support depends on it.
- **Don't** use `transition: all`. Ever. It animates properties you didn't intend (layout → jank).
- **Don't** animate `box-shadow`, `background-color`, or `border` in a hot path. Animate `opacity` on a layered pseudo-element instead (GPU-accelerated).
- **Don't** animate `width`, `height`, `top`, `left`. Use `transform: scale()` / `translate()` — layout animations cause reflow.
- **Don't** leave `will-change` set permanently. It creates compositor layers that never free.
- **Don't** wrap a CSS transition in `$effect` to trigger it — just toggle the class/attribute. The DOM handles the rest.
- **Don't** use a view-transition-name on dynamic list children without a stable identity (e.g. `view-transition-name: card-{id}`) — otherwise different cards will cross-fade into each other.
- **Don't** apply multiple Disney principles to the same short interaction. Pick one or two; combining them all in 200ms just feels busy.
- **Don't** use `linear` for human-perceived motion (the exception is loops — spinners, marquees).
- **Don't** skip the `@supports not (view-transition-name: ...)` fallback if your UX depends on the transition — older browsers get instant navigation, which may or may not be acceptable.
- **Don't** run Svelte `transition:` directives on every list item — causes cascading CPU cost on re-render. Use `animate:flip` for list reorder.

## 9. When to Re-Verify This Reference

- `apps/web/src/lib/styles/tokens/motion.css` — token value or addition
- `apps/web/src/lib/styles/view-transitions.css` — transition definitions
- `apps/web/src/lib/theme/reset.css` — reduced-motion override
- New Baseline-Widely motion features (Context7 MCP) — especially `@starting-style`, `animation-timeline`, `interpolate-size`
- `apps/web/src/lib/components/ui/ShaderHero/` — WebGL animation loop coordination with reduced-motion

If the code disagrees with this reference, **the code wins** — update the reference.

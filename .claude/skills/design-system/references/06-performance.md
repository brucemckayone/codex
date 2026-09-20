# Reference 06 — Performance

Render, paint, bundle, and shader discipline. Core Web Vitals posture.

## 1. Core Web Vitals Targets

Measure via Chrome DevTools MCP `lighthouse_audit`. Targets for the Codex web app:

| Metric | Target | Typical regressor |
|---|---|---|
| LCP (largest contentful paint) | ≤ 2.5s | Hero image/shader, unoptimised fonts, render-blocking CSS |
| CLS (cumulative layout shift) | ≤ 0.1 | Fonts loading without metric overrides, images without `aspect-ratio` |
| INP (interaction to next paint) | ≤ 200ms | Heavy `$effect` cascades, layout-triggering animations |
| TBT (total blocking time) | ≤ 200ms | Large JS bundles, sync hydration |

**TODO(design-system):** document per-route JS bundle ceiling once measured. No committed
number today — use Lighthouse output as the reference for now.

## 2. CLS Prevention Checklist

1. **Font metric overrides** — `tokens/typography.css:44-51` already defines `Inter-fallback`
   with `ascent/descent/size-adjust`. If you add a new brand font via the brand editor, ensure
   its fallback has similar metric overrides or accept the shift.
2. **Every image** declares `aspect-ratio` (via `<ResponsiveImage>` or CSS). Never render an
   `<img>` without width/height or aspect-ratio — the space reserves post-load.
3. **Skeleton placeholders** use the same dimensions as the loaded content. Streamed data
   (`{#await}` blocks) use skeletons that match the final shape (see
   `apps/web/CLAUDE.md` — Shell + Stream section).
4. **No late-arriving elements above viewport content.** Cookie banners, announcements,
   auth-dependent chrome should render from SSR, not hydrate in after.

## 3. GPU-Accelerated Animations

Only four properties animate without triggering layout/paint:
- `transform` — translate, scale, rotate, skew
- `opacity`
- `filter` (with care — blur can still be expensive on weak GPUs)
- `backdrop-filter`

**Never animate:**
- `width`, `height`, `padding`, `margin` — triggers layout on the animated element AND ancestors
- `top`, `left`, `right`, `bottom` — triggers layout
- `box-shadow` — paint, very expensive at high blur radii; use a layered pseudo-element with `opacity` instead
- `background-color` on hot paths — OK for `--transition-colors` (slow enough, infrequent enough); avoid in carousels / scroll-linked animations
- `border` — layout (the border takes space)

If you MUST animate a layout property (e.g., `max-height` for accordions), keep it off the
critical interaction path.

## 4. `will-change` Discipline

See [04-motion.md §6](04-motion.md#6-will-change-discipline). Summary: set at animation start,
remove at `transitionend`. Never globally in CSS.

## 5. `content-visibility` + `contain-intrinsic-size`

Baseline-Widely **propose-only** (see [02-css-architecture.md §6](02-css-architecture.md#6-baseline-widely-feature-adoption-framework)).
When adopted, use for long virtualized lists:

```css
.content-grid-row {
  content-visibility: auto;
  contain-intrinsic-size: 1px 280px;   /* MUST pair — prevents scroll-jump */
}
```

**Rule**: if you adopt `content-visibility: auto`, you *must* also set
`contain-intrinsic-size` with a plausible placeholder height. Otherwise scrolling collapses
off-screen rows to 0, then expands them on reveal — scroll-jumps ruin the experience.

## 6. `contain` Property

Declare explicit containment on components that own their layout/paint scope:

```css
.card {
  contain: layout style;                /* Layout + style scope only */
}
.self-contained-widget {
  contain: layout paint style;          /* Full containment */
}
```

- `layout` — child layout can't affect parent. Safe for most cards.
- `paint` — descendant paint is clipped to the element. Safe if the element has a background.
- `style` — style queries don't reach out.
- `size` — **dangerous** — forces the element to have explicit size or it collapses.

Use `contain` sparingly; profile before/after via Chrome DevTools MCP
`performance_start_trace`.

## 7. Image Strategy

- **Use `<ResponsiveImage>`** (`apps/web/src/lib/components/ui/ResponsiveImage/`) for all
  content images. It generates `srcset` (sm/md/lg WebP variants) and handles lazy loading.
- **`loading="lazy"`** on off-screen images (below the fold, carousel overflow).
  `loading="eager"` (default) for hero/above-fold images.
- **`fetchpriority="high"`** on the LCP image — usually the hero. Exactly ONE image per page
  should get `fetchpriority="high"`. More than one nullifies the hint.
- **WebP via CDN negotiation** — the dev-cdn (port 4100) and production R2 serve WebP when
  the client's `Accept` header permits. No `image-set()` needed at the CSS level.

## 8. Lazy Component Loading

For heavy components that aren't needed immediately:

```ts
// +page.svelte
import { onMount } from 'svelte';

let HeavyComponent: typeof import('./HeavyComponent.svelte').default | null = $state(null);

onMount(async () => {
  const module = await import('./HeavyComponent.svelte');
  HeavyComponent = module.default;
});
```

Svelte + Vite code-splits the dynamic import into its own chunk automatically. Use for:
Tiptap editor, charting libraries, modal contents that most users don't open.

## 9. `$effect` Cost Awareness

`$effect` runs on every dependency change — cascading effects compound.

```ts
// EXPENSIVE — runs on every props change
$effect(() => {
  const heavy = expensive(props.data);
  someStore.set(heavy);
});

// BETTER — only on the specific dep
$effect(() => {
  someStore.set(expensive(props.data));
});

// BEST — if 'expensive' is pure, use $derived
const heavy = $derived(expensive(props.data));
```

- Prefer `$derived` over `$effect` + assignment
- Guard effects with early returns (`if (!something) return;`)
- For effects that only should run once, use `onMount` + a ref to the value

## 10. Shader / Canvas Cost

The ShaderHero WebGL canvas runs at `requestAnimationFrame` rate — ~16ms per frame budget on
a 60Hz display. Rules:

1. **Pause when hidden** — listen to `visibilitychange`, cancel `requestAnimationFrame` when
   `document.hidden`, resume on visibility return. Already implemented in
   `lib/components/ui/ShaderHero/`.
2. **Respect `prefers-reduced-motion`** — render a single static frame and stop. Already
   implemented.
3. **One canvas per layout** — never stack multiple ShaderHero instances. The WebGL context
   is scarce.
4. **Throttle non-critical effects** — mouse-reactive animations should RAF-throttle, not
   run on every `mousemove` event.
5. **Texture budgets** — shader presets should use ≤ 2 MB of GPU texture memory. See
   `/shader-preset-pipeline` skill for the full perf checklist.
6. **Module-scoped GPU caches MUST expose disposal + validate handles.** Any module-level
   cache holding WebGL programs, buffers, textures, or FBOs (e.g. the JFA pipeline's
   `seedProg`/`stepProg`/`distProg` at `lib/components/ui/ShaderHero/jfa-sdf.ts`) must:
   - Export a `destroy*(gl)` function callers run during renderer disposal — without it,
     resources leak across SPA navigations when the context survives but the consumer doesn't.
   - Validate cached handles via `gl.isProgram(x)` / `gl.isTexture(x)` / `gl.isBuffer(x)`
     on cache-hit paths before returning them — otherwise an external `gl.deleteProgram`
     call produces silent drawQuad errors with no fail-fast.
7. **Enhancement fetches MUST be bounded.** Client-side fetches in progressive-enhancement
   paths (shader logo texture, optional images, non-critical metadata) must use
   `AbortController` with a timeout (5–10s; match the 10s used in `createServerApi`).
   On timeout or network error, resolve to `null` and let the caller fall through to the
   pre-enhancement state — never leave a renderer awaiting indefinitely.
   ```ts
   const controller = new AbortController();
   const timeout = setTimeout(() => controller.abort(), 7000);
   try {
     const res = await fetch(url, { signal: controller.signal });
     // ...
   } catch {
     return null;   // graceful fall-through
   } finally {
     clearTimeout(timeout);
   }
   ```
8. **Defensive `getContext` null-checks.** Privacy-hardened browsers (Firefox resistFingerprinting,
   Safari Lockdown Mode) can return `null` from `canvas.getContext('2d')` or `.getContext('webgl2')`
   alongside WebGL. Never non-null-assert (`canvas.getContext('2d')!`) — guard and fall through:
   ```ts
   const ctx = canvas.getContext('2d');
   if (!ctx) return null;
   ```

## 11. View Transition Budget

View transitions block paint on the entire page. Keep them **short** (≤ 300ms for most;
≤ 500ms for intentional cinematic moments). Measure via DevTools performance trace.

## 12. Reduced Animation for Power-Constrained Devices

`prefers-reduced-motion: reduce` is driven by OS settings, but also respect
`Network Information API` `saveData` where available:

```ts
const saveData = typeof navigator !== 'undefined'
  && 'connection' in navigator
  && (navigator.connection as any).saveData;
```

If `saveData`, skip non-essential animations and defer lazy images more aggressively.
(Currently not in use — adopt when you ship any feature that would benefit.)

## 13. Third-Party Scripts

Avoid them. The Codex platform is first-party end to end (auth worker, analytics in admin-api,
video player local HLS). If you introduce a third-party script:
- Load it after `load` event with `defer` or `async`
- Self-host if possible (first-party = one fewer TLS handshake)
- Budget its impact: Lighthouse `Third-Party Usage` panel

## 14. Gotchas / Anti-patterns

- **Don't** preload everything with `fetchpriority="high"` — it's a single-slot hint. More than one nullifies all.
- **Don't** wrap every component in `content-visibility: auto` — it's sharp-edged; measure before adopting.
- **Don't** spawn multiple `ShaderHero` instances. One canvas per page.
- **Don't** transition `width`/`height` — use `transform: scale()` with compensating layout (parent sized to the max).
- **Don't** use `will-change` globally in CSS. It creates compositor layers that never release.
- **Don't** ship a new image without `aspect-ratio` — instant CLS regression.
- **Don't** cascade `$effect` chains. Prefer `$derived` or pull-based patterns.
- **Don't** ship a new font without metric overrides matching Inter, or at least accept the CLS it introduces.
- **Don't** animate `backdrop-filter` directly — compositors struggle. Fade in a pre-blurred pseudo-element instead.
- **Don't** close a perf-sensitive task without a Chrome DevTools MCP `performance_start_trace` or `lighthouse_audit` in the evidence.

## 15. When to Re-Verify This Reference

- Chrome DevTools MCP results from the current Lighthouse run (authoritative)
- `apps/web/vite.config.ts` — bundle settings, manual chunks
- `apps/web/src/lib/components/ui/ShaderHero/` — shader perf strategy
- `apps/web/src/lib/components/ui/ResponsiveImage/` — srcset generation
- Baseline status of `content-visibility`, `contain`, `interpolate-size` via Context7 MCP

If the code disagrees, **the code wins**.

/**
 * Shared poll-config helper for shader render loops.
 *
 * `getShaderConfig` reads `getComputedStyle(.org-layout)` and parses 8+ CSS
 * variables — invoking it every animation frame (60Hz) forces a style
 * recalculation on each call (the most expensive operation in the render
 * loop). The canonical ShaderHero amortises this with a 30-frame poll
 * counter (~0.5s at 60fps); ImmersiveShaderPlayer and ShaderPreview shipped
 * without inheriting that optimisation.
 *
 * This factory returns a closure that mirrors ShaderHero.svelte:135-146:
 * the first call computes a config; subsequent calls re-use the cached
 * value until the counter ticks past `pollEveryNFrames` (default 30).
 *
 * Usage:
 *   const pollConfig = createPollConfig(() => getShaderConfig(null, preset));
 *   function renderFrame() {
 *     const config = pollConfig();
 *     renderer.render(gl, time, mouse, config, w, h);
 *   }
 *
 * Each consumer creates its own closure so cache state is per-component.
 */
export function createPollConfig<T>(
  fetchConfig: () => T,
  pollEveryNFrames = 30
): () => T {
  let counter = 0;
  let cached: T = fetchConfig();

  return function pollConfig(): T {
    counter++;
    if (counter >= pollEveryNFrames) {
      counter = 0;
      cached = fetchConfig();
    }
    return cached;
  };
}

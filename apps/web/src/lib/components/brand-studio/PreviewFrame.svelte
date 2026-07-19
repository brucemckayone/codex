<!--
  @component PreviewFrame

  ONE live-preview iframe for the Brand Studio canvas (Codex-cijzb · WP-1.3).
  Loads the org's REAL public page same-origin (root-relative `src`) and shows a
  token-driven skeleton until it finishes loading.

  STABLE ELEMENT — the `<iframe>` is never re-created on parent re-renders. Its
  `src` derives ONLY from route + slug (passed in), never from brand-editor
  state, so a brand edit cannot reload it. Only a ROUTE change swaps `src` (a
  reload the browser performs in place — the element identity, and therefore the
  `contentWindow` WP-1.4 holds, survives). Device changes never touch this
  component (they resize the parent viewport); theme changes re-stamp the loaded
  document in place (below), no reload.

  THEME (decoupled from WP-1.4) — on load, and whenever `theme` flips, we reach
  into the same-origin document and set `<html data-theme>` + the light/dark
  class exactly as `theme.svelte.ts` does. This is a same-origin DOM write from
  the parent, NOT editor code shipped into the customer page, and it does NOT
  use the postMessage bridge. A theme flip is a mode change, so re-stamping in
  place (no reload) is intentional.

  WP-1.4 SEAM — `onframeload` fires after every load with a live handle to the
  framed window + its origin. WP-1.4's bridge attaches there. This component
  never sends or receives postMessage.
-->
<script lang="ts">
  import type {
    PreviewFrameLoad,
    PreviewFrameTheme,
    PreviewRouteId,
  } from './preview-canvas';

  interface Props {
    /** Root-relative path to load (e.g. `/`, `/explore`, `/content/<slug>`). */
    src: string;
    /** Accessible iframe title. */
    title: string;
    /** Which route this frame is showing (surfaced to the WP-1.4 seam). */
    route: PreviewRouteId;
    /** Theme to paint the framed document in. */
    theme: PreviewFrameTheme;
    /** Same-origin origin for the WP-1.4 postMessage targetOrigin. */
    origin: string;
    /** WP-1.4 SEAM — fires on every load with a handle to the framed window. */
    onframeload?: (detail: PreviewFrameLoad) => void;
  }

  const { src, title, route, theme, origin, onframeload }: Props = $props();

  let frameEl: HTMLIFrameElement | null = $state(null);
  // The `src` that has finished loading. `loaded` derives from comparing it to
  // the current `src`, so a new `src` (route change) implicitly clears the
  // loaded state — no state-mutating effect needed to reset the skeleton.
  let loadedSrc = $state<string | null>(null);
  const loaded = $derived(loadedSrc === src);

  /**
   * Reach into the same-origin framed document and stamp the theme, mirroring
   * theme.svelte.ts setTheme() (data-theme attribute + light/dark class). Guarded:
   * a not-yet-loaded or (defensively) cross-origin frame has no reachable
   * documentElement, so we no-op rather than throw.
   */
  function applyPreviewTheme(): void {
    const root = frameEl?.contentDocument?.documentElement;
    if (!root) return;
    root.setAttribute('data-theme', theme);
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
  }

  function handleLoad(): void {
    loadedSrc = src;
    applyPreviewTheme();
    const win = frameEl?.contentWindow;
    if (win && frameEl) {
      // TODO(WP-1.4): this is the handle the postMessage bridge captures.
      onframeload?.({ window: win, element: frameEl, origin, route, theme });
    }
  }

  // Re-stamp the theme in place when it flips on an already-loaded frame — a
  // mode change, not a per-edit update, so no reload. This is a same-origin DOM
  // side-effect on the framed document (not reactive state), so an $effect is
  // the correct tool; it never assigns a stateful variable.
  $effect(() => {
    void theme;
    if (loaded) applyPreviewTheme();
  });
</script>

<div class="preview-frame" data-preview-theme={theme}>
  <iframe
    bind:this={frameEl}
    class="preview-frame__doc"
    {src}
    {title}
    onload={handleLoad}
  ></iframe>

  {#if !loaded}
    <div class="preview-frame__skeleton" aria-hidden="true"></div>
  {/if}
</div>

<style>
  .preview-frame {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    background-color: var(--color-surface);
    border-radius: var(--radius-lg);
    overflow: hidden;
    box-shadow: var(--shadow-lg);
  }

  .preview-frame__doc {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background-color: var(--color-surface);
  }

  /* Skeleton overlay — token-driven shimmer while the real page loads. */
  .preview-frame__skeleton {
    position: absolute;
    inset: 0;
    background-image: linear-gradient(
      100deg,
      var(--color-surface-secondary) 30%,
      var(--color-surface) 50%,
      var(--color-surface-secondary) 70%
    );
    background-size: 200% 100%;
    animation: preview-frame-shimmer var(--duration-slower) var(--ease-default)
      infinite;
  }

  @keyframes preview-frame-shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .preview-frame__skeleton {
      animation: none;
    }
  }
</style>

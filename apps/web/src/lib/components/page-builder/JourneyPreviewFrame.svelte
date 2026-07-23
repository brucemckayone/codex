<!--
  @component JourneyPreviewFrame

  ONE live-preview iframe for the journey builder canvas (Codex-2pryk.3.3 · WP-5).
  Cloned from `brand-studio/PreviewFrame.svelte`. Loads the org's REAL public
  journey page same-origin (root-relative `src`) and shows a token-driven skeleton
  until it finishes loading.

  STABLE ELEMENT — the `<iframe>` is never re-created on parent re-renders. Its
  `src` derives ONLY from the page slug (passed in), never from the builder's
  pending draft, so a copy/section edit cannot reload it — those stream in over
  the `codex:page-preview:v1` postMessage bridge with no reload. Theme changes
  re-stamp the loaded document in place (below), also no reload.

  WP-5 SEAM — `onframeload` fires after every load with a live handle to the
  framed window + its origin; the preview wiring registers it with the sender.
  This component never sends or receives postMessage.
-->
<script lang="ts">
  import type {
    JourneyPreviewFrameLoad,
    JourneyPreviewFrameTheme,
  } from './journey-preview-canvas';

  interface Props {
    /** Root-relative path to load (e.g. `/journeys/<slug>`). */
    src: string;
    /** Accessible iframe title. */
    title: string;
    /** Theme to paint the framed document in. */
    theme: JourneyPreviewFrameTheme;
    /** Same-origin origin for the postMessage targetOrigin. */
    origin: string;
    /** WP-5 SEAM — fires on every load with a handle to the framed window. */
    onframeload?: (detail: JourneyPreviewFrameLoad) => void;
  }

  const { src, title, theme, origin, onframeload }: Props = $props();

  let frameEl: HTMLIFrameElement | null = $state(null);
  // The `src` that has finished loading. `loaded` derives from comparing it to
  // the current `src`, so a new `src` implicitly clears the loaded state — no
  // state-mutating effect needed to reset the skeleton.
  let loadedSrc = $state<string | null>(null);
  const loaded = $derived(loadedSrc === src);

  /**
   * Reach into the same-origin framed document and stamp the theme, mirroring
   * theme.svelte.ts setTheme() (data-theme attribute + light/dark class).
   * Guarded: a not-yet-loaded / cross-origin frame has no reachable
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
      onframeload?.({ window: win, element: frameEl, origin, theme });
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
    animation: journey-preview-shimmer var(--duration-slower) var(--ease-default)
      infinite;
  }

  @keyframes journey-preview-shimmer {
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

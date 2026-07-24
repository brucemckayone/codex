<!--
  @component JourneyBuilderCanvas

  Live-preview canvas for the journey sales-page builder (Codex-2pryk.3.3 · WP-5).
  Cloned from `brand-studio/BrandStudioCanvas.svelte` — embeds the org's REAL
  public journey page in a same-origin <iframe> and lets a builder flip device
  width and light/dark (plus a side-by-side compare). The canvas IS the workspace.

  STABLE IFRAME: `src` derives ONLY from the page slug — never from the builder's
  pending draft — so copy/section edits never reload or re-create it. They stream
  in over the `codex:page-preview:v1` postMessage bridge (attached via the
  `onframeload` seam below). A device change only resizes this viewport; a theme
  flip re-stamps the framed document in place. Only toggling side-by-side
  mounts/unmounts the SECOND (dark) frame; the primary frame stays put.

  Unlike the brand canvas, the theme is LOCAL preview state (the page store edits
  sections, not brand tokens — there is no shared `editingTheme`).
-->
<script lang="ts">
  import JourneyCanvasToolbar from './JourneyCanvasToolbar.svelte';
  import JourneyPreviewFrame from './JourneyPreviewFrame.svelte';
  import {
    resolveJourneyPreviewPath,
    type JourneyPreviewDeviceId,
    type JourneyPreviewFrameLoad,
    type JourneyPreviewThemeMode,
  } from './journey-preview-canvas';

  interface Props {
    /**
     * Same-origin origin of the org subdomain (e.g. `page.url.origin`). Surfaced
     * to the preview seam as the postMessage targetOrigin. The iframe `src` is
     * root-relative, so this is only needed for the bridge, not for loading.
     */
    previewOrigin: string;
    /** The page's slug — resolves the root-relative public journey path. */
    slug: string;
    /**
     * WP-5 SEAM — invoked every time a preview iframe finishes loading, with a
     * live handle to the framed window, its origin and theme. The preview wiring
     * registers the frame with the sender here, then posts the pending draft.
     */
    onframeload?: (detail: JourneyPreviewFrameLoad) => void;
    /**
     * Full-screen preview state, owned by the route (the toggle lives in this
     * canvas' toolbar, but the position:fixed effect applies to the sibling
     * layout, so the page owns the state).
     */
    fullscreen?: boolean;
    onToggleFullscreen?: () => void;
  }

  const {
    previewOrigin,
    slug,
    onframeload,
    fullscreen = false,
    onToggleFullscreen,
  }: Props = $props();

  // Canvas view state — all local (the page builder has no shared editing theme).
  let device = $state<JourneyPreviewDeviceId>('desktop');
  let theme = $state<'light' | 'dark'>('light');
  let split = $state(false);

  const isSplit = $derived(split);
  // What the toolbar's theme segment shows as active: the compare view, else the
  // single-frame theme.
  const themeMode = $derived<JourneyPreviewThemeMode>(split ? 'split' : theme);

  function onThemeModeChange(mode: JourneyPreviewThemeMode): void {
    if (mode === 'split') {
      split = true;
      return;
    }
    split = false;
    theme = mode;
  }

  // Root-relative path for the sales page. `src` derives ONLY from slug so a
  // pending edit can never reload the frame (WP-5 stable-iframe invariant).
  const previewSrc = $derived(resolveJourneyPreviewPath(slug));
</script>

<div class="journey-canvas">
  <JourneyCanvasToolbar
    {device}
    {themeMode}
    {fullscreen}
    ondevicechange={(id) => (device = id)}
    onthememodechange={onThemeModeChange}
    ontogglefullscreen={onToggleFullscreen}
  />

  <div
    class="journey-canvas__viewport"
    data-device={device}
    data-mode={isSplit ? 'split' : 'single'}
  >
    <JourneyPreviewFrame
      src={previewSrc}
      title={isSplit ? 'Journey preview (light)' : 'Journey preview'}
      theme={isSplit ? 'light' : theme}
      origin={previewOrigin}
      {onframeload}
    />
    {#if isSplit}
      <JourneyPreviewFrame
        src={previewSrc}
        title="Journey preview (dark)"
        theme="dark"
        origin={previewOrigin}
        {onframeload}
      />
    {/if}
  </div>
</div>

<style>
  .journey-canvas {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .journey-canvas__viewport {
    flex: 1;
    display: flex;
    align-items: stretch;
    justify-content: center;
    min-width: 0;
    min-height: 0;
    padding: var(--space-4);
    overflow: auto;
  }

  /* Single-frame device widths — desktop is fluid; tablet/mobile cap the frame
     to the shared brand-studio viewport tokens and centre it. */
  .journey-canvas__viewport[data-mode='single'][data-device='tablet']
    :global(.preview-frame) {
    max-width: var(--brand-studio-preview-tablet);
  }

  .journey-canvas__viewport[data-mode='single'][data-device='mobile']
    :global(.preview-frame) {
    max-width: var(--brand-studio-preview-mobile);
  }

  /* Side-by-side: two equal columns filling the viewport. Device caps do not
     apply — the split IS the comparison view. */
  .journey-canvas__viewport[data-mode='split'] {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
    align-items: stretch;
  }

  @media (--below-md) {
    .journey-canvas__viewport[data-mode='split'] {
      grid-template-columns: 1fr;
    }
  }
</style>

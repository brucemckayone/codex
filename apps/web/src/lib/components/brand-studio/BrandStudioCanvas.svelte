<!--
  @component BrandStudioCanvas

  Live-preview canvas for the `/studio/brand` workspace (Codex-cijzb · WP-1.3).
  Embeds the org's REAL public pages in a same-origin <iframe> and lets an admin
  flip the preview between routes, device widths, and light/dark (plus a
  side-by-side light+dark). The canvas IS the workspace (Concept B — see
  docs/design/brand-editor-mockups.html §B).

  WHAT THIS WP DOES: load the untouched public route + provide the seam.
  WHAT IT DOES NOT: no editor code runs inside the iframe, and no postMessage is
  sent or received here — that is WP-1.4's bridge, which attaches via the
  `onframeload` seam below.

  STABLE IFRAME: the primary <PreviewFrame> is rendered unconditionally (while a
  path resolves) and its `src` derives ONLY from route + slug — never from
  brand-editor state — so brand edits never reload or re-create it. A route
  change swaps `src` in place; device changes only resize this viewport; a theme
  flip re-stamps the framed document in place. Only toggling side-by-side
  mounts/unmounts the SECOND (dark) frame; the primary frame stays put.

  Epic: Codex-cijzb · WP-1.3.
-->
<script lang="ts">
  import CanvasToolbar from './CanvasToolbar.svelte';
  import PreviewFrame from './PreviewFrame.svelte';
  import {
    resolvePreviewPath,
    type PreviewDeviceId,
    type PreviewFrameLoad,
    type PreviewRouteId,
    type PreviewThemeMode,
  } from './preview-canvas';

  interface Props {
    /**
     * Same-origin origin of the org subdomain (e.g. `page.url.origin`). Passed
     * to each frame and surfaced to the WP-1.4 seam as the postMessage
     * targetOrigin. The iframe `src` itself is root-relative, so this is only
     * needed for the bridge, not for loading.
     */
    previewOrigin: string;
    /**
     * One published content slug, for the Detail/Player previews. Undefined
     * when the org has no published content — those tabs disable and their
     * viewport shows an empty state.
     */
    contentSlug?: string;
    /**
     * WP-1.4 SEAM — invoked every time a preview iframe finishes loading, with
     * a live handle to the framed window, its origin, the route, and the frame
     * theme. WP-1.4's postMessage bridge attaches here (capture `detail.window`,
     * post brand `pending` to `detail.origin`). Left unwired in WP-1.3.
     */
    onframeload?: (detail: PreviewFrameLoad) => void;
  }

  const { previewOrigin, contentSlug, onframeload }: Props = $props();

  // Canvas view state — route/device/theme. None of these depend on brand
  // state, so the primary iframe is never reloaded by a brand edit.
  let route = $state<PreviewRouteId>('landing');
  let device = $state<PreviewDeviceId>('desktop');
  let themeMode = $state<PreviewThemeMode>('light');

  const contentAvailable = $derived(!!contentSlug);
  const isSplit = $derived(themeMode === 'split');
  // The single-frame theme (split resolves the two frames explicitly below).
  const singleTheme = $derived<'light' | 'dark'>(
    themeMode === 'dark' ? 'dark' : 'light'
  );
  // Root-relative path for the active route; null → route unavailable (no slug).
  const previewPath = $derived(resolvePreviewPath(route, contentSlug));
</script>

<div class="brand-studio-canvas">
  <CanvasToolbar
    {route}
    {device}
    {themeMode}
    {contentAvailable}
    onroutechange={(id) => (route = id)}
    ondevicechange={(id) => (device = id)}
    onthememodechange={(mode) => (themeMode = mode)}
  />

  <div
    class="brand-studio-canvas__viewport"
    data-device={device}
    data-mode={isSplit ? 'split' : 'single'}
  >
    {#if previewPath}
      <PreviewFrame
        src={previewPath}
        title={isSplit
          ? `${route} preview (light)`
          : `${route} preview`}
        {route}
        theme={isSplit ? 'light' : singleTheme}
        origin={previewOrigin}
        {onframeload}
      />
      {#if isSplit}
        <PreviewFrame
          src={previewPath}
          title={`${route} preview (dark)`}
          {route}
          theme="dark"
          origin={previewOrigin}
          {onframeload}
        />
      {/if}
    {:else}
      <div class="brand-studio-canvas__empty">
        <p class="brand-studio-canvas__empty-title">Nothing to preview yet</p>
        <p class="brand-studio-canvas__empty-hint">
          Publish content to preview the detail and player pages.
        </p>
      </div>
    {/if}
  </div>
</div>

<style>
  .brand-studio-canvas {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .brand-studio-canvas__viewport {
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
     to the token-defined viewport and centre it. */
  .brand-studio-canvas__viewport[data-mode='single'][data-device='tablet']
    :global(.preview-frame) {
    max-width: var(--brand-studio-preview-tablet);
  }

  .brand-studio-canvas__viewport[data-mode='single'][data-device='mobile']
    :global(.preview-frame) {
    max-width: var(--brand-studio-preview-mobile);
  }

  /* Side-by-side: two equal columns filling the viewport. Device caps do not
     apply — the split IS the comparison view. */
  .brand-studio-canvas__viewport[data-mode='split'] {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
    align-items: stretch;
  }

  .brand-studio-canvas__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    margin: auto;
    max-width: var(--container-sm);
    text-align: center;
  }

  .brand-studio-canvas__empty-title {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .brand-studio-canvas__empty-hint {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    margin: 0;
  }

  @media (--below-md) {
    .brand-studio-canvas__viewport[data-mode='split'] {
      grid-template-columns: 1fr;
    }
  }
</style>

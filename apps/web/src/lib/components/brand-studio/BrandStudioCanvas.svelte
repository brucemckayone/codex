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
  import { brandEditor } from '$lib/brand-editor';
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
    /**
     * WP-1.6 SCOPED RELOAD — a monotonically increasing token the route bumps
     * after a hero-text (org name/description) save. Bumping it appends a
     * cache-busting query param to the frame `src`, which reloads the iframe in
     * place (element identity + the WP-1.4 handle survive, same as a route
     * change) so the freshly-persisted hero text renders. Brand TOKEN edits
     * never touch this — they still live-preview via the postMessage bridge
     * with no reload. Defaults to 0 (no param → clean URL).
     */
    reloadToken?: number;
  }

  const {
    previewOrigin,
    contentSlug,
    onframeload,
    reloadToken = 0,
  }: Props = $props();

  // Canvas view state. Route + device are local; the light/dark choice is NOT —
  // it is the store's `editingTheme`, the SINGLE source of truth shared with the
  // rail's editing-theme toggle. So "edit dark" and "preview dark" are the same
  // switch: flipping it here or in the rail moves the palette-you-edit AND this
  // preview together (the old split control let them drift out of sync).
  let route = $state<PreviewRouteId>('landing');
  let device = $state<PreviewDeviceId>('desktop');
  // Side-by-side is a canvas-only VIEW augmentation (compare light + dark at
  // once); it does not change which theme you're editing.
  let split = $state(false);

  const contentAvailable = $derived(!!contentSlug);
  const isSplit = $derived(split);
  // The single-frame theme follows the shared editing theme.
  const singleTheme = $derived<'light' | 'dark'>(brandEditor.editingTheme);
  // What the toolbar's theme segment shows as active: the compare view, else the
  // editing theme.
  const themeMode = $derived<PreviewThemeMode>(
    split ? 'split' : brandEditor.editingTheme
  );

  function onThemeModeChange(mode: PreviewThemeMode): void {
    if (mode === 'split') {
      split = true;
      return;
    }
    // Light/Dark drive the shared editing theme (updates the rail toggle, the
    // colour controls' target palette, and this preview) and leave compare view.
    split = false;
    brandEditor.setEditingTheme(mode);
  }
  // Root-relative path for the active route; null → route unavailable (no slug).
  const previewPath = $derived(resolvePreviewPath(route, contentSlug));
  // Effective iframe src. Identical to previewPath until a hero-text save bumps
  // reloadToken, at which point a cache-busting param forces a fresh load. The
  // token is NOT brand-editor state — it's an explicit structural-reload signal,
  // so this stays consistent with WP-1.3's "src derives only from route + slug
  // (never brand edits)" invariant.
  const previewSrc = $derived.by(() => {
    if (!previewPath) return null;
    if (!reloadToken) return previewPath;
    const separator = previewPath.includes('?') ? '&' : '?';
    return `${previewPath}${separator}__brandPreviewReload=${reloadToken}`;
  });
</script>

<div class="brand-studio-canvas">
  <CanvasToolbar
    {route}
    {device}
    {themeMode}
    {contentAvailable}
    onroutechange={(id) => (route = id)}
    ondevicechange={(id) => (device = id)}
    onthememodechange={onThemeModeChange}
  />

  <div
    class="brand-studio-canvas__viewport"
    data-device={device}
    data-mode={isSplit ? 'split' : 'single'}
  >
    {#if previewSrc}
      <PreviewFrame
        src={previewSrc}
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
          src={previewSrc}
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

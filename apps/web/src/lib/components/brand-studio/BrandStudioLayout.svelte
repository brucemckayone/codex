<!--
  @component BrandStudioLayout

  Two-pane workspace shell for the `/studio/brand` brand editor (Concept B,
  "Studio Canvas"): a fixed control rail beside a large live-preview canvas.
  Rail and canvas are SIBLINGS, never overlapping layers — the canvas is the
  biggest thing on screen (see docs/design/brand-editor-mockups.html §B).

  This component owns ONLY the layout. The rail and canvas contents are passed
  as snippets so later WPs can fill them without touching the shell:
    - rail   → BrandStudioRail   (WP-1.5 rich controls, WP-1.6 logo + hero text)
    - canvas → BrandStudioCanvas (WP-1.3 iframe, WP-1.4 postMessage bridge)

  Epic: Codex-cijzb · WP-1.1 (route shell + state spine).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ChevronLeftIcon, ChevronRightIcon } from '$lib/components/ui/Icon';

  interface Props {
    /** Left control rail region. */
    rail?: Snippet;
    /** Right live-preview canvas region. */
    canvas?: Snippet;
    /**
     * Collapse the control rail to a thin STRIP so the canvas takes most of the
     * workspace width. The rail body hides but the rail keeps a slim column
     * holding its own expand control — the collapse/expand button belongs ON the
     * panel it collapses (never fully display:none, or its re-open control would
     * vanish with it).
     */
    railCollapsed?: boolean;
    /**
     * Lift the whole workspace over the studio chrome to fill the viewport
     * (position:fixed). Independent of railCollapsed — you can still collapse
     * the rail while full-screen to preview edge-to-edge, or keep it to edit
     * against a large canvas.
     */
    fullscreen?: boolean;
    /** Toggle the rail collapsed/expanded. Absent → the rail toggle hides. */
    onToggleRail?: () => void;
  }

  const {
    rail,
    canvas,
    railCollapsed = false,
    fullscreen = false,
    onToggleRail,
  }: Props = $props();
</script>

<div
  class="brand-studio"
  data-rail-collapsed={railCollapsed}
  data-fullscreen={fullscreen}
>
  <section
    class="brand-studio__rail"
    aria-label="Brand controls"
  >
    <!-- Fixed head (never scrolls) so the collapse/expand control stays pinned
         while the body scrolls. Lives ON the rail — when collapsed the head is
         all that remains (the strip), holding the expand chevron. -->
    <div class="brand-studio__rail-head">
      {#if onToggleRail}
        <button
          type="button"
          class="brand-studio__rail-toggle"
          aria-expanded={!railCollapsed}
          aria-controls="brand-studio-rail-body"
          aria-label={railCollapsed ? 'Show controls' : 'Hide controls'}
          title={railCollapsed ? 'Show controls' : 'Hide controls'}
          onclick={onToggleRail}
        >
          {#if railCollapsed}
            <ChevronRightIcon size={18} />
          {:else}
            <ChevronLeftIcon size={18} />
          {/if}
        </button>
      {/if}
    </div>
    <div id="brand-studio-rail-body" class="brand-studio__rail-body">
      {@render rail?.()}
    </div>
  </section>
  <section class="brand-studio__canvas" aria-label="Brand preview">
    {@render canvas?.()}
  </section>
</div>

<style>
  .brand-studio {
    display: grid;
    grid-template-columns: var(--brand-studio-rail-width) 1fr;
    /* ONE bounded row. Without an explicit rows track the single implicit row
       is `auto` and grows to its tallest child — a rail with expanded
       accordions — dragging the canvas (and the iframe) taller with it.
       minmax(0,1fr) makes the row a definite height whose children may shrink
       below content, so the rail scrolls INTERNALLY (its own overflow-y:auto)
       and the canvas height stays decoupled from the rail's content. */
    grid-template-rows: minmax(0, 1fr);
    gap: var(--space-4);
    /* A DEFINITE, non-growable height so the workspace always fills the
       viewport (minus the studio chrome offset) and the row above can bound
       its children. `min-height` was wrong here: it sets a floor but still lets
       a tall rail grow the grid (and the iframe with it); `height:100%` is
       indefinite unless every ancestor is definitely sized. Mirrors the
       org-layout's viewport-height convention. */
    height: calc(100vh - var(--space-24));
  }

  /* ── Rail collapsed ── shrink the rail track to a thin STRIP (not gone) so the
     canvas takes most of the width while the rail keeps its own expand control.
     The body hides; the head (with the expand chevron) is all that remains. */
  .brand-studio[data-rail-collapsed='true'] {
    grid-template-columns: var(--brand-studio-rail-collapsed-width) 1fr;
  }

  .brand-studio[data-rail-collapsed='true'] .brand-studio__rail-body {
    display: none;
  }

  .brand-studio[data-rail-collapsed='true'] .brand-studio__rail-head {
    justify-content: center;
    padding: var(--space-2);
  }

  /* ── Full-screen ── lift the workspace out of the studio content column and
     over the studio chrome to fill the viewport. Overrides the bounded height
     above (higher specificity via the attribute selector). A padded, filled
     backdrop keeps the two panes reading as one floating workspace rather than
     butting against the raw viewport edge. */
  .brand-studio[data-fullscreen='true'] {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    box-sizing: border-box;
    width: 100vw;
    height: 100vh;
    padding: var(--space-3);
    background-color: var(--color-surface-secondary);
  }

  .brand-studio__rail {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
  }

  /* Pinned head — holds the collapse/expand control. flex-shrink:0 so it never
     collapses under the scrolling body below it. */
  .brand-studio__rail-head {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: flex-end;
    padding: var(--space-2) var(--space-2) 0;
  }

  .brand-studio__rail-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition:
      background-color var(--duration-fast) var(--ease-default),
      color var(--duration-fast) var(--ease-default);
  }

  .brand-studio__rail-toggle:hover {
    color: var(--color-text);
    background-color: color-mix(
      in oklch,
      var(--color-interactive) 12%,
      transparent
    );
  }

  .brand-studio__rail-toggle:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  /* The scrolling region — everything below the pinned head. */
  .brand-studio__rail-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
  }

  /* min-width:0 lets the 1fr track shrink below its content's intrinsic width
     so wide preview content scrolls inside the canvas, not the page body. */
  .brand-studio__canvas {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background-color: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
  }

  /* Stack the two panes on narrow viewports — a side-by-side workspace needs
     width, so below md the rail sits above the canvas. Here the PAGE scrolls
     (not the rail): drop the fixed height so the rail expands to its natural
     height in the `auto` row above the canvas, and restore the growable
     min-height floor so the canvas still gets a usable height. */
  @media (--below-md) {
    .brand-studio {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
      height: auto;
      min-height: calc(100vh - var(--space-24));
    }

    /* Stacked: the PAGE scrolls, so the rail body grows to its natural height
       instead of scrolling internally. */
    .brand-studio__rail-body {
      overflow-y: visible;
    }

    /* Collapsed while stacked stays full-width (a thin head bar above the
       canvas) — the strip column only makes sense side-by-side. Overrides the
       base collapsed columns rule, which is higher-specificity than the plain
       `.brand-studio` reset above. */
    .brand-studio[data-rail-collapsed='true'] {
      grid-template-columns: 1fr;
    }
  }
</style>

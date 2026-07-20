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

  interface Props {
    /** Left control rail region. */
    rail?: Snippet;
    /** Right live-preview canvas region. */
    canvas?: Snippet;
    /**
     * Collapse the control rail so the canvas spans the FULL workspace width.
     * The rail region leaves layout flow (display:none) AND its grid track is
     * dropped — both are needed, or the empty track leaves a gap. The toggle
     * itself lives in the canvas toolbar (always visible), so the rail can
     * fully disappear without stranding its own re-open control.
     */
    railCollapsed?: boolean;
    /**
     * Lift the whole workspace over the studio chrome to fill the viewport
     * (position:fixed). Independent of railCollapsed — you can still collapse
     * the rail while full-screen to preview edge-to-edge, or keep it to edit
     * against a large canvas.
     */
    fullscreen?: boolean;
  }

  const {
    rail,
    canvas,
    railCollapsed = false,
    fullscreen = false,
  }: Props = $props();
</script>

<div
  class="brand-studio"
  data-rail-collapsed={railCollapsed}
  data-fullscreen={fullscreen}
>
  <!-- Stable id so the canvas-toolbar's rail toggle can point aria-controls at
       it (the two live in sibling subtrees). -->
  <section
    id="brand-studio-rail"
    class="brand-studio__rail"
    aria-label="Brand controls"
  >
    {@render rail?.()}
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

  /* ── Rail collapsed ── the canvas takes the whole width. Drop the rail track
     AND remove the rail from flow (see the Props note); either alone misbehaves. */
  .brand-studio[data-rail-collapsed='true'] {
    grid-template-columns: 1fr;
  }

  .brand-studio[data-rail-collapsed='true'] .brand-studio__rail {
    display: none;
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
    overflow-y: auto;
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
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

    .brand-studio__rail {
      overflow-y: visible;
    }

    /* Stacked layout: with the rail row removed, collapse the two-row track to
       one so the canvas fills instead of sitting in the vestigial `auto` row. */
    .brand-studio[data-rail-collapsed='true'] {
      grid-template-rows: 1fr;
    }
  }
</style>

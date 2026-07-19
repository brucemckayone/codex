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
  }

  const { rail, canvas }: Props = $props();
</script>

<div class="brand-studio">
  <section class="brand-studio__rail" aria-label="Brand controls">
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
    gap: var(--space-4);
    /* Fill the studio content area and guarantee a tall workspace floor even
       when the parent doesn't establish a definite height. Mirrors the
       org-layout's viewport-height convention. */
    height: 100%;
    min-height: calc(100vh - var(--space-24));
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
     width, so below md the rail sits above the canvas. */
  @media (--below-md) {
    .brand-studio {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
    }

    .brand-studio__rail {
      overflow-y: visible;
    }
  }
</style>

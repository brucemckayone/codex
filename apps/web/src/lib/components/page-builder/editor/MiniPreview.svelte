<!--
  @component MiniPreview

  Real kit output, small. The kit's own `PageRenderer` lays the page out at a
  fixed VIRTUAL width — so its container queries pick the desktop layout —
  and the result is scaled down to the thumbnail's width, cropped from the
  top when it is taller than the frame and centred when it is shorter.

  It is a picture, not a page: inert, hidden from assistive tech, rendered
  only once it scrolls near the viewport, and never playing a clip (the hero
  loop is swapped for its still). Ids inside it are dropped so the canvas's
  own `aria-labelledby` / `#anchor` references can never resolve into a
  thumbnail; SVG ids stay, since a filter is referenced by `url(#id)`.
-->
<script module lang="ts">
  import type { JourneySalesContext, SellPreview } from '$lib/page-builder/render/types';

  // One still-only promise per source promise: the blocks `{#await}` it, and
  // a fresh promise on every context rebuild would re-run their media.
  const stills = new WeakMap<Promise<SellPreview | null>, Promise<SellPreview | null>>();

  function stillsOf(source: JourneySalesContext['sellPreview']): Promise<SellPreview | null> {
    let still = stills.get(source);
    if (!still) {
      still = source
        .then((preview) =>
          preview
            ? {
                ...preview,
                heroClip: null,
                heroImageUrl: preview.heroImageUrl ?? preview.heroClip?.posterUrl ?? null,
              }
            : null
        )
        .catch(() => null);
      stills.set(source, still);
    }
    return still;
  }
</script>

<script lang="ts">
  import { page as appPage } from '$app/state';
  import { brandEditor } from '$lib/brand-editor';
  import { orgGrounds, orgShader } from '$lib/page-builder/org-grounds';
  import type { BrandTokenOverrides } from '$lib/page-builder';
  import { type KitPage, PageRenderer } from '$lib/page-builder/kit';

  interface Props {
    page: KitPage;
    context: JourneySalesContext;
    brandOverrides?: BrandTokenOverrides | null;
    theme?: 'light' | 'dark';
    /** The width the page is laid out at before scaling, in CSS pixels. */
    width?: number;
    /** The frame's shape (CSS `aspect-ratio`). */
    ratio?: string;
    class?: string;
  }

  const {
    page,
    context,
    brandOverrides = null,
    theme,
    width = 1200,
    ratio = '16 / 10',
    class: className,
  }: Props = $props();

  let near = $state(false);
  let frameWidth = $state(0);
  let frameHeight = $state(0);
  let contentHeight = $state(0);

  const scale = $derived(frameWidth > 0 ? frameWidth / width : 0);
  const offset = $derived(Math.max(0, (frameHeight - contentHeight * scale) / 2));
  // The org's own backgrounds, so the kit keeps its real ground (03 X48).
  const grounds = $derived(
    orgGrounds(appPage.data.org, brandEditor.isOpen ? brandEditor.pending : null)
  );
  // The org's moving background, so the hero takes it (03 X50, X51).
  const shader = $derived(
    orgShader(appPage.data.org, brandEditor.isOpen ? brandEditor.pending : null)
  );
  const thumbContext = $derived({ ...context, sellPreview: stillsOf(context.sellPreview) });

  /** Render once the frame comes within 200px of the viewport, then stay. */
  function whenNear(node: HTMLElement) {
    if (typeof IntersectionObserver === 'undefined') {
      near = true;
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          near = true;
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }

  /**
   * Sizes come from a ResizeObserver, which reports after layout. The
   * `bind:clientWidth` family reads each size synchronously as it mounts, and
   * every read restyles the stage — so with eight thumbnails mounting at once,
   * each read forced a fresh layout of the whole editor (574ms of forced
   * reflow opening the Style tab, measured in a trace).
   */
  function sized(report: (box: DOMRectReadOnly) => void) {
    return (node: HTMLElement) => {
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(([entry]) => report(entry.contentRect));
      observer.observe(node);
      return () => observer.disconnect();
    };
  }

  const measureFrame = sized((box) => {
    frameWidth = box.width;
    frameHeight = box.height;
  });
  const measureStage = sized((box) => {
    contentHeight = box.height;
  });

  function stripIds(root: HTMLElement) {
    const strip = () => {
      for (const element of root.querySelectorAll('[id]')) {
        if (!(element instanceof SVGElement)) element.removeAttribute('id');
      }
    };
    strip();
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(strip);
    observer.observe(root, { subtree: true, childList: true, attributeFilter: ['id'] });
    return () => observer.disconnect();
  }
</script>

<div
  class="mini {className ?? ''}"
  style:aspect-ratio={ratio}
  inert
  aria-hidden="true"
  {@attach whenNear}
  {@attach measureFrame}
>
  {#if near}
    <div
      class="mini__stage"
      data-measured={scale > 0 ? '' : undefined}
      style:inline-size="{width}px"
      style:transform="translateY({offset}px) scale({scale})"
      {@attach stripIds}
      {@attach measureStage}
    >
      <PageRenderer page={page} context={thumbContext} {brandOverrides} {theme} still sticky={false} orgGrounds={grounds} orgShader={shader} />
    </div>
  {/if}
</div>

<style>
  .mini {
    position: relative;
    overflow: hidden;
    pointer-events: none;
    user-select: none;
    background: color-mix(in oklab, var(--color-text) 5%, transparent);
  }

  .mini__stage {
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;
    transform-origin: 0 0;
    visibility: hidden;
  }

  .mini__stage[data-measured] {
    visibility: visible;
  }
</style>

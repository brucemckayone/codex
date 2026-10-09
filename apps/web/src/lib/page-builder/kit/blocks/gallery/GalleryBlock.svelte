<!--
  @component GalleryBlock

  The creator's own pictures (03-expressive-contract §3, §7). Three layouts,
  each its own component in this folder:
    mosaic — mixed sizes, the first the largest, on fixed tile shapes
             (GalleryMosaic)
    strip  — one row to swipe through, running to the section's edges
             (GalleryStrip)
    grid   — every picture the same size, a short last row centred
             (GalleryGrid)

  A picture's description is its `ImageRef` alt; a caption is a visible
  `figcaption`, not a stand-in for the alt. A picture drawn wider than the
  medium file takes the large one (`pictureVariant`).

  EMPTY. The public page keeps only the words. Wherever the section is only
  being looked at — the canvas, the layout picker, the section gallery, any
  still thumbnail (`.lp[data-lp-still]`) — the layout draws itself in the kit's
  designed plates, so its shape reads before a picture exists; a sample never
  points at a made-up image. While editing, the prompt sits over them.
-->
<script lang="ts">
  import { resolvePageImageUrl } from '../../../page-images';
  import type { BlockProps } from '../../model/types';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Text from '../../primitives/Text.svelte';
  import { type Picture, pictureVariant } from './arrange';
  import { GALLERY_EMPTY, galleryDefinition } from './definition';
  import GalleryGrid from './GalleryGrid.svelte';
  import GalleryMosaic from './GalleryMosaic.svelte';
  import GalleryStrip from './GalleryStrip.svelte';

  const { props, section, context, edit }: BlockProps = $props();

  /** How many plates each layout's empty preview draws: enough to show its shape. */
  const PLATES = { mosaic: 5, strip: 5, grid: 6 } as const;

  const content = $derived(galleryDefinition.coerce(props));
  const layout = $derived(
    section.layout === 'strip' || section.layout === 'grid' ? section.layout : 'mosaic'
  );
  const pictures = $derived<Picture[]>(
    (content.items ?? []).map((item, index, all) => ({
      url: resolvePageImageUrl(
        item.image,
        pictureVariant(layout, index, all.length),
        context.mediaBaseUrl
      ),
      alt: item.image.alt ?? '',
      caption: item.caption,
    }))
  );
  const plates = $derived<Picture[]>(
    Array.from({ length: PLATES[layout] }, () => ({ url: null, alt: '' }))
  );
</script>

{#snippet arrangement(set: readonly Picture[])}
  {#if layout === 'strip'}
    <GalleryStrip pictures={set} label={content.heading} anchor={section.anchor} />
  {:else if layout === 'grid'}
    <GalleryGrid pictures={set} />
  {:else}
    <GalleryMosaic pictures={set} />
  {/if}
{/snippet}

<div class="gallery" class:lp-bleed={layout === 'strip'} data-layout={layout}>
  {#if content.eyebrow || content.heading || content.body}
    <header class="gallery__head">
      {#if content.eyebrow}<Eyebrow text={content.eyebrow} type="gallery" {edit} />{/if}
      {#if content.heading}
        <Heading
          level={section.headingLevel}
          text={content.heading}
          type="gallery"
          field="heading"
          {edit}
        />
      {/if}
      {#if content.body}
        <Text text={content.body} size="lead" type="gallery" field="body" {edit} />
      {/if}
    </header>
  {/if}

  {#if pictures.length > 0}
    {@render arrangement(pictures)}
  {:else}
    <div class="gallery__empty">
      <div class="gallery__plates" aria-hidden="true" inert>{@render arrangement(plates)}</div>
      {#if edit}<p class="gallery__prompt" data-lp-edit-only>{GALLERY_EMPTY}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .gallery {
    display: grid;
    row-gap: var(--lp-gap);
  }

  /* The strip runs to the section's edges while its words keep the column:
     the section's own tracks, with no gap between them (a column gap would
     narrow the content track and push it off the section's). */
  .gallery.lp-bleed {
    grid-template-columns: inherit;
  }

  .gallery.lp-bleed > :global(*) {
    grid-column: content;
    min-inline-size: 0;
  }

  .gallery.lp-bleed > :global(:is(.gallery-strip, .gallery__empty)) {
    grid-column: bleed;
  }

  .gallery__head {
    display: grid;
    gap: var(--lp-stack);
    max-inline-size: var(--lp-measure);
  }

  /* The heading measures itself in its own `ch`, not the body face's. */
  .gallery__head :global(.lp-heading) {
    max-inline-size: 20ch;
  }

  /* Never on the public page: an empty gallery there is only its words. */
  .gallery__empty {
    display: none;
  }

  :global(.lp[data-lp-still]) .gallery__empty {
    display: grid;
  }

  .gallery__empty > * {
    grid-area: 1 / 1;
    min-inline-size: 0;
  }

  /* Many plates at once read louder than one: the frames keep their fill
     (the frame's own panel shows through) and the marks step back, so the
     layout's shape carries and the prompt over it stands out. */
  .gallery__plates :global(.lp-media__plate) {
    opacity: 0.4;
  }

  /* global.css caps every `p` at 65ch. Positioned, so it paints over the
     plates' positioned frames (later in the page, so on top). */
  .gallery__prompt {
    position: relative;
    align-self: center;
    justify-self: center;
    max-inline-size: calc(100% - 2 * var(--space-4));
    margin: 0;
    padding: var(--space-4) var(--space-6);
    border: var(--lp-border) var(--border-style-dashed) var(--lp-button-line);
    border-radius: var(--lp-radius-card);
    background: var(--lp-bg);
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    text-align: center;
  }
</style>

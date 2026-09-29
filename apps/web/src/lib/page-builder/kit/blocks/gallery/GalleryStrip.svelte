<!--
  @component GalleryStrip

  The `strip` layout: the pictures in one row that visitors swipe through
  (`ScrollStrip`: the browser's own scrolling, a labelled region, previous and
  next buttons). Every picture stands the same height and alternates between
  landscape and portrait, starting wide, so the row reads like a contact sheet
  rather than a carousel of equal cards; a caption wraps to its picture's
  width. The row runs to the section's edges, so its block is `.lp-bleed`.
-->
<script lang="ts">
  import ScrollStrip from '../../primitives/ScrollStrip.svelte';
  import { type Picture, stripShape } from './arrange';
  import { GALLERY_COPY } from './copy';
  import GalleryPicture from './GalleryPicture.svelte';

  interface Props {
    pictures: readonly Picture[];
    /** The region's name: the section heading, when there is one. */
    label?: string;
    anchor: string;
  }

  const { pictures, label, anchor }: Props = $props();
</script>

<div class="gallery-strip">
  <ScrollStrip
    id={`${anchor}-pictures`}
    label={label ?? GALLERY_COPY.strip}
    previousLabel={GALLERY_COPY.previous}
    nextLabel={GALLERY_COPY.next}
    count={pictures.length}
  >
    {#each pictures as picture, index (index)}
      <li class="gallery-strip__item" data-shape={stripShape(index)}>
        <GalleryPicture {picture} />
      </li>
    {/each}
  </ScrollStrip>
</div>

<style>
  /* Each column is as wide as its picture: the height is fixed, the shape
     gives the width. */
  .gallery-strip {
    --lp-strip-item: max-content;
    --lp-strip-gap: clamp(var(--space-3), 0.5rem + 1cqi, var(--space-6));
  }

  .gallery-strip__item :global(.gallery-picture__frame) {
    block-size: clamp(13rem, 8rem + 16cqi, 26rem);
    aspect-ratio: 3 / 2;
  }

  .gallery-strip__item[data-shape='tall'] :global(.gallery-picture__frame) {
    aspect-ratio: 4 / 5;
  }

  /* A caption never widens its column: it wraps to the picture. */
  .gallery-strip__item :global(.gallery-picture__caption) {
    contain: inline-size;
  }
</style>

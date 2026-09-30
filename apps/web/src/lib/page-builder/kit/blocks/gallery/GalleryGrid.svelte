<!--
  @component GalleryGrid

  The `grid` layout: every picture the same size, captions beneath. Wide, as
  many to a row as divide the set evenly (`gridColumns`), and a short last row
  is centred, so a set never ends on one stray picture at the edge. Narrow, two
  to a row — or one, when there are captions to read.
-->
<script lang="ts">
  import { gridColumns, type Picture } from './arrange';
  import GalleryPicture from './GalleryPicture.svelte';

  interface Props {
    pictures: readonly Picture[];
  }

  const { pictures }: Props = $props();

  const captioned = $derived(pictures.some((picture) => picture.caption));
</script>

<ul
  class="gallery-grid"
  data-count={pictures.length}
  data-columns={gridColumns(pictures.length)}
  data-captioned={captioned ? '' : undefined}
>
  {#each pictures as picture, index (index)}
    <li><GalleryPicture {picture} /></li>
  {/each}
</ul>

<style>
  .gallery-grid {
    --_columns: 2;
    --_gap: var(--lp-gap);
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-8) var(--_gap);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* base.css spaces every `li` but the last, which unevens a row. */
  .gallery-grid > li {
    flex: 0 0 calc((100% - (var(--_columns) - 1) * var(--_gap)) / var(--_columns));
    min-inline-size: 0;
    margin: 0;
  }

  .gallery-grid :global(.gallery-picture__frame) {
    aspect-ratio: 4 / 3;
  }

  .gallery-grid[data-count='1'] :global(.gallery-picture__frame) {
    aspect-ratio: 16 / 9;
  }

  /* A caption keeps a readable measure on a phone: one to a row. */
  .gallery-grid:is([data-count='1'], [data-captioned]) {
    --_columns: 1;
  }

  @container (min-width: 36rem) {
    .gallery-grid:not([data-count='1']) {
      --_columns: 2;
    }
  }

  @container (min-width: 60rem) {
    .gallery-grid[data-columns='3'] {
      --_columns: 3;
    }

    .gallery-grid[data-columns='4'] {
      --_columns: 4;
    }
  }
</style>

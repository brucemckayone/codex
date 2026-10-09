<!--
  @component GalleryMosaic

  The `mosaic` layout: pictures of mixed sizes, the first the largest, on a
  grid whose tiles are fixed shapes (`arrange.ts` designs every count from one
  to twelve, and `arrange.test.ts` packs each one). Wide, four columns; below
  48rem, two: the first picture across both, pairs under it, and a last one
  left alone takes its row. Captions sit on each picture's foot. The first
  picture is the layout's moving one: it drifts gently against the scroll.
-->
<script lang="ts">
  import { mosaicTiles, type Picture } from './arrange';
  import GalleryPicture from './GalleryPicture.svelte';

  interface Props {
    pictures: readonly Picture[];
  }

  const { pictures }: Props = $props();

  const tiles = $derived(mosaicTiles(pictures.length));
</script>

<div class="gallery-mosaic">
  <ul class="gallery-mosaic__tiles" data-count={pictures.length}>
    {#each pictures as picture, index (index)}
      <li data-tile={tiles[index]}>
        <GalleryPicture {picture} captionAt="over" fill drift={index === 0} />
      </li>
    {/each}
  </ul>
</div>

<style>
  /* Its own query container: the tiles are measured from the mosaic's width. */
  .gallery-mosaic {
    container: gallery-mosaic / inline-size;
  }

  .gallery-mosaic__tiles {
    --_gap: clamp(var(--space-2), 0.25rem + 0.8cqi, var(--space-4));
    --_columns: 2;
    display: grid;
    grid-template-columns: repeat(var(--_columns), minmax(0, 1fr));
    /* A row is four fifths of a column deep, so a tile's span fixes its shape. */
    grid-auto-rows: calc((100cqi - (var(--_columns) - 1) * var(--_gap)) / var(--_columns) * 0.8);
    gap: var(--_gap);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* base.css spaces every `li` but the last, which would open the rows. */
  .gallery-mosaic__tiles > li {
    min-inline-size: 0;
    margin: 0;
  }

  @container gallery-mosaic (width < 48rem) {
    .gallery-mosaic__tiles > li:first-child {
      grid-column: span 2;
      grid-row: span 2;
    }

    .gallery-mosaic__tiles > li:last-child:nth-child(even) {
      grid-column: span 2;
    }
  }

  @container gallery-mosaic (width >= 48rem) {
    .gallery-mosaic__tiles {
      --_columns: 4;
    }

    [data-tile='large'] {
      grid-column: span 3;
      grid-row: span 2;
    }

    [data-tile='block'] {
      grid-column: span 2;
      grid-row: span 2;
    }

    [data-tile='tall'] {
      grid-row: span 2;
    }

    [data-tile='wide'] {
      grid-column: span 2;
    }
  }

  /* A lone picture keeps a shape of its own rather than a row's. */
  .gallery-mosaic__tiles[data-count='1'] {
    grid-auto-rows: auto;
  }

  .gallery-mosaic__tiles > li[data-tile='single'] {
    grid-column: 1 / -1;
    grid-row: auto;
    aspect-ratio: 4 / 3;
  }

  @container gallery-mosaic (width >= 48rem) {
    .gallery-mosaic__tiles > li[data-tile='single'] {
      aspect-ratio: 16 / 9;
    }
  }
</style>

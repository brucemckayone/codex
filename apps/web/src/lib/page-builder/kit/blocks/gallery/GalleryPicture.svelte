<!--
  @component GalleryPicture

  One picture of the gallery and its caption. The frame carries the Style's
  media corner and clips what it holds; with no picture (or a failed one) the
  kit's designed plate fills it. The description is the picture's own alt;
  the caption is a visible `figcaption`, never a stand-in for it. Each layout
  gives the frame its shape from its own stylesheet (`fill` stretches it over
  a tile instead), so a Style can re-shape it without fighting an inline
  style.

  The caption sits `under` the picture, or `over` its foot on the kit's
  uniform media scrim, so the words hold their contrast over any photograph
  (a mosaic's tiles are fixed shapes that a caption beneath would unsettle).

  `drift` makes this the layout's moving picture (03 §6): it rides a wrapper
  of its own, grown by the drift at both ends so no edge ever shows. The frame
  clips with `overflow: clip`, which is no scroll container, so the drift is
  timed by the page's scroll.
-->
<script lang="ts">
  import Media from '../../primitives/Media.svelte';
  import type { Picture } from './arrange';

  interface Props {
    picture: Picture;
    captionAt?: 'under' | 'over';
    /** Fill a tile of fixed shape rather than take a shape of its own. */
    fill?: boolean;
    drift?: boolean;
  }

  const { picture, captionAt = 'under', fill = false, drift = false }: Props = $props();
</script>

<figure
  class="gallery-picture"
  data-fill={fill ? '' : undefined}
  data-caption={picture.caption ? captionAt : undefined}
>
  <div class="gallery-picture__frame">
    {#if drift}
      <div class="gallery-picture__drift" data-lp-parallax="1">
        <Media image={picture.url} alt={picture.alt} />
      </div>
    {:else}
      <Media image={picture.url} alt={picture.alt} />
    {/if}
  </div>
  {#if picture.caption}
    <figcaption
      class="gallery-picture__caption"
      data-lp-on-media={captionAt === 'over' ? '' : undefined}
    >
      {picture.caption}
    </figcaption>
  {/if}
</figure>

<style>
  .gallery-picture {
    position: relative;
    display: grid;
    align-content: start;
    gap: var(--space-3);
    margin: 0;
  }

  .gallery-picture[data-fill] {
    grid-template-rows: minmax(0, 1fr);
    block-size: 100%;
  }

  .gallery-picture__frame {
    position: relative;
    overflow: clip;
    border-radius: var(--lp-radius-media);
    background: var(--lp-panel);
  }

  /* The frame owns the shape; the media fills it edge to edge. */
  .gallery-picture__frame :global(.lp-media) {
    position: absolute;
    inset: 0;
    border-radius: 0;
  }

  .gallery-picture__drift {
    position: absolute;
    inset: calc(-1 * var(--space-5)) 0;
  }

  /* global.css sets every figcaption small and muted; this one is the section's. */
  .gallery-picture__caption {
    margin: 0;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-title);
    text-wrap: pretty;
  }

  .gallery-picture[data-caption='over'] .gallery-picture__caption {
    position: absolute;
    inset-inline: 0;
    inset-block-end: 0;
    padding: var(--space-3) var(--space-4);
    border-end-start-radius: var(--lp-radius-media);
    border-end-end-radius: var(--lp-radius-media);
    background: var(--lp-media-scrim);
    color: var(--lp-ink);
  }
</style>

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
  (a mosaic's broad tiles, `mosaicCaption`).

  `drift` makes this the layout's moving picture (03 §6): it rides a wrapper
  of its own, grown by the drift at both ends so no edge ever shows. The frame
  clips with `overflow: clip`, which is no scroll container, so the drift is
  timed by the page's scroll.

  With `onopen` the whole picture is a button that opens it in the lightbox
  (p3n §4), laid over the frame so the frame, its media and the caption keep
  the nesting the Styles dress. It is drawn on the canvas too, so the canvas
  shows the page's own markup; there the block ignores the press.
-->
<script lang="ts">
  import Media from '../../primitives/Media.svelte';
  import type { OpenPicture, Picture } from './arrange';
  import { GALLERY_COPY } from './copy';

  interface Props {
    picture: Picture;
    captionAt?: 'under' | 'over';
    /** Fill a tile of fixed shape rather than take a shape of its own. */
    fill?: boolean;
    drift?: boolean;
    /** Its place in the set, from 0, and the set's size: the press's words. */
    index?: number;
    count?: number;
    onopen?: OpenPicture;
  }

  const {
    picture,
    captionAt = 'under',
    fill = false,
    drift = false,
    index = 0,
    count = 1,
    onopen,
  }: Props = $props();
</script>

<figure
  class="gallery-picture"
  data-fill={fill ? '' : undefined}
  data-caption={picture.caption ? captionAt : undefined}
>
  <div class="gallery-picture__frame">
    {#if drift}
      <div class="gallery-picture__drift" data-lp-parallax="1">
        <Media
          image={picture.url}
          srcset={picture.srcset}
          sizes={picture.sizes}
          alt={picture.alt}
          focus={picture.focus}
        />
      </div>
    {:else}
      <Media
        image={picture.url}
        srcset={picture.srcset}
        sizes={picture.sizes}
        alt={picture.alt}
        focus={picture.focus}
      />
    {/if}
    {#if onopen}
      <button
        type="button"
        class="gallery-picture__open"
        aria-label={GALLERY_COPY.open(index + 1, count, picture.alt)}
        onclick={(event) => onopen(index, event.currentTarget)}
      ></button>
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

  /* A bare button over the whole frame: the picture is the press. The frame
     clips, so the focus ring is drawn inside it, on a band of the ground's
     own colour that holds it clear of any photograph. */
  .gallery-picture__open {
    position: absolute;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: zoom-in;
  }

  .gallery-picture__open:focus-visible {
    outline: var(--border-width-thick) solid var(--lp-focus);
    outline-offset: calc(-1 * var(--border-width-thick));
    box-shadow: inset 0 0 0 calc(2 * var(--border-width-thick)) var(--lp-bg);
  }

  /* The canvas and the thumbnails open nothing. */
  :global(.lp[data-lp-still]) .gallery-picture__open {
    cursor: default;
  }

  /* global.css sets every figcaption small and muted; this one is the section's. */
  .gallery-picture__caption {
    margin: 0;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-title);
    text-wrap: pretty;
  }

  /* Laid over the picture, it lets a press through to the picture's button. */
  .gallery-picture[data-caption='over'] .gallery-picture__caption {
    position: absolute;
    inset-inline: 0;
    inset-block-end: 0;
    padding: var(--space-3) var(--space-4);
    border-end-start-radius: var(--lp-radius-media);
    border-end-end-radius: var(--lp-radius-media);
    background: var(--lp-media-scrim);
    color: var(--lp-ink);
    pointer-events: none;
  }
</style>

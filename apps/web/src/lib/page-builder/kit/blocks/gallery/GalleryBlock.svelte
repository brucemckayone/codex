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

  OPENING. Every picture, in every layout, is a button that opens the set in
  the lightbox (GalleryLightbox, p3n §4) on that picture; closing it gives
  focus back to the tile. The lightbox exists only while open, so the page's
  markup and the canvas's stay the same, and on the canvas or a thumbnail a
  press opens nothing: a click there belongs to the editor. A browser with no
  modal `<dialog>` (Safari before 15.4), or one whose dialog refuses to open,
  opens the picture's large file in a tab of its own instead, and where it
  refuses the tab too, in this one.

  EMPTY. The public page keeps only the words. Wherever the section is only
  being looked at — the canvas, the layout picker, the section gallery, any
  still thumbnail (`.lp[data-lp-still]`) — the layout draws itself in the kit's
  designed plates, so its shape reads before a picture exists; a sample never
  points at a made-up image. While editing, the prompt sits over them.
-->
<script lang="ts">
  import { logger } from '$lib/observability';
  import { hasHead } from '../../model/read';
  import { pageImageSrcset, resolvePageImageUrl, storedFocus } from '../../../page-images';
  import type { BlockProps } from '../../model/types';
  import { getKitPage } from '../../page-context';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Text from '../../primitives/Text.svelte';
  import {
    fullPicture,
    type OpenPicture,
    type Picture,
    pictureSizes,
    pictureVariant,
  } from './arrange';
  import { GALLERY_COPY } from './copy';
  import { GALLERY_EMPTY, galleryDefinition } from './definition';
  import GalleryGrid from './GalleryGrid.svelte';
  import GalleryLightbox from './GalleryLightbox.svelte';
  import GalleryMosaic from './GalleryMosaic.svelte';
  import GalleryStrip from './GalleryStrip.svelte';

  const { props, section, context, edit }: BlockProps = $props();
  const page = getKitPage();

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
      // Every size it has, chosen at its tile's width (Codex-61zsk.66).
      srcset: pageImageSrcset(item.image, context.mediaBaseUrl),
      sizes: pictureSizes(layout, index, all.length, page.style),
      alt: item.image.alt ?? '',
      caption: item.caption,
      focus: storedFocus(item.image),
      full: fullPicture(item.image, context.mediaBaseUrl),
    }))
  );
  const plates = $derived<Picture[]>(
    Array.from({ length: PLATES[layout] }, () => ({ url: null, alt: '' }))
  );
  /** Every picture has a file to show large: none do without a CDN base. */
  const opens = $derived(pictures.every((picture) => picture.full));
  /** The strip's and the lightbox's name for a screen reader: the heading, when there is one. */
  const name = $derived(content.heading ?? GALLERY_COPY.pictures);

  /** The picture the lightbox opened on, from 0; `null` while it is closed. */
  let shown = $state<number | null>(null);
  /** The tile it opened from, which takes focus back when it closes. */
  let opener: HTMLElement | null = null;

  /** Whether this browser can show the lightbox: a modal `<dialog>`. */
  function modals() {
    return (
      typeof HTMLDialogElement === 'function' &&
      typeof HTMLDialogElement.prototype.showModal === 'function'
    );
  }

  /**
   * Picture `index`'s large file without the lightbox: in a tab of its own,
   * cut loose from this page once open. `noopener` would do that, but then
   * the browser answers `null` whether it opened one or not, and a refused
   * popup would show nothing; refused, the file opens in this tab. Heard at
   * `warn`, the lowest level production sends on, and before a refusal takes
   * the visitor off the page: the sink's keepalive send outlives that.
   */
  function inTab(index: number) {
    const file = pictures[index]?.full;
    if (!file) return;
    const tab = window.open(file.url, '_blank');
    logger.warn('gallery.lightbox_tab_fallback', { opened: Boolean(tab) });
    if (tab) tab.opener = null;
    else location.assign(file.url);
  }

  const open: OpenPicture = (index, from) => {
    if (edit || page.still) return;
    if (!modals()) {
      inTab(index);
      return;
    }
    opener = from;
    shown = index;
  };

  function close() {
    shown = null;
    opener?.focus();
    opener = null;
  }
</script>

{#snippet arrangement(set: readonly Picture[], onopen?: OpenPicture)}
  {#if layout === 'strip'}
    <GalleryStrip pictures={set} label={name} anchor={section.anchor} {onopen} />
  {:else if layout === 'grid'}
    <GalleryGrid pictures={set} {onopen} />
  {:else}
    <GalleryMosaic pictures={set} {onopen} />
  {/if}
{/snippet}

<div class="gallery" class:lp-bleed={layout === 'strip'} data-layout={layout}>
  {#if hasHead(content)}
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
    {@render arrangement(pictures, opens ? open : undefined)}
    {#if shown !== null}
      <GalleryLightbox {pictures} start={shown} label={name} onclose={close} onfail={inTab} />
    {/if}
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

  /* The measure is its heading's room too (louder's fit, 03 X62). */
  .gallery__head {
    display: grid;
    gap: var(--lp-stack);
    max-inline-size: calc(var(--lp-measure) * var(--lp-measure-unit));
    --lp-heading-column: calc(var(--lp-measure) * var(--lp-measure-unit));
  }

  /* The heading measures itself in its own face's `0`s, not the body's. */
  .gallery__head :global(.lp-heading) {
    max-inline-size: calc(20 * var(--lp-measure-unit));
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

<!--
  @component PictureBlock

  One picture on its own (03 X64), drawn the way the Style draws pictures.
  Three forms:
    contained — the whole picture at its own shape, centred in the column,
                never cropped and never taller than about 45rem
    full      — edge to edge across the band: 2:1 wide, 3:2 from 34rem and
                4:5 on a phone, cropped around the picture's focal point
    beside    — the picture and its words in a 7:5 row from 52rem, the words
                at the picture's foot like a gallery label; stacked on a phone

  The caption is never laid over the photograph: words on a picture would
  need a scrim, and this section's job is the picture. It sits under the
  picture, or beside it, in the soft ink.

  The picture offers every size it has (`pageImageSrcset`, the `xl` only when
  its reference carries its size), keeps its shape's room before it loads,
  and loads lazily: a Picture is never the opening section.

  EMPTY. With no picture the live page never draws this section: it is
  folded before the bands are resolved (`foldForVisitors`). A picture that
  fails to load hides its figure there too, never leaving an empty frame. Where
  the page is looked at (the canvas, a still thumbnail), the frame keeps its
  place with the kit's plate, and the canvas says what to do.
-->
<script lang="ts">
  import {
    pageImageSrcset,
    readFocus,
    readSize,
    resolvePageImageUrl,
  } from '../../../page-images';
  import type { BlockProps } from '../../model/types';
  import { getKitPage } from '../../page-context';
  import { editAttrs } from '../../primitives/edit';
  import Media from '../../primitives/Media.svelte';
  import ClipFrame from '../video/ClipFrame.svelte';
  import { CAPTION_PROMPT, PICTURE_PROMPT, pictureDefinition } from './definition';

  const { props, section, context, edit }: BlockProps = $props();

  const page = getKitPage();
  const content = $derived(pictureDefinition.coerce(props));
  const layout = $derived(section.layout);
  const size = $derived(readSize(content.image));
  const src = $derived(
    resolvePageImageUrl(content.image, size ? 'xl' : 'lg', context.mediaBaseUrl)
  );
  const srcset = $derived(pageImageSrcset(content.image, context.mediaBaseUrl));
  // How wide each form draws the picture, for choosing from the srcset.
  const sizes = $derived(
    layout === 'full'
      ? '100vw'
      : layout === 'beside'
        ? '(min-width: 52rem) 58vw, 100vw'
        : '(min-width: 48rem) 45rem, 100vw'
  );
  // Its own shape, so nothing is cropped in the column. A reference from
  // before sizes were stored has none: it is framed at 3:2.
  const aspect = $derived(size ? size.w / size.h : 1.5);
  const shape = $derived(size ? `${size.w} / ${size.h}` : '3 / 2');
  const captionAttrs = $derived(editAttrs('picture', 'caption', edit));
  const looked = $derived(page.still || !!edit);
</script>

<figure
  class="picture"
  class:lp-bleed={layout === 'full'}
  data-layout={layout}
  style:--_shape={shape}
  style:--_aspect={aspect}
>
  <div class="picture__shot">
    {#if src}
      <Media
        image={src}
        {srcset}
        {sizes}
        alt={content.image?.alt ?? ''}
        ratio="var(--_ratio)"
        focus={layout === 'full' ? readFocus(content.image) : undefined}
        intrinsic={size}
      />
    {:else if looked}
      <ClipFrame ratio="var(--_ratio)" prompt={edit ? PICTURE_PROMPT : undefined} />
    {/if}
  </div>
  {#if content.caption}
    <figcaption class="picture__caption" {...captionAttrs}>{content.caption}</figcaption>
  {:else if edit && layout === 'beside'}
    <figcaption
      class="picture__caption-prompt"
      data-placeholder={CAPTION_PROMPT}
      data-lp-edit-only
      {...captionAttrs}
    ></figcaption>
  {/if}
</figure>

<style>
  .picture {
    --_ratio: var(--_shape);
    display: grid;
    gap: var(--space-3);
    margin: 0;
  }

  .picture__shot {
    display: grid;
    min-inline-size: 0;
  }

  .picture__caption,
  .picture__caption-prompt {
    margin: 0;
    max-inline-size: 52ch;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-body);
    text-wrap: pretty;
  }

  .picture__caption-prompt:empty::before {
    content: attr(data-placeholder);
    opacity: 0.7;
  }

  /* A visitor never meets an empty frame: a picture that will not load
     (deleted, a CDN hiccup) takes its figure with it. */
  :global(.lp:not([data-lp-still])) .picture:has(:global(.lp-media[data-empty])) {
    display: none;
  }

  /* ── in the column: the whole picture, no taller than about 45rem ──────── */
  .picture[data-layout='contained'] {
    justify-items: center;
  }

  .picture[data-layout='contained'] > * {
    inline-size: min(100%, calc(var(--lp-picture-tall) * var(--_aspect)));
  }

  /* ── full width: across the band, cropped around the focal point ───────── */
  /* A subgrid of the band's columns: the picture runs edge to edge, its
     caption keeps the content column. */
  .picture[data-layout='full'] {
    --_ratio: 4 / 5;
    grid-template-columns: subgrid;
  }

  .picture[data-layout='full'] > * {
    grid-column: content;
  }

  .picture[data-layout='full'] > .picture__shot {
    grid-column: bleed;
  }

  .picture[data-layout='full'] :global(.lp-media) {
    border-radius: 0;
  }

  @container (min-width: 34rem) {
    .picture[data-layout='full'] {
      --_ratio: 3 / 2;
    }
  }

  @container (min-width: 56rem) {
    .picture[data-layout='full'] {
      --_ratio: 2 / 1;
    }
  }

  /* ── beside its caption: seven twelfths, the words at its foot ─────────── */
  .picture[data-layout='beside'] .picture__shot {
    inline-size: min(100%, calc(var(--lp-picture-tall) * 0.9 * var(--_aspect)));
  }

  .picture[data-layout='beside'] :is(.picture__caption, .picture__caption-prompt) {
    max-inline-size: 34ch;
    font-size: var(--lp-size-body);
  }

  @container (min-width: 52rem) {
    .picture[data-layout='beside'] {
      grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
      column-gap: var(--lp-gap);
      align-items: end;
    }

    .picture[data-layout='beside'] .picture__shot {
      justify-self: end;
    }
  }
</style>

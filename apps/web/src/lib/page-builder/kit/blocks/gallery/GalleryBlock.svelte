<!--
  @component GalleryBlock

  The creator's own pictures (03-expressive-contract §3, §7). Every layout
  currently renders an even grid of captioned figures; E4 designs `mosaic`,
  `strip` and `grid` on top of it. A picture's description is its `ImageRef`
  alt; a caption is a visible `figcaption`, not a stand-in for the alt.
-->
<script lang="ts">
  import { resolvePageImageUrl } from '../../../page-images';
  import type { BlockProps } from '../../model/types';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Media from '../../primitives/Media.svelte';
  import Text from '../../primitives/Text.svelte';
  import { GALLERY_EMPTY, galleryDefinition } from './definition';

  const { props, section, context, edit }: BlockProps = $props();

  const content = $derived(galleryDefinition.coerce(props));
  const items = $derived(content.items ?? []);
  const images = $derived(
    items.map((item) => resolvePageImageUrl(item.image, 'md', context.mediaBaseUrl))
  );
</script>

<div class="gallery" data-layout={section.layout}>
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

  {#if items.length > 0}
    <ul class="gallery__items" data-count={items.length}>
      {#each items as item, index (index)}
        <li>
          <figure class="gallery__figure">
            <Media image={images[index]} alt={item.image.alt ?? ''} ratio="4 / 3" />
            {#if item.caption}<figcaption>{item.caption}</figcaption>{/if}
          </figure>
        </li>
      {/each}
    </ul>
  {:else if edit}
    <p class="gallery__empty" data-lp-edit-only>{GALLERY_EMPTY}</p>
  {/if}
</div>

<style>
  .gallery {
    display: grid;
    gap: var(--lp-gap);
  }

  .gallery__head {
    display: grid;
    gap: var(--lp-stack);
    max-inline-size: var(--lp-measure);
  }

  .gallery__items {
    display: grid;
    gap: var(--lp-gap);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* base.css spaces every `li` but the last, which unevens a grid row. */
  .gallery__items li {
    margin: 0;
  }

  .gallery__figure {
    display: grid;
    gap: var(--space-2);
    margin: 0;
  }

  .gallery__figure figcaption {
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-body);
  }

  /* global.css caps every `p` at 65ch; the prompt spans its region. */
  .gallery__empty {
    max-inline-size: none;
    margin: 0;
    padding: var(--space-6);
    border: var(--lp-border) var(--border-style-dashed) var(--lp-button-line);
    border-radius: var(--lp-radius-card);
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    text-align: center;
  }

  @container (min-width: 36rem) {
    .gallery__items:not([data-count='1']) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @container (min-width: 60rem) {
    .gallery__items:not([data-count='1'], [data-count='2'], [data-count='4']) {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>

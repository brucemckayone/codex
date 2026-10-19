<!--
  @component BenefitsBento

  The `bento` layout: tiles of mixed sizes (`bento.ts` designs every count
  from one to nine). The first tile is the largest and the section's one
  filled card; the others are outlined. Each tile's words sit at its foot,
  and a tile whose item has a picture shows it across its top, edge to edge
  (A5: offered for every item here, so every tile honours it). The lead's
  picture is the layout's moving one: it drifts gently inside its frame.

  Wide, six columns; from 36rem, two, the lead across both; narrower, one.
-->
<script lang="ts">
  import type { ColourSchemeId } from '../../model/ids';
  import Heading from '../../primitives/Heading.svelte';
  import Mark from '../../primitives/Mark.svelte';
  import Media from '../../primitives/Media.svelte';
  import { storedFocus } from '../../../page-images';
  import { bentoTiles } from './bento';
  import type { BenefitItem } from './definition';

  interface Props {
    items: readonly BenefitItem[];
    /** Each item's picture, resolved; `null` for none. */
    images: readonly (string | null)[];
    level: 1 | 2 | 3;
    /** The lead tile's scheme: the Style's filled card for this section. */
    featured: ColourSchemeId;
  }

  const { items, images, level, featured }: Props = $props();

  const tiles = $derived(bentoTiles(items.length));
</script>

<ul class="benefits-bento" data-count={items.length}>
  {#each items as item, index (index)}
    <li
      class="benefits-bento__tile"
      data-tile={tiles[index]}
      data-lead={index === 0 ? '' : undefined}
      data-lp-scheme={index === 0 ? featured : undefined}
      data-pictured={images[index] ? '' : undefined}
    >
      {#if images[index]}
        <div class="benefits-bento__picture">
          {#if index === 0}
            <div class="benefits-bento__drift" data-lp-parallax="1">
              <Media image={images[index]} alt={item.image?.alt ?? ''} focus={storedFocus(item.image)} />
            </div>
          {:else}
            <Media image={images[index]} alt={item.image?.alt ?? ''} focus={storedFocus(item.image)} />
          {/if}
        </div>
      {/if}
      <div class="benefits-bento__words">
        {#if item.mark}<span class="benefits-bento__mark"><Mark mark={item.mark} /></span>{/if}
        <Heading {level} size="title" text={item.title} type="benefits" />
        {#if item.detail}<p class="benefits-bento__detail">{item.detail}</p>{/if}
      </div>
    </li>
  {/each}
</ul>

<style>
  .benefits-bento {
    --_gap: clamp(var(--space-3), 0.5rem + 1cqi, var(--space-5));
    --_row: clamp(9rem, 6rem + 5cqi, 12rem);
    --_cols: 1;
    display: grid;
    grid-template-columns: repeat(var(--_cols), minmax(0, 1fr));
    gap: var(--_gap);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* A tile spans `--_span` of the row's `--_cols`, so its name knows its
     room (03 X71): those columns and the gaps between them, less its inset,
     its padding and border (Bold opens every tile but the lead). */
  .benefits-bento__tile {
    --_pad: clamp(var(--space-5), var(--space-4) + 1cqi, var(--space-8));
    --_span: 1;
    --_inset: calc(var(--_pad) + var(--lp-border));
    --lp-title-column: calc(
      (var(--lp-column) - (var(--_cols) - 1) * var(--_gap)) / var(--_cols) * var(--_span) +
        (var(--_span) - 1) * var(--_gap) - 2 * var(--_inset)
    );
    grid-column: span var(--_span);
    display: grid;
    align-content: end;
    gap: var(--space-4);
    min-inline-size: 0;
    margin: 0;
    padding: var(--_pad);
    overflow: clip;
    border: var(--lp-border) var(--border-style) var(--lp-line);
    border-radius: var(--lp-radius-card);
  }

  /* The one filled card. */
  .benefits-bento__tile[data-lead] {
    border-color: transparent;
    background: var(--lp-bg);
    color: var(--lp-ink);
  }

  /* A picture takes the tile's top, edge to edge; the words keep the foot. */
  .benefits-bento__tile[data-pictured] {
    grid-template-rows: minmax(0, 1fr) auto;
    align-content: stretch;
  }

  .benefits-bento__picture {
    position: relative;
    min-block-size: clamp(8rem, 18cqi, 13rem);
    margin: calc(-1 * var(--_pad)) calc(-1 * var(--_pad)) 0;
    overflow: clip;
    aspect-ratio: 16 / 9;
  }

  .benefits-bento__picture :global(.lp-media) {
    position: absolute;
    inset: 0;
    border-radius: 0;
  }

  .benefits-bento__drift {
    position: absolute;
    inset: calc(-1 * var(--space-5)) 0;
  }

  .benefits-bento__words {
    display: grid;
    gap: var(--space-2);
  }

  /* An item's mark above its name, its stroke in the mark ink, as in the
     grid (BenefitsBlock). */
  .benefits-bento__mark {
    display: inline-flex;
    justify-self: start;
    margin-block-end: var(--space-1);
    font-size: var(--space-7);
    line-height: 1;
  }

  .benefits-bento__mark :global(svg) {
    stroke: var(--lp-mark-ink);
  }

  /* The lead speaks a size up, in a heading's size, weight, leading and
     tracking, through the title's own rule, so it is fitted to its tile as
     every name is (03 X71). Single-weight display faces keep their weight. */
  .benefits-bento__tile[data-lead] :global(.lp-heading) {
    --lp-title-lift: 1;
    --lp-weight-title: var(--lp-weight-heading);
    --lp-leading-title: var(--lp-leading-heading);
    --lp-tracking-title: var(--lp-tracking-heading);
    max-inline-size: 18ch;
  }

  /* global.css caps every `p` at 65ch and spaces it; a tile sets its own. */
  .benefits-bento__detail {
    max-inline-size: 48ch;
    margin: 0;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
    text-wrap: pretty;
  }

  /* Two to a row: the lead across both, and a last tile left alone too. */
  @container (36rem <= width < 56rem) {
    .benefits-bento {
      --_cols: 2;
    }

    .benefits-bento__tile[data-lead],
    .benefits-bento__tile:last-child:nth-child(even) {
      --_span: 2;
    }
  }

  /* Wide: tiles of fixed spans on six columns, rows at least one tile deep;
     a picture fills whatever its tile leaves above the words. */
  @container (min-width: 56rem) {
    .benefits-bento {
      --_cols: 6;
      grid-auto-rows: minmax(var(--_row), auto);
    }

    .benefits-bento__picture {
      aspect-ratio: auto;
    }

    [data-tile='whole'] {
      --_span: 6;
      grid-row: span 2;
    }

    [data-tile='lead'] {
      --_span: 4;
      grid-row: span 2;
    }

    [data-tile='side'] {
      --_span: 2;
      grid-row: span 2;
    }

    [data-tile='wide'] {
      --_span: 4;
    }

    [data-tile='half'] {
      --_span: 3;
    }

    [data-tile='small'] {
      --_span: 2;
    }
  }
</style>

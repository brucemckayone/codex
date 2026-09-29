<!--
  @component TestimonialsWall

  The `wall` layout: every quote on one wall of tiles, laid in columns like
  masonry, so each tile is exactly as tall as its words and none is cropped
  or stretched (03 §7: columns only). The first quote is featured — the
  section's one filled panel, set large — and a short quote is set large too,
  in the display face, so the wall has rhythm: the few words that land hardest
  take the most room. Longer quotes are set to be read.
-->
<script lang="ts">
  import type { ColourSchemeId } from '../../model/ids';
  import Voice from './Voice.svelte';
  import type { Testimonial } from './voices';

  interface Props {
    voices: readonly Testimonial[];
    /** The featured tile's scheme: the Style's filled card for this section. */
    featured: ColourSchemeId;
  }

  const { voices, featured }: Props = $props();
</script>

<ul class="tm-wall" data-count={voices.length}>
  {#each voices as voice, index (voice.key)}
    <li
      class="tm-wall__tile"
      data-featured={index === 0 ? '' : undefined}
      data-lp-scheme={index === 0 ? featured : undefined}
    >
      <Voice {voice} size="wall" featured={index === 0} />
    </li>
  {/each}
</ul>

<style>
  .tm-wall {
    column-gap: var(--lp-gap);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .tm-wall[data-count='1'] {
    max-inline-size: var(--lp-measure);
  }

  /* A tile never breaks across two columns. base.css's `li` spacing gives way
     to the wall's own gap. */
  .tm-wall__tile {
    break-inside: avoid;
    margin: 0 0 var(--lp-gap);
    padding: clamp(var(--space-5), var(--space-4) + 1cqi, var(--space-8));
    border: var(--lp-border) var(--border-style) var(--lp-line);
    border-radius: var(--lp-radius-card);
  }

  .tm-wall__tile[data-featured] {
    border-color: transparent;
    background: var(--lp-bg);
    color: var(--lp-ink);
  }

  /* The opening mark hangs outside the quote's words (`Voice`: 0.42em of a
     quote set in the display face, 0.4em of one set to be read). The room
     for it is added on the voice, not the tile, so it comes on top of
     whatever padding a Style gives the tile: the mark clears the edge by that
     whole padding, and the words and the name still share one edge. The
     sizes are the Voice's own, case by case. */
  .tm-wall__tile > :global(.voice) {
    --_quote: var(--lp-size-lead);
    --_hang: 0.4;
    padding-inline-start: calc(var(--_quote) * var(--_hang));
  }

  .tm-wall__tile > :global(.voice[data-length='long']) {
    --_quote: var(--lp-size-body);
  }

  .tm-wall__tile > :global(.voice:is([data-length='short'], [data-featured])) {
    --_quote: var(--lp-size-title);
    --_hang: 0.42;
  }

  .tm-wall__tile > :global(.voice[data-featured]:not([data-length='long'])) {
    --_quote: calc((var(--lp-size-heading) + var(--lp-size-title)) / 2);
  }

  @container (min-width: 40rem) {
    .tm-wall:not([data-count='1']) {
      columns: 2;
    }
  }

  /* Three columns, except where two divides the set evenly. */
  @container (min-width: 62rem) {
    .tm-wall:not([data-count='1'], [data-count='2'], [data-count='4']) {
      columns: 3;
    }
  }
</style>

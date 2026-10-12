<!--
  @component PracticeTile

  What a practice card's frame shows when the practice has no picture, or
  its picture fails: the kind's icon in a ring, on the brand colour, so a
  course with no thumbnails still reads as designed. Decoration: the card's
  words already say what the practice is.

  On a band that is already filled (brand, accent, the dark contrast) the
  brand would vanish into it or smear against it, so the tile takes the
  band's own panel instead (`ground="panel"`). The brand ground is a nested
  `brand` scheme, so its ink is the kit's proven ink on the brand
  (`styles/schemes.css`), whatever the brand.

  Fills the frame it is drawn in (`Media`'s, positioned).
-->
<script lang="ts">
  import type { JourneyPracticeView } from '$lib/page-builder';
  import { practiceIcon } from './practice-card';

  interface Props {
    type: JourneyPracticeView['contentType'];
    ground?: 'brand' | 'panel';
  }

  const { type, ground = 'brand' }: Props = $props();

  const Icon = $derived(practiceIcon(type));
</script>

<span
  class="practice-tile"
  data-ground={ground}
  data-lp-scheme={ground === 'brand' ? 'brand' : undefined}
  aria-hidden="true"
>
  <Icon size="1em" />
</span>

<style>
  .practice-tile {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--lp-bg);
    color: var(--lp-ink);
    font-size: clamp(var(--space-7), 2.4cqi, var(--space-10));
  }

  .practice-tile[data-ground='panel'] {
    background: var(--lp-panel);
    color: var(--lp-panel-ink);
  }

  .practice-tile::before,
  .practice-tile::after {
    content: '';
    position: absolute;
    aspect-ratio: 1;
    border-radius: var(--radius-full);
  }

  .practice-tile::before {
    block-size: 74%;
    border: var(--border-width) var(--border-style) color-mix(in oklab, currentColor 26%, transparent);
  }

  .practice-tile::after {
    block-size: 44%;
    background: color-mix(in oklab, currentColor 10%, transparent);
  }

  .practice-tile > :global(svg) {
    position: relative;
    z-index: 1;
    stroke-width: 1.5;
  }
</style>

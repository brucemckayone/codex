<!--
  @component HeroPoster

  The `poster` hero (03 §3, §7): the headline at the Style's full display
  size, set AROUND a picture that runs off the band's far edge and its foot.

  Wide, the picture floats at the end of the line and the words wrap round
  it: its shape is its content box, so the headline's first line passes over
  the drop above it at full width and the lines after it step in beside the
  picture — the words never sit on the photograph, so it needs no scrim. The
  lede and the buttons follow round it. Narrow, the words stack and the
  picture closes the band edge to edge. With no picture it is a type-only
  poster: the headline at the top, the lede and the buttons at the foot.

  Only the picture reaches the edges (03 X10): the words keep the content
  column, so this is never `.lp-bleed`. The picture paints in the first HTML
  (`priority`); it takes the hero's one entrance (`hero__enter-m`) on its
  outer box and a wipe as it scrolls in (`data-lp-reveal`) on its inner one.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { PreviewMedia } from '../../../render/types';
  import Media from '../../primitives/Media.svelte';

  interface Props {
    still: string | null;
    clip: PreviewMedia | null;
    alt: string;
    /** The hero's own words: eyebrow, headline, lede and buttons. */
    copy: Snippet<['start' | 'center']>;
    /** The play button laid over a clip. */
    watch: Snippet;
  }

  const { still, clip, alt, copy, watch }: Props = $props();

  const pictured = $derived(Boolean(still || clip));
</script>

<div class="hero-poster" data-pictured={pictured ? '' : undefined}>
  {#if pictured}
    <div class="hero-poster__media hero__enter-m">
      <div class="hero-poster__reveal" data-lp-reveal="wipe">
        {#if clip}
          <Media image={still} {clip} priority {alt}>{@render watch()}</Media>
        {:else}
          <Media image={still} priority {alt} />
        {/if}
      </div>
    </div>
  {/if}
  {@render copy('start')}
</div>

<style>
  .hero-poster {
    /* The distance from the section's edge to the content column's. */
    --_inset: max(var(--lp-gutter), (100cqi - var(--lp-container)) / 2);
    display: grid;
    gap: var(--lp-stack);
  }

  /* ── narrow: the words, then the picture edge to edge off the foot ─────── */
  .hero-poster__media {
    order: 1;
    margin-block: var(--lp-gap) calc(-1 * var(--lp-pad));
    margin-inline: calc(-1 * var(--_inset));
  }

  .hero-poster__reveal {
    position: relative;
    aspect-ratio: 4 / 5;
  }

  .hero-poster__reveal :global(.lp-media) {
    position: absolute;
    inset: 0;
    border-radius: 0;
  }

  /* ── wide: the words set round the picture ─────────────────────────────── */
  @container (min-width: 56rem) {
    .hero-poster[data-pictured] {
      display: flow-root;
    }

    /* The drop is one headline line (and the label, when there is one) plus
       the shape's own margin, which reaches up as well as out — so the first
       line runs the full width above the picture. */
    .hero-poster__media {
      --_line: calc(
        var(--lp-size-display) * var(--lp-display-scale, 1) * var(--lp-leading-display)
      );
      --_drop: calc(var(--_line) + var(--lp-gap) + var(--space-2));
      float: inline-end;
      inline-size: calc(46% + var(--_inset));
      margin-block: 0 calc(-1 * var(--lp-pad));
      /* Lines of text keep the shape's margin; a box that lays out its own
         content (the lede, the buttons) keeps clear of the float's margin
         box instead, so both need the same gap. */
      margin-inline: var(--lp-gap) calc(-1 * var(--_inset));
      padding-block-start: var(--_drop);
      shape-outside: content-box;
      shape-margin: var(--lp-gap);
    }

    .hero-poster:has(> :global(.hero__eyebrow)) .hero-poster__media {
      --_drop: calc(
        var(--lp-size-label) * 1.5 + var(--lp-stack) + var(--_line) + var(--lp-gap) + var(--space-2)
      );
    }

    .hero-poster__reveal {
      aspect-ratio: 5 / 4;
    }

    /* Only the corner inside the band is rounded; the others are cut by it. */
    .hero-poster__reveal :global(.lp-media) {
      border-start-start-radius: var(--lp-radius-media);
    }

    /* In a block container (the float needs one) the pieces part by margins. */
    .hero-poster[data-pictured]
      > :global(
        :is(.hero__eyebrow, .hero__headline, .hero__lede, .hero__actions)
          ~ :is(.hero__headline, .hero__lede, .hero__actions)
      ) {
      margin-block-start: var(--lp-stack);
    }

    /* Balancing evens every line out and leaves the first one short of the
       picture; filled greedily, the first line runs over it. */
    .hero-poster[data-pictured] :global(.lp-heading) {
      text-wrap: pretty;
    }
  }

  /* ── no picture: a type-only poster ────────────────────────────────────── */
  .hero-poster:not([data-pictured]) {
    display: flex;
    flex-direction: column;
    min-block-size: clamp(24rem, 42cqi, 38rem);
  }

  /* What follows the headline sits at the poster's foot. */
  .hero-poster:not([data-pictured]) > :global(.hero__headline + *) {
    margin-block-start: auto;
  }

  @container (min-width: 56rem) {
    .hero-poster:not([data-pictured]) > :global(:is(.hero__lede, .hero__actions)) {
      align-self: flex-end;
      inline-size: min(100%, 30rem);
    }
  }

  /* The hero's one entrance (keyframes named by the Style), as HeroBlock's. */
  @media (prefers-reduced-motion: no-preference) {
    :global(:root[data-theme] .lp:not([data-lp-still])) .hero-poster__media {
      animation: var(--lp-enter-media);
    }
  }
</style>

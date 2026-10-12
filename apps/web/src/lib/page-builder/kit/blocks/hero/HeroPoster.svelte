<!--
  @component HeroPoster

  The `poster` hero (03 §3, §7): the headline at the Style's full display
  size, set AROUND a picture that runs off the band's far edge and its foot.

  Wide, the picture floats at the end of the line and the words wrap round
  it: its shape is its content box, so the headline's first line passes over
  the drop above it at full width and the lines after it step in beside the
  picture — the words never sit on the photograph, so it needs no scrim. The
  lede and the buttons follow round it. Narrow, the words stack and the
  picture closes the band edge to edge.

  Where the page is looked at (the canvas, a still thumbnail) the picture's
  place is kept (`reserve`): a clip or a still that arrives on the stream
  drops into it, and with none the plate fills it, so nothing moves as the
  stream settles. The public page sets the words round a picture only once it
  has one (Codex-61zsk.37); with none — or "No image" — it is a type-only
  poster: the headline at the top, the lede and the buttons at the foot. The
  words are never re-set either way: only the picture's box comes and goes.

  SIZE (Codex-61zsk.33). The poster is the headline's parent, where a Style
  scales it (`--lp-display-scale`), and it carries the headline's length and
  how wide its words are (`chars`, `runs`: `model/long-heading.ts`). Wide, a
  word wider than its measure would be cut mid-word, so the headline is drawn
  no larger than the measure over its widest word, in the page's display face
  (`styles/faces.css`) and the Style's case and tracking: the first word over
  the column, which the first line runs across above the picture, and every
  word after it over what the picture leaves. A Style's own size where the
  words fit; smaller only where one would not.

  THE FOOT (Codex-61zsk.36). The picture runs off the band's foot, through
  its padding, but its words must still wrap round all of it: the float
  keeps its whole box, and the poster itself reaches into the padding,
  ending its words a padding short of the foot.

  Only the picture reaches the edges (03 X10): the words keep the content
  column, so this is never `.lp-bleed`. The picture paints in the first HTML
  (`priority`); it takes the hero's one entrance (`hero__enter-m`) on its
  outer box and a wipe as it scrolls in (`data-lp-reveal`) on its inner one.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { PreviewMedia } from '../../../render/types';
  import type { HeadingRuns } from '../../model/long-heading';
  import Media from '../../primitives/Media.svelte';

  interface Props {
    still: string | null;
    clip: PreviewMedia | null;
    alt: string;
    /** The hero's own words: eyebrow, headline, lede and buttons. */
    copy: Snippet<['start' | 'center']>;
    /** The headline's length, for a Style that scales it (`--lp-heading-chars`). */
    chars: number;
    /** How wide the headline's words are (`model/long-heading.ts`). */
    runs: HeadingRuns;
    /** The play button laid over a clip. */
    watch: Snippet;
    /**
     * Keep the picture's place though there is no still yet — only where the
     * page is looked at: one may arrive on the streamed preview, and the
     * plate stands in for it until then (or for good), so the words are set
     * round it from the first paint.
     */
    reserve?: boolean;
  }

  const { still, clip, alt, copy, chars, runs, watch, reserve = false }: Props = $props();

  const pictured = $derived(Boolean(still || clip) || reserve);
</script>

<div
  class="hero-poster"
  data-pictured={pictured ? '' : undefined}
  style:--lp-heading-chars={chars}
  style:--lp-heading-first-caps={runs.first.caps}
  style:--lp-heading-first-text={runs.first.text}
  style:--lp-heading-first-chars={runs.first.chars}
  style:--lp-heading-widest-caps={runs.widest.caps}
  style:--lp-heading-widest-text={runs.widest.text}
  style:--lp-heading-widest-chars={runs.widest.chars}
>
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
    /* The words' widths as the Style draws them: in the face's em per unit
       of weight (`styles/faces.css`), as written or in capitals. */
    --_scale: var(--lp-face-text);
    --_first: var(--lp-heading-first-text, 0);
    --_widest: var(--lp-heading-widest-text, 0);
    /* The Style's tracking, per character in em: 0 where a browser cannot
       divide a length by a length (below), which only draws a word narrower
       than reckoned, since every Style tracks its display tight. */
    --_track: 0;
    display: grid;
    gap: var(--lp-stack);
  }

  @container lp-page style(--lp-case-display: uppercase) {
    .hero-poster {
      --_scale: var(--lp-face-caps);
      --_first: var(--lp-heading-first-caps, 0);
      --_widest: var(--lp-heading-widest-caps, 0);
    }
  }

  /* A real property: a test of a custom one always passes. */
  @supports (width: calc(1px * (1px / 1px))) {
    .hero-poster {
      --_track: calc(var(--lp-tracking-display) / 1em);
    }
  }

  /* ── narrow: the words, then the picture edge to edge off the foot ─────── */
  .hero-poster__media {
    order: 1;
    margin-block: var(--lp-gap) calc(-1 * var(--lp-pad));
    margin-inline: calc(-1 * var(--_inset));
  }

  .hero-poster__reveal {
    /* The empty picture's sheet (below), from the panel it would have had. */
    --_plate: color-mix(
      in oklab,
      color-mix(in oklab, var(--lp-panel), var(--lp-brand) var(--lp-tint-panel)),
      var(--lp-panel-ink) 5%
    );
    position: relative;
    aspect-ratio: 4 / 5;
  }

  /* An empty picture is the plate, in the panel's colour — which on a band is
     the page's own ground, and this picture runs off the band's foot into the
     next section's ground, where a blank sheet has no edge. So its sheet is
     the panel tinted with the brand, as cards on the ground are, and a step
     toward its own ink: a pale brand on a light page or a dark one on a dark
     page tints the ground too little to show alone. The marks stay the
     panel's ink. Paint only: the box is the picture's either way. */
  .hero-poster__reveal :global(.lp-media[data-empty]) {
    --lp-panel: var(--_plate);
  }

  .hero-poster__reveal :global(.lp-media) {
    position: absolute;
    inset: 0;
    border-radius: 0;
  }

  /* ── wide: the words set round the picture ─────────────────────────────── */
  @container (min-width: 56rem) {
    /* The size: the Style's, or the largest at which each word fits its
       measure, whichever is smallest. The first word has the column; the
       words after it, what the picture leaves (below), or the column again
       on a poster with no picture. A run's em width is its weight times the
       face's scale, plus its tracking. */
    .hero-poster {
      --_column: calc(100cqi - 2 * var(--_inset));
      --_beside: var(--_column);
      --_display: min(
        var(--lp-size-display) * var(--lp-display-scale, 1),
        var(--_column) /
          max(
            0.01,
            var(--_first) * var(--_scale) + var(--lp-heading-first-chars, 0) * var(--_track)
          ),
        var(--_beside) /
          max(
            0.01,
            var(--_widest) * var(--_scale) + var(--lp-heading-widest-chars, 0) * var(--_track)
          )
      );
    }

    .hero-poster :global(.lp-heading[data-size='display']) {
      font-size: var(--_display);
    }

    .hero-poster[data-pictured] {
      --_beside: calc(var(--_column) * 0.54 - var(--lp-gap));
      display: flow-root;
      /* Into the band's padding, with the picture: the words end a padding
         short of the foot (the spacer below), the picture at it. */
      margin-block-end: calc(-1 * var(--lp-pad));
    }

    .hero-poster[data-pictured]::after {
      content: '';
      display: block;
      block-size: var(--lp-pad);
    }

    /* The drop is one headline line (and the label, when there is one) plus
       the shape's own margin, which reaches up as well as out — so the first
       line runs the full width above the picture. */
    .hero-poster__media {
      --_line: calc(var(--_display) * var(--lp-leading-display));
      --_drop: calc(var(--_line) + var(--lp-gap) + var(--space-2));
      /* Its share of the column is the 0.54 the measure above leaves. */
      float: inline-end;
      inline-size: calc(46% + var(--_inset));
      /* Its whole box, so every line wraps round all of the picture. */
      margin-block: 0;
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

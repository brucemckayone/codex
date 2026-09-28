<!--
  @component TestimonialsMarquee

  The `marquee` layout: the quotes as cards on a strip that drifts slowly
  across the page (03 §7). The strip is the set of cards and enough copies of
  it (`marqueeCopies`) side by side; each set slides one set's width and
  starts again, so the motion never jumps. Only the first set is read: every
  copy is `aria-hidden` and `inert`.

  It moves only where motion is welcome and can be stopped (WCAG 2.2.2): a
  visible pause button (`aria-pressed`), and a pointer resting on it or focus
  inside it holds it too. Reduced motion, a still page (the canvas, every
  thumbnail), print, no JavaScript and fewer than three quotes draw the cards
  still, wrapped in rows, with no copies and no button — the final state.

  Style hook: `--lp-marquee-pace`, the time one card takes to pass.
-->
<script lang="ts">
  import { PauseIcon } from '$lib/components/ui/Icon';
  import { TESTIMONIALS_COPY } from './copy';
  import { marqueeCopies } from './marquee';
  import Voice from './Voice.svelte';
  import type { Testimonial } from './voices';

  interface Props {
    voices: readonly Testimonial[];
  }

  const { voices }: Props = $props();

  let paused = $state(false);
  const copies = $derived(marqueeCopies(voices.length));
</script>

{#snippet cards(copy: boolean)}
  <ul class="tm-marquee__lane" data-copy={copy ? '' : undefined} aria-hidden={copy ? 'true' : undefined} inert={copy}>
    {#each voices as voice (voice.key)}
      <li class="tm-marquee__card"><Voice {voice} /></li>
    {/each}
  </ul>
{/snippet}

<div
  class="tm-marquee"
  data-moving={copies > 0 ? '' : undefined}
  data-paused={paused ? '' : undefined}
  style:--tm-count={voices.length}
>
  {#if copies > 0}
    <div class="tm-marquee__controls">
      <button
        type="button"
        class="tm-marquee__toggle"
        aria-pressed={paused}
        aria-label={TESTIMONIALS_COPY.pauseLabel}
        onclick={() => (paused = !paused)}
      >
        <PauseIcon size="1.1em" />
        <span>{TESTIMONIALS_COPY.pause}</span>
      </button>
    </div>
  {/if}
  <div class="tm-marquee__window">
    {@render cards(false)}
    {#each Array.from({ length: copies }) as _, index (index)}
      {@render cards(true)}
    {/each}
  </div>
</div>

<style>
  .tm-marquee {
    /* The distance from the section's edge to the content column's. */
    --_inset: max(var(--lp-gutter), (100cqi - var(--lp-container)) / 2);
    /* 22rem at most, with at least a 1.5rem gap: `marquee.ts` counts on it. */
    --_card: min(22rem, 80cqi);
    --_gap: var(--lp-gap);
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
  }

  /* ── still: the final state everywhere motion is not wanted ──────────────── */
  .tm-marquee__controls {
    display: none;
    justify-content: flex-end;
    padding-inline: var(--_inset);
  }

  /* `overflow: clip` is no scroll container, so a grid item keeps its
     content's width as its minimum unless told otherwise: the sets would
     widen the window instead of running off it. */
  .tm-marquee__window {
    min-inline-size: 0;
    padding-inline: var(--_inset);
  }

  /* Still, the cards share the row between them; a lone one keeps a measure. */
  .tm-marquee__lane {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
    gap: var(--_gap);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .tm-marquee__lane:has(> :only-child) {
    max-inline-size: var(--lp-measure);
  }

  .tm-marquee__lane[data-copy] {
    display: none;
  }

  /* base.css spaces every `li` but the last. */
  .tm-marquee__card {
    margin: 0;
    padding: clamp(var(--space-5), var(--space-4) + 1cqi, var(--space-8));
    border: var(--lp-border) var(--border-style) var(--lp-line);
    border-radius: var(--lp-radius-card);
  }

  .tm-marquee__toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-block-size: var(--tap-target-min);
    padding-inline: var(--space-4);
    border-radius: var(--lp-radius-button);
    box-shadow: inset 0 0 0 var(--lp-border) var(--lp-button-line);
    color: var(--lp-ink);
    font-size: var(--lp-size-label);
    font-weight: var(--lp-weight-label);
  }

  .tm-marquee__toggle[aria-pressed='true'] {
    background: var(--lp-button-bg);
    box-shadow: none;
    color: var(--lp-button-ink);
  }

  @media (hover: hover) {
    .tm-marquee__toggle[aria-pressed='false']:hover {
      box-shadow: inset 0 0 0 var(--border-width-thick) var(--lp-button-line);
    }
  }

  /* ── moving: motion welcome, JavaScript running, a live page ─────────────── */
  @media screen and (prefers-reduced-motion: no-preference) {
    :global(:root[data-theme] .lp:not([data-lp-still])) .tm-marquee[data-moving] {
      --_fade: clamp(var(--space-6), 6cqi, var(--space-24));
    }

    :global(:root[data-theme] .lp:not([data-lp-still]))
      .tm-marquee[data-moving]
      .tm-marquee__controls {
      display: flex;
    }

    /* The sets start at the window's own edge, so one cycle ends exactly
       where it began. The edges fade, so no card is cut by a hard line. */
    :global(:root[data-theme] .lp:not([data-lp-still]))
      .tm-marquee[data-moving]
      .tm-marquee__window {
      display: flex;
      overflow: clip;
      padding-inline: 0;
      mask-image: linear-gradient(
        to right,
        transparent,
        currentColor var(--_fade),
        currentColor calc(100% - var(--_fade)),
        transparent
      );
    }

    :global(:root[data-theme] .lp:not([data-lp-still]))
      .tm-marquee[data-moving]
      .tm-marquee__lane {
      display: flex;
      flex: none;
      gap: var(--_gap);
      padding-inline-end: var(--_gap);
      animation: tm-marquee-slide
        calc(var(--tm-count) * var(--lp-marquee-pace, calc(var(--duration-slowest) * 17)))
        linear infinite;
    }

    :global(:root[data-theme] .lp:not([data-lp-still]))
      .tm-marquee[data-moving]
      .tm-marquee__card {
      flex: none;
      inline-size: var(--_card);
    }

    :global(:root[data-theme] .lp:not([data-lp-still]))
      .tm-marquee[data-moving]:is(:hover, :focus-within, [data-paused])
      .tm-marquee__lane {
      animation-play-state: paused;
    }
  }

  @keyframes tm-marquee-slide {
    to {
      translate: -100% 0;
    }
  }
</style>

<!--
  @component StoryStrip

  The `strip` layout: the moments as cards in one row that scrolls sideways —
  the browser's own scrolling, snapping card by card, running to the section's
  edges. The row is a labelled region a keyboard can focus and scroll with
  the arrow keys; the previous and next buttons move one card and rest at the
  ends. Without JavaScript the row still scrolls and the buttons are left out;
  with it their space is kept from the first paint, so nothing moves.

  When no moment has a picture the cards are words only; when some do, an
  unpictured card keeps the row's rhythm with the kit's designed plate.
-->
<script lang="ts">
  import type { Attachment } from 'svelte/attachments';
  import { ChevronLeftIcon, ChevronRightIcon } from '$lib/components/ui/Icon';
  import Media from '../../primitives/Media.svelte';
  import { STORY_COPY } from './copy';
  import type { StoryStep } from './definition';
  import StoryWords from './StoryWords.svelte';

  interface Props {
    steps: readonly StoryStep[];
    images: readonly (string | null)[];
    level: 1 | 2 | 3;
    /** The region's name: the section heading, when there is one. */
    label?: string;
    anchor: string;
  }

  const { steps, images, level, label, anchor }: Props = $props();

  const pictured = $derived(images.some(Boolean));
  const trackId = $derived(`${anchor}-moments`);
  let atStart = $state(true);
  let atEnd = $state(true);
  let track = $state<HTMLElement>();

  /** Keeps the buttons' resting state true to the row's scroll position. */
  function measure(count: number): Attachment<HTMLElement> {
    return (node) => {
      track = node;
      if (count === 0) return;
      const update = () => {
        atStart = node.scrollLeft <= 1;
        atEnd = node.scrollLeft + node.clientWidth >= node.scrollWidth - 1;
      };
      update();
      node.addEventListener('scroll', update, { passive: true });
      // The row as well as the window onto it: the row's width is what
      // changes when cards are added or the styles and fonts arrive.
      const resize = new ResizeObserver(update);
      resize.observe(node);
      if (node.firstElementChild) resize.observe(node.firstElementChild);
      return () => {
        node.removeEventListener('scroll', update);
        resize.disconnect();
      };
    };
  }

  /** One card along — the card's width and the gap after it. */
  function move(direction: 1 | -1) {
    const card = track?.querySelector('li');
    if (!track || !card) return;
    const gap = Number.parseFloat(getComputedStyle(card.parentElement ?? card).columnGap) || 0;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollBy({
      left: direction * (card.getBoundingClientRect().width + gap),
      behavior: still ? 'auto' : 'smooth',
    });
  }
</script>

<div class="story-strip">
  <!-- A scrolling region must take focus, or a keyboard cannot scroll it. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="story-strip__track"
    id={trackId}
    role="region"
    aria-label={label ?? STORY_COPY.strip}
    tabindex="0"
    {@attach measure(steps.length)}
  >
    <ol class="story-strip__cards" data-pictured={pictured ? '' : undefined}>
      {#each steps as step, index (index)}
        <li class="story-strip__card">
          {#if pictured}
            <Media image={images[index]} alt={step.image?.alt ?? ''} ratio="4 / 5" />
          {/if}
          <StoryWords {step} {level} />
        </li>
      {/each}
    </ol>
  </div>
  <div class="story-strip__nav" data-idle={atStart && atEnd ? '' : undefined}>
    <button
      type="button"
      class="story-strip__move"
      aria-label={STORY_COPY.previous}
      aria-controls={trackId}
      disabled={atStart}
      onclick={() => move(-1)}
    >
      <ChevronLeftIcon size="1.25em" />
    </button>
    <button
      type="button"
      class="story-strip__move"
      aria-label={STORY_COPY.next}
      aria-controls={trackId}
      disabled={atEnd}
      onclick={() => move(1)}
    >
      <ChevronRightIcon size="1.25em" />
    </button>
  </div>
</div>

<style>
  .story-strip {
    /* The distance from the section's edge to the content column's. */
    --_inset: max(var(--lp-gutter), (100cqi - var(--lp-container)) / 2);
    display: grid;
    gap: var(--space-5);
  }

  .story-strip__track {
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x mandatory;
    scroll-padding-inline: var(--_inset);
    scrollbar-color: var(--lp-button-line) transparent;
    scrollbar-width: thin;
  }

  /* The focus ring sits inside the scroller, which clips anything outside it. */
  .story-strip__track:focus-visible {
    outline-offset: calc(-1 * var(--border-width-thick));
  }

  .story-strip__cards {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: clamp(15rem, 26cqi, 21rem);
    gap: var(--lp-gap);
    inline-size: max-content;
    margin: 0;
    padding: var(--space-1) var(--_inset) var(--space-5);
    list-style: none;
  }

  /* base.css spaces every `li` but the last. */
  .story-strip__card {
    display: grid;
    align-content: start;
    gap: var(--space-4);
    margin: 0;
    scroll-snap-align: start;
  }

  /* Words only: each card opens under a rule, so the row still reads as cards. */
  .story-strip__cards:not([data-pictured]) .story-strip__card {
    padding-block-start: var(--space-4);
    border-block-start: var(--lp-rule) var(--border-style) var(--lp-line);
  }

  .story-strip__nav {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding-inline: var(--_inset);
  }

  /* Nothing to scroll: the buttons step aside but keep their room. */
  .story-strip__nav[data-idle] {
    visibility: hidden;
  }

  .story-strip__move {
    display: grid;
    place-items: center;
    inline-size: var(--tap-target-min);
    block-size: var(--tap-target-min);
    border-radius: var(--radius-full);
    box-shadow: inset 0 0 0 var(--lp-border) var(--lp-button-line);
    color: var(--lp-ink);
  }

  .story-strip__move:disabled {
    cursor: default;
  }

  @media (hover: hover) {
    .story-strip__move:not(:disabled):hover {
      background: var(--lp-button-bg);
      box-shadow: none;
      color: var(--lp-button-ink);
    }
  }

  @media (scripting: none) {
    .story-strip__nav {
      display: none;
    }
  }
</style>

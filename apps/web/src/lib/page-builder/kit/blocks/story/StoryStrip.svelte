<!--
  @component StoryStrip

  The `strip` layout: the moments as cards in one row that scrolls sideways —
  the kit's own strip (`ScrollStrip`), so it behaves exactly as the gallery's
  does: the browser's own scrolling, snapping card by card, running to the
  section's edges; a labelled region a keyboard can focus and scroll; and
  previous and next buttons that move one card and rest, still focusable, at
  the ends. The strip's parts keep this block's own class names
  (`story-strip__track`, `__cards`, `__nav`, `__move`), which Styles use.

  When no moment has a picture the cards are words only; when some do, an
  unpictured card keeps the row's rhythm with the kit's designed plate.
-->
<script lang="ts">
  import Media from '../../primitives/Media.svelte';
  import ScrollStrip from '../../primitives/ScrollStrip.svelte';
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

  const PARTS = {
    track: 'story-strip__track',
    items: 'story-strip__cards',
    nav: 'story-strip__nav',
    move: 'story-strip__move',
  };
</script>

<div class="story-strip" data-pictured={pictured ? '' : undefined}>
  <ScrollStrip
    id={`${anchor}-moments`}
    label={label ?? STORY_COPY.strip}
    previousLabel={STORY_COPY.previous}
    nextLabel={STORY_COPY.next}
    count={steps.length}
    ordered
    parts={PARTS}
  >
    {#each steps as step, index (index)}
      <li class="story-strip__card">
        {#if pictured}
          <Media image={images[index]} alt={step.image?.alt ?? ''} ratio="4 / 5" />
        {/if}
        <StoryWords {step} {level} />
      </li>
    {/each}
  </ScrollStrip>
</div>

<style>
  /* The strip aligns its items to the top; a card stretches to the row's
     height instead, so a Style that frames the cards draws an even row. */
  .story-strip__card {
    display: grid;
    align-content: start;
    align-self: stretch;
    gap: var(--space-4);
  }

  /* Words only: each card opens under a rule, so the row still reads as cards. */
  .story-strip:not([data-pictured]) .story-strip__card {
    padding-block-start: var(--space-4);
    border-block-start: var(--lp-rule) var(--border-style) var(--lp-line);
  }
</style>

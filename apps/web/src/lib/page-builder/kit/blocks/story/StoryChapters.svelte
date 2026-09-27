<!--
  @component StoryChapters

  The `chapters` layout: each moment a full-width scene. A picture fills the
  scene behind a UNIFORM scrim — the kit's on-media recipe, so every line is
  legible wherever it falls and however tall the scene grows. A moment
  without a picture is a title card in the same scrim colour, lit by the
  brand glow, so a story mixing both still reads as one set of scenes.

  The scenes run to the section's lower edge (and its upper one when there is
  no heading above them): a band of page colour under a full-width scene would
  read as a gap.
-->
<script lang="ts">
  import Media from '../../primitives/Media.svelte';
  import type { StoryStep } from './definition';
  import StoryWords from './StoryWords.svelte';

  interface Props {
    steps: readonly StoryStep[];
    images: readonly (string | null)[];
    level: 1 | 2 | 3;
  }

  const { steps, images, level }: Props = $props();
</script>

<ol class="story-chapters">
  {#each steps as step, index (index)}
    <li class="story-chapter" data-lp-on-media data-pictured={images[index] ? '' : undefined}>
      {#if images[index]}
        <div class="story-chapter__media" data-lp-parallax="1">
          <Media image={images[index]} alt={step.image?.alt ?? ''} />
        </div>
      {:else}
        <span class="lp-atmos story-chapter__glow" aria-hidden="true"></span>
      {/if}
      <span class="story-chapter__num" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <StoryWords {step} {level} size="heading" />
    </li>
  {/each}
</ol>

<style>
  .story-chapters {
    display: grid;
    grid-template-columns: subgrid;
    gap: var(--space-1);
    margin: 0 0 calc(-1 * var(--lp-pad));
    padding: 0;
    list-style: none;
  }

  /* base.css spaces every `li` but the last. */
  .story-chapter {
    position: relative;
    isolation: isolate;
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: auto 1fr auto;
    min-block-size: clamp(24rem, 64svh, 42rem);
    margin: 0;
    padding-block: clamp(var(--space-10), var(--space-6) + 5cqi, var(--space-20));
    overflow: clip;
    background: var(--lp-bg);
    color: var(--lp-ink);
  }

  /* The words keep to the content column. The picture and the glow are left
     unplaced: a placed absolute child would take its cell, not the scene, as
     the box it fills. */
  .story-chapter > :global(:not(.story-chapter__media, .story-chapter__glow)) {
    grid-column: content;
  }

  /* Taller than the scene, so a drift (`data-lp-parallax`) never shows an
     edge; the scrim over it is one strength everywhere. */
  .story-chapter__media {
    position: absolute;
    inset: calc(-1 * var(--space-10)) 0;
    z-index: -2;
    display: grid;
  }

  .story-chapter__media :global(.lp-media) {
    border-radius: 0;
  }

  .story-chapter[data-pictured]::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    background: var(--lp-media-scrim);
    pointer-events: none;
  }

  /* The title card's light, moved off the words from scene to scene. */
  .story-chapter__glow {
    --lp-atmos-strength: 0.5;
    --lp-atmos-a: 82% 22%;
    --lp-atmos-b: 18% 110%;
  }

  .story-chapter:nth-child(even) .story-chapter__glow {
    --lp-atmos-a: 16% 18%;
    --lp-atmos-b: 88% 104%;
  }

  .story-chapter__num {
    grid-row: 1;
    color: color-mix(in oklab, var(--lp-ink) 34%, transparent);
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-heading);
    font-weight: var(--lp-weight-display);
    font-synthesis: none;
    font-variant-numeric: lining-nums tabular-nums;
    line-height: 1;
    letter-spacing: var(--lp-tracking-display);
  }

  .story-chapter > :global(.story-words) {
    grid-row: 3;
  }

  .story-chapter :global(.story-words .lp-heading) {
    max-inline-size: 18ch;
  }

  /* No heading above: the first scene starts at the section's top edge. */
  :global(.story:not(:has(> .story__head))) > .story-chapters {
    margin-block-start: calc(-1 * var(--lp-pad));
  }
</style>

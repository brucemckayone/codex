<!--
  @component StoryWords

  One moment's words — its heading and its paragraphs — as every story layout
  sets them. Only the SIZE differs: a card's title, a chapter's heading.
-->
<script lang="ts">
  import { paragraphs } from '../../model/read';
  import Heading from '../../primitives/Heading.svelte';
  import type { StoryStep } from './definition';

  interface Props {
    step: StoryStep;
    level: 1 | 2 | 3;
    size?: 'title' | 'heading';
  }

  const { step, level, size = 'title' }: Props = $props();
</script>

<div class="story-words" data-size={size}>
  <Heading {level} {size} text={step.heading} type="story" />
  {#each paragraphs(step.body) as part, index (index)}
    <p class="story-words__body">{part}</p>
  {/each}
</div>

<style>
  .story-words {
    display: grid;
    align-content: start;
    gap: var(--space-3);
    max-inline-size: var(--lp-measure);
  }

  .story-words[data-size='heading'] {
    gap: var(--lp-stack);
  }

  /* global.css caps every `p` at 65ch; the measure is the block's. */
  .story-words__body {
    max-inline-size: none;
    margin: 0;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
    text-wrap: pretty;
  }

  .story-words[data-size='heading'] .story-words__body {
    font-size: var(--lp-size-lead);
    line-height: var(--lp-leading-lead);
    max-inline-size: var(--lp-measure-lead);
  }
</style>

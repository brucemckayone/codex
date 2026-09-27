<!--
  @component StoryBlock

  The journey told in moments (03-expressive-contract §3, §7). Every layout
  currently renders the INLINE sequence — each moment's picture beside its
  words — which is also the contract's no-JS / narrow / reduced-motion form of
  `scroll` (the sticky, changing picture) and the base `chapters` and `strip`
  build on. E3 designs the three layouts on top of it.

  The moments are a real sequence, so they are an ordered list.
-->
<script lang="ts">
  import { resolvePageImageUrl } from '../../../page-images';
  import { paragraphs } from '../../model/read';
  import type { BlockProps } from '../../model/types';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Media from '../../primitives/Media.svelte';
  import Text from '../../primitives/Text.svelte';
  import { STORY_EMPTY, storyDefinition } from './definition';

  const { props, section, context, edit }: BlockProps = $props();

  const content = $derived(storyDefinition.coerce(props));
  const steps = $derived(content.steps ?? []);
  const images = $derived(
    steps.map((step) => resolvePageImageUrl(step.image, 'md', context.mediaBaseUrl))
  );
  // A moment's heading sits one level under the section heading, or takes its
  // level when there is none, so the outline never skips a step.
  const stepLevel = $derived(
    content.heading ? (section.headingLevel === 1 ? 2 : 3) : section.headingLevel
  );
</script>

<div class="story" data-layout={section.layout}>
  {#if content.eyebrow || content.heading || content.body}
    <header class="story__head">
      {#if content.eyebrow}<Eyebrow text={content.eyebrow} type="story" {edit} />{/if}
      {#if content.heading}
        <Heading
          level={section.headingLevel}
          text={content.heading}
          type="story"
          field="heading"
          {edit}
        />
      {/if}
      {#if content.body}
        <Text text={content.body} size="lead" type="story" field="body" {edit} />
      {/if}
    </header>
  {/if}

  {#if steps.length > 0}
    <ol class="story__steps">
      {#each steps as step, index (index)}
        <li class="story__step" data-pictured={images[index] ? '' : undefined}>
          {#if images[index]}
            <div class="story__media">
              <Media image={images[index]} alt={step.image?.alt ?? ''} ratio="4 / 3" />
            </div>
          {/if}
          <div class="story__words">
            <Heading level={stepLevel} size="title" text={step.heading} type="story" />
            {#each paragraphs(step.body) as part, p (p)}
              <p class="story__body">{part}</p>
            {/each}
          </div>
        </li>
      {/each}
    </ol>
  {:else if edit}
    <p class="story__empty" data-lp-edit-only>{STORY_EMPTY}</p>
  {/if}
</div>

<style>
  .story {
    display: grid;
    gap: var(--lp-gap);
  }

  .story__head {
    display: grid;
    gap: var(--lp-stack);
    max-inline-size: var(--lp-measure);
  }

  .story__steps {
    display: grid;
    gap: var(--space-12);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* base.css spaces every `li` but the last. */
  .story__step {
    display: grid;
    gap: var(--space-5);
    margin: 0;
  }

  .story__words {
    display: grid;
    align-content: start;
    gap: var(--space-3);
    max-inline-size: var(--lp-measure);
  }

  .story__body {
    margin: 0;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
    text-wrap: pretty;
  }

  /* global.css caps every `p` at 65ch; the prompt spans its region. */
  .story__empty {
    max-inline-size: none;
    margin: 0;
    padding: var(--space-6);
    border: var(--lp-border) var(--border-style-dashed) var(--lp-button-line);
    border-radius: var(--lp-radius-card);
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    text-align: center;
  }

  /* Wide: the picture and its words side by side, the words level with the
     top of the picture. */
  @container (min-width: 48rem) {
    .story__step[data-pictured] {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      align-items: start;
      column-gap: var(--lp-gap);
    }
  }
</style>

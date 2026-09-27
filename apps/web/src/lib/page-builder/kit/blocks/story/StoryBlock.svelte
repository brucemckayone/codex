<!--
  @component StoryBlock

  The journey told in moments (03-expressive-contract §3, §7). The moments are
  a real sequence, so every layout is an ordered list. Three layouts, each its
  own component in this folder:
    scroll   — words beside pictures; wide and in motion, a sticky frame shows
               the picture of the moment being read (StoryScroll)
    chapters — each moment a full-width scene behind a uniform scrim
               (StoryChapters)
    strip    — the moments as cards in a row that scrolls sideways
               (StoryStrip)

  The block spans the section's full width with the page's own columns, so a
  layout may run a row to the edges while its words keep to the content
  column.
-->
<script lang="ts">
  import { resolvePageImageUrl } from '../../../page-images';
  import type { BlockProps } from '../../model/types';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Text from '../../primitives/Text.svelte';
  import { STORY_EMPTY, storyDefinition } from './definition';
  import StoryChapters from './StoryChapters.svelte';
  import StoryScroll from './StoryScroll.svelte';
  import StoryStrip from './StoryStrip.svelte';

  const { props, section, context, edit }: BlockProps = $props();

  const content = $derived(storyDefinition.coerce(props));
  const steps = $derived(content.steps ?? []);
  const layout = $derived(
    section.layout === 'chapters' || section.layout === 'strip' ? section.layout : 'scroll'
  );
  // A full-width scene draws its picture at the large size (03 §10).
  const images = $derived(
    steps.map((step) =>
      resolvePageImageUrl(step.image, layout === 'chapters' ? 'lg' : 'md', context.mediaBaseUrl)
    )
  );
  // A moment's heading sits one level under the section heading, or takes its
  // level when there is none, so the outline never skips a step.
  const level = $derived(content.heading ? (section.headingLevel === 1 ? 2 : 3) : section.headingLevel);
</script>

<div class="story lp-bleed" data-layout={layout}>
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

  {#if steps.length === 0}
    {#if edit}<p class="story__empty" data-lp-edit-only>{STORY_EMPTY}</p>{/if}
  {:else if layout === 'chapters'}
    <StoryChapters {steps} {images} {level} />
  {:else if layout === 'strip'}
    <StoryStrip {steps} {images} {level} label={content.heading} anchor={section.anchor} />
  {:else}
    <StoryScroll {steps} {images} {level} />
  {/if}
</div>

<style>
  .story {
    display: grid;
    grid-template-columns: inherit;
    row-gap: var(--lp-gap);
  }

  .story > :global(*) {
    grid-column: content;
    min-inline-size: 0;
  }

  .story > :global(:is(.story-chapters, .story-strip)) {
    grid-column: bleed;
  }

  .story__head {
    display: grid;
    gap: var(--lp-stack);
    max-inline-size: var(--lp-measure);
  }

  /* The heading measures itself in its own `ch`, not the body face's. */
  .story__head :global(.lp-heading) {
    max-inline-size: 20ch;
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
</style>

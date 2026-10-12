<!--
  @component HeadingBlock

  A chapter title on its own (03 X64): an optional small label and a heading
  that announces the section after it, which it joins (`joinSimpleSections`).
  Two forms: at the column's start, or centred. Each Style aligns it as it
  aligns its own heads (centred in Soft and Cinematic).

  It is drawn at the page's section-heading size, never display size, which
  belongs to the hero, and it is an `<h2>` like every heading below the hero.
  A long heading (over 64 characters) steps down to the title size so it
  stays a head, not a wall.

  EMPTY. A label alone counts as empty: the live page never draws a Heading
  with no title (`foldForVisitors`). On the canvas the empty heading keeps its
  place and shows what to type, in the soft ink.
-->
<script lang="ts">
  import { isLongHeading } from '../../model/long-heading';
  import type { BlockProps } from '../../model/types';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import { HEADING_PROMPT, headingDefinition } from './definition';

  const { props, section, edit }: BlockProps = $props();

  const content = $derived(headingDefinition.coerce(props));
  const long = $derived(isLongHeading(content.heading));
</script>

<header class="heading" data-layout={section.layout}>
  {#if content.eyebrow}<Eyebrow text={content.eyebrow} type="heading" {edit} />{/if}
  {#if content.heading || edit}
    <Heading
      level={section.headingLevel}
      size={long ? 'title' : 'heading'}
      text={content.heading ?? ''}
      type="heading"
      field="heading"
      placeholder={HEADING_PROMPT}
      {edit}
      class="heading__title"
    />
  {/if}
</header>

<style>
  .heading {
    display: grid;
    gap: var(--lp-stack);
    max-inline-size: var(--lp-measure-lead);
  }

  /* A long title reads at the middle size, still a head in the Style's scale. */
  .heading :global(.heading__title[data-size='title']) {
    --lp-title-lift: 0.5;
  }

  .heading[data-layout='center'] {
    justify-self: center;
    justify-items: center;
    text-align: center;
  }

  .heading[data-layout='center'] :global(.lp-eyebrow) {
    justify-self: center;
  }
</style>

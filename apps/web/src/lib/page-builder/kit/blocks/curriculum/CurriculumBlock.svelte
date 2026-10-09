<!--
  @component CurriculumBlock

  The course's stages and what is in each, straight from the curriculum the
  page renders (`context.stages`). Three layouts:
    timeline  — the stages as a sequence: numbered markers on a spine, each
                stage's practices beside it
    accordion — one numbered row per stage, opening to its practices
    cards     — each stage its own tile, side by side
    map       — the stages as stops on a drawn route, each opening to its
                practices (StageMap)

  A practice's kind reads by its icon's shape. A join button appears only when
  the creator writes one. No stages yet: the public page keeps only the words;
  the canvas points to the Curriculum tab.
-->
<script lang="ts">
  import type { BlockProps } from '../../model/types';
  import ButtonRow from '../../primitives/ButtonRow.svelte';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Text from '../../primitives/Text.svelte';
  import { CURRICULUM_EMPTY, curriculumDefinition } from './definition';
  import StageAccordion from './StageAccordion.svelte';
  import StageCards from './StageCards.svelte';
  import StageMap from './StageMap.svelte';
  import StageTimeline from './StageTimeline.svelte';
  import { orderedStages } from './stages';

  const { props, section, context, edit }: BlockProps = $props();

  const content = $derived(curriculumDefinition.coerce(props));
  const stages = $derived(orderedStages(context.stages));
  const layout = $derived(
    section.layout === 'accordion' || section.layout === 'cards' || section.layout === 'map'
      ? section.layout
      : 'timeline'
  );
  const asks = $derived(Boolean(content.ctaLabel || content.note));
  const headed = $derived(Boolean(content.eyebrow || content.heading || content.body));
  // A stage's name sits one level under the section heading, or at the
  // section's own level when there is none — never a second h1.
  const level = $derived<2 | 3>(content.heading && section.headingLevel === 2 ? 3 : 2);
</script>

<div class="curriculum" data-layout={layout}>
  {#if headed}
    <header class="curriculum__head">
      {#if content.eyebrow}<Eyebrow text={content.eyebrow} type="curriculum" {edit} />{/if}
      {#if content.heading}
        <Heading
          level={section.headingLevel}
          text={content.heading}
          type="curriculum"
          field="heading"
          {edit}
        />
      {/if}
      {#if content.body}
        <Text text={content.body} size="lead" type="curriculum" field="body" {edit} />
      {/if}
    </header>
  {/if}

  {#if stages.length === 0}
    {#if edit}<p class="curriculum__empty" data-lp-edit-only>{CURRICULUM_EMPTY}</p>{/if}
  {:else if layout === 'accordion'}
    <StageAccordion {stages} {level} anchor={section.anchor} />
  {:else if layout === 'cards'}
    <StageCards {stages} {level} />
  {:else if layout === 'map'}
    <StageMap {stages} {level} />
  {:else}
    <StageTimeline {stages} {level} />
  {/if}

  {#if asks}
    <ButtonRow
      {context}
      section="curriculum"
      label={content.ctaLabel}
      note={content.note}
      size="md"
      {edit}
    />
  {/if}
</div>

<style>
  .curriculum,
  .curriculum__head {
    display: grid;
    gap: var(--lp-stack);
    align-content: start;
  }

  .curriculum {
    gap: var(--lp-gap);
  }

  /* The heading measures itself in its own `ch`, not the body face's. */
  .curriculum__head :global(.lp-heading) {
    max-inline-size: 20ch;
  }

  /* global.css caps every `p` at 65ch; the prompt spans its region. */
  .curriculum__empty {
    max-inline-size: none;
    margin: 0;
    padding: var(--space-6);
    border: var(--lp-border) var(--border-style-dashed) var(--lp-button-line);
    border-radius: var(--lp-radius-card);
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    text-align: center;
  }

  /* Soft centres a head over a row of cards, as its pricing does. */
  :global(.lp[data-lp-style='soft']) .curriculum[data-layout='cards'] {
    --lp-actions-align: center;
  }

  :global(.lp[data-lp-style='soft']) .curriculum[data-layout='cards'] .curriculum__head {
    justify-items: center;
    text-align: center;
  }

  :global(.lp[data-lp-style='soft'])
    .curriculum[data-layout='cards']
    .curriculum__head
    :global(:is(.lp-eyebrow, .lp-heading, .lp-text)) {
    justify-self: center;
    margin-inline: auto;
  }
</style>

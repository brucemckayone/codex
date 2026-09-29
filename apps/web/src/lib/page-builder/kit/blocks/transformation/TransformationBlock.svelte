<!--
  @component TransformationBlock

  Where the visitor is now, and where they will be. Three layouts, each its
  own component in this folder:
    columns   — before and after side by side, line level with line; the after
                side is the section's one filled panel (ChangeColumns)
    steps     — one change per row, each before joined to its after by a drawn
                connector (ChangeSteps)
    statement — the before lines small and quiet, the after lines large and
                bright, one beneath the other (ChangeStatement)

  Lines pair by position. A line without a partner still shows (layouts
  arrange, they never censor); only its connector is left out.
-->
<script lang="ts">
  import { featuredScheme } from '../../model/resolve';
  import type { BlockProps } from '../../model/types';
  import { getKitPage } from '../../page-context';
  import ButtonRow from '../../primitives/ButtonRow.svelte';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Text from '../../primitives/Text.svelte';
  import ChangeColumns from './ChangeColumns.svelte';
  import ChangeStatement from './ChangeStatement.svelte';
  import ChangeSteps from './ChangeSteps.svelte';
  import { TRANSFORMATION_EMPTY, transformationDefinition } from './definition';

  const { props, section, context, edit }: BlockProps = $props();

  const page = getKitPage();
  const content = $derived(transformationDefinition.coerce(props));
  const layout = $derived(section.layout);
  const lines = $derived({ before: content.before ?? [], after: content.after ?? [] });
  const labels = $derived({ before: content.beforeLabel, after: content.afterLabel });
  const empty = $derived(lines.before.length === 0 && lines.after.length === 0);
  const featured = $derived(featuredScheme(page.style, section.scheme));
  const asks = $derived(Boolean(content.ctaLabel || content.note));
</script>

<div class="tf" data-layout={layout}>
  {#if content.eyebrow || content.heading || content.body}
    <header class="tf__head">
      {#if content.eyebrow}<Eyebrow text={content.eyebrow} type="transformation" {edit} />{/if}
      {#if content.heading}
        <Heading
          level={section.headingLevel}
          text={content.heading}
          type="transformation"
          field="heading"
          {edit}
        />
      {/if}
      {#if content.body}
        <Text text={content.body} size="lead" type="transformation" field="body" {edit} />
      {/if}
    </header>
  {/if}

  {#if empty}
    {#if edit}<p class="tf__empty" data-lp-edit-only>{TRANSFORMATION_EMPTY}</p>{/if}
  {:else if layout === 'steps'}
    <ChangeSteps {lines} {labels} anchor={section.anchor} {edit} />
  {:else if layout === 'statement'}
    <ChangeStatement {lines} {labels} anchor={section.anchor} {edit} />
  {:else}
    <ChangeColumns {lines} {labels} anchor={section.anchor} {featured} {edit} />
  {/if}

  {#if asks}
    <ButtonRow
      {context}
      section="transformation"
      label={content.ctaLabel}
      note={content.note}
      size="md"
      {edit}
    />
  {/if}
</div>

<style>
  .tf {
    display: grid;
    gap: var(--lp-gap);
  }

  .tf__head {
    display: grid;
    gap: var(--lp-stack);
  }

  /* The heading measures itself in its own `ch`, not the body face's. */
  .tf__head :global(.lp-heading) {
    max-inline-size: 20ch;
  }

  /* global.css caps every `p` at 65ch; the prompt spans its region. */
  .tf__empty {
    max-inline-size: none;
    margin: 0;
    padding: var(--space-6);
    border: var(--lp-border) var(--border-style-dashed) var(--lp-button-line);
    border-radius: var(--lp-radius-card);
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    text-align: center;
  }

  /* Soft centres the head over its pair of cards, as its pricing does; the
     cards themselves keep reading from the start. */
  :global(.lp[data-lp-style='soft']) .tf[data-layout='columns'] {
    --lp-actions-align: center;
  }

  :global(.lp[data-lp-style='soft']) .tf[data-layout='columns'] .tf__head {
    justify-items: center;
    text-align: center;
  }

  /* Soft and Cinematic tell the statement centred, like a title card. */
  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic']))
    .tf[data-layout='statement'] {
    --lp-actions-align: center;
    text-align: center;
  }

  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic']))
    .tf[data-layout='statement']
    .tf__head {
    justify-items: center;
  }

  :global(.lp[data-lp-style='soft']) .tf[data-layout='columns'] :global(.lp-eyebrow),
  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic']))
    .tf[data-layout='statement']
    :global(.lp-eyebrow) {
    justify-self: center;
  }
</style>

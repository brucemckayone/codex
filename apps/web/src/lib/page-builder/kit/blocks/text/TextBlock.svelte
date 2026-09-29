<!--
  @component TextBlock

  The creator's own words, free-form, so every layout is designed for both
  extremes: one short line and several long paragraphs.
    statement — the first paragraph in large type under a quiet title; later
                paragraphs answer it from the side
    columns   — the heading on one side, staying in view while long text
                scrolls on the other
    centered  — a calm centred passage; long text keeps the centred column but
                reads from the start of each line

  A join button appears only when the creator gives it words (`ctaLabel` or
  `note`). The creator's image (contract A5) joins the heading's column in
  `columns`, and leads the passage in the other two.
-->
<script lang="ts">
  import { resolvePageImageUrl } from '../../../page-images';
  import { paragraphs } from '../../model/read';
  import type { BlockProps } from '../../model/types';
  import ButtonRow from '../../primitives/ButtonRow.svelte';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Media from '../../primitives/Media.svelte';
  import Text from '../../primitives/Text.svelte';
  import { TEXT_EMPTY, textDefinition } from './definition';

  const { props, section, context, edit }: BlockProps = $props();

  const content = $derived(textDefinition.coerce(props));
  const layout = $derived(section.layout);
  const parts = $derived(paragraphs(content.body));
  const asks = $derived(Boolean(content.ctaLabel || content.note));
  // Long text reads at body size and from the start of each line; short text
  // can afford to be large and centred.
  const long = $derived(parts.length > 2 || (content.body?.length ?? 0) > 520);
  // A first paragraph past a few lines steps down so it stays a statement.
  const longLead = $derived((parts[0]?.length ?? 0) > 240);
  // Under a large first paragraph the heading is a quiet title; alone, it is
  // the statement itself.
  const headingSize = $derived(layout === 'statement' && content.body ? 'title' : 'heading');
  const image = $derived(resolvePageImageUrl(content.image, 'lg', context.mediaBaseUrl));
  const beside = $derived(layout === 'columns');
</script>

{#snippet figure(src: string)}
  <div class="text__media">
    <Media image={src} alt={content.image?.alt ?? ''} ratio="var(--_ratio)" />
  </div>
{/snippet}

<div
  class="text"
  data-layout={layout}
  data-long={long ? '' : undefined}
  data-long-lead={longLead ? '' : undefined}
>
  {#if image && !beside}{@render figure(image)}{/if}
  {#if content.eyebrow || content.heading || (image && beside)}
    <header class="text__head">
      {#if content.eyebrow}<Eyebrow text={content.eyebrow} type="text" {edit} />{/if}
      {#if content.heading}
        <Heading
          level={section.headingLevel}
          size={headingSize}
          text={content.heading}
          type="text"
          field="heading"
          {edit}
        />
      {/if}
      {#if image && beside}{@render figure(image)}{/if}
    </header>
  {/if}

  {#if content.body}
    <Text
      text={content.body}
      size={long ? 'body' : 'lead'}
      tone="ink"
      type="text"
      field="body"
      {edit}
      class="text__body"
    />
  {:else if edit}
    <p class="text__empty" data-lp-edit-only>{TEXT_EMPTY}</p>
  {/if}

  {#if asks}
    <ButtonRow
      {context}
      section="text"
      label={content.ctaLabel}
      note={content.note}
      size="md"
      align={layout === 'centered' ? 'center' : 'start'}
      {edit}
    />
  {/if}
</div>

<style>
  .text {
    display: grid;
    gap: var(--lp-gap);
  }

  .text__head {
    display: grid;
    gap: var(--lp-stack);
    align-content: start;
  }

  /* The heading measures itself in its own `ch`, not the body face's. */
  .text__head :global(.lp-heading[data-size='heading']) {
    max-inline-size: 20ch;
  }

  /* Calm and low above a passage; a little taller beside one. */
  .text__media {
    --_ratio: 3 / 2;
    inline-size: 100%;
  }

  .text[data-layout='centered'] > .text__media {
    max-inline-size: 52rem;
  }

  @container (min-width: 48rem) {
    .text[data-layout='statement'] > .text__media {
      --_ratio: 21 / 9;
    }

    .text[data-layout='centered'] > .text__media,
    .text[data-layout='columns'] .text__media {
      --_ratio: 16 / 9;
    }
  }

  /* global.css caps every `p` at 65ch; the prompt spans its region. */
  .text__empty {
    max-inline-size: none;
    margin: 0;
    padding: var(--space-6);
    border: var(--lp-border) var(--border-style-dashed) var(--lp-button-line);
    border-radius: var(--lp-radius-card);
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    text-align: center;
  }

  /* ── statement ─────────────────────────────────────────────────────────── */
  .text[data-layout='statement'] {
    gap: var(--lp-stack);
  }

  /* The words stay tight to each other; the image stands a band-gap off them. */
  .text[data-layout='statement'] > .text__media {
    margin-block-end: calc(var(--lp-gap) - var(--lp-stack));
  }

  .text[data-layout='statement'] > :global(.lp-text.text__body) {
    max-inline-size: none;
    margin-block-end: var(--space-2);
  }

  .text[data-layout='statement'] :global(.text__body > p:first-child) {
    max-inline-size: 34ch;
    color: var(--lp-ink);
    font-size: calc(var(--lp-size-title) * 1.3);
    line-height: var(--leading-snug);
    text-wrap: balance;
  }

  .text[data-layout='statement'][data-long-lead] :global(.text__body > p:first-child) {
    max-inline-size: 40ch;
    font-size: var(--lp-size-lead);
    line-height: var(--lp-leading-lead);
    text-wrap: pretty;
  }

  .text[data-layout='statement'] :global(.text__body > p:not(:first-child)) {
    max-inline-size: var(--lp-measure-lead);
    color: var(--lp-ink-soft);
  }

  /* Wide: the first paragraph spans; the rest (and the button under them)
     answer it from the right, on the same column lines. */
  @container (min-width: 56rem) {
    .text[data-layout='statement'] {
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
      column-gap: var(--lp-gap);
    }

    /* Global on the child: the body and button are other components' roots,
       which a scoped `*` would never match. */
    .text[data-layout='statement'] > :global(*) {
      grid-column: 1 / -1;
    }

    .text[data-layout='statement'] > :global(.lp-text.text__body) {
      grid-template-columns: subgrid;
      column-gap: normal;
    }

    .text[data-layout='statement'] :global(.text__body > p:first-child) {
      grid-column: 1 / -1;
    }

    .text[data-layout='statement'] :global(.text__body > p:not(:first-child)) {
      grid-column: 2;
    }

    .text[data-layout='statement']:has(:global(.text__body > p + p)) > :global(.lp-actions) {
      grid-column: 2;
    }
  }

  /* ── columns ───────────────────────────────────────────────────────────── */
  /* Equal halves: the text keeps its own measure inside its half, and the
     heading is not squeezed into a tower beside a short passage. */
  @container (min-width: 56rem) {
    .text[data-layout='columns'] {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      align-items: start;
      column-gap: calc(var(--lp-gap) * 1.5);
    }

    .text[data-layout='columns'] > :global(:not(.text__head)) {
      grid-column: 2;
    }

    .text[data-layout='columns'] > .text__head {
      position: sticky;
      top: var(--space-12);
    }

    .text[data-layout='columns'] .text__media {
      --_ratio: 4 / 3;
    }

    /* A heading with nothing beside it takes the width instead — and its
       image turns wide and low rather than towering over the band. */
    .text[data-layout='columns']:not(:has(> :global(.text__body))) > .text__head {
      grid-column: 1 / -1;
    }

    .text[data-layout='columns']:not(:has(> :global(.text__body))) .text__media {
      --_ratio: 21 / 9;
    }
  }

  /* ── centered ──────────────────────────────────────────────────────────── */
  .text[data-layout='centered'] {
    justify-items: center;
    text-align: center;
  }

  .text[data-layout='centered'] .text__head {
    justify-items: center;
  }

  .text[data-layout='centered'] :global(.lp-eyebrow) {
    justify-self: center;
  }

  /* Several paragraphs keep the centred column but read from the start of
     each line: centred prose past a few lines is hard to follow. */
  .text[data-layout='centered'][data-long] > :global(.lp-text.text__body) {
    max-inline-size: var(--lp-measure-lead);
    text-align: start;
  }
</style>

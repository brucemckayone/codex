<!--
  @component ProblemBlock

  Names what the visitor is struggling with. Three layouts:
    statement — one oversized sentence; the quiet body answers it from the
                side, and the signs sit under it in a ruled row
    list      — the signs ARE the section: large ruled lines, one per sign
    split     — the words on one side, the signs listed on the other

  A join button appears only when the creator gives it words (`ctaLabel` or
  `note`): this is a story section, and the page's standing asks live in the
  hero, pricing and call-to-action sections.
-->
<script lang="ts">
  import { isLongHeading } from '../../model/long-heading';
  import type { BlockProps } from '../../model/types';
  import ButtonRow from '../../primitives/ButtonRow.svelte';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Text from '../../primitives/Text.svelte';
  import { PROBLEM_EMPTY, problemDefinition } from './definition';

  const { props, section, context, edit }: BlockProps = $props();

  const content = $derived(problemDefinition.coerce(props));
  const layout = $derived(section.layout);
  const points = $derived(content.points ?? []);
  const asks = $derived(Boolean(content.ctaLabel || content.note));
  // A long sentence steps down a size so it stays a statement, not a wall.
  const long = $derived(isLongHeading(content.heading));
</script>

{#snippet eyebrow()}
  {#if content.eyebrow}<Eyebrow text={content.eyebrow} type="problem" {edit} />{/if}
{/snippet}

{#snippet heading(size: 'display' | 'heading')}
  {#if content.heading}
    <Heading
      level={section.headingLevel}
      {size}
      text={content.heading}
      type="problem"
      field="heading"
      {edit}
    />
  {/if}
{/snippet}

{#snippet body()}
  {#if content.body}
    <Text text={content.body} size="lead" type="problem" field="body" {edit} />
  {/if}
{/snippet}

{#snippet ask()}
  {#if asks}
    <ButtonRow
      {context}
      section="problem"
      label={content.ctaLabel}
      note={content.note}
      size="md"
      {edit}
    />
  {/if}
{/snippet}

{#snippet empty()}
  {#if edit}<p class="problem__empty" data-lp-edit-only>{PROBLEM_EMPTY}</p>{/if}
{/snippet}

<div class="problem" data-layout={layout}>
  {#if layout === 'list'}
    <header class="problem__head">
      {@render eyebrow()}
      {@render heading('heading')}
      {@render body()}
    </header>
    {#if points.length > 0}
      <ul class="problem__lines">
        {#each points as point, index (index)}
          <li><span class="problem__bar" aria-hidden="true"></span><span>{point}</span></li>
        {/each}
      </ul>
    {:else}
      {@render empty()}
    {/if}
    {@render ask()}
  {:else if layout === 'split'}
    <div class="problem__words">
      {@render eyebrow()}
      {@render heading('heading')}
      {@render body()}
      {@render ask()}
    </div>
    {#if points.length > 0}
      <ul class="problem__signs">
        {#each points as point, index (index)}
          <li><span class="problem__bar" aria-hidden="true"></span><span>{point}</span></li>
        {/each}
      </ul>
    {:else}
      {@render empty()}
    {/if}
  {:else}
    <div class="problem__statement" data-long={long ? '' : undefined}>
      {@render eyebrow()}
      {@render heading('display')}
    </div>
    {#if content.body || asks}
      <div class="problem__aside">
        {@render body()}
        {@render ask()}
      </div>
    {/if}
    {#if points.length > 0}
      <ul class="problem__strip" data-count={points.length}>
        {#each points as point, index (index)}<li>{point}</li>{/each}
      </ul>
    {:else}
      {@render empty()}
    {/if}
  {/if}
</div>

<style>
  .problem {
    display: grid;
    gap: var(--lp-gap);
  }

  .problem__head,
  .problem__words,
  .problem__statement,
  .problem__aside {
    display: grid;
    gap: var(--lp-stack);
    align-content: start;
  }

  .problem ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* base.css spaces every `li` but the last, which unevens a grid row. */
  .problem li {
    margin: 0;
  }

  /* global.css caps every `p` at 65ch; the prompt spans its region. */
  .problem__empty {
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
  .problem__statement {
    --lp-display-scale: 0.78;
  }

  .problem__statement :global(.lp-heading) {
    max-inline-size: 17ch;
  }

  .problem__statement[data-long] {
    --lp-display-scale: 0.6;
  }

  .problem__statement[data-long] :global(.lp-heading) {
    max-inline-size: 24ch;
  }

  .problem__strip {
    display: grid;
    gap: var(--space-6) var(--lp-gap);
    margin-block-start: var(--space-4);
  }

  .problem__strip li {
    padding-block-start: var(--space-4);
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
    color: var(--lp-ink);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
    text-wrap: pretty;
  }

  @container (min-width: 40rem) {
    .problem__strip:not([data-count='1']) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  /* Wide: the sentence spans; the body answers it from the right, above the
     signs laid out in one row (a fourth sign keeps the row; more wrap in 3s). */
  @container (min-width: 56rem) {
    .problem[data-layout='statement'] {
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
      column-gap: var(--lp-gap);
    }

    .problem[data-layout='statement'] > :not(.problem__aside) {
      grid-column: 1 / -1;
    }

    .problem__aside {
      grid-column: 2;
    }

    .problem__strip:is([data-count='3'], [data-count='5'], [data-count='6']) {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .problem__strip[data-count='4'] {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  /* ── list ──────────────────────────────────────────────────────────────── */
  /* The heading measures itself in its own `ch`, not the body face's. */
  .problem__head :global(.lp-heading) {
    max-inline-size: 22ch;
  }

  .problem__lines {
    display: grid;
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
  }

  .problem__lines li {
    display: grid;
    grid-template-columns: var(--space-8) minmax(0, 1fr);
    padding-block: var(--space-5);
    border-block-end: var(--lp-border) var(--border-style) var(--lp-line);
    color: var(--lp-ink);
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-title);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
    line-height: var(--lp-leading-title);
    letter-spacing: var(--lp-tracking-title);
  }

  /* Given the width, a step above a title — still well under the heading, so
     the signs carry the section without competing with it. */
  @container (min-width: 40rem) {
    .problem__lines li {
      grid-template-columns: var(--space-10) minmax(0, 1fr);
      font-size: calc(var(--lp-size-title) * 1.2);
    }
  }

  .problem__lines span:last-child {
    text-wrap: balance;
  }

  /* ── split ─────────────────────────────────────────────────────────────── */
  .problem__signs {
    display: grid;
  }

  .problem__signs {
    display: grid;
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
  }

  .problem__signs li {
    display: grid;
    grid-template-columns: var(--space-8) minmax(0, 1fr);
    padding-block: var(--space-5);
    border-block-end: var(--lp-border) var(--border-style) var(--lp-line);
    color: var(--lp-ink);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
    text-wrap: pretty;
  }

  /* Centred on the FIRST line, however the sign wraps. Never a hairline: a
     one-pixel mark anti-aliases to grey on some rows and colour on others. */
  .problem__bar {
    margin-block-start: calc(0.5lh - var(--border-width-thick) / 2);
    inline-size: var(--space-4);
    block-size: var(--border-width-thick);
    background: var(--lp-accent);
  }

  @container (min-width: 56rem) {
    .problem[data-layout='split'] {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      align-items: center;
      column-gap: calc(var(--lp-gap) * 1.5);
    }
  }

  /* ── Bold: hard ink rules over open columns ────────────────────────────── */
  :global(.lp[data-lp-style='bold']) .problem__strip li,
  :global(.lp[data-lp-style='bold']) :is(.problem__lines, .problem__signs) {
    border-block-start: var(--lp-rule) var(--border-style) var(--lp-ink);
  }

  /* ── Soft: rounded outlines instead of rules, and a round mark ─────────── */
  :global(.lp[data-lp-style='soft']) :is(.problem__lines, .problem__signs) {
    padding-inline: var(--space-6);
    border: var(--lp-border) var(--border-style) var(--lp-line);
    border-radius: var(--lp-radius-card);
  }

  :global(.lp[data-lp-style='soft']) :is(.problem__lines, .problem__signs) li:last-child {
    border-block-end: none;
  }

  :global(.lp[data-lp-style='soft']) .problem__strip li {
    padding: var(--space-5) var(--space-6);
    border: var(--lp-border) var(--border-style) var(--lp-line);
    border-radius: var(--lp-radius-card);
  }

  :global(.lp[data-lp-style='soft']) .problem__bar {
    margin-block-start: calc(0.5lh - var(--space-2) / 2);
    inline-size: var(--space-2);
    block-size: var(--space-2);
    border-radius: var(--radius-full);
  }
</style>

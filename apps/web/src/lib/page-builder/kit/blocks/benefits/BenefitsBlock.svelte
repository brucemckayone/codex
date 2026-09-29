<!--
  @component BenefitsBlock

  Everything a member gets. Three layouts:
    grid      — each item a transparent tile under a rule: its name, then a line
    checklist — compact rows in two columns, a tick beside each
    split     — the words on one side (they stay in view while a long list
                scrolls), the items as large ruled rows on the other

  A join button appears only when the creator gives it words (`ctaLabel` or
  `note`). A grid tile may carry the creator's image (contract A5); once one
  does, every tile holds the same frame, so a mixed row still reads as a set.
-->
<script lang="ts">
  import { CheckIcon } from '$lib/components/ui/Icon';
  import { resolvePageImageUrl } from '../../../page-images';
  import type { BlockProps } from '../../model/types';
  import ButtonRow from '../../primitives/ButtonRow.svelte';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Media from '../../primitives/Media.svelte';
  import Text from '../../primitives/Text.svelte';
  import { BENEFITS_EMPTY, benefitsDefinition } from './definition';

  const { props, section, context, edit }: BlockProps = $props();

  const content = $derived(benefitsDefinition.coerce(props));
  const layout = $derived(section.layout);
  const items = $derived(content.items ?? []);
  const asks = $derived(Boolean(content.ctaLabel || content.note));
  const headed = $derived(Boolean(content.eyebrow || content.heading || content.body));
  // A tile's name sits one level under the section heading, or takes its
  // level when there is none, so the outline never skips a step.
  const itemLevel = $derived(
    content.heading ? (section.headingLevel === 1 ? 2 : 3) : section.headingLevel
  );
  const tileImages = $derived(
    layout === 'grid'
      ? items.map((item) => resolvePageImageUrl(item.image, 'md', context.mediaBaseUrl))
      : []
  );
  const pictured = $derived(tileImages.some(Boolean));
</script>

{#snippet words()}
  {#if content.eyebrow}<Eyebrow text={content.eyebrow} type="benefits" {edit} />{/if}
  {#if content.heading}
    <Heading
      level={section.headingLevel}
      text={content.heading}
      type="benefits"
      field="heading"
      {edit}
    />
  {/if}
  {#if content.body}
    <Text text={content.body} size="lead" type="benefits" field="body" {edit} />
  {/if}
{/snippet}

{#snippet ask()}
  {#if asks}
    <ButtonRow
      {context}
      section="benefits"
      label={content.ctaLabel}
      note={content.note}
      size="md"
      {edit}
    />
  {/if}
{/snippet}

{#snippet empty()}
  {#if edit}<p class="benefits__empty" data-lp-edit-only>{BENEFITS_EMPTY}</p>{/if}
{/snippet}

<div class="benefits" data-layout={layout} data-long={items.length > 4 ? '' : undefined}>
  {#if layout === 'split'}
    <div class="benefits__words">
      {@render words()}
      {@render ask()}
    </div>
    {#if items.length > 0}
      <ul class="benefits-rows">
        {#each items as item, index (index)}
          <li>
            <p class="benefits-rows__name">{item.title}</p>
            {#if item.detail}<p class="benefits__detail">{item.detail}</p>{/if}
          </li>
        {/each}
      </ul>
    {:else}
      {@render empty()}
    {/if}
  {:else}
    {#if headed}<header class="benefits__head">{@render words()}</header>{/if}
    {#if items.length === 0}
      {@render empty()}
    {:else if layout === 'checklist'}
      <ul class="benefits-checks">
        {#each items as item, index (index)}
          <li>
            <span class="benefits-checks__mark" aria-hidden="true"><CheckIcon size="1em" /></span>
            <div>
              <p class="benefits-checks__name">{item.title}</p>
              {#if item.detail}<p class="benefits__detail">{item.detail}</p>{/if}
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <ul class="benefits-grid" data-count={items.length} data-pictured={pictured ? '' : undefined}>
        {#each items as item, index (index)}
          <li>
            {#if pictured}
              <Media image={tileImages[index]} alt={item.image?.alt ?? ''} ratio="3 / 2" />
            {/if}
            <Heading level={itemLevel} size="title" text={item.title} type="benefits" />
            {#if item.detail}<p class="benefits__detail">{item.detail}</p>{/if}
          </li>
        {/each}
      </ul>
    {/if}
    {@render ask()}
  {/if}
</div>

<style>
  .benefits {
    display: grid;
    gap: var(--lp-gap);
  }

  .benefits__head,
  .benefits__words {
    display: grid;
    gap: var(--lp-stack);
    align-content: start;
  }

  /* The heading measures itself in its own `ch`, not the body face's. */
  .benefits :global(.lp-heading[data-size='heading']) {
    max-inline-size: 20ch;
  }

  .benefits ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* base.css spaces every `li` but the last, which unevens a grid row. */
  .benefits li {
    margin: 0;
  }

  .benefits p {
    margin: 0;
  }

  .benefits__detail {
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
    text-wrap: pretty;
  }

  /* global.css caps every `p` at 65ch; the prompt spans its region. */
  .benefits__empty {
    max-inline-size: none;
    padding: var(--space-6);
    border: var(--lp-border) var(--border-style-dashed) var(--lp-button-line);
    border-radius: var(--lp-radius-card);
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    text-align: center;
  }

  /* ── grid ──────────────────────────────────────────────────────────────── */
  .benefits-grid {
    display: grid;
    gap: var(--space-10) var(--lp-gap);
  }

  .benefits-grid li {
    display: grid;
    align-content: start;
    gap: var(--space-3);
    padding-block-start: var(--space-5);
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
  }

  .benefits-grid[data-count='1'] {
    max-inline-size: var(--lp-measure);
  }

  /* The picture leads the tile; its name keeps the tile's own rhythm under it. */
  .benefits-grid[data-pictured] :global(.lp-media) {
    margin-block-end: var(--space-2);
  }

  @container (min-width: 36rem) {
    .benefits-grid:not([data-count='1']) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  /* Wide: as many to a row as divides the set evenly (4 across for four,
     seven and eight; 3 across for the rest), so no row is left with one. */
  @container (min-width: 60rem) {
    .benefits-grid:is([data-count='3'], [data-count='5'], [data-count='6'], [data-count='9']) {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .benefits-grid:is([data-count='4'], [data-count='7'], [data-count='8']) {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  /* ── checklist ─────────────────────────────────────────────────────────── */
  .benefits-checks {
    display: grid;
    column-gap: var(--lp-gap);
    border-block-end: var(--lp-border) var(--border-style) var(--lp-line);
  }

  /* Compact in density, not in type: the name leads by weight and ink, the
     line under it is quiet by colour — both at body size. */
  .benefits-checks li {
    display: grid;
    grid-template-columns: var(--space-8) minmax(0, 1fr);
    gap: var(--space-2);
    padding-block: var(--space-5);
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-title);
  }

  /* On the first line of the name, however it wraps. */
  .benefits-checks__mark {
    display: inline-flex;
    margin-block-start: calc((1lh - 1em) / 2);
    color: var(--lp-accent);
  }

  .benefits-checks__name {
    color: var(--lp-ink);
    font-weight: var(--font-semibold);
  }

  .benefits-checks .benefits__detail {
    margin-block-start: var(--space-1-5);
  }

  @container (min-width: 40rem) {
    .benefits-checks {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  /* ── split ─────────────────────────────────────────────────────────────── */
  .benefits-rows {
    display: grid;
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
  }

  .benefits-rows li {
    display: grid;
    gap: var(--space-2);
    padding-block: var(--space-5);
    border-block-end: var(--lp-border) var(--border-style) var(--lp-line);
  }

  /* Ink named outright, and no "title" in the class: org-brand.css paints any
     `[class*='__title']` with the viewer theme's heading colour. */
  .benefits-rows__name {
    color: var(--lp-ink);
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-title);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
    line-height: var(--lp-leading-title);
    letter-spacing: var(--lp-tracking-title);
    text-wrap: balance;
  }

  /* A short list sits level with the words; a long one scrolls past them
     while they stay in view. */
  @container (min-width: 56rem) {
    .benefits[data-layout='split'] {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      align-items: center;
      column-gap: calc(var(--lp-gap) * 1.5);
    }

    .benefits[data-layout='split'][data-long] {
      align-items: start;
    }

    .benefits[data-long] .benefits__words {
      position: sticky;
      top: var(--space-12);
    }
  }

  /* ── Bold: hard ink rules over open columns ────────────────────────────── */
  :global(.lp[data-lp-style='bold']) :is(.benefits-grid li, .benefits-rows) {
    border-block-start: var(--lp-rule) var(--border-style) var(--lp-ink);
  }

  :global(.lp[data-lp-style='bold']) .benefits-checks li:first-child {
    border-block-start: var(--lp-rule) var(--border-style) var(--lp-ink);
  }

  @container (min-width: 40rem) {
    :global(.lp[data-lp-style='bold']) .benefits-checks li:nth-child(2) {
      border-block-start: var(--lp-rule) var(--border-style) var(--lp-ink);
    }
  }

  /* ── Soft: outlined rounded tiles, and lists in one rounded group ──────── */
  /* Cards, not ruled tiles: the rows part by the same gap as the columns. */
  :global(.lp[data-lp-style='soft']) .benefits-grid {
    row-gap: var(--lp-gap);
  }

  :global(.lp[data-lp-style='soft']) .benefits-grid li {
    padding: var(--space-6);
    border: var(--lp-border) var(--border-style) var(--lp-line);
    border-radius: var(--lp-radius-card);
  }

  /* Soft's column is the narrowest, so four tiles sit two by two and the
     larger sets in threes, never four narrow cards to a row. */
  @container (min-width: 60rem) {
    :global(.lp[data-lp-style='soft']) .benefits-grid[data-count='4'] {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    :global(.lp[data-lp-style='soft']) .benefits-grid:is([data-count='7'], [data-count='8']) {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  /* A head over a row of cards is centred in Soft, as its pricing is. */
  :global(.lp[data-lp-style='soft']) .benefits[data-layout='grid'] {
    --lp-actions-align: center;
  }

  :global(.lp[data-lp-style='soft']) .benefits[data-layout='grid'] .benefits__head {
    justify-items: center;
    text-align: center;
  }

  :global(.lp[data-lp-style='soft']) .benefits[data-layout='grid'] :global(.lp-eyebrow) {
    justify-self: center;
  }

  :global(.lp[data-lp-style='soft']) :is(.benefits-checks, .benefits-rows) {
    padding-inline: var(--space-6);
    border: var(--lp-border) var(--border-style) var(--lp-line);
    border-radius: var(--lp-radius-card);
  }

  :global(.lp[data-lp-style='soft']) .benefits-rows li:last-child {
    border-block-end: none;
  }

  :global(.lp[data-lp-style='soft']) .benefits-checks li:first-child {
    border-block-start: none;
  }

  @container (min-width: 40rem) {
    :global(.lp[data-lp-style='soft']) .benefits-checks li:nth-child(2) {
      border-block-start: none;
    }
  }
</style>

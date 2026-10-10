<!--
  @component FaqBlock

  The questions people ask before they join. Scanned, not read: strong
  questions, calm answers. Two layouts:
    accordion — the words beside the list (they stay in view while a long
                list scrolls); each question opens its answer
    columns   — the heading above; every question and answer on show, two to
                a row

  The contact is the list's closing row (Codex-61zsk.37): "Still wondering?",
  then the creator's own words and address — after the last answer, so it
  follows the questions it answers for, heading or not. A join button appears
  only when the creator writes one: beside the words when there are some,
  else closing the section, after the objections are answered. No questions:
  the public page keeps only the words; the canvas asks for some.
-->
<script lang="ts">
  import { COPY } from '../../model/copy';
  import type { BlockProps } from '../../model/types';
  import Button from '../../primitives/Button.svelte';
  import ButtonRow from '../../primitives/ButtonRow.svelte';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Text from '../../primitives/Text.svelte';
  import { contactHref } from './contact';
  import { FAQ_EMPTY, faqDefinition } from './definition';
  import FaqAccordion from './FaqAccordion.svelte';
  import FaqColumns from './FaqColumns.svelte';

  const { props, section, context, edit }: BlockProps = $props();

  const content = $derived(faqDefinition.coerce(props));
  const layout = $derived(section.layout === 'columns' ? 'columns' : 'accordion');
  const items = $derived(content.items ?? []);
  const asks = $derived(Boolean(content.ctaLabel || content.note));
  const headed = $derived(Boolean(content.eyebrow || content.heading || content.body));
  // Beside the list only when there are words to keep in view: a button alone
  // in that column would be as orphaned as the contact once was.
  const sided = $derived(layout === 'accordion' && headed);
  // A question sits one level under the section heading, or at the section's
  // own level when there is none — never a second h1.
  const level = $derived<2 | 3>(content.heading && section.headingLevel === 2 ? 3 : 2);
</script>

{#snippet head()}
  {#if headed}
    <header class="faq__head">
      {#if content.eyebrow}<Eyebrow text={content.eyebrow} type="faq" {edit} />{/if}
      {#if content.heading}
        <Heading
          level={section.headingLevel}
          text={content.heading}
          type="faq"
          field="heading"
          {edit}
        />
      {/if}
      {#if content.body}
        <Text text={content.body} size="lead" type="faq" field="body" {edit} />
      {/if}
    </header>
  {/if}
{/snippet}

{#snippet contact()}
  {#if content.contactLabel}
    <div class="faq__close">
      <p class="faq__close-ask">{COPY.faq.stillWondering}</p>
      <Button
        href={contactHref(content.contactHref)}
        label={content.contactLabel}
        variant="outline"
        section="faq"
        field="contactLabel"
        {edit}
      />
    </div>
  {/if}
{/snippet}

{#snippet ask()}
  {#if asks}
    <ButtonRow
      {context}
      section="faq"
      label={content.ctaLabel}
      note={content.note}
      size="md"
      {edit}
    />
  {/if}
{/snippet}

{#snippet list()}
  {#if items.length === 0}
    {#if edit}<p class="faq__empty" data-lp-edit-only>{FAQ_EMPTY}</p>{/if}
  {:else if layout === 'columns'}
    <FaqColumns {items} {level} />
  {:else}
    <FaqAccordion {items} {level} anchor={section.anchor} />
  {/if}
{/snippet}

<div class="faq" data-layout={layout} data-sided={sided ? '' : undefined}>
  {#if sided}
    <div class="faq__side">{@render head()}{@render ask()}</div>
  {:else}
    {@render head()}
  {/if}
  <div class="faq__list">{@render list()}{@render contact()}</div>
  {#if !sided}{@render ask()}{/if}
</div>

<style>
  .faq,
  .faq__side,
  .faq__head {
    display: grid;
    gap: var(--lp-stack);
    align-content: start;
  }

  .faq {
    gap: var(--lp-gap);
  }

  /* The heading measures itself in its own `ch`, not the body face's. */
  .faq__head :global(.lp-heading) {
    max-inline-size: 18ch;
  }

  /* The list and its closing row share one column of the section. */
  .faq__list {
    display: grid;
    align-content: start;
    min-inline-size: 0;
  }

  /* ── the contact: the list's closing row ───────────────────────────────── */
  /* One more line in the questions' own voice, answered by the way to ask. */
  .faq__close {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4) var(--space-6);
    padding-block: var(--space-5);
  }

  /* global.css caps every `p` at 65ch. */
  .faq__close-ask {
    max-inline-size: none;
    margin: 0;
    color: var(--lp-ink);
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-title);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
    line-height: var(--lp-leading-title);
    letter-spacing: var(--lp-tracking-title);
  }

  /* Under the columns it is a row of its own, ruled as each answer is. */
  .faq[data-layout='columns'] .faq__close {
    padding-block-end: 0;
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
  }

  :global(.lp[data-lp-style='bold']) .faq[data-layout='columns'] .faq__close {
    border-block-start: var(--lp-rule) var(--border-style) var(--lp-ink);
  }

  /* Soft's questions are tiles: the row keeps to their inset, unruled (in
     both layouts, so it outranks the columns rule above). */
  :global(.lp[data-lp-style='soft']) .faq .faq__close {
    padding-inline: var(--space-6);
    border-block-start: none;
  }

  /* A phone-width band: the way to ask takes the full row, as every call to
     action does there. `stretch`, or the row's `space-between` would size
     the grid's one column to its content. */
  @container (max-width: 30rem) {
    .faq__close {
      display: grid;
      justify-content: stretch;
    }
  }

  /* global.css caps every `p` at 65ch; the prompt spans its region. */
  .faq__empty {
    max-inline-size: none;
    margin: 0;
    padding: var(--space-6);
    border: var(--lp-border) var(--border-style-dashed) var(--lp-button-line);
    border-radius: var(--lp-radius-card);
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    text-align: center;
  }

  /* ── accordion: the words stay beside a long list ──────────────────────── */
  @container (min-width: 56rem) {
    .faq[data-sided] {
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
      align-items: start;
      column-gap: calc(var(--lp-gap) * 1.5);
    }

    .faq[data-sided] > .faq__side {
      position: sticky;
      top: var(--space-12);
    }
  }
</style>

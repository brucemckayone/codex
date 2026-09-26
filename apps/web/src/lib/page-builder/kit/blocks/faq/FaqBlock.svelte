<!--
  @component FaqBlock

  The questions people ask before they join. Scanned, not read: strong
  questions, calm answers. Two layouts:
    accordion — the words beside the list (they stay in view while a long
                list scrolls); each question opens its answer
    columns   — the heading above, the contact link level with it; every
                question and answer on show, two to a row; any join button
                closes the section, after the objections are answered

  The contact link is the creator's own words and address; a join button
  appears only when the creator writes one. No questions: the public page
  keeps only the words; the canvas asks for some.
-->
<script lang="ts">
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
  const sided = $derived(layout === 'accordion' && (headed || asks || !!content.contactLabel));
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
    <div class="faq__contact">
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
  {#if layout === 'columns'}
    {#if headed || content.contactLabel}
      <div class="faq__top">{@render head()}{@render contact()}</div>
    {/if}
    {@render list()}
    {@render ask()}
  {:else}
    {#if sided}
      <div class="faq__side">
        {@render head()}
        {#if asks || content.contactLabel}
          <div class="faq__links">{@render ask()}{@render contact()}</div>
        {/if}
      </div>
    {/if}
    {@render list()}
  {/if}
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

  .faq__top {
    display: grid;
    gap: var(--lp-stack);
  }

  .faq__links {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-4) var(--space-5);
  }

  .faq__contact {
    display: grid;
    justify-items: start;
  }

  /* A phone-width band: each way on takes a full row, as every call to
     action does there. */
  @container (max-width: 30rem) {
    .faq__links {
      display: grid;
    }

    .faq__contact {
      justify-items: stretch;
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

  /* ── columns: the contact link level with the heading ──────────────────── */
  @container (min-width: 48rem) {
    .faq__top:has(> .faq__head) {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
      column-gap: var(--lp-gap);
    }
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

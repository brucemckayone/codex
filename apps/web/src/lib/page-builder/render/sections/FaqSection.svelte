<!--
  @component FaqSection

  The honest answers (SPEC §4.1 `faq`) — an accessible accordion built on the
  Melt-wrapped `ui/Accordion` (WAI-ARIA + keyboard for free). Self-hides when no
  entries are configured.
-->
<script lang="ts">
  import * as Accordion from '$lib/components/ui/Accordion';
  import { asString, asObjectArray, fieldString } from '../coerce';
  import type { FaqSectionProps, FaqEntry, JourneySalesContext } from '../types';
  import type { SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    /** Present for a uniform section-component contract; unused by this section. */
    context: JourneySalesContext;
  }

  const { config }: Props = $props();

  const p: FaqSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    heading: asString(config, 'heading'),
    items: asObjectArray<FaqEntry>(config, 'items', (entry) => {
      const question = fieldString(entry, 'question');
      const answer = fieldString(entry, 'answer');
      if (!question || !answer) return null;
      return { question, answer };
    }),
  });

  const heading = $derived(p.heading ?? 'The honest answers.');
</script>

{#if p.items}
  <div class="faq">
    <div class="faq__inner">
      <header class="faq__head">
        {#if p.eyebrow}
          <p class="faq__eyebrow">{p.eyebrow}</p>
        {/if}
        <h2 class="faq__heading">{heading}</h2>
      </header>

      <!-- Single-open: one answer at a time keeps the FAQ compact. (The
           Melt-wrapped Accordion's Props narrows `multiple` to `false`, so
           multi-open would need an unsafe cast — single-open is the clean,
           type-honest default.) -->
      <Accordion.Root>
        {#each p.items as item, i (i)}
          <Accordion.Item value={`faq-${i}`}>
            <Accordion.Trigger>{item.question}</Accordion.Trigger>
            <Accordion.Content>{item.answer}</Accordion.Content>
          </Accordion.Item>
        {/each}
      </Accordion.Root>
    </div>
  </div>
{/if}

<style>
  .faq {
    padding-block: var(--space-20);
    padding-inline: var(--space-5);
  }

  .faq__inner {
    max-width: 48rem;
    margin-inline: auto;
  }

  .faq__head {
    text-align: center;
    margin-bottom: var(--space-10);
  }

  .faq__eyebrow {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .faq__heading {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-4xl);
    line-height: var(--leading-tight);
    letter-spacing: -0.015em;
    color: var(--color-heading);
    text-wrap: balance;
  }
</style>

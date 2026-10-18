<!--
  @component FaqColumns

  The columns layout's list: every question and answer on show, two to a row
  on a wide band so a visitor scans across as well as down. Questions are
  headings, strong and short; answers sit under them, quiet by colour.
-->
<script lang="ts">
  import { paragraphs } from '../../model/read';
  import Heading from '../../primitives/Heading.svelte';
  import type { FaqItem } from './definition';

  interface Props {
    items: readonly FaqItem[];
    level: 2 | 3;
  }

  const { items, level }: Props = $props();
</script>

<ul class="faq-cols" data-count={items.length}>
  {#each items as item, index (index)}
    <li class="faq-cols__item">
      <Heading {level} size="title" text={item.question} type="faq" />
      <div class="faq-cols__answer">
        {#each paragraphs(item.answer) as part, p (p)}<p>{part}</p>{/each}
      </div>
    </li>
  {/each}
</ul>

<style>
  .faq-cols {
    --_n: 1;
    display: grid;
    grid-template-columns: repeat(var(--_n), minmax(0, 1fr));
    column-gap: var(--lp-gap);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* Rows align across the columns, so each pair reads as one line of the
     page; a short answer leaves air under it rather than a ragged stagger. */
  /* Its question's room (03 X71): its share of the column, less its inset,
     the padding and border a Style that boxes it gives it (Soft, below). */
  .faq-cols__item {
    --_inset: 0px;
    --lp-title-column: calc(
      (var(--lp-column) - (var(--_n) - 1) * var(--lp-gap)) / var(--_n) - 2 * var(--_inset)
    );
    display: grid;
    align-content: start;
    gap: var(--space-3);
    margin: 0;
    padding-block: var(--space-6) var(--space-8);
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
  }

  .faq-cols__answer {
    display: grid;
    gap: var(--lp-paragraph-gap);
    max-inline-size: var(--lp-measure);
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
  }

  .faq-cols__answer p {
    max-inline-size: none;
    margin: 0;
    text-wrap: pretty;
  }

  @container (min-width: 44rem) {
    .faq-cols:not([data-count='1']) {
      --_n: 2;
    }
  }

  /* Bold: hard ink rules over open columns. */
  :global(.lp[data-lp-style='bold']) .faq-cols__item {
    border-block-start: var(--lp-rule) var(--border-style) var(--lp-ink);
  }

  /* Soft: rounded tiles, parted by the same gap both ways. */
  :global(.lp[data-lp-style='soft']) .faq-cols {
    row-gap: var(--space-4);
  }

  :global(.lp[data-lp-style='soft']) .faq-cols__item {
    --_inset: calc(var(--space-6) + var(--lp-border));
    padding: var(--space-6);
    border: var(--lp-border) var(--border-style) var(--lp-line);
    border-radius: var(--lp-radius-card);
  }
</style>

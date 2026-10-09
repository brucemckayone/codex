<!--
  @component FaqAccordion

  The accordion layout's list: each question a real button inside a heading
  (the ARIA accordion pattern), its answer in the panel it controls. Every
  answer is open until the page's script runs; after that they open one by one,
  independently, and a closed answer is still found by find-in-page
  (`hidden="until-found"`), which opens it.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { paragraphs } from '../../model/read';
  import type { FaqItem } from './definition';
  import { Disclosures, stepFocus } from './disclosure.svelte';
  import Sign from './Sign.svelte';

  interface Props {
    items: readonly FaqItem[];
    level: 2 | 3;
    /** The section's anchor, so every id on the page is unique and stable. */
    anchor: string;
  }

  const { items, level, anchor }: Props = $props();

  const panels = new Disclosures();
  onMount(() => panels.enhance());
</script>

<ul class="faq-acc" data-lp-disclosures>
  {#each items as item, index (index)}
    {@const key = String(index)}
    {@const open = panels.isOpen(key)}
    <li class="faq-acc__item">
      <svelte:element this={`h${level}`} class="faq-acc__q">
        <button
          type="button"
          class="faq-acc__toggle"
          id="{anchor}-q{index + 1}"
          aria-expanded={open}
          aria-controls="{anchor}-a{index + 1}"
          data-lp-toggle
          onclick={() => panels.toggle(key)}
          onkeydown={stepFocus}
        >
          <span class="faq-acc__question">{item.question}</span>
          <Sign {open} />
        </button>
      </svelte:element>
      <div
        class="faq-acc__panel"
        id="{anchor}-a{index + 1}"
        hidden={open ? undefined : 'until-found'}
        onbeforematch={() => panels.reveal(key)}
      >
        <div class="faq-acc__answer">
          {#each paragraphs(item.answer) as part, p (p)}<p>{part}</p>{/each}
        </div>
      </div>
    </li>
  {/each}
</ul>

<style>
  .faq-acc {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
  }

  /* base.css spaces every `li` but the last. */
  .faq-acc__item {
    margin: 0;
    border-block-end: var(--lp-border) var(--border-style) var(--lp-line);
  }

  /* A real heading for the outline; the app's heading rules (size, colour)
     are the button's business, not the heading's. */
  .faq-acc__q {
    margin: 0;
    color: var(--lp-ink);
    font-size: inherit;
    line-height: inherit;
  }

  .faq-acc__toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
    inline-size: 100%;
    min-block-size: var(--tap-target-min);
    padding-block: var(--space-5);
    color: var(--lp-ink);
    text-align: start;
  }

  .faq-acc__question {
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-title);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
    line-height: var(--lp-leading-title);
    letter-spacing: var(--lp-tracking-title);
    text-wrap: balance;
  }

  @media (hover: hover) {
    .faq-acc__toggle:hover .faq-acc__question {
      text-decoration: underline;
      text-decoration-thickness: var(--border-width);
      text-underline-offset: var(--lp-underline-offset);
    }
  }

  .faq-acc__toggle:focus-visible {
    outline: var(--border-width-thick) solid var(--lp-focus);
    outline-offset: var(--focus-offset);
  }

  /* `until-found` hides by content-visibility, not display: the panel's own
     box stays, so every inset lives on the inner answer. */
  .faq-acc__answer {
    display: grid;
    gap: var(--lp-paragraph-gap);
    max-inline-size: var(--lp-measure);
    padding-block-end: var(--space-6);
    padding-inline-end: calc(var(--space-5) + var(--space-6));
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
  }

  .faq-acc__answer p {
    max-inline-size: none;
    margin: 0;
    text-wrap: pretty;
  }

  /* A phone's line is short enough; the answer may run under the sign. */
  @container (max-width: 30rem) {
    .faq-acc__answer {
      padding-inline-end: 0;
    }
  }

  /* Bold: the list opens under a hard ink rule. */
  :global(.lp[data-lp-style='bold']) .faq-acc {
    border-block-start: var(--lp-rule) var(--border-style) var(--lp-ink);
  }

  /* Soft: each question its own rounded tile. */
  :global(.lp[data-lp-style='soft']) .faq-acc {
    gap: var(--space-3);
    border-block-start: none;
  }

  :global(.lp[data-lp-style='soft']) .faq-acc__item {
    padding-inline: var(--space-6);
    border: var(--lp-border) var(--border-style) var(--lp-line);
    border-radius: var(--lp-radius-card);
  }
</style>

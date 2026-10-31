<!--
  @component Credentials

  The guide's credentials — an unordered set, so never numbered. `ledger`
  sets them in ruled columns (a hard ink rule in Bold); `chips` centres them
  as outlined labels, for a layout that reads down the middle.

  In the ledger, a credential that leads with a figure ("20 years teaching",
  `model/credential-figure.ts`) sets the figure on its own line, the words
  under it (Codex-61zsk.73). Chips stay as written: short labels.
-->
<script lang="ts">
  import { credentialFigure } from '../../model/credential-figure';

  interface Props {
    items: readonly string[];
    variant?: 'ledger' | 'chips';
  }

  const { items, variant = 'ledger' }: Props = $props();

  const rows = $derived(
    items.map((text) => ({
      text,
      lead: variant === 'ledger' ? credentialFigure(text) : null,
    }))
  );
</script>

<!-- A led row still reads as one phrase: the space between its two lines is
     real text, so it is spoken and copied, but never drawn. -->
<ul class="creds" data-variant={variant}>
  {#each rows as row, index (index)}<li>
      {#if row.lead}<span class="creds__figure">{row.lead.figure}</span>{' '}<span
          class="creds__words">{row.lead.words}</span
        >{:else}{row.text}{/if}
    </li>{/each}
</ul>

<style>
  .creds {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-title);
    color: var(--lp-ink);
  }

  /* The app's prose lists space every item but the last. */
  .creds li {
    margin: 0;
  }

  /* A list's item size: a step under the guide's quote and name, a title or
     more in the display face, so they still lead; a chip keeps the body's.
     A column is at least ten of the list's own em, so a long word fits it at
     the size each Type sets. */
  .creds[data-variant='ledger'] {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 10em), 1fr));
    gap: var(--space-3) var(--space-6);
    font-size: var(--lp-size-item);
  }

  /* Under the quote layout's centrepiece (InstructorBlock's
     `.guide-quote__more`) the section's heading steps down to a title, so a
     list there keeps the body's size and never matches the heading. */
  :global(.guide-quote__more) .creds[data-variant='ledger'] {
    font-size: var(--lp-size-body);
  }

  .creds[data-variant='ledger'] li {
    padding-block-start: var(--space-3);
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
  }

  :global(.lp[data-lp-style='bold']) .creds[data-variant='ledger'] li {
    border-block-start: var(--lp-rule) var(--border-style) var(--lp-ink);
  }

  /* A leading figure in the display face, halfway from title to heading.
     Since #657 the item size is never under the lead's, so a figure at title
     size barely stood over its own words (smaller than them on a phone);
     halfway leads them clearly and still sits under the section heading.
     It sits in a column's room, which louder's fit cannot see, so its half
     of the heading follows the dial down and never up. Every row keeps its
     rule above, level at the top, led or not. */
  .creds__figure {
    display: block;
    font-family: var(--lp-font-display);
    font-size: calc(
      (var(--lp-size-title) + var(--lp-size-heading) * var(--lp-drama-held, 1)) / 2
    );
    font-weight: var(--lp-weight-display);
    font-synthesis: none;
    font-variant-numeric: lining-nums tabular-nums;
    line-height: var(--lp-leading-display);
    letter-spacing: var(--lp-tracking-display);
  }

  .creds__words {
    display: block;
  }

  /* Under the quote layout's centrepiece the list keeps the body's size and
     the heading is a title, so the figure takes the item's: it leads its
     words and never matches the heading. */
  :global(.guide-quote__more) .creds__figure {
    font-size: var(--lp-size-item);
  }

  /* Bold's Type sets a credential semibold, in a list or as a chip (03 X73). */
  :global(.lp[data-lp-type-facet='bold']) .creds[data-variant='ledger'] li {
    font-weight: var(--font-semibold);
  }

  .creds[data-variant='chips'] {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2);
  }

  .creds[data-variant='chips'] li {
    padding: var(--space-2) var(--space-4);
    border: var(--lp-border) var(--border-style) var(--lp-line);
    border-radius: var(--lp-radius-chip);
  }

  :global(.lp[data-lp-style='bold']) .creds[data-variant='chips'] li {
    border: var(--lp-rule) var(--border-style) var(--lp-ink);
  }

  :global(.lp[data-lp-type-facet='bold']) .creds[data-variant='chips'] li {
    font-weight: var(--font-semibold);
  }
</style>

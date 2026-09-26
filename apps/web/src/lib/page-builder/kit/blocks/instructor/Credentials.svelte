<!--
  @component Credentials

  The guide's credentials — an unordered set, so never numbered. `ledger`
  sets them in ruled columns (a hard ink rule in Bold); `chips` centres them
  as outlined labels, for a layout that reads down the middle.
-->
<script lang="ts">
  interface Props {
    items: readonly string[];
    variant?: 'ledger' | 'chips';
  }

  const { items, variant = 'ledger' }: Props = $props();
</script>

<ul class="creds" data-variant={variant}>
  {#each items as item, index (index)}<li>{item}</li>{/each}
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

  .creds[data-variant='ledger'] {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 12rem), 1fr));
    gap: var(--space-3) var(--space-6);
  }

  .creds[data-variant='ledger'] li {
    padding-block-start: var(--space-3);
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
  }

  :global(.lp[data-lp-style='bold']) .creds[data-variant='ledger'] li {
    border-block-start: var(--lp-rule) var(--border-style) var(--lp-ink);
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
    font-weight: var(--font-semibold);
  }
</style>

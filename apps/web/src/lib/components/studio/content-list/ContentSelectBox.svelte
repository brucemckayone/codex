<!--
  @component ContentSelectBox

  A bulk-selection box (Codex-a6ofh.3.5, mockup L2): a row's or a card's,
  or with `rows` the table header's, for every row on the page as far as
  the cap allows. At the cap a box not ticked waits, so the cap is never
  passed by a click. One box for the table and the cards, so both read
  and behave alike.
-->
<script lang="ts">
  import type { ContentWithRelations } from '$lib/types';
  import * as m from '$paraglide/messages';
  import type { ContentSelection } from './content-selection.svelte';

  type Props = { selection: ContentSelection } & (
    | { row: Pick<ContentWithRelations, 'id' | 'title'>; rows?: never }
    | { rows: readonly Pick<ContentWithRelations, 'id'>[]; row?: never }
  );

  const { selection, row, rows }: Props = $props();

  const picked = $derived(row ? selection.has(row.id) : false);
  const onPage = $derived(rows ? rows.filter((each) => selection.has(each.id)).length : 0);
  const allOn = $derived(
    rows !== undefined && onPage > 0 && (onPage === rows.length || selection.full)
  );
</script>

{#if row}
  <input
    type="checkbox"
    class="select-box"
    checked={picked}
    disabled={!picked && selection.full}
    aria-label={m.studio_content_bulk_select_row({ title: row.title })}
    onchange={() => selection.toggle(row.id)}
  />
{:else if rows}
  <input
    type="checkbox"
    class="select-box"
    checked={allOn}
    indeterminate={onPage > 0 && !allOn}
    aria-label={m.studio_content_bulk_select_page({ max: selection.max })}
    onchange={(event) =>
      selection.setPage(
        rows.map((each) => each.id),
        event.currentTarget.checked
      )}
  />
{/if}

<style>
  .select-box {
    width: var(--space-4);
    height: var(--space-4);
    margin: 0;
    accent-color: var(--color-interactive);
    cursor: pointer;
  }

  .select-box:disabled {
    cursor: not-allowed;
  }

  .select-box:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }
</style>

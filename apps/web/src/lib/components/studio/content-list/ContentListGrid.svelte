<!--
  @component ContentListGrid

  The content list as cards (Codex-a6ofh.3.1, mockup L5 `?view=grid`):
  picture-led and calmer than the table, about six pieces a screen, so each
  card carries its status, its access and one count (views, or sales for a
  piece that sells), and the line that says what it needs. The same words as
  the table (`row-facts`), so a piece reads the same in either view. The
  phone's only view. Each card has a box for the bulk bar and a ⋯ menu
  (Codex-a6ofh.3.5), over its picture.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ContentWithRelations } from '$lib/types';
  import type { PayoutsRead } from '$lib/utils/connect-readiness';
  import * as m from '$paraglide/messages';
  import ContentCategories from './ContentCategories.svelte';
  import ContentRowLine from './ContentRowLine.svelte';
  import ContentStatus from './ContentStatus.svelte';
  import ContentThumb from './ContentThumb.svelte';
  import type { ContentSelection } from './content-selection.svelte';
  import {
    accessWords,
    categoryWords,
    rowHref,
    rowLine,
    salesShown,
    type TierName,
    viewsShown,
  } from './row-facts';

  interface Props {
    items: ContentWithRelations[];
    payouts: PayoutsRead;
    tierName: TierName;
    /** The org studio's categories, as its table shows them (Codex-a6ofh.3.3). */
    showCategories: boolean;
    /** The bulk selection: a box on each card. */
    selection: ContentSelection;
    /** A card's ⋯ menu. */
    rowMenu: Snippet<[ContentWithRelations]>;
  }

  const { items, payouts, tierName, showCategories, selection, rowMenu }: Props = $props();

  /** Mockup L5: a selling piece shows its sales, anything else its views. */
  function countLine(row: ContentWithRelations): string | null {
    const sales = salesShown(row);
    if (sales !== null) return m.studio_content_list_sales_count({ count: sales });
    const views = viewsShown(row);
    return views === null ? null : m.studio_content_list_views_count({ count: views });
  }
</script>

<ul class="content-grid" role="list">
  {#each items as row (row.id)}
    {@const line = rowLine(row, payouts)}
    {@const counted = countLine(row)}
    {@const filed = showCategories ? categoryWords(row) : null}
    {@const picked = selection.has(row.id)}
    <li class="card" data-content-id={row.id} data-selected={picked || undefined}>
      <ContentThumb piece={row} variant="card" />
      <div class="card-body">
        <a class="card-title" href={rowHref(row, line)}>
          {row.title}
        </a>
        <span class="card-facts">
          <ContentStatus piece={row} />
          <span class="card-fact">{accessWords(row, tierName).label}</span>
          {#if filed}
            <span class="card-fact"><ContentCategories {filed} /></span>
          {/if}
          {#if counted}<span class="card-fact">{counted}</span>{/if}
        </span>
        {#if line}<ContentRowLine {line} />{/if}
      </div>
      <!-- After the title's link, so they sit above the card-wide link. -->
      <span class="card-tool card-select">
        <input
          type="checkbox"
          class="card-check"
          checked={picked}
          disabled={!picked && selection.full}
          aria-label={m.studio_content_bulk_select_row({ title: row.title })}
          onchange={() => selection.toggle(row.id)}
        />
      </span>
      <span class="card-tool card-menu">{@render rowMenu(row)}</span>
    </li>
  {/each}
</ul>

<style>
  .content-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    transition: var(--transition-colors);
  }

  .card:hover {
    border-color: var(--color-border-strong);
  }

  .card[data-selected] {
    border-color: var(--color-interactive);
    background: var(--color-interactive-subtle);
  }

  /* Over the picture's corners, on a surface so they read on any frame. */
  .card-tool {
    position: absolute;
    top: var(--space-3);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    background: var(--color-surface);
    box-shadow: var(--shadow-sm);
  }

  .card-select {
    left: var(--space-3);
    width: var(--space-8);
    height: var(--space-8);
  }

  .card-menu {
    right: var(--space-3);
  }

  .card-check {
    width: var(--space-4);
    height: var(--space-4);
    margin: 0;
    accent-color: var(--color-interactive);
    cursor: pointer;
  }

  .card-check:disabled {
    cursor: not-allowed;
  }

  .card-check:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* The whole card is the title's link: one tab stop, and its ring, for a
     keyboard focus only (`:focus-within` ringed a mouse click too). */
  .card:has(.card-title:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .card-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    padding: 0 var(--space-1) var(--space-1);
    min-width: 0;
  }

  .card-title {
    font-weight: var(--font-semibold);
    color: var(--color-text);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-title::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }

  .card-title:focus-visible {
    outline: none;
  }

  .card:hover .card-title {
    color: var(--color-link);
  }

  .card-facts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .card-fact {
    white-space: nowrap;
  }
</style>

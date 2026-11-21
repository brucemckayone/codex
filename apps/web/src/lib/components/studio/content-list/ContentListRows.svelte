<!--
  @component ContentListRows

  The content list on a phone, as rows (Codex-a6ofh.3.6, mockup L4a, owner
  2026-11-15): a small picture, the title at the full width, one line of its
  status, its access and one more fact, the line that says what it needs, and
  its ⋯ menu. About six pieces a screen, where a card shows one and a half.
  A phone's Grid is still the cards (`ContentListGrid`).

  The one more fact, as the mockup's rows: a leaving piece's owners (LN3),
  else the tier a subscriber piece is in, else its count (sales, or views),
  else when it was last changed. The same words as the table and the cards
  (`row-facts`).

  The whole row is the title's link; the box (the bulk bar's) and the menu
  sit above it.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ContentWithRelations } from '$lib/types';
  import type { PayoutsRead } from '$lib/utils/connect-readiness';
  import { formatRelativeTime } from '$lib/utils/format';
  import ContentRowLine from './ContentRowLine.svelte';
  import ContentSelectBox from './ContentSelectBox.svelte';
  import ContentStatus from './ContentStatus.svelte';
  import ContentThumb from './ContentThumb.svelte';
  import type { ContentSelection } from './content-selection.svelte';
  import {
    accessWords,
    countWords,
    type LeavingLine,
    rowHref,
    rowLine,
    type TierName,
  } from './row-facts';

  interface Props {
    items: ContentWithRelations[];
    payouts: PayoutsRead;
    tierName: TierName;
    /** The bulk selection: a box on each row. */
    selection: ContentSelection;
    /** A row's ⋯ menu, given the row and where its title opens it. */
    rowMenu: Snippet<[ContentWithRelations, string]>;
    /** Keep it or Delete it too, on a leaving row's line (Codex-a6ofh.6, LN3). */
    onLeaveAction: (row: ContentWithRelations, action: LeavingLine['action']) => void;
    /** An action on the list is under way: the line's action waits. */
    busy: boolean;
  }

  const { items, payouts, tierName, selection, rowMenu, onLeaveAction, busy }: Props = $props();
</script>

<ul class="content-rows" role="list">
  {#each items as row (row.id)}
    {@const line = rowLine(row, payouts)}
    {@const href = rowHref(row, line)}
    {@const access = accessWords(row, tierName)}
    {@const fact =
      (line?.kind === 'leaving' ? line.owners : null) ??
      access.detail ??
      countWords(row) ??
      formatRelativeTime(row.updatedAt)}
    <li class="crow" data-content-id={row.id} data-selected={selection.has(row.id) || undefined}>
      <span class="crow-tool"><ContentSelectBox {selection} {row} /></span>
      <ContentThumb piece={row} variant="compact" />
      <div class="crow-body">
        <a class="crow-title" {href}>{row.title}</a>
        <span class="crow-facts">
          <ContentStatus piece={row} />
          <span class="crow-fact">{access.label} · {fact}</span>
        </span>
        {#if line}<ContentRowLine {line} title={row.title} compact {busy} onaction={(action) => onLeaveAction(row, action)} />{/if}
      </div>
      <span class="crow-tool">{@render rowMenu(row, href)}</span>
    </li>
  {/each}
</ul>

<style>
  .content-rows {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
    border-block-start: var(--border-width) var(--border-style) var(--color-border);
  }

  .crow {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-3) 0;
    border-block-end: var(--border-width) var(--border-style) var(--color-border);
    transition: var(--transition-colors);
  }

  .crow[data-selected] {
    background: var(--color-interactive-subtle);
  }

  /* The box and the menu sit above the row-wide link. */
  .crow-tool {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }

  .crow-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  /* Two lines before it is cut: the phone row's point (L4a) is a title
     that reads, where the table's was cut to about two words. */
  .crow-title {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    font-weight: var(--font-semibold);
    color: var(--color-text);
    text-decoration: none;
    overflow-wrap: anywhere;
  }

  /* The whole row is the title's link: one tab stop, ringed for a keyboard. */
  .crow-title::after {
    content: '';
    position: absolute;
    inset: 0;
  }

  .crow-title:focus-visible {
    outline: none;
  }

  .crow:has(.crow-title:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: calc(-1 * var(--border-width-thick));
  }

  .crow-facts {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* A long fact wraps under itself, never cut: "Buyers keep access" is
     the point of an off-sale row. The status beside it stays whole. */
  .crow-fact {
    min-width: 0;
  }

  .crow-facts > :global(:first-child) {
    flex-shrink: 0;
  }
</style>

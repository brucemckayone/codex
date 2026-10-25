<!--
  @component ChargeResults

  The search's charges (Codex-2hxff.28, mockup A1): a table, and below 40rem
  one block per charge in place of a sideways-scrolling table. The status
  column copies the studio Sales page: the Badge, the "−£x refunded" note and
  the dispute flag. The window is the server's answer; the "days left" is for
  display only.

  A charge Stripe names no charge id for (an old purchase) is listed but not
  linked: it cannot be opened for a refund. Soft-deleted items and buyers are
  labelled, never hidden.

  @prop {ChargeSummary[]} items
  @prop {Date} [now] - The clock "days left" is measured from.
-->
<script lang="ts">
  import type { ChargeSummary } from '@codex/admin';
  import * as m from '$paraglide/messages';
  import { Badge } from '$lib/components/ui';
  import * as Table from '$lib/components/ui/Table';
  import { AlertTriangleIcon } from '$lib/components/ui/Icon';
  import { formatPrice } from '$lib/utils/format';
  import {
    chargebackFlag,
    chargeKindLabel,
    chargeTitle,
    daysLeftText,
    formatDay,
    formatShortDay,
    windowCell,
  } from './support-format';

  interface Props {
    items: ChargeSummary[];
    now?: Date;
  }

  const { items, now = new Date() }: Props = $props();

  function chargeHref(chargeId: string): string {
    return `/admin/refunds/${encodeURIComponent(chargeId)}`;
  }

  function kindLine(item: ChargeSummary): string {
    const kind = chargeKindLabel(item.kind);
    return item.organizationName ? `${kind} · ${item.organizationName}` : kind;
  }

  function isRefunded(item: ChargeSummary): boolean {
    return item.refundedCents >= item.amountCents;
  }
</script>

{#snippet titleOf(item: ChargeSummary)}
  {#if item.chargeId}
    <a class="row-link" href={chargeHref(item.chargeId)}>{chargeTitle(item)}</a>
  {:else}
    <span class="cell-title">{chargeTitle(item)}</span>
  {/if}
  {#if item.titleDeleted}<Badge>{m.support_deleted()}</Badge>{/if}
{/snippet}

{#snippet statusOf(item: ChargeSummary)}
  {#if isRefunded(item)}
    <Badge>{m.support_status_refunded()}</Badge>
  {:else}
    <Badge variant="success">{m.support_status_paid()}</Badge>
  {/if}
  {#if item.refundedCents > 0 && !isRefunded(item)}
    <span class="refund-note">
      {m.support_refunded_note({ amount: formatPrice(item.refundedCents) })}
    </span>
  {/if}
  {#if chargebackFlag(item.chargeback)}
    <span class="dispute-flag" data-state={item.chargeback}>
      <AlertTriangleIcon size={12} />
      {chargebackFlag(item.chargeback)}
    </span>
  {/if}
{/snippet}

<div class="results-table">
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>{m.support_col_paid()}</Table.Head>
        <Table.Head>{m.support_col_charge()}</Table.Head>
        <Table.Head>{m.support_col_buyer()}</Table.Head>
        <Table.Head class="support-right">{m.support_col_amount()}</Table.Head>
        <Table.Head>{m.support_col_status()}</Table.Head>
        <Table.Head>{m.support_col_window()}</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each items as item, i (item.chargeId ?? `row-${i}`)}
        {@const win = windowCell(item.window, now)}
        <Table.Row data-testid="charge-row">
          <Table.Cell class="support-muted support-num">{formatDay(item.paidAt)}</Table.Cell>
          <Table.Cell>
            <span class="cell-stack">
              <span class="cell-line">{@render titleOf(item)}</span>
              <span class="cell-sub">{kindLine(item)}</span>
              {#if !item.chargeId}
                <span class="cell-sub">{m.support_no_charge_id()}</span>
              {/if}
            </span>
          </Table.Cell>
          <Table.Cell>
            <span class="cell-stack">
              <span class="cell-line">
                <span class="cell-title">{item.buyer.name}</span>
                {#if item.buyer.deleted}<Badge>{m.support_deleted()}</Badge>{/if}
              </span>
              <span class="cell-sub">{item.buyer.email}</span>
            </span>
          </Table.Cell>
          <Table.Cell class="support-amount">{formatPrice(item.amountCents)}</Table.Cell>
          <Table.Cell>
            <span class="cell-stack">{@render statusOf(item)}</span>
          </Table.Cell>
          <Table.Cell>
            <span class="cell-stack">
              <Badge variant={win.badge.variant}>{win.badge.label}</Badge>
              <span class="cell-sub">{win.detail}</span>
            </span>
          </Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
</div>

<ul class="row-list" aria-label={m.support_results_label()}>
  {#each items as item, i (item.chargeId ?? `item-${i}`)}
    <li class="row-item">
      <div class="row-item__line">
        <span class="cell-line">{@render titleOf(item)}</span>
        <span class="row-item__amount">{formatPrice(item.amountCents)}</span>
      </div>
      <span class="cell-sub">{kindLine(item)} · {formatDay(item.paidAt)}</span>
      {#if !item.chargeId}
        <span class="cell-sub">{m.support_no_charge_id()}</span>
      {/if}
      <div class="row-item__tags">
        {@render statusOf(item)}
        {#if item.window.isOpen}
          <Badge variant="success">{m.support_window_open_long()}</Badge>
          <span class="cell-sub">{daysLeftText(item.window.closesAt, now)}</span>
        {:else}
          <Badge>
            {m.support_window_closed_long({ date: formatShortDay(item.window.closesAt) })}
          </Badge>
        {/if}
      </div>
    </li>
  {/each}
</ul>

<style>
  .cell-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    align-items: flex-start;
    min-width: 0;
  }

  .cell-line {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .cell-title {
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .cell-sub,
  .refund-note {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .refund-note {
    font-variant-numeric: tabular-nums;
  }

  .row-link {
    color: var(--color-text);
    font-weight: var(--font-medium);
    text-decoration: none;
    border-bottom: var(--border-width) var(--border-style) var(--color-border-strong);
    transition: var(--transition-colors);
  }

  .row-link:hover {
    border-bottom-color: var(--color-text);
  }

  .row-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .dispute-flag {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--color-status-error-text);
  }

  .dispute-flag[data-state='won'],
  .dispute-flag[data-state='inquiry'] {
    color: var(--color-status-warning-text);
  }

  .results-table :global(.table-cell) {
    vertical-align: top;
  }

  .results-table :global(.support-right) {
    text-align: right;
  }

  .results-table :global(.support-amount) {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-medium);
    white-space: nowrap;
  }

  .results-table :global(.support-muted) {
    color: var(--color-text-secondary);
  }

  .results-table :global(.support-num) {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .row-list {
    display: none;
    flex-direction: column;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    padding: var(--space-4);
    /* base.css gives every li a bottom margin; these rows space by padding. */
    margin: 0;
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .row-item:last-child {
    border-bottom: none;
  }

  .row-item__line {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
  }

  .row-item__amount {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .row-item__tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  @media (--below-sm) {
    .results-table {
      display: none;
    }

    .row-list {
      display: flex;
    }
  }
</style>

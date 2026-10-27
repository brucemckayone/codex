<!--
  @component FailedRefundsTable

  Failed refunds waiting for a person, oldest first (Codex-2hxff.28, mockup
  D1). The buyer's bank sent each one back: the money is in the platform's
  balance again and the payees' shares are still taken back. Each row offers
  the two settlements; the page opens the confirm dialog. A row whose re-pay
  the server refused for a later cause (`repay-blocks.svelte.ts`) keeps Re-pay
  disabled for the session, with the reason beside it.

  @prop {FailedRefundItem[]} items
  @prop {(item, resolution) => void} onSettle
-->
<script lang="ts">
  import type { FailedRefundItem, FailedRefundResolution } from '@codex/admin';
  import * as m from '$paraglide/messages';
  import { Badge, Button } from '$lib/components/ui';
  import * as Table from '$lib/components/ui/Table';
  import { formatPrice } from '$lib/utils/format';
  import { repayBlockReason } from './repay-blocks.svelte';
  import { formatDay, formatShortDay } from './support-format';

  interface Props {
    items: FailedRefundItem[];
    onSettle: (item: FailedRefundItem, resolution: FailedRefundResolution) => void;
  }

  const { items, onSettle }: Props = $props();

  /** "Inner Circle invoice · 2 Oct · £12.00" (D1); a part we hold no record of is left out. */
  function chargeLabel(item: FailedRefundItem): string {
    const title = item.title ?? m.support_unknown_item();
    return [
      item.kind && item.kind !== 'purchase'
        ? m.support_failed_charge_invoice_title({ title })
        : title,
      // A no-break space keeps "12 Oct" on one line when the cell wraps.
      item.chargePaidAt ? formatShortDay(item.chargePaidAt).replace(' ', '\u00a0') : null,
      item.chargeAmountCents === null ? null : formatPrice(item.chargeAmountCents),
    ]
      .filter(Boolean)
      .join(' · ');
  }

  function madeLine(item: FailedRefundItem): string {
    const date = formatShortDay(item.createdAt);
    const name = item.requestedBy?.name;
    if (item.isFull === true) {
      return name
        ? m.support_failed_full_by({ date, name })
        : m.support_failed_full({ date });
    }
    // Null: no record of the charge, so its size is unknown, never "part".
    if (item.isFull === null) {
      return name
        ? m.support_failed_size_unknown_by({ date, name })
        : m.support_failed_size_unknown({ date });
    }
    return name ? m.support_failed_part_by({ date, name }) : m.support_failed_part({ date });
  }

  function phoneLine(item: FailedRefundItem): string {
    const dates = { made: formatShortDay(item.createdAt), failed: formatShortDay(item.failedAt) };
    if (item.isFull === true) return m.support_failed_phone_full(dates);
    if (item.isFull === null) return m.support_failed_phone_size_unknown(dates);
    return m.support_failed_phone_part(dates);
  }

  function chargeHref(chargeId: string): string {
    return `/admin/refunds/${encodeURIComponent(chargeId)}`;
  }
</script>

{#snippet buyer(item: FailedRefundItem)}
  <span class="cell-line">
    <span class="cell-title">{item.buyer?.name ?? m.support_unknown_buyer()}</span>
    {#if item.buyer?.deleted}<Badge>{m.support_deleted()}</Badge>{/if}
  </span>
{/snippet}

{#snippet actions(item: FailedRefundItem)}
  {@const blockedBy = repayBlockReason(item.refundId)}
  <Button variant="secondary" size="sm" onclick={() => onSettle(item, 'refunded_elsewhere')}>
    {m.support_action_elsewhere()}
  </Button>
  <Button
    variant="secondary"
    size="sm"
    disabled={blockedBy !== null}
    data-repay-blocked={blockedBy ?? undefined}
    onclick={() => onSettle(item, 'creators_repaid')}
  >
    {m.support_action_repay()}
  </Button>
  {#if blockedBy}
    <span class="action-note" data-testid="repay-off">
      {blockedBy === 'chargeback'
        ? m.support_repay_off_chargeback()
        : blockedBy === 'needs_person'
          ? m.support_repay_off_needs_person()
          : m.support_repay_off_later_refunds()}
    </span>
  {/if}
{/snippet}

<div class="queue-table">
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>{m.support_col_failed()}</Table.Head>
        <Table.Head>{m.support_col_buyer_charge()}</Table.Head>
        <Table.Head class="support-right">{m.support_col_refund()}</Table.Head>
        <Table.Head>{m.support_col_why_failed()}</Table.Head>
        <Table.Head class="support-right">{m.support_col_taken_from_payees()}</Table.Head>
        <Table.Head class="support-right">{m.support_col_actions()}</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each items as item (item.refundId)}
        <Table.Row data-testid="failed-refund-row">
          <Table.Cell class="support-muted support-num">{formatDay(item.failedAt)}</Table.Cell>
          <Table.Cell>
            <span class="cell-stack">
              {@render buyer(item)}
              <a class="row-link cell-sub" href={chargeHref(item.chargeId)}>{chargeLabel(item)}</a>
            </span>
          </Table.Cell>
          <Table.Cell class="support-right">
            <span class="cell-stack cell-stack--end">
              <span class="cell-title num">{formatPrice(item.amountCents)}</span>
              <span class="cell-sub">{madeLine(item)}</span>
            </span>
          </Table.Cell>
          <Table.Cell>
            <span class="cell-stack">
              <span>{item.failureLabel}</span>
              {#if item.failureReason}<span class="cell-sub mono">{item.failureReason}</span>{/if}
            </span>
          </Table.Cell>
          <Table.Cell class="support-amount">{formatPrice(item.takenFromPayeesCents)}</Table.Cell>
          <Table.Cell class="support-right">
            <span class="table-actions" data-row-actions>{@render actions(item)}</span>
          </Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
</div>

<ul class="row-list">
  {#each items as item (item.refundId)}
    <li class="row-item">
      <div class="row-item__line">
        {@render buyer(item)}
        <span class="row-item__amount">{formatPrice(item.amountCents)}</span>
      </div>
      <a class="row-link cell-sub" href={chargeHref(item.chargeId)}>{chargeLabel(item)}</a>
      <span class="cell-sub">
        {phoneLine(item)}
      </span>
      <span class="text-sm">{item.failureLabel}</span>
      <span class="cell-sub">
        {m.support_failed_taken_line({ amount: formatPrice(item.takenFromPayeesCents) })}
      </span>
      <div class="row-item__actions" data-row-actions>{@render actions(item)}</div>
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

  .cell-stack--end {
    align-items: flex-end;
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

  .cell-sub {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .text-sm {
    font-size: var(--text-sm);
  }

  .num {
    font-variant-numeric: tabular-nums;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .row-link {
    text-decoration: none;
    border-bottom: var(--border-width) var(--border-style) var(--color-border-strong);
    transition: var(--transition-colors);
  }

  .row-link:hover {
    color: var(--color-text);
    border-bottom-color: var(--color-text);
  }

  .row-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .table-actions {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  /* Its own line, under the buttons. */
  .action-note {
    flex-basis: 100%;
    max-width: var(--control-width-md);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .table-actions .action-note {
    margin-left: auto;
    text-align: right;
  }

  .queue-table :global(.table-cell) {
    vertical-align: top;
  }

  /* Short labels: a wrapped "Taken from / payees" reads as two columns. */
  .queue-table :global(.table-head) {
    white-space: nowrap;
  }

  .queue-table :global(.support-right) {
    text-align: right;
  }

  .queue-table :global(.support-amount) {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-medium);
    white-space: nowrap;
  }

  .queue-table :global(.support-muted) {
    color: var(--color-text-secondary);
  }

  .queue-table :global(.support-num) {
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

  .row-item__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  @media (--below-sm) {
    .queue-table {
      display: none;
    }

    .row-list {
      display: flex;
    }
  }
</style>

<!--
  @component ChargebacksCard

  The charge's disputes, at their current status (Codex-2hxff.28, mockup B4).
  An inquiry (the bank asking, no money taken) is listed too; it doesn't
  block a refund, and the form says so.

  @prop {ChargebackRow[]} chargebacks
-->
<script lang="ts">
  import type { ChargebackRow } from '@codex/admin';
  import * as m from '$paraglide/messages';
  import { Badge } from '$lib/components/ui';
  import * as Card from '$lib/components/ui/Card';
  import * as Table from '$lib/components/ui/Table';
  import { formatPrice } from '$lib/utils/format';
  import { disputeStatus, formatDay, formatShortDay, humanise } from './support-format';

  interface Props {
    chargebacks: ChargebackRow[];
  }

  const { chargebacks }: Props = $props();

  function reasonOf(row: ChargebackRow): string {
    return row.reason ? humanise(row.reason) : m.support_reason_none();
  }
</script>

{#snippet status(row: ChargebackRow)}
  {@const badge = disputeStatus(row.status)}
  <Badge variant={badge.variant}>{badge.label}</Badge>
  {#if row.respondBy}
    <span class="cell-sub">{m.support_respond_by({ date: formatShortDay(row.respondBy) })}</span>
  {/if}
{/snippet}

<Card.Root>
  <Card.Header>
    <Card.Title level={2}>{m.support_chargebacks_title()}</Card.Title>
    {#if chargebacks.length === 0}
      <Card.Description>{m.support_chargebacks_none()}</Card.Description>
    {/if}
  </Card.Header>
  {#if chargebacks.length > 0}
    <div class="disputes-table">
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>{m.support_col_opened()}</Table.Head>
            <Table.Head class="support-right">{m.support_col_amount()}</Table.Head>
            <Table.Head>{m.support_col_bank_reason()}</Table.Head>
            <Table.Head>{m.support_col_status()}</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each chargebacks as row (row.id)}
            <Table.Row data-testid="chargeback-row">
              <Table.Cell>
                <span class="cell-stack">
                  <span class="num">{formatDay(row.createdAt)}</span>
                  <span class="cell-sub mono">{row.id}</span>
                </span>
              </Table.Cell>
              <Table.Cell class="support-amount">{formatPrice(row.amountCents)}</Table.Cell>
              <Table.Cell>{reasonOf(row)}</Table.Cell>
              <Table.Cell><span class="cell-stack">{@render status(row)}</span></Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
    <ul class="row-list">
      {#each chargebacks as row (row.id)}
        <li class="row-item">
          <div class="row-item__line">
            <span class="row-item__title num">
              {m.support_opened_on({ date: formatDay(row.createdAt) })}
            </span>
            <span class="row-item__amount">{formatPrice(row.amountCents)}</span>
          </div>
          <div class="row-item__tags">{@render status(row)}</div>
          <span class="cell-sub">{reasonOf(row)} · <span class="mono">{row.id}</span></span>
        </li>
      {/each}
    </ul>
  {/if}
</Card.Root>

<style>
  .cell-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    align-items: flex-start;
  }

  .cell-sub {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .num {
    font-variant-numeric: tabular-nums;
  }

  .mono {
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
  }

  .disputes-table :global(.table-cell) {
    vertical-align: top;
  }

  .disputes-table :global(.support-right) {
    text-align: right;
  }

  .disputes-table :global(.support-amount) {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-medium);
    white-space: nowrap;
  }

  .row-list {
    display: none;
    flex-direction: column;
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: var(--border-width) var(--border-style) var(--color-border);
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
  }

  .row-item__title {
    font-weight: var(--font-medium);
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
    .disputes-table {
      display: none;
    }

    .row-list {
      display: flex;
    }
  }
</style>

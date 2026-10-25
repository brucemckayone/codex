<!--
  @component SplitCard

  How the charge was split, one row per slice (Codex-2hxff.28, mockup B1 and
  C1). The shares come from the charge's payout rows, which is what the
  clawback acts on, and "Taken back so far" is the server's `takenCents`:
  this card adds nothing up but the column totals. A slice with history can
  show it underneath.

  @prop {ChargeDetail} detail
-->
<script lang="ts">
  import type { ChargeDetail, Slice } from '@codex/admin';
  import { formatShareBps } from '$lib/components/studio/ownership/ownership-view';
  import * as m from '$paraglide/messages';
  import { Badge, Button } from '$lib/components/ui';
  import * as Card from '$lib/components/ui/Card';
  import * as Table from '$lib/components/ui/Table';
  import { ChevronDownIcon } from '$lib/components/ui/Icon';
  import { formatPrice } from '$lib/utils/format';
  import SliceHistory from './SliceHistory.svelte';
  import {
    formatShortDay,
    payeeCell,
    payoutReasonLabel,
    payoutStatus,
    takenHow,
  } from './support-format';

  interface Props {
    detail: ChargeDetail;
  }

  const { detail }: Props = $props();

  const amount = $derived(formatPrice(detail.charge.amountCents));
  const isInvoice = $derived(detail.source.type !== 'purchase');
  // The server's totals: the card does no money arithmetic of its own.
  const takenTotal = $derived(detail.split.takenTotalCents);

  let open = $state<Record<string, boolean>>({});

  const uid = $props.id();
  /** The table and the phone list each have their own copy of a history. */
  function historyId(slice: Slice, where: 'table' | 'list'): string {
    return `${uid}-${slice.payoutId}-${where}`;
  }

  function toggle(payoutId: string) {
    open = { ...open, [payoutId]: !open[payoutId] };
  }

  function payoutDetail(slice: Slice): string | null {
    if (slice.payoutType === 'platform_fee') return null;
    if (slice.status === 'paid' && slice.paidAt) return formatShortDay(slice.paidAt);
    return payoutReasonLabel(slice.reason);
  }

  /** The fee slice's share of this charge, from the server: the effective share, not a configured rate. */
  function platformShare(slice: Slice): string | null {
    const bps = detail.split.platformFeeShareBps;
    if (slice.payoutType !== 'platform_fee' || bps === null) return null;
    return formatShareBps(bps);
  }

  function historyTitle(slice: Slice): string {
    return m.support_history_title_plain({ name: payeeCell(slice).title });
  }
</script>

{#snippet payee(slice: Slice)}
  {@const cell = payeeCell(slice)}
  <span class="cell-stack">
    <span class="cell-line">
      <span class="cell-title">{cell.title}</span>
      {#if slice.payee?.deleted}<Badge>{m.support_deleted()}</Badge>{/if}
    </span>
    {#if cell.detail || platformShare(slice)}
      <span class="cell-sub">{cell.detail || platformShare(slice)}</span>
    {/if}
  </span>
{/snippet}

{#snippet payout(slice: Slice)}
  {@const status = payoutStatus(slice)}
  <Badge variant={status.variant}>{status.label}</Badge>
  {#if payoutDetail(slice)}
    <span class="cell-sub">
      {payoutDetail(slice)}{#if slice.status === 'paid' && slice.transferId}
        · <span class="mono">{slice.transferId}</span>{/if}
    </span>
  {/if}
{/snippet}

{#snippet historyToggle(slice: Slice, where: 'table' | 'list')}
  {#if slice.history.length > 0}
    <Button
      variant="ghost"
      size="xs"
      aria-expanded={open[slice.payoutId] === true}
      aria-controls={historyId(slice, where)}
      onclick={() => toggle(slice.payoutId)}
    >
      {open[slice.payoutId] ? m.support_history_hide() : m.support_history_show()}
      <span class="chevron" data-open={open[slice.payoutId] === true}>
        <ChevronDownIcon size={14} />
      </span>
    </Button>
  {/if}
{/snippet}

<Card.Root>
  <Card.Header>
    <Card.Title level={2}>{m.support_split_title({ amount })}</Card.Title>
    <Card.Description>
      {isInvoice ? m.support_split_desc_invoice() : m.support_split_desc_purchase()}
    </Card.Description>
  </Card.Header>
  <div class="split-table">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>{m.support_col_payee()}</Table.Head>
          <Table.Head class="support-right">{m.support_col_share()}</Table.Head>
          <Table.Head>{m.support_col_payout()}</Table.Head>
          <Table.Head class="support-right">{m.support_col_taken()}</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each detail.slices as slice (slice.payoutId)}
          <Table.Row data-testid="slice-row">
            <Table.Cell>
              {@render payee(slice)}
              {@render historyToggle(slice, 'table')}
            </Table.Cell>
            <Table.Cell class="support-amount">{formatPrice(slice.amountCents)}</Table.Cell>
            <Table.Cell><span class="cell-stack">{@render payout(slice)}</span></Table.Cell>
            <Table.Cell class="support-right">
              {#if slice.takenCents > 0}
                <span class="cell-stack cell-stack--end">
                  <span class="num">{formatPrice(slice.takenCents)}</span>
                  <span class="cell-sub">{takenHow(slice)}</span>
                </span>
              {:else}
                <span class="cell-sub">{m.support_taken_nothing()}</span>
              {/if}
              {#if slice.owedCents > 0}
                <span class="owed">{m.support_owed({ amount: formatPrice(slice.owedCents) })}</span>
              {/if}
            </Table.Cell>
          </Table.Row>
          {#if open[slice.payoutId]}
            <Table.Row class="support-expand">
              <Table.Cell colspan={4}>
                <SliceHistory
                  id={historyId(slice, 'table')}
                  title={historyTitle(slice)}
                  lines={slice.history}
                />
              </Table.Cell>
            </Table.Row>
          {/if}
        {/each}
      </Table.Body>
      <Table.Footer>
        <Table.Row>
          <Table.Cell>{m.support_total()}</Table.Cell>
          <Table.Cell class="support-amount">{amount}</Table.Cell>
          <Table.Cell></Table.Cell>
          <Table.Cell class="support-amount">{formatPrice(takenTotal)}</Table.Cell>
        </Table.Row>
      </Table.Footer>
    </Table.Root>
  </div>
  <ul class="row-list">
    {#each detail.slices as slice (slice.payoutId)}
      <li class="row-item">
        <div class="row-item__line">
          {@render payee(slice)}
          <span class="row-item__amount">{formatPrice(slice.amountCents)}</span>
        </div>
        <div class="row-item__tags">{@render payout(slice)}</div>
        <span class="cell-sub">
          {slice.takenCents > 0
            ? m.support_taken_line({ amount: formatPrice(slice.takenCents), how: takenHow(slice) })
            : m.support_taken_line_nothing()}
        </span>
        {#if slice.owedCents > 0}
          <span class="owed">{m.support_owed({ amount: formatPrice(slice.owedCents) })}</span>
        {/if}
        <div>{@render historyToggle(slice, 'list')}</div>
        {#if open[slice.payoutId]}
          <SliceHistory
            id={historyId(slice, 'list')}
            title={historyTitle(slice)}
            lines={slice.history}
          />
        {/if}
      </li>
    {/each}
  </ul>
</Card.Root>

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

  .num {
    font-variant-numeric: tabular-nums;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .owed {
    display: block;
    font-size: var(--text-xs);
    color: var(--color-status-warning-text);
    font-variant-numeric: tabular-nums;
  }

  .chevron {
    display: inline-flex;
    transition: transform var(--duration-fast) var(--ease-default);
  }

  .chevron[data-open='true'] {
    transform: rotate(180deg);
  }

  .split-table :global(.table-cell) {
    vertical-align: top;
  }

  .split-table :global(.support-right) {
    text-align: right;
  }

  .split-table :global(.support-amount) {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-medium);
    white-space: nowrap;
  }

  .split-table :global(.support-expand > td) {
    background: var(--color-surface-secondary);
    padding: var(--space-4);
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
    .split-table {
      display: none;
    }

    .row-list {
      display: flex;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .chevron {
      transition: none;
    }
  }
</style>

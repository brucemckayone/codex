<!--
  @component RefundsCard

  The charge's refunds, as Stripe lists them (Codex-2hxff.28, mockup B1/B3).

  A refund that Stripe has confirmed is not yet clawed back: the shares are
  taken when `charge.refunded` arrives. Until the webhook has recorded it (no
  slice has a history line for it, and the buyer has not been emailed) its
  row says "Taking back shares…". After support makes a refund the page
  reloads once and offers Refresh (Q10); nothing polls.

  @prop {ChargeDetail} detail
  @prop {() => void} [onRefresh] - Shows the Refresh button.
  @prop {boolean} [refreshing=false]
-->
<script lang="ts">
  import type { ChargeDetail, RefundRow } from '@codex/admin';
  import * as m from '$paraglide/messages';
  import { Badge, Button } from '$lib/components/ui';
  import * as Card from '$lib/components/ui/Card';
  import * as Table from '$lib/components/ui/Table';
  import { RefreshCwIcon } from '$lib/components/ui/Icon';
  import { formatPrice } from '$lib/utils/format';
  import {
    formatDayTime,
    formatShortDay,
    refundReasonLabel,
    refundStatus,
    requesterLabel,
  } from './support-format';

  interface Props {
    detail: ChargeDetail;
    onRefresh?: () => void;
    refreshing?: boolean;
  }

  const { detail, onRefresh, refreshing = false }: Props = $props();

  /** Refund ids the webhook has already acted on, from the slices' history. */
  const recorded = $derived(
    new Set(
      detail.slices.flatMap((slice) =>
        slice.history
          .filter((line) => line.causeType === 'refund')
          .map((line) => line.causeId)
      )
    )
  );

  function takingBack(refund: RefundRow): boolean {
    return (
      refund.status === 'succeeded' &&
      refund.notifiedAt === null &&
      !recorded.has(refund.id)
    );
  }

  function byLine(refund: RefundRow): string {
    const by = requesterLabel(refund.requestedBy);
    return refund.notifiedAt
      ? m.support_refund_by_emailed({ by, date: formatShortDay(refund.notifiedAt) })
      : m.support_refund_by_not_emailed({ by });
  }
</script>

{#snippet status(refund: RefundRow)}
  {@const badge = refundStatus(refund.status)}
  <Badge variant={badge.variant}>{badge.label}</Badge>
  {#if refund.status === 'failed' && refund.failureLabel}
    <span class="cell-sub">{refund.failureLabel}</span>
  {/if}
  {#if takingBack(refund)}
    <span class="cell-sub" data-testid="taking-back">{m.support_taking_back()}</span>
  {/if}
{/snippet}

{#snippet requester(refund: RefundRow)}
  {requesterLabel(refund.requestedBy)}
  {#if refund.requestedBy !== null && refund.requestedBy !== 'dashboard' && refund.requestedBy.deleted}
    <Badge>{m.support_deleted()}</Badge>
  {/if}
{/snippet}

<Card.Root>
  <Card.Header>
    <div class="refunds-card__head">
      <Card.Title level={2}>{m.support_refunds_card_title()}</Card.Title>
      {#if onRefresh}
        <Button
          variant="secondary"
          size="sm"
          loading={refreshing}
          onclick={onRefresh}
        >
          <RefreshCwIcon size={14} />
          {m.support_refresh()}
        </Button>
      {/if}
    </div>
    {#if detail.refunds.length === 0}
      <Card.Description>{m.support_refunds_none()}</Card.Description>
    {/if}
  </Card.Header>
  {#if detail.refunds.length > 0}
    <div class="refunds-table">
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>{m.support_col_made()}</Table.Head>
            <Table.Head class="support-right">{m.support_col_amount()}</Table.Head>
            <Table.Head>{m.support_col_reason()}</Table.Head>
            <Table.Head>{m.support_col_status()}</Table.Head>
            <Table.Head>{m.support_col_by()}</Table.Head>
            <Table.Head>{m.support_col_emailed()}</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each detail.refunds as refund (refund.id)}
            <Table.Row data-testid="refund-row" data-refund-id={refund.id}>
              <Table.Cell>
                <span class="cell-stack">
                  <span class="num">{formatDayTime(refund.createdAt)}</span>
                  <span class="cell-sub mono">{refund.id}</span>
                </span>
              </Table.Cell>
              <Table.Cell class="support-amount">{formatPrice(refund.amountCents)}</Table.Cell>
              <Table.Cell>{refundReasonLabel(refund.reason)}</Table.Cell>
              <Table.Cell><span class="cell-stack">{@render status(refund)}</span></Table.Cell>
              <Table.Cell>{@render requester(refund)}</Table.Cell>
              <Table.Cell class="support-muted">
                {refund.notifiedAt ? formatShortDay(refund.notifiedAt) : m.support_emailed_not_yet()}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
    <ul class="row-list">
      {#each detail.refunds as refund (refund.id)}
        <li class="row-item">
          <div class="row-item__line">
            <span class="row-item__title num">{formatDayTime(refund.createdAt)}</span>
            <span class="row-item__amount">{formatPrice(refund.amountCents)}</span>
          </div>
          <div class="row-item__tags">
            {@render status(refund)}
            <span class="cell-sub">{refundReasonLabel(refund.reason)}</span>
          </div>
          <span class="cell-sub">{byLine(refund)} · <span class="mono">{refund.id}</span></span>
        </li>
      {/each}
    </ul>
  {/if}
</Card.Root>

<style>
  .refunds-card__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .cell-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    align-items: flex-start;
    min-width: 0;
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

  .refunds-table :global(.table-cell) {
    vertical-align: top;
  }

  .refunds-table :global(.support-right) {
    text-align: right;
  }

  .refunds-table :global(.support-amount) {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-medium);
    white-space: nowrap;
  }

  .refunds-table :global(.support-muted) {
    color: var(--color-text-secondary);
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
    min-width: 0;
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
    .refunds-table {
      display: none;
    }

    .row-list {
      display: flex;
    }
  }
</style>

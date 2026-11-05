<!--
  @component PriceMovesTable

  Queue › Price moves: one row per held subscriber per price change, oldest
  first (Codex-2hxff.85 M1; batch C1 Part B page 6, M1-M6). Who, which
  organisation and plan, the price they'd move to, why it's held in plain
  words, and what was tried. Held people stay on their old price: nothing
  here moves anyone without an accepted email.

  Two actions, by kind (the server's `action`): Retry when no email was
  accepted, so the run emails them again; Retry the move when the email
  went and Stripe refused, so the run asks Stripe again and sends no second
  email (owner decision Q5). Close… takes a row off without a retry. A row
  Retry queued shows "Queued for 11:00" until the run takes it (M2). A row
  the run held again after a retry suggests Close… first (M4). A member with
  an open chargeback waits for it to end (owner D1), and the row says so in
  place of a time that keeps moving (Codex-2hxff.70 D1-a).

  @prop {HeldPriceMove[]} items
  @prop {(item: HeldPriceMove) => void} onRetry
  @prop {(item: HeldPriceMove) => void} onClose
  @prop {string | null} [busyId] - The move whose Retry is running.
-->
<script lang="ts">
  import type { HeldPriceMove } from '@codex/admin';
  import * as m from '$paraglide/messages';
  import { Badge, Button } from '$lib/components/ui';
  import { ClockIcon } from '$lib/components/ui/Icon';
  import * as Table from '$lib/components/ui/Table';
  import {
    closeComesFirst,
    moveAddress,
    moveAmounts,
    disputeWaitLine,
    movePlace,
    queuedLine,
    whyHeld,
  } from './price-moves-view';
  import { formatDay, formatShortDay, personName } from './support-format';

  interface Props {
    items: HeldPriceMove[];
    onRetry: (item: HeldPriceMove) => void;
    onClose: (item: HeldPriceMove) => void;
    busyId?: string | null;
  }

  const { items, onRetry, onClose, busyId = null }: Props = $props();
</script>

{#snippet why(item: HeldPriceMove)}
  {@const said = whyHeld(item)}
  <span>{said.text}</span>
  <span class="cell-sub">
    {said.sub}{#if said.mono}{said.sub ? ' ' : ''}<span class="mono">{said.mono}</span>{/if}
  </span>
{/snippet}

{#snippet actions(item: HeldPriceMove)}
  {@const queued = queuedLine(item)}
  {@const waits = disputeWaitLine(item)}
  {@const busy = busyId === item.moveId}
  {@const closeFirst = closeComesFirst(item)}
  {#if queued}
    <span class="row-queued" data-testid="price-move-queued">
      <ClockIcon size={14} aria-hidden="true" />{queued}
    </span>
  {:else}
    {#if waits}
      <span class="row-queued" data-testid="price-move-waits-dispute">
        <ClockIcon size={14} aria-hidden="true" />{waits}
      </span>
    {/if}
    {#if item.action && !closeFirst}
      <Button
        variant="secondary"
        size="sm"
        loading={busy}
        disabled={busyId !== null && !busy}
        onclick={() => onRetry(item)}
        data-testid="price-move-retry"
      >
        {item.action === 'retry_move'
          ? m.support_queue_moves_action_retry_move()
          : m.support_queue_moves_action_retry()}
      </Button>
    {/if}
    <Button
      variant={item.action && !closeFirst ? 'ghost' : 'secondary'}
      size="sm"
      disabled={busyId !== null}
      onclick={() => onClose(item)}
      data-testid="price-move-close"
    >
      {m.support_queue_moves_action_close()}
    </Button>
    {#if item.action && closeFirst}
      <Button
        variant="ghost"
        size="sm"
        loading={busy}
        disabled={busyId !== null && !busy}
        onclick={() => onRetry(item)}
        data-testid="price-move-retry"
      >
        {m.support_queue_moves_action_retry()}
      </Button>
    {/if}
  {/if}
{/snippet}

<div class="queue-table">
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>{m.support_queue_moves_col_since()}</Table.Head>
        <Table.Head>{m.support_queue_moves_col_subscriber()}</Table.Head>
        <Table.Head>{m.support_queue_moves_col_move()}</Table.Head>
        <Table.Head>{m.support_queue_moves_col_why()}</Table.Head>
        <Table.Head class="support-right">{m.support_col_actions()}</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each items as item (item.moveId)}
        <Table.Row data-testid="price-move-row" data-status={item.status} data-action={item.action}>
          <Table.Cell class="support-muted support-num">{formatDay(item.createdAt)}</Table.Cell>
          <Table.Cell>
            <span class="cell-stack">
              <span class="cell-line">
                <span class="cell-title">{personName(item.subscriber)}</span>
                {#if item.subscriber.deleted}<Badge>{m.support_deleted()}</Badge>{/if}
              </span>
              <span class="cell-sub">{moveAddress(item)}</span>
            </span>
          </Table.Cell>
          <Table.Cell>
            <span class="cell-stack">
              <span>{movePlace(item)}</span>
              <span class="cell-sub">{moveAmounts(item.fromAmountCents, item.newAmountCents)}</span>
            </span>
          </Table.Cell>
          <Table.Cell><span class="cell-stack">{@render why(item)}</span></Table.Cell>
          <Table.Cell class="support-right">
            <span class="table-actions" data-row-actions>{@render actions(item)}</span>
          </Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
</div>

<ul class="row-list">
  {#each items as item (item.moveId)}
    <li class="row-item">
      <div class="row-item__line">
        <span class="cell-title">{personName(item.subscriber)}</span>
        <span class="row-item__amount">{moveAmounts(item.fromAmountCents, item.newAmountCents)}</span>
      </div>
      <span class="cell-sub">
        {m.support_queue_moves_held_since_line({
          place: movePlace(item),
          date: formatShortDay(item.createdAt),
        })}
      </span>
      <span class="cell-stack">{@render why(item)}</span>
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
    font-size: var(--text-sm);
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
    font-weight: var(--font-normal);
    color: var(--color-text-secondary);
  }

  .mono {
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
  }

  /* A row waiting for the next run instead of offering actions: the row's
     buttons' size, in the muted text colour, with a clock and its words. */
  .row-queued {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .table-actions {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .queue-table :global(.table-cell) {
    vertical-align: top;
  }

  .queue-table :global(.table-head) {
    white-space: nowrap;
  }

  .queue-table :global(.support-right) {
    text-align: right;
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

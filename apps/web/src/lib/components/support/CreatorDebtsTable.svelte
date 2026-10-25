<!--
  @component CreatorDebtsTable

  Creator debts waiting for a person, oldest first (Codex-2hxff.28, mockup
  D2): a refund or chargeback that couldn't take a payee's share back. The
  buyer has their money; the platform paid it. A row can open the slice's
  history, which the server has already read (data design §2's rule).

  "Creator debts" is the tab's name, but an organisation owner can owe one
  too, so the column says "Who owes".

  @prop {CreatorDebtItem[]} items
  @prop {(item: CreatorDebtItem) => void} onSettle
-->
<script lang="ts">
  import type { CreatorDebtItem } from '@codex/admin';
  import { DISPUTE_CLOSED_STATUSES } from '@codex/constants';
  import * as m from '$paraglide/messages';
  import { Badge, Button } from '$lib/components/ui';
  import * as Table from '$lib/components/ui/Table';
  import { ChevronDownIcon } from '$lib/components/ui/Icon';
  import { formatPrice } from '$lib/utils/format';
  import SliceHistory from './SliceHistory.svelte';
  import { chargebackWord, formatDay } from './support-format';

  interface Props {
    items: CreatorDebtItem[];
    onSettle: (item: CreatorDebtItem) => void;
  }

  const { items, onSettle }: Props = $props();

  let open = $state<Record<string, boolean>>({});

  function toggle(reviewId: string) {
    open = { ...open, [reviewId]: !open[reviewId] };
  }

  function payeeLabel(item: CreatorDebtItem): string {
    return item.payee.name || m.support_debt_unnamed();
  }

  function roleLabel(item: CreatorDebtItem): string {
    return item.payee.role === 'organisation_owner'
      ? m.support_role_owner()
      : m.support_role_creator();
  }

  function fromLine(item: CreatorDebtItem): string {
    const buyer = item.buyerName ?? m.support_unknown_buyer();
    const cause = item.cause;
    if (cause?.type === 'dispute') {
      const status = cause.disputeStatus ? chargebackWord(cause.disputeStatus) : '';
      return m.support_debt_from_chargeback({ buyer, status });
    }
    if (cause?.amountCents != null) {
      return m.support_debt_from_refund({ buyer, amount: formatPrice(cause.amountCents) });
    }
    return m.support_debt_from_refund_plain({ buyer });
  }

  /** A chargeback still open: winning it closes the debt by itself (Q7). */
  function closesIfWon(item: CreatorDebtItem): boolean {
    return (
      item.cause?.type === 'dispute' &&
      !(DISPUTE_CLOSED_STATUSES as readonly string[]).includes(
        item.cause.disputeStatus ?? 'won'
      )
    );
  }

  function historyTitle(item: CreatorDebtItem): string {
    const name = payeeLabel(item);
    return item.title
      ? m.support_history_title({ name, title: item.title })
      : m.support_history_title_plain({ name });
  }

  function chargeHref(chargeId: string): string {
    return `/admin/refunds/${encodeURIComponent(chargeId)}`;
  }
</script>

{#snippet from(item: CreatorDebtItem, withBuyer: boolean)}
  {#if item.chargeId}
    <a class="row-link" href={chargeHref(item.chargeId)}>{item.title ?? m.support_unknown_item()}</a>
  {:else}
    <span>{item.title ?? m.support_unknown_item()}</span>
  {/if}
  {#if withBuyer}<span class="cell-sub">{fromLine(item)}</span>{/if}
{/snippet}

{#snippet why(item: CreatorDebtItem)}
  <span>{item.errorLabel}</span>
  <span class="cell-sub mono">{item.errorCode}</span>
  {#if closesIfWon(item)}
    <span class="cell-sub">{m.support_debt_closes_if_won()}</span>
  {/if}
{/snippet}

{#snippet historyToggle(item: CreatorDebtItem)}
  {#if item.history.length > 0}
    <Button
      variant="ghost"
      size="sm"
      aria-expanded={open[item.reviewId] === true}
      onclick={() => toggle(item.reviewId)}
    >
      {open[item.reviewId] ? m.support_history_hide() : m.support_history_show()}
      <span class="chevron" data-open={open[item.reviewId] === true}>
        <ChevronDownIcon size={14} />
      </span>
    </Button>
  {/if}
{/snippet}

{#snippet history(item: CreatorDebtItem)}
  <SliceHistory
    title={historyTitle(item)}
    lines={item.history}
    debtCause={item.cause ? { type: item.cause.type, id: item.cause.id } : null}
  />
{/snippet}

<div class="queue-table">
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>{m.support_col_recorded()}</Table.Head>
        <Table.Head>{m.support_col_who_owes()}</Table.Head>
        <Table.Head class="support-right">{m.support_col_owes()}</Table.Head>
        <Table.Head>{m.support_col_from()}</Table.Head>
        <Table.Head>{m.support_col_why()}</Table.Head>
        <Table.Head class="support-right">{m.support_col_actions()}</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each items as item (item.reviewId)}
        <Table.Row data-testid="creator-debt-row">
          <Table.Cell class="support-muted support-num">{formatDay(item.createdAt)}</Table.Cell>
          <Table.Cell>
            <span class="cell-stack">
              <span class="cell-line">
                <span class="cell-title">{payeeLabel(item)}</span>
                {#if item.payee.deleted}<Badge>{m.support_deleted()}</Badge>{/if}
              </span>
              <span class="cell-sub">{roleLabel(item)}</span>
            </span>
          </Table.Cell>
          <Table.Cell class="support-amount">{formatPrice(item.owedCents)}</Table.Cell>
          <Table.Cell><span class="cell-stack">{@render from(item, true)}</span></Table.Cell>
          <Table.Cell><span class="cell-stack">{@render why(item)}</span></Table.Cell>
          <Table.Cell class="support-right">
            <span class="table-actions">
              {@render historyToggle(item)}
              <Button variant="secondary" size="sm" onclick={() => onSettle(item)}>
                {m.support_action_settle()}
              </Button>
            </span>
          </Table.Cell>
        </Table.Row>
        {#if open[item.reviewId]}
          <Table.Row class="support-expand">
            <Table.Cell colspan={6}>{@render history(item)}</Table.Cell>
          </Table.Row>
        {/if}
      {/each}
    </Table.Body>
  </Table.Root>
</div>

<ul class="row-list">
  {#each items as item (item.reviewId)}
    <li class="row-item">
      <div class="row-item__line">
        <span class="cell-title">{m.support_debt_owes({ name: payeeLabel(item) })}</span>
        <span class="row-item__amount">{formatPrice(item.owedCents)}</span>
      </div>
      <span class="cell-sub">{@render from(item, false)} · {fromLine(item)}</span>
      <span class="cell-stack">{@render why(item)}</span>
      {#if open[item.reviewId]}{@render history(item)}{/if}
      <div class="row-item__actions">
        {@render historyToggle(item)}
        <Button variant="secondary" size="sm" onclick={() => onSettle(item)}>
          {m.support_action_settle()}
        </Button>
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
    color: var(--color-text-secondary);
  }

  .mono {
    font-family: var(--font-mono);
  }

  .row-link {
    color: var(--color-text);
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

  .table-actions {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .chevron {
    display: inline-flex;
    transition: transform var(--duration-fast) var(--ease-default);
  }

  .chevron[data-open='true'] {
    transform: rotate(180deg);
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

  .queue-table :global(.support-expand > td) {
    background: var(--color-surface-secondary);
    padding: var(--space-4);
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

  @media (prefers-reduced-motion: reduce) {
    .chevron {
      transition: none;
    }
  }
</style>

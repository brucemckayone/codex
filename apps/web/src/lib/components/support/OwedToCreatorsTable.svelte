<!--
  @component OwedToCreatorsTable

  Owed to creators, oldest first (Codex-2hxff.72/.73, mock-b-support O1;
  owner decisions Q8-Q11): a take-back reached Stripe after its share was
  settled, so the payee lost money they were meant to keep. Every late case
  has a row (Q10), including a take-back Stripe couldn't be asked about.

  One main action per row, the server's (`action`): Re-pay £X, Count against
  this debt, or Check Stripe again. A row the ledger can't attribute
  (`needs_person`) offers Re-pay and Not owed, both asking for a note. A row
  only a person can settle by hand has no main action.
  Not owed is on every row, and is the quiet one. While a row's check runs,
  its button shows the spinner and its other button is off.

  @prop {OwedToCreatorItem[]} items
  @prop {(item: OwedToCreatorItem, action: OwedToCreatorAction) => void} onResolve
  @prop {(item: OwedToCreatorItem) => void} onCheck
  @prop {string | null} [checkingId] - The credit whose check is running.
-->
<script lang="ts">
  import type { OwedToCreatorAction, OwedToCreatorItem } from '@codex/admin';
  import * as m from '$paraglide/messages';
  import { Badge, Button } from '$lib/components/ui';
  import * as Table from '$lib/components/ui/Table';
  import { formatPrice } from '$lib/utils/format';
  import {
    owedAmountCents,
    owedAmountNote,
    owedFrom,
    owedMainAction,
    owedPayeeName,
    owedRole,
    owedWhat,
  } from './owed-view';
  import { formatDay } from './support-format';

  interface Props {
    items: OwedToCreatorItem[];
    onResolve: (item: OwedToCreatorItem, action: OwedToCreatorAction) => void;
    onCheck: (item: OwedToCreatorItem) => void;
    checkingId?: string | null;
  }

  const { items, onResolve, onCheck, checkingId = null }: Props = $props();

  function chargeHref(chargeId: string): string {
    return `/admin/refunds/${encodeURIComponent(chargeId)}`;
  }

  function act(item: OwedToCreatorItem) {
    const main = owedMainAction(item);
    if (!main) return;
    if (main.kind === 'check') onCheck(item);
    else onResolve(item, main.kind);
  }
</script>

{#snippet itemTitle(item: OwedToCreatorItem)}
  {#if item.chargeId}
    <a class="row-link" href={chargeHref(item.chargeId)}>{item.title ?? m.support_unknown_item()}</a>
  {:else}
    <span>{item.title ?? m.support_unknown_item()}</span>
  {/if}
{/snippet}

{#snippet what(item: OwedToCreatorItem)}
  {@const said = owedWhat(item)}
  <span>{said.text}</span>
  {#each said.subs as sub (sub.text)}
    <span class="cell-sub" class:mono={sub.mono}>{sub.text}</span>
  {/each}
{/snippet}

{#snippet actions(item: OwedToCreatorItem)}
  {@const main = owedMainAction(item)}
  {@const checking = checkingId === item.creditId}
  {#if main}
    <Button
      variant="secondary"
      size="sm"
      loading={checking}
      disabled={checkingId !== null && !checking}
      onclick={() => act(item)}
      data-testid="owed-main-action"
    >
      {main.label}
    </Button>
  {/if}
  <Button
    variant="ghost"
    size="sm"
    disabled={checkingId !== null}
    onclick={() => onResolve(item, 'not_owed')}
  >
    {m.support_owed_action_not_owed()}
  </Button>
{/snippet}

<div class="queue-table">
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>{m.support_col_found()}</Table.Head>
        <Table.Head>{m.support_col_who_is_owed()}</Table.Head>
        <Table.Head class="support-right">{m.support_col_owed()}</Table.Head>
        <Table.Head>{m.support_col_from()}</Table.Head>
        <Table.Head>{m.support_col_what_happened()}</Table.Head>
        <Table.Head class="support-right">{m.support_col_actions()}</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each items as item (item.creditId)}
        <Table.Row data-testid="owed-row" data-action={item.action}>
          <Table.Cell class="support-muted support-num">{formatDay(item.foundAt)}</Table.Cell>
          <Table.Cell>
            <span class="cell-stack">
              <span class="cell-line">
                <span class="cell-title">{owedPayeeName(item)}</span>
                {#if item.payee?.deleted}<Badge>{m.support_deleted()}</Badge>{/if}
              </span>
              {#if owedRole(item)}<span class="cell-sub">{owedRole(item)}</span>{/if}
            </span>
          </Table.Cell>
          <Table.Cell class="support-amount">
            <span class="cell-stack cell-stack--end">
              <span>{formatPrice(owedAmountCents(item))}</span>
              {#if owedAmountNote(item, 'table')}
                <span class="cell-sub">{owedAmountNote(item, 'table')}</span>
              {/if}
            </span>
          </Table.Cell>
          <Table.Cell>
            <span class="cell-stack">
              {@render itemTitle(item)}
              <span class="cell-sub">{owedFrom(item)}</span>
            </span>
          </Table.Cell>
          <Table.Cell><span class="cell-stack">{@render what(item)}</span></Table.Cell>
          <Table.Cell class="support-right">
            <span class="table-actions" data-row-actions>{@render actions(item)}</span>
          </Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
</div>

<ul class="row-list">
  {#each items as item (item.creditId)}
    <li class="row-item">
      <div class="row-item__line">
        <span class="cell-title">{m.support_owed_is_owed({ name: owedPayeeName(item) })}</span>
        <span class="row-item__amount">
          {owedAmountNote(item, 'phone') ?? formatPrice(owedAmountCents(item))}
        </span>
      </div>
      <span class="cell-sub">
        {owedRole(item)
          ? m.support_owed_found_line({ role: owedRole(item) ?? '', date: formatDay(item.foundAt) })
          : m.support_owed_found_line_plain({ date: formatDay(item.foundAt) })}
      </span>
      <span class="cell-sub">{@render itemTitle(item)} · {owedFrom(item)}</span>
      <span class="cell-stack">{@render what(item)}</span>
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
    font-weight: var(--font-normal);
    color: var(--color-text-secondary);
  }

  .mono {
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
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

  .queue-table :global(.table-cell) {
    vertical-align: top;
  }

  /* Short labels: a wrapped "Who is / owed" reads as two columns. */
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

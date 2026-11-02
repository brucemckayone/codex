<!--
  @component FeeNoticesTable

  Queue › Fee notices: one row per person a fee rise's email hasn't reached,
  oldest first (Codex-2hxff.33 F4; batch C1 Part B page 5, F1-F7). "What
  happened" says it plainly and says what the daily run does next, so
  support acts only when a person can help: a refused email is tried again
  each morning; one that may have gone is looked for in our email log
  before anything is resent, so nobody gets two.

  A joiner (F8) is tagged "Joined later": they are told the same date and
  don't hold it, but still need telling (owner decision Q4).

  @prop {FeeNoticeItem[]} items
  @prop {FeeChangeCard[]} cards - The rises, to name each row's change.
  @prop {(item: FeeNoticeItem) => void} onMark - "Told another way".
-->
<script lang="ts">
  import type { FeeChangeCard, FeeNoticeItem } from '@codex/admin';
  import * as m from '$paraglide/messages';
  import { Badge, Button } from '$lib/components/ui';
  import * as Table from '$lib/components/ui/Table';
  import {
    noticeNext,
    noticeRise,
    noticeRoles,
    noticeWhat,
  } from './fee-notices-view';
  import { formatDay, formatShortDay, personName } from './support-format';

  interface Props {
    items: FeeNoticeItem[];
    cards: FeeChangeCard[];
    onMark: (item: FeeNoticeItem) => void;
  }

  const { items, cards, onMark }: Props = $props();

  const cardOf = (item: FeeNoticeItem) =>
    cards.find((card) => card.changeId === item.changeId);
</script>

{#snippet joinedTag(item: FeeNoticeItem)}
  {#if !item.onList}
    <span class="row-tag" data-testid="fee-notice-joined">{m.support_queue_fees_joined_later()}</span>
  {/if}
{/snippet}

{#snippet mark(item: FeeNoticeItem)}
  <Button variant="secondary" size="sm" onclick={() => onMark(item)} data-testid="fee-notice-mark">
    {m.support_queue_fees_action_mark()}
  </Button>
{/snippet}

<div class="queue-table">
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>{m.support_queue_fees_col_since()}</Table.Head>
        <Table.Head>{m.support_queue_fees_col_who()}</Table.Head>
        <Table.Head>{m.support_queue_fees_col_rise()}</Table.Head>
        <Table.Head>{m.support_col_what_happened()}</Table.Head>
        <Table.Head class="support-right">{m.support_col_actions()}</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each items as item (item.noticeId)}
        {@const rise = noticeRise(item, cardOf(item))}
        <Table.Row data-testid="fee-notice-row" data-state={item.state}>
          <Table.Cell class="support-muted support-num">{formatDay(item.waitingSince)}</Table.Cell>
          <Table.Cell>
            <span class="cell-stack">
              <span class="cell-line">
                <span class="cell-title">{personName(item.person)}</span>
                {#if item.person.deleted}<Badge>{m.support_deleted()}</Badge>{/if}
                {@render joinedTag(item)}
              </span>
              <span class="cell-sub">{noticeRoles(item)}</span>
            </span>
          </Table.Cell>
          <Table.Cell>
            <span class="cell-stack">
              <span>{rise.text}</span>
              <span class="cell-sub">{rise.sub}</span>
            </span>
          </Table.Cell>
          <Table.Cell>
            <span class="cell-stack">
              <span>{noticeWhat(item)}</span>
              <span class="cell-sub">{noticeNext(item, 'table')}</span>
            </span>
          </Table.Cell>
          <Table.Cell class="support-right">
            <span class="table-actions" data-row-actions>{@render mark(item)}</span>
          </Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
</div>

<ul class="row-list">
  {#each items as item (item.noticeId)}
    {@const rise = noticeRise(item, cardOf(item))}
    <li class="row-item">
      <div class="row-item__line">
        <span class="cell-title">{personName(item.person)}{@render joinedTag(item)}</span>
      </div>
      <span class="cell-sub">
        {m.support_queue_fees_waiting_since_line({
          roles: noticeRoles(item),
          date: formatShortDay(item.waitingSince),
        })}
      </span>
      <span class="cell-sub">
        {item.changeEffectiveFrom ? `${rise.text} · ${rise.sub}` : rise.text}
      </span>
      <span class="cell-stack">
        <span>{noticeWhat(item)}</span>
        <span class="cell-sub">{noticeNext(item, 'phone')}</span>
      </span>
      <div class="row-item__actions" data-row-actions>{@render mark(item)}</div>
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

  /* A joiner who doesn't hold the date: the Badge's shape, neutral and
     outlined, with its words, so the tag never rests on colour. */
  .row-tag {
    display: inline-block;
    margin-left: var(--space-1);
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) var(--color-border);
    font-size: var(--text-xs);
    font-weight: var(--font-normal);
    color: var(--color-text-secondary);
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

<!--
  @component CreatorDebtsTable

  Creator debts, one row per person, oldest first (Codex-2hxff.30, .73;
  mock-b-support D1-D2; owner decisions Q2, Q4, Q7). What each person owes
  across every organisation: most of it Stripe holds as their negative
  balance, and takes back from their next earnings by itself; a debt Stripe
  refused is the platform's, and waits for support to settle it.

  A debt over £50 that Stripe collected from the platform (AMENDMENT 2) is
  still the person's to pay: it reads "To invoice", with when and how much
  Stripe collected, until invoices ship.

  A row opens the person's debts; each debt opens the slice's history, which
  the server has already read. Settle is only on a debt the platform holds:
  a Stripe-held debt has nothing to settle. The totals, the state and the Q4
  clock are the server's; a balance Stripe couldn't be read for says so and
  never reads £0.00.

  "Creator debts" is the tab's name, but an organisation owner can owe one
  too, so the column says "Who owes".

  @prop {CreatorDebtPerson[]} items
  @prop {(debt: CreatorDebtItem) => void} onSettle
-->
<script lang="ts">
  import type { CreatorDebtItem, CreatorDebtPerson, StripeHeldTakeBack } from '@codex/admin';
  import * as m from '$paraglide/messages';
  import { Badge, Button } from '$lib/components/ui';
  import * as Table from '$lib/components/ui/Table';
  import { ChevronDownIcon } from '$lib/components/ui/Icon';
  import { formatPrice } from '$lib/utils/format';
  import SliceHistory from './SliceHistory.svelte';
  import {
    backText,
    balanceCell,
    clockLines,
    debtCauseLine,
    debtorName,
    owesSub,
    personRoles,
    phoneBalanceLine,
    standsBadge,
  } from './creator-debts-view';
  import { formatDay, formatShortDay } from './support-format';

  interface Props {
    items: CreatorDebtPerson[];
    onSettle: (debt: CreatorDebtItem) => void;
  }

  const { items, onSettle }: Props = $props();

  /** Open people, by user id; open histories, by debt. */
  let openPeople = $state<Record<string, boolean>>({});
  let openHistory = $state<Record<string, boolean>>({});

  const uid = $props.id();
  /** The table and the phone list each have their own copy. */
  function debtsId(person: CreatorDebtPerson, where: 'table' | 'list'): string {
    return `${uid}-${person.payee.userId}-${where}`;
  }
  function historyId(key: string, where: 'table' | 'list'): string {
    return `${uid}-${key}-${where}-history`;
  }

  function togglePerson(userId: string) {
    openPeople = { ...openPeople, [userId]: !openPeople[userId] };
  }
  function toggleHistory(key: string) {
    openHistory = { ...openHistory, [key]: !openHistory[key] };
  }

  function chargeHref(chargeId: string): string {
    return `/admin/refunds/${encodeURIComponent(chargeId)}`;
  }

  function heldWhat(person: CreatorDebtPerson, held: StripeHeldTakeBack): string {
    const args = {
      date: formatShortDay(held.takenAt),
      amount: formatPrice(held.amountCents),
      name: debtorName(person),
    };
    return held.cause.type === 'dispute'
      ? m.support_debts_held_what_dispute(args)
      : m.support_debts_held_what_refund(args);
  }

  function historyTitle(person: CreatorDebtPerson, title: string | null): string {
    const name = debtorName(person);
    return title
      ? m.support_history_title({ name, title })
      : m.support_history_title_plain({ name });
  }
</script>

{#snippet itemTitle(chargeId: string | null, title: string | null)}
  {#if chargeId}
    <a class="debt-link" href={chargeHref(chargeId)}>{title ?? m.support_unknown_item()}</a>
  {:else}
    <span>{title ?? m.support_unknown_item()}</span>
  {/if}
{/snippet}

{#snippet historyToggle(key: string, hasHistory: boolean, where: 'table' | 'list')}
  {#if hasHistory}
    <Button
      variant="ghost"
      size="xs"
      aria-expanded={openHistory[key] === true}
      aria-controls={historyId(key, where)}
      onclick={() => toggleHistory(key)}
    >
      {openHistory[key] ? m.support_history_hide() : m.support_history_show()}
      <span class="chevron" data-open={openHistory[key] === true}>
        <ChevronDownIcon size={14} />
      </span>
    </Button>
  {/if}
{/snippet}

{#snippet debts(person: CreatorDebtPerson, where: 'table' | 'list')}
  <div class="person-debts" id={debtsId(person, where)}>
    <p class="person-debts__title">{m.support_debts_person_title({ name: debtorName(person) })}</p>
    <ul class="person-debts__list">
      {#each person.stripeHeld as held (held.payoutReversalId)}
        <li data-testid="debt-line" data-held="stripe">
          <span class="person-debts__cause">
            {@render itemTitle(held.chargeId, held.title)} · {debtCauseLine(held.organizationName, held.buyerName, held.cause)}
          </span>
          <span class="person-debts__amount">{formatPrice(held.amountCents)}</span>
          <span class="person-debts__what">{heldWhat(person, held)}</span>
          <span class="person-debts__tags">
            <Badge variant="warning">{m.support_debts_held_stripe()}</Badge>
            <span class="mono">{held.stripeReversalId ?? held.cause.id}</span>
            {@render historyToggle(held.payoutReversalId, held.history.length > 0, where)}
          </span>
          {#if openHistory[held.payoutReversalId]}
            <div class="person-debts__nested">
              <SliceHistory
                id={historyId(held.payoutReversalId, where)}
                title={historyTitle(person, held.title)}
                lines={held.history}
                payeeName={debtorName(person)}
              />
            </div>
          {/if}
        </li>
      {/each}
      {#each person.recordedDebts as debt (debt.reviewId)}
        <li data-testid="debt-line" data-held="platform">
          <span class="person-debts__cause">
            {@render itemTitle(debt.chargeId, debt.title)} · {debtCauseLine(debt.organizationName, debt.buyerName, debt.cause)}
          </span>
          <span class="person-debts__amount">{formatPrice(debt.owedCents)}</span>
          <span class="person-debts__what">
            {m.support_debts_recorded_what({ date: formatShortDay(debt.createdAt), why: debt.errorLabel })}
            {#if debt.owedCreditId}
              {m.support_debts_paid_by_take_back()}
              <a class="debt-link" href="/admin/queue?tab=owed">{m.support_debts_count_link()}</a>.
            {/if}
          </span>
          <span class="person-debts__tags" data-row-actions>
            <Badge variant="warning">{m.support_debts_held_platform()}</Badge>
            <span class="mono">{debt.errorCode}</span>
            {@render historyToggle(debt.reviewId, debt.history.length > 0, where)}
            <Button variant="secondary" size="xs" onclick={() => onSettle(debt)}>
              {m.support_action_settle()}
            </Button>
          </span>
          {#if openHistory[debt.reviewId]}
            <div class="person-debts__nested">
              <SliceHistory
                id={historyId(debt.reviewId, where)}
                title={historyTitle(person, debt.title)}
                lines={debt.history}
                payeeName={debtorName(person)}
                debtCause={debt.cause ? { type: debt.cause.type, id: debt.cause.id } : null}
              />
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/snippet}

{#snippet personToggle(person: CreatorDebtPerson, where: 'table' | 'list')}
  <!-- A person with only a collected debt has no lines to open. -->
  {#if person.stripeHeld.length + person.recordedDebts.length > 0}
  <Button
    variant="ghost"
    size="sm"
    aria-expanded={openPeople[person.payee.userId] === true}
    aria-controls={debtsId(person, where)}
    onclick={() => togglePerson(person.payee.userId)}
  >
    {openPeople[person.payee.userId] ? m.support_debts_hide() : m.support_debts_show()}
    <span class="chevron" data-open={openPeople[person.payee.userId] === true}>
      <ChevronDownIcon size={14} />
    </span>
  </Button>
  {/if}
{/snippet}

{#snippet stands(person: CreatorDebtPerson)}
  {@const badge = standsBadge(person.state)}
  <Badge variant={badge.variant}>{badge.label}</Badge>
  {#each clockLines(person) as line (line)}
    <span class="cell-sub">{line}</span>
  {/each}
{/snippet}

<div class="queue-table">
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>{m.support_col_oldest()}</Table.Head>
        <Table.Head>{m.support_col_who_owes()}</Table.Head>
        <Table.Head class="support-right">{m.support_col_owes()}</Table.Head>
        <Table.Head class="support-right">{m.support_col_stripe_balance()}</Table.Head>
        <Table.Head class="support-right">{m.support_col_back_so_far()}</Table.Head>
        <Table.Head>{m.support_col_where_it_stands()}</Table.Head>
        <Table.Head class="support-right">{m.support_col_actions()}</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each items as person (person.payee.userId)}
        {@const balance = balanceCell(person)}
        {@const recorded = owesSub(person)}
        <Table.Row data-testid="creator-debt-person">
          <Table.Cell class="support-muted support-num">{formatDay(person.oldestAt)}</Table.Cell>
          <Table.Cell>
            <span class="cell-stack">
              <span class="cell-line">
                <span class="cell-title">{debtorName(person)}</span>
                {#if person.payee.deleted}<Badge>{m.support_deleted()}</Badge>{/if}
              </span>
              <span class="cell-sub">{personRoles(person)}</span>
            </span>
          </Table.Cell>
          <Table.Cell class="support-amount">
            <span class="cell-stack cell-stack--end">
              <span>{formatPrice(person.totalOwedCents)}</span>
              {#if recorded}<span class="cell-sub">{recorded}</span>{/if}
            </span>
          </Table.Cell>
          <Table.Cell class="support-amount" data-testid="stripe-balance">
            <span class="cell-stack cell-stack--end">
              {#if balance.amount}
                <span class:balance-negative={balance.negative}>{balance.amount}</span>
              {/if}
              {#if balance.sub}<span class="cell-sub">{balance.sub}</span>{/if}
            </span>
          </Table.Cell>
          <Table.Cell class="support-amount">{backText(person)}</Table.Cell>
          <Table.Cell><span class="cell-stack">{@render stands(person)}</span></Table.Cell>
          <Table.Cell class="support-right">
            <span class="table-actions">{@render personToggle(person, 'table')}</span>
          </Table.Cell>
        </Table.Row>
        {#if openPeople[person.payee.userId]}
          <Table.Row class="support-expand">
            <Table.Cell colspan={7}>{@render debts(person, 'table')}</Table.Cell>
          </Table.Row>
        {/if}
      {/each}
    </Table.Body>
  </Table.Root>
</div>

<ul class="row-list">
  {#each items as person (person.payee.userId)}
    <li class="row-item">
      <div class="row-item__line">
        <span class="cell-title">{m.support_debt_owes({ name: debtorName(person) })}</span>
        <span class="row-item__amount">{formatPrice(person.totalOwedCents)}</span>
      </div>
      <span class="cell-sub">
        {m.support_debts_phone_line({ role: personRoles(person), date: formatDay(person.oldestAt) })}
      </span>
      <span class="cell-sub">{phoneBalanceLine(person)}</span>
      <span class="cell-stack">{@render stands(person)}</span>
      {#if openPeople[person.payee.userId]}{@render debts(person, 'list')}{/if}
      <div class="row-item__actions">{@render personToggle(person, 'list')}</div>
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
  }

  /* A negative Stripe balance reads in the warning colour, as an owed line does. */
  .balance-negative {
    color: var(--color-status-warning-text);
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

  /* The person's debts: the same shape as SliceHistory (title + bordered lines). */
  .person-debts {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: var(--container-md);
  }

  .person-debts__title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .person-debts__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .person-debts__list > li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }

  .person-debts__cause,
  .person-debts__amount {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .person-debts__amount {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .person-debts__what,
  .person-debts__tags,
  .person-debts__nested {
    grid-column: 1 / -1;
  }

  .person-debts__what {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .person-debts__tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .person-debts__tags .mono {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    overflow-wrap: anywhere;
  }

  .person-debts__nested {
    margin-top: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-surface-secondary);
  }

  .debt-link {
    color: var(--color-text);
    text-decoration: none;
    border-bottom: var(--border-width) var(--border-style) var(--color-border-strong);
    transition: var(--transition-colors);
  }

  .debt-link:hover {
    border-bottom-color: var(--color-text);
  }

  .debt-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .queue-table :global(.table-cell) {
    vertical-align: top;
  }

  /* Short labels: a wrapped "Stripe / balance" reads as two columns. */
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

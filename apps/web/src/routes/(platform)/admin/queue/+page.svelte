<!--
  /admin/queue — money the automatic refund path couldn't settle
  (Codex-2hxff.28, mockup D1–D3). Oldest first; each needs a person.

  `?tab=failed` (the default), `?tab=debts`, `?tab=owed` (Owed to creators,
  Codex-2hxff.73), `?tab=moves` (Price moves, Codex-2hxff.85/.86) or
  `?tab=fees` (Fee notices, Codex-2hxff.33) is the list on screen. Only that
  tab's reads load; another loads when support switches to it. The last two
  tabs read two lists each: the changes (cards) and the people (a table),
  and show the skeleton until both land, or the error if either fails.
  Settling refreshes the tab's lists and the counts (the nav badge shares
  the counts query).
  A charge's own page is not open beside the queue, and it reads fresh each
  time it opens, so there is no charge to refresh here.

  As on the search page, a list whose query was rejected shows an error,
  never the empty state. Settling the last row of a later page goes back to
  the last page with rows, rather than saying nothing is waiting. A list
  refused because the session ended says so, with no Try again (R2-M1).

  "Check Stripe again" on an Owed to creators row asks Stripe once per click,
  with no dialog, and says what it found. Retry and Restart on Price moves
  are database flips for the next hourly run: one request per click, and the
  notice says when the run is and when to come back. Nothing on the page asks
  again by itself (the cost rule).

  When a settle dialog closes on an answer, focus moves to the notice
  (`tabindex="-1"`) so it is read out; on Cancel, back to the row's button,
  or, when Re-pay has turned itself off (refused for good), to the row's
  next enabled choice (R3-L2).
-->
<script lang="ts">
  import type {
    CreatorDebtItem,
    FailedRefundItem,
    FailedRefundResolution,
    FeeNoticeItem,
    HeldPriceMove,
    OwedToCreatorAction,
    OwedToCreatorItem,
    StoppedPriceChange,
  } from '@codex/admin';
  import { tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { Alert, Button, EmptyState, PageHeader, Skeleton } from '$lib/components/ui';
  import * as Card from '$lib/components/ui/Card';
  import { ReceiptIcon } from '$lib/components/ui/Icon';
  import ClosePriceMoveDialog from '$lib/components/support/ClosePriceMoveDialog.svelte';
  import CreatorDebtsTable from '$lib/components/support/CreatorDebtsTable.svelte';
  import FailedRefundsTable from '$lib/components/support/FailedRefundsTable.svelte';
  import FeeChangeCards from '$lib/components/support/FeeChangeCards.svelte';
  import FeeNoticesTable from '$lib/components/support/FeeNoticesTable.svelte';
  import OwedToCreatorsTable from '$lib/components/support/OwedToCreatorsTable.svelte';
  import PriceMovesTable from '$lib/components/support/PriceMovesTable.svelte';
  import StoppedPriceChangeCards from '$lib/components/support/StoppedPriceChangeCards.svelte';
  import ToldAnotherWayDialog from '$lib/components/support/ToldAnotherWayDialog.svelte';
  import { formatDayMonth } from '$lib/components/support/fee-notices-view';
  import {
    moveFailedNotice,
    moveRefusalNotice,
    restartedNotice,
    restartRefusalNotice,
    retriedNotice,
  } from '$lib/components/support/price-moves-view';
  import ResolveCreditDialog from '$lib/components/support/ResolveCreditDialog.svelte';
  import {
    type CreditTarget,
    checkNotice,
    targetFromItem,
  } from '$lib/components/support/owed-view';
  import SettleDebtDialog from '$lib/components/support/SettleDebtDialog.svelte';
  import SettleRefundDialog from '$lib/components/support/SettleRefundDialog.svelte';
  import SessionEndedAlert from '$lib/components/support/SessionEndedAlert.svelte';
  import { isSessionEnded } from '$lib/components/support/session';
  import type { SettleNotice } from '$lib/components/support/settle-notice';
  import TabLinks from '$lib/components/support/TabLinks.svelte';
  import { useQueueCounts } from '$lib/components/support/queue-counts';
  import { queryErrorMessage } from '$lib/remote/query-result';
  import {
    checkOwedToCreator,
    listCreatorDebts,
    listFailedRefunds,
    listFeeChanges,
    listFeeNotices,
    listHeldPriceMoves,
    listOwedToCreators,
    listStoppedPriceChanges,
    restartPriceChange,
    retryPriceMove,
  } from '$lib/remote/support.remote';

  const LIMIT = 20;

  type Tab = 'failed' | 'debts' | 'owed' | 'moves' | 'fees';
  const TABS: readonly Tab[] = ['failed', 'debts', 'owed', 'moves', 'fees'];

  const tab = $derived.by((): Tab => {
    const asked = page.url.searchParams.get('tab');
    return TABS.find((t) => t === asked) ?? 'failed';
  });
  const currentPage = $derived(
    Math.max(1, Number.parseInt(page.url.searchParams.get('page') ?? '1', 10) || 1)
  );

  const countsQuery = useQueueCounts();
  const counts = $derived(countsQuery.current);

  const failedQuery = $derived(
    tab === 'failed' ? listFailedRefunds({ page: currentPage, limit: LIMIT }) : null
  );
  const debtsQuery = $derived(
    tab === 'debts' ? listCreatorDebts({ page: currentPage, limit: LIMIT }) : null
  );
  const owedQuery = $derived(
    tab === 'owed' ? listOwedToCreators({ page: currentPage, limit: LIMIT }) : null
  );
  // Price moves: the stopped changes (cards, one page) and the held people.
  const stoppedQuery = $derived(
    tab === 'moves' ? listStoppedPriceChanges({ page: 1, limit: LIMIT }) : null
  );
  const heldQuery = $derived(
    tab === 'moves' ? listHeldPriceMoves({ page: currentPage, limit: LIMIT }) : null
  );
  // Fee notices: the rises that haven't started (cards) and the people.
  const feeChangesQuery = $derived(
    tab === 'fees' ? listFeeChanges({ page: 1, limit: LIMIT }) : null
  );
  const feeNoticesQuery = $derived(
    tab === 'fees' ? listFeeNotices({ page: currentPage, limit: LIMIT }) : null
  );
  /** The tab's paged list: the one Previous and Next walk. */
  const activeQuery = $derived(
    tab === 'failed'
      ? failedQuery
      : tab === 'debts'
        ? debtsQuery
        : tab === 'owed'
          ? owedQuery
          : tab === 'moves'
            ? heldQuery
            : feeNoticesQuery
  );
  /** The tab's cards, on the two tabs that have them. */
  const cardsQuery = $derived(
    tab === 'moves' ? stoppedQuery : tab === 'fees' ? feeChangesQuery : null
  );
  const listError = $derived(
    queryErrorMessage(activeQuery?.error) ?? queryErrorMessage(cardsQuery?.error)
  );
  const sessionEnded = $derived(
    isSessionEnded(activeQuery?.error) || isSessionEnded(cardsQuery?.error)
  );
  const failed = $derived(failedQuery?.current);
  const debts = $derived(debtsQuery?.current);
  const owed = $derived(owedQuery?.current);
  const stopped = $derived(stoppedQuery?.current);
  const held = $derived(heldQuery?.current);
  const feeChanges = $derived(feeChangesQuery?.current);
  const feeNotices = $derived(feeNoticesQuery?.current);
  const active = $derived(
    tab === 'failed'
      ? failed
      : tab === 'debts'
        ? debts
        : tab === 'owed'
          ? owed
          : tab === 'moves'
            ? held
            : feeNotices
  );
  /** Both lists on a two-list tab; the one list elsewhere. */
  const loaded = $derived(
    active !== undefined && (cardsQuery === null || cardsQuery.current !== undefined)
  );
  const pagination = $derived(active?.pagination);
  /** A later page left empty (its last row settled): on its way back. */
  const emptyLaterPage = $derived(active !== undefined && active.items.length === 0 && currentPage > 1);

  $effect(() => {
    if (!emptyLaterPage || !pagination) return;
    const target = Math.max(1, Math.min(currentPage - 1, pagination.totalPages));
    const params = new URLSearchParams(page.url.searchParams);
    params.set('page', String(target));
    void goto(`/admin/queue?${params}`, { keepFocus: true, replaceState: true });
  });

  let notice = $state<SettleNotice | null>(null);
  // A notice belongs to the list it was settled from.
  $effect(() => {
    void tab;
    notice = null;
  });

  let refundItem = $state<FailedRefundItem | null>(null);
  let refundResolution = $state<FailedRefundResolution | null>(null);
  let refundOpen = $state(false);
  let debtItem = $state<CreatorDebtItem | null>(null);
  let debtOpen = $state(false);
  let creditTarget = $state<CreditTarget | null>(null);
  let creditAction = $state<OwedToCreatorAction | null>(null);
  let creditOpen = $state(false);
  /** The credit whose "Check Stripe again" is running. */
  let checkingId = $state<string | null>(null);
  let markItem = $state<FeeNoticeItem | null>(null);
  let markOpen = $state(false);
  let closeItem = $state<HeldPriceMove | null>(null);
  let closeOpen = $state(false);
  /** The held move whose Retry, or the stopped change whose Restart, is running. */
  let retryingId = $state<string | null>(null);
  let restartingId = $state<string | null>(null);

  const markCard = $derived(
    markItem ? feeChanges?.items.find((card) => card.changeId === markItem?.changeId) : undefined
  );
  /** The date a joiner is emailed until, for the empty list under a dated rise. */
  const datedUntil = $derived.by(() => {
    const dated = (feeChanges?.items ?? [])
      .map((card) => card.effectiveFrom)
      .filter((date): date is string => date !== null)
      .sort();
    return dated.length > 0 && dated.length === feeChanges?.items.length
      ? (dated.at(-1) ?? null)
      : null;
  });

  // Where focus goes when a settle dialog closes.
  let returnFocus: HTMLElement | null = null;
  let focusNotice = false;

  function rememberFocus() {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusNotice = false;
  }

  function focusAfterSettle(): HTMLElement | null {
    if (focusNotice) return document.querySelector<HTMLElement>('[data-settle-notice]');
    if (!returnFocus?.isConnected) return null;
    // A disabled button can't take focus: Re-pay turns itself off when it is
    // refused for good, so go to the row's next enabled choice.
    if (returnFocus.matches(':disabled')) {
      return (
        returnFocus
          .closest('[data-row-actions]')
          ?.querySelector<HTMLElement>('button:not(:disabled)') ?? null
      );
    }
    return returnFocus;
  }

  function openRefund(item: FailedRefundItem, resolution: FailedRefundResolution) {
    rememberFocus();
    refundItem = item;
    refundResolution = resolution;
    refundOpen = true;
  }

  function openDebt(item: CreatorDebtItem) {
    rememberFocus();
    debtItem = item;
    debtOpen = true;
  }

  function openCredit(item: OwedToCreatorItem, action: OwedToCreatorAction) {
    rememberFocus();
    creditTarget = targetFromItem(item);
    creditAction = action;
    creditOpen = true;
  }

  function openMark(item: FeeNoticeItem) {
    rememberFocus();
    markItem = item;
    markOpen = true;
  }

  function openClose(item: HeldPriceMove) {
    rememberFocus();
    closeItem = item;
    closeOpen = true;
  }

  /** One re-read of the tab's lists and the counts, after a change. */
  function refreshTab() {
    void activeQuery?.refresh().catch(() => {});
    void cardsQuery?.refresh().catch(() => {});
    void countsQuery.refresh().catch(() => {});
  }

  function handleFinished(next: SettleNotice) {
    focusNotice = true;
    notice = next;
    refreshTab();
  }

  async function showNotice(next: SettleNotice, changed: boolean) {
    notice = next;
    if (changed) refreshTab();
    await tick();
    document.querySelector<HTMLElement>('[data-settle-notice]')?.focus();
  }

  /** Retry: a flip for the next run, one request per click (M2, M3, M6). */
  async function retryMove(item: HeldPriceMove) {
    if (retryingId !== null) return;
    retryingId = item.moveId;
    let next: SettleNotice;
    let changed = true;
    try {
      const answer = await retryPriceMove({ moveId: item.moveId });
      if (answer.outcome === 'done') {
        next = retriedNotice(item, answer.result);
      } else if (answer.status === 401 || answer.status === 403) {
        next = sessionNotice();
        changed = false;
      } else {
        const refused = moveRefusalNotice(item, 'retry', answer);
        next = refused ?? moveFailedNotice();
        changed = refused !== null;
      }
    } catch (error) {
      next = isSessionEnded(error) ? sessionNotice() : moveFailedNotice();
      changed = false;
    } finally {
      retryingId = null;
    }
    await showNotice(next, changed);
  }

  /** Restart: the next run sets the change running again (M8). */
  async function restartChange(change: StoppedPriceChange) {
    if (restartingId !== null) return;
    restartingId = change.changeId;
    let next: SettleNotice;
    let changed = true;
    try {
      const answer = await restartPriceChange({ changeId: change.changeId });
      if (answer.outcome === 'done') {
        next = restartedNotice(answer.result.change, answer.result.nextRunAt);
      } else if (answer.status === 401 || answer.status === 403) {
        next = sessionNotice();
        changed = false;
      } else {
        const refused = restartRefusalNotice(answer);
        next = refused ?? moveFailedNotice();
        changed = refused !== null;
      }
    } catch (error) {
      next = isSessionEnded(error) ? sessionNotice() : moveFailedNotice();
      changed = false;
    } finally {
      restartingId = null;
    }
    await showNotice(next, changed);
  }

  function sessionNotice(): SettleNotice {
    return {
      variant: 'warning',
      lead: m.support_outcome_signed_out_lead(),
      text: m.support_settle_session_ended(),
    };
  }

  /** One question to Stripe per click (O5, O6): it never asks again by itself. */
  async function checkStripe(item: OwedToCreatorItem) {
    if (checkingId !== null) return;
    checkingId = item.creditId;
    const target = targetFromItem(item);
    let next: SettleNotice;
    let changed = true;
    try {
      const answer = await checkOwedToCreator({ creditId: item.creditId });
      next = checkNotice(target, answer);
      // Still no answer from Stripe: nothing changed, so nothing to reload.
      changed = !(answer.outcome === 'done' && answer.result.outcome === 'still_unknown');
    } catch (error) {
      next = isSessionEnded(error)
        ? {
            variant: 'warning',
            lead: m.support_outcome_signed_out_lead(),
            text: m.support_settle_session_ended(),
          }
        : { variant: 'warning', text: m.support_credit_check_failed() };
      changed = false;
    } finally {
      checkingId = null;
    }
    notice = next;
    if (changed) {
      void activeQuery?.refresh().catch(() => {});
      void countsQuery.refresh().catch(() => {});
    }
    await tick();
    document.querySelector<HTMLElement>('[data-settle-notice]')?.focus();
  }

  function goToPage(next: number) {
    const params = new URLSearchParams(page.url.searchParams);
    params.set('page', String(next));
    void goto(`/admin/queue?${params}`, { keepFocus: true });
  }
</script>

<svelte:head>
  <title>{m.support_queue_title()} · {m.support_nav_label()}</title>
</svelte:head>

<PageHeader
  kicker={m.support_nav_label()}
  title={m.support_queue_title()}
  description={m.support_queue_description()}
/>

<TabLinks
  label={m.support_queue_tabs_label()}
  currentAs="true"
  items={[
    {
      href: '/admin/queue',
      label: m.support_queue_tab_failed(),
      current: tab === 'failed',
      count: counts?.failedRefunds ?? null,
      countLabel: counts?.failedRefunds
        ? m.support_nav_queue_waiting({ count: String(counts.failedRefunds) })
        : undefined,
    },
    {
      href: '/admin/queue?tab=debts',
      label: m.support_queue_tab_debts(),
      current: tab === 'debts',
      count: counts?.creatorDebts ?? null,
      countLabel: counts?.creatorDebts
        ? m.support_nav_queue_waiting({ count: String(counts.creatorDebts) })
        : undefined,
    },
    {
      href: '/admin/queue?tab=owed',
      label: m.support_queue_tab_owed(),
      current: tab === 'owed',
      count: counts?.owedToCreators ?? null,
      countLabel: counts?.owedToCreators
        ? m.support_nav_queue_waiting({ count: String(counts.owedToCreators) })
        : undefined,
    },
    {
      href: '/admin/queue?tab=moves',
      label: m.support_queue_tab_moves(),
      current: tab === 'moves',
      count: counts?.priceMoves ?? null,
      countLabel: counts?.priceMoves
        ? m.support_nav_queue_waiting({ count: String(counts.priceMoves) })
        : undefined,
    },
    {
      href: '/admin/queue?tab=fees',
      label: m.support_queue_tab_fees(),
      current: tab === 'fees',
      count: counts?.feeNotices ?? null,
      countLabel: counts?.feeNotices
        ? m.support_nav_queue_waiting({ count: String(counts.feeNotices) })
        : undefined,
    },
  ]}
/>

<p class="intro">
  {tab === 'failed'
    ? m.support_queue_failed_intro()
    : tab === 'debts'
      ? m.support_queue_debts_intro()
      : tab === 'owed'
        ? m.support_queue_owed_intro()
        : tab === 'moves'
          ? m.support_queue_moves_intro()
          : m.support_queue_fees_intro()}
</p>

{#if notice}
  <Alert variant={notice.variant} tabindex={-1} data-settle-notice data-testid="settle-notice">
    <p>{#if notice.lead}<strong>{notice.lead}</strong> {/if}{notice.text}</p>
  </Alert>
{/if}

{#if sessionEnded && !loaded}
  <SessionEndedAlert />
{:else if listError && !loaded}
  <Alert variant="error" data-testid="queue-error">
    <p><strong>{m.support_queue_load_error_lead()}</strong> {m.support_try_again_soon()}</p>
    <div class="alert-actions">
      <Button
        variant="secondary"
        size="sm"
        onclick={() => {
          if (activeQuery?.error) void activeQuery.refresh().catch(() => {});
          if (cardsQuery?.error) void cardsQuery.refresh().catch(() => {});
        }}
      >
        {m.support_try_again()}
      </Button>
    </div>
  </Alert>
{:else if !active || !loaded || emptyLaterPage}
  <Card.Root>
    <div class="skeleton" aria-busy="true" data-testid="queue-loading">
      <span class="sr-only" role="status">{m.support_queue_loading()}</span>
      {#each Array(3) as _, i (i)}
        <div class="skeleton__row">
          <Skeleton width="14%" height="var(--space-5)" />
          <Skeleton width="30%" height="var(--space-5)" />
          <Skeleton width="16%" height="var(--space-5)" />
          <Skeleton width="20%" height="var(--space-5)" />
        </div>
      {/each}
    </div>
  </Card.Root>
{:else if tab === 'moves' && held}
  {#if stopped && stopped.items.length > 0}
    <h2 class="queue-subhead">
      {m.support_queue_moves_subhead_stopped({ count: String(stopped.pagination.total) })}
    </h2>
    <StoppedPriceChangeCards
      changes={stopped.items}
      onRestart={(change) => void restartChange(change)}
      busyId={restartingId}
    />
  {/if}
  {#if held.items.length > 0}
    <h2 class="queue-subhead">
      {m.support_queue_moves_subhead_held({ count: String(held.pagination.total) })}
    </h2>
    <Card.Root>
      <PriceMovesTable
        items={held.items}
        onRetry={(item) => void retryMove(item)}
        onClose={openClose}
        busyId={retryingId}
      />
    </Card.Root>
  {:else}
    <Card.Root>
      <EmptyState
        title={m.support_queue_moves_empty_title()}
        description={m.support_queue_moves_empty_body()}
        icon={ReceiptIcon}
        headingLevel={2}
      />
    </Card.Root>
  {/if}
{:else if tab === 'fees' && feeNotices}
  {@const cards = feeChanges?.items ?? []}
  {#if cards.length > 0}
    <FeeChangeCards {cards} />
    <h2 class="queue-subhead">
      {m.support_queue_fees_subhead({ count: String(feeNotices.pagination.total) })}
    </h2>
  {/if}
  {#if feeNotices.items.length > 0}
    <Card.Root>
      <FeeNoticesTable items={feeNotices.items} {cards} onMark={openMark} />
    </Card.Root>
  {:else}
    <Card.Root>
      <EmptyState
        title={cards.length === 0
          ? m.support_queue_fees_empty_title()
          : datedUntil
            ? m.support_queue_fees_empty_rise_title()
            : m.support_queue_fees_empty_waiting_title()}
        description={cards.length === 0
          ? m.support_queue_fees_empty_body()
          : datedUntil
            ? m.support_queue_fees_empty_rise_body({ date: formatDayMonth(datedUntil) })
            : m.support_queue_fees_empty_waiting_body()}
        icon={ReceiptIcon}
        headingLevel={2}
      />
    </Card.Root>
  {/if}
{:else if active.items.length === 0}
  <Card.Root>
    <EmptyState
      title={tab === 'failed'
        ? m.support_queue_failed_empty_title()
        : tab === 'debts'
          ? m.support_queue_debts_empty_title()
          : m.support_queue_owed_empty_title()}
      description={tab === 'failed'
        ? m.support_queue_failed_empty_body()
        : tab === 'debts'
          ? m.support_queue_debts_empty_body()
          : m.support_queue_owed_empty_body()}
      icon={ReceiptIcon}
      headingLevel={2}
    />
  </Card.Root>
{:else}
  <Card.Root>
    {#if tab === 'failed' && failed}
      <FailedRefundsTable items={failed.items} onSettle={openRefund} />
    {:else if tab === 'debts' && debts}
      <CreatorDebtsTable items={debts.items} onSettle={openDebt} />
    {:else if owed}
      <OwedToCreatorsTable
        items={owed.items}
        onResolve={openCredit}
        onCheck={(item) => void checkStripe(item)}
        {checkingId}
      />
    {/if}
  </Card.Root>
  {#if pagination && pagination.totalPages > 1}
    <nav class="pagination" aria-label={m.support_pagination_label()}>
      <Button
        variant="secondary"
        size="sm"
        disabled={currentPage <= 1}
        onclick={() => goToPage(currentPage - 1)}
      >
        {m.support_pagination_previous()}
      </Button>
      <span class="intro">
        {m.support_pagination_status({
          page: String(pagination.page),
          total: String(pagination.totalPages),
        })}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={currentPage >= pagination.totalPages}
        onclick={() => goToPage(currentPage + 1)}
      >
        {m.support_pagination_next()}
      </Button>
    </nav>
  {/if}
{/if}

<SettleRefundDialog
  item={refundItem}
  resolution={refundResolution}
  bind:open={refundOpen}
  onFinished={handleFinished}
  closeFocus={focusAfterSettle}
/>
<SettleDebtDialog
  item={debtItem}
  bind:open={debtOpen}
  onFinished={handleFinished}
  closeFocus={focusAfterSettle}
/>
<ResolveCreditDialog
  target={creditTarget}
  action={creditAction}
  bind:open={creditOpen}
  onFinished={handleFinished}
  closeFocus={focusAfterSettle}
/>
<ToldAnotherWayDialog
  item={markItem}
  card={markCard}
  bind:open={markOpen}
  onFinished={handleFinished}
  closeFocus={focusAfterSettle}
/>
<ClosePriceMoveDialog
  item={closeItem}
  bind:open={closeOpen}
  onFinished={handleFinished}
  closeFocus={focusAfterSettle}
/>

<style>
  .intro {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .queue-subhead {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .alert-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
  }

  .skeleton__row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) 0;
  }

  .pagination {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }
</style>

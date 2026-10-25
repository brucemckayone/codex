<!--
  /admin/queue — money the automatic refund path couldn't settle
  (Codex-2hxff.28, mockup D1–D3). Oldest first; each needs a person.

  `?tab=failed` (the default) or `?tab=debts` is the list on screen. Only that
  list is loaded; the other loads when support switches to it. Settling
  refreshes the list and the counts (the nav badge shares the counts query).
  A charge's own page is not open beside the queue, and it reads fresh each
  time it opens, so there is no charge to refresh here.

  As on the search page, a list whose query was rejected shows an error,
  never the empty state.
-->
<script lang="ts">
  import type {
    CreatorDebtItem,
    FailedRefundItem,
    FailedRefundResolution,
  } from '@codex/admin';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { Alert, Button, EmptyState, PageHeader, Skeleton } from '$lib/components/ui';
  import * as Card from '$lib/components/ui/Card';
  import { ReceiptIcon } from '$lib/components/ui/Icon';
  import CreatorDebtsTable from '$lib/components/support/CreatorDebtsTable.svelte';
  import FailedRefundsTable from '$lib/components/support/FailedRefundsTable.svelte';
  import SettleDebtDialog from '$lib/components/support/SettleDebtDialog.svelte';
  import SettleRefundDialog from '$lib/components/support/SettleRefundDialog.svelte';
  import type { SettleNotice } from '$lib/components/support/settle-notice';
  import TabLinks from '$lib/components/support/TabLinks.svelte';
  import { queryErrorMessage } from '$lib/remote/query-result';
  import {
    getSupportQueueCounts,
    listCreatorDebts,
    listFailedRefunds,
  } from '$lib/remote/support.remote';

  const LIMIT = 20;

  const tab = $derived(page.url.searchParams.get('tab') === 'debts' ? 'debts' : 'failed');
  const currentPage = $derived(
    Math.max(1, Number.parseInt(page.url.searchParams.get('page') ?? '1', 10) || 1)
  );

  const countsQuery = getSupportQueueCounts();
  const counts = $derived(countsQuery.current);

  const failedQuery = $derived(
    tab === 'failed' ? listFailedRefunds({ page: currentPage, limit: LIMIT }) : null
  );
  const debtsQuery = $derived(
    tab === 'debts' ? listCreatorDebts({ page: currentPage, limit: LIMIT }) : null
  );
  const activeQuery = $derived(tab === 'failed' ? failedQuery : debtsQuery);
  const listError = $derived(queryErrorMessage(activeQuery?.error));
  const failed = $derived(failedQuery?.current);
  const debts = $derived(debtsQuery?.current);
  const active = $derived(tab === 'failed' ? failed : debts);
  const pagination = $derived(active?.pagination);

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

  function openRefund(item: FailedRefundItem, resolution: FailedRefundResolution) {
    refundItem = item;
    refundResolution = resolution;
    refundOpen = true;
  }

  function openDebt(item: CreatorDebtItem) {
    debtItem = item;
    debtOpen = true;
  }

  function handleFinished(next: SettleNotice) {
    notice = next;
    void activeQuery?.refresh().catch(() => {});
    void countsQuery.refresh().catch(() => {});
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
  ]}
/>

<p class="intro">
  {tab === 'failed' ? m.support_queue_failed_intro() : m.support_queue_debts_intro()}
</p>

{#if notice}
  <Alert variant={notice.variant} data-testid="settle-notice">
    <p>{notice.text}</p>
  </Alert>
{/if}

{#if listError && !active}
  <Alert variant="error" data-testid="queue-error">
    <p><strong>{m.support_queue_load_error_lead()}</strong> {listError}</p>
    <div class="alert-actions">
      <Button
        variant="secondary"
        size="sm"
        onclick={() => void activeQuery?.refresh().catch(() => {})}
      >
        {m.support_try_again()}
      </Button>
    </div>
  </Alert>
{:else if !active}
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
{:else if active.items.length === 0}
  <Card.Root>
    <EmptyState
      title={tab === 'failed'
        ? m.support_queue_failed_empty_title()
        : m.support_queue_debts_empty_title()}
      description={tab === 'failed'
        ? m.support_queue_failed_empty_body()
        : m.support_queue_debts_empty_body()}
      icon={ReceiptIcon}
      headingLevel={2}
    />
  </Card.Root>
{:else}
  <Card.Root>
    {#if tab === 'failed' && failed}
      <FailedRefundsTable items={failed.items} onSettle={openRefund} />
    {:else if debts}
      <CreatorDebtsTable items={debts.items} onSettle={openDebt} />
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
/>
<SettleDebtDialog item={debtItem} bind:open={debtOpen} onFinished={handleFinished} />

<style>
  .intro {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
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

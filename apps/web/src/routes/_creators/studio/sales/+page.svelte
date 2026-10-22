<!--
  @component CreatorStudioSales (Codex-2hxff.21)

  The solo creator's own sales outside any organisation: the org Studio's
  Sales page (`_org/[slug]/studio/sales`) cut down to orgless purchases of the
  creator's content. The same KPIs (gross / your share / refunded / count),
  date-range + status filters, ledger table, hand-rolled pagination and CSV
  export, so the two pages match.

  "Your share" here is the creator's payout on each sale; on the org page it
  is the organisation's share.

  Below 40rem the six-column table gives way to one block per sale, so Your
  share and Status never scroll off a phone screen.

  Studio is `ssr = false`. The KPIs and the ledger stream from
  `+page.server.ts` behind skeletons; a stream that failed resolves to `null`
  and renders an error with Try again, never the empty state.
-->
<script lang="ts">
  import { goto, invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import {
    Alert,
    Badge,
    Button,
    EmptyState,
    PageHeader,
    Skeleton,
  } from '$lib/components/ui';
  import * as Card from '$lib/components/ui/Card';
  import * as Table from '$lib/components/ui/Table';
  import Select from '$lib/components/ui/Select/Select.svelte';
  import {
    AlertTriangleIcon,
    DownloadIcon,
    ReceiptIcon,
  } from '$lib/components/ui/Icon';
  import KPICard from '$lib/components/studio/analytics/KPICard.svelte';
  import { formatDate, formatPrice } from '$lib/utils/format';
  import { downloadCsv } from '$lib/utils/csv-export';
  import type { SaleListItem, SalesStats } from '@codex/purchase';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const filters = $derived(data.filters);
  const isFiltered = $derived(
    filters.status !== 'all' || filters.range !== '30'
  );

  // ── Filter handlers ──────────────────────────────────────────────────
  /**
   * Default values per URL key, stripped from the URL so it stays short.
   * Every change re-runs the server load, which reads these back.
   */
  const URL_DEFAULTS: Record<string, string> = {
    range: '30',
    status: 'all',
  };

  function setUrlParam(key: string, value: string | null) {
    const params = new URLSearchParams(page.url.searchParams);
    if (value && value !== URL_DEFAULTS[key]) params.set(key, value);
    else params.delete(key);
    if (key !== 'page') params.delete('page');
    const qs = params.toString();
    goto(`/studio/sales${qs ? `?${qs}` : ''}`, {
      replaceState: true,
      keepFocus: true,
    });
  }

  const rangeOptions = [
    { value: '7', label: m.sales_filter_range_7() },
    { value: '30', label: m.sales_filter_range_30() },
    { value: '90', label: m.sales_filter_range_90() },
    { value: 'all', label: m.sales_filter_range_all() },
  ];

  const statusOptions = [
    { value: 'all', label: m.sales_filter_status_all() },
    { value: 'completed', label: m.sales_status_completed() },
    { value: 'refunded', label: m.sales_status_refunded() },
    { value: 'disputed', label: m.sales_status_disputed() },
    { value: 'failed', label: m.sales_status_failed() },
    { value: 'pending', label: m.sales_status_pending() },
  ];

  function onRangeChange(v: string | undefined) {
    if (v) setUrlParam('range', v);
  }
  function onStatusChange(v: string | undefined) {
    if (v) setUrlParam('status', v);
  }

  function goToPage(next: number) {
    setUrlParam('page', String(next));
  }

  function retry() {
    invalidate('cache:studio-page:sales');
  }

  // ── Display helpers ──────────────────────────────────────────────────
  const SALE_STATUS_VARIANT: Record<
    SaleListItem['status'],
    'success' | 'warning' | 'error' | 'neutral'
  > = {
    completed: 'success',
    pending: 'warning',
    failed: 'error',
    refunded: 'neutral',
  };

  const SALE_STATUS_LABEL: Record<SaleListItem['status'], () => string> = {
    completed: m.sales_status_completed,
    pending: m.sales_status_pending,
    failed: m.sales_status_failed,
    refunded: m.sales_status_refunded,
  };

  function saleDate(sale: SaleListItem): string {
    return sale.purchasedAt ?? sale.createdAt;
  }

  /** The public content page on the creators subdomain, once there's a username. */
  function contentHref(sale: SaleListItem): string | null {
    const username = data.creator.username;
    return username ? `/${username}/content/${sale.contentSlug}` : null;
  }

  // ── CSV export ───────────────────────────────────────────────────────
  // The column names are the org page's, so the two exports read alike.
  function exportCsv(items: SaleListItem[]) {
    const headers = [
      'Date',
      'Customer',
      'Email',
      'Content',
      'Amount (GBP)',
      'Your share (GBP)',
      'Status',
      'Refunded (GBP)',
      'Refund reason',
      'Disputed',
      'Stripe payment intent',
    ];
    const rows = items.map((s) => [
      saleDate(s).split('T')[0],
      s.customerName ?? '',
      s.customerEmail,
      s.contentTitle,
      (s.amountPaidCents / 100).toFixed(2),
      (s.creatorPayoutCents / 100).toFixed(2),
      s.status,
      s.refundAmountCents != null ? (s.refundAmountCents / 100).toFixed(2) : '',
      s.refundReason ?? '',
      s.disputedAt ? 'yes' : '',
      s.stripePaymentIntentId,
    ]);
    downloadCsv(
      `sales-${new Date().toISOString().split('T')[0]}.csv`,
      headers,
      rows
    );
  }
</script>

{#snippet kpiGrid(stats: SalesStats | null, loading: boolean)}
  <div class="kpi-grid">
    <KPICard
      label={m.sales_kpi_gross()}
      value={stats?.grossCents ?? 0}
      format="money"
      {loading}
    />
    <KPICard
      label={m.sales_kpi_share()}
      value={stats?.netCents ?? 0}
      format="money"
      {loading}
    />
    <KPICard
      label={m.sales_kpi_refunded()}
      value={stats?.refundedCents ?? 0}
      format="money"
      {loading}
    />
    <KPICard label={m.sales_kpi_count()} value={stats?.count ?? 0} {loading} />
  </div>
{/snippet}

{#snippet loadError(message: string)}
  <Alert variant="error">
    <div class="load-error">
      <span>{message}</span>
      <Button variant="secondary" size="sm" onclick={retry}>
        {m.sales_retry()}
      </Button>
    </div>
  </Alert>
{/snippet}

{#snippet contentTitle(sale: SaleListItem, extraClass = '')}
  {@const href = contentHref(sale)}
  {#if href}
    <a class="content-link {extraClass}" {href}>{sale.contentTitle}</a>
  {:else}
    <span class="content-link {extraClass}">{sale.contentTitle}</span>
  {/if}
{/snippet}

{#snippet customer(sale: SaleListItem)}
  <span class="customer-text">
    <span class="customer-name">{sale.customerName ?? sale.customerEmail}</span>
    {#if sale.customerName}
      <span class="customer-email">{sale.customerEmail}</span>
    {/if}
  </span>
{/snippet}

{#snippet statusBadge(sale: SaleListItem)}
  <Badge variant={SALE_STATUS_VARIANT[sale.status] ?? 'neutral'}>
    {SALE_STATUS_LABEL[sale.status]?.() ?? sale.status}
  </Badge>
{/snippet}

{#snippet disputeFlag(sale: SaleListItem)}
  {#if sale.disputedAt}
    <span class="dispute-flag" title={sale.disputeReason ?? m.sales_status_disputed()}>
      <AlertTriangleIcon size={12} />
      {m.sales_status_disputed()}
    </span>
  {/if}
{/snippet}

{#snippet refundNote(sale: SaleListItem)}
  {#if sale.refundAmountCents != null && sale.refundAmountCents > 0}
    <span class="refund-note">−{formatPrice(sale.refundAmountCents)}</span>
  {/if}
{/snippet}

<svelte:head>
  <title>{m.sales_title()} | Creator Studio</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="sales">
  <PageHeader
    kicker={m.studio_section_money()}
    title={m.sales_title()}
    description={m.sales_personal_description()}
  >
    {#snippet actions()}
      {#await data.sales then sales}
        {#if sales && sales.items.length > 0}
          <Button variant="secondary" size="sm" onclick={() => exportCsv(sales.items)}>
            <DownloadIcon size={14} />
            {m.sales_export_csv()}
          </Button>
        {/if}
      {/await}
    {/snippet}
  </PageHeader>

  <!-- KPI tiles -->
  {#await data.stats}
    {@render kpiGrid(null, true)}
  {:then stats}
    {#if stats}
      {@render kpiGrid(stats, false)}
    {:else}
      {@render loadError(m.sales_kpi_load_error())}
    {/if}
  {/await}

  <Card.Root>
    <Card.Header>
      <div class="filters">
        <Select
          options={rangeOptions}
          value={filters.range}
          label={m.sales_filter_range()}
          onValueChange={onRangeChange}
          class="range-filter"
        />
        <Select
          options={statusOptions}
          value={filters.status}
          label={m.sales_filter_status()}
          onValueChange={onStatusChange}
          class="status-filter"
        />
      </div>
    </Card.Header>

    <Card.Content>
      {#await data.sales}
        <div class="table-skeleton" aria-busy="true" aria-live="polite">
          <Skeleton width="100%" height="var(--space-10)" />
          {#each { length: 5 } as _, i (i)}
            <div class="table-skeleton-row">
              <Skeleton width="14%" height="var(--space-5)" />
              <Skeleton width="22%" height="var(--space-5)" />
              <Skeleton width="22%" height="var(--space-5)" />
              <Skeleton width="12%" height="var(--space-5)" />
              <Skeleton width="12%" height="var(--space-5)" />
              <Skeleton width="14%" height="var(--space-5)" />
            </div>
          {/each}
        </div>
      {:then sales}
        {#if !sales}
          {@render loadError(m.sales_load_error())}
        {:else if sales.items.length === 0}
          {#if isFiltered}
            <EmptyState
              title={m.sales_empty_filtered_title()}
              description={m.sales_empty_filtered_description()}
              icon={ReceiptIcon}
            />
          {:else}
            <EmptyState
              title={m.sales_personal_empty_title()}
              description={m.sales_personal_empty_description()}
              icon={ReceiptIcon}
            >
              {#snippet action()}
                <div class="empty-actions">
                  <a href="/studio/content" class="empty-link">
                    <Button variant="primary">{m.sales_personal_empty_publish()}</Button>
                  </a>
                  <a href="/studio/earnings" class="empty-link">
                    <Button variant="secondary">{m.sales_personal_empty_payouts()}</Button>
                  </a>
                </div>
              {/snippet}
            </EmptyState>
          {/if}
        {:else}
          {@const pagination = sales.pagination}
          <div class="table-wrapper">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head>{m.sales_col_date()}</Table.Head>
                  <Table.Head>{m.sales_col_customer()}</Table.Head>
                  <Table.Head>{m.sales_col_content()}</Table.Head>
                  <Table.Head class="amount-head">{m.sales_col_amount()}</Table.Head>
                  <Table.Head class="amount-head">{m.sales_col_share()}</Table.Head>
                  <Table.Head>{m.sales_col_status()}</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#each sales.items as sale (sale.id)}
                  <Table.Row>
                    <Table.Cell>
                      <span class="date-cell" title={saleDate(sale)}>
                        {formatDate(saleDate(sale))}
                      </span>
                    </Table.Cell>
                    <Table.Cell>{@render customer(sale)}</Table.Cell>
                    <Table.Cell>{@render contentTitle(sale)}</Table.Cell>
                    <Table.Cell class="amount-cell">
                      {formatPrice(sale.amountPaidCents)}
                    </Table.Cell>
                    <Table.Cell class="amount-cell">
                      {formatPrice(sale.creatorPayoutCents)}
                    </Table.Cell>
                    <Table.Cell>
                      <span class="status-stack">
                        {@render statusBadge(sale)}
                        {@render disputeFlag(sale)}
                        {@render refundNote(sale)}
                      </span>
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          </div>

          <!-- Phone (below 40rem): the same sales, one block each -->
          <ul class="sale-list">
            {#each sales.items as sale (sale.id)}
              <li class="sale-item">
                <div class="sale-item__row">
                  {@render contentTitle(sale, 'sale-item__title')}
                  <span class="sale-item__amount">{formatPrice(sale.amountPaidCents)}</span>
                </div>
                <div class="sale-item__row">
                  {@render customer(sale)}
                  <span class="sale-item__share">
                    {m.sales_item_share({ amount: formatPrice(sale.creatorPayoutCents) })}
                  </span>
                </div>
                <div class="sale-item__row">
                  <span class="date-cell">{formatDate(saleDate(sale))}</span>
                  <span class="sale-item__status">
                    {@render refundNote(sale)}
                    {@render disputeFlag(sale)}
                    {@render statusBadge(sale)}
                  </span>
                </div>
              </li>
            {/each}
          </ul>

          {#if pagination.totalPages > 1}
            <nav class="pagination" aria-label={m.sales_pagination_label()}>
              <Button
                variant="secondary"
                disabled={filters.page <= 1}
                onclick={() => goToPage(filters.page - 1)}
              >
                {m.common_previous()}
              </Button>
              <span class="pagination-status">
                {m.common_page_x_of_y({
                  current: pagination.page,
                  total: pagination.totalPages,
                })}
                <span class="pagination-total">
                  {pagination.total === 1
                    ? m.sales_pagination_total_one()
                    : m.sales_pagination_total_other({ count: pagination.total })}
                </span>
              </span>
              <Button
                variant="secondary"
                disabled={filters.page >= pagination.totalPages}
                onclick={() => goToPage(filters.page + 1)}
              >
                {m.common_next()}
              </Button>
            </nav>
          {/if}
        {/if}
      {/await}
    </Card.Content>
  </Card.Root>
</div>

<style>
  .sales {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    width: 100%;
  }

  .empty-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-3);
  }

  .empty-link {
    text-decoration: none;
    color: inherit;
  }

  .load-error {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-3);
  }

  @media (--below-md) {
    .kpi-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (--below-sm) {
    .kpi-grid {
      grid-template-columns: 1fr;
    }
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: flex-end;
  }

  .filters :global(.range-filter),
  .filters :global(.status-filter) {
    /* One answer for "how wide is an inline studio filter" — see
       --control-width-md in tokens/layout.css. */
    min-width: var(--control-width-md);
    max-width: var(--control-width-md);
  }

  .table-wrapper {
    overflow-x: auto;
  }

  .table-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .table-skeleton-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
  }

  .date-cell {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .customer-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .customer-name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 22ch;
  }

  .customer-email {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 22ch;
  }

  .content-link {
    color: var(--color-text);
    text-decoration: none;
    font-size: var(--text-sm);
    border-bottom: var(--border-width) var(--border-style) transparent;
    transition: var(--transition-colors);
  }

  a.content-link:hover {
    border-bottom-color: var(--color-border);
  }

  .sales :global(.amount-head),
  .sales :global(.amount-cell) {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-medium);
  }

  .status-stack {
    display: inline-flex;
    flex-direction: column;
    gap: var(--space-1);
    align-items: flex-start;
  }

  .dispute-flag {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--color-status-error-text);
  }

  .refund-note {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* Phone: one block per sale in place of the sideways-scrolling table. */
  .sale-list {
    display: none;
    list-style: none;
    margin: 0;
    padding: 0;
    flex-direction: column;
  }

  @media (--below-sm) {
    .table-wrapper {
      display: none;
    }

    .sale-list {
      display: flex;
    }
  }

  .sale-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    padding-block: var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .sale-item:first-child {
    padding-top: 0;
  }

  .sale-item__row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
  }

  .sale-item :global(.sale-item__title) {
    font-weight: var(--font-medium);
    min-width: 0;
  }

  .sale-item__amount {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .sale-item__share {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .sale-item__status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
    margin-top: var(--space-4);
    flex-wrap: wrap;
  }

  .pagination-status {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .pagination-total {
    color: var(--color-text-muted);
  }
</style>

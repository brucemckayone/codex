<!--
  @component StudioSales (Codex-1csms)

  Owner-only studio surface listing every sale that landed on the org
  (the inverse of /account/payment which is the customer's own purchase
  receipts). Includes header KPIs (gross / net / refunded / count),
  date-range + status filters, a refunds & disputes indicator, and CSV
  export. Mirrors /studio/payouts: client-side $effect redirect for
  non-owners, snapshot query semantics.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    Alert,
    Badge,
    Button,
    EmptyState,
    Skeleton,
  } from '$lib/components/ui';
  import * as Card from '$lib/components/ui/Card';
  import * as Table from '$lib/components/ui/Table';
  import Select from '$lib/components/ui/Select/Select.svelte';
  import {
    ReceiptIcon,
    DownloadIcon,
    AlertTriangleIcon,
  } from '$lib/components/ui/Icon';
  import KPICard from '$lib/components/studio/analytics/KPICard.svelte';
  import { listSales, getSalesStats } from '$lib/remote/sales.remote';
  import { formatDate, formatPrice } from '$lib/utils/format';
  import { downloadCsv } from '$lib/utils/csv-export';
  import type { SaleListItem, SalesStats } from '@codex/purchase';
  import type { DateRange } from '@codex/shared-types';
  import type { QueryResult } from '$lib/remote/query-result';

  type SalesPage = {
    items: SaleListItem[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };

  // DateRange lifted to @codex/shared-types (Codex-6nt4l) — payouts page
  // and any new studio surface share this lookback vocabulary.
  type StatusFilter =
    | 'all'
    | 'completed'
    | 'refunded'
    | 'failed'
    | 'pending'
    | 'disputed';

  let { data } = $props();

  $effect(() => {
    if (data.userRole !== 'owner') {
      goto('/studio');
    }
  });

  const isOwner = $derived(data.userRole === 'owner');
  const orgId = $derived(data.org.id);

  // ── URL-derived state ─────────────────────────────────────────────────
  const currentUrlPage = $derived(
    parseInt(page.url.searchParams.get('page') ?? '1', 10) || 1
  );
  const rangeFilter = $derived(
    (page.url.searchParams.get('range') as DateRange) || '30'
  );
  const statusFilter = $derived(
    (page.url.searchParams.get('status') as StatusFilter) || 'all'
  );
  const limit = 20;

  // ── Date-range → ISO bounds (window applies to listSales AND stats) ──
  const dateBounds = $derived.by(() => {
    if (rangeFilter === 'all') return { fromDate: undefined };
    const days =
      rangeFilter === '7' ? 7 : rangeFilter === '90' ? 90 : 30;
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - days);
    return { fromDate: from.toISOString() };
  });

  // ── Remote queries ───────────────────────────────────────────────────
  const salesQuery = $derived(
    isOwner && orgId
      ? listSales({
          organizationId: orgId,
          page: currentUrlPage,
          limit,
          ...(statusFilter !== 'all' && { status: statusFilter }),
          ...(dateBounds.fromDate && { fromDate: dateBounds.fromDate }),
        })
      : null
  );

  const statsQuery = $derived(
    isOwner && orgId
      ? getSalesStats({
          organizationId: orgId,
          ...(dateBounds.fromDate && { fromDate: dateBounds.fromDate }),
        })
      : null
  );

  const salesData = $derived(
    (salesQuery as QueryResult<SalesPage> | null)?.current
  );
  const statsData = $derived(
    (statsQuery as QueryResult<SalesStats> | null)?.current
  );

  const loading = $derived(
    (salesQuery as QueryResult<SalesPage> | null)?.loading ?? true
  );
  const statsLoading = $derived(
    (statsQuery as QueryResult<SalesStats> | null)?.loading ?? true
  );

  const queryError = $derived(
    (salesQuery as QueryResult<SalesPage> | null)?.error?.message ?? null
  );

  const items = $derived(salesData?.items ?? []);
  const pagination = $derived(salesData?.pagination);
  const isEmpty = $derived(!loading && items.length === 0);

  // ── Filter handlers ──────────────────────────────────────────────────
  /**
   * Default values per URL key. setUrlParam strips a key from the URL when
   * its value matches the default — keeps URLs short and unambiguous, but
   * scoped per key so a future filter that also accepts 'all' (e.g.
   * customer filter) doesn't silently lose state.
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
    { value: '7', label: 'Last 7 days' },
    { value: '30', label: 'Last 30 days' },
    { value: '90', label: 'Last 90 days' },
    { value: 'all', label: 'All time' },
  ];

  const statusOptions = [
    { value: 'all', label: 'All statuses' },
    { value: 'completed', label: 'Completed' },
    { value: 'refunded', label: 'Refunded' },
    { value: 'disputed', label: 'Disputed' },
    { value: 'failed', label: 'Failed' },
    { value: 'pending', label: 'Pending' },
  ];

  function onRangeChange(v: string | undefined) {
    if (v) setUrlParam('range', v);
  }
  function onStatusChange(v: string | undefined) {
    if (v) setUrlParam('status', v);
  }

  function nextPage() {
    if (pagination && currentUrlPage < pagination.totalPages) {
      setUrlParam('page', String(currentUrlPage + 1));
    }
  }
  function prevPage() {
    if (currentUrlPage > 1) {
      setUrlParam('page', String(currentUrlPage - 1));
    }
  }

  // ── Display helpers ──────────────────────────────────────────────────
  const SALE_STATUS_VARIANT: Record<
    string,
    'success' | 'warning' | 'error' | 'neutral'
  > = {
    completed: 'success',
    pending: 'warning',
    failed: 'error',
    refunded: 'neutral',
  };
  function statusVariant(s: SaleListItem['status']) {
    return SALE_STATUS_VARIANT[s] ?? 'neutral';
  }
  function statusLabel(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ── CSV export ───────────────────────────────────────────────────────
  function exportCsv() {
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
      (s.purchasedAt ?? s.createdAt).split('T')[0],
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

<svelte:head>
  <title>Sales | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#if !isOwner}
  <!-- redirecting -->
{:else}
  <div class="sales">
    <header class="sales-header">
      <div class="header-text">
        <h1 class="sales-title">Sales</h1>
        <p class="sales-subtitle">
          Every sale that landed on this organisation in the selected period,
          including refunds and disputes. "Your share" is the net to the org
          after platform fees.
        </p>
      </div>
      {#if items.length > 0}
        <Button variant="secondary" size="sm" onclick={exportCsv}>
          <DownloadIcon size={14} />
          Export CSV
        </Button>
      {/if}
    </header>

    <!-- KPI tiles -->
    <div class="kpi-grid">
      <KPICard
        label="Gross"
        value={statsData?.grossCents ?? 0}
        format="money"
        loading={statsLoading}
      />
      <KPICard
        label="Your share"
        value={statsData?.netCents ?? 0}
        format="money"
        loading={statsLoading}
      />
      <KPICard
        label="Refunded"
        value={statsData?.refundedCents ?? 0}
        format="money"
        loading={statsLoading}
      />
      <KPICard
        label="Sales count"
        value={statsData?.count ?? 0}
        loading={statsLoading}
      />
    </div>

    <Card.Root>
      <Card.Header>
        <div class="filters">
          <Select
            options={rangeOptions}
            value={rangeFilter}
            label="Date range"
            onValueChange={onRangeChange}
            class="range-filter"
          />
          <Select
            options={statusOptions}
            value={statusFilter}
            label="Status"
            onValueChange={onStatusChange}
            class="status-filter"
          />
        </div>
      </Card.Header>

      <Card.Content>
        {#if queryError}
          <Alert variant="error">Could not load sales: {queryError}</Alert>
        {:else if loading}
          <div class="table-skeleton" aria-busy="true" aria-live="polite">
            <Skeleton width="100%" height="var(--space-10)" />
            {#each Array(5) as _, i (i)}
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
        {:else if isEmpty}
          <EmptyState
            title={statusFilter !== 'all' || rangeFilter !== '30'
              ? 'No sales match'
              : 'No sales yet'}
            description={statusFilter !== 'all' || rangeFilter !== '30'
              ? 'Try widening the date range or clearing the status filter.'
              : 'Sales will appear here once customers buy your content.'}
            icon={ReceiptIcon}
          />
        {:else}
          <div class="table-wrapper">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Date</Table.Head>
                  <Table.Head>Customer</Table.Head>
                  <Table.Head>Content</Table.Head>
                  <Table.Head class="amount-head">Amount</Table.Head>
                  <Table.Head class="amount-head">Your share</Table.Head>
                  <Table.Head>Status</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#each items as sale (sale.id)}
                  <Table.Row>
                    <Table.Cell>
                      <span
                        class="date-cell"
                        title={(sale.purchasedAt ?? sale.createdAt) ?? ''}
                      >
                        {formatDate(sale.purchasedAt ?? sale.createdAt)}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span class="customer-text">
                        <span class="customer-name">
                          {sale.customerName ?? sale.customerEmail}
                        </span>
                        {#if sale.customerName}
                          <span class="customer-email">{sale.customerEmail}</span>
                        {/if}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <a
                        class="content-link"
                        href={`/content/${sale.contentSlug}`}
                      >
                        {sale.contentTitle}
                      </a>
                    </Table.Cell>
                    <Table.Cell class="amount-cell">
                      {formatPrice(sale.amountPaidCents)}
                    </Table.Cell>
                    <Table.Cell class="amount-cell">
                      {formatPrice(sale.creatorPayoutCents)}
                    </Table.Cell>
                    <Table.Cell>
                      <span class="status-stack">
                        <Badge variant={statusVariant(sale.status)}>
                          {statusLabel(sale.status)}
                        </Badge>
                        {#if sale.disputedAt}
                          <span class="dispute-flag" title={sale.disputeReason ?? 'Disputed'}>
                            <AlertTriangleIcon size={12} />
                            Disputed
                          </span>
                        {/if}
                        {#if sale.refundAmountCents != null && sale.refundAmountCents > 0}
                          <span class="refund-note">
                            −{formatPrice(sale.refundAmountCents)}
                          </span>
                        {/if}
                      </span>
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          </div>

          {#if pagination && pagination.totalPages > 1}
            <nav class="pagination" aria-label="Sales pagination">
              <Button
                variant="secondary"
                disabled={currentUrlPage <= 1}
                onclick={prevPage}
              >
                Previous
              </Button>
              <span class="pagination-status">
                Page {pagination.page} of {pagination.totalPages}
                <span class="pagination-total">
                  · {pagination.total} sale{pagination.total === 1 ? '' : 's'}
                </span>
              </span>
              <Button
                variant="secondary"
                disabled={currentUrlPage >= pagination.totalPages}
                onclick={nextPage}
              >
                Next
              </Button>
            </nav>
          {/if}
        {/if}
      </Card.Content>
    </Card.Root>
  </div>
{/if}

<style>
  .sales {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 1200px;
  }

  .sales-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .header-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .sales-title {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
    line-height: var(--leading-tight);
  }

  .sales-subtitle {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
    max-width: 720px;
    margin: 0;
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

  :global(.range-filter),
  :global(.status-filter) {
    min-width: 180px;
    max-width: 240px;
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

  .content-link:hover {
    border-bottom-color: var(--color-border);
  }

  :global(.amount-head),
  :global(.amount-cell) {
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
    color: var(--color-error-700);
  }

  .refund-note {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
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

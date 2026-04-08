<!--
  @component Studio Customers Page

  Full-featured customer management page with search, sortable DataTable,
  client-side filters, stats bar, CSV export, row selection, and bulk grant access.
  Customer detail drawer opens when clicking a customer name.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { CustomerListItem } from '@codex/shared-types';
  import type { PageData } from './$types';
  import * as m from '$paraglide/messages';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import CustomerTable from '$lib/components/studio/CustomerTable.svelte';
  import CustomerDetailDrawer from '$lib/components/studio/CustomerDetailDrawer.svelte';
  import BulkGrantAccessDialog from '$lib/components/studio/BulkGrantAccessDialog.svelte';
  import { Pagination } from '$lib/components/ui/Pagination';
  import { PageHeader, Button } from '$lib/components/ui';
  import { FilterBar } from '$lib/components/ui/FilterBar';
  import { UsersIcon, DownloadIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import { getCustomers, listAdminContent } from '$lib/remote/admin.remote';
  import { formatPrice } from '$lib/utils/format';
  import { toast } from '$lib/components/ui/Toast/toast-store';

  let { data }: { data: PageData } = $props();

  // ── URL-derived state (all filters are URL-based for server-side filtering) ──
  const currentUrlPage = $derived(parseInt(page.url.searchParams.get('page') || '1', 10) || 1);
  const urlSearch = $derived(page.url.searchParams.get('search')?.trim() || undefined);
  const urlContentId = $derived(page.url.searchParams.get('contentId') || undefined);
  const urlJoined = $derived(page.url.searchParams.get('joined') || undefined);
  const urlSpend = $derived(page.url.searchParams.get('spend') || undefined);
  const urlLimit = $derived(
    Math.min(50, Math.max(10, parseInt(page.url.searchParams.get('limit') || '20', 10) || 20))
  );

  // ── Client-side sort state (sorting the current page is fine client-side) ──
  let sortKey = $state('totalSpentCents');
  let sortOrder = $state<'asc' | 'desc'>('desc');

  // ── Content filter options (org-scoped via admin API) ──────────────
  let contentOptions = $state<Array<{ value: string; label: string }>>([
    { value: '', label: m.studio_customers_filter_content_all() },
  ]);

  $effect(() => {
    if (data.org?.id) {
      loadContentOptions(data.org.id);
    }
  });

  async function loadContentOptions(orgId: string) {
    try {
      const result = await listAdminContent({ organizationId: orgId, status: 'published', limit: 100 });
      contentOptions = [
        { value: '', label: m.studio_customers_filter_content_all() },
        ...(result?.items ?? []).map((item: { id: string; title: string }) => ({
          value: item.id,
          label: item.title,
        })),
      ];
    } catch {
      contentOptions = [{ value: '', label: m.studio_customers_filter_content_all() }];
    }
  }

  // ── Map URL filter values to API params ────────────────────────────
  const joinedDaysMap: Record<string, number> = { last7: 7, last30: 30, last90: 90 };
  const spendRangeMap: Record<string, [number, number | undefined]> = {
    under10: [0, 1000],
    '10to50': [1000, 5000],
    '50to100': [5000, 10000],
    over100: [10000, undefined],
  };

  // ── Drawer state ───────────────────────────────────────────────────
  let drawerOpen = $state(false);
  let selectedCustomerId = $state<string | null>(null);

  // ── Bulk grant state ───────────────────────────────────────────────
  let bulkGrantOpen = $state(false);
  let bulkGrantCustomerIds = $state<string[]>([]);
  let tableKey = $state(0);

  // ── Data query (all filters sent server-side) ──────────────────────
  const customersQuery = $derived(
    data.org?.id
      ? getCustomers({
          organizationId: data.org.id,
          page: currentUrlPage,
          limit: urlLimit,
          ...(urlSearch && { search: urlSearch }),
          ...(urlContentId && { contentId: urlContentId }),
          ...(urlJoined && joinedDaysMap[urlJoined] && { joinedWithin: joinedDaysMap[urlJoined] }),
          ...(urlSpend && spendRangeMap[urlSpend] && { minSpendCents: spendRangeMap[urlSpend][0] }),
          ...(urlSpend && spendRangeMap[urlSpend] && spendRangeMap[urlSpend][1] != null && { maxSpendCents: spendRangeMap[urlSpend][1] }),
        })
      : null
  );

  // ── Sort pipeline (client-side sort of server-filtered results) ────
  function applySorting(items: CustomerListItem[], key: string, order: 'asc' | 'desc'): CustomerListItem[] {
    return [...items].sort((a, b) => {
      let cmp = 0;
      if (key === 'name') {
        cmp = (a.name ?? '').localeCompare(b.name ?? '');
      } else if (key === 'totalPurchases') {
        cmp = a.totalPurchases - b.totalPurchases;
      } else if (key === 'totalSpentCents') {
        cmp = a.totalSpentCents - b.totalSpentCents;
      } else if (key === 'createdAt') {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return order === 'asc' ? cmp : -cmp;
    });
  }

  const rawItems = $derived(customersQuery?.current?.items ?? []);
  const sortedCustomers = $derived(applySorting(rawItems, sortKey, sortOrder));

  // ── Stats (derived from loaded data) ───────────────────────────────
  const pagination = $derived(customersQuery?.current?.pagination ?? { page: 1, limit: urlLimit, total: 0, totalPages: 0 });
  const totalCustomers = $derived(pagination.total);
  const pageRevenue = $derived(rawItems.reduce((sum, c) => sum + c.totalSpentCents, 0));
  const avgSpend = $derived(rawItems.length ? Math.round(pageRevenue / rawItems.length) : 0);

  // ── FilterBar config ───────────────────────────────────────────────
  const filterConfigs = [
    { type: 'search' as const, key: 'search', placeholder: m.studio_customers_search_placeholder(), mode: 'submit' as const },
    {
      type: 'select' as const, key: 'joined', label: m.studio_customers_filter_joined(),
      placeholder: m.studio_customers_filter_joined_all(),
      options: [
        { value: '', label: m.studio_customers_filter_joined_all() },
        { value: 'last7', label: m.studio_customers_filter_last_7_days() },
        { value: 'last30', label: m.studio_customers_filter_last_30_days() },
        { value: 'last90', label: m.studio_customers_filter_last_90_days() },
      ],
    },
    {
      type: 'select' as const, key: 'spend', label: m.studio_customers_filter_spend(),
      placeholder: m.studio_customers_filter_spend_all(),
      options: [
        { value: '', label: m.studio_customers_filter_spend_all() },
        { value: 'under10', label: m.studio_customers_filter_under_10() },
        { value: '10to50', label: m.studio_customers_filter_10_to_50() },
        { value: '50to100', label: m.studio_customers_filter_50_to_100() },
        { value: 'over100', label: m.studio_customers_filter_over_100() },
      ],
    },
    {
      type: 'select' as const, key: 'contentId', label: m.studio_customers_filter_content(),
      placeholder: m.studio_customers_filter_content_all(),
      options: contentOptions,
    },
  ];

  const filterValues = $derived({
    search: page.url.searchParams.get('search') ?? '',
    joined: page.url.searchParams.get('joined') ?? '',
    spend: page.url.searchParams.get('spend') ?? '',
    contentId: page.url.searchParams.get('contentId') ?? '',
  });

  // ── Handlers ───────────────────────────────────────────────────────
  function handleCustomerClick(customerId: string) {
    selectedCustomerId = customerId;
    drawerOpen = true;
  }

  function handleSort(key: string, order: 'asc' | 'desc') {
    sortKey = key;
    sortOrder = order;
  }

  function handleFilterChange(key: string, value: string | null) {
    const params = new URLSearchParams(page.url.searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete('page');
    const query = params.toString();
    goto(`/studio/customers${query ? `?${query}` : ''}`, { replaceState: true, keepFocus: true });
  }

  function handlePageSizeChange(e: Event) {
    const size = (e.target as HTMLSelectElement).value;
    const params = new URLSearchParams(page.url.searchParams);
    if (size !== '20') params.set('limit', size);
    else params.delete('limit');
    params.delete('page');
    const query = params.toString();
    goto(`/studio/customers${query ? `?${query}` : ''}`, { replaceState: true });
  }

  function openBulkGrant(ids: Set<string>) {
    bulkGrantCustomerIds = [...ids];
    bulkGrantOpen = true;
  }

  function handleBulkGrantSuccess() {
    tableKey++;
  }

  async function handleCopyEmail(email: string) {
    try {
      await navigator.clipboard.writeText(email);
      toast.success(m.studio_customers_email_copied());
    } catch {
      toast.error(m.studio_customers_copy_email_failed());
    }
  }

  // ── CSV Export ─────────────────────────────────────────────────────
  function escapeCsvField(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  function exportCsv() {
    const headers = ['Name', 'Email', 'Purchases', 'Total Spent (GBP)', 'Joined'];
    const rows = sortedCustomers.map((c) => [
      escapeCsvField(c.name ?? ''),
      escapeCsvField(c.email),
      String(c.totalPurchases),
      (c.totalSpentCents / 100).toFixed(2),
      new Date(c.createdAt).toISOString().split('T')[0],
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customers-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Pagination baseUrl (preserves search + limit) ──────────────────
  const paginationBaseUrl = $derived.by(() => {
    const params = new URLSearchParams();
    if (urlSearch) params.set('search', urlSearch);
    if (urlContentId) params.set('contentId', urlContentId);
    if (urlJoined) params.set('joined', urlJoined);
    if (urlSpend) params.set('spend', urlSpend);
    if (urlLimit !== 20) params.set('limit', String(urlLimit));
    const query = params.toString();
    return `/studio/customers${query ? `?${query}` : ''}`;
  });
</script>

<svelte:head>
  <title>{m.studio_customers_title()} | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="customers-page">
  {#if customersQuery?.loading}
    <PageHeader title={m.studio_customers_title()} />
    <div class="table-skeleton">
      <div class="skeleton table-skeleton-header" style="width: 100%; height: var(--space-10);"></div>
      {#each Array(5) as _}
        <div class="table-skeleton-row">
          <div class="skeleton" style="width: 40%; height: var(--space-5);"></div>
          <div class="skeleton" style="width: 25%; height: var(--space-5);"></div>
          <div class="skeleton" style="width: 15%; height: var(--space-5);"></div>
          <div class="skeleton" style="width: 15%; height: var(--space-5);"></div>
        </div>
      {/each}
    </div>
  {:else}
    {@const currentPage = pagination.page ?? 1}
    {@const totalPages = Math.max(1, pagination.totalPages ?? 0)}
    {@const hasCustomers = rawItems.length > 0 || currentPage > 1}

    <PageHeader title={m.studio_customers_title()}>
      {#snippet actions()}
        {#if hasCustomers && totalCustomers > 0}
          <span class="count-badge">{totalCustomers}</span>
        {/if}
        {#if rawItems.length > 0}
          <Button variant="secondary" size="sm" onclick={exportCsv}>
            <DownloadIcon size={14} />
            {m.studio_customers_export_csv()}
          </Button>
        {/if}
      {/snippet}
    </PageHeader>

    {#if hasCustomers}
      <!-- FilterBar: search + client-side filters -->
      <FilterBar
        filters={filterConfigs}
        values={filterValues}
        onFilterChange={handleFilterChange}
        showActiveChips
      />

      <!-- Stats bar -->
      <section class="stats-bar" role="group" aria-label={m.studio_customers_stat_total_customers()}>
        <div class="stat-card">
          <span class="stat-label">{m.studio_customers_stat_total_customers()}</span>
          <span class="stat-value">{totalCustomers}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">{m.studio_customers_stat_page_revenue()}</span>
          <span class="stat-value">{formatPrice(pageRevenue)}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">{m.studio_customers_stat_page_avg_spend()}</span>
          <span class="stat-value">{formatPrice(avgSpend)}</span>
        </div>
      </section>

      <!-- DataTable -->
      {#key tableKey}
        <CustomerTable
          customers={sortedCustomers}
          onCustomerClick={handleCustomerClick}
          onCopyEmail={handleCopyEmail}
          {sortKey}
          {sortOrder}
          onSort={handleSort}
          selectable
        >
          {#snippet bulkActions(selectedIds: Set<string>)}
            <Button variant="primary" size="sm" onclick={() => openBulkGrant(selectedIds)}>
              {m.studio_customers_bulk_grant_access()}
            </Button>
          {/snippet}
        </CustomerTable>
      {/key}

      <!-- Pagination + page size -->
      {#if totalPages > 1 || urlLimit !== 20}
        <div class="pagination-wrapper">
          {#if totalPages > 1}
            <Pagination
              {currentPage}
              {totalPages}
              baseUrl={paginationBaseUrl}
            />
          {/if}
          <div class="page-size">
            <label for="page-size-select" class="page-size-label">
              {m.studio_customers_page_size()}
            </label>
            <select
              id="page-size-select"
              class="page-size-select"
              value={String(urlLimit)}
              onchange={handlePageSizeChange}
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </select>
          </div>
        </div>
      {/if}
    {:else}
      <EmptyState title={m.studio_customers_empty()} description={m.studio_customers_empty_description()} icon={UsersIcon} />
    {/if}
  {/if}
</div>

<CustomerDetailDrawer
  bind:open={drawerOpen}
  customerId={selectedCustomerId}
  orgId={data.org?.id}
/>

<BulkGrantAccessDialog
  bind:open={bulkGrantOpen}
  customerIds={bulkGrantCustomerIds}
  orgId={data.org?.id ?? ''}
  onSuccess={handleBulkGrantSuccess}
/>

<style>
  .customers-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .count-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--space-6);
    height: var(--space-6);
    padding: 0 var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-full, 9999px);
  }

  /* ── Stats bar ────────────────────────────────────────────────────── */
  .stats-bar {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
  }

  .stat-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4);
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .stat-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  @media (--below-sm) {
    .stats-bar {
      grid-template-columns: 1fr;
    }
  }

  /* ── Filtered notice ──────────────────────────────────────────────── */
  .filtered-notice {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* ── Pagination + page size ───────────────────────────────────────── */
  .pagination-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-6);
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .page-size {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .page-size-label {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .page-size-select {
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    font-family: var(--font-sans);
    color: var(--color-text);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
  }

  .page-size-select:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 1px;
  }

  /* ── Skeleton Loading States ─────────────────────────────────────── */
  .table-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .table-skeleton-header {
    border-radius: 0;
  }

  .table-skeleton-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
  }

  .skeleton {
    background: linear-gradient(
      90deg,
      var(--color-surface-secondary) 25%,
      var(--color-surface-tertiary) 50%,
      var(--color-surface-secondary) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: var(--radius-md);
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>

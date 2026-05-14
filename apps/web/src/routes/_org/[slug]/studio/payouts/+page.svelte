<!--
  @component StudioPayouts (Codex-zqaxo, rebuilt Codex-05vp8)

  Owner-only payouts ledger surface for the org. Shows every transfer
  event (success/pending/failed) with KPI cards, an exception banner,
  status + date-range filters, and a Stripe deep-link per paid row.

  Backend data flow:
    listPayouts() remote query → api.subscription.listPayouts
      → GET ecom-api `/subscriptions/payouts`
      → SubscriptionService.listPayoutsByOrg (org-scoped)

    getPayoutSummary() remote query → api.subscription.getPayoutSummary
      → GET ecom-api `/subscriptions/payouts/summary`
      → SubscriptionService.getPayoutSummary (org-scoped aggregates)

  Mirrors /studio/sales URL-sync + snapshot-query pattern. NO TanStack
  DB live collection — each filter/page change re-issues the remote
  queries.

  @prop data - Org info + userRole from parent studio layout
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { Alert, Badge, EmptyState, Skeleton } from '$lib/components/ui';
  import * as Card from '$lib/components/ui/Card';
  import * as Table from '$lib/components/ui/Table';
  import Select from '$lib/components/ui/Select/Select.svelte';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import {
    AlertTriangleIcon,
    BanknoteIcon,
    CopyIcon,
    ExternalLinkIcon,
  } from '$lib/components/ui/Icon';
  import Avatar from '$lib/components/ui/Avatar/Avatar.svelte';
  import AvatarImage from '$lib/components/ui/Avatar/AvatarImage.svelte';
  import AvatarFallback from '$lib/components/ui/Avatar/AvatarFallback.svelte';
  import KPICard from '$lib/components/studio/analytics/KPICard.svelte';
  import {
    getPayoutSummary,
    listPayouts,
  } from '$lib/remote/subscription.remote';
  import { formatDate, formatPrice, getInitials } from '$lib/utils/format';
  import type {
    PayoutSummary,
    PayoutWithCreator,
  } from '@codex/subscription';
  import type { QueryResult } from '$lib/remote/query-result';

  type PayoutsPage = {
    items: PayoutWithCreator[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };

  type DateRange = '7' | '30' | '90' | 'all';
  type StatusFilter =
    | 'all'
    | 'paid'
    | 'resolved' // legacy URL alias for 'paid'
    | 'pending'
    | 'failed'
    | 'needs_attention';

  let { data } = $props();

  // Role guard — owner only. Mirror billing/monetisation/sales pattern.
  $effect(() => {
    if (data.userRole !== 'owner') {
      goto('/studio');
    }
  });

  const isOwner = $derived(data.userRole === 'owner');
  const orgId = $derived(data.org.id);

  // ── URL-derived state ────────────────────────────────────────────────
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

  // ── Date-range → ISO bounds (window applies to both list + summary) ──
  const dateBounds = $derived.by(() => {
    if (rangeFilter === 'all') return { fromDate: undefined };
    const days = rangeFilter === '7' ? 7 : rangeFilter === '90' ? 90 : 30;
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - days);
    return { fromDate: from.toISOString() };
  });

  // ── Remote queries ───────────────────────────────────────────────────
  const payoutsQuery = $derived(
    isOwner && orgId
      ? listPayouts({
          organizationId: orgId,
          status: statusFilter,
          page: currentUrlPage,
          limit,
          ...(dateBounds.fromDate && { fromDate: dateBounds.fromDate }),
        })
      : null
  );

  const summaryQuery = $derived(
    isOwner && orgId
      ? getPayoutSummary({
          organizationId: orgId,
          ...(dateBounds.fromDate && { fromDate: dateBounds.fromDate }),
        })
      : null
  );

  const payoutsData = $derived(
    (payoutsQuery as QueryResult<PayoutsPage> | null)?.current
  );
  const summary = $derived(
    (summaryQuery as QueryResult<PayoutSummary> | null)?.current
  );

  const loading = $derived(
    (payoutsQuery as QueryResult<PayoutsPage> | null)?.loading ?? true
  );
  const summaryLoading = $derived(
    (summaryQuery as QueryResult<PayoutSummary> | null)?.loading ?? true
  );

  const queryError = $derived(
    (payoutsQuery as QueryResult<PayoutsPage> | null)?.error?.message ?? null
  );

  const items = $derived(payoutsData?.items ?? []);
  const pagination = $derived(payoutsData?.pagination);
  const isEmpty = $derived(!loading && items.length === 0);

  // ── Filter handlers ──────────────────────────────────────────────────
  // Default values per URL key — same pattern as /studio/sales:
  // setUrlParam strips a key from the URL when its value matches the
  // default, keeping URLs short while preserving any non-default state.
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
    goto(`/studio/payouts${qs ? `?${qs}` : ''}`, {
      replaceState: true,
      keepFocus: true,
    });
  }

  const rangeOptions: Array<{ value: DateRange; label: string }> = [
    { value: '7', label: 'Last 7 days' },
    { value: '30', label: 'Last 30 days' },
    { value: '90', label: 'Last 90 days' },
    { value: 'all', label: 'All time' },
  ];

  const statusOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: 'all', label: 'All statuses' },
    { value: 'paid', label: 'Paid' },
    { value: 'pending', label: 'Pending' },
    { value: 'failed', label: 'Failed' },
    { value: 'needs_attention', label: 'Needs attention' },
  ];

  // KPI label dynamics — "Earned (last 7d)" etc. The "all time" case is
  // collapsed to the same label as Total earned in practice; we still
  // render the windowed card to keep the row stable.
  const RANGE_LABELS: Record<DateRange, string> = {
    '7': 'last 7 days',
    '30': 'last 30 days',
    '90': 'last 90 days',
    all: 'all time',
  };
  const rangeLabel = $derived(RANGE_LABELS[rangeFilter]);

  // ── Badge variant + label helpers ────────────────────────────────────
  // Token-aligned status mapping: pending = warning, resolved/paid =
  // success, failed = error.
  function statusVariant(
    status: PayoutWithCreator['status']
  ): 'warning' | 'success' | 'error' {
    if (status === 'resolved') return 'success';
    if (status === 'failed') return 'error';
    return 'warning';
  }

  function statusLabel(status: PayoutWithCreator['status']): string {
    if (status === 'resolved') return 'Paid';
    if (status === 'failed') return 'Failed';
    return 'Pending';
  }

  /**
   * Human-readable label for `payouts.payoutType` enum:
   *   - organization_fee → "Org fee"
   *   - creator_payout_to_owner → "Creator pool"
   *   - creator_payout → "Creator share"
   */
  function typeLabel(t: PayoutWithCreator['payoutType']): string {
    if (t === 'organization_fee') return 'Org fee';
    if (t === 'creator_payout_to_owner') return 'Creator pool';
    return 'Creator share';
  }

  /**
   * Human-readable reason string. The DB enum is `connect_not_ready |
   * connect_restricted | transfer_failed | min_transfer_floor`.
   */
  function reasonLabel(reason: string): string {
    switch (reason) {
      case 'connect_not_ready':
        return 'Connect onboarding incomplete';
      case 'connect_restricted':
        return 'Connect account restricted';
      case 'transfer_failed':
        return 'Transfer failed';
      case 'min_transfer_floor':
        return 'Below minimum transfer';
      default:
        return reason;
    }
  }

  /**
   * Truncate a Stripe Transfer ID (`tr_xxxxxxxxxxxxxxxxxx`) to a compact
   * `tr_xxxx…xxxx`. The full id is preserved as a tooltip and copy-button
   * payload.
   */
  function truncateTransferId(id: string): string {
    if (id.length <= 12) return id;
    return `${id.slice(0, 6)}…${id.slice(-4)}`;
  }

  let copiedTransferId = $state<string | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  async function copyTransferId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      copiedTransferId = id;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copiedTransferId = null;
      }, 2000);
    } catch {
      // navigator.clipboard can be blocked (non-secure context); fail
      // silently — the title attribute lets the user copy manually.
    }
  }

  function stripeTransferUrl(id: string): string {
    return `https://dashboard.stripe.com/connect/transfers/${id}`;
  }
</script>

<svelte:head>
  <title>Payouts | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#if !isOwner}
  <!-- Redirecting to /studio… -->
{:else}
  <div class="payouts">
    <header class="payouts-header">
      <h1 class="payouts-title">Payouts</h1>
      <p class="payouts-subtitle">
        Every transfer Stripe makes on your organisation's behalf.
        Subscription invoices split into an organisation fee plus one
        creator-share row per beneficiary.
      </p>
    </header>

    <!-- ── KPI row ──────────────────────────────────────────────────── -->
    <div class="kpi-row">
      <KPICard
        label="Earned ({rangeLabel})"
        value={summary?.earnedInPeriodCents ?? 0}
        format="money"
        loading={summaryLoading}
      />
      <KPICard
        label="Total earned"
        value={summary?.totalEarnedCents ?? 0}
        format="money"
        loading={summaryLoading}
      />
      <KPICard
        label="In transit"
        value={summary?.inTransitCents ?? 0}
        format="money"
        loading={summaryLoading}
      />
    </div>

    <!-- ── Exception banner (only when needsAttention > 0) ──────────── -->
    {#if summary && summary.needsAttentionCount > 0 && statusFilter !== 'needs_attention'}
      <Alert variant="warning">
        <span class="banner-text">
          <AlertTriangleIcon size={16} />
          <strong>{summary.needsAttentionCount}</strong>
          payout{summary.needsAttentionCount === 1 ? '' : 's'} need attention
          — Connect onboarding incomplete, transfers failed, or amounts
          below the minimum-transfer floor.
        </span>
        <Button
          variant="secondary"
          onclick={() => setUrlParam('status', 'needs_attention')}
        >
          Review
        </Button>
      </Alert>
    {/if}

    <Card.Root>
      <Card.Header>
        <div class="filters">
          <Select
            options={statusOptions}
            value={statusFilter}
            label="Filter by status"
            onValueChange={(v) => v && setUrlParam('status', v)}
            class="status-filter"
          />
          <Select
            options={rangeOptions}
            value={rangeFilter}
            label="Date range"
            onValueChange={(v) => v && setUrlParam('range', v)}
            class="range-filter"
          />
        </div>
      </Card.Header>

      <Card.Content>
        {#if queryError}
          <Alert variant="error">
            Could not load payouts: {queryError}
          </Alert>
        {:else if loading}
          <div class="table-skeleton" aria-busy="true" aria-live="polite">
            <Skeleton width="100%" height="var(--space-10)" />
            {#each Array(5) as _, i (i)}
              <div class="table-skeleton-row">
                <Skeleton width="14%" height="var(--space-5)" />
                <Skeleton width="22%" height="var(--space-5)" />
                <Skeleton width="14%" height="var(--space-5)" />
                <Skeleton width="18%" height="var(--space-5)" />
                <Skeleton width="12%" height="var(--space-5)" />
                <Skeleton width="20%" height="var(--space-5)" />
              </div>
            {/each}
          </div>
        {:else if isEmpty}
          <EmptyState
            title="No payouts yet"
            description="Payouts will appear here once subscription invoices land and Stripe transfers the org and creator shares."
            icon={BanknoteIcon}
          >
            {#snippet action()}
              <a href="/studio/monetisation" class="empty-link">
                <Button variant="secondary">Go to Monetisation</Button>
              </a>
            {/snippet}
          </EmptyState>
        {:else}
          <div class="table-wrapper">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Date</Table.Head>
                  <Table.Head>From</Table.Head>
                  <Table.Head>Type</Table.Head>
                  <Table.Head>Beneficiary</Table.Head>
                  <Table.Head class="amount-head">Amount</Table.Head>
                  <Table.Head>Status</Table.Head>
                  <Table.Head>Transfer / Reason</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#each items as payout (payout.id)}
                  <Table.Row>
                    <Table.Cell>
                      <span
                        class="date-cell"
                        title={new Date(payout.createdAt).toISOString()}
                      >
                        {formatDate(payout.createdAt)}
                      </span>
                    </Table.Cell>

                    <Table.Cell>
                      <span class="from-cell">
                        {payout.subscriberName ??
                          payout.subscriberEmail ??
                          '—'}
                      </span>
                    </Table.Cell>

                    <Table.Cell>
                      <Badge variant="info">
                        {typeLabel(payout.payoutType)}
                      </Badge>
                    </Table.Cell>

                    <Table.Cell>
                      <span class="creator-cell">
                        <Avatar class="creator-avatar">
                          {#if payout.creatorAvatarUrl}
                            <AvatarImage
                              src={payout.creatorAvatarUrl}
                              alt={payout.creatorName ?? payout.creatorEmail ?? ''}
                            />
                          {/if}
                          <AvatarFallback>
                            {getInitials(
                              payout.creatorName,
                              payout.creatorEmail
                            )}
                          </AvatarFallback>
                        </Avatar>
                        <span class="creator-name">
                          {payout.creatorName ??
                            payout.creatorEmail ??
                            'Unknown'}
                        </span>
                      </span>
                    </Table.Cell>

                    <Table.Cell class="amount-cell">
                      {formatPrice(payout.amountCents)}
                    </Table.Cell>

                    <Table.Cell>
                      <Badge variant={statusVariant(payout.status)}>
                        {statusLabel(payout.status)}
                      </Badge>
                    </Table.Cell>

                    <Table.Cell>
                      {#if payout.status === 'resolved' && payout.stripeTransferId}
                        <span class="transfer-cell">
                          <code
                            class="transfer-id"
                            title={payout.stripeTransferId}
                          >
                            {truncateTransferId(payout.stripeTransferId)}
                          </code>
                          <button
                            type="button"
                            class="icon-btn"
                            onclick={() =>
                              copyTransferId(payout.stripeTransferId!)}
                            aria-label="Copy Stripe transfer ID {payout.stripeTransferId}"
                            title={copiedTransferId === payout.stripeTransferId
                              ? 'Copied!'
                              : 'Copy transfer ID'}
                          >
                            <CopyIcon size={14} />
                          </button>
                          <a
                            class="icon-btn"
                            href={stripeTransferUrl(payout.stripeTransferId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Open transfer in Stripe Dashboard"
                            title="Open in Stripe Dashboard"
                          >
                            <ExternalLinkIcon size={14} />
                          </a>
                        </span>
                      {:else}
                        <span
                          class="reason-cell"
                          class:reason-cell--failed={payout.status === 'failed'}
                        >
                          {#if payout.status === 'failed'}
                            <AlertTriangleIcon size={14} />
                          {/if}
                          {reasonLabel(payout.reason)}
                        </span>
                      {/if}
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          </div>

          {#if pagination && pagination.totalPages > 1}
            <nav class="pagination" aria-label="Payout pagination">
              <Button
                variant="secondary"
                disabled={currentUrlPage <= 1}
                onclick={() =>
                  setUrlParam('page', String(currentUrlPage - 1))}
              >
                Previous
              </Button>
              <span class="pagination-status">
                Page {pagination.page} of {pagination.totalPages}
                <span class="pagination-total">
                  · {pagination.total} payout{pagination.total === 1
                    ? ''
                    : 's'}
                </span>
              </span>
              <Button
                variant="secondary"
                disabled={currentUrlPage >= pagination.totalPages}
                onclick={() =>
                  setUrlParam('page', String(currentUrlPage + 1))}
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
  .payouts {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 1200px;
  }

  .payouts-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .payouts-title {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
    line-height: var(--leading-tight);
  }

  .payouts-subtitle {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
    max-width: 720px;
    margin: 0;
  }

  .kpi-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-4);
  }

  @media (max-width: 720px) {
    .kpi-row {
      grid-template-columns: 1fr;
    }
  }

  .banner-text {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: flex-end;
  }

  .filters :global(.status-filter),
  .filters :global(.range-filter) {
    min-width: 200px;
    max-width: 260px;
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

  .from-cell {
    font-size: var(--text-sm);
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 20ch;
    display: inline-block;
  }

  .creator-cell {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  :global(.creator-avatar) {
    width: var(--space-7) !important;
    height: var(--space-7) !important;
    flex-shrink: 0 !important;
  }

  .creator-name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 14ch;
  }

  :global(.amount-head),
  :global(.amount-cell) {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-medium);
  }

  .transfer-cell {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .transfer-id {
    font-family: var(--font-mono, monospace);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    background-color: var(--color-surface-secondary);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-sm);
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-7);
    height: var(--space-7);
    background: transparent;
    border: var(--border-width) var(--border-style) transparent;
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    cursor: pointer;
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .icon-btn:hover {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .icon-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .reason-cell {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .reason-cell--failed {
    color: var(--color-error-700);
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

  .empty-link {
    text-decoration: none;
    color: inherit;
  }
</style>

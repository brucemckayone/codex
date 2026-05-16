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
  import CreatorBreakdownRail from '$lib/components/studio/payouts/CreatorBreakdownRail.svelte';
  import {
    getPayoutSummary,
    getPayoutsByCreatorBreakdown,
    listPayouts,
  } from '$lib/remote/subscription.remote';
  import { formatDate, formatPrice, getInitials } from '$lib/utils/format';
  import type {
    CreatorPayoutBreakdown,
    PayoutSourceFilter,
    PayoutStatusFilter,
    PayoutSummary,
    PayoutWithCreator,
  } from '@codex/subscription';
  import type { DateRange } from '@codex/shared-types';
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

  // Filter unions reused from shared packages — DateRange is generic
  // (sales page consumes the same), Status/Source are payout-specific
  // (canonical enums live in @codex/validation, re-exported via
  // @codex/subscription).
  type StatusFilter = PayoutStatusFilter;
  type SourceFilter = PayoutSourceFilter;

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
  const sourceFilter = $derived(
    (page.url.searchParams.get('source') as SourceFilter) || 'all'
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
          source: sourceFilter,
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

  // Per-creator breakdown for the right rail — same filter args as the
  // table so both surfaces stay in sync. Always issues when owner
  // resolves, regardless of pagination (the rail aggregates the whole
  // filtered set, not the current page).
  const creatorBreakdownQuery = $derived(
    isOwner && orgId
      ? getPayoutsByCreatorBreakdown({
          organizationId: orgId,
          status: statusFilter,
          source: sourceFilter,
          ...(dateBounds.fromDate && { fromDate: dateBounds.fromDate }),
        })
      : null
  );

  const creatorBreakdown = $derived(
    (creatorBreakdownQuery as QueryResult<CreatorPayoutBreakdown[]> | null)
      ?.current ?? []
  );
  const creatorBreakdownLoading = $derived(
    (creatorBreakdownQuery as QueryResult<CreatorPayoutBreakdown[]> | null)
      ?.loading ?? true
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

  // ── Transaction grouping (Codex-6nt4l) ───────────────────────────────
  // Every charge generates 3 sibling rows (platform_fee + organization_fee
  // + creator_payout) sharing the same `transferGroup`. Group them so the
  // table reads as "one transaction per group header + indented children"
  // rather than 3× as many flat rows. Pre-h69cg historical rows have no
  // `transferGroup` — fall back to row id so they render as a 1-row group
  // (still gets a header, just with a one-row child list).
  type PayoutGroup = {
    key: string;
    source: PayoutWithCreator['sourceType'];
    subscriberName: string | null;
    subscriberEmail: string | null;
    createdAt: string;
    rows: PayoutWithCreator[];
    totalCents: number;
  };

  // Render order within a group: ledger flow follows the money outward
  // from the platform → org → creator. `creator_payout_to_owner` sits
  // between because it routes the org owner's share of multi-creator pools.
  const PAYOUT_TYPE_ORDER: Record<PayoutWithCreator['payoutType'], number> = {
    platform_fee: 0,
    organization_fee: 1,
    creator_payout_to_owner: 2,
    creator_payout: 3,
  };

  const groupedTransactions = $derived.by<PayoutGroup[]>(() => {
    const map = new Map<string, PayoutGroup>();
    for (const row of items) {
      const key = row.transferGroup ?? row.id;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          source: row.sourceType,
          subscriberName: row.subscriberName,
          subscriberEmail: row.subscriberEmail,
          createdAt: row.createdAt,
          rows: [],
          totalCents: 0,
        };
        map.set(key, g);
      }
      g.rows.push(row);
      g.totalCents += row.amountCents;
    }
    for (const g of map.values()) {
      g.rows.sort(
        (a, b) =>
          (PAYOUT_TYPE_ORDER[a.payoutType] ?? 99) -
          (PAYOUT_TYPE_ORDER[b.payoutType] ?? 99)
      );
    }
    // Groups sort by createdAt desc to match the table's existing
    // server-side ORDER BY desc(payouts.createdAt).
    return Array.from(map.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  });

  // ── Filter handlers ──────────────────────────────────────────────────
  // Default values per URL key — same pattern as /studio/sales:
  // setUrlParam strips a key from the URL when its value matches the
  // default, keeping URLs short while preserving any non-default state.
  const URL_DEFAULTS: Record<string, string> = {
    range: '30',
    status: 'all',
    source: 'all',
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
    { value: 'reversed', label: 'Reversed' },
    { value: 'cancelled_by_refund', label: 'Cancelled (refund)' },
    { value: 'needs_attention', label: 'Needs attention' },
  ];

  const sourceOptions: Array<{ value: SourceFilter; label: string }> = [
    { value: 'all', label: 'All sources' },
    { value: 'purchase', label: 'Purchase' },
    { value: 'subscription', label: 'Subscription' },
  ];

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
  ): 'warning' | 'success' | 'error' | 'info' {
    if (status === 'resolved') return 'success';
    if (status === 'failed') return 'error';
    if (status === 'reversed') return 'info';
    if (status === 'cancelled_by_refund') return 'info';
    return 'warning';
  }

  function statusLabel(status: PayoutWithCreator['status']): string {
    if (status === 'resolved') return 'Paid';
    if (status === 'failed') return 'Failed';
    if (status === 'reversed') return 'Reversed';
    if (status === 'cancelled_by_refund') return 'Cancelled (refund)';
    return 'Pending';
  }

  /**
   * Human-readable label for `payouts.payoutType` enum:
   *   - platform_fee → "Platform fee" (Codex-h69cg tri-party row)
   *   - organization_fee → "Org fee"
   *   - creator_payout_to_owner → "Creator pool"
   *   - creator_payout → "Creator share"
   */
  function typeLabel(t: PayoutWithCreator['payoutType']): string {
    if (t === 'platform_fee') return 'Platform fee';
    if (t === 'organization_fee') return 'Org fee';
    if (t === 'creator_payout_to_owner') return 'Creator pool';
    return 'Creator share';
  }

  function sourceLabel(s: PayoutWithCreator['sourceType']): string {
    return s === 'purchase' ? 'Purchase' : 'Subscription';
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

    <div class="payouts-grid">
    <div class="payouts-main">
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
            options={sourceOptions}
            value={sourceFilter}
            label="Source"
            onValueChange={(v) => v && setUrlParam('source', v)}
            class="source-filter"
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
                {#each groupedTransactions as group (group.key)}
                  <!-- Group header: one row per transaction, banner-styled
                       with date + source pill + subscriber + gross total.
                       colspan=7 spans the whole table width. -->
                  <Table.Row data-row-kind="header">
                    <Table.Cell colspan={7} class="group-header-cell">
                      <span class="group-header">
                        <span class="group-header__left">
                          <span
                            class="date-cell"
                            title={new Date(group.createdAt).toISOString()}
                          >
                            {formatDate(group.createdAt)}
                          </span>
                          <Badge variant="info">
                            {sourceLabel(group.source)}
                          </Badge>
                          <span class="group-header__subscriber">
                            From: {group.subscriberName ??
                              group.subscriberEmail ??
                              '—'}
                          </span>
                        </span>
                        <span class="group-header__total">
                          {formatPrice(group.totalCents)}
                        </span>
                      </span>
                    </Table.Cell>
                  </Table.Row>

                  {#each group.rows as payout (payout.id)}
                    <Table.Row data-row-kind="child">
                      <!-- Date + From are blank for child rows; the header
                           carries them so the indent reads as "this row
                           belongs to the transaction above". -->
                      <Table.Cell class="child-spacer-cell" />
                      <Table.Cell />

                      <Table.Cell>
                        <span class="type-cell">
                          <Badge variant="info">
                            {typeLabel(payout.payoutType)}
                          </Badge>
                        </span>
                      </Table.Cell>

                      <Table.Cell>
                        {#if payout.payoutType === 'platform_fee'}
                          <span class="creator-cell platform-cell">
                            <span class="creator-name">Platform</span>
                          </span>
                        {:else}
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
                        {/if}
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

    <div class="payouts-rail">
      <CreatorBreakdownRail
        breakdown={creatorBreakdown}
        loading={creatorBreakdownLoading}
        activeFilters={{
          status: statusFilter,
          source: sourceFilter,
          range: rangeFilter,
        }}
      />
    </div>
    </div>
  </div>
{/if}

<style>
  .payouts {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 1280px;
  }

  /* Two-column shell: main content on the left (KPIs + filters +
     transaction table), sticky per-creator rail on the right. Below
     1024px the rail stacks below the main content as a regular section
     — preserves the rail's affordance without crowding narrower screens. */
  .payouts-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: var(--space-6);
    align-items: start;
  }

  .payouts-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
  }

  .payouts-rail {
    position: sticky;
    top: var(--space-6);
  }

  @media (max-width: 1024px) {
    .payouts-grid {
      grid-template-columns: 1fr;
    }
    .payouts-rail {
      position: static;
    }
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
  .filters :global(.source-filter),
  .filters :global(.range-filter) {
    min-width: 200px;
    max-width: 260px;
  }

  .type-cell {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    white-space: nowrap;
  }

  .platform-cell {
    font-style: italic;
    color: var(--color-text-secondary);
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

  /* ── Transaction grouping (Codex-6nt4l) ──────────────────────────── */

  /* Group header row: full-width banner on tinted surface so the eye
     sees "one transaction" before reading its 3 indented children. */
  :global(tr[data-row-kind='header']) {
    background-color: var(--color-surface-secondary);
  }

  :global(tr[data-row-kind='header']:hover) {
    background-color: var(--color-surface-secondary);
  }

  :global(.group-header-cell) {
    padding: var(--space-3) var(--space-4);
  }

  .group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .group-header__left {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .group-header__subscriber {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .group-header__total {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  /* Indent the first child cell so siblings read as belonging to the
     group above. Using padding-inline-start on the first cell keeps the
     remaining column grid intact. */
  :global(tr[data-row-kind='child'] .child-spacer-cell) {
    padding-inline-start: var(--space-6);
  }
</style>

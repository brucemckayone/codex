<!--
  @component StudioSubscribers (Codex-1csms)

  Owner-only studio surface listing every active/cancelling/past_due
  subscriber on the org, with tier chip filters, a "show cancelled" toggle,
  and CSV export. Mirrors /studio/payouts: client-side $effect redirect for
  non-owners, snapshot query semantics (no live collection in Phase 1).
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
  import { HeartIcon, DownloadIcon } from '$lib/components/ui/Icon';
  import Avatar from '$lib/components/ui/Avatar/Avatar.svelte';
  import AvatarImage from '$lib/components/ui/Avatar/AvatarImage.svelte';
  import AvatarFallback from '$lib/components/ui/Avatar/AvatarFallback.svelte';
  import {
    listSubscribers,
    listTiers,
  } from '$lib/remote/subscription.remote';
  import { formatDate, formatPrice, getInitials } from '$lib/utils/format';
  import { downloadCsv } from '$lib/utils/csv-export';
  import type { SubscriberListItem } from '@codex/subscription';
  import type { QueryResult } from '$lib/remote/query-result';

  type SubscribersPage = {
    items: SubscriberListItem[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };

  type TierRow = {
    id: string;
    name: string;
    priceMonthly: number;
  };

  let { data } = $props();

  // Owner gate — non-owners get bounced to /studio. Worker-level the route is
  // requireOrgManagement (owner OR admin), so this redirect is the strict
  // owner-only enforcement. Same pattern as /studio/payouts and /studio/billing.
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
  const tierIdFilter = $derived(
    page.url.searchParams.get('tierId') || undefined
  );
  const includeCancelled = $derived(
    page.url.searchParams.get('cancelled') === '1'
  );
  const limit = 20;

  // ── Remote queries ───────────────────────────────────────────────────
  const tiersQuery = $derived(
    isOwner && orgId ? listTiers(orgId) : null
  );
  const tierRows = $derived(
    ((tiersQuery as QueryResult<TierRow[]> | null)?.current ?? []) as TierRow[]
  );

  const subscribersQuery = $derived(
    isOwner && orgId
      ? listSubscribers({
          organizationId: orgId,
          page: currentUrlPage,
          limit,
          ...(tierIdFilter && { tierId: tierIdFilter }),
          ...(includeCancelled && { includeCancelled: true }),
        })
      : null
  );

  const subsData = $derived(
    (subscribersQuery as QueryResult<SubscribersPage> | null)?.current
  );
  const loading = $derived(
    (subscribersQuery as QueryResult<SubscribersPage> | null)?.loading ?? true
  );
  const queryError = $derived(
    (subscribersQuery as QueryResult<SubscribersPage> | null)?.error?.message ??
      null
  );

  const items = $derived(subsData?.items ?? []);
  const pagination = $derived(subsData?.pagination);
  const isEmpty = $derived(!loading && items.length === 0);

  // ── Handlers ─────────────────────────────────────────────────────────
  function setUrlParam(key: string, value: string | null) {
    const params = new URLSearchParams(page.url.searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    if (key !== 'page') params.delete('page'); // any filter change resets page
    const qs = params.toString();
    goto(`/studio/subscribers${qs ? `?${qs}` : ''}`, {
      replaceState: true,
      keepFocus: true,
    });
  }

  function selectTier(tierId: string | undefined) {
    setUrlParam('tierId', tierId ?? null);
  }

  function toggleCancelled() {
    setUrlParam('cancelled', includeCancelled ? null : '1');
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
  const SUBSCRIBER_STATUS_VARIANT: Record<
    string,
    'success' | 'warning' | 'error' | 'neutral'
  > = {
    active: 'success',
    cancelling: 'warning',
    past_due: 'error',
    cancelled: 'neutral',
  };
  function statusVariant(status: string) {
    return SUBSCRIBER_STATUS_VARIANT[status] ?? 'neutral';
  }

  function statusLabel(s: string): string {
    return s.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // ── CSV export ───────────────────────────────────────────────────────
  function exportCsv() {
    const headers = [
      'Name',
      'Email',
      'Tier',
      'Status',
      'Billing',
      'Amount (GBP)',
      'Renews',
      'Joined',
    ];
    const rows = items.map((s) => [
      s.userName ?? '',
      s.userEmail,
      s.tierName,
      s.status,
      s.billingInterval,
      (s.amountCents / 100).toFixed(2),
      s.currentPeriodEnd ? s.currentPeriodEnd.split('T')[0] : '',
      s.createdAt.split('T')[0],
    ]);
    downloadCsv(
      `subscribers-${new Date().toISOString().split('T')[0]}.csv`,
      headers,
      rows
    );
  }
</script>

<svelte:head>
  <title>Subscribers | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#if !isOwner}
  <!-- redirecting -->
{:else}
  <div class="subscribers">
    <header class="subscribers-header">
      <div class="header-text">
        <h1 class="subscribers-title">Subscribers</h1>
        <p class="subscribers-subtitle">
          Everyone currently subscribed to this organisation, broken down by
          tier. Toggle "Show cancelled" to include past subscribers.
        </p>
      </div>
      {#if items.length > 0}
        <Button variant="secondary" size="sm" onclick={exportCsv}>
          <DownloadIcon size={14} />
          Export CSV
        </Button>
      {/if}
    </header>

    <Card.Root>
      <Card.Header>
        <div class="filters">
          <div class="tier-chips" role="group" aria-label="Filter by tier">
            <button
              type="button"
              class="chip"
              class:chip--active={!tierIdFilter}
              onclick={() => selectTier(undefined)}
            >
              All tiers
            </button>
            {#each tierRows as tier (tier.id)}
              <button
                type="button"
                class="chip"
                class:chip--active={tierIdFilter === tier.id}
                onclick={() => selectTier(tier.id)}
              >
                {tier.name}
              </button>
            {/each}
          </div>
          <label class="cancelled-toggle">
            <input
              type="checkbox"
              checked={includeCancelled}
              onchange={toggleCancelled}
            />
            <span>Show cancelled</span>
          </label>
        </div>
      </Card.Header>

      <Card.Content>
        {#if queryError}
          <Alert variant="error">Could not load subscribers: {queryError}</Alert>
        {:else if loading}
          <div class="table-skeleton" aria-busy="true" aria-live="polite">
            <Skeleton width="100%" height="var(--space-10)" />
            {#each Array(5) as _, i (i)}
              <div class="table-skeleton-row">
                <Skeleton width="28%" height="var(--space-5)" />
                <Skeleton width="18%" height="var(--space-5)" />
                <Skeleton width="14%" height="var(--space-5)" />
                <Skeleton width="14%" height="var(--space-5)" />
                <Skeleton width="14%" height="var(--space-5)" />
              </div>
            {/each}
          </div>
        {:else if isEmpty}
          <EmptyState
            title={includeCancelled || tierIdFilter
              ? 'No subscribers match'
              : 'No subscribers yet'}
            description={includeCancelled || tierIdFilter
              ? 'Try clearing the filters to see all current subscribers.'
              : 'Once people subscribe to one of your tiers they will appear here.'}
            icon={HeartIcon}
          >
            {#snippet action()}
              <a href="/studio/monetisation" class="empty-link">
                <Button variant="secondary">Manage tiers</Button>
              </a>
            {/snippet}
          </EmptyState>
        {:else}
          <div class="table-wrapper">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Subscriber</Table.Head>
                  <Table.Head>Tier</Table.Head>
                  <Table.Head>Status</Table.Head>
                  <Table.Head class="amount-head">Amount</Table.Head>
                  <Table.Head>Renews</Table.Head>
                  <Table.Head>Joined</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#each items as sub (sub.id)}
                  <Table.Row>
                    <Table.Cell>
                      <span class="subscriber-cell">
                        <Avatar class="sub-avatar">
                          {#if sub.userAvatarUrl}
                            <AvatarImage
                              src={sub.userAvatarUrl}
                              alt={sub.userName ?? sub.userEmail}
                            />
                          {/if}
                          <AvatarFallback>
                            {getInitials(sub.userName, sub.userEmail)}
                          </AvatarFallback>
                        </Avatar>
                        <span class="subscriber-text">
                          <span class="subscriber-name">
                            {sub.userName ?? sub.userEmail}
                          </span>
                          {#if sub.userName}
                            <span class="subscriber-email">{sub.userEmail}</span>
                          {/if}
                        </span>
                      </span>
                    </Table.Cell>
                    <Table.Cell>{sub.tierName}</Table.Cell>
                    <Table.Cell>
                      <Badge variant={statusVariant(sub.status)}>
                        {statusLabel(sub.status)}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell class="amount-cell">
                      {formatPrice(sub.amountCents)} / {sub.billingInterval}
                    </Table.Cell>
                    <Table.Cell>
                      <span class="date-cell">
                        {sub.currentPeriodEnd
                          ? formatDate(sub.currentPeriodEnd)
                          : '–'}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span class="date-cell">{formatDate(sub.createdAt)}</span>
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          </div>

          {#if pagination && pagination.totalPages > 1}
            <nav class="pagination" aria-label="Subscriber pagination">
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
                  · {pagination.total} subscriber{pagination.total === 1
                    ? ''
                    : 's'}
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
  .subscribers {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 1200px;
  }

  .subscribers-header {
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

  .subscribers-title {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
    line-height: var(--leading-tight);
  }

  .subscribers-subtitle {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
    max-width: 720px;
    margin: 0;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .tier-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .chip {
    padding: var(--space-1-5) var(--space-3);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full, 9999px);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .chip:hover {
    color: var(--color-text);
    border-color: var(--color-border-strong, var(--color-border));
  }

  .chip--active {
    color: var(--color-surface);
    background: var(--color-text);
    border-color: var(--color-text);
  }

  .chip:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset, var(--space-0-5));
  }

  .cancelled-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    cursor: pointer;
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

  .subscriber-cell {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  :global(.sub-avatar) {
    width: var(--space-8) !important;
    height: var(--space-8) !important;
    flex-shrink: 0 !important;
  }

  .subscriber-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .subscriber-name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 22ch;
  }

  .subscriber-email {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 22ch;
  }

  :global(.amount-head),
  :global(.amount-cell) {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .date-cell {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    white-space: nowrap;
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

  .empty-link {
    text-decoration: none;
    color: inherit;
  }
</style>

<!--
  @component StudioPayouts

  Owner-only payout history table (Codex-zqaxo). Phase 1 of the
  payouts-visibility epic (Codex-kbfe3) — read-only surface that lists
  pending + resolved creator payouts for the org so owners can verify
  Stripe transfers landed after subscription invoices.

  Backend data flow:
    listPayouts() remote query → api.subscription.listPayouts
      → GET ecom-api `/subscriptions/payouts`
      → SubscriptionService.listPayoutsByOrg (org-scoped)

  This page deliberately uses snapshot queries per filter — NO TanStack DB
  live collection in Phase 1 (epic decision). Each filter/page change
  re-issues the remote query.

  @prop data - Org info + userRole from parent studio layout
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { Alert, Badge, EmptyState, Skeleton } from '$lib/components/ui';
  import * as Card from '$lib/components/ui/Card';
  import * as Table from '$lib/components/ui/Table';
  import Select from '$lib/components/ui/Select/Select.svelte';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import {
    BanknoteIcon,
    CopyIcon,
    AlertTriangleIcon,
  } from '$lib/components/ui/Icon';
  import Avatar from '$lib/components/ui/Avatar/Avatar.svelte';
  import AvatarImage from '$lib/components/ui/Avatar/AvatarImage.svelte';
  import AvatarFallback from '$lib/components/ui/Avatar/AvatarFallback.svelte';
  import { listPayouts } from '$lib/remote/subscription.remote';
  import { formatDate, formatPrice } from '$lib/utils/format';
  import type { PayoutWithCreator } from '@codex/subscription';

  /** Shape returned by SvelteKit's query() when called client-side */
  interface QueryResult<T> {
    current: T | undefined;
    loading?: boolean;
    error?: { message?: string } | null;
  }

  type PayoutsPage = {
    items: PayoutWithCreator[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };

  let { data } = $props();

  // Role guard — owner only. Mirror the billing/monetisation pages exactly.
  // The studio layout supplies `data.userRole`; non-owners are redirected to
  // /studio rather than a 403 page (matches existing owner-only routes).
  $effect(() => {
    if (data.userRole !== 'owner') {
      goto('/studio');
    }
  });

  const isOwner = $derived(data.userRole === 'owner');
  const orgId = $derived(data.org.id);

  // ─── Filter state ──────────────────────────────────────────────────────
  // Snapshot-style — every change re-runs the remote query. No
  // optimistic UI / local mutation since this is a read-only surface.

  type StatusFilter = 'all' | 'pending' | 'resolved' | 'failed';
  let statusFilter = $state<StatusFilter>('all');
  let page = $state(1);
  const limit = 20;

  const statusOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: 'all', label: 'All statuses' },
    { value: 'pending', label: 'Pending' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'failed', label: 'Failed' },
  ];

  // ─── Remote query ──────────────────────────────────────────────────────
  // `$derived` re-runs when orgId / statusFilter / page change. We pass the
  // tagged arg object verbatim — Zod coerces strings/numbers server-side.
  const payoutsQuery = $derived(
    isOwner && orgId
      ? listPayouts({ organizationId: orgId, status: statusFilter, page, limit })
      : null
  );

  const payoutsData = $derived(
    (payoutsQuery as QueryResult<PayoutsPage> | null)?.current
  );
  const loading = $derived(
    (payoutsQuery as QueryResult<PayoutsPage> | null)?.loading ?? true
  );
  const queryError = $derived(
    (payoutsQuery as QueryResult<PayoutsPage> | null)?.error?.message ?? null
  );

  const items = $derived(payoutsData?.items ?? []);
  const pagination = $derived(payoutsData?.pagination);
  const isEmpty = $derived(!loading && items.length === 0);

  // ─── Filter handlers ───────────────────────────────────────────────────
  function onStatusChange(next: string | undefined) {
    if (!next) return;
    statusFilter = next as StatusFilter;
    page = 1; // reset to first page on filter change
  }

  function nextPage() {
    if (pagination && page < pagination.totalPages) page += 1;
  }
  function prevPage() {
    if (page > 1) page -= 1;
  }

  // ─── Badge variant + label helpers ─────────────────────────────────────
  // Token-aligned status mapping (epic Codex-kbfe3 decision):
  //   pending = warning · resolved = success · failed = error.
  function statusVariant(
    status: PayoutWithCreator['status']
  ): 'warning' | 'success' | 'error' {
    if (status === 'resolved') return 'success';
    if (status === 'failed') return 'error';
    return 'warning';
  }

  function statusLabel(status: PayoutWithCreator['status']): string {
    if (status === 'resolved') return 'Resolved';
    if (status === 'failed') return 'Failed';
    return 'Pending';
  }

  /**
   * Human-readable reason string for the `reason` column in the table.
   * The DB enum is `connect_not_ready | connect_restricted | transfer_failed
   * | min_transfer_floor` — keep these strings short and operator-friendly.
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

  function getInitials(name: string | null, email: string | null): string {
    const source = name?.trim() || email?.trim() || '?';
    return source
      .split(/\s+|@/)
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  /**
   * Truncate a Stripe Transfer ID (`tr_xxxxxxxxxxxxxxxxxx`) to
   * `tr_xxxx…xxxx` so the table cell stays readable. The full id is
   * retained as a `title` tooltip and copy-button payload.
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
      // navigator.clipboard can be blocked (non-secure context / permissions)
      // — fail silently; the title attribute lets the user copy manually.
    }
  }
</script>

<svelte:head>
  <title>Payouts | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#if !isOwner}
  <!-- Redirecting to /studio... -->
{:else}
  <div class="payouts">
    <header class="payouts-header">
      <h1 class="payouts-title">Payouts</h1>
      <p class="payouts-subtitle">
        Pending and resolved creator payouts for this organisation. Payouts
        appear here once a subscription invoice is paid and Stripe transfers
        the creator's share.
      </p>
    </header>

    <Card.Root>
      <Card.Header>
        <div class="filters">
          <Select
            options={statusOptions}
            value={statusFilter}
            label="Filter by status"
            onValueChange={onStatusChange}
            class="status-filter"
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
                <Skeleton width="22%" height="var(--space-5)" />
                <Skeleton width="22%" height="var(--space-5)" />
                <Skeleton width="14%" height="var(--space-5)" />
                <Skeleton width="14%" height="var(--space-5)" />
                <Skeleton width="14%" height="var(--space-5)" />
              </div>
            {/each}
          </div>
        {:else if isEmpty}
          <EmptyState
            title="No payouts yet"
            description="Payouts will appear here once subscriptions resolve and Stripe transfers the creator's share."
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
                  <Table.Head>Creator</Table.Head>
                  <Table.Head class="amount-head">Amount</Table.Head>
                  <Table.Head>Status</Table.Head>
                  <Table.Head>Transfer / Reason</Table.Head>
                  <Table.Head>Resolved</Table.Head>
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
                      <span class="creator-cell">
                        <Avatar class="creator-avatar">
                          {#if payout.creatorAvatarUrl}
                            <AvatarImage
                              src={payout.creatorAvatarUrl}
                              alt={payout.creatorName ?? payout.creatorEmail ?? ''}
                            />
                          {/if}
                          <AvatarFallback>
                            {getInitials(payout.creatorName, payout.creatorEmail)}
                          </AvatarFallback>
                        </Avatar>
                        <span class="creator-name">
                          {payout.creatorName ?? payout.creatorEmail ?? 'Unknown creator'}
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
                          <code class="transfer-id" title={payout.stripeTransferId}>
                            {truncateTransferId(payout.stripeTransferId)}
                          </code>
                          <button
                            type="button"
                            class="copy-btn"
                            onclick={() => copyTransferId(payout.stripeTransferId!)}
                            aria-label="Copy Stripe transfer ID {payout.stripeTransferId}"
                            title={copiedTransferId === payout.stripeTransferId
                              ? 'Copied!'
                              : 'Copy transfer ID'}
                          >
                            <CopyIcon size={14} />
                          </button>
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

                    <Table.Cell>
                      <span class="date-cell">
                        {payout.resolvedAt ? formatDate(payout.resolvedAt) : '–'}
                      </span>
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
                disabled={page <= 1}
                onclick={prevPage}
              >
                Previous
              </Button>
              <span class="pagination-status">
                Page {pagination.page} of {pagination.totalPages}
                <span class="pagination-total">
                  · {pagination.total} payout{pagination.total === 1 ? '' : 's'}
                </span>
              </span>
              <Button
                variant="secondary"
                disabled={page >= pagination.totalPages}
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

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: flex-end;
  }

  /* Constrain the status select so it doesn't span the full header */
  .filters :global(.status-filter) {
    min-width: 220px;
    max-width: 280px;
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

  /* Avatar primitive sets size via its own scoped .avatar class. Force
     here with !important to match the StudioSidebar avatar pattern —
     primitive specificity (0,2,0) beats consumer :global (0,1,0). */
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
    max-width: 16ch;
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

  .copy-btn {
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
    transition: var(--transition-colors);
  }

  .copy-btn:hover {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .copy-btn:focus-visible {
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

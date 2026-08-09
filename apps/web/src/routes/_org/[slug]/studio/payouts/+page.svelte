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
  import * as m from '$paraglide/messages';
  import { Alert, Badge, EmptyState, PageHeader, Skeleton } from '$lib/components/ui';
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
  import { queryErrorMessage, type QueryResult } from '$lib/remote/query-result';
  import { groupTransactions } from './group-transactions';

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
  const orgId = $derived(data.org?.id);

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

  // Via `queryErrorMessage` — SvelteKit rejects with `HttpError`, whose text is
  // at `.body.message`, so the `.error?.message` this replaces was `undefined`
  // for every real failure and this branch never fired (Codex-xo3bl).
  const queryError = $derived(
    queryErrorMessage((payoutsQuery as QueryResult<PayoutsPage> | null)?.error)
  );

  const items = $derived(payoutsData?.items ?? []);
  const pagination = $derived(payoutsData?.pagination);
  const isEmpty = $derived(!loading && items.length === 0);

  // ── Transaction grouping (Codex-6nt4l) ───────────────────────────────
  // Every charge generates up to 3 sibling rows (platform_fee +
  // organization_fee + creator_payout). Group them so the table reads as
  // "one transaction per header + indented children" rather than 3x as many
  // flat rows. The keying rules are load-bearing and non-obvious — they live
  // in ./group-transactions.ts with unit tests over the real seeded ledger,
  // because inline they silently produced fabricated transaction totals.
  const groupedTransactions = $derived(groupTransactions(items));

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
  /**
   * Only two states earn a colour here: settled (success) and failed (error).
   *
   * `pending` used to fall through to `warning` — amber reads as "a problem to
   * fix", but pending is the pipeline's normal pre-drain state (docs/payouts:
   * the webhook drain plus the safety-net cron drain both resolve it), so it
   * was colouring healthy rows as exceptions. `reversed` and
   * `cancelled_by_refund` are terminal bookkeeping outcomes, and
   * sales/+page.svelte:208 already maps its equivalent (`refunded`) to
   * `neutral` — converging the two money surfaces is worth more than polishing
   * one. `neutral`'s ink-on-fill is also the best of all six variants in every
   * org × theme combo measured (16.44 / 16.87 light, 9.93 / 13.71 dark).
   */
  function statusVariant(
    status: PayoutWithCreator['status']
  ): 'success' | 'error' | 'neutral' {
    if (status === 'resolved') return 'success';
    if (status === 'failed') return 'error';
    return 'neutral';
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
  <title>{m.payouts_title()} | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<!-- The five ledger cells shared by a grouped child row and a standalone row.
     Declared once so the two row shapes cannot drift. -->
{#snippet ledgerCells(payout: PayoutWithCreator)}
  <!-- Type: plain text, not a chip. 13 of the 19 pills on this page were
       `variant="info"` doing taxonomy work — the source label and every Type
       label — so the status column lost its scanability and the two statuses
       that legitimately mean "informational" were chromatically identical to
       "Org fee". status.css deliberately makes fills whisper and puts the
       signal in border + ink, so a chip spent on taxonomy contributes almost
       no fill but a full-strength coloured ring: the page read as rows of
       small outlined buttons rather than labels. Sales renders exactly one
       badge per row. -->
  <Table.Cell>
    <span class="type-cell">{typeLabel(payout.payoutType)}</span>
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
            {getInitials(payout.creatorName, payout.creatorEmail)}
          </AvatarFallback>
        </Avatar>
        <span class="creator-name">
          {payout.creatorName ?? payout.creatorEmail ?? 'Unknown'}
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
        <code class="transfer-id" title={payout.stripeTransferId}>
          {truncateTransferId(payout.stripeTransferId)}
        </code>
        <button
          type="button"
          class="icon-btn"
          onclick={() => copyTransferId(payout.stripeTransferId!)}
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
    {:else if payout.payoutType === 'platform_fee'}
      <!-- Structural, not a data gap: the schema states that platform_fee rows
           carry a NULL stripeTransferId because no transfer happens — the slice
           retains on the platform balance (payouts.ts:141-143). Falling through
           to reasonLabel('') rendered a blank last cell on 2 of 6 rows. -->
      <span class="reason-cell">Retained on platform</span>
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
{/snippet}

{#if !isOwner}
  <!-- Redirecting to /studio… -->
{:else}
  <div class="payouts">
    <PageHeader
      kicker={m.studio_section_money()}
      title={m.payouts_title()}
      description={m.payouts_description()}
    />

    <div class="payouts-grid">
    <div class="payouts-main">
    <!-- ── KPI row ──────────────────────────────────────────────────── -->
    <!-- Exact pence via `valueContent`: `format="money"` routes through
         formatPriceCompact (0dp), so this row read "£4 / £4 / £0" on a ledger
         whose only paid rows are £1.30 + £2.50 = £3.80 — a headline overstating
         by 20p, twice, directly above figures printed to the penny.
         `totalEarnedCents` is dropped: it is the same aggregate as
         `earnedInPeriodCents` with a different window (identical when
         range=all), and "Needs attention" is the number an operator opens this
         page for. -->
    <div class="kpi-row">
      <KPICard
        label="Settled · {rangeLabel}"
        value={summary?.earnedInPeriodCents ?? 0}
        loading={summaryLoading}
      >
        {#snippet valueContent()}
          <span class="kpi-money">
            {formatPrice(summary?.earnedInPeriodCents ?? 0)}
          </span>
        {/snippet}
      </KPICard>
      <KPICard
        label="In transit"
        value={summary?.inTransitCents ?? 0}
        loading={summaryLoading}
      >
        {#snippet valueContent()}
          <span class="kpi-money">
            {formatPrice(summary?.inTransitCents ?? 0)}
          </span>
        {/snippet}
      </KPICard>
      <KPICard
        label="Needs attention"
        value={summary?.needsAttentionCount ?? 0}
        format="number"
        loading={summaryLoading}
      />
    </div>

    <!-- `getPayoutSummary` sums payouts.amountCents for status='paid' with NO
         payoutType filter (subscription-service.ts:3158-3167), so the platform's
         retained slice is inside the figure. On of-blood-and-bones 100% of it is
         (£1.30 + £2.50, both platform_fee) — "Earned" was therefore naming money
         the org never receives. Labelled "Settled" and disclosed rather than
         silently relabelled; narrowing the aggregate is a backend change. -->
    <p class="kpi-note">
      Settled counts every ledger line that cleared, including the platform's
      fee. The table below shows the split.
    </p>

    <!-- ── Exception banner (only when needsAttention > 0) ──────────── -->
    {#if summary && summary.needsAttentionCount > 0 && statusFilter !== 'needs_attention'}
      <Alert variant="warning">
        <!-- ui/Alert is a plain block (no `display`), so the old
             `.banner-text { flex: 1 }` was inert: the Review button was dumped
             inline after the sentence with ~380px of dead space to its right and
             its 40px box sat off-centre against the 22.5px text line. The row
             lives here, at the call site — the Alert's colours were already
             correct. -->
        <div class="banner">
          <span class="banner-text">
            <AlertTriangleIcon size={16} />
            <span>
              <strong>{summary.needsAttentionCount}</strong>
              payout{summary.needsAttentionCount === 1 ? '' : 's'} need attention
              — Connect onboarding incomplete, transfers failed, or amounts
              below the minimum-transfer floor.
            </span>
          </span>
          <Button
            variant="secondary"
            onclick={() => setUrlParam('status', 'needs_attention')}
          >
            Review
          </Button>
        </div>
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
                <Skeleton width="16%" height="var(--space-5)" />
                <Skeleton width="16%" height="var(--space-5)" />
                <Skeleton width="20%" height="var(--space-5)" />
                <Skeleton width="14%" height="var(--space-5)" />
                <Skeleton width="12%" height="var(--space-5)" />
                <Skeleton width="22%" height="var(--space-5)" />
              </div>
            {/each}
          </div>
        {:else if isEmpty}
          <!-- Two of the three seeded orgs render this, so it IS the payouts
               page for most operators. Kept to one line: EmptyState's
               `description` is --color-text-muted (measured 2.52:1 light /
               3.19:1 dark — a WCAG AA fail that belongs to the primitive), so
               the substantive guidance moved into the action slot where this
               page controls the token. -->
          <EmptyState
            title="No payouts yet"
            description="Nothing has been transferred in this period."
            icon={BanknoteIcon}
          >
            {#snippet action()}
              <div class="empty-block">
                <p class="empty-lede">
                  Every sale splits three ways — a platform fee, an org fee, and
                  a creator share. Those rows land here once Stripe settles the
                  charge.
                </p>
                <div class="empty-actions">
                  <a href="/studio/monetisation" class="empty-link">
                    <Button variant="secondary">Go to Monetisation</Button>
                  </a>
                  <a
                    href="/studio/monetisation/revenue-share"
                    class="empty-link"
                  >
                    <Button variant="secondary">Revenue share</Button>
                  </a>
                </div>
              </div>
            {/snippet}
          </EmptyState>
        {:else}
          <div class="table-wrapper">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Date</Table.Head>
                  <Table.Head>Type</Table.Head>
                  <Table.Head>Beneficiary</Table.Head>
                  <Table.Head class="amount-head">Amount</Table.Head>
                  <Table.Head>Status</Table.Head>
                  <Table.Head>Transfer / reason</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#each groupedTransactions as group (group.key)}
                  {@const subscriber =
                    group.subscriberName ?? group.subscriberEmail}
                  {#if group.rows.length > 1}
                    <!-- Group header: one band per charge. The total sits in the
                         Amount column (colspan 3 + the amount cell + colspan 2)
                         so it lands above the figures it sums — it used to float
                         ~290px to the right, out past the Transfer column, which
                         is what made the numbers read as design rather than
                         data. -->
                    <Table.Row data-row-kind="header">
                      <Table.Cell colspan={3} class="group-header-cell">
                        <span class="group-header__left">
                          <span
                            class="date-cell"
                            title={new Date(group.createdAt).toISOString()}
                          >
                            {formatDate(group.createdAt)}
                          </span>
                          <span class="source-label">
                            {sourceLabel(group.source)}
                          </span>
                          {#if subscriber}
                            <span class="group-header__subscriber">
                              {subscriber}
                            </span>
                          {/if}
                        </span>
                      </Table.Cell>
                      <Table.Cell class="group-header-cell amount-cell group-header__total">
                        {formatPrice(group.totalCents)}
                      </Table.Cell>
                      <Table.Cell colspan={2} class="group-header-cell" />
                    </Table.Row>

                    {#each group.rows as payout (payout.id)}
                      <Table.Row data-row-kind="child">
                        <!-- Date is blank for child rows; the header carries it
                             so the indent reads as "this row belongs to the
                             transaction above". -->
                        <Table.Cell class="child-spacer-cell" />
                        {@render ledgerCells(payout)}
                      </Table.Row>
                    {/each}
                  {:else}
                    <!-- A one-row group has no arithmetic to show, so it gets no
                         band and no total: a "transaction total" that sums a
                         single line is a number the operator cannot check. Date
                         and source fold into the row. -->
                    {#each group.rows as payout (payout.id)}
                      <Table.Row data-row-kind="single">
                        <Table.Cell>
                          <span class="single-date">
                            <span
                              class="date-cell"
                              title={new Date(payout.createdAt).toISOString()}
                            >
                              {formatDate(payout.createdAt)}
                            </span>
                            <span class="source-label">
                              {sourceLabel(payout.sourceType)}
                            </span>
                          </span>
                        </Table.Cell>
                        {@render ledgerCells(payout)}
                      </Table.Row>
                    {/each}
                  {/if}
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
                  · {pagination.total} transaction{pagination.total === 1
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
  /* No max-width: the studio shell owns the content column via
     --container-studio. Re-adding a cap here would be a regression. */
  .payouts {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    width: 100%;
  }

  /* Two-column shell: main content on the left (KPIs + filters +
     transaction table), sticky per-creator rail on the right. Below
     1024px the rail stacks below the main content as a regular section
     — preserves the rail's affordance without crowding narrower screens. */
  .payouts-grid {
    /* Named locally because tokens/layout.css has no studio data-rail width —
       --brand-studio-rail-width (24rem) is the brand editor's control rail and
       --control-width-md (16rem) is an inline filter. A shared
       --studio-rail-width belongs in the token file; that is a cross-round
       change, so this at least stops the literal being anonymous. */
    --payouts-rail-width: 20rem;

    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--payouts-rail-width);
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

  @media (--below-lg) {
    .payouts-grid {
      grid-template-columns: 1fr;
    }
    .payouts-rail {
      position: static;
    }
  }

  .kpi-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-4);
  }

  @media (--below-md) {
    .kpi-row {
      grid-template-columns: 1fr;
    }
  }

  /* Mirrors KPICard's own .kpi-card__value treatment — the `valueContent`
     snippet renders outside that component's scoped styles. */
  .kpi-money {
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    line-height: var(--leading-tight);
    font-variant-numeric: tabular-nums;
  }

  .kpi-note {
    margin: calc(-1 * var(--space-3)) 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  /* `flex-basis: 0`, not `auto`: with a non-zero basis the flex algorithm
     breaks the line BEFORE it shrinks, so the Review button dropped onto its
     own row and sat 43px below the sentence's centre. Basis 0 lets both items
     share one line and the text grow into what is left. */
  .banner-text {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1 1 0;
    min-width: 0;
  }

  /* Below md the sentence needs the full measure more than the row needs to
     stay a row. */
  @media (--below-md) {
    .banner {
      flex-direction: column;
      align-items: flex-start;
    }

    .banner-text {
      flex: 0 1 auto;
    }
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
    /* One answer for "how wide is an inline studio filter" — see
       --control-width-md in tokens/layout.css. */
    min-width: var(--control-width-md);
    max-width: var(--control-width-md);
  }

  .type-cell {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  /* Was font-style: italic — the only italic in the table, which reads as a
     placeholder or an error state. "Platform" is a real beneficiary. */
  .platform-cell .creator-name {
    font-weight: var(--font-normal);
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

  /* Source as a label, not a chip — same treatment TableHead gives its own
     column labels, so it reads as metadata rather than as a status. */
  .source-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    letter-spacing: var(--tracking-wide);
    text-transform: var(--text-transform-label);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .single-date {
    display: inline-flex;
    flex-direction: column;
    gap: var(--space-1);
    align-items: flex-start;
  }

  .creator-cell {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* Scoped under .table-wrapper — these were declared bare, leaking generic
     names (`.amount-cell`, `.creator-avatar`, `tr[data-row-kind]`) app-wide
     from a page component. The `!important` stays: it beats Avatar's own
     scoped size rule and removing it is a separate, verifiable change. */
  .table-wrapper :global(.creator-avatar) {
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
    /* Was 14ch, which "Luzura Peralta" sits exactly on — the next slightly
       longer name would have started ellipsing silently. */
    max-width: 22ch;
  }

  /* `th.` is load-bearing: TableHead's scoped rule compiles to
     `.table-head.s-XXXX` (0,2,0) and sets text-align:left, so the bare
     `:global(.amount-head)` (0,1,0) this replaces always lost — the money
     column header rendered left-aligned over right-aligned tabular figures.
     `th.amount-head` is 0,2,1 and wins without touching ui/Table/*. */
  .table-wrapper :global(th.amount-head),
  .table-wrapper :global(.amount-cell) {
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
    /* Was --color-error-700 (#b91c1c): a fixed light-mode step that never
       re-maps, so this text measured 2.34:1 on the dark platform surface. */
    color: var(--color-status-error-text);
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

  .empty-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
  }

  /* Left-aligned inside the centred block: centred running text at a narrow
     measure is the least readable configuration available, and this replaced a
     46-word centred wall that also sat on --color-text-muted. */
  .empty-lede {
    margin: 0;
    max-width: var(--measure-lede);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-align: start;
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

  /* ── Transaction grouping (Codex-6nt4l) ──────────────────────────── */

  /* Group header row: full-width banner on tinted surface so the eye
     sees "one transaction" before reading its indented children. */
  .table-wrapper :global(tr[data-row-kind='header']),
  .table-wrapper :global(tr[data-row-kind='header']:hover) {
    background-color: var(--color-surface-secondary);
  }

  .table-wrapper :global(.group-header-cell) {
    padding: var(--space-3) var(--space-4);
  }

  .group-header__left {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .group-header__subscriber {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .table-wrapper :global(.group-header__total) {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  /* Indent the first child cell so siblings read as belonging to the
     group above. Using padding-inline-start on the first cell keeps the
     remaining column grid intact. */
  .table-wrapper :global(tr[data-row-kind='child'] .child-spacer-cell) {
    padding-inline-start: var(--space-6);
  }
</style>

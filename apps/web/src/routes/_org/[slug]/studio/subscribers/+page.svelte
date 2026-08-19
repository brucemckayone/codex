<!--
  @component StudioSubscribers (Codex-1csms)

  Owner-only studio surface listing every active/cancelling/past_due subscriber
  on the org, with tier chip filters, a "show cancelled" toggle, and CSV export.

  Structured as BANDS, matching studio/customers: masthead (carrying the count as
  a header fact) → money-readiness prompt → filters → summary → table →
  pagination. It previously had two bands — a header and one card — and then
  ~600px of nothing, which is the specific "customers reads finished, this does
  not" gap this pass closes.

  The readiness prompt sits ABOVE the table, not inside the empty branch. That
  ordering is the whole point: studio-alpha has two active subscriptions and zero
  Connect rows, so the list is NOT empty and the old empty-branch-only check
  stayed silent about money with nowhere to land.

  Goes through `ui/DataTable` rather than raw `Table.*`: the Amount column's
  `th` computed `text-align: left` while its `td` computed `right`, because a
  `:global(.amount-head)` rule (0,1,0) loses to TableHead's scoped
  `.table-head` (0,2,0). DataTable sets alignment inline per column, which wins
  outright, and brings per-column widths so six columns stop spreading evenly
  across 1780px for 60–90px of content.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { Alert, Badge, Button, EmptyState, PageHeader, Skeleton } from '$lib/components/ui';
  import DataTable from '$lib/components/ui/DataTable/DataTable.svelte';
  import ActionLink from '$lib/components/studio/ActionLink.svelte';
  import MoneySetupPrompt from '$lib/components/studio/MoneySetupPrompt.svelte';
  import MoneyStatBand from '$lib/components/studio/MoneyStatBand.svelte';
  import type { MoneyStat } from '$lib/components/studio/money-stat';
  import { DownloadIcon, HeartIcon } from '$lib/components/ui/Icon';
  import Avatar from '$lib/components/ui/Avatar/Avatar.svelte';
  import AvatarImage from '$lib/components/ui/Avatar/AvatarImage.svelte';
  import AvatarFallback from '$lib/components/ui/Avatar/AvatarFallback.svelte';
  import {
    getConnectStatus,
    getSubscriptionStats,
    listSubscribers,
    listTiers,
  } from '$lib/remote/subscription.remote';
  import { formatDate, formatPrice, getInitials } from '$lib/utils/format';
  import { downloadCsv } from '$lib/utils/csv-export';
  import { logger } from '$lib/observability';
  import type { SubscriberListItem } from '@codex/subscription';
  import { queryErrorMessage, type QueryResult } from '$lib/remote/query-result';
  import {
    moneyReadiness,
    type ConnectReadinessStatus,
  } from '$lib/utils/connect-readiness';

  /**
   * DataTable's generic is `T extends Record<string, unknown>`. An `interface`
   * has no implicit index signature and so fails that constraint, while a
   * homomorphic mapped type over the same shape satisfies it. This keeps the
   * table fully typed with no cast and no drift — the fields still come from
   * `SubscriberListItem`.
   */
  type SubscriberRow = {
    [K in keyof SubscriberListItem]: SubscriberListItem[K];
  };

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

  type SubscriptionStats = {
    totalSubscribers: number;
    activeSubscribers: number;
    mrrCents: number;
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
  const orgId = $derived(data.org?.id);

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
  const tiersQuery = $derived(isOwner && orgId ? listTiers(orgId) : null);
  const tierRows = $derived(
    ((tiersQuery as QueryResult<TierRow[]> | null)?.current ?? []) as TierRow[]
  );

  // Connect readiness via the shared money-readiness signal — the same helper
  // the monetisation page and the backend TierService.requireActiveConnect use,
  // so this page can't claim "you're set up, add tiers" for an account the
  // backend would reject.
  const connectQuery = $derived(
    isOwner && orgId ? getConnectStatus(orgId) : null
  );
  const connectStatus = $derived<ConnectReadinessStatus>(
    (connectQuery as QueryResult<ConnectReadinessStatus> | null)?.current ?? {
      isConnected: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      status: null,
    }
  );

  const statsQuery = $derived(
    isOwner && orgId ? getSubscriptionStats(orgId) : null
  );
  const stats = $derived(
    (statsQuery as QueryResult<SubscriptionStats> | null)?.current ?? {
      totalSubscribers: 0,
      activeSubscribers: 0,
      mrrCents: 0,
    }
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
  // Fold Connect + tiers loading into the gate so the empty state resolves to
  // the correct prerequisite message once, rather than flashing "set up
  // payments" before Connect status and tier count have landed.
  const loading = $derived(
    ((subscribersQuery as QueryResult<SubscribersPage> | null)?.loading ??
      true) ||
      ((connectQuery as QueryResult<ConnectReadinessStatus> | null)?.loading ??
        false) ||
      ((tiersQuery as QueryResult<TierRow[]> | null)?.loading ?? false)
  );
  // Via `queryErrorMessage` — SvelteKit rejects with `HttpError`, whose text is
  // at `.body.message`, so the `.error?.message` this replaces was `undefined`
  // for every real failure and this branch never fired (Codex-xo3bl).
  const queryError = $derived(
    queryErrorMessage(
      (subscribersQuery as QueryResult<SubscribersPage> | null)?.error
    )
  );

  // The real text is logged (redacted by ObservabilityClient), never rendered.
  $effect(() => {
    if (queryError) {
      logger.error('studio/subscribers list query failed', {
        organizationId: orgId,
        reason: queryError,
      });
    }
  });

  const items = $derived<SubscriberRow[]>(subsData?.items ?? []);
  const pagination = $derived(subsData?.pagination);
  const isEmpty = $derived(!loading && items.length === 0);
  const isFiltered = $derived(!!tierIdFilter || includeCancelled);

  /** One readiness verdict, shared with the monetisation page's helper. */
  const readiness = $derived(
    moneyReadiness(connectStatus, {
      hasTiers: tierRows.length > 0,
      subscriberCount: stats.activeSubscribers,
    })
  );

  const totalSubscribers = $derived(pagination?.total ?? 0);

  /** Only render the filter row when there is something to filter, or when a
      filter is what emptied the list. It used to offer to filter nothing. */
  const showFilters = $derived(!loading && (items.length > 0 || isFiltered));
  const showStats = $derived(!loading && stats.totalSubscribers > 0);

  /** Text of the persistent live region — see the markup comment above it. */
  const liveStatus = $derived.by(() => {
    if (queryError) return m.subscribers_live_error();
    if (loading) return m.subscribers_live_loading();
    if (items.length === 0) return m.subscribers_empty_title();
    return items.length === 1
      ? m.subscribers_live_count_one()
      : m.subscribers_live_count({ count: String(items.length) });
  });

  const statBand = $derived<MoneyStat[]>([
    { label: m.subscribers_stat_active(), value: stats.activeSubscribers },
    { label: m.subscribers_stat_mrr(), value: formatPrice(stats.mrrCents) },
    {
      label: m.subscribers_stat_average(),
      value: formatPrice(
        stats.activeSubscribers > 0
          ? Math.round(stats.mrrCents / stats.activeSubscribers)
          : 0
      ),
    },
  ]);

  // ── Table shape ──────────────────────────────────────────────────────
  // Explicit widths: six auto-spread columns previously took 442/230/217/308/
  // 289/272px for content 60–90px wide, so a row read as scattered fragments.
  const columns = $derived([
    { key: 'subscriber', label: m.subscribers_col_subscriber(), width: '30%' },
    { key: 'tier', label: m.subscribers_col_tier(), width: '14%' },
    { key: 'status', label: m.subscribers_col_status(), width: '12%' },
    {
      key: 'amount',
      label: m.subscribers_col_amount(),
      width: '16%',
      align: 'right' as const,
    },
    { key: 'renews', label: m.subscribers_col_renews(), width: '14%' },
    { key: 'joined', label: m.subscribers_col_joined(), width: '14%' },
  ]);

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

  function clearFilters() {
    goto('/studio/subscribers', { replaceState: true, keepFocus: true });
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

  // Translated labels, replacing a regex that title-cased the raw enum —
  // `s.replace('_',' ').replace(/\b\w/g, …)` cannot be localised.
  function statusLabel(s: string): string {
    switch (s) {
      case 'active':
        return m.subscribers_status_active();
      case 'cancelling':
        return m.subscribers_status_cancelling();
      case 'past_due':
        return m.subscribers_status_past_due();
      case 'cancelled':
        return m.subscribers_status_cancelled();
      default:
        return s;
    }
  }

  /** `/mo` and `/yr`, the same vocabulary the tier rows use. The table said
      "£4.99 / month" while monetisation said "/monthly" for the same fact. */
  function intervalSuffix(interval: string): string {
    return interval === 'year' || interval === 'annual'
      ? m.monetisation_tier_annual()
      : m.monetisation_tier_monthly();
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
  <title>{m.subscribers_title()} | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#if !isOwner}
  <!-- redirecting -->
{:else}
  <div class="subscribers">
    <PageHeader
      kicker={m.studio_section_audience()}
      title={m.subscribers_title()}
      description={m.subscribers_description()}
    >
      {#snippet meta()}
        {#if totalSubscribers > 0}
          <li>{m.subscribers_meta_total()}: {totalSubscribers}</li>
        {/if}
      {/snippet}
      {#snippet actions()}
        {#if items.length > 0}
          <Button variant="secondary" size="sm" onclick={exportCsv}>
            <DownloadIcon size={14} />
            {m.subscribers_export_csv()}
          </Button>
        {/if}
      {/snippet}
    </PageHeader>

    <!-- ABOVE the table, so a blocked org is warned whether or not it has
         rows. This is the studio-alpha case: real payers, no payout account. -->
    {#if !loading}
      <MoneySetupPrompt
        {readiness}
        subscriberCount={stats.activeSubscribers}
        showTierPrompt
      />
    {/if}

    {#if showFilters}
      <div class="filters">
        <div class="tier-chips" role="group" aria-label={m.subscribers_filter_by_tier()}>
          <button
            type="button"
            class="chip"
            class:chip--active={!tierIdFilter}
            aria-pressed={!tierIdFilter}
            onclick={() => selectTier(undefined)}
          >
            {m.subscribers_filter_all_tiers()}
          </button>
          {#each tierRows as tier (tier.id)}
            <button
              type="button"
              class="chip"
              class:chip--active={tierIdFilter === tier.id}
              aria-pressed={tierIdFilter === tier.id}
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
          <span>{m.subscribers_show_cancelled()}</span>
        </label>
      </div>
    {/if}

    {#if showStats}
      <MoneyStatBand stats={statBand} label={m.subscribers_meta_total()} />
    {/if}

    <!-- ONE persistent live region, mounted OUTSIDE the branch chain below.
         The skeleton used to carry `aria-live` itself, so the region's lifetime
         was the state it described: it was created when loading started and
         destroyed when the rows arrived, which is precisely the transition an
         AT user needs announced and the one an unmounted node cannot announce.
         It also held nothing but <Skeleton> boxes, so there was no text to
         read. This node persists and its TEXT changes, which is what
         `aria-live` actually reacts to — and it covers the chip-filter and
         show-cancelled swaps too, which were silent as well. -->
    <p class="sr-only" role="status" aria-live="polite" aria-busy={loading}>
      {liveStatus}
    </p>

    {#if queryError}
      <!-- Fixed copy, never the server's text. `queryError` is the worker's
           `HttpError.body.message`; this route reads subscription and Stripe
           data, so that string can carry account ids or an email, and Alert
           sets role="alert" — it would be spoken verbatim and swept into any
           DOM-scraping error pipeline. The real error goes to the logger,
           which redacts. -->
      <Alert variant="error">{m.subscribers_load_error()}</Alert>
    {:else if loading}
      <!-- Six columns, matching the table that replaces it. -->
      <div class="table-skeleton" aria-busy="true">
        <Skeleton width="100%" height="var(--space-10)" />
        {#each Array(5) as _, i (i)}
          <div class="table-skeleton-row">
            <Skeleton width="30%" height="var(--space-5)" />
            <Skeleton width="14%" height="var(--space-5)" />
            <Skeleton width="12%" height="var(--space-5)" />
            <Skeleton width="16%" height="var(--space-5)" />
            <Skeleton width="14%" height="var(--space-5)" />
            <Skeleton width="14%" height="var(--space-5)" />
          </div>
        {/each}
      </div>
    {:else if isEmpty}
      <!-- `size="lg"` — on two of three seeded orgs this IS the page, so it gets
           a real heading and a real measure instead of a 300px caption centred
           in an 1808px column. `headingLevel={2}` because the PageHeader above
           owns the <h1> and nothing else on this page is a heading: the default
           <h3> made the outline h1 → h3.

           ONE OWNER for the prerequisite chain. This used to render
           `money_setup_stripe_missing_*` and `money_setup_no_tiers_*` — the
           EXACT keys MoneySetupPrompt renders ~80px above — so a brand-new org
           (Stripe blocking, zero subscribers: the first screen every real
           customer sees) read the same two sentences twice, the second time
           with no CTA. Worse, the blocking branch hardcoded the
           `stripe_missing` copy for all four blocking states, so an org
           mid-onboarding was told "set up payments before you can be paid" by
           the panel while the prompt above it said "Stripe still needs a few
           details" about an account that IS set up.

           The prompt states the blocker and carries the action. This panel now
           says only what the prompt cannot: what will appear here, and when. -->
      <div class="empty-panel">
        {#if isFiltered}
          <EmptyState
            size="lg"
            headingLevel={2}
            title={m.subscribers_empty_filtered_title()}
            description={m.subscribers_empty_filtered_description()}
            icon={HeartIcon}
          >
            {#snippet action()}
              <Button variant="primary" onclick={clearFilters}>
                {m.subscribers_empty_filtered_cta()}
              </Button>
            {/snippet}
          </EmptyState>
        {:else if readiness.blocking || readiness.state === 'no_tiers'}
          <!-- No CTA: the prompt above already owns the one next action, and a
               second competing button is how the duplication started. -->
          <EmptyState
            size="lg"
            headingLevel={2}
            title={m.subscribers_empty_title()}
            description={m.subscribers_empty_pending_setup_description()}
            icon={HeartIcon}
          />
        {:else}
          <!-- Rails work, tiers exist, nobody has joined. The next useful action
               is to look at (or share) the page people actually subscribe from —
               "Manage tiers" pointed back at tiers that already exist. -->
          <EmptyState
            size="lg"
            headingLevel={2}
            title={m.subscribers_empty_title()}
            description={m.subscribers_empty_description()}
            icon={HeartIcon}
          >
            {#snippet action()}
              <ActionLink href="/pricing">{m.subscribers_empty_cta()}</ActionLink>
            {/snippet}
          </EmptyState>
        {/if}
      </div>
    {:else}
      <DataTable
        {columns}
        data={items}
        getRowId={(row) => row.id}
      >
        {#snippet renderCell(row: SubscriberRow, col: { key: string })}
          {#if col.key === 'subscriber'}
            <span class="subscriber-cell">
              <Avatar class="sub-avatar">
                {#if row.userAvatarUrl}
                  <AvatarImage
                    src={row.userAvatarUrl}
                    alt={row.userName ?? row.userEmail}
                  />
                {/if}
                <AvatarFallback>
                  {getInitials(row.userName, row.userEmail)}
                </AvatarFallback>
              </Avatar>
              <span class="subscriber-text">
                <span class="subscriber-name">
                  {row.userName ?? row.userEmail}
                </span>
                {#if row.userName}
                  <span class="subscriber-email">{row.userEmail}</span>
                {/if}
              </span>
            </span>
          {:else if col.key === 'tier'}
            {row.tierName}
          {:else if col.key === 'status'}
            <Badge variant={statusVariant(row.status)}>
              {statusLabel(row.status)}
            </Badge>
          {:else if col.key === 'amount'}
            <span class="amount-cell">
              {formatPrice(row.amountCents)}<span class="amount-interval"
                >/{intervalSuffix(row.billingInterval)}</span
              >
            </span>
          {:else if col.key === 'renews'}
            <span class="date-cell">
              {row.currentPeriodEnd ? formatDate(row.currentPeriodEnd) : '–'}
            </span>
          {:else if col.key === 'joined'}
            <span class="date-cell">{formatDate(row.createdAt)}</span>
          {/if}
        {/snippet}
      </DataTable>

      {#if pagination && pagination.totalPages > 1}
        <nav class="pagination" aria-label={m.subscribers_pagination_label()}>
          <Button
            variant="secondary"
            disabled={currentUrlPage <= 1}
            onclick={prevPage}
          >
            {m.subscribers_previous()}
          </Button>
          <span class="pagination-status">
            {m.subscribers_page_of({
              page: String(pagination.page),
              total: String(pagination.totalPages),
            })}
            <span class="pagination-total">
              · {pagination.total === 1
                ? m.subscribers_count_one()
                : m.subscribers_count({ count: String(pagination.total) })}
            </span>
          </span>
          <Button
            variant="secondary"
            disabled={currentUrlPage >= pagination.totalPages}
            onclick={nextPage}
          >
            {m.subscribers_next()}
          </Button>
        </nav>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .subscribers {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
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

  /* The empty state gets the card the table would have had, so the page keeps
     its shape whether or not there are rows. */
  .empty-panel {
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
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

  /* Alignment is set inline by DataTable per column, so this rule no longer has
     to beat TableHead's scoped `text-align: left` — it only carries the
     numeral treatment. */
  .amount-cell {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* `--color-text-secondary`, NOT `--color-text-muted`. Muted measures 2.52:1
     on the platform light theme and ~4.3:1 on the branded orgs — under AA for
     body copy at any size, and this is 12px. Secondary derives back toward the
     page's own ink, so it clears AA in all three orgs × both themes. The
     hierarchy here is already carried by size. */
  .amount-interval {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
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

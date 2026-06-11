<!--
  @component CreatorEarningsHub

  WP9 (Codex-69t7c.9) — Creator-scoped earnings & payouts surface.

  Sections:
    1. Connect banner — not started / incomplete / pending / enabled / fetch_failed
    2. Earnings KPI cards (streamed) — earnedInPeriodCents / totalEarnedCents /
       inTransitCents / needsAttentionCount
    3. Payouts ledger (streamed) — paginated table, status/source filter chips

  Connect-return handling:
    ?connect=success    → +page.server.ts called syncMyConnect; banner shows "connected"
    ?connect=sync_failed → sync call failed; banner warns user to retry manually
    ?connect=refresh    → onboarding abandoned; banner shows "resume" CTA

  Studio is `ssr = false` — all data is client-side via streamed promises that
  server loads resolve over SSR fetch (SvelteKit calls them via fetch on
  client nav). The {#await} blocks render skeletons until promises resolve.

  Currency: GBP (£) throughout.
-->
<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import {
    connectMeOnboard,
    getMyConnectDashboard,
    syncMyConnect,
  } from '$lib/remote/subscription.remote';
  import * as m from '$paraglide/messages';
  import type { PageData } from './$types';

  const { data }: { data: PageData } = $props();

  // ── Connect state ─────────────────────────────────────────────────────────
  type ConnectStateStatus =
    | 'not_started'
    | 'incomplete'
    | 'pending_verification'
    | 'enabled'
    | 'fetch_failed';

  const connectStateStatus = $derived.by<ConnectStateStatus>(() => {
    const s = data.connectStatus;
    if (!s) return 'not_started';
    // Distinct sentinel returned by server on transient fetch error
    if ('fetchFailed' in s && s.fetchFailed) return 'fetch_failed';
    if (!s.isConnected) return 'not_started';
    if (s.chargesEnabled && s.payoutsEnabled) return 'enabled';
    if (s.status === 'restricted' || s.status === 'disabled') return 'pending_verification';
    // status === 'onboarding' or accountId exists but not fully enabled
    return 'incomplete';
  });

  let isSyncing = $state(false);
  let isOnboarding = $state(false);

  // ── Connect-return banner (from ?connect=success / ?connect=sync_failed / ?connect=refresh) ──
  const returnBanner = $derived(data.connectReturnBanner);

  // ── Filter state ──────────────────────────────────────────────────────────
  type StatusFilter = 'all' | 'paid' | 'pending' | 'failed';
  type SourceFilter = 'all' | 'subscription' | 'purchase';

  let statusFilter = $state<StatusFilter>('all');
  let sourceFilter = $state<SourceFilter>('all');

  // ── Helpers ───────────────────────────────────────────────────────────────

  function formatPence(pence: number): string {
    return `£${(pence / 100).toFixed(2)}`;
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function statusLabel(status: string): string {
    switch (status) {
      case 'paid':
        return m.earnings_status_paid();
      case 'pending':
        return m.earnings_status_pending();
      case 'failed':
        return m.earnings_status_failed();
      case 'in_transit':
        return m.earnings_status_in_transit();
      case 'cancelled':
        return m.earnings_status_cancelled();
      default:
        return status;
    }
  }

  function statusClass(status: string): string {
    switch (status) {
      case 'paid':
        return 'status-badge--paid';
      case 'pending':
      case 'in_transit':
        return 'status-badge--pending';
      case 'failed':
      case 'cancelled':
        return 'status-badge--failed';
      default:
        return '';
    }
  }

  function sourceLabel(sourceType: string): string {
    switch (sourceType) {
      case 'subscription':
        return m.earnings_payouts_filter_source_subscription();
      case 'purchase':
        return m.earnings_payouts_filter_source_content();
      default:
        return sourceType;
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleOnboard() {
    if (isOnboarding) return;
    isOnboarding = true;
    try {
      const origin = browser ? window.location.origin : '';
      const currentPath = page.url.pathname;
      const returnUrl = `${origin}${currentPath}?connect=success`;
      const refreshUrl = `${origin}${currentPath}?connect=refresh`;
      const result = await connectMeOnboard({ returnUrl, refreshUrl });
      if (result?.onboardingUrl) {
        window.location.href = result.onboardingUrl;
        // Don't reset isOnboarding — we're navigating away; keep button disabled
        return;
      } else {
        toast.error(m.common_error(), 'No onboarding URL returned. Please try again.');
      }
    } catch (err) {
      toast.error('Could not start onboarding', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      isOnboarding = false;
    }
  }

  async function handleSync() {
    if (isSyncing) return;
    isSyncing = true;
    try {
      await syncMyConnect();
      toast.success('Status refreshed', 'Your Stripe account status has been updated.');
      // Remove the ?connect= param and invalidate so the server load re-runs
      goto(page.url.pathname, { invalidateAll: true });
    } catch (err) {
      toast.error('Could not sync status', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      isSyncing = false;
    }
  }

  async function handleOpenDashboard() {
    try {
      const result = await getMyConnectDashboard();
      if (result?.url) {
        window.open(result.url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      toast.error('Could not open dashboard', err instanceof Error ? err.message : 'Unknown error');
    }
  }

  // ── Filter helpers ────────────────────────────────────────────────────────

  type PayoutItem = {
    id: string;
    amountCents: number;
    status: string;
    sourceType: 'purchase' | 'subscription';
    organizationId?: string | null;
    createdAt: string;
  };

  function filterPayouts(items: PayoutItem[]): PayoutItem[] {
    return items.filter((p) => {
      const matchStatus = statusFilter === 'all' || p.status === statusFilter;
      const matchSource =
        sourceFilter === 'all' ||
        (sourceFilter === 'subscription' && p.sourceType === 'subscription') ||
        (sourceFilter === 'purchase' && p.sourceType === 'purchase');
      return matchStatus && matchSource;
    });
  }
</script>

<svelte:head>
  <title>{m.earnings_page_title()} | Creator Studio</title>
</svelte:head>

<div class="earnings-hub">
  <header class="earnings-hub__header">
    <h1 class="page-title earnings-hub__title">{m.earnings_page_title()}</h1>
    <p class="earnings-hub__subtitle">{m.earnings_page_subtitle()}</p>
  </header>

  <!-- ── Connect-return banner ────────────────────────────────────────────── -->
  {#if returnBanner === 'success'}
    <div class="connect-banner connect-banner--success" role="status" aria-live="polite">
      <span class="connect-banner__message">{m.earnings_connect_return_success()}</span>
    </div>
  {:else if returnBanner === 'sync_failed'}
    <div class="connect-banner connect-banner--warning" role="alert" aria-live="assertive">
      <span class="connect-banner__message">{m.earnings_connect_return_sync_failed()}</span>
    </div>
  {:else if returnBanner === 'refresh'}
    <div class="connect-banner connect-banner--warning" role="status" aria-live="polite">
      <span class="connect-banner__message">{m.earnings_connect_return_refresh()}</span>
    </div>
  {/if}

  <!-- ── Connect status banner ──────────────────────────────────────────────  -->
  {#if connectStateStatus === 'fetch_failed'}
    <section class="connect-card connect-card--error" aria-label="Payout status unavailable">
      <div class="connect-card__body">
        <h2 class="connect-card__title">{m.earnings_connect_status_load_failed()}</h2>
      </div>
      <button
        type="button"
        class="btn btn--secondary btn--sm"
        onclick={() => goto(page.url.pathname, { invalidateAll: true })}
      >
        {m.earnings_connect_status_load_failed_retry()}
      </button>
    </section>

  {:else if connectStateStatus === 'not_started'}
    <section class="connect-card connect-card--cta" aria-label="Set up payouts">
      <div class="connect-card__body">
        <h2 class="connect-card__title">{m.earnings_connect_not_started_title()}</h2>
        <p class="connect-card__description">{m.earnings_connect_not_started_body()}</p>
      </div>
      <button
        type="button"
        class="btn btn--primary"
        onclick={handleOnboard}
        disabled={isOnboarding}
        aria-busy={isOnboarding}
      >
        {isOnboarding ? m.common_loading() : m.earnings_connect_cta()}
      </button>
    </section>

  {:else if connectStateStatus === 'incomplete'}
    <section class="connect-card connect-card--warning" aria-label="Resume Stripe onboarding">
      <div class="connect-card__body">
        <h2 class="connect-card__title">{m.earnings_connect_incomplete_title()}</h2>
        <p class="connect-card__description">{m.earnings_connect_incomplete_body()}</p>
      </div>
      <button
        type="button"
        class="btn btn--secondary"
        onclick={handleOnboard}
        disabled={isOnboarding}
        aria-busy={isOnboarding}
      >
        {isOnboarding ? m.common_loading() : m.earnings_connect_resume_cta()}
      </button>
    </section>

  {:else if connectStateStatus === 'pending_verification'}
    <section class="connect-card connect-card--info" aria-label="Account under review">
      <div class="connect-card__body">
        <h2 class="connect-card__title">{m.earnings_connect_pending_title()}</h2>
        <p class="connect-card__description">{m.earnings_connect_pending_body()}</p>
      </div>
      <button
        type="button"
        class="btn btn--ghost btn--sm"
        onclick={handleSync}
        disabled={isSyncing}
        aria-busy={isSyncing}
      >
        {isSyncing ? m.earnings_connect_syncing() : m.earnings_connect_sync_cta()}
      </button>
    </section>

  {:else if connectStateStatus === 'enabled'}
    <section class="connect-card connect-card--enabled" aria-label="Payout account connected">
      <div class="connect-card__body">
        <h2 class="connect-card__title">{m.earnings_connect_enabled_title()}</h2>
      </div>
      <div class="connect-card__actions">
        <button
          type="button"
          class="btn btn--ghost btn--sm"
          onclick={handleOpenDashboard}
          aria-label={m.earnings_connect_dashboard_cta()}
        >
          {m.earnings_connect_dashboard_cta()}
        </button>
        <button
          type="button"
          class="btn btn--ghost btn--sm"
          onclick={handleSync}
          disabled={isSyncing}
          aria-busy={isSyncing}
        >
          {isSyncing ? m.earnings_connect_syncing() : m.earnings_connect_sync_cta()}
        </button>
      </div>
    </section>
  {/if}

  <!-- ── Earnings KPI cards (streamed) ─────────────────────────────────────── -->
  {#await data.earningsSummary}
    <div class="kpi-grid" aria-label="Loading earnings summary" aria-busy="true">
      {#each { length: 4 } as _, i (i)}
        <div class="kpi-card kpi-card--skeleton">
          <Skeleton height="1rem" width="60%" />
          <Skeleton height="2rem" width="80%" />
        </div>
      {/each}
    </div>
  {:then summary}
    {#if summary}
      <div class="kpi-grid" aria-label="Earnings summary">
        <div class="kpi-card">
          <span class="kpi-card__label">{m.earnings_kpi_earned_period()}</span>
          <span class="kpi-card__value">{formatPence(summary.earnedInPeriodCents ?? 0)}</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-card__label">{m.earnings_kpi_total_earned()}</span>
          <span class="kpi-card__value">{formatPence(summary.totalEarnedCents ?? 0)}</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-card__label">{m.earnings_kpi_in_transit()}</span>
          <span class="kpi-card__value">{formatPence(summary.inTransitCents ?? 0)}</span>
        </div>
        <div class="kpi-card {(summary.needsAttentionCount ?? 0) > 0 ? 'kpi-card--attention' : ''}">
          <span class="kpi-card__label">{m.earnings_kpi_needs_attention()}</span>
          <span class="kpi-card__value">{summary.needsAttentionCount ?? 0}</span>
        </div>
      </div>
    {/if}
  {:catch}
    <div class="stream-error" role="alert">
      <span class="stream-error__message">{m.earnings_kpi_load_error()}</span>
      <button
        type="button"
        class="btn btn--ghost btn--sm"
        onclick={() => goto(page.url.pathname, { invalidateAll: true })}
      >
        {m.earnings_kpi_retry()}
      </button>
    </div>
  {/await}

  <!-- ── Payouts ledger (streamed) ──────────────────────────────────────────── -->
  <section class="payouts-section" aria-label={m.earnings_payouts_title()}>
    <header class="payouts-section__header">
      <h2 class="payouts-section__title">{m.earnings_payouts_title()}</h2>

      <!-- Filter chips -->
      <div class="filter-row" role="group" aria-label="Filter payouts">
        <div class="filter-chips" aria-label="Status filter">
          {#each (['all', 'paid', 'pending', 'failed'] as StatusFilter[]) as s (s)}
            <button
              type="button"
              class="filter-chip {statusFilter === s ? 'filter-chip--active' : ''}"
              onclick={() => { if (statusFilter !== s) statusFilter = s; }}
              aria-pressed={statusFilter === s}
            >
              {s === 'all' ? m.earnings_payouts_filter_status_all()
                : s === 'paid' ? m.earnings_payouts_filter_status_paid()
                : s === 'pending' ? m.earnings_payouts_filter_status_pending()
                : m.earnings_payouts_filter_status_failed()}
            </button>
          {/each}
        </div>

        <div class="filter-chips" aria-label="Source filter">
          {#each (['all', 'subscription', 'purchase'] as SourceFilter[]) as src (src)}
            <button
              type="button"
              class="filter-chip {sourceFilter === src ? 'filter-chip--active' : ''}"
              onclick={() => { if (sourceFilter !== src) sourceFilter = src; }}
              aria-pressed={sourceFilter === src}
            >
              {src === 'all' ? m.earnings_payouts_filter_source_all()
                : src === 'subscription' ? m.earnings_payouts_filter_source_subscription()
                : m.earnings_payouts_filter_source_content()}
            </button>
          {/each}
        </div>
      </div>
    </header>

    {#await data.payouts}
      <div class="payouts-table payouts-table--skeleton" aria-busy="true">
        {#each { length: 5 } as _, i (i)}
          <div class="payouts-table__row payouts-table__row--skeleton">
            <Skeleton height="1rem" width="80px" />
            <Skeleton height="1rem" width="60px" />
            <Skeleton height="1.25rem" width="70px" />
            <Skeleton height="1rem" width="90px" />
          </div>
        {/each}
      </div>
    {:then payoutsResult}
      {#if payoutsResult?.items && payoutsResult.items.length > 0}
        {@const filtered = filterPayouts(payoutsResult.items)}
        {#if filtered.length > 0}
          <div class="payouts-table" role="table" aria-label={m.earnings_payouts_title()}>
            <div class="payouts-table__head" role="row">
              <span class="payouts-table__th" role="columnheader">{m.earnings_payouts_col_date()}</span>
              <span class="payouts-table__th" role="columnheader">{m.earnings_payouts_col_amount()}</span>
              <span class="payouts-table__th" role="columnheader">{m.earnings_payouts_col_status()}</span>
              <span class="payouts-table__th" role="columnheader">{m.earnings_payouts_col_source()}</span>
            </div>
            {#each filtered as payout (payout.id)}
              <div class="payouts-table__row" role="row">
                <span class="payouts-table__cell payouts-table__cell--date" role="cell">
                  {formatDate(payout.createdAt)}
                </span>
                <span class="payouts-table__cell payouts-table__cell--amount" role="cell">
                  {formatPence(payout.amountCents)}
                </span>
                <span class="payouts-table__cell" role="cell">
                  <span class="status-badge {statusClass(payout.status)}" aria-label={statusLabel(payout.status)}>
                    {statusLabel(payout.status)}
                  </span>
                </span>
                <span class="payouts-table__cell" role="cell">
                  {sourceLabel(payout.sourceType)}
                </span>
              </div>
            {/each}
          </div>

          <!-- Pagination -->
          {#if (payoutsResult.pagination?.totalPages ?? 1) > 1}
            <div class="payouts-pagination" aria-label={m.common_pagination()}>
              <span class="payouts-pagination__info">
                {m.common_page_x_of_y({
                  current: String(payoutsResult.pagination.page),
                  total: String(payoutsResult.pagination.totalPages),
                })}
              </span>
            </div>
          {/if}
        {:else}
          <!-- Filters active but no results match — "no payouts yet" is wrong here -->
          <div class="payouts-empty">
            <p class="payouts-empty__title">{m.earnings_payouts_empty()}</p>
          </div>
        {/if}
      {:else}
        <!-- payoutsResult is null (never fetched / no items) -->
        <div class="payouts-empty">
          <p class="payouts-empty__title">{m.earnings_payouts_empty()}</p>
          <p class="payouts-empty__description">{m.earnings_payouts_empty_description()}</p>
        </div>
      {/if}
    {:catch}
      <!-- Distinct from empty: the request failed -->
      <div class="stream-error" role="alert">
        <span class="stream-error__message">{m.earnings_payouts_load_error()}</span>
        <button
          type="button"
          class="btn btn--ghost btn--sm"
          onclick={() => goto(page.url.pathname, { invalidateAll: true })}
        >
          {m.earnings_payouts_retry()}
        </button>
      </div>
    {/await}
  </section>
</div>

<style>
  .earnings-hub {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-6);
    max-width: var(--container-max);
  }

  /* ── Header ─────────────────────────────────────────────────────────────── */
  .earnings-hub__header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .earnings-hub__title {
    font-size: var(--text-2xl);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
  }

  .earnings-hub__subtitle {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  /* ── Connect-return banner ──────────────────────────────────────────────── */
  .connect-banner {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
  }

  .connect-banner--success {
    background: var(--color-success-50);
    color: var(--color-success-700);
    border: var(--border-width) var(--border-style) var(--color-success-200);
  }

  .connect-banner--warning {
    background: var(--color-warning-50);
    color: var(--color-warning-700);
    border: var(--border-width) var(--border-style) var(--color-warning-200);
  }

  /* ── Connect cards ──────────────────────────────────────────────────────── */
  .connect-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-5) var(--space-6);
    border-radius: var(--radius-lg);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .connect-card--cta {
    background: var(--color-primary-50);
    border-color: var(--color-primary-200);
  }

  .connect-card--warning {
    background: var(--color-warning-50);
    border-color: var(--color-warning-200);
  }

  .connect-card--info {
    background: var(--color-surface-secondary);
    border-color: var(--color-border);
  }

  .connect-card--enabled {
    background: var(--color-success-50);
    border-color: var(--color-success-200);
  }

  .connect-card--error {
    background: var(--color-error-50);
    border-color: var(--color-error-200);
  }

  .connect-card__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .connect-card__title {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
  }

  .connect-card__description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .connect-card__actions {
    display: flex;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  /* ── KPI grid ───────────────────────────────────────────────────────────── */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--space-4);
  }

  .kpi-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    border: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface);
  }

  .kpi-card--attention {
    border-color: var(--color-warning-300);
    background: var(--color-warning-50);
  }

  .kpi-card--skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    border: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface);
  }

  .kpi-card__label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .kpi-card__value {
    font-size: var(--text-2xl);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  /* ── Stream error state ─────────────────────────────────────────────────── */
  .stream-error {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    background: var(--color-error-50);
    border: var(--border-width) var(--border-style) var(--color-error-200);
  }

  .stream-error__message {
    font-size: var(--text-sm);
    color: var(--color-error-700);
    flex: 1;
  }

  /* ── Payouts section ────────────────────────────────────────────────────── */
  .payouts-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .payouts-section__header {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .payouts-section__title {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
  }

  /* ── Filter chips ───────────────────────────────────────────────────────── */
  .filter-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .filter-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .filter-chip {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    background: transparent;
    border: var(--border-width) var(--border-style) var(--color-border);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .filter-chip:hover {
    background: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .filter-chip--active {
    background: var(--color-primary-100);
    border-color: var(--color-primary-300);
    color: var(--color-primary-700);
  }

  /* ── Payouts table ──────────────────────────────────────────────────────── */
  .payouts-table {
    display: flex;
    flex-direction: column;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .payouts-table__head {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface-secondary);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .payouts-table__th {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .payouts-table__row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    align-items: center;
  }

  .payouts-table__row:last-child {
    border-bottom: none;
  }

  .payouts-table__row--skeleton {
    display: flex;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    align-items: center;
  }

  .payouts-table__row--skeleton:last-child {
    border-bottom: none;
  }

  .payouts-table__cell {
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .payouts-table__cell--date {
    color: var(--color-text-secondary);
  }

  .payouts-table__cell--amount {
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-medium);
  }

  /* ── Status badges ──────────────────────────────────────────────────────── */
  .status-badge {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
  }

  .status-badge--paid {
    background: var(--color-success-100);
    color: var(--color-success-700);
  }

  .status-badge--pending {
    background: var(--color-warning-100);
    color: var(--color-warning-700);
  }

  .status-badge--failed {
    background: var(--color-error-100);
    color: var(--color-error-700);
  }

  /* ── Empty state ────────────────────────────────────────────────────────── */
  .payouts-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-12) var(--space-6);
    text-align: center;
  }

  .payouts-empty__title {
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    color: var(--color-text);
    margin: 0;
  }

  .payouts-empty__description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  /* ── Pagination ─────────────────────────────────────────────────────────── */
  .payouts-pagination {
    display: flex;
    justify-content: center;
    padding: var(--space-4);
  }

  .payouts-pagination__info {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* ── Button styles (mirrors existing btn primitives) ────────────────────── */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    cursor: pointer;
    border: var(--border-width) var(--border-style) transparent;
    transition: var(--transition-colors);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn--primary {
    background: var(--color-primary-600);
    color: var(--color-surface);
    border-color: var(--color-primary-600);
  }

  .btn--primary:hover:not(:disabled) {
    background: var(--color-primary-700);
    border-color: var(--color-primary-700);
  }

  .btn--secondary {
    background: var(--color-surface);
    color: var(--color-text);
    border-color: var(--color-border);
  }

  .btn--secondary:hover:not(:disabled) {
    background: var(--color-surface-secondary);
  }

  .btn--ghost {
    background: transparent;
    color: var(--color-text-secondary);
    border-color: var(--color-border);
  }

  .btn--ghost:hover:not(:disabled) {
    background: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .btn--sm {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
  }
</style>

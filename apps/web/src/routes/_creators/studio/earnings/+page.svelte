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
  import {
    bankLineFor,
    deriveConnectState,
    filterPayouts,
    formatDay,
    formatPence,
    negativeCauseLine,
    ruleLine,
    type SourceFilter,
    type StatusFilter,
    statusLabel,
    statusTone,
    switchoverNotice,
    waitingLines,
    type WaitingView,
    waitingSince,
  } from './earnings-view';

  const { data }: { data: PageData } = $props();

  // ── Connect state ─────────────────────────────────────────────────────────
  const connectStateStatus = $derived(deriveConnectState(data.connectStatus));

  let isSyncing = $state(false);
  let isOnboarding = $state(false);

  // ── Connect-return banner (from ?connect=success / ?connect=sync_failed / ?connect=refresh) ──
  const returnBanner = $derived(data.connectReturnBanner);

  // ── Filter state ──────────────────────────────────────────────────────────
  let statusFilter = $state<StatusFilter>('all');
  let sourceFilter = $state<SourceFilter>('all');

  // ── The Stripe balance (Codex-2hxff.29, .30) ──────────────────────────────
  // Read once per load (nothing polls). The ledger rows render at once from
  // our own dates and take the balance in when it lands, so a row the
  // balance is using never shows a bank date first.
  type BalanceResult = Awaited<PageData['stripeBalance']>;
  type PayoutRow = Extract<
    Awaited<PageData['payouts']>,
    { ok: true }
  >['list']['items'][number];
  let balanceResult = $state<BalanceResult | undefined>(undefined);
  $effect(() => {
    const pending = data.stripeBalance;
    let current = true;
    balanceResult = undefined;
    pending.then((result) => {
      if (current) balanceResult = result;
    });
    return () => {
      current = false;
    };
  });
  /** For the rows: undefined while loading, null when there is none to use. */
  const rowBalance = $derived(
    balanceResult === undefined
      ? undefined
      : balanceResult?.ok
        ? balanceResult.balance
        : null
  );
  // The page's clock for "goes" against "sent": fixed per load, never ticking.
  const now = new Date();

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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

  function reload() {
    goto(page.url.pathname, { invalidateAll: true });
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
      reload();
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
        {#await data.earningsSummary}
          <p class="connect-card__description">{m.earnings_connect_not_started_body()}</p>
        {:then result}
          {#if result.ok && result.summary.waiting}
            <p class="connect-card__description">
              {m.earnings_connect_not_started_waiting({ total: formatPence(result.summary.waiting.totalCents) })}
            </p>
            {@render waitingList(result.summary.waiting)}
          {:else}
            <p class="connect-card__description">{m.earnings_connect_not_started_body()}</p>
          {/if}
        {/await}
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
        {#await data.earningsSummary}
          <p class="connect-card__description">{m.earnings_connect_incomplete_body()}</p>
        {:then result}
          {#if result.ok && result.summary.waiting}
            <p class="connect-card__description">
              {m.earnings_connect_incomplete_waiting({ total: formatPence(result.summary.waiting.totalCents) })}
            </p>
            {@render waitingList(result.summary.waiting)}
          {:else}
            <p class="connect-card__description">{m.earnings_connect_incomplete_body()}</p>
          {/if}
        {/await}
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
        {#await data.earningsSummary}
          <p class="connect-card__description">{m.earnings_connect_pending_body()}</p>
        {:then result}
          {#if result.ok && result.summary.waiting}
            <p class="connect-card__description">
              {m.earnings_connect_pending_waiting({ total: formatPence(result.summary.waiting.totalCents) })}
            </p>
            {@render waitingList(result.summary.waiting)}
          {:else}
            <p class="connect-card__description">{m.earnings_connect_pending_body()}</p>
          {/if}
        {/await}
      </div>
      <div class="connect-card__actions">
        <!-- A paused account needs the person to give Stripe something, and
             the monthly email sends them here (M3): the same onboarding link
             as the incomplete state. -->
        <button
          type="button"
          class="btn btn--secondary btn--sm"
          onclick={handleOnboard}
          disabled={isOnboarding}
          aria-busy={isOnboarding}
        >
          {isOnboarding ? m.common_loading() : m.earnings_connect_resume_cta()}
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

  {:else if connectStateStatus === 'enabled'}
    {#await data.stripeBalance}
      <section class="connect-card connect-card--enabled" aria-label="Payout account connected" aria-busy="true">
        <div class="connect-card__body">
          <h2 class="connect-card__title">{m.earnings_connect_enabled_title()}</h2>
          <Skeleton height="2.5rem" width="60%" />
        </div>
        {@render enabledActions()}
      </section>
    {:then result}
      {#if result?.ok}
        {@const notice = switchoverNotice(result.balance.manualPayoutsSince, now)}
        {#if notice}
          <div class="connect-banner connect-banner--info" role="status">
            <span class="connect-banner__message">{notice}</span>
          </div>
        {/if}
      {/if}
      {#if result?.ok && result.balance.negative}
        {@const rule = ruleLine(result.balance.negative.rule)}
        <section class="connect-card connect-card--warning" aria-label={m.earnings_negative_aria()}>
          <div class="connect-card__body">
            <h2 class="connect-card__title">
              {m.earnings_negative_title()} {@render negativeMoney(result.balance.negative.owedCents)}
            </h2>
            <p class="connect-card__description">{m.earnings_negative_body()}</p>
            <p class="connect-card__description">{negativeCauseLine(result.balance.negative.causes)}</p>
            <p class="connect-card__rule"><b>{rule.label}</b> {rule.text}</p>
          </div>
          {@render enabledActions()}
        </section>
      {:else}
        <section class="connect-card connect-card--enabled" aria-label="Payout account connected">
          <div class="connect-card__body">
            <h2 class="connect-card__title">{m.earnings_connect_enabled_title()}</h2>
            {#if result && !result.ok}
              <!-- A failed read is never shown as £0.00 or "nothing waiting" (E8). -->
              <p class="connect-card__inline-error" role="alert">
                {m.earnings_bank_check_failed()}
                <button type="button" class="btn btn--ghost btn--sm" onclick={reload}>
                  {m.earnings_bank_check_retry()}
                </button>
              </p>
              <p class="connect-card__description">{m.earnings_bank_hold_sentence()}</p>
            {:else if result?.ok && result.balance.manualPayouts}
              {@const balance = result.balance}
              {@const inStripe = balance.availableCents + balance.pendingCents}
              {#if balance.nextPayout === null && inStripe <= 0}
                <p class="connect-card__description">{m.earnings_bank_nothing_waiting()}</p>
              {:else}
                <dl class="bank-figures">
                  {#if balance.nextPayout}
                    <div>
                      <dt>{m.earnings_bank_next_payout()}</dt>
                      <dd>
                        {formatPence(balance.nextPayout.amountCents)}<small>{formatDay(balance.nextPayout.on, { weekday: true })}</small>
                      </dd>
                    </div>
                  {/if}
                  <div>
                    <dt>{m.earnings_bank_in_stripe()}</dt>
                    <dd>{formatPence(inStripe)}</dd>
                  </div>
                </dl>
                {#if balance.covering}
                  <p class="connect-card__description">
                    {m.earnings_bank_covering_sentence({ amount: formatPence(balance.covering.cents) })}
                  </p>
                {/if}
                <p class="connect-card__description">{m.earnings_bank_hold_sentence()}</p>
              {/if}
            {/if}
          </div>
          {@render enabledActions()}
        </section>
      {/if}
    {/await}
  {/if}

  {#snippet enabledActions()}
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
  {/snippet}

  {#snippet negativeMoney(owedCents: number)}
    <span class="money-neg"
      ><span class="sr-only">{m.earnings_money_minus()} </span><span aria-hidden="true">−</span>{formatPence(owedCents)}</span
    >
  {/snippet}

  {#snippet waitingList(waiting: WaitingView)}
    <dl class="waiting-list">
      {#each waitingLines(waiting) as line (line.key)}
        <div class="waiting-list__row">
          <dt>
            {line.name}{#if line.asOwner}
              <em> {m.earnings_waiting_owner_share()}</em>{/if}
          </dt>
          <dd>{line.amount}</dd>
        </div>
      {/each}
      <div class="waiting-list__row waiting-list__row--total">
        <dt>{m.earnings_waiting_since({ date: waitingSince(waiting) })}</dt>
        <dd>{formatPence(waiting.totalCents)}</dd>
      </div>
    </dl>
  {/snippet}

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
  {:then result}
    {#if result.ok}
      {@const summary = result.summary}
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
    {:else}
      <!-- A failed read, never empty KPIs. -->
      <div class="stream-error" role="alert" data-testid="earnings-kpi-error">
        <span class="stream-error__message">{m.earnings_kpi_load_error()}</span>
        <button type="button" class="btn btn--ghost btn--sm" onclick={reload}>
          {m.earnings_kpi_retry()}
        </button>
      </div>
    {/if}
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
    {:then result}
      {@const payoutsResult = result.ok ? result.list : null}
      {#if !result.ok}
        <!-- Distinct from empty: the request failed -->
        <div class="stream-error" role="alert" data-testid="earnings-payouts-error">
          <span class="stream-error__message">{m.earnings_payouts_load_error()}</span>
          <button type="button" class="btn btn--ghost btn--sm" onclick={reload}>
            {m.earnings_payouts_retry()}
          </button>
        </div>
      {:else if payoutsResult?.items && payoutsResult.items.length > 0}
        {@const filtered = filterPayouts<PayoutRow>(payoutsResult.items, statusFilter, sourceFilter)}
        {#if filtered.length > 0}
          <div class="payouts-table" role="table" aria-label={m.earnings_payouts_title()}>
            <div class="payouts-table__head" role="row">
              <span class="payouts-table__th" role="columnheader">{m.earnings_payouts_col_date()}</span>
              <span class="payouts-table__th" role="columnheader">{m.earnings_payouts_col_amount()}</span>
              <span class="payouts-table__th" role="columnheader">{m.earnings_payouts_col_status()}</span>
              <span class="payouts-table__th" role="columnheader">{m.earnings_payouts_col_source()}</span>
            </div>
            {#each filtered as payout (payout.id)}
              {@const bankLine = bankLineFor(payout, {
                connectState: connectStateStatus,
                balance: rowBalance,
                now,
              })}
              <div class="payouts-table__row" role="row">
                <span
                  class="payouts-table__cell payouts-table__cell--date"
                  role="cell"
                  data-label={m.earnings_payouts_col_date()}
                >
                  {formatDate(payout.createdAt)}
                </span>
                <span
                  class="payouts-table__cell payouts-table__cell--amount"
                  role="cell"
                  data-label={m.earnings_payouts_col_amount()}
                >
                  {formatPence(payout.amountCents)}
                </span>
                <span class="payouts-table__cell" role="cell" data-label={m.earnings_payouts_col_status()}>
                  <span class="status-stack">
                    <span class="status-badge status-badge--{statusTone(payout.status)}">
                      {statusLabel(payout.status)}
                    </span>
                    {#if bankLine}
                      <span class="bank-line">{bankLine}</span>
                    {/if}
                  </span>
                </span>
                <span class="payouts-table__cell" role="cell" data-label={m.earnings_payouts_col_source()}>
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
        <!-- The read worked and there are no rows -->
        <div class="payouts-empty">
          <p class="payouts-empty__title">{m.earnings_payouts_empty()}</p>
          <p class="payouts-empty__description">{m.earnings_payouts_empty_description()}</p>
        </div>
      {/if}
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

  /* Status tokens, not the raw -50/-200/-700 steps: those are fixed
     light-mode hex, so in dark theme every card was near-white under
     near-white text (themes/status.css). */
  .connect-banner--success {
    background: var(--color-status-success-surface);
    color: var(--color-status-success-text);
    border: var(--border-width) var(--border-style) var(--color-status-success-border);
  }

  .connect-banner--warning {
    background: var(--color-status-warning-surface);
    color: var(--color-status-warning-text);
    border: var(--border-width) var(--border-style) var(--color-status-warning-border);
  }

  .connect-banner--info {
    background: var(--color-status-info-surface);
    color: var(--color-status-info-text);
    border: var(--border-width) var(--border-style) var(--color-status-info-border);
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
    background: color-mix(in oklab, var(--color-interactive) 8%, var(--color-surface));
    border-color: color-mix(in oklab, var(--color-interactive) 40%, var(--color-border));
  }

  .connect-card--warning {
    background: var(--color-status-warning-surface);
    border-color: var(--color-status-warning-border);
  }

  .connect-card--info {
    background: var(--color-surface-secondary);
    border-color: var(--color-border);
  }

  .connect-card--enabled {
    background: var(--color-status-success-surface);
    border-color: var(--color-status-success-border);
  }

  .connect-card--error {
    background: var(--color-status-error-surface);
    border-color: var(--color-status-error-border);
  }

  .connect-card__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    flex: 1 1 auto;
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

  /* ── The money lines in the connect card (Codex-2hxff.29, .30, .34) ───── */
  .bank-figures {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-8);
    margin: 0;
  }

  .bank-figures > div {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .bank-figures dt {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .bank-figures dd {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .bank-figures dd small {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    margin-inline-start: var(--space-1);
  }

  .waiting-list {
    display: grid;
    gap: var(--space-1);
    max-width: var(--measure-narrow);
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
  }

  .waiting-list__row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .waiting-list__row dt {
    color: var(--color-text-secondary);
    min-width: 0;
  }

  .waiting-list__row dt em {
    font-style: normal;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .waiting-list__row dd {
    margin: 0;
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-medium);
  }

  .waiting-list__row--total {
    padding-top: var(--space-1);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .waiting-list__row--total dt,
  .waiting-list__row--total dd {
    color: var(--color-text);
    font-weight: var(--font-semibold);
  }

  .connect-card__rule {
    margin: 0;
    padding-top: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text);
    border-top: var(--border-width) var(--border-style) var(--color-status-warning-border);
  }

  .connect-card__rule b {
    font-weight: var(--font-semibold);
  }

  .connect-card__inline-error {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .money-neg {
    color: var(--color-status-error-text);
  }

  /* The connect card is a body↔actions row on desktop; on phones the actions
     (Stripe dashboard + refresh) overflow past the viewport, so stack the card
     and let the buttons wrap full-width. */
  @media (--below-sm) {
    .connect-card {
      flex-direction: column;
      align-items: stretch;
    }
    .connect-card__actions {
      flex-wrap: wrap;
    }
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
    border-color: var(--color-status-warning-border);
    background: var(--color-status-warning-surface);
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
    background: var(--color-status-error-surface);
    border: var(--border-width) var(--border-style) var(--color-status-error-border);
  }

  .stream-error__message {
    font-size: var(--text-sm);
    color: var(--color-status-error-text);
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
    background: color-mix(in oklab, var(--color-interactive) 12%, var(--color-surface));
    border-color: color-mix(in oklab, var(--color-interactive) 45%, var(--color-border));
    color: var(--color-text);
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

  /* On phones the four equal columns collapse to unreadable slivers, so each
     row becomes a stacked label/value card. The header row is redundant once
     each cell carries its own label via data-label, so it is hidden. ARIA
     table semantics (role="table"/row/cell) are unaffected. */
  @media (--below-sm) {
    .payouts-table__head {
      display: none;
    }

    .payouts-table__row {
      grid-template-columns: 1fr;
      gap: var(--space-2);
      padding: var(--space-4);
    }

    .payouts-table__cell {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
    }

    .payouts-table__cell::before {
      content: attr(data-label);
      font-size: var(--text-xs);
      font-weight: var(--font-semibold);
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
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
    background: var(--color-status-success-surface);
    color: var(--color-status-success-text);
  }

  .status-badge--pending {
    background: var(--color-status-warning-surface);
    color: var(--color-status-warning-text);
  }

  .status-badge--failed {
    background: var(--color-status-error-surface);
    color: var(--color-status-error-text);
  }

  /* Reversed and cancelled rows: neutral, as on the org Payouts page. */
  .status-badge--neutral {
    background: var(--color-surface-secondary);
    color: var(--color-text);
  }

  /* The per-sale bank line under the status badge (E1-E6). */
  .status-stack {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
  }

  .bank-line {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: var(--leading-snug);
  }

  @media (--below-sm) {
    .status-stack {
      align-items: flex-end;
      text-align: end;
    }

    .bank-figures {
      gap: var(--space-3) var(--space-6);
    }
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
    background: var(--color-interactive);
    color: var(--color-on-interactive);
    border-color: var(--color-interactive);
  }

  .btn--primary:hover:not(:disabled) {
    background: color-mix(in oklab, var(--color-interactive) 88%, var(--color-text));
    border-color: color-mix(in oklab, var(--color-interactive) 88%, var(--color-text));
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

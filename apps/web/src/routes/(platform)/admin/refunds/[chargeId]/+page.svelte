<!--
  /admin/refunds/[chargeId] — one charge, and its refund form (Codex-2hxff.28,
  mockup B1–B4, C1).

  The charge is ONE awaited call: header, split, refunds and chargebacks are
  one answer, so a half-loaded page can never invite a refund on partial
  data. Until it lands the page shows a skeleton and no form. While it
  reloads (after a refund, or Refresh) the form stays shown but Review waits.

  After a submit the outcome shows above the refunds list (B3), and the
  refunds card moves to the top of the record so the two sit together. The
  charge is reloaded once when what it shows is known to be out of date, and
  the counts with it when a refund exists; then Refresh (Q10). No polling.
-->
<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { Alert, Badge, Button, EmptyState, PageHeader, Skeleton } from '$lib/components/ui';
  import * as Card from '$lib/components/ui/Card';
  import { ArrowLeftIcon, ReceiptIcon } from '$lib/components/ui/Icon';
  import { formatPrice } from '$lib/utils/format';
  import ChargebacksCard from '$lib/components/support/ChargebacksCard.svelte';
  import ChargeSummaryCard from '$lib/components/support/ChargeSummaryCard.svelte';
  import RefundForm from '$lib/components/support/RefundForm.svelte';
  import RefundOutcomeAlert from '$lib/components/support/RefundOutcomeAlert.svelte';
  import RefundsCard from '$lib/components/support/RefundsCard.svelte';
  import SplitCard from '$lib/components/support/SplitCard.svelte';
  import {
    type RefundOutcome,
    refreshesCounts,
    reloadsCharge,
  } from '$lib/components/support/refund-outcome';
  import {
    chargeKindLabel,
    daysLeftText,
    formatDayTime,
    formatShortDay,
  } from '$lib/components/support/support-format';
  import { queryErrorMessage } from '$lib/remote/query-result';
  import { getSupportCharge, getSupportQueueCounts } from '$lib/remote/support.remote';

  /** The route's own pattern: anything else is not a charge, so not found. */
  const CHARGE_ID = /^(ch|py)_[A-Za-z0-9]{8,64}$/;

  const chargeId = $derived(page.params.chargeId ?? '');
  const isChargeId = $derived(CHARGE_ID.test(chargeId));

  const chargeQuery = $derived(isChargeId ? getSupportCharge(chargeId) : null);
  const detail = $derived(chargeQuery?.current);
  const loadError = $derived(queryErrorMessage(chargeQuery?.error));
  const notFound = $derived(
    !isChargeId ||
      (detail === undefined &&
        (chargeQuery?.error as { status?: unknown } | undefined)?.status === 404)
  );
  const reloading = $derived(detail !== undefined && chargeQuery?.loading === true);

  let outcome = $state<RefundOutcome | null>(null);
  let refreshingByHand = $state(false);

  // A different charge starts clean.
  $effect(() => {
    void chargeId;
    outcome = null;
  });

  // "Back to results" returns to the search it came from, query and all.
  let backHref = $state('/admin/refunds');
  afterNavigate(({ from }) => {
    if (from?.url.pathname === '/admin/refunds') {
      backHref = `${from.url.pathname}${from.url.search}`;
    }
  });

  function reloadCharge(): Promise<void> {
    return chargeQuery?.refresh().catch(() => {}) ?? Promise.resolve();
  }

  async function handleRefresh() {
    refreshingByHand = true;
    await Promise.all([
      reloadCharge(),
      getSupportQueueCounts().refresh().catch(() => {}),
    ]);
    refreshingByHand = false;
  }

  function handleOutcome(next: RefundOutcome) {
    outcome = next;
    if (reloadsCharge(next)) void reloadCharge();
    if (refreshesCounts(next)) void getSupportQueueCounts().refresh().catch(() => {});
  }

  const header = $derived.by(() => {
    if (!detail) return null;
    const source = detail.source;
    const title =
      source.type === 'purchase'
        ? (source.item?.title ?? m.support_item_unknown())
        : source.planName;
    return {
      kicker:
        source.type === 'purchase'
          ? chargeKindLabel('purchase')
          : chargeKindLabel(
              source.type === 'course_subscription'
                ? 'course_plan_invoice'
                : 'subscription_invoice'
            ),
      title: m.support_charge_title({
        title:
          source.type === 'purchase'
            ? title
            : `${title} · ${source.interval === 'year' ? m.support_interval_year() : m.support_interval_month()}`,
        amount: formatPrice(detail.charge.amountCents),
      }),
    };
  });

  const showRefresh = $derived(outcome?.kind === 'made');
</script>

<svelte:head>
  <title>{header?.title ?? m.support_refunds_title()} · {m.support_nav_label()}</title>
</svelte:head>

<a class="back-link" href={backHref}>
  <ArrowLeftIcon size={16} />
  {m.support_back_to_results()}
</a>

{#if notFound}
  <Card.Root>
    <EmptyState
      title={m.support_not_found_title()}
      description={m.support_not_found_body()}
      icon={ReceiptIcon}
      headingLevel={2}
    />
  </Card.Root>
{:else if detail === undefined && loadError !== null}
  <Alert variant="error" data-testid="charge-load-error">
    <p><strong>{m.support_load_error_lead()}</strong> {loadError}</p>
    <div class="alert-actions">
      <Button variant="secondary" size="sm" onclick={() => void reloadCharge()}>
        {m.support_try_again()}
      </Button>
    </div>
  </Alert>
{:else if detail === undefined}
  <div class="charge-skeleton" aria-busy="true" data-testid="charge-loading">
    <span class="sr-only" role="status">{m.support_loading_charge()}</span>
    <Skeleton width="40%" height="var(--space-8)" />
    <Skeleton width="60%" height="var(--space-5)" />
    <div class="charge-grid">
      <div class="charge-main">
        <Skeleton width="100%" height="var(--space-24)" />
        <Skeleton width="100%" height="var(--space-24)" />
      </div>
      <div class="charge-aside">
        <Skeleton width="100%" height="var(--space-24)" />
      </div>
    </div>
  </div>
{:else if header}
  <PageHeader kicker={header.kicker} title={header.title}>
    {#snippet actions()}
      {#if detail.window.isOpen}
        <Badge variant="success">
          {m.support_window_badge_open({ left: daysLeftText(detail.window.closesAt) })}
        </Badge>
      {:else}
        <Badge>
          {m.support_window_badge_closed({ date: formatShortDay(detail.window.closesAt) })}
        </Badge>
      {/if}
    {/snippet}
    {#snippet meta()}
      <li>{detail.buyer.name} · {detail.buyer.email}</li>
      <li>{m.support_paid_at({ date: formatDayTime(detail.charge.paidAt) })}</li>
      {#if detail.charge.card}
        <li>
          {m.support_card({
            brand:
              detail.charge.card.brand.charAt(0).toUpperCase() +
              detail.charge.card.brand.slice(1),
            last4: detail.charge.card.last4,
          })}
        </li>
      {/if}
    {/snippet}
  </PageHeader>

  {#if loadError !== null}
    <Alert variant="warning" data-testid="charge-reload-error">
      <p><strong>{m.support_reload_error_lead()}</strong> {m.support_reload_error_body()}</p>
      <div class="alert-actions">
        <Button variant="secondary" size="sm" onclick={() => void reloadCharge()}>
          {m.support_try_again()}
        </Button>
      </div>
    </Alert>
  {/if}

  {#if outcome}
    <RefundOutcomeAlert
      {outcome}
      {detail}
      reloading={reloading}
      onReload={() => void reloadCharge()}
    />
  {/if}

  <div class="charge-grid">
    <div class="charge-main">
      {#if outcome}
        <RefundsCard
          {detail}
          onRefresh={showRefresh ? handleRefresh : undefined}
          refreshing={refreshingByHand}
        />
      {/if}
      <ChargeSummaryCard {detail} />
      <SplitCard {detail} />
      {#if !outcome}
        <RefundsCard {detail} />
      {/if}
      <ChargebacksCard chargebacks={detail.chargebacks} />
    </div>
    <aside class="charge-aside">
      <RefundForm {detail} stale={reloading} onOutcome={handleOutcome} />
    </aside>
  </div>
{/if}

<style>
  .back-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    align-self: flex-start;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-decoration: none;
    border-radius: var(--radius-sm);
  }

  .back-link:hover {
    color: var(--color-text);
  }

  .back-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .alert-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .charge-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .charge-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-6);
    align-items: start;
  }

  .charge-main,
  .charge-aside {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
  }

  /* One column: the form comes straight after the first card of the record. */
  @media (--below-lg) {
    .charge-main {
      display: contents;
    }

    .charge-main > :global(*) {
      order: 2;
    }

    .charge-main > :global(:first-child) {
      order: 0;
    }

    .charge-aside {
      order: 1;
    }
  }

  /* Two columns: the form stays in view while the record scrolls. */
  @media (--breakpoint-lg) {
    .charge-grid {
      grid-template-columns: minmax(0, 1fr) var(--container-drawer);
    }

    .charge-aside {
      position: sticky;
      top: var(--space-6);
    }
  }
</style>

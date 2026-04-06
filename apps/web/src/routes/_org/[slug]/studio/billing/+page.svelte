<!--
  @component StudioBilling

  Billing page for organization owners.
  Displays revenue summary cards, Stripe portal access, and top content by revenue.
  Fetches data client-side to avoid __data.json round-trips.

  @prop data - Org info and userRole from parent studio layout
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import * as m from '$paraglide/messages';
  import StatCard from '$lib/components/studio/StatCard.svelte';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import * as Table from '$lib/components/ui/Table';
  import { Alert, Card, EmptyState } from '$lib/components/ui';
  import { portalSessionForm, getOrgRevenue, getTopContent } from '$lib/remote/billing.remote';

  let { data } = $props();

  // Role guard: owner only
  $effect(() => {
    if (data.userRole !== 'owner') {
      goto('/studio');
    }
  });

  const isOwner = $derived(data.userRole === 'owner');

  const revenueQuery = $derived(
    isOwner ? getOrgRevenue({ organizationId: data.org.id }) : null
  );

  const topContentQuery = $derived(
    isOwner ? getTopContent({ organizationId: data.org.id, limit: 5 }) : null
  );

  const loading = $derived((revenueQuery?.loading ?? true) || (topContentQuery?.loading ?? true));

  /**
   * Format cents to currency string (GBP)
   */
  function formatCurrency(cents: number): string {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  }

  // Derived stats from revenue data
  const totalRevenue = $derived(revenueQuery?.current?.totalRevenueCents ?? 0);
  const totalPurchases = $derived(revenueQuery?.current?.totalPurchases ?? 0);
  const avgOrder = $derived(revenueQuery?.current?.averageOrderValueCents ?? 0);

  // Top content items
  const topContentItems = $derived(topContentQuery?.current?.items ?? []);
</script>

<svelte:head>
  <title>{m.billing_title()} | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#if !isOwner}
  <!-- Redirecting... -->
{:else}
<div class="billing">
  <header class="billing-header">
    <h1 class="billing-title">{m.billing_title()}</h1>
  </header>

  <!-- Revenue Summary Cards -->
  <section class="stats-grid" aria-label={m.billing_title()}>
    <StatCard
      label={m.billing_total_revenue()}
      value={formatCurrency(totalRevenue)}
      loading={loading}
    />
    <StatCard
      label={m.billing_total_purchases()}
      value={totalPurchases}
      loading={loading}
    />
    <StatCard
      label={m.billing_avg_order()}
      value={formatCurrency(avgOrder)}
      loading={loading}
    />
  </section>

  <!-- Manage Billing Section -->
  <Card.Root>
    <Card.Header>
      <Card.Title level={2}>{m.billing_manage_stripe()}</Card.Title>
      <Card.Description>{m.billing_manage_stripe_description()}</Card.Description>
    </Card.Header>
    <Card.Content>
      <form {...portalSessionForm} class="portal-form">
        <Button type="submit" variant="secondary" loading={portalSessionForm.pending > 0}>
          {portalSessionForm.pending > 0 ? m.common_loading() : m.billing_manage_stripe()}
        </Button>
      </form>

      {#if portalSessionForm.result?.error}
        <Alert variant="error" style="margin-top: var(--space-3)">{portalSessionForm.result.error}</Alert>
      {/if}
    </Card.Content>
  </Card.Root>

  <!-- Top Content by Revenue -->
  <Card.Root>
    <Card.Header>
      <Card.Title level={2}>{m.billing_top_content()}</Card.Title>
    </Card.Header>
    <Card.Content>
    {#if loading}
      <div class="table-skeleton">
        <div class="skeleton table-skeleton-header" style="width: 100%; height: var(--space-10);"></div>
        {#each Array(5) as _, i}
          <div class="table-skeleton-row">
            <div class="skeleton" style="width: {40 + (i % 3) * 8}%; height: var(--space-5);"></div>
            <div class="skeleton" style="width: 20%; height: var(--space-5);"></div>
            <div class="skeleton" style="width: 15%; height: var(--space-5);"></div>
          </div>
        {/each}
      </div>
    {:else if topContentItems.length > 0}
      <div class="table-wrapper">
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>{m.billing_top_content_column_title()}</Table.Head>
              <Table.Head>{m.billing_top_content_column_revenue()}</Table.Head>
              <Table.Head>{m.billing_top_content_column_purchases()}</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each topContentItems as item (item.contentId)}
              <Table.Row>
                <Table.Cell class="content-title-cell">
                  {item.contentTitle}
                </Table.Cell>
                <Table.Cell class="revenue-cell">
                  {formatCurrency(item.revenueCents)}
                </Table.Cell>
                <Table.Cell class="purchases-cell">
                  {item.purchaseCount}
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </div>
    {:else}
      <EmptyState title={m.billing_top_content_empty()} />
    {/if}
    </Card.Content>
  </Card.Root>
</div>
{/if}

<style>
  .billing {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 1200px;
  }

  .billing-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .billing-title {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
    line-height: var(--leading-tight);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }

  @media (--breakpoint-sm) {
    .stats-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .portal-form {
    margin-top: var(--space-2);
  }

  .table-wrapper {
    overflow-x: auto;
    margin-top: var(--space-4);
  }

  .table-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .table-skeleton-header {
    border-radius: var(--radius-md) var(--radius-md) 0 0;
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

  :global(.content-title-cell) {
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  :global(.revenue-cell) {
    font-weight: var(--font-medium);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  :global(.purchases-cell) {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }


</style>

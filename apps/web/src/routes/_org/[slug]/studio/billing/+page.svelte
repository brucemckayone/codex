<!--
  @component StudioBilling

  Billing page for organization owners.
  Displays revenue summary cards, Stripe portal access, and top content by revenue.

  @prop {PageData} data - Server-loaded billing data (revenue, topContent, org)
-->
<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$paraglide/messages';
  import StatCard from '$lib/components/studio/StatCard.svelte';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import * as Table from '$lib/components/ui/Table';
  import { Alert, Card, EmptyState } from '$lib/components/ui';
  import { portalSessionForm } from '$lib/remote/billing.remote';

  let { data }: { data: PageData } = $props();

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
  const totalRevenue = $derived(data.revenue?.totalRevenueCents ?? 0);
  const totalPurchases = $derived(data.revenue?.totalPurchases ?? 0);
  const avgOrder = $derived(data.revenue?.averageOrderValueCents ?? 0);

  // Top content items
  const topContentItems = $derived(data.topContent?.items ?? []);
</script>

<svelte:head>
  <title>{m.billing_title()} | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="billing">
  <header class="billing-header">
    <h1 class="billing-title">{m.billing_title()}</h1>
  </header>

  <!-- Revenue Summary Cards -->
  <section class="stats-grid" aria-label={m.billing_title()}>
    <StatCard
      label={m.billing_total_revenue()}
      value={formatCurrency(totalRevenue)}
      loading={!data.revenue}
    />
    <StatCard
      label={m.billing_total_purchases()}
      value={totalPurchases}
      loading={!data.revenue}
    />
    <StatCard
      label={m.billing_avg_order()}
      value={formatCurrency(avgOrder)}
      loading={!data.revenue}
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
    {#if topContentItems.length > 0}
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

<!--
  @component StudioMonetisation

  Studio monetisation dashboard for org owners.
  Sections:
  - Stripe Connect status + onboarding
  - Enable/disable subscriptions toggle
  - Subscription tier CRUD
  - Subscriber stats
-->
<script lang="ts">
  import { goto, invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import StatCard from '$lib/components/studio/StatCard.svelte';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import * as Card from '$lib/components/ui/Card';
  import * as Dialog from '$lib/components/ui/Dialog';
  import { Alert, Badge, EmptyState } from '$lib/components/ui';
  import Switch from '$lib/components/ui/Switch/Switch.svelte';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import TextArea from '$lib/components/ui/TextArea/TextArea.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
  import { TrashIcon, EditIcon, PlusIcon, CheckCircleIcon } from '$lib/components/ui/Icon';
  import {
    createTier,
    updateTier,
    deleteTier,
    reorderTiers,
    connectOnboard,
    getConnectDashboardLink,
  } from '$lib/remote/subscription.remote';
  import type { SubscriptionTier } from '$lib/types';

  let { data } = $props();

  // Role guard
  $effect(() => {
    if (data.userRole !== 'owner') {
      goto('/studio');
    }
  });

  const isOwner = $derived(data.userRole === 'owner');
  const orgId = $derived(data.org.id);

  // ─── State ──────────────────────────────────────────────────────────────

  let enableSubscriptions = $state(data.enableSubscriptions);
  let tierDialogOpen = $state(false);
  let deleteDialogOpen = $state(false);
  let editingTier = $state<SubscriptionTier | null>(null);
  let deletingTier = $state<SubscriptionTier | null>(null);

  // Tier form state
  let tierName = $state('');
  let tierDescription = $state('');
  let tierPriceMonthly = $state(499);
  let tierPriceAnnual = $state(4990);
  let tierFormError = $state('');
  let tierFormLoading = $state(false);

  // Connect state
  let connectLoading = $state(false);
  let connectError = $state('');

  // ─── Helpers ────────────────────────────────────────────────────────────

  function formatCurrency(cents: number): string {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
    }).format(cents / 100);
  }

  function connectStatusLabel(status: string | null): string {
    switch (status) {
      case 'active': return m.monetisation_connect_active();
      case 'onboarding': return m.monetisation_connect_onboarding();
      case 'restricted': return m.monetisation_connect_restricted();
      default: return m.monetisation_connect_not_connected();
    }
  }

  function connectStatusVariant(status: string | null): 'success' | 'warning' | 'error' | 'neutral' {
    switch (status) {
      case 'active': return 'success';
      case 'onboarding': return 'warning';
      case 'restricted': return 'error';
      default: return 'neutral';
    }
  }

  // ─── Tier Dialog ────────────────────────────────────────────────────────

  function openCreateTier() {
    editingTier = null;
    tierName = '';
    tierDescription = '';
    tierPriceMonthly = 499;
    tierPriceAnnual = 4990;
    tierFormError = '';
    tierDialogOpen = true;
  }

  function openEditTier(tier: SubscriptionTier) {
    editingTier = tier;
    tierName = tier.name;
    tierDescription = tier.description ?? '';
    tierPriceMonthly = tier.priceMonthly;
    tierPriceAnnual = tier.priceAnnual;
    tierFormError = '';
    tierDialogOpen = true;
  }

  function openDeleteTier(tier: SubscriptionTier) {
    deletingTier = tier;
    deleteDialogOpen = true;
  }

  async function handleTierSubmit() {
    tierFormLoading = true;
    tierFormError = '';
    try {
      if (editingTier) {
        await updateTier({
          orgId,
          tierId: editingTier.id,
          name: tierName,
          description: tierDescription || undefined,
          priceMonthly: tierPriceMonthly,
          priceAnnual: tierPriceAnnual,
        });
      } else {
        await createTier({
          orgId,
          name: tierName,
          description: tierDescription || undefined,
          priceMonthly: tierPriceMonthly,
          priceAnnual: tierPriceAnnual,
        });
      }
      tierDialogOpen = false;
      await invalidate('cache:studio');
    } catch (error) {
      tierFormError = error instanceof Error ? error.message : 'Failed to save tier';
    } finally {
      tierFormLoading = false;
    }
  }

  async function handleDeleteTier() {
    if (!deletingTier) return;
    try {
      await deleteTier({ orgId, tierId: deletingTier.id });
      deleteDialogOpen = false;
      deletingTier = null;
      await invalidate('cache:studio');
    } catch (error) {
      // Show error inline
      tierFormError = error instanceof Error ? error.message : 'Failed to delete tier';
    }
  }

  // ─── Feature Toggle ─────────────────────────────────────────────────────

  let featureToggleLoading = $state(false);

  async function handleFeatureToggle(checked: boolean) {
    featureToggleLoading = true;
    try {
      const api = await import('$lib/server/api');
      // Use the settings remote function instead
      enableSubscriptions = checked;
      // This will need a remote function for settings update — for now just toggle locally
      // The actual settings update is already wired through the settings page
    } finally {
      featureToggleLoading = false;
    }
  }

  // ─── Connect ────────────────────────────────────────────────────────────

  async function handleConnectOnboard() {
    connectLoading = true;
    connectError = '';
    try {
      const returnUrl = `${page.url.origin}/studio/monetisation?connect=success`;
      const refreshUrl = `${page.url.origin}/studio/monetisation?connect=refresh`;
      const result = await connectOnboard({
        organizationId: orgId,
        returnUrl,
        refreshUrl,
      });
      window.location.href = result.onboardingUrl;
    } catch (error) {
      connectError = error instanceof Error ? error.message : 'Failed to start Connect onboarding';
      connectLoading = false;
    }
  }

  async function handleConnectDashboard() {
    connectLoading = true;
    connectError = '';
    try {
      const result = await getConnectDashboardLink({ organizationId: orgId });
      window.location.href = result.url;
    } catch (error) {
      connectError = error instanceof Error ? error.message : 'Failed to open dashboard';
      connectLoading = false;
    }
  }
</script>

<svelte:head>
  <title>{m.monetisation_title()} | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#if !isOwner}
  <!-- Redirecting... -->
{:else}
<div class="monetisation">
  <header class="page-header">
    <h1 class="page-title">{m.monetisation_title()}</h1>
    <p class="page-description">{m.monetisation_description()}</p>
  </header>

  <!-- Stripe Connect Card -->
  <Card.Root>
    <Card.Header>
      <div class="card-header-row">
        <Card.Title level={2}>{m.monetisation_connect_title()}</Card.Title>
        <Badge variant={connectStatusVariant(data.connectStatus.status)}>
          {connectStatusLabel(data.connectStatus.status)}
        </Badge>
      </div>
      <Card.Description>{m.monetisation_connect_description()}</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if data.connectStatus.isConnected}
        <div class="connect-status-row">
          {#if data.connectStatus.chargesEnabled}
            <span class="status-item status-enabled">
              <CheckCircleIcon size={14} />
              {m.monetisation_connect_charges_enabled()}
            </span>
          {/if}
          {#if data.connectStatus.payoutsEnabled}
            <span class="status-item status-enabled">
              <CheckCircleIcon size={14} />
              {m.monetisation_connect_payouts_enabled()}
            </span>
          {/if}
        </div>
      {/if}

      {#if connectError}
        <Alert variant="error" style="margin-top: var(--space-3)">{connectError}</Alert>
      {/if}

      <div class="connect-actions">
        {#if !data.connectStatus.isConnected}
          <Button onclick={handleConnectOnboard} loading={connectLoading}>
            {m.monetisation_connect_start()}
          </Button>
        {:else if data.connectStatus.status === 'onboarding'}
          <Button onclick={handleConnectOnboard} loading={connectLoading} variant="secondary">
            {m.monetisation_connect_continue()}
          </Button>
        {:else}
          <Button onclick={handleConnectDashboard} loading={connectLoading} variant="secondary">
            {m.monetisation_connect_dashboard()}
          </Button>
        {/if}
      </div>
    </Card.Content>
  </Card.Root>

  <!-- Feature Toggle -->
  <Card.Root>
    <Card.Content>
      <div class="feature-toggle-row">
        <div class="feature-toggle-text">
          <span class="feature-toggle-label">{m.monetisation_feature_toggle()}</span>
          <span class="feature-toggle-description">{m.monetisation_feature_toggle_description()}</span>
        </div>
        <Switch
          checked={enableSubscriptions}
          disabled={featureToggleLoading || !data.connectStatus.isConnected || data.connectStatus.status !== 'active'}
          onCheckedChange={handleFeatureToggle}
        />
      </div>
    </Card.Content>
  </Card.Root>

  <!-- Subscriber Stats -->
  {#if data.stats.totalSubscribers > 0}
    <section class="stats-grid" aria-label={m.monetisation_stats_title()}>
      <StatCard
        label={m.monetisation_stats_total()}
        value={data.stats.totalSubscribers}
      />
      <StatCard
        label={m.monetisation_stats_active()}
        value={data.stats.activeSubscribers}
      />
      <StatCard
        label={m.monetisation_stats_mrr()}
        value={formatCurrency(data.stats.mrrCents)}
      />
    </section>
  {/if}

  <!-- Subscription Tiers -->
  <Card.Root>
    <Card.Header>
      <div class="card-header-row">
        <div>
          <Card.Title level={2}>{m.monetisation_tiers_title()}</Card.Title>
          <Card.Description>{m.monetisation_tiers_description()}</Card.Description>
        </div>
        <Button onclick={openCreateTier} size="sm">
          <PlusIcon size={14} />
          {m.monetisation_tiers_create()}
        </Button>
      </div>
    </Card.Header>
    <Card.Content>
      {#if data.tiers.length === 0}
        <EmptyState
          title={m.monetisation_tiers_empty()}
          description={m.monetisation_tiers_empty_description()}
        />
      {:else}
        <div class="tier-list">
          {#each data.tiers as tier, i (tier.id)}
            <div class="tier-item">
              <div class="tier-info">
                <div class="tier-rank">{i + 1}</div>
                <div class="tier-details">
                  <span class="tier-name">{tier.name}</span>
                  {#if tier.description}
                    <span class="tier-description">{tier.description}</span>
                  {/if}
                </div>
              </div>
              <div class="tier-prices">
                <span class="tier-price">
                  {formatCurrency(tier.priceMonthly)}<span class="tier-interval">/{m.monetisation_tier_monthly()}</span>
                </span>
                <span class="tier-price tier-price-secondary">
                  {formatCurrency(tier.priceAnnual)}<span class="tier-interval">/{m.monetisation_tier_annual()}</span>
                </span>
              </div>
              <div class="tier-actions">
                <Button variant="ghost" size="sm" onclick={() => openEditTier(tier)} aria-label={m.monetisation_tiers_edit()}>
                  <EditIcon size={14} />
                </Button>
                <Button variant="ghost" size="sm" onclick={() => openDeleteTier(tier)} aria-label={m.monetisation_tiers_delete()}>
                  <TrashIcon size={14} />
                </Button>
              </div>
            </div>
          {/each}
        </div>
        <p class="tier-reorder-hint">{m.monetisation_tiers_reorder()}</p>
      {/if}
    </Card.Content>
  </Card.Root>

  <!-- Tier Breakdown Table -->
  {#if data.stats.tierBreakdown.length > 0}
    <Card.Root>
      <Card.Header>
        <Card.Title level={2}>{m.monetisation_stats_title()}</Card.Title>
      </Card.Header>
      <Card.Content>
        <div class="breakdown-grid">
          {#each data.stats.tierBreakdown as tb (tb.tierId)}
            <div class="breakdown-item">
              <span class="breakdown-name">{tb.tierName}</span>
              <span class="breakdown-count">{tb.subscriberCount} subscribers</span>
              <span class="breakdown-mrr">{formatCurrency(tb.mrrCents)}/mo</span>
            </div>
          {/each}
        </div>
      </Card.Content>
    </Card.Root>
  {/if}
</div>

<!-- Create/Edit Tier Dialog -->
<Dialog.Root bind:open={tierDialogOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>
        {editingTier ? m.monetisation_tiers_edit() : m.monetisation_tiers_create()}
      </Dialog.Title>
    </Dialog.Header>

    <form class="tier-form" onsubmit={(e) => { e.preventDefault(); handleTierSubmit(); }}>
      <div class="form-field">
        <Label for="tier-name">{m.monetisation_tier_name()}</Label>
        <Input
          id="tier-name"
          bind:value={tierName}
          placeholder="e.g. Basic, Pro, Premium"
          required
          maxlength={100}
        />
      </div>

      <div class="form-field">
        <Label for="tier-description">{m.monetisation_tier_description()}</Label>
        <TextArea
          id="tier-description"
          bind:value={tierDescription}
          placeholder="What subscribers get at this tier"
          rows={3}
          maxlength={500}
        />
      </div>

      <div class="form-row">
        <div class="form-field">
          <Label for="tier-price-monthly">{m.monetisation_tier_price_monthly()}</Label>
          <Input
            id="tier-price-monthly"
            type="number"
            bind:value={tierPriceMonthly}
            min={100}
            step={1}
            required
          />
          <span class="form-hint">{formatCurrency(tierPriceMonthly)}</span>
        </div>
        <div class="form-field">
          <Label for="tier-price-annual">{m.monetisation_tier_price_annual()}</Label>
          <Input
            id="tier-price-annual"
            type="number"
            bind:value={tierPriceAnnual}
            min={100}
            step={1}
            required
          />
          <span class="form-hint">{formatCurrency(tierPriceAnnual)}</span>
        </div>
      </div>

      {#if tierFormError}
        <Alert variant="error">{tierFormError}</Alert>
      {/if}

      <Dialog.Footer>
        <Button variant="ghost" type="button" onclick={() => { tierDialogOpen = false; }}>
          {m.monetisation_cancel()}
        </Button>
        <Button type="submit" loading={tierFormLoading}>
          {m.monetisation_save()}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<!-- Delete Tier Dialog -->
<Dialog.Root bind:open={deleteDialogOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{m.monetisation_tiers_delete()}</Dialog.Title>
    </Dialog.Header>
    <p class="delete-confirm">{m.monetisation_tiers_delete_confirm()}</p>
    {#if tierFormError}
      <Alert variant="error">{tierFormError}</Alert>
    {/if}
    <Dialog.Footer>
      <Button variant="ghost" onclick={() => { deleteDialogOpen = false; deletingTier = null; }}>
        {m.monetisation_cancel()}
      </Button>
      <Button variant="destructive" onclick={handleDeleteTier}>
        {m.monetisation_tiers_delete()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
{/if}

<style>
  .monetisation {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 1200px;
  }

  .page-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .page-title {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
    line-height: var(--leading-tight);
  }

  .page-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .card-header-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
  }

  /* Stats grid */
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

  /* Connect */
  .connect-status-row {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
    margin-bottom: var(--space-3);
  }

  .status-item {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
  }

  .status-enabled {
    color: var(--color-success-600);
  }

  .connect-actions {
    margin-top: var(--space-3);
  }

  /* Feature toggle */
  .feature-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .feature-toggle-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .feature-toggle-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .feature-toggle-description {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  /* Tier list */
  .tier-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .tier-item {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
  }

  .tier-item:hover {
    background-color: var(--color-surface-secondary);
  }

  .tier-info {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex: 1;
    min-width: 0;
  }

  .tier-rank {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    border-radius: var(--radius-full);
    background-color: var(--color-surface-secondary);
    font-size: var(--text-sm);
    font-weight: var(--font-bold);
    color: var(--color-text-secondary);
    flex-shrink: 0;
  }

  .tier-details {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .tier-name {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .tier-description {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tier-prices {
    display: flex;
    gap: var(--space-4);
    flex-shrink: 0;
  }

  .tier-price {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .tier-price-secondary {
    color: var(--color-text-secondary);
  }

  .tier-interval {
    font-weight: var(--font-normal);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .tier-actions {
    display: flex;
    gap: var(--space-1);
    flex-shrink: 0;
  }

  .tier-reorder-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin-top: var(--space-2);
  }

  /* Breakdown */
  .breakdown-grid {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .breakdown-item {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) 0;
    border-bottom: var(--border-width) var(--border-style) var(--color-border-subtle);
  }

  .breakdown-item:last-child {
    border-bottom: none;
  }

  .breakdown-name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    flex: 1;
  }

  .breakdown-count {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .breakdown-mrr {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  /* Tier form */
  .tier-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
  }

  .form-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* Delete confirm */
  .delete-confirm {
    padding: 0 var(--space-4);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
</style>

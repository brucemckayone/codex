<!--
  @component OrgPricing

  Customer-facing pricing page showing subscription tiers.
  Displays monthly/annual toggle, tier cards with CTA buttons,
  and current plan badge if the user is subscribed.
-->
<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import { Badge, EmptyState } from '$lib/components/ui';
  import { CheckIcon } from '$lib/components/ui/Icon';
  import { createSubscriptionCheckoutSession } from '$lib/remote/subscription.remote';
  import type { SubscriptionTier } from '$lib/types';
  import { formatPrice } from '$lib/utils/format';

  let { data } = $props();

  let billingInterval = $state<'month' | 'year'>('month');
  let checkoutLoading = $state<string | null>(null);

  const tiers: SubscriptionTier[] = $derived(data.tiers ?? []);
  const currentTierId = $derived(data.currentSubscription?.tierId ?? null);

  function savingsPercent(tier: SubscriptionTier): number {
    const monthlyTotal = tier.priceMonthly * 12;
    if (monthlyTotal <= 0) return 0;
    return Math.round(((monthlyTotal - tier.priceAnnual) / monthlyTotal) * 100);
  }

  function tierPrice(tier: SubscriptionTier): number {
    return billingInterval === 'month' ? tier.priceMonthly : tier.priceAnnual;
  }

  async function handleSubscribe(tier: SubscriptionTier) {
    if (!data.isAuthenticated) {
      const returnUrl = encodeURIComponent(page.url.pathname);
      window.location.href = `/login?redirect=${returnUrl}`;
      return;
    }

    checkoutLoading = tier.id;
    try {
      const result = await createSubscriptionCheckoutSession({
        tierId: tier.id,
        billingInterval,
        organizationId: data.org.id,
      });
      window.location.href = result.sessionUrl;
    } catch {
      checkoutLoading = null;
    }
  }
</script>

<svelte:head>
  <title>{m.subscription_pricing_title()} | {data.org.name}</title>
  <meta name="description" content={m.subscription_pricing_subtitle()} />
</svelte:head>

<div class="pricing-page">
  <header class="pricing-header">
    <h1 class="pricing-title">{m.subscription_pricing_title()}</h1>
    <p class="pricing-subtitle">{m.subscription_pricing_subtitle()}</p>
  </header>

  {#if tiers.length === 0}
    <EmptyState title={m.pricing_no_tiers()} />
  {:else}
    <!-- Billing Toggle -->
    <div class="billing-toggle" role="radiogroup" aria-label="Billing period">
      <button
        class="toggle-option"
        class:active={billingInterval === 'month'}
        onclick={() => { billingInterval = 'month'; }}
        role="radio"
        aria-checked={billingInterval === 'month'}
      >
        {m.pricing_monthly()}
      </button>
      <button
        class="toggle-option"
        class:active={billingInterval === 'year'}
        onclick={() => { billingInterval = 'year'; }}
        role="radio"
        aria-checked={billingInterval === 'year'}
      >
        {m.pricing_annual()}
      </button>
    </div>

    <!-- Tier Cards -->
    <div class="tier-grid" style="--tier-count: {tiers.length}">
      {#each tiers as tier (tier.id)}
        {@const isCurrentPlan = currentTierId === tier.id}
        {@const savings = savingsPercent(tier)}
        <article class="tier-card" class:current={isCurrentPlan}>
          <div class="tier-card-header">
            <h2 class="tier-card-name">{tier.name}</h2>
            {#if isCurrentPlan}
              <Badge variant="success">{m.pricing_current_plan()}</Badge>
            {/if}
          </div>

          {#if tier.description}
            <p class="tier-card-description">{tier.description}</p>
          {/if}

          <div class="tier-card-price">
            <span class="price-amount">{formatPrice(tierPrice(tier))}</span>
            <span class="price-interval">
              {billingInterval === 'month' ? m.pricing_per_month() : m.pricing_per_year()}
            </span>
          </div>

          {#if billingInterval === 'year' && savings > 0}
            <span class="tier-savings">
              {m.pricing_save_percent({ percent: savings.toString() })}
            </span>
          {/if}

          <div class="tier-card-features">
            <span class="feature-item">
              <CheckIcon size={14} />
              {m.pricing_all_tier_content({ tierName: tier.name })}
            </span>
          </div>

          {#if isCurrentPlan}
            <Button variant="secondary" disabled class="tier-cta">
              {m.pricing_current_plan()}
            </Button>
          {:else}
            <Button
              onclick={() => handleSubscribe(tier)}
              loading={checkoutLoading === tier.id}
              class="tier-cta"
            >
              {m.pricing_subscribe()}
            </Button>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
  .pricing-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-8);
    padding: var(--space-8) var(--space-4);
    max-width: 1200px;
    margin: 0 auto;
  }

  .pricing-header {
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .pricing-title {
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
    line-height: var(--leading-tight);
  }

  .pricing-subtitle {
    font-size: var(--text-lg);
    color: var(--color-text-secondary);
    margin: 0;
  }

  /* Billing toggle */
  .billing-toggle {
    display: inline-flex;
    gap: 0;
    padding: var(--space-0-5);
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-lg);
  }

  .toggle-option {
    padding: var(--space-2) var(--space-5);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    border: none;
    background: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .toggle-option.active {
    background-color: var(--color-surface);
    color: var(--color-text);
    box-shadow: var(--shadow-sm);
  }

  .toggle-option:hover:not(.active) {
    color: var(--color-text);
  }

  /* Tier grid */
  .tier-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-6);
    width: 100%;
  }

  @media (--breakpoint-sm) {
    .tier-grid {
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    }
  }

  /* Tier card */
  .tier-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    transition: var(--transition-shadow);
  }

  .tier-card:hover {
    box-shadow: var(--shadow-md);
  }

  .tier-card.current {
    border-color: var(--color-interactive);
    border-width: var(--border-width-thick);
  }

  .tier-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .tier-card-name {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
  }

  .tier-card-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
    line-height: var(--leading-relaxed);
  }

  .tier-card-price {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
  }

  .price-amount {
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
    line-height: var(--leading-tight);
  }

  .price-interval {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .tier-savings {
    display: inline-flex;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-success-600);
    background-color: var(--color-success-50);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    width: fit-content;
  }

  .tier-card-features {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 1;
  }

  .feature-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  :global(.tier-cta) {
    width: 100%;
    margin-top: auto;
  }
</style>

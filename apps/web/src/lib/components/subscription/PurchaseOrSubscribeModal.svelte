<!--
  @component PurchaseOrSubscribeModal

  Shown when a user hits locked content that requires a subscription.
  Displays available tiers with billing toggle and subscribe CTAs.
  For content that can also be purchased individually, shows both options.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import * as Dialog from '$lib/components/ui/Dialog';
  import Badge from '$lib/components/ui/Badge/Badge.svelte';
  import { CheckIcon } from '$lib/components/ui/Icon';
  import { createSubscriptionCheckoutSession } from '$lib/remote/subscription.remote';
  import type { SubscriptionTier, CurrentSubscription } from '$lib/types';
  import { formatPrice } from '$lib/utils/format';

  interface Props {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    tiers: SubscriptionTier[];
    userSubscription?: CurrentSubscription | null;
    contentTitle?: string;
    reason: 'subscription_required' | 'higher_tier_required';
    organizationId: string;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    tiers,
    userSubscription = null,
    contentTitle,
    reason,
    organizationId,
  }: Props = $props();

  let billingInterval = $state<'month' | 'year'>('month');
  let checkoutLoading = $state<string | null>(null);

  const currentTierSortOrder = $derived(userSubscription?.tier?.sortOrder ?? 0);

  function tierPrice(tier: SubscriptionTier): number {
    return billingInterval === 'month' ? tier.priceMonthly : tier.priceAnnual;
  }

  async function handleSubscribe(tier: SubscriptionTier) {
    checkoutLoading = tier.id;
    try {
      const result = await createSubscriptionCheckoutSession({
        tierId: tier.id,
        billingInterval,
        organizationId,
      });
      window.location.href = result.sessionUrl;
    } catch {
      checkoutLoading = null;
    }
  }

  function handleOpenChange(value: boolean) {
    open = value;
    onOpenChange?.(value);
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content size="sm">
    <Dialog.Header>
      <Dialog.Title>
        {#if reason === 'higher_tier_required'}
          {m.subscription_change_tier()}
        {:else}
          {m.pricing_subscribe()}
        {/if}
      </Dialog.Title>
      {#if contentTitle}
        <Dialog.Description>
          {contentTitle}
        </Dialog.Description>
      {/if}
    </Dialog.Header>

    <Dialog.Body>
      <!-- Billing toggle -->
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

      <!-- Tier options -->
      <div class="tier-options">
        {#each tiers as tier (tier.id)}
          {@const isCurrentTier = userSubscription?.tierId === tier.id}
          {@const canAccess = tier.sortOrder <= currentTierSortOrder}
          <div class="tier-option" class:current={isCurrentTier}>
            <div class="tier-option-info">
              <span class="tier-option-name">{tier.name}</span>
              <span class="tier-option-price">
                {formatPrice(tierPrice(tier))}
                <span class="tier-option-interval">
                  {billingInterval === 'month' ? m.pricing_per_month() : m.pricing_per_year()}
                </span>
              </span>
            </div>
            {#if isCurrentTier}
              <Badge variant="success">{m.pricing_current_plan()}</Badge>
            {:else if canAccess}
              <Badge variant="neutral">
                <CheckIcon size={12} />
              </Badge>
            {:else}
              <Button
                size="sm"
                onclick={() => handleSubscribe(tier)}
                loading={checkoutLoading === tier.id}
              >
                {m.pricing_subscribe()}
              </Button>
            {/if}
          </div>
        {/each}
      </div>
    </Dialog.Body>
  </Dialog.Content>
</Dialog.Root>

<style>
  /* Billing toggle */
  .billing-toggle {
    display: inline-flex;
    gap: 0;
    padding: var(--space-0-5);
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-lg);
    align-self: center;
  }

  .toggle-option {
    padding: var(--space-1-5) var(--space-4);
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

  /* Tier options */
  .tier-options {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .tier-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
  }

  .tier-option:hover {
    background-color: var(--color-surface-secondary);
  }

  .tier-option.current {
    border-color: var(--color-interactive);
  }

  .tier-option-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .tier-option-name {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .tier-option-price {
    font-size: var(--text-sm);
    font-weight: var(--font-bold);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .tier-option-interval {
    font-weight: var(--font-normal);
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }
</style>

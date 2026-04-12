<!--
  @component PriceBadge

  Displays a price/access badge with visual variants:
  - "Free" (success) when amount is 0
  - Formatted price (neutral) when amount > 0
  - "Purchased" (info + check icon) when purchased is true
  - "Subscription" (purple) for subscriber-gated content
  - "Members" (secondary) for members-only content

  @prop {number | null} amount - Price in minor units (pence). 0 = free, null = hidden.
  @prop {string} currency - ISO 4217 currency code. Defaults to 'GBP'.
  @prop {boolean} purchased - Whether the user has purchased this content.
  @prop {'free' | 'paid' | 'subscribers' | 'members'} [accessType] - Content access type override.
-->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import * as m from '$paraglide/messages';
  import { formatPrice } from '$lib/utils/format';
  import { CheckIcon } from '$lib/components/ui/Icon';

  interface Props extends HTMLAttributes<HTMLSpanElement> {
    amount: number | null;
    currency?: string;
    purchased?: boolean;
    accessType?: 'free' | 'paid' | 'subscribers' | 'members' | null;
  }

  const {
    amount,
    currency = 'GBP',
    purchased = false,
    accessType = null,
    class: className,
    ...restProps
  }: Props = $props();

  const variant = $derived.by(() => {
    if (purchased) return 'purchased';
    if (accessType === 'subscribers') return 'subscribers';
    if (accessType === 'members') return 'members';
    if (amount === 0 || accessType === 'free') return 'free';
    return 'paid';
  });

  const label = $derived.by(() => {
    if (purchased) return m.content_price_purchased();
    if (accessType === 'subscribers') {
      // Show price if also purchasable, otherwise show "Subscription"
      if (amount && amount > 0) return formatPrice(amount);
      return m.content_price_subscribers();
    }
    if (accessType === 'members') return m.content_price_members();
    if (amount === 0 || accessType === 'free') return m.content_price_free();
    if (amount != null) return formatPrice(amount);
    return '';
  });

  const show = $derived(amount != null || purchased || accessType != null);
</script>

{#if show}
  <span class="price-badge {className ?? ''}" data-variant={variant} {...restProps}>
    {#if purchased}
      <CheckIcon size={12} />
    {/if}
    {label}
  </span>
{/if}

<style>
  .price-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    border-radius: var(--radius-sm);
    line-height: var(--leading-none);
    white-space: nowrap;
    backdrop-filter: blur(var(--blur-sm));
    -webkit-backdrop-filter: blur(var(--blur-sm));
  }

  .price-badge[data-variant='free'] {
    background: var(--color-success-50);
    color: var(--color-success-700);
    border: var(--border-width) var(--border-style) var(--color-success-200);
  }

  .price-badge[data-variant='purchased'] {
    background: var(--color-info-50);
    color: var(--color-info-700);
    border: var(--border-width) var(--border-style) var(--color-info-200);
  }

  .price-badge[data-variant='paid'] {
    background: var(--color-surface-secondary);
    color: var(--color-text);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .price-badge[data-variant='subscribers'] {
    background: var(--color-primary-50);
    color: var(--color-primary-700);
    border: var(--border-width) var(--border-style) var(--color-primary-200);
  }

  .price-badge[data-variant='members'] {
    background: var(--color-surface-secondary);
    color: var(--color-text-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
  }
</style>

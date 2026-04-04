<!--
  @component PriceBadge

  Displays a price badge with three visual variants:
  - "Free" (success) when amount is 0
  - Formatted price (neutral) when amount > 0
  - "Purchased" (info + check icon) when purchased is true

  @prop {number | null} amount - Price in minor units (pence). 0 = free, null = hidden.
  @prop {string} currency - ISO 4217 currency code. Defaults to 'GBP'.
  @prop {boolean} purchased - Whether the user has purchased this content.
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
  }

  const {
    amount,
    currency = 'GBP',
    purchased = false,
    class: className,
    ...restProps
  }: Props = $props();

  const variant = $derived.by(() => {
    if (purchased) return 'purchased';
    if (amount === 0) return 'free';
    return 'paid';
  });

  const label = $derived.by(() => {
    if (purchased) return m.content_price_purchased();
    if (amount === 0) return m.content_price_free();
    if (amount != null) return formatPrice(amount);
    return '';
  });
</script>

{#if amount != null || purchased}
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
</style>

<!--
  @component PriceDisplay

  A price display component that formats currency values using Intl.NumberFormat.
  Shows "Free" for null or zero prices via i18n.

  @prop {number | null} priceCents - Price in cents (null for free)
  @prop {'sm' | 'md' | 'lg'} [size='md'] - Size variant
  @prop {string} [currency='GBP'] - Currency code for formatting
  @prop {string} [locale='en-GB'] - Locale for formatting

  @example
  ```svelte
  <PriceDisplay priceCents={999} size="md" />
  ```

  @example
  ```svelte
  <PriceDisplay priceCents={null} size="lg" />
  ```
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLSpanElement> {
    priceCents: number | null;
    size?: 'sm' | 'md' | 'lg';
    currency?: string;
    locale?: string;
  }

  const {
    priceCents,
    size = 'md',
    currency = 'GBP',
    locale = 'en-GB',
    class: className,
    ...restProps
  }: Props = $props();

  const formattedPrice = $derived.by(() => {
    if (priceCents === null || priceCents === 0) {
      return m.commerce_free();
    }
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(priceCents / 100);
  });

  const sizeClasses = {
    sm: 'price-display--sm',
    md: 'price-display--md',
    lg: 'price-display--lg',
  };

  const displayClass = $derived(
    `price-display ${sizeClasses[size]} ${className ?? ''}`
  );
</script>

<span class={displayClass} {...restProps}>
  {formattedPrice}
</span>

<style>
  .price-display {
    font-family: var(--font-sans);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
  }

  .price-display--sm {
    font-size: var(--text-sm);
  }

  .price-display--md {
    font-size: var(--text-base);
  }

  .price-display--lg {
    font-size: var(--text-xl);
  }
</style>

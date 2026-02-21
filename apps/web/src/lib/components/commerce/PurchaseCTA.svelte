<!--
  @component PurchaseCTA

  A composite component that displays the appropriate call-to-action for content
  based on purchase status and price. Uses the Snippet API for flexible children.

  Displays one of three states:
  1. Paid content: PriceDisplay + PurchaseButton + guarantee text
  2. Already purchased: "Purchased" Badge + "Watch Now" button
  3. Free content: "Free" Badge + "Watch Now" button

  @prop {string} contentId - The UUID of the content
  @prop {number | null} priceCents - Price in cents (null or 0 = free)
  @prop {boolean} [isPurchased=false] - Whether the user has already purchased this content
  @prop {string} [watchUrl] - URL to navigate to when clicking "Watch Now"
  @prop {Snippet} [children] - Additional content to render below the CTA
  @prop {'sm' | 'md' | 'lg'} [size='md'] - Size variant for the CTA

  @example
  ```svelte
  <PurchaseCTA
    contentId="123e4567-e89b-12d3-a456-426614174000"
    priceCents={999}
  />
  ```

  @example
  ```svelte
  <PurchaseCTA
    contentId={contentId}
    priceCents={null}
    watchUrl="/watch/{contentId}"
  />
  ```

  @example
  ```svelte
  <PurchaseCTA
    contentId={contentId}
    priceCents={1999}
    isPurchased={true}
    watchUrl="/watch/{contentId}"
  >
    {#snippet children()}
      <p>Includes bonus content!</p>
    {/snippet}
  </PurchaseCTA>
  ```
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import PriceDisplay from './PriceDisplay.svelte';
  import PurchaseButton from './PurchaseButton.svelte';
  import Badge from '$lib/components/ui/Badge/Badge.svelte';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    contentId: string;
    priceCents: number | null;
    isPurchased?: boolean;
    watchUrl?: string;
    children?: Snippet;
    size?: 'sm' | 'md' | 'lg';
  }

  const {
    contentId,
    priceCents,
    isPurchased = false,
    watchUrl,
    children,
    size = 'md',
    class: className,
    ...restProps
  }: Props = $props();

  const ctaState = $derived(() => {
    if (isPurchased) return 'purchased';
    if (priceCents === null || priceCents === 0) return 'free';
    return 'paid';
  });

  function handleCTAClick() {
    if (watchUrl && (ctaState() === 'purchased' || ctaState() === 'free')) {
      window.location.href = watchUrl;
    }
  }
</script>

<div class="purchase-cta purchase-cta--{size} {className ?? ''}" {...restProps}>
  {#if ctaState() === 'paid'}
    <div class="purchase-cta-paid">
      <div class="purchase-cta-price">
        <PriceDisplay {priceCents} {size} />
      </div>
      <PurchaseButton {contentId} variant="primary" {size} />
      <p class="purchase-cta-guarantee">
        {m.commerce_guarantee()}
      </p>
    </div>
  {:else if ctaState() === 'purchased'}
    <div class="purchase-cta-owned">
      <Badge variant="success">{m.commerce_purchased()}</Badge>
      <button
        class="purchase-cta-watch"
        onclick={handleCTAClick}
        data-size={size}
      >
        {m.commerce_watch_now()}
      </button>
    </div>
  {:else}
    <div class="purchase-cta-free">
      <Badge variant="neutral">{m.commerce_free()}</Badge>
      <button
        class="purchase-cta-watch"
        onclick={handleCTAClick}
        data-size={size}
      >
        {m.commerce_watch_now()}
      </button>
    </div>
  {/if}

  {#if children}
    <div class="purchase-cta-children">
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .purchase-cta {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 100%;
  }

  /* Size variants */
  .purchase-cta--sm {
    gap: var(--space-2);
  }

  .purchase-cta--md {
    gap: var(--space-4);
  }

  .purchase-cta--lg {
    gap: var(--space-6);
  }

  /* Paid content state */
  .purchase-cta-paid {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    align-items: flex-start;
  }

  .purchase-cta-price {
    font-weight: var(--font-semibold);
  }

  .purchase-cta-guarantee {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    text-align: center;
  }

  /* Purchased/Free states */
  .purchase-cta-owned,
  .purchase-cta-free {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  /* Watch button - similar to primary button with success color */
  .purchase-cta-watch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    font-family: var(--font-sans);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    transition: var(--transition-colors), var(--transition-shadow);
    cursor: pointer;
    white-space: nowrap;
    border: var(--border-width) var(--border-style) transparent;
    background-color: var(--color-success);
    color: var(--color-white);
  }

  .purchase-cta-watch:hover {
    background-color: var(--color-success-hover);
  }

  .purchase-cta-watch:focus-visible {
    outline: 2px solid var(--color-success);
    outline-offset: 2px;
  }

  /* Watch button size variants */
  .purchase-cta-watch[data-size="sm"] {
    height: 2rem;
    padding-inline: var(--space-3);
    font-size: var(--text-sm);
  }

  .purchase-cta-watch[data-size="md"] {
    height: 2.5rem;
    padding-inline: var(--space-4);
    font-size: var(--text-base);
  }

  .purchase-cta-watch[data-size="lg"] {
    height: 2.75rem;
    padding-inline: var(--space-5);
    font-size: var(--text-lg);
  }

  /* Children slot */
  .purchase-cta-children {
    margin-top: var(--space-2);
  }

  /* Dark mode support */
  @media (prefers-color-scheme: dark) {
    .purchase-cta-guarantee {
      color: var(--color-text-secondary);
    }

    .purchase-cta-watch {
      background-color: var(--color-success);
      color: var(--color-white);
    }

    .purchase-cta-watch:hover {
      background-color: var(--color-success-hover);
    }
  }

  /* Data-theme attribute support for explicit dark mode */
  [data-theme='dark'] .purchase-cta-guarantee {
    color: var(--color-text-secondary);
  }

  [data-theme='dark'] .purchase-cta-watch {
    background-color: var(--color-success);
    color: var(--color-white);
  }

  [data-theme='dark'] .purchase-cta-watch:hover {
    background-color: var(--color-success-hover);
  }
</style>

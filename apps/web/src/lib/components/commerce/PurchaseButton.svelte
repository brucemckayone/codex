<!--
  @component PurchaseButton

  A specialized button component for initiating e-commerce checkout flows.
  Integrates with Stripe checkout via `createCheckoutSession` and handles
  loading states, errors, and redirects.

  @prop {string} contentId - The UUID of the content to purchase
  @prop {('primary'|'secondary')} [variant='primary'] - Visual style variant
  @prop {('sm'|'md'|'lg')} [size='md'] - Button size
  @prop {string} [successUrl] - URL to redirect to after successful purchase
  @prop {string} [cancelUrl] - URL to redirect to if purchase is cancelled
  @prop {boolean} [disabled=false] - Whether the button is disabled

  @example
  ```svelte
  <PurchaseButton
    contentId="123e4567-e89b-12d3-a456-426614174000"
    variant="primary"
    size="lg"
  />
  ```

  @example
  ```svelte
  <PurchaseButton
    contentId={contentId}
    variant="secondary"
    size="md"
    successUrl="/library?purchase=success"
    cancelUrl="/content/{contentId}"
  />
  ```
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { createCheckoutSession } from '$lib/remote/checkout.remote';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    contentId: string;
    variant?: 'primary' | 'secondary';
    size?: 'sm' | 'md' | 'lg';
    successUrl?: string;
    cancelUrl?: string;
    disabled?: boolean;
  }

  const {
    contentId,
    variant = 'primary',
    size = 'md',
    successUrl,
    cancelUrl,
    disabled = false,
    class: className,
    ...restProps
  }: Props = $props();

  let isLoading = $state(false);
  let error = $state<string | null>(null);

  async function handleClick() {
    if (isLoading || disabled) return;

    isLoading = true;
    error = null;

    try {
      const result = await createCheckoutSession({
        contentId,
        successUrl,
        cancelUrl,
      });

      window.location.href = result.sessionUrl;
    } catch (err) {
      error = err instanceof Error ? err.message : m.commerce_checkout_failed();
      isLoading = false;
    }
  }

  const buttonText = $derived(() => {
    if (isLoading) return m.commerce_redirecting();
    return m.commerce_buy_now();
  });
</script>

<button
  class="purchase-button {className ?? ''}"
  data-variant={variant}
  data-size={size}
  disabled={disabled || isLoading}
  aria-busy={isLoading}
  onclick={handleClick}
  {...restProps}
>
  {#if isLoading}
    <span class="purchase-button-spinner" aria-hidden="true"></span>
  {/if}
  <span class="purchase-button-content" class:invisible={isLoading}>
    {buttonText()}
  </span>
</button>

{#if error}
  <div class="purchase-button-error" role="alert">
    {error}
  </div>
{/if}

<style>
  .purchase-button {
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
    position: relative;
    border: var(--border-width) var(--border-style) transparent;
  }

  .purchase-button:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
  }

  .purchase-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Size variants */
  .purchase-button[data-size="sm"] {
    height: 2rem;
    padding-inline: var(--space-3);
    font-size: var(--text-sm);
  }

  .purchase-button[data-size="md"] {
    height: 2.5rem;
    padding-inline: var(--space-4);
    font-size: var(--text-base);
  }

  .purchase-button[data-size="lg"] {
    height: 2.75rem;
    padding-inline: var(--space-5);
    font-size: var(--text-lg);
  }

  /* Variant: Primary */
  .purchase-button[data-variant="primary"] {
    background-color: var(--color-primary-500);
    color: var(--color-text-inverse);
    border: none;
  }

  .purchase-button[data-variant="primary"]:hover:not(:disabled) {
    background-color: var(--color-primary-600);
  }

  .purchase-button[data-variant="primary"]:active:not(:disabled) {
    background-color: var(--color-primary-700);
  }

  /* Variant: Secondary */
  .purchase-button[data-variant="secondary"] {
    background-color: var(--color-surface);
    color: var(--color-text);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .purchase-button[data-variant="secondary"]:hover:not(:disabled) {
    background-color: var(--color-surface-secondary);
  }

  /* Dark mode variants */
  @media (prefers-color-scheme: dark) {
    .purchase-button[data-variant="secondary"] {
      background-color: var(--color-surface);
      color: var(--color-text);
      border-color: var(--color-border);
    }

    .purchase-button[data-variant="secondary"]:hover:not(:disabled) {
      background-color: var(--color-surface-secondary);
    }
  }

  .purchase-button-content {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .purchase-button-spinner {
    position: absolute;
    width: 1em;
    height: 1em;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  .invisible {
    visibility: hidden;
  }

  .purchase-button-error {
    margin-top: var(--space-2);
    padding: var(--space-3);
    background-color: var(--color-error-container);
    color: var(--color-error);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>

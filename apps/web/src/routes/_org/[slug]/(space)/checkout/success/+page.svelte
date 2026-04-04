<!--
  @component CheckoutSuccessPage

  Post-checkout landing page. Shows purchase confirmation when the Stripe
  session is verified as complete, or a graceful fallback if verification
  is still pending (webhook may be async).
-->
<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { formatPrice } from '$lib/utils/format';
  import { CheckCircleIcon, ClockIcon } from '$lib/components/ui/Icon';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  const { data }: Props = $props();

  const isComplete = $derived(data.verification?.sessionStatus === 'complete');
  const content = $derived(data.verification?.content);
  const purchase = $derived(data.verification?.purchase);
  const contentSlug = $derived(data.contentSlug);
</script>

<svelte:head>
  <title>{m.checkout_success_title()} | {data.org?.name ?? 'Codex'}</title>
</svelte:head>

<div class="checkout-success">
  <div class="checkout-success__card">
    {#if isComplete && content}
      <!-- Purchase confirmed -->
      <div class="checkout-success__icon checkout-success__icon--success">
        <CheckCircleIcon size={48} />
      </div>

      <h1 class="checkout-success__title">{m.checkout_success_title()}</h1>
      <p class="checkout-success__description">{m.checkout_success_description()}</p>

      {#if content.thumbnailUrl}
        <div class="checkout-success__content-preview">
          <img
            src={content.thumbnailUrl}
            alt={content.title}
            class="checkout-success__thumbnail"
          />
        </div>
      {/if}

      <div class="checkout-success__content-info">
        <p class="checkout-success__content-title">{content.title}</p>
        {#if purchase?.amountPaidCents}
          <p class="checkout-success__amount">{formatPrice(purchase.amountPaidCents)}</p>
        {/if}
      </div>

      <div class="checkout-success__actions">
        <a href={buildContentUrl(page.url, { slug: contentSlug, id: content.id })} class="checkout-success__btn checkout-success__btn--primary">
          {m.checkout_success_watch_now()}
        </a>
        <a href="/explore" class="checkout-success__btn checkout-success__btn--secondary">
          {m.checkout_success_browse()}
        </a>
      </div>

    {:else if data.verification === null}
      <!-- Verification failed or pending -->
      <div class="checkout-success__icon checkout-success__icon--pending">
        <ClockIcon size={48} />
      </div>

      <h1 class="checkout-success__title">{m.checkout_success_verifying()}</h1>
      <p class="checkout-success__description">{m.checkout_success_error()}</p>

      <div class="checkout-success__actions">
        <a href="/library" class="checkout-success__btn checkout-success__btn--primary">
          {m.checkout_success_go_to_library()}
        </a>
        <a href="/explore" class="checkout-success__btn checkout-success__btn--secondary">
          {m.checkout_success_browse()}
        </a>
      </div>

    {:else}
      <!-- Session open or expired -->
      <div class="checkout-success__icon checkout-success__icon--pending">
        <ClockIcon size={48} />
      </div>

      <h1 class="checkout-success__title">{m.checkout_success_verifying()}</h1>
      <p class="checkout-success__description">{m.checkout_success_error()}</p>

      <div class="checkout-success__actions">
        <a href="/library" class="checkout-success__btn checkout-success__btn--primary">
          {m.checkout_success_go_to_library()}
        </a>
      </div>
    {/if}
  </div>
</div>

<style>
  .checkout-success {
    min-height: 60vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
  }

  .checkout-success__card {
    width: 100%;
    max-width: 480px;
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    padding: var(--space-8);
    box-shadow: var(--shadow-lg);
    border: var(--border-width) solid var(--color-border);
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
  }

  .checkout-success__icon {
    margin-bottom: var(--space-2);
  }

  .checkout-success__icon--success {
    color: var(--color-success-600);
  }

  .checkout-success__icon--pending {
    color: var(--color-text-secondary);
  }

  .checkout-success__title {
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
  }

  .checkout-success__description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
    max-width: 360px;
    line-height: var(--leading-normal);
  }

  .checkout-success__content-preview {
    width: 100%;
    max-width: 320px;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-md);
    overflow: hidden;
    margin-top: var(--space-2);
  }

  .checkout-success__thumbnail {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .checkout-success__content-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .checkout-success__content-title {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
  }

  .checkout-success__amount {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .checkout-success__actions {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-4);
    flex-wrap: wrap;
    justify-content: center;
  }

  .checkout-success__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2) var(--space-5);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .checkout-success__btn--primary {
    background: var(--color-interactive);
    color: var(--color-text-inverse);
  }

  .checkout-success__btn--primary:hover {
    background: var(--color-interactive-hover);
  }

  .checkout-success__btn--secondary {
    background: transparent;
    color: var(--color-text-secondary);
    border: var(--border-width) solid var(--color-border);
  }

  .checkout-success__btn--secondary:hover {
    background: var(--color-surface);
    color: var(--color-text);
  }
</style>

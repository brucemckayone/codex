<!--
  @component OrgSubscriptionSuccessPage

  Subscription-mode counterpart to /checkout/success.

  Three visual states, driven by `data.verification`:
  - Complete (subscription row exists in our DB): animated checkmark + "Go to
    Library" CTA. The webhook has landed — library will populate immediately.
  - Pending (verification null or status !== 'complete', subscription missing):
    spinner + auto-retry via `invalidate('subscription:verify')` up to 10 times
    at 3s intervals (~30s total window). Handles the Stripe webhook race
    where the redirect beats `checkout.session.completed`.
  - Expired / fallback: honest "didn't land in time" message with a library CTA.

  See the shared CheckoutSuccess component for the equivalent purchase flow
  — intentionally kept separate so each flow can evolve independently.
-->
<script lang="ts">
  import { invalidate } from '$app/navigation';
  import * as m from '$paraglide/messages';
  import { ClockIcon } from '$lib/components/ui/Icon';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  const { data }: Props = $props();

  const verification = $derived(data.verification);
  const isComplete = $derived(
    verification?.sessionStatus === 'complete' && !!verification?.subscription
  );
  const isExpired = $derived(verification?.sessionStatus === 'expired');

  // Auto-retry loop — mirrors the checkout/success pattern. We retry until
  // either the subscription row appears (webhook landed) OR Stripe says the
  // session expired. A null `verification` is treated as still-pending
  // (transient ecom-api failure) so the user doesn't get stuck on an error.
  let retryCount = $state(0);
  const MAX_RETRIES = 10;
  const RETRY_INTERVAL_MS = 3000;
  const shouldRetry = $derived(
    !isComplete && !isExpired && retryCount < MAX_RETRIES
  );

  $effect(() => {
    if (!shouldRetry) return;
    const t = setTimeout(() => {
      retryCount++;
      invalidate('subscription:verify');
    }, RETRY_INTERVAL_MS);
    return () => clearTimeout(t);
  });

  const subscription = $derived(verification?.subscription);
  const orgName = $derived(data.org?.name ?? 'Codex');
  const libraryUrl = '/library';
</script>

<svelte:head>
  <title>{m.subscription_success_title()} | {orgName}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="subscription-success">
  <div class="subscription-success__card" aria-live="polite">
    {#if isComplete}
      <div class="subscription-success__icon">
        <svg
          class="checkmark"
          viewBox="0 0 64 64"
          width="64"
          height="64"
          role="img"
          aria-label={m.subscription_success_title()}
        >
          <circle class="checkmark__circle" cx="32" cy="32" r="30" />
          <polyline class="checkmark__check" points="20 34 28 42 44 24" />
        </svg>
      </div>

      <h1 class="subscription-success__title">{m.subscription_success_title()}</h1>
      <p class="subscription-success__description">
        {m.subscription_success_description()}
      </p>

      {#if subscription}
        <p class="subscription-success__tier">
          {subscription.tierName} · {subscription.organizationName}
        </p>
      {/if}

      <div class="subscription-success__actions">
        <a
          href={libraryUrl}
          class="subscription-success__btn subscription-success__btn--primary"
        >
          {m.nav_library()}
        </a>
      </div>

    {:else if shouldRetry}
      <div class="subscription-success__icon" role="status" aria-live="polite">
        <div class="subscription-success__spinner"></div>
      </div>
      <h1 class="subscription-success__title">{m.checkout_success_confirming()}</h1>
      <p class="subscription-success__description">
        {m.checkout_success_confirming_description()}
      </p>

    {:else if isExpired}
      <div
        class="subscription-success__icon subscription-success__icon--pending"
      >
        <ClockIcon size={48} />
      </div>
      <h1 class="subscription-success__title">{m.checkout_success_expired_title()}</h1>
      <p class="subscription-success__description">
        {m.checkout_success_expired_description()}
      </p>
      <div class="subscription-success__actions">
        <a
          href="/pricing"
          class="subscription-success__btn subscription-success__btn--primary"
        >
          {m.checkout_success_start_over()}
        </a>
      </div>

    {:else}
      <!-- Retries exhausted, webhook hasn't landed. Let the user into their
           library — the webhook will catch up shortly and the next library
           refresh will reconcile. -->
      <div
        class="subscription-success__icon subscription-success__icon--pending"
      >
        <ClockIcon size={48} />
      </div>
      <h1 class="subscription-success__title">{m.checkout_success_almost_there()}</h1>
      <p class="subscription-success__description">
        {m.checkout_success_almost_there_description()}
      </p>
      <div class="subscription-success__actions">
        <a
          href={libraryUrl}
          class="subscription-success__btn subscription-success__btn--primary"
        >
          {m.checkout_success_go_to_library()}
        </a>
      </div>
    {/if}
  </div>
</div>

<style>
  .subscription-success {
    min-height: 60vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
  }

  .subscription-success__card {
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

  .subscription-success__icon {
    margin-bottom: var(--space-2);
  }

  .subscription-success__icon--pending {
    color: var(--color-text-secondary);
  }

  .checkmark {
    display: block;
  }

  .checkmark__circle {
    stroke: var(--color-success-600);
    stroke-width: var(--border-width-thick);
    fill: none;
    stroke-dasharray: 188;
    stroke-dashoffset: 188;
    animation: checkmark-circle-draw var(--duration-normal) var(--ease-out)
      forwards;
  }

  .checkmark__check {
    stroke: var(--color-success-600);
    stroke-width: var(--border-width-thick);
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 48;
    stroke-dashoffset: 48;
    animation: checkmark-check-draw var(--duration-fast) var(--ease-out)
      var(--duration-fast) forwards;
  }

  @keyframes checkmark-circle-draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  @keyframes checkmark-check-draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  .subscription-success__spinner {
    width: var(--space-12);
    height: var(--space-12);
    border-radius: 50%;
    border: var(--border-width-thick) solid var(--color-border);
    border-top-color: var(--color-interactive);
    animation: spin var(--duration-slower) linear infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .subscription-success__spinner {
      animation: none;
      border-top-color: var(--color-interactive);
    }
  }

  .subscription-success__title {
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
  }

  .subscription-success__description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
    max-width: 360px;
    line-height: var(--leading-normal);
  }

  .subscription-success__tier {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    margin: 0;
    padding: var(--space-2) var(--space-4);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-md);
  }

  .subscription-success__actions {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-4);
    flex-wrap: wrap;
    justify-content: center;
    width: 100%;
  }

  .subscription-success__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3) var(--space-6);
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .subscription-success__btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .subscription-success__btn--primary {
    background: var(--color-interactive);
    color: var(--color-text-inverse);
    width: 100%;
  }

  .subscription-success__btn--primary:hover {
    background: var(--color-interactive-hover);
  }

  @media (--breakpoint-sm) {
    .subscription-success__btn--primary {
      width: auto;
    }
  }
</style>

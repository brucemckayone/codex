<!--
  @component CheckoutSuccess

  Shared checkout success component used by both org and creator checkout
  success pages. Handles three states: success (animated checkmark +
  content preview + CTA + onboarding tips), pending (spinner + auto-retry),
  and fallback (retries exhausted, friendly messaging).

  Auto-retry: When verification is null or not complete, polls via
  invalidate('checkout:verify') every 3 seconds, up to 5 times.
-->
<script lang="ts">
  import { invalidate } from '$app/navigation';
  import * as m from '$paraglide/messages';
  import { formatPrice } from '$lib/utils/format';
  import { ClockIcon, PlayIcon, FileTextIcon, GlobeIcon } from '$lib/components/ui/Icon';

  interface Verification {
    sessionStatus: 'complete' | 'expired' | 'open';
    purchase?: { id: string; amountPaidCents: number; purchasedAt: string };
    content?: { id: string; title: string; thumbnailUrl?: string; contentType: string };
  }

  interface Props {
    /** Verification result from server load (null if API call failed) */
    verification: Verification | null;
    /** URL to the purchased content (for "Start Watching/Listening/Reading" CTA) */
    contentUrl: string;
    /** URL for "Continue Browsing" CTA */
    browseUrl: string;
    /** URL for "Go to Library" CTA (pending/fallback state) */
    libraryUrl: string;
    /** Page title suffix (org name or "Creators") */
    titleSuffix: string;
  }

  const { verification, contentUrl, browseUrl, libraryUrl, titleSuffix }: Props = $props();

  const isComplete = $derived(verification?.sessionStatus === 'complete');
  const content = $derived(verification?.content);
  const purchase = $derived(verification?.purchase);

  // --- Auto-retry polling ---
  let retryCount = $state(0);
  const MAX_RETRIES = 5;
  const RETRY_INTERVAL_MS = 3000;
  const shouldRetry = $derived(!isComplete && retryCount < MAX_RETRIES);

  $effect(() => {
    if (!shouldRetry) return;
    const timeout = setTimeout(() => {
      retryCount++;
      invalidate('checkout:verify');
    }, RETRY_INTERVAL_MS);
    return () => clearTimeout(timeout);
  });

  // --- Content-type-aware CTA label ---
  const ctaLabel = $derived.by(() => {
    const type = content?.contentType;
    if (type === 'audio') return m.checkout_success_listen_now();
    if (type === 'written') return m.checkout_success_read_now();
    return m.checkout_success_watch_now();
  });
</script>

<svelte:head>
  <title>{m.checkout_success_title()} | {titleSuffix}</title>
</svelte:head>

<div class="checkout-success">
  <div class="checkout-success__card">
    {#if isComplete && content}
      <!-- Success: Animated checkmark + content preview + CTA + tips -->
      <div class="checkout-success__icon">
        <svg
          class="checkmark"
          viewBox="0 0 64 64"
          width="64"
          height="64"
          role="img"
          aria-label="Purchase confirmed"
        >
          <circle
            class="checkmark__circle"
            cx="32"
            cy="32"
            r="30"
          />
          <polyline
            class="checkmark__check"
            points="20 34 28 42 44 24"
          />
        </svg>
      </div>

      <h1 class="checkout-success__title">{m.checkout_success_title()}</h1>
      <p class="checkout-success__description">{m.checkout_success_description()}</p>

      <!-- Content preview card -->
      <div class="checkout-success__preview-card">
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
      </div>

      <!-- CTAs -->
      <div class="checkout-success__actions">
        <a href={contentUrl} class="checkout-success__btn checkout-success__btn--primary">
          {ctaLabel}
        </a>
        <a href={browseUrl} class="checkout-success__btn checkout-success__btn--secondary">
          {m.checkout_success_browse()}
        </a>
      </div>

      <!-- What's Next onboarding tips -->
      <div class="whats-next">
        <p class="whats-next__title">{m.checkout_success_whats_next()}</p>
        <div class="whats-next__list">
          <div class="whats-next__item">
            <span class="whats-next__item-icon" aria-hidden="true">
              <PlayIcon size={16} />
            </span>
            <span>{m.checkout_success_tip_progress()}</span>
          </div>
          <div class="whats-next__item">
            <span class="whats-next__item-icon" aria-hidden="true">
              <FileTextIcon size={16} />
            </span>
            <span>{m.checkout_success_tip_library()}</span>
          </div>
          <div class="whats-next__item">
            <span class="whats-next__item-icon" aria-hidden="true">
              <GlobeIcon size={16} />
            </span>
            <span>{m.checkout_success_tip_devices()}</span>
          </div>
        </div>
      </div>

    {:else if shouldRetry}
      <!-- Pending: Spinner + auto-retry -->
      <div class="checkout-success__icon" role="status" aria-label="Verifying purchase" aria-live="polite">
        <div class="checkout-success__spinner"></div>
      </div>

      <h1 class="checkout-success__title">{m.checkout_success_confirming()}</h1>
      <p class="checkout-success__description">{m.checkout_success_confirming_description()}</p>

    {:else}
      <!-- Fallback: Retries exhausted or session open/expired -->
      <div class="checkout-success__icon checkout-success__icon--pending">
        <ClockIcon size={48} />
      </div>

      <h1 class="checkout-success__title">{m.checkout_success_almost_there()}</h1>
      <p class="checkout-success__description">{m.checkout_success_almost_there_description()}</p>

      <div class="checkout-success__actions">
        <a href={libraryUrl} class="checkout-success__btn checkout-success__btn--primary">
          {m.checkout_success_go_to_library()}
        </a>
        <a href={browseUrl} class="checkout-success__btn checkout-success__btn--secondary">
          {m.checkout_success_browse()}
        </a>
      </div>
    {/if}
  </div>
</div>

<style>
  /* --- Layout --- */
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

  /* --- Icon area --- */
  .checkout-success__icon {
    margin-bottom: var(--space-2);
  }

  .checkout-success__icon--pending {
    color: var(--color-text-secondary);
  }

  /* --- Animated checkmark --- */
  .checkmark {
    display: block;
  }

  .checkmark__circle {
    stroke: var(--color-success-600);
    stroke-width: 2;
    fill: none;
    stroke-dasharray: 188;
    stroke-dashoffset: 188;
    animation: checkmark-circle-draw 0.4s var(--ease-out) forwards;
  }

  .checkmark__check {
    stroke: var(--color-success-600);
    stroke-width: 3;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 48;
    stroke-dashoffset: 48;
    animation: checkmark-check-draw 0.3s var(--ease-out) 0.3s forwards;
  }

  @keyframes checkmark-circle-draw {
    to { stroke-dashoffset: 0; }
  }

  @keyframes checkmark-check-draw {
    to { stroke-dashoffset: 0; }
  }

  /* prefers-reduced-motion is handled globally by tokens/motion.css
     which sets animation-duration: 0.01ms !important — checkmark
     appears immediately with no visible animation. */

  /* --- Spinner --- */
  .checkout-success__spinner {
    width: var(--space-12);
    height: var(--space-12);
    border-radius: 50%;
    border: var(--border-width-thick) solid var(--color-border);
    border-top-color: var(--color-interactive);
    animation: spin 1s linear infinite;
  }

  /* --- Typography --- */
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

  /* --- Content preview card --- */
  .checkout-success__preview-card {
    width: 100%;
    max-width: 280px;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    margin-top: var(--space-2);
  }

  .checkout-success__content-preview {
    width: 100%;
    aspect-ratio: 16 / 9;
    overflow: hidden;
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
    padding: var(--space-3);
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

  /* --- Actions --- */
  .checkout-success__actions {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-4);
    flex-wrap: wrap;
    justify-content: center;
    width: 100%;
  }

  .checkout-success__btn {
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

  .checkout-success__btn--primary {
    background: var(--color-interactive);
    color: var(--color-text-inverse);
    width: 100%;
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

  @media (min-width: 640px) {
    .checkout-success__btn--primary {
      width: auto;
    }
  }

  /* --- What's Next tips --- */
  .whats-next {
    width: 100%;
    margin-top: var(--space-6);
    padding: var(--space-4);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-md);
  }

  .whats-next__title {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0 0 var(--space-3) 0;
  }

  .whats-next__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .whats-next__item {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
    text-align: left;
  }

  .whats-next__item-icon {
    color: var(--color-text-muted);
    flex-shrink: 0;
    margin-top: var(--space-0-5);
  }
</style>

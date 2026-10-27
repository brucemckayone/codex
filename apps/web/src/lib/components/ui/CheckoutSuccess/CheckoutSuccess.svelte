<!--
  @component CheckoutSuccess

  Shared checkout success component used by both org and creator checkout
  success pages. It confirms against OUR record of the purchase, not Stripe's
  `complete` alone, and acts on the verify read's `state` (Codex-2hxff.22):

  - arriving (`recording`): Stripe says paid and our row is not there yet.
    "Payment received · Unlocking your content…", with the Start slot held.
    The load records it at once (`unlock`, the webhook's own completion;
    owner decision 2026-10-26, "Unlock on arrival").
  - unlocked: the success card. It refreshes the library collection once.
  - late: still `recording` after the capped checks. "Your payment went
    through. We're still finishing up; check again in a minute." with Check
    again (one check per click) and Go to library.
  - duplicate: a second payment for an item the buyer owns, being refunded
    (Codex-o4jvw): a calm notice, no confirmation.
  - inactive (`refunded` / `paused`): "This purchase is no longer active.",
    with the buyer's payment history. No checks.
  - expired, and error (`verifyFailed` or `unpaid`): as before, no checks.
  - confirming / almost: no answer yet (the verify failed transiently) or an
    `open` session: the neutral spinner, then "Almost there…" with Check again.

  Checks: about six over the first minute, only while the tab is visible,
  then they stop (`CappedChecks`; owner decision 2026-10-26, "Capped, then a
  button"). Never an open-ended loop.
-->
<script lang="ts">
  import type { CheckoutSessionVerifyResult } from '@codex/purchase';
  import { coverCropSizes, getThumbnailSrcset } from '$lib/utils/image';
  import { invalidate } from '$app/navigation';
  import * as m from '$paraglide/messages';
  import { invalidateCollection } from '$lib/collections';
  import { CappedChecks } from '$lib/utils/capped-checks.svelte';
  import { formatPrice } from '$lib/utils/format';
  import {
    AlertCircleIcon,
    CheckCircleIcon,
    ClockIcon,
    PlayIcon,
    FileTextIcon,
    GlobeIcon
  } from '$lib/components/ui/Icon';

  type Verification = Pick<
    CheckoutSessionVerifyResult,
    'sessionStatus' | 'state' | 'content' | 'duplicatePayment' | 'amountTotalCents'
  > & {
    purchase?: Pick<
      NonNullable<CheckoutSessionVerifyResult['purchase']>,
      'id' | 'amountPaidCents' | 'purchasedAt'
    >;
  };

  interface Props {
    /** Verification result from server load (null if API call failed) */
    verification: Verification | null;
    /** The verify failed in a way a retry will not change (a 4xx): stop polling. */
    verifyFailed?: boolean;
    /**
     * The arrival's completion (`POST /checkout/complete`), streamed by the
     * load while our record is missing. It resolves to the session as read
     * after, or to null when the call failed (the checks carry on).
     */
    unlock?: Promise<Verification | null> | null;
    /** URL to the purchased content (for "Start Watching/Listening/Reading" CTA) */
    contentUrl: string;
    /** URL for "Continue Browsing" CTA */
    browseUrl: string;
    /** URL for "Go to Library" CTA (pending/fallback state) */
    libraryUrl: string;
    /** The buyer's payment history, for a purchase that is no longer active. */
    paymentHistoryUrl: string;
    /** Page title suffix (org name or "Creators") */
    titleSuffix: string;
  }

  const {
    verification,
    verifyFailed = false,
    unlock = null,
    contentUrl,
    browseUrl,
    libraryUrl,
    paymentHistoryUrl,
    titleSuffix
  }: Props = $props();

  // --- Unlock on arrival ---
  // The answer of the load's completion call, for the promise it answered:
  // each check re-runs the load, which streams a new one while still recording.
  let unlockAnswer = $state.raw<{
    for: Promise<Verification | null>;
    result: Verification | null;
  } | null>(null);

  $effect(() => {
    const pending = unlock;
    if (!pending) return;
    let live = true;
    pending.then(
      (result) => {
        if (live) unlockAnswer = { for: pending, result };
      },
      () => {
        if (live) unlockAnswer = { for: pending, result: null };
      }
    );
    return () => {
      live = false;
    };
  });

  /** The completion call is still on its way. */
  const unlocking = $derived(!!unlock && unlockAnswer?.for !== unlock);
  // Not reactive: only `current` reads and writes it.
  let lastKnown: Verification | null = null;
  /**
   * The freshest read: the completion's answer, else the load's verify. A
   * check whose verify failed for now (a 5xx or a rate limit leaves
   * `verification` null) is no news, not a step back: the last answer stands,
   * so "Payment received" never drops back to "Confirming…".
   */
  const current = $derived.by(() => {
    const fresh =
      unlock && unlockAnswer?.for === unlock && unlockAnswer.result
        ? unlockAnswer.result
        : verification;
    if (fresh) lastKnown = fresh;
    return fresh ?? lastKnown;
  });
  const content = $derived(current?.content);
  /** Our row's amount, or Stripe's while our row is on its way. */
  const amountCents = $derived(
    current?.purchase?.amountPaidCents ?? current?.amountTotalCents
  );

  // --- Capped checks ---
  // Waiting: paid and not recorded yet, an `open` session, or no answer yet
  // (a transient verify failure). Paused while a completion call is out, so a
  // check never races the one before it.
  const waiting = $derived(
    !verifyFailed &&
      (current === null ||
        current.state === 'recording' ||
        current.state === 'open')
  );
  const checks = new CappedChecks(() => invalidate('checkout:verify'));

  $effect(() => {
    if (!waiting || unlocking) return;
    return checks.start();
  });

  type View =
    | 'duplicate'
    | 'unlocked'
    | 'arriving'
    | 'late'
    | 'inactive'
    | 'expired'
    | 'error'
    | 'confirming'
    | 'almost';

  const view = $derived.by((): View => {
    if (verifyFailed) return 'error';
    switch (current?.state) {
      case 'duplicate':
        // The notice names the item; our row always joins it.
        return content ? 'duplicate' : 'error';
      case 'unlocked':
        return 'unlocked';
      case 'refunded':
      case 'paused':
        return 'inactive';
      case 'expired':
        return 'expired';
      case 'unpaid':
        return 'error';
      case 'recording':
        return checks.exhausted ? 'late' : 'arriving';
      default:
        return checks.exhausted ? 'almost' : 'confirming';
    }
  });
  /** The three views of a payment Stripe took: one checkmark across them. */
  const paid = $derived(
    view === 'arriving' || view === 'unlocked' || view === 'late'
  );

  // --- Library refresh (WEB-04) ---
  // Once, when it unlocks: the buyer's next stop is usually the library.
  let libraryRefreshed = false;
  $effect(() => {
    if (view !== 'unlocked' || libraryRefreshed) return;
    libraryRefreshed = true;
    void invalidateCollection('library');
  });

  const headTitle = $derived(
    view === 'duplicate' && content
      ? m.checkout_duplicate_title({ item: content.title })
      : view === 'inactive'
        ? m.checkout_inactive_title()
        : m.checkout_success_title()
  );

  // --- Content-type-aware CTA label ---
  const ctaLabel = $derived.by(() => {
    const type = content?.contentType;
    if (type === 'audio') return m.checkout_success_listen_now();
    if (type === 'written') return m.checkout_success_read_now();
    return m.checkout_success_watch_now();
  });
</script>

<svelte:head>
  <title>{headTitle} | {titleSuffix}</title>
  <!-- Session-keyed thank-you page — never index. Each visit uses a
       unique session_id param so appearing in SERPs would be noise. -->
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

{#snippet checkAgain(label: string)}
  <!-- No `disabled` while it runs: that would drop focus to <body>. The label
       says so, and a click sends nothing while a check, or the completion
       call it started, is still out. -->
  <button
    type="button"
    class="checkout-success__btn checkout-success__btn--primary"
    aria-busy={checks.checking || unlocking}
    onclick={() => {
      if (!unlocking) void checks.checkOnce();
    }}
  >
    {checks.checking || unlocking ? m.checkout_checking() : label}
  </button>
{/snippet}

<div class="checkout-success">
  <div class="checkout-success__card" aria-live="polite">
    {#if view === 'duplicate' && content}
      <!-- Duplicate: the buyer already owned this, and this payment is being
           refunded (Codex-o4jvw). No confirmation, amount or tips — just the
           way to the item they already have. -->
      <div class="checkout-success__icon checkout-success__icon--notice" aria-hidden="true">
        <CheckCircleIcon size={48} />
      </div>

      <h1 class="checkout-success__title">
        {m.checkout_duplicate_title({ item: content.title })}
      </h1>
      <p class="checkout-success__description">{m.checkout_duplicate_description()}</p>

      <div class="checkout-success__actions">
        <a href={contentUrl} class="checkout-success__btn checkout-success__btn--primary">
          {m.checkout_duplicate_go_to({ name: content.title })}
        </a>
      </div>

    {:else if paid}
      <!-- One checkmark for arriving → unlocked → late, so it draws once. -->
      <div class="checkout-success__icon">
        <svg
          class="checkmark"
          viewBox="0 0 64 64"
          width="64"
          height="64"
          role="img"
          aria-label={view === 'unlocked'
            ? m.checkout_success_icon_alt()
            : m.checkout_arrival_title()}
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

      {#if view === 'unlocked'}
        <h1 class="checkout-success__title" aria-live="polite">{m.checkout_success_title()}</h1>
        <p class="checkout-success__description">{m.checkout_success_description()}</p>
      {:else if view === 'arriving'}
        <h1 class="checkout-success__title">{m.checkout_arrival_title()}</h1>
        <p class="checkout-success__description checkout-success__status" role="status">
          <span class="checkout-success__status-spinner" aria-hidden="true"></span>
          <span>{m.checkout_arrival_unlocking()}</span>
        </p>
      {:else}
        <h1 class="checkout-success__title">{m.checkout_late_title()}</h1>
        <p class="checkout-success__description">{m.checkout_late_description()}</p>
      {/if}

      <!-- Content preview card -->
      {#if content}
        <div class="checkout-success__preview-card">
          {#if content.thumbnailUrl}
            <div class="checkout-success__content-preview">
              <!-- At most 280px at 16:9, which it reaches at 19.5rem (Codex-kk9nv.3). -->
              <img
                src={content.thumbnailUrl}
                srcset={getThumbnailSrcset(content.thumbnailUrl) || undefined}
                sizes={coverCropSizes('(min-width: 19.5rem) 17.5rem, calc(100vw - 2rem)', 16 / 9, content.thumbnailUrl)}
                alt={content.title}
                class="checkout-success__thumbnail"
              />
            </div>
          {/if}

          <div class="checkout-success__content-info">
            <p class="checkout-success__content-title">{content.title}</p>
            {#if amountCents}
              <p class="checkout-success__amount">{formatPrice(amountCents)}</p>
            {/if}
          </div>
        </div>
      {/if}

      <!-- CTAs -->
      <div class="checkout-success__actions">
        {#if view === 'unlocked'}
          <a href={contentUrl} class="checkout-success__btn checkout-success__btn--primary">
            {ctaLabel}
          </a>
          <a href={browseUrl} class="checkout-success__btn checkout-success__btn--secondary">
            {m.checkout_success_browse()}
          </a>
        {:else if view === 'arriving'}
          <!-- The Start slot, held with Button's loading treatment so nothing
               jumps when it unlocks. -->
          <span
            class="checkout-success__btn checkout-success__btn--primary checkout-success__btn--held"
            aria-disabled="true"
          >
            <span class="checkout-success__btn-spinner" aria-hidden="true"></span>
            <span class="checkout-success__btn-label">{ctaLabel}</span>
          </span>
        {:else}
          {@render checkAgain(m.checkout_check_again())}
          <a href={libraryUrl} class="checkout-success__btn checkout-success__btn--secondary">
            {m.checkout_success_go_to_library()}
          </a>
        {/if}
      </div>

      {#if view === 'unlocked'}
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
      {/if}

    {:else if view === 'inactive'}
      <!-- Refunded, or held by an open bank dispute: one plain notice and the
           way to the payment history (owner decision 2026-10-26). -->
      <div class="checkout-success__icon checkout-success__icon--pending" aria-hidden="true">
        <AlertCircleIcon size={48} />
      </div>

      <h1 class="checkout-success__title">{m.checkout_inactive_title()}</h1>

      <div class="checkout-success__actions">
        <a href={paymentHistoryUrl} class="checkout-success__btn checkout-success__btn--primary">
          {m.checkout_inactive_payment_history()}
        </a>
      </div>

    {:else if view === 'confirming'}
      <!-- No answer yet: we don't know the payment went through. -->
      <div class="checkout-success__icon" role="status" aria-label={m.checkout_success_verifying()} aria-live="polite">
        <div class="checkout-success__spinner"></div>
      </div>

      <h1 class="checkout-success__title">{m.checkout_success_confirming()}</h1>
      <p class="checkout-success__description">{m.checkout_success_confirming_description()}</p>

    {:else if view === 'expired'}
      <!-- Expired: Stripe session timed out before payment landed. No
           charge was taken; distinct message from the retry-exhausted
           fallback so users know they need to start a new checkout. -->
      <div class="checkout-success__icon checkout-success__icon--pending">
        <ClockIcon size={48} />
      </div>

      <h1 class="checkout-success__title">{m.checkout_success_expired_title()}</h1>
      <p class="checkout-success__description">{m.checkout_success_expired_description()}</p>

      <div class="checkout-success__actions">
        <a href={browseUrl} class="checkout-success__btn checkout-success__btn--primary">
          {m.checkout_success_start_over()}
        </a>
      </div>

    {:else if view === 'error'}
      <!-- Error: the verify failed in a way a retry will not change (a 4xx).
           Say we could not verify it, rather than implying it is still
           processing. -->
      <div class="checkout-success__icon checkout-success__icon--pending" aria-hidden="true">
        <AlertCircleIcon size={48} />
      </div>

      <h1 class="checkout-success__title">{m.common_error()}</h1>
      <p class="checkout-success__description">{m.checkout_success_error()}</p>

      <div class="checkout-success__actions">
        <a href={libraryUrl} class="checkout-success__btn checkout-success__btn--primary">
          {m.checkout_success_go_to_library()}
        </a>
      </div>

    {:else}
      <!-- The checks ran out with no answer, or a session still open. -->
      <div class="checkout-success__icon checkout-success__icon--pending">
        <ClockIcon size={48} />
      </div>

      <h1 class="checkout-success__title">{m.checkout_success_almost_there()}</h1>
      <p class="checkout-success__description">{m.checkout_success_almost_there_description()}</p>

      <div class="checkout-success__actions">
        {@render checkAgain(m.checkout_check_again())}
        <a href={libraryUrl} class="checkout-success__btn checkout-success__btn--secondary">
          {m.checkout_success_go_to_library()}
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

  .checkout-success__icon--pending,
  .checkout-success__icon--notice {
    color: var(--color-text-secondary);
  }

  /* --- Animated checkmark --- */
  .checkmark {
    display: block;
  }

  .checkmark__circle {
    stroke: var(--color-success-600);
    stroke-width: var(--border-width-thick);
    fill: none;
    stroke-dasharray: 188;
    stroke-dashoffset: 188;
    animation: checkmark-circle-draw var(--duration-normal) var(--ease-out) forwards;
  }

  .checkmark__check {
    stroke: var(--color-success-600);
    stroke-width: var(--border-width-thick);
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 48;
    stroke-dashoffset: 48;
    animation: checkmark-check-draw var(--duration-fast) var(--ease-out) var(--duration-fast) forwards;
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
    animation: spin var(--duration-slower) linear infinite;
  }

  /* motion.css duration-collapse does NOT neutralise infinite keyframe
     animations — a 500ms linear-infinite spin at 0.01ms becomes chaotic.
     Explicit reduced-motion guard stops the rotation but keeps the
     coloured border-top so there's still a non-animated visual indicator
     that something is loading (ref 05 §Media §5). */
  @media (prefers-reduced-motion: reduce) {
    .checkout-success__spinner {
      animation: none;
      border-top-color: var(--color-interactive);
    }
  }

  /* --- "Unlocking your content…": a small copy of the page's spinner --- */
  .checkout-success__status {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
  }

  .checkout-success__status-spinner {
    flex-shrink: 0;
    width: var(--space-4);
    height: var(--space-4);
    border-radius: 50%;
    border: var(--border-width-thick) solid var(--color-border);
    border-top-color: var(--color-interactive);
    animation: spin var(--duration-slower) linear infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .checkout-success__status-spinner {
      animation: none;
    }
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
    font-family: inherit;
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    border: none;
    border-radius: var(--radius-md);
    text-decoration: none;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .checkout-success__btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
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
    background: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .checkout-success__btn[aria-busy='true'] {
    cursor: progress;
  }

  /* The held Start slot: Button's loading treatment, a spinner in place of
     the label, which keeps its width. */
  .checkout-success__btn--held {
    position: relative;
    cursor: progress;
  }

  .checkout-success__btn--held:hover {
    background: var(--color-interactive);
  }

  .checkout-success__btn--held .checkout-success__btn-label {
    visibility: hidden;
  }

  .checkout-success__btn-spinner {
    position: absolute;
    width: var(--space-4);
    height: var(--space-4);
    border: var(--border-width-thick) solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin var(--duration-slower) linear infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .checkout-success__btn-spinner {
      animation: none;
    }
  }

  @media (--breakpoint-sm) {
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

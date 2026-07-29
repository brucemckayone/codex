<!--
  @component JourneyCheckoutSuccess

  The return leg from Stripe (Codex-2pryk.2.4.4). A waiting room: the load
  forwards to the dashboard the moment the entitlement exists, so reaching this
  markup at all means the grant has not landed YET.

  It therefore re-polls by invalidating the load's `journey:entitlement`
  dependency. The poll is capped — a webhook that never arrives must resolve into
  an honest "we're still working on it, here's what to do" rather than an
  indefinite spinner that quietly implies the purchase failed.
-->
<script lang="ts">
  import { invalidate } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  /** 2s × 15 ≈ 30s — long enough for a Stripe webhook, short enough to not strand. */
  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 15;

  let polls = $state(0);
  const givenUp = $derived(polls >= MAX_POLLS);

  $effect(() => {
    // Only poll when a payment actually happened; a direct visit has nothing
    // pending and polling it would be a pointless request loop.
    if (!data.arrivedFromStripe || givenUp) return;

    const timer = setInterval(() => {
      polls += 1;
      invalidate('journey:entitlement');
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  });
</script>

<svelte:head>
  <title>Confirming your place in {data.courseTitle}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<section class="ret">
  {#if !data.arrivedFromStripe}
    <h1 class="ret__title">Nothing to confirm here</h1>
    <p class="ret__body">
      This page confirms a payment as it completes. If you meant to join
      {data.courseTitle}, start from the offer page.
    </p>
    <a class="ret__cta" href={data.checkoutPath}>
      See the ways in <span aria-hidden="true">→</span>
    </a>
  {:else if givenUp}
    <h1 class="ret__title">Still confirming your payment</h1>
    <p class="ret__body">
      Your payment went through, but the confirmation is taking longer than usual
      to reach us. Nothing is lost — {data.courseTitle} will appear in your
      library as soon as it lands, usually within a few minutes.
    </p>
    <div class="ret__actions">
      <a class="ret__cta" href={data.dashboardPath}>
        Try the journey <span aria-hidden="true">→</span>
      </a>
      <a class="ret__link" href={data.libraryPath}>Go to your library</a>
    </div>
  {:else}
    <div class="ret__pulse" aria-hidden="true"></div>
    <h1 class="ret__title">Confirming your payment…</h1>
    <p class="ret__body" role="status">
      Thank you. We're setting up your access to {data.courseTitle} — this
      usually takes a few seconds.
    </p>
  {/if}
</section>

<style>
  .ret {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    max-width: 34rem;
    margin-inline: auto;
    padding-block: var(--space-20);
    padding-inline: var(--space-5);
    text-align: center;
  }

  .ret__pulse {
    width: var(--space-3);
    height: var(--space-3);
    border-radius: var(--radius-full);
    background: var(--color-brand-primary);
    animation: ret-pulse 1.6s ease-in-out infinite;
  }

  .ret__title {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-2xl);
    line-height: var(--leading-tight);
    color: var(--color-heading);
    text-wrap: balance;
  }

  .ret__body {
    margin: 0;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .ret__actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    margin-block-start: var(--space-2);
  }

  .ret__cta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-6);
    border-radius: var(--radius-full);
    font-weight: var(--font-semibold);
    text-decoration: none;
    color: var(--color-text-on-brand);
    background: var(--color-brand-primary);
    transition: var(--transition-colors);
  }

  .ret__cta:hover {
    background: var(--color-brand-primary-hover);
  }

  .ret__link {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  @keyframes ret-pulse {
    0%,
    100% {
      opacity: 0.35;
      transform: scale(0.85);
    }
    50% {
      opacity: 1;
      transform: scale(1.15);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ret__pulse {
      animation: none;
      opacity: 1;
    }
  }
</style>

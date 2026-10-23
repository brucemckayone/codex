<!--
  @component JourneyCheckoutSuccess

  The return leg from Stripe (Codex-2pryk.2.4.4). A waiting room: the load
  forwards to the dashboard the moment the entitlement exists, so reaching this
  markup at all means the grant has not landed YET.

  It therefore re-polls by invalidating the load's `journey:entitlement`
  dependency. The poll is capped — a webhook that never arrives must resolve into
  an honest "we're still working on it, here's what to do" rather than an
  indefinite spinner that quietly implies the purchase failed.

  A second payment for access the buyer already held (`data.duplicate`,
  Codex-o4jvw) is final: a calm notice that it is being refunded, the way in,
  and no more polling.
-->
<script lang="ts">
  import { invalidate } from '$app/navigation';
  import * as m from '$paraglide/messages';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  /** 2s × 15 ≈ 30s — long enough for a Stripe webhook, short enough to not strand. */
  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 15;

  let polls = $state(0);
  const givenUp = $derived(polls >= MAX_POLLS);

  /** The duplicate-payment notice, or null for every other state. */
  const notice = $derived.by(() => {
    const duplicate = data.duplicate;
    if (!duplicate) return null;
    const toCourse = {
      href: data.dashboardPath,
      label: m.checkout_duplicate_go_to({ name: data.courseTitle }),
    };
    switch (duplicate.kind) {
      case 'purchase':
        return {
          title: m.checkout_duplicate_title({ item: data.courseTitle }),
          body: m.checkout_duplicate_description(),
          goTo: toCourse,
          changePlanHint: null,
        };
      case 'subscription':
        return {
          title: m.subscription_duplicate_course_title({ course: data.courseTitle }),
          body: m.subscription_duplicate_description(),
          goTo: toCourse,
          changePlanHint: null,
        };
      case 'tier':
        return {
          title: m.subscription_duplicate_title({
            org: duplicate.organizationName,
            tier: duplicate.keptTierName,
          }),
          body: m.subscription_duplicate_description(),
          goTo: {
            href: '/',
            label: m.checkout_duplicate_go_to({ name: duplicate.organizationName }),
          },
          changePlanHint: duplicate.otherTierName
            ? m.subscription_duplicate_change_plan_hint({ tier: duplicate.otherTierName })
            : null,
        };
    }
  });

  $effect(() => {
    // Only poll when a payment actually happened; a direct visit has nothing
    // pending and polling it would be a pointless request loop. A duplicate
    // notice is final.
    if (!data.arrivedFromStripe || givenUp || notice) return;

    const timer = setInterval(() => {
      polls += 1;
      invalidate('journey:entitlement');
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  });
</script>

<svelte:head>
  {#if notice}
    <title>{notice.title}</title>
  {:else}
    <title>Confirming your place in {data.courseTitle}</title>
  {/if}
  <meta name="robots" content="noindex" />
</svelte:head>

<section class="ret">
  {#if notice}
    <h1 class="ret__title">{notice.title}</h1>
    <p class="ret__body">{notice.body}</p>
    {#if notice.changePlanHint}
      <p class="ret__body">{notice.changePlanHint}</p>
    {/if}
    <div class="ret__actions">
      <a class="ret__cta" href={notice.goTo.href}>
        {notice.goTo.label} <span aria-hidden="true">→</span>
      </a>
      {#if notice.changePlanHint}
        <a class="ret__link" href="/pricing">{m.subscription_duplicate_change_plan()}</a>
      {/if}
    </div>
  {:else if !data.arrivedFromStripe}
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

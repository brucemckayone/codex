<!--
  @component JourneyCheckoutSuccess

  The return leg from Stripe (Codex-2pryk.2.4.4). A waiting room: the load
  forwards to the dashboard the moment the entitlement exists, so reaching this
  markup at all means the grant has not landed YET.

  It therefore re-checks by invalidating the load's `journey:entitlement`
  dependency, capped: about six checks over the first minute, only while the
  tab is visible, then it stops (owner decision 2026-10-26, "Capped, then a
  button"; Codex-2hxff.22). A webhook that never arrives resolves into "Your
  payment went through. We're still finishing up; check again in a minute."
  with Check again (one check per click) and Go to library, rather than an
  indefinite spinner — or an open-ended loop on a tab left open.

  A second payment for access the buyer already held (`data.duplicate`,
  Codex-o4jvw) is final: a calm notice that it is being refunded, the way in,
  and no more polling. So is a course purchase no longer active
  (`data.inactive`: refunded, or paused by a dispute), and so is a payment
  nothing will record (`data.notRecorded`; Codex-2hxff.81, owner decision
  2026-10-27, "Say we're on it"): support was alerted, and the page says so
  with Contact support and Go to library.
-->
<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { CappedChecks } from '$lib/utils/capped-checks.svelte';
  import { buildPlatformUrl } from '$lib/utils/subdomain';
  import { supportMailto } from '$lib/utils/support-mailto';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const checks = new CappedChecks(() => invalidate('journey:entitlement'));
  const givenUp = $derived(checks.exhausted);

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

  // Only check when a payment actually happened; a direct visit has nothing
  // pending and checking it would be a pointless request loop. A duplicate
  // notice, a purchase no longer active, or a payment nothing will record is
  // final: a check on that last one would ask again and alert support again.
  // A boolean, so the effect restarts only when it flips: every check hands
  // the page a new `data`, and an effect reading `data` itself would restart
  // on each one.
  const waiting = $derived(
    Boolean(
      data.arrivedFromStripe && !notice && !data.inactive && !data.notRecorded
    )
  );

  $effect(() => {
    if (!waiting) return;
    return checks.start();
  });
</script>

<svelte:head>
  {#if notice}
    <title>{notice.title}</title>
  {:else if data.inactive}
    <title>{m.checkout_inactive_title()}</title>
  {:else if data.notRecorded}
    <title>{m.checkout_late_title()}</title>
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
  {:else if data.inactive}
    <!-- Refunded, or paused by a bank dispute: one plain notice and the way
         to the payment history (owner decision 2026-10-26). -->
    <h1 class="ret__title">{m.checkout_inactive_title()}</h1>
    <div class="ret__actions">
      <a class="ret__cta" href={buildPlatformUrl(page.url, '/account/payment')}>
        {m.checkout_inactive_payment_history()}
      </a>
    </div>
  {:else if data.notRecorded}
    <!-- Paid, and nothing will record it: support was alerted
         (Codex-2hxff.81). No checks. -->
    <h1 class="ret__title">{m.checkout_not_recorded_title()}</h1>
    <p class="ret__body">{m.checkout_not_recorded_description()}</p>
    <div class="ret__actions">
      <!-- The subject quotes the reference, so support can match it to the
           alert. -->
      <a
        class="ret__cta"
        href={supportMailto(`Checkout help, reference ${data.notRecorded.reference}`)}
      >
        {m.checkout_contact_support()}
      </a>
      <a class="ret__link" href={data.libraryPath}>
        {m.checkout_success_go_to_library()}
      </a>
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
    <h1 class="ret__title">{m.checkout_late_title()}</h1>
    <p class="ret__body">{m.checkout_late_description()}</p>
    <div class="ret__actions">
      <!-- No `disabled` while it runs: that would drop focus to <body>. The
           label says so, and a second click sends nothing (CappedChecks). -->
      <button
        type="button"
        class="ret__cta"
        aria-busy={checks.checking}
        onclick={() => checks.checkOnce()}
      >
        {checks.checking ? m.checkout_checking() : m.checkout_check_again()}
      </button>
      <a class="ret__link" href={data.libraryPath}>
        {m.checkout_success_go_to_library()}
      </a>
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
    border: none;
    border-radius: var(--radius-full);
    font-family: inherit;
    font-size: inherit;
    font-weight: var(--font-semibold);
    text-decoration: none;
    color: var(--color-text-on-brand);
    background: var(--color-brand-primary);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .ret__cta[aria-busy='true'] {
    cursor: progress;
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

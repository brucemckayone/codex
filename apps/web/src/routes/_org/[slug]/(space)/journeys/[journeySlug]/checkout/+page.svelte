<!--
  @component JourneyCheckoutShell

  The offer/pay step (SPEC §7, FRONTEND-MAP §1 checkout). This is the WP-3
  STRUCTURAL shell: it renders the resolved course as an offer summary and a
  placeholder "continue to payment" affordance so the sell → pay funnel is
  navigable today. The real three-path offer selection and the Stripe form
  action land in WP-6 (monetization) — flagged inline.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { buildJourneyUrl } from '@codex/urls';
  import { formatPrice } from '$lib/utils/format';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const course = $derived(data.course);
  const priceLabel = $derived(
    course.priceCents !== null ? formatPrice(course.priceCents) : null
  );

  const backToSales = $derived(
    buildJourneyUrl(
      page.url,
      { slug: course.slug, id: course.id },
      { surface: 'sales' }
    )
  );
</script>

<svelte:head>
  <title>Join {course.title}</title>
  <!-- A per-user pay step is never a search target. -->
  <meta name="robots" content="noindex" />
</svelte:head>

<section class="checkout">
  <div class="checkout__inner">
    <a class="checkout__back" href={backToSales}>← Back to {course.title}</a>

    <header class="checkout__head">
      {#if course.kicker}
        <p class="checkout__kicker">{course.kicker}</p>
      {/if}
      <h1 class="checkout__title">Join {course.title}</h1>
      {#if course.lede}
        <p class="checkout__lede">{course.lede}</p>
      {/if}
    </header>

    <div class="checkout__offer">
      <div class="checkout__offer-body">
        <p class="checkout__offer-name">Own {course.title}</p>
        <p class="checkout__offer-meta">
          {course.stageCount} stages · {course.practiceCount} practices
        </p>
      </div>
      {#if priceLabel}
        <p class="checkout__price">{priceLabel}</p>
      {/if}
    </div>

    {#if data.preselectedOffer}
      <p class="checkout__preselect">
        Pre-selected offer: <b>{data.preselectedOffer}</b>
      </p>
    {/if}

    <!--
      WP-6 seam: the real three-path selection (tier / course-subscription /
      one-off) + the Stripe checkout form action replace this placeholder. Kept
      a plain, disabled affordance so the shell never implies a working pay flow.
    -->
    <button type="button" class="checkout__pay" disabled>
      Continue to payment
    </button>
    <p class="checkout__note">
      Secure checkout is being connected. Payment goes live with the
      monetization release.
    </p>
  </div>
</section>

<style>
  .checkout {
    padding-block: var(--space-16);
    padding-inline: var(--space-5);
  }

  .checkout__inner {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 40rem;
    margin-inline: auto;
  }

  .checkout__back {
    align-self: flex-start;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-decoration: none;
  }

  .checkout__back:hover {
    color: var(--color-text);
    text-decoration: underline;
  }

  .checkout__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .checkout__kicker {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .checkout__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    line-height: var(--leading-tight);
    color: var(--color-heading);
    text-wrap: balance;
  }

  .checkout__lede {
    margin: 0;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .checkout__offer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-5);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-card);
    background: var(--color-surface);
  }

  .checkout__offer-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .checkout__offer-name {
    margin: 0;
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .checkout__offer-meta {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .checkout__price {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    color: var(--color-heading);
  }

  .checkout__preselect {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .checkout__pay {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3) var(--space-6);
    border: var(--border-width) solid transparent;
    border-radius: var(--radius-button);
    font-family: var(--font-body);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text-on-brand);
    background: var(--color-brand-primary);
  }

  .checkout__pay:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .checkout__note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
    text-align: center;
  }
</style>

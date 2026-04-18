<script lang="ts">
  import { page } from '$app/state';
  import { onMount, tick, untrack } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import * as m from '$paraglide/messages';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import { Badge, EmptyState } from '$lib/components/ui';
  import {
    AlertTriangleIcon,
    CheckIcon,
    CheckCircleIcon,
    LockIcon,
    XIcon,
  } from '$lib/components/ui/Icon';
  import * as Accordion from '$lib/components/ui/Accordion';
  import { createSubscriptionCheckoutSession } from '$lib/remote/subscription.remote';
  import { getPricingFaq } from '$lib/remote/branding.remote';
  import type { SubscriptionTier } from '$lib/types';
  import type { PricingFaqItem } from '@codex/validation';
  import { formatPrice } from '$lib/utils/format';

  let { data } = $props();

  // ── Billing Interval ──────────────────────────────────────────────
  const initialInterval = page.url.searchParams.get('billingInterval');
  let billingInterval = $state<'month' | 'year'>(
    initialInterval === 'year' ? 'year' : 'month'
  );

  // ── Checkout Flow ─────────────────────────────────────────────────
  let checkoutLoading = $state<string | null>(null);
  let checkoutError = $state('');
  const restoredTierId = page.url.searchParams.get('tierId');

  // ── Feature Flag ──────────────────────────────────────────────────
  const enableSubscriptions = $derived(data.enableSubscriptions ?? true);

  // ── Resolved Streamed Data ────────────────────────────────────────
  let tiers = $state<SubscriptionTier[]>([]);
  let currentTierId = $state<string | null>(null);
  let pricingLoading = $state(true);

  let resolvedTiersPromise: Promise<unknown> | null = null;
  $effect(() => {
    const promise = data.tiers;
    untrack(() => {
      if (promise && promise !== resolvedTiersPromise) {
        pricingLoading = true;
        resolvedTiersPromise = promise;
        Promise.resolve(promise).then((result) => {
          if (resolvedTiersPromise === promise) {
            tiers = (result as SubscriptionTier[]) ?? [];
            pricingLoading = false;
          }
        });
      }
    });
  });

  let resolvedSubPromise: Promise<unknown> | null = null;
  $effect(() => {
    const promise = data.currentSubscription;
    untrack(() => {
      if (promise && promise !== resolvedSubPromise) {
        resolvedSubPromise = promise;
        Promise.resolve(promise).then((result) => {
          if (resolvedSubPromise === promise) {
            currentTierId =
              (result as { tierId?: string } | null)?.tierId ?? null;
          }
        });
      }
    });
  });

  // ── Recommended Tier ──────────────────────────────────────────────
  const recommendedTier = $derived.by(() => {
    if (tiers.length === 0) return null;
    const explicit = tiers.find((t) => t.isRecommended);
    if (explicit) return explicit;
    const sorted = [...tiers].sort((a, b) => a.sortOrder - b.sortOrder);
    return sorted[Math.floor(sorted.length / 2)] ?? sorted[0];
  });

  // Max annual savings across all tiers — used as the hero lure.
  const maxAnnualSavings = $derived.by(() => {
    if (tiers.length === 0) return 0;
    return Math.max(0, ...tiers.map((t) => savingsPercent(t)));
  });

  // ── FAQ ────────────────────────────────────────────────────────────
  const DEFAULT_FAQ: PricingFaqItem[] = [
    {
      id: 'default-access',
      question: 'When does my access start?',
      answer:
        'Immediately. The moment your payment confirms, every title included in your tier unlocks — no waiting period, no activation email to hunt down.',
      order: 0,
    },
    {
      id: 'default-cancel',
      question: 'Can I cancel anytime?',
      answer:
        'Yes. Cancel from your account in a couple of clicks and you keep access through the end of the billing period you have already paid for.',
      order: 1,
    },
    {
      id: 'default-change-plan',
      question: 'Can I switch plans later?',
      answer:
        'Anytime. Upgrades and downgrades take effect at the start of your next billing period so you never lose paid time, and the price difference is handled automatically.',
      order: 2,
    },
    {
      id: 'default-payment',
      question: 'Is my payment secure?',
      answer:
        'Every transaction is processed by Stripe, the same payment infrastructure used by Amazon, Shopify, and most of the internet. The creators never see your card details.',
      order: 3,
    },
  ];

  let faqItems = $state<PricingFaqItem[]>(DEFAULT_FAQ);

  // ── Sticky CTA ────────────────────────────────────────────────────
  // Two-observer pattern: tier cards leaving → sticky allowed;
  // trust strip entering → sticky suppressed (so it doesn't cover the footer).
  // Identical logic on desktop and mobile — no more always-visible mobile shortcut.
  let tierCardsRef = $state<HTMLElement | null>(null);
  let trustStripRef = $state<HTMLElement | null>(null);
  let tierCardsOutOfView = $state(false);
  let trustStripInView = $state(false);
  let dismissedStickyCta = $state(false);
  let isMobile = $state(false);

  const stickyVisible = $derived(
    tierCardsOutOfView &&
      !trustStripInView &&
      !dismissedStickyCta &&
      tiers.length > 0 &&
      !pricingLoading &&
      !currentTierId
  );

  // ── Helpers ────────────────────────────────────────────────────────
  function savingsPercent(tier: SubscriptionTier): number {
    const monthlyTotal = tier.priceMonthly * 12;
    if (monthlyTotal <= 0) return 0;
    return Math.round(((monthlyTotal - tier.priceAnnual) / monthlyTotal) * 100);
  }

  function tierPrice(tier: SubscriptionTier): number {
    return billingInterval === 'month' ? tier.priceMonthly : tier.priceAnnual;
  }

  function formatHoursShort(totalSeconds: number): string {
    if (totalSeconds <= 0) return '0';
    const hours = totalSeconds / 3600;
    if (hours < 1) return `${Math.round(totalSeconds / 60)}m`;
    return hours % 1 === 0 ? `${Math.round(hours)}` : `${hours.toFixed(1)}`;
  }

  // ── Billing toggle radiogroup keyboard handling ──────────────────
  // ARIA radiogroup pattern: arrow keys navigate + select the adjacent radio.
  // Roving tabindex is set inline on each button so Tab only lands once on
  // the group (on the currently-checked radio).
  function handleBillingKey(e: KeyboardEvent) {
    const next = ['ArrowRight', 'ArrowDown'].includes(e.key);
    const prev = ['ArrowLeft', 'ArrowUp'].includes(e.key);
    if (!next && !prev) return;
    e.preventDefault();
    billingInterval = billingInterval === 'month' ? 'year' : 'month';
    // Shift focus to the newly-checked option on the next microtask after
    // Svelte updates aria-checked + tabindex.
    const targetIdx = billingInterval === 'month' ? 0 : 1;
    const buttons = (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button');
    queueMicrotask(() => buttons[targetIdx]?.focus());
  }

  async function handleSubscribe(tier: SubscriptionTier) {
    if (!data.isAuthenticated) {
      const returnPath = `${page.url.pathname}?tierId=${encodeURIComponent(tier.id)}&billingInterval=${encodeURIComponent(billingInterval)}`;
      window.location.href = `/login?redirect=${encodeURIComponent(returnPath)}`;
      return;
    }

    checkoutLoading = tier.id;
    checkoutError = '';
    try {
      const result = await createSubscriptionCheckoutSession({
        tierId: tier.id,
        billingInterval,
        organizationId: data.org.id,
      });
      window.location.href = result.sessionUrl;
    } catch (err) {
      checkoutError =
        err instanceof Error ? err.message : m.subscription_checkout_error();
      checkoutLoading = null;
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────
  onMount(() => {
    if (restoredTierId && data.isAuthenticated) {
      Promise.resolve(data.tiers).then((resolved) => {
        const tier = (resolved as SubscriptionTier[] | null)?.find(
          (t) => t.id === restoredTierId
        );
        if (tier) handleSubscribe(tier);
      });
    }

    getPricingFaq(data.org.id).then((result) => {
      if (result && Array.isArray(result) && result.length > 0) {
        faqItems = (result as PricingFaqItem[]).sort(
          (a, b) => a.order - b.order
        );
      }
    }).catch(() => {});

    const mq = window.matchMedia('(max-width: 47.9375rem)');
    isMobile = mq.matches;
    const handleMq = (e: MediaQueryListEvent) => {
      isMobile = e.matches;
    };
    mq.addEventListener('change', handleMq);

    // Observer 1: tier cards leaving viewport → sticky allowed.
    let tierObserver: IntersectionObserver | undefined;
    // Observer 2: trust strip entering viewport → sticky suppressed so it
    // doesn't cover the page footer.
    let trustObserver: IntersectionObserver | undefined;

    const setupTierObserver = () => {
      if (tierCardsRef && !tierObserver) {
        tierObserver = new IntersectionObserver(
          ([entry]) => {
            tierCardsOutOfView = !entry.isIntersecting;
          },
          { threshold: 0 }
        );
        tierObserver.observe(tierCardsRef);
      }
    };

    const setupTrustObserver = () => {
      if (trustStripRef && !trustObserver) {
        trustObserver = new IntersectionObserver(
          ([entry]) => {
            trustStripInView = entry.isIntersecting;
          },
          { threshold: 0.3 }
        );
        trustObserver.observe(trustStripRef);
      }
    };

    const unwatch = $effect.root(() => {
      $effect(() => {
        if (!pricingLoading && tierCardsRef) setupTierObserver();
      });
      $effect(() => {
        if (trustStripRef) setupTrustObserver();
      });
    });

    // Generic scroll-reveal for below-fold sections (preview, faq, trust).
    // Sections that haven't entered the viewport stay at reduced opacity;
    // adding `.reveal--visible` triggers the CSS transition.
    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('reveal--visible');
            revealObserver.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );

    const observeReveals = () => {
      const revealEls = document.querySelectorAll<HTMLElement>(
        '[data-reveal]:not(.reveal--visible)'
      );
      revealEls.forEach((el) => revealObserver.observe(el));
    };

    // Initial sweep picks up static sections (faq, trust).
    observeReveals();
    // Re-sweep after streamed sections land in the DOM (preview).
    // `tick()` waits for Svelte to flush the post-promise DOM update so the
    // `<section class="preview">` element exists when observeReveals runs.
    Promise.resolve(data.contentPreview).finally(async () => {
      await tick();
      observeReveals();
    });
    Promise.resolve(data.stats).finally(async () => {
      await tick();
      observeReveals();
    });

    return () => {
      mq.removeEventListener('change', handleMq);
      tierObserver?.disconnect();
      trustObserver?.disconnect();
      revealObserver.disconnect();
      unwatch();
    };
  });
</script>

<svelte:head>
  <title>{m.subscription_pricing_title()} | {data.org.name}</title>
  <meta name="description" content={m.subscription_pricing_subtitle()} />
</svelte:head>

<div class="pricing-page">
  {#if !enableSubscriptions}
    <EmptyState
      title={m.subscription_disabled_title()}
      description={m.subscription_disabled_description()}
    />
  {:else}
    <!-- ═══ HERO ═══ -->
    <section class="pricing-hero">
      <div class="pricing-hero__backdrop" aria-hidden="true"></div>
      <header class="pricing-hero__lede">
        <p class="pricing-hero__eyebrow">Membership</p>
        <span class="pricing-hero__rule" aria-hidden="true"></span>
        <h1 class="pricing-hero__title">
          {m.subscription_pricing_title()}
        </h1>
        <p class="pricing-hero__subtitle">
          {m.subscription_pricing_subtitle()}
        </p>
      </header>

      <div class="billing-toggle-wrapper">
        <div
          class="billing-toggle"
          role="radiogroup"
          aria-label="Billing period"
          onkeydown={handleBillingKey}
          tabindex={-1}
        >
          <button
            class="toggle-option"
            class:active={billingInterval === 'month'}
            onclick={() => { billingInterval = 'month'; }}
            role="radio"
            aria-checked={billingInterval === 'month'}
            tabindex={billingInterval === 'month' ? 0 : -1}
          >
            {m.pricing_monthly()}
          </button>
          <button
            class="toggle-option"
            class:active={billingInterval === 'year'}
            onclick={() => { billingInterval = 'year'; }}
            role="radio"
            aria-checked={billingInterval === 'year'}
            tabindex={billingInterval === 'year' ? 0 : -1}
          >
            {m.pricing_annual()}
            {#if billingInterval === 'month' && maxAnnualSavings > 0}
              <span class="savings-pill">Save {maxAnnualSavings}%</span>
            {/if}
          </button>
        </div>
      </div>
    </section>

    <!-- ═══ TIER CARDS ═══ -->
    {#if checkoutError}
      <div
        class="checkout-error"
        role="alert"
        aria-live="polite"
        transition:fly={{ y: -12, duration: 220, easing: cubicOut }}
      >
        <span class="checkout-error__icon" aria-hidden="true">
          <AlertTriangleIcon size={18} />
        </span>
        <div class="checkout-error__body">
          <p class="checkout-error__title">Something went wrong</p>
          <p class="checkout-error__message">{checkoutError}</p>
        </div>
        <button
          class="checkout-error__dismiss"
          type="button"
          onclick={() => { checkoutError = ''; }}
          aria-label="Dismiss error"
        >
          <XIcon size={14} />
        </button>
      </div>
    {/if}

    {#if pricingLoading}
      <div class="tier-stage" aria-busy="true" aria-label="Loading subscription plans">
        {#each Array(3) as _, i}
          <div
            class="card-shell"
            class:card-shell--featured={i === 1}
            style="--card-index: {i}"
          >
            <div class="skeleton skeleton--title"></div>
            <div class="skeleton skeleton--desc"></div>
            <div class="skeleton skeleton--price"></div>
            <div class="skeleton skeleton--helper"></div>
            <div class="card-shell__features">
              {#each Array(3) as _}
                <div class="card-shell__feature">
                  <div class="skeleton skeleton--feature-icon"></div>
                  <div class="skeleton skeleton--feature"></div>
                </div>
              {/each}
            </div>
            <div class="skeleton skeleton--cta"></div>
          </div>
        {/each}
      </div>
    {:else if tiers.length === 0}
      <EmptyState title={m.pricing_no_tiers()} />
    {:else}
      <section
        class="tier-stage"
        class:tier-stage--single={tiers.length === 1}
        class:tier-stage--duo={tiers.length === 2}
        bind:this={tierCardsRef}
      >
        {#each tiers as tier, i (tier.id)}
          {@const isCurrentPlan = currentTierId === tier.id}
          {@const isRecommended = recommendedTier?.id === tier.id}
          {@const savings = savingsPercent(tier)}
          <article
            class="card"
            class:card--featured={isRecommended && !isCurrentPlan}
            class:card--current={isCurrentPlan}
            style="--card-index: {i}"
          >
            <!-- Glow layer + floating ribbon for recommended -->
            {#if isRecommended && !isCurrentPlan}
              <div class="card__glow" aria-hidden="true"></div>
              <span class="card__ribbon">Most Popular</span>
            {/if}

            <div class="card__inner">
              {#if isCurrentPlan}
                <span class="card__label card__label--current">{m.pricing_current_plan()}</span>
              {/if}

              <header class="card__header">
                <h2 class="card__name">{tier.name}</h2>
                {#if tier.description}
                  <p class="card__desc">{tier.description}</p>
                {/if}
              </header>

              <div class="card__pricing">
                <div class="card__price-row">
                  <span class="card__price-amount">{formatPrice(tierPrice(tier))}</span>
                  <span class="card__price-interval">
                    {billingInterval === 'month' ? m.pricing_per_month() : m.pricing_per_year()}
                  </span>
                  {#if billingInterval === 'year' && savings > 0}
                    <span class="card__price-save">−{savings}%</span>
                  {/if}
                </div>
                {#if billingInterval === 'year' && tier.priceAnnual > 0}
                  <span class="card__price-helper">
                    £{(tier.priceAnnual / 1200).toFixed(2)}/mo · billed annually
                  </span>
                {:else if billingInterval === 'month' && savings > 0}
                  <span class="card__price-helper">
                    Save {savings}% when billed annually
                  </span>
                {/if}
              </div>

              <ul class="card__features">
                <li>
                  <span class="card__feature-icon" aria-hidden="true">
                    <CheckIcon size={16} />
                  </span>
                  <span>{m.pricing_all_tier_content({ tierName: tier.name })}</span>
                </li>
                <li>
                  <span class="card__feature-icon" aria-hidden="true">
                    <CheckIcon size={16} />
                  </span>
                  <span>Cancel anytime, no questions asked</span>
                </li>
                <li>
                  <span class="card__feature-icon" aria-hidden="true">
                    <CheckIcon size={16} />
                  </span>
                  <span>Instant access on payment</span>
                </li>
              </ul>

              <div class="card__action">
                {#if isCurrentPlan}
                  <Button variant="secondary" disabled class="tier-cta">
                    {m.pricing_current_plan()}
                  </Button>
                {:else}
                  <Button
                    variant={isRecommended ? 'primary' : 'secondary'}
                    onclick={() => handleSubscribe(tier)}
                    loading={checkoutLoading === tier.id}
                    class="tier-cta"
                  >
                    {m.pricing_subscribe()}
                  </Button>
                {/if}
              </div>
            </div>
          </article>
        {/each}
      </section>
    {/if}

    <!-- ═══ CONTENT PREVIEW ═══ -->
    {#await data.contentPreview then items}
      {@const withThumbs = items?.filter((i) => i.thumbnailUrl) ?? []}
      {#if (items?.length ?? 0) > 0}
        {@const tiles = withThumbs.slice(0, 4)}
        {@const spreadVariant = tiles.length === 1 ? 'solo' : tiles.length === 2 ? 'pair' : tiles.length === 3 ? 'trio' : 'magazine'}
        <section class="preview reveal" data-reveal>
          <header class="preview__lede">
            <p class="preview__eyebrow">Inside the library</p>
            <span class="preview__rule" aria-hidden="true"></span>
            <h2 class="preview__title">A catalogue you'll never finish.</h2>
            <p class="preview__subtitle">
              Video, audio, and writing from every creator — included with every membership.
            </p>
          </header>

          {#if tiles.length > 0}
            <div class="preview__spread preview__spread--{spreadVariant}">
              {#each tiles as item, i (item.id)}
                {@const typeLabel = item.contentType === 'audio' ? 'Audio' : item.contentType === 'written' ? 'Article' : 'Video'}
                <div class="preview__tile preview__tile--{i}">
                  <img src={item.thumbnailUrl} alt="" loading="lazy" />
                  <div class="preview__tile-shade" aria-hidden="true"></div>
                  <span class="preview__badge">{typeLabel}</span>
                  {#if i === 0}
                    <span class="preview__tile-title">{item.title}</span>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}

          {#await data.stats then stats}
            <footer class="preview__footer">
              <div class="preview__stats">
                {#if stats?.content?.total}
                  <div class="preview__stat">
                    <span class="preview__stat-number">{stats.content.total}</span>
                    <span class="preview__stat-label">{stats.content.total === 1 ? 'Title' : 'Titles'}</span>
                  </div>
                {/if}
                {#if (stats?.creators ?? 0) > 0}
                  <div class="preview__stat">
                    <span class="preview__stat-number">{stats.creators}</span>
                    <span class="preview__stat-label">{stats.creators === 1 ? 'Creator' : 'Creators'}</span>
                  </div>
                {/if}
                {#if (stats?.totalDurationSeconds ?? 0) > 0}
                  <div class="preview__stat">
                    <span class="preview__stat-number">{formatHoursShort(stats.totalDurationSeconds)}</span>
                    <span class="preview__stat-label">Hours</span>
                  </div>
                {/if}
              </div>

              {#if (stats?.categories?.length ?? 0) > 1}
                <ul class="preview__categories" aria-label="Topics">
                  {#each stats.categories.slice(0, 8) as cat}
                    <li>{cat}</li>
                  {/each}
                </ul>
              {/if}

              <a href="/explore" class="preview__cta">
                <span>Browse the catalogue</span>
                <span class="preview__cta-arrow" aria-hidden="true">→</span>
              </a>
            </footer>
          {/await}
        </section>
      {/if}
    {/await}

    <!-- ═══ FAQ ═══ -->
    <section class="faq reveal" data-reveal>
      <header class="faq__lede">
        <p class="faq__eyebrow">Before you subscribe</p>
        <span class="faq__rule" aria-hidden="true"></span>
        <h2 class="faq__title">Questions, answered.</h2>
        <p class="faq__subtitle">
          The questions we hear most — answered straight.
        </p>
      </header>

      <div class="faq__list">
        <Accordion.Root>
          {#each faqItems as item (item.id)}
            <Accordion.Item value={item.id}>
              <Accordion.Trigger>{item.question}</Accordion.Trigger>
              <Accordion.Content><p>{item.answer}</p></Accordion.Content>
            </Accordion.Item>
          {/each}
        </Accordion.Root>
      </div>
    </section>

    <!-- ═══ TRUST ═══ -->
    <footer class="trust reveal" data-reveal bind:this={trustStripRef}>
      <span class="trust__rule" aria-hidden="true"></span>
      <div class="trust__signals">
        <span class="trust__signal">
          <span class="trust__icon" aria-hidden="true"><CheckCircleIcon size={14} /></span>
          <span class="trust__label">Cancel anytime</span>
        </span>
        <span class="trust__dot" aria-hidden="true"></span>
        <span class="trust__signal">
          <span class="trust__icon" aria-hidden="true"><LockIcon size={14} /></span>
          <span class="trust__label">Secure checkout</span>
        </span>
        <span class="trust__dot" aria-hidden="true"></span>
        <span class="trust__signal">
          <span class="trust__icon" aria-hidden="true"><CheckIcon size={14} /></span>
          <span class="trust__label">Instant access</span>
        </span>
      </div>
    </footer>
  {/if}
</div>

<!-- ═══ STICKY CTA ═══ -->
{#if stickyVisible && recommendedTier}
  <div
    class="sticky-bar"
    class:sticky-bar--mobile={isMobile}
    transition:fly={{ y: 80, duration: 350, easing: cubicOut }}
  >
    <div class="sticky-bar__inner">
      <div class="sticky-bar__info">
        <span class="sticky-bar__eyebrow">Most Popular</span>
        <span class="sticky-bar__headline">
          <span class="sticky-bar__name">{recommendedTier.name}</span>
          <span class="sticky-bar__sep" aria-hidden="true">·</span>
          <span class="sticky-bar__price">
            {formatPrice(tierPrice(recommendedTier))}<small>/{billingInterval === 'month' ? 'mo' : 'yr'}</small>
          </span>
        </span>
        {#if billingInterval === 'year' && recommendedTier.priceAnnual > 0}
          <span class="sticky-bar__helper">
            £{(recommendedTier.priceAnnual / 1200).toFixed(2)}/mo · billed annually
          </span>
        {/if}
      </div>
      <Button onclick={() => handleSubscribe(recommendedTier)}>
        {m.pricing_subscribe()}
      </Button>
      {#if !isMobile}
        <button
          class="sticky-bar__dismiss"
          onclick={() => { dismissedStickyCta = true; }}
          aria-label="Dismiss"
        >
          <XIcon size={14} />
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* ══════════════════════════════════════════════════════════════════
     PRICING PAGE — Luxury Editorial
     Layered glass cards with real depth, brand glow, editorial spacing.
     All values via design tokens. No hardcoded px/hex.
     ══════════════════════════════════════════════════════════════════ */

  .pricing-page {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-16);
    padding: 0 var(--space-6) var(--space-20);
    max-width: 72rem;
    margin: 0 auto;
  }

  @media (--below-md) {
    .pricing-page {
      gap: var(--space-12);
      /* Reserve space for the MobileBottomNav (--space-16) + sticky CTA
         (~--space-16) + breathing room (--space-8) so content above isn't
         hidden when both fixed bars are visible. */
      padding: 0 var(--space-4) calc(var(--space-24) + var(--space-16) + env(safe-area-inset-bottom, 0px));
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     HERO — editorial masthead over brand gradient mesh
     ══════════════════════════════════════════════════════════════════ */

  .pricing-hero {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-8);
    padding: var(--space-20) var(--space-8) var(--space-14);
    text-align: center;
    width: 100%;
    isolation: isolate;
  }

  @media (--below-md) {
    .pricing-hero {
      padding: var(--space-14) var(--space-2) var(--space-10);
      gap: var(--space-6);
    }
  }

  /* Brand gradient mesh + surface wash — fills the whole hero band,
     extends slightly beyond so the glow isn't clipped at the edges. */
  .pricing-hero__backdrop {
    position: absolute;
    inset: calc(-1 * var(--space-4)) calc(-1 * var(--space-8)) 0;
    z-index: -1;
    pointer-events: none;
    border-radius: var(--radius-xl);
    overflow: hidden;
    background:
      radial-gradient(
        ellipse 60% 70% at 18% 12%,
        color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 18%, transparent),
        transparent 62%
      ),
      radial-gradient(
        ellipse 50% 60% at 82% 88%,
        color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 11%, transparent),
        transparent 65%
      ),
      radial-gradient(
        ellipse 80% 60% at 50% 0%,
        color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 7%, transparent),
        transparent 70%
      ),
      linear-gradient(
        180deg,
        color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 4%, var(--color-surface)) 0%,
        var(--color-surface) 100%
      );
  }

  /* Editorial grain — adds a fine texture on top of the gradient.
     Inlined fractalNoise SVG keeps this zero-network-cost. */
  .pricing-hero__backdrop::after {
    content: '';
    position: absolute;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='5'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    opacity: 0.04;
    mix-blend-mode: overlay;
    pointer-events: none;
  }

  .pricing-hero__lede {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    max-width: 44rem;
    width: 100%;
  }

  .pricing-hero__eyebrow {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    text-transform: var(--text-transform-label, uppercase);
    color: var(--color-brand-primary, var(--color-interactive));
    margin: 0;
    opacity: 0;
    transform: translateY(var(--space-2));
  }

  .pricing-hero__rule {
    display: block;
    width: var(--space-16);
    height: var(--border-width);
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 72%, transparent),
      transparent
    );
    opacity: 0;
    transform: scaleX(0.4);
    transform-origin: center;
  }

  .pricing-hero__title {
    font-family: var(--font-heading);
    font-size: clamp(2.5rem, 4vw + 1rem, 4.5rem);
    font-weight: var(--font-bold);
    line-height: var(--leading-none);
    letter-spacing: var(--tracking-tighter);
    color: var(--color-text);
    margin: 0;
    max-width: 18ch;
    text-wrap: balance;
    opacity: 0;
    transform: translateY(var(--space-3));
  }

  .pricing-hero__subtitle {
    font-size: var(--text-xl);
    line-height: var(--leading-snug);
    color: var(--color-text-secondary);
    margin: 0;
    max-width: 46ch;
    text-wrap: pretty;
    opacity: 0;
    transform: translateY(var(--space-3));
  }

  .billing-toggle-wrapper {
    display: inline-flex;
    opacity: 0;
    transform: translateY(var(--space-3));
  }

  @media (prefers-reduced-motion: no-preference) {
    .pricing-hero__eyebrow,
    .pricing-hero__title,
    .pricing-hero__subtitle,
    .billing-toggle-wrapper {
      animation: heroRise var(--duration-slower) var(--ease-smooth) forwards;
    }
    .pricing-hero__rule {
      animation: heroRuleExpand var(--duration-slower) var(--ease-smooth) forwards;
    }
    .pricing-hero__eyebrow        { animation-delay: 40ms; }
    .pricing-hero__rule           { animation-delay: 140ms; }
    .pricing-hero__title          { animation-delay: 200ms; }
    .pricing-hero__subtitle       { animation-delay: 320ms; }
    .billing-toggle-wrapper       { animation-delay: 440ms; }
  }

  @media (prefers-reduced-motion: reduce) {
    .pricing-hero__eyebrow,
    .pricing-hero__rule,
    .pricing-hero__title,
    .pricing-hero__subtitle,
    .billing-toggle-wrapper {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes heroRise {
    from { opacity: 0; transform: translateY(var(--space-3)); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @keyframes heroRuleExpand {
    from { opacity: 0; transform: scaleX(0.4); }
    to   { opacity: 1; transform: scaleX(1); }
  }

  /* ── BILLING TOGGLE ──────────────────────────────────────────────── */

  .billing-toggle {
    position: relative;
    display: inline-flex;
    padding: var(--space-1);
    background: color-mix(in srgb, var(--color-surface) 70%, transparent);
    backdrop-filter: blur(var(--blur-lg));
    -webkit-backdrop-filter: blur(var(--blur-lg));
    border: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-border) 60%, transparent);
    border-radius: var(--radius-full);
    box-shadow:
      var(--shadow-sm),
      inset 0 1px 0 color-mix(in srgb, var(--color-glass-tint, white) 14%, transparent),
      inset 0 -1px 0 color-mix(in srgb, var(--color-glass-tint-dark, black) 3%, transparent);
  }

  .toggle-option {
    position: relative;
    padding: var(--space-2) var(--space-6);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    border: none;
    background: none;
    border-radius: var(--radius-full);
    cursor: pointer;
    transition:
      color var(--duration-normal) var(--ease-default),
      background-color var(--duration-normal) var(--ease-default),
      box-shadow var(--duration-normal) var(--ease-default);
  }

  .toggle-option:hover:not(.active) {
    color: var(--color-text);
  }

  .toggle-option:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .toggle-option.active {
    color: var(--color-text);
    background: linear-gradient(
      180deg,
      color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 8%, var(--color-surface)),
      var(--color-surface)
    );
    box-shadow:
      var(--shadow-sm),
      0 0 0 1px color-mix(in srgb, var(--color-border) 60%, transparent),
      inset 0 1px 0 color-mix(in srgb, var(--color-glass-tint, white) 22%, transparent);
  }

  .savings-pill {
    display: inline-flex;
    align-items: center;
    margin-left: var(--space-2);
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    color: var(--color-success-700);
    background: color-mix(in srgb, var(--color-success-50) 85%, transparent);
    border: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-success-200) 80%, transparent);
    border-radius: var(--radius-full);
    vertical-align: middle;
  }

  @media (prefers-reduced-motion: no-preference) {
    .savings-pill {
      animation: savingsBounce var(--duration-slower) var(--ease-bounce) forwards;
      transform-origin: center;
    }
  }

  @keyframes savingsBounce {
    0%   { opacity: 0; transform: scale(0.5) translateY(var(--space-1)); }
    60%  { opacity: 1; transform: scale(1.06) translateY(0); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
  }

  /* ── TIER STAGE (card grid) ──────────────────────────────────────── */

  .tier-stage {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-6);
    width: 100%;
    padding: 0;
    /* stretch → all cards share the tallest card's height, CTAs align */
    align-items: stretch;
  }

  /* Card inner fills its grid cell so stretch takes effect through the
     visible surface. */
  .card,
  .card__inner {
    height: 100%;
  }

  @media (--breakpoint-sm) {
    .tier-stage {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (--breakpoint-lg) {
    .tier-stage {
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
      gap: var(--space-5);
    }
  }

  /* 1-tier: centered, narrow */
  .tier-stage--single {
    grid-template-columns: minmax(0, 28rem);
    justify-content: center;
    max-width: 28rem;
    margin: 0 auto;
  }
  @media (--breakpoint-sm) {
    .tier-stage--single {
      grid-template-columns: minmax(0, 28rem);
    }
  }

  /* 2-tier: side-by-side, constrained total width */
  .tier-stage--duo {
    grid-template-columns: minmax(0, 1fr);
    max-width: 52rem;
    margin: 0 auto;
  }
  @media (--breakpoint-sm) {
    .tier-stage--duo {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (--breakpoint-lg) {
    .tier-stage--duo {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  /* ── CARD ─────────────────────────────────────────────────────────── */

  .card {
    position: relative;
    width: 100%;
    min-width: 0;
    border-radius: var(--radius-lg);
    opacity: 0;
    transform: translateY(var(--space-6));
  }

  /* Featured card overhangs siblings on side-by-side layouts */
  @media (--breakpoint-sm) {
    .tier-stage:not(.tier-stage--single) .card--featured {
      margin-top: calc(-1 * var(--space-4));
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    .card {
      animation: cardReveal calc(var(--duration-slower) * 1.1) var(--ease-smooth) forwards;
      animation-delay: calc(120ms * var(--card-index));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .card {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes cardReveal {
    from { opacity: 0; transform: translateY(var(--space-6)); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .card__inner {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-8) var(--space-6);
    background: color-mix(in srgb, var(--color-surface) 85%, transparent);
    backdrop-filter: blur(var(--blur-xl));
    -webkit-backdrop-filter: blur(var(--blur-xl));
    border: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
    border-radius: var(--radius-lg);
    box-shadow:
      var(--shadow-lg),
      inset 0 1px 0 color-mix(in srgb, var(--color-glass-tint, white) 10%, transparent),
      inset 0 -1px 0 color-mix(in srgb, var(--color-glass-tint-dark, black) 4%, transparent);
    transition: transform calc(var(--duration-slow) * 1.17) var(--ease-smooth), box-shadow calc(var(--duration-slow) * 1.17);
  }

  .card:hover .card__inner {
    transform: translateY(calc(-1 * var(--space-1)));
    box-shadow:
      var(--shadow-lg),
      0 var(--space-4) var(--space-8) color-mix(in srgb, var(--color-glass-tint-dark, black) 8%, transparent),
      inset 0 1px 0 color-mix(in srgb, var(--color-glass-tint, white) 12%, transparent),
      inset 0 -1px 0 color-mix(in srgb, var(--color-glass-tint-dark, black) 4%, transparent);
  }

  /* ── FEATURED CARD (recommended glow + brand tint) ─────────────── */

  .card--featured .card__inner {
    padding-top: var(--space-10);
    background:
      linear-gradient(
        180deg,
        color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 6%, var(--color-surface)) 0%,
        color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 1%, var(--color-surface)) 55%,
        color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 3%, var(--color-surface)) 100%
      );
    border-color: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 45%, transparent);
    box-shadow:
      var(--shadow-xl),
      0 var(--space-6) var(--space-12) calc(-1 * var(--space-4)) color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 22%, transparent),
      inset 0 1px 0 color-mix(in srgb, var(--color-glass-tint, white) 14%, transparent),
      inset 0 -1px 0 color-mix(in srgb, var(--color-glass-tint-dark, black) 3%, transparent);
  }

  .card--featured:hover .card__inner {
    box-shadow:
      var(--shadow-xl),
      0 var(--space-8) var(--space-16) calc(-1 * var(--space-4)) color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 32%, transparent),
      inset 0 1px 0 color-mix(in srgb, var(--color-glass-tint, white) 18%, transparent),
      inset 0 -1px 0 color-mix(in srgb, var(--color-glass-tint-dark, black) 3%, transparent);
  }

  .card__glow {
    position: absolute;
    inset: calc(-1 * var(--border-width-thick));
    border-radius: calc(var(--radius-lg) + var(--border-width-thick));
    background: conic-gradient(
      from 180deg,
      color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 70%, transparent),
      color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 22%, transparent),
      color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 70%, transparent)
    );
    opacity: 0.55;
    filter: blur(var(--blur-sm));
    z-index: 0;
    animation: glowPulse 3.2s var(--ease-smooth) infinite alternate;
  }

  @media (prefers-reduced-motion: reduce) {
    .card__glow { animation: none; }
  }

  @keyframes glowPulse {
    from { opacity: 0.4; transform: scale(1); }
    to   { opacity: 0.75; transform: scale(1.005); }
  }

  .card--featured:hover .card__glow {
    opacity: 0.9;
    filter: blur(var(--blur-md));
  }

  /* ── FLOATING RIBBON (recommended) ─────────────────────────────── */

  .card__ribbon {
    position: absolute;
    top: calc(-1 * var(--space-3));
    left: 50%;
    transform: translateX(-50%);
    z-index: 2;
    display: inline-flex;
    align-items: center;
    padding: var(--space-1-5, calc(var(--space-1) * 1.5)) var(--space-4);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    text-transform: var(--text-transform-label, uppercase);
    color: var(--color-text-on-brand, white);
    background: linear-gradient(
      180deg,
      color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 92%, white),
      var(--color-brand-primary, var(--color-interactive))
    );
    border: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 60%, transparent);
    border-radius: var(--radius-full);
    box-shadow:
      var(--shadow-md),
      0 var(--space-1) var(--space-4) color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 25%, transparent),
      inset 0 1px 0 color-mix(in srgb, var(--color-glass-tint, white) 25%, transparent);
    white-space: nowrap;
    overflow: hidden;
  }

  /* One-shot diagonal shine after entrance — draws the eye to the
     recommended tier once, then stays quiet. Disabled under reduced motion. */
  @media (prefers-reduced-motion: no-preference) {
    .card__ribbon::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(
        120deg,
        transparent 25%,
        color-mix(in srgb, white 38%, transparent) 50%,
        transparent 75%
      );
      mix-blend-mode: overlay;
      transform: translateX(-160%);
      animation: ribbonShine 2.2s var(--ease-smooth) 1.2s 1 forwards;
      pointer-events: none;
      border-radius: inherit;
    }
  }

  @keyframes ribbonShine {
    to { transform: translateX(160%); }
  }

  /* ── CURRENT PLAN ──────────────────────────────────────────────── */

  .card--current .card__inner {
    border-color: var(--color-interactive);
    border-width: var(--border-width-thick);
  }

  /* ── CARD LABEL (inline pill — current plan only) ──────────────── */

  .card__label {
    display: inline-flex;
    align-self: flex-start;
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    text-transform: var(--text-transform-label, uppercase);
    border-radius: var(--radius-full);
  }

  .card__label--current {
    color: var(--color-interactive);
    background: color-mix(in srgb, var(--color-interactive) 10%, var(--color-surface));
    border: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-interactive) 20%, transparent);
  }

  /* ── CARD CONTENT ──────────────────────────────────────────────── */

  .card__header {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .card__name {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tight);
  }

  .card__desc {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-snug);
    margin: 0;
    text-wrap: pretty;
    /* Cap at 3 lines so cards stay visually balanced regardless of
       creator copy length. Tier descriptions should be concise by design. */
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* ── PRICING (editorial stack) ────────────────────────────────── */

  .card__pricing {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-1) 0;
  }

  .card__price-row {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--space-2);
    row-gap: var(--space-1);
  }

  .card__price-amount {
    font-family: var(--font-heading);
    font-size: clamp(2.25rem, 2vw + 1.5rem, 3rem);
    font-weight: var(--font-bold);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
    line-height: var(--leading-none);
    letter-spacing: var(--tracking-tighter);
  }

  /* Featured tier: price amount in brand color for visual anchor */
  .card--featured .card__price-amount {
    color: var(--color-brand-primary, var(--color-interactive));
  }

  .card__price-interval {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    letter-spacing: var(--tracking-tight);
  }

  .card__price-save {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    color: var(--color-success-700);
    background: color-mix(in srgb, var(--color-success-50) 85%, transparent);
    border: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-success-200) 80%, transparent);
    border-radius: var(--radius-full);
    font-variant-numeric: tabular-nums;
  }

  .card__price-helper {
    display: inline-block;
    margin-top: var(--space-1);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    letter-spacing: var(--tracking-tight);
  }

  /* ── FEATURES (hairlined list) ────────────────────────────────── */

  .card__features {
    display: flex;
    flex-direction: column;
    list-style: none;
    padding: var(--space-2) 0 0;
    margin: 0;
    border-top: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-border) 50%, transparent);
    flex: 1;
  }

  .card__features li {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    color: var(--color-text-secondary);
    border-bottom: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-border) 35%, transparent);
  }

  .card__features li:last-child {
    border-bottom: none;
  }

  .card__feature-icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 12%, transparent);
    color: var(--color-brand-primary, var(--color-interactive));
    margin-top: calc(-1 * var(--space-0-5));
  }

  .card--featured .card__feature-icon {
    background: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 20%, transparent);
  }

  .card__features li :global(svg) {
    flex-shrink: 0;
  }

  .card__action {
    margin-top: auto;
  }

  :global(.tier-cta) {
    width: 100%;
  }

  @media (prefers-reduced-motion: no-preference) {
    :global(.tier-cta:active) {
      transform: scale(0.96);
      transition: transform 80ms;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     SCROLL REVEAL — shared by below-fold sections (preview, faq, trust)
     Toggled via [data-reveal] + .reveal--visible (added by JS observer).
     ══════════════════════════════════════════════════════════════════ */

  .reveal {
    opacity: 0;
    transform: translateY(var(--space-5));
    transition:
      opacity var(--duration-slower) var(--ease-smooth),
      transform var(--duration-slower) var(--ease-smooth);
  }

  :global(.reveal.reveal--visible) {
    opacity: 1;
    transform: translateY(0);
  }

  /* Child-rule scale-expand — echoes the hero's heroRuleExpand,
     delayed slightly so the section lifts first, then the rule draws. */
  .reveal .preview__rule,
  .reveal .faq__rule,
  .reveal .trust__rule {
    transform: scaleX(0.3);
    transform-origin: center;
    transition: transform var(--duration-slower) var(--ease-smooth) 150ms;
  }

  :global(.reveal.reveal--visible) .preview__rule,
  :global(.reveal.reveal--visible) .faq__rule,
  :global(.reveal.reveal--visible) .trust__rule {
    transform: scaleX(1);
  }

  @media (prefers-reduced-motion: reduce) {
    .reveal {
      opacity: 1;
      transform: none;
    }
    .reveal .preview__rule,
    .reveal .faq__rule,
    .reveal .trust__rule {
      transform: none;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     CONTENT PREVIEW — editorial magazine spread
     ══════════════════════════════════════════════════════════════════ */

  .preview {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
  }

  /* Masthead */
  .preview__lede {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    text-align: center;
    max-width: 44rem;
    margin: 0 auto;
  }

  .preview__eyebrow {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    text-transform: var(--text-transform-label, uppercase);
    color: var(--color-brand-primary, var(--color-interactive));
    margin: 0;
  }

  .preview__rule {
    display: block;
    width: var(--space-16);
    height: var(--border-width);
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 72%, transparent),
      transparent
    );
  }

  .preview__title {
    font-family: var(--font-heading);
    font-size: clamp(1.75rem, 2.5vw + 1rem, 2.75rem);
    font-weight: var(--font-bold);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tighter);
    color: var(--color-text);
    margin: 0;
    max-width: 20ch;
    text-wrap: balance;
  }

  .preview__subtitle {
    font-size: var(--text-base);
    line-height: var(--leading-snug);
    color: var(--color-text-secondary);
    margin: 0;
    max-width: 48ch;
    text-wrap: pretty;
  }

  /* Magazine spread — base + count-adaptive variants (solo/pair/trio/magazine).
     Default is the 4-tile magazine layout; narrower variants keep the editorial
     feel at sparse-content orgs without looking underfilled. */
  .preview__spread {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
    border-radius: var(--radius-lg);
    overflow: hidden;
    box-shadow: var(--shadow-md);
  }

  /* Solo (1 tile): single cinematic hero */
  .preview__spread--solo {
    grid-template-columns: 1fr;
  }
  .preview__spread--solo .preview__tile--0 {
    aspect-ratio: 16 / 9;
  }

  /* Trio (3 tiles): mobile = 1 wide hero + 2 side-by-side below */
  .preview__spread--trio .preview__tile--0 {
    grid-column: 1 / -1;
    aspect-ratio: 16 / 9;
  }

  /* md+: full magazine layouts */
  @media (--breakpoint-md) {
    .preview__spread--magazine {
      grid-template-columns: 1.8fr 1fr;
      grid-template-rows: repeat(3, 1fr);
      aspect-ratio: 5 / 2.4;
      gap: var(--space-1);
    }
    .preview__spread--magazine .preview__tile--0 { grid-column: 1; grid-row: 1 / 4; }
    .preview__spread--magazine .preview__tile--1 { grid-column: 2; grid-row: 1; }
    .preview__spread--magazine .preview__tile--2 { grid-column: 2; grid-row: 2; }
    .preview__spread--magazine .preview__tile--3 { grid-column: 2; grid-row: 3; }

    .preview__spread--solo {
      grid-template-columns: 1fr;
      aspect-ratio: 16 / 7;
      gap: 0;
    }
    .preview__spread--solo .preview__tile--0 {
      aspect-ratio: auto;
    }

    .preview__spread--pair {
      grid-template-columns: 1fr 1fr;
      aspect-ratio: 16 / 7;
      gap: var(--space-1);
    }

    .preview__spread--trio {
      grid-template-columns: 1.8fr 1fr;
      grid-template-rows: repeat(2, 1fr);
      aspect-ratio: 5 / 3;
      gap: var(--space-1);
    }
    .preview__spread--trio .preview__tile--0 {
      grid-column: 1;
      grid-row: 1 / 3;
      aspect-ratio: auto;
    }
    .preview__spread--trio .preview__tile--1 { grid-column: 2; grid-row: 1; }
    .preview__spread--trio .preview__tile--2 { grid-column: 2; grid-row: 2; }
  }

  .preview__tile {
    position: relative;
    overflow: hidden;
    aspect-ratio: 4 / 3;
    border-radius: var(--radius-sm);
  }

  @media (--breakpoint-md) {
    .preview__tile {
      aspect-ratio: auto;
      border-radius: 0;
    }
  }

  .preview__tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: blur(var(--blur-sm)) saturate(0.85);
    transform: scale(1.08);
    transition:
      filter calc(var(--duration-slower) * 1.2) var(--ease-smooth),
      transform calc(var(--duration-slower) * 1.2) var(--ease-smooth);
  }

  /* Hero tile: lighter blur so the composition reads */
  .preview__tile--0 img {
    filter: blur(calc(var(--blur-sm) / 2)) saturate(0.92);
  }

  .preview__tile:hover img {
    filter: blur(calc(var(--blur-sm) / 2)) saturate(1);
    transform: scale(1.1);
  }

  .preview__tile--0:hover img {
    filter: blur(1px) saturate(1);
  }

  .preview__tile-shade {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(
      180deg,
      transparent 0%,
      transparent 42%,
      color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 18%, black) 100%
    );
    opacity: 0.55;
    mix-blend-mode: multiply;
  }

  .preview__badge {
    position: absolute;
    top: var(--space-3);
    right: var(--space-3);
    display: inline-flex;
    align-items: center;
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    text-transform: var(--text-transform-label, uppercase);
    color: white;
    background: color-mix(in srgb, black 40%, transparent);
    backdrop-filter: blur(var(--blur-md));
    -webkit-backdrop-filter: blur(var(--blur-md));
    border: var(--border-width) var(--border-style) color-mix(in srgb, white 28%, transparent);
    border-radius: var(--radius-full);
    z-index: 2;
  }

  /* Hero tile title — gives one concrete piece of content a name,
     while supporting tiles stay as teaser-blurs. Signal over noise. */
  .preview__tile-title {
    position: absolute;
    left: var(--space-5);
    right: var(--space-5);
    bottom: var(--space-4);
    z-index: 2;
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: white;
    letter-spacing: var(--tracking-tight);
    line-height: var(--leading-snug);
    text-shadow:
      0 var(--border-width) var(--space-2) color-mix(in srgb, black 70%, transparent),
      0 0 var(--space-1) color-mix(in srgb, black 50%, transparent);
    text-wrap: balance;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    pointer-events: none;
    max-width: 22ch;
  }

  @media (--below-md) {
    .preview__tile-title {
      font-size: var(--text-base);
      left: var(--space-3);
      right: var(--space-3);
      bottom: var(--space-3);
    }
  }

  /* Footer: stats → categories → CTA */
  .preview__footer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-6);
    padding: 0 var(--space-2);
  }

  .preview__stats {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: var(--space-8);
    padding: var(--space-6) 0;
    width: 100%;
    max-width: 40rem;
    border-top: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-border) 50%, transparent);
    border-bottom: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-border) 50%, transparent);
  }

  @media (--below-sm) {
    .preview__stats {
      gap: var(--space-4);
    }
  }

  .preview__stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    text-align: center;
  }

  .preview__stat-number {
    font-family: var(--font-heading);
    font-size: clamp(1.75rem, 2vw + 1rem, 2.5rem);
    font-weight: var(--font-bold);
    color: var(--color-text);
    line-height: var(--leading-none);
    letter-spacing: var(--tracking-tighter);
    font-variant-numeric: tabular-nums;
  }

  .preview__stat-label {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    text-transform: var(--text-transform-label, uppercase);
    color: var(--color-text-secondary);
  }

  .preview__categories {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2);
    list-style: none;
    padding: 0;
    margin: 0;
    max-width: 44rem;
  }

  .preview__categories li {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    background: color-mix(in srgb, var(--color-surface-secondary) 70%, transparent);
    border: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-border) 40%, transparent);
    border-radius: var(--radius-full);
    letter-spacing: var(--tracking-wide);
    text-transform: capitalize;
  }

  .preview__cta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-5);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    /* Hover variant = brand color with -0.08L OKLCH — darker for legibility
       on light surfaces without abandoning brand identity. */
    color: var(--color-brand-primary-hover, var(--color-interactive-hover, var(--color-brand-primary)));
    background: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 10%, var(--color-surface));
    border: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 30%, transparent);
    border-radius: var(--radius-full);
    text-decoration: none;
    transition:
      background-color var(--duration-normal) var(--ease-default),
      border-color var(--duration-normal) var(--ease-default),
      box-shadow var(--duration-normal) var(--ease-default);
  }

  .preview__cta:hover {
    background: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 12%, var(--color-surface));
    border-color: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 45%, transparent);
    box-shadow:
      0 var(--space-1) var(--space-4) color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 22%, transparent);
  }

  .preview__cta:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .preview__cta-arrow {
    display: inline-flex;
    transition: transform var(--duration-normal) var(--ease-spring);
  }

  .preview__cta:hover .preview__cta-arrow {
    transform: translateX(var(--space-1));
  }

  /* ══════════════════════════════════════════════════════════════════
     FAQ — editorial single column with brand-indicator accordion
     ══════════════════════════════════════════════════════════════════ */

  .faq {
    width: 100%;
    max-width: 48rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .faq__lede {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    text-align: center;
    max-width: 44rem;
    margin: 0 auto;
  }

  .faq__eyebrow {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    text-transform: var(--text-transform-label, uppercase);
    color: var(--color-brand-primary, var(--color-interactive));
    margin: 0;
  }

  .faq__rule {
    display: block;
    width: var(--space-16);
    height: var(--border-width);
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 72%, transparent),
      transparent
    );
  }

  .faq__title {
    font-family: var(--font-heading);
    font-size: clamp(1.75rem, 2.5vw + 1rem, 2.75rem);
    font-weight: var(--font-bold);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tighter);
    color: var(--color-text);
    margin: 0;
    max-width: 20ch;
    text-wrap: balance;
  }

  .faq__subtitle {
    font-size: var(--text-base);
    line-height: var(--leading-snug);
    color: var(--color-text-secondary);
    margin: 0;
    max-width: 48ch;
    text-wrap: pretty;
  }

  .faq__list {
    width: 100%;
    border-top: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-border) 50%, transparent);
  }

  /* ── Accordion overrides ─────────────────────────────────────────
     Targets the inner components (scoped to their own files).
     Svelte hashes `.faq__list`; inner descendants must be :global(). */

  .faq__list :global(.accordion-item) {
    border-bottom: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-border) 50%, transparent);
  }

  .faq__list :global(.accordion-item:last-child) {
    border-bottom: none;
  }

  .faq__list :global(.accordion-header) {
    position: relative;
  }

  .faq__list :global(.accordion-trigger) {
    position: relative;
    padding: var(--space-5) var(--space-4) var(--space-5) var(--space-6);
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    line-height: var(--leading-snug);
    color: var(--color-text);
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    transition:
      color var(--duration-normal) var(--ease-default),
      background-color var(--duration-normal) var(--ease-default);
  }

  .faq__list :global(.accordion-trigger:hover) {
    color: var(--color-brand-primary, var(--color-interactive));
    text-decoration: none;
    background: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 4%, transparent);
  }

  .faq__list :global(.accordion-trigger:focus-visible) {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .faq__list :global(.accordion-trigger[aria-expanded="true"]) {
    color: var(--color-brand-primary, var(--color-interactive));
  }

  /* Left-edge brand indicator — fills in on hover, stays lit when open.
     Pseudo-element stays outside :global() per Svelte's selector parser. */
  .faq__list :global(.accordion-trigger)::before {
    content: '';
    position: absolute;
    top: 50%;
    left: var(--space-2);
    width: var(--border-width-thick);
    height: 0;
    background: var(--color-brand-primary, var(--color-interactive));
    border-radius: var(--radius-full);
    transform: translateY(-50%);
    transition: height var(--duration-normal) var(--ease-smooth);
  }

  .faq__list :global(.accordion-trigger):hover::before {
    height: 45%;
  }

  .faq__list :global(.accordion-trigger[aria-expanded="true"])::before {
    height: 70%;
  }

  .faq__list :global(.accordion-chevron) {
    color: var(--color-brand-primary, var(--color-interactive));
    opacity: 1;
    height: var(--space-4);
    width: var(--space-4);
    transition: transform var(--duration-normal) var(--ease-spring);
  }

  .faq__list :global(.accordion-content) {
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .faq__list :global(.accordion-content-inner) {
    padding: var(--space-1) var(--space-4) var(--space-5) var(--space-6);
    max-width: 44rem;
  }

  .faq__list :global(.accordion-content-inner p) {
    margin: 0;
    text-wrap: pretty;
  }

  /* ══════════════════════════════════════════════════════════════════
     TRUST STRIP — editorial coda
     Short brand rule on top, tinted icon circles, brand-colored dots
     between signals. Rhymes with the section mastheads above.
     ══════════════════════════════════════════════════════════════════ */

  .trust {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-6);
  }

  .trust__rule {
    display: block;
    width: var(--space-16);
    height: var(--border-width);
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 72%, transparent),
      transparent
    );
  }

  .trust__signals {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: var(--space-3) var(--space-5);
    padding: 0 var(--space-4);
    max-width: 42rem;
  }

  .trust__signal {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    white-space: nowrap;
  }

  .trust__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-5);
    height: var(--space-5);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 10%, transparent);
    color: var(--color-brand-primary, var(--color-interactive));
    flex-shrink: 0;
  }

  .trust__icon :global(svg) {
    flex-shrink: 0;
  }

  .trust__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    letter-spacing: var(--tracking-tight);
  }

  .trust__dot {
    display: inline-block;
    width: var(--space-1);
    height: var(--space-1);
    border-radius: var(--radius-full);
    background: color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 45%, transparent);
    flex-shrink: 0;
  }

  @media (--below-sm) {
    .trust__signals {
      flex-direction: column;
      gap: var(--space-3);
    }
    .trust__dot {
      display: none;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     STICKY BAR — floating pill (desktop) / full-bleed bar (mobile)
     ══════════════════════════════════════════════════════════════════ */

  .sticky-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    /* --z-fixed (1030) so the sticky layer beats the org-footer's backdrop-filter
       compositing layer, which would otherwise paint above it in Chrome despite
       our z-index being higher than the footer's (auto → 0) — a known
       backdrop-filter stacking quirk. */
    z-index: var(--z-fixed, 1030);
    pointer-events: none;
    display: flex;
    justify-content: center;
    padding: var(--space-3) var(--space-4);
    padding-bottom: calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
    isolation: isolate;
  }

  .sticky-bar__inner {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    max-width: 44rem;
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-5);
    background: color-mix(in srgb, var(--color-surface) 88%, transparent);
    backdrop-filter: blur(var(--blur-xl));
    -webkit-backdrop-filter: blur(var(--blur-xl));
    border: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-border) 60%, transparent);
    border-radius: var(--radius-full);
    box-shadow:
      var(--shadow-xl),
      0 var(--space-4) var(--space-12) calc(-1 * var(--space-2)) color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 18%, transparent),
      inset 0 1px 0 color-mix(in srgb, var(--color-glass-tint, white) 16%, transparent),
      inset 0 -1px 0 color-mix(in srgb, var(--color-glass-tint-dark, black) 2%, transparent);
  }

  /* Mobile: full-bleed bar sitting ABOVE the MobileBottomNav (64px tall).
     Without this offset the nav covers the sticky — both are position:fixed
     at z-index: 1030 with same DOM order tie-break won by the nav. */
  .sticky-bar--mobile {
    bottom: var(--space-16);
    padding: 0;
    padding-bottom: 0;
  }

  .sticky-bar--mobile .sticky-bar__inner {
    max-width: 100%;
    padding: var(--space-3) var(--space-4);
    border-radius: 0;
    border-left: none;
    border-right: none;
    border-bottom: none;
    box-shadow:
      0 calc(-1 * var(--space-2)) var(--space-6) color-mix(in srgb, var(--color-glass-tint-dark, black) 6%, transparent),
      inset 0 1px 0 color-mix(in srgb, var(--color-glass-tint, white) 12%, transparent);
  }

  .sticky-bar__info {
    display: flex;
    flex-direction: column;
    gap: 0;
    flex: 1;
    min-width: 0;
  }

  .sticky-bar__eyebrow {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    text-transform: var(--text-transform-label, uppercase);
    color: var(--color-brand-primary, var(--color-interactive));
    line-height: var(--leading-tight);
  }

  .sticky-bar__headline {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    margin-top: var(--space-0-5);
    flex-wrap: wrap;
    min-width: 0;
  }

  .sticky-bar__name {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    letter-spacing: var(--tracking-tight);
    line-height: var(--leading-none);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 16ch;
  }

  .sticky-bar__sep {
    color: var(--color-text-muted);
    opacity: 0.5;
    line-height: var(--leading-none);
  }

  .sticky-bar__price {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-bold);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
    letter-spacing: var(--tracking-tight);
    line-height: var(--leading-none);
  }

  .sticky-bar__price small {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
    margin-left: var(--space-0-5);
  }

  .sticky-bar__helper {
    margin-top: var(--space-0-5);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
    letter-spacing: var(--tracking-tight);
    line-height: var(--leading-tight);
  }

  .sticky-bar__dismiss {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    border: none;
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    border-radius: var(--radius-full);
    flex-shrink: 0;
    transition:
      color var(--duration-normal) var(--ease-default),
      background-color var(--duration-normal) var(--ease-default),
      transform var(--duration-normal) var(--ease-default);
  }

  .sticky-bar__dismiss:hover {
    color: var(--color-text);
    background-color: color-mix(in srgb, var(--color-text) 6%, transparent);
    transform: rotate(90deg);
  }

  .sticky-bar__dismiss:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  @media (prefers-reduced-motion: reduce) {
    .sticky-bar__dismiss:hover {
      transform: none;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     CHECKOUT ERROR — editorial alert, not a flat banner
     ══════════════════════════════════════════════════════════════════ */

  .checkout-error {
    width: 100%;
    max-width: 44rem;
    margin: 0 auto;
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-4) var(--space-4) var(--space-3);
    background: color-mix(in srgb, var(--color-error-50) 92%, var(--color-surface));
    border: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-error-200) 85%, transparent);
    border-left: var(--border-width-thick) var(--border-style) var(--color-error-600);
    border-radius: var(--radius-md);
    box-shadow:
      var(--shadow-sm),
      inset 0 1px 0 color-mix(in srgb, var(--color-glass-tint, white) 20%, transparent);
  }

  .checkout-error__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    flex-shrink: 0;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-error-100) 80%, transparent);
    color: var(--color-error-600);
    margin-top: calc(-1 * var(--space-0-5));
  }

  .checkout-error__body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .checkout-error__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-error-700);
    letter-spacing: var(--tracking-tight);
    line-height: var(--leading-tight);
  }

  .checkout-error__message {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-error-700);
    line-height: var(--leading-snug);
    text-wrap: pretty;
    opacity: 0.9;
  }

  .checkout-error__dismiss {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-7);
    height: var(--space-7);
    flex-shrink: 0;
    border: none;
    background: none;
    color: var(--color-error-600);
    cursor: pointer;
    border-radius: var(--radius-full);
    transition:
      color var(--duration-normal) var(--ease-default),
      background-color var(--duration-normal) var(--ease-default),
      transform var(--duration-normal) var(--ease-default);
  }

  .checkout-error__dismiss:hover {
    color: var(--color-error-700);
    background: color-mix(in srgb, var(--color-error-100) 90%, transparent);
    transform: rotate(90deg);
  }

  .checkout-error__dismiss:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring-error);
  }

  @media (prefers-reduced-motion: reduce) {
    .checkout-error__dismiss:hover {
      transform: none;
    }
  }

  /* ── SKELETON ─────────────────────────────────────────────────────── */

  .card-shell {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-8) var(--space-6);
    background: color-mix(in srgb, var(--color-surface) 85%, transparent);
    backdrop-filter: blur(var(--blur-xl));
    -webkit-backdrop-filter: blur(var(--blur-xl));
    border: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-border) 60%, transparent);
    border-radius: var(--radius-lg);
    box-shadow:
      var(--shadow-md),
      inset 0 1px 0 color-mix(in srgb, var(--color-glass-tint, white) 10%, transparent);
    opacity: 0;
    animation: cardReveal calc(var(--duration-slower) * 1.1) var(--ease-smooth) forwards;
    animation-delay: calc(120ms * var(--card-index));
  }

  /* Middle shell hints at the featured tier — matches card--featured tint */
  .card-shell--featured {
    padding-top: var(--space-10);
    background: linear-gradient(
      180deg,
      color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 6%, var(--color-surface)),
      color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 1%, var(--color-surface))
    );
    border-color: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 30%, transparent);
  }

  .card-shell__features {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-2) 0 0;
    margin-top: var(--space-2);
    border-top: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-border) 40%, transparent);
    flex: 1;
  }

  .card-shell__feature {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .card-shell { opacity: 1; animation: none; }
  }

  .skeleton {
    background: linear-gradient(
      90deg,
      var(--color-surface-secondary) 25%,
      color-mix(in srgb, var(--color-surface-secondary) 60%, var(--color-surface)) 50%,
      var(--color-surface-secondary) 75%
    );
    background-size: 200% 100%;
    animation: shimmer calc(var(--duration-slower) * 3.6) ease-in-out infinite;
    border-radius: var(--radius-sm);
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton { animation: none; }
  }

  .skeleton--title         { width: 50%; height: var(--space-6); }
  .skeleton--desc          { width: 80%; height: var(--space-4); }
  .skeleton--price         { width: 45%; height: var(--space-10); }
  .skeleton--helper        { width: 60%; height: var(--space-3); }
  .skeleton--feature       { flex: 1; height: var(--space-3); }
  .skeleton--feature-icon  {
    width: var(--space-6);
    height: var(--space-6);
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }
  .skeleton--cta           { width: 100%; height: var(--space-12); margin-top: auto; border-radius: var(--radius-md); }

  @keyframes shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* ══════════════════════════════════════════════════════════════════
     BACKDROP-FILTER FALLBACK — for browsers without support
     ══════════════════════════════════════════════════════════════════ */

  @supports not (backdrop-filter: blur(1px)) {
    .card__inner,
    .card-shell,
    .billing-toggle,
    .sticky-bar__inner {
      background: var(--color-surface);
    }
    .card--featured .card__inner,
    .card-shell--featured {
      background: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 6%, var(--color-surface));
    }
    .preview__badge {
      background: color-mix(in srgb, black 70%, transparent);
    }
  }
</style>

<script lang="ts">
  import { page } from '$app/state';
  import { onMount, untrack } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import * as m from '$paraglide/messages';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import { Badge, EmptyState } from '$lib/components/ui';
  import {
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

  // ── FAQ ────────────────────────────────────────────────────────────
  const DEFAULT_FAQ: PricingFaqItem[] = [
    {
      id: 'default-cancel',
      question: 'Can I cancel my subscription at any time?',
      answer:
        'Yes, you can cancel your subscription at any time from your account settings. Your access will continue until the end of your current billing period.',
      order: 0,
    },
    {
      id: 'default-payment',
      question: 'What payment methods do you accept?',
      answer:
        'We accept all major credit and debit cards including Visa, Mastercard, and American Express. All payments are processed securely through Stripe.',
      order: 1,
    },
    {
      id: 'default-access',
      question: 'Do I get instant access after subscribing?',
      answer:
        'Yes, you get immediate access to all content included in your subscription tier as soon as your payment is confirmed.',
      order: 2,
    },
    {
      id: 'default-change-plan',
      question: 'Can I change my plan later?',
      answer:
        'Absolutely. You can upgrade or downgrade your subscription tier at any time. Changes take effect at the start of your next billing period.',
      order: 3,
    },
  ];

  let faqItems = $state<PricingFaqItem[]>(DEFAULT_FAQ);

  // ── Sticky CTA ────────────────────────────────────────────────────
  let tierCardsRef = $state<HTMLElement | null>(null);
  let previewRef = $state<HTMLElement | null>(null);
  let showStickyCta = $state(false);
  let dismissedStickyCta = $state(false);
  let isMobile = $state(false);

  const showMobileStickyCta = $derived(
    isMobile && tiers.length > 0 && !pricingLoading && !currentTierId
  );
  const showDesktopStickyCta = $derived(
    !isMobile && showStickyCta && !dismissedStickyCta
  );
  const stickyVisible = $derived(showMobileStickyCta || showDesktopStickyCta);

  // ── Helpers ────────────────────────────────────────────────────────
  function savingsPercent(tier: SubscriptionTier): number {
    const monthlyTotal = tier.priceMonthly * 12;
    if (monthlyTotal <= 0) return 0;
    return Math.round(((monthlyTotal - tier.priceAnnual) / monthlyTotal) * 100);
  }

  function tierPrice(tier: SubscriptionTier): number {
    return billingInterval === 'month' ? tier.priceMonthly : tier.priceAnnual;
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

    let observer: IntersectionObserver | undefined;
    const setupObserver = () => {
      if (tierCardsRef) {
        observer = new IntersectionObserver(
          ([entry]) => {
            if (!isMobile) {
              showStickyCta = !entry.isIntersecting && !dismissedStickyCta;
            }
          },
          { threshold: 0 }
        );
        observer.observe(tierCardsRef);
      }
    };

    const unwatch = $effect.root(() => {
      $effect(() => {
        if (!pricingLoading && tierCardsRef) {
          setupObserver();
        }
      });
    });

    let previewObserver: IntersectionObserver | undefined;
    const unwatchPreview = $effect.root(() => {
      $effect(() => {
        if (previewRef && !previewObserver) {
          previewObserver = new IntersectionObserver(
            ([entry]) => {
              if (entry.isIntersecting) {
                entry.target.classList.add('preview-visible');
                previewObserver?.disconnect();
              }
            },
            { threshold: 0.2 }
          );
          previewObserver.observe(previewRef);
        }
      });
    });

    return () => {
      mq.removeEventListener('change', handleMq);
      observer?.disconnect();
      previewObserver?.disconnect();
      unwatch();
      unwatchPreview();
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
        <div class="billing-toggle" role="radiogroup" aria-label="Billing period">
          <button
            class="toggle-option"
            class:active={billingInterval === 'month'}
            onclick={() => { billingInterval = 'month'; }}
            role="radio"
            aria-checked={billingInterval === 'month'}
          >
            {m.pricing_monthly()}
          </button>
          <button
            class="toggle-option"
            class:active={billingInterval === 'year'}
            onclick={() => { billingInterval = 'year'; }}
            role="radio"
            aria-checked={billingInterval === 'year'}
          >
            {m.pricing_annual()}
            {#if billingInterval === 'year'}
              <span class="savings-pill">Save 20%</span>
            {/if}
          </button>
        </div>
      </div>
    </section>

    <!-- ═══ TIER CARDS ═══ -->
    {#if checkoutError}
      <div class="checkout-error" role="alert">
        <p>{checkoutError}</p>
      </div>
    {/if}

    {#if pricingLoading}
      <div class="tier-stage">
        {#each Array(2) as _, i}
          <div class="card-shell" style="--card-index: {i}">
            <div class="skeleton skeleton--badge"></div>
            <div class="skeleton skeleton--title"></div>
            <div class="skeleton skeleton--desc"></div>
            <div class="skeleton skeleton--price"></div>
            <div class="skeleton skeleton--feature"></div>
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
            <!-- Glow layer for recommended -->
            {#if isRecommended && !isCurrentPlan}
              <div class="card__glow" aria-hidden="true"></div>
            {/if}

            <div class="card__inner">
              {#if isRecommended && !isCurrentPlan}
                <span class="card__label card__label--popular">Most Popular</span>
              {/if}
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
                <span class="card__amount">{formatPrice(tierPrice(tier))}</span>
                <span class="card__interval">
                  /{billingInterval === 'month' ? m.pricing_per_month() : m.pricing_per_year()}
                </span>
              </div>

              {#if billingInterval === 'year' && savings > 0}
                <div class="card__savings">
                  {m.pricing_save_percent({ percent: savings.toString() })}
                </div>
              {/if}

              <ul class="card__features">
                <li>
                  <CheckIcon size={14} />
                  {m.pricing_all_tier_content({ tierName: tier.name })}
                </li>
                <li>
                  <CheckIcon size={14} />
                  Cancel anytime
                </li>
                <li>
                  <CheckIcon size={14} />
                  Instant access
                </li>
              </ul>

              <div class="card__action">
                {#if isCurrentPlan}
                  <Button variant="secondary" disabled class="tier-cta">
                    {m.pricing_current_plan()}
                  </Button>
                {:else}
                  <Button
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
      {#if withThumbs.length >= 3}
        <section class="content-preview" bind:this={previewRef}>
          <div class="preview-grid">
            {#each withThumbs.slice(0, 6) as item}
              <div class="preview-thumb">
                <img src={item.thumbnailUrl} alt="" loading="lazy" />
              </div>
            {/each}
          </div>
          <div class="preview-overlay">
            {#await data.stats then stats}
              <p class="preview-text">
                <strong>{stats?.content?.total ?? items.length}</strong> pieces of exclusive content
              </p>
            {/await}
            <a href="/explore" class="preview-cta">Browse the library</a>
          </div>
        </section>
      {/if}
    {/await}

    <!-- ═══ FAQ ═══ -->
    <section class="faq-section">
      <h2 class="section-heading">Frequently Asked Questions</h2>
      <div class="faq-container">
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
    <footer class="trust-bar">
      <span class="trust-signal">
        <CheckCircleIcon size={14} />
        <span>Cancel anytime</span>
      </span>
      <span class="trust-divider" aria-hidden="true"></span>
      <span class="trust-signal">
        <LockIcon size={14} />
        <span>Secure checkout</span>
      </span>
      <span class="trust-divider" aria-hidden="true"></span>
      <span class="trust-signal">
        <CheckIcon size={14} />
        <span>Instant access</span>
      </span>
    </footer>
  {/if}
</div>

<!-- ═══ STICKY CTA ═══ -->
{#if stickyVisible && recommendedTier}
  <div
    class="sticky-bar"
    transition:fly={{ y: 60, duration: 300, easing: cubicOut }}
  >
    <div class="sticky-bar__inner">
      <div class="sticky-bar__info">
        <span class="sticky-bar__name">{recommendedTier.name}</span>
        <span class="sticky-bar__price">{formatPrice(tierPrice(recommendedTier))}<small>/{billingInterval === 'month' ? 'mo' : 'yr'}</small></span>
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
      padding: 0 var(--space-4) calc(var(--space-20) + env(safe-area-inset-bottom, 0px));
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
      color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 55%, transparent),
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
    color: var(--color-text-muted);
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
    color: var(--color-text-secondary);
  }

  .toggle-option:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
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
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-6);
    width: 100%;
    padding: 0 var(--space-2);
  }

  .tier-stage--single {
    max-width: 400px;
  }

  /* ── CARD ─────────────────────────────────────────────────────────── */

  .card {
    position: relative;
    flex: 1 1 320px;
    max-width: 420px;
    min-width: 280px;
    border-radius: var(--radius-lg);
    opacity: 0;
    transform: translateY(var(--space-6));
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

  /* ── FEATURED CARD (recommended glow) ──────────────────────────── */

  .card--featured .card__inner {
    border-color: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 40%, transparent);
  }

  .card__glow {
    position: absolute;
    inset: -2px;
    border-radius: calc(var(--radius-lg) + 2px);
    background: conic-gradient(
      from 180deg,
      color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 60%, transparent),
      color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 20%, transparent),
      color-mix(in oklch, var(--color-brand-primary, var(--color-interactive)) 60%, transparent)
    );
    opacity: var(--opacity-70);
    filter: blur(var(--blur-sm));
    z-index: 0;
    animation: glowPulse 3s ease-in-out infinite alternate;
  }

  @media (prefers-reduced-motion: reduce) {
    .card__glow { animation: none; }
  }

  @keyframes glowPulse {
    from { opacity: 0.5; }
    to   { opacity: 0.8; }
  }

  .card--featured:hover .card__glow {
    opacity: 1;
    filter: blur(var(--blur-md));
  }

  /* Featured card is slightly scaled up in multi-card layouts */
  .tier-stage--duo .card--featured {
    flex: 1 1 340px;
  }
  .tier-stage--duo .card--featured .card__inner {
    padding: var(--space-10) var(--space-8);
  }

  /* ── CURRENT PLAN ──────────────────────────────────────────────── */

  .card--current .card__inner {
    border-color: var(--color-interactive);
    border-width: var(--border-width-thick);
  }

  /* ── CARD LABEL (badge) ────────────────────────────────────────── */

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

  .card__label--popular {
    color: var(--color-brand-primary, var(--color-interactive));
    background: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 12%, var(--color-surface));
    border: 1px solid color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 25%, transparent);
  }

  .card__label--current {
    color: var(--color-interactive);
    background: color-mix(in srgb, var(--color-interactive) 10%, var(--color-surface));
    border: 1px solid color-mix(in srgb, var(--color-interactive) 20%, transparent);
  }

  /* ── CARD CONTENT ──────────────────────────────────────────────── */

  .card__header {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .card__name {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
    letter-spacing: var(--tracking-normal);
  }

  .card__desc {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
    margin: 0;
  }

  .card__pricing {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
    padding: var(--space-2) 0;
  }

  .card__amount {
    font-size: var(--text-4xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    letter-spacing: var(--tracking-tighter);
  }

  .card__interval {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .card__savings {
    display: inline-flex;
    align-self: flex-start;
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-success-600);
    background-color: var(--color-success-50);
    border-radius: var(--radius-full);
  }

  .card__features {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    list-style: none;
    padding: var(--space-4) 0;
    margin: 0;
    border-top: 1px solid color-mix(in srgb, var(--color-border) 50%, transparent);
    flex: 1;
  }

  .card__features li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .card__features li :global(svg) {
    flex-shrink: 0;
    color: var(--color-brand-primary, var(--color-interactive));
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

  /* ── CONTENT PREVIEW ─────────────────────────────────────────────── */

  .content-preview {
    position: relative;
    width: 100%;
    border-radius: var(--radius-lg);
    overflow: hidden;
    opacity: 0;
    transform: translateY(var(--space-4));
    transition: opacity calc(var(--duration-slower) * 1.2), transform calc(var(--duration-slower) * 1.2);
  }

  :global(.content-preview.preview-visible) {
    opacity: 1;
    transform: translateY(0);
  }

  @media (prefers-reduced-motion: reduce) {
    .content-preview {
      opacity: 1;
      transform: none;
    }
  }

  .preview-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-1);
  }

  @media (max-width: 47.9375rem) {
    .preview-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .preview-thumb {
    aspect-ratio: 16 / 9;
    overflow: hidden;
  }

  .preview-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: blur(var(--blur-sm)) saturate(0.8);
    transform: scale(1.1);
  }

  .preview-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    background: color-mix(in srgb, var(--color-surface) 70%, transparent);
    backdrop-filter: blur(var(--blur-sm));
    -webkit-backdrop-filter: blur(var(--blur-sm));
  }

  .preview-text {
    font-size: var(--text-lg);
    color: var(--color-text);
    margin: 0;
  }

  .preview-text strong {
    color: var(--color-brand-primary, var(--color-interactive));
  }

  .preview-cta {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-brand-primary, var(--color-interactive));
    text-decoration: none;
    border-bottom: 1px solid currentColor;
    padding-bottom: var(--space-0-5);
    transition: opacity var(--duration-normal);
  }

  .preview-cta:hover {
    opacity: var(--opacity-70);
  }

  /* ── FAQ ──────────────────────────────────────────────────────────── */

  .faq-section {
    width: 100%;
    max-width: 640px;
  }

  .section-heading {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    text-align: center;
    margin: 0 0 var(--space-6);
    letter-spacing: var(--tracking-normal);
  }

  .faq-container {
    background: color-mix(in srgb, var(--color-surface) 60%, transparent);
    backdrop-filter: blur(var(--blur-md));
    -webkit-backdrop-filter: blur(var(--blur-md));
    border: 1px solid color-mix(in srgb, var(--color-border) 40%, transparent);
    border-radius: var(--radius-lg);
    padding: var(--space-2);
    box-shadow:
      var(--shadow-sm),
      inset 0 1px 0 color-mix(in srgb, var(--color-glass-tint, white) 6%, transparent);
  }

  /* ── TRUST BAR ───────────────────────────────────────────────────── */

  .trust-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-4);
    width: 100%;
    max-width: 640px;
  }

  .trust-signal {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .trust-signal :global(svg) {
    flex-shrink: 0;
    opacity: 0.6;
  }

  .trust-divider {
    width: 1px;
    height: var(--space-4);
    background-color: var(--color-border);
    flex-shrink: 0;
  }

  @media (max-width: 47.9375rem) {
    .trust-bar {
      flex-wrap: wrap;
    }
    .trust-divider {
      display: none;
    }
  }

  /* ── STICKY BAR ──────────────────────────────────────────────────── */

  .sticky-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: var(--z-sticky, 40);
    background: color-mix(in srgb, var(--color-surface) 92%, transparent);
    backdrop-filter: blur(var(--blur-xl));
    -webkit-backdrop-filter: blur(var(--blur-xl));
    border-top: 1px solid color-mix(in srgb, var(--color-border) 40%, transparent);
    box-shadow: 0 calc(-1 * var(--space-2)) var(--space-6) color-mix(in srgb, var(--color-glass-tint-dark, black) 6%, transparent);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  .sticky-bar__inner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    max-width: 960px;
    margin: 0 auto;
  }

  .sticky-bar__info {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .sticky-bar__name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .sticky-bar__price {
    font-size: var(--text-lg);
    font-weight: var(--font-bold);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .sticky-bar__price small {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
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
    transition: color var(--duration-fast), background-color var(--duration-fast);
  }

  .sticky-bar__dismiss:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  /* ── ERROR ────────────────────────────────────────────────────────── */

  .checkout-error {
    width: 100%;
    padding: var(--space-3) var(--space-4);
    background-color: var(--color-error-50);
    border: var(--border-width) var(--border-style) var(--color-error-200);
    border-radius: var(--radius-md);
    color: var(--color-error-700);
    font-size: var(--text-sm);
    text-align: center;
  }

  .checkout-error p { margin: 0; }

  /* ── SKELETON ─────────────────────────────────────────────────────── */

  .card-shell {
    flex: 1 1 320px;
    max-width: 420px;
    min-width: 280px;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-8) var(--space-6);
    background: color-mix(in srgb, var(--color-surface) 70%, transparent);
    backdrop-filter: blur(var(--blur-md));
    -webkit-backdrop-filter: blur(var(--blur-md));
    border: 1px solid color-mix(in srgb, var(--color-border) 40%, transparent);
    border-radius: var(--radius-lg);
    opacity: 0;
    animation: cardReveal calc(var(--duration-slower) * 1.1) var(--ease-smooth) forwards;
    animation-delay: calc(120ms * var(--card-index));
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

  .skeleton--badge  { width: 30%; height: var(--space-6); border-radius: var(--radius-full); }
  .skeleton--title  { width: 45%; height: var(--space-6); }
  .skeleton--desc   { width: 80%; height: var(--space-4); }
  .skeleton--price  { width: 40%; height: var(--space-10); }
  .skeleton--feature { width: 65%; height: var(--space-4); }
  .skeleton--cta    { width: 100%; height: var(--space-12); margin-top: auto; border-radius: var(--radius-md); }

  @keyframes shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* ── BACKDROP FALLBACK ───────────────────────────────────────────── */

  @supports not (backdrop-filter: blur(1px)) {
    .card__inner,
    .faq-container,
    .billing-toggle {
      background: var(--color-surface);
    }
    .sticky-bar {
      background: var(--color-surface);
    }
  }
</style>

# Phase 2: Pricing Page Frontend — Complete Rewrite

**Version**: 1.1 (post-review)
**Date**: 2026-04-15
**Status**: Implementation-ready
**Depends on**: Phase 1A (isRecommended), Phase 1B (pricingFaq)

---

## 1. Overview

Complete rewrite of the org pricing page into a premium, brand-aware experience with three acts (Hero → Cards → Proof), Disney-principled animations, glassmorphic tier cards, a content preview section, FAQ accordion, trust strip, and a smart sticky CTA bar.

### Files Modified

| File | Change |
|------|--------|
| `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.server.ts` | Extended data loading (content preview, FAQ access) |
| `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte` | Complete rewrite |

---

## 2. Server Load (`+page.server.ts`)

### Current State

```ts
return {
  tiers: api.tiers.list(org.id).catch(() => []),
  currentSubscription: locals.user
    ? api.subscription.getCurrent(org.id).catch(() => null)
    : Promise.resolve(null),
  isAuthenticated: !!locals.user,
};
```

### New State

```ts
const { org } = await parent();

setHeaders(
  locals.user ? CACHE_HEADERS.PRIVATE : CACHE_HEADERS.DYNAMIC_PUBLIC
);

const api = createServerApi(platform, cookies);

return {
  // Existing (unchanged)
  tiers: api.tiers.list(org.id).catch(() => []),
  currentSubscription: locals.user
    ? api.subscription.getCurrent(org.id).catch(() => null)
    : Promise.resolve(null),
  isAuthenticated: !!locals.user,

  // New: content thumbnails for preview section (streamed)
  // NOTE: Correct method is getPublicContent(), NOT listPublic()
  contentPreview: api.content
    .getPublicContent(new URLSearchParams({ orgId: org.id, limit: '6' }))
    .then((result) => result?.items ?? [])
    .catch(() => []),

  // New: org stats for content preview overlay
  stats: api.org
    .getPublicStats(org.slug)
    .catch(() => null),
};
```

### FAQ Data Path

FAQ comes from the parent layout's branding data (already loaded for CSS injection). The org layout flattens branding into `data.org.*` fields (e.g., `data.org.brandColors`, `data.org.brandFineTune`). After Phase 1B wires `pricingFaq` through, verify the exact access path.

```ts
const faqItems = $derived.by(() => {
  try {
    // Access path depends on how Phase 1B wires pricingFaq through the layout
    const raw = data.org?.pricingFaq ?? data.org?.brandFineTune?.pricingFaq;

    // Handle all empty states: null, undefined, empty string, empty array
    if (!raw) return DEFAULT_FAQ;

    const parsed = JSON.parse(raw) as PricingFaqItem[];
    return parsed.length > 0
      ? parsed.sort((a, b) => {
          if (a.order !== b.order) return a.order - b.order;
          return a.id.localeCompare(b.id); // Stable tie-breaker
        })
      : DEFAULT_FAQ;
  } catch {
    return DEFAULT_FAQ; // Malformed JSON → defaults
  }
});
```

**Important**: Use `{item.answer}` text interpolation in Svelte (auto-escaped), NEVER `{@html item.answer}` (XSS risk).

---

## 3. Page Component Structure (`+page.svelte`)

### Component Outline

```
<svelte:head> (SEO: title, meta description)

<div class="pricing-page">
  <!-- ACT 1: HERO -->
  <section class="pricing-hero">
    <h1 class="hero-heading">              ← stagger 0
    <p class="hero-subtitle">              ← stagger 1
    <div class="billing-toggle">           ← stagger 2
      <button class="toggle-option">Monthly
      <button class="toggle-option">Annual
      {#if billingInterval === 'year'}
        <span class="savings-badge">       ← bounceIn animation
      {/if}
    </div>
  </section>

  <!-- ACT 2: TIER CARDS -->
  {#if pricingLoading}
    <Skeleton cards />
  {:else if tiers.length === 0}
    <EmptyState />
  {:else}
    <section class="tier-cards" bind:this={tierCardsRef}>
      {#each tiers as tier, i (tier.id)}
        <article class="tier-card"         ← stagger i * 80ms
          class:recommended
          class:current
        >
          <div class="tier-card-badge">    ← "Most Popular" or "Current Plan"
          <h2 class="tier-card-name">
          <p class="tier-card-description">
          <div class="tier-card-price">    ← cross-fade on toggle
          <div class="tier-card-features"> ← staggered checkmarks
          <Button class="tier-cta">        ← squash on press
        </article>
      {/each}
    </section>
  {/if}

  <!-- ACT 3: BELOW THE FOLD -->

  <!-- Content Preview (conditional) -->
  {#await data.contentPreview then items}
    {#if items.length > 0}
      <section class="content-preview">
        <div class="preview-grid">
          {#each items.slice(0, 6) as item}
            <div class="preview-thumb">
              <img src={item.thumbnailUrl} alt="" />
            </div>
          {/each}
        </div>
        <div class="preview-overlay glass">
          <p class="preview-stats">
          <a href="/explore">Browse content</a>
        </div>
      </section>
    {/if}
  {/await}

  <!-- FAQ Accordion -->
  <section class="faq-section">
    <h2>Frequently Asked Questions</h2>
    <Accordion.Root>
      {#each faqItems as item (item.id)}
        <Accordion.Item value={item.id}>
          <Accordion.Trigger>{item.question}</Accordion.Trigger>
          <Accordion.Content><p>{item.answer}</p></Accordion.Content>
        </Accordion.Item>
      {/each}
    </Accordion.Root>
  </section>

  <!-- Trust Strip -->
  <div class="trust-strip">
    <span class="trust-item"><ShieldIcon /> Cancel anytime</span>
    <span class="trust-item"><LockIcon /> Secure checkout</span>
    <span class="trust-item"><ZapIcon /> Instant access</span>
  </div>
</div>

<!-- STICKY CTA BAR -->
{#if showStickyCta}
  <div class="sticky-cta glass" transition:fly={{ y: 60, duration: 300 }}>
    <span class="sticky-tier">{recommendedTier.name}</span>
    <span class="sticky-price">{formatPrice(tierPrice(recommendedTier))}</span>
    <Button onclick={() => handleSubscribe(recommendedTier)}>Subscribe</Button>
    <button class="sticky-dismiss" onclick={() => dismissedStickyCta = true}>
      <XIcon />
    </button>
  </div>
{/if}
```

---

## 4. Reactive State

```ts
// Billing interval (restored from URL params on login redirect)
const initialInterval = page.url.searchParams.get('billingInterval');
let billingInterval = $state<'month' | 'year'>(
  initialInterval === 'year' ? 'year' : 'month'
);

// Checkout flow (existing pattern, preserved)
let checkoutLoading = $state<string | null>(null);
let checkoutError = $state('');
const restoredTierId = page.url.searchParams.get('tierId');

// Streamed data resolution (existing pattern, preserved)
let tiers = $state<SubscriptionTier[]>([]);
let currentTierId = $state<string | null>(null);
let pricingLoading = $state(true);

// Sticky CTA
let tierCardsRef = $state<HTMLElement | null>(null);
let showStickyCta = $state(false);
let dismissedStickyCta = $state(false);

// Feature flag from org layout
const enableSubscriptions = $derived(data.enableSubscriptions ?? true);

// Recommended tier derivation
const recommendedTier = $derived.by(() => {
  if (tiers.length === 0) return null;
  // 1. Creator-selected recommended tier
  const explicit = tiers.find((t) => t.isRecommended);
  if (explicit) return explicit;
  // 2. Fallback: middle tier by sortOrder
  const sorted = [...tiers].sort((a, b) => a.sortOrder - b.sortOrder);
  return sorted[Math.floor(sorted.length / 2)] ?? sorted[0];
});

// Media query for mobile detection
let isMobile = $state(false);
```

---

## 5. Hero Section Design

### Background

```css
.pricing-hero {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-16) var(--space-4) var(--space-8);
  text-align: center;
  overflow: hidden;
}

/* Brand-tinted gradient base */
.pricing-hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      ellipse 80% 60% at 50% 0%,
      color-mix(in oklch, var(--color-brand-primary) 12%, transparent),
      transparent 70%
    ),
    linear-gradient(
      180deg,
      color-mix(in oklch, var(--color-brand-primary) 6%, var(--color-surface)) 0%,
      var(--color-surface) 100%
    );
  pointer-events: none;
  z-index: -1;
}
```

### Staggered Entrance Animation

```css
.hero-heading,
.hero-subtitle,
.billing-toggle-wrapper {
  opacity: 0;
  transform: translateY(var(--space-4));
}

@media (prefers-reduced-motion: no-preference) {
  .hero-heading,
  .hero-subtitle,
  .billing-toggle-wrapper {
    animation: fadeInUp 400ms var(--ease-out) forwards;
    animation-delay: calc(60ms * var(--stagger));
  }
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(var(--space-4));
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

### Billing Toggle

```css
.billing-toggle {
  display: inline-flex;
  position: relative;
  padding: var(--space-0-5);
  background-color: var(--color-surface-secondary);
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-md);
}

.toggle-option {
  padding: var(--space-2) var(--space-6);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--color-text-secondary);
  border: none;
  background: none;
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: var(--transition-colors);
  position: relative;
  z-index: 1;
}

.toggle-option.active {
  background-color: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-sm);
}
```

### Annual Savings Badge

```css
.savings-badge {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--color-success-600);
  background-color: var(--color-success-50);
  border-radius: var(--radius-full);
}

@media (prefers-reduced-motion: no-preference) {
  .savings-badge {
    animation: bounceIn 400ms var(--ease-bounce) forwards;
  }
}

@keyframes bounceIn {
  from {
    opacity: 0;
    transform: scale(0.8);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
```

---

## 6. Tier Cards Design

### Glass Card Base

```css
.tier-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6);
  background: var(--material-glass);
  backdrop-filter: blur(var(--blur-md));
  -webkit-backdrop-filter: blur(var(--blur-md));
  border: 1px solid var(--material-glass-border);
  border-radius: var(--radius-lg);
  transition:
    transform 300ms var(--ease-default),
    box-shadow 300ms var(--ease-default);

  /* Entrance animation */
  opacity: 0;
  transform: translateY(24px);
}

@media (prefers-reduced-motion: no-preference) {
  .tier-card {
    animation: cardFlyIn 400ms var(--ease-out) forwards;
    animation-delay: calc(80ms * var(--card-index));
  }
}

/* No-motion fallback: just show the cards */
@media (prefers-reduced-motion: reduce) {
  .tier-card {
    opacity: 1;
    transform: none;
  }
}

@keyframes cardFlyIn {
  from {
    opacity: 0;
    transform: translateY(24px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

### Hover

```css
.tier-card:hover {
  transform: translateY(calc(-1 * var(--space-1)));
  box-shadow: var(--shadow-lg);
}
```

### Recommended Tier Glow

```css
.tier-card.recommended {
  padding: var(--space-8);
  box-shadow:
    0 0 0 2px var(--color-brand-primary),
    0 0 24px color-mix(in oklch, var(--color-brand-primary) 20%, transparent);
}

.tier-card.recommended:hover {
  box-shadow:
    0 0 0 2px var(--color-brand-primary),
    0 0 32px color-mix(in oklch, var(--color-brand-primary) 30%, transparent),
    var(--shadow-lg);
}
```

### Current Plan

```css
.tier-card.current {
  border-color: var(--color-interactive);
  border-width: var(--border-width-thick);
}
```

### Price Display

```css
.tier-card-price {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
}

.price-amount {
  font-size: var(--text-4xl);
  font-weight: var(--font-bold);
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-tight);
  transition: opacity var(--duration-normal) var(--ease-default);
}

.price-interval {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
```

### Feature Checklist Stagger

```css
.feature-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  opacity: 0;
}

@media (prefers-reduced-motion: no-preference) {
  .feature-item {
    animation: featureFadeIn 200ms var(--ease-default) forwards;
    animation-delay: calc(40ms * var(--check-index));
  }
}

@media (prefers-reduced-motion: reduce) {
  .feature-item {
    opacity: 1;
  }
}

@keyframes featureFadeIn {
  from { opacity: 0; transform: translateX(calc(-1 * var(--space-1))); }
  to { opacity: 1; transform: translateX(0); }
}
```

### CTA Button Squash (Disney)

```css
:global(.tier-cta) {
  width: 100%;
  margin-top: auto;
  transition: transform 200ms var(--ease-bounce);
}

:global(.tier-cta:active) {
  transform: scale(0.82) scaleY(0.92);
  transition: transform 60ms;
}
```

### Grid Layout

```css
.tier-cards {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-6);
  width: 100%;
  max-width: 1200px;
  padding: 0 var(--space-4);
}

@media (--breakpoint-sm) {
  .tier-cards {
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  }
}
```

---

## 7. Content Preview Section

### Layout

```css
.content-preview {
  position: relative;
  width: 100%;
  max-width: 1200px;
  padding: var(--space-8) var(--space-4);
  overflow: hidden;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-2);
}

@media (--breakpoint-md) {
  .preview-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.preview-thumb {
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: var(--radius-md);
}

.preview-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(8px);
  transform: scale(1.05); /* Prevent blur edge artifacts */
}
```

### Glass Overlay

```css
.preview-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  /* Glass uses the .glass utility class from materials.css */
  border-radius: var(--radius-lg);
}

.preview-stats {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--color-text);
  text-align: center;
}

.preview-stats span {
  font-size: var(--text-2xl);
  font-weight: var(--font-bold);
  color: var(--color-brand-primary);
}
```

### Scroll-Triggered Entrance

```ts
// In onMount
const previewObserver = new IntersectionObserver(
  ([entry]) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('preview-visible');
      previewObserver.disconnect();
    }
  },
  { threshold: 0.2 }
);
```

```css
.content-preview {
  opacity: 0;
  transform: scale(0.95);
  transition: opacity 500ms var(--ease-out), transform 500ms var(--ease-out);
}

.content-preview.preview-visible {
  opacity: 1;
  transform: scale(1);
}

@media (prefers-reduced-motion: reduce) {
  .content-preview {
    opacity: 1;
    transform: none;
  }
}
```

---

## 8. FAQ Accordion Section

```css
.faq-section {
  width: 100%;
  max-width: 720px;
  padding: var(--space-8) var(--space-4);
}

.faq-section h2 {
  font-family: var(--font-heading);
  font-size: var(--text-2xl);
  font-weight: var(--font-bold);
  color: var(--color-text);
  text-align: center;
  margin-bottom: var(--space-6);
}
```

Uses the existing Melt UI `Accordion` component — no custom accordion needed.

---

## 9. Trust Strip

```css
.trust-strip {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-6);
  padding: var(--space-6) var(--space-4);
  border-top: var(--border-width) var(--border-style) var(--color-border);
  width: 100%;
  max-width: 720px;
}

.trust-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
```

---

## 10. Sticky CTA Bar

### Intersection Observer Logic

```ts
onMount(() => {
  // Mobile detection
  const mq = window.matchMedia('(max-width: 47.9375rem)'); // --below-md
  isMobile = mq.matches;
  const handleMq = (e: MediaQueryListEvent) => { isMobile = e.matches; };
  mq.addEventListener('change', handleMq);

  // Desktop: show sticky CTA when tier cards scroll out of viewport
  let observer: IntersectionObserver | undefined;
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

  return () => {
    mq.removeEventListener('change', handleMq);
    observer?.disconnect();
  };
});

// Mobile: always show sticky CTA (when tiers loaded and not on current plan)
const showMobileStickyCta = $derived(
  isMobile && tiers.length > 0 && !pricingLoading && !currentTierId
);

const showDesktopStickyCta = $derived(
  !isMobile && showStickyCta && !dismissedStickyCta
);

const stickyVisible = $derived(showMobileStickyCta || showDesktopStickyCta);
```

### Sticky CTA CSS

```css
.sticky-cta {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  padding-bottom: calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
  z-index: var(--z-sticky);
  /* .glass class provides backdrop-filter + border */
}

.sticky-tier {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--color-text);
}

.sticky-price {
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

.sticky-dismiss {
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
  transition: var(--transition-colors);
}

.sticky-dismiss:hover {
  color: var(--color-text);
  background-color: var(--color-surface-secondary);
}

/* Bottom padding on main content to prevent CTA overlap on mobile */
@media (--below-md) {
  .pricing-page {
    padding-bottom: calc(var(--space-16) + env(safe-area-inset-bottom, 0px));
  }
}
```

### Svelte Transition

```svelte
{#if stickyVisible}
  <div
    class="sticky-cta glass"
    transition:fly={{ y: 60, duration: 300, easing: cubicOut }}
  >
    ...
  </div>
{/if}
```

---

## 11. Skeleton Loading State

Enhanced shimmer pattern matching the glassmorphic card layout:

```css
.tier-card-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6);
  background: var(--material-glass);
  backdrop-filter: blur(var(--blur-md));
  -webkit-backdrop-filter: blur(var(--blur-md));
  border: 1px solid var(--material-glass-border);
  border-radius: var(--radius-lg);
}

.skeleton {
  background: linear-gradient(
    90deg,
    var(--color-surface-secondary) 25%,
    var(--color-surface-tertiary, var(--color-surface-secondary)) 50%,
    var(--color-surface-secondary) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: var(--radius-md);
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

---

## 12. Backdrop-Filter Fallback

```css
@supports not (backdrop-filter: blur(1px)) {
  .tier-card {
    background: var(--color-surface);
  }
  .sticky-cta {
    background: var(--color-surface);
    opacity: 0.98;
  }
  .preview-overlay {
    background: var(--color-surface);
    opacity: 0.95;
  }
}
```

---

## 13. Existing Utilities Reused

| Import | From | Purpose |
|--------|------|---------|
| `Button` | `$lib/components/ui/Button/Button.svelte` | CTA buttons (primary/secondary, loading) |
| `Badge` | `$lib/components/ui` | "Most Popular", "Save X%", "Current Plan" |
| `EmptyState` | `$lib/components/ui` | No-tiers fallback |
| `* as Accordion` | `$lib/components/ui/Accordion` | FAQ section |
| `CheckIcon, LockIcon, XIcon` | `$lib/components/ui/Icon` | Features, trust strip, dismiss. **NOTE**: `ShieldIcon` and `ZapIcon` do NOT exist — create them or use `LockIcon` + `CheckCircleIcon` as alternatives |
| `formatPrice` | `$lib/utils/format` | GBP price formatting |
| `formatDurationHuman` | `$lib/utils/format` | Content hours in preview |
| `createSubscriptionCheckoutSession` | `$lib/remote/subscription.remote` | Checkout flow |
| `page` | `$app/state` | URL params for login redirect restore |
| `fly` | `svelte/transition` | Sticky CTA entrance |
| `cubicOut` | `svelte/easing` | Sticky CTA easing |

---

## 14. Animation Summary

| Element | Keyframes | Duration | Easing | Stagger | Trigger |
|---------|-----------|----------|--------|---------|---------|
| Hero heading | fadeInUp | 400ms | `--ease-out` | 0ms | Page load |
| Hero subtitle | fadeInUp | 400ms | `--ease-out` | 60ms | Page load |
| Billing toggle | fadeInUp | 400ms | `--ease-out` | 120ms | Page load |
| Savings badge | bounceIn | 400ms | `--ease-bounce` | — | Toggle to annual |
| Tier cards | cardFlyIn | 400ms | `--ease-out` | `i * 80ms` | Data loaded |
| Feature checks | featureFadeIn | 200ms | `--ease-default` | `j * 40ms` | Card visible |
| Card hover | translateY + shadow | 300ms | `--ease-default` | — | Hover |
| CTA press | squash (scale) | 60ms active | — | — | :active |
| CTA release | recover | 200ms | `--ease-bounce` | — | Release |
| Content preview | opacity + scale | 500ms | `--ease-out` | — | Scroll IntersectionObserver |
| Sticky CTA | fly y:60 | 300ms | cubicOut | — | Cards leave viewport |

**All disabled under `prefers-reduced-motion: reduce`** (global `motion.css` + explicit `@media` guards).

---

## 15. Responsive Breakpoints

| Viewport | Cards | Preview Grid | Sticky CTA | Hero |
|----------|-------|-------------|------------|------|
| < 640px (mobile) | 1 column | 2x2 | Always visible | Compact padding |
| 640–1024px (tablet) | 2 columns | 2x3 | Scroll-triggered | Standard |
| > 1024px (desktop) | auto-fit 300px+ | 3x2 | Scroll-triggered | Full width |

---

## 16. Empty States

| Condition | Behaviour |
|-----------|-----------|
| `enableSubscriptions === false` | Show `EmptyState` with disabled message |
| `pricingLoading === true` | Show shimmer skeleton cards (3 placeholders) |
| `tiers.length === 0` | Show `EmptyState` with "no tiers" message |
| No published content | Hide content preview section entirely |
| No FAQ configured | Show hardcoded default FAQ |
| No recommended tier | Auto-select middle tier by sortOrder |
| User already subscribed | Show "Current Plan" badge, disable CTA, hide sticky bar |

---

## 17. Checkout Flow (Preserved)

The existing checkout flow is preserved exactly:

1. Unauthenticated user clicks "Subscribe" → redirect to `/login?redirect=/pricing?tierId=X&billingInterval=Y`
2. After login → redirect back to pricing → `restoredTierId` triggers auto-checkout via `onMount`
3. Authenticated user clicks "Subscribe" → `createSubscriptionCheckoutSession()` → redirect to Stripe Checkout
4. Checkout error → displayed in alert banner above tier cards

---

## 18. Verification Checklist

1. Hero renders with brand gradient tint matching org primary color
2. Staggered entrance animation plays (heading → subtitle → toggle)
3. Billing toggle switches between monthly/annual
4. Annual toggle shows bouncing savings badge
5. Tier cards display with glass effect
6. Recommended tier has brand-primary glow border + "Most Popular" badge
7. Current plan has interactive border + "Current Plan" badge + disabled CTA
8. Price cross-fades when toggling billing interval
9. Feature checkmarks stagger in
10. Card hover lifts + shadow escalation
11. CTA squashes on press (Disney)
12. Content preview shows blurred thumbnails with glass overlay stats
13. Content preview hidden when no published content
14. FAQ accordion opens/closes
15. FAQ shows creator-configured items (or defaults)
16. Trust strip renders with icons
17. Sticky CTA appears on desktop when scrolling past cards
18. Sticky CTA always visible on mobile
19. Sticky CTA respects billing interval selection
20. Sticky CTA dismiss button works on desktop
21. Subscribe redirects to Stripe checkout (or login if unauth'd)
22. Login redirect restores tier + billing interval
23. Reduced motion disables all animations
24. Backdrop-filter fallback renders solid cards
25. Test with 1, 2, 3, 4+ tiers
26. Test with no tiers (EmptyState)
27. Test on mobile viewport

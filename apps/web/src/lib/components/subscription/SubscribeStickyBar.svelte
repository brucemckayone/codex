<!--
  @component SubscribeStickyBar

  Floating bottom-of-viewport CTA that nudges visitors to subscribe to an org.
  Renders as a rounded pill on every breakpoint — on mobile it floats above
  the MobileBottomNav with a deliberate gap so it reads as part of the same
  glass-dock family rather than a separate slab pinned to the chrome.

  Visibility is engagement-gated: the bar stays out of the way until the
  user has scrolled ~40% of viewport height, then slides up. It's hidden
  again if the user dismisses it.

  Dismissals are persisted via `$lib/collections/dismissals` keyed by
  `dismissKey` so the suppression survives page navigations and tab close,
  with a TTL (default 4 days) handled by the collection.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import { XIcon } from '$lib/components/ui/Icon';
  import { dismiss, isDismissed } from '$lib/collections/dismissals';

  interface Props {
    orgName: string;
    /** Storage key for dismissal — typically `subscribe-cta:${orgId}`. */
    dismissKey: string;
    /** Where to send the user when they click Subscribe. */
    href?: string;
  }

  let { orgName, dismissKey, href = '/pricing' }: Props = $props();

  // Mounted gate prevents an SSR/hydration flash before onMount has had a
  // chance to read the persisted dismissal state. Without it, a previously-
  // dismissed bar would render for one frame, then disappear.
  let mounted = $state(false);
  let dismissed = $state(false);
  let isMobile = $state(false);
  let reducedMotion = $state(false);
  // Engagement gate — bar stays hidden until the user scrolls past ~40% of
  // viewport height. Avoids slamming a CTA into someone's face before they've
  // had a chance to read the hero.
  let scrolledEnough = $state(false);

  const visible = $derived(mounted && scrolledEnough && !dismissed);

  onMount(() => {
    // One-shot client-only seeding from the persisted collection BEFORE
    // flipping `mounted` so the visibility derived sees the correct value
    // on its first true-evaluation.
    dismissed = isDismissed(dismissKey);
    mounted = true;
  });

  $effect(() => {
    const mql = window.matchMedia('(max-width: 47.99rem)');
    isMobile = mql.matches;
    const mqlHandler = (e: MediaQueryListEvent) => {
      isMobile = e.matches;
    };
    mql.addEventListener('change', mqlHandler);

    // Honour OS-level reduced-motion preference (WCAG 2.3.3).
    const motionMql = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = motionMql.matches;
    const motionHandler = (e: MediaQueryListEvent) => {
      reducedMotion = e.matches;
    };
    motionMql.addEventListener('change', motionHandler);

    // Scroll engagement gate — viewport-relative threshold so the bar feels
    // equally patient on a 600px phone and a 1400px monitor.
    const updateScrolled = () => {
      scrolledEnough = window.scrollY > window.innerHeight * 0.4;
    };
    window.addEventListener('scroll', updateScrolled, { passive: true });
    updateScrolled();

    return () => {
      mql.removeEventListener('change', mqlHandler);
      motionMql.removeEventListener('change', motionHandler);
      window.removeEventListener('scroll', updateScrolled);
    };
  });

  function handleSubscribeClick() {
    // Always route to the pricing page first — login is deferred until the
    // user picks a specific tier, so the redirect can carry tier + billing
    // interval context. Mirrors the pricing page's own handleSubscribe flow.
    window.location.href = href;
  }

  function handleDismiss() {
    dismissed = true;
    dismiss(dismissKey);
  }
</script>

{#if visible}
  <div
    class="sticky-bar"
    class:sticky-bar--mobile={isMobile}
    transition:fly={{
      y: reducedMotion ? 0 : 80,
      duration: reducedMotion ? 0 : 350,
      easing: cubicOut,
    }}
    role="region"
    aria-label="Subscribe call to action"
  >
    <div class="sticky-bar__inner">
      <div class="sticky-bar__info">
        <span class="sticky-bar__eyebrow">Become a member</span>
        <span class="sticky-bar__headline">
          <span class="sticky-bar__name">{orgName}</span>
        </span>
      </div>
      <Button onclick={handleSubscribeClick}>Subscribe</Button>
      <button
        type="button"
        class="sticky-bar__dismiss"
        onclick={handleDismiss}
        aria-label="Dismiss subscribe banner"
      >
        <XIcon size={14} />
      </button>
    </div>
  </div>
{/if}

<style>
  .sticky-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: var(--z-fixed);
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
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-border) 60%, transparent);
    border-radius: var(--radius-full);
    box-shadow:
      var(--shadow-xl),
      0 var(--space-4) var(--space-12) calc(-1 * var(--space-2))
        color-mix(in oklch, var(--color-brand-primary) 18%, transparent),
      inset 0 1px 0
        color-mix(in srgb, var(--color-glass-tint) 16%, transparent);
  }

  /* Mobile: keep the floating pill identity. Lift above the MobileBottomNav
     (var(--space-16) tall) with a deliberate gap so the two glass surfaces
     read as a coherent dock family rather than a stacked slab. */
  .sticky-bar--mobile {
    bottom: calc(var(--space-16) + var(--space-2));
    padding: 0 var(--space-3);
    padding-bottom: 0;
  }

  .sticky-bar--mobile .sticky-bar__inner {
    max-width: 100%;
    padding: var(--space-1-5) var(--space-1-5) var(--space-1-5) var(--space-4);
    gap: var(--space-2);
  }

  .sticky-bar--mobile .sticky-bar__eyebrow {
    font-size: var(--text-2xs, var(--text-xs));
  }

  .sticky-bar--mobile .sticky-bar__name {
    max-width: 10ch;
    font-size: var(--text-sm);
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
    text-transform: var(--text-transform-label);
    color: var(--color-brand-primary);
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

  .sticky-bar__dismiss {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    border-radius: var(--radius-full);
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: var(--transition-colors);
    flex-shrink: 0;
  }

  .sticky-bar__dismiss:hover {
    color: var(--color-text);
    background: color-mix(
      in srgb,
      var(--color-surface-secondary) 60%,
      transparent
    );
  }

  .sticky-bar__dismiss:focus-visible {
    outline: var(--border-width) solid var(--color-focus-ring);
    outline-offset: var(--space-0-5);
  }
</style>

<!--
  @component FloatingCta

  Persistent bottom-centre conversion pill for the public journey sales page —
  the real-token equivalent of the prototype's `.floatcta`. It is parked
  off-screen and slides up once the reader passes the first viewport, giving an
  always-available "begin" affordance that follows them down the long page.

  PROGRESSIVE ENHANCEMENT. The markup renders on the server (so hydration
  matches), starts hidden + `inert`, and the slide is a pure CSS transform gated
  on `.is-shown`. Only a real, top-level visitor arms the scroll listener — the
  studio builder renders this component inside a preview iframe, where it stays
  parked off-screen and inert so it never covers the builder chrome or fights
  its own scroll. Under reduced motion it snaps in without the slide.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import CtaLink from './CtaLink.svelte';

  interface Props {
    /** Navigation target — checkout (pre-purchase) or dashboard (enrolled). */
    href: string;
    /** Short lead-in copy, e.g. the course title. */
    label: string;
    /** CTA button text. */
    ctaText: string;
  }

  const { href, label, ctaText }: Props = $props();

  let shown = $state(false);

  onMount(() => {
    // Real top-level visitors only. In the studio builder's preview iframe
    // (`window.self !== window.top`) the pill stays parked + inert.
    if (window.self !== window.top) return;

    let ticking = false;
    const update = () => {
      ticking = false;
      shown = window.scrollY > window.innerHeight * 0.5;
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => window.removeEventListener('scroll', onScroll);
  });
</script>

<div class="floatcta" class:is-shown={shown} inert={!shown}>
  <span class="floatcta__copy">{label}</span>
  <CtaLink {href} size="md">{ctaText}</CtaLink>
</div>

<style>
  .floatcta {
    position: fixed;
    left: 50%;
    bottom: var(--space-5);
    z-index: var(--z-fixed);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    max-width: calc(100vw - var(--space-8));
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-5);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--color-surface) 88%, transparent);
    backdrop-filter: blur(var(--blur-lg));
    -webkit-backdrop-filter: blur(var(--blur-lg));
    box-shadow: var(--shadow-xl);
    /* Parked below the fold; slides up when `.is-shown`. */
    transform: translate(-50%, 200%);
    transition: transform var(--duration-slow) var(--ease-out);
  }

  .floatcta.is-shown {
    transform: translate(-50%, 0);
  }

  .floatcta__copy {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (--below-sm) {
    .floatcta {
      padding: var(--space-2);
    }
    .floatcta__copy {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .floatcta {
      transition: none;
    }
  }
</style>

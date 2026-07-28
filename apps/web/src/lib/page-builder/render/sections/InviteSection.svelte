<!--
  @component InviteSection

  The offer and pricing (SPEC §4.1 `invite`) — the primary conversion moment.

  Every path and every price comes from `context.offer` — the AUTHORITATIVE
  `getCourseOffer` read (Codex-2pryk.2.4.3). Authored `offers` copy may decorate
  a real path (name / who / blurb / bullets / which is recommended) and can
  neither invent a path nor state a price: this section used to render the
  authored `priceLabel` directly, which is how a dev page came to advertise
  "Included with membership · £12 a month" against a real £15 tier and a real
  £27 course subscription.

  When `context.offer` is null the offer read was unavailable. The section then
  shows the CTA with NO price rather than falling back to authored numbers —
  a price-less invitation is honest, a wrong one is not. Each card deep-links
  into the checkout with its own path pre-selected (`?offer=`). Currency is GBP.

  TWO renderings, progressively enhanced (SPEC §6: CSS-first motion, always
  degradable):
  • BASELINE (SSR, no-JS, reduced-motion): a clean, fully-legible centred close —
    eyebrow, heading, sub, and the offer(s), all visible immediately. This is what
    the server emits, so the section is never blank and never depends on JS.
  • ENHANCED (browser + motion OK): the prototype's cinematic close — a breathing
    "warm ground" rises from below, a descent hairline drops a travelling spark
    that arrives at a glowing seed, a centred vignette focuses the frame, and each
    block fades/rises into view on scroll (staggered) via the shared `reveal`
    action.

  Ambient loops (breathe / descent spark / seed pulse) are gated on
  `mounted && !reduced` so the accessible baseline always ships first; the
  reduced-motion preference is re-read live so a mid-session flip settles the
  frame. The reveal action is self-gating (SSR-safe, reduced-motion aware).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import {
    checkoutUrlForPath,
    deriveOfferPaths,
  } from '$lib/page-builder/offer-paths';
  import CtaLink from '../CtaLink.svelte';
  import { asString } from '../coerce';
  import { reveal } from '../reveal';
  import type { JourneySalesContext } from '../types';
  import type { SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    context: JourneySalesContext;
  }

  const { config, context }: Props = $props();

  const eyebrow = $derived(asString(config, 'eyebrow'));
  const sub = $derived(asString(config, 'sub'));
  const priceNote = $derived(asString(config, 'priceNote'));
  const heading = $derived(asString(config, 'heading') ?? 'Begin the work.');

  // The real ways in, decorated by this section's authored copy. Empty when the
  // offer read was unavailable, or when the course has no purchasable path.
  const paths = $derived(
    deriveOfferPaths(context.offer, context.course, config)
  );

  // CTA branches on enrolment: an enrolled member is sent to their dashboard;
  // everyone else funnels to checkout to join.
  const ctaLabel = $derived(
    context.enrolled
      ? 'Go to your dashboard'
      : (asString(config, 'ctaLabel') ?? 'Join now')
  );
  /**
   * Where one card's CTA goes. An enrolled viewer has nothing to buy, so every
   * card points at their dashboard; everyone else lands on the checkout with
   * THAT path pre-selected, so the choice made here survives the navigation.
   */
  function hrefFor(pathId: string | null): string {
    if (context.enrolled) return context.dashboardUrl;
    return pathId
      ? checkoutUrlForPath(context.checkoutUrl, pathId)
      : context.checkoutUrl;
  }

  let mounted = $state(false);
  let reduced = $state(false);

  // Ambient loops (breathe / descent / pulse) only after JS confirms motion is
  // welcome; the static baseline stays the SSR / no-JS / reduced-motion render.
  const enhanced = $derived(mounted && !reduced);

  onMount(() => {
    mounted = true;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mql.matches;
    const onChange = (e: MediaQueryListEvent) => {
      reduced = e.matches;
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  });
</script>

<div class="invite" class:invite--enhanced={enhanced}>
  <!-- The descent: a hairline from above dropping a travelling spark that
       arrives at a glowing seed — "you have come all the way down". -->
  <div class="invite__descent" aria-hidden="true">
    <span class="invite__seed"></span>
  </div>

  <div class="invite__inner">
    <header class="invite__head">
      {#if eyebrow}
        <p class="invite__eyebrow invite__reveal" use:reveal>{eyebrow}</p>
      {/if}
      <h2 class="invite__heading invite__reveal invite__reveal--d1" use:reveal>
        {heading}
      </h2>
      {#if sub}
        <p class="invite__sub invite__reveal invite__reveal--d2" use:reveal>{sub}</p>
      {/if}
    </header>

    {#if paths.length > 0}
      <ul class="invite__offers invite__reveal invite__reveal--d3" use:reveal>
        {#each paths as path (path.id)}
          {@const href = hrefFor(path.id)}
          <li class="invite__offer" data-best={path.best ? 'true' : undefined}>
            {#if path.best}
              <span class="invite__badge">Recommended</span>
            {/if}
            <p class="invite__offer-name">{path.name}</p>
            <p class="invite__price">
              <span class="invite__price-amount">{path.priceLabel}</span>
              <span class="invite__price-cadence">{path.cadenceLabel}</span>
            </p>
            {#if path.blurb}
              <p class="invite__offer-blurb">{path.blurb}</p>
            {/if}
            <CtaLink
              {href}
              variant={path.best ? 'primary' : 'secondary'}
              size="md"
            >
              {ctaLabel}
            </CtaLink>
          </li>
        {/each}
      </ul>
    {:else}
      <div class="invite__single invite__reveal invite__reveal--d3" use:reveal>
        <!-- The threshold: a warm doorway seated on its own ember pool so
             beginning feels contained, safe, inevitable.

             NO price here by design. This branch is reached when the offer read
             was unavailable or the course has no purchasable path, and in both
             cases the checkout is the only surface that can state the terms. -->
        <div class="invite__pool" aria-hidden="true"></div>
        {#if priceNote}
          <p class="invite__note">{priceNote}</p>
        {/if}
        <CtaLink href={hrefFor(null)} variant="primary" size="lg">
          {ctaLabel}
        </CtaLink>
      </div>
    {/if}
  </div>
</div>

<style>
  /* THE INVITATION — the emotional close. You have descended; here is the
     ground, warm and waiting. Brand light rises from below, a descent-spark
     arrives, the offer is a warm threshold to step through. */
  .invite {
    position: relative;
    min-height: 100svh;
    display: grid;
    place-items: center;
    padding-block: var(--space-24) var(--space-20);
    padding-inline: var(--space-5);
    overflow: clip;
    isolation: isolate;
  }

  /* Warm ground: brand light rising from the floor + a settling dark base.
     This is the deep you arrive at — it fills the lower space, never a void. */
  .invite::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -2;
    pointer-events: none;
    background:
      radial-gradient(
        115% 62% at 50% 122%,
        color-mix(in oklab, var(--color-brand-accent) 26%, transparent),
        transparent 62%
      ),
      radial-gradient(
        85% 50% at 50% 112%,
        color-mix(in oklab, var(--color-brand-primary) 24%, transparent),
        transparent 58%
      ),
      linear-gradient(
        180deg,
        transparent 40%,
        color-mix(in oklab, var(--color-background) 62%, transparent)
      );
  }

  /* Centred vignette focuses the eye and deepens the cinematic close. */
  .invite::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background: radial-gradient(
      120% 90% at 50% 46%,
      transparent 52%,
      color-mix(in oklab, var(--color-background) 72%, transparent)
    );
  }

  /* ── the descent hairline + arriving spark + glowing seed ── */
  .invite__descent {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 1px;
    height: clamp(4rem, 13vh, 9.375rem);
    z-index: 0;
    pointer-events: none;
    background: linear-gradient(
      180deg,
      transparent,
      color-mix(in oklab, var(--color-brand-accent) 52%, transparent)
    );
  }

  .invite__descent::before {
    /* the arriving spark — hidden until the ambient loop animates it */
    content: '';
    position: absolute;
    left: 50%;
    top: -0.25rem;
    transform: translateX(-50%);
    width: 0.25rem;
    height: 0.25rem;
    border-radius: var(--radius-full);
    opacity: 0;
    background: var(--color-brand-accent);
    box-shadow: 0 0 12px 3px color-mix(in oklab, var(--color-brand-accent) 70%, transparent);
  }

  .invite__seed {
    /* the point of arrival — the ground */
    position: absolute;
    bottom: -0.25rem;
    left: 50%;
    transform: translateX(-50%);
    width: 0.4375rem;
    height: 0.4375rem;
    border-radius: var(--radius-full);
    background: var(--color-brand-accent);
    box-shadow: 0 0 18px 5px color-mix(in oklab, var(--color-brand-accent) 55%, transparent);
  }

  .invite__inner {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-10);
    max-width: 60rem;
    margin-inline: auto;
  }

  .invite__head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    max-width: 44rem;
    text-align: center;
  }

  .invite__eyebrow {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .invite__heading {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-display);
    line-height: var(--leading-tight);
    letter-spacing: -0.02em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  .invite__sub {
    margin: 0;
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .invite__offers {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-5);
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  @media (--breakpoint-md) {
    .invite__offers {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  .invite__offer {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-6);
    border-radius: var(--radius-card);
    border: var(--border-width) solid var(--color-border-subtle);
    background: var(--color-surface-secondary);
  }

  .invite__offer[data-best='true'] {
    border-color: var(--color-brand-primary);
  }

  .invite__badge {
    position: absolute;
    top: 0;
    right: var(--space-5);
    transform: translateY(-50%);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-text-on-brand);
    background: var(--color-brand-primary);
  }

  .invite__offer-name {
    margin: 0;
    font-weight: var(--font-semibold);
    font-size: var(--text-base);
    color: var(--color-text);
  }

  /* the threshold — a warm doorway to step through, seated on its own ember
     pool so beginning feels contained, safe, inevitable. */
  .invite__single {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-8) var(--space-10);
    border-radius: var(--radius-card);
    border: var(--border-width) solid
      color-mix(in oklab, var(--color-brand-accent) 22%, transparent);
    background: color-mix(in oklab, var(--color-surface) 60%, transparent);
    -webkit-backdrop-filter: blur(var(--blur-sm));
    backdrop-filter: blur(var(--blur-sm));
    text-align: center;
  }

  /* the warm pool it rests in */
  .invite__pool {
    position: absolute;
    inset: -14% -8% -34%;
    z-index: -1;
    pointer-events: none;
    background: radial-gradient(
      60% 65% at 50% 70%,
      color-mix(in oklab, var(--color-brand-accent) 20%, transparent),
      transparent 72%
    );
  }

  .invite__price {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin: 0;
  }

  .invite__price-amount {
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    color: var(--color-heading);
  }

  .invite__price-cadence,
  .invite__note {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .invite__offer-blurb {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
    flex-grow: 1;
  }

  /* ── reveal-on-scroll (shared `reveal` action) ──
     The hidden state is armed by JS (`reveal--armed`), never in static CSS, so
     SSR / no-JS / reduced-motion paint the fully-revealed content. `is-in` is
     added when the block crosses the viewport; stagger classes offset siblings. */
  .invite__reveal:global(.reveal--armed) {
    opacity: 0;
    transform: translateY(1.5rem);
    transition:
      opacity 0.9s var(--ease-out),
      transform 0.9s var(--ease-out);
  }

  .invite__reveal:global(.reveal--armed.is-in) {
    opacity: 1;
    transform: none;
  }

  .invite__reveal--d1:global(.reveal--armed) {
    transition-delay: 0.1s;
  }

  .invite__reveal--d2:global(.reveal--armed) {
    transition-delay: 0.22s;
  }

  .invite__reveal--d3:global(.reveal--armed) {
    transition-delay: 0.34s;
  }

  /* ── ENHANCED: ambient loops, only once JS confirms motion is welcome ── */
  .invite--enhanced::before {
    animation: invite-breathe 8s ease-in-out infinite;
  }

  .invite--enhanced .invite__descent::before {
    animation: invite-descend 5s var(--ease-out) infinite;
  }

  .invite--enhanced .invite__seed {
    animation: invite-pulse 5s ease-in-out infinite;
  }

  @keyframes invite-breathe {
    0%,
    100% {
      opacity: 0.84;
    }
    50% {
      opacity: 1;
    }
  }

  @keyframes invite-descend {
    0% {
      top: -0.25rem;
      opacity: 0;
    }
    18% {
      opacity: 1;
    }
    72% {
      opacity: 1;
    }
    100% {
      top: 100%;
      opacity: 0;
    }
  }

  @keyframes invite-pulse {
    0%,
    60%,
    100% {
      transform: translateX(-50%) scale(1);
      box-shadow: 0 0 18px 5px color-mix(in oklab, var(--color-brand-accent) 55%, transparent);
    }
    78% {
      transform: translateX(-50%) scale(1.5);
      box-shadow: 0 0 26px 8px color-mix(in oklab, var(--color-brand-accent) 72%, transparent);
    }
  }

  @media (max-width: 640px) {
    .invite__single {
      width: 100%;
      padding-inline: var(--space-6);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .invite::before {
      animation: none;
      opacity: 1;
    }
    .invite__descent::before {
      display: none;
    }
    .invite__seed {
      animation: none;
    }
    .invite__reveal:global(.reveal--armed) {
      transition: none;
    }
  }
</style>

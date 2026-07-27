<!--
  @component HeroSection

  Opening headline, kicker and primary CTA (SPEC §4.1 `hero`). Falls back to the
  awaited course fields when a copy prop is absent, so an unconfigured hero still
  renders a coherent first paint (SEO-critical).

  TWO renderings, progressively enhanced (mirrors AcheSection):
  • BASELINE (SSR, no-JS, reduced-motion): a clean, fully-legible centred column —
    every word visible, glow static, motes/scroll-cue hidden. This is what the
    server emits, so the section is never blank and never depends on JS. The
    headline sits on `--color-heading` over `--color-background`, legible on any
    org brand (dark included).
  • ENHANCED (browser + motion OK): the prototype's cinematic opening — a breathing
    warm core, slow rising motes, an edge vignette, a word-by-word kinetic headline,
    staggered fade-up entrances, a heart-beating trust dot and a descending
    scroll-cue spark.

  Enhancement is gated on `mounted && !reduced` (the `.hero--enhanced` class) so
  the accessible baseline always ships first; a `matchMedia` listener re-wires if
  the reduced-motion preference flips mid-session. All atmosphere is decorative
  and never load-bearing for legibility.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import CtaLink from '../CtaLink.svelte';
  import { asString } from '../coerce';
  import type { HeroSectionProps, JourneySalesContext } from '../types';
  import type { SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    context: JourneySalesContext;
  }

  const { config, context }: Props = $props();

  const p: HeroSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    headline: asString(config, 'headline'),
    subheadline: asString(config, 'subheadline'),
    ctaLabel: asString(config, 'ctaLabel'),
    secondaryLabel: asString(config, 'secondaryLabel'),
    secondaryHref: asString(config, 'secondaryHref'),
    trust: asString(config, 'trust'),
  });

  const eyebrow = $derived(p.eyebrow ?? context.course.kicker ?? undefined);
  const headline = $derived(p.headline ?? context.course.title);
  const subheadline = $derived(p.subheadline ?? context.course.lede ?? undefined);

  // Split the (dynamic) headline into words so each can animate in on a stagger —
  // the prototype's kinetic signature. Pure + SSR-safe; baseline just renders the
  // words inline with no motion.
  const words = $derived(headline.split(/\s+/).filter((w) => w.length > 0));

  // CTA branches on the viewer's enrolment (the sales page is otherwise fully
  // public): an enrolled member goes to their dashboard; everyone else is sent
  // to the offer/checkout surface to join.
  const ctaHref = $derived(
    context.enrolled ? context.dashboardUrl : context.checkoutUrl
  );
  const ctaLabel = $derived(
    context.enrolled
      ? 'Go to your dashboard'
      : (p.ctaLabel ?? 'Begin the journey')
  );

  // Decorative motes — count only; per-mote geometry lives in CSS (nth-child).
  const MOTE_COUNT = 12;
  const motes = Array.from({ length: MOTE_COUNT });

  let mounted = $state(false);
  let reduced = $state(false);

  // Motion is layered only once JS confirms it is welcome; otherwise the static
  // composed baseline above is what the viewer keeps.
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

<header class="hero" class:hero--enhanced={enhanced}>
  <div class="hero__atmos" aria-hidden="true">
    <div class="hero__glow"></div>
    <div class="hero__motes">
      {#each motes as _, i (i)}
        <span class="hero__mote"></span>
      {/each}
    </div>
    <div class="hero__vignette"></div>
  </div>

  <div class="hero__inner">
    {#if eyebrow}
      <p class="hero__eyebrow">{eyebrow}</p>
    {/if}

    <h1 class="hero__headline">
      {#each words as word, i (i)}
        <span class="hero__word" style="--word-i: {i}">{`${word} `}</span>
      {/each}
    </h1>

    {#if subheadline}
      <p class="hero__sub">{subheadline}</p>
    {/if}

    <div class="hero__actions">
      <CtaLink href={ctaHref} variant="primary" size="lg">
        {ctaLabel}
      </CtaLink>
      {#if p.secondaryLabel && p.secondaryHref}
        <CtaLink href={p.secondaryHref} variant="secondary" size="lg">
          {p.secondaryLabel}
        </CtaLink>
      {/if}
    </div>

    {#if p.trust}
      <p class="hero__trust">
        <span class="hero__trust-dot" aria-hidden="true"></span>
        {p.trust}
      </p>
    {/if}
  </div>

  <!-- Scroll cue: a light descending a hairline. Enhancement-only + decorative. -->
  <div class="hero__cue" aria-hidden="true">
    <span class="hero__cue-line"><span class="hero__cue-spark"></span></span>
    <svg
      class="hero__cue-chevron"
      width="16"
      height="10"
      viewBox="0 0 16 10"
      fill="none"
    >
      <path
        d="M1 1l7 7 7-7"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </div>
</header>

<style>
  .hero {
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    min-height: 100svh;
    padding-block: var(--space-24) var(--space-16);
    padding-inline: var(--space-5);
    overflow: hidden;
    text-align: center;
  }

  /* ── atmosphere layers (all decorative, behind content) ── */
  .hero__atmos {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
  }

  /* breathing warm core — the "living light" behind the headline */
  .hero__glow {
    position: absolute;
    left: 50%;
    top: 40%;
    width: min(92vw, 48.75rem);
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
    border-radius: var(--radius-full);
    opacity: 0.55;
    filter: blur(var(--blur-2xl));
    background: radial-gradient(
      circle at 50% 46%,
      color-mix(in oklab, var(--color-brand-primary) 24%, transparent),
      color-mix(in oklab, var(--color-brand-accent) 14%, transparent) 46%,
      transparent 70%
    );
  }

  /* slow rising embers — hidden in the baseline (they only read while moving) */
  .hero__motes {
    position: absolute;
    inset: 0;
    overflow: hidden;
    display: none;
  }

  .hero__mote {
    position: absolute;
    bottom: -0.75rem;
    width: 0.1875rem;
    height: 0.1875rem;
    border-radius: var(--radius-full);
    opacity: 0;
    background: radial-gradient(
      circle,
      color-mix(in oklab, var(--color-brand-primary) 92%, white),
      color-mix(in oklab, var(--color-brand-primary) 20%, transparent) 70%
    );
    box-shadow: 0 0 6px color-mix(in oklab, var(--color-brand-primary) 55%, transparent);
  }

  /* edge vignette to focus the centre and blend into the next section.
     Theme-aware: darkens toward the page background (subtle on light themes). */
  .hero__vignette {
    position: absolute;
    inset: 0;
    background: radial-gradient(
      125% 95% at 50% 42%,
      transparent 55%,
      color-mix(in oklab, var(--color-background) 58%, transparent) 100%
    );
  }

  /* ── content column ── */
  .hero__inner {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-5);
    width: 100%;
    max-width: 56rem;
    margin-inline: auto;
  }

  .hero__eyebrow {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .hero__headline {
    margin: 0;
    max-width: 16ch;
    margin-inline: auto;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-display);
    line-height: var(--leading-tight);
    letter-spacing: -0.02em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  /* Baseline: plain inline words. Enhancement upgrades to inline-block + stagger. */
  .hero__word {
    white-space: pre;
  }

  .hero__sub {
    margin: 0;
    max-width: 42ch;
    margin-inline: auto;
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
    text-wrap: pretty;
  }

  .hero__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .hero__trust {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-3) 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }

  .hero__trust-dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-brand-primary);
    box-shadow: 0 0 0 var(--space-1)
      color-mix(in oklab, var(--color-brand-primary) 22%, transparent);
  }

  /* ── scroll cue: hidden in the baseline, revealed only when enhanced ── */
  .hero__cue {
    position: absolute;
    bottom: clamp(var(--space-3), 3vh, var(--space-8));
    left: 0;
    right: 0;
    z-index: 1;
    margin-inline: auto;
    width: max-content;
    display: none;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-tertiary);
  }

  .hero__cue-line {
    position: relative;
    width: 1px;
    height: 2.875rem;
    overflow: hidden;
    background: linear-gradient(
      to bottom,
      transparent,
      color-mix(in oklab, var(--color-heading) 22%, transparent) 45%,
      transparent
    );
  }

  .hero__cue-spark {
    position: absolute;
    left: 50%;
    top: 0;
    width: 0.1875rem;
    height: 0.6875rem;
    margin-left: -0.09375rem;
    border-radius: var(--radius-sm);
    background: linear-gradient(var(--color-brand-primary), transparent);
    box-shadow: 0 0 9px color-mix(in oklab, var(--color-brand-primary) 80%, transparent);
  }

  .hero__cue-chevron {
    color: var(--color-text-tertiary);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ENHANCED — layered on top of the legible baseline once JS confirms motion
     is welcome (`.hero--enhanced`). Nothing here is required for legibility.
     ═══════════════════════════════════════════════════════════════════════ */

  .hero--enhanced .hero__glow {
    animation: hero-breathe 11s ease-in-out infinite;
  }

  .hero--enhanced .hero__motes {
    display: block;
  }

  .hero--enhanced .hero__mote {
    animation: hero-rise linear infinite;
  }

  /* Per-mote geometry — left position, size, drift (--dx), peak opacity (--o),
     duration + delay. Sizes/offsets in rem + viewport units (no hardcoded px). */
  .hero--enhanced .hero__mote:nth-child(1)  { left: 7%;  width: 0.125rem;  height: 0.125rem;  --dx: 1.125rem;  --o: 0.40; animation-duration: 20s; animation-delay: 0s; }
  .hero--enhanced .hero__mote:nth-child(2)  { left: 15%; width: 0.1875rem; height: 0.1875rem; --dx: -0.9375rem; --o: 0.34; animation-duration: 25s; animation-delay: 3s; }
  .hero--enhanced .hero__mote:nth-child(3)  { left: 24%; width: 0.125rem;  height: 0.125rem;  --dx: 1.375rem;  --o: 0.48; animation-duration: 16s; animation-delay: 6s; }
  .hero--enhanced .hero__mote:nth-child(4)  { left: 33%; width: 0.25rem;   height: 0.25rem;   --dx: -0.625rem; --o: 0.30; animation-duration: 28s; animation-delay: 1s; }
  .hero--enhanced .hero__mote:nth-child(5)  { left: 42%; width: 0.125rem;  height: 0.125rem;  --dx: 0.8125rem; --o: 0.52; animation-duration: 21s; animation-delay: 9s; }
  .hero--enhanced .hero__mote:nth-child(6)  { left: 50%; width: 0.1875rem; height: 0.1875rem; --dx: -1.3125rem; --o: 0.38; animation-duration: 26s; animation-delay: 4s; }
  .hero--enhanced .hero__mote:nth-child(7)  { left: 59%; width: 0.125rem;  height: 0.125rem;  --dx: 1rem;      --o: 0.46; animation-duration: 18s; animation-delay: 11s; }
  .hero--enhanced .hero__mote:nth-child(8)  { left: 67%; width: 0.1875rem; height: 0.1875rem; --dx: -0.75rem;  --o: 0.34; animation-duration: 23s; animation-delay: 2s; }
  .hero--enhanced .hero__mote:nth-child(9)  { left: 76%; width: 0.125rem;  height: 0.125rem;  --dx: 1.25rem;   --o: 0.50; animation-duration: 17s; animation-delay: 7s; }
  .hero--enhanced .hero__mote:nth-child(10) { left: 84%; width: 0.25rem;   height: 0.25rem;   --dx: -1rem;     --o: 0.28; animation-duration: 27s; animation-delay: 5s; }
  .hero--enhanced .hero__mote:nth-child(11) { left: 91%; width: 0.125rem;  height: 0.125rem;  --dx: 0.6875rem; --o: 0.44; animation-duration: 20s; animation-delay: 10s; }
  .hero--enhanced .hero__mote:nth-child(12) { left: 96%; width: 0.1875rem; height: 0.1875rem; --dx: -1.125rem; --o: 0.36; animation-duration: 22s; animation-delay: 13s; }

  /* Kinetic headline — each word rises + de-blurs on its own beat. */
  .hero--enhanced .hero__word {
    display: inline-block;
    animation: hero-word-in 0.9s var(--ease-out) both;
    animation-delay: calc(var(--word-i, 0) * 0.08s + 0.2s);
  }

  /* Staggered fade-up entrances for the surrounding copy. */
  .hero--enhanced .hero__eyebrow {
    animation: hero-fade-up 0.8s var(--ease-out) 0.1s both;
  }
  .hero--enhanced .hero__sub {
    animation: hero-fade-up 0.8s var(--ease-out) 1.05s both;
  }
  .hero--enhanced .hero__actions {
    animation: hero-fade-up 0.8s var(--ease-out) 1.25s both;
  }
  .hero--enhanced .hero__trust {
    animation: hero-fade-up 0.8s var(--ease-out) 1.42s both;
  }
  .hero--enhanced .hero__trust-dot {
    animation: hero-heartbeat 4.5s ease-in-out infinite;
  }

  .hero--enhanced .hero__cue {
    display: flex;
    animation: hero-fade-up 0.9s var(--ease-out) 1.65s both;
  }
  .hero--enhanced .hero__cue-spark {
    animation: hero-spark 2.8s var(--ease-out) infinite;
  }
  .hero--enhanced .hero__cue-chevron {
    animation: hero-cue-bob 2.8s ease-in-out infinite;
  }

  @keyframes hero-word-in {
    from {
      opacity: 0;
      transform: translateY(0.42em);
      filter: blur(10px);
    }
    to {
      opacity: 1;
      transform: none;
      filter: blur(0);
    }
  }

  @keyframes hero-fade-up {
    from {
      opacity: 0;
      transform: translateY(1.125rem);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes hero-breathe {
    0%,
    100% {
      transform: translate(-50%, -50%) scale(1);
      opacity: 0.5;
    }
    50% {
      transform: translate(-50%, -50%) scale(1.09);
      opacity: 0.78;
    }
  }

  @keyframes hero-rise {
    0% {
      transform: translate3d(0, 0, 0);
      opacity: 0;
    }
    12% {
      opacity: var(--o, 0.42);
    }
    50% {
      transform: translate3d(calc(var(--dx, 0.75rem) * 0.5), -48vh, 0);
    }
    88% {
      opacity: var(--o, 0.42);
    }
    100% {
      transform: translate3d(var(--dx, 0.75rem), -94vh, 0);
      opacity: 0;
    }
  }

  @keyframes hero-heartbeat {
    0%,
    100% {
      transform: scale(1);
      opacity: 0.9;
    }
    50% {
      transform: scale(1.35);
      opacity: 0.5;
    }
  }

  @keyframes hero-spark {
    0% {
      transform: translateY(0);
      opacity: 0;
    }
    22% {
      opacity: 1;
    }
    78% {
      opacity: 1;
    }
    100% {
      transform: translateY(2.3125rem);
      opacity: 0;
    }
  }

  @keyframes hero-cue-bob {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(0.1875rem);
    }
  }

  @media (max-width: 35rem) {
    .hero__actions {
      flex-direction: column;
      align-items: stretch;
    }
  }

  /* Belt-and-braces: even if `.hero--enhanced` is applied, honour a reduced-motion
     preference by holding the final composed state (the enhanced flag already
     gates this, but this covers a mid-animation preference flip). */
  @media (prefers-reduced-motion: reduce) {
    .hero__glow,
    .hero__mote,
    .hero__word,
    .hero__eyebrow,
    .hero__sub,
    .hero__actions,
    .hero__trust,
    .hero__trust-dot,
    .hero__cue,
    .hero__cue-spark,
    .hero__cue-chevron {
      animation: none !important;
    }
    .hero__word {
      opacity: 1;
      transform: none;
      filter: none;
    }
    .hero__motes {
      display: none;
    }
  }
</style>

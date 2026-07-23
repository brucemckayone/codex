<!--
  @component HeroSection

  Opening headline, kicker and primary CTA (SPEC §4.1 `hero`). Falls back to the
  awaited course fields when a copy prop is absent, so an unconfigured hero still
  renders a coherent first paint (SEO-critical). Atmosphere is purely decorative
  and never load-bearing for legibility — the headline sits on `--color-heading`
  over `--color-background`, which stays legible on any org brand (dark included).
-->
<script lang="ts">
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
  });

  const eyebrow = $derived(p.eyebrow ?? context.course.kicker ?? undefined);
  const headline = $derived(p.headline ?? context.course.title);
  const subheadline = $derived(p.subheadline ?? context.course.lede ?? undefined);
  const ctaLabel = $derived(p.ctaLabel ?? 'Begin the journey');
</script>

<div class="hero">
  <div class="hero__glow" aria-hidden="true"></div>
  <div class="hero__inner">
    {#if eyebrow}
      <p class="hero__eyebrow">{eyebrow}</p>
    {/if}
    <h1 class="hero__headline">{headline}</h1>
    {#if subheadline}
      <p class="hero__sub">{subheadline}</p>
    {/if}
    <div class="hero__actions">
      <CtaLink href={context.checkoutUrl} variant="primary" size="lg">
        {ctaLabel}
      </CtaLink>
      {#if p.secondaryLabel && p.secondaryHref}
        <CtaLink href={p.secondaryHref} variant="secondary" size="lg">
          {p.secondaryLabel}
        </CtaLink>
      {/if}
    </div>
  </div>
</div>

<style>
  .hero {
    position: relative;
    isolation: isolate;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: min(88svh, 720px);
    padding-block: var(--space-16);
    overflow: hidden;
    text-align: center;
  }

  /* Decorative warm core — subtle, never relied on for contrast. */
  .hero__glow {
    position: absolute;
    z-index: -1;
    left: 50%;
    top: 42%;
    width: min(90vw, 780px);
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
    border-radius: var(--radius-full);
    opacity: 0.5;
    filter: blur(var(--blur-2xl));
    pointer-events: none;
    background: radial-gradient(
      circle at 50% 46%,
      color-mix(in oklab, var(--color-brand-primary) 22%, transparent),
      color-mix(in oklab, var(--color-brand-accent) 12%, transparent) 46%,
      transparent 70%
    );
  }

  .hero__inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-5);
    max-width: 56rem;
    padding-inline: var(--space-5);
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
    font-family: var(--font-heading);
    font-size: var(--text-display);
    line-height: var(--leading-tight);
    letter-spacing: -0.02em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  .hero__sub {
    margin: 0;
    max-width: 42ch;
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
    text-wrap: pretty;
  }

  .hero__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }
</style>

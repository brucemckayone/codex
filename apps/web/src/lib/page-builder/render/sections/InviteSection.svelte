<!--
  @component InviteSection

  The offer and pricing (SPEC §4.1 `invite`) — the primary conversion moment. The
  frozen `JourneyCoursePage` carries only the one-off `course.priceCents`; the
  full 3-path offer model (tier / course-subscription / course-purchase, SPEC §7)
  lives on the checkout route (WP-6). When the builder teases offer paths via the
  `offers` prop they render as cards; otherwise the invite shows the one-off
  price. Every path funnels to `context.checkoutUrl`. Currency is GBP.
-->
<script lang="ts">
  import { formatPrice } from '$lib/utils/format';
  import CtaLink from '../CtaLink.svelte';
  import { asString, asObjectArray, fieldString, fieldBool } from '../coerce';
  import type { InviteSectionProps, InviteOffer, JourneySalesContext } from '../types';
  import type { SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    context: JourneySalesContext;
  }

  const { config, context }: Props = $props();

  const p: InviteSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    heading: asString(config, 'heading'),
    sub: asString(config, 'sub'),
    ctaLabel: asString(config, 'ctaLabel'),
    priceNote: asString(config, 'priceNote'),
    offers: asObjectArray<InviteOffer>(config, 'offers', (entry) => {
      const id = fieldString(entry, 'id');
      const name = fieldString(entry, 'name');
      const priceLabel = fieldString(entry, 'priceLabel');
      if (!id || !name || !priceLabel) return null;
      return {
        id,
        name,
        priceLabel,
        cadenceLabel: fieldString(entry, 'cadenceLabel'),
        blurb: fieldString(entry, 'blurb'),
        best: fieldBool(entry, 'best'),
      };
    }),
  });

  const heading = $derived(p.heading ?? 'Begin the work.');
  const ctaLabel = $derived(p.ctaLabel ?? 'Join now');
  // One-off price fallback when no offer paths are teased on the sell page.
  const oneOffPrice = $derived(
    context.course.priceCents !== null ? formatPrice(context.course.priceCents) : null
  );
</script>

<div class="invite">
  <div class="invite__inner">
    <header class="invite__head">
      {#if p.eyebrow}
        <p class="invite__eyebrow">{p.eyebrow}</p>
      {/if}
      <h2 class="invite__heading">{heading}</h2>
      {#if p.sub}
        <p class="invite__sub">{p.sub}</p>
      {/if}
    </header>

    {#if p.offers}
      <ul class="invite__offers">
        {#each p.offers as offer (offer.id)}
          <li class="invite__offer" data-best={offer.best ? 'true' : undefined}>
            {#if offer.best}
              <span class="invite__badge">Recommended</span>
            {/if}
            <p class="invite__offer-name">{offer.name}</p>
            <p class="invite__price">
              <span class="invite__price-amount">{offer.priceLabel}</span>
              {#if offer.cadenceLabel}
                <span class="invite__price-cadence">{offer.cadenceLabel}</span>
              {/if}
            </p>
            {#if offer.blurb}
              <p class="invite__offer-blurb">{offer.blurb}</p>
            {/if}
            <CtaLink
              href={context.checkoutUrl}
              variant={offer.best ? 'primary' : 'secondary'}
              size="md"
            >
              {ctaLabel}
            </CtaLink>
          </li>
        {/each}
      </ul>
    {:else}
      <div class="invite__single">
        {#if oneOffPrice}
          <p class="invite__price">
            <span class="invite__price-amount">{oneOffPrice}</span>
          </p>
        {/if}
        {#if p.priceNote}
          <p class="invite__note">{p.priceNote}</p>
        {/if}
        <CtaLink href={context.checkoutUrl} variant="primary" size="lg">
          {ctaLabel}
        </CtaLink>
      </div>
    {/if}
  </div>
</div>

<style>
  .invite {
    padding-block: var(--space-24);
    padding-inline: var(--space-5);
  }

  .invite__inner {
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

  .invite__single {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    text-align: center;
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
</style>

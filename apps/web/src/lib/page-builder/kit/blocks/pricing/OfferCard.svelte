<!--
  @component OfferCard

  One real way in: its name, the price and cadence the live offer charges, the
  copy that describes it, and a button that deep-links the checkout to exactly
  this path. The recommended card renders in its own nested colour scheme, so
  its button is contrasted against the CARD, not the section around it.
-->
<script lang="ts">
  import type { OfferPath } from '../../../offer-paths';
  import type { JourneySalesContext } from '../../../render/types';
  import { COPY, pathActionName } from '../../model/copy';
  import { pathHref } from '../../model/cta';
  import type { ColourSchemeId } from '../../model/ids';
  import type { BlockEdit } from '../../model/types';
  import Button from '../../primitives/Button.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import List from '../../primitives/List.svelte';

  interface Props {
    path: OfferPath;
    context: JourneySalesContext;
    label: string;
    note: string;
    /** The nested scheme of the recommended card; absent = transparent card. */
    scheme?: ColourSchemeId;
    /** "Recommended" means something only when there is a choice. */
    badge?: boolean;
    size?: 'card' | 'focus';
    /** Only one card edits the shared button label inline. */
    editable?: boolean;
    edit?: BlockEdit | null;
  }

  const {
    path,
    context,
    label,
    note,
    scheme,
    badge = false,
    size = 'card',
    editable = false,
    edit = null,
  }: Props = $props();
</script>

<article
  class="offer"
  data-size={size}
  data-featured={scheme ? '' : undefined}
  data-lp-scheme={scheme}
>
  <div class="offer__top">
    <Heading level={3} size="title" text={path.name} type="pricing" />
    {#if badge && path.best}<p class="offer__badge">{COPY.pricing.recommended}</p>{/if}
  </div>
  {#if path.who}<p class="offer__who">{path.who}</p>{/if}
  <p class="offer__price">
    <span class="offer__amount">{path.priceLabel}</span>
    <span class="offer__cadence">{path.cadenceLabel}</span>
  </p>
  {#if path.blurb}<p class="offer__blurb">{path.blurb}</p>{/if}
  {#if path.bullets.length > 0}<List items={path.bullets} />{/if}
  <div class="offer__action">
    <Button
      href={pathHref(context, path)}
      {label}
      name={pathActionName(label, path)}
      variant={scheme || size === 'focus' ? 'primary' : 'outline'}
      size={size === 'focus' ? 'lg' : 'md'}
      section="pricing"
      field={editable ? 'ctaLabel' : undefined}
      {edit}
    />
    <p class="offer__note">{note}</p>
  </div>
</article>

<style>
  .offer {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6);
    border: var(--lp-border) var(--border-style) var(--lp-line);
    border-radius: var(--lp-radius-card);
    color: var(--lp-ink);
  }

  .offer[data-featured] {
    background: var(--lp-bg);
    border-color: var(--lp-bg);
  }

  .offer[data-size='focus'] {
    gap: var(--space-5);
    padding: clamp(var(--space-6), var(--space-4) + 3cqi, var(--space-12));
  }

  .offer__top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
  }

  .offer__badge {
    margin: 0;
    padding: var(--space-0-5) var(--space-2-5);
    border: var(--lp-border) var(--border-style) var(--lp-button-line);
    border-radius: var(--lp-radius-chip);
    font-size: var(--lp-size-label);
    font-weight: var(--lp-weight-label);
    line-height: var(--lp-leading-title);
  }

  .offer__who,
  .offer__blurb,
  .offer__note {
    margin: 0;
    color: var(--lp-ink-soft);
  }

  .offer__who,
  .offer__note {
    font-size: var(--lp-size-small);
  }

  .offer__blurb {
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-body);
  }

  .offer__price {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-2);
    margin: 0;
  }

  .offer__amount {
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-heading);
    font-weight: var(--lp-weight-display);
    font-synthesis: none;
    font-variant-numeric: lining-nums tabular-nums;
    line-height: var(--lp-leading-display);
    letter-spacing: var(--lp-tracking-heading);
  }

  .offer[data-size='focus'] .offer__amount {
    font-size: var(--lp-size-price);
    letter-spacing: var(--lp-tracking-display);
  }

  .offer__cadence {
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-body);
  }

  .offer__action {
    display: grid;
    justify-items: start;
    gap: var(--space-2);
    margin-block-start: auto;
    padding-block-start: var(--space-2);
  }

  /* A phone-width band: the way in spans the card, as every way in does there. */
  @container (max-width: 30rem) {
    .offer__action {
      justify-items: stretch;
    }
  }

  /* Bold: open columns under a hard ink rule; only the featured card is a block. */
  :global(.lp[data-lp-style='bold']) .offer:not([data-featured]) {
    padding-inline: 0;
    border: none;
    border-block-start: var(--lp-rule) var(--border-style) var(--lp-ink);
    border-radius: 0;
  }
</style>

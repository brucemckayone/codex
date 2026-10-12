<!--
  @component OfferAsk

  The page's own ask with its price: the closing ask's offer, on its own, so
  the call to action and a Button section (03 X64) draw one ask one way and
  can never disagree.

  While the page is priced it sets the recommended path's price and period
  above the button, which deep-links the checkout to that path, and under it
  that path's own billing line (`derivedNote`), never authored small print.
  Every other state has its next step from `ButtonRow`: "Continue" for a
  member, the closed notice when there is no way in, or a price-less button
  when the offer could not be read.

  The path is the PAGE's (`getKitPage().offerProps`, the pricing section's
  own choices), so it is the one the pricing section and the floating bar
  recommend (Codex-61zsk.39).

  The class names are the closing ask's own (`cta__offer` …): extracted from
  `CtaBlock` with its markup unchanged.
-->
<script lang="ts">
  import type { JourneySalesContext } from '../../render/types';
  import { COPY, derivedNote, pathActionName } from '../model/copy';
  import { pathHref } from '../model/cta';
  import type { SectionTypeId } from '../model/ids';
  import { pricingView } from '../model/offer';
  import type { BlockEdit } from '../model/types';
  import { getKitPage } from '../page-context';
  import Button from './Button.svelte';
  import ButtonRow from './ButtonRow.svelte';

  interface Props {
    context: JourneySalesContext;
    /** The section whose `ctaLabel` this edits inline. */
    section: SectionTypeId;
    /** The creator's `ctaLabel`; "Join now" when they wrote none. */
    label?: string;
    size?: 'md' | 'lg';
    edit?: BlockEdit | null;
  }

  const { context, section, label, size = 'lg', edit = null }: Props = $props();

  const page = getKitPage();
  const view = $derived(pricingView(context, page.offerProps));
  const text = $derived(label ?? COPY.cta.buy);
</script>

{#if view.featured}
  <div class="cta__offer">
    <p class="cta__price">
      <span class="cta__amount">{view.featured.priceLabel}</span>
      <span class="cta__cadence">{view.featured.cadenceLabel}</span>
    </p>
    <Button
      href={pathHref(context, view.featured)}
      label={text}
      name={pathActionName(text, view.featured)}
      {size}
      {section}
      field="ctaLabel"
      {edit}
    />
    <p class="cta__billing">{derivedNote(view.featured)}</p>
  </div>
{:else}
  <ButtonRow {context} {section} {label} {size} {edit} />
{/if}

<style>
  /* Aligned as the Style aligns a section's actions (`--lp-actions-align`, as
     ButtonRow reads it), so a centred band centres its offer too. */
  .cta__offer {
    --_align: var(--lp-actions-align, start);
    display: grid;
    gap: var(--space-3);
    justify-items: var(--_align);
    text-align: var(--_align);
  }

  .cta__price {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: var(--_align);
    gap: var(--space-1) var(--space-2);
    margin: 0;
  }

  .cta__amount {
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-title);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
    font-variant-numeric: lining-nums tabular-nums;
    line-height: var(--lp-leading-title);
  }

  .cta__cadence,
  .cta__billing {
    color: var(--lp-ink-soft);
  }

  .cta__cadence {
    font-size: var(--lp-size-body);
  }

  .cta__billing {
    margin: 0;
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-body);
  }

  /* A phone-width band: the way in spans it, as every way in does there. */
  @container (max-width: 30rem) {
    .cta__offer {
      justify-self: stretch;
      justify-items: stretch;
    }
  }
</style>

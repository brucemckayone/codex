<!--
  @component CtaBlock

  An invitation to join, anywhere on the page. Three layouts:
    band    — a big closing band: large heading, the words, the offer
    split   — the words on one side; on the other a panel with the offer
    compact — one line and the offer, to sit between sections

  The button travels with the offer it sells. While the page is priced, every
  layout sets the recommended path's price and period beside the button, which
  deep-links the checkout to that path (as the pricing strip does), and under
  it that path's own billing line — never the creator's note, which is the
  section's words. Every other state has its next step from `ButtonRow`:
  "Continue" (enrolled), the closed notice (no way in), or a price-less button
  (the offer could not be read).

  `band` may carry the creator's background image (contract A5): the whole
  band sits on the media ink set, over a full-strength scrim, so every line is
  legible wherever the Style aligns it.
-->
<script lang="ts">
  import { resolvePageImageUrl } from '../../../page-images';
  import { COPY, derivedNote, pathActionName } from '../../model/copy';
  import { pathHref } from '../../model/cta';
  import { pricingView } from '../../model/offer';
  import { featuredScheme } from '../../model/resolve';
  import type { BlockProps } from '../../model/types';
  import { getKitPage } from '../../page-context';
  import Button from '../../primitives/Button.svelte';
  import ButtonRow from '../../primitives/ButtonRow.svelte';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Media from '../../primitives/Media.svelte';
  import Text from '../../primitives/Text.svelte';
  import { ctaDefinition } from './definition';

  const { props, section, context, edit }: BlockProps = $props();

  const page = getKitPage();
  const content = $derived(ctaDefinition.coerce(props));
  const layout = $derived(section.layout);
  const view = $derived(pricingView(context, {}));
  // The note reassures a buyer: it has no place once there is nothing to buy.
  const selling = $derived(view.state === 'priced' || view.state === 'unpriced');
  const label = $derived(content.ctaLabel ?? COPY.cta.buy);
  const panel = $derived(featuredScheme(page.style, section.scheme));
  const backdrop = $derived(
    layout === 'band'
      ? resolvePageImageUrl(content.background, 'lg', context.mediaBaseUrl)
      : null
  );
</script>

{#snippet words(size: 'heading' | 'title')}
  {#if content.eyebrow}<Eyebrow text={content.eyebrow} type="cta" {edit} />{/if}
  {#if content.heading}
    <Heading
      level={section.headingLevel}
      {size}
      text={content.heading}
      type="cta"
      field="heading"
      {edit}
    />
  {/if}
  {#if content.body}
    <Text
      text={content.body}
      size={size === 'heading' ? 'lead' : 'body'}
      type="cta"
      field="body"
      {edit}
    />
  {/if}
  {#if content.note && selling}
    <Text
      text={content.note}
      size={size === 'heading' ? 'body' : 'small'}
      type="cta"
      field="note"
      {edit}
    />
  {/if}
{/snippet}

{#snippet offer(size: 'md' | 'lg')}
  {#if view.featured}
    <div class="cta__offer">
      <p class="cta__price">
        <span class="cta__amount">{view.featured.priceLabel}</span>
        <span class="cta__cadence">{view.featured.cadenceLabel}</span>
      </p>
      <Button
        href={pathHref(context, view.featured)}
        {label}
        name={pathActionName(label, view.featured)}
        {size}
        section="cta"
        field="ctaLabel"
        {edit}
      />
      <p class="cta__billing">{derivedNote(view.featured)}</p>
    </div>
  {:else}
    <ButtonRow {context} section="cta" label={content.ctaLabel} {size} {edit} />
  {/if}
{/snippet}

<div class="cta" data-layout={layout} data-lp-on-media={backdrop ? '' : undefined}>
  {#if backdrop}
    <div class="cta__backdrop">
      <Media image={backdrop} alt={content.background?.alt ?? ''} />
    </div>
  {:else}
    <span class="lp-atmos cta__atmos" data-drift aria-hidden="true"></span>
  {/if}
  {#if layout === 'split'}
    <div class="cta__words">{@render words('heading')}</div>
    <div class="cta__panel" data-lp-scheme={panel}>{@render offer('lg')}</div>
  {:else if layout === 'compact'}
    <div class="cta__words">{@render words('title')}</div>
    {@render offer('md')}
  {:else}
    <div class="cta__words">{@render words('heading')}</div>
    {@render offer('lg')}
  {/if}
</div>

<style>
  /* Not positioned: the glow is placed against the SECTION, so it fills the
     whole band rather than the content column. */
  .cta {
    display: grid;
    gap: var(--lp-gap);
    isolation: isolate;
  }

  /* The heading measures itself in its own `ch`; the body keeps its measure. */
  .cta__words {
    display: grid;
    gap: var(--lp-stack);
  }

  .cta__words :global(.lp-heading) {
    max-inline-size: 18ch;
  }

  /* The glow belongs to Cinematic's dark room only; on a light band it would
     be a gradient wash. */
  .cta__atmos {
    display: none;
  }

  :global(.lp[data-lp-style='cinematic']) .cta__atmos {
    display: block;
  }

  /* ── band ──────────────────────────────────────────────────────────────── */
  .cta[data-layout='band'] {
    --lp-size-heading: var(--lp-size-cta);
    padding-block: var(--space-4);
  }

  /* Placed against the SECTION like the glow, so it fills the band edge to
     edge. The scrim is uniform: the copy may sit anywhere the Style puts it. */
  .cta__backdrop {
    position: absolute;
    inset: 0;
    z-index: -1;
    display: grid;
  }

  .cta__backdrop :global(.lp-media) {
    border-radius: 0;
  }

  .cta__backdrop::after {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--lp-media-scrim);
    pointer-events: none;
  }

  /* Centred all the way down: a measured paragraph centres its own box too. */
  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic']))
    .cta[data-layout='band'],
  :global(.lp:is([data-lp-style='soft'], [data-lp-style='cinematic']))
    .cta[data-layout='band']
    .cta__words {
    --lp-actions-align: center;
    justify-items: center;
    text-align: center;
  }

  /* ── split ─────────────────────────────────────────────────────────────── */
  .cta__panel {
    display: grid;
    gap: var(--space-4);
    justify-items: start;
    align-self: center;
    padding: clamp(var(--space-6), var(--space-4) + 3cqi, var(--space-12));
    border-radius: var(--lp-radius-card);
    background: var(--lp-bg);
    color: var(--lp-ink);
  }

  @container (min-width: 56rem) {
    .cta[data-layout='split'] {
      grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
      align-items: center;
    }
  }

  /* ── compact ───────────────────────────────────────────────────────────── */
  /* One line where it fits: the 18ch cap is for the band's display heading. */
  .cta[data-layout='compact'] .cta__words :global(.lp-heading) {
    max-inline-size: var(--lp-measure);
  }

  @container (min-width: 48rem) {
    .cta[data-layout='compact'] {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
    }
  }

  /* ── the offer: price and period, the button, its own billing line ─────── */
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

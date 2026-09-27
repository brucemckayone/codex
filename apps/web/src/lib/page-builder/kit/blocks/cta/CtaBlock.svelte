<!--
  @component CtaBlock

  An invitation to join, anywhere on the page. Three layouts:
    band    — a big closing band: large heading, the words, the button
    split   — the words on one side; on the other a panel with the recommended
              path's real price and the button
    compact — one line and a button, to sit between sections

  Every state has its next step: the button (buy), "Continue" (enrolled) or the
  closed notice (no way in) — all decided by `ButtonRow`. The price line in
  `split` comes from the live offer, and is simply absent when there is none.

  `band` may carry the creator's background image (contract A5): the whole
  band sits on the media ink set, over a full-strength scrim, so every line is
  legible wherever the Style aligns it.
-->
<script lang="ts">
  import { resolvePageImageUrl } from '../../../page-images';
  import { priceWithCadence } from '../../model/copy';
  import { pricingView } from '../../model/offer';
  import { featuredScheme } from '../../model/resolve';
  import type { BlockProps } from '../../model/types';
  import { getKitPage } from '../../page-context';
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
    <div class="cta__panel" data-lp-scheme={panel}>
      {#if view.featured}
        <p class="cta__price">{priceWithCadence(view.featured)}</p>
      {/if}
      <ButtonRow {context} section="cta" label={content.ctaLabel} note={content.note} {edit} />
    </div>
  {:else if layout === 'compact'}
    <div class="cta__words">{@render words('title')}</div>
    <ButtonRow
      {context}
      section="cta"
      label={content.ctaLabel}
      note={content.note}
      size="md"
      {edit}
    />
  {:else}
    <div class="cta__words">{@render words('heading')}</div>
    <ButtonRow {context} section="cta" label={content.ctaLabel} note={content.note} {edit} />
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

  .cta__price {
    margin: 0;
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-title);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
    font-variant-numeric: lining-nums tabular-nums;
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
</style>

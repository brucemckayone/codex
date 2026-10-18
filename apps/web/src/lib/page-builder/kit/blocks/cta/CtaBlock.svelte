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
  legible wherever the Style aligns it. The image runs edge to edge, so it
  offers every size it has, drawn at the viewport's width (Codex-61zsk.13).
-->
<script lang="ts">
  import { pageImageSrcset, resolvePageImageUrl } from '../../../page-images';
  import { pricingView } from '../../model/offer';
  import { featuredScheme } from '../../model/resolve';
  import type { BlockProps } from '../../model/types';
  import { getKitPage } from '../../page-context';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Media from '../../primitives/Media.svelte';
  import OfferAsk from '../../primitives/OfferAsk.svelte';
  import Text from '../../primitives/Text.svelte';
  import { ctaDefinition } from './definition';

  const { props, section, context, edit }: BlockProps = $props();

  const page = getKitPage();
  const content = $derived(ctaDefinition.coerce(props));
  const layout = $derived(section.layout);
  // The page's own offer choices, so the path featured here is the one the
  // pricing section and the floating bar recommend (Codex-61zsk.39).
  const view = $derived(pricingView(context, page.offerProps));
  // The note reassures a buyer: it has no place once there is nothing to buy.
  const selling = $derived(view.state === 'priced' || view.state === 'unpriced');
  const panel = $derived(featuredScheme(page.style, section.scheme));
  const backdrop = $derived(
    layout === 'band'
      ? resolvePageImageUrl(content.background, 'lg', context.mediaBaseUrl)
      : null
  );
  const backdropSrcset = $derived(
    backdrop ? pageImageSrcset(content.background, context.mediaBaseUrl) : ''
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
  <OfferAsk {context} section="cta" label={content.ctaLabel} {size} {edit} />
{/snippet}

<div class="cta" data-layout={layout} data-lp-on-media={backdrop ? '' : undefined}>
  {#if backdrop}
    <div class="cta__backdrop">
      <Media
        image={backdrop}
        srcset={backdropSrcset}
        sizes="100vw"
        alt={content.background?.alt ?? ''}
      />
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
  /* The band's heading is drawn at the ask's size, which louder leaves (03
     X62): there is no step in it for the heading's fit to take back. */
  .cta[data-layout='band'] {
    --lp-size-heading: var(--lp-size-cta);
    --lp-drama-held: 1;
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
      /* The heading's room is its share (louder's fit, 03 X62). */
      --lp-heading-column: calc((var(--lp-column) - var(--lp-gap)) * 7 / 12);
    }
  }

  /* ── compact ───────────────────────────────────────────────────────────── */
  /* One line where it fits: the 18ch cap is for the band's display heading. */
  .cta[data-layout='compact'] .cta__words :global(.lp-heading) {
    max-inline-size: var(--lp-measure);
  }

  /* Wide: the words beside the offer wherever the title's widest word fits
     there, and over it where it does not (as the offer's band, 03 X70). The
     words grow from nothing, so the narrowest they can be is that word (a
     flex item's automatic minimum) at the size the fit draws it in the
     column, and the row wraps before it could run into the offer, whose
     width is its own words'. The words stack as a column, not a grid: a
     grid's narrowest drops any child whose own minimum is 0. */
  @container (min-width: 48rem) {
    .cta[data-layout='compact'] {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
    }

    .cta[data-layout='compact'] > .cta__words {
      display: flex;
      flex: 1 1 0;
      flex-direction: column;
    }
  }

  /* The offer itself (price and period, the button, its own billing line)
     is `OfferAsk`, shared with the Button section (03 X64). */
</style>

<!--
  @component PricingBlock

  The offer, priced ONLY from the live offer (`pricingView` → the same
  `deriveOfferPaths` the checkout uses). Three layouts:
    cards — every path side by side; the recommended one in its own scheme
    focus — the recommended path large, the others listed beneath
    band  — one strip: price, button, and the other paths in a line

  The small print beside a price is always that path's own billing line
  (`derivedNote`), so it follows the offer when the recommended one changes.
  The creator's note is the section's own words, under the lede, and only
  while there is something to buy.

  A single way in stands beside what the course holds ("What's included",
  `included.ts`), in each layout's own form: in `cards` the lone card and the
  list share the row, the card first; in `focus` the list sits under the
  card, in its column; in `band` the lines run along the strip under its
  rule, as the other ways to join do.

  And, in every layout, the states that are not "priced": an enrolled viewer
  gets a way back in, a course with no way in says so, and a failed offer read
  gets a price-less button — never an invented price.
-->
<script lang="ts">
  import { COPY, derivedNote, priceWithCadence } from '../../model/copy';
  import { pathHref } from '../../model/cta';
  import { courseFacts } from '../../model/facts';
  import { featuredScheme } from '../../model/resolve';
  import type { BlockProps } from '../../model/types';
  import { getKitPage } from '../../page-context';
  import Button from '../../primitives/Button.svelte';
  import ButtonRow from '../../primitives/ButtonRow.svelte';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import List from '../../primitives/List.svelte';
  import Text from '../../primitives/Text.svelte';
  import { PRICING_COPY } from './copy';
  import { pricingDefinition } from './definition';
  import { drawsIncluded, includedLines } from './included';
  import OfferCard from './OfferCard.svelte';
  import { pricingView } from '../../model/offer';

  const { props, section, context, edit }: BlockProps = $props();

  const page = getKitPage();
  const content = $derived(pricingDefinition.coerce(props));
  const view = $derived(pricingView(context, content));
  // The note reassures a buyer: it has no place once there is nothing to buy.
  const selling = $derived(view.state === 'priced' || view.state === 'unpriced');
  const featured = $derived(featuredScheme(page.style, section.scheme));
  const label = $derived(content.ctaLabel ?? COPY.cta.buy);
  const included = $derived(includedLines(content.included, courseFacts(context.stages)));
  // An empty list (switched off, or a course with nothing to count yet) draws
  // the card as it stood alone.
  const beside = $derived(drawsIncluded(view.paths.length) && included.length > 0);
</script>

{#snippet head()}
  <header class="pricing__head">
    {#if content.eyebrow}<Eyebrow text={content.eyebrow} type="pricing" {edit} />{/if}
    {#if content.heading}
      <Heading
        level={section.headingLevel}
        text={content.heading}
        type="pricing"
        field="heading"
        {edit}
      />
    {/if}
    {#if content.body}
      <Text text={content.body} size="lead" type="pricing" field="body" {edit} />
    {/if}
    {#if content.note && selling}
      <Text text={content.note} type="pricing" field="note" {edit} />
    {/if}
  </header>
{/snippet}

{#snippet others()}
  {#if view.others.length > 0}
    <div class="pricing__others">
      <p class="pricing__others-label">{COPY.pricing.otherWays}</p>
      <ul>
        {#each view.others as path (path.id)}
          <li>
            <a class="pricing__other" href={pathHref(context, path)}>{path.name}</a>
            <span>{priceWithCadence(path)}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
{/snippet}

<!-- A list under a title beside a card; along a `strip`, a line under a
     small label, as the other ways to join are set. -->
{#snippet whatsIncluded(form: 'list' | 'strip')}
  <div class="pricing__included" data-form={form}>
    {#if form === 'strip'}
      <p class="pricing__included-label">{PRICING_COPY.included}</p>
    {:else}
      <Heading level={3} size="title" text={PRICING_COPY.included} type="pricing" />
    {/if}
    <List items={included} />
  </div>
{/snippet}

<div class="pricing" data-layout={section.layout} data-state={view.state}>
  {@render head()}

  {#if view.state === 'enrolled'}
    <div class="pricing__panel" data-lp-scheme={featured}>
      <p class="pricing__panel-heading">{COPY.pricing.enrolledTitle}</p>
      <p class="pricing__panel-body">{COPY.pricing.enrolledBody}</p>
      <ButtonRow {context} section="pricing" size="md" />
    </div>
  {:else if view.state !== 'priced' || !view.featured}
    <div class="pricing__state">
      <ButtonRow {context} section="pricing" label={content.ctaLabel} {edit} />
      <!-- The kit's own line, so never an editable field. -->
      {#if view.state === 'unpriced'}<p class="pricing__note">{COPY.pricing.atCheckout}</p>{/if}
    </div>
  {:else if section.layout === 'focus'}
    <div class="pricing__focus">
      <OfferCard
        path={view.featured}
        {context}
        {label}
        scheme={featured}
        choice={view.paths.length > 1}
        size="focus"
        editable
        {edit}
      />
      {@render others()}
      {#if beside}{@render whatsIncluded('list')}{/if}
    </div>
  {:else if section.layout === 'band'}
    <div class="pricing__band">
      <p class="pricing__band-price">
        <span class="pricing__band-amount">{view.featured.priceLabel}</span>
        <span class="pricing__band-cadence">{view.featured.cadenceLabel}</span>
      </p>
      <div class="pricing__band-action">
        <Button
          href={pathHref(context, view.featured)}
          {label}
          size="lg"
          section="pricing"
          field="ctaLabel"
          {edit}
        />
        <p class="pricing__note">{derivedNote(view.featured)}</p>
      </div>
    </div>
    {@render others()}
    {#if beside}{@render whatsIncluded('strip')}{/if}
  {:else}
    <div
      class="pricing__cards"
      data-count={Math.min(view.paths.length, 5)}
      data-included={beside ? '' : undefined}
    >
      {#each view.paths as path (path.id)}
        <OfferCard
          {path}
          {context}
          {label}
          scheme={path.best ? featured : undefined}
          choice={view.paths.length > 1}
          editable={path.best}
          {edit}
        />
      {/each}
      {#if beside}{@render whatsIncluded('list')}{/if}
    </div>
  {/if}
</div>

<style>
  .pricing {
    display: grid;
    gap: var(--lp-gap);
  }

  /* The measure is its heading's room too (louder's fit, 03 X62). */
  .pricing__head {
    display: grid;
    gap: var(--lp-stack);
    max-inline-size: calc(var(--lp-measure) * var(--lp-measure-unit));
    --lp-heading-column: calc(var(--lp-measure) * var(--lp-measure-unit));
  }

  /* Soft centres its cards' head, so the states that stand in for the cards
     centre under it too. */
  :global(.lp[data-lp-style='soft']) .pricing[data-layout='cards'] .pricing__head {
    justify-items: center;
    margin-inline: auto;
    text-align: center;
  }

  :global(.lp[data-lp-style='soft']) .pricing[data-layout='cards'] .pricing__state {
    --lp-actions-align: center;
  }

  :global(.lp[data-lp-style='soft']) .pricing[data-layout='cards'] .pricing__panel {
    justify-self: center;
  }

  /* A lone card sits under the centred head, not hard left of it. */
  :global(.lp[data-lp-style='soft'])
    .pricing[data-layout='cards']
    .pricing__cards[data-count='1'] {
    inline-size: 100%;
    margin-inline: auto;
  }

  .pricing__note,
  .pricing__panel-body {
    margin: 0;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
  }

  /* ── non-priced states ─────────────────────────────────────────────────── */
  /* The state's own line keeps to its button, wherever the Style aligns it. */
  .pricing__state {
    display: grid;
    gap: var(--space-3);
    justify-items: var(--lp-actions-align, start);
    text-align: var(--lp-actions-align, start);
  }

  .pricing__panel {
    display: grid;
    gap: var(--space-3);
    justify-items: start;
    max-inline-size: calc(var(--lp-measure-lead) * var(--lp-measure-unit));
    padding: var(--space-8);
    border-radius: var(--lp-radius-card);
    background: var(--lp-bg);
    color: var(--lp-ink);
  }

  /* The focus layout's panel takes the price's place, at the price's width. */
  .pricing[data-layout='focus'] > .pricing__panel {
    max-inline-size: none;
  }

  .pricing__panel-heading {
    margin: 0;
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-title);
    font-weight: var(--lp-weight-title);
    font-synthesis: none;
  }

  /* ── cards ─────────────────────────────────────────────────────────────── */
  /* A card's width (`--_track`), which its name's room is read from
     (03 X71): its share of the cards, `--_n` across, which draws the tracks
     too. A lone card is held to the lead's measure, in the body's `0`s,
     which a title's room reads as its box does (in `font-size` an `em` is
     the parent's). */
  .pricing__cards {
    --_n: 1;
    --_track: calc((var(--lp-column) - (var(--_n) - 1) * var(--lp-gap)) / var(--_n));
    display: grid;
    grid-template-columns: repeat(var(--_n), minmax(0, 1fr));
    gap: var(--lp-gap);
    align-items: stretch;
  }

  .pricing__cards[data-count='1'] {
    --_track: min(var(--lp-column), var(--lp-measure-lead) * var(--lp-measure-unit) + var(--space-16));
    max-inline-size: calc(var(--lp-measure-lead) * var(--lp-measure-unit) + var(--space-16));
  }

  @container (min-width: 44rem) {
    .pricing__cards:not([data-count='1']) {
      --_n: 2;
    }
  }

  @container (min-width: 66rem) {
    .pricing__cards[data-count='3'],
    .pricing__cards[data-count='5'] {
      --_n: 3;
    }

    .pricing__cards[data-count='4'] {
      --_n: 4;
    }
  }

  /* One way in beside what it holds (Codex-61zsk.73). Narrow, the list sits
     under the card at the card's measure, card first as a phone reads them.
     Across, the card takes five parts to the list's six, and the card's
     width (`--_track`, its name's room) is its share of the column. */
  .pricing__cards[data-included] {
    --_split-gap: calc(var(--lp-gap) * 1.25);
  }

  /* The heading's room is the column it sits in: the card's, until the list
     has a column of its own. */
  .pricing__included {
    --lp-title-column: var(--_track, var(--lp-column));
    display: grid;
    align-content: start;
    gap: var(--space-4);
  }

  @container (min-width: 44rem) {
    .pricing__cards[data-included] {
      --_track: calc((var(--lp-column) - var(--_split-gap)) * 5 / 11);
      grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
      column-gap: var(--_split-gap);
      align-items: start;
      max-inline-size: none;
    }

    /* Its heading level with the card's name: the card's own inset
       (OfferCard's `--_pad` and border). */
    .pricing__cards[data-included] > .pricing__included {
      --lp-title-column: calc((var(--lp-column) - var(--_split-gap)) * 6 / 11);
      padding-block-start: calc(var(--space-6) + var(--lp-border));
    }
  }

  /* ── focus ─────────────────────────────────────────────────────────────── */
  .pricing__focus {
    --_track: var(--lp-column);
    display: grid;
    gap: var(--space-6);
  }

  /* Wide: the promise stays beside the price while a long offer scrolls. */
  @container (min-width: 60rem) {
    .pricing[data-layout='focus'] {
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
      align-items: start;
      column-gap: calc(var(--lp-gap) * 1.5);
    }

    .pricing[data-layout='focus'] > .pricing__focus {
      --_track: calc((var(--lp-column) - var(--lp-gap) * 1.5) * 7 / 12);
    }

    .pricing[data-layout='focus'] > .pricing__head {
      position: sticky;
      top: var(--space-12);
      --lp-heading-column: min(var(--lp-measure) * var(--lp-measure-unit), (var(--lp-column) - var(--lp-gap) * 1.5) * 5 / 12);
    }
  }

  .pricing__others {
    display: grid;
    gap: var(--space-3);
  }

  .pricing__others-label,
  .pricing__included-label {
    margin: 0;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
  }

  .pricing__others ul {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .pricing__others li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1) var(--space-4);
    min-block-size: var(--tap-target-min);
    border-block-start: var(--lp-border) var(--border-style) var(--lp-line);
    font-size: var(--lp-size-body);
  }

  .pricing__other {
    color: var(--lp-ink);
    font-weight: var(--font-semibold);
    text-decoration: underline;
    text-decoration-thickness: var(--border-width);
    text-underline-offset: var(--lp-underline-offset);
  }

  .pricing__other:focus-visible {
    outline: var(--border-width-thick) solid var(--lp-focus);
    outline-offset: var(--focus-offset);
  }

  /* ── band ──────────────────────────────────────────────────────────────── */
  .pricing__band {
    display: grid;
    gap: var(--space-5);
    align-items: center;
  }

  .pricing__band-price {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin: 0;
  }

  .pricing__band-amount {
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-price);
    font-weight: var(--lp-weight-display);
    font-synthesis: none;
    font-variant-numeric: lining-nums tabular-nums;
    line-height: var(--lp-leading-display);
    letter-spacing: var(--lp-tracking-display);
  }

  .pricing__band-cadence {
    color: var(--lp-ink-soft);
  }

  .pricing__band-action {
    display: grid;
    justify-items: start;
    gap: var(--space-2);
  }

  /* What's included along the strip (Codex-61zsk.73): under a rule of the
     Style's own weight (`--lp-rule`: Poster's thick print, Bold's heavier
     one), its label and then its lines in a row that wraps, so the band
     stays a strip rather than growing a column. */
  .pricing__included[data-form='strip'] {
    gap: var(--space-3);
    padding-block-start: var(--space-4);
    border-block-start: var(--lp-rule) var(--border-style) var(--lp-line);
  }

  .pricing__included[data-form='strip'] :global(.lp-list) {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-6);
  }

  /* The head beside its price wherever its widest word fits there, and over
     it where it does not (03 X70). The head grows from nothing, so the
     narrowest it can be is its own longest word (a flex item's automatic
     minimum), at the size the fit draws it in its room, the measure: the row
     wraps before that word could run into the price. On a row of its own the
     head has that room, and on a shared row more than its word. The price
     keeps the row's end, or its start alone.
     The head stacks its words as a column, not a grid: a grid's narrowest
     drops any child whose own minimum is 0 (a common cure for a grid
     blowout), and the row would then keep a word that does not fit. */
  @container (min-width: 60rem) {
    .pricing[data-layout='band'] {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
    }

    .pricing[data-layout='band'] > .pricing__head {
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
    }

    .pricing__band {
      grid-template-columns: auto auto;
      column-gap: var(--lp-gap);
    }

    .pricing[data-layout='band'] .pricing__others,
    .pricing[data-layout='band'] .pricing__included {
      flex-basis: 100%;
    }
  }
</style>

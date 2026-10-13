<!--
  @component InsideBlock

  "What's inside" (03 X63): every practice in the course as a picture-led
  card, in the order a member meets them, in one row the visitor swipes
  through (`ScrollStrip`: the browser's own scrolling, snapping card by card,
  a labelled region, previous and next buttons under the row on the right,
  and where the visitor is, "1–3 of 18"). It never moves by itself. Each card
  names its stage under it. A pure showcase: no button, no links.

  The cards are about four-fifths of a phone's width, so the next one shows
  at the edge and says there is more. Up to three practices sit from the
  column's start, as any row does. The first four pictures, as many as a wide
  screen shows at once, load straight away but behind the hero's; the rest
  load as a swipe nears them.

  EMPTY (no practices yet). A heading over nothing is an empty promise, so
  the public page folds the band away from the first paint, as the video's
  does. Wherever the page is only looked at — the canvas, a still thumbnail —
  the band keeps a row of tiles, and while editing a prompt points to the
  Curriculum tab.
-->
<script lang="ts">
  import { hasHead } from '../../model/read';
  import type { BlockProps } from '../../model/types';
  import { getKitPage } from '../../page-context';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import ScrollStrip from '../../primitives/ScrollStrip.svelte';
  import Text from '../../primitives/Text.svelte';
  import { INSIDE_COPY } from './copy';
  import { INSIDE_EMPTY, insideDefinition } from './definition';
  import PracticeCard from './PracticeCard.svelte';
  import PracticeTile from './PracticeTile.svelte';
  import { PRACTICE_CARD_SIZES, practiceTileGround, stagedPracticeCards } from './practice-card';

  const { props, section, context, edit }: BlockProps = $props();

  /** As many cards as a wide screen shows at once: their pictures load now. */
  const EARLY = 4;
  /** The tiles an empty preview draws: enough to show the row's shape. */
  const PREVIEW = ['video', 'audio', 'written', 'video'] as const;

  const page = getKitPage();
  const content = $derived(insideDefinition.coerce(props));
  const cards = $derived(stagedPracticeCards(context.stages));
  const empty = $derived(cards.length === 0);
  const shown = $derived(!empty || page.still || !!edit);
  const tile = $derived(practiceTileGround(section.scheme));
</script>

{#if empty}
  <!-- No practices: the live page folds this band away. -->
  <span class="inside-none" hidden></span>
{/if}
{#if shown}
  <div class="inside lp-bleed" data-lp-edit-only={empty ? '' : undefined}>
    {#if hasHead(content)}
      <header class="inside__head">
        {#if content.eyebrow}<Eyebrow text={content.eyebrow} type="inside" {edit} />{/if}
        {#if content.heading}
          <Heading
            level={section.headingLevel}
            text={content.heading}
            type="inside"
            field="heading"
            {edit}
          />
        {/if}
        {#if content.body}
          <Text text={content.body} size="lead" type="inside" field="body" {edit} />
        {/if}
      </header>
    {/if}

    {#if empty}
      <div class="inside__empty">
        <ul class="inside__tiles" aria-hidden="true" inert>
          {#each PREVIEW as type, index (index)}
            <li class="inside__tile"><PracticeTile {type} ground={tile} /></li>
          {/each}
        </ul>
        {#if edit}<p class="inside__prompt" data-lp-edit-only>{INSIDE_EMPTY}</p>{/if}
      </div>
    {:else}
      <div class="inside__strip">
        <ScrollStrip
          id={`${section.anchor}-practices`}
          label={content.heading ?? INSIDE_COPY.label}
          previousLabel={INSIDE_COPY.previous}
          nextLabel={INSIDE_COPY.next}
          count={cards.length}
          ordered
          position={INSIDE_COPY.position}
        >
          {#each cards as { card, stage }, index (index)}
            <li class="inside__item">
              <PracticeCard {card} {stage} {tile} early={index < EARLY} sizes={PRACTICE_CARD_SIZES} />
            </li>
          {/each}
        </ScrollStrip>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* ── no practices on the live page: no band either ───────────────────── */
  :global(.lp:not([data-lp-still]) .lp-section:has(> .lp-inner > .inside-none)) {
    display: none;
  }

  /* The card's width and gap are shared with the layered curriculum (kit.css). */
  .inside {
    --_card: var(--lp-practice-card);
    --_gap: var(--lp-practice-gap);
    display: grid;
    row-gap: var(--lp-gap);
  }

  /* The row runs to the section's edges while its words keep the column:
     the section's own tracks, with no gap between them (a column gap would
     narrow the content track and push it off the section's). */
  .inside.lp-bleed {
    grid-template-columns: inherit;
  }

  .inside.lp-bleed > :global(*) {
    grid-column: content;
    min-inline-size: 0;
  }

  .inside.lp-bleed > :global(:is(.inside__strip, .inside__empty)) {
    grid-column: bleed;
  }

  .inside__strip {
    --lp-strip-item: var(--_card);
    --lp-strip-gap: var(--_gap);
  }

  /* The measure is its heading's room too (louder's fit, 03 X62). */
  .inside__head {
    display: grid;
    gap: var(--lp-stack);
    max-inline-size: var(--lp-measure);
    --lp-heading-column: var(--lp-measure);
  }

  /* The heading measures itself in its own `ch`, not the body face's. */
  .inside__head :global(.lp-heading) {
    max-inline-size: 20ch;
  }

  /* ── empty: a row of tiles where the page is looked at ────────────────── */
  .inside__empty {
    display: grid;
    overflow: clip;
  }

  .inside__empty > * {
    grid-area: 1 / 1;
    min-inline-size: 0;
  }

  /* As the strip lays its cards: from the content column's start, off the
     band's end. */
  .inside__tiles {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: var(--_card);
    gap: var(--_gap);
    margin: 0;
    padding: 0 max(var(--lp-gutter), (100cqi - var(--lp-container)) / 2);
    list-style: none;
    opacity: var(--opacity-40);
  }

  /* base.css spaces every `li` but the last. */
  .inside__tile {
    position: relative;
    margin: 0;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: var(--lp-radius-media);
  }

  /* global.css caps every `p` at 65ch. Positioned, so it paints over the
     tiles (later in the page, so on top). */
  .inside__prompt {
    position: relative;
    align-self: center;
    justify-self: center;
    max-inline-size: calc(100% - 2 * var(--space-4));
    margin: 0;
    padding: var(--space-4) var(--space-6);
    border: var(--lp-border) var(--border-style-dashed) var(--lp-button-line);
    border-radius: var(--lp-radius-card);
    background: var(--lp-bg);
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    text-align: center;
  }

  /* Soft centres a head over a row of cards, as its pricing does. */
  :global(.lp[data-lp-style='soft']) .inside__head {
    justify-items: center;
    margin-inline: auto;
    text-align: center;
  }

  :global(.lp[data-lp-style='soft'])
    .inside__head
    :global(:is(.lp-eyebrow, .lp-heading, .lp-text)) {
    justify-self: center;
    margin-inline: auto;
  }
</style>

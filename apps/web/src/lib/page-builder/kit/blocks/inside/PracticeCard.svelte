<!--
  @component PracticeCard

  One practice as a picture-led card (03 X63): its picture at 16:9, then what
  it is and how long it takes ("Video · 12 min", the curriculum's own words),
  then its title in full however it wraps, then — when the layout names it —
  the stage it sits in, in small type. A pure showcase: nothing on it is a
  link or takes a press.

  With no picture, or one that fails, the frame draws its kind's tile
  (`PracticeTile`): on the brand colour on the page's grounds, on the band's
  panel on a filled band (`tile="panel"`).

  Spoken "title, kind, length, stage": the title leads the markup and the
  kind leads the eye (CSS `order`), since a card holds nothing to focus.

  SHARED: `practice-card.ts` says why and how a curriculum layout reuses it.
-->
<script lang="ts">
  import Media from '../../primitives/Media.svelte';
  import { type PracticeCardView, practiceIcon } from './practice-card';
  import PracticeTile from './PracticeTile.svelte';

  interface Props {
    card: PracticeCardView;
    /** The stage line, "Stage 2 · Breath"; left off where the layout shows stages itself. */
    stage?: string;
    /** The tile's ground: the brand on the page's grounds, the panel on a filled band. */
    tile?: 'brand' | 'panel';
    /** On screen at first paint: load the picture now, behind the page's largest. */
    early?: boolean;
    /** How wide the card is drawn, for choosing the picture's size. */
    sizes?: string;
  }

  const { card, stage, tile = 'brand', early = false, sizes }: Props = $props();

  /** What a screen reader hears between the pieces. Written as text in the
   *  markup, its space would be trimmed and the pieces run together. */
  const PAUSE = ', ';

  const Icon = $derived(practiceIcon(card.type));
</script>

<div class="practice-card">
  <div class="practice-card__picture">
    <Media image={card.picture} srcset={card.srcset} {sizes} {early} ratio="16 / 9" alt="">
      {#snippet fallback()}<PracticeTile type={card.type} ground={tile} />{/snippet}
    </Media>
  </div>
  <p class="practice-card__name">{card.title}</p>
  <!-- The pieces touch, the commas are hidden and the dot is drawn. -->
  <p class="practice-card__meta">
    <Icon size="1em" /><span
      ><span class="sr-only">{PAUSE}</span>{card.kind}{#if card.length}<span class="practice-card__length"
          ><span class="sr-only">{PAUSE}</span>{card.length}</span
        >{/if}</span
    >
  </p>
  {#if stage}
    <p class="practice-card__stage"><span class="sr-only">{PAUSE}</span>{stage}</p>
  {/if}
</div>

<style>
  .practice-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* global.css caps every `p` at 65ch and spaces it. */
  .practice-card > p {
    max-inline-size: none;
    margin: 0;
  }

  .practice-card__picture {
    order: 1;
    margin-block-end: var(--space-1);
  }

  .practice-card__meta {
    order: 2;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    font-variant-numeric: lining-nums tabular-nums;
    line-height: var(--lp-leading-body);
    white-space: nowrap;
  }

  .practice-card__meta > :global(svg) {
    flex: none;
  }

  .practice-card__length::before {
    content: '·' / '';
    margin-inline: 0.4em;
  }

  /* A title in full, however long: it wraps, never clips. */
  .practice-card__name {
    order: 3;
    color: var(--lp-title-ink, currentColor);
    font-family: var(--lp-font-display);
    font-size: var(--lp-size-title);
    font-synthesis: none;
    font-weight: var(--lp-weight-title);
    letter-spacing: var(--lp-tracking-title);
    line-height: var(--lp-leading-title);
    overflow-wrap: break-word;
    text-wrap: pretty;
  }

  .practice-card__stage {
    order: 4;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-body);
  }
</style>

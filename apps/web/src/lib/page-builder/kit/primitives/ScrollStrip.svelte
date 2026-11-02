<!--
  @component ScrollStrip

  A row that scrolls sideways with the browser's own scrolling, snapping item
  by item, running to the section's edges while its first item lines up with
  the content column. The row is a labelled region a keyboard can focus and
  scroll with the arrow keys; the previous and next buttons move one item and
  rest at the ends. Items may differ in width: a move goes to the next item's
  own start, not a fixed distance.

  Without JavaScript the row still scrolls and the buttons are left out; with
  it their space is kept from the first paint, so nothing moves. A resting
  button stays focusable (`aria-disabled`, not `disabled`), so pressing "next"
  to the end never drops the keyboard's place.

  The consumer renders the `<li>` items and sizes them through
  `--lp-strip-item` (a grid column size) and `--lp-strip-gap`. A block whose
  Styles already style its strip by the block's own names passes them as
  `parts`: they are added beside the strip's own, which still do the work.

  A long row can say where the visitor is in it (`position`): the items wholly
  in view, "4–6 of 18", at the start of the buttons' row. It is the eye's
  shortcut only, hidden from a screen reader, which already hears the list's
  length and walks it item by item.

  A row with a heading of its own (`head`) carries its buttons in that
  heading's line, above the row, so a row that fits pays no empty line under
  it. The heading stays when there is nothing to scroll and without
  JavaScript; only the buttons step aside. Without `head` the strip is drawn
  exactly as before.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import { ChevronLeftIcon, ChevronRightIcon } from '$lib/components/ui/Icon';
  import { holdsStill } from '../motion/attributes';

  /** Extra class names for the strip's own parts. */
  interface Parts {
    track?: string;
    items?: string;
    nav?: string;
    move?: string;
  }

  interface Props {
    /** The row's id: the buttons name it in `aria-controls`. */
    id: string;
    /** The region's name for a screen reader. */
    label: string;
    previousLabel: string;
    nextLabel: string;
    /** How many items; the row measures itself again when it changes. */
    count: number;
    /** An ordered list for a real sequence, a plain one otherwise. */
    ordered?: boolean;
    /** Words for the items in view, counted from 1: "4–6 of 18". */
    position?: (first: number, last: number, count: number) => string;
    /**
     * The row's own heading, drawn in the buttons' line above the row. Its
     * room is that line less the buttons, so a row with a heading draws no
     * `position`: the readout is as wide as its words, which no rule can take
     * from the heading's room.
     */
    head?: Snippet;
    class?: string;
    parts?: Parts;
    children: Snippet;
  }

  const {
    id,
    label,
    previousLabel,
    nextLabel,
    count,
    ordered = false,
    position,
    head,
    class: className,
    parts = {},
    children,
  }: Props = $props();

  let atStart = $state(true);
  let atEnd = $state(true);
  let track = $state<HTMLElement>();
  /** The first and last item wholly in view, from 0; unknown until measured. */
  let inView = $state<readonly [number, number] | null>(null);
  // A boolean, so a consumer passing a fresh function never re-measures the row.
  const reads = $derived(Boolean(position));
  const readout = $derived(
    position && inView ? position(inView[0] + 1, inView[1] + 1, count) : ''
  );

  /** The row's items, in order. */
  function itemsOf(row: HTMLElement): HTMLElement[] {
    return [...row.querySelectorAll<HTMLElement>(':scope > .lp-strip__items > li')];
  }

  /** Keeps the buttons' resting state true to the row's scroll position. */
  function measure(items: number): Attachment<HTMLElement> {
    return (node) => {
      track = node;
      if (items === 0) return;
      const update = () => {
        atStart = node.scrollLeft <= 1;
        atEnd = node.scrollLeft + node.clientWidth >= node.scrollWidth - 1;
        if (reads) inView = seen(node);
      };
      update();
      node.addEventListener('scroll', update, { passive: true });
      // The row as well as the window onto it: the row's width is what
      // changes when items are added or the styles, fonts and images arrive.
      const resize = new ResizeObserver(update);
      resize.observe(node);
      if (node.firstElementChild) resize.observe(node.firstElementChild);
      return () => {
        node.removeEventListener('scroll', update);
        resize.disconnect();
      };
    };
  }

  /**
   * Where the row must scroll to put each item at the snap line. The list's
   * start padding IS the scroll padding, so an item's distance from the first
   * item is exactly the scroll position that snaps it.
   */
  function stops(row: HTMLElement): number[] {
    const items = itemsOf(row);
    if (items.length === 0) return [];
    const origin = items[0].getBoundingClientRect().left;
    return items.map((item) => item.getBoundingClientRect().left - origin);
  }

  /**
   * The first and last item wholly inside the row's window. An item wider
   * than the window is never wholly in it: then the one nearest the snap line.
   */
  function seen(row: HTMLElement): readonly [number, number] | null {
    const items = itemsOf(row);
    if (items.length === 0) return null;
    const view = row.getBoundingClientRect();
    const whole = items.map((item) => {
      const box = item.getBoundingClientRect();
      return box.left >= view.left - 1 && box.left + box.width <= view.left + view.width + 1;
    });
    const first = whole.indexOf(true);
    if (first >= 0) return [first, whole.lastIndexOf(true)];
    const at = row.scrollLeft;
    const nearest = stops(row).reduce(
      (best, stop, index, all) => (Math.abs(stop - at) < Math.abs(all[best] - at) ? index : best),
      0
    );
    return [nearest, nearest];
  }

  /** One item along, to the next item's own start. */
  function move(direction: 1 | -1) {
    if (!track || (direction === 1 ? atEnd : atStart)) return;
    const at = track.scrollLeft;
    let target: number | undefined;
    for (const stop of stops(track)) {
      if (direction === 1 && stop > at + 1) {
        target = stop;
        break;
      }
      if (direction === -1 && stop < at - 1) target = stop;
    }
    if (target === undefined) return;
    track.scrollTo({ left: target, behavior: holdsStill(track) ? 'auto' : 'smooth' });
  }
</script>

{#snippet buttons()}
  {#if position && !head}<p class="lp-strip__position" aria-hidden="true">{readout}</p>{/if}
  <button
    type="button"
    class="lp-strip__move {parts.move ?? ''}"
    aria-label={previousLabel}
    aria-controls={id}
    aria-disabled={atStart}
    onclick={() => move(-1)}
  >
    <ChevronLeftIcon size="1.25em" />
  </button>
  <button
    type="button"
    class="lp-strip__move {parts.move ?? ''}"
    aria-label={nextLabel}
    aria-controls={id}
    aria-disabled={atEnd}
    onclick={() => move(1)}
  >
    <ChevronRightIcon size="1.25em" />
  </button>
{/snippet}

<div class="lp-strip {className ?? ''}">
  {#if head}
    <div
      class="lp-strip__nav lp-strip__nav--head {parts.nav ?? ''}"
      data-idle={atStart && atEnd ? '' : undefined}
    >
      <div class="lp-strip__head">{@render head()}</div>
      {@render buttons()}
    </div>
  {/if}
  <!-- A scrolling region must take focus, or a keyboard cannot scroll it. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="lp-strip__track {parts.track ?? ''}"
    {id}
    role="region"
    aria-label={label}
    tabindex="0"
    {@attach measure(count)}
  >
    <svelte:element this={ordered ? 'ol' : 'ul'} class="lp-strip__items {parts.items ?? ''}">
      {@render children()}
    </svelte:element>
  </div>
  {#if !head}
    <div class="lp-strip__nav {parts.nav ?? ''}" data-idle={atStart && atEnd ? '' : undefined}>
      {@render buttons()}
    </div>
  {/if}
</div>

<style>
  .lp-strip {
    /* The distance from the section's edge to the content column's. */
    --_inset: max(var(--lp-gutter), (100cqi - var(--lp-container)) / 2);
    display: grid;
    gap: var(--space-5);
  }

  .lp-strip__track {
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x mandatory;
    scroll-padding-inline: var(--_inset);
    scrollbar-color: var(--lp-button-line) transparent;
    scrollbar-width: thin;
  }

  /* The focus ring sits inside the scroller, which clips anything outside it. */
  .lp-strip__track:focus-visible {
    outline-offset: calc(-1 * var(--border-width-thick));
  }

  .lp-strip__items {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: var(--lp-strip-item, clamp(15rem, 26cqi, 21rem));
    align-items: start;
    gap: var(--lp-strip-gap, var(--lp-gap));
    inline-size: max-content;
    margin: 0;
    padding: var(--space-1) var(--_inset) var(--space-5);
    list-style: none;
  }

  /* base.css spaces every `li` but the last. */
  .lp-strip__items > :global(li) {
    margin: 0;
    scroll-snap-align: start;
  }

  .lp-strip__nav {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding-inline: var(--_inset);
  }

  /* The position leads the row; the buttons keep the end. global.css caps
     every `p` at 65ch and spaces it. */
  .lp-strip__position {
    align-self: center;
    margin-block: 0;
    margin-inline: 0 auto;
    color: var(--lp-ink-soft);
    font-size: var(--lp-size-small);
    font-variant-numeric: lining-nums tabular-nums;
    line-height: var(--lp-leading-body);
  }

  /* Nothing to scroll: the buttons step aside but keep their room; a row's
     own heading stays. */
  .lp-strip__nav[data-idle] > :not(.lp-strip__head) {
    visibility: hidden;
  }

  /* A row's own heading leads the buttons' line, above the row; the buttons
     keep its end, level with its last line. */
  .lp-strip__nav--head {
    align-items: end;
  }

  .lp-strip__nav--head > :not(.lp-strip__head) {
    flex: none;
  }

  /* Its room is the line's (the column: the line is padded in by the same
     inset) less the two buttons, the gaps beside them and its own margin,
     so a title in it is fitted beside the buttons (03 X71). With no script
     the buttons are gone and the room is understated: drawn a little small,
     never cut. */
  .lp-strip__head {
    --lp-heading-column: calc(
      var(--lp-column) - 2 * var(--tap-target-min) - 2 * var(--space-2) -
        (var(--space-4) - var(--space-2))
    );
    flex: 1 1 0;
    min-inline-size: 0;
    margin-inline-end: calc(var(--space-4) - var(--space-2));
  }

  .lp-strip__move {
    display: grid;
    place-items: center;
    inline-size: var(--tap-target-min);
    block-size: var(--tap-target-min);
    border-radius: var(--radius-full);
    box-shadow: inset 0 0 0 var(--lp-border) var(--lp-button-line);
    color: var(--lp-ink);
  }

  .lp-strip__move[aria-disabled='true'] {
    cursor: default;
    opacity: var(--opacity-40);
  }

  @media (hover: hover) {
    .lp-strip__move:not([aria-disabled='true']):hover {
      background: var(--lp-button-bg);
      box-shadow: none;
      color: var(--lp-button-ink);
    }
  }

  @media (scripting: none) {
    .lp-strip__nav:not(.lp-strip__nav--head),
    .lp-strip__nav--head > :not(.lp-strip__head) {
      display: none;
    }
  }
</style>

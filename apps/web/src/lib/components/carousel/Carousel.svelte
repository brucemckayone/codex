<!--
  @component Carousel

  A horizontal scrollable row of items with CSS scroll-snap, navigation arrows,
  touch/swipe support, keyboard accessibility, and responsive item sizing.

  @prop {T[]} items - Array of items to render
  @prop {Snippet<[T, number]>} renderItem - Snippet that renders a single item
  @prop {string} title - Optional section title
  @prop {string} viewAllHref - URL for "View All" link
  @prop {string} viewAllLabel - Label for "View All" link
  @prop {string} itemMinWidth - Minimum width for each item (CSS value)
  @prop {string} gap - Gap between items (design token reference)
  @prop {boolean} showArrows - Show navigation arrows
  @prop {'page' | number} scrollAmount - Scroll distance per arrow click
  @prop {string} ariaLabel - Accessible label for the carousel region
-->
<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { onMount } from 'svelte';
  import { ChevronLeftIcon, ChevronRightIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    items: T[];
    renderItem: Snippet<[T, number]>;
    title?: string;
    viewAllHref?: string;
    viewAllLabel?: string;
    itemMinWidth?: string;
    gap?: string;
    showArrows?: boolean;
    scrollAmount?: 'page' | number;
    ariaLabel?: string;
    /**
     * When true, the first carousel item is rendered at ~2× the regular
     * item width. Used on the org landing feed where each per-domain
     * section leads with a "hero" tile (Netflix-style row anchor).
     */
    firstItemHero?: boolean;
  }

  const {
    items,
    renderItem,
    title,
    viewAllHref,
    viewAllLabel = m.carousel_view_all(),
    itemMinWidth = '280px',
    gap = 'var(--space-4)',
    showArrows = true,
    scrollAmount = 'page',
    ariaLabel,
    firstItemHero = false,
    class: className,
    ...restProps
  }: Props = $props();

  let trackEl: HTMLDivElement | undefined = $state();
  let canScrollLeft = $state(false);
  let canScrollRight = $state(true);

  function updateArrowVisibility() {
    if (!trackEl) return;
    const { scrollLeft, scrollWidth, clientWidth } = trackEl;
    canScrollLeft = scrollLeft > 1;
    canScrollRight = scrollLeft + clientWidth < scrollWidth - 1;
  }

  function scrollByDirection(direction: 'left' | 'right') {
    if (!trackEl) return;
    const prefersReducedMotion =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scrollDistance =
      scrollAmount === 'page'
        ? trackEl.clientWidth * 0.85
        : scrollAmount * parseInt(itemMinWidth, 10);

    trackEl.scrollBy({
      left: direction === 'left' ? -scrollDistance : scrollDistance,
      behavior: prefersReducedMotion ? 'instant' : 'smooth',
    });
  }

  function handleFocusIn(e: FocusEvent) {
    const target = e.target as HTMLElement;
    if (target && trackEl?.contains(target)) {
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  onMount(() => {
    updateArrowVisibility();
  });
</script>

{#if items.length > 0}
  <div
    class="carousel {className ?? ''}"
    role="region"
    aria-roledescription="carousel"
    aria-label={ariaLabel ?? title ?? m.carousel_default_label()}
    {...restProps}
  >
    {#if title}
      <div class="carousel__header">
        <h2 class="carousel__title">{title}</h2>
        {#if viewAllHref}
          <a href={viewAllHref} class="carousel__view-all">
            {viewAllLabel} &rarr;
          </a>
        {/if}
      </div>
    {/if}

    <div class="carousel__wrapper">
      <div
        class="carousel__track"
        class:carousel__track--first-hero={firstItemHero}
        bind:this={trackEl}
        onscroll={updateArrowVisibility}
        onfocusin={handleFocusIn}
        style:--carousel-item-min-width={itemMinWidth}
        style:--carousel-gap={gap}
      >
        {#each items as item, index (index)}
          <div class="carousel__item">
            {@render renderItem(item, index)}
          </div>
        {/each}
      </div>

      {#if showArrows}
        <button
          class="carousel__arrow carousel__arrow--left"
          hidden={!canScrollLeft}
          onclick={() => scrollByDirection('left')}
          aria-label={m.carousel_scroll_left()}
        >
          <ChevronLeftIcon size={20} />
        </button>
        <button
          class="carousel__arrow carousel__arrow--right"
          hidden={!canScrollRight}
          onclick={() => scrollByDirection('right')}
          aria-label={m.carousel_scroll_right()}
        >
          <ChevronRightIcon size={20} />
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .carousel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .carousel__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .carousel__title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
  }

  .carousel__view-all {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    text-decoration: none;
    white-space: nowrap;
    transition: color var(--duration-fast) var(--ease-default);
  }

  .carousel__view-all:hover {
    color: var(--color-interactive-hover);
  }

  .carousel__wrapper {
    position: relative;
  }

  .carousel__track {
    display: flex;
    gap: var(--carousel-gap, var(--space-4));
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    scroll-behavior: smooth;
    scroll-padding-inline-start: var(--space-1);
    padding-block-end: var(--space-2);

    /* Thin scrollbar */
    scrollbar-width: thin;
    scrollbar-color: var(--color-border) transparent;
  }

  .carousel__track::-webkit-scrollbar {
    height: var(--space-1);
  }

  .carousel__track::-webkit-scrollbar-track {
    background: transparent;
  }

  .carousel__track::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: var(--radius-full);
  }

  .carousel__item {
    /* DEFINITE width — not content-driven. `flex: 0 0 auto` sized each item to
       its max-content width, which leaks the thumbnail image's INTRINSIC
       resolution: a low-res cover produced a narrow card while a high-res one
       hit the cap, so cards in the same rail rendered at wildly different
       widths (204–400px). A fixed flex-basis pins every tile to one width so a
       row of 3:4 / 1:1 cards reads as a single rhythm. Viewport-capped (`82vw`)
       so a phone shows one card plus a peek of the next; the cap wins only
       below a ~488px viewport, leaving tablet/desktop at the intended size. */
    flex: 0 0 min(var(--carousel-item-min-width, 280px), 82vw);
    max-width: min(400px, 82vw);
    scroll-snap-align: start;
    /* Pass the stretched track height down to the card. The flex track
       stretches every item to the tallest card; without this the `.cc` inside
       keeps its natural height, so a shorter card (a title-in-cover article
       beside a taller video/audio tile) floats at the top of an over-tall slot
       with blank space beneath. Column-flex + the child rule below make the
       card fill its slot, so heights match and bottoms align. */
    display: flex;
    flex-direction: column;
  }

  /* The single card inside each item fills the (possibly stretched) slot. */
  .carousel__item > :global(*) {
    flex: 1 1 auto;
    min-height: 0;
  }

  /* Hero variant — first tile in the carousel is ~2× width. Used by the
     org landing feed's per-domain sections where each section leads with
     a larger "anchor" tile. The cap accounts for very wide min-widths
     which would otherwise produce a hero tile that dwarfs the viewport. */
  .carousel__track--first-hero > .carousel__item:first-child {
    min-width: min(
      calc(var(--carousel-item-min-width, 280px) * 2),
      40rem
    );
    max-width: 40rem;
  }

  /* Navigation arrows */
  .carousel__arrow {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-10);
    height: var(--space-10);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) var(--color-border);
    background: color-mix(in srgb, var(--color-surface) 85%, transparent);
    color: var(--color-text);
    cursor: pointer;
    transition: var(--transition-colors), var(--transition-shadow);
    backdrop-filter: blur(4px);
  }

  .carousel__arrow:hover {
    background: var(--color-surface);
    box-shadow: var(--shadow-md);
  }

  .carousel__arrow:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .carousel__arrow--left {
    left: var(--space-2);
  }

  .carousel__arrow--right {
    right: var(--space-2);
  }

  .carousel__arrow[hidden] {
    display: none;
  }

  /* Hide arrows on touch devices where swipe is natural */
  @media (hover: none) {
    .carousel__arrow {
      display: none;
    }
  }
</style>

<!--
  @component TopicChannels

  The "Channels" topic selector (Codex-8swlj.7): every topic gets a front page.
  A row of tabs, one per topic, sits over a horizontal pager with one page per
  topic. It snaps page by page, swipes on a phone and has ← → steps on desktop.
  The tabs and the pager follow each other both ways.

  A page is its topic's cover photo, in its own colour, fading into the org's
  live shader, under ONE veil that spans the whole band (never a patch behind
  the words). On it: a kicker, the name, the blurb, the type mix, a "Browse N
  pieces" button that filters the grid below (`onSelect`), and the topic's
  three newest pieces from the loaded catalogue.

  - Browsing pages changes nothing; only the button filters.
  - When `active` changes from outside (a `?category=` deep link, another
    control), the pager turns to that topic's page.
  - The shader is one `ShaderWindow` behind the whole band, shared by every
    page, so a page that slides in never flashes the fallback. With no live
    shader, the window's fallback paints the brand gradient instead.
  - The tabs are hand-rolled to the ARIA tabs pattern (roving tabindex,
    arrows, Home and End), as the host BrowseModule's type tabs are: a Melt
    tab panel is `hidden` when unselected, and a hidden page cannot be swiped
    to. Unselected pages are `inert` instead, so only the page in view reaches
    the keyboard and assistive tech.
  - Reduced motion: every programmatic scroll is instant.

  @prop {TopicItem[]} topics - Curated topics, in the curator's order.
  @prop {string | null} active - The slug filtering the grid, or null.
  @prop {(slug: string | null) => void} onSelect - Called by a page's button.
  @prop {BrowseItem[]} items - The loaded catalogue, newest first.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import type { BrowseItem } from '$lib/components/browse/browse-module.types';
  import type { TopicItem } from '$lib/components/topic/topic-card.types';
  import { Button } from '$lib/components/ui/Button';
  import {
    ArrowLeftIcon,
    ArrowRightIcon,
    FileTextIcon,
    MusicIcon,
    PlayIcon,
  } from '$lib/components/ui/Icon';
  import { ShaderWindow } from '$lib/components/ui/ShaderWindow';
  import {
    buildChannelPages,
    COPY,
    type ChannelPage,
    topicInitial,
  } from './topic-channels';

  interface Props {
    topics: TopicItem[];
    active: string | null;
    onSelect: (slug: string | null) => void;
    items: BrowseItem[];
  }

  const { topics, active, onSelect, items }: Props = $props();

  const uid = $props.id();

  /** A mini card's type badge. */
  const TYPE_ICON: Record<BrowseItem['contentType'], typeof PlayIcon> = {
    video: PlayIcon,
    audio: MusicIcon,
    article: FileTextIcon,
  };

  const pages = $derived(buildChannelPages(topics, items));
  const activeIndex = $derived(
    active ? topics.findIndex((t) => t.slug === active) : -1
  );

  /** The page in view. It starts on the active topic, so SSR selects its tab. */
  let current = $state(untrack(() => Math.max(0, activeIndex)));
  /** `current`, kept in range when the topics shrink. */
  const shown = $derived(Math.min(current, Math.max(0, pages.length - 1)));

  let tablistEl = $state<HTMLDivElement | null>(null);
  let pagerEl = $state<HTMLDivElement | null>(null);

  /*
   * Plain bookkeeping, not state: nothing renders from these.
   * - `heading`: the page a programmatic scroll is on its way to. The scroll
   *   events on the way there name every page it passes, and must not drag
   *   the tabs through them.
   * - `placed`: the pager has been turned to its first page once. The server
   *   renders it at page 1, whatever is active.
   */
  let heading: number | null = null;
  let placed = false;
  let frame = 0;

  function behavior(instant: boolean): ScrollBehavior {
    return instant || prefersReducedMotion.current ? 'instant' : 'smooth';
  }

  /** The page the pager rests on, from its scroll position. */
  function pageAt(pager: HTMLElement): number {
    const at = Math.round(pager.scrollLeft / pager.clientWidth);
    return Math.min(Math.max(at, 0), pages.length - 1);
  }

  function scrollPager(index: number, instant: boolean) {
    const pager = pagerEl;
    if (!pager) return;
    pager.scrollTo({
      left: index * pager.clientWidth,
      behavior: behavior(instant),
    });
  }

  /** Turn to a page. Steps past either end wrap round. */
  function show(index: number) {
    const count = pages.length;
    if (count === 0) return;
    const next = ((index % count) + count) % count;
    current = next;
    const pager = pagerEl;
    if (!pager) return;
    // Already resting there: no scroll will come to clear `heading`.
    if (pager.clientWidth > 0 && pageAt(pager) === next) return;
    heading = next;
    scrollPager(next, false);
  }

  function focusTab(index: number) {
    tablistEl
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [index]?.focus({ preventScroll: true });
  }

  /** ARIA tabs, horizontal: ← → move and select (wrapping), Home and End jump. */
  function onTabKeydown(event: KeyboardEvent, index: number) {
    const last = pages.length - 1;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = index === last ? 0 : index + 1;
        break;
      case 'ArrowLeft':
        next = index === 0 ? last : index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    show(next);
    focusTab(next);
  }

  // The pager tells the tabs which page it rests on. Passive listeners, read
  // once a frame.
  $effect(() => {
    const pager = pagerEl;
    if (!pager) return;

    const sync = () => {
      if (!pager.clientWidth) return;
      const at = pageAt(pager);
      if (heading !== null) {
        if (at !== heading) return;
        heading = null;
      }
      current = at;
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    // The visitor took the pager over (a swipe, a trackpad, a scroll that
    // ended short of its page): follow wherever it goes from here.
    const release = () => {
      heading = null;
    };
    const onScrollEnd = () => {
      release();
      onScroll();
    };
    // Sideways only: a wheel turning the PAGE, over the band, is not a turn.
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) release();
    };

    const passive = { passive: true };
    pager.addEventListener('scroll', onScroll, passive);
    pager.addEventListener('scrollend', onScrollEnd, passive);
    pager.addEventListener('pointerdown', release, passive);
    pager.addEventListener('wheel', onWheel, passive);
    return () => {
      pager.removeEventListener('scroll', onScroll);
      pager.removeEventListener('scrollend', onScrollEnd);
      pager.removeEventListener('pointerdown', release);
      pager.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(frame);
    };
  });

  // The active topic, set from outside, turns the pager to its page: at once
  // the first time (the server rendered page 1), then as a normal turn. A
  // swipe moves `current` only, so it never re-runs this and the pager is
  // never pulled back to the active page.
  $effect(() => {
    const pager = pagerEl;
    const target = activeIndex;
    if (!pager) {
      placed = false;
      return;
    }
    untrack(() => {
      if (!placed) {
        placed = true;
        if (target >= 0) current = target;
        if (current > 0) scrollPager(current, true);
        return;
      }
      if (target >= 0 && target !== current) show(target);
    });
  });

  // The selected tab stays in view in a tab row that overflows. It scrolls
  // the row only, never the page, which `scrollIntoView` would.
  $effect(() => {
    const list = tablistEl;
    const index = shown;
    if (!list || list.scrollWidth <= list.clientWidth) return;
    const tab = list.querySelectorAll<HTMLElement>('[role="tab"]')[index];
    if (!tab) return;
    list.scrollTo({
      left: tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2,
      behavior: untrack(() => behavior(false)),
    });
  });
</script>

{#snippet brandFallback()}
  <span class="channels__fallback"></span>
{/snippet}

<!-- One of the topic's newest pieces. -->
{#snippet mini(item: BrowseItem)}
  {@const TypeIcon = TYPE_ICON[item.contentType]}
  <li>
    <a class="channels__mini" href={item.href}>
      <span class="channels__mini-cover">
        {#if item.thumbnail}
          <img src={item.thumbnail} alt="" loading="lazy" decoding="async" />
        {/if}
        <span class="channels__mini-type"><TypeIcon size={12} /></span>
      </span>
      <span class="channels__mini-title">{item.title}</span>
    </a>
  </li>
{/snippet}

<!-- A topic's front page: its art, then its words over the shared veil. -->
{#snippet channelPage(page: ChannelPage, i: number)}
  <div
    id="{uid}-page-{i}"
    class="channels__page"
    role="tabpanel"
    aria-labelledby="{uid}-tab-{i}"
    inert={i !== shown}
  >
    {#if page.topic.coverImageUrl}
      <img
        class="channels__art"
        src={page.topic.coverImageUrl}
        alt=""
        loading="lazy"
        decoding="async"
      />
    {:else}
      <span class="channels__mark" aria-hidden="true"
        >{topicInitial(page.topic.name)}</span
      >
    {/if}

    <div class="channels__copy">
      <p class="channels__kicker">{page.kicker}</p>
      <h3 class="channels__name">{page.topic.name}</h3>
      {#if page.topic.description}
        <p class="channels__desc">{page.topic.description}</p>
      {/if}
      {#if page.mix}
        <p class="channels__mix">{page.mix}</p>
      {/if}
      <Button
        variant="primary"
        size="sm"
        class="channels__cta"
        onclick={() => onSelect(page.topic.slug)}
      >
        {page.cta}
        <ArrowRightIcon size={16} />
      </Button>
      {#if page.minis.length > 0}
        <ul class="channels__minis">
          {#each page.minis as item (item.id)}
            {@render mini(item)}
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/snippet}

<!-- The tab per topic, and the ← → steps (shown on desktop). -->
{#snippet tabBar()}
  <div class="channels__bar">
    <div
      bind:this={tablistEl}
      class="channels__tabs"
      role="tablist"
      aria-label={COPY.tablist}
    >
      {#each pages as page, i (page.topic.id)}
        <button
          type="button"
          role="tab"
          id="{uid}-tab-{i}"
          class="channels__tab"
          aria-selected={i === shown}
          aria-controls="{uid}-page-{i}"
          tabindex={i === shown ? 0 : -1}
          onclick={() => show(i)}
          onkeydown={(event) => onTabKeydown(event, i)}
        >
          {page.topic.name}
        </button>
      {/each}
    </div>

    {#if pages.length > 1}
      <div class="channels__steps">
        <button
          type="button"
          class="channels__step"
          aria-label={COPY.previous}
          aria-controls="{uid}-pager"
          onclick={() => show(shown - 1)}
        >
          <ArrowLeftIcon size={18} />
        </button>
        <button
          type="button"
          class="channels__step"
          aria-label={COPY.next}
          aria-controls="{uid}-pager"
          onclick={() => show(shown + 1)}
        >
          <ArrowRightIcon size={18} />
        </button>
      </div>
    {/if}
  </div>
{/snippet}

<!-- Which page is in view, as dots (decorative: the tabs say it). -->
{#snippet pageDots()}
  {#if pages.length > 1}
    <div class="channels__dots" aria-hidden="true">
      {#each pages as page, i (page.topic.id)}
        <span class="channels__dot" data-on={i === shown ? '' : undefined}
        ></span>
      {/each}
    </div>
  {/if}
{/snippet}

{#if pages.length > 0}
  <div class="channels">
    {@render tabBar()}

    <div class="channels__band">
      <div class="channels__shader" aria-hidden="true">
        <ShaderWindow fallback={brandFallback} />
      </div>
      <div class="channels__veil" aria-hidden="true"></div>

      <div bind:this={pagerEl} id="{uid}-pager" class="channels__pager">
        {#each pages as page, i (page.topic.id)}
          {@render channelPage(page, i)}
        {/each}
      </div>
    </div>

    {@render pageDots()}
  </div>
{/if}

<style>
  .channels {
    /* How much of the brand's media scrim lies over the band: across the
       words, and on the far side where only the photo and shader show. One
       wash over the whole band, flat under the words, thinning away from
       them; never a patch behind a line of text. */
    --_veil-words: 86%;
    --_veil-far: 22%;

    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }

  /* ── Tabs and steps ─────────────────────────────────────────────── */

  .channels__bar {
    display: flex;
    align-items: flex-end;
    gap: var(--space-4);
    min-width: 0;
  }

  .channels__tabs {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    gap: var(--space-5);
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    /* The baseline under the tabs, drawn inside the scroller so a selected
       tab's underline sits on it rather than being clipped below it. */
    box-shadow: inset 0 calc(-1 * var(--border-width)) 0
      var(--color-border-subtle);
  }

  .channels__tabs::-webkit-scrollbar {
    display: none;
  }

  .channels__tab {
    flex: 0 0 auto;
    padding: var(--space-3) var(--space-1);
    border: 0;
    border-bottom: var(--border-width-thick) var(--border-style) transparent;
    background: none;
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-tertiary);
    white-space: nowrap;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .channels__tab:hover {
    color: var(--color-text-secondary);
  }

  .channels__tab[aria-selected='true'] {
    color: var(--color-text-primary);
    border-bottom-color: var(--color-brand-primary);
  }

  /* Inset: the tab row is a scroller, and would clip an outer ring. */
  .channels__tab:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: calc(-1 * var(--border-width-thick));
  }

  .channels__steps {
    display: none;
    flex: 0 0 auto;
    gap: var(--space-2);
    padding-bottom: var(--space-1);
  }

  .channels__step {
    display: grid;
    place-items: center;
    width: var(--space-10);
    height: var(--space-10);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) var(--color-border-strong);
    background: var(--color-surface);
    color: var(--color-text-primary);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .channels__step:hover {
    background: var(--color-surface-secondary);
  }

  .channels__step:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* ── The band: shader, art, one veil, words ─────────────────────── */

  /* Every layer shares this stacking context: the pager makes none, so each
     page's art (1) sits under the shared veil (2) and its words (3) over it. */
  .channels__band {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    border-radius: var(--radius-card);
  }

  .channels__shader,
  .channels__veil {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .channels__shader {
    z-index: 0;
  }

  /* No live shader: the brand's own gradient, so the band still looks made. */
  .channels__fallback {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(
        120% 120% at 28% 22%,
        color-mix(in oklab, var(--color-brand-primary) 55%, var(--color-surface)),
        transparent 68%
      ),
      linear-gradient(
        150deg,
        var(--color-surface-elevated),
        var(--color-surface) 55%,
        color-mix(
          in oklab,
          var(--color-brand-secondary) 45%,
          var(--color-surface)
        )
      );
  }

  /* Phone: the words sit at the foot, so the wash is flat from there up. */
  .channels__veil {
    z-index: 2;
    background: linear-gradient(
      to top,
      color-mix(in srgb, var(--media-scrim) var(--_veil-words), transparent) 0%,
      color-mix(in srgb, var(--media-scrim) var(--_veil-words), transparent)
        55%,
      color-mix(in srgb, var(--media-scrim) var(--_veil-far), transparent) 100%
    );
  }

  .channels__pager {
    display: flex;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
  }

  .channels__pager::-webkit-scrollbar {
    display: none;
  }

  /* Every page is as tall as the tallest (the row stretches them), so the
     band never changes height between topics. */
  .channels__page {
    position: relative;
    flex: 0 0 100%;
    min-width: 0;
    aspect-ratio: 2 / 3;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    scroll-snap-align: start;
    scroll-snap-stop: always;
  }

  /* The cover, in its own colour, dissolving into the shader below it.
     A mask's colour is ignored, only its alpha counts. */
  .channels__art {
    position: absolute;
    inset: 0 0 auto;
    z-index: 1;
    width: 100%;
    height: 60%;
    object-fit: cover;
    display: block;
    mask-image: linear-gradient(to bottom, black 50%, transparent);
  }

  /* No cover: the shader alone, with the topic's initial as a ghost. */
  .channels__mark {
    position: absolute;
    inset: 0 0 auto;
    z-index: 1;
    height: 60%;
    display: grid;
    place-items: center;
    font-family: var(--font-heading);
    font-size: calc(var(--text-5xl) * 3);
    line-height: var(--leading-none);
    color: color-mix(in srgb, var(--media-glyph) 14%, transparent);
    pointer-events: none;
    user-select: none;
  }

  .channels__copy {
    position: relative;
    z-index: 3;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-4);
    color: var(--media-glyph);
  }

  .channels__kicker {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: color-mix(in srgb, var(--media-glyph) 80%, transparent);
  }

  .channels__name {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    line-height: var(--leading-none);
    letter-spacing: var(--tracking-tighter);
    overflow-wrap: anywhere;
  }

  .channels__desc {
    margin: 0;
    max-width: 34ch;
    font-size: var(--text-sm);
    color: color-mix(in srgb, var(--media-glyph) 90%, transparent);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
  }

  .channels__mix {
    margin: 0;
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: color-mix(in srgb, var(--media-glyph) 80%, transparent);
  }

  .channels__copy :global(.channels__cta) {
    margin-top: var(--space-1);
  }

  /* ── Mini cards: the topic's three newest ───────────────────────── */

  /* Three to a row, sized by the column, so the band never grows a second
     scroller inside the pager. */
  .channels__minis {
    list-style: none;
    margin: var(--space-2) 0 0;
    padding: 0;
    width: 100%;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .channels__mini {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    color: inherit;
    text-decoration: none;
    border-radius: var(--radius-card);
  }

  .channels__mini:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .channels__mini-cover {
    position: relative;
    aspect-ratio: 1 / 1;
    overflow: hidden;
    border-radius: var(--radius-card);
    background: var(--color-surface-secondary);
    box-shadow: var(--shadow-lg);
  }

  .channels__mini-cover img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .channels__mini-type {
    position: absolute;
    left: var(--space-1-5);
    bottom: var(--space-1-5);
    width: var(--space-6);
    height: var(--space-6);
    display: grid;
    place-items: center;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--media-scrim) 55%, transparent);
    color: var(--media-glyph);
  }

  .channels__mini-title {
    font-size: var(--text-xs);
    line-height: var(--leading-tight);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }

  .channels__mini:hover .channels__mini-title {
    text-decoration: underline;
  }

  /* ── Page dots ──────────────────────────────────────────────────── */

  .channels__dots {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2);
  }

  .channels__dot {
    width: var(--space-1-5);
    height: var(--space-1-5);
    border-radius: var(--radius-full);
    background: var(--color-border-strong);
    transition:
      width var(--duration-normal) var(--ease-out),
      background-color var(--duration-normal) var(--ease-out);
  }

  .channels__dot[data-on] {
    width: var(--space-5);
    background: var(--color-brand-primary);
  }

  /* ── Desktop: words on the left, the cover on the right ─────────── */

  @media (--breakpoint-md) {
    .channels__steps {
      display: flex;
    }

    .channels__veil {
      background: linear-gradient(
        to right,
        color-mix(in srgb, var(--media-scrim) var(--_veil-words), transparent)
          0%,
        color-mix(in srgb, var(--media-scrim) var(--_veil-words), transparent)
          45%,
        color-mix(in srgb, var(--media-scrim) var(--_veil-far), transparent)
          100%
      );
    }

    .channels__page {
      aspect-ratio: 8 / 3;
      justify-content: center;
    }

    .channels__art,
    .channels__mark {
      inset: 0 0 0 auto;
      width: 62%;
      height: 100%;
    }

    .channels__art {
      mask-image: linear-gradient(to right, transparent, black 45%);
    }

    .channels__mark {
      font-size: calc(var(--text-5xl) * 4);
    }

    .channels__copy {
      width: 50%;
      padding: var(--space-10);
      gap: var(--space-3);
    }

    .channels__name {
      font-size: var(--text-5xl);
    }

    .channels__desc {
      font-size: var(--text-base);
    }

    .channels__minis {
      max-width: 42ch;
    }
  }
</style>

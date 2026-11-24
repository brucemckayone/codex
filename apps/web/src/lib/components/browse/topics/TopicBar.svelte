<!--
  @component TopicBar

  "One bar" (Codex-8swlj.5), the default topic selector BrowseModule hosts: a
  sticky glass bar of topic chips over the catalogue grid. Each chip carries a
  cover dot (the topic's photo, in its own colour) or its initial, its name,
  and a count badge when the count is known. An "All topics" chip clears.

  Every topic is one tap away at any count:
    - sm and up: "See all N ▾" opens a Popover with the topic grid;
    - below sm: "Topics" opens FilterDrawer, a bottom sheet with the same grid.
  A grid pick selects the topic and closes the overlay. A chip is a toggle
  (aria-pressed), so pressing the active one clears it.

  THE GLASS IS DERIVED FROM THE INK, never `--material-glass`: that token
  always lifts lightness, which on a mid-tone org ground pushes the glass
  toward its own light ink (1.18:1 on the mobile dock, #722). Here the ink's
  opposite lightness is mixed into the ground, so the bar always sits on the
  far side of the ink from the text.

  The chip row scrolls inside itself, so the page never scrolls sideways.

  ONE BAR, as the round-1 mock drew it: the host hands its type tabs in as
  `lead`, and they share the band with the chips. On one row from sm up, and
  on a phone a row of their own above "Topics" and the chips.

  The selector contract (shared by TopicBar, TopicWindows, TopicChannels):
  @prop {TopicItem[]} topics - The org's curated topics, in curator order.
  @prop {string | null} active - The active topic slug, or null.
  @prop {(slug: string | null) => void} onSelect - Pick a topic (null = all).
  And TopicBar's own:
  @prop {Snippet} [lead] - Rendered first in the band (the host's type tabs).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { TopicItem } from '$lib/components/topic/topic-card.types';
  import { FilterDrawer } from '$lib/components/ui/FilterDrawer';
  import { ChevronDownIcon, LayoutGridIcon } from '$lib/components/ui/Icon';
  import * as Popover from '$lib/components/ui/Popover';
  import { getThumbnailUrl } from '$lib/utils/image';
  import * as m from '$paraglide/messages';

  interface Props {
    topics: TopicItem[];
    active: string | null;
    onSelect: (slug: string | null) => void;
    /** Rendered first in the band: the host's type tabs, so it is ONE bar. */
    lead?: Snippet;
  }

  const { topics, active, onSelect, lead }: Props = $props();

  /** The phone sheet's one facet: the topic, staged there until Apply. */
  interface TopicFacets {
    topic: string | null;
  }
  const NO_TOPIC: TopicFacets = { topic: null };
  const facets = $derived<TopicFacets>({ topic: active });

  let popoverOpen = $state(false);
  let sheetOpen = $state(false);

  /** The topic's first letter, for a topic with no cover. */
  const initialOf = (name: string) =>
    (Array.from(name.trim())[0] ?? '').toUpperCase();

  const countLabel = (count: number) =>
    count === 1
      ? m.browse_topic_count_one()
      : m.browse_topic_count_other({ count });

  /** A grid pick selects (never toggles) and closes whichever overlay held it. */
  function pick(slug: string | null) {
    onSelect(slug);
    popoverOpen = false;
    sheetOpen = false;
  }
</script>

{#snippet topicGrid(current: string | null)}
  <ul class="topic-bar__grid">
    {#each topics as topic (topic.slug)}
      <li>
        <button
          type="button"
          class="topic-bar__tile"
          aria-pressed={current === topic.slug}
          onclick={() => pick(topic.slug)}
        >
          <span class="topic-bar__tile-art" aria-hidden="true">
            {#if topic.coverImageUrl}
              <img src={topic.coverImageUrl} alt="" loading="lazy" decoding="async" />
            {:else}
              <span class="topic-bar__tile-initial">{initialOf(topic.name)}</span>
            {/if}
          </span>
          <span class="topic-bar__tile-name">{topic.name}</span>
          {#if typeof topic.contentCount === 'number'}
            <span class="topic-bar__tile-count">{countLabel(topic.contentCount)}</span>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
{/snippet}

<div class="topic-bar" data-lead={lead ? '' : undefined}>
  {#if lead}
    <div class="topic-bar__lead">{@render lead()}</div>
  {/if}
  <button
    type="button"
    class="topic-bar__sheet-btn"
    aria-haspopup="dialog"
    aria-expanded={sheetOpen}
    onclick={() => (sheetOpen = true)}
  >
    <LayoutGridIcon size={16} />
    <span>{m.topic_bar_title()}</span>
  </button>

  <div class="topic-bar__chips" role="group" aria-label={m.topic_bar_label()}>
    <button
      type="button"
      class="topic-bar__chip topic-bar__chip--all"
      aria-pressed={active === null}
      onclick={() => onSelect(null)}
    >
      {m.topic_bar_all()}
    </button>
    {#each topics as topic (topic.slug)}
      <button
        type="button"
        class="topic-bar__chip"
        aria-pressed={active === topic.slug}
        onclick={() => onSelect(active === topic.slug ? null : topic.slug)}
      >
        <span class="topic-bar__dot" aria-hidden="true">
          {#if topic.coverImageUrl}
            <img
              src={getThumbnailUrl(topic.coverImageUrl, 'sm')}
              alt=""
              loading="lazy"
              decoding="async"
            />
          {:else}
            {initialOf(topic.name)}
          {/if}
        </span>
        <span class="topic-bar__chip-name">{topic.name}</span>
        {#if typeof topic.contentCount === 'number'}
          <span class="topic-bar__count" aria-hidden="true">{topic.contentCount}</span>
          <span class="sr-only">{countLabel(topic.contentCount)}</span>
        {/if}
      </button>
    {/each}
  </div>

  <Popover.Root bind:open={popoverOpen} positioning={{ placement: 'bottom-end' }}>
    <Popover.Trigger class="topic-bar__more">
      <LayoutGridIcon size={16} />
      <span>{m.topic_bar_see_all({ count: topics.length })}</span>
      <ChevronDownIcon size={16} />
    </Popover.Trigger>
    <Popover.Content class="topic-bar__pop" aria-label={m.topic_bar_title()}>
      {@render topicGrid(active)}
    </Popover.Content>
  </Popover.Root>
</div>

<!-- The phone sheet. A grid pick commits at once and closes; the footer's
     "All topics" stages a clear that Apply commits, as FilterDrawer does on a
     phone, so the grid shows the STAGED topic. -->
<FilterDrawer
  open={sheetOpen}
  onOpenChange={(open) => (sheetOpen = open)}
  title={m.topic_bar_title()}
  filters={facets}
  sort=""
  defaultFilters={NO_TOPIC}
  defaultSort=""
  onFilterChange={(next) => onSelect(next.topic)}
  onSortChange={() => {}}
  onClearAll={() => pick(null)}
  applyLabel={m.topic_bar_apply()}
  doneLabel={m.topic_bar_done()}
  clearLabel={m.topic_bar_all()}
>
  {#snippet sections({ filters })}
    <section class="filter-drawer__section">
      {@render topicGrid(filters.topic)}
    </section>
  {/snippet}
</FilterDrawer>

<style>
  .topic-bar {
    /* The ink's opposite lightness, achromatic, mixed into the ground: a
       surface on the far side of the ink, at any brand lightness. */
    --_glass: color-mix(
      in oklch,
      var(--color-background) 72%,
      oklch(from var(--color-text) calc(1 - l) 0 0)
    );

    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-2);
    border: var(--border-width) var(--border-style)
      color-mix(in oklch, var(--color-text) 12%, transparent);
    border-radius: var(--radius-lg);
    background: color-mix(in oklch, var(--_glass) 82%, transparent);
    -webkit-backdrop-filter: blur(var(--blur-xl)) saturate(1.8);
    backdrop-filter: blur(var(--blur-xl)) saturate(1.8);
    /* A lit top rim, tinted from the glass itself, never a literal white. */
    box-shadow:
      inset 0 var(--border-width) 0
        oklch(from var(--_glass) calc(l + 0.08) c h / 0.7),
      var(--shadow-sm);
    color: var(--color-text);
  }

  /* The chip row scrolls inside the bar. Its end fades to say there is more,
     and the end padding lets the last chip clear that fade. */
  .topic-bar__chips {
    display: flex;
    flex: 1;
    gap: var(--space-2);
    min-width: 0;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    scrollbar-width: none;
    padding: var(--space-1) var(--space-8) var(--space-1) var(--space-1);
    -webkit-mask-image: linear-gradient(
      to right,
      black calc(100% - var(--space-8)),
      transparent
    );
    mask-image: linear-gradient(
      to right,
      black calc(100% - var(--space-8)),
      transparent
    );
  }

  .topic-bar__chips::-webkit-scrollbar {
    display: none;
  }

  .topic-bar__chip {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--space-8);
    padding: var(--space-1) var(--space-3) var(--space-1) var(--space-1);
    font: inherit;
    font-size: var(--text-sm);
    white-space: nowrap;
    border: var(--border-width) var(--border-style)
      color-mix(in oklch, var(--color-text) 18%, transparent);
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .topic-bar__chip--all {
    padding-inline: var(--space-4);
  }

  .topic-bar__chip:hover {
    border-color: color-mix(in oklch, var(--color-text) 40%, transparent);
  }

  /* Selected: brand primary, the same rule as the type tabs below. */
  .topic-bar__chip[aria-pressed='true'] {
    background: var(--color-brand-primary);
    border-color: transparent;
    color: var(--color-text-on-brand);
  }

  /* The cover dot. A photo keeps its own colour; a topic without one gets
     the brand-tinted ground and its initial. */
  .topic-bar__dot {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    inline-size: var(--space-6);
    block-size: var(--space-6);
    overflow: hidden;
    border-radius: var(--radius-full);
    background: color-mix(
      in oklch,
      var(--color-brand-primary) 55%,
      var(--color-surface)
    );
    color: var(--color-text);
    font-family: var(--font-heading);
    font-size: var(--text-xs);
    line-height: var(--leading-none);
  }

  .topic-bar__dot img {
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
  }

  .topic-bar__count {
    padding: 0 var(--space-2);
    border-radius: var(--radius-full);
    background: color-mix(in oklch, currentColor 14%, transparent);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    line-height: var(--leading-tight);
  }

  /* The two overlay triggers: "Topics" below sm, "See all N" from sm up. */
  .topic-bar__sheet-btn,
  .topic-bar :global(.topic-bar__more) {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--space-8);
    padding: var(--space-1) var(--space-3);
    font: inherit;
    font-size: var(--text-sm);
    white-space: nowrap;
    border: var(--border-width) var(--border-style)
      color-mix(in oklch, var(--color-text) 28%, transparent);
    border-radius: var(--radius-full);
    background: color-mix(in oklch, var(--_glass) 60%, transparent);
    color: var(--color-text);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .topic-bar__sheet-btn:hover,
  .topic-bar :global(.topic-bar__more:hover) {
    border-color: color-mix(in oklch, var(--color-text) 50%, transparent);
  }

  .topic-bar__sheet-btn {
    display: none;
  }

  /* The host's type tabs, first in the band and never squeezed. */
  .topic-bar__lead {
    flex: 0 0 auto;
    display: flex;
    min-width: 0;
  }

  @media (--below-sm) {
    .topic-bar__sheet-btn {
      display: inline-flex;
    }

    .topic-bar :global(.topic-bar__more) {
      display: none;
    }

    /* A phone: the tabs take a row of their own, above Topics and the chips. */
    .topic-bar[data-lead] {
      flex-wrap: wrap;
    }

    .topic-bar__lead {
      flex-basis: 100%;
    }
  }

  .topic-bar__chip:focus-visible,
  .topic-bar__sheet-btn:focus-visible,
  .topic-bar :global(.topic-bar__more:focus-visible),
  .topic-bar__tile:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* Through the bar: Popover.Content's own `.popover-content` caps it at
     20rem, too narrow for a grid of covers. */
  .topic-bar :global(.topic-bar__pop) {
    inline-size: min(var(--container-md), calc(100vw - var(--space-8)));
    max-inline-size: none;
    max-block-size: calc(100dvh - var(--space-32));
    overflow-y: auto;
    padding: var(--space-5);
    border-radius: var(--radius-card);
  }

  /* The topic grid, shared by the popover and the phone sheet. */
  .topic-bar__grid {
    display: grid;
    grid-template-columns: repeat(
      auto-fill,
      minmax(min(100%, var(--space-32)), 1fr)
    );
    gap: var(--space-4) var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .topic-bar__tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    inline-size: 100%;
    padding: 0;
    border: 0;
    border-radius: var(--radius-card);
    background: none;
    color: var(--color-text);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .topic-bar__tile-art {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    border-radius: var(--radius-card);
    background:
      radial-gradient(
        circle at 30% 20%,
        color-mix(in oklch, var(--color-brand-primary) 55%, var(--color-surface)),
        transparent 70%
      ),
      color-mix(in oklch, var(--color-brand-secondary) 45%, var(--color-surface));
    transition: var(--transition-shadow);
  }

  .topic-bar__tile-art img {
    position: absolute;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
  }

  .topic-bar__tile-initial {
    font-family: var(--font-heading);
    font-size: var(--text-4xl);
    line-height: var(--leading-none);
    color: color-mix(in oklch, var(--color-text) 30%, transparent);
  }

  /* Pressed: a brand ring round the art, and a heavier name, so the choice is
     never carried by colour alone. */
  .topic-bar__tile[aria-pressed='true'] .topic-bar__tile-art {
    box-shadow: 0 0 0 var(--border-width-thick) var(--color-brand-primary);
  }

  .topic-bar__tile[aria-pressed='true'] .topic-bar__tile-name {
    font-weight: var(--font-semibold);
  }

  .topic-bar__tile-name {
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    line-height: var(--leading-tight);
  }

  /* `--color-text-secondary`, not tertiary: tertiary sits near 3.5:1 on light
     org grounds (see FilterDrawer's heading note). */
  .topic-bar__tile-count {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
</style>

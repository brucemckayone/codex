<!--
  @component TopicCarousel

  Horizontal "Browse by topic" rail of `TopicCard`s. Replaces the earlier
  auto-fill `TopicGrid`: with six or more curated topics the grid wrapped into a
  ragged part-filled second row, which read as an accident rather than a set. A
  rail holds one line, one rhythm, and any number of topics.

  Built on the shared `Carousel` primitive — the same one the landing feed's
  "New this week" and contributor rails use — so scroll-snap, keyboard focus
  scrolling, touch swipe, thin scrollbar and reduced-motion handling all come
  from one place rather than being re-invented here.

  Arrows are ON (unlike some sibling rails) because this module previously
  showed every topic at once: without a visible affordance a mouse-only visitor
  would have no cue that topics continue past the right edge. The primitive
  hides them on touch devices, where swiping is the natural gesture.

  Thin mapper: it turns `TopicItem[]` into cards, builds each card's deep-link
  href from its slug (default `?category=<slug>` — WP-11's contract), and
  forwards an optional `onselect` for inline filtering (WP-10). The primitive
  renders nothing when there are no topics, so callers can drop it in without an
  outer guard.

  @prop {TopicItem[]} items - Topics to render (already ordered by the server).
  @prop {(slug: string) => string} [hrefFor] - Build a card href from its slug.
  @prop {(slug: string) => void} [onselect] - Inline-filter hook forwarded to cards.
  @prop {string} [ariaLabel] - Accessible name for the carousel region.
-->
<script lang="ts">
  import Carousel from '$lib/components/carousel/Carousel.svelte';
  import TopicCard from './TopicCard.svelte';
  import type { TopicItem } from './topic-card.types';

  interface Props {
    items: TopicItem[];
    hrefFor?: (slug: string) => string;
    onselect?: (slug: string) => void;
    ariaLabel?: string;
  }

  const {
    items,
    hrefFor = (slug: string) => `?category=${encodeURIComponent(slug)}`,
    onselect,
    ariaLabel = 'Browse by topic',
  }: Props = $props();
</script>

<Carousel
  {items}
  {ariaLabel}
  itemMinWidth="21rem"
  gap="var(--space-4)"
  class="topic-carousel"
>
  {#snippet renderItem(item: TopicItem)}
    <TopicCard
      name={item.name}
      slug={item.slug}
      href={hrefFor(item.slug)}
      coverImageUrl={item.coverImageUrl}
      description={item.description}
      {onselect}
    />
  {/snippet}
</Carousel>

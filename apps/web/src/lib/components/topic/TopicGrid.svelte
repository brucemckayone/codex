<!--
  @component TopicGrid

  Responsive, image-led grid of `TopicCard`s for the landing "Browse by topic"
  section. Auto-fills 16rem tracks (matching the mockup's `.topic-grid`), so it
  packs 2–5 topics per row by width rather than the fixed 1→2→3 rhythm of
  `.content-grid` — topic cards are denser and 16:9, so a distinct grid fits.

  Thin mapper: it turns `TopicItem[]` into cards, builds each card's deep-link
  href from its slug (default `?category=<slug>` — WP-11's contract), and
  forwards an optional `onselect` for inline filtering (WP-10). Renders nothing
  when there are no topics, so callers can drop it in without an outer guard.

  @prop {TopicItem[]} items - Topics to render (already ordered by the server).
  @prop {(slug: string) => string} [hrefFor] - Build a card href from its slug.
  @prop {(slug: string) => void} [onselect] - Inline-filter hook forwarded to cards.
-->
<script lang="ts">
  import TopicCard from './TopicCard.svelte';
  import type { TopicItem } from './topic-card.types';

  interface Props {
    items: TopicItem[];
    hrefFor?: (slug: string) => string;
    onselect?: (slug: string) => void;
  }

  const {
    items,
    hrefFor = (slug: string) => `?category=${encodeURIComponent(slug)}`,
    onselect,
  }: Props = $props();
</script>

{#if items.length > 0}
  <div class="topic-grid">
    {#each items as item (item.id)}
      <TopicCard
        name={item.name}
        slug={item.slug}
        href={hrefFor(item.slug)}
        coverImageUrl={item.coverImageUrl}
        icon={item.icon}
        description={item.description}
        {onselect}
      />
    {/each}
  </div>
{/if}

<style>
  /* 16rem min track matches the mockup + the existing masonry idiom in
     utilities.css (18rem). Track sizing is not a spacing-scale concern, so the
     literal rem is intentional; the gap uses a spacing token. */
  .topic-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
    gap: var(--space-5);
  }
</style>

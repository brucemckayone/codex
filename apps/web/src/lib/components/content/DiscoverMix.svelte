<!--
  @component DiscoverMix

  Optional bento-grid section for the org landing page. Renders a curated
  mix of content items with varied tile sizes so the grid ignores media-
  type boundaries and shows breadth at a glance.

  Layout (desktop 4-col):
    - Item 1: 2×2 hero (top-left block)
    - Items 2-5: 1×1 minor tiles (top-right quadrant, 2 cols × 2 rows)
    - Item 6: 4×1 wide banner across the bottom

  Mobile (2-col): Hero spans both cols, minors fall into a 2×2 grid,
  wide banner spans both cols.

  Card treatment: hero tiles use `variant="featured"` to lean into the
  larger area; minor tiles use the default `variant="grid"`. The existing
  per-type aspect ratios (audio 1:1, article 3:2, video 16:9) create
  intentional visual variety inside the shared grid.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { useAccessContext } from '$lib/utils/access-context.svelte';

  interface MixItem {
    id: string;
    title: string;
    slug: string;
    description?: string | null;
    thumbnailUrl?: string | null;
    contentType?: 'video' | 'audio' | 'written' | null;
    mediaItem?: {
      thumbnailUrl?: string | null;
      durationSeconds?: number | null;
    } | null;
    creator?: { name?: string | null } | null;
    priceCents?: number | null;
    accessType?: 'free' | 'paid' | 'followers' | 'subscribers' | 'team' | null;
    category?: string | null;
  }

  interface Props {
    items: MixItem[];
    access: ReturnType<typeof useAccessContext>;
  }

  const { items, access }: Props = $props();

  // Cap to 6 so the layout always matches the template slots. Larger
  // collections get truncated — the parent section can expose a "View all"
  // link via FeedSection.viewAllHref.
  const slotted = $derived(items.slice(0, 6));

  function cardContentType(
    t: MixItem['contentType']
  ): 'video' | 'audio' | 'article' | undefined {
    if (!t) return undefined;
    return t === 'written' ? 'article' : t;
  }
</script>

<div class="discover-mix">
  {#each slotted as item, i (item.id)}
    <div
      class="discover-mix__slot"
      data-slot={i === 0 ? 'hero' : i === 5 ? 'wide' : 'minor'}
    >
      <ContentCard
        variant={i === 0 || i === 5 ? 'featured' : 'grid'}
        id={item.id}
        title={item.title}
        thumbnail={item.mediaItem?.thumbnailUrl ?? item.thumbnailUrl ?? null}
        description={item.description}
        contentType={cardContentType(item.contentType)}
        duration={item.mediaItem?.durationSeconds ?? null}
        creator={item.creator?.name
          ? { username: item.creator.name, displayName: item.creator.name }
          : undefined}
        href={buildContentUrl(page.url, item)}
        price={item.priceCents != null
          ? { amount: item.priceCents, currency: 'GBP' }
          : null}
        contentAccessType={item.accessType}
        included={access.isIncluded(item)}
        isFollower={access.isFollowing}
        tierName={access.getTierName(item)}
        category={item.category ?? null}
      />
    </div>
  {/each}
</div>

<style>
  .discover-mix {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-rows: minmax(calc(var(--space-24) * 2), auto);
    gap: var(--space-4);
    padding-inline: var(--space-4);
  }

  @media (--breakpoint-md) {
    .discover-mix {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--space-5);
      padding-inline: 0;
    }
  }

  /* Slot wrappers let us apply grid-column/grid-row to the data-slot
     attribute rather than :nth-child (more resilient if #items ≠ 6). */
  .discover-mix__slot {
    min-width: 0;
    min-height: 0;
  }

  .discover-mix__slot > :global(.cc) {
    height: 100%;
  }

  /* Desktop template — hero takes top-left 2×2, wide banner spans the
     whole bottom row. Minors naturally fill the remaining cells. */
  @media (--breakpoint-md) {
    .discover-mix__slot[data-slot='hero'] {
      grid-column: span 2;
      grid-row: span 2;
    }

    .discover-mix__slot[data-slot='wide'] {
      grid-column: span 4;
      grid-row: span 1;
    }
  }

  /* Mobile (2-col): hero and wide banner span both columns. Minors
     fall into standard 1-col-wide cells. */
  @media (--below-md) {
    .discover-mix__slot[data-slot='hero'],
    .discover-mix__slot[data-slot='wide'] {
      grid-column: span 2;
    }
  }

  /* Subtle stagger reveal — mirrors the AudioWall pattern. */
  @media (prefers-reduced-motion: no-preference) {
    .discover-mix__slot {
      opacity: 0;
      transform: translateY(var(--space-3));
      animation: discover-mix-in var(--duration-slower) var(--ease-out)
        forwards;
    }

    .discover-mix__slot:nth-child(1) {
      animation-delay: 40ms;
    }
    .discover-mix__slot:nth-child(2) {
      animation-delay: 80ms;
    }
    .discover-mix__slot:nth-child(3) {
      animation-delay: 120ms;
    }
    .discover-mix__slot:nth-child(4) {
      animation-delay: 160ms;
    }
    .discover-mix__slot:nth-child(5) {
      animation-delay: 200ms;
    }
    .discover-mix__slot:nth-child(6) {
      animation-delay: 240ms;
    }
  }

  @keyframes discover-mix-in {
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>

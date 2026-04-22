<!--
  @component AudioWall

  Mosaic grid of square audio cards — the landing page's "Listen" section
  rendered as an album wall rather than a horizontal carousel. Each tile
  is a ContentCard grid variant; ContentCard itself enforces 1:1 album-art
  framing when `contentType='audio'`, so this component is purely a
  responsive grid wrapper.

  Caps the visible tiles at 8 (4×2 desktop, 2×4 mobile). When more exist,
  renders a "View all →" anchor in the final tile slot so users can drill
  in without the wall overflowing the viewport.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { MusicIcon } from '$lib/components/ui/Icon';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { useAccessContext } from '$lib/utils/access-context.svelte';

  interface AudioItem {
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
    items: AudioItem[];
    access: ReturnType<typeof useAccessContext>;
    /** Where "View all" should link when items exceed the display cap. */
    viewAllHref?: string;
  }

  const DISPLAY_CAP = 8;

  const { items, access, viewAllHref = '/explore?type=audio' }: Props = $props();

  const visible = $derived(items.slice(0, DISPLAY_CAP));
  const overflow = $derived(Math.max(0, items.length - DISPLAY_CAP));
</script>

<div class="audio-wall">
  {#each visible as item (item.id)}
    <ContentCard
      variant="grid"
      id={item.id}
      title={item.title}
      thumbnail={item.mediaItem?.thumbnailUrl ?? item.thumbnailUrl ?? null}
      description={item.description}
      contentType="audio"
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
  {/each}

  {#if overflow > 0}
    <a class="audio-wall__more" href={viewAllHref}>
      <span class="audio-wall__more-icon" aria-hidden="true">
        <MusicIcon size={28} />
      </span>
      <span class="audio-wall__more-count">+{overflow}</span>
      <span class="audio-wall__more-label">View all audio</span>
    </a>
  {/if}
</div>

<style>
  .audio-wall {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
    padding-inline: var(--space-4);
  }

  @media (--breakpoint-md) {
    .audio-wall {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--space-5);
      padding-inline: 0;
    }
  }

  /* Stagger reveal — tiles fade up in sequence so the wall materialises
     rather than snapping in. Capped at 8 delays to match the display cap. */
  @media (prefers-reduced-motion: no-preference) {
    .audio-wall :global(.cc),
    .audio-wall__more {
      opacity: 0;
      transform: translateY(var(--space-3));
      animation: audio-wall-in var(--duration-slower) var(--ease-out) forwards;
    }

    .audio-wall :global(.cc:nth-child(1)) { animation-delay: 40ms; }
    .audio-wall :global(.cc:nth-child(2)) { animation-delay: 80ms; }
    .audio-wall :global(.cc:nth-child(3)) { animation-delay: 120ms; }
    .audio-wall :global(.cc:nth-child(4)) { animation-delay: 160ms; }
    .audio-wall :global(.cc:nth-child(5)) { animation-delay: 200ms; }
    .audio-wall :global(.cc:nth-child(6)) { animation-delay: 240ms; }
    .audio-wall :global(.cc:nth-child(7)) { animation-delay: 280ms; }
    .audio-wall :global(.cc:nth-child(8)) { animation-delay: 320ms; }
    .audio-wall__more { animation-delay: 360ms; }
  }

  @keyframes audio-wall-in {
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Overflow tile — lives at the end of the mosaic when > 8 items exist.
     Matches the aspect ratio and radius of the surrounding audio cards
     (1:1 album) so the grid cell doesn't collapse against its neighbours. */
  .audio-wall__more {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    aspect-ratio: 1 / 1;
    padding: var(--space-4);
    font-family: var(--font-sans);
    color: var(--color-text-secondary);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-border) 60%, transparent);
    border-radius: var(--radius-xl);
    text-decoration: none;
    text-align: center;
    overflow: hidden;
    transition:
      transform var(--duration-slow) var(--ease-smooth),
      box-shadow var(--duration-slow) var(--ease-smooth),
      background-color var(--duration-fast) var(--ease-default),
      color var(--duration-fast) var(--ease-default);
  }

  .audio-wall__more:hover {
    background: color-mix(in srgb, var(--color-text) 6%, var(--color-surface-secondary));
    color: var(--color-text);
    transform: translateY(calc(-1 * var(--space-0-5)));
    box-shadow: var(--shadow-md);
  }

  .audio-wall__more:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .audio-wall__more-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-12);
    height: var(--space-12);
    color: var(--color-text-secondary);
    background: color-mix(in srgb, var(--color-text) 8%, transparent);
    border-radius: var(--radius-full);
  }

  .audio-wall__more-count {
    font-size: var(--text-2xl);
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .audio-wall__more-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    letter-spacing: var(--tracking-normal);
  }
</style>

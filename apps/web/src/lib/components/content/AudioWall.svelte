<!--
  @component AudioWall

  "Listen" section of the org landing page, rendered as a music-app style
  playlist: a 2-column grid of horizontal audio rows on desktop (album art
  left, title + waveform + meta right) and a single-column stack on mobile.
  ContentCard renders the horizontal treatment when `layout='row'` and
  `contentType='audio'` — this wrapper is purely a responsive grid host.

  Caps the visible rows at 8 (4 rows × 2 columns desktop, 8 rows × 1 column
  mobile). When more items exist, the final cell renders a "+N View all
  audio" anchor so users can drill in without overflowing the viewport.
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
      layout="row"
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
      <span class="audio-wall__more-body">
        <span class="audio-wall__more-count">+{overflow}</span>
        <span class="audio-wall__more-label">View all audio</span>
      </span>
    </a>
  {/if}
</div>

<style>
  /*
    Two-column grid of horizontal audio rows on desktop; stacks to a
    single column on mobile. Rows live inside each column as ContentCard
    (`layout='row'`) instances — the grid itself does not need row-
    templating because each child is a self-contained row.
  */
  .audio-wall {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    /* Smaller column gap than the old mosaic — rows are themselves padded. */
    gap: var(--space-2);
    padding-inline: var(--space-4);
  }

  @media (--breakpoint-md) {
    .audio-wall {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      column-gap: var(--space-4);
      row-gap: var(--space-2);
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

  /*
    Overflow affordance — lives at the end of the row grid. Shaped as a
    horizontal pill to match the rhythm of the audio rows (album art on
    the left, "+N View all" on the right) instead of a square tile.
  */
  .audio-wall__more {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    /* Gap + padding bumped in lockstep with the audio-row refinement so
       the overflow affordance keeps reading as "just another row". */
    gap: var(--space-4);
    padding: var(--space-3);
    /* Matches the new album-art size + padding total:
       112 (thumb) + 12×2 (padding) + border slack = ~140 */
    min-height: calc(var(--space-24) + var(--space-4) + var(--space-6));
    font-family: var(--font-sans);
    color: var(--color-text-secondary);
    background: transparent;
    border: var(--border-width) var(--border-style) transparent;
    border-radius: var(--radius-lg);
    text-decoration: none;
    text-align: left;
    overflow: hidden;
    transition:
      transform var(--duration-slow) var(--ease-smooth),
      box-shadow var(--duration-slow) var(--ease-smooth),
      background-color var(--duration-fast) var(--ease-default),
      border-color var(--duration-fast) var(--ease-default),
      color var(--duration-fast) var(--ease-default);
  }

  .audio-wall__more:hover {
    background: color-mix(in srgb, var(--color-surface-card) 70%, transparent);
    border-color: color-mix(in srgb, var(--color-border) 50%, transparent);
    color: var(--color-text);
    transform: translateY(calc(-1 * var(--space-0-5)));
    box-shadow: var(--shadow-sm);
  }

  .audio-wall__more:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .audio-wall__more-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* Matches the album-art size of the surrounding audio rows so the
       affordance reads as one of them. 112px — composed from space-24
       + space-4 — in lockstep with `.cc--audio-row .cc__thumb`. */
    width: calc(var(--space-24) + var(--space-4));
    height: calc(var(--space-24) + var(--space-4));
    color: var(--color-text-secondary);
    background: color-mix(in srgb, var(--color-text) 8%, transparent);
    border-radius: var(--radius-md);
  }

  .audio-wall__more-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .audio-wall__more-count {
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .audio-wall__more-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    letter-spacing: var(--tracking-normal);
    color: var(--color-text-secondary);
  }

  @media (prefers-reduced-motion: reduce) {
    .audio-wall__more:hover {
      transform: none;
    }
  }
</style>

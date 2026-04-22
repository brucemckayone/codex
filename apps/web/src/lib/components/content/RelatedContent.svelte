<!--
  @component RelatedContent

  Shared "More from this creator" grid used by both the org and creator
  content detail pages. Extracted from the two page wrappers so the markup,
  skeleton, and responsive grid live in one place.

  Callers provide an `hrefBuilder` so the grid can route correctly for
  either the org subdomain route or the creator subdomain route.

  @prop {ContentWithRelations[]} items - Related content (already filtered by caller)
  @prop {string} creatorName - Display name for the creator heading
  @prop {(item: ContentWithRelations) => string} hrefBuilder - Href builder per card
  @prop {string} [className] - Optional extra class on the root section
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import type { ContentWithRelations } from '$lib/types';

  // Same "mediaItem with resolved URLs" shape used by ContentDetailView — the
  // public content API resolves R2 keys to full CDN URLs (thumbnailUrl) that
  // aren't on the base MediaItem schema type.
  type RelatedItem = ContentWithRelations & {
    mediaItem?:
      | (NonNullable<ContentWithRelations['mediaItem']> & {
          thumbnailUrl?: string | null;
        })
      | null;
  };

  interface Props {
    items: RelatedItem[];
    creatorName: string;
    hrefBuilder: (item: RelatedItem) => string;
    class?: string;
  }

  const { items, creatorName, hrefBuilder, class: className }: Props = $props();
</script>

{#if items.length > 0}
  <section class={`related-content ${className ?? ''}`.trim()}>
    <h2 class="related-content__heading">
      {m.content_detail_more_from_creator({ creator: creatorName })}
    </h2>
    <div class="related-content__grid">
      {#each items as item (item.id)}
        <ContentCard
          id={item.id}
          title={item.title}
          thumbnail={item.mediaItem?.thumbnailUrl ?? null}
          description={item.description}
          contentType={item.contentType === 'written'
            ? 'article'
            : (item.contentType as 'video' | 'audio')}
          duration={item.mediaItem?.durationSeconds ?? null}
          href={hrefBuilder(item)}
          price={item.priceCents != null
            ? { amount: item.priceCents, currency: 'GBP' }
            : null}
          contentAccessType={item.accessType as 'free' | 'paid' | 'followers' | 'subscribers' | 'team' | null}
        />
      {/each}
    </div>
  </section>
{/if}

<style>
  .related-content {
    width: 100%;
    max-width: var(--container-max, 960px);
    margin: 0 auto;
    padding: 0 var(--space-4) var(--space-8);
    /* Related content is far below the fold — defer render/paint until
       it scrolls near. Size hint reserves layout space so scrolling
       doesn't jump when the browser starts painting. */
    content-visibility: auto;
    contain-intrinsic-size: auto 500px;
  }

  .related-content__heading {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0 0 var(--space-4);
    padding-top: var(--space-6);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .related-content__grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }

  @media (--breakpoint-sm) {
    .related-content__grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (--breakpoint-md) {
    .related-content {
      padding: 0 var(--space-6) var(--space-10);
    }
  }

  @media (--breakpoint-lg) {
    .related-content__grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }
</style>

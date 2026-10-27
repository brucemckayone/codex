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
  import { getDisplayThumbnail } from '$lib/utils/thumbnail';
  import * as m from '$paraglide/messages';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { deriveContentAccessKind } from '$lib/utils/content-access';
  import type { ContentWithRelations } from '$lib/types';

  // The media item and org fields a card and its link read. The public content
  // API sends the media fields with the R2 keys already resolved to CDN URLs
  // (Codex-ve5eh) and the org as four fields (Codex-567de).
  // No `purchaseCount`: the public and browse lists never send it.
  type RelatedItem = Omit<
    ContentWithRelations,
    'mediaItem' | 'organization' | 'purchaseCount'
  > & {
    mediaItem?: {
      durationSeconds?: number | null;
      thumbnailUrl?: string | null;
    } | null;
    organization?: { slug: string } | null;
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
        <!-- 1, 2, then 4 columns. The section caps at --container-max (80rem)
             beside the 4rem rail, which it reaches at 84rem, less its 1.5rem
             padding and three 1rem gaps. -->
        <ContentCard
          sizes="(min-width: 84rem) calc((80rem - 6rem) / 4), (min-width: 64rem) calc((100vw - 4rem - 6rem) / 4), (min-width: 40rem) calc((100vw - 4rem) / 2), calc(100vw - 2rem)"
          id={item.id}
          title={item.title}
          thumbnail={getDisplayThumbnail(item)}
          description={item.description}
          contentType={item.contentType === 'written'
            ? 'article'
            : (item.contentType as 'video' | 'audio')}
          duration={item.mediaItem?.durationSeconds ?? null}
          href={hrefBuilder(item)}
          price={item.priceCents != null
            ? { amount: item.priceCents, currency: 'GBP' }
            : null}
          contentAccessType={deriveContentAccessKind(item)}
          featured={item.featured ?? false}
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

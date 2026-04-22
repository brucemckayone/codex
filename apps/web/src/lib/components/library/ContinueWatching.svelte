<!--
  @component ContinueWatching

  Displays a horizontal row of in-progress content items using the Carousel component.
  Filters items where positionSeconds > 0 and not completed, sorted by updatedAt desc.
  Shows up to 4 items. Does not render if no in-progress items exist.

  @prop {import('$lib/collections').LibraryItem[]} items - All library items
  @prop {'default' | 'prominent'} variant - Layout variant. 'prominent' uses larger min-width and bottom border.
-->
<script lang="ts">
  import {
    subscriptionCollection,
    useLiveQuery,
    type LibraryItem,
    type SubscriptionItem,
  } from '$lib/collections';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import Carousel from '$lib/components/carousel/Carousel.svelte';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import {
    getLibraryAccessState,
    indexSubscriptionsBySlug,
  } from '$lib/subscription/library-access';

  interface Props {
    items: LibraryItem[];
    variant?: 'default' | 'prominent';
  }

  const { items, variant = 'default' }: Props = $props();

  const continueWatchingItems = $derived.by(() => {
    return items
      .filter(
        (item) =>
          item.progress &&
          item.progress.positionSeconds > 0 &&
          !item.progress.completed
      )
      .sort((a, b) => {
        const aTime = a.progress?.updatedAt ?? '';
        const bTime = b.progress?.updatedAt ?? '';
        return bTime.localeCompare(aTime);
      })
      .slice(0, 4);
  });

  const itemMinWidth = $derived(variant === 'prominent' ? '280px' : '240px');

  // Subscription-backed access state (Codex-k7ppt).
  const subsQuery = useLiveQuery(
    (q) => q.from({ sub: subscriptionCollection }),
    undefined,
    { ssrData: [] as SubscriptionItem[] }
  );

  const subsBySlug = $derived(
    indexSubscriptionsBySlug((subsQuery.data ?? []) as SubscriptionItem[])
  );
</script>

{#snippet renderItem(item: LibraryItem)}
  {@const access = getLibraryAccessState(
    {
      accessType: item.accessType,
      organizationSlug: item.content.organizationSlug ?? null,
    },
    subsBySlug
  )}
  <ContentCard
    variant="resume"
    id={item.content.id}
    title={item.content.title}
    thumbnail={item.content.thumbnailUrl}
    contentType={(item.content.contentType === 'written' ? 'article' : item.content.contentType) as 'video' | 'audio' | 'article'}
    duration={item.content.durationSeconds}
    progress={item.progress}
    href={buildContentUrl(page.url, item.content)}
    accessState={access.kind}
    accessStatePeriodEnd={access.kind === 'cancelling' ? access.periodEnd : null}
  />
{/snippet}

<section class="continue-watching" class:continue-watching--prominent={variant === 'prominent'}>
  <Carousel
    items={continueWatchingItems}
    {renderItem}
    title={m.library_continue_watching()}
    {itemMinWidth}
    gap="var(--space-4)"
    ariaLabel={m.library_continue_watching()}
  />
</section>

<style>
  .continue-watching {
    margin-bottom: var(--space-8);
  }

  /* Prominent variant */
  .continue-watching--prominent {
    padding-bottom: var(--space-6);
    margin-bottom: var(--space-6);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }
</style>

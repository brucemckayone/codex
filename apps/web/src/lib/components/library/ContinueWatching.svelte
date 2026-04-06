<!--
  @component ContinueWatching

  Displays a horizontal row of in-progress content items using the Carousel component.
  Filters items where positionSeconds > 0 and not completed, sorted by updatedAt desc.
  Shows up to 4 items. Does not render if no in-progress items exist.

  @prop {import('$lib/collections').LibraryItem[]} items - All library items
  @prop {'default' | 'prominent'} variant - Layout variant. 'prominent' uses larger min-width and bottom border.
-->
<script lang="ts">
  import type { LibraryItem } from '$lib/collections';
  import * as m from '$paraglide/messages';
  import Carousel from '$lib/components/carousel/Carousel.svelte';
  import ContinueWatchingCard from './ContinueWatchingCard.svelte';

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

  const cardSize = $derived(variant === 'prominent' ? 'large' : 'default');
  const itemMinWidth = $derived(variant === 'prominent' ? '280px' : '220px');
</script>

{#snippet renderItem(item: LibraryItem)}
  <ContinueWatchingCard {item} size={cardSize} />
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

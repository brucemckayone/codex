<!--
  @component ContinueWatching

  Displays a horizontal row of in-progress content items.
  Filters items where positionSeconds > 0 and not completed, sorted by updatedAt desc.
  Shows up to 4 items. Does not render if no in-progress items exist.

  @prop {import('$lib/collections').LibraryItem[]} items - All library items
  @prop {'default' | 'prominent'} variant - Layout variant. 'prominent' uses larger heading, CSS grid, and bottom border.
-->
<script lang="ts">
  import type { LibraryItem } from '$lib/collections';
  import * as m from '$paraglide/messages';
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
</script>

{#if continueWatchingItems.length > 0}
  <section class="continue-watching" class:continue-watching--prominent={variant === 'prominent'}>
    <h2 class="continue-watching__title">{m.library_continue_watching()}</h2>
    <div class="continue-watching__row">
      {#each continueWatchingItems as item (item.content.id)}
        <ContinueWatchingCard {item} size={cardSize} />
      {/each}
    </div>
  </section>
{/if}

<style>
  .continue-watching {
    margin-bottom: var(--space-8);
  }

  .continue-watching__title {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin-bottom: var(--space-4);
  }

  .continue-watching__row {
    display: flex;
    gap: var(--space-4);
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    padding-bottom: var(--space-2);
  }

  /* Hide scrollbar but keep functionality */
  .continue-watching__row::-webkit-scrollbar {
    height: 4px;
  }

  .continue-watching__row::-webkit-scrollbar-track {
    background: transparent;
  }

  .continue-watching__row::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: var(--radius-full, 9999px);
  }

  @media (--breakpoint-sm) {
    .continue-watching__row {
      overflow-x: visible;
      scroll-snap-type: none;
    }
  }

  /* Prominent variant */
  .continue-watching--prominent {
    padding-bottom: var(--space-6);
    margin-bottom: var(--space-6);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .continue-watching--prominent .continue-watching__title {
    font-size: var(--text-2xl);
  }

  .continue-watching--prominent .continue-watching__row {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    overflow-x: visible;
    scroll-snap-type: none;
  }

  @media (--breakpoint-sm) {
    .continue-watching--prominent .continue-watching__row {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (--breakpoint-lg) {
    .continue-watching--prominent .continue-watching__row {
      grid-template-columns: repeat(4, 1fr);
    }
  }
</style>

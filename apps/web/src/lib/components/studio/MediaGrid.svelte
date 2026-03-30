<!--
  @component MediaGrid

  Displays a grid of MediaCard components with an empty state.

  @prop {MediaItemWithRelations[]} items - Array of media items to display
  @prop {(id: string) => void} [onEdit] - Callback when edit is triggered on a media item
  @prop {(id: string) => void} [onDelete] - Callback when delete is triggered on a media item
-->
<script lang="ts">
  import type { MediaItemWithRelations } from '$lib/types';
  import MediaCard from './MediaCard.svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    items: MediaItemWithRelations[];
    onEdit?: (id: string) => void;
    onDelete?: (id: string) => void;
  }

  const { items, onEdit, onDelete }: Props = $props();

  const isEmpty = $derived(items.length === 0);
</script>

{#if isEmpty}
  <div class="empty-state">
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="empty-icon" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
      <line x1="7" y1="2" x2="7" y2="22"></line>
      <line x1="17" y1="2" x2="17" y2="22"></line>
      <line x1="2" y1="12" x2="22" y2="12"></line>
      <line x1="2" y1="7" x2="7" y2="7"></line>
      <line x1="2" y1="17" x2="7" y2="17"></line>
      <line x1="17" y1="7" x2="22" y2="7"></line>
      <line x1="17" y1="17" x2="22" y2="17"></line>
    </svg>
    <h3 class="empty-title">{m.media_empty()}</h3>
    <p class="empty-description">{m.media_empty_description()}</p>
  </div>
{:else}
  <div class="media-grid" role="list">
    {#each items as media (media.id)}
      <div role="listitem">
        <MediaCard {media} {onEdit} {onDelete} />
      </div>
    {/each}
  </div>
{/if}

<style>
  .media-grid {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-12) var(--space-4);
    text-align: center;
  }

  .empty-icon {
    color: var(--color-text-muted);
    margin-bottom: var(--space-2);
  }

  .empty-title {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
  }

  .empty-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
    max-width: 320px;
  }

  /* Dark mode */
  :global([data-theme='dark']) .empty-icon {
    color: var(--color-text-muted-dark);
  }

  :global([data-theme='dark']) .empty-title {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .empty-description {
    color: var(--color-text-secondary-dark);
  }
</style>

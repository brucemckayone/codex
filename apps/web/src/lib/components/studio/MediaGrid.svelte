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
  import { FilmIcon } from '$lib/components/ui/Icon';
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
    <FilmIcon size={48} stroke-width="1" class="empty-icon" />
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

</style>

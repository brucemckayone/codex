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
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
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
  <EmptyState title={m.media_empty()} description={m.media_empty_description()} icon={FilmIcon} />
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


</style>

<!--
  @component MediaGrid

  Thin compatibility wrapper. Historically this was a flat grid of
  MediaCard rows; the editorial redesign moved per-tile rendering into
  `media-library/MediaTile.svelte` and grid wrapping into
  `media-library/MediaTileGrid.svelte`. This file now forwards to the
  new grid so any external importer (tests, older pages) keeps working.

  New callers should import `MediaTileGrid` directly.
-->
<script lang="ts">
  import type { MediaItemWithRelations } from '$lib/types';
  import MediaTileGrid from './media-library/MediaTileGrid.svelte';
  import { FilmIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    items: MediaItemWithRelations[];
    onEdit?: (id: string) => void;
    onDelete?: (id: string) => void;
    /** Base ordinal (for paginated pages) — defaults to 1 */
    startOrdinal?: number;
  }

  const { items, onEdit, onDelete, startOrdinal = 1 }: Props = $props();

  const isEmpty = $derived(items.length === 0);
</script>

{#if isEmpty}
  <EmptyState title={m.media_empty()} description={m.media_empty_description()} icon={FilmIcon} />
{:else}
  <MediaTileGrid {items} {onEdit} {onDelete} {startOrdinal} />
{/if}

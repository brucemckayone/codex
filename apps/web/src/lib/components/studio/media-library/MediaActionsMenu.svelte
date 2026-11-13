<!--
  @component MediaActionsMenu

  A media item's ⋯ menu (Codex-a6ofh.1.6, mockup M1 note 7). Always visible:
  the hover-only edit and delete it replaces could not be reached by touch.
  Its accessible name carries the item's title, so a screen reader moving
  through the grid hears which item's actions these are. The trigger and the
  menu are the studio lists' shared `RowActionsMenu`.
-->
<script lang="ts">
  import * as DropdownMenu from '$lib/components/ui/DropdownMenu';
  import { EditIcon, RefreshCwIcon, TrashIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import RowActionsMenu from '../list-toolbar/RowActionsMenu.svelte';

  interface Props {
    title: string;
    /** A failed item that another attempt can help (the list row's Try again). */
    onRetry?: () => void;
    onEdit?: () => void;
    onDelete?: () => void;
  }

  const { title, onRetry, onEdit, onDelete }: Props = $props();
</script>

{#if onRetry || onEdit || onDelete}
  <RowActionsMenu label={m.media_actions_named({ title })}>
    {#if onRetry}
      <DropdownMenu.Item onclick={onRetry}>
        <RefreshCwIcon size={14} />
        {m.media_tile_try_again()}
      </DropdownMenu.Item>
    {/if}
    {#if onEdit}
      <DropdownMenu.Item onclick={onEdit}>
        <EditIcon size={14} />
        {m.media_action_edit()}
      </DropdownMenu.Item>
    {/if}
    {#if onDelete}
      <DropdownMenu.Item class="row-actions-danger" onclick={onDelete}>
        <TrashIcon size={14} />
        {m.media_action_delete()}
      </DropdownMenu.Item>
    {/if}
  </RowActionsMenu>
{/if}

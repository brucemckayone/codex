<!--
  @component MediaActionsMenu

  A media item's ⋯ menu (Codex-a6ofh.1.6, mockup M1 note 7). Always visible:
  the hover-only edit and delete it replaces could not be reached by touch.
  Its accessible name carries the item's title, so a screen reader moving
  through the grid hears which item's actions these are.
-->
<script lang="ts">
  import * as DropdownMenu from '$lib/components/ui/DropdownMenu';
  import { EditIcon, MoreHorizontalIcon, RefreshCwIcon, TrashIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';

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
  <DropdownMenu.Root positioning={{ placement: 'bottom-end' }}>
    <DropdownMenu.Trigger class="media-actions-trigger" aria-label={m.media_actions_named({ title })}>
      <MoreHorizontalIcon size={16} />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content class="media-actions-menu">
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
        <DropdownMenu.Item class="media-actions-danger" onclick={onDelete}>
          <TrashIcon size={14} />
          {m.media_action_delete()}
        </DropdownMenu.Item>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}

<style>
  /* The trigger is a component's <button>: reached through :global(). */
  :global(.media-actions-trigger) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: var(--space-8);
    height: var(--space-8);
    padding: 0;
    border: var(--border-width) var(--border-style) transparent;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  :global(.media-actions-trigger:hover),
  :global(.media-actions-trigger[data-state='open']) {
    background: var(--color-surface-secondary);
    border-color: var(--color-border);
    color: var(--color-text);
  }

  :global(.media-actions-trigger:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  :global(.media-actions-menu .dropdown-item) {
    gap: var(--space-2);
  }

  :global(.media-actions-menu .media-actions-danger) {
    color: var(--color-status-error-text);
  }
</style>

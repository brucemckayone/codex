<!--
  @component ContentBulkBar

  The content list's selection bar (Codex-a6ofh.3.5, mockup L2): how many
  are selected, and what can be done to them, one request each. Publish
  shows with a draft selected, Unpublish with a live piece. Add to category
  is the org studio's, for a member who can read its categories. At most
  CONTENT_BULK_MAX are held (owner D-b3), and the bar says so at the cap.
  While an action runs its buttons wait, and its live region says what is
  under way ("Publishing 3…").
-->
<script lang="ts">
  import { Button } from '$lib/components/ui';
  import * as DropdownMenu from '$lib/components/ui/DropdownMenu';
  import { TagIcon, TrashIcon, UsersIcon, XIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';

  interface Category {
    id: string;
    name: string;
  }

  interface Props {
    count: number;
    max: number;
    /** What is under way, in words; null while nothing runs. */
    busy: string | null;
    canPublish: boolean;
    canUnpublish: boolean;
    /** Add to category's choices; undefined offers no Add to category. */
    categories?: readonly Category[];
    onPublish: () => void;
    onUnpublish: () => void;
    onAddCategory: (category: Category) => void;
    onChangeAccess: () => void;
    onDelete: () => void;
    onClear: () => void;
  }

  const {
    count,
    max,
    busy,
    canPublish,
    canUnpublish,
    categories,
    onPublish,
    onUnpublish,
    onAddCategory,
    onChangeAccess,
    onDelete,
    onClear,
  }: Props = $props();

  const waiting = $derived(busy !== null);
</script>

<div class="bulk-bar" role="region" aria-label={m.studio_content_bulk_label()}>
  <span class="bulk-count">
    {m.studio_content_bulk_selected({ count })}
    {#if count >= max}
      <span class="bulk-cap">{m.studio_content_bulk_cap({ max })}</span>
    {/if}
  </span>
  <span class="bulk-busy" role="status">{busy ?? ''}</span>
  <div class="bulk-actions">
    {#if canPublish}
      <Button size="sm" variant="secondary" disabled={waiting} onclick={onPublish}>
        {m.studio_content_bulk_publish()}
      </Button>
    {/if}
    {#if canUnpublish}
      <Button size="sm" variant="secondary" disabled={waiting} onclick={onUnpublish}>
        {m.studio_content_bulk_unpublish()}
      </Button>
    {/if}
    {#if categories && categories.length > 0}
      <DropdownMenu.Root positioning={{ placement: 'bottom-end' }}>
        <!-- The items wait, never the trigger: Melt reads `disabled` once. -->
        <DropdownMenu.Trigger class="bulk-menu-trigger">
          <TagIcon size={14} />
          {m.studio_content_bulk_add_category()}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content class="bulk-category-menu">
          {#each categories as category (category.id)}
            <DropdownMenu.Item disabled={waiting} onclick={() => onAddCategory(category)}>
              {category.name}
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
    <Button size="sm" variant="secondary" disabled={waiting} onclick={onChangeAccess}>
      <UsersIcon size={14} />
      {m.studio_content_bulk_change_access()}
    </Button>
    <Button size="sm" variant="secondary" disabled={waiting} onclick={onDelete}>
      <TrashIcon size={14} />
      {m.studio_content_bulk_delete()}
    </Button>
    <Button
      size="sm"
      variant="ghost"
      disabled={waiting}
      aria-label={m.studio_content_bulk_clear()}
      onclick={onClear}
    >
      <XIcon size={14} />
    </Button>
  </div>
</div>

<style>
  .bulk-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-interactive);
    border-radius: var(--radius-md);
    background: var(--color-interactive-subtle);
  }

  .bulk-count {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .bulk-cap,
  .bulk-busy {
    font-size: var(--text-sm);
    font-weight: var(--font-normal);
    color: var(--color-text-secondary);
  }

  .bulk-busy {
    flex: 1;
  }

  .bulk-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  /* The menu's trigger is a component's <button>: reached through :global(). */
  :global(.bulk-menu-trigger) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    height: var(--space-8);
    padding: 0 var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  :global(.bulk-menu-trigger:hover) {
    background: var(--color-surface-secondary);
  }

  :global(.bulk-menu-trigger:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  :global(.bulk-category-menu) {
    max-height: 20rem;
    overflow-y: auto;
  }
</style>

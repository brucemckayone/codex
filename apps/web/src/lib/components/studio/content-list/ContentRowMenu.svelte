<!--
  @component ContentRowMenu

  A piece's ⋯ menu in the content list (Codex-a6ofh.3.5, mockup L2): Edit,
  Preview, Copy link (once it is live), Publish or Unpublish, and Delete….
  Its accessible name carries the title, so a screen reader moving down the
  list hears whose actions these are. Duplicate is not offered (the plan).

  @prop row        The piece
  @prop editHref   Where Edit opens it (the step a draft is on)
  @prop liveHref   Its public address, while it is live; null hides Copy link
  @prop busy       An action on the list is under way: the actions wait
-->
<script lang="ts">
  import { CONTENT_STATUS } from '@codex/constants';
  import * as DropdownMenu from '$lib/components/ui/DropdownMenu';
  import {
    CopyIcon,
    EditIcon,
    EyeIcon,
    EyeOffIcon,
    GlobeIcon,
    MoreHorizontalIcon,
    TrashIcon,
  } from '$lib/components/ui/Icon';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import type { ContentWithRelations } from '$lib/types';
  import * as m from '$paraglide/messages';
  import { previewHref } from '../editor/editor-url';

  interface Props {
    row: Pick<ContentWithRelations, 'id' | 'title' | 'status'>;
    editHref: string;
    liveHref: string | null;
    busy: boolean;
    onPublish: () => void;
    onUnpublish: () => void;
    onDelete: () => void;
  }

  const { row, editHref, liveHref, busy, onPublish, onUnpublish, onDelete }: Props = $props();

  const live = $derived(row.status === CONTENT_STATUS.PUBLISHED);

  async function copyLink() {
    if (!liveHref) return;
    try {
      await navigator.clipboard.writeText(liveHref);
      toast.success(m.studio_content_row_link_copied());
    } catch {
      // Refused by the browser (no permission, an insecure origin): said.
      toast.error(m.studio_content_row_link_failed());
    }
  }
</script>

<DropdownMenu.Root positioning={{ placement: 'bottom-end' }}>
  <DropdownMenu.Trigger
    class="content-row-trigger"
    aria-label={m.studio_content_row_actions({ title: row.title })}
  >
    <MoreHorizontalIcon size={16} />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content class="content-row-menu">
    <DropdownMenu.Item href={editHref}>
      <EditIcon size={14} />
      {m.studio_content_row_edit()}
    </DropdownMenu.Item>
    <DropdownMenu.Item href={previewHref(row.id)}>
      <EyeIcon size={14} />
      {m.studio_content_row_preview()}
    </DropdownMenu.Item>
    {#if live && liveHref}
      <DropdownMenu.Item onclick={copyLink}>
        <CopyIcon size={14} />
        {m.studio_content_row_copy_link()}
      </DropdownMenu.Item>
    {/if}
    <DropdownMenu.Separator />
    {#if live}
      <DropdownMenu.Item disabled={busy} onclick={onUnpublish}>
        <EyeOffIcon size={14} />
        {m.studio_content_row_unpublish()}
      </DropdownMenu.Item>
    {:else}
      <DropdownMenu.Item disabled={busy} onclick={onPublish}>
        <GlobeIcon size={14} />
        {m.studio_content_row_publish()}
      </DropdownMenu.Item>
    {/if}
    <DropdownMenu.Item class="content-row-danger" disabled={busy} onclick={onDelete}>
      <TrashIcon size={14} />
      {m.studio_content_row_delete()}
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>

<style>
  /* The trigger is a component's <button>: reached through :global(). */
  :global(.content-row-trigger) {
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

  :global(.content-row-trigger:hover),
  :global(.content-row-trigger[data-state='open']) {
    background: var(--color-surface-secondary);
    border-color: var(--color-border);
    color: var(--color-text);
  }

  :global(.content-row-trigger:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  :global(.content-row-menu .dropdown-item) {
    gap: var(--space-2);
  }

  :global(.content-row-menu .content-row-danger) {
    color: var(--color-status-error-text);
  }
</style>

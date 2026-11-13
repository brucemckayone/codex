<!--
  @component RowActionsMenu

  A studio list row's ⋯ menu: the trigger, always visible (a hover-only
  action could not be reached by touch), and the menu its items go in. The
  media library's and the content list's (Codex-a6ofh.3.5), so both read
  and behave alike. An item with the class `row-actions-danger` reads as
  destructive.

  @prop label     The trigger's accessible name, carrying the row's title, so
                  a screen reader moving down the list hears whose actions these are
  @prop children  The menu's items
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as DropdownMenu from '$lib/components/ui/DropdownMenu';
  import { MoreHorizontalIcon } from '$lib/components/ui/Icon';

  interface Props {
    label: string;
    children: Snippet;
  }

  const { label, children }: Props = $props();
</script>

<DropdownMenu.Root positioning={{ placement: 'bottom-end' }}>
  <DropdownMenu.Trigger class="row-actions-trigger" aria-label={label}>
    <MoreHorizontalIcon size={16} />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content class="row-actions-menu">
    {@render children()}
  </DropdownMenu.Content>
</DropdownMenu.Root>

<style>
  /* The trigger is a component's <button>: reached through :global(). */
  :global(.row-actions-trigger) {
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

  :global(.row-actions-trigger:hover),
  :global(.row-actions-trigger[data-state='open']) {
    background: var(--color-surface-secondary);
    border-color: var(--color-border);
    color: var(--color-text);
  }

  :global(.row-actions-trigger:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  :global(.row-actions-menu .dropdown-item) {
    gap: var(--space-2);
  }

  :global(.row-actions-menu .row-actions-danger) {
    color: var(--color-status-error-text);
  }
</style>

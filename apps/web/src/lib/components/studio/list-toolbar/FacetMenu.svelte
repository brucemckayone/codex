<!--
  @component FacetMenu

  One of a studio list's facet menus (Codex-a6ofh.3.1; the media library's
  since Codex-a6ofh.1.6): "Status · Any ▾", a DropdownMenu whose items are
  radios. A value other than the facet's default marks the trigger set, so
  a narrowed list shows which menu narrowed it. A facet whose choices could
  not be read says so after the ones it has, with a Try again that keeps
  the menu open (`unread`, Codex-a6ofh.3.3), as the New menu's drafts do.
-->
<script lang="ts" generics="T extends string">
  import { tick } from 'svelte';
  import * as DropdownMenu from '$lib/components/ui/DropdownMenu';
  import { CheckIcon, ChevronDownIcon } from '$lib/components/ui/Icon';
  import { formatCount } from '$lib/utils/format';
  import * as m from '$paraglide/messages';
  import type { FacetUnread, ListOption } from './list-option';

  interface Props {
    label: string;
    value: T;
    options: readonly ListOption<T>[];
    /** The facet's default: anything else marks the trigger set. */
    fallback: T;
    onSelect: (value: T) => void;
    /** Set when the choices could not be read. */
    unread?: FacetUnread;
  }

  const { label, value, options, fallback, onSelect, unread }: Props = $props();

  const current = $derived(options.find((option) => option.value === value));
  const shown = $derived(current?.label() ?? value);

  const menuKey = $props.id();
  let open = $state(false);

  async function retry() {
    if (!unread || !(await unread.retry()) || !open) return;
    // The pressed item went with the failure, leaving focus on the menu
    // itself: it goes to the first choice. One arrowed to meanwhile (the
    // read can take seconds) keeps it.
    await tick();
    if (document.activeElement?.getAttribute('role')?.startsWith('menuitem')) return;
    document
      .querySelector<HTMLElement>(`[data-facet-menu="${menuKey}"] [role^="menuitem"]`)
      ?.focus();
  }
</script>

<DropdownMenu.Root
  positioning={{ placement: 'bottom-start' }}
  onOpenChange={(next) => {
    open = next;
  }}
>
  <DropdownMenu.Trigger
    class="toolbar-menu {value !== fallback ? 'is-set' : ''}"
    aria-label={m.media_filter_menu_named({ label, value: shown })}
  >
    <span class="toolbar-menu-key">{label}</span>
    <span class="toolbar-menu-value">{shown}</span>
    <ChevronDownIcon size={14} />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content class="toolbar-menu-list" data-facet-menu={menuKey}>
    {#each options as option (option.value)}
      <DropdownMenu.Item
        role="menuitemradio"
        aria-checked={option.value === value}
        onclick={() => onSelect(option.value)}
      >
        <span class="toolbar-menu-check" aria-hidden="true">
          {#if option.value === value}<CheckIcon size={14} />{/if}
        </span>
        {option.label()}
        {#if option.count !== undefined}
          <span class="toolbar-menu-count">{formatCount(option.count)}</span>
        {/if}
      </DropdownMenu.Item>
    {/each}
    {#if unread}
      <DropdownMenu.Separator />
      <p class="toolbar-menu-note" role="status">{unread.words}</p>
      <DropdownMenu.Item keepOpen aria-busy={unread.retrying} onclick={retry}>
        <span class="toolbar-menu-check" aria-hidden="true"></span>
        {m.common_try_again()}
      </DropdownMenu.Item>
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>

<style>
  /* The trigger and the list are DropdownMenu's elements: :global(). */
  :global(.toolbar-menu) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    height: var(--space-10);
    padding: 0 var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  :global(.toolbar-menu:hover),
  :global(.toolbar-menu[data-state='open']) {
    background: var(--color-surface-secondary);
  }

  :global(.toolbar-menu.is-set) {
    border-color: var(--color-interactive);
    background: var(--color-interactive-subtle);
  }

  :global(.toolbar-menu:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  :global(.toolbar-menu .toolbar-menu-key) {
    color: var(--color-text-secondary);
  }

  :global(.toolbar-menu .toolbar-menu-value) {
    font-weight: var(--font-semibold);
  }

  :global(.toolbar-menu-list .dropdown-item) {
    gap: var(--space-2);
  }

  :global(.toolbar-menu-list .toolbar-menu-check) {
    display: inline-flex;
    width: var(--space-4);
    color: var(--color-link);
  }

  :global(.toolbar-menu-list .toolbar-menu-note) {
    margin: 0;
    padding: var(--space-2) var(--space-3) var(--space-1);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  /* An option's count sits at the row's end, its digits in columns. */
  :global(.toolbar-menu-list .toolbar-menu-count) {
    margin-inline-start: auto;
    padding-inline-start: var(--space-4);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }
</style>

<!--
  @component FacetMenu

  One of a studio list's facet menus (Codex-a6ofh.3.1; the media library's
  since Codex-a6ofh.1.6): "Status · Any ▾", a DropdownMenu whose items are
  radios. A value other than the facet's default marks the trigger set, so
  a narrowed list shows which menu narrowed it.
-->
<script lang="ts" generics="T extends string">
  import * as DropdownMenu from '$lib/components/ui/DropdownMenu';
  import { CheckIcon, ChevronDownIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import type { ListOption } from './list-option';

  interface Props {
    label: string;
    value: T;
    options: readonly ListOption<T>[];
    /** The facet's default: anything else marks the trigger set. */
    fallback: T;
    onSelect: (value: T) => void;
  }

  const { label, value, options, fallback, onSelect }: Props = $props();

  const current = $derived(options.find((option) => option.value === value));
  const shown = $derived(current?.label() ?? value);
</script>

<DropdownMenu.Root positioning={{ placement: 'bottom-start' }}>
  <DropdownMenu.Trigger
    class="toolbar-menu {value !== fallback ? 'is-set' : ''}"
    aria-label={m.media_filter_menu_named({ label, value: shown })}
  >
    <span class="toolbar-menu-key">{label}</span>
    <span class="toolbar-menu-value">{shown}</span>
    <ChevronDownIcon size={14} />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content class="toolbar-menu-list">
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
      </DropdownMenu.Item>
    {/each}
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
</style>

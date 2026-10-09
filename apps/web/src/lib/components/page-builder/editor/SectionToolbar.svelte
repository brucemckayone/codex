<!--
  @component SectionToolbar

  The selected section's quick actions on the canvas. It sits in a track as
  tall as the section and sticks to the top of the view, so a long section
  keeps its toolbar in reach while it scrolls.
-->
<script module lang="ts">
  export type SectionAction = 'up' | 'down' | 'duplicate' | 'hide' | 'delete';
</script>

<script lang="ts">
  import {
    ChevronDownIcon,
    ChevronUpIcon,
    CopyIcon,
    EyeOffIcon,
    TrashIcon,
  } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';

  interface Props {
    label: string;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onAction: (action: SectionAction) => void;
  }

  const { label, canMoveUp, canMoveDown, onAction }: Props = $props();

  const actions = $derived([
    { id: 'up', Icon: ChevronUpIcon, name: m.studio_builder_section_move_up({ section: label }), disabled: !canMoveUp },
    { id: 'down', Icon: ChevronDownIcon, name: m.studio_builder_section_move_down({ section: label }), disabled: !canMoveDown },
    { id: 'duplicate', Icon: CopyIcon, name: m.studio_builder_canvas_duplicate({ section: label }), disabled: false },
    { id: 'hide', Icon: EyeOffIcon, name: m.studio_builder_section_hide({ section: label }), disabled: false },
    { id: 'delete', Icon: TrashIcon, name: m.studio_builder_canvas_delete({ section: label }), disabled: false },
  ] as const);
</script>

<div
  class="toolbar"
  role="toolbar"
  aria-label={m.studio_builder_canvas_block_actions({ section: label })}
>
  <span class="toolbar__label">{label}</span>
  {#each actions as action (action.id)}
    <button
      type="button"
      class="toolbar__button"
      data-action={action.id}
      aria-label={action.name}
      title={action.name}
      disabled={action.disabled}
      onclick={() => onAction(action.id)}
    >
      <action.Icon size={16} />
    </button>
  {/each}
</div>

<style>
  .toolbar {
    position: sticky;
    top: var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-0-5);
    padding: var(--space-1);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow: var(--shadow-md);
    font-family: var(--font-sans);
    pointer-events: auto;
  }

  .toolbar__label {
    padding-inline: var(--space-2) var(--space-1);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .toolbar__button {
    display: grid;
    place-items: center;
    inline-size: var(--space-8);
    block-size: var(--space-8);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
  }

  .toolbar__button:hover:not(:disabled) {
    background: color-mix(in oklab, var(--color-text) 8%, transparent);
  }

  .toolbar__button[data-action='delete']:hover:not(:disabled) {
    color: var(--color-error);
  }

  .toolbar__button:disabled {
    color: var(--color-text-disabled);
    cursor: default;
  }

  .toolbar__button:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }
</style>

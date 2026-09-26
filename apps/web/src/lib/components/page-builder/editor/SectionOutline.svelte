<!--
  @component SectionOutline

  The page's sections, top to bottom: plain names, their icons, which are
  hidden, and the ways to reorder, hide, duplicate and delete them.

  Keyboard: the rows are one tab stop (roving tabindex). Up/Down/Home/End move
  the selection; Alt+Up/Down moves the selected section. Pointer: drag a row.
-->
<script lang="ts">
  import type { PageSection } from '@codex/shared-types';
  import { tick } from 'svelte';
  import * as DropdownMenu from '$lib/components/ui/DropdownMenu';
  import {
    EyeIcon,
    EyeOffIcon,
    GripVerticalIcon,
    MoreHorizontalIcon,
    PlusIcon,
  } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import { dropGap, gapToIndex, sectionIcon, sectionLabel } from './outline';

  interface Props {
    sections: readonly PageSection[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onToggle: (id: string) => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
    /** Move to an absolute index (the index after removal). */
    onMove: (id: string, toIndex: number) => void;
    onAdd: () => void;
  }

  const {
    sections,
    selectedId,
    onSelect,
    onToggle,
    onDuplicate,
    onDelete,
    onMove,
    onAdd,
  }: Props = $props();

  const mains: Record<string, HTMLButtonElement | undefined> = {};
  const rows: Record<string, HTMLLIElement | undefined> = {};
  let announcement = $state('');

  interface Drag {
    id: string;
    from: number;
    startY: number;
    active: boolean;
    gap: number;
  }
  let drag = $state<Drag | null>(null);

  /** The row that owns the list's single tab stop. */
  const currentId = $derived(
    sections.some((s) => s.id === selectedId) ? selectedId : (sections[0]?.id ?? null)
  );

  async function focusRow(id: string): Promise<void> {
    await tick();
    mains[id]?.focus();
  }

  function move(id: string, from: number, to: number): void {
    if (to < 0 || to >= sections.length || to === from) return;
    const section = sections[from];
    onMove(id, to);
    announcement = m.studio_page_editor_outline_moved({
      section: sectionLabel(section),
      position: String(to + 1),
      total: String(sections.length),
    });
    void focusRow(id);
  }

  function handleKeydown(event: KeyboardEvent, index: number): void {
    const section = sections[index];
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step !== 0 && event.altKey) {
      event.preventDefault();
      move(section.id, index, index + step);
      return;
    }
    let target = -1;
    if (step !== 0) target = index + step;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = sections.length - 1;
    else if (event.key === 'Escape' && drag) {
      drag = null;
      return;
    }
    if (target < 0 || target >= sections.length) return;
    event.preventDefault();
    onSelect(sections[target].id);
    void focusRow(sections[target].id);
  }

  function rowBoxes(): { top: number; height: number }[] {
    return sections.map((s) => {
      const box = rows[s.id]?.getBoundingClientRect();
      return { top: box?.top ?? 0, height: box?.height ?? 0 };
    });
  }

  function handlePointerDown(event: PointerEvent, index: number): void {
    if (event.button !== 0) return;
    drag = {
      id: sections[index].id,
      from: index,
      startY: event.clientY,
      active: false,
      gap: index,
    };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!drag) return;
    if (!drag.active && Math.abs(event.clientY - drag.startY) < 4) return;
    drag.active = true;
    drag.gap = dropGap(event.clientY, rowBoxes());
  }

  function handlePointerUp(): void {
    const ended = drag;
    drag = null;
    if (!ended?.active) return;
    const to = gapToIndex(ended.from, ended.gap);
    if (to !== null) move(ended.id, ended.from, to);
  }

  /** The gap marker, unless the drop would leave the row where it is. */
  function dropMark(index: number): 'before' | 'after' | undefined {
    if (!drag?.active || gapToIndex(drag.from, drag.gap) === null) return undefined;
    if (drag.gap === index) return 'before';
    if (drag.gap === sections.length && index === sections.length - 1) return 'after';
    return undefined;
  }
</script>

<nav class="outline" aria-label={m.studio_page_editor_outline_label()}>
  <h2 class="outline__title">{m.studio_builder_sections()}</h2>
  <p class="outline__hint" id="outline-hint">{m.studio_page_editor_outline_hint()}</p>

  {#if sections.length === 0}
    <p class="outline__empty">{m.studio_builder_sections_empty()}</p>
  {:else}
    <ol class="outline__list" aria-describedby="outline-hint">
      {#each sections as section, index (section.id)}
        {@const label = sectionLabel(section)}
        {@const Icon = sectionIcon(section.type)}
        {@const hidden = section.enabled === false}
        {@const tab = section.id === currentId ? 0 : -1}
        <li
          class="outline__row"
          bind:this={rows[section.id]}
          data-selected={section.id === selectedId ? '' : undefined}
          data-hidden={hidden ? '' : undefined}
          data-dragging={drag?.active && drag.id === section.id ? '' : undefined}
          data-drop={dropMark(index)}
        >
          <button
            type="button"
            class="outline__main"
            bind:this={mains[section.id]}
            tabindex={tab}
            aria-current={section.id === selectedId ? 'true' : undefined}
            onclick={() => onSelect(section.id)}
            onkeydown={(event) => handleKeydown(event, index)}
            onpointerdown={(event) => handlePointerDown(event, index)}
            onpointermove={handlePointerMove}
            onpointerup={handlePointerUp}
            onpointercancel={() => (drag = null)}
          >
            <span class="outline__grip" aria-hidden="true"><GripVerticalIcon size={14} /></span>
            <span class="outline__icon" aria-hidden="true"><Icon size={16} /></span>
            <span class="outline__label">{label}</span>
            {#if hidden}
              <span class="outline__badge">{m.studio_page_editor_outline_hidden()}</span>
            {/if}
          </button>
          <button
            type="button"
            class="outline__tool"
            data-persist={hidden ? '' : undefined}
            tabindex={tab}
            aria-label={hidden
              ? m.studio_builder_section_show({ section: label })
              : m.studio_builder_section_hide({ section: label })}
            title={hidden ? m.studio_builder_section_show_title() : m.studio_builder_section_hide_title()}
            onclick={() => onToggle(section.id)}
          >
            {#if hidden}<EyeIcon size={16} />{:else}<EyeOffIcon size={16} />{/if}
          </button>
          <DropdownMenu.Root positioning={{ placement: 'bottom-end' }}>
            <DropdownMenu.Trigger
              class="outline__tool"
              tabindex={tab}
              aria-label={m.studio_builder_canvas_block_actions({ section: label })}
            >
              <MoreHorizontalIcon size={16} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Item
                disabled={index === 0}
                onclick={() => move(section.id, index, index - 1)}
              >
                {m.studio_builder_move_up()}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                disabled={index === sections.length - 1}
                onclick={() => move(section.id, index, index + 1)}
              >
                {m.studio_builder_move_down()}
              </DropdownMenu.Item>
              <DropdownMenu.Item onclick={() => onDuplicate(section.id)}>
                {m.studio_builder_inspector_duplicate()}
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item onclick={() => onDelete(section.id)}>
                {m.studio_builder_inspector_delete()}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </li>
      {/each}
    </ol>
  {/if}

  <button type="button" class="outline__add" onclick={onAdd}>
    <PlusIcon size={16} />
    {m.studio_builder_add_section()}
  </button>

  <p class="outline__live" aria-live="polite">{announcement}</p>
</nav>

<style>
  .outline {
    display: grid;
    align-content: start;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-3);
  }

  .outline__title {
    margin: 0;
    padding-inline: var(--space-2);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
  }

  .outline__hint,
  .outline__live {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .outline__empty {
    margin: 0;
    padding: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .outline__list {
    display: grid;
    gap: var(--space-0-5);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .outline__row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-0-5);
    padding-inline-end: var(--space-1);
    border-radius: var(--radius-md);
    transition: background-color var(--duration-fast) var(--ease-default);
  }

  .outline__row:hover {
    background: color-mix(in oklab, var(--color-text) 5%, transparent);
  }

  .outline__row[data-selected] {
    background: color-mix(in oklab, var(--color-text) 9%, transparent);
  }

  .outline__row[data-dragging] {
    opacity: var(--opacity-50);
  }

  .outline__row[data-drop]::after {
    content: '';
    position: absolute;
    inset-inline: var(--space-2);
    block-size: var(--border-width-thick);
    background: var(--color-text);
    pointer-events: none;
  }

  .outline__row[data-drop='before']::after {
    inset-block-start: calc(var(--space-0-5) * -1);
  }

  .outline__row[data-drop='after']::after {
    inset-block-end: calc(var(--space-0-5) * -1);
  }

  .outline__main {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-2);
    min-inline-size: 0;
    min-block-size: calc(var(--space-8) + var(--space-1));
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    text-align: start;
    cursor: pointer;
    touch-action: none;
  }

  .outline__row[data-hidden] .outline__main {
    color: var(--color-text-secondary);
  }

  .outline__icon {
    display: grid;
    flex: none;
    color: var(--color-text-secondary);
  }

  .outline__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .outline__row[data-selected] .outline__label {
    font-weight: var(--font-medium);
  }

  .outline__badge {
    flex: none;
    margin-inline-start: auto;
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--color-text) 8%, transparent);
    font-size: var(--text-xs);
  }

  .outline :global(.outline__tool) {
    display: grid;
    place-items: center;
    flex: none;
    inline-size: var(--space-7);
    block-size: var(--space-7);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    opacity: 0;
  }

  .outline__row:hover :global(.outline__tool),
  .outline__row:focus-within :global(.outline__tool),
  .outline__row[data-selected] :global(.outline__tool),
  .outline :global(.outline__tool[data-persist]),
  .outline :global(.outline__tool[data-state='open']) {
    opacity: 1;
  }

  .outline :global(.outline__tool:hover) {
    background: color-mix(in oklab, var(--color-text) 9%, transparent);
    color: var(--color-text);
  }

  .outline__add {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-block-start: var(--space-2);
    padding: var(--space-2);
    border: var(--border-width) dashed var(--color-border-strong);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .outline__add:hover {
    border-style: solid;
    color: var(--color-text);
  }

  /* The drag affordance: the whole row drags, the grip says so on hover. */
  .outline__grip {
    display: grid;
    flex: none;
    margin-inline: calc(var(--space-1) * -1);
    color: var(--color-text-secondary);
    opacity: 0;
    cursor: grab;
    transition: opacity var(--duration-fast) var(--ease-default);
  }

  .outline__row:hover .outline__grip,
  .outline__row[data-dragging] .outline__grip,
  .outline__main:focus-visible .outline__grip {
    opacity: 1;
  }

  .outline__main:focus-visible,
  .outline__add:focus-visible,
  .outline :global(.outline__tool:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: calc(var(--focus-offset) * -1);
    opacity: 1;
  }
</style>

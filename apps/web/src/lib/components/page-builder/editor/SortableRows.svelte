<!--
  @component SortableRows

  The row mechanics a list field and an items field share: each row's grip
  (drag it, or focus it and press ↑ / ↓), its remove button, the drop marker
  and the "Add" button that stops at the field's maximum. What a row CONTAINS
  is the caller's `row` snippet; which value moved is the caller's business —
  this only reports indices, and announces each move.
-->
<script lang="ts">
  import { type Snippet, tick } from 'svelte';
  import { GripVerticalIcon, PlusIcon, TrashIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import { dropGap, gapToIndex } from './outline';

  interface Props {
    count: number;
    max?: number;
    /** A row's plain name for its controls, e.g. "Point 2". */
    labelFor: (index: number) => string;
    addLabel: string;
    onMove: (from: number, to: number) => void;
    onRemove: (index: number) => void;
    onAdd: () => void;
    row: Snippet<[number]>;
  }

  const { count, max, labelFor, addLabel, onMove, onRemove, onAdd, row }: Props = $props();

  const hintId = $props.id();
  const rows: HTMLElement[] = $state([]);
  const grips: HTMLButtonElement[] = $state([]);
  let drag = $state<{ from: number; startY: number; active: boolean; gap: number } | null>(
    null
  );
  let announcement = $state('');

  const full = $derived(max !== undefined && count >= max);

  async function move(from: number, to: number): Promise<void> {
    if (to < 0 || to >= count || to === from) return;
    onMove(from, to);
    announcement = m.studio_page_editor_row_moved({
      item: labelFor(to),
      position: String(to + 1),
      total: String(count),
    });
    await tick();
    grips[to]?.focus();
  }

  function onGripKeydown(event: KeyboardEvent, index: number): void {
    if (event.key === 'Escape' && drag) {
      drag = null;
      return;
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    void move(index, index + step);
  }

  function onPointerDown(event: PointerEvent, index: number): void {
    if (event.button !== 0) return;
    drag = { from: index, startY: event.clientY, active: false, gap: index };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag) return;
    if (!drag.active && Math.abs(event.clientY - drag.startY) < 4) return;
    drag.active = true;
    drag.gap = dropGap(
      event.clientY,
      rows.slice(0, count).map((element) => {
        const box = element?.getBoundingClientRect();
        return { top: box?.top ?? 0, height: box?.height ?? 0 };
      })
    );
  }

  function onPointerUp(): void {
    const ended = drag;
    drag = null;
    if (!ended?.active) return;
    const to = gapToIndex(ended.from, ended.gap);
    if (to !== null) void move(ended.from, to);
  }

  function dropMark(index: number): 'before' | 'after' | undefined {
    if (!drag?.active || gapToIndex(drag.from, drag.gap) === null) return undefined;
    if (drag.gap === index) return 'before';
    if (drag.gap === count && index === count - 1) return 'after';
    return undefined;
  }
</script>

<div class="rows">
  <p class="sr-only" id={hintId}>{m.studio_page_editor_row_hint()}</p>
  {#if count > 0}
    <ol class="rows__list">
      {#each { length: count }, index (index)}
        <li
          class="rows__row"
          data-drop={dropMark(index)}
          data-dragging={drag?.active && drag.from === index ? '' : undefined}
          bind:this={rows[index]}
        >
          <button
            type="button"
            class="rows__grip"
            aria-label={m.studio_page_editor_row_move({ item: labelFor(index) })}
            aria-describedby={hintId}
            bind:this={grips[index]}
            onkeydown={(event) => onGripKeydown(event, index)}
            onpointerdown={(event) => onPointerDown(event, index)}
            onpointermove={onPointerMove}
            onpointerup={onPointerUp}
            onpointercancel={() => (drag = null)}
          >
            <GripVerticalIcon size={16} />
          </button>
          <div class="rows__body">{@render row(index)}</div>
          <button
            type="button"
            class="rows__remove"
            aria-label={m.studio_page_editor_row_remove({ item: labelFor(index) })}
            title={m.studio_page_editor_row_remove({ item: labelFor(index) })}
            onclick={() => onRemove(index)}
          >
            <TrashIcon size={16} />
          </button>
        </li>
      {/each}
    </ol>
  {/if}
  <button type="button" class="rows__add" disabled={full} onclick={onAdd}>
    <PlusIcon size={16} />
    {addLabel}
  </button>
  {#if full && max !== undefined}
    <p class="rows__full">{m.studio_page_editor_rows_full({ max: String(max) })}</p>
  {/if}
  <p class="sr-only" aria-live="polite">{announcement}</p>
</div>

<style>
  .rows {
    display: grid;
    gap: var(--space-2);
  }

  .rows__list {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .rows__row {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--space-1);
  }

  .rows__row[data-dragging] {
    opacity: 0.6;
  }

  .rows__row[data-drop]::after {
    content: '';
    position: absolute;
    inset-inline: 0;
    block-size: var(--border-width-thick);
    background: var(--color-text);
    border-radius: var(--radius-full);
  }

  .rows__row[data-drop='before']::after {
    inset-block-start: calc(var(--space-1) / -2);
    translate: 0 -50%;
  }

  .rows__row[data-drop='after']::after {
    inset-block-end: calc(var(--space-1) / -2);
    translate: 0 50%;
  }

  .rows__body {
    min-inline-size: 0;
  }

  .rows__grip,
  .rows__remove {
    display: grid;
    place-items: center;
    inline-size: var(--space-8);
    block-size: var(--space-10);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
  }

  .rows__grip {
    cursor: grab;
    touch-action: none;
  }

  .rows__row[data-dragging] .rows__grip {
    cursor: grabbing;
  }

  .rows__grip:hover,
  .rows__remove:hover {
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
    color: var(--color-text);
  }

  .rows__add {
    display: inline-flex;
    align-items: center;
    justify-self: start;
    gap: var(--space-1);
    min-block-size: var(--space-8);
    padding: 0 var(--space-3);
    border: var(--border-width) dashed var(--color-border-strong);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .rows__add:hover:not(:disabled) {
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
  }

  .rows__add:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .rows__grip:focus-visible,
  .rows__remove:focus-visible,
  .rows__add:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }

  .rows__full {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
</style>

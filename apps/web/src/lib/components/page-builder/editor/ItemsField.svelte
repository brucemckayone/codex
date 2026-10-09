<!--
  @component ItemsField

  An `items` field — repeated entries of several fields each (benefits,
  testimonials, questions). Each entry is a collapsible row named by its own
  first line of text, holding one control per `itemFields` entry; entries
  are added, removed and reordered in place, and a new one opens ready to
  type into.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { ChevronDownIcon } from '$lib/components/ui/Icon';
  import type { BlockField } from '$lib/page-builder/kit';
  import * as m from '$paraglide/messages';
  import FieldControl from './FieldControl.svelte';
  import { entryTitle, moveItem, readEntries } from './field-values';
  import SortableRows from './SortableRows.svelte';

  interface Props {
    field: BlockField;
    value: unknown;
    onChange: (value: Record<string, unknown>[] | undefined) => void;
    /** Passed through to an entry's `image` field. */
    mediaBaseUrl?: string | null;
  }

  const { field, value, onChange, mediaBaseUrl = null }: Props = $props();

  const id = $props.id();
  const entries = $derived(readEntries(value));
  const itemFields = $derived(field.itemFields ?? []);
  let open = $state<number | null>(null);
  const toggles: HTMLButtonElement[] = $state([]);

  function write(next: Record<string, unknown>[]): void {
    onChange(next.length > 0 ? next : undefined);
  }

  function setKey(index: number, key: string, next: unknown): void {
    // The items as they are NOW, not `entries`: an entry's image upload can
    // finish after this field has left the screen.
    write(
      readEntries(value).map((entry, at) => {
        if (at !== index) return entry;
        const copy = { ...entry };
        if (next === undefined) delete copy[key];
        else copy[key] = next;
        return copy;
      })
    );
  }

  function titleOf(index: number): string {
    const entry = entries[index];
    return (
      (entry && entryTitle(entry, itemFields)) ??
      m.studio_page_editor_row_label({ field: field.label, position: String(index + 1) })
    );
  }

  function move(from: number, to: number): void {
    write(moveItem(entries, from, to));
    if (open === from) open = to;
    else if (open !== null && from < open && to >= open) open -= 1;
    else if (open !== null && from > open && to <= open) open += 1;
  }

  function remove(index: number): void {
    write(entries.filter((_, at) => at !== index));
    if (open === index) open = null;
    else if (open !== null && open > index) open -= 1;
  }

  async function add(): Promise<void> {
    const index = entries.length;
    write([...entries, {}]);
    open = index;
    await tick();
    toggles[index]?.closest('li')?.querySelector<HTMLElement>('input, textarea')?.focus();
  }
</script>

<div class="items" role="group" aria-labelledby="{id}-label">
  <span class="items__label" id="{id}-label">{field.label}</span>
  {#if field.hint}<p class="items__hint">{field.hint}</p>{/if}
  <SortableRows
    count={entries.length}
    max={field.maxItems}
    labelFor={titleOf}
    addLabel={m.studio_page_editor_row_add()}
    onMove={move}
    onRemove={remove}
    onAdd={() => void add()}
  >
    {#snippet row(index)}
      {@const expanded = open === index}
      <div class="item" data-open={expanded ? '' : undefined}>
        <button
          type="button"
          class="item__toggle"
          aria-expanded={expanded}
          aria-controls="{id}-item-{index}"
          bind:this={toggles[index]}
          onclick={() => (open = expanded ? null : index)}
        >
          <span class="item__title">{titleOf(index)}</span>
          <ChevronDownIcon size={16} />
        </button>
        <div class="item__fields" id="{id}-item-{index}" hidden={!expanded}>
          {#if expanded}
            {#each itemFields as itemField (itemField.key)}
              <FieldControl
                field={itemField}
                value={entries[index]?.[itemField.key]}
                onChange={(next) => setKey(index, itemField.key, next)}
                {mediaBaseUrl}
              />
            {/each}
          {/if}
        </div>
      </div>
    {/snippet}
  </SortableRows>
</div>

<style>
  .items {
    display: grid;
    gap: var(--space-1);
  }

  .items__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .items__hint {
    margin: 0 0 var(--space-1);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .item {
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-background);
  }

  .item__toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    inline-size: 100%;
    min-block-size: var(--space-10);
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    text-align: start;
    cursor: pointer;
  }

  .item__toggle:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: calc(var(--border-width-thick) * -1);
  }

  .item__title {
    flex: 1;
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item__toggle :global(svg) {
    flex: none;
    color: var(--color-text-secondary);
    transition: rotate var(--duration-fast) var(--ease-default);
  }

  .item[data-open] .item__toggle :global(svg) {
    rotate: 180deg;
  }

  .item__fields {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-3) var(--space-3);
  }

  .item__fields[hidden] {
    display: none;
  }
</style>

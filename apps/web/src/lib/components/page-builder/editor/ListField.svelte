<!--
  @component ListField

  A `list` field — a short list of lines (points, credentials, what is
  included). One input per line; lines are added, removed and reordered in
  place. An empty line stays while it is being written; the block itself
  skips empty lines, so an unfinished one never reaches the page.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import type { BlockField } from '$lib/page-builder/kit';
  import * as m from '$paraglide/messages';
  import { moveItem } from './field-values';
  import SortableRows from './SortableRows.svelte';

  interface Props {
    field: BlockField;
    value: unknown;
    onChange: (value: string[] | undefined) => void;
  }

  const { field, value, onChange }: Props = $props();

  const id = $props.id();
  const lines = $derived(
    Array.isArray(value) ? value.map((line) => (typeof line === 'string' ? line : '')) : []
  );
  const inputs: HTMLInputElement[] = $state([]);

  function write(next: string[]): void {
    onChange(next.length > 0 ? next : undefined);
  }

  function lineLabel(index: number): string {
    return m.studio_page_editor_row_label({ field: field.label, position: String(index + 1) });
  }

  async function add(): Promise<void> {
    const index = lines.length;
    write([...lines, '']);
    await tick();
    inputs[index]?.focus();
  }
</script>

<div class="list" role="group" aria-labelledby="{id}-label">
  <span class="list__label" id="{id}-label">{field.label}</span>
  {#if field.hint}<p class="list__hint">{field.hint}</p>{/if}
  <SortableRows
    count={lines.length}
    max={field.maxItems}
    labelFor={lineLabel}
    addLabel={m.studio_page_editor_row_add()}
    onMove={(from, to) => write(moveItem(lines, from, to))}
    onRemove={(index) => write(lines.filter((_, at) => at !== index))}
    onAdd={() => void add()}
  >
    {#snippet row(index)}
      <input
        class="list__input"
        type="text"
        aria-label={lineLabel(index)}
        value={lines[index]}
        maxlength={field.maxLength ?? 160}
        bind:this={inputs[index]}
        oninput={(event) => write(lines.map((line, at) => (at === index ? event.currentTarget.value : line)))}
      />
    {/snippet}
  </SortableRows>
</div>

<style>
  .list {
    display: grid;
    gap: var(--space-1);
  }

  .list__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .list__hint {
    margin: 0 0 var(--space-1);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .list__input {
    inline-size: 100%;
    min-block-size: var(--space-10);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-background);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
  }

  .list__input:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--border-width);
  }
</style>

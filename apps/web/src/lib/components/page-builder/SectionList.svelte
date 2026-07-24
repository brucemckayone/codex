<!--
  @component SectionList

  The ordered section list for the journey builder rail (Codex-2pryk.3.3 · WP-5).
  Each row selects a section for editing, toggles it on/off (§4.1), reorders it
  up/down, or removes it. An "Add section" control reveals the catalogue picker.
  Reorder uses accessible up/down buttons (not pointer-only drag) so it works
  with a keyboard and screen reader.

  Drives the module-singleton `pageBuilder` store directly — every mutation
  flows to the live preview via the store's pending draft.
-->
<script lang="ts">
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import { findSectionDefinition } from '$lib/page-builder';
  import {
    ChevronUpIcon,
    ChevronDownIcon,
    EyeIcon,
    EyeOffIcon,
    PlusIcon,
    TrashIcon,
  } from '$lib/components/ui/Icon';
  import AddSectionPicker from './AddSectionPicker.svelte';

  const sections = $derived(pageBuilder.sections);
  let picking = $state(false);

  function labelFor(type: string): string {
    return findSectionDefinition(type)?.label ?? type;
  }

  function glyphFor(type: string): string {
    return findSectionDefinition(type)?.icon ?? '◌';
  }

  function onAdd(type: string): void {
    pageBuilder.addSection(type);
    picking = false;
  }
</script>

<div class="section-list">
  <div class="section-list__head">
    <h2 class="section-list__title">Sections</h2>
    <button
      type="button"
      class="section-list__add"
      aria-expanded={picking}
      onclick={() => (picking = !picking)}
    >
      <PlusIcon size={15} />
      Add
    </button>
  </div>

  {#if picking}
    <div class="section-list__picker">
      <AddSectionPicker onadd={onAdd} onclose={() => (picking = false)} />
    </div>
  {/if}

  {#if sections.length > 0}
    <ol class="section-list__rows" role="list">
      {#each sections as section, i (section.id)}
        {@const selected = pageBuilder.selectedSectionId === section.id}
        <li class="section-list__row" class:section-list__row--selected={selected}>
          <div class="section-list__reorder">
            <button
              type="button"
              class="section-list__icon-btn"
              aria-label="Move {labelFor(section.type)} up"
              disabled={i === 0}
              onclick={() => pageBuilder.moveSection(section.id, -1)}
            >
              <ChevronUpIcon size={14} />
            </button>
            <button
              type="button"
              class="section-list__icon-btn"
              aria-label="Move {labelFor(section.type)} down"
              disabled={i === sections.length - 1}
              onclick={() => pageBuilder.moveSection(section.id, 1)}
            >
              <ChevronDownIcon size={14} />
            </button>
          </div>

          <button
            type="button"
            class="section-list__select"
            class:section-list__select--disabled={!section.enabled}
            aria-pressed={selected}
            onclick={() => pageBuilder.selectSection(section.id)}
          >
            <span class="section-list__glyph" aria-hidden="true">{glyphFor(section.type)}</span>
            <span class="section-list__label">{labelFor(section.type)}</span>
          </button>

          <div class="section-list__actions">
            <button
              type="button"
              class="section-list__icon-btn"
              aria-pressed={section.enabled}
              aria-label={section.enabled
                ? `Hide ${labelFor(section.type)}`
                : `Show ${labelFor(section.type)}`}
              title={section.enabled ? 'Hide section' : 'Show section'}
              onclick={() => pageBuilder.toggleSection(section.id)}
            >
              {#if section.enabled}
                <EyeIcon size={15} />
              {:else}
                <EyeOffIcon size={15} />
              {/if}
            </button>
            <button
              type="button"
              class="section-list__icon-btn section-list__icon-btn--danger"
              aria-label="Remove {labelFor(section.type)}"
              title="Remove section"
              onclick={() => pageBuilder.removeSection(section.id)}
            >
              <TrashIcon size={15} />
            </button>
          </div>
        </li>
      {/each}
    </ol>
  {:else}
    <p class="section-list__empty">No sections yet. Add one to begin building the page.</p>
  {/if}
</div>

<style>
  .section-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-3) 0;
  }

  .section-list__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .section-list__title {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .section-list__add {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .section-list__add:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .section-list__add:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .section-list__picker {
    padding-bottom: var(--space-1);
  }

  .section-list__rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .section-list__row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1);
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
  }

  .section-list__row:hover {
    background-color: var(--color-surface-secondary);
  }

  .section-list__row--selected {
    background-color: var(--color-surface-secondary);
    box-shadow: inset var(--space-0-5) 0 0 0 var(--color-interactive);
  }

  .section-list__reorder {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .section-list__select {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius-md);
    background: none;
    text-align: left;
    cursor: pointer;
    color: var(--color-text);
  }

  .section-list__select:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .section-list__select--disabled {
    color: var(--color-text-muted);
  }

  .section-list__glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    flex-shrink: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .section-list__label {
    flex: 1;
    min-width: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .section-list__actions {
    display: flex;
    align-items: center;
    gap: var(--space-0-5);
    flex-shrink: 0;
  }

  .section-list__icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .section-list__icon-btn:hover:not(:disabled) {
    color: var(--color-text);
    background-color: color-mix(in oklch, var(--color-interactive) 12%, transparent);
  }

  .section-list__icon-btn--danger:hover:not(:disabled) {
    color: var(--color-danger, var(--color-text));
    background-color: color-mix(in oklch, var(--color-danger, red) 12%, transparent);
  }

  .section-list__icon-btn:disabled {
    opacity: var(--opacity-40);
    cursor: not-allowed;
  }

  .section-list__icon-btn:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .section-list__empty {
    margin: 0;
    padding: var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    line-height: var(--leading-normal);
  }
</style>

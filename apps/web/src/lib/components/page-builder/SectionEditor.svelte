<!--
  @component SectionEditor

  The config editor for the rail's currently-selected section (Codex-2pryk.3.3 ·
  WP-5). The analog of a brand-editor `levels/*` panel: it renders the copy
  fields declared for the section's type (`section-fields.ts`) and writes each
  edit straight into the page-builder store's pending draft, so every keystroke
  streams to the live preview over the postMessage bridge.

  Reads/writes the module-singleton `pageBuilder` store — no props needed beyond
  the section. A per-section "Reset" reverts just this section to its saved value.
-->
<script lang="ts">
  import type { PageSection } from '@codex/shared-types';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import { findSectionDefinition } from '$lib/page-builder';
  import { fieldsForSectionType } from './section-fields';

  interface Props {
    section: PageSection;
  }

  const { section }: Props = $props();

  const definition = $derived(findSectionDefinition(section.type));
  const fields = $derived(fieldsForSectionType(section.type));

  /** Read a prop as a string for an input `value` (non-strings coerce to ''). */
  function valueOf(key: string): string {
    const v = section.props[key];
    return typeof v === 'string' ? v : '';
  }

  function onInput(key: string, event: Event): void {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    pageBuilder.setSectionProp(section.id, key, target.value);
  }

  // A section is resettable only when it exists in the saved baseline (a newly
  // added section has no saved value to revert to).
  const canReset = $derived(
    !!pageBuilder.saved?.sections.some((s) => s.id === section.id)
  );
</script>

<div class="section-editor">
  <header class="section-editor__head">
    <div class="section-editor__title">
      <span class="section-editor__glyph" aria-hidden="true">{definition?.icon ?? '◌'}</span>
      <div>
        <p class="section-editor__label">{definition?.label ?? section.type}</p>
        {#if definition?.summary}
          <p class="section-editor__summary">{definition.summary}</p>
        {/if}
      </div>
    </div>
    {#if canReset}
      <button
        type="button"
        class="section-editor__reset"
        onclick={() => pageBuilder.resetSection(section.id)}
        title="Reset this section to its saved values"
      >
        Reset
      </button>
    {/if}
  </header>

  <div class="section-editor__fields">
    {#each fields as field (field.key)}
      <label class="section-editor__field">
        <span class="section-editor__field-label">{field.label}</span>
        {#if field.control === 'textarea'}
          <textarea
            class="section-editor__input section-editor__input--area"
            rows="3"
            placeholder={field.placeholder}
            value={valueOf(field.key)}
            oninput={(e) => onInput(field.key, e)}
          ></textarea>
        {:else}
          <input
            type="text"
            class="section-editor__input"
            placeholder={field.placeholder}
            value={valueOf(field.key)}
            oninput={(e) => onInput(field.key, e)}
          />
        {/if}
      </label>
    {/each}
  </div>
</div>

<style>
  .section-editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .section-editor__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .section-editor__title {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    min-width: 0;
  }

  .section-editor__glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-7);
    height: var(--space-7);
    flex-shrink: 0;
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .section-editor__label {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .section-editor__summary {
    margin: var(--space-0-5) 0 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-snug);
  }

  .section-editor__reset {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .section-editor__reset:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .section-editor__reset:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .section-editor__fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .section-editor__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .section-editor__field-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .section-editor__input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    transition: var(--transition-colors);
  }

  .section-editor__input--area {
    resize: vertical;
    line-height: var(--leading-normal);
  }

  .section-editor__input::placeholder {
    color: var(--color-text-muted);
  }

  .section-editor__input:focus-visible {
    outline: none;
    border-color: var(--color-interactive);
    box-shadow: var(--shadow-focus-ring);
  }
</style>

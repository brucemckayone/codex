<!--
  @component SectionEditor

  The inspector for the rail's currently-selected section (Codex-2pryk.3.3 · WP-5).
  A faithful port of the prototype inspector: a visual VARIANT picker (§4.1
  "options per component") atop the schema-driven copy fields
  (`section-fields.ts`), then per-section actions (duplicate / hide / delete /
  reset). Every edit writes straight into the `pageBuilder` store's pending draft,
  so it streams to the live canvas immediately (two-way with in-canvas typing).
-->
<script lang="ts">
  import type { PageSection } from '@codex/shared-types';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import { findSectionDefinition, resolveVariant, variantsForType } from '$lib/page-builder';
  import { fieldsForSectionType } from './section-fields';
  import VariantPicker from './VariantPicker.svelte';

  interface Props {
    section: PageSection;
  }

  const { section }: Props = $props();

  const definition = $derived(findSectionDefinition(section.type));
  const fields = $derived(fieldsForSectionType(section.type));
  const variants = $derived(variantsForType(section.type));
  const currentVariant = $derived(resolveVariant(section));

  /** Read a prop as a string for a control `value` (non-strings coerce to ''). */
  function valueOf(key: string): string {
    const v = section.props[key];
    return typeof v === 'string' ? v : '';
  }

  function onInput(key: string, event: Event): void {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    pageBuilder.setSectionProp(section.id, key, target.value);
  }

  // Resettable only when it exists in the saved baseline (a new section has none).
  const canReset = $derived(
    !!pageBuilder.saved?.sections.some((s) => s.id === section.id)
  );
</script>

<div class="section-editor">
  <header class="section-editor__head">
    <div class="section-editor__title">
      <span class="section-editor__glyph" aria-hidden="true">{definition?.icon ?? '◌'}</span>
      <div>
        <p class="section-editor__label">{section.name ?? definition?.label ?? section.type}</p>
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

  {#if variants.length >= 2}
    <div class="section-editor__group">
      <p class="section-editor__group-label">Layout · options</p>
      <VariantPicker
        {variants}
        selected={currentVariant}
        onselect={(id) => pageBuilder.setSectionVariant(section.id, id)}
      />
    </div>
  {/if}

  <div class="section-editor__fields">
    {#if variants.length >= 2}
      <p class="section-editor__group-label">Content</p>
    {/if}
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
        {:else if field.control === 'select'}
          <select
            class="section-editor__input"
            value={valueOf(field.key)}
            onchange={(e) => onInput(field.key, e)}
          >
            {#each field.options ?? [] as opt (opt.value)}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        {:else if field.control === 'media'}
          <span class="section-editor__media">
            <span class="section-editor__media-thumb" aria-hidden="true">▶</span>
            <input
              type="text"
              class="section-editor__input section-editor__input--media"
              placeholder="On-frame label"
              value={valueOf(field.key)}
              oninput={(e) => onInput(field.key, e)}
            />
          </span>
        {:else}
          <input
            type="text"
            class="section-editor__input"
            placeholder={field.placeholder}
            value={valueOf(field.key)}
            oninput={(e) => onInput(field.key, e)}
          />
        {/if}
        {#if field.hint}
          <span class="section-editor__hint">{field.hint}</span>
        {/if}
      </label>
    {/each}
  </div>

  <footer class="section-editor__foot">
    <button type="button" class="section-editor__foot-btn" onclick={() => pageBuilder.duplicateSection(section.id)}>
      Duplicate
    </button>
    <button type="button" class="section-editor__foot-btn" onclick={() => pageBuilder.toggleSection(section.id)}>
      {section.enabled ? 'Hide' : 'Show'}
    </button>
    <button
      type="button"
      class="section-editor__foot-btn section-editor__foot-btn--danger"
      onclick={() => pageBuilder.removeSection(section.id)}
    >
      Delete
    </button>
  </footer>
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

  .section-editor__reset:focus-visible,
  .section-editor__foot-btn:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .section-editor__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .section-editor__group-label {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-text-muted);
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

  .section-editor__media {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .section-editor__media-thumb {
    display: grid;
    place-items: center;
    width: var(--space-11, 2.75rem);
    height: var(--space-8);
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--color-interactive) 30%, var(--color-surface-secondary));
    color: var(--color-text-on-brand, var(--color-background));
    font-size: var(--text-xs);
  }

  .section-editor__input--media {
    flex: 1;
  }

  .section-editor__hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-snug);
  }

  .section-editor__foot {
    display: flex;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: var(--border-width) var(--border-style) var(--color-border-subtle);
  }

  .section-editor__foot-btn {
    flex: 1;
    padding: var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .section-editor__foot-btn:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .section-editor__foot-btn--danger:hover {
    color: var(--color-error-600, var(--color-error));
    border-color: color-mix(in oklab, var(--color-error, red) 40%, transparent);
  }
</style>

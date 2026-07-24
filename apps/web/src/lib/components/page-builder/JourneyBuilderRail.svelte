<!--
  @component JourneyBuilderRail

  The control rail for the journey sales-page builder (Codex-2pryk.3.3 · WP-5) —
  the page-builder analog of `BrandStudioRail`. Composes:
    · page-meta head  — title + lifecycle status (writes `pending` meta)
    · SectionList     — ordered add / toggle / reorder / remove
    · SectionEditor   — copy fields for the selected section
    · a save/discard footer (mirrors the brand rail's dirty-gated actions)

  All edits flow through the module-singleton `pageBuilder` store, so they stream
  to the live preview. `saving` + `onsave` are owned by the route (it runs the
  persist command + `markSaved`); `discard` is handled here via the store.
-->
<script lang="ts">
  import type { PageStatus } from '@codex/shared-types';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import SectionList from './SectionList.svelte';
  import SectionEditor from './SectionEditor.svelte';

  interface Props {
    /** Persist in flight — disables the Save button + shows a saving label. */
    saving?: boolean;
    /** Persist the pending draft (route maps → command() + markSaved). */
    onsave: () => void;
  }

  const { saving = false, onsave }: Props = $props();

  const pending = $derived(pageBuilder.pending);
  const selected = $derived(pageBuilder.selectedSection);
  const isDirty = $derived(pageBuilder.isDirty);

  const STATUSES: readonly { id: PageStatus; label: string }[] = [
    { id: 'draft', label: 'Draft' },
    { id: 'published', label: 'Published' },
    { id: 'archived', label: 'Archived' },
  ];

  function onTitleInput(event: Event): void {
    pageBuilder.updateMeta('title', (event.target as HTMLInputElement).value);
  }

  function onStatusChange(event: Event): void {
    pageBuilder.updateMeta('status', (event.target as HTMLSelectElement).value as PageStatus);
  }
</script>

<div class="rail">
  {#if pending}
    <header class="rail__meta">
      <label class="rail__field">
        <span class="rail__field-label">Page title</span>
        <input
          type="text"
          class="rail__title-input"
          value={pending.title}
          oninput={onTitleInput}
          placeholder="Untitled page"
        />
      </label>
      <label class="rail__field rail__field--status">
        <span class="rail__field-label">Status</span>
        <select class="rail__status" value={pending.status} onchange={onStatusChange}>
          {#each STATUSES as s (s.id)}
            <option value={s.id}>{s.label}</option>
          {/each}
        </select>
      </label>
    </header>

    <div class="rail__body">
      <SectionList />
      {#if selected}
        <div class="rail__editor">
          <SectionEditor section={selected} />
        </div>
      {/if}
    </div>

    <footer class="rail__footer">
      <button
        type="button"
        class="rail__btn rail__btn--ghost"
        disabled={!isDirty || saving}
        onclick={() => pageBuilder.discard()}
      >
        Discard
      </button>
      <button
        type="button"
        class="rail__btn rail__btn--primary"
        disabled={!isDirty || saving}
        onclick={onsave}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </footer>
  {/if}
</div>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .rail__meta {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-3);
    border-bottom: var(--border-width) var(--border-style) var(--color-border-subtle);
  }

  .rail__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .rail__field--status {
    max-width: var(--space-40, 12rem);
  }

  .rail__field-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .rail__title-input,
  .rail__status {
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

  .rail__title-input:focus-visible,
  .rail__status:focus-visible {
    outline: none;
    border-color: var(--color-interactive);
    box-shadow: var(--shadow-focus-ring);
  }

  /* Scrolling middle — the list + selected editor scroll while head + footer pin. */
  .rail__body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: var(--space-4);
  }

  .rail__editor {
    border-top: var(--border-width) var(--border-style) var(--color-border-subtle);
    margin-top: var(--space-2);
  }

  .rail__footer {
    display: flex;
    gap: var(--space-2);
    flex-shrink: 0;
    padding: var(--space-3);
    border-top: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-surface);
  }

  .rail__btn {
    flex: 1;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .rail__btn:disabled {
    opacity: var(--opacity-40);
    cursor: not-allowed;
  }

  .rail__btn:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .rail__btn--ghost {
    border: var(--border-width) var(--border-style) var(--color-border);
    background: none;
    color: var(--color-text-secondary);
  }

  .rail__btn--ghost:hover:not(:disabled) {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .rail__btn--primary {
    border: var(--border-width) var(--border-style) transparent;
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand, var(--color-background));
  }

  .rail__btn--primary:hover:not(:disabled) {
    background-color: var(--color-interactive-hover);
  }
</style>

<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import {
    ChevronLeftIcon,
    MinusIcon,
    MoonIcon,
    SunIcon,
    XIcon,
  } from '$lib/components/ui/Icon';

  interface Props {
    onclose?: () => void;
  }

  const { onclose }: Props = $props();

  function handleBack() {
    brandEditor.navigateBack();
  }

  function toggleEditingTheme() {
    const next = brandEditor.editingTheme === 'light' ? 'dark' : 'light';
    brandEditor.setEditingTheme(next);
  }
</script>

<div class="editor-header">
  <div class="editor-header__breadcrumb">
    {#if brandEditor.currentLevel.parent}
      <button
        type="button"
        class="editor-header__back"
        onclick={handleBack}
        aria-label="Go back"
      >
        <ChevronLeftIcon size={16} />
      </button>
    {/if}
    <span class="editor-header__title">{brandEditor.currentLevel.label}</span>
  </div>

  <div class="editor-header__actions">
    <button
      type="button"
      class="editor-header__theme-toggle"
      onclick={toggleEditingTheme}
      aria-label="Switch editing theme"
      title="Edit {brandEditor.editingTheme === 'light' ? 'dark' : 'light'} theme"
    >
      <span class="editor-header__theme-icon" aria-hidden="true">
        {#if brandEditor.editingTheme === 'light'}
          <SunIcon size={14} />
        {:else}
          <MoonIcon size={14} />
        {/if}
      </span>
      <span class="editor-header__theme-label">
        {brandEditor.editingTheme === 'light' ? 'Light' : 'Dark'}
      </span>
    </button>
    <button
      type="button"
      class="editor-header__btn"
      onclick={() => brandEditor.minimize()}
      aria-label="Minimize editor"
    >
      <MinusIcon size={16} />
    </button>
    <button
      type="button"
      class="editor-header__btn"
      onclick={() => onclose?.()}
      aria-label="Close editor"
    >
      <XIcon size={16} />
    </button>
  </div>
</div>

<style>
  .editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .editor-header__breadcrumb {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .editor-header__back {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    flex-shrink: 0;
    transition: var(--transition-colors);
  }

  .editor-header__back:hover {
    background: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .editor-header__back:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .editor-header__title {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .editor-header__actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
  }

  .editor-header__btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-7);
    height: var(--space-7);
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    transition: var(--transition-colors);
  }

  .editor-header__btn:hover {
    background: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .editor-header__btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .editor-header__theme-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-full);
    background: var(--color-surface-secondary);
    color: var(--color-text-secondary);
    cursor: pointer;
    font-size: var(--text-xs);
    transition: var(--transition-colors);
    flex-shrink: 0;
  }

  .editor-header__theme-toggle:hover {
    border-color: var(--color-interactive);
    color: var(--color-interactive);
  }

  .editor-header__theme-toggle:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .editor-header__theme-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .editor-header__theme-label {
    font-weight: var(--font-medium);
  }
</style>

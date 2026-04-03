<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';

  interface Props {
    onclose?: () => void;
  }

  const { onclose }: Props = $props();

  function handleBack() {
    brandEditor.navigateBack();
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') ?? 'light';
    brandEditor.setThemePreview(current === 'light' ? 'dark' : 'light');
  }
</script>

<div class="editor-header">
  <div class="editor-header__breadcrumb">
    {#if brandEditor.currentLevel.parent}
      <button class="editor-header__back" onclick={handleBack} aria-label="Go back">
        ◀
      </button>
    {/if}
    <span class="editor-header__title">{brandEditor.currentLevel.label}</span>
  </div>

  <div class="editor-header__actions">
    <button
      class="editor-header__btn"
      onclick={toggleTheme}
      aria-label="Toggle theme preview"
      title="Preview in other theme"
    >◑</button>
    <button
      class="editor-header__btn"
      onclick={() => brandEditor.minimize()}
      aria-label="Minimize editor"
    >─</button>
    <button
      class="editor-header__btn"
      onclick={() => onclose?.()}
      aria-label="Close editor"
    >✕</button>
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
    width: 24px;
    height: 24px;
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
    width: 28px;
    height: 28px;
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
    outline-offset: 2px;
  }
</style>

<!--
  @component TagsInput

  Tokenized tag input with pill badges.
  Enter or comma to add, X to remove. Max 20 tags, 50 chars each.

  @prop {string[]} tags - Current tags array (bindable)
  @prop {(tags: string[]) => void} onchange - Callback when tags change
-->
<script lang="ts">
  interface Props {
    tags: string[];
    onchange: (tags: string[]) => void;
  }

  const { tags, onchange }: Props = $props();

  let inputValue = $state('');
  let inputRef = $state<HTMLInputElement | null>(null);

  const MAX_TAGS = 20;
  const MAX_TAG_LENGTH = 50;

  function addTag(value: string) {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return;
    if (trimmed.length > MAX_TAG_LENGTH) return;
    if (tags.length >= MAX_TAGS) return;
    if (tags.includes(trimmed)) return;

    onchange([...tags, trimmed]);
    inputValue = '';
  }

  function removeTag(index: number) {
    onchange(tags.filter((_, i) => i !== index));
    inputRef?.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  }
</script>

<div class="tags-input-wrapper">
  <div class="label-row">
    <span class="field-label">Tags</span>
    <span
      class="tag-count"
      data-warning={tags.length >= 18 || undefined}
      data-error={tags.length >= MAX_TAGS || undefined}
    >
      {tags.length}/{MAX_TAGS}
    </span>
  </div>

  <div class="tags-container" onclick={() => inputRef?.focus()}>
    {#each tags as tag, i}
      <span class="tag-pill">
        {tag}
        <button
          type="button"
          class="tag-remove"
          onclick={() => removeTag(i)}
          aria-label="Remove tag {tag}"
        >
          &times;
        </button>
      </span>
    {/each}
    {#if tags.length < MAX_TAGS}
      <input
        bind:this={inputRef}
        bind:value={inputValue}
        type="text"
        class="tag-input"
        placeholder={tags.length === 0 ? 'Add tags...' : ''}
        maxlength={MAX_TAG_LENGTH}
        onkeydown={handleKeydown}
        onblur={() => { if (inputValue.trim()) addTag(inputValue); }}
      />
    {/if}
  </div>
  <span class="field-hint">Press Enter or comma to add. Max {MAX_TAG_LENGTH} chars each.</span>
</div>

<style>
  .tags-input-wrapper {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .label-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .field-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .tag-count {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .tag-count[data-warning] {
    color: var(--color-warning-600);
  }

  .tag-count[data-error] {
    color: var(--color-error-600);
  }

  .tags-container {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    padding: var(--space-2);
    min-height: calc(var(--space-4) + var(--space-6));
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-background);
    cursor: text;
    transition: var(--transition-colors);
  }

  .tags-container:focus-within {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: -1px;
    border-color: var(--color-border-focus);
  }

  .tag-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    background-color: var(--color-interactive-subtle);
    color: var(--color-interactive-active);
    border-radius: var(--radius-full, 9999px);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    white-space: nowrap;
  }

  .tag-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-4);
    height: var(--space-4);
    padding: 0;
    border: none;
    background: none;
    color: var(--color-interactive);
    cursor: pointer;
    border-radius: var(--radius-full, 9999px);
    font-size: var(--text-sm);
    line-height: 1;
    transition: var(--transition-colors);
  }

  .tag-remove:hover {
    background-color: var(--color-focus-ring);
    color: var(--color-interactive-active);
  }

  .tag-input {
    flex: 1;
    min-width: 80px;
    border: none;
    outline: none;
    background: transparent;
    font-size: var(--text-sm);
    color: var(--color-text);
    font-family: inherit;
    padding: var(--space-1) 0;
  }

  .tag-input::placeholder {
    color: var(--color-text-muted);
  }

  .field-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  :global([data-theme='dark']) .tags-container {
    background-color: var(--color-background-dark);
    border-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .tag-pill {
    background-color: color-mix(in srgb, var(--color-interactive) 20%, var(--color-surface-dark));
    color: var(--color-brand-primary-subtle);
  }

  :global([data-theme='dark']) .tag-remove:hover {
    background-color: color-mix(in srgb, var(--color-interactive) 30%, var(--color-surface-dark));
  }

  :global([data-theme='dark']) .tag-input {
    color: var(--color-text-dark);
  }
</style>

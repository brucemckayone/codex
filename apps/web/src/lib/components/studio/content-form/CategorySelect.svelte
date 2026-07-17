<!--
  @component CategorySelect

  Presentational multiselect for content categories (topics). Pure props +
  callbacks, no remote imports, so it renders/tests in isolation (mirrors
  CategoryList). The parent (OrganizeSection) owns the remote fetch of options
  and the create-on-the-fly mutation; this component only renders the picker,
  emits toggle/create intents, and serializes the selection into the hidden
  `categoryIds` input the content form submits.

  @prop options   Available categories in the org space ({ id, name }).
  @prop selected  Currently-selected category ids (controlled by the parent).
  @prop onToggle  Called with a category id when a chip is clicked.
  @prop onCreate  Called with a trimmed name when the create affordance fires.
  @prop creating  True while a create-on-the-fly request is in flight.
  @prop disabled  Disables all interaction.
-->
<script lang="ts">
  export interface CategoryOption {
    id: string;
    name: string;
  }

  interface Props {
    options: CategoryOption[];
    selected: string[];
    onToggle: (id: string) => void;
    onCreate: (name: string) => void;
    creating?: boolean;
    disabled?: boolean;
  }

  const {
    options,
    selected,
    onToggle,
    onCreate,
    creating = false,
    disabled = false,
  }: Props = $props();

  const MAX_NAME = 100;

  let newName = $state('');

  const selectedSet = $derived(new Set(selected));

  function submitCreate() {
    const trimmed = newName.trim();
    if (!trimmed || creating || disabled) return;
    onCreate(trimmed);
    newName = '';
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      // Prevent the parent <form> from submitting when the creator presses
      // Enter to add a topic.
      event.preventDefault();
      submitCreate();
    }
  }
</script>

<div class="category-select">
  <span class="field-label" id="category-select-label">
    Categories <span class="optional-hint">Optional</span>
  </span>

  <!-- The form field: a JSON array of the selected ids, kept in sync with the
       controlled `selected` prop. -->
  <input type="hidden" name="categoryIds" value={JSON.stringify(selected)} />

  {#if options.length > 0}
    <div class="option-grid" role="group" aria-labelledby="category-select-label">
      {#each options as option (option.id)}
        {@const isSelected = selectedSet.has(option.id)}
        <button
          type="button"
          class="option-chip"
          data-category-id={option.id}
          data-selected={isSelected || undefined}
          aria-pressed={isSelected}
          {disabled}
          onclick={() => onToggle(option.id)}
        >
          {option.name}
        </button>
      {/each}
    </div>
  {:else}
    <p class="empty-hint">No topics yet. Create your first one below.</p>
  {/if}

  <div class="create-row">
    <input
      class="create-input"
      type="text"
      aria-label="New topic name"
      bind:value={newName}
      placeholder="Create a new topic…"
      maxlength={MAX_NAME}
      disabled={disabled || creating}
      onkeydown={handleKeydown}
    />
    <button
      type="button"
      class="create-button"
      onclick={submitCreate}
      disabled={disabled || creating || !newName.trim()}
    >
      {creating ? 'Adding…' : 'Add'}
    </button>
  </div>

  <span class="field-hint">
    Group this content under one or more topics shown on your landing page.
  </span>
</div>

<style>
  .category-select {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .field-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .optional-hint {
    font-size: var(--text-xs);
    font-weight: var(--font-normal);
    color: var(--color-text-muted);
    margin-left: var(--space-1);
  }

  .option-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .option-chip {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full, 9999px);
    background-color: transparent;
    color: var(--color-text);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    font-family: inherit;
    cursor: pointer;
    transition: var(--transition-colors);
    white-space: nowrap;
  }

  .option-chip:hover:not(:disabled) {
    border-color: var(--color-border-focus);
    background-color: var(--color-interactive-subtle);
  }

  .option-chip:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset-inset);
  }

  .option-chip[data-selected] {
    border-color: var(--color-interactive);
    background-color: var(--color-interactive-subtle);
    color: var(--color-interactive-active);
  }

  .option-chip:disabled {
    opacity: var(--opacity-disabled, 0.5);
    cursor: not-allowed;
  }

  .empty-hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .create-row {
    display: flex;
    gap: var(--space-2);
    align-items: stretch;
  }

  .create-input {
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    font-family: inherit;
    color: var(--color-text);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-background);
    transition: var(--transition-colors);
  }

  .create-input:focus {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset-inset);
    border-color: var(--color-border-focus);
  }

  .create-input::placeholder {
    color: var(--color-text-muted);
  }

  .create-button {
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    font-family: inherit;
    color: var(--color-interactive-active);
    background-color: var(--color-interactive-subtle);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
    white-space: nowrap;
  }

  .create-button:hover:not(:disabled) {
    border-color: var(--color-border-focus);
  }

  .create-button:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset-inset);
  }

  .create-button:disabled {
    opacity: var(--opacity-disabled, 0.5);
    cursor: not-allowed;
  }

  .field-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-relaxed);
  }

  :global([data-theme='dark']) .option-chip[data-selected] {
    background-color: color-mix(
      in srgb,
      var(--color-interactive) 20%,
      var(--color-surface)
    );
    color: var(--color-brand-primary-subtle);
  }
</style>

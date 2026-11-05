<!--
  @component TagsInput

  Tokenized tag input with pill badges.
  Enter or comma to add, X to remove. Max 20 tags, 50 chars each.

  @prop {string[]} tags - Current tags array (bindable)
  @prop {(tags: string[]) => void} onchange - Callback when tags change
-->
<script lang="ts">
  import * as m from '$paraglide/messages';

  interface Props {
    tags: string[];
    onchange: (tags: string[]) => void;
  }

  const { tags, onchange }: Props = $props();

  let inputValue = $state('');
  let inputRef = $state<HTMLInputElement | null>(null);
  let announcement = $state('');

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
    announcement = `${trimmed} added`;
  }

  function removeTag(index: number) {
    const removed = tags[index];
    onchange(tags.filter((_, i) => i !== index));
    inputRef?.focus();
    announcement = `${removed} removed`;
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
    <label for="tags-input" class="field-label">{m.content_form_tags()} <span class="optional-hint">{m.content_form_optional()}</span></label>
    <span
      class="tag-count"
      data-warning={tags.length >= 18 || undefined}
      data-error={tags.length >= MAX_TAGS || undefined}
    >
      {tags.length}/{MAX_TAGS}
    </span>
  </div>

  <div class="tags-container" role="list" aria-label={m.content_form_tags()}>
    {#each tags as tag, i}
      <span class="tag-pill" role="listitem">
        {tag}
        <button
          type="button"
          class="tag-remove"
          onclick={() => removeTag(i)}
          aria-label={m.content_form_tags_remove({ tag })}
        >
          &times;
        </button>
      </span>
    {/each}
    {#if tags.length < MAX_TAGS}
      <input
        id="tags-input"
        bind:this={inputRef}
        bind:value={inputValue}
        type="text"
        class="tag-input"
        placeholder={tags.length === 0 ? m.content_form_tags_placeholder() : ''}
        maxlength={MAX_TAG_LENGTH}
        onkeydown={handleKeydown}
        onblur={() => { if (inputValue.trim()) addTag(inputValue); }}
      />
    {/if}
  </div>
  <span class="field-hint">{m.content_form_tags_hint({ max: MAX_TAG_LENGTH })}</span>
  <span class="sr-only" aria-live="polite">{announcement}</span>
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

  .optional-hint {
    font-size: var(--text-xs);
    font-weight: var(--font-normal);
    color: var(--color-text-muted);
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
    outline-offset: var(--focus-offset-inset);
    border-color: var(--color-border-focus);
  }

  .tag-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    background-color: var(--color-interactive-subtle);
    color: var(--color-link-active);
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
    /* The pill's tint carries the brand; its label takes the page's text
       colour (owner, Codex-mik4h: "Neutral text on tints"). The brand colour
       here failed AA for 2 799 of 4 101 brands on a light page. */
    color: var(--color-text);
    cursor: pointer;
    border-radius: var(--radius-full, 9999px);
    font-size: var(--text-sm);
    line-height: var(--leading-none);
    transition: var(--transition-colors);
  }

  /* The hover fill is the focus-ring colour, which no token names an ink for,
     so the glyph takes the luminance step from that fill itself
     (`--_on-fill-step`, light.css). The pressed brand colour it had was under
     4.5:1 on the ring for every brand in light and all but a few dozen in dark;
     page text would fail 618 of 4 101 in light and all of them in dark. */
  .tag-remove:hover {
    --_remove-fill: var(--color-focus-ring);
    background-color: var(--_remove-fill);
    color: oklch(from var(--_remove-fill) clamp(0, (0.62 - l) * 1000, 1) 0 0);
  }
  @supports (color: rgb(from red calc(255 * pow(r / 255, 2)) 0 0)) {
    .tag-remove:hover {
      color: rgb(from var(--_remove-fill) calc(255 * var(--_on-fill-step)) calc(255 * var(--_on-fill-step)) calc(255 * var(--_on-fill-step)));
    }
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

  :global([data-theme='dark']) .tag-pill {
    background-color: color-mix(in srgb, var(--color-interactive) 20%, var(--color-surface));
    color: var(--color-text);
  }

  :global([data-theme='dark']) .tag-remove:hover {
    background-color: color-mix(in srgb, var(--color-interactive) 30%, var(--color-surface));
  }
</style>

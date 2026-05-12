<!--
  @component SearchPill

  Single canonical search input. Replaces the bespoke `.explore__search` and
  `.lt__search` rules. Renders a hairline pill containing an inline search
  icon, the input itself, and (when value is non-empty) a clear button.

  Two commit modes:

    • Live (Library)    — pass `onChange`; each keystroke (optionally
                          debounced) flushes to the parent.
    • Submit-only (Explore) — omit `onChange`, pass `onSubmit`; typing only
                              updates the local mirror until Enter.

  External value resets re-sync the local mirror when there's no pending
  debounce timer.
-->
<script lang="ts">
  import { SearchIcon, XIcon } from '$lib/components/ui/Icon';

  interface Props {
    /** Controlled value from parent. Re-syncs the local mirror externally. */
    value: string;
    placeholder: string;
    /**
     * Called on every keystroke (optionally debounced). Omit to make the
     * input submit-only: typing won't commit to parent until Enter.
     */
    onChange?: (value: string) => void;
    /** Called on Enter / form submit with the current value. */
    onSubmit?: (value: string) => void;
    /**
     * Milliseconds to wait before flushing `onChange`. 0 = flush every
     * keystroke synchronously. Ignored when `onChange` is omitted.
     */
    debounce?: number;
    clearLabel?: string;
  }

  const {
    value,
    placeholder,
    onChange,
    onSubmit,
    debounce = 0,
    clearLabel = 'Clear search',
  }: Props = $props();

  // svelte-ignore state_referenced_locally — seeded once from initial prop
  let local = $state(value);
  let timer: ReturnType<typeof setTimeout> | null = null;

  // External reset (e.g. parent's Clear all) re-syncs the local mirror
  // when there's no pending debounce flush.
  $effect(() => {
    if (value !== local && timer === null) {
      local = value;
    }
  });

  function flushNow(v: string) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    onChange?.(v);
  }

  function handleInput(next: string) {
    local = next;
    if (!onChange) return;
    if (debounce > 0) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onChange(next);
      }, debounce);
    } else {
      onChange(next);
    }
  }

  function clear() {
    local = '';
    // Always commit a clear synchronously — both modes treat clear as
    // an explicit user action.
    flushNow('');
    onSubmit?.('');
  }

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    flushNow(local);
    onSubmit?.(local);
  }
</script>

{#snippet body()}
  <span class="search-pill__icon" aria-hidden="true">
    <SearchIcon size={14} />
  </span>
  <input
    type="search"
    class="search-pill__input"
    {placeholder}
    value={local}
    oninput={(e) => handleInput((e.currentTarget as HTMLInputElement).value)}
    aria-label={placeholder}
  />
  {#if local}
    <button
      type="button"
      class="search-pill__clear"
      onclick={clear}
      aria-label={clearLabel}
    >
      <XIcon size={11} />
    </button>
  {/if}
{/snippet}

{#if onSubmit}
  <form class="search-pill" data-testid="search-pill" onsubmit={handleSubmit}>
    {@render body()}
  </form>
{:else}
  <label class="search-pill" data-testid="search-pill">
    {@render body()}
  </label>
{/if}

<style>
  .search-pill {
    position: relative;
    display: inline-flex;
    align-items: center;
    align-self: center;
    flex: 1 1 18rem;
    min-width: 0;
    max-width: 28rem;
    height: var(--space-9);
    box-sizing: border-box;
    padding-inline: var(--space-3);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full);
    transition:
      var(--transition-colors),
      var(--transition-shadow);
  }

  .search-pill:focus-within {
    border-color: var(--color-interactive);
    box-shadow: 0 0 0 var(--border-width-thick) var(--color-interactive-subtle);
  }

  .search-pill__icon {
    display: inline-flex;
    color: var(--color-text-tertiary);
    margin-inline-end: var(--space-2);
    flex: 0 0 auto;
  }

  /* Defeat global base.css input rule: zero padding + small font so the
     input matches the pill's container height instead of stretching it. */
  .search-pill__input {
    flex: 1 1 auto;
    min-width: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    line-height: 1;
    color: var(--color-text);
    outline: none;
  }

  .search-pill__input::placeholder {
    color: var(--color-text-tertiary);
  }

  .search-pill__input::-webkit-search-cancel-button {
    appearance: none;
    -webkit-appearance: none;
  }

  /* Defeat base.css input:focus box-shadow — the pill carries the focus
     state via .search-pill:focus-within. */
  .search-pill__input:focus {
    outline: none;
    border: 0;
    box-shadow: none;
  }

  .search-pill__clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-4);
    height: var(--space-4);
    margin-inline-start: var(--space-1);
    padding: 0;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--color-surface-secondary);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .search-pill__clear:hover {
    background: var(--color-text-secondary);
    color: var(--color-text-inverse);
  }
</style>

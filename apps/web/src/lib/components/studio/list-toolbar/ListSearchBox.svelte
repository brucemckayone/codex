<!--
  @component ListSearchBox

  A studio list's search box (Codex-a6ofh.3.1; the media library's since
  Codex-a6ofh.1.6, mockup M1). `/` focuses it unless the creator is already
  typing somewhere; it shows a Clear button while it holds text and the `/`
  hint otherwise (the hint goes on phones, which have no `/` key to press).

  Presentational: the parent debounces `onInput` into the URL, so a link
  reproduces the search.
-->
<script lang="ts">
  import { SEARCH_MAX_QUERY_LENGTH } from '@codex/validation';
  import { SearchIcon, XIcon } from '$lib/components/ui/Icon';

  interface Props {
    id: string;
    /** The URL param it writes, for a form that posts without JS. */
    name: string;
    /** As typed, not as gated: the box never drops what the creator wrote. */
    value: string;
    placeholder: string;
    label: string;
    clearLabel: string;
    onInput: (value: string) => void;
    onClear: () => void;
    /** Optional class forwarded to the root for layout composition (R13). */
    class?: string;
  }

  const {
    id,
    name,
    value,
    placeholder,
    label,
    clearLabel,
    onInput,
    onClear,
    class: className,
  }: Props = $props();

  let input = $state<HTMLInputElement | null>(null);

  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]'))
    ) {
      return;
    }
    event.preventDefault();
    input?.focus();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="toolbar-search {className ?? ''}" data-field-box>
  <span class="search-icon" aria-hidden="true"><SearchIcon size={16} /></span>
  <input
    bind:this={input}
    type="search"
    {id}
    {name}
    autocomplete="off"
    maxlength={SEARCH_MAX_QUERY_LENGTH}
    class="search-input"
    {placeholder}
    aria-label={label}
    {value}
    oninput={(event) => onInput(event.currentTarget.value)}
  />
  {#if value}
    <button type="button" class="search-clear" onclick={onClear} aria-label={clearLabel}>
      <XIcon size={14} />
    </button>
  {:else}
    <kbd class="search-kbd" aria-hidden="true">/</kbd>
  {/if}
</div>

<style>
  .toolbar-search {
    position: relative;
    display: flex;
    align-items: center;
    flex: 1 1 18rem;
    min-width: 0;
    height: var(--space-10);
    padding: 0 var(--space-3);
    gap: var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    transition: var(--transition-colors);
  }

  /* The border's focus cue is base.css's `[data-field-box]` rule:
     --color-border-focus, which an org brand holds to 3:1 against its ground.
     It was --color-interactive, the brand's colour as picked: 1.47:1 for a
     pale yellow brand, 1.83:1 for a navy one on a dark page (Codex-c5prp). */
  .toolbar-search:focus-within {
    box-shadow: 0 0 0 var(--border-width-thick) var(--color-focus-ring, var(--color-focus));
  }

  .search-icon {
    display: inline-flex;
    color: var(--color-text-muted);
  }

  .search-input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: none;
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
  }

  .search-input:focus {
    outline: none;
  }

  .search-input::placeholder {
    color: var(--color-text-muted);
  }

  .search-input::-webkit-search-cancel-button {
    display: none;
  }

  .search-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
  }

  .search-clear:hover {
    background: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .search-clear:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
  }

  .search-kbd {
    padding: 0 var(--space-1-5);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  @media (--below-sm) {
    .search-kbd {
      display: none;
    }
  }
</style>

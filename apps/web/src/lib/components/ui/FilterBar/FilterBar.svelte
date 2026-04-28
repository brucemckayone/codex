<!--
  @component FilterBar

  Config-driven filter bar with pill groups, sort dropdown, and search input.
  Syncs filter state with URL query parameters via goto().

  @prop {FilterConfig[]} filters - Filter configuration array
  @prop {Record<string, string>} values - Current filter values (from URL params)
  @prop {(key: string, value: string | null) => void} onFilterChange - Called when a filter changes
  @prop {boolean} showActiveChips - Show removable chips for active filters
-->
<script lang="ts">
  import { XIcon } from '$lib/components/ui/Icon';
  import Select from '$lib/components/ui/Select/Select.svelte';

  interface FilterOption {
    value: string;
    label: string;
  }

  interface PillFilter {
    type: 'pills';
    key: string;
    label: string;
    options: FilterOption[];
    variant?: 'connected' | 'separated';
  }

  interface SelectFilter {
    type: 'select';
    key: string;
    label: string;
    options: FilterOption[];
    placeholder?: string;
    minWidth?: string;
  }

  interface SearchFilter {
    type: 'search';
    key: string;
    placeholder: string;
    mode?: 'debounce' | 'submit';
    debounceMs?: number;
  }

  export type FilterConfig = PillFilter | SelectFilter | SearchFilter;

  interface Props {
    filters: FilterConfig[];
    values: Record<string, string>;
    onFilterChange: (key: string, value: string | null) => void;
    showActiveChips?: boolean;
    class?: string;
  }

  const {
    filters,
    values,
    onFilterChange,
    showActiveChips = false,
    class: className,
  }: Props = $props();

  // Search debounce state per search filter
  let searchTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  let searchValues: Record<string, string> = $state({});

  // Initialize search values from URL
  $effect(() => {
    for (const filter of filters) {
      if (filter.type === 'search') {
        searchValues[filter.key] = values[filter.key] ?? '';
      }
    }
  });

  function handleSearchInput(filter: SearchFilter, value: string) {
    searchValues[filter.key] = value;

    if (filter.mode === 'submit') return; // wait for form submit

    clearTimeout(searchTimers[filter.key]);
    searchTimers[filter.key] = setTimeout(() => {
      onFilterChange(filter.key, value.trim() || null);
    }, filter.debounceMs ?? 300);
  }

  function handleSearchSubmit(filter: SearchFilter) {
    clearTimeout(searchTimers[filter.key]);
    const value = searchValues[filter.key]?.trim();
    onFilterChange(filter.key, value || null);
  }

  // ── Pill radiogroup keyboard handling ─────────────────────────────
  // ARIA radiogroup pattern: arrow keys (and Home/End) navigate + select.
  // Follow-focus semantics — matches apps/web/src/routes/_org/[slug]/(space)/
  // pricing/+page.svelte handleBillingKey. Roving tabindex is set inline on
  // each pill so Tab only lands once on the group (on the checked radio).
  function handlePillKey(e: KeyboardEvent, filter: PillFilter) {
    const isNext = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const isPrev = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    const isHome = e.key === 'Home';
    const isEnd = e.key === 'End';
    if (!isNext && !isPrev && !isHome && !isEnd) return;
    e.preventDefault();

    const options = filter.options;
    if (options.length === 0) return;

    const current = values[filter.key] ?? '';
    const currentIdx = options.findIndex(
      (o) => o.value === current || (!current && !o.value)
    );
    const safeIdx = currentIdx < 0 ? 0 : currentIdx;

    let targetIdx: number;
    if (isHome) {
      targetIdx = 0;
    } else if (isEnd) {
      targetIdx = options.length - 1;
    } else if (isNext) {
      targetIdx = (safeIdx + 1) % options.length;
    } else {
      targetIdx = (safeIdx - 1 + options.length) % options.length;
    }

    const target = options[targetIdx];
    if (!target) return;
    onFilterChange(filter.key, target.value || null);

    // Shift focus to the newly-checked pill on the next microtask, after
    // Svelte updates aria-checked + tabindex.
    const buttons = (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(
      'button[role="radio"]'
    );
    queueMicrotask(() => buttons[targetIdx]?.focus());
  }

  // Active chips for display
  const activeChips = $derived.by(() => {
    if (!showActiveChips) return [];
    const chips: Array<{ key: string; label: string; filterLabel: string }> = [];
    for (const filter of filters) {
      if (filter.type === 'search') continue;
      const val = values[filter.key];
      if (!val) continue;
      const option = filter.options.find(o => o.value === val);
      if (option) {
        chips.push({ key: filter.key, label: option.label, filterLabel: filter.label });
      }
    }
    return chips;
  });
</script>

<div class="filter-bar {className ?? ''}">
  <div class="filter-bar__controls">
    {#each filters as filter (filter.key)}
      {#if filter.type === 'pills'}
        <div
          class="filter-bar__pills"
          class:filter-bar__pills--connected={filter.variant === 'connected'}
          role="radiogroup"
          aria-label={filter.label}
          onkeydown={(e) => handlePillKey(e, filter)}
        >
          {#each filter.options as option (option.value)}
            {@const isChecked = values[filter.key] === option.value || (!values[filter.key] && !option.value)}
            <button
              type="button"
              class="filter-bar__pill"
              class:filter-bar__pill--active={isChecked}
              onclick={() => onFilterChange(filter.key, option.value || null)}
              role="radio"
              aria-checked={isChecked}
              tabindex={isChecked ? 0 : -1}
            >
              {option.label}
            </button>
          {/each}
        </div>

      {:else if filter.type === 'select'}
        <div class="filter-bar__select" style:min-width={filter.minWidth ?? '160px'}>
          <Select
            options={filter.options}
            value={values[filter.key] ?? ''}
            onValueChange={(val) => onFilterChange(filter.key, val || null)}
            placeholder={filter.placeholder ?? filter.label}
          />
        </div>

      {:else if filter.type === 'search'}
        <form
          class="filter-bar__search"
          onsubmit={(e) => { e.preventDefault(); handleSearchSubmit(filter); }}
        >
          <input
            type="search"
            id="filter-bar-search-{filter.key}"
            name={filter.key}
            autocomplete="off"
            class="filter-bar__search-input"
            placeholder={filter.placeholder}
            value={searchValues[filter.key] ?? ''}
            oninput={(e) => handleSearchInput(filter, (e.target as HTMLInputElement).value)}
            aria-label={filter.placeholder}
          />
          {#if searchValues[filter.key]}
            <button
              type="button"
              class="filter-bar__search-clear"
              onclick={() => { searchValues[filter.key] = ''; onFilterChange(filter.key, null); }}
              aria-label="Clear search"
            >
              <XIcon size={14} />
            </button>
          {/if}
        </form>
      {/if}
    {/each}
  </div>

  {#if showActiveChips && activeChips.length > 0}
    <div class="filter-bar__chips">
      {#each activeChips as chip (chip.key)}
        <span class="filter-bar__chip">
          {chip.filterLabel}: {chip.label}
          <button
            class="filter-bar__chip-remove"
            onclick={() => onFilterChange(chip.key, null)}
            aria-label="Remove {chip.filterLabel} filter"
          >
            <XIcon size={12} />
          </button>
        </span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .filter-bar {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .filter-bar__controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  /* Pills */
  .filter-bar__pills {
    display: flex;
    gap: var(--space-2);
  }

  .filter-bar__pills--connected {
    gap: var(--space-0);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .filter-bar__pill {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    background: var(--color-surface);
    border: none;
    cursor: pointer;
    white-space: nowrap;
    transition: background-color var(--duration-fast) var(--ease-default),
      color var(--duration-fast) var(--ease-default);
  }

  .filter-bar__pills:not(.filter-bar__pills--connected) .filter-bar__pill {
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full);
  }

  .filter-bar__pill:hover {
    background: var(--color-surface-secondary);
  }

  .filter-bar__pill--active {
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  .filter-bar__pill--active:hover {
    background: var(--color-interactive-hover);
  }

  .filter-bar__pill:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* Select */
  .filter-bar__select {
    flex-shrink: 0;
  }

  /* Search */
  .filter-bar__search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    flex: 1 1 240px;
    min-width: 0;
    transition: var(--transition-colors);
  }

  .filter-bar__search:focus-within {
    border-color: var(--color-interactive);
  }

  .filter-bar__search-input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: var(--text-sm);
    color: var(--color-text);
    font-family: var(--font-sans);
    min-width: 0;
  }

  .filter-bar__search-input::placeholder {
    color: var(--color-text-muted);
  }

  .filter-bar__search-input::-webkit-search-cancel-button {
    display: none;
  }

  .filter-bar__search-clear {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-0-5);
    border: none;
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: var(--transition-colors);
  }

  .filter-bar__search-clear:hover {
    color: var(--color-text);
  }

  .filter-bar__search-clear:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* Chips */
  .filter-bar__chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .filter-bar__chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-interactive);
    border-radius: var(--radius-full);
  }

  .filter-bar__chip-remove {
    display: inline-flex;
    align-items: center;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
  }

  /* Responsive */
  @media (--below-sm) {
    .filter-bar__controls {
      flex-direction: column;
      align-items: stretch;
    }

    .filter-bar__pills {
      overflow-x: auto;
      scrollbar-width: none;
    }

    .filter-bar__pills::-webkit-scrollbar {
      display: none;
    }
  }
</style>

<!--
  @component FontPicker

  A font selection dropdown with categorized Google Fonts, search,
  per-option font rendering, and live hover preview on the page.

  Built on Melt UI's createSelect for ARIA listbox semantics and keyboard nav.
  Hover preview uses direct DOM CSS injection (bypasses the store to avoid
  marking dirty or writing sessionStorage on transient hovers).

  @prop {'body' | 'heading'} mode - Controls which fonts are shown and which CSS var is previewed
  @prop {string} label - Label text above the trigger
  @prop {string} value - Current font family ('' = default)
  @prop {(value: string) => void} onValueChange - Called on selection
-->
<script lang="ts">
  import { browser } from '$app/environment';
  import { createSelect } from '@melt-ui/svelte';
  import { untrack } from 'svelte';
  import { Label } from '$lib/components/ui';
  import {
    CheckIcon,
    ChevronDownIcon,
    SearchIcon,
    XIcon,
  } from '$lib/components/ui/Icon';
  import {
    BODY_CATEGORY_ORDER,
    CATEGORY_LABELS,
    HEADING_CATEGORY_ORDER,
    findFont,
    getBodyFonts,
    getFontsByCategory,
    getHeadingFonts,
  } from '$lib/brand-editor/font-catalog';
  import {
    loadGoogleFont,
    previewFont,
    revertFontPreview,
  } from '$lib/brand-editor/css-injection';

  interface Props {
    mode: 'body' | 'heading';
    label: string;
    value: string;
    onValueChange: (value: string) => void;
  }

  const { mode, label, value, onValueChange }: Props = $props();

  // ── Search ──────────────────────────────────────────────────────────────
  let searchQuery = $state('');
  let searchInputEl = $state<HTMLInputElement | null>(null);

  // ── Font data ───────────────────────────────────────────────────────────
  const allFonts = $derived(
    mode === 'body' ? getBodyFonts() : getHeadingFonts()
  );
  const categoryOrder = $derived(
    mode === 'heading' ? HEADING_CATEGORY_ORDER : BODY_CATEGORY_ORDER
  );

  const filteredFonts = $derived.by(() => {
    if (!searchQuery.trim()) return allFonts;
    const q = searchQuery.toLowerCase().trim();
    return allFonts.filter((f) => f.family.toLowerCase().includes(q));
  });

  const groupedFonts = $derived(getFontsByCategory(filteredFonts));
  const selectedFont = $derived(value ? findFont(value) : undefined);

  // ── Melt UI Select ─────────────────────────────────────────────────────
  const {
    elements: { trigger, menu, option },
    states: { open, selected },
    helpers: { isSelected },
  } = createSelect<string>({
    forceVisible: true,
    portal: 'body',
    positioning: {
      placement: 'bottom',
      sameWidth: true,
      fitViewport: true,
    },
    defaultSelected: untrack(() =>
      value ? { value, label: value } : undefined
    ),
    onSelectedChange: ({ next }) => {
      onValueChange(next?.value ?? '');
      searchQuery = '';
      return next;
    },
  });

  // Sync external value changes into Melt UI state
  $effect(() => {
    const current = $selected;
    if (value !== (current?.value ?? '')) {
      selected.set(value ? { value, label: value } : undefined);
    }
  });

  // ── Font lazy-loading ──────────────────────────────────────────────────
  // Fonts load when their row scrolls into view via IntersectionObserver
  // (plus the per-option handlePointerEnter preload below for hover).
  // Matches the existing IntersectionObserver pattern used in ShaderHero /
  // _org/[slug]/(space)/+page.svelte (sentinel/observer per visible element).
  let listEl = $state<HTMLElement | null>(null);
  let fontObserver = $state<IntersectionObserver | null>(null);

  $effect(() => {
    if (!$open || !browser || !listEl) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const family = (entry.target as HTMLElement).dataset.fontFamily;
            if (family) loadGoogleFont(family);
            observer.unobserve(entry.target);
          }
        }
      },
      { root: listEl, rootMargin: '200px 0px' }
    );
    fontObserver = observer;
    return () => {
      observer.disconnect();
      fontObserver = null;
    };
  });

  function observeFontOption(node: HTMLElement) {
    if (fontObserver) fontObserver.observe(node);
    return {
      destroy() {
        if (fontObserver) fontObserver.unobserve(node);
      },
    };
  }

  // Auto-focus search when dropdown opens
  $effect(() => {
    if ($open && searchInputEl) {
      // Defer to next frame so Melt UI finishes its focus management
      requestAnimationFrame(() => searchInputEl?.focus());
    }
  });

  // Reset search when dropdown closes
  $effect(() => {
    if (!$open) {
      searchQuery = '';
    }
  });

  // ── Hover preview ──────────────────────────────────────────────────────
  function handlePointerEnter(family: string) {
    previewFont(mode, family);
  }

  function handleDropdownLeave() {
    revertFontPreview(mode, value || null);
  }

  // Revert on dropdown close (escape, click outside)
  let prevOpen = $state(false);
  $effect(() => {
    const isOpen = $open;
    if (prevOpen && !isOpen && browser) {
      revertFontPreview(mode, value || null);
    }
    prevOpen = isOpen;
  });
</script>

<div class="font-picker">
  <Label>{label}</Label>

  <button {...$trigger} use:trigger class="font-picker__trigger">
    {#if value}
      <span
        class="font-picker__value"
        style:font-family="'{value}', {selectedFont?.fallback ?? 'sans-serif'}"
      >
        {value}
      </span>
      {#if selectedFont}
        <span class="font-picker__tag">{CATEGORY_LABELS[selectedFont.category]}</span>
      {/if}
    {:else}
      <span class="font-picker__value font-picker__value--default">
        Default (Inter)
      </span>
    {/if}
    <ChevronDownIcon size={16} class="font-picker__chevron" />
  </button>

  {#if $open}
    <div
      {...$menu}
      use:menu
      class="font-picker__dropdown"
      onpointerleave={handleDropdownLeave}
    >
      <!-- Search input -->
      <div class="font-picker__search" role="none">
        <SearchIcon size={14} />
        <input
          bind:this={searchInputEl}
          class="font-picker__search-input"
          type="text"
          placeholder="Search fonts..."
          bind:value={searchQuery}
          onkeydown={(e) => e.stopPropagation()}
        />
        {#if searchQuery}
          <button
            type="button"
            class="font-picker__search-clear"
            aria-label="Clear search"
            onclick={() => { searchQuery = ''; }}
            onkeydown={(e) => e.stopPropagation()}
          >
            <XIcon size={12} />
          </button>
        {/if}
      </div>

      <!-- Options list -->
      <div class="font-picker__list" bind:this={listEl}>
        <!-- Default option -->
        <div
          {...$option({ value: '', label: 'Default (Inter)' })}
          use:option
          class="font-picker__option"
          class:font-picker__option--selected={!value}
          onpointerenter={() => handlePointerEnter('Inter')}
        >
          <span class="font-picker__option-label">Default (Inter)</span>
          {#if $isSelected('')}
            <CheckIcon size={14} class="font-picker__check" />
          {/if}
        </div>

        <!-- Grouped by category -->
        {#each categoryOrder as cat (cat)}
          {#if groupedFonts.has(cat)}
            <div class="font-picker__group-header" role="presentation">
              {CATEGORY_LABELS[cat]}
            </div>
            {#each groupedFonts.get(cat) ?? [] as font (font.family)}
              <div
                {...$option({ value: font.family, label: font.family })}
                use:option
                use:observeFontOption
                data-font-family={font.family}
                class="font-picker__option"
                class:font-picker__option--selected={value === font.family}
                style:font-family="'{font.family}', {font.fallback}"
                onpointerenter={() => handlePointerEnter(font.family)}
              >
                <span class="font-picker__option-label">{font.family}</span>
                {#if $isSelected(font.family)}
                  <CheckIcon size={14} class="font-picker__check" />
                {/if}
              </div>
            {/each}
          {/if}
        {/each}

        {#if filteredFonts.length === 0}
          <div class="font-picker__empty">
            No fonts match &ldquo;{searchQuery}&rdquo;
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .font-picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
    position: relative;
  }

  /* ── Trigger ─────────────────────────────────────────────────────────── */
  .font-picker__trigger {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
    font-size: var(--text-sm);
    color: var(--color-text);
    text-align: left;
    min-height: var(--space-10);
  }

  .font-picker__trigger:hover {
    border-color: var(--color-border-strong);
  }

  .font-picker__trigger:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .font-picker__value {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--font-medium);
  }

  .font-picker__value--default {
    color: var(--color-text-muted);
    font-weight: var(--font-normal);
  }

  .font-picker__tag {
    flex-shrink: 0;
    font-size: var(--text-xs);
    font-family: var(--font-sans);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-full);
    padding: var(--space-0-5) var(--space-2);
    line-height: 1.4;
  }

  :global(.font-picker__chevron) {
    color: var(--color-text-muted);
    flex-shrink: 0;
    transition: transform var(--duration-fast);
  }

  .font-picker__trigger:global([data-state='open']) :global(.font-picker__chevron) {
    transform: rotate(180deg);
  }

  /* ── Dropdown ────────────────────────────────────────────────────────── */
  .font-picker__dropdown {
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    z-index: var(--z-modal);
    overflow: hidden;
  }

  /* ── Search ──────────────────────────────────────────────────────────── */
  .font-picker__search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    color: var(--color-text-muted);
  }

  .font-picker__search-input {
    flex: 1;
    border: none;
    background: none;
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    color: var(--color-text);
    outline: none;
    padding: 0;
    min-width: 0;
  }

  .font-picker__search-input::placeholder {
    color: var(--color-text-muted);
  }

  .font-picker__search-clear {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-5);
    height: var(--space-5);
    border: none;
    background: none;
    color: var(--color-text-muted);
    border-radius: var(--radius-sm);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition: var(--transition-colors);
  }

  .font-picker__search-clear:hover {
    color: var(--color-text);
    background: var(--color-surface-secondary);
  }

  /* ── Option list ─────────────────────────────────────────────────────── */
  .font-picker__list {
    max-height: 18rem;
    overflow-y: auto;
    padding: var(--space-1);
  }

  /* ── Group headers ───────────────────────────────────────────────────── */
  .font-picker__group-header {
    font-size: var(--text-xs);
    font-family: var(--font-sans);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: var(--space-3) var(--space-3) var(--space-1);
    user-select: none;
  }

  /* ── Options ─────────────────────────────────────────────────────────── */
  .font-picker__option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--text-base);
    color: var(--color-text);
    transition: background-color var(--duration-fast);
    background: transparent;
    border: none;
    text-align: left;
  }

  .font-picker__option:global([data-highlighted]) {
    background-color: var(--color-surface-secondary);
  }

  .font-picker__option--selected {
    background-color: var(--color-interactive-subtle);
  }

  .font-picker__option--selected:global([data-highlighted]) {
    background-color: var(--color-interactive-subtle);
  }

  .font-picker__option-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  :global(.font-picker__check) {
    color: var(--color-interactive);
    flex-shrink: 0;
  }

  /* ── Empty state ─────────────────────────────────────────────────────── */
  .font-picker__empty {
    padding: var(--space-4) var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    text-align: center;
    font-family: var(--font-sans);
  }
</style>

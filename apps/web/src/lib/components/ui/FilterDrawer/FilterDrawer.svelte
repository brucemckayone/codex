<!--
  @component FilterDrawer

  Generic chrome for a "Filters & Sort" drawer. Right-edge panel on desktop
  (≥40rem); bottom sheet on mobile (<40rem). Owns the responsive geometry,
  slide animations, grip handle, header, body, footer, prefers-reduced-motion,
  and the hybrid commit model:

    • Desktop — live: each setter flushes to parent immediately.
    • Mobile  — staged: local snapshot; flush on Apply, discard on Cancel
      (close-via-X / outside-click / Esc are all treated as Cancel).

  Generic over `TFacets extends Record<string, unknown>` so consumers can
  pass any flat filter shape. The `sections` snippet receives the current
  view state (staged on mobile, live on desktop) plus setters and an
  isMobile flag, and renders its own section content using the exposed
  :global() class hooks:

    .filter-drawer__section
    .filter-drawer__heading
    .filter-drawer__list / .filter-drawer__option / .filter-drawer__option-label / .filter-drawer__option-check
    .filter-drawer__pills / .filter-drawer__pill
-->
<script lang="ts" generics="TFacets extends object">
  import type { Snippet } from 'svelte';
  import * as Dialog from '$lib/components/ui/Dialog';
  import { SlidersIcon } from '$lib/components/ui/Icon';

  type FacetKey = keyof TFacets;

  interface SectionContext {
    filters: TFacets;
    sort: string;
    setFilter: <K extends FacetKey>(key: K, value: TFacets[K]) => void;
    setSort: (value: string) => void;
    isMobile: boolean;
  }

  interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    /** Current live filter state from parent. */
    filters: TFacets;
    /** Current live sort value from parent. */
    sort: string;
    /** Default filter shape used by mobile in-drawer Clear-all. */
    defaultFilters: TFacets;
    /** Default sort value used by mobile in-drawer Clear-all. */
    defaultSort: string;
    /** Flush staged filters → parent on Apply / desktop write. */
    onFilterChange: (filters: TFacets) => void;
    /** Flush staged sort → parent on Apply / desktop write. */
    onSortChange: (value: string) => void;
    /** Desktop Clear-all; mobile clears locally without flushing. */
    onClearAll: () => void;
    /** Section content. Receives reactive view state + setters + isMobile. */
    sections: Snippet<[SectionContext]>;
    applyLabel: string;
    doneLabel: string;
    clearLabel: string;
    /** Number of non-default filters + sort delta. Surfaces as a header badge. */
    activeCount?: number;
  }

  const {
    open,
    onOpenChange,
    title,
    filters,
    sort,
    defaultFilters,
    defaultSort,
    onFilterChange,
    onSortChange,
    onClearAll,
    sections,
    applyLabel,
    doneLabel,
    clearLabel,
    activeCount = 0,
  }: Props = $props();

  const badgeLabel = $derived(activeCount > 9 ? '9+' : String(activeCount));

  // ── Responsive mode detection ───────────────────────────────────────
  let isMobile = $state(false);
  $effect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(max-width: 40rem)');
    isMobile = mql.matches;
    const onChange = (e: MediaQueryListEvent) => {
      isMobile = e.matches;
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  });

  // ── Shallow equality for flat filter shapes ─────────────────────────
  function facetsEqual(a: TFacets, b: TFacets): boolean {
    const ak = Object.keys(a as object) as FacetKey[];
    const bk = Object.keys(b as object) as FacetKey[];
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (a[k] !== b[k]) return false;
    }
    return true;
  }

  // ── Staged snapshot (mobile-only path reads it) ─────────────────────
  // svelte-ignore state_referenced_locally — seeded once from initial prop
  let staged = $state<TFacets>({ ...filters });
  // svelte-ignore state_referenced_locally
  let stagedSort = $state(sort);
  let prevOpen = $state(false);
  let prevIsMobile = $state(false);

  // Reseed snapshot on closed→open transition. Diff-guarded to absorb
  // Melt UI onOpenChange echoes during controlled-state mount.
  $effect(() => {
    if (open && !prevOpen) {
      if (!facetsEqual(staged, filters)) {
        staged = { ...filters };
      }
      if (stagedSort !== sort) stagedSort = sort;
    }
    prevOpen = open;
  });

  // Rotation / viewport change while drawer is open.
  $effect(() => {
    if (!open) {
      prevIsMobile = isMobile;
      return;
    }
    if (prevIsMobile === isMobile) return;
    if (prevIsMobile && !isMobile) {
      // mobile → desktop: flush staged so live mode continues from same
      // visual state without dropping the user's pending picks.
      if (!facetsEqual(staged, filters)) {
        onFilterChange(staged);
      }
      if (stagedSort !== sort) onSortChange(stagedSort);
    } else if (!prevIsMobile && isMobile) {
      // desktop → mobile: reseed staged from live parent values.
      staged = { ...filters };
      stagedSort = sort;
    }
    prevIsMobile = isMobile;
  });

  // ── View bindings & write handlers ──────────────────────────────────
  const viewFilters = $derived<TFacets>(isMobile ? staged : filters);
  const viewSort = $derived(isMobile ? stagedSort : sort);

  function setFilter<K extends FacetKey>(key: K, value: TFacets[K]) {
    if (isMobile) {
      staged = { ...staged, [key]: value } as TFacets;
    } else {
      onFilterChange({ ...filters, [key]: value } as TFacets);
    }
  }
  function setSort(value: string) {
    if (isMobile) {
      stagedSort = value;
    } else {
      onSortChange(value);
    }
  }

  function apply() {
    if (!facetsEqual(staged, filters)) onFilterChange(staged);
    if (stagedSort !== sort) onSortChange(stagedSort);
    onOpenChange(false);
  }
  function cancel() {
    staged = { ...filters };
    stagedSort = sort;
    onOpenChange(false);
  }
  function done() {
    onOpenChange(false);
  }
  function clearAllInDrawer() {
    if (isMobile) {
      staged = { ...defaultFilters };
      stagedSort = defaultSort;
    } else {
      onClearAll();
    }
  }

  // Idempotent open binding — Melt echoes during mount, and a non-Apply
  // close on mobile must be treated as Cancel (no implicit commit).
  function handleOpenChange(next: boolean) {
    if (next === open) return;
    if (!next && isMobile) {
      cancel();
      return;
    }
    onOpenChange(next);
  }

  // Fade-swap the footer primary label across rotation rather than a
  // hard-pop on {#if} reflow.
  const primaryLabel = $derived(isMobile ? applyLabel : doneLabel);

  const sectionContext = $derived<SectionContext>({
    filters: viewFilters,
    sort: viewSort,
    setFilter,
    setSort,
    isMobile,
  });
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
  <Dialog.Content class="filter-drawer">
    <Dialog.Header class="filter-drawer__head">
      <span class="filter-drawer__grip" aria-hidden="true"></span>
      <div class="filter-drawer__head-inner">
        <span class="filter-drawer__head-glyph" aria-hidden="true">
          <SlidersIcon size={18} />
        </span>
        <Dialog.Title>{title}</Dialog.Title>
        {#if activeCount > 0}
          <span class="filter-drawer__badge" aria-label={`${activeCount} active`}>
            {badgeLabel}
          </span>
        {/if}
      </div>
    </Dialog.Header>

    <Dialog.Body class="filter-drawer__body">
      {@render sections(sectionContext)}
    </Dialog.Body>

    <Dialog.Footer class="filter-drawer__foot">
      <button type="button" class="filter-drawer__clear" onclick={clearAllInDrawer}>
        {clearLabel}
      </button>
      <button
        type="button"
        class="filter-drawer__btn filter-drawer__btn--primary"
        onclick={isMobile ? apply : done}
      >
        {primaryLabel}
      </button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  /* ── Animations ─────────────────────────────────────────────────── */
  @keyframes filter-drawer-slide-in-right {
    0% {
      transform: translateX(100%);
      opacity: 0;
    }
    60% {
      opacity: 1;
    }
    100% {
      transform: translateX(0);
      opacity: 1;
    }
  }
  @keyframes filter-drawer-slide-in-bottom {
    0% {
      transform: translateY(100%);
      opacity: 0;
    }
    60% {
      opacity: 1;
    }
    100% {
      transform: translateY(0);
      opacity: 1;
    }
  }
  @keyframes filter-drawer-tap {
    0% {
      transform: scale(1);
    }
    40% {
      transform: scale(0.96);
    }
    100% {
      transform: scale(1);
    }
  }

  /* ── Desktop: floating-glass right-edge panel ──────────────────── */
  :global(.dialog-content.filter-drawer) {
    position: fixed;
    top: var(--space-3);
    right: var(--space-3);
    bottom: var(--space-3);
    left: auto;
    max-width: var(--container-drawer, 24rem);
    width: calc(100% - var(--space-6));
    height: auto;
    max-height: calc(100dvh - var(--space-6));
    background: var(--material-glass);
    backdrop-filter: blur(var(--blur-xl));
    -webkit-backdrop-filter: blur(var(--blur-xl));
    border: var(--border-width) var(--border-style) var(--material-glass-border);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-xl);
    display: flex;
    flex-direction: column;
    padding: 0;
    overflow: hidden; /* clip head/foot hairlines to the rounded panel */
    animation: filter-drawer-slide-in-right var(--duration-slow) var(--ease-smooth) both;
  }

  /* ── Mobile: floating-glass bottom sheet ─────────────────────────── */
  @media (max-width: 40rem) {
    :global(.dialog-content.filter-drawer) {
      top: auto;
      left: var(--space-2);
      right: var(--space-2);
      bottom: var(--space-2);
      max-width: none;
      width: auto;
      height: auto;
      max-height: 85dvh;
      border-radius: var(--radius-xl);
      animation: filter-drawer-slide-in-bottom var(--duration-slow) var(--ease-spring) both;
    }
  }

  /* ── Reduced motion ─────────────────────────────────────────────── */
  /* !important required: animation shorthand sets 8 sub-properties at once;
     only !important overrides it from a media query. */
  @media (prefers-reduced-motion: reduce) {
    :global(.dialog-content.filter-drawer) {
      animation: none !important;
    }
    :global(.filter-drawer__option),
    :global(.filter-drawer__pill) {
      animation: none !important;
    }
  }

  /* ── Drag handle (mobile only, visual affordance) ───────────────── */
  .filter-drawer__grip {
    display: none;
  }
  @media (max-width: 40rem) {
    .filter-drawer__grip {
      display: block;
      width: var(--space-10);
      height: var(--space-1);
      margin: var(--space-2) auto var(--space-1);
      border-radius: var(--radius-full);
      background: var(--color-border-strong);
    }
  }

  /* ── Header ─────────────────────────────────────────────────────── */
  :global(.filter-drawer__head) {
    padding: var(--space-5) var(--space-6) var(--space-4);
    padding-inline-end: var(--space-12);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    background: transparent;
  }
  @media (max-width: 40rem) {
    :global(.filter-drawer__head) {
      padding-block-start: max(var(--space-1), env(safe-area-inset-top, 0));
      padding-inline: var(--space-5);
      padding-block-end: var(--space-3);
    }
  }
  .filter-drawer__head-inner {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .filter-drawer__head-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-secondary);
    flex: 0 0 auto;
  }
  :global(.filter-drawer__head .dialog-title) {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    letter-spacing: -0.01em;
    flex: 1 1 auto;
    min-width: 0;
  }
  .filter-drawer__badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    min-width: var(--space-5);
    height: var(--space-5);
    padding: 0 var(--space-2);
    background: var(--color-interactive-subtle, var(--color-surface-secondary));
    color: var(--color-interactive);
    border-radius: var(--radius-full);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  /* ── Body ───────────────────────────────────────────────────────── */
  :global(.filter-drawer__body) {
    flex: 1 1 auto;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    padding: var(--space-5) var(--space-5) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: 0; /* dividers do the spacing work, mirroring MobileBottomSheet */
    background: transparent;
  }
  @media (max-width: 40rem) {
    :global(.filter-drawer__body) {
      padding-inline: var(--space-4);
      padding-block-start: var(--space-4);
    }
  }

  /* Class hooks exposed to consumers via the `sections` snippet. They
     render section content inside the body and inherit these styles. */
  :global(.filter-drawer__section) {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  /* Hairline divider between adjacent sections — matches
     MobileBottomSheet's `.sheet__divider` (border-width × --color-border,
     symmetric --space-3 spacing). Adjacent-sibling so consumers don't
     have to render a separator element between sections. */
  :global(.filter-drawer__section + .filter-drawer__section) {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  :global(.filter-drawer__heading) {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  /* ── Sort row list ──────────────────────────────────────────────── */
  :global(.filter-drawer__list) {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  :global(.filter-drawer__option) {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-height: var(--space-11);
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: 0;
    border-radius: var(--radius-md);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text);
    text-align: start;
    cursor: pointer;
    transition:
      var(--transition-colors),
      transform var(--duration-fast) var(--ease-out);
  }
  :global(.filter-drawer__option::before) {
    content: '';
    position: absolute;
    inset-block: var(--space-2);
    inset-inline-start: 0;
    width: 3px;
    border-radius: var(--radius-full);
    background: transparent;
    transition: background-color var(--duration-fast) var(--ease-out);
  }
  :global(.filter-drawer__option:hover) {
    background: var(--color-surface-secondary);
  }
  :global(.filter-drawer__option:active) {
    animation: filter-drawer-tap var(--duration-fast) var(--ease-out);
  }
  :global(.filter-drawer__option:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset-inset, -1px);
  }
  :global(.filter-drawer__option.is-active) {
    color: var(--color-interactive);
    font-weight: var(--font-semibold);
    background: var(--color-interactive-subtle, var(--color-surface-secondary));
  }
  :global(.filter-drawer__option.is-active::before) {
    background: var(--color-interactive);
  }
  :global(.filter-drawer__option-label) {
    flex: 1 1 auto;
    min-width: 0;
  }
  :global(.filter-drawer__option-check) {
    display: inline-flex;
    color: var(--color-interactive);
  }

  /* ── Pill grid ──────────────────────────────────────────────────── */
  :global(.filter-drawer__pills) {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  :global(.filter-drawer__pill) {
    min-height: var(--space-10);
    padding: var(--space-2) var(--space-4);
    background: transparent;
    /* border-strong: --color-border is invisible against --color-surface-elevated
       on dark theme; --color-border-strong holds contrast on the drawer
       surface. */
    border: var(--border-width) var(--border-style) var(--color-border-strong);
    border-radius: var(--radius-full);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    cursor: pointer;
    white-space: nowrap;
    transition:
      var(--transition-colors),
      transform var(--duration-fast) var(--ease-out);
  }
  :global(.filter-drawer__pill:hover) {
    color: var(--color-text);
    border-color: var(--color-border-hover, var(--color-text-secondary));
    background: var(--color-surface-secondary);
  }
  :global(.filter-drawer__pill:active) {
    animation: filter-drawer-tap var(--duration-fast) var(--ease-out);
  }
  :global(.filter-drawer__pill:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset, 1px);
  }
  :global(.filter-drawer__pill.is-active) {
    color: var(--color-text-inverse);
    background: var(--color-interactive);
    border-color: var(--color-interactive);
  }
  :global(.filter-drawer__pill.is-active:hover) {
    background: var(--color-interactive-hover);
    border-color: var(--color-interactive-hover);
  }

  /* ── Footer ─────────────────────────────────────────────────────── */
  :global(.dialog-footer.filter-drawer__foot) {
    display: flex !important;
    flex-direction: row !important;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-5);
    background: transparent;
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }
  @media (max-width: 40rem) {
    :global(.dialog-footer.filter-drawer__foot) {
      padding-inline: var(--space-4);
      padding-block-end: max(var(--space-3), env(safe-area-inset-bottom, 0));
    }
  }

  .filter-drawer__clear {
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: 0;
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    cursor: pointer;
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
  }
  .filter-drawer__clear:hover {
    color: var(--color-interactive);
    text-decoration: underline;
  }
  .filter-drawer__clear:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset, 1px);
  }

  .filter-drawer__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--space-10);
    padding: var(--space-2) var(--space-5);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    border: var(--border-width) var(--border-style) transparent;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
      var(--transition-colors),
      var(--transition-shadow),
      transform var(--duration-fast) var(--ease-out);
  }
  .filter-drawer__btn--primary {
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
    box-shadow: var(--shadow-sm);
  }
  .filter-drawer__btn--primary:hover {
    background: var(--color-interactive-hover);
    box-shadow: var(--shadow-md);
  }
  .filter-drawer__btn:active {
    animation: filter-drawer-tap var(--duration-fast) var(--ease-out);
  }
  .filter-drawer__btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset, 1px);
  }

  @media (max-width: 40rem) {
    .filter-drawer__btn--primary {
      min-width: var(--space-32);
      padding-inline: var(--space-6);
    }
  }
</style>

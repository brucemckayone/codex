<!--
  @component FilterDrawer

  Generic chrome for a "Filters & Sort" drawer. Right-edge panel at `sm` and
  up; bottom sheet below it (the `--below-sm` breakpoint, matched in JS by
  MOBILE_QUERY so CSS and behaviour flip together). The panel, its slide and
  its phone sheet are Dialog.Content's `variant="drawer" floating sheet`; this
  owns the grip handle, the title row, the two footer actions and the hybrid
  commit model:

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
  import * as m from '$paraglide/messages';
  import { MOBILE_QUERY } from './breakpoint';

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
  // MOBILE_QUERY matches the `--below-sm` custom-media the CSS below uses. The
  // old `40rem` was 1px wider than every other breakpoint in the app, so at
  // exactly 640px this drawer became a bottom sheet while nothing else moved.
  // It lives in `./breakpoint.ts` so the test asserts against the SAME string
  // the component asks matchMedia for, instead of a hand-copied literal that
  // silently drifts.
  let isMobile = $state(false);
  $effect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(MOBILE_QUERY);
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
  // Seeded once from the initial props; the reseed effect below owns updates.
  // (svelte-ignore lines carry the code ONLY — trailing prose on the same line
  // parses as further ignore codes and is reported as unused.)
  // svelte-ignore state_referenced_locally
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

<!--
  The glass rail and its phone sheet are Dialog.Content's `floating sheet`
  drawer, with the Dialog's own Header and Body. The head and body rules this
  drawer once declared lost to those parts on specificity and never applied
  (measured against HEAD, Codex-vlphc.3), so the parts' defaults ARE its look.
-->
<Dialog.Root {open} onOpenChange={handleOpenChange}>
  <Dialog.Content variant="drawer" floating sheet class="filter-drawer">
    <Dialog.Header>
      <span class="filter-drawer__grip" aria-hidden="true"></span>
      <div class="filter-drawer__head-inner">
        <span class="filter-drawer__head-glyph" aria-hidden="true">
          <SlidersIcon size={18} />
        </span>
        <Dialog.Title class="filter-drawer__title">{title}</Dialog.Title>
        {#if activeCount > 0}
          <span
            class="filter-drawer__badge"
            aria-label={m.filters_active_count({ count: activeCount })}
          >
            {badgeLabel}
          </span>
        {/if}
      </div>
    </Dialog.Header>

    <Dialog.Body>
      {@render sections(sectionContext)}
    </Dialog.Body>

    <Dialog.Footer align="between">
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

  /* ── Reduced motion ─────────────────────────────────────────────── */
  /* !important required: animation shorthand sets 8 sub-properties at once;
     only !important overrides it from a media query. */
  @media (prefers-reduced-motion: reduce) {
    :global(.filter-drawer__option),
    :global(.filter-drawer__pill) {
      animation: none !important;
    }
  }

  /* ── Drag handle (mobile only, visual affordance) ───────────────── */
  .filter-drawer__grip {
    display: none;
  }
  @media (--below-sm) {
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
  /* Through this drawer's own row: Dialog.Title's `.dialog-title` is
     (0,2,0) with its scoping class, and this is (0,3,0). */
  .filter-drawer__head-inner :global(.filter-drawer__title) {
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
    /* `--color-text`, as the selected row's label (below): brand ink on a brand
       tint has no inverting side (Codex-mik4h). The tint carries the brand. */
    color: var(--color-text);
    border-radius: var(--radius-full);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    line-height: 1;
    font-variant-numeric: tabular-nums;
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

  /* SPECIFICITY: scoping through `.filter-drawer` is load-bearing. Dialog's
     `forwardBrandTokens` copies `data-org-brand` onto the portal container so
     the brand derivation engine works inside the dialog — which also
     re-activates org-brand.css's `[data-org-brand] :is(h1..h6) { color:
     var(--color-heading) }` at (0,1,1), beating a bare
     `:global(.filter-drawer__heading)` at (0,1,0). The result was that on
     EVERY branded org these quiet uppercase micro-labels computed to exactly
     the same colour as the dialog title, flattening the hierarchy — and it
     only showed up on branded orgs, so a default-theme review never saw it.

     COLOUR: `--color-text-secondary`, NOT `--color-text-tertiary`. Winning the
     cascade is the first time this rule's colour has ever applied on a branded
     org, and tertiary FAILS WCAG AA here. Under `[data-org-bg]` tertiary is
     `oklch(from var(--brand-bg) clamp(0.35, abs(0.5 - l) + 0.35, 0.6) 0 0)`,
     whose clamp SATURATES at L=0.6 — a flat mid-grey — for any light brand
     background, so it is ~3.5:1 on every light org regardless of palette.
     Measured on the composited glass panel at 13px/600 (which is NOT large
     text: that needs ≥18.66px bold or ≥24px, so 4.5:1 applies): 3.79–4.09:1
     with tertiary across of-blood-and-bones, studio-alpha and studio-beta in
     both themes — three of six combos below AA. `--color-text-secondary` is
     `color-mix(in oklab, var(--color-text) 62%, var(--color-background))`,
     deliberately measured in org-brand.css to clear AA at both ends of the
     brand range (7.56:1 worst light, 5.84:1 worst dark) — 6.38:1 against this
     panel's glass. The hierarchy separation from the 18px dialog title is
     carried by the 13px / uppercase / 0.08em treatment; it never needed the
     colour drop. Do not reach for `--color-text-tertiary` on body-sized text
     anywhere until that clamp ceiling is raised. */
  :global(.filter-drawer .filter-drawer__heading) {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
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
    width: var(--border-width-thick);
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
  /* The selected row's LABEL takes `--color-text`, not `--color-interactive`.
     Brand ink on a brand tint is a contrast pair with no inverting side — both
     derive from the same hue and lightness band — and it measured 3.81:1
     (studio-beta dark) to 4.71:1 (studio-beta light) at 15px/600: five of six
     org×theme combos below WCAG AA's 4.5:1. `--color-text` is the token that
     inverts with the surface, so it clears AA at both ends by construction.
     Brand identity is not lost: the tinted background, the `::before` brand rail
     and the brand-coloured check glyph all still carry it, and each of those is
     non-text (3:1 floor) rather than a 15px label (4.5:1). The semibold step
     also means selection is not signalled by colour alone. */
  :global(.filter-drawer__option.is-active) {
    color: var(--color-text);
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
    color: var(--color-link);
  }

  /* ── Pill grid ──────────────────────────────────────────────────── */
  :global(.filter-drawer__pills) {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  /* --space-11 (44px at density 1) is the WCAG 2.5.8 / platform minimum touch
     target, and it applies at every width — the option rows already use it, and
     pointer accuracy on a laptop trackpad is not meaningfully better than a
     thumb. Measured at 390 wide before this: pills 40px, Apply 40px, Clear
     37px. Because --space-* is density-scaled, a tighter brand density pushed
     them lower still. */
  :global(.filter-drawer__pill) {
    min-height: var(--space-11);
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
  /* --color-on-interactive, NOT --color-text-inverse: `inverse` flips with the
     THEME, `on-interactive` is derived from the `--color-interactive` fill this
     pill is painted with. In dark theme they diverge, so the active pill took
     near-black text while the Apply button beside it — same fill — took white.
     On a blue brand in dark theme that was near-black (#171717) on #2563EB at
     3.47:1, a WCAG AA fail. The hover fill takes its own ink for the same
     reason. */
  :global(.filter-drawer__pill.is-active) {
    color: var(--color-on-interactive);
    background: var(--color-interactive);
    border-color: var(--color-interactive);
  }
  :global(.filter-drawer__pill.is-active:hover) {
    color: var(--color-on-interactive-hover);
    background: var(--color-interactive-hover);
    border-color: var(--color-interactive-hover);
  }

  /* ── Footer ─────────────────────────────────────────────────────── */
  .filter-drawer__clear {
    display: inline-flex;
    align-items: center;
    min-height: var(--space-11);
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
    color: var(--color-link);
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
    min-height: var(--space-11);
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
    color: var(--color-on-interactive);
    box-shadow: var(--shadow-sm);
  }
  .filter-drawer__btn--primary:hover {
    background: var(--color-interactive-hover);
    color: var(--color-on-interactive-hover);
    box-shadow: var(--shadow-md);
  }
  .filter-drawer__btn:active {
    animation: filter-drawer-tap var(--duration-fast) var(--ease-out);
  }
  .filter-drawer__btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset, 1px);
  }

  @media (--below-sm) {
    .filter-drawer__btn--primary {
      min-width: var(--space-32);
      padding-inline: var(--space-6);
    }
  }
</style>

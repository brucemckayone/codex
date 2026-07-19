<!--
  @component BrandStudioRail

  The control rail — the left pane of `/studio/brand` and the spine of the
  difficulty dial (Codex-cijzb · WP-1.5). Replaces the WP-1.1 placeholder with a
  real grouped control surface driving the module-level `brandEditor` store.

  DATA FLOW (store → bridge → iframe, untouched by this WP): every control here
  is a REUSED brand-editor field component that writes the store's `pending`
  (setThemeColor / updateField / setThemeFont / setThemeTokenOverride). The
  route's `$effect` watches `brandEditor.pending` and hands each snapshot to the
  WP-1.4 postMessage sender, which live-updates the preview iframe. This rail
  never talks to the bridge — it only drives the store.

  REUSE: the OKLCH picker, FontPicker, sliders, logo + hero controls are the
  existing `$lib/components/brand-editor/**` level components, re-homed here
  unchanged. Only the NAVIGATION MODEL is new — three grouped, collapsible
  sections + search/jump/breadcrumb + change-ledger — replacing the retired
  12-level back-button stack.

  Groups:
    - Foundations → Colours (+ fine-tune) · Shape & density
    - Identity    → Typography (+ fine-tune) · Logo
    - Hero        → Layout & visibility · Effects

  Epic: Codex-cijzb · WP-1.5.
-->
<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import { Button } from '$lib/components/ui';
  import { SearchIcon, XIcon } from '$lib/components/ui/Icon';
  // Reused leaf/field components — re-homed unchanged from the retired overlay.
  import BrandEditorColors from '$lib/components/brand-editor/levels/BrandEditorColors.svelte';
  import BrandEditorFineTuneColors from '$lib/components/brand-editor/levels/BrandEditorFineTuneColors.svelte';
  import BrandEditorFineTuneTypography from '$lib/components/brand-editor/levels/BrandEditorFineTuneTypography.svelte';
  import BrandEditorHeaderLayout from '$lib/components/brand-editor/levels/BrandEditorHeaderLayout.svelte';
  import BrandEditorHeroEffects from '$lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte';
  import BrandEditorHeroText from '$lib/components/brand-editor/levels/BrandEditorHeroText.svelte';
  import BrandEditorLogo from '$lib/components/brand-editor/levels/BrandEditorLogo.svelte';
  import BrandEditorShape from '$lib/components/brand-editor/levels/BrandEditorShape.svelte';
  import BrandEditorTypography from '$lib/components/brand-editor/levels/BrandEditorTypography.svelte';
  import * as m from '$paraglide/messages';
  import ChangeLedger from './rail/ChangeLedger.svelte';
  import EditingThemeContrast from './rail/EditingThemeContrast.svelte';
  import RailControl from './rail/RailControl.svelte';
  import RailGroup from './rail/RailGroup.svelte';
  import {
    controlMatchesQuery,
    firstControlMatch,
    RAIL_GROUPS,
    type RailControlId,
    type RailControlMeta,
    type RailGroupId,
    type RailGroupMeta,
  } from './rail/rail-model';

  interface Props {
    /** True while a save is in flight — disables the Save button. */
    saving?: boolean;
    /** True when the store has unsaved edits — gates the Save/Reset buttons. */
    isDirty?: boolean;
    /** Persist the current brand-editor payload. Owned by the route. */
    onsave: () => void;
    /**
     * Current org name (hero <h1>). Seeds the WP-1.6 hero-text control. Optional
     * so the rail can still mount without org data (e.g. in unit tests).
     */
    orgName?: string;
    /** Current org description (hero subheading); null when unset. */
    orgDescription?: string | null;
    /**
     * Fired after a successful hero-text save. The route bumps the preview
     * reload token so the framed page re-renders with the new hero text (org
     * name/description are not brand tokens, so they can't ride the WP-1.4
     * colour bridge — a structural change needs a scoped reload).
     */
    onpreviewreload?: () => void;
  }

  const {
    saving = false,
    isDirty = false,
    onsave,
    orgName = '',
    orgDescription = null,
    onpreviewreload,
  }: Props = $props();

  // ── Navigation state ──────────────────────────────────────────────────────
  // Which groups are open (manual state); Foundations starts open. During an
  // active search this is overridden — groups with matches auto-expand.
  const expandedState = $state<Record<RailGroupId, boolean>>({
    foundations: true,
    identity: false,
    hero: false,
  });
  let activeGroup = $state<RailGroupId>('foundations');
  let query = $state('');
  let railEl = $state<HTMLElement | null>(null);

  const searching = $derived(query.trim() !== '');

  function groupHasMatch(group: RailGroupMeta): boolean {
    return group.controls.some((c) => controlMatchesQuery(c, query));
  }

  function isGroupExpanded(group: RailGroupMeta): boolean {
    // Search takes over: reveal exactly the groups that contain a match.
    if (searching) return groupHasMatch(group);
    return expandedState[group.id];
  }

  function isGroupHidden(group: RailGroupMeta): boolean {
    return searching && !groupHasMatch(group);
  }

  function isControlHidden(control: RailControlMeta): boolean {
    return searching && !controlMatchesQuery(control, query);
  }

  function toggleGroup(id: RailGroupId): void {
    expandedState[id] = !expandedState[id];
    activeGroup = id;
  }

  function scrollToControl(id: RailControlId): void {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(`rail-control-${id}`);
    if (!el) return;
    el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    // Move focus to the block for keyboard users; -1 keeps it out of Tab order.
    el.setAttribute('tabindex', '-1');
    (el as HTMLElement).focus?.();
  }

  /** Enter in the search box jumps to the first matching control. */
  function onSearchKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const match = firstControlMatch(query);
    if (!match) return;
    expandedState[match.groupId] = true;
    activeGroup = match.groupId;
    scrollToControl(match.control.id);
  }

  function clearSearch(): void {
    query = '';
  }

  /** Roving arrow-key navigation between the group header buttons. */
  function onGroupHeaderKeydown(event: KeyboardEvent): void {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key) || !railEl) return;
    const headers = Array.from(
      railEl.querySelectorAll<HTMLButtonElement>('[data-rail-group-header]')
    );
    if (headers.length === 0) return;
    const currentIndex = headers.findIndex(
      (h) => h === document.activeElement
    );
    event.preventDefault();
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowDown':
        nextIndex = (currentIndex + 1) % headers.length;
        break;
      case 'ArrowUp':
        nextIndex = (currentIndex - 1 + headers.length) % headers.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      default:
        nextIndex = headers.length - 1;
    }
    headers[nextIndex]?.focus();
  }

  function jumpToTop(): void {
    activeGroup = RAIL_GROUPS[0].id;
    clearSearch();
    railEl?.querySelector<HTMLElement>('[data-rail-group-header]')?.focus();
  }

  // ── Breadcrumb ──────────────────────────────────────────────────────────
  const activeGroupLabel = $derived(
    RAIL_GROUPS.find((g) => g.id === activeGroup)?.label ?? ''
  );
  // Surface an open fine-tune drill in the trail so the deep-tune context is
  // never a dead end (reuses the store's level for the local drill only).
  const drillLabel = $derived.by(() => {
    if (brandEditor.level === 'fine-tune-colors') return 'Fine-tune colours';
    if (brandEditor.level === 'fine-tune-typography') return 'Fine-tune type';
    return null;
  });
</script>

<div class="brand-rail" bind:this={railEl}>
  <header class="brand-rail__top">
    <div class="brand-rail__titles">
      <h1 class="brand-rail__title">{m.branding_title()}</h1>
      <p class="brand-rail__subtitle">{m.branding_description()}</p>
    </div>

    <nav class="brand-rail__breadcrumb" aria-label="Breadcrumb">
      <button type="button" class="brand-rail__crumb" onclick={jumpToTop}>
        Brand
      </button>
      <span class="brand-rail__crumb-sep" aria-hidden="true">›</span>
      <span class="brand-rail__crumb brand-rail__crumb--current" aria-current="page">
        {activeGroupLabel}
      </span>
      {#if drillLabel}
        <span class="brand-rail__crumb-sep" aria-hidden="true">›</span>
        <span class="brand-rail__crumb brand-rail__crumb--current">{drillLabel}</span>
      {/if}
    </nav>

    <div class="brand-rail__search">
      <span class="brand-rail__search-icon" aria-hidden="true">
        <SearchIcon size={16} />
      </span>
      <input
        class="brand-rail__search-input"
        type="search"
        placeholder="Search settings"
        aria-label="Search brand settings"
        bind:value={query}
        onkeydown={onSearchKeydown}
      />
      {#if searching}
        <button
          type="button"
          class="brand-rail__search-clear"
          aria-label="Clear search"
          onclick={clearSearch}
        >
          <XIcon size={14} />
        </button>
      {/if}
    </div>
  </header>

  <EditingThemeContrast />

  <div class="brand-rail__scroll">
    {#each RAIL_GROUPS as group (group.id)}
      <RailGroup
        {group}
        expanded={isGroupExpanded(group)}
        active={activeGroup === group.id}
        hidden={isGroupHidden(group)}
        ontoggle={() => toggleGroup(group.id)}
        onactivate={() => (activeGroup = group.id)}
        onheaderkeydown={onGroupHeaderKeydown}
      >
        {#each group.controls as c (c.id)}
          <RailControl control={c} hidden={isControlHidden(c)}>
            {@render controlBody(c.id)}
          </RailControl>
        {/each}
      </RailGroup>
    {/each}

    {#if searching && RAIL_GROUPS.every((g) => !groupHasMatch(g))}
      <p class="brand-rail__no-results">No settings match “{query.trim()}”.</p>
    {/if}
  </div>

  <footer class="brand-rail__footer">
    <ChangeLedger />
    <div class="brand-rail__actions">
      <Button
        variant="ghost"
        size="sm"
        onclick={() => brandEditor.discard()}
        disabled={!isDirty || saving}
      >
        Reset all
      </Button>
      <Button variant="primary" onclick={onsave} loading={saving} disabled={!isDirty}>
        {m.branding_save()}
      </Button>
    </div>
  </footer>
</div>

<!--
  Per-control body dispatch. Each arm renders a REUSED field component bound to
  the store; the Colours/Typography arms also render their fine-tune drill
  inline when the store's level is on that leaf (local progressive disclosure,
  not a global back-stack — the group is the primary nav).
-->
{#snippet controlBody(id: RailControlId)}
  {#if id === 'colours'}
    <BrandEditorColors />
    {#if brandEditor.level === 'fine-tune-colors'}
      <div class="brand-rail__drill">
        <button
          type="button"
          class="brand-rail__drill-back"
          onclick={() => brandEditor.navigateBack()}
        >
          ‹ Back to colours
        </button>
        <BrandEditorFineTuneColors />
      </div>
    {/if}
  {:else if id === 'shape'}
    <BrandEditorShape />
  {:else if id === 'typography'}
    <BrandEditorTypography />
    {#if brandEditor.level === 'fine-tune-typography'}
      <div class="brand-rail__drill">
        <button
          type="button"
          class="brand-rail__drill-back"
          onclick={() => brandEditor.navigateBack()}
        >
          ‹ Back to typography
        </button>
        <BrandEditorFineTuneTypography />
      </div>
    {/if}
  {:else if id === 'logo'}
    <BrandEditorLogo />
  {:else if id === 'hero-text'}
    <BrandEditorHeroText
      name={orgName}
      description={orgDescription}
      onsaved={onpreviewreload}
    />
  {:else if id === 'hero-layout'}
    <BrandEditorHeaderLayout />
  {:else if id === 'hero-effects'}
    <BrandEditorHeroEffects />
  {/if}
{/snippet}

<style>
  .brand-rail {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  /* ── Top: titles + breadcrumb + search ── */
  .brand-rail__top {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border-subtle);
  }

  .brand-rail__titles {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .brand-rail__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .brand-rail__subtitle {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .brand-rail__breadcrumb {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
  }

  .brand-rail__crumb {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }

  .brand-rail__crumb:not(.brand-rail__crumb--current):hover {
    color: var(--color-interactive);
    text-decoration: underline;
  }

  .brand-rail__crumb:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .brand-rail__crumb--current {
    color: var(--color-text);
    font-weight: var(--font-semibold);
    cursor: default;
  }

  .brand-rail__crumb-sep {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }

  .brand-rail__search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
  }

  .brand-rail__search:focus-within {
    border-color: var(--color-focus);
  }

  .brand-rail__search-icon {
    display: inline-flex;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .brand-rail__search-input {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    font-size: var(--text-sm);
    color: var(--color-text);
    outline: none;
  }

  .brand-rail__search-input::placeholder {
    color: var(--color-text-muted);
  }

  .brand-rail__search-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
  }

  .brand-rail__search-clear:hover {
    color: var(--color-text);
  }

  .brand-rail__search-clear:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  /* ── Scrollable groups ── */
  .brand-rail__scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .brand-rail__no-results {
    padding: var(--space-5) var(--space-4);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    text-align: center;
  }

  /* ── Fine-tune drill ── */
  .brand-rail__drill {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-2);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-secondary);
  }

  .brand-rail__drill-back {
    align-self: flex-start;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }

  .brand-rail__drill-back:hover {
    color: var(--color-interactive-hover);
  }

  .brand-rail__drill-back:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  /* ── Footer: change ledger + actions ── */
  .brand-rail__footer {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .brand-rail__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>

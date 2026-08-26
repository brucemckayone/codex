<!--
  @component BrandStudioRail

  The control rail — left pane of `/studio/brand` and the spine of the
  difficulty dial (Codex-cijzb · WP-1.5, reworked in the rail-UX overhaul).

  NAVIGATION MODEL — master/detail, NOT a stack of accordions. The rail is ever
  in one of two mutually-exclusive views:

    • BROWSE  (focusedId === null) — a short, scannable list of control rows
      grouped under Foundations / Identity / Hero, plus search. Pure navigation:
      no editing happens here, so it stays short and never competes for height.

    • FOCUS   (focusedId set) — the chosen control OWNS THE FULL RAIL HEIGHT.
      A slim back header, then the reused field component fills the remaining
      space and scrolls on its own. Editing context that only some controls
      need (the Light/Dark theme toggle + contrast readout) lives HERE, inside
      the colour focus, instead of eating ~200px on every screen.

  This replaces the previous "everything in one scroll" accordion rail, where
  persistent chrome + all groups + the inline picker shared a single scroll and
  the active control was always a cramped, shrinking sliver.

  DATA FLOW (unchanged): every control is a REUSED brand-editor field component
  that writes the store's `pending`. The route's `$effect` streams pending to
  the WP-1.4 preview bridge. This rail only drives navigation + the store; it
  never talks to the bridge.

  Epic: Codex-cijzb · WP-1.5 + rail-UX overhaul.
-->
<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import { Button } from '$lib/components/ui';
  import {
    ArrowLeftIcon,
    ChevronRightIcon,
    SearchIcon,
    XIcon,
  } from '$lib/components/ui/Icon';
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
  import {
    controlMatchesQuery,
    firstControlMatch,
    flattenControls,
    RAIL_GROUPS,
    type RailControlId,
    type RailControlMeta,
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
     * Current org name (hero <h1>). Seeds the hero-text control. Optional so the
     * rail can still mount without org data (e.g. in unit tests).
     */
    orgName?: string;
    /** Current org description (hero subheading); null when unset. */
    orgDescription?: string | null;
    /**
     * Fired after a successful hero-text save so the route can bump the preview
     * reload token (org name/description are not brand tokens).
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
  // focusedId === null → BROWSE; otherwise the FOCUS view for that control.
  let focusedId = $state<RailControlId | null>(null);
  let query = $state('');

  const searching = $derived(query.trim() !== '');

  const focusedControl = $derived<RailControlMeta | null>(
    focusedId ? (flattenControls().find((c) => c.id === focusedId) ?? null) : null
  );

  // The store's `level` still drives the fine-tune sub-drills. In the focus
  // model these REPLACE the base control body (full height), never stack under
  // it — so drilling deeper never shrinks the editing area.
  const inFineTune = $derived(
    brandEditor.level === 'fine-tune-colors' ||
      brandEditor.level === 'fine-tune-typography'
  );
  const fineTuneLabel = $derived.by(() => {
    if (brandEditor.level === 'fine-tune-colors') return 'Fine-tune colours';
    if (brandEditor.level === 'fine-tune-typography') return 'Fine-tune type';
    return null;
  });

  function openControl(id: RailControlId): void {
    focusedId = id;
    query = '';
  }

  function goBack(): void {
    // Back out of a fine-tune drill first, staying in the same focus; a second
    // Back returns to Browse. So Browse is only ever reached with the store at a
    // base level — the focus body's fine-tune guard can't fire unexpectedly.
    if (inFineTune) {
      brandEditor.navigateBack();
      return;
    }
    focusedId = null;
  }

  /** Enter in the search box opens the first matching control's focus. */
  function onSearchKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const match = firstControlMatch(query);
    if (match) openControl(match.control.id);
  }

  function clearSearch(): void {
    query = '';
  }

  /** The controls of a group that match the current query (all when inactive). */
  function visibleControls(group: RailGroupMeta): RailControlMeta[] {
    return group.controls.filter((c) => controlMatchesQuery(c, query));
  }

  const noMatches = $derived(
    searching && RAIL_GROUPS.every((g) => visibleControls(g).length === 0)
  );
</script>

<div class="brand-rail">
  {#if focusedControl}
    <!-- ── FOCUS: the active control owns the full height ── -->
    <header class="brand-rail__focus-head">
      <button type="button" class="brand-rail__back" onclick={goBack}>
        <ArrowLeftIcon size={16} />
        <span>{inFineTune ? focusedControl.label : 'All settings'}</span>
      </button>

      <div class="brand-rail__focus-title">
        <span class="brand-rail__focus-icon" aria-hidden="true">
          {focusedControl.icon}
        </span>
        <h2 class="brand-rail__focus-h">
          {fineTuneLabel ?? focusedControl.label}
        </h2>
      </div>

      {#if !inFineTune && focusedControl.affects.length > 0}
        <p class="brand-rail__affects">
          <span class="brand-rail__affects-label">Affects</span>
          {focusedControl.affects.join(' · ')}
        </p>
      {/if}
    </header>

    {#if focusedId === 'colours' && !inFineTune}
      <div class="brand-rail__context">
        <EditingThemeContrast />
      </div>
    {/if}

    <div class="brand-rail__focus-body">
      {@render controlBody(focusedControl.id)}
    </div>
  {:else}
    <!-- ── BROWSE: short, scannable navigation ── -->
    <header class="brand-rail__browse-head">
      <div class="brand-rail__titles">
        <h1 class="brand-rail__title">{m.branding_title()}</h1>
        <p class="brand-rail__subtitle">{m.branding_description()}</p>
      </div>

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

    <div class="brand-rail__browse">
      {#each RAIL_GROUPS as group (group.id)}
        {@const controls = visibleControls(group)}
        {#if controls.length > 0}
          <section class="brand-rail__group">
            <h2 class="brand-rail__group-label">
              <span class="brand-rail__group-icon" aria-hidden="true">
                {group.icon}
              </span>
              {group.label}
            </h2>
            <ul class="brand-rail__rows">
              {#each controls as control (control.id)}
                <li>
                  <button
                    type="button"
                    class="rail-row"
                    data-rail-control={control.id}
                    onclick={() => openControl(control.id)}
                  >
                    <span class="rail-row__icon" aria-hidden="true">
                      {control.icon}
                    </span>
                    <span class="rail-row__text">
                      <span class="rail-row__label">{control.label}</span>
                      {#if control.affects.length > 0}
                        <span class="rail-row__affects">
                          {control.affects.slice(0, 3).join(' · ')}
                        </span>
                      {/if}
                    </span>
                    <span class="rail-row__chevron" aria-hidden="true">
                      <ChevronRightIcon size={16} />
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      {/each}

      {#if noMatches}
        <p class="brand-rail__no-results">No settings match “{query.trim()}”.</p>
      {/if}
    </div>
  {/if}

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
  the store. The Colours/Typography arms swap to their fine-tune drill as a
  FULL-HEIGHT REPLACEMENT when the store's level is on that leaf (not a nested
  stack) — the focus header's Back handles returning to the base control.
-->
{#snippet controlBody(id: RailControlId)}
  {#if id === 'colours'}
    {#if brandEditor.level === 'fine-tune-colors'}
      <BrandEditorFineTuneColors />
    {:else}
      <BrandEditorColors />
    {/if}
  {:else if id === 'shape'}
    <BrandEditorShape />
  {:else if id === 'typography'}
    {#if brandEditor.level === 'fine-tune-typography'}
      <BrandEditorFineTuneTypography />
    {:else}
      <BrandEditorTypography />
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

  /* ── Shared head chrome (browse title + focus header) ── */
  .brand-rail__browse-head,
  .brand-rail__focus-head {
    display: flex;
    flex-direction: column;
    border-bottom: var(--border-width) var(--border-style)
      var(--color-border-subtle);
  }

  .brand-rail__browse-head {
    gap: var(--space-3);
    padding: var(--space-4);
  }

  /* Tighter than browse — the focus header is chrome above the editor, so it
     hands as much height as possible to the control body below. */
  .brand-rail__focus-head {
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
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

  /* ── Search (browse only) ── */
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

  /* ── Browse list ── */
  .brand-rail__browse {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .brand-rail__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .brand-rail__group-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .brand-rail__group-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-5);
    color: var(--color-text-secondary);
    flex-shrink: 0;
  }

  .brand-rail__rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .rail-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-3);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    transition: var(--transition-colors);
  }

  .rail-row:hover {
    background: var(--color-surface-secondary);
    border-color: var(--color-border);
  }

  .rail-row:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .rail-row__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-md);
    flex-shrink: 0;
  }

  .rail-row__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    flex: 1;
    min-width: 0;
  }

  .rail-row__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .rail-row__affects {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rail-row__chevron {
    display: inline-flex;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .brand-rail__no-results {
    padding: var(--space-5) var(--space-4);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    text-align: center;
  }

  /* ── Focus header ── */
  .brand-rail__back {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    align-self: flex-start;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .brand-rail__back:hover {
    color: var(--color-interactive);
  }

  .brand-rail__back:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .brand-rail__focus-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .brand-rail__focus-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-md);
    flex-shrink: 0;
  }

  .brand-rail__focus-h {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  /* Compact single muted line (not chunky chips) — the same reference info the
     browse row already hints at, kept out of the picker's way. */
  .brand-rail__affects {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-snug);
  }

  .brand-rail__affects-label {
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    margin-right: var(--space-1);
  }

  /* ── Focus context bar (colour focus only) ── */
  .brand-rail__context {
    flex-shrink: 0;
  }

  /* ── Focus body: the active control fills + scrolls on its own ── */
  .brand-rail__focus-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-4);
  }

  /* ── Footer: change ledger + actions (pinned) ── */
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

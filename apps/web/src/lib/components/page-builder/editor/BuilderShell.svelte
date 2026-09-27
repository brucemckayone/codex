<!--
  @component BuilderShell

  The editor's frame (contract §7): the top bar, then the side panel (whose
  tabs are Page · Style · Offer · Settings), the canvas, and — on the Page
  tab — the inspector. The canvas is visible in every tab.

  The canvas renders at true scale, so it cannot shrink to make room: when
  docking the inspector would leave the chosen device too little width, the
  inspector becomes a drawer over the canvas instead (`inspectorPlacement`).

  Editor chrome is STUDIO chrome: neutral tokens only. The page's brand is
  the canvas's business, never the frame's.
-->
<script lang="ts">
  import type { PageSection } from '@codex/shared-types';
  import { tick } from 'svelte';
  import PageMediaPanel from '$lib/components/page-builder/PageMediaPanel.svelte';
  import PagePricingPanel from '$lib/components/page-builder/PagePricingPanel.svelte';
  import PageSeoPanel from '$lib/components/page-builder/PageSeoPanel.svelte';
  import {
    ChevronLeftIcon,
    ChevronRightIcon,
    MoonIcon,
    SlidersIcon,
    SunIcon,
  } from '$lib/components/ui/Icon';
  import * as Tabs from '$lib/components/ui/Tabs';
  import {
    isSectionTypeId,
    resolveStyle,
    type SectionTypeId,
    STYLES,
  } from '$lib/page-builder/kit';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import { themeState } from '$lib/theme.svelte';
  import * as m from '$paraglide/messages';
  import type { BuilderSession } from './builder-session.svelte';
  import Canvas, { type CanvasNotice } from './Canvas.svelte';
  import EmptyPage from './EmptyPage.svelte';
  import {
    type Device,
    EDITOR_TABS,
    type EditorTab,
    inspectorPlacement,
    primaryAction,
    saveIndicator,
    statusChip,
  } from './editor-state';
  import Inspector from './Inspector.svelte';
  import { sectionLabel } from './outline';
  import SectionGallery from './SectionGallery.svelte';
  import SectionOutline from './SectionOutline.svelte';
  import type { SectionAction } from './SectionToolbar.svelte';
  import StylePanel from './StylePanel.svelte';
  import TopBar from './TopBar.svelte';
  import UndoToast from './UndoToast.svelte';

  interface Props {
    session: BuilderSession;
    orgDomain: string;
  }

  const { session, orgDomain }: Props = $props();

  /** The inspector's width, in rem — shared by the grid and the placement rule. */
  const INSPECTOR_REM = 20;

  const TAB_LABELS: Record<EditorTab, () => string> = {
    page: () => m.studio_page_editor_tab_page(),
    style: () => m.studio_page_editor_tab_style(),
    offer: () => m.studio_page_editor_tab_offer(),
    settings: () => m.studio_page_editor_tab_settings(),
  };

  let device = $state<Device>('desktop');
  let tab = $state<EditorTab>('page');
  let sideOpen = $state(true);
  let inspectorOpen = $state(true);
  let drawerOpen = $state(false);
  let previewTheme = $state<'light' | 'dark' | null>(null);
  let pickerOpen = $state(false);
  let pickerAfter = $state<string | null>(null);
  let pickerReturn: HTMLElement | null = null;
  let undo = $state<{
    message: string;
    signature: string;
    section: PageSection;
    index: number;
  } | null>(null);
  let shellWidth = $state(0);
  let sideWidth = $state(0);
  let canvas = $state<ReturnType<typeof Canvas>>();

  const remPx =
    typeof window === 'undefined'
      ? 16
      : Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

  const sections = $derived(pageBuilder.sections);
  const selectedId = $derived(pageBuilder.selectedSectionId);
  const pageStyle = $derived(resolveStyle(session.page?.design));
  const styleLabel = $derived(STYLES[pageStyle].label);
  const theme = $derived(previewTheme ?? themeState.theme);
  const placement = $derived(
    inspectorPlacement({
      shellWidth,
      outlineWidth: sideWidth,
      inspectorWidth: INSPECTOR_REM * remPx,
      device,
    })
  );
  const inspectorShown = $derived(
    tab === 'page' && (placement === 'docked' ? inspectorOpen : drawerOpen)
  );
  // A stale tab (another tab saved this page) must not put its older copy
  // live, so Publish and Publish changes are off until it reloads.
  const primary = $derived(
    primaryAction({
      status: session.status,
      hasUnpublishedChanges: session.hasUnpublishedChanges,
      busy: session.busy,
      ready: !session.stale,
    })
  );
  const notices = $derived.by<CanvasNotice[]>(() => {
    const shown: CanvasNotice[] = [];
    if (session.stale) {
      shown.push({
        id: 'stale',
        message: m.studio_page_editor_stale_banner(),
        action: {
          label: m.studio_page_editor_stale_reload(),
          run: () => session.reloadTab(),
        },
      });
    }
    if (session.contextError) {
      shown.push({
        id: 'context',
        message: m.studio_page_editor_context_failed(),
        action: {
          label: m.studio_page_editor_context_retry(),
          run: () => session.retryContext(),
        },
        onDismiss: () => session.dismissContextError(),
      });
    }
    return shown;
  });
  const counts = $derived(
    sections.reduce<Partial<Record<SectionTypeId, number>>>((all, s) => {
      if (isSectionTypeId(s.type)) all[s.type] = (all[s.type] ?? 0) + 1;
      return all;
    }, {})
  );
  const pickerAfterLabel = $derived.by(() => {
    const after = sections.find((s) => s.id === pickerAfter);
    return after ? sectionLabel(after) : null;
  });

  // The delete toast shows only while the sections are exactly as the delete
  // left them. Its Undo puts the section back itself rather than through the
  // store's history, which every save clears.
  const sectionsSignature = $derived(JSON.stringify(pageBuilder.pending?.sections));
  const undoMessage = $derived(
    undo && undo.signature === sectionsSignature ? undo.message : null
  );

  function reveal(id: string): void {
    if (!id) return;
    void tick().then(() => canvas?.scrollToSection(id));
  }

  function select(id: string | null): void {
    pageBuilder.selectSection(id);
  }

  function selectAndReveal(id: string): void {
    select(id);
    reveal(id);
  }

  function remove(id: string): void {
    const index = sections.findIndex((s) => s.id === id);
    if (index < 0) return;
    const section = $state.snapshot(sections[index]);
    pageBuilder.removeSection(id);
    undo = {
      message: m.studio_page_editor_deleted({ section: sectionLabel(section) }),
      signature: JSON.stringify(pageBuilder.pending?.sections),
      section,
      index,
    };
  }

  function restoreDeleted(): void {
    const deleted = undo;
    undo = null;
    if (!deleted) return;
    const next: PageSection[] = $state.snapshot(sections);
    next.splice(deleted.index, 0, deleted.section);
    pageBuilder.updateMeta('sections', next);
    selectAndReveal(deleted.section.id);
  }

  /** Past the next VISIBLE section: a hidden one is not on the canvas to pass. */
  function moveOnCanvas(id: string, step: -1 | 1): void {
    const from = sections.findIndex((s) => s.id === id);
    let to = from + step;
    while (to >= 0 && to < sections.length && sections[to].enabled === false) {
      to += step;
    }
    if (from < 0 || to < 0 || to >= sections.length) return;
    pageBuilder.moveSectionTo(id, to);
    reveal(id);
  }

  function onCanvasAction(action: SectionAction, id: string): void {
    if (action === 'up') moveOnCanvas(id, -1);
    else if (action === 'down') moveOnCanvas(id, 1);
    else if (action === 'duplicate') reveal(pageBuilder.duplicateSection(id));
    else if (action === 'hide') pageBuilder.toggleSection(id);
    else remove(id);
  }

  function openPicker(afterId: string | null): void {
    pickerReturn =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pickerAfter = afterId;
    pickerOpen = true;
  }

  function choose(type: SectionTypeId): void {
    reveal(session.insertSection(type, pickerAfter));
  }

  function commit(sectionId: string, key: string, value: string): void {
    pageBuilder.setSectionProp(sectionId, key, value.trim() ? value : undefined);
  }

  function toggleInspector(): void {
    if (placement === 'docked') inspectorOpen = !inspectorOpen;
    else drawerOpen = !drawerOpen;
  }

  async function onPrimary(): Promise<void> {
    const result =
      primary.kind === 'publish-changes'
        ? await session.publishChanges()
        : await session.publish();
    if (result.reveal) reveal(result.reveal);
  }

  function isTyping(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT')
    );
  }

  // History shortcuts skip text fields, where the browser's own per-field
  // undo is the right one. Esc closes the drawer, then deselects.
  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[role="dialog"], [role="menu"]')) {
      return;
    }
    if (isTyping(target)) return;
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && (key === 'z' || key === 'y')) {
      event.preventDefault();
      if (key === 'y' || event.shiftKey) pageBuilder.redo();
      else pageBuilder.undo();
      return;
    }
    if (event.key === 'Escape') {
      if (drawerOpen && placement === 'drawer') drawerOpen = false;
      else select(null);
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div
  class="shell"
  data-studio-fullbleed
  data-tab={tab}
  data-side={sideOpen ? 'open' : 'closed'}
  data-inspector={tab !== 'page' ? 'none' : placement}
  data-inspector-shown={inspectorShown ? '' : undefined}
  style:--_inspector="{INSPECTOR_REM}rem"
  bind:clientWidth={shellWidth}
>
  <TopBar
    title={pageBuilder.pending?.title ?? ''}
    chip={statusChip(session.status, session.hasUnpublishedChanges)}
    {device}
    canUndo={pageBuilder.canUndo}
    canRedo={pageBuilder.canRedo}
    save={saveIndicator({
      saveStatus: session.saveStatus,
      hasUnpublishedChanges: session.hasUnpublishedChanges,
    })}
    saveError={session.saveError}
    {primary}
    busy={session.busy}
    canUnpublish={session.status === 'published' && !session.stale}
    onTitle={(title) => pageBuilder.updateMeta('title', title)}
    onDevice={(next) => (device = next)}
    onUndo={() => pageBuilder.undo()}
    onRedo={() => pageBuilder.redo()}
    onRetry={() => session.retrySave()}
    onPreview={() => void session.preview()}
    {onPrimary}
    onUnpublish={() => void session.unpublish()}
  />

  <Tabs.Root bind:value={tab} defaultValue="page" class="shell__workspace">
    <aside class="shell__side" hidden={!sideOpen} bind:clientWidth={sideWidth}>
      <div class="shell__side-head">
        <Tabs.List class="shell__tabs" aria-label={m.studio_page_editor_tabs_label()}>
          {#each EDITOR_TABS as option (option)}
            <Tabs.Trigger value={option} class="shell__tab">{TAB_LABELS[option]()}</Tabs.Trigger>
          {/each}
        </Tabs.List>
      </div>
      <div class="shell__side-body">
        <Tabs.Content value="page">
          <SectionOutline
            {sections}
            {selectedId}
            onSelect={selectAndReveal}
            onToggle={(id) => pageBuilder.toggleSection(id)}
            onDuplicate={(id) => reveal(pageBuilder.duplicateSection(id))}
            onDelete={remove}
            onMove={(id, to) => {
              pageBuilder.moveSectionTo(id, to);
              reveal(id);
            }}
            onAdd={() => openPicker(sections.at(-1)?.id ?? null)}
          />
        </Tabs.Content>
        <Tabs.Content value="style">
          {#if session.page}
            <StylePanel
              page={session.page}
              context={session.context}
              brandOverrides={pageBuilder.pending?.brandOverrides ?? null}
              {theme}
            />
          {/if}
        </Tabs.Content>
        <Tabs.Content value="offer">
          <PagePricingPanel />
        </Tabs.Content>
        <Tabs.Content value="settings">
          <PageMediaPanel />
          <PageSeoPanel {orgDomain} />
        </Tabs.Content>
      </div>
    </aside>

    <div class="shell__stage">
      <div class="shell__canvas-bar">
        <button
          type="button"
          class="shell__bar-button"
          aria-pressed={sideOpen}
          onclick={() => (sideOpen = !sideOpen)}
        >
          {#if sideOpen}<ChevronLeftIcon size={16} />{:else}<ChevronRightIcon size={16} />{/if}
          {sideOpen ? m.studio_page_editor_panel_hide() : m.studio_page_editor_panel_show()}
        </button>
        <div class="shell__bar-end">
          <div class="shell__themes" role="group" aria-label={m.studio_page_editor_theme_label()}>
            <button
              type="button"
              class="shell__theme"
              aria-pressed={theme === 'light'}
              aria-label={m.studio_page_editor_theme_light()}
              title={m.studio_page_editor_theme_light()}
              onclick={() => (previewTheme = 'light')}
            >
              <SunIcon size={16} />
            </button>
            <button
              type="button"
              class="shell__theme"
              aria-pressed={theme === 'dark'}
              aria-label={m.studio_page_editor_theme_dark()}
              title={m.studio_page_editor_theme_dark()}
              onclick={() => (previewTheme = 'dark')}
            >
              <MoonIcon size={16} />
            </button>
          </div>
          {#if tab === 'page'}
            <button
              type="button"
              class="shell__bar-button"
              aria-pressed={inspectorShown}
              onclick={toggleInspector}
            >
              <SlidersIcon size={16} />
              {inspectorShown
                ? m.studio_page_editor_inspector_hide()
                : m.studio_page_editor_inspector_show()}
            </button>
          {/if}
        </div>
      </div>

      {#if session.page}
        <Canvas
          bind:this={canvas}
          page={session.page}
          context={session.context}
          brandOverrides={pageBuilder.pending?.brandOverrides ?? null}
          {device}
          {theme}
          {selectedId}
          onSelect={select}
          onCommit={commit}
          onInsert={openPicker}
          onAction={onCanvasAction}
          {notices}
        >
          {#snippet empty()}
            <EmptyPage
              mode={sections.length === 0 ? 'empty' : 'hidden'}
              {styleLabel}
              onTemplate={() => {
                session.startFromTemplate();
                reveal(pageBuilder.selectedSectionId ?? '');
              }}
              onAddHero={() => reveal(session.insertSection('hero', null))}
            />
          {/snippet}
        </Canvas>
      {/if}

      <UndoToast
        message={undoMessage}
        onUndo={restoreDeleted}
        onDismiss={() => (undo = null)}
      />
    </div>

    {#if tab === 'page'}
      <aside
        class="shell__inspector"
        aria-label={m.studio_page_editor_inspector_label()}
        hidden={!inspectorShown}
      >
        {#if session.page}
          <Inspector
            page={session.page}
            {selectedId}
            context={session.context}
            brandOverrides={pageBuilder.pending?.brandOverrides ?? null}
            {theme}
            onDuplicate={(id) => reveal(pageBuilder.duplicateSection(id))}
            onToggle={(id) => pageBuilder.toggleSection(id)}
            onDelete={remove}
            onChangeStyle={() => (tab = 'style')}
          />
        {/if}
      </aside>
    {/if}
  </Tabs.Root>

  <SectionGallery
    bind:open={pickerOpen}
    style={pageStyle}
    brandOverrides={pageBuilder.pending?.brandOverrides ?? null}
    {theme}
    afterLabel={pickerAfterLabel}
    {counts}
    onChoose={choose}
    returnFocus={() => pickerReturn}
  />
</div>

<style>
  .shell {
    --_side: 16rem;
    --_bar: var(--space-10);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    block-size: 100dvh;
    background: var(--color-background);
    color: var(--color-text);
    font-family: var(--font-sans);
  }

  .shell[data-tab='style'],
  .shell[data-tab='offer'],
  .shell[data-tab='settings'] {
    --_side: 23.75rem;
  }

  .shell[data-side='closed'] {
    --_side: 0rem;
  }

  .shell :global(.shell__workspace) {
    position: relative;
    display: grid;
    grid-template-columns: var(--_side) minmax(0, 1fr) 0;
    min-block-size: 0;
  }

  .shell[data-inspector='docked'][data-inspector-shown] :global(.shell__workspace) {
    grid-template-columns: var(--_side) minmax(0, 1fr) var(--_inspector);
  }

  .shell__side,
  .shell__inspector {
    min-block-size: 0;
    overflow-y: auto;
    background: var(--color-surface);
  }

  .shell__side {
    display: flex;
    flex-direction: column;
    border-inline-end: var(--border-width) var(--border-style) var(--color-border);
  }

  .shell__side-head {
    position: sticky;
    inset-block-start: 0;
    display: flex;
    align-items: center;
    padding: var(--space-2);
    border-block-end: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface);
  }

  .shell :global(.shell__tabs) {
    display: flex;
    flex: 1;
    gap: var(--space-0-5);
    min-inline-size: 0;
  }

  .shell :global(.shell__tab) {
    flex: 1 1 auto;
    padding: var(--space-1-5);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    white-space: nowrap;
    cursor: pointer;
  }

  .shell :global(.shell__tab:hover) {
    color: var(--color-text);
  }

  .shell :global(.shell__tab[data-state='active']) {
    background: color-mix(in oklab, var(--color-text) 9%, transparent);
    color: var(--color-text);
    font-weight: var(--font-medium);
  }

  .shell__side-body {
    flex: 1;
  }

  .shell__side-body :global(.tabs-content[hidden]) {
    display: none;
  }

  .shell__stage {
    position: relative;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-inline-size: 0;
    min-block-size: 0;
  }

  .shell__canvas-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    block-size: var(--_bar);
    padding-inline: var(--space-3);
    border-block-end: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface);
  }

  .shell__bar-end {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-inline-start: auto;
  }

  .shell__themes {
    display: flex;
    gap: var(--space-0-5);
    padding: var(--space-0-5);
    border-radius: var(--radius-md);
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
  }

  .shell__theme,
  .shell__bar-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1-5);
    min-block-size: var(--space-7);
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .shell__theme[aria-pressed='true'] {
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow: var(--shadow-xs);
  }

  .shell__bar-button:hover,
  .shell__theme:hover {
    color: var(--color-text);
  }

  .shell__bar-button[aria-pressed='true'] {
    color: var(--color-text);
  }

  .shell__inspector {
    border-inline-start: var(--border-width) var(--border-style) var(--color-border);
  }

  /* No room to dock: the inspector floats over the canvas's edge, below the
     canvas bar so the toggle that opened it can close it. */
  .shell[data-inspector='drawer'] .shell__inspector {
    position: absolute;
    inset-block: var(--_bar) 0;
    inset-inline-end: 0;
    inline-size: var(--_inspector);
    box-shadow: var(--shadow-xl);
  }

  .shell__theme:focus-visible,
  .shell__bar-button:focus-visible,
  .shell :global(.shell__tab:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }
</style>

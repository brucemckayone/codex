<!--
  @component Journey sales-page builder (route shell + state spine)

  The INLINE WYSIWYG journey/page builder (Codex-2pryk.3.3 · WP-5). A three-pane
  workspace faithful to the finished prototype (`docs/design/course-journeys/
  prototype/builder.html`): a top bar (device + Preview + Save), page-wide mode
  tabs (Design / Pricing / Brand / SEO), and — in Design mode — an outline rail, a
  live editable canvas, and a per-section inspector. The settings modes swap the
  outline+inspector for a single settings panel beside the canvas.

  It OWNS the `pageBuilder` store: open() on load → edit via rail/canvas → Save
  (saveJourneyPage + updateJourneyOffer + markSaved) → close() on destroy. Every
  control mutates the store; the canvas renders the store's pending draft directly,
  so edits are live.

  The remotes are REAL (`getJourneyForBuilder` / `saveJourneyPage` /
  `updateJourneyOffer` — no mocks). Save drives two endpoints because pricing is a
  separate resource from page copy; see `handleSave`. Admin/owner gate lives in
  +page.server.ts. Per-page brand overrides tint the canvas via the org brand OKLCH
  layer (`data-org-brand` + brand vars on the canvas wrapper).
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { beforeNavigate, invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import type { PageStatus } from '@codex/shared-types';
  import {
    JourneyBuilderCanvas,
    PageBrandPanel,
    PagePricingPanel,
    PageSeoPanel,
    SectionEditor,
    SectionList,
  } from '$lib/components/page-builder';
  import {
    getCourseCurriculum,
    getJourneyForBuilder,
    saveJourneyPage,
    updateJourneyOffer,
  } from '$lib/remote/journeys.remote';
  import { saveBuilderDraft } from '$lib/page-builder/builder-save';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import type { JourneyStagePreview } from '$lib/page-builder/render-edit';
  import { toast } from '$lib/components/ui/Toast/toast-store';

  const { data } = $props();

  const pageId = $derived(page.params.id ?? '');
  const orgName = $derived(data.org?.name ?? 'Studio');
  const orgDomain = $derived(data.org?.slug ?? 'your-space');

  // Load the page draft — the reactive query the conductor swaps for the real
  // remote after WP-2 (identical `.current` access).
  const draftQuery = $derived(pageId ? getJourneyForBuilder({ id: pageId }) : null);

  // Curriculum stages feed the map/descent section previews (course-owned). This
  // was a hardcoded `[]` awaiting "real curriculum wiring", which meant the map
  // showed ZERO stages in the builder while the public page rendered the real
  // ones — the builder looked broken next to its own live page. Now reads the same
  // admin curriculum the two-pane editor uses.
  //
  // `minutes` comes from the practice's linked media duration. It read a flat 0
  // while `EditorPracticeView` carried no duration, so the map's "≈ N min in all"
  // cue under-claimed every course; a written practice (or media with no probed
  // duration) still contributes 0, which is the honest answer for it.
  const curriculumQuery = $derived(
    pageId ? getCourseCurriculum({ pageId }) : null
  );

  const stages: JourneyStagePreview[] = $derived(
    (curriculumQuery?.current?.stages ?? []).map((stage) => ({
      name: stage.name,
      gloss: stage.gloss ?? '',
      lessons: stage.practices.map((practice) => ({
        title: practice.title,
        type: practice.contentType,
        minutes: Math.round((practice.durationSeconds ?? 0) / 60),
      })),
    }))
  );

  // ── Workspace view state ──────────────────────────────────────────────────
  type BuilderMode = 'design' | 'pricing' | 'brand' | 'seo';
  let mode = $state<BuilderMode>('design');
  let device = $state<'desktop' | 'tablet' | 'mobile'>('desktop');
  let railCollapsed = $state(false);
  let previewMode = $state(false);
  let saving = $state(false);

  const MODES: readonly { id: BuilderMode; label: string }[] = [
    { id: 'design', label: 'Design' },
    { id: 'pricing', label: 'Pricing' },
    { id: 'brand', label: 'Brand' },
    { id: 'seo', label: 'SEO' },
  ];
  const DEVICES: readonly { id: 'desktop' | 'tablet' | 'mobile'; label: string }[] = [
    { id: 'desktop', label: 'Desktop' },
    { id: 'tablet', label: 'Tablet' },
    { id: 'mobile', label: 'Mobile' },
  ];
  const STATUSES: readonly { id: PageStatus; label: string }[] = [
    { id: 'draft', label: 'Draft' },
    { id: 'published', label: 'Published' },
    { id: 'archived', label: 'Archived' },
  ];

  // Esc exits full-width preview; Cmd/Ctrl+Z undo (+Shift redo) walks the
  // section-model history — but only when NOT typing in a field, so native
  // per-field text undo still works while editing copy.
  function onWindowKeydown(event: KeyboardEvent): void {
    if (previewMode && event.key === 'Escape' && !event.defaultPrevented) {
      previewMode = false;
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    const target = event.target as HTMLElement | null;
    const editing =
      !!target &&
      (target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA');
    if (editing) return;
    const key = event.key.toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) pageBuilder.redo();
      else pageBuilder.undo();
    } else if (key === 'y') {
      event.preventDefault();
      pageBuilder.redo();
    }
  }

  // ── Own the store: open once the draft loads; close on destroy. ─────────────
  let opened = false;
  $effect(() => {
    const draft = draftQuery?.current;
    if (!pageId || !draft || opened) return;
    opened = true;
    // The record extends PageBuilderState with row identity; the store's spine is
    // the editable draft only (id/orgId/publishedAt live on the row).
    const { id: _id, organizationId: _org, publishedAt: _pub, ...editable } = draft;
    pageBuilder.open(pageId, editable);
  });

  onDestroy(() => pageBuilder.close());

  const pending = $derived(pageBuilder.pending);
  const selected = $derived(pageBuilder.selectedSection);
  const isDirty = $derived(pageBuilder.isDirty);
  const slug = $derived(pending?.slug ?? '');

  // Per-page brand overrides → tint the canvas via the org brand OKLCH layer.
  const brandStyle = $derived.by<string | undefined>(() => {
    const o = pending?.brandOverrides;
    if (!o) return undefined;
    const parts: string[] = [];
    if (o.primaryColor) parts.push(`--brand-color:${o.primaryColor}`);
    if (o.secondaryColor) parts.push(`--brand-secondary:${o.secondaryColor}`);
    if (o.accentColor) parts.push(`--brand-accent:${o.accentColor}`);
    if (o.backgroundColor) parts.push(`--brand-bg:${o.backgroundColor}`);
    const shader = o.tokenOverrides?.['--brand-shader-preset'];
    if (shader) parts.push(`--brand-shader-preset:${shader}`);
    return parts.length ? parts.join(';') : undefined;
  });

  /**
   * The page draft and the journey's OFFER are two resources with two endpoints —
   * page copy via `saveJourneyPage`, pricing via `updateJourneyOffer` (which also
   * writes the authoritative `courses.price_cents`). One Save button drives both so
   * the creator has one mental model. The orchestration lives in
   * `$lib/page-builder/builder-save` so it is unit-testable; this wrapper only
   * turns its explicit result into toasts.
   *
   * RETURNS whether the write landed (Codex-xzwl5). It used to swallow its own
   * errors and return normally, which made a failed save indistinguishable from a
   * successful one — `handlePublish` then reported "Page published" over content
   * that was never persisted, and `handleViewLive` opened a page showing stale
   * content. Every caller MUST gate on this boolean.
   */
  async function handleSave(): Promise<boolean> {
    const payload = pageBuilder.getSavePayload();
    const record = draftQuery?.current;
    // Nothing loaded ⇒ nothing to save. Reported as NOT saved so callers can
    // never treat "there was no draft" as "the draft was persisted".
    if (!payload || !record) {
      toast.error('The page draft is still loading — try again in a moment');
      return false;
    }
    saving = true;
    try {
      const result = await saveBuilderDraft({
        pageId: record.id,
        payload,
        savedOffer: pageBuilder.saved?.offer,
        savePage: saveJourneyPage,
        saveOffer: updateJourneyOffer,
        markSaved: () => pageBuilder.markSaved(),
        // The PUBLIC sales load `depends('cache:versions')` precisely so a save
        // can mark it stale; without this the client reuses its cached load data
        // and the live page keeps showing pre-save content until a hard reload.
        refresh: () => invalidate('cache:versions'),
      });

      if (result.outcome === 'failed') {
        toast.error(result.message);
        return false;
      }
      if (result.staleWarning) {
        toast.warning(result.staleWarning);
        return true;
      }
      toast.success('Page saved');
      return true;
    } finally {
      saving = false;
    }
  }

  /**
   * Open the REAL public sales page in a new tab — the only surface that renders
   * the cinematic motion (the canvas mounts the static editable components; see
   * the toolbar comment). Saves first when dirty, and ABORTS when that save fails
   * (Codex-xzwl5): opening the live page after a failed save showed stale content
   * next to a builder showing the new content — an intermittent builder-vs-live
   * discrepancy the creator has no way to explain. The save's own toast already
   * says what went wrong.
   */
  async function handleViewLive(): Promise<void> {
    if (pageBuilder.isDirty && !(await handleSave())) return;
    if (!slug) {
      toast.error('Give the page a slug and save it before viewing live');
      return;
    }
    window.open(`/journeys/${slug}`, '_blank', 'noopener');
  }

  /**
   * Publish = flip the status and save. The success toast fires ONLY when the
   * write landed; on failure the status is rolled back to what it was so the
   * builder does not sit there claiming "Published" over an unpublished page.
   */
  async function handlePublish(): Promise<void> {
    const previousStatus = pageBuilder.pending?.status;
    pageBuilder.updateMeta('status', 'published');
    if (!(await handleSave())) {
      if (previousStatus) pageBuilder.updateMeta('status', previousStatus);
      return;
    }
    toast.success('Page published');
  }

  beforeNavigate(({ cancel }) => {
    if (pageBuilder.isDirty && !confirm('You have unsaved page changes. Discard?')) {
      cancel();
    }
  });
</script>

<svelte:head>
  <title>Page builder | {orgName}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<svelte:window onkeydown={onWindowKeydown} />

{#if pageBuilder.isOpen && pending}
  <div
    class="jb"
    data-mode={mode}
    class:jb--preview={previewMode}
    class:jb--rail-collapsed={railCollapsed}
  >
    <!-- ── top bar ── -->
    <header class="jb__top">
      <span class="jb__doc">
        Journey ·
        <input
          class="jb__doc-title"
          value={pending.title}
          oninput={(e) => pageBuilder.updateMeta('title', e.currentTarget.value)}
          aria-label="Page title"
        />
      </span>
      <select
        class="jb__status"
        value={pending.status}
        onchange={(e) => pageBuilder.updateMeta('status', e.currentTarget.value as PageStatus)}
        aria-label="Page status"
      >
        {#each STATUSES as s (s.id)}
          <option value={s.id}>{s.label}</option>
        {/each}
      </select>

      <nav class="jb__art" aria-label="Journey artifacts">
        <a href="/studio/journeys/{pageId}/curriculum">Curriculum</a>
        <span class="jb__art-on" aria-current="page">Sales page</span>
      </nav>

      <div class="jb__seg" role="group" aria-label="Device">
        {#each DEVICES as d (d.id)}
          <button type="button" aria-pressed={device === d.id} onclick={() => (device = d.id)}>
            {d.label}
          </button>
        {/each}
      </div>

      <div class="jb__history" role="group" aria-label="History">
        <button
          type="button"
          class="jb__icon-btn"
          title="Undo (⌘Z)"
          aria-label="Undo"
          disabled={!pageBuilder.canUndo}
          onclick={() => pageBuilder.undo()}
        >↶</button>
        <button
          type="button"
          class="jb__icon-btn"
          title="Redo (⌘⇧Z)"
          aria-label="Redo"
          disabled={!pageBuilder.canRedo}
          onclick={() => pageBuilder.redo()}
        >↷</button>
      </div>

      <!--
        "Full width" only hides the editor rails — the canvas still renders the
        EDITABLE section components (`render-edit/`), which are deliberately static
        so click-to-edit stays reliable. The cinematic motion (pinned ache, kinetic
        hero, scroll reveals) lives in the PUBLIC renderer (`render/`), so seeing it
        means opening the real page — hence the separate "View live" below.
      -->
      <button
        type="button"
        class="jb__btn"
        class:jb__btn--on={previewMode}
        title="Hide the editor rails (still the editable canvas, not the animated page)"
        onclick={() => (previewMode = !previewMode)}
      >
        {previewMode ? 'Editing' : 'Full width'}
      </button>
      <button
        type="button"
        class="jb__btn"
        title="Open the real sales page in a new tab — full animations, saves first"
        disabled={saving}
        onclick={handleViewLive}
      >
        View live ↗
      </button>
      <button type="button" class="jb__btn" disabled={!isDirty || saving} onclick={handleSave}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        class="jb__btn jb__btn--primary"
        disabled={saving}
        onclick={handlePublish}
      >
        {saving ? 'Publishing…' : 'Publish'}
      </button>
    </header>

    <!-- ── mode tabs ── -->
    <nav class="jb__modes" aria-label="Builder mode">
      {#each MODES as m (m.id)}
        <button type="button" aria-pressed={mode === m.id} onclick={() => (mode = m.id)}>
          {m.label}
        </button>
      {/each}
    </nav>

    <!-- ── shell ── -->
    <div class="jb__shell">
      {#if mode === 'design'}
        <aside class="jb__outline">
          <SectionList />
        </aside>
      {:else}
        <aside class="jb__settings">
          {#if mode === 'pricing'}
            <PagePricingPanel />
          {:else if mode === 'brand'}
            <PageBrandPanel />
          {:else}
            <PageSeoPanel {orgDomain} />
          {/if}
        </aside>
      {/if}

      <!--
        Per-page brand vars flow into the canvas; the `.jp` page self-derives its
        surface + text ladder from them (see journey-sections.css), so the sales
        page tints without re-theming the studio chrome around it.
      -->
      <section class="jb__canvas" style={brandStyle}>
        <JourneyBuilderCanvas
          editable={!previewMode}
          {device}
          {railCollapsed}
          onToggleRail={() => (railCollapsed = !railCollapsed)}
          {slug}
          {orgDomain}
          {stages}
        />
      </section>

      {#if mode === 'design'}
        <aside class="jb__inspector">
          {#if selected}
            <SectionEditor section={selected} />
          {:else}
            <p class="jb__inspector-empty">Select a section to edit its content and layout.</p>
          {/if}
        </aside>
      {/if}
    </div>
  </div>
{:else}
  <div class="jb-loading" aria-busy="true"><p>Loading page…</p></div>
{/if}

<style>
  .jb {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    height: 100dvh;
    background-color: var(--color-background);
  }

  /* ── top bar ── */
  .jb__top {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--space-4);
    height: var(--space-12);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-surface);
  }

  .jb__doc {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .jb__doc-title {
    border: 0;
    background: none;
    color: var(--color-text);
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    min-width: 8rem;
    padding: var(--space-1);
    border-radius: var(--radius-sm);
  }

  .jb__doc-title:hover {
    background-color: var(--color-surface-secondary);
  }

  .jb__doc-title:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .jb__status {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
  }

  .jb__art {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-1);
    border-radius: var(--radius-full);
    background-color: var(--color-surface-secondary);
  }

  .jb__art a,
  .jb__art-on {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    text-decoration: none;
  }

  .jb__art a:hover {
    color: var(--color-text);
  }

  .jb__art-on {
    background-color: var(--color-surface);
    color: var(--color-text);
  }

  .jb__seg {
    display: flex;
    gap: var(--space-1);
    margin-left: auto;
    padding: var(--space-1);
    border-radius: var(--radius-full);
    background-color: var(--color-surface-secondary);
  }

  .jb__seg button {
    padding: var(--space-1) var(--space-3);
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .jb__seg button[aria-pressed='true'] {
    background-color: var(--color-text);
    color: var(--color-background);
  }

  .jb__btn {
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .jb__btn:hover:not(:disabled) {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .jb__btn:disabled {
    opacity: var(--opacity-40, 0.4);
    cursor: not-allowed;
  }

  .jb__btn--on {
    color: var(--color-text);
    border-color: var(--color-interactive);
    background-color: color-mix(in oklab, var(--color-interactive) 12%, transparent);
  }

  .jb__btn--primary {
    border-color: transparent;
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand, var(--color-background));
    font-weight: var(--font-semibold);
  }

  .jb__btn--primary:hover:not(:disabled) {
    background-color: var(--color-interactive-hover);
  }

  .jb__history {
    display: flex;
    gap: var(--space-0-5);
  }

  .jb__icon-btn {
    display: grid;
    place-items: center;
    width: var(--space-8);
    height: var(--space-8);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    font-size: var(--text-base);
    line-height: 1;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .jb__icon-btn:hover:not(:disabled) {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .jb__icon-btn:disabled {
    opacity: var(--opacity-40, 0.4);
    cursor: not-allowed;
  }

  .jb__icon-btn:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .jb__btn:focus-visible,
  .jb__seg button:focus-visible,
  .jb__modes button:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  /* ── mode tabs ── */
  .jb__modes {
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
    height: var(--space-11, 2.75rem);
    padding: 0 var(--space-3);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-surface);
  }

  .jb__modes button {
    padding: 0 var(--space-4);
    border: 0;
    border-bottom: var(--border-width-thick) var(--border-style) transparent;
    background: none;
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .jb__modes button:hover {
    color: var(--color-text);
  }

  .jb__modes button[aria-pressed='true'] {
    color: var(--color-text);
    border-bottom-color: var(--color-interactive);
  }

  /* ── shell grid ── */
  .jb__shell {
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr) 360px;
    min-height: 0;
  }

  .jb[data-mode='pricing'] .jb__shell,
  .jb[data-mode='brand'] .jb__shell,
  .jb[data-mode='seo'] .jb__shell {
    grid-template-columns: 380px minmax(0, 1fr);
  }

  .jb--rail-collapsed[data-mode='design'] .jb__shell {
    grid-template-columns: 0 minmax(0, 1fr) 360px;
  }

  .jb--preview .jb__shell {
    grid-template-columns: minmax(0, 1fr);
  }

  .jb__outline,
  .jb__settings,
  .jb__inspector {
    min-height: 0;
    overflow-y: auto;
    background-color: var(--color-surface);
  }

  .jb__outline,
  .jb__settings {
    border-right: var(--border-width) var(--border-style) var(--color-border);
  }

  .jb__inspector {
    border-left: var(--border-width) var(--border-style) var(--color-border);
  }

  .jb--rail-collapsed[data-mode='design'] .jb__outline,
  .jb--preview .jb__outline,
  .jb--preview .jb__settings,
  .jb--preview .jb__inspector {
    display: none;
  }

  .jb__inspector-empty {
    padding: var(--space-6) var(--space-4);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    line-height: var(--leading-normal);
  }

  .jb__canvas {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .jb-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100dvh;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  @media (--below-lg) {
    .jb__shell,
    .jb[data-mode='pricing'] .jb__shell,
    .jb[data-mode='brand'] .jb__shell,
    .jb[data-mode='seo'] .jb__shell {
      grid-template-columns: minmax(0, 1fr);
    }

    .jb__outline,
    .jb__settings,
    .jb__inspector {
      display: none;
    }
  }
</style>

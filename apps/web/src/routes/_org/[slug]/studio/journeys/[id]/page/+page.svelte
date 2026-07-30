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
  `updateJourneyOffer` / `updateCourseMonetisation` — no mocks). Save drives four
  endpoints because the page copy, the course's plan + tier access, the page's
  offer row and the sell media are four separate resources; see `handleSave`
  and `$lib/page-builder/builder-save`. Admin/owner gate lives in
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
    PageMediaPanel,
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
  import {
    remoteErrorMessage,
    saveBuilderDraft,
  } from '$lib/page-builder/builder-save';
  import { monetisation } from '$lib/page-builder/monetisation-store.svelte';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import { sellMedia } from '$lib/page-builder/sell-media-store.svelte';
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

  // Curriculum and Insights are both COURSE artifacts — each resolves this page
  // to its subject course server-side — so the artifact switch only offers them
  // for a course journey. The Curriculum tab was ungated, which pointed a
  // non-course journey at a guaranteed 404.
  const isCourse = $derived(draftQuery?.current?.subjectType === 'course');

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
  type BuilderMode = 'design' | 'pricing' | 'media' | 'brand' | 'seo';
  let mode = $state<BuilderMode>('design');
  let device = $state<'desktop' | 'tablet' | 'mobile'>('desktop');
  let railCollapsed = $state(false);
  let previewMode = $state(false);
  let saving = $state(false);

  const MODES: readonly { id: BuilderMode; label: string }[] = [
    { id: 'design', label: 'Design' },
    { id: 'pricing', label: 'Pricing' },
    { id: 'media', label: 'Media' },
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
    // Sell media + cover live on the SUBJECT COURSE, not the page row, so they
    // load from their own endpoint alongside the draft (Codex-eqh0z). Fire-and-
    // forget: `open()` already fails soft per-read, and a media-library hiccup
    // must not stop the creator editing copy.
    void sellMedia.open(pageId);
    // The subscription plan + tier-access set live on the SUBJECT COURSE too, and
    // their baseline is read back from the tables that actually gate access
    // (Codex-2pryk.2.4.2) — never from the page's `offer` bag. A page with no
    // subject course has nothing to monetise, so it opens with `null`.
    void monetisation.open(
      draft.subjectType === 'course' ? draft.subjectId : null
    );
  });

  onDestroy(() => {
    pageBuilder.close();
    sellMedia.close();
    monetisation.close();
  });

  const pending = $derived(pageBuilder.pending);
  const selected = $derived(pageBuilder.selectedSection);
  // Media and monetisation are part of "unsaved work" too — otherwise picking a
  // clip or a tier and navigating away would lose it with no warning, and Save
  // would appear to have nothing to do.
  const isDirty = $derived(
    pageBuilder.isDirty || sellMedia.isDirty || monetisation.isDirty
  );
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
   * The page draft, the course's MONETISATION and the journey's OFFER are separate
   * resources with separate endpoints — page copy via `saveJourneyPage`, the
   * subscription plan + tier access via `updateCourseMonetisation`, and the offer
   * row via `updateJourneyOffer` (which also writes the authoritative
   * `courses.price_cents`). One Save button drives all of them so the creator has
   * one mental model. The orchestration lives in
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
        // The two course-owned ways in (subscription plan + tier access). This
        // leg runs BEFORE the offer leg because it is the one that talks to
        // Stripe, and the offer bag's tier/subscription fields are DERIVED from
        // what it persisted — so a refused plan never leaves the sales page
        // advertising a subscription with no Stripe Product behind it.
        monetisation: {
          isDirty: monetisation.isDirty,
          save: () => monetisation.save(),
          presentation: () => monetisation.presentationOffer,
        },
        // Fold the persisted bag back into the draft so the saved baseline carries
        // the derived fields; without it every save would re-send the offer write.
        syncOffer: (offer) => pageBuilder.updateOffer(offer),
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

      // Sell media is a THIRD resource (it writes `courses.*MediaId`, not the page
      // row) and only sends when a slot actually changed. Same partial-success
      // discipline as pricing: on refusal, say what DID save and report NOT saved
      // so `handlePublish`/`handleViewLive` do not proceed on a half-written page.
      // A foreign media id lands here as a 403 carrying the service's own message.
      //
      // `markSaved()` and the `cache:versions` invalidation already happened inside
      // `saveBuilderDraft`, so they are deliberately NOT repeated here. That does
      // not lose the retry: `sellMedia` owns its own `isDirty`, independent of the
      // page-builder draft state, so a failed media write stays dirty and re-sends
      // on the next save.
      if (sellMedia.isDirty) {
        try {
          await sellMedia.save();
        } catch (err) {
          const why = remoteErrorMessage(err);
          toast.error(
            why
              ? `Page saved, but the media was not: ${why}`
              : 'Page saved, but the media could not be saved.'
          );
          return false;
        }
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
      <!--
        Brand home link (prototype builder.html:203). The builder is a
        full-bleed surface, so this is the only way back out of it besides the
        icon rail. It targets the Portals index — the list the builder was
        opened from, matching the prototype's own `href` — rather than /studio,
        so it reads as "up one level" from the page you are editing.
      -->
      <a class="jb__brand" href="/studio/journeys" title="All portals">
        Studio<span aria-hidden="true">.</span>
      </a>
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
        {#if isCourse}
          <a href="/studio/journeys/{pageId}/curriculum">Curriculum</a>
          <a href="/studio/journeys/{pageId}/insights">Insights</a>
        {/if}
        <span class="jb__art-on" aria-current="page">Sales page</span>
      </nav>

      <!--
        The device switch, history and the four actions share one wrapper so the
        whole right-hand cluster wraps to a second line AS A UNIT and stays
        right-aligned. Wrapped individually, Save/Publish stranded themselves
        bottom-left while the rest of the row stayed put.
      -->
      <div class="jb__actions">
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
      </div>
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
          {:else if mode === 'media'}
            <PageMediaPanel />
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
  /*
    `minmax(0, 1fr)` on the implicit column is load-bearing: the default `auto`
    track is sized to its item's max-content, so the top bar's min-content width
    would push the whole workspace wider than the viewport and give the page a
    horizontal scrollbar. Capping the track lets the bar wrap instead.
  */
  .jb {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr);
    height: 100dvh;
    background-color: var(--color-background);
  }

  /*
    ── top bar ──
    Nine controls, so the row is allowed to wrap onto a second line rather than
    overflow: below roughly 1330px of bar width the right-hand cluster drops
    whole (its `margin-left: auto` keeps it right-aligned on the new line). The
    height is a MIN, not a fixed value — a fixed height is what clipped the
    wrapped action labels before. With one line the bar is still 48px tall.
  */
  .jb__top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    align-content: center;
    gap: var(--space-1) var(--space-3);
    padding: var(--space-1) var(--space-4);
    min-height: var(--space-12);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-surface);
  }

  /*
    The identity block is the ONLY negotiable item in the bar. Every sibling is
    `flex: none` (below), so when the row runs short the title yields instead of
    the whole row squashing — which is what used to clip the action labels.
  */
  /*
    Brand wordmark / home link. The prototype tinted the period with a fixed
    studio gold (`--st-gold: #cdb489`); we have no such token and every brand
    colour here is org-overridable, so the period takes `--color-brand-primary`
    and the mark tints per org rather than pinning one org's palette into the
    studio chrome.

    Sized with `--text-sm` to sit level with `.jb__doc` next to it — the
    prototype's .82rem-vs-.8rem split is finer than one step of our type scale,
    so matching its neighbour is the honest translation. Focus ring comes from
    the global `:focus-visible` in base.css; hover underlines rather than
    changing colour, because the mark is already at full `--color-text` and the
    bar's dim→prominent hover convention (`.jb__art a`) has nowhere to go from
    there.

    DON'T "fix" the weight: `--font-bold` resolves to the ORG's heading weight,
    not 700, because org-brand.css re-declares
    `[data-org-brand] { --font-bold: var(--heading-weight, 700) }`. On this org
    it computes to 400 — the brand heading font is Archivo Black, a single-weight
    display face, and 700 would make the browser synthesise a smeared fake bold.
    The mark reads heavy because the FACE is heavy (`--font-heading`, the same
    token `.jb__doc-title` beside it uses), not because of the weight axis. An
    org with a multi-weight heading font gets a real 700 here.
  */
  .jb__brand {
    flex: none;
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: var(--font-bold);
    color: var(--color-text);
    text-decoration: none;
    white-space: nowrap;
  }

  .jb__brand span {
    color: var(--color-brand-primary);
  }

  .jb__brand:hover {
    text-decoration: underline;
  }

  .jb__doc {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex: 0 1 auto;
    min-width: 0;
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
    flex: 0 1 auto;
    min-width: var(--space-32);
    padding: var(--space-1);
    border-radius: var(--radius-sm);
    text-overflow: ellipsis;
  }

  .jb__doc-title:hover {
    background-color: var(--color-surface-secondary);
  }

  .jb__doc-title:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  /*
    `width: max-content` is load-bearing. A bare <select> resolves `width: auto`
    to fill-available (measured: 1800px basis for 100px of content), and since
    every flex child defaults to `flex-shrink: 1` the algorithm handed this
    control ~565px of a 1688px bar while clipping the buttons. Sizing it to its
    own content — and taking it out of the negotiation — is the actual fix.
  */
  .jb__status {
    flex: none;
    width: max-content;
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
    flex: none;
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
    white-space: nowrap;
  }

  .jb__art a:hover {
    color: var(--color-text);
  }

  .jb__art-on {
    background-color: var(--color-surface);
    color: var(--color-text);
  }

  /*
    The right-hand cluster. `margin-left: auto` lives HERE rather than on
    `.jb__seg` so that when the bar wraps, the whole group moves to the new line
    together and `justify-content: flex-end` keeps it right-aligned. It wraps
    internally too, so it degrades to any width without overflowing.
  */
  .jb__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1) var(--space-3);
    margin-left: auto;
    min-width: 0;
  }

  .jb__seg {
    display: flex;
    flex: none;
    gap: var(--space-1);
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
    white-space: nowrap;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .jb__seg button[aria-pressed='true'] {
    background-color: var(--color-text);
    color: var(--color-background);
  }

  .jb__btn {
    flex: none;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    white-space: nowrap;
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
    flex: none;
    gap: var(--space-0-5);
  }

  .jb__icon-btn {
    display: grid;
    flex: none;
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

<!--
  @component Journey curriculum editor (Codex-2pryk · Codex-03cwh · WP-5)

  The course-editor surface (prototype: course-editor.html): a TWO-PANE editor —
  left, the curriculum tree (ordered stages, each holding an ordered practice
  pool); right, an INSPECTOR for the selected stage or practice. A "practice" is
  a JOIN to an existing content row (`stage_practices.contentId`), NOT free text,
  so practices are added via a content-library PICKER ("Choose from your
  library"), never a title box.

  Client-only (studio `ssr = false`); admin/owner gate in +page.server.ts. Reads
  the REAL curriculum via `getCourseCurriculum` and persists via
  `saveCourseCurriculum` (bulk diff + reconcile in one worker transaction). Local
  edits are optimistic; Save swaps them for the authoritative server payload
  (which carries server ids for newly-added stages).
-->
<script lang="ts">
  import { page } from '$app/state';
  import type { CurriculumContentOption, EditorCurriculum, JourneyContentType } from '$lib/page-builder';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import * as Dialog from '$lib/components/ui/Dialog';
  import {
    ChevronUpIcon,
    ChevronDownIcon,
    FileTextIcon,
    MusicIcon,
    PlusIcon,
    SearchIcon,
    TrashIcon,
    VideoIcon,
  } from '$lib/components/ui/Icon';
  import {
    getCourseCurriculum,
    listCurriculumContentOptions,
    saveCourseCurriculum,
  } from '$lib/remote/journeys.remote';

  const { data } = $props();

  const pageId = $derived(page.params.id ?? '');

  // ── Local editable model ────────────────────────────────────────────────────
  // `key` is a client-only identity for `{#each}` + selection (stable across
  // edits); `id` is the persisted stage id (null for a stage not yet saved).
  interface LocalPractice {
    key: string;
    contentId: string;
    title: string;
    contentType: JourneyContentType;
    status: string;
    thumbnailUrl: string | null;
  }
  interface LocalStage {
    key: string;
    id: string | null;
    name: string;
    gloss: string;
    practices: LocalPractice[];
  }

  function uid(): string {
    return crypto.randomUUID();
  }

  const curriculumQuery = $derived(getCourseCurriculum({ pageId }));

  let stages = $state<LocalStage[]>([]);
  let loadedForPage = $state<string | null>(null);
  let dirty = $state(false);
  let saving = $state(false);
  // Selection: a stage (practiceKey null) or a practice within it.
  let sel = $state<{ stageKey: string; practiceKey: string | null } | null>(null);

  const seeded = $derived(loadedForPage === pageId);

  function seed(curr: EditorCurriculum): void {
    stages = curr.stages.map((s) => ({
      key: uid(),
      id: s.id,
      name: s.name,
      gloss: s.gloss ?? '',
      practices: s.practices.map((p) => ({
        key: uid(),
        contentId: p.contentId,
        title: p.title,
        contentType: p.contentType,
        status: p.status,
        thumbnailUrl: p.thumbnailUrl,
      })),
    }));
    dirty = false;
    sel = null;
  }

  // Seed local state once per page from the loaded curriculum. A later refresh
  // (e.g. post-save) does NOT reseed here — Save reseeds explicitly — so live
  // edits are never clobbered; navigating to another journey reseeds.
  $effect(() => {
    const curr = curriculumQuery.current;
    if (curr && loadedForPage !== pageId) {
      seed(curr);
      loadedForPage = pageId;
    }
  });

  function markDirty(): void {
    dirty = true;
  }

  const practiceCount = $derived(stages.reduce((n, s) => n + s.practices.length, 0));
  // Every stage needs a name and every practice its content — the save schema
  // enforces this too, but a client guard keeps Save honest + explains why.
  const invalid = $derived(stages.some((s) => !s.name.trim()));

  const selStage = $derived(sel ? (stages.find((s) => s.key === sel.stageKey) ?? null) : null);
  const selPractice = $derived(
    sel?.practiceKey && selStage
      ? (selStage.practices.find((p) => p.key === sel.practiceKey) ?? null)
      : null
  );

  function typeIcon(t: JourneyContentType) {
    return t === 'audio' ? MusicIcon : t === 'written' ? FileTextIcon : VideoIcon;
  }

  // ── Stage mutations ─────────────────────────────────────────────────────────
  function addStage(): void {
    const stage: LocalStage = { key: uid(), id: null, name: '', gloss: '', practices: [] };
    stages.push(stage);
    sel = { stageKey: stage.key, practiceKey: null };
    markDirty();
  }
  function removeStage(key: string): void {
    stages = stages.filter((s) => s.key !== key);
    if (sel?.stageKey === key) sel = null;
    markDirty();
  }
  function moveStage(key: string, dir: -1 | 1): void {
    const i = stages.findIndex((s) => s.key === key);
    const target = i + dir;
    if (i < 0 || target < 0 || target >= stages.length) return;
    [stages[i], stages[target]] = [stages[target], stages[i]];
    markDirty();
  }

  // ── Practice mutations ───────────────────────────────────────────────────────
  function removePractice(stage: LocalStage, key: string): void {
    stage.practices = stage.practices.filter((p) => p.key !== key);
    if (sel?.practiceKey === key) sel = { stageKey: stage.key, practiceKey: null };
    markDirty();
  }
  function movePractice(stage: LocalStage, key: string, dir: -1 | 1): void {
    const i = stage.practices.findIndex((p) => p.key === key);
    const target = i + dir;
    if (i < 0 || target < 0 || target >= stage.practices.length) return;
    [stage.practices[i], stage.practices[target]] = [
      stage.practices[target],
      stage.practices[i],
    ];
    markDirty();
  }
  function movePracticeToStage(practice: LocalPractice, destStageKey: string): void {
    if (!selStage || destStageKey === selStage.key) return;
    const dest = stages.find((s) => s.key === destStageKey);
    if (!dest) return;
    // A content id can't appear twice in the destination stage (join PK).
    if (dest.practices.some((p) => p.contentId === practice.contentId)) {
      toast.error('That practice is already in the destination stage');
      return;
    }
    selStage.practices = selStage.practices.filter((p) => p.key !== practice.key);
    dest.practices.push(practice);
    sel = { stageKey: dest.key, practiceKey: practice.key };
    markDirty();
  }

  // ── Content picker ───────────────────────────────────────────────────────────
  let pickerOpen = $state(false);
  let pickerStageKey = $state<string | null>(null);
  let pickerReplaceKey = $state<string | null>(null);
  let pickerSearch = $state('');
  let pickerType = $state<'' | JourneyContentType>('');

  const pickerQuery = $derived(pickerOpen ? listCurriculumContentOptions({}) : null);
  const pickerLoading = $derived(pickerQuery?.loading ?? false);
  const pickerTargetStage = $derived(
    pickerStageKey ? (stages.find((s) => s.key === pickerStageKey) ?? null) : null
  );
  const pickerOptions = $derived.by<CurriculumContentOption[]>(() => {
    const all = pickerQuery?.current ?? [];
    const q = pickerSearch.trim().toLowerCase();
    return all.filter(
      (o) =>
        (!pickerType || o.contentType === pickerType) &&
        (!q || o.title.toLowerCase().includes(q))
    );
  });

  function openAddPractice(stageKey: string): void {
    pickerStageKey = stageKey;
    pickerReplaceKey = null;
    pickerSearch = '';
    pickerType = '';
    pickerOpen = true;
  }
  function openReplacePractice(stageKey: string, practiceKey: string): void {
    pickerStageKey = stageKey;
    pickerReplaceKey = practiceKey;
    pickerSearch = '';
    pickerType = '';
    pickerOpen = true;
  }

  function isAlreadyInStage(contentId: string): boolean {
    const stage = pickerTargetStage;
    if (!stage) return false;
    // When replacing, the practice being replaced doesn't count against itself.
    return stage.practices.some(
      (p) => p.contentId === contentId && p.key !== pickerReplaceKey
    );
  }

  function pickContent(opt: CurriculumContentOption): void {
    const stage = pickerTargetStage;
    if (!stage || isAlreadyInStage(opt.contentId)) return;

    if (pickerReplaceKey) {
      const practice = stage.practices.find((p) => p.key === pickerReplaceKey);
      if (practice) {
        practice.contentId = opt.contentId;
        practice.title = opt.title;
        practice.contentType = opt.contentType;
        practice.status = opt.status;
        practice.thumbnailUrl = opt.thumbnailUrl;
        sel = { stageKey: stage.key, practiceKey: practice.key };
      }
    } else {
      const practice: LocalPractice = {
        key: uid(),
        contentId: opt.contentId,
        title: opt.title,
        contentType: opt.contentType,
        status: opt.status,
        thumbnailUrl: opt.thumbnailUrl,
      };
      stage.practices.push(practice);
      sel = { stageKey: stage.key, practiceKey: practice.key };
    }
    markDirty();
    pickerOpen = false;
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave(): Promise<void> {
    if (invalid) {
      toast.error('Every stage needs a name before you can save');
      return;
    }
    saving = true;
    try {
      const result = await saveCourseCurriculum({
        pageId,
        stages: stages.map((s) => ({
          id: s.id,
          name: s.name.trim(),
          gloss: s.gloss.trim() ? s.gloss.trim() : null,
          practices: s.practices.map((p) => ({ contentId: p.contentId })),
        })),
      });
      seed(result);
      loadedForPage = pageId;
      await curriculumQuery.refresh?.();
      toast.success('Curriculum saved');
    } catch {
      toast.error('Could not save the curriculum — please try again');
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>Curriculum | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="ce">
  <header class="ce__head">
    <nav class="ce__crumbs" aria-label="Breadcrumb">
      <a href="/studio/journeys">Portals</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">Curriculum</span>
    </nav>
    <div class="ce__head-row">
      <div>
        <h1 class="ce__title">Curriculum</h1>
        <p class="ce__count">
          {stages.length} {stages.length === 1 ? 'stage' : 'stages'} · {practiceCount}
          {practiceCount === 1 ? 'practice' : 'practices'}
        </p>
      </div>
      <div class="ce__head-actions">
        <a href="/studio/journeys/{pageId}/page" class="ce__link">Edit sales page</a>
        <button
          type="button"
          class="ce__save"
          disabled={!dirty || saving || invalid}
          onclick={handleSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  </header>

  {#if !seeded && curriculumQuery.loading}
    <div class="ce__loading" aria-hidden="true">
      <div class="ce__skeleton"></div>
      <div class="ce__skeleton"></div>
      <div class="ce__skeleton"></div>
    </div>
  {:else if curriculumQuery.error}
    <p class="ce__error" role="alert">
      This curriculum could not be loaded. It may not exist, or you may not have access.
    </p>
  {:else}
    <div class="ce__shell">
      <!-- ── Structure column ── -->
      <section class="ce__struct" aria-label="Curriculum structure">
        {#if stages.length === 0}
          <p class="ce__empty-tree">
            No stages yet. A stage is a chapter of the journey — add one, then fill it
            with practices from your library.
          </p>
        {/if}

        <ol class="ce__stages" role="list">
          {#each stages as stage, si (stage.key)}
            {@const isStageSel = sel?.stageKey === stage.key && sel?.practiceKey === null}
            <li class="stage" class:stage--sel={isStageSel}>
              <div class="stage__head">
                <div class="reorder">
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label="Move stage up"
                    disabled={si === 0}
                    onclick={() => moveStage(stage.key, -1)}
                  >
                    <ChevronUpIcon size={15} />
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label="Move stage down"
                    disabled={si === stages.length - 1}
                    onclick={() => moveStage(stage.key, 1)}
                  >
                    <ChevronDownIcon size={15} />
                  </button>
                </div>
                <button
                  type="button"
                  class="stage__select"
                  aria-pressed={isStageSel}
                  onclick={() => (sel = { stageKey: stage.key, practiceKey: null })}
                >
                  <span class="stage__ordinal">{(si + 1).toString().padStart(2, '0')}</span>
                  <span class="stage__label">
                    <span class="stage__name-text">{stage.name || 'Untitled stage'}</span>
                    {#if stage.gloss}<span class="stage__gloss-text">{stage.gloss}</span>{/if}
                  </span>
                  <span class="stage__ct">
                    {stage.practices.length}
                    {stage.practices.length === 1 ? 'practice' : 'practices'}
                  </span>
                </button>
              </div>

              <ul class="stage__practices" role="list">
                {#each stage.practices as practice, pi (practice.key)}
                  {@const isPracticeSel = sel?.practiceKey === practice.key}
                  {@const Glyph = typeIcon(practice.contentType)}
                  <li class="prow" class:prow--sel={isPracticeSel}>
                    <div class="reorder">
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label="Move practice up"
                        disabled={pi === 0}
                        onclick={() => movePractice(stage, practice.key, -1)}
                      >
                        <ChevronUpIcon size={13} />
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label="Move practice down"
                        disabled={pi === stage.practices.length - 1}
                        onclick={() => movePractice(stage, practice.key, 1)}
                      >
                        <ChevronDownIcon size={13} />
                      </button>
                    </div>
                    <button
                      type="button"
                      class="prow__select"
                      aria-pressed={isPracticeSel}
                      onclick={() =>
                        (sel = { stageKey: stage.key, practiceKey: practice.key })}
                    >
                      <span class="prow__glyph"><Glyph size={15} /></span>
                      <span class="prow__title">{practice.title}</span>
                      {#if practice.status !== 'published'}
                        <span class="prow__badge">{practice.status}</span>
                      {/if}
                    </button>
                    <button
                      type="button"
                      class="icon-btn icon-btn--danger"
                      aria-label="Remove practice"
                      onclick={() => removePractice(stage, practice.key)}
                    >
                      <TrashIcon size={14} />
                    </button>
                  </li>
                {/each}

                <li>
                  <button
                    type="button"
                    class="add-practice"
                    onclick={() => openAddPractice(stage.key)}
                  >
                    <PlusIcon size={13} />
                    Add a practice
                  </button>
                </li>
              </ul>

              {#if si < stages.length - 1}
                {@const next = stages[si + 1]}
                <div class="gate" aria-hidden="true">
                  <span class="gate__line"></span>
                  <span class="gate__txt">
                    the gate — {next?.name || 'the next stage'} opens once
                    {stage.name || 'this stage'} settles
                  </span>
                </div>
              {/if}
            </li>
          {/each}
        </ol>

        <button type="button" class="add-stage" onclick={addStage}>
          <PlusIcon size={16} />
          Add a stage
        </button>
      </section>

      <!-- ── Inspector column ── -->
      <aside class="ce__insp" aria-label="Inspector">
        {#if selPractice && selStage}
          {@const Glyph = typeIcon(selPractice.contentType)}
          <div class="insp__head">
            <div class="insp__t">{selPractice.title}</div>
            <div class="insp__s">Practice · {selPractice.contentType}</div>
          </div>
          <div class="insp__body">
            <p class="insp__group">Content</p>
            <div class="media-slot">
              <span class="media-slot__th">
                {#if selPractice.thumbnailUrl}
                  <img src={selPractice.thumbnailUrl} alt="" />
                {:else}
                  <Glyph size={18} />
                {/if}
              </span>
              <span class="media-slot__nm">
                {selPractice.title}
                <small>
                  linked content{selPractice.status !== 'published'
                    ? ` · ${selPractice.status}`
                    : ''}
                </small>
              </span>
              <button
                type="button"
                class="media-slot__act"
                onclick={() => openReplacePractice(selStage.key, selPractice.key)}
              >
                Choose…
              </button>
            </div>

            <p class="insp__hint">
              A practice points at one piece of content. Pick from your library — the
              same item can appear in more than one journey.
            </p>

            {#if stages.length > 1}
              <p class="insp__group">Stage</p>
              <div class="fld">
                <select
                  aria-label="Move this practice to another stage"
                  value={selStage.key}
                  onchange={(e) =>
                    movePracticeToStage(selPractice, e.currentTarget.value)}
                >
                  {#each stages as s (s.key)}
                    <option value={s.key}>{s.name || 'Untitled stage'}</option>
                  {/each}
                </select>
                <p class="fld__hint">Move this practice to another stage.</p>
              </div>
            {/if}

            <div class="insp__foot">
              <button
                type="button"
                class="btn-danger"
                onclick={() => removePractice(selStage, selPractice.key)}
              >
                Remove practice
              </button>
            </div>
          </div>
        {:else if selStage}
          <div class="insp__head">
            <div class="insp__t">{selStage.name || 'Untitled stage'}</div>
            <div class="insp__s">Stage</div>
          </div>
          <div class="insp__body">
            <div class="fld">
              <label for="stage-name">Stage name</label>
              <input
                id="stage-name"
                type="text"
                placeholder="e.g. Arriving"
                bind:value={selStage.name}
                oninput={markDirty}
              />
            </div>
            <div class="fld">
              <label for="stage-gloss">Felt meaning</label>
              <textarea
                id="stage-gloss"
                placeholder="The one line a member reads at the top of the stage…"
                bind:value={selStage.gloss}
                oninput={markDirty}
              ></textarea>
              <p class="fld__hint">What this part of the work is <em>for</em>.</p>
            </div>
            <p class="insp__callout">
              <b>The gate.</b> This stage's practices are a free pool — members move
              among them in any order.
              {#if stages.findIndex((s) => s.key === selStage.key) < stages.length - 1}
                The next stage opens once this one has been sat with.
              {:else}
                This is the final stage.
              {/if}
            </p>
            <div class="insp__foot">
              <button
                type="button"
                class="btn"
                onclick={() => openAddPractice(selStage.key)}
              >
                <PlusIcon size={13} /> Add practice
              </button>
              <button
                type="button"
                class="btn-danger"
                onclick={() => removeStage(selStage.key)}
              >
                Remove stage
              </button>
            </div>
          </div>
        {:else}
          <div class="insp__head">
            <div class="insp__t">Nothing selected</div>
            <div class="insp__s">Pick a stage or practice</div>
          </div>
          <div class="insp__body">
            <p class="insp__empty">
              Select a practice to see its content, or a stage to name it and write its
              felt meaning.
            </p>
          </div>
        {/if}
      </aside>
    </div>
  {/if}
</div>

<!-- ── Content-library picker ── -->
<Dialog.Root bind:open={pickerOpen}>
  <Dialog.Content size="md" class="picker">
    <Dialog.Header>
      <Dialog.Title>Choose from your library</Dialog.Title>
    </Dialog.Header>
    <div class="picker__controls">
      <div class="picker__search">
        <SearchIcon size={16} />
        <input
          type="search"
          placeholder="Search your content…"
          bind:value={pickerSearch}
          aria-label="Search your content"
        />
      </div>
      <div class="picker__types" role="group" aria-label="Filter by type">
        {#each [{ id: '', label: 'All' }, { id: 'video', label: 'Video' }, { id: 'audio', label: 'Audio' }, { id: 'written', label: 'Written' }] as t (t.id)}
          <button
            type="button"
            class="picker__type"
            aria-pressed={pickerType === t.id}
            onclick={() => (pickerType = t.id as '' | JourneyContentType)}
          >
            {t.label}
          </button>
        {/each}
      </div>
    </div>
    <Dialog.Body>
      {#if pickerLoading}
        <p class="picker__state">Loading your library…</p>
      {:else if pickerOptions.length === 0}
        <p class="picker__state">
          No content matches. Publish or upload content, then link it here.
        </p>
      {:else}
        <ul class="picker__list" role="list">
          {#each pickerOptions as opt (opt.contentId)}
            {@const Glyph = typeIcon(opt.contentType)}
            {@const added = isAlreadyInStage(opt.contentId)}
            <li>
              <button
                type="button"
                class="picker__opt"
                disabled={added}
                onclick={() => pickContent(opt)}
              >
                <span class="picker__glyph"><Glyph size={16} /></span>
                <span class="picker__opt-main">
                  <span class="picker__opt-title">{opt.title}</span>
                  <span class="picker__opt-meta">
                    {opt.contentType}{opt.status !== 'published' ? ` · ${opt.status}` : ''}
                  </span>
                </span>
                {#if added}<span class="picker__added">Added</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </Dialog.Body>
  </Dialog.Content>
</Dialog.Root>

<style>
  .ce {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    width: 100%;
    max-width: var(--container-studio);
  }

  /* ── Header ── */
  .ce__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-bottom: var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }
  .ce__crumbs {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
  .ce__crumbs a {
    color: var(--color-text-secondary);
    text-decoration: none;
  }
  .ce__crumbs a:hover {
    color: var(--color-text);
  }
  .ce__head-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .ce__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }
  .ce__count {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
  .ce__head-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .ce__link {
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-decoration: none;
    transition: var(--transition-colors);
  }
  .ce__link:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }
  .ce__save {
    padding: var(--space-2) var(--space-4);
    border: var(--border-width) var(--border-style) transparent;
    border-radius: var(--radius-md);
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand, var(--color-background));
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: var(--transition-colors);
  }
  .ce__save:hover:not(:disabled) {
    background-color: var(--color-interactive-hover);
  }
  .ce__save:disabled {
    opacity: var(--opacity-40);
    cursor: not-allowed;
  }

  /* ── Loading / error ── */
  .ce__loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .ce__skeleton {
    height: var(--space-16, 4rem);
    border-radius: var(--radius-lg);
    background-image: linear-gradient(
      100deg,
      var(--color-surface-secondary) 30%,
      var(--color-surface) 50%,
      var(--color-surface-secondary) 70%
    );
    background-size: 200% 100%;
    animation: ce-shimmer var(--duration-slower) var(--ease-default) infinite;
  }
  @keyframes ce-shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ce__skeleton {
      animation: none;
    }
  }
  .ce__error {
    padding: var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  /* ── Two-pane shell ── */
  .ce__shell {
    display: grid;
    grid-template-columns: 1fr minmax(300px, 360px);
    gap: var(--space-5);
    align-items: start;
  }
  @media (max-width: 900px) {
    .ce__shell {
      grid-template-columns: 1fr;
    }
  }

  .ce__struct {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .ce__empty-tree {
    margin: 0 0 var(--space-2);
    padding: var(--space-4);
    border: var(--border-width) dashed var(--color-border);
    border-radius: var(--radius-lg);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
  .ce__stages {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* ── Stage card ── */
  .stage {
    display: flex;
    flex-direction: column;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    overflow: hidden;
  }
  .stage--sel {
    border-color: var(--color-interactive);
  }
  .stage__head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }
  .stage__select {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-1);
    border: 0;
    border-radius: var(--radius-md);
    background: none;
    cursor: pointer;
    text-align: left;
    color: inherit;
  }
  .stage__select:hover {
    background-color: var(--color-surface-secondary);
  }
  .stage__ordinal {
    flex: none;
    font-family: var(--font-mono, monospace);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
  }
  .stage__label {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }
  .stage__name-text {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stage__gloss-text {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stage__ct {
    flex: none;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .stage__practices {
    list-style: none;
    margin: 0;
    padding: 0 var(--space-3) var(--space-3) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .prow {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) transparent;
  }
  .prow--sel {
    border-color: var(--color-interactive);
    background-color: color-mix(in oklch, var(--color-interactive) 9%, transparent);
  }
  .prow__select {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-2);
    border: 0;
    background: none;
    cursor: pointer;
    text-align: left;
    color: inherit;
    border-radius: var(--radius-md);
  }
  .prow__select:hover {
    background-color: var(--color-surface-secondary);
  }
  .prow__glyph {
    flex: none;
    display: inline-flex;
    color: var(--color-text-secondary);
  }
  .prow__title {
    flex: 1;
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .prow__badge {
    flex: none;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--text-2xs, 0.6875rem);
    font-weight: var(--font-medium);
    text-transform: capitalize;
    background-color: var(--color-surface-secondary);
    color: var(--color-text-muted);
  }

  .add-practice {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1-5) var(--space-2);
    border: var(--border-width) dashed var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }
  .add-practice:hover {
    color: var(--color-text);
    border-color: var(--color-interactive);
  }

  .gate {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3) var(--space-2) var(--space-6);
    font-size: var(--text-xs);
    font-style: italic;
    color: var(--color-text-muted);
  }
  .gate__line {
    flex: none;
    width: var(--border-width-thick, 2px);
    height: var(--space-4);
    background-color: var(--color-border);
  }

  .add-stage {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border: var(--border-width) dashed var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }
  .add-stage:hover {
    color: var(--color-text);
    border-color: var(--color-interactive);
  }

  /* ── Inspector ── */
  .ce__insp {
    position: sticky;
    top: var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    overflow: hidden;
  }
  @media (max-width: 900px) {
    .ce__insp {
      position: static;
    }
  }
  .insp__head {
    padding: var(--space-3) var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }
  .insp__t {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .insp__s {
    margin-top: var(--space-0-5);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-transform: capitalize;
  }
  .insp__body {
    padding: var(--space-4);
  }
  .insp__group {
    margin: 0 0 var(--space-2);
    font-size: var(--text-2xs, 0.6875rem);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }
  .insp__group:not(:first-child) {
    margin-top: var(--space-5);
  }
  .insp__hint,
  .fld__hint {
    margin: var(--space-2) 0 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-normal, 1.5);
  }
  .insp__empty {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    line-height: var(--leading-normal, 1.5);
  }
  .insp__callout {
    margin: var(--space-4) 0 0;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal, 1.5);
  }
  .insp__foot {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-5);
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .media-slot {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
  }
  .media-slot__th {
    flex: none;
    width: var(--space-12, 3rem);
    height: var(--space-8, 2rem);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-secondary);
    display: grid;
    place-items: center;
    color: var(--color-text-muted);
    overflow: hidden;
  }
  .media-slot__th img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .media-slot__nm {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    font-size: var(--text-sm);
    color: var(--color-text);
    overflow: hidden;
  }
  .media-slot__nm small {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-transform: capitalize;
  }
  .media-slot__act {
    flex: none;
    padding: var(--space-1-5) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }
  .media-slot__act:hover {
    color: var(--color-text);
    border-color: var(--color-interactive);
  }

  .fld {
    margin-bottom: var(--space-4);
  }
  .fld label {
    display: block;
    margin-bottom: var(--space-1-5);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .fld input,
  .fld textarea,
  .fld select {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    transition: var(--transition-colors);
  }
  .fld textarea {
    resize: vertical;
    min-height: var(--space-16, 4rem);
    line-height: var(--leading-normal, 1.5);
  }
  .fld input:focus-visible,
  .fld textarea:focus-visible,
  .fld select:focus-visible {
    outline: none;
    border-color: var(--color-interactive);
    box-shadow: var(--shadow-focus-ring);
  }

  .btn,
  .btn-danger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1-5) var(--space-3);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    background: none;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }
  .btn {
    color: var(--color-text-secondary);
  }
  .btn:hover {
    color: var(--color-text);
    border-color: var(--color-interactive);
  }
  .btn-danger {
    color: var(--color-danger, var(--color-text-secondary));
  }
  .btn-danger:hover {
    background-color: color-mix(in oklch, var(--color-danger, red) 10%, transparent);
    border-color: var(--color-danger, var(--color-border));
  }

  /* ── Shared icon button ── */
  .reorder {
    display: flex;
    flex-direction: column;
    flex: none;
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-5);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: var(--transition-colors);
  }
  .icon-btn:hover:not(:disabled) {
    color: var(--color-text);
    background-color: color-mix(in oklch, var(--color-interactive) 12%, transparent);
  }
  .icon-btn--danger {
    flex: none;
    width: var(--space-7, 1.75rem);
    height: var(--space-7, 1.75rem);
  }
  .icon-btn--danger:hover:not(:disabled) {
    color: var(--color-danger, var(--color-text));
    background-color: color-mix(in oklch, var(--color-danger, red) 12%, transparent);
  }
  .icon-btn:disabled {
    opacity: var(--opacity-40);
    cursor: not-allowed;
  }
  .icon-btn:focus-visible,
  .stage__select:focus-visible,
  .prow__select:focus-visible,
  .add-practice:focus-visible,
  .add-stage:focus-visible,
  .media-slot__act:focus-visible,
  .btn:focus-visible,
  .btn-danger:focus-visible,
  .ce__save:focus-visible,
  .ce__link:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  /* ── Picker dialog ── */
  .picker__controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 var(--space-5) var(--space-3);
  }
  .picker__search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-muted);
  }
  .picker__search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
  }
  .picker__search input:focus-visible {
    outline: none;
  }
  .picker__types {
    display: flex;
    gap: var(--space-1);
  }
  .picker__type {
    padding: var(--space-1) var(--space-3);
    border: 0;
    border-radius: var(--radius-full);
    background-color: var(--color-surface-secondary);
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }
  .picker__type[aria-pressed='true'] {
    background-color: var(--color-text);
    color: var(--color-background);
  }
  .picker__type:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }
  .picker__state {
    padding: var(--space-6) var(--space-2);
    text-align: center;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
  .picker__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .picker__opt {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) transparent;
    border-radius: var(--radius-md);
    background: none;
    cursor: pointer;
    text-align: left;
    color: inherit;
    transition: var(--transition-colors);
  }
  .picker__opt:hover:not(:disabled) {
    background-color: var(--color-surface-secondary);
  }
  .picker__opt:disabled {
    opacity: var(--opacity-60, 0.6);
    cursor: not-allowed;
  }
  .picker__opt:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }
  .picker__glyph {
    flex: none;
    display: inline-flex;
    color: var(--color-text-secondary);
  }
  .picker__opt-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }
  .picker__opt-title {
    font-size: var(--text-sm);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .picker__opt-meta {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-transform: capitalize;
  }
  .picker__added {
    flex: none;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }
</style>

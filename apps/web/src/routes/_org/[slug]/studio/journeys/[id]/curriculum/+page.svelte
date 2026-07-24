<!--
  @component Journey curriculum editor (Codex-2pryk.3.3 · WP-5)

  The course-editor surface: stages, each holding an ordered list of practices
  (FRONTEND-MAP §5.3 item 6 — net-new). Add / rename / reorder / remove stages
  and practices, then Save. Client-only (studio `ssr = false`); admin/owner gate
  in +page.server.ts.

  AGGRESSIVE-MODE MOCKS: the curriculum is not covered by a frozen read-model
  (the frozen queries are the public/member/library/list/builder reads), so this
  seeds local state and mocks Save. INTEGRATION SEAM: WP-1 backs stages/practices
  and WP-5 BE adds a getCourseCurriculum query + stage/practice CRUD commands —
  swap the seed + `handleSave` for those. Local edits mirror the shapes of the
  frozen `JourneyStageView` / `JourneyPracticeView`.
-->
<script lang="ts">
  import { page } from '$app/state';
  import type { JourneyContentType } from '$lib/page-builder';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import {
    ChevronUpIcon,
    ChevronDownIcon,
    PlusIcon,
    TrashIcon,
  } from '$lib/components/ui/Icon';

  const { data } = $props();

  const pageId = $derived(page.params.id ?? '');

  interface EditorPractice {
    id: string;
    title: string;
    contentType: JourneyContentType;
  }
  interface EditorStage {
    id: string;
    name: string;
    gloss: string;
    practices: EditorPractice[];
  }

  function uid(): string {
    return crypto.randomUUID();
  }

  // Mock seed — the integration seam replaces this with a curriculum query.
  let stages = $state<EditorStage[]>([
    {
      id: uid(),
      name: 'Arriving',
      gloss: 'Settling in — learning to land.',
      practices: [
        { id: uid(), title: 'The first breath', contentType: 'audio' },
        { id: uid(), title: 'Why stillness is hard', contentType: 'video' },
      ],
    },
    {
      id: uid(),
      name: 'Descending',
      gloss: 'Going beneath the surface noise.',
      practices: [{ id: uid(), title: 'The body scan', contentType: 'audio' }],
    },
  ]);

  let saving = $state(false);
  let dirty = $state(false);
  function markDirty(): void {
    dirty = true;
  }

  const CONTENT_TYPES: readonly JourneyContentType[] = ['video', 'audio', 'written'];

  const practiceCount = $derived(stages.reduce((n, s) => n + s.practices.length, 0));

  // ── Stage mutations ────────────────────────────────────────────────────────
  function addStage(): void {
    stages.push({ id: uid(), name: '', gloss: '', practices: [] });
    markDirty();
  }
  function removeStage(id: string): void {
    stages = stages.filter((s) => s.id !== id);
    markDirty();
  }
  function moveStage(id: string, dir: -1 | 1): void {
    const i = stages.findIndex((s) => s.id === id);
    const target = i + dir;
    if (i < 0 || target < 0 || target >= stages.length) return;
    [stages[i], stages[target]] = [stages[target], stages[i]];
    markDirty();
  }

  // ── Practice mutations ───────────────────────────────────────────────────────
  function addPractice(stage: EditorStage): void {
    stage.practices.push({ id: uid(), title: '', contentType: 'audio' });
    markDirty();
  }
  function removePractice(stage: EditorStage, id: string): void {
    stage.practices = stage.practices.filter((p) => p.id !== id);
    markDirty();
  }
  function movePractice(stage: EditorStage, id: string, dir: -1 | 1): void {
    const i = stage.practices.findIndex((p) => p.id === id);
    const target = i + dir;
    if (i < 0 || target < 0 || target >= stage.practices.length) return;
    [stage.practices[i], stage.practices[target]] = [
      stage.practices[target],
      stage.practices[i],
    ];
    markDirty();
  }

  async function handleSave(): Promise<void> {
    saving = true;
    try {
      await new Promise((resolve) => setTimeout(resolve, 250)); // mock persist
      dirty = false;
      toast.success('Curriculum saved');
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>Curriculum | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="curriculum">
  <header class="curriculum__head">
    <nav class="curriculum__crumbs" aria-label="Breadcrumb">
      <a href="/studio/journeys">Journeys</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">Curriculum</span>
    </nav>
    <div class="curriculum__head-row">
      <div>
        <h1 class="curriculum__title">Curriculum</h1>
        <p class="curriculum__count">
          {stages.length} {stages.length === 1 ? 'stage' : 'stages'} · {practiceCount}
          {practiceCount === 1 ? 'practice' : 'practices'}
        </p>
      </div>
      <div class="curriculum__head-actions">
        <a href="/studio/journeys/{pageId}/page" class="curriculum__link">Edit sales page</a>
        <button
          type="button"
          class="curriculum__save"
          disabled={!dirty || saving}
          onclick={handleSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  </header>

  <ol class="curriculum__stages" role="list">
    {#each stages as stage, si (stage.id)}
      <li class="stage">
        <div class="stage__head">
          <div class="stage__reorder">
            <button
              type="button"
              class="icon-btn"
              aria-label="Move stage up"
              disabled={si === 0}
              onclick={() => moveStage(stage.id, -1)}
            >
              <ChevronUpIcon size={15} />
            </button>
            <button
              type="button"
              class="icon-btn"
              aria-label="Move stage down"
              disabled={si === stages.length - 1}
              onclick={() => moveStage(stage.id, 1)}
            >
              <ChevronDownIcon size={15} />
            </button>
          </div>
          <span class="stage__ordinal">{(si + 1).toString().padStart(2, '0')}</span>
          <div class="stage__fields">
            <input
              type="text"
              class="stage__name"
              placeholder="Stage name"
              bind:value={stage.name}
              oninput={markDirty}
            />
            <input
              type="text"
              class="stage__gloss"
              placeholder="A short gloss for this stage…"
              bind:value={stage.gloss}
              oninput={markDirty}
            />
          </div>
          <button
            type="button"
            class="icon-btn icon-btn--danger"
            aria-label="Remove stage"
            onclick={() => removeStage(stage.id)}
          >
            <TrashIcon size={16} />
          </button>
        </div>

        <ul class="stage__practices" role="list">
          {#each stage.practices as practice, pi (practice.id)}
            <li class="practice">
              <div class="practice__reorder">
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Move practice up"
                  disabled={pi === 0}
                  onclick={() => movePractice(stage, practice.id, -1)}
                >
                  <ChevronUpIcon size={13} />
                </button>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Move practice down"
                  disabled={pi === stage.practices.length - 1}
                  onclick={() => movePractice(stage, practice.id, 1)}
                >
                  <ChevronDownIcon size={13} />
                </button>
              </div>
              <input
                type="text"
                class="practice__title"
                placeholder="Practice title"
                bind:value={practice.title}
                oninput={markDirty}
              />
              <select
                class="practice__type"
                bind:value={practice.contentType}
                onchange={markDirty}
                aria-label="Practice type"
              >
                {#each CONTENT_TYPES as t (t)}
                  <option value={t}>{t}</option>
                {/each}
              </select>
              <button
                type="button"
                class="icon-btn icon-btn--danger"
                aria-label="Remove practice"
                onclick={() => removePractice(stage, practice.id)}
              >
                <TrashIcon size={15} />
              </button>
            </li>
          {/each}
        </ul>

        <button type="button" class="stage__add-practice" onclick={() => addPractice(stage)}>
          <PlusIcon size={14} />
          Add practice
        </button>
      </li>
    {/each}
  </ol>

  <button type="button" class="curriculum__add-stage" onclick={addStage}>
    <PlusIcon size={16} />
    Add stage
  </button>
</div>

<style>
  .curriculum {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    width: 100%;
    max-width: var(--container-studio);
  }

  .curriculum__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-bottom: var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .curriculum__crumbs {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .curriculum__crumbs a {
    color: var(--color-text-secondary);
    text-decoration: none;
  }

  .curriculum__crumbs a:hover {
    color: var(--color-text);
  }

  .curriculum__head-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .curriculum__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .curriculum__count {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .curriculum__head-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .curriculum__link {
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .curriculum__link:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .curriculum__save {
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

  .curriculum__save:hover:not(:disabled) {
    background-color: var(--color-interactive-hover);
  }

  .curriculum__save:disabled {
    opacity: var(--opacity-40);
    cursor: not-allowed;
  }

  .curriculum__stages {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .stage {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
  }

  .stage__head {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .stage__reorder {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .stage__ordinal {
    font-family: var(--font-mono, monospace);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    padding-top: var(--space-2);
  }

  .stage__fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
  }

  .stage__name,
  .stage__gloss,
  .practice__title,
  .practice__type {
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

  .stage__name {
    font-weight: var(--font-semibold);
  }

  .stage__name:focus-visible,
  .stage__gloss:focus-visible,
  .practice__title:focus-visible,
  .practice__type:focus-visible {
    outline: none;
    border-color: var(--color-interactive);
    box-shadow: var(--shadow-focus-ring);
  }

  .stage__practices {
    list-style: none;
    margin: 0;
    padding: 0 0 0 var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .practice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .practice__reorder {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .practice__title {
    flex: 1;
    min-width: 0;
  }

  .practice__type {
    width: auto;
    flex-shrink: 0;
    text-transform: capitalize;
  }

  .stage__add-practice {
    align-self: flex-start;
    margin-left: var(--space-6);
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1-5) var(--space-3);
    border: var(--border-width) dashed var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .stage__add-practice:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .curriculum__add-stage {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
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

  .curriculum__add-stage:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
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

  .icon-btn--danger:hover:not(:disabled) {
    color: var(--color-danger, var(--color-text));
    background-color: color-mix(in oklch, var(--color-danger, red) 12%, transparent);
  }

  .icon-btn:disabled {
    opacity: var(--opacity-40);
    cursor: not-allowed;
  }

  .icon-btn:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }
</style>

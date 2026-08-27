<!--
  @component Studio Categories

  Owner/admin management surface for the org's topic taxonomy (the topics that
  power the landing page's "Browse by topic" rail). List + create + edit
  (name/description/cover) + reorder + delete.

  LAYOUT — a two-pane workspace, the same idiom as `studio/brand` and
  `studio/journeys/[id]/curriculum`: the topic list holds the left pane, and a
  sticky INSPECTOR on the right is the single place editing happens. It replaces
  an always-open create card stacked above rows that each expanded their own
  inline edit panel — a shape that made the page jump as panels opened, forced
  the whole surface into an 800px column, and never showed the creator what a
  topic would actually look like.

  The inspector leads with a LIVE `TopicCard` preview built from the real public
  component, so name/blurb/cover decisions are made against the artefact rather
  than against form fields. The preview is inert (`pointer-events: none` +
  `aria-hidden`) so it is neither a tab stop nor a way to navigate off the page.

  NO EMOJI FIELD. The public card no longer renders `categories.icon`, so
  offering an emoji input here would invite content the landing page discards.
  The column and the API field are untouched — the edit form round-trips the
  stored value through a hidden input so editing a topic cannot silently wipe an
  icon set before this change (the form coerces a MISSING field to null).

  Mirrors settings/branding: `ssr=false`, remote-function data via a refreshable
  query, and a multipart cover upload copied from the logo-upload flow. The
  owner|admin gate lives server-side in `+page.server.ts`.
-->
<script lang="ts">
  import {
    createCategoryForm,
    deleteCategory,
    getCategories,
    reorderCategories,
    updateCategoryForm,
    uploadCategoryCoverForm,
  } from '$lib/remote/categories.remote';
  import * as m from '$paraglide/messages';
  import type { StudioCategory } from '$lib/remote/categories.types';
  import CategoryList from '$lib/components/studio/categories/CategoryList.svelte';
  import TopicCard from '$lib/components/topic/TopicCard.svelte';
  import {
    Alert,
    Button,
    Card,
    ConfirmDialog,
    PageHeader,
  } from '$lib/components/ui';
  import { PlusIcon, UploadIcon } from '$lib/components/ui/Icon';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { keepValuesOnSave } from '$lib/utils/remote-form';

  let { data } = $props();

  const orgId = $derived(data.orgId);

  // Reactive source: the remote query owns refresh-after-mutation; until it
  // resolves on the client we paint the server-load snapshot for instant first
  // render (ssr=false means the query fetches on mount).
  const categoriesQuery = $derived(getCategories(orgId));
  const categories = $derived<StudioCategory[]>(
    categoriesQuery.current ?? data.categories
  );

  // ── Inspector subject ───────────────────────────────────────────────
  // `selectedId` is the source of truth; `selected` re-derives from the live
  // list, so a refresh after save/upload flows straight into the inspector.
  let selectedId = $state<string | null>(null);
  const selected = $derived<StudioCategory | null>(
    categories.find((c) => c.id === selectedId) ?? null
  );
  const mode = $derived<'create' | 'edit'>(selected ? 'edit' : 'create');

  // ── Create form state (bind:value; cleared on success) ───────────────
  let createName = $state('');
  let createDescription = $state('');

  // ── Edit form state (seeded when a row is selected) ──────────────────
  let editName = $state('');
  let editDescription = $state('');
  /**
   * Preservation shim, not an input: carried in a hidden field so an update
   * round-trips whatever emoji the category already had. The form schema turns a
   * MISSING `icon` into null, so omitting it entirely would wipe the column.
   */
  let editIcon = $state('');

  /**
   * The EDIT form deliberately does not use the bare `{...updateCategoryForm}`
   * spread: its default attachment resets the <form> after a successful save.
   * `bind:value` sets the input PROPERTY, never the `value` attribute, so the
   * DOM default of both controls is `''` — reset() emptied them on screen
   * while `editName` / `editDescription` (and therefore the live TopicCard
   * preview) still held the text, and because FormData is read from the DOM a
   * second Save would have posted an empty name. Nothing re-seeded them: the
   * update-result effect only fires a toast. The CREATE form below keeps the
   * bare spread on purpose — an add form SHOULD clear. (Codex-1g5lh.2 · see
   * `keepValuesOnSave`)
   */
  const updateFormAttrs = keepValuesOnSave(updateCategoryForm);

  // ── Delete confirmation ─────────────────────────────────────────────
  let deleteTarget = $state<StudioCategory | null>(null);
  let confirmOpen = $state(false);

  // ── Reorder in-flight guard ─────────────────────────────────────────
  let reorderPending = $state(false);

  // Freshly-uploaded cover URLs, keyed by category id. The management list
  // endpoint may return only a raw R2 key (no resolved URL), so this keeps the
  // cover we obtained this session paintable without a reload.
  let sessionCoverUrls = $state<Record<string, string>>({});

  // ── Cover upload plumbing (mirrors LogoUpload) ──────────────────────
  let coverInput = $state<HTMLInputElement>();
  let coverFormEl = $state<HTMLFormElement>();

  /** The inspector pane — scrolled to on select once the panes stack. */
  let inspectorEl = $state<HTMLElement>();

  function browseCover() {
    coverInput?.click();
  }

  function onCoverSelected() {
    if (coverInput?.files?.length && coverFormEl) {
      coverFormEl.requestSubmit();
    }
  }

  // Session upload URL (freshest) wins over the persisted list URL.
  function coverUrlFor(cat: StudioCategory): string | null {
    return sessionCoverUrls[cat.id] ?? cat.coverImageUrl ?? null;
  }

  function hasCover(cat: StudioCategory): boolean {
    return Boolean(coverUrlFor(cat) || cat.coverImageKey);
  }

  // ── Live preview (the public card, fed by whichever pane is active) ──
  const previewName = $derived(
    (mode === 'edit' ? editName : createName).trim() || 'Untitled topic'
  );
  const previewDescription = $derived(
    (mode === 'edit' ? editDescription : createDescription).trim() || null
  );
  const previewCover = $derived(selected ? coverUrlFor(selected) : null);
  /**
   * A real slug so the preview anchor is a valid href rather than `#`. It is
   * never followed — the frame is `pointer-events: none` and `aria-hidden` — but
   * a placeholder keeps the card honest before the server derives the slug.
   */
  const previewSlug = $derived(selected?.slug ?? 'new-topic');

  // ── Result effects (fire once per distinct result object) ────────────
  let lastCreateResult: unknown = null;
  $effect(() => {
    const r = createCategoryForm.result;
    if (r && r !== lastCreateResult && createCategoryForm.pending === 0) {
      lastCreateResult = r;
      if (r.success) {
        toast.success('Topic created');
        createName = '';
        createDescription = '';
        // Hand the creator straight to the new topic — a cover can only be
        // uploaded against an existing id, so this is the next step anyway.
        // Seeded inline rather than via selectRow(), whose toggle behaviour
        // reads `selectedId` and would make this effect depend on state it sets.
        selectedId = r.category.id;
        editName = r.category.name;
        editDescription = r.category.description ?? '';
        editIcon = r.category.icon ?? '';
      } else {
        toast.error(r.error ?? 'Failed to create category');
      }
    }
  });

  let lastUpdateResult: unknown = null;
  $effect(() => {
    const r = updateCategoryForm.result;
    if (r && r !== lastUpdateResult && updateCategoryForm.pending === 0) {
      lastUpdateResult = r;
      if (r.success) {
        toast.success('Topic updated');
      } else {
        toast.error(r.error ?? 'Failed to update category');
      }
    }
  });

  let lastCoverResult: unknown = null;
  $effect(() => {
    const r = uploadCategoryCoverForm.result;
    if (r && r !== lastCoverResult && uploadCategoryCoverForm.pending === 0) {
      lastCoverResult = r;
      if (r.success) {
        if (r.coverImageUrl) {
          sessionCoverUrls = {
            ...sessionCoverUrls,
            [r.categoryId]: r.coverImageUrl,
          };
        }
        if (coverInput) coverInput.value = '';
        toast.success('Cover uploaded');
      } else {
        toast.error(r.error ?? 'Failed to upload cover');
      }
    }
  });

  // ── Actions ─────────────────────────────────────────────────────────
  /** Load a topic into the inspector (clicking the selected row deselects). */
  function selectRow(cat: StudioCategory) {
    if (selectedId === cat.id) {
      selectedId = null;
      return;
    }
    selectedId = cat.id;
    editName = cat.name;
    editDescription = cat.description ?? '';
    editIcon = cat.icon ?? '';
    revealInspector();
  }

  /**
   * Bring the inspector into view only when it is ENTIRELY off-screen — the
   * stacked (below-lg) case, where it sits under a long list and a row tap
   * would otherwise change something the user cannot see.
   *
   * Deliberately not `scrollIntoView({ block: 'nearest' })`: the inspector is
   * taller than a laptop viewport, so `nearest` judged it partially visible and
   * scrolled the desktop page by 50–80px on every single row selection.
   */
  function revealInspector() {
    const el = inspectorEl;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const offscreen = rect.top >= window.innerHeight || rect.bottom <= 0;
    if (offscreen) el.scrollIntoView({ block: 'start' });
  }

  /** Leave edit mode and return the inspector to "New topic". */
  function newTopic() {
    selectedId = null;
  }

  function askDelete(cat: StudioCategory) {
    deleteTarget = cat;
    confirmOpen = true;
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    const res = await deleteCategory({
      organizationId: orgId,
      categoryId: target.id,
    });
    if (res.success) {
      toast.success('Topic deleted');
      if (selectedId === target.id) selectedId = null;
    } else {
      toast.error(res.error ?? 'Failed to delete category');
    }
    deleteTarget = null;
  }

  async function move(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= categories.length || reorderPending) return;
    const ids = categories.map((c) => c.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    reorderPending = true;
    try {
      const res = await reorderCategories({
        organizationId: orgId,
        orderedIds: ids,
      });
      if (!res.success) {
        toast.error(res.error ?? 'Failed to reorder categories');
      }
    } finally {
      reorderPending = false;
    }
  }

  const createPending = $derived(createCategoryForm.pending > 0);
  const updatePending = $derived(updateCategoryForm.pending > 0);
  const coverPending = $derived(uploadCategoryCoverForm.pending > 0);
</script>

<svelte:head>
  <title>{m.categories_title()} | {data.org?.name ?? 'Studio'}</title>
</svelte:head>

<div class="cats">
  <PageHeader
    kicker={m.studio_section_catalogue()}
    title={m.categories_title()}
    description={m.categories_description()}
  />

  {#if categoriesQuery.error}
    <Alert variant="error">Couldn't load categories. Please refresh.</Alert>
  {/if}

  <div class="cats__panes">
    <!-- ── Left: the ordered list ── -->
    <section class="pane pane--list" aria-labelledby="cats-list-heading">
      <header class="pane__head">
        <h2 class="pane__title" id="cats-list-heading">
          Your topics
          <span class="pane__count">{categories.length}</span>
        </h2>
        {#if categories.length > 0}
          <p class="pane__hint">
            They appear on your landing page in this order. Select one to edit.
          </p>
        {/if}
      </header>

      <CategoryList
        {categories}
        activeId={selectedId}
        {reorderPending}
        {coverUrlFor}
        onselect={selectRow}
        ondelete={askDelete}
        onmove={move}
      />
    </section>

    <!-- ── Right: the inspector ── -->
    <aside
      class="pane pane--inspector"
      aria-labelledby="cats-inspector-heading"
      bind:this={inspectorEl}
    >
      <Card.Root>
        <Card.Header>
          <Card.Title id="cats-inspector-heading">
            {mode === 'edit' ? 'Edit topic' : 'New topic'}
          </Card.Title>
          <Card.Description>
            {mode === 'edit'
              ? `Changes to /${selected?.slug} go live as soon as you save.`
              : 'Name it, add a short blurb, then give it a cover image.'}
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <div class="inspector">
            <!-- Live preview of the real public card -->
            <div class="preview">
              <div class="preview__frame" aria-hidden="true">
                <TopicCard
                  name={previewName}
                  slug={previewSlug}
                  href="/explore?category={encodeURIComponent(previewSlug)}"
                  coverImageUrl={previewCover}
                  description={previewDescription}
                />
              </div>
              <p class="preview__caption">
                How it appears in Browse by topic.
              </p>
            </div>

            {#if mode === 'edit' && selected}
              {#if updateCategoryForm.result && !updateCategoryForm.result.success}
                <Alert variant="error">
                  {updateCategoryForm.result.error ?? 'Failed to update category'}
                </Alert>
              {/if}
              <form {...updateFormAttrs} class="category-form" novalidate>
                <input type="hidden" name="organizationId" value={orgId} />
                <input type="hidden" name="categoryId" value={selected.id} />
                <!-- Preserves any pre-existing emoji; see the component note. -->
                <input type="hidden" name="icon" value={editIcon} />
                <div class="form-field">
                  <label class="field-label" for="editName">Name</label>
                  <input
                    id="editName"
                    name="name"
                    class="field-input"
                    bind:value={editName}
                    maxlength="100"
                    required
                  />
                </div>
                <div class="form-field">
                  <label class="field-label" for="editDescription">
                    Blurb
                    <span class="field-optional">optional</span>
                  </label>
                  <textarea
                    id="editDescription"
                    name="description"
                    class="field-input field-textarea"
                    bind:value={editDescription}
                    rows="3"
                    maxlength="500"
                    placeholder="One or two lines shown under the topic name."
                  ></textarea>
                </div>
                <div class="form-actions">
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    loading={updatePending}
                    disabled={editName.trim().length === 0}
                  >
                    Save changes
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onclick={newTopic}
                  >
                    Done
                  </Button>
                </div>
              </form>

              <!-- Cover upload (multipart; copies the logo-upload flow) -->
              <div class="cover-field">
                <span class="field-label">Cover image</span>
                <p class="cover-hint">
                  Landscape works best. PNG, JPEG, or WebP up to 10MB. Covers are
                  tinted to your brand on the landing page.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onclick={browseCover}
                  loading={coverPending}
                >
                  <UploadIcon size={16} />
                  {hasCover(selected) ? 'Replace cover' : 'Upload cover'}
                </Button>
                <form
                  bind:this={coverFormEl}
                  {...uploadCategoryCoverForm}
                  enctype="multipart/form-data"
                  class="hidden-form"
                >
                  <input type="hidden" name="organizationId" value={orgId} />
                  <input type="hidden" name="categoryId" value={selected.id} />
                  <input
                    bind:this={coverInput}
                    {...uploadCategoryCoverForm.fields.cover.as('file')}
                    accept="image/png,image/jpeg,image/webp"
                    onchange={onCoverSelected}
                    tabindex="-1"
                    aria-hidden="true"
                  />
                </form>
              </div>
            {:else}
              {#if createCategoryForm.result && !createCategoryForm.result.success}
                <Alert variant="error">
                  {createCategoryForm.result.error ?? 'Failed to create category'}
                </Alert>
              {/if}
              <form {...createCategoryForm} class="category-form" novalidate>
                <input type="hidden" name="organizationId" value={orgId} />
                <!--
                  Append at the end. The service defaults a new category to
                  `sortOrder: 0` and lists by (sortOrder, name), so without this
                  a new topic collides with the first row's 0 and surfaces
                  wherever its name sorts — "I added Breathwork and it appeared
                  second". Passing the current count puts it last, where the
                  creator just looked.
                -->
                <input
                  type="hidden"
                  name="sortOrder"
                  value={categories.length}
                />
                <div class="form-field">
                  <label class="field-label" for="createName">Name</label>
                  <input
                    id="createName"
                    name="name"
                    class="field-input"
                    bind:value={createName}
                    maxlength="100"
                    placeholder="e.g. Breathwork"
                    required
                  />
                </div>
                <div class="form-field">
                  <label class="field-label" for="createDescription">
                    Blurb
                    <span class="field-optional">optional</span>
                  </label>
                  <textarea
                    id="createDescription"
                    name="description"
                    class="field-input field-textarea"
                    bind:value={createDescription}
                    rows="3"
                    maxlength="500"
                    placeholder="One or two lines shown under the topic name."
                  ></textarea>
                </div>
                <div class="form-actions">
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    loading={createPending}
                    disabled={createName.trim().length === 0}
                  >
                    <PlusIcon size={16} />
                    Add topic
                  </Button>
                </div>
              </form>
              <p class="cover-hint">
                A cover image can be added once the topic exists — it opens here
                automatically after you add it.
              </p>
            {/if}
          </div>
        </Card.Content>
      </Card.Root>
    </aside>
  </div>
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Delete topic?"
  description={deleteTarget
    ? `"${deleteTarget.name}" will be removed. Content stays published; it just loses this topic.`
    : ''}
  confirmText="Delete"
  variant="destructive"
  onConfirm={confirmDelete}
  onCancel={() => (deleteTarget = null)}
/>

<style>
  .cats {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    width: 100%;
  }

  /* ── Two-pane workspace ── */
  .cats__panes {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(20rem, 26rem);
    gap: var(--space-5);
    align-items: start;
  }

  @media (--below-lg) {
    .cats__panes {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .pane {
    min-width: 0;
  }

  .pane--list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  /* The inspector tracks the list while it scrolls; `align-items: start` on the
     grid is what makes sticky possible (a stretched item has nothing to slide
     within). Stacked layouts drop the stickiness. */
  .pane--inspector {
    position: sticky;
    top: var(--space-4);
    /* Breathing room when revealInspector() scrolls it to the top (stacked). */
    scroll-margin-top: var(--space-4);
  }

  @media (--below-lg) {
    .pane--inspector {
      position: static;
    }
  }

  .pane__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .pane__title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .pane__count {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-secondary);
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-full);
    padding: 0 var(--space-2);
  }

  .pane__hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  /* ── Inspector ── */
  .inspector {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* Inert: not a tab stop, not a way to navigate off the editor. */
  .preview__frame {
    pointer-events: none;
  }

  .preview__caption {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* ── Forms ── */
  .category-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .field-label {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .field-optional {
    font-size: var(--text-xs);
    font-weight: var(--font-normal);
    color: var(--color-text-muted);
  }

  .field-input {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-background);
    color: var(--color-text);
    transition: var(--transition-colors);
    width: 100%;
  }

  .field-textarea {
    resize: vertical;
    min-height: var(--space-16);
    font-family: inherit;
    line-height: var(--leading-normal);
  }

  .field-input:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset-inset);
    border-color: var(--color-border-focus);
  }

  .form-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* ── Cover ── */
  .cover-field {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .cover-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin: 0;
    line-height: var(--leading-normal);
  }

  .hidden-form {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>

<!--
  @component Studio Categories

  Owner/admin management surface for the org's topic taxonomy (the categories
  that power the landing "Browse by topic" module). List + create + edit
  (name/description/icon/cover) + reorder (accessible up/down) + delete.

  Mirrors settings/branding: `ssr=false`, remote-function data via a refreshable
  query, and a multipart cover upload copied from the logo-upload flow. The
  owner|admin gate lives server-side in `+page.server.ts`. Row rendering + empty
  state live in the presentational `CategoryList`; this page owns the remote
  data and the create/edit/cover forms (the edit panel is passed in as a snippet).
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
  import type { StudioCategory } from '$lib/remote/categories.types';
  import CategoryList from '$lib/components/studio/categories/CategoryList.svelte';
  import { Alert, Button, Card, ConfirmDialog, PageHeader } from '$lib/components/ui';
  import { ImageIcon, PlusIcon, UploadIcon } from '$lib/components/ui/Icon';
  import { toast } from '$lib/components/ui/Toast/toast-store';

  let { data } = $props();

  const orgId = $derived(data.orgId);

  // Reactive source: the remote query owns refresh-after-mutation; until it
  // resolves on the client we paint the server-load snapshot for instant first
  // render (ssr=false means the query fetches on mount).
  const categoriesQuery = $derived(getCategories(orgId));
  const categories = $derived<StudioCategory[]>(
    categoriesQuery.current ?? data.categories
  );

  // ── Create form state (bind:value; cleared on success) ──────────────
  let createName = $state('');
  let createDescription = $state('');
  let createIcon = $state('');

  // ── Edit state (one row at a time) ──────────────────────────────────
  let editingId = $state<string | null>(null);
  let editName = $state('');
  let editDescription = $state('');
  let editIcon = $state('');

  // ── Delete confirmation ─────────────────────────────────────────────
  let deleteTarget = $state<StudioCategory | null>(null);
  let confirmOpen = $state(false);

  // ── Reorder in-flight guard ─────────────────────────────────────────
  let reorderPending = $state(false);

  // Freshly-uploaded cover URLs, keyed by category id. The management list
  // endpoint returns only raw R2 keys (no resolved URL), so we can only paint a
  // cover URL we obtained this session from the upload response.
  let sessionCoverUrls = $state<Record<string, string>>({});

  // ── Cover upload plumbing (mirrors LogoUpload) ──────────────────────
  let coverInput = $state<HTMLInputElement>();
  let coverFormEl = $state<HTMLFormElement>();

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

  // ── Result effects (fire once per distinct result object) ───────────
  let lastCreateResult: unknown = null;
  $effect(() => {
    const r = createCategoryForm.result;
    if (r && r !== lastCreateResult && createCategoryForm.pending === 0) {
      lastCreateResult = r;
      if (r.success) {
        toast.success('Category created');
        createName = '';
        createDescription = '';
        createIcon = '';
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
        toast.success('Category updated');
        editingId = null;
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
  function toggleEdit(cat: StudioCategory) {
    if (editingId === cat.id) {
      editingId = null;
      return;
    }
    editingId = cat.id;
    editName = cat.name;
    editDescription = cat.description ?? '';
    editIcon = cat.icon ?? '';
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
      toast.success('Category deleted');
      if (editingId === target.id) editingId = null;
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
  <title>Categories | {data.org?.name ?? 'Studio'}</title>
</svelte:head>

<div class="categories-page">
  <PageHeader
    title="Categories"
    description="Curate the topics that power your landing page's Browse by topic."
  />

  {#if categoriesQuery.error}
    <Alert variant="error">Couldn't load categories. Please refresh.</Alert>
  {/if}

  <!-- Create -->
  <Card.Root>
    <Card.Header>
      <Card.Title>Add a category</Card.Title>
      <Card.Description>
        Give it a name and an optional short description and glyph. Add a cover
        image after creating it.
      </Card.Description>
    </Card.Header>
    <Card.Content>
      {#if createCategoryForm.result && !createCategoryForm.result.success}
        <Alert variant="error">
          {createCategoryForm.result.error ?? 'Failed to create category'}
        </Alert>
      {/if}
      <form {...createCategoryForm} class="category-form" novalidate>
        <input type="hidden" name="organizationId" value={orgId} />
        <div class="form-grid">
          <div class="form-field form-field--grow">
            <label class="field-label" for="createName">Name</label>
            <input
              id="createName"
              name="name"
              class="field-input"
              bind:value={createName}
              maxlength="100"
              placeholder="e.g. Interviews"
              required
            />
          </div>
          <div class="form-field form-field--icon">
            <label class="field-label" for="createIcon">Icon</label>
            <input
              id="createIcon"
              name="icon"
              class="field-input"
              bind:value={createIcon}
              maxlength="64"
              placeholder="emoji or name"
            />
          </div>
        </div>
        <div class="form-field">
          <label class="field-label" for="createDescription">Description</label>
          <textarea
            id="createDescription"
            name="description"
            class="field-input field-textarea"
            bind:value={createDescription}
            rows="2"
            maxlength="500"
            placeholder="Optional — a short blurb shown on the topic card."
          ></textarea>
        </div>
        <div class="form-actions">
          <Button
            type="submit"
            variant="primary"
            loading={createPending}
            disabled={createName.trim().length === 0}
          >
            <PlusIcon size={16} />
            Add category
          </Button>
        </div>
      </form>
    </Card.Content>
  </Card.Root>

  <!-- List + inline edit panel -->
  <CategoryList
    {categories}
    activeId={editingId}
    {reorderPending}
    {coverUrlFor}
    onedit={toggleEdit}
    ondelete={askDelete}
    onmove={move}
  >
    {#snippet editPanel(cat)}
      <div class="edit-panel">
        {#if updateCategoryForm.result && !updateCategoryForm.result.success}
          <Alert variant="error">
            {updateCategoryForm.result.error ?? 'Failed to update category'}
          </Alert>
        {/if}
        <form {...updateCategoryForm} class="category-form" novalidate>
          <input type="hidden" name="organizationId" value={orgId} />
          <input type="hidden" name="categoryId" value={cat.id} />
          <div class="form-grid">
            <div class="form-field form-field--grow">
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
            <div class="form-field form-field--icon">
              <label class="field-label" for="editIcon">Icon</label>
              <input
                id="editIcon"
                name="icon"
                class="field-input"
                bind:value={editIcon}
                maxlength="64"
                placeholder="emoji or name"
              />
            </div>
          </div>
          <div class="form-field">
            <label class="field-label" for="editDescription">Description</label>
            <textarea
              id="editDescription"
              name="description"
              class="field-input field-textarea"
              bind:value={editDescription}
              rows="2"
              maxlength="500"
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
          </div>
        </form>

        <!-- Cover upload (multipart; copies the logo-upload flow) -->
        <div class="cover-field">
          <span class="field-label">Cover image</span>
          <div class="cover-field__row">
            <div class="cover-tile" aria-hidden="true">
              {#if coverUrlFor(cat)}
                <img src={coverUrlFor(cat)} alt="" class="cover-image" />
              {:else}
                <ImageIcon size={24} class="cover-placeholder-icon" />
              {/if}
            </div>
            <div class="cover-field__actions">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onclick={browseCover}
                loading={coverPending}
              >
                <UploadIcon size={16} />
                {hasCover(cat) ? 'Replace cover' : 'Upload cover'}
              </Button>
              <p class="cover-hint">PNG, JPEG, or WebP. Max 10MB.</p>
            </div>
          </div>
          <form
            bind:this={coverFormEl}
            {...uploadCategoryCoverForm}
            enctype="multipart/form-data"
            class="hidden-form"
          >
            <input type="hidden" name="organizationId" value={orgId} />
            <input type="hidden" name="categoryId" value={cat.id} />
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
      </div>
    {/snippet}
  </CategoryList>
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Delete category?"
  description={deleteTarget
    ? `"${deleteTarget.name}" will be removed. Content stays published; it just loses this topic.`
    : ''}
  confirmText="Delete"
  variant="destructive"
  onConfirm={confirmDelete}
  onCancel={() => (deleteTarget = null)}
/>

<style>
  .categories-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 800px;
  }

  /* ── Forms ── */
  .category-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .form-grid {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .form-field--grow {
    flex: 1 1 16rem;
    min-width: 0;
  }

  .form-field--icon {
    flex: 0 0 auto;
    width: 8rem;
  }

  .field-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
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
    min-height: var(--space-12);
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
    justify-content: flex-start;
  }

  /* ── Edit panel ── */
  .edit-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .cover-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .cover-field__row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .cover-field__actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .cover-tile {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-16);
    height: var(--space-16);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-surface-secondary);
    overflow: hidden;
    color: var(--color-text-muted);
  }

  .cover-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cover-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin: 0;
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

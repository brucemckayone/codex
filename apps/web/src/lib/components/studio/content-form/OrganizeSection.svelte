<!--
  @component OrganizeSection

  Category multiselect + tags + homepage feature flag. Laid out in a single card
  with a two-column grid on wide screens (categories | tags), then the feature
  row spans full width beneath. When there is no org space (personal creators
  studio) the category taxonomy — an org-curation feature — is hidden and tags
  span the row.

  This is the container half: it owns the remote fetch of the org's categories
  and the create-on-the-fly mutation, and delegates the pure picker UI to
  CategorySelect (which also renders the hidden `categoryIds` form field).

  @prop form                 Active form instance
  @prop organizationId       Org space UUID, or null for personal content
  @prop tags                 Tag array (uplifted so it survives in hidden input)
  @prop featured             Feature flag (uplifted)
  @prop selectedCategoryIds  Selected category ids (uplifted)
  @prop onTagsChange
  @prop onFeaturedChange
  @prop onCategoryChange
-->
<script lang="ts">
  import TagsInput from './TagsInput.svelte';
  import CategorySelect from './CategorySelect.svelte';
  import Switch from '$lib/components/ui/Switch/Switch.svelte';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import {
    getCategories,
    createCategoryInline,
  } from '$lib/remote/categories.remote';
  import type {
    createContentForm,
    updateContentForm,
  } from '$lib/remote/content.remote';

  type ContentForm = typeof createContentForm | typeof updateContentForm;

  interface Props {
    form: ContentForm;
    organizationId: string | null;
    tags: string[];
    featured: boolean;
    selectedCategoryIds: string[];
    onTagsChange: (tags: string[]) => void;
    onFeaturedChange: (featured: boolean) => void;
    onCategoryChange: (ids: string[]) => void;
  }

  const {
    form,
    organizationId,
    tags,
    featured,
    selectedCategoryIds,
    onTagsChange,
    onFeaturedChange,
    onCategoryChange,
  }: Props = $props();

  // Category taxonomy is org-scoped (WP-4 management + api client are org-only),
  // so only fetch/render the multiselect when there is an org space.
  const categoriesQuery = $derived(
    organizationId ? getCategories(organizationId) : null
  );
  const categoryOptions = $derived(
    (categoriesQuery?.current ?? []).map((c) => ({ id: c.id, name: c.name }))
  );

  let creatingCategory = $state(false);

  function toggleCategory(id: string) {
    onCategoryChange(
      selectedCategoryIds.includes(id)
        ? selectedCategoryIds.filter((x) => x !== id)
        : [...selectedCategoryIds, id]
    );
  }

  async function createCategory(name: string) {
    if (!organizationId) return;
    creatingCategory = true;
    try {
      const result = await createCategoryInline({ organizationId, name });
      if (result.success) {
        // Add the freshly-minted topic to the selection; getCategories has been
        // refreshed by the command so it also appears as a selectable option.
        onCategoryChange([...selectedCategoryIds, result.category.id]);
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create topic'
      );
    } finally {
      creatingCategory = false;
    }
  }
</script>

<!-- Hidden inputs (tags + featured). The `categoryIds` hidden field is rendered
     by CategorySelect; `category` is legacy — echoed back unchanged so existing
     values round-trip while the taxonomy (categoryIds) becomes the source of
     truth. -->
<input type="hidden" name="tags" value={JSON.stringify(tags)} />
<input type="hidden" name="featured" value={featured ? 'true' : ''} />
<input type="hidden" name="category" value={form.fields.category?.value() ?? ''} />

<div class="organize-grid" class:single={!organizationId}>
  {#if organizationId}
    <div class="organize-field">
      <CategorySelect
        options={categoryOptions}
        selected={selectedCategoryIds}
        onToggle={toggleCategory}
        onCreate={createCategory}
        creating={creatingCategory}
      />
    </div>
  {/if}

  <div class="organize-field">
    <TagsInput {tags} onchange={onTagsChange} />
  </div>
</div>

<hr class="organize-rule" aria-hidden="true" />

<div class="feature-row">
  <div class="feature-label">
    <span class="feature-title">Feature on homepage</span>
    <p class="feature-desc">
      Promote this content to a full-width editorial card on the org landing page.
    </p>
  </div>
  <Switch
    checked={featured}
    onCheckedChange={onFeaturedChange}
    aria-label="Feature on homepage"
  />
</div>

<style>
  .organize-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-5);
  }

  @media (--breakpoint-lg) {
    .organize-grid { grid-template-columns: minmax(0, 22rem) minmax(0, 1fr); }
    .organize-grid.single { grid-template-columns: 1fr; }
  }

  .organize-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .organize-rule {
    border: none;
    border-top: var(--border-width) var(--border-style) var(--color-border);
    margin: var(--space-5) 0 0;
  }

  .feature-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    margin-top: var(--space-5);
  }

  .feature-label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .feature-title {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .feature-desc {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-relaxed);
  }
</style>

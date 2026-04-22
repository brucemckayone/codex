<!--
  @component OrganizeSection

  Category + tags + homepage feature flag. Laid out in a single card with
  a two-column grid on wide screens (category | tags), then the feature
  row spans full width beneath.

  @prop form       Active form instance
  @prop tags       Tag array (uplifted to parent so it survives in hidden input)
  @prop featured   Feature flag (uplifted)
  @prop onTagsChange
  @prop onFeaturedChange
-->
<script lang="ts">
  import TagsInput from './TagsInput.svelte';
  import Switch from '$lib/components/ui/Switch/Switch.svelte';
  import type { createContentForm, updateContentForm } from '$lib/remote/content.remote';

  type ContentForm = typeof createContentForm | typeof updateContentForm;

  interface Props {
    form: ContentForm;
    tags: string[];
    featured: boolean;
    onTagsChange: (tags: string[]) => void;
    onFeaturedChange: (featured: boolean) => void;
  }

  const { form, tags, featured, onTagsChange, onFeaturedChange }: Props = $props();
</script>

<!-- Hidden inputs -->
<input type="hidden" name="tags" value={JSON.stringify(tags)} />
<input type="hidden" name="featured" value={featured ? 'true' : ''} />

<div class="organize-grid">
  <div class="organize-field">
    <label class="field-label" for="category">
      Category <span class="optional-hint">Optional</span>
    </label>
    <input
      {...form.fields.category.as('text')}
      id="category"
      class="field-input"
      placeholder="Tutorial, Review, Guide…"
      maxlength="100"
    />
    <span class="field-hint">A single-word genre or format. Used in filters.</span>
  </div>

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
  }

  .organize-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .field-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .field-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-relaxed);
  }

  .optional-hint {
    font-size: var(--text-xs);
    font-weight: var(--font-normal);
    color: var(--color-text-muted);
    margin-left: var(--space-1);
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
    font-family: inherit;
  }

  .field-input:focus {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: -1px;
    border-color: var(--color-border-focus, var(--color-focus));
  }

  .organize-rule {
    margin: var(--space-5) 0 var(--space-4) 0;
    border: 0;
    border-top: var(--border-width) dashed var(--color-border);
  }

  .feature-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .feature-label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .feature-title {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .feature-desc {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-relaxed);
  }
</style>

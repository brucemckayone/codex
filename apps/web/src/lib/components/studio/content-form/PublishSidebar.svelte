<!--
  @component PublishSidebar

  Publishing controls sidebar: status, readiness checklist,
  visibility, pricing, category, tags, and danger zone.

  @prop {any} form - The active form instance
  @prop {boolean} isEdit - Whether in edit mode
  @prop {ContentWithRelations} [content] - Existing content (edit mode)
  @prop {boolean} formPending - Whether the form is submitting
  @prop {() => void} onPublishToggle - Publish/unpublish handler
  @prop {() => void} onDelete - Delete handler
  @prop {boolean} publishing - Whether publish action is in progress
  @prop {boolean} deleting - Whether delete action is in progress
-->
<script lang="ts">
  import { CheckIcon, CircleIcon } from '$lib/components/ui/Icon';
  import { Badge, Button, Select } from '$lib/components/ui';
  import * as m from '$paraglide/messages';
  import TagsInput from './TagsInput.svelte';
  import type { ContentWithRelations } from '$lib/types';

  interface Props {
    form: any;
    isEdit: boolean;
    content?: ContentWithRelations;
    formPending: boolean;
    onPublishToggle: () => void;
    onDelete: () => void;
    publishing: boolean;
    deleting: boolean;
  }

  const {
    form,
    isEdit,
    content,
    formPending,
    onPublishToggle,
    onDelete,
    publishing,
    deleting,
  }: Props = $props();

  const currentStatus = $derived(content?.status ?? 'draft');

  // Reactive field values for readiness checks
  const titleVal = $derived(form.fields.title.value() ?? '');
  const slugVal = $derived(form.fields.slug.value() ?? '');
  const contentTypeVal = $derived(form.fields.contentType.value() ?? 'video');
  const mediaItemIdVal = $derived(form.fields.mediaItemId?.value() ?? '');
  const contentBodyVal = $derived(form.fields.contentBody?.value() ?? '');
  const visibilityVal = $derived(form.fields.visibility.value() ?? 'public');
  const priceVal = $derived(form.fields.price?.value() ?? '0.00');

  // Tags state (managed locally, serialized to hidden input)
  let tags = $state<string[]>(content?.tags ?? []);

  function handleTagsChange(newTags: string[]) {
    tags = newTags;
  }

  // Visibility options for Select component
  const visibilityOptions = $derived([
    { value: 'public', label: m.studio_content_form_visibility_public() },
    { value: 'private', label: m.studio_content_form_visibility_private() },
    { value: 'members_only', label: m.studio_content_form_visibility_members_only() },
    { value: 'purchased_only', label: m.studio_content_form_visibility_purchased_only() },
  ]);

  function handleVisibilityChange(val: string | undefined) {
    if (val) form.fields.visibility.set(val);
  }

  // Visibility descriptions
  const visibilityDescriptions: Record<string, () => string> = {
    public: () => m.studio_content_form_visibility_public_desc(),
    private: () => m.studio_content_form_visibility_private_desc(),
    members_only: () => m.studio_content_form_visibility_members_only_desc(),
    purchased_only: () => m.studio_content_form_visibility_purchased_only_desc(),
  };

  // Readiness checklist
  const readinessChecks = $derived.by(() => {
    const checks = [
      { label: 'Title is set', met: !!titleVal.trim() },
      { label: 'Slug is valid', met: !!slugVal.trim() && /^[a-z0-9-]+$/.test(slugVal) },
    ];
    if (contentTypeVal === 'video' || contentTypeVal === 'audio') {
      checks.push({ label: 'Media attached', met: !!mediaItemIdVal });
    }
    if (contentTypeVal === 'written') {
      checks.push({ label: 'Content body written', met: !!contentBodyVal.trim() });
    }
    if (visibilityVal === 'purchased_only') {
      checks.push({
        label: 'Price set for paid content',
        met: parseFloat(priceVal || '0') > 0,
      });
    }
    return checks;
  });

  const isReadyToPublish = $derived(readinessChecks.every((c) => c.met));
  const showPriceField = $derived(visibilityVal === 'purchased_only');
  let showDangerZone = $state(false);
</script>

<aside class="publish-sidebar">
  <!-- Hidden input for serialized tags -->
  <input type="hidden" name="tags" value={JSON.stringify(tags)} />
  <!-- Hidden input for category (rendered inline below) -->

  <!-- Status + Primary Action -->
  <div class="sidebar-section">
    {#if isEdit}
      <div class="status-row">
        <span class="status-badge" data-status={currentStatus}>
          {currentStatus === 'published'
            ? m.studio_content_status_published()
            : currentStatus === 'archived'
              ? m.studio_content_status_archived()
              : m.studio_content_status_draft()}
        </span>
      </div>
    {/if}

    <Button
      type="submit"
      variant="primary"
      class="btn-full"
      disabled={formPending || deleting}
      loading={formPending}
    >
      {#if formPending}
        {m.studio_content_form_submitting()}
      {:else if isEdit}
        {m.studio_content_form_submit_update()}
      {:else}
        {m.studio_content_form_submit_create()}
      {/if}
    </Button>

    {#if isEdit && currentStatus !== 'published'}
      <Button
        type="button"
        variant="secondary"
        class="btn-full"
        disabled={publishing || deleting || formPending || !isReadyToPublish}
        onclick={onPublishToggle}
        title={isReadyToPublish ? '' : 'Complete all readiness checks before publishing'}
        loading={publishing}
      >
        {#if publishing}
          {m.studio_content_form_publishing()}
        {:else}
          {m.studio_content_form_publish()}
        {/if}
      </Button>
    {:else if isEdit && currentStatus === 'published'}
      <Button
        type="button"
        variant="secondary"
        class="btn-full"
        disabled={publishing || deleting || formPending}
        onclick={onPublishToggle}
        loading={publishing}
      >
        {#if publishing}
          {m.studio_content_form_unpublishing()}
        {:else}
          {m.studio_content_form_unpublish()}
        {/if}
      </Button>
    {/if}
  </div>

  <!-- Readiness Checklist -->
  <div class="sidebar-section">
    <h4 class="sidebar-heading">Publish Readiness</h4>
    <ul class="readiness-list">
      {#each readinessChecks as check}
        <li class="readiness-item" data-met={check.met || undefined}>
          {#if check.met}
            <CheckIcon size={14} />
          {:else}
            <CircleIcon size={14} />
          {/if}
          <span>{check.label}</span>
        </li>
      {/each}
    </ul>
  </div>

  <!-- Visibility -->
  <div class="sidebar-section">
    <h4 class="sidebar-heading">{m.studio_content_form_visibility_label()}</h4>
    <input type="hidden" name="visibility" value={visibilityVal} />
    <Select
      options={visibilityOptions}
      value={visibilityVal}
      onValueChange={handleVisibilityChange}
      placeholder={m.studio_content_form_visibility_label()}
    />
    <span class="field-hint">
      {visibilityDescriptions[visibilityVal]?.() ?? ''}
    </span>
  </div>

  <!-- Price (conditionally shown) -->
  {#if showPriceField}
    <div class="sidebar-section" style="animation: slideIn var(--duration-normal) var(--ease-out);">
      <h4 class="sidebar-heading">{m.studio_content_form_price_label()}</h4>
      <div class="price-wrapper">
        <span class="price-prefix">&pound;</span>
        <input
          {...form.fields.price.as('text')}
          id="price"
          class="field-input price-input"
          min="0"
          step="0.01"
          placeholder={m.studio_content_form_price_placeholder()}
        />
      </div>
      {#if parseFloat(priceVal || '0') <= 0}
        <span class="field-warning">Paid content requires a price greater than &pound;0</span>
      {/if}
    </div>
  {/if}

  <!-- Category -->
  <div class="sidebar-section">
    <h4 class="sidebar-heading">Category</h4>
    <input
      {...form.fields.category.as('text')}
      id="category"
      class="field-input"
      placeholder="e.g. Tutorial, Review, Guide"
      maxlength="100"
    />
  </div>

  <!-- Tags -->
  <div class="sidebar-section">
    <TagsInput {tags} onchange={handleTagsChange} />
  </div>

  <!-- Danger Zone (edit only) -->
  {#if isEdit}
    <div class="sidebar-section danger-zone">
      <button
        type="button"
        class="danger-toggle"
        onclick={() => (showDangerZone = !showDangerZone)}
        aria-expanded={showDangerZone}
      >
        Danger Zone {showDangerZone ? '−' : '+'}
      </button>
      {#if showDangerZone}
        <Button
          type="button"
          variant="destructive"
          class="btn-full"
          disabled={deleting || formPending}
          onclick={onDelete}
          loading={deleting}
        >
          {deleting ? 'Deleting...' : m.studio_content_form_delete()}
        </Button>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .publish-sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    position: sticky;
    top: var(--space-6);
    align-self: start;
  }

  .sidebar-section {
    padding: var(--space-4);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .sidebar-heading {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--color-text-secondary);
    margin: 0;
  }

  /* Status badge */
  .status-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    border-radius: var(--radius-full, 9999px);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .status-badge[data-status='draft'] {
    background-color: var(--color-warning-100, var(--color-warning-50));
    color: var(--color-warning-700);
  }

  .status-badge[data-status='published'] {
    background-color: var(--color-success-100, var(--color-success-50));
    color: var(--color-success-700);
  }

  .status-badge[data-status='archived'] {
    background-color: var(--color-surface-secondary);
    color: var(--color-text-secondary);
  }

  /* Button full-width override */
  :global(.btn-full) {
    width: 100%;
  }

  /* Readiness checklist */
  .readiness-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .readiness-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .readiness-item[data-met] {
    color: var(--color-success-600);
  }

  /* Form inputs */
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
    border-color: var(--color-border-focus);
  }

  .field-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .field-warning {
    font-size: var(--text-xs);
    color: var(--color-warning-600);
  }

  /* Price */
  .price-wrapper {
    display: flex;
    align-items: stretch;
  }

  .price-prefix {
    display: flex;
    align-items: center;
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    background-color: var(--color-surface-raised, var(--color-surface));
    border: var(--border-width) var(--border-style) var(--color-border);
    border-right: none;
    border-radius: var(--radius-md) 0 0 var(--radius-md);
  }

  .price-input {
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
  }

  /* Danger zone */
  .danger-zone {
    border-color: var(--color-error-200);
  }

  .danger-toggle {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    background: none;
    border: none;
    padding: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--color-error-600);
    cursor: pointer;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      max-height: 0;
      transform: translateY(calc(-1 * var(--space-2)));
    }
    to {
      opacity: 1;
      max-height: 200px;
      transform: translateY(0);
    }
  }

</style>

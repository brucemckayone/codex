<!--
  @component PublishSidebar

  Publishing controls sidebar: status, readiness checklist,
  access type, pricing, tier, category, tags, and danger zone.

  @prop {ContentForm} form - The active form instance
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
  import { Button, Select } from '$lib/components/ui';
  import Switch from '$lib/components/ui/Switch/Switch.svelte';
  import * as m from '$paraglide/messages';
  import TagsInput from './TagsInput.svelte';
  import type { ContentWithRelations, SubscriptionTier } from '$lib/types';
  import type { createContentForm, updateContentForm } from '$lib/remote/content.remote';

  type ContentForm = typeof createContentForm | typeof updateContentForm;

  interface Props {
    form: ContentForm;
    isEdit: boolean;
    content?: ContentWithRelations;
    formPending: boolean;
    onPublishToggle: () => void;
    onDelete: () => void;
    publishing: boolean;
    deleting: boolean;
    tiers?: SubscriptionTier[];
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
    tiers = [],
  }: Props = $props();

  const currentStatus = $derived(content?.status ?? 'draft');

  // Reactive field values for readiness checks
  const titleVal = $derived(form.fields.title.value() ?? '');
  const slugVal = $derived(form.fields.slug.value() ?? '');
  const contentTypeVal = $derived(form.fields.contentType.value() ?? 'video');
  const mediaItemIdVal = $derived(form.fields.mediaItemId?.value() ?? '');
  const contentBodyVal = $derived(form.fields.contentBody?.value() ?? '');
  const accessTypeVal = $derived(form.fields.accessType?.value() ?? 'free');
  const priceVal = $derived(form.fields.price?.value() ?? '0.00');

  // Tags state (managed locally, serialized to hidden input)
  // svelte-ignore state_referenced_locally — form field: user edits must survive until submit
  let tags = $state<string[]>(content?.tags ?? []);

  function handleTagsChange(newTags: string[]) {
    tags = newTags;
  }

  // Featured flag — locally managed, serialized to hidden input. Promotes the
  // content to a full-width editorial card on the org homepage feed.
  // svelte-ignore state_referenced_locally — user edits must survive until submit
  let featured = $state<boolean>(content?.featured ?? false);

  // Access type options
  type AccessTypeOption = { value: string; label: string; description: string };
  const hasOrg = $derived(!!form.fields.organizationId?.value());
  const hasTiers = $derived(tiers.length > 0);

  const accessTypeOptions = $derived.by((): AccessTypeOption[] => {
    const options: AccessTypeOption[] = [
      {
        value: 'free',
        label: m.studio_content_form_access_free(),
        description: m.studio_content_form_access_free_desc(),
      },
      {
        value: 'paid',
        label: m.studio_content_form_access_paid(),
        description: m.studio_content_form_access_paid_desc(),
      },
    ];

    if (hasOrg) {
      options.push({
        value: 'followers',
        label: m.studio_content_form_access_followers(),
        description: m.studio_content_form_access_followers_desc(),
      });
    }

    if (hasTiers) {
      options.push({
        value: 'subscribers',
        label: m.studio_content_form_access_subscribers(),
        description: m.studio_content_form_access_subscribers_desc(),
      });
    }

    if (hasOrg) {
      options.push({
        value: 'team',
        label: m.studio_content_form_access_team(),
        description: m.studio_content_form_access_team_desc(),
      });
    }

    return options;
  });

  function handleAccessTypeChange(val: string) {
    form.fields.accessType?.set(val);

    // Clear price when switching to non-priced access types
    if (val === 'free' || val === 'followers' || val === 'team') {
      form.fields.price?.set('0.00');
    }
  }

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
    if (accessTypeVal === 'paid') {
      checks.push({
        label: 'Price set for paid content',
        met: parseFloat(priceVal || '0') > 0,
      });
    }
    if (accessTypeVal === 'subscribers') {
      checks.push({
        label: 'Subscription tier selected',
        met: !!selectedMinimumTierId,
      });
    }
    return checks;
  });

  const isReadyToPublish = $derived(readinessChecks.every((c) => c.met));
  const showPriceField = $derived(accessTypeVal === 'paid' || accessTypeVal === 'subscribers');
  const showTierField = $derived(accessTypeVal === 'subscribers' && hasTiers);
  let showDangerZone = $state(false);

  // Minimum tier selector
  // svelte-ignore state_referenced_locally — form field: user edits must survive until submit
  let selectedMinimumTierId = $state<string>(content?.minimumTierId ?? '');
  const tierSelectOptions = $derived([
    { value: '', label: 'Select a tier' },
    ...tiers.map((t) => ({ value: t.id, label: `${t.name}` })),
  ]);

  function handleTierChange(val: string | undefined) {
    selectedMinimumTierId = val ?? '';
  }

  // Derive a legacy visibility value for backwards compat
  const derivedVisibility = $derived.by(() => {
    switch (accessTypeVal) {
      case 'paid':
      case 'subscribers':
        return 'purchased_only';
      case 'followers':
      case 'team':
        return 'members_only';
      default:
        return 'public';
    }
  });
</script>

<aside class="publish-sidebar">
  <!-- Hidden inputs for form submission -->
  <input type="hidden" name="tags" value={JSON.stringify(tags)} />
  <input type="hidden" name="accessType" value={accessTypeVal} />
  <input type="hidden" name="visibility" value={derivedVisibility} />
  <input type="hidden" name="minimumTierId" value={selectedMinimumTierId || ''} />
  <input type="hidden" name="featured" value={featured ? 'true' : ''} />
  {#if !showPriceField}
    <input type="hidden" name="price" value={priceVal} />
  {/if}

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
        aria-describedby={!isReadyToPublish ? 'publish-hint' : undefined}
        loading={publishing}
      >
        {#if publishing}
          {m.studio_content_form_publishing()}
        {:else}
          {m.studio_content_form_publish()}
        {/if}
      </Button>
      {#if !isReadyToPublish}
        <p class="field-hint" id="publish-hint">
          Complete all readiness checks before publishing
        </p>
      {/if}
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

  <!-- Access Type — the label (treated as the disclosure trigger) carries
       aria-expanded/aria-controls; the underlying radio input handles the
       native radiogroup keyboard semantics. aria-expanded is not supported on
       role="radio", so the disclosure relationship lives on the label. -->
  <div class="sidebar-section">
    <h4 class="sidebar-heading">{m.studio_content_form_access_label()}</h4>
    <div class="access-options" role="radiogroup" aria-label="Content access type">
      {#each accessTypeOptions as option (option.value)}
        {@const controls =
          option.value === 'paid'
            ? 'paid-settings-panel'
            : option.value === 'subscribers'
              ? 'member-settings-panel'
              : undefined}
        {@const isExpanded =
          option.value === 'paid'
            ? showPriceField
            : option.value === 'subscribers'
              ? showTierField || showPriceField
              : undefined}
        <label
          class="access-option"
          data-selected={accessTypeVal === option.value || undefined}
          aria-controls={controls}
          aria-expanded={isExpanded}
        >
          <input
            type="radio"
            name="_accessTypeRadio"
            value={option.value}
            checked={accessTypeVal === option.value}
            onchange={() => handleAccessTypeChange(option.value)}
            class="access-radio"
          />
          <div class="access-option-content">
            <span class="access-option-label">{option.label}</span>
            <span class="access-option-desc">{option.description}</span>
          </div>
        </label>
      {/each}
    </div>
  </div>

  <!-- Price panel (revealed when access is paid or subscribers).
       <section> implicitly has role="region" when labelled, so no explicit role. -->
  {#if showPriceField}
    <section
      id="paid-settings-panel"
      class="sidebar-section sidebar-section--revealed"
      aria-live="polite"
      data-revealed="true"
    >
      <h4 class="sidebar-heading">
        {#if accessTypeVal === 'subscribers'}
          {m.studio_content_form_access_also_purchasable()}
        {:else}
          {m.studio_content_form_price_label()}
        {/if}
      </h4>
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
      {#if accessTypeVal === 'paid' && parseFloat(priceVal || '0') <= 0}
        <span class="field-warning">Paid content requires a price greater than &pound;0</span>
      {:else if accessTypeVal === 'subscribers'}
        <span class="field-hint">Optional. Leave at &pound;0 if only available via subscription.</span>
      {/if}
    </section>
  {/if}

  <!-- Tier panel (revealed when access is subscribers and tiers exist) -->
  {#if showTierField}
    <section
      id="member-settings-panel"
      class="sidebar-section sidebar-section--revealed"
      aria-live="polite"
      data-revealed="true"
    >
      <h4 class="sidebar-heading">Minimum Tier</h4>
      <Select
        options={tierSelectOptions}
        value={selectedMinimumTierId}
        onValueChange={handleTierChange}
        placeholder="Select a minimum tier"
      />
      <span class="field-hint">
        Subscribers at or above this tier can access this content.
      </span>
    </section>
  {/if}

  <!-- Category -->
  <div class="sidebar-section">
    <h4 class="sidebar-heading">Category <span class="optional-hint">Optional</span></h4>
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

  <!-- Homepage feature flag — promotes content to a full-width editorial card -->
  <div class="sidebar-section">
    <div class="feature-row">
      <div class="feature-label">
        <h4 class="sidebar-heading">Feature on homepage</h4>
        <p class="feature-desc">
          Promote this content to a full-width editorial card on the org landing page.
        </p>
      </div>
      <Switch
        bind:checked={featured}
        aria-label="Feature on homepage"
      />
    </div>
  </div>

  <!-- Danger Zone (edit only) -->
  {#if isEdit}
    <div class="sidebar-section danger-zone">
      <button
        type="button"
        class="danger-toggle"
        onclick={() => (showDangerZone = !showDangerZone)}
        aria-expanded={showDangerZone}
        aria-controls="danger-zone-region"
      >
        <span>Danger Zone</span>
        <span aria-hidden="true">{showDangerZone ? '−' : '+'}</span>
      </button>
      {#if showDangerZone}
        <div id="danger-zone-region">
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
        </div>
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

  .optional-hint {
    font-weight: var(--font-normal);
    text-transform: none;
    letter-spacing: normal;
    color: var(--color-text-muted);
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
    border-radius: var(--radius-full);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  .status-badge[data-status='draft'] {
    background-color: var(--color-warning-100);
    color: var(--color-warning-700);
  }

  .status-badge[data-status='published'] {
    background-color: var(--color-success-100);
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

  .field-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .field-warning {
    font-size: var(--text-xs);
    color: var(--color-warning-600);
  }

  /* Access type radio group */
  .access-options {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .access-option {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    cursor: pointer;
    transition: border-color var(--duration-fast) var(--ease-out),
                background-color var(--duration-fast) var(--ease-out);
  }

  .access-option:hover {
    border-color: var(--color-border-hover);
  }

  .access-option[data-selected] {
    border-color: var(--color-interactive);
    background-color: var(--color-interactive-subtle);
  }

  .access-radio {
    margin-top: var(--space-1);
    accent-color: var(--color-interactive);
  }

  .access-option-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .access-option-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .access-option-desc {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-relaxed);
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
    background-color: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-right: none;
    border-radius: var(--radius-md) 0 0 var(--radius-md);
  }

  .price-input {
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
  }

  /* Homepage feature flag row */
  .feature-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .feature-label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .feature-desc {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-relaxed);
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

  .danger-toggle:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  /* Reveal animation — driven by data-revealed on .sidebar-section--revealed
     instead of inline style="animation: …" so the scoped rule is token-linted
     and the reduced-motion guard works. */
  .sidebar-section--revealed[data-revealed='true'] {
    animation: slideIn var(--duration-normal) var(--ease-out);
  }

  @media (prefers-reduced-motion: reduce) {
    .sidebar-section--revealed[data-revealed='true'] {
      animation: none;
    }
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

<!--
  @component ContentForm

  Handles content creation and editing. Auto-generates slug from title,
  supports all content types and visibility options, with delete confirmation.

  @prop {ContentWithRelations} [content] - Existing content (edit mode) or undefined (create mode)
  @prop {string} organizationId - Organization UUID

  @example
  <ContentForm {organizationId} />
  <ContentForm {content} {organizationId} />
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { Button, Input, Label, Select, TextArea, ConfirmDialog } from '$lib/components/ui';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import {
    createContent,
    updateContent,
    deleteContent,
  } from '$lib/remote/content.remote';
  import type { ContentWithRelations } from '$lib/types';

  interface Props {
    content?: ContentWithRelations;
    organizationId: string;
  }

  const { content, organizationId }: Props = $props();

  const isEdit = $derived(!!content);

  // ── Form State ──────────────────────────────────────────────────────────
  // Capture initial prop values with untrack to avoid state_referenced_locally warnings.
  // Form fields are intentionally independent of prop changes after mount.
  let title = $state(untrack(() => content?.title ?? ''));
  let slug = $state(untrack(() => content?.slug ?? ''));
  let description = $state(untrack(() => content?.description ?? ''));
  let contentType = $state(untrack(() => content?.contentType ?? 'video'));
  let visibility = $state(untrack(() => content?.visibility ?? 'public'));
  let priceCents = $state(untrack(() => content?.priceCents ?? 0));

  let submitting = $state(false);
  let slugManuallyEdited = $state(untrack(() => !!content));
  let showDeleteConfirm = $state(false);
  let deleting = $state(false);

  // ── Auto-slug from title ────────────────────────────────────────────────
  function generateSlug(value: string): string {
    return value
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }

  function handleTitleInput() {
    if (!slugManuallyEdited) {
      slug = generateSlug(title);
    }
  }

  function handleSlugInput() {
    slugManuallyEdited = true;
  }

  // ── Select Options ──────────────────────────────────────────────────────
  const contentTypeOptions = [
    { value: 'video', label: m.studio_content_form_type_video() },
    { value: 'audio', label: m.studio_content_form_type_audio() },
    { value: 'written', label: m.studio_content_form_type_article() },
  ];

  const visibilityOptions = [
    { value: 'public', label: m.studio_content_form_visibility_public() },
    { value: 'private', label: m.studio_content_form_visibility_private() },
    {
      value: 'members_only',
      label: m.studio_content_form_visibility_members_only(),
    },
    {
      value: 'purchased_only',
      label: m.studio_content_form_visibility_purchased_only(),
    },
  ];

  // ── Submit ──────────────────────────────────────────────────────────────
  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    submitting = true;

    try {
      const payload = {
        title,
        slug,
        description: description || null,
        contentType: contentType as 'video' | 'audio' | 'written',
        visibility: visibility as
          | 'public'
          | 'private'
          | 'members_only'
          | 'purchased_only',
        priceCents: priceCents || 0,
        organizationId,
      };

      if (isEdit && content) {
        await updateContent({ id: content.id, data: payload });
        toast.success(m.studio_content_form_update_success());
      } else {
        await createContent(payload);
        toast.success(m.studio_content_form_create_success());
        goto(`/studio/content`);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : isEdit
          ? m.studio_content_form_update_error()
          : m.studio_content_form_create_error();
      toast.error(message);
    } finally {
      submitting = false;
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!content) return;
    deleting = true;

    try {
      await deleteContent(content.id);
      toast.success(m.studio_content_form_delete_success());
      goto(`/studio/content`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : m.studio_content_form_delete_error();
      toast.error(message);
    } finally {
      deleting = false;
    }
  }
</script>

<form class="content-form" onsubmit={handleSubmit}>
  <div class="form-header">
    <a href="/studio/content" class="back-link">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="19" y1="12" x2="5" y2="12"></line>
        <polyline points="12 19 5 12 12 5"></polyline>
      </svg>
      {m.studio_content_form_back_to_content()}
    </a>
    <h1>
      {isEdit
        ? m.studio_content_form_edit_title()
        : m.studio_content_form_create_title()}
    </h1>
  </div>

  <div class="form-body">
    <!-- Title -->
    <div class="form-field">
      <Label for="content-title">{m.studio_content_form_title_label()}</Label>
      <Input
        id="content-title"
        bind:value={title}
        oninput={handleTitleInput}
        placeholder={m.studio_content_form_title_placeholder()}
        required
      />
    </div>

    <!-- Slug -->
    <div class="form-field">
      <Label for="content-slug">{m.studio_content_form_slug_label()}</Label>
      <Input
        id="content-slug"
        bind:value={slug}
        oninput={handleSlugInput}
        placeholder={m.studio_content_form_slug_placeholder()}
        required
      />
    </div>

    <!-- Description -->
    <div class="form-field">
      <Label for="content-description">{m.studio_content_form_description_label()}</Label>
      <TextArea
        id="content-description"
        bind:value={description}
        placeholder={m.studio_content_form_description_placeholder()}
        rows={4}
      />
    </div>

    <!-- Content Type -->
    <div class="form-field">
      <Select
        options={contentTypeOptions}
        bind:value={contentType}
        label={m.studio_content_form_content_type_label()}
      />
    </div>

    <!-- Visibility -->
    <div class="form-field">
      <Select
        options={visibilityOptions}
        bind:value={visibility}
        label={m.studio_content_form_visibility_label()}
      />
    </div>

    <!-- Price -->
    <div class="form-field">
      <Label for="content-price">{m.studio_content_form_price_label()}</Label>
      <Input
        id="content-price"
        type="number"
        bind:value={priceCents}
        min="0"
        placeholder={m.studio_content_form_price_placeholder()}
      />
      <span class="form-help">{m.studio_content_form_price_help()}</span>
    </div>
  </div>

  <div class="form-actions">
    <Button type="submit" loading={submitting} disabled={submitting}>
      {#if submitting}
        {m.studio_content_form_submitting()}
      {:else if isEdit}
        {m.studio_content_form_submit_update()}
      {:else}
        {m.studio_content_form_submit_create()}
      {/if}
    </Button>

    {#if isEdit}
      <Button
        type="button"
        variant="destructive"
        loading={deleting}
        disabled={deleting}
        onclick={() => (showDeleteConfirm = true)}
      >
        {m.studio_content_form_delete()}
      </Button>
    {/if}
  </div>
</form>

<ConfirmDialog
  bind:open={showDeleteConfirm}
  title={m.studio_content_form_delete_confirm_title()}
  description={m.studio_content_form_delete_confirm_description()}
  confirmText={m.studio_content_form_delete()}
  cancelText={m.common_cancel()}
  variant="destructive"
  onConfirm={handleDelete}
/>

<style>
  .content-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 640px;
  }

  .form-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .form-header h1 {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .back-link:hover {
    color: var(--color-text);
  }

  .form-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .form-help {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .form-actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  /* Dark mode */
  :global([data-theme='dark']) .form-header h1 {
    color: var(--color-text-dark);
  }
</style>

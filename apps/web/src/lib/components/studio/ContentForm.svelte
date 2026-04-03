<!--
  @component ContentForm

  Content creation and editing form with progressive enhancement.
  Two-column layout: main content area + sticky publishing sidebar.

  @prop {ContentWithRelations} [content] - Existing content (edit mode) or undefined (create mode)
  @prop {string} organizationId - Organization UUID
  @prop {string} orgSlug - Organization slug for URL preview
  @prop {MediaItemOption[]} [mediaItems] - Available media items for picker
-->
<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { ArrowLeftIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import { goto } from '$app/navigation';
  import { ConfirmDialog } from '$lib/components/ui';
  import {
    createContentForm,
    updateContentForm,
    deleteContent,
    publishContent,
    unpublishContent,
  } from '$lib/remote/content.remote';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import type { ContentWithRelations } from '$lib/types';

  // Sub-components
  import ContentTypeSelector from './content-form/ContentTypeSelector.svelte';
  import ContentDetails from './content-form/ContentDetails.svelte';
  import MediaSection from './content-form/MediaSection.svelte';
  import WrittenContentEditor from './content-form/WrittenContentEditor.svelte';
  import ThumbnailUpload from './content-form/ThumbnailUpload.svelte';
  import PublishSidebar from './content-form/PublishSidebar.svelte';

  interface MediaItemOption {
    id: string;
    title: string;
    mediaType: string;
    durationSeconds?: number | null;
    fileSizeBytes?: number | null;
    status?: string;
    thumbnailKey?: string | null;
  }

  interface Props {
    content?: ContentWithRelations;
    organizationId: string | null;
    orgSlug: string | null;
    mediaItems?: MediaItemOption[];
    onSuccess?: () => void;
  }

  const { content, organizationId, orgSlug, mediaItems = [], onSuccess }: Props = $props();

  const isEdit = $derived(!!content);
  const form = $derived(isEdit ? updateContentForm : createContentForm);

  // ── Local UI state ──────────────────────────────────────────────────────
  let showDeleteConfirm = $state(false);
  let showUnsavedDialog = $state(false);
  let deleting = $state(false);
  let publishing = $state(false);
  let confirmLeave = $state(false);
  let showSuccess = $state(false);
  let successTimeout: ReturnType<typeof setTimeout> | null = null;

  const contentTypeVal = $derived(form.fields.contentType.value() ?? content?.contentType ?? 'video');
  const formPending = $derived(form.pending > 0);

  onDestroy(() => {
    if (successTimeout) clearTimeout(successTimeout);
  });

  // ── Populate form fields for edit mode ─────────────────────────────────
  $effect(() => {
    if (isEdit && content) {
      updateContentForm.fields.set({
        contentId: content.id,
        organizationId: organizationId ?? '',
        title: content.title ?? '',
        slug: content.slug ?? '',
        description: content.description ?? '',
        contentType: content.contentType ?? 'video',
        mediaItemId: content.mediaItemId ?? '',
        contentBody: content.contentBody ?? '',
        visibility: content.visibility ?? 'public',
        price: content.priceCents ? (content.priceCents / 100).toFixed(2) : '0.00',
        category: content.category ?? '',
        tags: JSON.stringify(content.tags ?? []),
        thumbnailUrl: content.thumbnailUrl ?? '',
      });
    } else {
      createContentForm.fields.set({
        organizationId: organizationId ?? '',
        title: '',
        slug: '',
        description: '',
        contentType: 'video',
        mediaItemId: '',
        contentBody: '',
        visibility: 'public',
        price: '0.00',
        category: '',
        tags: '[]',
        thumbnailUrl: '',
      });
    }
  });

  // ── Unsaved changes guard ─────────────────────────────────────────────
  let pendingNavigation: { url: URL; cancel: () => void } | null = null;

  beforeNavigate((navigation) => {
    // Skip guard if form is submitting or user confirmed leave
    if (formPending || confirmLeave) return;

    // Check if any field has been modified (basic dirty check)
    // For now, we'll only guard in edit mode or if title has content
    const titleVal = form.fields.title.value() ?? '';
    if (!isEdit && !titleVal.trim()) return; // Nothing entered yet in create mode

    navigation.cancel();
    pendingNavigation = { url: navigation.to?.url ?? new URL('/studio/content', window.location.origin), cancel: () => {} };
    showUnsavedDialog = true;
  });

  function handleConfirmLeave() {
    confirmLeave = true;
    showUnsavedDialog = false;
    if (pendingNavigation) {
      goto(pendingNavigation.url.pathname + pendingNavigation.url.search);
    }
  }

  // Browser close/refresh guard
  $effect(() => {
    const titleVal = form.fields.title.value() ?? '';
    const shouldGuard = isEdit || titleVal.trim().length > 0;
    if (shouldGuard && !formPending) {
      const handler = (e: BeforeUnloadEvent) => e.preventDefault();
      window.addEventListener('beforeunload', handler);
      return () => window.removeEventListener('beforeunload', handler);
    }
  });

  // ── Result handlers ────────────────────────────────────────────────────
  function handleCreateSuccess() {
    tick().then(() => {
      confirmLeave = true;
      toast.success(m.studio_content_form_create_success());
      onSuccess?.();
      goto('/studio/content');
    });
  }

  function handleUpdateSuccess() {
    tick().then(() => {
      showSuccess = true;
      if (successTimeout) clearTimeout(successTimeout);
      successTimeout = setTimeout(() => (showSuccess = false), 3000);
    });
  }

  // ── Publish / Unpublish ───────────────────────────────────────────────
  async function handlePublishToggle() {
    if (!content) return;
    publishing = true;
    const previousStatus = content.status;
    try {
      if (content.status === 'published') {
        content.status = 'draft';
        await unpublishContent(content.id);
        toast.success(m.studio_content_form_unpublish_success());
      } else {
        content.status = 'published';
        await publishContent(content.id);
        toast.success(m.studio_content_form_publish_success());
      }
    } catch (err) {
      content.status = previousStatus;
      const message =
        err instanceof Error
          ? err.message
          : previousStatus === 'published'
            ? m.studio_content_form_unpublish_error()
            : m.studio_content_form_publish_error();
      toast.error(message);
    } finally {
      publishing = false;
    }
  }

  async function handleDelete() {
    showDeleteConfirm = false;
    if (!content) return;
    deleting = true;
    try {
      confirmLeave = true;
      await deleteContent(content.id);
      toast.success(m.studio_content_form_delete_success());
      goto('/studio/content');
    } catch (err) {
      confirmLeave = false;
      const message = err instanceof Error ? err.message : m.studio_content_form_delete_error();
      toast.error(message);
    } finally {
      deleting = false;
    }
  }

  // Get media thumbnail URL if available
  const selectedMediaId = $derived(form.fields.mediaItemId?.value() ?? '');
  const selectedMedia = $derived(
    selectedMediaId ? mediaItems.find((m) => m.id === selectedMediaId) : null
  );
  const mediaThumbnailUrl = $derived(
    selectedMedia?.thumbnailKey
      ? `/cdn/${selectedMedia.thumbnailKey}`
      : null
  );
</script>

<div class="content-page">
  <div class="page-header">
    <a href="/studio/content" class="back-link">
      <ArrowLeftIcon size={16} />
      {m.studio_content_form_back_to_content()}
    </a>
    <h1 class="page-title">
      {isEdit ? m.studio_content_form_edit_title() : m.studio_content_form_create_title()}
    </h1>
  </div>

  <!-- Success message -->
  {#if showSuccess}
    <div class="success-message" role="status" aria-live="polite">
      {m.studio_content_form_update_success()}
    </div>
  {/if}

  <!-- Trigger redirects/toasts when form result changes (template-reactive) -->
  {#if !isEdit && createContentForm.result?.success}
    {@const _ = handleCreateSuccess()}
  {/if}
  {#if isEdit && updateContentForm.result?.success}
    {@const _ = handleUpdateSuccess()}
  {/if}

  <!-- Error message -->
  {#if form.result?.error}
    <div class="error-message" role="alert">
      {form.result.error}
    </div>
  {/if}

  <form
    {...form}
    class="content-form-layout"
    novalidate
    oninput={() => form.validate()}
  >
    <input type="hidden" name="organizationId" value={organizationId ?? ''} />
    {#if isEdit && content}
      <input type="hidden" name="contentId" value={content.id} />
    {/if}

    <!-- ═══ MAIN COLUMN ═══ -->
    <div class="main-column">
      <!-- Content Type -->
      <ContentTypeSelector {form} {isEdit} currentType={content?.contentType} />

      <!-- Details (Title, Slug, Description) -->
      <ContentDetails {form} {orgSlug} />

      <!-- Media Section (video/audio only) -->
      {#if contentTypeVal === 'video' || contentTypeVal === 'audio'}
        <MediaSection {form} {mediaItems} {orgSlug} />
      {/if}

      <!-- Written Content Editor (written only) -->
      {#if contentTypeVal === 'written'}
        <WrittenContentEditor {form} />
      {/if}

      <!-- Thumbnail -->
      <ThumbnailUpload {form} {mediaThumbnailUrl} />
    </div>

    <!-- ═══ SIDEBAR ═══ -->
    <PublishSidebar
      {form}
      {isEdit}
      {content}
      {formPending}
      {publishing}
      {deleting}
      onPublishToggle={handlePublishToggle}
      onDelete={() => (showDeleteConfirm = true)}
    />
  </form>
</div>

<!-- Delete confirmation -->
<ConfirmDialog
  bind:open={showDeleteConfirm}
  title={m.studio_content_form_delete_confirm_title()}
  description={m.studio_content_form_delete_confirm_description()}
  confirmText={m.studio_content_form_delete()}
  cancelText={m.common_cancel()}
  variant="destructive"
  onConfirm={handleDelete}
/>

<!-- Unsaved changes confirmation -->
<ConfirmDialog
  bind:open={showUnsavedDialog}
  title="Unsaved Changes"
  description="You have unsaved changes. Are you sure you want to leave?"
  confirmText="Leave"
  cancelText="Stay"
  variant="destructive"
  onConfirm={handleConfirmLeave}
/>

<style>
  .content-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: var(--container-lg, 1024px);
  }

  .page-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .page-title {
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

  /* Two-column layout */
  .content-form-layout {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-6);
  }

  @media (min-width: 768px) {
    .content-form-layout {
      grid-template-columns: 1fr 280px;
    }
  }

  .main-column {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
  }

  /* Success/error messages */
  .success-message {
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background-color: var(--color-success-50);
    border: var(--border-width) var(--border-style) var(--color-success-200);
    color: var(--color-success-700);
    font-size: var(--text-sm);
  }

  .error-message {
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background-color: var(--color-error-50);
    border: var(--border-width) var(--border-style) var(--color-error-200);
    color: var(--color-error-700);
    font-size: var(--text-sm);
  }

  /* Mobile sticky save bar */
  @media (max-width: 767px) {
    .content-form-layout :global(.publish-sidebar) {
      position: static;
    }
  }

  /* Dark mode */
  :global([data-theme='dark']) .page-title {
    color: var(--color-text);
  }

  :global([data-theme='dark']) .success-message {
    background-color: var(--color-success-900);
    border-color: var(--color-success-700);
    color: var(--color-success-100);
  }

  :global([data-theme='dark']) .error-message {
    background-color: var(--color-error-900);
    border-color: var(--color-error-700);
    color: var(--color-error-100);
  }
</style>

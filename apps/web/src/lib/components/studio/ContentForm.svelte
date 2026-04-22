<!--
  @component ContentForm

  Content creation and editing form. Hard-core redesigned layout:
  - Sticky command bar top (breadcrumb + status + readiness + primary actions)
  - Left section rail (numbered outline, anchor nav, per-section readiness pips)
  - Main column (numbered form-section cards, full studio width)
  - Inline ReadinessPanel at bottom + DangerZone for edit mode.

  No right sidebar — every control is visible without scrolling through a
  stacked aside. Full-width on wide screens via --container-studio.

  @prop {ContentWithRelations} [content] - Existing content (edit mode) or undefined (create mode)
  @prop {string} organizationId - Organization UUID
  @prop {string} orgSlug - Organization slug for URL preview
  @prop {MediaItemOption[]} [mediaItems] - Available media items for picker
-->
<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { browser } from '$app/environment';
  import * as m from '$paraglide/messages';
  import { goto } from '$app/navigation';
  import { ConfirmDialog, Alert } from '$lib/components/ui';
  import {
    createContentForm,
    updateContentForm,
    deleteContent,
  } from '$lib/remote/content.remote';
  import { togglePublishStatus, type ContentStatus } from './publish-toggle';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import type { ContentWithRelations, SubscriptionTier } from '$lib/types';

  // Sub-components
  import ContentTypeSelector from './content-form/ContentTypeSelector.svelte';
  import ContentDetails from './content-form/ContentDetails.svelte';
  import MediaSection from './content-form/MediaSection.svelte';
  import WrittenContentEditor from './content-form/WrittenContentEditor.svelte';
  import ThumbnailUpload from './content-form/ThumbnailUpload.svelte';
  import ShaderPicker from './content-form/ShaderPicker.svelte';
  import ContentFormCommandBar from './content-form/ContentFormCommandBar.svelte';
  import ContentFormSectionRail from './content-form/ContentFormSectionRail.svelte';
  import FormSection from './content-form/FormSection.svelte';
  import AccessSection from './content-form/AccessSection.svelte';
  import OrganizeSection from './content-form/OrganizeSection.svelte';
  import ReadinessPanel from './content-form/ReadinessPanel.svelte';
  import DangerZone from './content-form/DangerZone.svelte';

  interface MediaItemOption {
    id: string;
    title: string;
    mediaType: string;
    durationSeconds?: number | null;
    fileSizeBytes?: number | null;
    status?: string;
    thumbnailKey?: string | null;
    thumbnailUrl?: string | null;
  }

  interface Props {
    content?: ContentWithRelations;
    organizationId: string | null;
    orgSlug: string | null;
    creatorUsername?: string | null;
    mediaItems?: MediaItemOption[];
    tiers?: SubscriptionTier[];
    onSuccess?: () => void;
  }

  const {
    content,
    organizationId,
    orgSlug,
    creatorUsername,
    mediaItems = [],
    tiers = [],
    onSuccess,
  }: Props = $props();

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

  // Local status tracking — content prop may be derived (immutable),
  // so we track status separately for optimistic publish/unpublish updates.
  let contentStatus = $state<string>(content?.status ?? 'draft');
  $effect(() => {
    contentStatus = content?.status ?? 'draft';
  });

  // Shader preset for immersive audio mode
  let shaderPreset = $state<string | null>(content?.shaderPreset ?? null);

  // Tags + featured + minimum tier: locally managed, serialized to hidden input
  // svelte-ignore state_referenced_locally — form field: user edits must survive until submit
  let tags = $state<string[]>(content?.tags ?? []);
  // svelte-ignore state_referenced_locally — user edits must survive until submit
  let featured = $state<boolean>(content?.featured ?? false);
  // svelte-ignore state_referenced_locally — form field: user edits must survive until submit
  let selectedMinimumTierId = $state<string>(content?.minimumTierId ?? '');

  const contentTypeVal = $derived(form.fields.contentType.value() ?? content?.contentType ?? 'video');
  const formPending = $derived(form.pending > 0);

  // Reactive field values for readiness + access
  const titleVal = $derived(form.fields.title.value() ?? '');
  const slugVal = $derived(form.fields.slug.value() ?? '');
  const mediaItemIdVal = $derived(form.fields.mediaItemId?.value() ?? '');
  const contentBodyVal = $derived(form.fields.contentBody?.value() ?? '');
  const accessTypeVal = $derived(form.fields.accessType?.value() ?? 'free');
  const priceVal = $derived(form.fields.price?.value() ?? '0.00');

  // ── Layout refs ─────────────────────────────────────────────────────────
  let layoutEl: HTMLFormElement | undefined = $state();

  // ── Sidebar: no-op ──────────────────────────────────────────────────────
  // The studio shell redesign (iter-10) switched the sidebar to a
  // hover-expand rail — it is always visually collapsed until the user
  // hovers/focuses it. That means the ContentForm page automatically has
  // maximum horizontal room without any extra plumbing from this component.
  // No collapse-on-mount effect is needed.

  // Measure the command bar height and expose it as --cf-bar-height so the
  // rail can stick exactly below the bar without magic numbers. ResizeObserver
  // keeps it correct on viewport / content changes.
  $effect(() => {
    if (!browser || !layoutEl) return;
    const layout = layoutEl;
    const target = layout.querySelector<HTMLElement>('.command-bar');
    if (!target) return;
    const apply = () => {
      const h = Math.round(target.getBoundingClientRect().height);
      if (h > 0) layout.style.setProperty('--cf-bar-height', `${h}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(target);
    return () => ro.disconnect();
  });

  onDestroy(() => {
    if (successTimeout) clearTimeout(successTimeout);
  });

  // ── Populate form fields for edit mode (one-time initialization) ────────
  // untrack prevents re-running when content updates after save,
  // which would reset user edits (e.g. newly selected mediaItemId)
  let formInitialized = false;
  $effect(() => {
    if (formInitialized) return;
    if (isEdit && content) {
      formInitialized = true;
      untrack(() => {
        updateContentForm.fields.set({
          contentId: content!.id,
          organizationId: organizationId ?? '',
          title: content!.title ?? '',
          slug: content!.slug ?? '',
          description: content!.description ?? '',
          contentType: content!.contentType ?? 'video',
          mediaItemId: content!.mediaItemId ?? '',
          contentBody: content!.contentBodyJson
            ? JSON.stringify(content!.contentBodyJson)
            : content!.contentBody ?? '',
          accessType: content!.accessType ?? 'free',
          visibility: content!.visibility ?? 'public',
          price: content!.priceCents ? (content!.priceCents / 100).toFixed(2) : '0.00',
          category: content!.category ?? '',
          tags: JSON.stringify(content!.tags ?? []),
          thumbnailUrl: content!.thumbnailUrl ?? '',
          shaderPreset: content!.shaderPreset ?? '',
          featured: content!.featured ? 'true' : '',
        });
      });
    } else if (!isEdit) {
      createContentForm.fields.set({
        organizationId: organizationId ?? '',
        title: '',
        slug: '',
        description: '',
        contentType: 'video',
        mediaItemId: '',
        contentBody: '',
        accessType: 'free',
        visibility: 'public',
        price: '0.00',
        category: '',
        tags: '[]',
        thumbnailUrl: '',
        shaderPreset: '',
        featured: '',
      });
    }
  });

  // ── Unsaved changes guard ─────────────────────────────────────────────
  let pendingNavigation: { url: URL; cancel: () => void } | null = null;

  beforeNavigate((navigation) => {
    if (formPending || confirmLeave) return;
    const titleValRaw = form.fields.title.value() ?? '';
    if (!isEdit && !titleValRaw.trim()) return;

    navigation.cancel();
    pendingNavigation = {
      url: navigation.to?.url ?? new URL('/studio/content', window.location.origin),
      cancel: () => {},
    };
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
    const titleValRaw = form.fields.title.value() ?? '';
    const shouldGuard = isEdit || titleValRaw.trim().length > 0;
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
    const previousStatus = contentStatus;
    try {
      const optimistic = contentStatus === 'published' ? 'draft' : 'published';
      contentStatus = optimistic;
      await togglePublishStatus(content.id, previousStatus as ContentStatus);
    } catch {
      contentStatus = previousStatus;
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

  // Selected media thumbnail (for ThumbnailUpload auto-extract)
  const selectedMediaId = $derived(form.fields.mediaItemId?.value() ?? '');
  const selectedMedia = $derived(
    selectedMediaId ? mediaItems.find((mi) => mi.id === selectedMediaId) : null
  );
  const mediaThumbnailUrl = $derived(selectedMedia?.thumbnailUrl ?? null);

  // ── Readiness checks ─────────────────────────────────────────────────
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
      checks.push({ label: 'Price set for paid content', met: parseFloat(priceVal || '0') > 0 });
    }
    if (accessTypeVal === 'subscribers') {
      checks.push({ label: 'Subscription tier selected', met: !!selectedMinimumTierId });
    }
    return checks;
  });

  const readinessMet = $derived(readinessChecks.filter((c) => c.met).length);
  const readinessTotal = $derived(readinessChecks.length);

  // ── Per-section readiness (for the left rail) ────────────────────────
  // Each section maps to one or more readiness checks; a section is
  // "ready" when all of its relevant checks are met. Sections without
  // readiness checks are marked unscored (dashed pip).
  const detailsReady = $derived(
    !!titleVal.trim() && !!slugVal.trim() && /^[a-z0-9-]+$/.test(slugVal)
  );
  const mediaReady = $derived(!!mediaItemIdVal);
  const bodyReady = $derived(!!contentBodyVal.trim());
  const accessReady = $derived(
    accessTypeVal === 'paid'
      ? parseFloat(priceVal || '0') > 0
      : accessTypeVal === 'subscribers'
        ? !!selectedMinimumTierId
        : true
  );

  const sections = $derived.by(() => {
    const list: { id: string; label: string; ready?: boolean }[] = [];
    if (!isEdit) list.push({ id: 'section-type', label: 'Content type' });
    list.push({ id: 'section-details', label: 'Details', ready: detailsReady });
    if (contentTypeVal === 'video' || contentTypeVal === 'audio') {
      list.push({ id: 'section-media', label: 'Media', ready: mediaReady });
    }
    if (contentTypeVal === 'audio') {
      list.push({ id: 'section-shader', label: 'Immersive shader' });
    }
    list.push({
      id: 'section-body',
      label: contentTypeVal === 'written' ? 'Body' : 'Notes',
      ready: contentTypeVal === 'written' ? bodyReady : undefined,
    });
    list.push({ id: 'section-thumbnail', label: 'Thumbnail' });
    list.push({ id: 'section-access', label: 'Access & price', ready: accessReady });
    list.push({ id: 'section-organize', label: 'Organize' });
    list.push({ id: 'section-review', label: 'Review & publish' });
    if (isEdit) list.push({ id: 'section-danger', label: 'Danger zone' });
    return list;
  });

  // ── Access handlers ──────────────────────────────────────────────────
  type AccessType = 'free' | 'paid' | 'followers' | 'subscribers' | 'team';
  function handleAccessChange(val: string) {
    form.fields.accessType?.set(val as AccessType);
    if (val === 'free' || val === 'followers' || val === 'team') {
      form.fields.price?.set('0.00');
      // Tier is only meaningful for 'subscribers' (required) and 'paid' (optional, hybrid mode).
      // Clear any leftover tier state when switching to a mode that can't have one, so the
      // hidden input submits '' → coerced to null on the server.
      selectedMinimumTierId = '';
    }
  }

  function handleTierChange(val: string | undefined) {
    selectedMinimumTierId = val ?? '';
  }

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

  // Map section id -> index in the `sections` array so the numeric
  // prefix on each rendered <FormSection> matches the rail.
  const sectionIndex = $derived.by(() => {
    const map = new Map<string, number>();
    sections.forEach((s, i) => map.set(s.id, i));
    return map;
  });

  function ordFor(id: string): string {
    const i = sectionIndex.get(id);
    return ((i ?? 0) + 1).toString().padStart(2, '0');
  }
</script>

<div class="content-page">
  <form
    {...form}
    bind:this={layoutEl}
    class="content-form-layout"
    novalidate
    oninput={() => form.validate()}
  >
    <input type="hidden" name="organizationId" value={organizationId ?? ''} />
    {#if isEdit && content}
      <input type="hidden" name="contentId" value={content.id} />
    {/if}

    <!-- ── COMMAND BAR ── -->
    <ContentFormCommandBar
      {isEdit}
      {contentStatus}
      {formPending}
      {publishing}
      {deleting}
      {readinessMet}
      {readinessTotal}
      onPublishToggle={handlePublishToggle}
    />

    <!-- ── LEFT RAIL ── -->
    <aside class="rail-slot">
      <ContentFormSectionRail {sections} />
    </aside>

    <!-- ── MAIN COLUMN ── -->
    <div class="body-slot">
      {#if showSuccess}
        <Alert variant="success">{m.studio_content_form_update_success()}</Alert>
      {/if}

      {#if !isEdit && createContentForm.result?.success}
        {@const _ = handleCreateSuccess()}
      {/if}
      {#if isEdit && updateContentForm.result?.success}
        {@const _ = handleUpdateSuccess()}
      {/if}

      {#if form.result?.error}
        <Alert variant="error">{form.result.error}</Alert>
      {/if}

      {#if !isEdit}
        <FormSection
          id="section-type"
          ordinal={ordFor('section-type')}
          title={m.studio_content_form_content_type_label()}
          description="Choose how this piece of content is delivered."
        >
          <ContentTypeSelector {form} {isEdit} currentType={content?.contentType} />
        </FormSection>
      {:else}
        <!-- In edit mode the hidden input for contentType is required -->
        <ContentTypeSelector {form} {isEdit} currentType={content?.contentType} />
      {/if}

      <FormSection
        id="section-details"
        ordinal={ordFor('section-details')}
        title="Details"
        description="Title, URL slug, and description."
      >
        <ContentDetails
          {form}
          {orgSlug}
          {creatorUsername}
          {organizationId}
          contentId={content?.id}
        />
      </FormSection>

      {#if contentTypeVal === 'video' || contentTypeVal === 'audio'}
        <FormSection
          id="section-media"
          ordinal={ordFor('section-media')}
          title={m.studio_content_form_section_media()}
          description={m.studio_content_form_section_media_desc()}
        >
          <MediaSection
            {form}
            mediaItems={mediaItems.filter((mi) => mi.mediaType === contentTypeVal)}
            {orgSlug}
            contentId={content?.id ?? null}
            contentStatus={contentStatus ?? null}
          />
        </FormSection>
      {/if}

      {#if contentTypeVal === 'audio'}
        <FormSection
          id="section-shader"
          ordinal={ordFor('section-shader')}
          title="Immersive shader"
          description="Preset for fullscreen audio playback background."
          optional
        >
          <input type="hidden" name="shaderPreset" value={shaderPreset ?? ''} />
          <ShaderPicker
            value={shaderPreset}
            onchange={(preset) => { shaderPreset = preset; }}
          />
        </FormSection>
      {/if}

      <FormSection
        id="section-body"
        ordinal={ordFor('section-body')}
        title={contentTypeVal === 'written' ? 'Article body' : 'Notes & transcript'}
        description={contentTypeVal === 'written'
          ? 'The full article — rendered on the content page.'
          : 'Complementary long-form text shown alongside the media.'}
        optional={contentTypeVal !== 'written'}
      >
        <WrittenContentEditor {form} optional={contentTypeVal !== 'written'} />
      </FormSection>

      <FormSection
        id="section-thumbnail"
        ordinal={ordFor('section-thumbnail')}
        title="Thumbnail"
        description="16:9 image used across discovery and library surfaces."
        optional
      >
        <ThumbnailUpload {form} {mediaThumbnailUrl} contentId={content?.id ?? null} />
      </FormSection>

      <FormSection
        id="section-access"
        ordinal={ordFor('section-access')}
        title="Access & price"
        description="Who can view this content and — if paid — at what price."
      >
        <AccessSection
          {form}
          {tiers}
          {accessTypeVal}
          {priceVal}
          {selectedMinimumTierId}
          {derivedVisibility}
          onAccessChange={handleAccessChange}
          onTierChange={handleTierChange}
        />
      </FormSection>

      <FormSection
        id="section-organize"
        ordinal={ordFor('section-organize')}
        title="Organize"
        description="Classify, tag, and optionally feature this content."
      >
        <OrganizeSection
          {form}
          {tags}
          {featured}
          onTagsChange={(next) => (tags = next)}
          onFeaturedChange={(next) => (featured = next)}
        />
      </FormSection>

      <FormSection
        id="section-review"
        ordinal={ordFor('section-review')}
        title="Review & publish"
        description="Last look before you ship."
      >
        <ReadinessPanel checks={readinessChecks} />
      </FormSection>

      {#if isEdit}
        <section
          id="section-danger"
          aria-labelledby="section-danger-title"
          class="danger-slot"
        >
          <h2 id="section-danger-title" class="sr-only">Danger zone</h2>
          <DangerZone
            {formPending}
            {deleting}
            onDelete={() => (showDeleteConfirm = true)}
          />
        </section>
      {/if}
    </div>
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
    max-width: var(--container-studio);
    width: 100%;
  }

  /*
    Grid:
    – Command bar spans the full row.
    – Below, a two-column split: left rail (narrow, sticky) + main body.
    – On narrow viewports (< lg) the rail collapses out and body goes full width.

    Sticky requirements:
    – The nearest scrolling ancestor is .studio-main (overflow-y:auto on desktop);
      both the command bar and the rail stick relative to that.
    – --cf-bar-height is measured live at runtime by ContentForm.svelte and
      injected via inline style so the rail top always matches the real bar
      height (falls back to a token-safe calc until measurement lands).
    – isolation:isolate ensures no ancestor creates a new containing block
      that would collapse sticky behaviour.
  */
  .content-form-layout {
    display: grid;
    grid-template-columns: 1fr;
    grid-template-areas:
      'bar'
      'body';
    gap: var(--space-5);
    isolation: isolate;
    --cf-bar-height: calc(var(--space-16) + var(--space-6)); /* fallback until measured */
  }

  @media (--breakpoint-lg) {
    .content-form-layout {
      grid-template-columns: var(--rail-width) minmax(0, 1fr);
      grid-template-areas:
        'bar  bar'
        'rail body';
      column-gap: var(--space-8);
      row-gap: var(--space-5);

      /* Local token — scoped to this layout only. Sized to fit the longest
         section label comfortably without stealing too much main-column width. */
      --rail-width: 14rem;
    }
  }

  @media (--breakpoint-xl) {
    .content-form-layout {
      --rail-width: 16rem;
      column-gap: var(--space-10);
    }
  }

  /* The command bar is the first grid item; grid-area lets the children
     slot into the named areas regardless of source order. */
  .content-form-layout > :global(.command-bar) {
    grid-area: bar;
  }

  .rail-slot {
    grid-area: rail;
    display: none;
    /* Containing block for the sticky rail — stretching to row height is the
       default for grid items with align-self:stretch, but we set it
       explicitly so the sticky calc has a predictable tall parent. */
    min-height: 100%;
  }

  @media (--breakpoint-lg) {
    .rail-slot { display: block; }
  }

  .body-slot {
    grid-area: body;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    min-width: 0;
  }

  .danger-slot {
    scroll-margin-top: calc(var(--cf-bar-height, calc(var(--space-16) + var(--space-6))) + var(--space-4));
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>

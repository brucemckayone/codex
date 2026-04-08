<!--
  @component CreateOrganizationDialog

  Dialog for creating a new organization. Features real-time slug
  auto-generation from the name, debounced availability checking,
  and a URL preview that shows the future subdomain.

  @prop {boolean} open - Whether the dialog is open (bindable)
  @prop {(open: boolean) => void} [onOpenChange] - Callback for open state change
-->
<script lang="ts">
  import { page } from '$app/state';
  import { DialogForm } from '$lib/components/ui/DialogForm';
  import { CheckCircleIcon, XIcon } from '$lib/components/ui/Icon';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { createOrganization, checkOrgSlug } from '$lib/remote/org.remote';
  import { buildOrgUrl } from '$lib/utils/subdomain';
  import * as m from '$paraglide/messages';

  interface Props {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }

  let {
    open = $bindable(false),
    onOpenChange,
  }: Props = $props();

  let name = $state('');
  let slug = $state('');
  let description = $state('');
  let slugManuallyEdited = $state(false);
  let showDescription = $state(false);
  let submitting = $state(false);
  let error = $state<string | null>(null);
  let slugStatus = $state<'idle' | 'checking' | 'available' | 'taken' | 'error'>('idle');

  // Non-reactive counter to avoid infinite loops in $effect
  let checkRequestId = 0;

  const canSubmit = $derived(
    name.trim().length > 0 && slug.length >= 2 && slugStatus === 'available'
  );

  // Auto-generate slug from name when not manually edited
  $effect(() => {
    if (!slugManuallyEdited && name) {
      slug = name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '');
    }
  });

  // Debounced slug availability check
  $effect(() => {
    const currentSlug = slug;

    if (!currentSlug || currentSlug.length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(currentSlug)) {
      slugStatus = 'idle';
      return;
    }

    const thisRequestId = ++checkRequestId;
    slugStatus = 'idle';

    const timer = setTimeout(async () => {
      slugStatus = 'checking';

      try {
        const result = await checkOrgSlug(currentSlug);
        if (thisRequestId === checkRequestId) {
          slugStatus = result?.available ? 'available' : 'taken';
        }
      } catch {
        if (thisRequestId === checkRequestId) {
          slugStatus = 'error';
        }
      }
    }, 800);

    return () => clearTimeout(timer);
  });

  function handleSlugInput() {
    slugManuallyEdited = true;
  }

  function resetForm() {
    name = '';
    slug = '';
    description = '';
    slugManuallyEdited = false;
    showDescription = false;
    error = null;
    slugStatus = 'idle';
    checkRequestId = 0;
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = null;

    if (!canSubmit) return;

    submitting = true;
    try {
      await createOrganization({
        name: name.trim(),
        slug,
        ...(description.trim() ? { description: description.trim() } : {}),
      });

      toast.success(m.org_create_success());

      const targetUrl = buildOrgUrl(page.url, slug, '/studio');
      resetForm();
      open = false;
      onOpenChange?.(false);

      // Cross-subdomain navigation — different origin, can't use goto()
      window.location.href = targetUrl;
    } catch (err) {
      error = err instanceof Error ? err.message : m.org_create_error();
    } finally {
      submitting = false;
    }
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      resetForm();
    }
    onOpenChange?.(isOpen);
  }
</script>

<DialogForm
  title={m.org_create_title()}
  description={m.org_create_description()}
  bind:open
  {submitting}
  {error}
  onsubmit={handleSubmit}
  onOpenChange={handleOpenChange}
  submitLabel={m.org_create_submit()}
  submitDisabled={!canSubmit}
>
  <!-- Organisation name -->
  <div class="form-field">
    <label class="field-label" for="org-name">
      {m.org_create_name_label()}
    </label>
    <input
      type="text"
      id="org-name"
      class="field-input"
      bind:value={name}
      placeholder={m.org_create_name_placeholder()}
      required
      disabled={submitting}
      autocomplete="organization"
    />
  </div>

  <!-- URL handle (slug) -->
  <div class="form-field">
    <label class="field-label" for="org-slug">
      {m.org_create_slug_label()}
    </label>
    <input
      type="text"
      id="org-slug"
      class="field-input"
      class:input-available={slugStatus === 'available'}
      class:input-taken={slugStatus === 'taken'}
      bind:value={slug}
      oninput={handleSlugInput}
      placeholder="my-organisation"
      disabled={submitting}
    />

    <!-- Status indicators -->
    {#if slugStatus === 'checking'}
      <p class="slug-status slug-checking">
        <span class="status-dot checking-dot"></span>
        {m.org_create_slug_checking()}
      </p>
    {:else if slugStatus === 'available'}
      <p class="slug-status slug-available">
        <CheckCircleIcon size={14} />
        {m.org_create_slug_available()}
      </p>
    {:else if slugStatus === 'taken'}
      <p class="slug-status slug-taken">
        <XIcon size={14} />
        {m.org_create_slug_taken()}
      </p>
    {/if}

    <!-- URL preview -->
    {#if slug.length >= 2}
      <div class="url-preview">
        <span class="url-slug">{slug}</span><span class="url-suffix">.lvh.me</span>
      </div>
    {/if}
  </div>

  <!-- Optional description -->
  {#if showDescription}
    <div class="form-field">
      <label class="field-label" for="org-description">
        Description
      </label>
      <textarea
        id="org-description"
        class="field-textarea"
        bind:value={description}
        placeholder="What's your organisation about?"
        rows="3"
        disabled={submitting}
      ></textarea>
    </div>
  {:else}
    <button
      type="button"
      class="add-description-btn"
      onclick={() => (showDescription = true)}
      disabled={submitting}
    >
      + Add description
    </button>
  {/if}
</DialogForm>

<style>
  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
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
    font-family: inherit;
  }

  .field-input:focus {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: -1px;
    border-color: var(--color-border-focus);
  }

  .field-input.input-available:not(:focus) {
    border-color: var(--color-success-500);
  }

  .field-input.input-taken:not(:focus) {
    border-color: var(--color-error-500);
  }

  .field-textarea {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-background);
    color: var(--color-text);
    transition: var(--transition-colors);
    width: 100%;
    font-family: inherit;
    resize: vertical;
  }

  .field-textarea:focus {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: -1px;
    border-color: var(--color-border-focus);
  }

  .slug-status {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    margin: 0;
  }

  .slug-checking {
    color: var(--color-text-muted);
  }

  .slug-available {
    color: var(--color-success-600);
  }

  .slug-taken {
    color: var(--color-error-600);
  }

  .status-dot {
    display: inline-block;
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    border: var(--border-width-thick) solid var(--color-text-muted);
    border-top-color: transparent;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .url-preview {
    padding: var(--space-2) var(--space-3);
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-md);
    font-family: var(--font-mono, monospace);
    font-size: var(--text-xs);
    overflow-x: auto;
    white-space: nowrap;
  }

  .url-slug {
    color: var(--color-interactive-hover);
    font-weight: var(--font-medium);
  }

  .url-suffix {
    color: var(--color-text-muted);
  }

  .add-description-btn {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    color: var(--color-interactive);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .add-description-btn:hover {
    color: var(--color-interactive-hover);
  }

  .add-description-btn:disabled {
    opacity: var(--opacity-50);
    cursor: not-allowed;
  }
</style>

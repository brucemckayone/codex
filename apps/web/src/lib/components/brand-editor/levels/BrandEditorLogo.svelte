<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import { uploadLogoForm } from '$lib/remote/branding.remote';
  import Button from '$lib/components/ui/Button/Button.svelte';

  let fileInput: HTMLInputElement;

  const logoUrl = $derived(brandEditor.pending?.logoUrl ?? null);
  const uploading = $derived(uploadLogoForm.pending > 0);

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;
    // Programmatically submit the hidden form
    input.form?.requestSubmit();
  }

  // Handle upload success — update store with new logo URL
  $effect(() => {
    if (uploadLogoForm.result?.success && !uploading) {
      const url = uploadLogoForm.result.data?.logoUrl;
      if (url) brandEditor.updateField('logoUrl', url);
    }
  });
</script>

<div class="logo-level">
  <div
    class="logo-level__preview"
    style:background-color={brandEditor.pending?.backgroundColor || 'var(--color-surface)'}
  >
    {#if logoUrl}
      <img src={logoUrl} alt="Organization logo" class="logo-level__image" />
    {:else}
      <div class="logo-level__placeholder">
        <span>No logo uploaded</span>
      </div>
    {/if}
  </div>

  <div class="logo-level__actions">
    <form {...uploadLogoForm} enctype="multipart/form-data" class="logo-upload-form">
      <input type="hidden" name="orgId" value={brandEditor.orgId ?? ''} />
      <input
        bind:this={fileInput}
        type="file"
        {...uploadLogoForm.fields.logo.as('file')}
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        hidden
        onchange={handleFileSelect}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onclick={() => fileInput?.click()}
        disabled={uploading}
        loading={uploading}
      >
        {uploading ? 'Uploading…' : 'Upload Logo'}
      </Button>
    </form>
    {#if logoUrl}
      <Button variant="ghost" size="sm" onclick={() => brandEditor.updateField('logoUrl', null)} disabled={uploading}>
        Remove
      </Button>
    {/if}
  </div>

  {#if uploadLogoForm.result?.error}
    <p class="logo-level__error">{uploadLogoForm.result.error}</p>
  {/if}

  <p class="logo-level__hint">
    PNG, SVG, or WebP. Max 2MB. Recommended: 400 x 100px.
  </p>
</div>

<style>
  .logo-level {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .logo-level__preview {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(var(--space-24) * 1.25); /* 120px at base density */
    border-radius: var(--radius-lg);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    padding: var(--space-6);
  }

  .logo-level__image {
    max-width: 100%;
    max-height: var(--space-20); /* 80px at base density */
    object-fit: contain;
  }

  .logo-level__placeholder {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .logo-level__actions {
    display: flex;
    gap: var(--space-2);
  }

  .logo-level__hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .logo-upload-form {
    display: contents;
  }

  .logo-level__error {
    font-size: var(--text-xs);
    color: var(--color-error-500);
  }
</style>

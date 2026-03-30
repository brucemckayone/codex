<!--
  @component BrandingSettings

  Branding settings page for organization admins.
  Allows uploading a logo and setting a primary brand color.

  Uses form() for color updates (progressive enhancement) and
  command() for logo upload/delete.

  @prop {PageData} data - Server-loaded branding settings + orgId from parent
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import * as m from '$paraglide/messages';
  import {
    updateBrandingForm,
    uploadLogoForm,
    deleteLogo,
  } from '$lib/remote/branding.remote';
  import LogoUpload from '$lib/components/studio/LogoUpload.svelte';
  import ColorPicker from '$lib/components/studio/ColorPicker.svelte';
  import { toast } from '$lib/components/ui/Toast/toast-store';

  let { data } = $props();

  const orgId = $derived(data.orgId);
  const branding = $derived(data.branding ?? {
    logoUrl: null,
    primaryColorHex: '#3B82F6',
  });

  // ─── Color State ──────────────────────────────────────────────────────────

  let primaryColor = $state('#3B82F6');

  // Sync color from branding data
  $effect(() => {
    primaryColor = branding.primaryColorHex ?? '#3B82F6';
  });

  function handleColorChange(color: string) {
    primaryColor = color;
  }

  // ─── Logo Upload/Delete ───────────────────────────────────────────────────

  let deleteLoading = $state(false);
  const logoLoading = $derived(uploadLogoForm.pending > 0 || deleteLoading);

  // Watch upload result — invalidate after short delay to let query cache settle
  $effect(() => {
    if (uploadLogoForm.result && !uploadLogoForm.pending) {
      if (uploadLogoForm.result.success) {
        toast.success(m.branding_saved());
        setTimeout(() => void invalidateAll(), 200);
      } else if (uploadLogoForm.result.error) {
        toast.error(uploadLogoForm.result.error);
      }
    }
  });

  async function handleLogoDelete() {
    deleteLoading = true;
    try {
      await deleteLogo(orgId);
      toast.success(m.branding_saved());
      setTimeout(() => void invalidateAll(), 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : m.branding_error();
      toast.error(message);
    } finally {
      deleteLoading = false;
    }
  }

  // ─── Form Result Handling ─────────────────────────────────────────────────

  let showSuccess = $state(false);
  let successTimeout: ReturnType<typeof setTimeout> | null = null;

  function showSuccessMessage() {
    showSuccess = true;
    if (successTimeout) clearTimeout(successTimeout);
    successTimeout = setTimeout(() => (showSuccess = false), 3000);
  }

  onDestroy(() => {
    if (successTimeout) clearTimeout(successTimeout);
  });

  $effect(() => {
    if (updateBrandingForm.result?.success && !updateBrandingForm.pending) {
      showSuccessMessage();
    }
  });
</script>

<svelte:head>
  <title>{m.settings_branding()} | {m.settings_title()}</title>
</svelte:head>

<div class="branding-page">
  <div class="page-header">
    <h2 class="page-title">{m.branding_title()}</h2>
    <p class="page-description">{m.branding_description()}</p>
  </div>

  {#if showSuccess}
    <div class="success-message" role="status" aria-live="polite">
      {m.branding_saved()}
    </div>
  {/if}

  {#if updateBrandingForm.result?.error}
    <div class="error-message" role="alert">
      {updateBrandingForm.result.error}
    </div>
  {/if}

  <!-- Logo Section -->
  <section class="settings-card">
    <h3 class="card-title">{m.branding_logo_title()}</h3>
    <p class="card-description">{m.branding_logo_description()}</p>

    <LogoUpload
      logoUrl={branding.logoUrl}
      loading={logoLoading}
      {orgId}
      uploadFormAttrs={uploadLogoForm}
      onDelete={handleLogoDelete}
    />
  </section>

  <!-- Brand Color Section -->
  <section class="settings-card">
    <h3 class="card-title">{m.branding_color_title()}</h3>
    <p class="card-description">{m.branding_color_description()}</p>

    <form {...updateBrandingForm} class="color-form" novalidate>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="primaryColorHex" value={primaryColor} />

      <ColorPicker value={primaryColor} onchange={handleColorChange} />

      <div class="form-actions">
        <button
          type="submit"
          class="btn btn-primary"
          disabled={updateBrandingForm.pending > 0}
        >
          {#if updateBrandingForm.pending > 0}
            {m.common_loading()}
          {:else}
            {m.branding_save()}
          {/if}
        </button>
      </div>
    </form>
  </section>
</div>

<style>
  .branding-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .page-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .page-title {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
  }

  .page-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .settings-card {
    padding: var(--space-6);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .card-title {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
  }

  .card-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .color-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .form-actions {
    display: flex;
    justify-content: flex-start;
  }

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

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
    border: none;
    text-decoration: none;
    padding: var(--space-2) var(--space-4);
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-primary {
    background-color: var(--color-primary-500);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background-color: var(--color-primary-600);
  }

  .btn-primary:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
  }

  /* Dark mode */
  :global([data-theme='dark']) .page-title,
  :global([data-theme='dark']) .card-title {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .settings-card {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
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

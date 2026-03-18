<!--
  @component BrandingSettings

  Branding settings page for organization admins.
  Allows uploading/deleting a logo and setting the primary brand color.

  Uses:
  - LogoUpload component for drag-and-drop logo management
  - ColorPicker component for primary color selection
  - Progressive enhancement form for color save
  - command() remote functions for logo upload/delete

  @prop {PageData} data - Server-loaded branding settings + orgId from parent
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import * as m from '$paraglide/messages';
  import LogoUpload from '$lib/components/studio/LogoUpload.svelte';
  import ColorPicker from '$lib/components/studio/ColorPicker.svelte';
  import { updateBrandingForm } from '$lib/remote/branding.remote';
  import { uploadLogo, deleteLogo } from '$lib/remote/branding.remote';

  let { data } = $props();

  const orgId = $derived(data.orgId);
  const branding = $derived(data.branding);

  // ─── Logo State ──────────────────────────────────────────────────────────

  /**
   * Local logo override: set by upload/delete operations.
   * When null, falls back to the server-provided branding.logoUrl.
   * Uses a sentinel to distinguish "explicitly set to null" (deleted) from "not overridden".
   */
  const LOGO_NOT_OVERRIDDEN = Symbol('not-overridden');
  let logoOverride = $state<string | null | typeof LOGO_NOT_OVERRIDDEN>(LOGO_NOT_OVERRIDDEN);
  const logoUrl = $derived(logoOverride !== LOGO_NOT_OVERRIDDEN ? logoOverride : branding.logoUrl);

  let logoLoading = $state(false);
  let logoError = $state<string | null>(null);

  async function handleLogoUpload(file: File) {
    logoLoading = true;
    logoError = null;

    try {
      const result = await uploadLogo({ orgId, file });
      if (result?.logoUrl) {
        logoOverride = result.logoUrl;
      }
    } catch (error) {
      logoError =
        error instanceof Error ? error.message : 'Failed to upload logo';
    } finally {
      logoLoading = false;
    }
  }

  async function handleLogoDelete() {
    logoLoading = true;
    logoError = null;

    try {
      await deleteLogo(orgId);
      logoOverride = null;
    } catch (error) {
      logoError =
        error instanceof Error ? error.message : 'Failed to delete logo';
    } finally {
      logoLoading = false;
    }
  }

  // ─── Color State ─────────────────────────────────────────────────────────

  /**
   * Local color override: set when user picks a new color.
   * Falls back to branding.primaryColorHex from server data.
   */
  let colorOverride = $state<string | null>(null);
  const primaryColor = $derived(colorOverride ?? branding.primaryColorHex ?? '#3B82F6');

  function handleColorChange(color: string) {
    colorOverride = color;
  }

  // ─── Success/Error Messages ──────────────────────────────────────────────

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

  // React to form submission result
  $effect(() => {
    if (updateBrandingForm.result?.success && !updateBrandingForm.pending) {
      showSuccessMessage();
      // Reset color override after successful save so server value takes over
      colorOverride = null;
    }
  });

  // Populate form fields reactively when orgId or branding changes
  $effect(() => {
    updateBrandingForm.fields.set({
      orgId,
      primaryColorHex: branding.primaryColorHex ?? '#3B82F6',
    });
  });
</script>

<svelte:head>
  <title>{m.branding_title()} | {m.settings_title()}</title>
</svelte:head>

<div class="branding-page">
  <div class="page-header">
    <h2 class="page-title">{m.branding_title()}</h2>
    <p class="page-description">{m.branding_description()}</p>
  </div>

  <!-- Success message -->
  {#if showSuccess}
    <div class="success-message" role="status" aria-live="polite">
      {m.branding_saved()}
    </div>
  {/if}

  <!-- Form-level error -->
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
      {logoUrl}
      loading={logoLoading}
      onUpload={handleLogoUpload}
      onDelete={handleLogoDelete}
    />

    {#if logoError}
      <div class="error-message" role="alert">{logoError}</div>
    {/if}
  </section>

  <!-- Color Section -->
  <section class="settings-card">
    <h3 class="card-title">{m.branding_color_title()}</h3>
    <p class="card-description">{m.branding_color_description()}</p>

    <div class="color-field">
      <label class="field-label" for="primaryColorHex">
        {m.branding_color_primary()}
      </label>
      <ColorPicker
        value={primaryColor}
        onchange={handleColorChange}
      />
    </div>

    <!-- Save form for color (progressive enhancement) -->
    <form {...updateBrandingForm} class="color-form" novalidate>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="primaryColorHex" value={primaryColor} />

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
  }

  .card-title {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0 0 var(--space-1) 0;
  }

  .card-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0 0 var(--space-4) 0;
  }

  .color-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .field-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .color-form {
    margin-top: var(--space-4);
  }

  .form-actions {
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
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
    margin-top: var(--space-3);
  }

  /* Buttons */
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
  :global([data-theme='dark']) .card-title,
  :global([data-theme='dark']) .field-label {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .settings-card {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .form-actions {
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

<!--
  @component BrandingSettings

  Branding settings page with live preview.
  One color picker → derives entire palette via CSS relative colors.
  Continuous sliders for density and radius with instant visual feedback.

  Live preview works by updating CSS variables on the org layout element directly.
  The org-brand.css file derives all variants from --brand-color via OKLCH.

  @prop {PageData} data - Server-loaded branding settings + orgId from parent
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { browser } from '$app/environment';
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
    secondaryColorHex: null,
    accentColorHex: null,
    backgroundColorHex: null,
    fontBody: null,
    fontHeading: null,
    radiusValue: 0.5,
    densityValue: 1,
  });

  // Optimistic logo URL override (undefined = use server data)
  let optimisticLogoUrl = $state<string | null | undefined>(undefined);
  const effectiveLogoUrl = $derived(
    optimisticLogoUrl !== undefined ? (optimisticLogoUrl || null) : branding.logoUrl
  );

  // ─── Color State ──────────────────────────────────────────────────────────

  let primaryColor = $state('#3B82F6');
  let secondaryColor = $state<string | null>(null);
  let accentColor = $state<string | null>(null);
  let backgroundColor = $state<string | null>(null);

  $effect(() => {
    primaryColor = branding.primaryColorHex ?? '#3B82F6';
    secondaryColor = branding.secondaryColorHex ?? null;
    accentColor = branding.accentColorHex ?? null;
    backgroundColor = branding.backgroundColorHex ?? null;
  });

  // ─── Typography State ─────────────────────────────────────────────────────

  const FONT_OPTIONS = [
    '', 'Inter', 'Roboto', 'Open Sans', 'Lato', 'Poppins',
    'Montserrat', 'Playfair Display', 'Merriweather', 'DM Sans',
    'Source Sans 3', 'Nunito', 'Raleway',
  ];

  let fontBody = $state('');
  let fontHeading = $state('');

  $effect(() => {
    fontBody = branding.fontBody ?? '';
    fontHeading = branding.fontHeading ?? '';
  });

  // ─── Slider State ─────────────────────────────────────────────────────────

  let radiusValue = $state(0.5);
  let densityValue = $state(1);

  $effect(() => {
    radiusValue = branding.radiusValue ?? 0.5;
    densityValue = branding.densityValue ?? 1;
  });

  // ─── Live Preview ─────────────────────────────────────────────────────────
  // Updates CSS variables on the org layout element directly.
  // The org-brand.css file derives all variants from these inputs via OKLCH.

  function getOrgLayout(): HTMLElement | null {
    if (!browser) return null;
    return document.querySelector('.org-layout');
  }

  function updateBrandPreview(prop: string, value: string | null) {
    const el = getOrgLayout();
    if (!el) return;
    // Ensure data-org-brand is set so the CSS derivation rules activate
    if (!el.hasAttribute('data-org-brand')) {
      el.setAttribute('data-org-brand', '');
    }
    if (value) {
      el.style.setProperty(prop, value);
    } else {
      el.style.removeProperty(prop);
    }
  }

  function handlePrimaryChange(color: string) {
    primaryColor = color;
    updateBrandPreview('--brand-color', color);
  }

  function handleSecondaryChange(color: string) {
    secondaryColor = color;
    // Secondary doesn't map to a CSS variable currently — reserved for future use
  }

  function handleAccentChange(color: string) {
    accentColor = color;
    updateBrandPreview('--brand-accent', color);
  }

  function handleBackgroundChange(color: string) {
    backgroundColor = color;
    const el = getOrgLayout();
    if (el) el.setAttribute('data-org-bg', '');
    updateBrandPreview('--brand-bg', color);
  }

  function handleRadiusChange(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    radiusValue = val;
    updateBrandPreview('--brand-radius', `${val}rem`);
  }

  function handleDensityChange(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    densityValue = val;
    updateBrandPreview('--brand-density', String(val));
  }

  // ─── Logo Upload/Delete ───────────────────────────────────────────────────

  let deleteLoading = $state(false);
  const logoLoading = $derived(uploadLogoForm.pending > 0 || deleteLoading);

  $effect(() => {
    if (uploadLogoForm.result && !uploadLogoForm.pending) {
      if (uploadLogoForm.result.success) {
        const newUrl = uploadLogoForm.result.data?.logoUrl;
        if (newUrl) optimisticLogoUrl = newUrl;
        toast.success(m.branding_saved());
        setTimeout(() => void invalidateAll(), 200);
      } else if (uploadLogoForm.result.error) {
        toast.error(uploadLogoForm.result.error);
      }
    }
  });

  $effect(() => {
    if (optimisticLogoUrl === undefined) return;
    if (branding.logoUrl === optimisticLogoUrl ||
        (!branding.logoUrl && optimisticLogoUrl === '')) {
      optimisticLogoUrl = undefined;
    }
  });

  async function handleLogoDelete() {
    deleteLoading = true;
    optimisticLogoUrl = '';
    try {
      await deleteLogo(orgId);
      toast.success(m.branding_saved());
      setTimeout(() => void invalidateAll(), 200);
    } catch (err) {
      optimisticLogoUrl = undefined;
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
      logoUrl={effectiveLogoUrl}
      loading={logoLoading}
      {orgId}
      uploadFormAttrs={uploadLogoForm}
      onDelete={handleLogoDelete}
    />
  </section>

  <!-- All branding settings in one form -->
  <form {...updateBrandingForm} class="branding-form" novalidate>
    <input type="hidden" name="orgId" value={orgId} />
    <input type="hidden" name="primaryColorHex" value={primaryColor} />
    <input type="hidden" name="secondaryColorHex" value={secondaryColor ?? ''} />
    <input type="hidden" name="accentColorHex" value={accentColor ?? ''} />
    <input type="hidden" name="backgroundColorHex" value={backgroundColor ?? ''} />
    <input type="hidden" name="fontBody" value={fontBody} />
    <input type="hidden" name="fontHeading" value={fontHeading} />
    <input type="hidden" name="radiusValue" value={radiusValue} />
    <input type="hidden" name="densityValue" value={densityValue} />

    <!-- Brand Colors Section -->
    <section class="settings-card">
      <h3 class="card-title">{m.branding_color_title()}</h3>
      <p class="card-description">{m.branding_color_description()}</p>

      <div class="color-fields">
        <div class="color-field">
          <label class="field-label">{m.branding_color_primary()}</label>
          <ColorPicker value={primaryColor} onchange={handlePrimaryChange} />
        </div>

        <div class="color-field">
          <div class="field-label-row">
            <label class="field-label">{m.branding_color_accent()}</label>
            {#if accentColor}
              <button type="button" class="btn-clear" onclick={() => { accentColor = null; updateBrandPreview('--brand-accent', null); }}>
                {m.branding_color_clear()}
              </button>
            {/if}
          </div>
          {#if accentColor}
            <ColorPicker value={accentColor} onchange={handleAccentChange} />
          {:else}
            <button type="button" class="btn-add-color" onclick={() => { accentColor = '#F59E0B'; updateBrandPreview('--brand-accent', '#F59E0B'); }}>
              + Add accent color
            </button>
          {/if}
        </div>
        <div class="color-field">
          <div class="field-label-row">
            <label class="field-label">Background Color</label>
            {#if backgroundColor}
              <button type="button" class="btn-clear" onclick={() => { backgroundColor = null; updateBrandPreview('--brand-bg', null); const el = getOrgLayout(); if (el) el.removeAttribute('data-org-bg'); }}>
                {m.branding_color_clear()}
              </button>
            {/if}
          </div>
          {#if backgroundColor}
            <ColorPicker value={backgroundColor} onchange={handleBackgroundChange} />
          {:else}
            <button type="button" class="btn-add-color" onclick={() => { backgroundColor = '#FFFFFF'; handleBackgroundChange('#FFFFFF'); }}>
              + Add background color
            </button>
          {/if}
        </div>
      </div>
    </section>

    <!-- Typography Section -->
    <section class="settings-card">
      <h3 class="card-title">{m.branding_typography_title()}</h3>
      <p class="card-description">{m.branding_typography_description()}</p>

      <div class="typography-fields">
        <div class="select-field">
          <label class="field-label" for="font-body">{m.branding_typography_body()}</label>
          <select id="font-body" class="select-input" bind:value={fontBody}>
            <option value="">{m.branding_typography_default()}</option>
            {#each FONT_OPTIONS.slice(1) as font}
              <option value={font}>{font}</option>
            {/each}
          </select>
          {#if fontBody}
            <p class="font-preview" style:font-family="'{fontBody}', var(--font-sans)">
              The quick brown fox jumps over the lazy dog
            </p>
          {/if}
        </div>

        <div class="select-field">
          <label class="field-label" for="font-heading">{m.branding_typography_heading()}</label>
          <select id="font-heading" class="select-input" bind:value={fontHeading}>
            <option value="">{m.branding_typography_default()}</option>
            {#each FONT_OPTIONS.slice(1) as font}
              <option value={font}>{font}</option>
            {/each}
          </select>
          {#if fontHeading}
            <p class="font-preview heading-preview" style:font-family="'{fontHeading}', var(--font-sans)">
              Heading Preview Text
            </p>
          {/if}
        </div>
      </div>
    </section>

    <!-- Shape & Density Section -->
    <section class="settings-card">
      <h3 class="card-title">{m.branding_shape_title()}</h3>
      <p class="card-description">{m.branding_shape_description()}</p>

      <div class="slider-fields">
        <!-- Border Radius Slider -->
        <div class="slider-field">
          <div class="slider-header">
            <label class="field-label" for="radius-slider">{m.branding_shape_radius()}</label>
            <span class="slider-value">{radiusValue.toFixed(2)}rem</span>
          </div>
          <input
            id="radius-slider"
            type="range"
            class="range-input"
            min="0"
            max="1.5"
            step="0.05"
            value={radiusValue}
            oninput={handleRadiusChange}
          />
          <div class="slider-labels">
            <span>{m.branding_shape_radius_sharp()}</span>
            <span>{m.branding_shape_radius_rounded()}</span>
          </div>
          <!-- Radius preview -->
          <div class="radius-preview-row">
            <div class="radius-preview-box" style:border-radius="{radiusValue}rem"></div>
            <div class="radius-preview-btn" style:border-radius="{radiusValue}rem">Button</div>
          </div>
        </div>

        <!-- Density Slider -->
        <div class="slider-field">
          <div class="slider-header">
            <label class="field-label" for="density-slider">{m.branding_shape_density()}</label>
            <span class="slider-value">{densityValue.toFixed(2)}x</span>
          </div>
          <input
            id="density-slider"
            type="range"
            class="range-input"
            min="0.75"
            max="1.25"
            step="0.01"
            value={densityValue}
            oninput={handleDensityChange}
          />
          <div class="slider-labels">
            <span>{m.branding_shape_density_compact()}</span>
            <span>{m.branding_shape_density_spacious()}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Save Button -->
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
</div>

<style>
  .branding-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .branding-form {
    display: contents;
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

  .field-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .field-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  /* ── Colors ───────────────────────────────────────────── */

  .color-fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .color-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .btn-clear {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    transition: var(--transition-colors);
  }

  .btn-clear:hover {
    color: var(--color-error);
    background-color: var(--color-error-50);
  }

  .btn-add-color {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) dashed var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: var(--transition-colors);
    width: fit-content;
  }

  .btn-add-color:hover {
    border-color: var(--color-border-strong);
    color: var(--color-text-secondary);
  }

  /* ── Typography ───────────────────────────────────────── */

  .typography-fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .select-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .select-input {
    width: 100%;
    max-width: 320px;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .select-input:focus {
    border-color: var(--color-brand-primary);
    outline: none;
    box-shadow: 0 0 0 1px var(--color-brand-primary);
  }

  .font-preview {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
    padding: var(--space-2) var(--space-3);
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-md);
  }

  .heading-preview {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
  }

  /* ── Sliders ──────────────────────────────────────────── */

  .slider-fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .slider-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .slider-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .slider-value {
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    color: var(--color-text-muted);
    min-width: 60px;
    text-align: right;
  }

  .range-input {
    width: 100%;
    max-width: 400px;
    height: 6px;
    appearance: none;
    background: var(--color-border);
    border-radius: var(--radius-full);
    outline: none;
    cursor: pointer;
  }

  .range-input::-webkit-slider-thumb {
    appearance: none;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-full);
    background: var(--color-brand-primary, var(--color-interactive));
    border: 2px solid var(--color-surface);
    box-shadow: var(--shadow-sm);
    cursor: pointer;
  }

  .range-input::-moz-range-thumb {
    width: 20px;
    height: 20px;
    border-radius: var(--radius-full);
    background: var(--color-brand-primary, var(--color-interactive));
    border: 2px solid var(--color-surface);
    box-shadow: var(--shadow-sm);
    cursor: pointer;
  }

  .slider-labels {
    display: flex;
    justify-content: space-between;
    max-width: 400px;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* ── Radius Preview ───────────────────────────────────── */

  .radius-preview-row {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    margin-top: var(--space-2);
  }

  .radius-preview-box {
    width: 48px;
    height: 32px;
    border: var(--border-width) var(--border-style) var(--color-border-strong);
    background-color: var(--color-surface-secondary);
    transition: border-radius var(--duration-fast) var(--ease-default);
  }

  .radius-preview-btn {
    padding: var(--space-1-5) var(--space-3);
    background-color: var(--color-brand-primary, var(--color-interactive));
    color: var(--color-text-on-brand, white);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    transition: border-radius var(--duration-fast) var(--ease-default);
  }

  /* ── Form Actions ─────────────────────────────────────── */

  .form-actions {
    display: flex;
    justify-content: flex-start;
  }

  /* ── Messages ─────────────────────────────────────────── */

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

  /* ── Buttons ──────────────────────────────────────────── */

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
    opacity: var(--opacity-60);
    cursor: not-allowed;
  }

  .btn-primary {
    background-color: var(--color-brand-primary, var(--color-interactive));
    color: var(--color-text-on-brand, white);
  }

  .btn-primary:hover:not(:disabled) {
    background-color: var(--color-brand-primary-hover, var(--color-interactive-hover));
  }

  .btn-primary:focus-visible {
    outline: 2px solid var(--color-brand-primary, var(--color-interactive));
    outline-offset: 2px;
  }
</style>

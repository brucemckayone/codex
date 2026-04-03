<!--
  @component SettingsGeneral

  General & Social settings page for organization admins.
  Allows editing platform name, support email, contact URL, timezone,
  and social media URLs (Twitter, YouTube, Instagram, TikTok).

  Uses form() progressive enhancement -- works without JS, enhances with JS.

  @prop {PageData} data - Server-loaded contact settings + orgId from parent
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import * as m from '$paraglide/messages';
  import { updateContactForm } from '$lib/remote/settings.remote';

  let { data } = $props();

  const orgId = $derived(data.orgId);
  const contact = $derived(data.contact ?? {
    platformName: '',
    supportEmail: '',
    contactUrl: '',
    timezone: 'UTC',
    twitterUrl: '',
    youtubeUrl: '',
    instagramUrl: '',
    tiktokUrl: '',
  });

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
    if (updateContactForm.result?.success && !updateContactForm.pending) {
      showSuccessMessage();
    }
  });

  // Populate form fields reactively when orgId or contact changes
  $effect(() => {
    updateContactForm.fields.set({
      orgId,
      platformName: contact.platformName ?? '',
      supportEmail: contact.supportEmail ?? '',
      contactUrl: contact.contactUrl ?? '',
      timezone: contact.timezone ?? 'UTC',
      twitterUrl: contact.twitterUrl ?? '',
      youtubeUrl: contact.youtubeUrl ?? '',
      instagramUrl: contact.instagramUrl ?? '',
      tiktokUrl: contact.tiktokUrl ?? '',
    });
  });

  // Common timezone options
  const timezones = [
    'UTC',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Asia/Kolkata',
    'Australia/Sydney',
    'Pacific/Auckland',
  ];
</script>

<svelte:head>
  <title>{m.settings_general()} | {m.settings_title()}</title>
</svelte:head>

<div class="general-page">
  <div class="page-header">
    <h2 class="page-title">{m.settings_general_title()}</h2>
  </div>

  <!-- Success message -->
  {#if showSuccess}
    <div class="success-message" role="status" aria-live="polite">
      {m.settings_saved()}
    </div>
  {/if}

  <!-- Form-level error -->
  {#if updateContactForm.result?.error}
    <div class="error-message" role="alert">
      {updateContactForm.result.error}
    </div>
  {/if}

  <form {...updateContactForm} class="settings-form" novalidate>
    <input type="hidden" name="orgId" value={orgId} />

    <!-- General Section -->
    <section class="settings-card">
      <h3 class="card-title">{m.settings_general_title()}</h3>

      <div class="form-fields">
        <div class="form-field">
          <label class="field-label" for="platformName">
            {m.settings_platform_name()}
          </label>
          <input
            type="text"
            id="platformName"
            name="platformName"
            class="field-input"
            value={contact.platformName ?? ''}
            maxlength="100"
          />
        </div>

        <div class="form-field">
          <label class="field-label" for="supportEmail">
            {m.settings_support_email()}
          </label>
          <input
            type="email"
            id="supportEmail"
            name="supportEmail"
            class="field-input"
            value={contact.supportEmail ?? ''}
          />
        </div>

        <div class="form-field">
          <label class="field-label" for="contactUrl">
            {m.settings_contact_url()}
          </label>
          <input
            type="url"
            id="contactUrl"
            name="contactUrl"
            class="field-input"
            value={contact.contactUrl ?? ''}
            placeholder="https://"
          />
        </div>

        <div class="form-field">
          <label class="field-label" for="timezone">
            {m.settings_timezone()}
          </label>
          <select
            id="timezone"
            name="timezone"
            class="field-input field-select"
            value={contact.timezone ?? 'UTC'}
          >
            {#each timezones as tz}
              <option value={tz} selected={tz === (contact.timezone ?? 'UTC')}>
                {tz}
              </option>
            {/each}
          </select>
        </div>
      </div>
    </section>

    <!-- Social Section -->
    <section class="settings-card">
      <h3 class="card-title">{m.settings_social_title()}</h3>

      <div class="form-fields">
        <div class="form-field">
          <label class="field-label" for="twitterUrl">
            {m.settings_twitter()}
          </label>
          <input
            type="url"
            id="twitterUrl"
            name="twitterUrl"
            class="field-input"
            value={contact.twitterUrl ?? ''}
            placeholder="https://twitter.com/..."
          />
        </div>

        <div class="form-field">
          <label class="field-label" for="youtubeUrl">
            {m.settings_youtube()}
          </label>
          <input
            type="url"
            id="youtubeUrl"
            name="youtubeUrl"
            class="field-input"
            value={contact.youtubeUrl ?? ''}
            placeholder="https://youtube.com/..."
          />
        </div>

        <div class="form-field">
          <label class="field-label" for="instagramUrl">
            {m.settings_instagram()}
          </label>
          <input
            type="url"
            id="instagramUrl"
            name="instagramUrl"
            class="field-input"
            value={contact.instagramUrl ?? ''}
            placeholder="https://instagram.com/..."
          />
        </div>

        <div class="form-field">
          <label class="field-label" for="tiktokUrl">
            {m.settings_tiktok()}
          </label>
          <input
            type="url"
            id="tiktokUrl"
            name="tiktokUrl"
            class="field-input"
            value={contact.tiktokUrl ?? ''}
            placeholder="https://tiktok.com/..."
          />
        </div>
      </div>
    </section>

    <!-- Save Button -->
    <div class="form-actions">
      <button
        type="submit"
        class="btn btn-primary"
        disabled={updateContactForm.pending > 0}
      >
        {#if updateContactForm.pending > 0}
          {m.common_loading()}
        {:else}
          {m.settings_save()}
        {/if}
      </button>
    </div>
  </form>
</div>

<style>
  .general-page {
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

  .settings-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
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
    margin: 0 0 var(--space-4) 0;
  }

  .form-fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

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
  }

  .field-input:focus {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: -1px;
    border-color: var(--color-border-focus);
  }

  .field-select {
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right var(--space-3) center;
    padding-right: var(--space-8);
    cursor: pointer;
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
    opacity: var(--opacity-60);
    cursor: not-allowed;
  }

  .btn-primary {
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  .btn-primary:hover:not(:disabled) {
    background-color: var(--color-interactive-hover);
  }

  .btn-primary:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }
</style>

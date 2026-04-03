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
  import { Alert, Card, PageHeader, Select } from '$lib/components/ui';

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
  const timezoneOptions = [
    { value: 'UTC', label: 'UTC' },
    { value: 'Europe/London', label: 'Europe/London' },
    { value: 'Europe/Paris', label: 'Europe/Paris' },
    { value: 'Europe/Berlin', label: 'Europe/Berlin' },
    { value: 'America/New_York', label: 'America/New_York' },
    { value: 'America/Chicago', label: 'America/Chicago' },
    { value: 'America/Denver', label: 'America/Denver' },
    { value: 'America/Los_Angeles', label: 'America/Los_Angeles' },
    { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
    { value: 'Asia/Shanghai', label: 'Asia/Shanghai' },
    { value: 'Asia/Kolkata', label: 'Asia/Kolkata' },
    { value: 'Australia/Sydney', label: 'Australia/Sydney' },
    { value: 'Pacific/Auckland', label: 'Pacific/Auckland' },
  ];

  let timezoneValue = $state(contact.timezone ?? 'UTC');

  // Sync timezone when contact data changes
  $effect(() => {
    timezoneValue = contact.timezone ?? 'UTC';
  });
</script>

<svelte:head>
  <title>{m.settings_general()} | {m.settings_title()}</title>
</svelte:head>

<div class="general-page">
  <PageHeader title={m.settings_general_title()} />

  <!-- Success message -->
  {#if showSuccess}
    <Alert variant="success">
      {m.settings_saved()}
    </Alert>
  {/if}

  <!-- Form-level error -->
  {#if updateContactForm.result?.error}
    <Alert variant="error">
      {updateContactForm.result.error}
    </Alert>
  {/if}

  <form {...updateContactForm} class="settings-form" novalidate>
    <input type="hidden" name="orgId" value={orgId} />

    <!-- General Section -->
    <Card.Root>
      <Card.Header>
        <Card.Title>{m.settings_general_title()}</Card.Title>
      </Card.Header>
      <Card.Content>
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
          <input type="hidden" name="timezone" value={timezoneValue} />
          <Select
            options={timezoneOptions}
            bind:value={timezoneValue}
            label={m.settings_timezone()}
            placeholder="Select timezone..."
          />
        </div>
      </div>
      </Card.Content>
    </Card.Root>

    <!-- Social Section -->
    <Card.Root>
      <Card.Header>
        <Card.Title>{m.settings_social_title()}</Card.Title>
      </Card.Header>
      <Card.Content>
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
      </Card.Content>
    </Card.Root>

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

.settings-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
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

  .form-actions {
    display: flex;
    justify-content: flex-start;
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

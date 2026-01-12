# P1-FE-ADMIN-002: Platform Settings

**Priority**: P1
**Status**: 🚧 Not Started
**Estimated Effort**: 2-3 days
**Beads Task**: Codex-vw8.7

---

## Table of Contents

- [Overview](#overview)
- [System Context](#system-context)
- [Settings Page](#settings-page)
- [Branding Section](#branding-section)
- [Billing Page](#billing-page)
- [Form Handling](#form-handling)
- [Dependencies](#dependencies)
- [Implementation Checklist](#implementation-checklist)
- [Testing Strategy](#testing-strategy)

---

## Overview

This work packet implements organization settings and billing pages within the studio. Settings includes branding (logo, colors), general configuration, and social links. Billing is owner-only for subscription management.

Key features:
- **Branding customization**: Logo upload, primary/accent colors
- **General settings**: Platform name, description
- **Social links**: Twitter, YouTube, Instagram
- **Billing management**: Owner-only subscription settings

---

## System Context

### Upstream Dependencies

| System | What We Consume |
|--------|-----------------|
| **Settings-API** | Settings CRUD, logo upload |
| **Organization-API** | Org info, role verification |
| **P1-FE-ADMIN-001** | Studio layout, sidebar |
| **P1-FE-FOUNDATION-002** | Input, Button, ColorPicker |

### Downstream Consumers

| System | What We Provide |
|--------|-----------------|
| **All org pages** | Brand colors applied via CSS variables |
| **Public org space** | Logo, description |

### Brand Token Flow

```
Admin updates brand colors in Settings
    │
    ▼
Settings-API stores in database
    │
    ▼
Org layout fetches settings on load
    │
    ▼
CSS variables injected: --org-brand-primary
    │
    ▼
All components inherit brand colors
```

---

## Settings Page

### Route Structure

```
src/routes/(org)/[slug]/studio/settings/
├── +page.svelte           # Settings form
├── +page.server.ts        # Load settings, handle save
└── settings.remote.ts     # Remote functions

src/routes/(org)/[slug]/studio/billing/
├── +page.svelte           # Billing page (Owner only)
└── +page.server.ts
```

### +page.server.ts (Settings)

```typescript
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createServerApi } from '$lib/server/api';

export const load: PageServerLoad = async ({ parent, platform, cookies }) => {
  const { org, role } = await parent();

  // Admin+ only
  if (role !== 'owner' && role !== 'admin') {
    error(403, 'You do not have access to settings');
  }

  const api = createServerApi(platform);
  const sessionCookie = cookies.get('codex-session');

  const settings = await api.fetch<OrgSettings>(
    'settings',
    `/api/organizations/${org.id}/settings`,
    sessionCookie
  );

  return { settings };
};

interface OrgSettings {
  branding: {
    logoUrl: string | null;
    primaryColor: string;
    accentColor: string;
  };
  general: {
    name: string;
    description: string;
    contactEmail: string;
  };
  social: {
    twitter: string | null;
    youtube: string | null;
    instagram: string | null;
  };
}
```

### +page.svelte (Settings)

```svelte
<script lang="ts">
  import { updateSettings, uploadLogo } from './settings.remote';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import TextArea from '$lib/components/ui/TextArea/TextArea.svelte';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import ColorPicker from '$lib/components/settings/ColorPicker.svelte';
  import LogoUpload from '$lib/components/settings/LogoUpload.svelte';
  import * as m from '$paraglide/messages';

  let { data } = $props();
  let { settings, org } = data;

  let saving = $state(false);
  let saved = $state(false);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    saving = true;

    const formData = new FormData(e.target as HTMLFormElement);
    const result = await updateSettings(Object.fromEntries(formData));

    saving = false;
    if (result.success) {
      saved = true;
      setTimeout(() => saved = false, 2000);
    }
  }
</script>

<svelte:head>
  <title>{m.settings_title()} | {org.name} Studio</title>
</svelte:head>

<div class="settings-page">
  <header class="page-header">
    <h1>{m.settings_title()}</h1>
  </header>

  <form onsubmit={handleSubmit}>
    <!-- Branding Section -->
    <section class="settings-section">
      <h2>{m.settings_branding()}</h2>

      <div class="form-group">
        <label>{m.settings_logo()}</label>
        <LogoUpload
          currentUrl={settings.branding.logoUrl}
          onupload={(url) => settings.branding.logoUrl = url}
        />
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="primaryColor">{m.settings_primary_color()}</label>
          <ColorPicker
            id="primaryColor"
            name="branding.primaryColor"
            value={settings.branding.primaryColor}
          />
        </div>

        <div class="form-group">
          <label for="accentColor">{m.settings_accent_color()}</label>
          <ColorPicker
            id="accentColor"
            name="branding.accentColor"
            value={settings.branding.accentColor}
          />
        </div>
      </div>
    </section>

    <!-- General Section -->
    <section class="settings-section">
      <h2>{m.settings_general()}</h2>

      <div class="form-group">
        <label for="name">{m.settings_org_name()}</label>
        <Input
          id="name"
          name="general.name"
          value={settings.general.name}
          required
        />
      </div>

      <div class="form-group">
        <label for="description">{m.settings_description()}</label>
        <TextArea
          id="description"
          name="general.description"
          value={settings.general.description}
          rows={4}
        />
      </div>

      <div class="form-group">
        <label for="contactEmail">{m.settings_contact_email()}</label>
        <Input
          id="contactEmail"
          name="general.contactEmail"
          type="email"
          value={settings.general.contactEmail}
        />
      </div>
    </section>

    <!-- Social Section -->
    <section class="settings-section">
      <h2>{m.settings_social()}</h2>

      <div class="form-group">
        <label for="twitter">{m.settings_twitter()}</label>
        <Input
          id="twitter"
          name="social.twitter"
          value={settings.social.twitter ?? ''}
          placeholder="@yourhandle"
        />
      </div>

      <div class="form-group">
        <label for="youtube">{m.settings_youtube()}</label>
        <Input
          id="youtube"
          name="social.youtube"
          value={settings.social.youtube ?? ''}
          placeholder="https://youtube.com/@channel"
        />
      </div>

      <div class="form-group">
        <label for="instagram">{m.settings_instagram()}</label>
        <Input
          id="instagram"
          name="social.instagram"
          value={settings.social.instagram ?? ''}
          placeholder="@yourhandle"
        />
      </div>
    </section>

    <div class="form-actions">
      <Button type="submit" loading={saving}>
        {saving ? m.common_saving() : saved ? m.common_saved() : m.common_save()}
      </Button>
    </div>
  </form>
</div>

<style>
  .settings-page {
    max-width: 800px;
  }

  .page-header {
    margin-bottom: var(--space-6);
  }

  .page-header h1 {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
  }

  .settings-section {
    background: var(--color-surface);
    padding: var(--space-6);
    border-radius: var(--radius-lg);
    margin-bottom: var(--space-6);
  }

  .settings-section h2 {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    margin-bottom: var(--space-4);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--color-border);
  }

  .form-group {
    margin-bottom: var(--space-4);
  }

  .form-group label {
    display: block;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    margin-bottom: var(--space-1);
    color: var(--color-text);
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
```

---

## Branding Section

### ColorPicker.svelte

```svelte
<!-- src/lib/components/settings/ColorPicker.svelte -->
<script lang="ts">
  interface Props {
    id: string;
    name: string;
    value: string;
  }

  let { id, name, value = '#e85a3f' }: Props = $props();

  // Preset brand colors
  const presets = [
    '#e85a3f', // Terracotta (default)
    '#3b82f6', // Blue
    '#22c55e', // Green
    '#8b5cf6', // Purple
    '#ec4899', // Pink
    '#f59e0b', // Amber
  ];
</script>

<div class="color-picker">
  <div class="color-preview" style:background-color={value}>
    <input
      type="color"
      {id}
      {name}
      bind:value
      class="color-input"
    />
  </div>

  <div class="presets">
    {#each presets as preset}
      <button
        type="button"
        class="preset"
        class:active={value === preset}
        style:background-color={preset}
        onclick={() => value = preset}
        aria-label="Select color {preset}"
      ></button>
    {/each}
  </div>

  <input
    type="text"
    value={value}
    oninput={(e) => value = (e.target as HTMLInputElement).value}
    pattern="^#[0-9a-fA-F]{6}$"
    class="hex-input"
    placeholder="#000000"
  />
</div>

<style>
  .color-picker {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .color-preview {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-md);
    border: 2px solid var(--color-border);
    position: relative;
    overflow: hidden;
    cursor: pointer;
  }

  .color-input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }

  .presets {
    display: flex;
    gap: var(--space-1);
  }

  .preset {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-full);
    border: 2px solid transparent;
    cursor: pointer;
    transition: var(--transition-transform);
  }

  .preset:hover {
    transform: scale(1.1);
  }

  .preset.active {
    border-color: var(--color-text);
    box-shadow: 0 0 0 2px var(--color-surface);
  }

  .hex-input {
    width: 80px;
    padding: var(--space-1) var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }
</style>
```

### LogoUpload.svelte

```svelte
<!-- src/lib/components/settings/LogoUpload.svelte -->
<script lang="ts">
  import { uploadLogo } from '../../routes/(org)/[slug]/studio/settings/settings.remote';
  import * as m from '$paraglide/messages';

  interface Props {
    currentUrl: string | null;
    onupload: (url: string) => void;
  }

  let { currentUrl, onupload }: Props = $props();

  let uploading = $state(false);
  let error = $state<string | null>(null);
  let fileInput: HTMLInputElement;

  async function handleFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    // Validate file
    if (!file.type.startsWith('image/')) {
      error = m.settings_logo_invalid_type();
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      error = m.settings_logo_too_large();
      return;
    }

    error = null;
    uploading = true;

    try {
      const result = await uploadLogo(file);
      if (result.url) {
        onupload(result.url);
      }
    } catch (e) {
      error = m.settings_logo_upload_failed();
    } finally {
      uploading = false;
    }
  }
</script>

<div class="logo-upload">
  <div class="logo-preview">
    {#if currentUrl}
      <img src={currentUrl} alt="Organization logo" />
    {:else}
      <div class="placeholder">
        <span class="icon">📷</span>
      </div>
    {/if}
  </div>

  <div class="upload-controls">
    <button
      type="button"
      class="upload-button"
      onclick={() => fileInput.click()}
      disabled={uploading}
    >
      {uploading ? m.common_uploading() : m.settings_upload_logo()}
    </button>

    <input
      bind:this={fileInput}
      type="file"
      accept="image/*"
      onchange={handleFileChange}
      hidden
    />

    <p class="hint">{m.settings_logo_hint()}</p>

    {#if error}
      <p class="error">{error}</p>
    {/if}
  </div>
</div>

<style>
  .logo-upload {
    display: flex;
    gap: var(--space-4);
    align-items: flex-start;
  }

  .logo-preview {
    width: 80px;
    height: 80px;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--color-surface-secondary);
    flex-shrink: 0;
  }

  .logo-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-2xl);
  }

  .upload-controls {
    flex: 1;
  }

  .upload-button {
    padding: var(--space-2) var(--space-4);
    background: var(--color-surface-secondary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .upload-button:hover:not(:disabled) {
    background: var(--color-border);
  }

  .hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin-top: var(--space-2);
  }

  .error {
    font-size: var(--text-xs);
    color: var(--color-error);
    margin-top: var(--space-2);
  }
</style>
```

---

## Billing Page

### +page.svelte (Billing)

```svelte
<script lang="ts">
  import * as m from '$paraglide/messages';

  let { data } = $props();
</script>

<svelte:head>
  <title>{m.billing_title()} | {data.org.name} Studio</title>
</svelte:head>

<div class="billing-page">
  <header class="page-header">
    <h1>{m.billing_title()}</h1>
  </header>

  <section class="billing-section">
    <h2>{m.billing_current_plan()}</h2>
    <div class="plan-card">
      <div class="plan-info">
        <span class="plan-name">{data.plan.name}</span>
        <span class="plan-price">
          {data.plan.price === 0 ? m.billing_free() : `${data.plan.formattedPrice}/mo`}
        </span>
      </div>
      <!-- Phase 1: Simple display. Upgrade flow is future -->
    </div>
  </section>

  <section class="billing-section">
    <h2>{m.billing_payment_method()}</h2>
    <!-- Phase 1: Display only, managed via Stripe portal -->
    <p class="muted">
      {m.billing_managed_via_stripe()}
    </p>
    <a href={data.stripePortalUrl} class="stripe-link" target="_blank">
      {m.billing_manage_in_stripe()}
    </a>
  </section>
</div>
```

---

## Remote Functions

### settings.remote.ts

```typescript
import { form, command } from '$app/server';
import * as v from 'valibot';
import { createServerApi } from '$lib/server/api';

const settingsSchema = v.object({
  'branding.primaryColor': v.pipe(v.string(), v.regex(/^#[0-9a-fA-F]{6}$/)),
  'branding.accentColor': v.pipe(v.string(), v.regex(/^#[0-9a-fA-F]{6}$/)),
  'general.name': v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  'general.description': v.optional(v.pipe(v.string(), v.maxLength(500))),
  'general.contactEmail': v.optional(v.pipe(v.string(), v.email())),
  'social.twitter': v.optional(v.string()),
  'social.youtube': v.optional(v.string()),
  'social.instagram': v.optional(v.string())
});

export const updateSettings = form(
  settingsSchema,
  async (data, { platform, cookies, params }) => {
    const api = createServerApi(platform);
    const sessionCookie = cookies.get('codex-session');

    // Transform flat form data to nested structure
    const settings = {
      branding: {
        primaryColor: data['branding.primaryColor'],
        accentColor: data['branding.accentColor']
      },
      general: {
        name: data['general.name'],
        description: data['general.description'],
        contactEmail: data['general.contactEmail']
      },
      social: {
        twitter: data['social.twitter'] || null,
        youtube: data['social.youtube'] || null,
        instagram: data['social.instagram'] || null
      }
    };

    await api.fetch(
      'settings',
      `/api/organizations/${params.slug}/settings`,
      sessionCookie,
      { method: 'PATCH', body: JSON.stringify(settings) }
    );

    return { success: true };
  }
);

export const uploadLogo = command(
  v.instanceof(File),
  async (file, { platform, cookies, params }) => {
    const api = createServerApi(platform);
    const sessionCookie = cookies.get('codex-session');

    const formData = new FormData();
    formData.append('logo', file);

    const result = await api.fetch<{ url: string }>(
      'settings',
      `/api/organizations/${params.slug}/settings/logo`,
      sessionCookie,
      { method: 'POST', body: formData }
    );

    return { url: result.url };
  }
);
```

---

## i18n Messages

```json
{
  "settings_title": "Settings",
  "settings_branding": "Branding",
  "settings_logo": "Organization Logo",
  "settings_upload_logo": "Upload Logo",
  "settings_logo_hint": "Recommended: 200x200px, PNG or JPG, max 2MB",
  "settings_logo_invalid_type": "Please upload an image file",
  "settings_logo_too_large": "File must be under 2MB",
  "settings_logo_upload_failed": "Upload failed. Please try again.",
  "settings_primary_color": "Primary Color",
  "settings_accent_color": "Accent Color",
  "settings_general": "General",
  "settings_org_name": "Organization Name",
  "settings_description": "Description",
  "settings_contact_email": "Contact Email",
  "settings_social": "Social Links",
  "settings_twitter": "Twitter",
  "settings_youtube": "YouTube",
  "settings_instagram": "Instagram",

  "billing_title": "Billing",
  "billing_current_plan": "Current Plan",
  "billing_free": "Free",
  "billing_payment_method": "Payment Method",
  "billing_managed_via_stripe": "Payment methods are managed through Stripe.",
  "billing_manage_in_stripe": "Manage in Stripe →"
}
```

---

## Dependencies

### Required

| Dependency | Status | Description |
|------------|--------|-------------|
| P1-FE-ADMIN-001 | ✅ | Studio layout |
| Settings-API | ✅ | Settings CRUD |

---

## Implementation Checklist

- [ ] **Settings Page**
  - [ ] Create route with role check
  - [ ] Build settings form sections
  - [ ] Implement updateSettings remote function

- [ ] **Branding Components**
  - [ ] ColorPicker with presets
  - [ ] LogoUpload with preview
  - [ ] Real-time preview (optional)

- [ ] **Billing Page**
  - [ ] Create owner-only route
  - [ ] Display current plan
  - [ ] Link to Stripe portal

- [ ] **Testing**
  - [ ] Form validation tests
  - [ ] Color picker tests
  - [ ] Upload tests

---

## Testing Strategy

### Unit Tests

```typescript
describe('ColorPicker', () => {
  it('validates hex color format');
  it('updates value on preset click');
});

describe('Settings Form', () => {
  it('validates required fields');
  it('submits updated settings');
});
```

### Integration Tests

```typescript
describe('Settings Page', () => {
  it('loads current settings');
  it('saves updated settings');
  it('restricts access to admin+');
});
```

---

**Last Updated**: 2026-01-12
**Template Version**: 1.0

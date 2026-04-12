# WP7: Frontend -- Studio Template Management

**Parent spec**: `docs/email-notifications-design-spec.md`
**Priority**: P2
**Dependencies**: WP6, WP2
**Estimated scope**: 8 files created/changed, ~900 lines of new code

---

## Goal

Build the studio UI for managing email templates -- list, create, edit with live preview, and test-send -- so org admins can customise transactional and marketing emails without code changes.

## Context

The notifications-api already has full template CRUD endpoints at three scope levels: `GET/POST /api/templates/global` (platform owner), `GET/POST/PATCH/DELETE /api/templates/organizations/:orgId` (org members with management rights), and `GET/POST/PATCH/DELETE /api/templates/creator` (creators). Preview (`POST /api/templates/:id/preview`) and test-send (`POST /api/templates/:id/test-send`) are also wired with rate limiting (20 req/min via `strict` preset). The studio is a client-rendered SPA (`ssr = false` in `_org/[slug]/studio/+layout.ts`), so `+page.server.ts` files still execute (SvelteKit calls them via fetch) but the initial render is client-side. The studio settings sub-navigation (`SETTINGS_NAV` in `apps/web/src/lib/config/navigation.ts`) currently has two entries: "General" and "Branding". No studio settings routes exist on disk yet -- they are likely rendered via the studio settings layout which reads `SETTINGS_NAV`. No frontend template management UI exists.

The 18 global templates are seeded in WP2. The unsubscribe footer context (from WP6) means non-transactional templates include `{{unsubscribeUrl}}` in their footer -- the editor must show this as a read-only system token, not editable by org admins.

## Changes

### `apps/web/src/lib/config/navigation.ts` (update)

Add "Email Templates" to `SETTINGS_NAV`:

```typescript
/** Studio settings sub-navigation (General, Branding, Email Templates) */
export const SETTINGS_NAV: NavLink[] = [
  { href: '/studio/settings', label: 'General' },
  { href: '/studio/settings/branding', label: 'Branding' },
  { href: '/studio/settings/email-templates', label: 'Email Templates' },
];
```

### `apps/web/src/lib/server/api.ts` (update)

Add template management methods to the API client. These call the notifications-api worker:

```typescript
import type {
  EmailTemplate,
  CreateOrgTemplateInput,
  UpdateTemplateInput,
  ListTemplatesQuery,
} from '@codex/validation';

// Inside createServerApi, add a `templates` namespace:
templates: {
  /** List templates for an organization */
  listOrgTemplates: (orgId: string, query?: ListTemplatesQuery) =>
    request<PaginatedListResponse<EmailTemplate>>(
      'notifications',
      `/api/templates/organizations/${orgId}?${toQueryString(query)}`
    ),

  /** List global templates (read-only reference) */
  listGlobalTemplates: (query?: ListTemplatesQuery) =>
    request<PaginatedListResponse<EmailTemplate>>(
      'notifications',
      `/api/templates/global?${toQueryString(query)}`
    ),

  /** Get a single template by ID */
  getTemplate: (orgId: string, id: string) =>
    request<EmailTemplate>(
      'notifications',
      `/api/templates/organizations/${orgId}/${id}`
    ),

  /** Create an org-scoped template */
  createOrgTemplate: (orgId: string, data: CreateOrgTemplateInput) =>
    request<EmailTemplate>(
      'notifications',
      `/api/templates/organizations/${orgId}`,
      { method: 'POST', body: JSON.stringify(data) }
    ),

  /** Update an org-scoped template */
  updateOrgTemplate: (orgId: string, id: string, data: UpdateTemplateInput) =>
    request<EmailTemplate>(
      'notifications',
      `/api/templates/organizations/${orgId}/${id}`,
      { method: 'PATCH', body: JSON.stringify(data) }
    ),

  /** Soft-delete an org-scoped template */
  deleteOrgTemplate: (orgId: string, id: string) =>
    request<null>(
      'notifications',
      `/api/templates/organizations/${orgId}/${id}`,
      { method: 'DELETE' }
    ),

  /** Preview a template with sample data */
  previewTemplate: (id: string, data: Record<string, unknown>) =>
    request<{ html: string }>(
      'notifications',
      `/api/templates/${id}/preview`,
      { method: 'POST', body: JSON.stringify({ data }) }
    ),

  /** Send a test email using a template */
  testSendTemplate: (id: string, recipientEmail: string, data?: Record<string, unknown>) =>
    request<{ sent: boolean }>(
      'notifications',
      `/api/templates/${id}/test-send`,
      { method: 'POST', body: JSON.stringify({ recipientEmail, data: data ?? {} }) }
    ),
},
```

Note: The `getTemplate` method calls the org-scoped endpoint. For global templates, the list endpoint returns full data. If a dedicated `GET /api/templates/global/:id` is needed for the editor (to show global templates in read-only mode), it already exists on the notifications-api.

### `apps/web/src/routes/(platform)/_org/[slug]/studio/settings/email-templates/+page.server.ts` (new)

Server load fetches org templates and global templates for the current org:

```typescript
import type { PageServerLoad } from './$types';
import { createServerApi } from '$lib/server/api';

export const load: PageServerLoad = async ({ parent, platform, cookies }) => {
  const { org } = await parent();
  const api = createServerApi(platform, cookies);

  // Fetch org templates and global templates in parallel
  const [orgTemplates, globalTemplates] = await Promise.all([
    api.templates.listOrgTemplates(org.id, { limit: 50 })
      .catch(() => ({ items: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } })),
    api.templates.listGlobalTemplates({ limit: 50 })
      .catch(() => ({ items: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } })),
  ]);

  return {
    orgTemplates,
    globalTemplates,
    orgId: org.id,
  };
};
```

### `apps/web/src/routes/(platform)/_org/[slug]/studio/settings/email-templates/+page.svelte` (new)

Template list page with tabs for org and global templates:

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import Badge from '$lib/components/ui/Badge/Badge.svelte';

  let { data } = $props();

  let activeTab: 'organization' | 'global' = $state('organization');

  const templates = $derived(
    activeTab === 'organization'
      ? data.orgTemplates.items
      : data.globalTemplates.items
  );

  const statusVariant = (status: string) => {
    switch (status) {
      case 'active': return 'success';
      case 'draft': return 'warning';
      case 'archived': return 'neutral';
      default: return 'neutral';
    }
  };

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  }
</script>

<svelte:head>
  <title>{m.studio_email_templates_title()} - Studio</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="templates-page">
  <div class="page-header">
    <h1>{m.studio_email_templates_title()}</h1>
    {#if activeTab === 'organization'}
      <Button
        variant="primary"
        size="sm"
        onclick={() => goto('/studio/settings/email-templates/new')}
      >
        {m.studio_email_templates_create()}
      </Button>
    {/if}
  </div>

  <div class="tabs" role="tablist">
    <button
      role="tab"
      class="tab"
      class:active={activeTab === 'organization'}
      aria-selected={activeTab === 'organization'}
      onclick={() => (activeTab = 'organization')}
    >
      {m.studio_email_templates_tab_org()}
    </button>
    <button
      role="tab"
      class="tab"
      class:active={activeTab === 'global'}
      aria-selected={activeTab === 'global'}
      onclick={() => (activeTab = 'global')}
    >
      {m.studio_email_templates_tab_global()}
    </button>
  </div>

  {#if templates.length === 0}
    <div class="empty-state">
      <p>{activeTab === 'organization'
        ? m.studio_email_templates_empty_org()
        : m.studio_email_templates_empty_global()}</p>
    </div>
  {:else}
    <div class="template-list">
      {#each templates as template (template.id)}
        <button
          class="template-row"
          onclick={() => {
            if (activeTab === 'organization') {
              goto(`/studio/settings/email-templates/${template.id}`);
            }
          }}
          disabled={activeTab === 'global'}
          aria-label={m.studio_email_templates_edit_label({ name: template.name })}
        >
          <div class="template-info">
            <span class="template-name">{template.name}</span>
            {#if template.description}
              <span class="template-desc">{template.description}</span>
            {/if}
          </div>
          <Badge variant={statusVariant(template.status)}>
            {template.status}
          </Badge>
          <span class="template-date">{formatDate(template.updatedAt)}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .templates-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .page-header h1 {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
  }

  .tabs {
    display: flex;
    gap: var(--space-1);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .tab {
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    background: none;
    border: none;
    border-bottom: var(--border-width-thick) var(--border-style) transparent;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .tab.active {
    color: var(--color-primary-500);
    border-bottom-color: var(--color-primary-500);
  }

  .tab:hover:not(.active) {
    color: var(--color-text);
  }

  .empty-state {
    text-align: center;
    padding: var(--space-12);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .template-list {
    display: flex;
    flex-direction: column;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .template-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    background: var(--color-surface);
    border: none;
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    cursor: pointer;
    text-align: left;
    transition: var(--transition-colors);
    width: 100%;
  }

  .template-row:last-child {
    border-bottom: none;
  }

  .template-row:hover:not(:disabled) {
    background: var(--color-surface-secondary);
  }

  .template-row:disabled {
    cursor: default;
  }

  .template-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .template-name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    font-family: var(--font-mono);
  }

  .template-desc {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .template-date {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  @media (max-width: 640px) {
    .template-row {
      grid-template-columns: 1fr auto;
    }

    .template-date {
      display: none;
    }
  }
</style>
```

### `apps/web/src/routes/(platform)/_org/[slug]/studio/settings/email-templates/new/+page.svelte` (new)

Create template form:

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import * as m from '$paraglide/messages';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import { Alert } from '$lib/components/ui';
  import { addToast } from '$lib/components/ui/Toast/toast-store';
  import { createServerApi } from '$lib/server/api';

  let { data } = $props();

  let name = $state('');
  let subject = $state('');
  let htmlBody = $state('');
  let textBody = $state('');
  let description = $state('');
  let status: 'draft' | 'active' = $state('draft');
  let error = $state('');
  let submitting = $state(false);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    submitting = true;
    error = '';

    try {
      const response = await fetch(
        `/api/templates/organizations/${data.orgId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, subject, htmlBody, textBody, description, status }),
        }
      );

      if (!response.ok) {
        const err = await response.json();
        error = err.error?.message ?? m.studio_email_templates_create_error();
        return;
      }

      addToast({ type: 'success', message: m.studio_email_templates_create_success() });
      goto('/studio/settings/email-templates');
    } catch {
      error = m.studio_email_templates_create_error();
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>{m.studio_email_templates_create()} - Studio</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="create-template">
  <h1>{m.studio_email_templates_create()}</h1>

  {#if error}
    <Alert variant="error" style="margin-bottom: var(--space-4)">{error}</Alert>
  {/if}

  <form onsubmit={handleSubmit} class="template-form">
    <div class="form-field">
      <Label for="name">{m.studio_email_templates_field_name()}</Label>
      <Input
        id="name"
        bind:value={name}
        placeholder="e.g. welcome-custom"
        pattern="[a-z][a-z0-9-]*[a-z0-9]"
        required
      />
      <span class="field-hint">{m.studio_email_templates_name_hint()}</span>
    </div>

    <div class="form-field">
      <Label for="subject">{m.studio_email_templates_field_subject()}</Label>
      <Input id="subject" bind:value={subject} required />
    </div>

    <div class="form-field">
      <Label for="htmlBody">{m.studio_email_templates_field_html_body()}</Label>
      <textarea id="htmlBody" bind:value={htmlBody} rows="12" class="code-editor" required></textarea>
    </div>

    <div class="form-field">
      <Label for="textBody">{m.studio_email_templates_field_text_body()}</Label>
      <textarea id="textBody" bind:value={textBody} rows="6" class="code-editor" required></textarea>
    </div>

    <div class="form-field">
      <Label for="description">{m.studio_email_templates_field_description()}</Label>
      <Input id="description" bind:value={description} />
    </div>

    <div class="form-field">
      <Label for="status">{m.studio_email_templates_field_status()}</Label>
      <select id="status" bind:value={status} class="select">
        <option value="draft">{m.studio_email_templates_status_draft()}</option>
        <option value="active">{m.studio_email_templates_status_active()}</option>
      </select>
    </div>

    <div class="form-actions">
      <Button
        type="button"
        variant="ghost"
        onclick={() => goto('/studio/settings/email-templates')}
      >
        {m.common_cancel()}
      </Button>
      <Button type="submit" variant="primary" loading={submitting}>
        {m.studio_email_templates_create()}
      </Button>
    </div>
  </form>
</div>

<style>
  .create-template h1 {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin-bottom: var(--space-6);
  }

  .template-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    max-width: 40rem;
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-hint {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .code-editor {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    resize: vertical;
    line-height: var(--leading-relaxed);
  }

  .code-editor:focus {
    outline: none;
    border-color: var(--color-primary-500);
    box-shadow: var(--shadow-focus);
  }

  .select {
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-sm);
  }

  .form-actions {
    display: flex;
    gap: var(--space-3);
    justify-content: flex-end;
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }
</style>
```

### `apps/web/src/routes/(platform)/_org/[slug]/studio/settings/email-templates/[id]/+page.server.ts` (new)

Server load to fetch a single template for editing:

```typescript
import type { PageServerLoad } from './$types';
import { createServerApi } from '$lib/server/api';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ parent, params, platform, cookies }) => {
  const { org } = await parent();
  const api = createServerApi(platform, cookies);

  try {
    const template = await api.templates.getTemplate(org.id, params.id);
    return { template, orgId: org.id };
  } catch {
    error(404, 'Template not found');
  }
};
```

### `apps/web/src/routes/(platform)/_org/[slug]/studio/settings/email-templates/[id]/+page.svelte` (new)

Split-layout editor with live preview, token reference, test-send, and delete:

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import * as m from '$paraglide/messages';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import Badge from '$lib/components/ui/Badge/Badge.svelte';
  import { Alert } from '$lib/components/ui';
  import { addToast } from '$lib/components/ui/Toast/toast-store';

  let { data } = $props();

  // Editable fields (initialised from server data)
  let subject = $state(data.template.subject);
  let htmlBody = $state(data.template.htmlBody);
  let textBody = $state(data.template.textBody);
  let description = $state(data.template.description ?? '');
  let status = $state(data.template.status);

  // Preview state
  let previewHtml = $state('');
  let previewLoading = $state(false);
  let previewTimer: ReturnType<typeof setTimeout> | null = null;

  // Save/delete state
  let saving = $state(false);
  let error = $state('');
  let showDeleteConfirm = $state(false);
  let deleting = $state(false);

  // Test send state
  let showTestSend = $state(false);
  let testEmail = $state('');
  let testSending = $state(false);

  // Token reference for this template
  const TEMPLATE_TOKENS: Record<string, string[]> = {
    _brand: ['platformName', 'logoUrl', 'primaryColor', 'secondaryColor', 'supportEmail', 'contactUrl'],
    _unsubscribe: ['unsubscribeUrl'],
    'purchase-receipt': ['userName', 'contentTitle', 'priceFormatted', 'purchaseDate', 'contentUrl', 'orgName'],
    'subscription-created': ['userName', 'planName', 'priceFormatted', 'billingInterval', 'nextBillingDate', 'manageUrl'],
    'subscription-renewed': ['userName', 'planName', 'priceFormatted', 'billingDate', 'nextBillingDate', 'manageUrl'],
    'payment-failed': ['userName', 'planName', 'priceFormatted', 'retryDate', 'updatePaymentUrl'],
    'subscription-cancelled': ['userName', 'planName', 'accessEndDate', 'resubscribeUrl'],
    'refund-processed': ['userName', 'contentTitle', 'refundAmount', 'originalAmount', 'refundDate'],
    'email-verification': ['userName', 'verificationUrl', 'expiryHours'],
    'org-member-invitation': ['inviterName', 'orgName', 'roleName', 'acceptUrl', 'expiryDays'],
    'password-reset': ['userName', 'resetUrl', 'expiryHours'],
    'password-changed': ['userName', 'supportUrl'],
    'welcome': ['userName', 'loginUrl', 'exploreUrl'],
    'transcoding-complete': ['userName', 'contentTitle', 'contentUrl', 'duration'],
    'transcoding-failed': ['userName', 'contentTitle', 'errorSummary', 'retryUrl'],
    'new-sale': ['creatorName', 'contentTitle', 'saleAmount', 'buyerName', 'dashboardUrl'],
    'connect-account-status': ['creatorName', 'accountStatus', 'actionRequired', 'dashboardUrl'],
    'new-content-published': ['userName', 'contentTitle', 'creatorName', 'contentUrl', 'contentDescription'],
    'weekly-digest': ['userName', 'newContentCount', 'topContent', 'platformUrl'],
    'member-role-changed': ['userName', 'orgName', 'oldRole', 'newRole'],
    'member-removed': ['userName', 'orgName'],
  };

  const allowedTokens = $derived(
    [
      ...(TEMPLATE_TOKENS[data.template.name] ?? []),
      ...TEMPLATE_TOKENS._brand,
      ...TEMPLATE_TOKENS._unsubscribe,
    ]
  );

  // Debounced preview fetch
  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(fetchPreview, 500);
  }

  async function fetchPreview() {
    previewLoading = true;
    try {
      const sampleData: Record<string, string> = {};
      for (const token of allowedTokens) {
        sampleData[token] = `[${token}]`;
      }

      const response = await fetch(`/api/templates/${data.template.id}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: sampleData }),
      });

      if (response.ok) {
        const result = await response.json();
        previewHtml = result.data?.html ?? '';
      }
    } catch {
      // Preview failure is non-critical
    } finally {
      previewLoading = false;
    }
  }

  // Auto-preview on subject/body changes
  $effect(() => {
    // Touch reactive deps
    subject; htmlBody;
    schedulePreview();
  });

  async function handleSave() {
    saving = true;
    error = '';

    try {
      const response = await fetch(
        `/api/templates/organizations/${data.orgId}/${data.template.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject, htmlBody, textBody, description, status }),
        }
      );

      if (!response.ok) {
        const err = await response.json();
        error = err.error?.message ?? m.studio_email_templates_save_error();
        return;
      }

      addToast({ type: 'success', message: m.studio_email_templates_save_success() });
    } catch {
      error = m.studio_email_templates_save_error();
    } finally {
      saving = false;
    }
  }

  async function handleDelete() {
    deleting = true;
    try {
      const response = await fetch(
        `/api/templates/organizations/${data.orgId}/${data.template.id}`,
        { method: 'DELETE' }
      );

      if (response.ok || response.status === 204) {
        addToast({ type: 'success', message: m.studio_email_templates_delete_success() });
        goto('/studio/settings/email-templates');
      }
    } catch {
      addToast({ type: 'error', message: m.studio_email_templates_delete_error() });
    } finally {
      deleting = false;
      showDeleteConfirm = false;
    }
  }

  async function handleTestSend() {
    testSending = true;
    try {
      const response = await fetch(`/api/templates/${data.template.id}/test-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientEmail: testEmail, data: {} }),
      });

      if (response.ok) {
        addToast({ type: 'success', message: m.studio_email_templates_test_send_success() });
        showTestSend = false;
        testEmail = '';
      } else {
        addToast({ type: 'error', message: m.studio_email_templates_test_send_error() });
      }
    } catch {
      addToast({ type: 'error', message: m.studio_email_templates_test_send_error() });
    } finally {
      testSending = false;
    }
  }
</script>

<svelte:head>
  <title>{m.studio_email_templates_edit_title({ name: data.template.name })} - Studio</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="editor-page">
  <div class="editor-header">
    <div class="header-left">
      <Button variant="ghost" size="sm" onclick={() => goto('/studio/settings/email-templates')}>
        &larr; {m.common_back()}
      </Button>
      <h1>{data.template.name}</h1>
      <Badge variant={status === 'active' ? 'success' : 'warning'}>{status}</Badge>
    </div>
    <div class="header-actions">
      <Button variant="ghost" size="sm" onclick={() => (showTestSend = true)}>
        {m.studio_email_templates_test_send()}
      </Button>
      <Button variant="destructive" size="sm" onclick={() => (showDeleteConfirm = true)}>
        {m.studio_email_templates_delete()}
      </Button>
      <Button variant="primary" size="sm" loading={saving} onclick={handleSave}>
        {m.studio_email_templates_save()}
      </Button>
    </div>
  </div>

  {#if error}
    <Alert variant="error" style="margin-bottom: var(--space-4)">{error}</Alert>
  {/if}

  <div class="editor-layout">
    <!-- Left: Editor -->
    <div class="editor-panel">
      <div class="form-field">
        <Label for="subject">{m.studio_email_templates_field_subject()}</Label>
        <Input id="subject" bind:value={subject} />
      </div>

      <div class="form-field">
        <Label for="htmlBody">{m.studio_email_templates_field_html_body()}</Label>
        <textarea id="htmlBody" bind:value={htmlBody} rows="16" class="code-editor"></textarea>
      </div>

      <div class="form-field">
        <Label for="textBody">{m.studio_email_templates_field_text_body()}</Label>
        <textarea id="textBody" bind:value={textBody} rows="8" class="code-editor"></textarea>
      </div>

      <div class="form-field">
        <Label for="description">{m.studio_email_templates_field_description()}</Label>
        <Input id="description" bind:value={description} />
      </div>

      <div class="form-field">
        <Label for="status">{m.studio_email_templates_field_status()}</Label>
        <select id="status" bind:value={status} class="select">
          <option value="draft">{m.studio_email_templates_status_draft()}</option>
          <option value="active">{m.studio_email_templates_status_active()}</option>
          <option value="archived">{m.studio_email_templates_status_archived()}</option>
        </select>
      </div>

      <!-- Token reference -->
      <div class="token-reference">
        <h3>{m.studio_email_templates_tokens_title()}</h3>
        <p class="token-hint">{m.studio_email_templates_tokens_hint()}</p>
        <div class="token-list">
          {#each allowedTokens as token}
            <code class="token-chip">{`{{${token}}}`}</code>
          {/each}
        </div>
      </div>
    </div>

    <!-- Right: Preview -->
    <div class="preview-panel">
      <h3>{m.studio_email_templates_preview_title()}</h3>
      {#if previewLoading}
        <div class="preview-loading">
          <span>{m.common_loading()}</span>
        </div>
      {:else if previewHtml}
        <iframe
          title={m.studio_email_templates_preview_title()}
          srcdoc={previewHtml}
          class="preview-iframe"
          sandbox=""
        ></iframe>
      {:else}
        <div class="preview-empty">
          <p>{m.studio_email_templates_preview_empty()}</p>
        </div>
      {/if}
    </div>
  </div>

  <!-- Test Send Dialog -->
  {#if showTestSend}
    <div class="dialog-overlay" role="presentation" onclick={() => (showTestSend = false)}>
      <div class="dialog" role="dialog" aria-label={m.studio_email_templates_test_send()} onclick|stopPropagation>
        <h2>{m.studio_email_templates_test_send()}</h2>
        <div class="form-field">
          <Label for="testEmail">{m.studio_email_templates_test_send_email()}</Label>
          <Input id="testEmail" type="email" bind:value={testEmail} required />
        </div>
        <div class="dialog-actions">
          <Button variant="ghost" onclick={() => (showTestSend = false)}>
            {m.common_cancel()}
          </Button>
          <Button
            variant="primary"
            loading={testSending}
            disabled={!testEmail}
            onclick={handleTestSend}
          >
            {m.studio_email_templates_test_send_button()}
          </Button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Delete Confirmation Dialog -->
  {#if showDeleteConfirm}
    <div class="dialog-overlay" role="presentation" onclick={() => (showDeleteConfirm = false)}>
      <div class="dialog" role="alertdialog" aria-label={m.studio_email_templates_delete_confirm_title()} onclick|stopPropagation>
        <h2>{m.studio_email_templates_delete_confirm_title()}</h2>
        <p>{m.studio_email_templates_delete_confirm_message({ name: data.template.name })}</p>
        <div class="dialog-actions">
          <Button variant="ghost" onclick={() => (showDeleteConfirm = false)}>
            {m.common_cancel()}
          </Button>
          <Button variant="destructive" loading={deleting} onclick={handleDelete}>
            {m.studio_email_templates_delete_confirm_button()}
          </Button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .editor-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .header-left h1 {
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
  }

  .header-actions {
    display: flex;
    gap: var(--space-2);
  }

  .editor-layout {
    display: grid;
    grid-template-columns: 3fr 2fr;
    gap: var(--space-6);
  }

  @media (max-width: 1024px) {
    .editor-layout {
      grid-template-columns: 1fr;
    }
  }

  .editor-panel,
  .preview-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .preview-panel h3,
  .token-reference h3 {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .code-editor {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    resize: vertical;
    line-height: var(--leading-relaxed);
  }

  .code-editor:focus {
    outline: none;
    border-color: var(--color-primary-500);
    box-shadow: var(--shadow-focus);
  }

  .select {
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-sm);
  }

  .preview-iframe {
    width: 100%;
    min-height: 24rem;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: white;
  }

  .preview-loading,
  .preview-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 12rem;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .token-reference {
    padding: var(--space-4);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .token-hint {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .token-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .token-chip {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    padding: var(--space-1) var(--space-2);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-primary-500);
  }

  /* Dialog styles */
  .dialog-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal);
    padding: var(--space-4);
  }

  .dialog {
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    max-width: 28rem;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .dialog h2 {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
  }

  .dialog p {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .dialog-actions {
    display: flex;
    gap: var(--space-3);
    justify-content: flex-end;
  }
</style>
```

### `apps/web/src/paraglide/messages/en.js` (update)

Add i18n keys for all template management UI:

```javascript
// Studio Email Templates
export const studio_email_templates_title = () => 'Email Templates';
export const studio_email_templates_create = () => 'Create Template';
export const studio_email_templates_tab_org = () => 'Organisation';
export const studio_email_templates_tab_global = () => 'Global (Defaults)';
export const studio_email_templates_empty_org = () =>
  'No custom templates yet. Global templates are used as defaults.';
export const studio_email_templates_empty_global = () =>
  'No global templates found.';
export const studio_email_templates_edit_label = ({ name }) =>
  `Edit template: ${name}`;
export const studio_email_templates_edit_title = ({ name }) =>
  `Edit: ${name}`;
export const studio_email_templates_field_name = () => 'Template Name';
export const studio_email_templates_name_hint = () =>
  'Kebab-case identifier (e.g. welcome-custom). Must match an existing template name to override it.';
export const studio_email_templates_field_subject = () => 'Subject';
export const studio_email_templates_field_html_body = () => 'HTML Body';
export const studio_email_templates_field_text_body = () => 'Text Body';
export const studio_email_templates_field_description = () => 'Description';
export const studio_email_templates_field_status = () => 'Status';
export const studio_email_templates_status_draft = () => 'Draft';
export const studio_email_templates_status_active = () => 'Active';
export const studio_email_templates_status_archived = () => 'Archived';
export const studio_email_templates_save = () => 'Save';
export const studio_email_templates_save_success = () =>
  'Template saved successfully.';
export const studio_email_templates_save_error = () =>
  'Failed to save template. Please try again.';
export const studio_email_templates_create_success = () =>
  'Template created successfully.';
export const studio_email_templates_create_error = () =>
  'Failed to create template. Please try again.';
export const studio_email_templates_delete = () => 'Delete';
export const studio_email_templates_delete_success = () =>
  'Template deleted.';
export const studio_email_templates_delete_error = () =>
  'Failed to delete template. Please try again.';
export const studio_email_templates_delete_confirm_title = () =>
  'Delete Template';
export const studio_email_templates_delete_confirm_message = ({ name }) =>
  `Are you sure you want to delete "${name}"? The global default will be used instead.`;
export const studio_email_templates_delete_confirm_button = () =>
  'Delete Template';
export const studio_email_templates_test_send = () => 'Test Send';
export const studio_email_templates_test_send_email = () =>
  'Recipient Email';
export const studio_email_templates_test_send_button = () => 'Send Test';
export const studio_email_templates_test_send_success = () =>
  'Test email sent successfully.';
export const studio_email_templates_test_send_error = () =>
  'Failed to send test email. Please try again.';
export const studio_email_templates_preview_title = () => 'Preview';
export const studio_email_templates_preview_empty = () =>
  'Save or edit the template to see a preview.';
export const studio_email_templates_tokens_title = () => 'Available Tokens';
export const studio_email_templates_tokens_hint = () =>
  'Use these tokens in your template with {{tokenName}} syntax. Brand and unsubscribe tokens are injected automatically.';
```

---

## Verification

### Unit Tests

No new unit tests required for the frontend pages themselves. Validation logic relies on the existing `@codex/validation` schemas tested in WP2.

### Integration Tests

- Ensure the `api.templates.listOrgTemplates()` and `api.templates.listGlobalTemplates()` methods return the expected paginated response shape from the notifications-api.
- Ensure `api.templates.createOrgTemplate()` returns a 201 with the created template.
- Ensure `api.templates.previewTemplate()` returns rendered HTML.
- Ensure `api.templates.testSendTemplate()` returns a success indicator.

### Manual Verification

1. Run `pnpm dev` from monorepo root.
2. Login as `creator@test.com` / `Test1234!`.
3. Navigate to an org studio.
4. Click "Settings" in the sidebar.
5. Verify "Email Templates" tab appears in settings navigation.
6. Click "Email Templates" -- verify global tab shows seeded templates (from WP2).
7. Click "Organisation" tab -- verify empty state message.
8. Click "Create Template" -- fill in all fields -- click create -- verify redirect to list.
9. Verify new template appears in the organisation tab.
10. Click the template -- verify editor loads with preview pane.
11. Edit the subject line -- wait 500ms -- verify preview updates.
12. Click "Test Send" -- enter email -- send -- verify success toast.
13. Click "Delete" -- confirm -- verify removed from list.

### Playwright/Chrome DevTools

**`apps/web/e2e/studio-email-templates.spec.ts`** (new):

1. Login as creator, navigate to studio settings, click "Email Templates".
2. Verify template list loads; "Global (Defaults)" tab shows seeded templates.
3. Click "Create Template", fill form (name: `test-override`, subject: `Test Subject`, htmlBody: `<p>{{userName}} hello</p>...` (min 10 chars), textBody: `Hello {{userName}}...` (min 10 chars)), save.
4. Verify redirect to list; new template appears in "Organisation" tab.
5. Click template row, verify editor loads with correct data in fields.
6. Change subject text, wait 600ms, verify preview iframe updates (check srcdoc attribute or iframe content).
7. Click "Test Send", enter `test@example.com`, send, verify success toast.
8. Click "Delete", confirm in dialog, verify redirect to list, template gone.
9. Switch to "Global (Defaults)" tab, verify rows are not clickable (disabled state).

**Chrome DevTools checks:**
- Network tab: no 4xx/5xx errors during full create/edit/delete flow.
- Console: no runtime errors or unhandled promise rejections.
- Accessibility: tab through all form controls, verify focus returns to list after dialog close.
- Layout: resize to 768px width, verify editor stacks vertically (no horizontal overflow).

---

## Review Checklist

- [ ] Uses design tokens for ALL CSS values (no hardcoded px, hex, or raw values)
- [ ] Uses Svelte 5 runes (`$props`, `$state`, `$derived`, `$effect`) -- no legacy `export let` or stores
- [ ] Uses `$app/state` (`page`) -- not `$app/stores` (`$page`)
- [ ] Uses `goto()` from `$app/navigation` for programmatic navigation
- [ ] All user-facing strings use paraglide message functions (no hardcoded English)
- [ ] Form uses `onsubmit` handler pattern (SPA mode, no progressive enhancement needed since `ssr = false`)
- [ ] Preview uses sandboxed `<iframe>` with `sandbox=""` (no script execution)
- [ ] Debounced preview (500ms) to avoid excessive API calls
- [ ] Dialog overlays trap focus and close on backdrop click
- [ ] Delete uses confirmation dialog before destructive action
- [ ] Responsive layout: side-by-side on desktop (1024px+), stacked on mobile
- [ ] No `as any` type casts
- [ ] `SETTINGS_NAV` is the single source of truth for settings tabs
- [ ] Global templates displayed as read-only (disabled rows, no edit/delete)
- [ ] Token reference shows the correct tokens for the template name from `TEMPLATE_TOKENS`

---

## Acceptance Criteria

- [ ] "Email Templates" item appears in studio settings navigation
- [ ] Template list page shows tabs for "Organisation" (editable) and "Global (Defaults)" (read-only)
- [ ] Global templates from seed are visible in the global tab
- [ ] Can create a new org-scoped template with all fields (name, subject, htmlBody, textBody, description, status)
- [ ] Can edit an existing template with live HTML preview (debounced 500ms)
- [ ] Token reference sidebar shows the allowed tokens for the template name
- [ ] Can test-send a template to an arbitrary email address via dialog
- [ ] Can soft-delete a template with confirmation dialog
- [ ] Success and error toasts display for all mutation actions
- [ ] All UI uses design tokens and i18n (paraglide messages)
- [ ] Layout is responsive (stacked on mobile, side-by-side on desktop)

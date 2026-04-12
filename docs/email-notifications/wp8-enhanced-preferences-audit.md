# WP8: Frontend -- Enhanced Preferences & Audit Log

**Parent spec**: `docs/email-notifications-design-spec.md`
**Priority**: P2
**Dependencies**: WP6, WP1
**Estimated scope**: 8 files created/changed, ~600 lines of new code

---

## Goal

Restructure the notification preferences page with clear category descriptions and a locked transactional toggle, then build a studio email audit log viewer so org admins can see what emails have been sent, their delivery status, and failure details.

## Context

The `/account/notifications` page exists at `apps/web/src/routes/(platform)/account/notifications/+page.svelte` with 3 toggles (marketing, transactional, digest) that all look identical -- there is no visual distinction indicating that transactional emails cannot be disabled. The toggles use a `form()` remote function (`updateNotificationsForm`) backed by `PUT /api/user/notification-preferences` on identity-api, which proxies to the `notificationPreferences` table.

The `emailAuditLogs` table (in `packages/database/src/schema/notifications.ts`) stores every email send attempt with columns: `id`, `organizationId`, `creatorId`, `templateName`, `recipientEmail`, `status` (pending/success/failed), `error`, `metadata` (JSON text), `createdAt`, `updatedAt`. This table is populated by WP1's `NotificationsService.sendEmail()` pipeline but has no frontend viewer. The notifications-api currently has no endpoint that queries audit logs -- a new internal endpoint is needed.

The studio is a client-rendered SPA (`ssr = false`). The studio settings navigation (`SETTINGS_NAV`) is defined in `apps/web/src/lib/config/navigation.ts`.

## Changes

### `apps/web/src/routes/(platform)/account/notifications/+page.svelte` (update)

Restructure into three clearly described sections with visual differentiation for the locked transactional toggle. The form submission pattern (using `updateNotificationsForm` remote function) remains unchanged -- only the presentation is updated.

```svelte
<script lang="ts">
  import { onDestroy } from 'svelte';
  import * as m from '$paraglide/messages';
  import { updateNotificationsForm } from '$lib/remote/account.remote';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
  import Switch from '$lib/components/ui/Switch/Switch.svelte';
  import { Alert } from '$lib/components/ui';

  let { data } = $props();
  const preferences = data.preferences;

  let marketingChecked = $state(preferences?.emailMarketing ?? false);
  let transactionalChecked = $state(preferences?.emailTransactional ?? true);
  let digestChecked = $state(preferences?.emailDigest ?? false);

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
    if (updateNotificationsForm.result?.success && !updateNotificationsForm.pending) {
      showSuccessMessage();
    }
  });
</script>

<svelte:head>
  <title>{m.account_notifications_title()} - Codex</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="notifications">
  <h1>{m.account_notifications_title()}</h1>
  <p class="description">{m.account_notifications_description()}</p>

  <!-- Info callout -->
  <div class="info-callout">
    <p>{m.account_notifications_info_callout()}</p>
  </div>

  {#if showSuccess}
    <Alert variant="success" style="margin-bottom: var(--space-4)">
      {m.account_notifications_save_success()}
    </Alert>
  {/if}

  {#if updateNotificationsForm.result?.error}
    <Alert variant="error" style="margin-bottom: var(--space-4)">
      {updateNotificationsForm.result.error}
    </Alert>
  {/if}

  <form {...updateNotificationsForm} class="settings-card">
    <!-- Transactional Emails (always on, disabled) -->
    <div class="category-section">
      <div class="toggle-row toggle-row--locked">
        <div class="toggle-info">
          <Label for="emailTransactional">
            {m.account_notifications_transactional()}
          </Label>
          <span class="toggle-desc">
            {m.account_notifications_transactional_desc_enhanced()}
          </span>
        </div>
        {#if transactionalChecked}
          <input type="hidden" name="b:emailTransactional" value="on" />
        {/if}
        <div class="toggle-with-tooltip">
          <Switch
            id="emailTransactional"
            bind:checked={transactionalChecked}
            disabled={true}
          />
          <span class="locked-hint">
            {m.account_notifications_transactional_locked()}
          </span>
        </div>
      </div>
    </div>

    <!-- Marketing Emails -->
    <div class="category-section">
      <div class="toggle-row">
        <div class="toggle-info">
          <Label for="emailMarketing">
            {m.account_notifications_marketing()}
          </Label>
          <span class="toggle-desc">
            {m.account_notifications_marketing_desc_enhanced()}
          </span>
        </div>
        {#if marketingChecked}
          <input type="hidden" name="b:emailMarketing" value="on" />
        {/if}
        <Switch
          id="emailMarketing"
          bind:checked={marketingChecked}
          disabled={updateNotificationsForm.pending > 0}
        />
      </div>
    </div>

    <!-- Weekly Digest -->
    <div class="category-section">
      <div class="toggle-row">
        <div class="toggle-info">
          <Label for="emailDigest">
            {m.account_notifications_digest()}
          </Label>
          <span class="toggle-desc">
            {m.account_notifications_digest_desc_enhanced()}
          </span>
        </div>
        {#if digestChecked}
          <input type="hidden" name="b:emailDigest" value="on" />
        {/if}
        <Switch
          id="emailDigest"
          bind:checked={digestChecked}
          disabled={updateNotificationsForm.pending > 0}
        />
      </div>
    </div>

    <div class="form-actions">
      <Button
        type="submit"
        variant="primary"
        loading={updateNotificationsForm.pending > 0}
      >
        {updateNotificationsForm.pending > 0
          ? m.common_loading()
          : m.account_notifications_save_button()}
      </Button>
    </div>
  </form>
</div>

<style>
  .notifications h1 {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin-bottom: var(--space-2);
  }

  .description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin-bottom: var(--space-4);
  }

  .info-callout {
    padding: var(--space-3) var(--space-4);
    background-color: var(--color-info-50);
    border: var(--border-width) var(--border-style) var(--color-info-200);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-6);
  }

  .info-callout p {
    font-size: var(--text-sm);
    color: var(--color-info-700);
    margin: 0;
    line-height: var(--leading-relaxed);
  }

  .settings-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-0);
  }

  .category-section {
    padding: var(--space-5) var(--space-6);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    margin-bottom: var(--space-3);
  }

  .toggle-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .toggle-row--locked {
    opacity: 0.7;
  }

  .toggle-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    flex: 1;
  }

  .toggle-desc {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
    max-width: 32rem;
  }

  .toggle-with-tooltip {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-1);
  }

  .locked-hint {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    font-style: italic;
  }

  .form-actions {
    margin-top: var(--space-4);
  }
</style>
```

### `apps/web/src/paraglide/messages/en.js` (update -- preferences)

Add enhanced description keys (the original short keys remain for backward compatibility; only the `_enhanced` variants are new):

```javascript
// Enhanced notification preference descriptions
export const account_notifications_info_callout = () =>
  'Some emails (like purchase receipts and password resets) will always be sent for security and compliance.';
export const account_notifications_transactional_desc_enhanced = () =>
  'Receipts, security notices, and account alerts. These cannot be disabled.';
export const account_notifications_transactional_locked = () =>
  'Always on';
export const account_notifications_marketing_desc_enhanced = () =>
  'Product updates, new content announcements, and promotional emails.';
export const account_notifications_digest_desc_enhanced = () =>
  'A weekly summary of new content and activity on the platform.';
```

### `packages/validation/src/schemas/notifications.ts` (extend)

Add the audit log query schema below the existing notification preferences schemas:

```typescript
// ============================================
// Audit Log Query Schema
// ============================================

export const auditLogQuerySchema = z.object({
  organizationId: uuidSchema,
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['success', 'failed', 'skipped', 'pending']).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
```

Also export from `packages/validation/src/index.ts`.

### `workers/notifications-api/src/routes/internal.ts` (extend)

Add `GET /internal/audit-logs` endpoint below the existing `POST /internal/send`. This is a worker-authenticated endpoint (HMAC) for server-side use by the web app:

```typescript
import { auditLogQuerySchema } from '@codex/validation';
import { emailAuditLogs } from '@codex/database/schema';
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import { PaginatedResult } from '@codex/worker-utils';

/**
 * GET /internal/audit-logs
 * Query email audit logs for an organization.
 * Worker-to-worker auth (HMAC). Emails are masked for privacy.
 */
app.get(
  '/audit-logs',
  procedure({
    policy: { auth: 'worker' },
    input: { query: auditLogQuerySchema },
    handler: async (ctx) => {
      const { organizationId, page, limit, status, dateFrom, dateTo } = ctx.input.query;
      const db = ctx.services.db; // Or however the DB client is accessed

      const conditions = [eq(emailAuditLogs.organizationId, organizationId)];

      if (status) {
        conditions.push(eq(emailAuditLogs.status, status));
      }
      if (dateFrom) {
        conditions.push(gte(emailAuditLogs.createdAt, new Date(dateFrom)));
      }
      if (dateTo) {
        conditions.push(lte(emailAuditLogs.createdAt, new Date(dateTo)));
      }

      const where = and(...conditions);
      const offset = (page - 1) * limit;

      const [items, countResult] = await Promise.all([
        db
          .select({
            id: emailAuditLogs.id,
            templateName: emailAuditLogs.templateName,
            recipientEmail: emailAuditLogs.recipientEmail,
            status: emailAuditLogs.status,
            error: emailAuditLogs.error,
            metadata: emailAuditLogs.metadata,
            createdAt: emailAuditLogs.createdAt,
          })
          .from(emailAuditLogs)
          .where(where)
          .orderBy(desc(emailAuditLogs.createdAt))
          .limit(limit)
          .offset(offset),

        db
          .select({ count: sql<number>`count(*)` })
          .from(emailAuditLogs)
          .where(where),
      ]);

      const total = Number(countResult[0]?.count ?? 0);

      // Mask email addresses for privacy: j***@example.com
      const maskedItems = items.map((item) => ({
        ...item,
        recipientEmail: maskEmail(item.recipientEmail),
      }));

      return new PaginatedResult(maskedItems, {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      });
    },
  })
);

/**
 * Mask an email address for privacy.
 * "jane.doe@example.com" -> "j***@example.com"
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***@***';
  return `${local[0]}***@${domain}`;
}
```

### `apps/web/src/lib/server/api.ts` (update)

Add audit log method to the API client. This calls the notifications-api internal endpoint via the server API (which can forward HMAC headers since it runs server-side):

```typescript
// Inside createServerApi, add to the existing templates/notifications namespace:
audit: {
  /** List email audit logs for an organization */
  listAuditLogs: (params: {
    organizationId: string;
    page?: number;
    limit?: number;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }) =>
    request<PaginatedListResponse<AuditLogEntry>>(
      'notifications',
      `/internal/audit-logs?${toQueryString(params)}`
    ),
},
```

Note: The web app server load runs in a trusted server context. The `createServerApi` function forwards the session cookie. However, the `/internal/audit-logs` endpoint uses `auth: 'worker'` policy (HMAC), so the server API client must also sign these requests with the worker shared secret. If the existing `createServerApi` does not support HMAC signing, an alternative is to change the audit logs endpoint to use `auth: 'required', requireOrgMembership: true, requireOrgManagement: true` -- this makes it a regular authenticated endpoint that org admins can call directly, which is simpler and still secure. This is the recommended approach.

**Recommended revision**: Change the audit log endpoint from `auth: 'worker'` to session-based auth:

```typescript
app.get(
  '/audit-logs',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: auditLogQuerySchema },
    handler: async (ctx) => {
      // Same handler as above
    },
  })
);
```

Mount as `/api/audit-logs` instead of `/internal/audit-logs` so it is accessible from the web app via the standard API client.

### `apps/web/src/lib/config/navigation.ts` (update)

Add "Email Audit" to `SETTINGS_NAV` (after WP7's "Email Templates" entry):

```typescript
export const SETTINGS_NAV: NavLink[] = [
  { href: '/studio/settings', label: 'General' },
  { href: '/studio/settings/branding', label: 'Branding' },
  { href: '/studio/settings/email-templates', label: 'Email Templates' },
  { href: '/studio/settings/email-audit', label: 'Email Audit' },
];
```

### `apps/web/src/routes/(platform)/_org/[slug]/studio/settings/email-audit/+page.server.ts` (new)

Server load fetches audit logs for the current org:

```typescript
import type { PageServerLoad } from './$types';
import { createServerApi } from '$lib/server/api';

export const load: PageServerLoad = async ({ parent, platform, cookies, url }) => {
  const { org } = await parent();
  const api = createServerApi(platform, cookies);

  const page = Number(url.searchParams.get('page') ?? '1');
  const limit = Number(url.searchParams.get('limit') ?? '20');
  const status = url.searchParams.get('status') ?? undefined;
  const dateFrom = url.searchParams.get('dateFrom') ?? undefined;
  const dateTo = url.searchParams.get('dateTo') ?? undefined;

  const auditLogs = await api.audit
    .listAuditLogs({
      organizationId: org.id,
      page,
      limit,
      status,
      dateFrom,
      dateTo,
    })
    .catch(() => ({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    }));

  return {
    auditLogs,
    orgId: org.id,
    filters: { status, dateFrom, dateTo },
  };
};
```

### `apps/web/src/routes/(platform)/_org/[slug]/studio/settings/email-audit/+page.svelte` (new)

Paginated audit log table with status filter, date range filter, and expandable detail rows:

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import Badge from '$lib/components/ui/Badge/Badge.svelte';
  import Button from '$lib/components/ui/Button/Button.svelte';

  let { data } = $props();

  let expandedRow: string | null = $state(null);

  const statusVariant = (status: string) => {
    switch (status) {
      case 'success': return 'success';
      case 'failed': return 'error';
      case 'skipped': return 'warning';
      case 'pending': return 'neutral';
      default: return 'neutral';
    }
  };

  function formatDateTime(dateStr: string): string {
    return new Date(dateStr).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function toggleExpand(id: string) {
    expandedRow = expandedRow === id ? null : id;
  }

  function applyFilters(params: Record<string, string | undefined>) {
    const url = new URL(page.url);
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        url.searchParams.set(key, value);
      } else {
        url.searchParams.delete(key);
      }
    }
    // Reset to page 1 when filters change
    url.searchParams.set('page', '1');
    goto(url.pathname + url.search);
  }

  function goToPage(pageNum: number) {
    const url = new URL(page.url);
    url.searchParams.set('page', String(pageNum));
    goto(url.pathname + url.search);
  }

  let statusFilter = $state(data.filters.status ?? '');
  let dateFromFilter = $state(data.filters.dateFrom ?? '');
  let dateToFilter = $state(data.filters.dateTo ?? '');
</script>

<svelte:head>
  <title>{m.studio_email_audit_title()} - Studio</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="audit-page">
  <h1>{m.studio_email_audit_title()}</h1>

  <!-- Filters -->
  <div class="filters">
    <div class="filter-field">
      <label for="statusFilter">{m.studio_email_audit_filter_status()}</label>
      <select
        id="statusFilter"
        class="select"
        bind:value={statusFilter}
        onchange={() => applyFilters({ status: statusFilter || undefined })}
      >
        <option value="">{m.studio_email_audit_filter_all()}</option>
        <option value="success">{m.studio_email_audit_status_success()}</option>
        <option value="failed">{m.studio_email_audit_status_failed()}</option>
        <option value="skipped">{m.studio_email_audit_status_skipped()}</option>
        <option value="pending">{m.studio_email_audit_status_pending()}</option>
      </select>
    </div>

    <div class="filter-field">
      <label for="dateFrom">{m.studio_email_audit_filter_from()}</label>
      <input
        id="dateFrom"
        type="date"
        class="date-input"
        bind:value={dateFromFilter}
        onchange={() => applyFilters({
          dateFrom: dateFromFilter ? new Date(dateFromFilter).toISOString() : undefined,
        })}
      />
    </div>

    <div class="filter-field">
      <label for="dateTo">{m.studio_email_audit_filter_to()}</label>
      <input
        id="dateTo"
        type="date"
        class="date-input"
        bind:value={dateToFilter}
        onchange={() => applyFilters({
          dateTo: dateToFilter ? new Date(dateToFilter).toISOString() : undefined,
        })}
      />
    </div>
  </div>

  <!-- Table -->
  {#if data.auditLogs.items.length === 0}
    <div class="empty-state">
      <p>{m.studio_email_audit_empty()}</p>
    </div>
  {:else}
    <div class="audit-table-wrapper">
      <table class="audit-table">
        <thead>
          <tr>
            <th>{m.studio_email_audit_col_date()}</th>
            <th>{m.studio_email_audit_col_recipient()}</th>
            <th>{m.studio_email_audit_col_template()}</th>
            <th>{m.studio_email_audit_col_status()}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.auditLogs.items as entry (entry.id)}
            <tr
              class="audit-row"
              class:expanded={expandedRow === entry.id}
              onclick={() => toggleExpand(entry.id)}
              role="button"
              tabindex="0"
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(entry.id); } }}
              aria-expanded={expandedRow === entry.id}
            >
              <td>{formatDateTime(entry.createdAt)}</td>
              <td class="recipient">{entry.recipientEmail}</td>
              <td><code class="template-name">{entry.templateName}</code></td>
              <td>
                <Badge variant={statusVariant(entry.status)}>
                  {entry.status}
                </Badge>
              </td>
            </tr>

            {#if expandedRow === entry.id}
              <tr class="detail-row">
                <td colspan="4">
                  <div class="detail-panel">
                    {#if entry.error}
                      <div class="detail-section">
                        <strong>{m.studio_email_audit_detail_error()}</strong>
                        <p class="error-text">{entry.error}</p>
                      </div>
                    {/if}
                    {#if entry.metadata}
                      <div class="detail-section">
                        <strong>{m.studio_email_audit_detail_metadata()}</strong>
                        <pre class="metadata-json">{JSON.stringify(JSON.parse(entry.metadata), null, 2)}</pre>
                      </div>
                    {/if}
                    {#if !entry.error && !entry.metadata}
                      <p class="detail-empty">{m.studio_email_audit_detail_none()}</p>
                    {/if}
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    {#if data.auditLogs.pagination.totalPages > 1}
      <div class="pagination">
        <Button
          variant="ghost"
          size="sm"
          disabled={data.auditLogs.pagination.page <= 1}
          onclick={() => goToPage(data.auditLogs.pagination.page - 1)}
        >
          {m.common_previous()}
        </Button>
        <span class="page-info">
          {m.studio_email_audit_page_info({
            current: data.auditLogs.pagination.page,
            total: data.auditLogs.pagination.totalPages,
          })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={data.auditLogs.pagination.page >= data.auditLogs.pagination.totalPages}
          onclick={() => goToPage(data.auditLogs.pagination.page + 1)}
        >
          {m.common_next()}
        </Button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .audit-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .audit-page h1 {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
  }

  .filters {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
    align-items: flex-end;
  }

  .filter-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .filter-field label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .select,
  .date-input {
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-sm);
  }

  .empty-state {
    text-align: center;
    padding: var(--space-12);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .audit-table-wrapper {
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .audit-table {
    width: 100%;
    border-collapse: collapse;
  }

  .audit-table th {
    text-align: left;
    padding: var(--space-3) var(--space-4);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: var(--color-surface-secondary);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .audit-table td {
    padding: var(--space-3) var(--space-4);
    font-size: var(--text-sm);
    color: var(--color-text);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .audit-row {
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .audit-row:hover {
    background: var(--color-surface-secondary);
  }

  .audit-row.expanded {
    background: var(--color-surface-secondary);
  }

  .recipient {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .template-name {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    padding: var(--space-1) var(--space-2);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-sm);
  }

  .detail-row td {
    padding: 0;
  }

  .detail-panel {
    padding: var(--space-4) var(--space-6);
    background: var(--color-surface);
    border-top: var(--border-width) dashed var(--color-border);
  }

  .detail-section {
    margin-bottom: var(--space-3);
  }

  .detail-section strong {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    display: block;
    margin-bottom: var(--space-1);
  }

  .error-text {
    font-size: var(--text-sm);
    color: var(--color-error-700);
    margin: 0;
  }

  .metadata-json {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: var(--space-3);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-md);
    overflow-x: auto;
    margin: 0;
    color: var(--color-text);
  }

  .detail-empty {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
  }

  .page-info {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  @media (max-width: 640px) {
    .filters {
      flex-direction: column;
    }

    .audit-table th:nth-child(2),
    .audit-table td:nth-child(2) {
      display: none;
    }
  }
</style>
```

### `apps/web/src/paraglide/messages/en.js` (update -- audit log)

Add i18n keys for the audit log UI:

```javascript
// Studio Email Audit
export const studio_email_audit_title = () => 'Email Audit Log';
export const studio_email_audit_filter_status = () => 'Status';
export const studio_email_audit_filter_all = () => 'All';
export const studio_email_audit_filter_from = () => 'From';
export const studio_email_audit_filter_to = () => 'To';
export const studio_email_audit_status_success = () => 'Success';
export const studio_email_audit_status_failed = () => 'Failed';
export const studio_email_audit_status_skipped = () => 'Skipped';
export const studio_email_audit_status_pending = () => 'Pending';
export const studio_email_audit_col_date = () => 'Date/Time';
export const studio_email_audit_col_recipient = () => 'Recipient';
export const studio_email_audit_col_template = () => 'Template';
export const studio_email_audit_col_status = () => 'Status';
export const studio_email_audit_empty = () => 'No emails sent yet.';
export const studio_email_audit_detail_error = () => 'Error';
export const studio_email_audit_detail_metadata = () => 'Metadata';
export const studio_email_audit_detail_none = () => 'No additional details.';
export const studio_email_audit_page_info = ({ current, total }) =>
  `Page ${current} of ${total}`;
```

---

## Verification

### Unit Tests

**`packages/validation/src/__tests__/notifications.test.ts`** (extend):

- `auditLogQuerySchema` validates with all fields present
- `auditLogQuerySchema` validates with only `organizationId` (other fields default)
- `auditLogQuerySchema` rejects non-UUID `organizationId`
- `auditLogQuerySchema` rejects `limit` > 100
- `auditLogQuerySchema` rejects invalid `status` value
- `auditLogQuerySchema` rejects non-ISO `dateFrom`

### Integration Tests

**`workers/notifications-api/src/routes/__tests__/audit-logs.test.ts`** (new):

- `GET /api/audit-logs?organizationId=<id>` with valid session returns 200 with paginated response
- Response items have masked email addresses (no full addresses exposed)
- Status filter: `?status=failed` returns only failed entries
- Date range filter: `?dateFrom=<iso>&dateTo=<iso>` scopes results correctly
- Pagination: `?page=2&limit=5` returns correct offset of results
- Unauthenticated request returns 401

### Manual Verification

1. Navigate to `/account/notifications`.
2. Verify the transactional toggle is visually dimmed and disabled, with "Always on" hint.
3. Verify info callout about mandatory emails displays at top.
4. Toggle marketing off, click save, verify success toast.
5. Toggle marketing on, click save, verify success toast.
6. Query DB to confirm `notification_preferences` row updated correctly.
7. Navigate to studio > settings > "Email Audit".
8. Verify table loads (may be empty initially; trigger test emails via WP1/WP4 first).
9. Filter by "failed" status, verify table updates.
10. Filter by date range, verify table updates.
11. Click a row, verify expansion shows error/metadata.
12. Test pagination by seeding enough audit entries.

### Playwright/Chrome DevTools

**`apps/web/e2e/notification-preferences.spec.ts`** (new or extend existing):

1. Navigate to account > notifications.
2. Verify 3 toggle sections render with descriptions.
3. Verify transactional toggle is disabled (cannot click).
4. Verify "Always on" hint text appears under transactional toggle.
5. Verify info callout banner is visible.
6. Toggle marketing off, submit, verify success toast.
7. Refresh page, verify marketing is still off (persisted).
8. Toggle marketing on, submit, verify success toast.

**`apps/web/e2e/studio-email-audit.spec.ts`** (new):

1. Login as creator, navigate to studio settings > "Email Audit".
2. Verify table renders (empty state if no emails sent yet).
3. If entries exist: verify columns show date, masked recipient (e.g., `j***@example.com`), template name, status badge.
4. Filter by status dropdown, verify table refreshes via URL query param change.
5. Click a row, verify detail panel expands below with metadata.
6. Click same row again, verify panel collapses.
7. Test pagination if enough entries exist.

**Chrome DevTools checks:**
- Network tab: no 4xx/5xx errors on load and filter changes.
- Console: no runtime errors.
- Accessibility: all filter controls keyboard accessible, expanded detail rows announced by screen reader (`aria-expanded`).

---

## Review Checklist

- [ ] Uses design tokens for ALL CSS values (no hardcoded px, hex, or raw values)
- [ ] Uses Svelte 5 runes (`$props`, `$state`, `$derived`, `$effect`)
- [ ] Uses `$app/state` (`page`) and `$app/navigation` (`goto`)
- [ ] All user-facing strings use paraglide message functions
- [ ] Transactional toggle is truly disabled (`disabled={true}` on Switch)
- [ ] Info callout uses `--color-info-*` tokens (not error or warning)
- [ ] Email addresses masked in audit log (no full addresses in UI)
- [ ] Expanded detail row parses metadata JSON safely (`JSON.parse` inside `{#if entry.metadata}`)
- [ ] Date filter converts local date to ISO string correctly
- [ ] Pagination uses URL query params (server load re-runs on `goto()`)
- [ ] No `as any` type casts
- [ ] `auditLogQuerySchema` validates all parameters with sensible defaults
- [ ] Audit log endpoint scoped by org membership (no cross-org data leakage)
- [ ] Responsive: recipient column hidden on mobile (640px breakpoint)

---

## Acceptance Criteria

- [ ] Preferences page shows 3 categories with clear, distinct descriptions
- [ ] Transactional toggle is visually dimmed, disabled, with "Always on" indicator
- [ ] Info callout explains that some emails are always sent
- [ ] Marketing and digest toggles work with API persistence and success toasts
- [ ] "Email Audit" item appears in studio settings navigation
- [ ] Audit log shows paginated email history with date, masked recipient, template name, status
- [ ] Audit log filters by status (dropdown) and date range (from/to inputs)
- [ ] Clicking a row expands to show error message and/or metadata JSON
- [ ] Email addresses are masked in the audit log display (privacy)
- [ ] All UI uses design tokens and i18n
- [ ] Responsive layout (mobile-friendly)

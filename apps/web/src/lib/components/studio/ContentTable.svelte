<!--
  @component ContentTable

  Displays a compact data table of content items for studio content management.
  Shows title (linked to edit), type badge, status badge, created date, and actions.

  @prop {ContentWithRelations[]} items - Array of content items to display
-->
<script lang="ts">
  import type { ContentWithRelations } from '$lib/types';
  import { FileIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import * as m from '$paraglide/messages';
  import { publishContent, unpublishContent } from '$lib/remote/content.remote';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { formatDate } from '$lib/utils/format';
  import Spinner from '$lib/components/ui/Feedback/Spinner/Spinner.svelte';

  interface Props {
    items: ContentWithRelations[];
  }

  const { items }: Props = $props();

  let togglingId = $state<string | null>(null);
  let statusOverrides = $state<Record<string, string>>({});

  const isEmpty = $derived(items.length === 0);

  function getItemStatus(item: ContentWithRelations): string {
    return statusOverrides[item.id] ?? item.status;
  }

  function getStatusVariant(status: string): 'published' | 'draft' | 'archived' {
    if (status === 'published') return 'published';
    if (status === 'draft') return 'draft';
    return 'archived';
  }

  function getStatusText(status: string): string {
    switch (status) {
      case 'published': return m.studio_content_status_published();
      case 'draft': return m.studio_content_status_draft();
      case 'archived': return m.studio_content_status_archived();
      default: return status;
    }
  }

  function getTypeText(contentType: string): string {
    switch (contentType) {
      case 'video': return m.content_type_video();
      case 'audio': return m.content_type_audio();
      case 'written': return m.content_type_article();
      default: return contentType;
    }
  }

  async function handlePublishToggle(item: ContentWithRelations) {
    togglingId = item.id;
    const currentStatus = getItemStatus(item);
    try {
      if (currentStatus === 'published') {
        statusOverrides[item.id] = 'draft';
        await unpublishContent(item.id);
        toast.success(m.studio_content_form_unpublish_success());
      } else {
        statusOverrides[item.id] = 'published';
        await publishContent(item.id);
        toast.success(m.studio_content_form_publish_success());
      }
    } catch (err) {
      delete statusOverrides[item.id];
      const message = err instanceof Error ? err.message : m.studio_content_form_publish_error();
      toast.error(message);
    } finally {
      togglingId = null;
    }
  }
</script>

{#if isEmpty}
  <EmptyState title={m.studio_content_empty()} icon={FileIcon} />
{:else}
  <div class="table-wrap">
    <table class="content-table">
      <colgroup>
        <col class="col-title" />
        <col class="col-type" />
        <col class="col-status" />
        <col class="col-date" />
        <col class="col-actions" />
      </colgroup>
      <thead>
        <tr>
          <th>{m.studio_content_col_title()}</th>
          <th>{m.studio_content_col_type()}</th>
          <th>{m.studio_content_col_status()}</th>
          <th>{m.studio_content_col_created()}</th>
          <th class="th-actions"></th>
        </tr>
      </thead>
      <tbody>
        {#each items as item (item.id)}
          {@const status = getItemStatus(item)}
          <tr class="row">
            <td class="cell-title">
              <a href="/studio/content/{item.id}/edit" class="title-link">
                {item.title}
              </a>
            </td>
            <td>
              <span class="type-badge">{getTypeText(item.contentType)}</span>
            </td>
            <td>
              <span class="status-dot" data-status={getStatusVariant(status)}></span>
              <span class="status-text" data-status={getStatusVariant(status)}>
                {getStatusText(status)}
              </span>
            </td>
            <td class="cell-date">{formatDate(item.createdAt)}</td>
            <td class="cell-actions">
              <button
                type="button"
                class="action-btn"
                data-action={status === 'published' ? 'unpublish' : 'publish'}
                disabled={togglingId === item.id}
                onclick={() => handlePublishToggle(item)}
              >
                {#if togglingId === item.id}
                  <Spinner size="sm" />
                {:else if status === 'published'}
                  {m.studio_content_form_unpublish()}
                {:else}
                  {m.studio_content_form_publish()}
                {/if}
              </button>
              <a href="/studio/content/{item.id}/edit" class="action-edit">
                {m.studio_content_edit()}
              </a>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  /* ── Layout ────────────────────────────────────── */
  .table-wrap {
    overflow-x: auto;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
  }

  .content-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  /* ── Column widths ─────────────────────────────── */
  .col-title   { width: auto; }
  .col-type    { width: var(--space-24); }
  .col-status  { width: calc(var(--space-24) + var(--space-4)); }
  .col-date    { width: calc(var(--space-24) + var(--space-6)); }
  .col-actions { width: calc(var(--space-24) * 2); }

  /* ── Header ────────────────────────────────────── */
  thead {
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  th {
    padding: var(--space-2) var(--space-3);
    text-align: left;
    font-weight: var(--font-medium);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide, 0.05em);
    white-space: nowrap;
  }

  .th-actions {
    text-align: right;
  }

  /* ── Rows ──────────────────────────────────────── */
  .row {
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    transition: var(--transition-colors);
  }

  .row:last-child {
    border-bottom: none;
  }

  .row:hover {
    background-color: var(--color-surface-secondary);
  }

  td {
    padding: var(--space-2) var(--space-3);
    vertical-align: middle;
    white-space: nowrap;
  }

  /* ── Title cell ────────────────────────────────── */
  .cell-title {
    white-space: normal;
    max-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .title-link {
    font-weight: var(--font-medium);
    color: var(--color-text);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .title-link:hover {
    color: var(--color-interactive);
  }

  .title-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  /* ── Type badge ────────────────────────────────── */
  .type-badge {
    display: inline-block;
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    background-color: var(--color-surface-raised, var(--color-surface));
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  /* ── Status ────────────────────────────────────── */
  .status-dot {
    display: inline-block;
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    margin-right: var(--space-1);
    vertical-align: middle;
  }

  .status-dot[data-status='published'] { background-color: var(--color-success-500); }
  .status-dot[data-status='draft']     { background-color: var(--color-warning-400); }
  .status-dot[data-status='archived']  { background-color: var(--color-text-muted); }

  .status-text {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* ── Date cell ─────────────────────────────────── */
  .cell-date {
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
    font-size: var(--text-xs);
  }

  /* ── Actions cell ──────────────────────────────── */
  .cell-actions {
    text-align: right;
  }

  .action-btn {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    border: none;
    background-color: transparent;
    cursor: pointer;
    transition: var(--transition-colors);
    vertical-align: middle;
  }

  .action-btn:disabled {
    opacity: var(--opacity-50);
    cursor: not-allowed;
  }

  .action-btn[data-action='publish'] {
    color: var(--color-success-600);
  }

  .action-btn[data-action='publish']:hover:not(:disabled) {
    background-color: var(--color-success-50);
  }

  .action-btn[data-action='unpublish'] {
    color: var(--color-text-muted);
  }

  .action-btn[data-action='unpublish']:hover:not(:disabled) {
    background-color: var(--color-surface-raised, var(--color-surface));
    color: var(--color-warning-600);
  }

  .action-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .action-edit {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    text-decoration: none;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
    vertical-align: middle;
  }

  .action-edit:hover {
    background-color: var(--color-interactive-subtle);
    color: var(--color-interactive-hover);
  }

  .action-edit:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }


</style>

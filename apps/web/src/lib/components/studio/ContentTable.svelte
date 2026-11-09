<!--
  @component ContentTable

  Displays a compact data table of content items for studio content management.
  Shows title (linked to edit), type badge, status badge, created date, and actions.
  A draft shows how far it has got and Continue, which opens the step still
  to do (Codex-a6ofh.2.6); a live piece keeps its publish toggle and Edit.

  @prop {ContentWithRelations[]} items - Array of content items to display
  @prop {PayoutsRead} payouts - The page's one payouts read, for each draft's step
-->
<script lang="ts">
  import { tick } from 'svelte';
  import type { ContentWithRelations } from '$lib/types';
  import { FileIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import * as m from '$paraglide/messages';
  import { formatDate } from '$lib/utils/format';
  import { togglePublishStatus, type ContentStatus } from './publish-toggle';
  import Spinner from '$lib/components/ui/Feedback/Spinner/Spinner.svelte';
  import DraftProgress from './content-list/DraftProgress.svelte';
  import type { PayoutsRead } from '$lib/utils/connect-readiness';
  import { draftProgress } from './content-list/draft-progress';
  import { listStatus } from './content-list/list-status';
  import { focusIfLost } from '$lib/utils/focus-if-lost';
  import { editHref } from './editor/editor-url';
  import { logReadFailure } from './media-library/log-read-failure';

  interface Props {
    items: ContentWithRelations[];
    payouts: PayoutsRead;
  }

  const { items, payouts }: Props = $props();

  let togglingId = $state<string | null>(null);
  let statusOverrides = $state<Record<string, string>>({});

  const isEmpty = $derived(items.length === 0);

  function getItemStatus(item: ContentWithRelations): string {
    return statusOverrides[item.id] ?? item.status;
  }

  function getTypeText(contentType: string): string {
    switch (contentType) {
      case 'video': return m.content_type_video();
      case 'audio': return m.content_type_audio();
      case 'written': return m.content_type_article();
      default: return contentType;
    }
  }

  /** Disabled while it goes, the pressed toggle loses focus: it has it back once settled. */
  async function handlePublishToggle(item: ContentWithRelations, button: HTMLButtonElement) {
    togglingId = item.id;
    const currentStatus = getItemStatus(item);
    try {
      const optimistic = currentStatus === 'published' ? 'draft' : 'published';
      statusOverrides[item.id] = optimistic;
      await togglePublishStatus(item.id, currentStatus as ContentStatus);
    } catch (err) {
      // Said in the toggle's own toast; logged here, by the studio's one rule.
      delete statusOverrides[item.id];
      logReadFailure('studio_content.publish_toggle_failed', err, {
        contentId: item.id,
        from: currentStatus,
      });
    } finally {
      togglingId = null;
    }
    await tick();
    focusIfLost(button);
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
          {@const progress = status === 'draft' ? draftProgress(item, payouts) : null}
          <!-- An unpublished piece is "Off sale", never a draft (`listStatus`). -->
          {@const shown = listStatus({ status, publishedAt: item.publishedAt })}
          {@const href = progress?.href ?? editHref(item.id)}
          <tr class="row">
            <td class="cell-title">
              <a {href} class="title-link">
                {item.title}
              </a>
              {#if progress}
                <DraftProgress {progress} />
              {/if}
            </td>
            <td>
              <span class="type-badge">{getTypeText(item.contentType)}</span>
            </td>
            <td>
              <span class="status-dot" data-status={shown.variant}></span>
              <span class="status-text" data-status={shown.variant}>
                {shown.label}
              </span>
            </td>
            <td class="cell-date">{formatDate(item.createdAt)}</td>
            <td class="cell-actions">
              {#if progress}
                <a
                  {href}
                  class="action-edit"
                  aria-label={m.studio_drafts_continue_label({ title: item.title })}
                >
                  {m.studio_drafts_continue()}
                </a>
              {:else}
                <button
                  type="button"
                  class="action-btn"
                  data-action={status === 'published' ? 'unpublish' : 'publish'}
                  disabled={togglingId === item.id}
                  onclick={(event) => handlePublishToggle(item, event.currentTarget)}
                >
                  {#if togglingId === item.id}
                    <Spinner size="sm" />
                  {:else}
                    {shown.toggle}
                  {/if}
                </button>
                <a {href} class="action-edit">
                  {m.studio_content_edit()}
                </a>
              {/if}
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
    /*
     * The fixed columns alone are wider than a phone: below this the title,
     * and a draft's progress under it, were crushed and clipped. Narrower,
     * the table scrolls in its wrap.
     */
    min-inline-size: calc(var(--space-24) * 8);
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

  .cell-title :global(.draft-progress) {
    margin-block-start: var(--space-1);
  }

  .title-link {
    font-weight: var(--font-medium);
    color: var(--color-text);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .title-link:hover {
    color: var(--color-link);
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
  .status-dot[data-status='off-sale']  { background-color: var(--color-text-muted); }

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
    color: var(--color-link);
    text-decoration: none;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
    vertical-align: middle;
  }

  .action-edit:hover {
    background-color: var(--color-interactive-subtle);
    color: var(--color-link-hover);
  }

  .action-edit:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }


</style>

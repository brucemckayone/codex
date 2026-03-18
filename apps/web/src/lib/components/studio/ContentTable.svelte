<!--
  @component ContentTable

  Displays a table of content items for the studio content management page.
  Shows title (linked to edit), type badge, status badge, created date, and actions.

  @prop {ContentWithRelations[]} items - Array of content items to display
  @prop {string} orgSlug - Organization slug for building edit URLs
-->
<script lang="ts">
  import type { ContentWithRelations } from '$lib/types';
  import * as Table from '$lib/components/ui/Table';
  import Badge from '$lib/components/ui/Badge/Badge.svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    items: ContentWithRelations[];
    orgSlug: string;
  }

  const { items, orgSlug }: Props = $props();

  const isEmpty = $derived(items.length === 0);

  /**
   * Map content status to Badge variant
   */
  function getStatusVariant(status: string): 'success' | 'warning' | 'neutral' {
    switch (status) {
      case 'published':
        return 'success';
      case 'draft':
        return 'warning';
      case 'archived':
        return 'neutral';
      default:
        return 'neutral';
    }
  }

  /**
   * Get localized status text
   */
  function getStatusText(status: string): string {
    switch (status) {
      case 'published':
        return m.studio_content_status_published();
      case 'draft':
        return m.studio_content_status_draft();
      case 'archived':
        return m.studio_content_status_archived();
      default:
        return status;
    }
  }

  /**
   * Get localized content type text
   */
  function getTypeText(contentType: string): string {
    switch (contentType) {
      case 'video':
        return m.content_type_video();
      case 'audio':
        return m.content_type_audio();
      case 'written':
        return m.content_type_article();
      default:
        return contentType;
    }
  }

  /**
   * Format a date string for display
   */
  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
</script>

{#if isEmpty}
  <div class="empty-state">
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="empty-icon" aria-hidden="true">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
    </svg>
    <h3 class="empty-title">{m.studio_content_empty()}</h3>
  </div>
{:else}
  <div class="table-wrapper">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>{m.studio_content_col_title()}</Table.Head>
          <Table.Head>{m.studio_content_col_type()}</Table.Head>
          <Table.Head>{m.studio_content_col_status()}</Table.Head>
          <Table.Head>{m.studio_content_col_created()}</Table.Head>
          <Table.Head>{m.studio_content_col_actions()}</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each items as item (item.id)}
          <Table.Row>
            <Table.Cell class="title-cell">
              <a href="/{orgSlug}/studio/content/{item.id}" class="title-link">
                {item.title}
              </a>
            </Table.Cell>
            <Table.Cell>
              <Badge variant="neutral">{getTypeText(item.contentType)}</Badge>
            </Table.Cell>
            <Table.Cell>
              <Badge variant={getStatusVariant(item.status)}>
                {getStatusText(item.status)}
              </Badge>
            </Table.Cell>
            <Table.Cell class="date-cell">
              {formatDate(item.createdAt)}
            </Table.Cell>
            <Table.Cell>
              <a href="/{orgSlug}/studio/content/{item.id}" class="edit-link">
                {m.studio_content_edit()}
              </a>
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
{/if}

<style>
  .table-wrapper {
    overflow-x: auto;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-12) var(--space-4);
    text-align: center;
  }

  .empty-icon {
    color: var(--color-text-muted);
    margin-bottom: var(--space-2);
  }

  .empty-title {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
  }

  .title-link {
    font-weight: var(--font-medium);
    color: var(--color-text);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .title-link:hover {
    color: var(--color-primary-500);
  }

  .title-link:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  .edit-link {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-primary-500);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .edit-link:hover {
    color: var(--color-primary-600);
  }

  .edit-link:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  /* Cell styles via :global since classes are passed as props to Table components */
  :global(.title-cell) {
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  :global(.date-cell) {
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  /* Dark mode */
  :global([data-theme='dark']) .empty-icon {
    color: var(--color-text-muted-dark);
  }

  :global([data-theme='dark']) .empty-title {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .title-link {
    color: var(--color-text-dark);
  }
</style>

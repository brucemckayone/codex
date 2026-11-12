<!--
  @component ContentListTable

  The content list as a table (Codex-a6ofh.3.1, mockup L1): what a piece
  is, its status, who can open it and for how much, its categories in the
  org studio (Codex-a6ofh.3.3), its views and sales, and when it last
  changed. Under each title, the one line that says what it
  needs: a draft's two steps, a schedule, a refusal, or media gone from a
  live piece (`rowLine`). The title is the row's way in: a draft opens at
  the step it is on, anything that has been live opens the live editor.

  Presentational: the rows and the tier names come from StudioContentList.
-->
<script lang="ts">
  import * as Table from '$lib/components/ui/Table';
  import type { ContentWithRelations } from '$lib/types';
  import type { PayoutsRead } from '$lib/utils/connect-readiness';
  import { formatRelativeTime } from '$lib/utils/format';
  import * as m from '$paraglide/messages';
  import ContentCategories from './ContentCategories.svelte';
  import ContentRowLine from './ContentRowLine.svelte';
  import ContentStatus from './ContentStatus.svelte';
  import ContentThumb from './ContentThumb.svelte';
  import {
    accessWords,
    categoryWords,
    rowHref,
    rowLine,
    salesShown,
    type TierName,
    viewsShown,
  } from './row-facts';

  interface Props {
    items: ContentWithRelations[];
    payouts: PayoutsRead;
    tierName: TierName;
    /** The org studio's Category column (mockup L1); the personal studio has none. */
    showCategories: boolean;
  }

  const { items, payouts, tierName, showCategories }: Props = $props();
</script>

{#snippet count(value: string | null)}
  {#if value === null}
    <span aria-hidden="true">—</span><span class="sr-only">{m.studio_content_list_none()}</span>
  {:else}
    {value}
  {/if}
{/snippet}

<Table.Root class="content-table">
  <caption class="sr-only">{m.studio_content_list_caption()}</caption>
  <Table.Header>
    <Table.Row>
      <Table.Head class="col-content">{m.studio_content_list_col_content()}</Table.Head>
      <Table.Head>{m.studio_content_list_col_status()}</Table.Head>
      <Table.Head>{m.studio_content_form_access_label()}</Table.Head>
      {#if showCategories}
        <Table.Head>{m.studio_content_category_label()}</Table.Head>
      {/if}
      <Table.Head class="col-num">{m.studio_content_list_col_views()}</Table.Head>
      <Table.Head class="col-num">{m.studio_content_list_col_sales()}</Table.Head>
      <Table.Head>{m.studio_content_list_col_updated()}</Table.Head>
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {#each items as row (row.id)}
      {@const line = rowLine(row, payouts)}
      {@const access = accessWords(row, tierName)}
      <Table.Row data-content-id={row.id}>
        <Table.Cell class="col-content">
          <div class="row-content">
            <ContentThumb piece={row} />
            <span class="row-text">
              <a class="row-title" href={rowHref(row, line)} title={row.title}>
                {row.title}
              </a>
              <span class="row-slug">/{row.slug}</span>
              {#if line}<ContentRowLine {line} />{/if}
            </span>
          </div>
        </Table.Cell>
        <Table.Cell><ContentStatus piece={row} /></Table.Cell>
        <Table.Cell>
          <span class="access">
            <span class="access-label">{access.label}</span>
            {#if access.detail}<span class="access-detail">{access.detail}</span>{/if}
          </span>
        </Table.Cell>
        {#if showCategories}
          {@const filed = categoryWords(row)}
          <Table.Cell>
            {#if filed}
              <ContentCategories {filed} />
            {:else}
              {@render count(null)}
            {/if}
          </Table.Cell>
        {/if}
        <Table.Cell class="col-num">{@render count(viewsShown(row))}</Table.Cell>
        <Table.Cell class="col-num">{@render count(salesShown(row))}</Table.Cell>
        <Table.Cell class="col-date">{formatRelativeTime(row.updatedAt)}</Table.Cell>
      </Table.Row>
    {/each}
  </Table.Body>
</Table.Root>

<style>
  /* The primitives render the elements: their classes are reached through
     this component's own wrapper class. */
  :global(.content-table) {
    width: 100%;
  }

  :global(.content-table .col-content) {
    width: 44%;
    min-width: 18rem;
  }

  :global(.content-table .col-num) {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  :global(.content-table .col-date) {
    white-space: nowrap;
    color: var(--color-text-secondary);
  }

  .row-content {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    min-width: 0;
  }

  .row-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .row-title {
    font-weight: var(--font-semibold);
    color: var(--color-text);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: var(--radius-sm);
  }

  .row-title:hover {
    color: var(--color-link);
  }

  .row-title:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .row-slug {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .access {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .access-label {
    font-weight: var(--font-medium);
    color: var(--color-text);
    white-space: nowrap;
  }

  .access-detail {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
</style>

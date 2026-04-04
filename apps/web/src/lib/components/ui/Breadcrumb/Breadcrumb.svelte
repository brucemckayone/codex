<!--
  @component Breadcrumb

  Renders a breadcrumb navigation trail with chevron separators.
  The last item (without href) is marked as the current page.

  @prop {BreadcrumbItem[]} items - Array of breadcrumb items with label and optional href
-->
<script lang="ts">
  import { ChevronRightIcon } from '$lib/components/ui/Icon';

  export interface BreadcrumbItem {
    label: string;
    href?: string;
  }

  interface Props {
    items: BreadcrumbItem[];
  }

  const { items }: Props = $props();
</script>

<nav class="breadcrumb" aria-label="Breadcrumb">
  <ol class="breadcrumb__list">
    {#each items as item, index (index)}
      <li class="breadcrumb__item">
        {#if index > 0}
          <ChevronRightIcon size={14} class="breadcrumb__separator" aria-hidden="true" />
        {/if}
        {#if item.href}
          <a href={item.href} class="breadcrumb__link">{item.label}</a>
        {:else}
          <span class="breadcrumb__current" aria-current="page">{item.label}</span>
        {/if}
      </li>
    {/each}
  </ol>
</nav>

<style>
  .breadcrumb {
    font-size: var(--text-sm);
  }

  .breadcrumb__list {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    list-style: none;
    padding: 0;
    margin: 0;
    flex-wrap: wrap;
  }

  .breadcrumb__item {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  :global(.breadcrumb__separator) {
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .breadcrumb__link {
    color: var(--color-text-secondary);
    text-decoration: none;
    font-weight: var(--font-medium);
    transition: var(--transition-colors);
  }

  .breadcrumb__link:hover {
    color: var(--color-interactive);
  }

  .breadcrumb__link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  .breadcrumb__current {
    color: var(--color-text);
    font-weight: var(--font-medium);
  }
</style>

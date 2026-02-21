<!--
  @component Pagination

  Accessible pagination component with page number display and navigation.
  Supports both default and compact variants.

  @prop {number} currentPage - Current active page (1-indexed)
  @prop {number} totalPages - Total number of pages
  @prop {(page: number) => void} onPageChange - Callback when page changes
  @prop {'default' | 'compact'} variant - Display variant
-->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import * as m from '$paraglide/messages';

  interface Props extends HTMLAttributes<HTMLElement> {
    currentPage: number;
    totalPages: number;
    onPageChange?: (page: number) => void;
    variant?: 'default' | 'compact';
  }

  const {
    currentPage,
    totalPages,
    onPageChange,
    variant = 'default',
    class: className,
    ...rest
  }: Props = $props();

  const hasPrevious = $derived(currentPage > 1);
  const hasNext = $derived(currentPage < totalPages);

  // Generate page numbers to show with ellipsis for large ranges
  const pages = $derived(() => {
    const pages: Array<number | 'ellipsis'> = [];
    const maxVisible = variant === 'compact' ? 5 : 7;

    if (totalPages <= maxVisible) {
      // Show all pages if total fits within max visible
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (currentPage <= 3) {
        // Near start: 1, 2, 3, 4, ..., last
        for (let i = 2; i <= 4 && i <= totalPages - 1; i++) {
          pages.push(i);
        }
        if (totalPages > 5) pages.push('ellipsis');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        // Near end: 1, ..., last-3, last-2, last-1, last
        if (totalPages > 5) pages.push('ellipsis');
        for (let i = totalPages - 3; i <= totalPages; i++) {
          if (i > 1) pages.push(i);
        }
      } else {
        // Middle: 1, ..., current-1, current, current+1, ..., last
        pages.push('ellipsis');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(totalPages);
      }
    }

    return pages;
  });

  function goToPage(page: number) {
    if (page >= 1 && page <= totalPages && page !== currentPage) {
      onPageChange?.(page);
    }
  }
</script>

<nav
  class="pagination {variant === 'compact' ? 'pagination--compact' : ''} {className ?? ''}"
  aria-label={m.common_pagination()}
  {...rest}
>
  <!-- Previous button -->
  <button
    class="pagination__btn pagination__prev"
    disabled={!hasPrevious}
    aria-label={m.common_previous()}
    onclick={() => goToPage(currentPage - 1)}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="15 18 9 12 15 6"></polyline>
    </svg>
    {#if variant === 'default'}
      <span>{m.common_previous()}</span>
    {/if}
  </button>

  <!-- Page numbers -->
  <ol class="pagination__pages" role="list">
    {#each pages() as pageItem (pageItem)}
      {#if pageItem === 'ellipsis'}
        <li class="pagination__ellipsis" aria-hidden="true">…</li>
      {:else}
        <li>
          <button
            class="pagination__page"
            class:active={pageItem === currentPage}
            aria-label={m.common_page_number({ page: pageItem })}
            aria-current={pageItem === currentPage ? 'page' : undefined}
            onclick={() => goToPage(pageItem)}
          >
            {pageItem}
          </button>
        </li>
      {/if}
    {/each}
  </ol>

  <!-- Next button -->
  <button
    class="pagination__btn pagination__next"
    disabled={!hasNext}
    aria-label={m.common_next()}
    onclick={() => goToPage(currentPage + 1)}
  >
    {#if variant === 'default'}
      <span>{m.common_next()}</span>
    {/if}
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
  </button>

  {#if variant === 'default'}
    <p class="pagination__info">
      {m.common_page_x_of_y({ current: currentPage, total: totalPages })}
    </p>
  {/if}
</nav>

<style>
  .pagination {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .pagination--compact {
    gap: var(--space-1);
  }

  .pagination__btn {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1-5) var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .pagination__btn:hover:not(:disabled) {
    background: var(--color-surface-secondary);
  }

  .pagination__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .pagination__pages {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .pagination__page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: var(--space-8);
    height: var(--space-8);
    padding: 0 var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .pagination__page:hover {
    background: var(--color-surface-secondary);
  }

  .pagination__page.active {
    background: var(--color-primary-500);
    color: var(--color-text-inverse);
    border-color: var(--color-primary-500);
  }

  .pagination__ellipsis {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: var(--space-8);
    height: var(--space-8);
    color: var(--color-text-muted);
  }

  .pagination__info {
    margin-left: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

</style>

<!--
  @component Pagination

  Accessible pagination component with page number display and navigation.
  Supports both default and compact variants.

  When `baseUrl` is provided, renders `<a>` tags instead of `<button>` for
  SSR/SEO-friendly pagination (progressive enhancement). Links still fire
  `onPageChange` for client-side state sync.

  @prop {number} currentPage - Current active page (1-indexed)
  @prop {number} totalPages - Total number of pages
  @prop {(page: number) => void} onPageChange - Callback when page changes
  @prop {'default' | 'compact'} variant - Display variant
  @prop {string} [baseUrl] - When set, render <a> tags with href for SEO
  @prop {string} [paramName='page'] - URL search param name for page number
-->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import * as m from '$paraglide/messages';
  import { ChevronLeftIcon, ChevronRightIcon } from '$lib/components/ui/Icon';

  interface Props extends HTMLAttributes<HTMLElement> {
    currentPage: number;
    totalPages: number;
    onPageChange?: (page: number) => void;
    variant?: 'default' | 'compact';
    baseUrl?: string;
    paramName?: string;
  }

  const {
    currentPage,
    totalPages,
    onPageChange,
    variant = 'default',
    baseUrl,
    paramName = 'page',
    class: className,
    ...rest
  }: Props = $props();

  const useLinks = $derived(!!baseUrl);
  const hasPrevious = $derived(currentPage > 1);
  const hasNext = $derived(currentPage < totalPages);

  // Generate page numbers to show with ellipsis for large ranges
  const pages = $derived.by(() => {
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

  /**
   * Build a URL for the given page number, preserving any existing
   * query parameters from the baseUrl.
   */
  function hrefForPage(page: number): string {
    if (!baseUrl) return '#';
    try {
      const url = new URL(baseUrl, 'https://placeholder.local');
      url.searchParams.set(paramName, String(page));
      // Return only path + search (no origin) so links work with SvelteKit routing
      return `${url.pathname}${url.search}`;
    } catch {
      // Fallback: baseUrl is already a path
      const separator = baseUrl.includes('?') ? '&' : '?';
      return `${baseUrl}${separator}${paramName}=${page}`;
    }
  }

  function goToPage(page: number) {
    if (page >= 1 && page <= totalPages && page !== currentPage) {
      onPageChange?.(page);
    }
  }

  function handleLinkClick(page: number, event: MouseEvent) {
    // Fire callback for client-side state sync; let default navigation proceed
    goToPage(page);
  }
</script>

<nav
  class="pagination {variant === 'compact' ? 'pagination--compact' : ''} {className ?? ''}"
  aria-label={m.common_pagination()}
  {...rest}
>
  <!-- Previous -->
  {#if useLinks}
    {#if hasPrevious}
      <a
        class="pagination__btn pagination__prev"
        href={hrefForPage(currentPage - 1)}
        aria-label={m.common_previous()}
        data-sveltekit-noscroll
        onclick={(e) => handleLinkClick(currentPage - 1, e)}
      >
        <ChevronLeftIcon size={16} />
        {#if variant === 'default'}
          <span>{m.common_previous()}</span>
        {/if}
      </a>
    {:else}
      <span class="pagination__btn pagination__prev pagination__btn--disabled" aria-disabled="true">
        <ChevronLeftIcon size={16} />
        {#if variant === 'default'}
          <span>{m.common_previous()}</span>
        {/if}
      </span>
    {/if}
  {:else}
    <button
      class="pagination__btn pagination__prev"
      disabled={!hasPrevious}
      aria-label={m.common_previous()}
      onclick={() => goToPage(currentPage - 1)}
    >
      <ChevronLeftIcon size={16} />
      {#if variant === 'default'}
        <span>{m.common_previous()}</span>
      {/if}
    </button>
  {/if}

  <!-- Page numbers -->
  <ol class="pagination__pages" role="list">
    {#each pages as pageItem (pageItem)}
      {#if pageItem === 'ellipsis'}
        <li class="pagination__ellipsis" aria-hidden="true">...</li>
      {:else if useLinks}
        <li>
          <a
            class="pagination__page"
            class:active={pageItem === currentPage}
            href={hrefForPage(pageItem)}
            aria-label={m.common_page_number({ page: pageItem })}
            aria-current={pageItem === currentPage ? 'page' : undefined}
            data-sveltekit-noscroll
            onclick={(e) => handleLinkClick(pageItem, e)}
          >
            {pageItem}
          </a>
        </li>
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

  <!-- Next -->
  {#if useLinks}
    {#if hasNext}
      <a
        class="pagination__btn pagination__next"
        href={hrefForPage(currentPage + 1)}
        aria-label={m.common_next()}
        data-sveltekit-noscroll
        onclick={(e) => handleLinkClick(currentPage + 1, e)}
      >
        {#if variant === 'default'}
          <span>{m.common_next()}</span>
        {/if}
        <ChevronRightIcon size={16} />
      </a>
    {:else}
      <span class="pagination__btn pagination__next pagination__btn--disabled" aria-disabled="true">
        {#if variant === 'default'}
          <span>{m.common_next()}</span>
        {/if}
        <ChevronRightIcon size={16} />
      </span>
    {/if}
  {:else}
    <button
      class="pagination__btn pagination__next"
      disabled={!hasNext}
      aria-label={m.common_next()}
      onclick={() => goToPage(currentPage + 1)}
    >
      {#if variant === 'default'}
        <span>{m.common_next()}</span>
      {/if}
      <ChevronRightIcon size={16} />
    </button>
  {/if}

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

  .pagination__btn:hover:not(:disabled):not(.pagination__btn--disabled) {
    background: var(--color-surface-secondary);
  }

  .pagination__btn:disabled,
  .pagination__btn--disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }

  /* Anchor tag resets for link variant */
  a.pagination__btn,
  a.pagination__page {
    text-decoration: none;
    color: inherit;
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
    background: var(--color-interactive);
    color: var(--color-text-inverse);
    border-color: var(--color-interactive);
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

  /* Dark mode */
  :global([data-theme='dark']) .pagination__btn,
  :global([data-theme='dark']) .pagination__page {
    background: var(--color-surface-dark);
    border-color: var(--color-border-dark);
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .pagination__btn:hover:not(:disabled):not(.pagination__btn--disabled),
  :global([data-theme='dark']) .pagination__page:hover {
    background: var(--color-surface-variant);
  }

  :global([data-theme='dark']) .pagination__page.active {
    background: var(--color-interactive);
    border-color: var(--color-interactive);
  }

  :global([data-theme='dark']) .pagination__info,
  :global([data-theme='dark']) .pagination__ellipsis {
    color: var(--color-text-secondary-dark);
  }
</style>

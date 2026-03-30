<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';

  const orgSlug = $derived(page.params.slug);
</script>

<svelte:head>
  <title>{m.billing_error_title()} | {orgSlug}</title>
</svelte:head>

<div class="error-page" role="alert" aria-live="polite">
  <div class="error-container">
    <div class="error-icon" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
    </div>

    <h1 class="error-title">{m.billing_error_title()}</h1>
    <p class="error-description">{m.billing_error_description()}</p>

    {#if page.error?.message}
      <p class="error-detail">{page.error.message}</p>
    {/if}

    <div class="error-actions">
      <a href="/studio" class="back-link">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        {m.billing_error_back_to_studio()}
      </a>
    </div>
  </div>
</div>

<style>
  .error-page {
    min-height: 50vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
  }

  .error-container {
    width: 100%;
    max-width: 480px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
  }

  .error-icon {
    color: var(--color-text-secondary);
    margin-bottom: var(--space-2);
  }

  .error-title {
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
  }

  .error-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
    line-height: 1.5;
  }

  .error-detail {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    padding: var(--space-2);
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-md);
  }

  .error-actions {
    margin-top: var(--space-4);
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    text-decoration: none;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    transition: var(--transition-colors);
  }

  .back-link:hover {
    background-color: var(--color-surface-secondary);
  }

  /* Dark mode */
  :global([data-theme='dark']) .error-icon {
    color: var(--color-text-muted-dark);
  }

  :global([data-theme='dark']) .error-title {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .back-link {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
    color: var(--color-text-dark);
  }
</style>

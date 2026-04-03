<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { AlertTriangleIcon, ArrowLeftIcon } from '$lib/components/ui/Icon';

  const orgSlug = page.params.slug;
</script>

<svelte:head>
  <title>{m.studio_customers_error_title()} | {orgSlug}</title>
</svelte:head>

<div class="error-page" role="alert" aria-live="polite">
  <div class="error-container">
    <div class="error-icon" aria-hidden="true">
      <AlertTriangleIcon size={48} stroke-width="1.5" />
    </div>

    <h1 class="error-title">{m.studio_customers_error_title()}</h1>
    <p class="error-description">{m.studio_customers_error_description()}</p>

    {#if page.error?.message}
      <p class="error-detail">{page.error.message}</p>
    {/if}

    <div class="error-actions">
      <a href="/studio" class="back-link">
        <ArrowLeftIcon size={16} />
        {m.studio_customers_error_back_to_studio()}
      </a>
    </div>
  </div>
</div>

<style>
  .error-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background-color: var(--color-background);
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
    line-height: var(--leading-normal);
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
  :global([data-theme='dark']) .error-page {
    background-color: var(--color-background);
  }

  :global([data-theme='dark']) .error-icon {
    color: var(--color-text-muted);
  }

  :global([data-theme='dark']) .error-title {
    color: var(--color-text);
  }

  :global([data-theme='dark']) .back-link {
    background-color: var(--color-surface);
    border-color: var(--color-border);
    color: var(--color-text);
  }
</style>

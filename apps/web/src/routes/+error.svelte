<script lang="ts">
  import { page } from '$app/stores';

  const statusConfig: Record<number, { title: string; description: string; icon: 'search' | 'lock' | 'warning' }> = {
    404: {
      title: 'Page not found',
      description: "The page you're looking for doesn't exist or has been moved.",
      icon: 'search'
    },
    403: {
      title: 'Access denied',
      description: "You don't have permission to view this page.",
      icon: 'lock'
    },
    500: {
      title: 'Something went wrong',
      description: "We're working on fixing this. Please try again.",
      icon: 'warning'
    }
  };

  const config = $derived(statusConfig[$page.status] ?? {
    title: 'Error',
    description: $page.error?.message ?? 'An unexpected error occurred.',
    icon: 'warning' as const
  });
</script>

<svelte:head>
  <title>{$page.status} {config.title} | Codex</title>
</svelte:head>

<div class="error-page">
  <div class="error-card">
    <div class="error-icon">
      {#if config.icon === 'search'}
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          <line x1="8" y1="11" x2="14" y2="11"></line>
        </svg>
      {:else if config.icon === 'lock'}
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
      {/if}
    </div>

    <h1 class="error-code">{$page.status}</h1>
    <h2 class="error-title">{config.title}</h2>
    <p class="error-description">{config.description}</p>

    <div class="error-actions">
      <a href="/" class="btn btn-primary">Go Home</a>

      {#if $page.status === 404}
        <button class="btn btn-secondary" onclick={() => history.back()}>Go Back</button>
      {:else if $page.status === 403}
        <a href="/login" class="btn btn-secondary">Sign In</a>
      {:else if $page.status === 500}
        <button class="btn btn-secondary" onclick={() => location.reload()}>Try Again</button>
      {/if}
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
    background: var(--color-background, #ffffff);
  }

  .error-card {
    width: 100%;
    max-width: 480px;
    background: var(--color-surface, #ffffff);
    border-radius: var(--radius-lg, 0.75rem);
    padding: var(--space-8, 2rem) var(--space-8, 2rem) var(--space-6, 1.5rem);
    box-shadow: var(--shadow-lg, 0 10px 15px -3px rgba(0,0,0,.1));
    border: 1px solid var(--color-border, #e5e5e5);
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2, 0.5rem);
  }

  .error-icon {
    color: var(--color-text-secondary, #737373);
    margin-bottom: var(--space-2, 0.5rem);
  }

  .error-code {
    font-size: var(--text-4xl, 2.25rem);
    font-weight: var(--font-bold, 700);
    color: var(--color-text, #171717);
    margin: 0;
    line-height: 1;
  }

  .error-title {
    font-size: var(--text-xl, 1.25rem);
    font-weight: var(--font-semibold, 600);
    color: var(--color-text, #171717);
    margin: 0;
  }

  .error-description {
    font-size: var(--text-sm, 0.875rem);
    color: var(--color-text-secondary, #737373);
    margin: 0;
    max-width: 360px;
    line-height: 1.5;
  }

  .error-actions {
    display: flex;
    gap: var(--space-3, 0.75rem);
    margin-top: var(--space-4, 1rem);
    flex-wrap: wrap;
    justify-content: center;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2, 0.5rem) var(--space-4, 1rem);
    font-size: var(--text-sm, 0.875rem);
    font-weight: var(--font-medium, 500);
    border-radius: var(--radius-md, 0.5rem);
    text-decoration: none;
    border: none;
    cursor: pointer;
    transition: var(--transition-colors, color 0.15s, background-color 0.15s);
    font-family: inherit;
  }

  .btn-primary {
    background: var(--color-primary-500, #c24129);
    color: #ffffff;
  }

  .btn-primary:hover {
    background: var(--color-primary-600, #b23720);
  }

  .btn-secondary {
    background: transparent;
    color: var(--color-text-secondary, #737373);
    border: 1px solid var(--color-border, #e5e5e5);
  }

  .btn-secondary:hover {
    background: var(--color-neutral-50, #fafafa);
    color: var(--color-text, #171717);
  }
</style>

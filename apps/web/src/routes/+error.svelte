<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { AlertTriangleIcon, SearchMinusIcon, LockIcon } from '$lib/components/ui/Icon';
  import { Button } from '$lib/components/ui';

  const statusConfig: Record<number, { title: () => string; description: () => string; icon: 'search' | 'lock' | 'warning' }> = {
    404: {
      title: () => m.errors_not_found(),
      description: () => m.errors_not_found_description(),
      icon: 'search'
    },
    403: {
      title: () => m.errors_forbidden(),
      description: () => m.errors_forbidden_description(),
      icon: 'lock'
    },
    500: {
      title: () => m.errors_server_error(),
      description: () => m.errors_server_error_description(),
      icon: 'warning'
    }
  };

  const config = $derived(statusConfig[page.status] ?? {
    title: () => m.errors_generic(),
    description: () => page.error?.message ?? m.errors_generic_description(),
    icon: 'warning' as const
  });
</script>

<svelte:head>
  <title>{page.status} {config.title()} | Codex</title>
</svelte:head>

<div class="error-page">
  <div class="error-card">
    <div class="error-icon">
      {#if config.icon === 'search'}
        <SearchMinusIcon size={48} stroke-width="1.5" />
      {:else if config.icon === 'lock'}
        <LockIcon size={48} stroke-width="1.5" />
      {:else}
        <AlertTriangleIcon size={48} stroke-width="1.5" />
      {/if}
    </div>

    <h1 class="error-code">{page.status}</h1>
    <h2 class="error-title">{config.title()}</h2>
    <p class="error-description">{config.description()}</p>

    <div class="error-actions">
      <a href="/" class="btn-link btn-link--primary">{m.errors_go_home()}</a>

      {#if page.status === 404}
        <Button variant="secondary" onclick={() => history.back()}>{m.errors_go_back()}</Button>
      {:else if page.status === 403}
        <a href="/login" class="btn-link btn-link--secondary">{m.errors_sign_in()}</a>
      {:else if page.status === 500}
        <Button variant="secondary" onclick={() => location.reload()}>{m.errors_try_again()}</Button>
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
    box-shadow: var(--shadow-lg);
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
    line-height: var(--leading-none);
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
    line-height: var(--leading-normal);
  }

  .error-actions {
    display: flex;
    gap: var(--space-3, 0.75rem);
    margin-top: var(--space-4, 1rem);
    flex-wrap: wrap;
    justify-content: center;
  }

  .btn-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    text-decoration: none;
    border: var(--border-width) var(--border-style) transparent;
    cursor: pointer;
    transition: var(--transition-colors);
    font-family: inherit;
  }

  .btn-link--primary {
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  .btn-link--primary:hover {
    background: var(--color-interactive-hover);
  }

  .btn-link--secondary {
    background: transparent;
    color: var(--color-text-secondary);
    border-color: var(--color-border);
  }

  .btn-link--secondary:hover {
    background: var(--color-surface-secondary);
    color: var(--color-text);
  }
</style>

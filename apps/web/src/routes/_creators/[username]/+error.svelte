<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { AlertTriangleIcon, SearchMinusIcon, LockIcon } from '$lib/components/ui/Icon';

  const errorInfo = $derived.by(() => {
    switch (page.status) {
      case 404:
        return {
          title: m.errors_not_found(),
          message: m.errors_resource_not_found(),
          action: m.errors_browse_discover(),
          href: '/discover',
        };
      case 401:
      case 403:
        return {
          title: m.errors_unauthorized(),
          message: m.errors_login_required(),
          action: m.errors_login(),
          href: '/login',
        };
      default:
        return {
          title: m.errors_server_error(),
          message: m.errors_try_again_later(),
          action: m.errors_go_home(),
          href: '/discover',
        };
    }
  });

</script>

<svelte:head>
  <title>{page.status} {errorInfo.title} | Creator</title>
</svelte:head>

<div class="error-page" role="alert" aria-live="polite">
  <div class="error-card">
    <div class="error-icon" aria-hidden="true">
      {#if page.status === 404}
        <SearchMinusIcon size={48} stroke-width="1.5" />
      {:else if page.status === 401 || page.status === 403}
        <LockIcon size={48} stroke-width="1.5" />
      {:else}
        <AlertTriangleIcon size={48} stroke-width="1.5" />
      {/if}
    </div>

    <h1 class="error-code">{page.status}</h1>
    <h2 class="error-title">{errorInfo.title}</h2>
    <p class="error-description">{errorInfo.message}</p>

    {#if page.error?.message}
      <p class="error-detail">{page.error.message}</p>
    {/if}

    <div class="error-actions">
      <a href={errorInfo.href} class="btn btn-primary">{errorInfo.action}</a>

      {#if page.status !== 401 && page.status !== 403}
        <button class="btn btn-secondary" onclick={() => history.back()}>{m.org_error_go_back()}</button>
      {:else}
        <a href="/discover" class="btn btn-secondary">{m.org_error_go_home()}</a>
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
    background: var(--color-background);
  }

  .error-card {
    width: 100%;
    max-width: 480px;
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    padding: var(--space-8) var(--space-8) var(--space-6);
    box-shadow: var(--shadow-lg);
    border: var(--border-width) var(--border-style) var(--color-border);
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
  }

  .error-icon {
    color: var(--color-text-secondary);
    margin-bottom: var(--space-2);
  }

  .error-code {
    font-size: var(--text-4xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
    line-height: 1;
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
    max-width: 360px;
    line-height: 1.5;
  }

  .error-detail {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    padding: var(--space-2);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-md);
  }

  .error-actions {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-4);
    flex-wrap: wrap;
    justify-content: center;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    text-decoration: none;
    border: none;
    cursor: pointer;
    transition: var(--transition-colors);
    font-family: inherit;
  }

  .btn-primary {
    background: var(--color-interactive);
    color: #ffffff;
  }

  .btn-primary:hover {
    background: var(--color-interactive-hover);
  }

  .btn-secondary {
    background: transparent;
    color: var(--color-text-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .btn-secondary:hover {
    background: var(--color-neutral-50);
    color: var(--color-text);
  }

  /* Dark mode */
  :global([data-theme='dark']) .error-page {
    background: var(--color-background-dark);
  }

  :global([data-theme='dark']) .error-card {
    background: var(--color-surface-dark);
    border-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .error-icon {
    color: var(--color-text-muted-dark);
  }

  :global([data-theme='dark']) .error-code,
  :global([data-theme='dark']) .error-title {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .error-description {
    color: var(--color-text-secondary-dark);
  }

  :global([data-theme='dark']) .btn-secondary {
    border-color: var(--color-border-dark);
    color: var(--color-text-secondary-dark);
  }

  :global([data-theme='dark']) .btn-secondary:hover {
    background: var(--color-surface-variant);
    color: var(--color-text-dark);
  }
</style>

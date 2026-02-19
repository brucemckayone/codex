<script lang="ts">
  import { page } from '$app/stores';
  import * as m from '$paraglide/messages';

  const errorInfo = $derived(() => {
    switch ($page.status) {
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

  const icons = {
    search: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>`,
    lock: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
    warning: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
  };

  const icon = $derived(() => {
    if ($page.status === 404) return 'search';
    if ($page.status === 401 || $page.status === 403) return 'lock';
    return 'warning';
  });
</script>

<svelte:head>
  <title>{$page.status} {errorInfo().title} | Creator</title>
</svelte:head>

<div class="error-page" role="alert" aria-live="polite">
  <div class="error-card">
    <div class="error-icon" aria-hidden="true">
      {@html icons[icon()]}
    </div>

    <h1 class="error-code">{$page.status}</h1>
    <h2 class="error-title">{errorInfo().title}</h2>
    <p class="error-description">{errorInfo().message}</p>

    {#if $page.error?.message}
      <p class="error-detail">{$page.error.message}</p>
    {/if}

    <div class="error-actions">
      <a href={errorInfo().href} class="btn btn-primary">{errorInfo().action}</a>

      {#if $page.status !== 401 && $page.status !== 403}
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
    background: var(--color-primary-500);
    color: #ffffff;
  }

  .btn-primary:hover {
    background: var(--color-primary-600);
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
  [data-theme='dark'] .error-page {
    background: var(--color-background-dark);
  }

  [data-theme='dark'] .error-card {
    background: var(--color-surface-dark);
    border-color: var(--color-border-dark);
  }

  [data-theme='dark'] .error-icon {
    color: var(--color-text-muted-dark);
  }

  [data-theme='dark'] .error-code,
  [data-theme='dark'] .error-title {
    color: var(--color-text-dark);
  }

  [data-theme='dark'] .error-description {
    color: var(--color-text-secondary-dark);
  }

  [data-theme='dark'] .btn-secondary {
    border-color: var(--color-border-dark);
    color: var(--color-text-secondary-dark);
  }

  [data-theme='dark'] .btn-secondary:hover {
    background: var(--color-surface-variant);
    color: var(--color-text-dark);
  }
</style>

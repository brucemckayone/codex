<!--
  @component AccountErrorPage

  Shared error page for all account-related routes.
  Displays a status-specific error card with icon, message, and actions.

  @prop {number} status - HTTP status code from page.status
  @prop {string} returnHref - Primary action link (e.g. "/account", "/account/payment")
  @prop {string} pageTitle - Title suffix for the <title> tag (e.g. "Account", "Payments")
-->
<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { AlertTriangleIcon, SearchMinusIcon, LockIcon } from '$lib/components/ui/Icon';

  interface Props {
    status: number;
    returnHref: string;
    pageTitle: string;
  }

  const { status, returnHref, pageTitle }: Props = $props();

  const statusConfig: Record<number, { title: string; description: string; icon: string }> = {
    404: {
      title: m.account_error_not_found(),
      description: m.account_error_not_found_description(),
      icon: 'search',
    },
    403: {
      title: m.account_error_unauthorized(),
      description: m.account_error_unauthorized_description(),
      icon: 'lock',
    },
    500: {
      title: m.account_error_server_error(),
      description: m.account_error_server_error_description(),
      icon: 'warning',
    },
  };

  const config = $derived(
    statusConfig[status] ?? {
      title: m.account_error_server_error(),
      description: page.error?.message ?? 'An unexpected error occurred.',
      icon: 'warning',
    }
  );

</script>

<svelte:head>
  <title>{status} {config.title} | {pageTitle}</title>
</svelte:head>

<div class="error-page" role="alert" aria-live="polite">
  <div class="error-card">
    <div class="error-icon" aria-hidden="true">
      {#if config.icon === 'search'}
        <SearchMinusIcon size={48} stroke-width="1.5" />
      {:else if config.icon === 'lock'}
        <LockIcon size={48} stroke-width="1.5" />
      {:else}
        <AlertTriangleIcon size={48} stroke-width="1.5" />
      {/if}
    </div>

    <h1 class="error-code">{status}</h1>
    <h2 class="error-title">{config.title}</h2>
    <p class="error-description">{config.description}</p>

    <div class="error-actions">
      <a href={returnHref} class="btn btn-primary">{m.common_go_to_account()}</a>

      {#if status === 404}
        <button class="btn btn-secondary" onclick={() => history.back()}>{m.common_go_back()}</button>
      {:else if status === 403}
        <a href="/login" class="btn btn-secondary">{m.common_sign_in()}</a>
      {:else if status === 500}
        <button class="btn btn-secondary" onclick={() => location.reload()}>{m.common_try_again()}</button>
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
    line-height: var(--leading-none);
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
    line-height: var(--leading-normal);
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
    color: var(--color-text-inverse);
  }

  .btn-primary:hover {
    background: var(--color-interactive-hover);
  }

  .btn-primary:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .btn-secondary {
    background: transparent;
    color: var(--color-text-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .btn-secondary:hover {
    background: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .btn-secondary:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }
</style>

<!--
  @component OrgErrorBoundary

  Reusable error boundary component for organization routes.
  Provides consistent error display with org-aware navigation links.

  @prop {OrganizationData | null} org - Organization data for context
-->
<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import type { OrganizationData } from '$lib/types';
  import { AlertTriangleIcon, SearchMinusIcon, LockIcon } from '$lib/components/ui/Icon';

  const { org }: { org?: OrganizationData | null } = $props();

  const homeUrl = $derived(`/${org?.slug ?? ''}`);

  const statusConfig = {
    404: {
      titleKey: 'org_error_not_found',
      descriptionKey: 'org_error_not_found_description',
      icon: 'search',
      actionKey: 'org_error_go_home',
    },
    403: {
      titleKey: 'org_error_forbidden',
      descriptionKey: 'org_error_forbidden_description',
      icon: 'lock',
      actionKey: 'org_error_sign_in',
    },
    401: {
      titleKey: 'org_error_unauthorized',
      descriptionKey: 'org_error_unauthorized_description',
      icon: 'lock',
      actionKey: 'org_error_sign_in',
    },
    500: {
      titleKey: 'org_error_server_error',
      descriptionKey: 'org_error_server_error_description',
      icon: 'warning',
      actionKey: 'org_error_go_home',
    },
  };

  const config = $derived(
    statusConfig[page.status] ?? {
      titleKey: 'org_error_unknown',
      descriptionKey: 'org_error_unknown_description',
      icon: 'warning',
      actionKey: 'org_error_go_home',
    }
  );

  // Get message function dynamically
  const getMessage = (key: string) => {
    const fn = (m as Record<string, () => string>)[key];
    return fn ? fn() : key;
  };
</script>

<svelte:head>
  <title>{page.status} {getMessage(config.titleKey)} | {org?.name ?? 'Org'}</title>
</svelte:head>

<div class="org-error-page" role="alert" aria-live="polite">
  <div class="org-error-card">
    <div class="error-icon" aria-hidden="true">
      {#if config.icon === 'search'}
        <SearchMinusIcon size={48} stroke-width="1.5" />
      {:else if config.icon === 'lock'}
        <LockIcon size={48} stroke-width="1.5" />
      {:else}
        <AlertTriangleIcon size={48} stroke-width="1.5" />
      {/if}
    </div>

    <h1 class="error-code">{page.status}</h1>
    <h2 class="error-title">{getMessage(config.titleKey)}</h2>
    <p class="error-description">{getMessage(config.descriptionKey)}</p>

    {#if page.error?.message}
      <p class="error-detail">{page.error.message}</p>
    {/if}

    <div class="error-actions">
      {#if page.status === 401 || page.status === 403}
        <a href="/login" class="btn btn-primary">{getMessage(config.actionKey)}</a>
      {:else}
        <a href={homeUrl} class="btn btn-primary">{getMessage(config.actionKey)}</a>
      {/if}

      <button class="btn btn-secondary" onclick={() => history.back()}>
        {m.org_error_go_back()}
      </button>
    </div>
  </div>
</div>

<style>
  .org-error-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background: var(--color-background);
  }

  .org-error-card {
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
    color: var(--color-text-on-brand);
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

</style>

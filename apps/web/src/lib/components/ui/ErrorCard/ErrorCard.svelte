<!--
  @component ErrorCard

  Shared error display card used across all +error.svelte pages.
  Handles status-to-icon/title mapping internally, with optional
  overrides and custom action buttons via Snippet.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { AlertTriangleIcon, SearchMinusIcon, LockIcon } from '$lib/components/ui/Icon';

  interface ErrorConfig {
    title: string;
    description: string;
    icon: 'search' | 'lock' | 'warning';
  }

  interface Props {
    /** HTTP status code — defaults to page.status */
    status?: number;
    /** Override the default error title */
    title?: string;
    /** Override the default error description */
    description?: string;
    /** Optional detail message (e.g., page.error.message) */
    detail?: string | null;
    /** Suffix for the <title> tag (e.g., "Creator", "Codex") */
    titleSuffix?: string;
    /** Custom action buttons — replaces the default actions */
    actions?: Snippet;
  }

  const {
    status: statusProp,
    title: titleOverride,
    description: descriptionOverride,
    detail,
    titleSuffix = 'Codex',
    actions,
  }: Props = $props();

  const status = $derived(statusProp ?? page.status);

  const defaultConfig: Record<number, ErrorConfig> = {
    404: {
      title: m.errors_not_found(),
      description: m.errors_not_found_description(),
      icon: 'search',
    },
    401: {
      title: m.errors_unauthorized(),
      description: m.errors_login_required(),
      icon: 'lock',
    },
    403: {
      title: m.errors_forbidden(),
      description: m.errors_forbidden_description(),
      icon: 'lock',
    },
    500: {
      title: m.errors_server_error(),
      description: m.errors_server_error_description(),
      icon: 'warning',
    },
  };

  const fallbackConfig: ErrorConfig = {
    title: m.errors_generic(),
    description: m.errors_generic_description(),
    icon: 'warning',
  };

  const config = $derived(defaultConfig[status] ?? fallbackConfig);

  const displayTitle = $derived(titleOverride ?? config.title);
  const displayDescription = $derived(descriptionOverride ?? config.description);
  const displayIcon = $derived(config.icon);
</script>

<svelte:head>
  <title>{status} {displayTitle} | {titleSuffix}</title>
</svelte:head>

<div class="error-page" role="alert" aria-live="polite">
  <div class="error-card">
    <div class="error-icon" aria-hidden="true">
      {#if displayIcon === 'search'}
        <SearchMinusIcon size={48} stroke-width="1.5" />
      {:else if displayIcon === 'lock'}
        <LockIcon size={48} stroke-width="1.5" />
      {:else}
        <AlertTriangleIcon size={48} stroke-width="1.5" />
      {/if}
    </div>

    <h1 class="error-code">{status}</h1>
    <h2 class="error-title">{displayTitle}</h2>
    <p class="error-description">{displayDescription}</p>

    {#if detail}
      <p class="error-detail">{detail}</p>
    {/if}

    <div class="error-actions">
      {#if actions}
        {@render actions()}
      {:else}
        <a href="/" class="error-btn error-btn--primary">{m.errors_go_home()}</a>
        <button class="error-btn error-btn--secondary" onclick={() => history.back()}>
          {m.errors_go_back()}
        </button>
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

  .error-btn {
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

  .error-btn--primary {
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  .error-btn--primary:hover {
    background: var(--color-interactive-hover);
  }

  .error-btn--secondary {
    background: transparent;
    color: var(--color-text-secondary);
    border-color: var(--color-border);
  }

  .error-btn--secondary:hover {
    background: var(--color-surface-secondary);
    color: var(--color-text);
  }
</style>

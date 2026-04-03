<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { AlertTriangleIcon, ArrowLeftIcon } from '$lib/components/ui/Icon';

  const username = page.params.username;
</script>

<svelte:head>
  <title>{m.studio_error_title()} | @{username}</title>
</svelte:head>

<div class="error-page" role="alert" aria-live="polite">
  <div class="error-container">
    <div class="error-icon" aria-hidden="true">
      <AlertTriangleIcon size={48} stroke-width="1.5" />
    </div>

    <h1 class="error-title">
      {#if page.status === 404}
        Content not found
      {:else}
        {m.studio_error_title()}
      {/if}
    </h1>
    <p class="error-description">
      {#if page.status === 404}
        This content may have been removed or is no longer available.
      {:else}
        {m.studio_error_description()}
      {/if}
    </p>

    {#if page.error?.message && page.status !== 404}
      <p class="error-detail">{page.error.message}</p>
    {/if}

    <div class="error-actions">
      <a href="/{username}/content" class="back-link">
        <ArrowLeftIcon size={16} />
        Back to @{username}'s content
      </a>
    </div>
  </div>
</div>

<style>
  .error-page {
    min-height: 60vh;
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

  .error-icon { color: var(--color-text-secondary); margin-bottom: var(--space-2); }
  .error-title { font-size: var(--text-xl); font-weight: var(--font-semibold); color: var(--color-text); margin: 0; }
  .error-description { font-size: var(--text-sm); color: var(--color-text-secondary); margin: 0; line-height: var(--leading-normal); }
  .error-detail { font-size: var(--text-xs); color: var(--color-text-muted); font-family: var(--font-mono); padding: var(--space-2); background-color: var(--color-surface-secondary); border-radius: var(--radius-md); }
  .error-actions { margin-top: var(--space-4); }
  .back-link { display: inline-flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-4); font-size: var(--text-sm); font-weight: var(--font-medium); color: var(--color-text); text-decoration: none; border: var(--border-width) var(--border-style) var(--color-border); border-radius: var(--radius-md); background-color: var(--color-surface); transition: var(--transition-colors); }
  .back-link:hover { background-color: var(--color-surface-secondary); }
</style>

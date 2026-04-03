<script lang="ts">
  import type { Snippet } from 'svelte';
  import { AlertCircleIcon } from '$lib/components/ui/Icon';

  interface Props {
    title: string;
    description?: string;
    children?: Snippet;
  }

  const { title, description, children }: Props = $props();
</script>

<div class="error-banner" role="alert">
  <div class="error-icon">
    <AlertCircleIcon size={24} />
  </div>

  <div class="error-content">
    <h3 class="error-title">{title}</h3>
    {#if description}
      <p class="error-description">{description}</p>
    {/if}
    {#if children}
      <div class="error-actions">
        {@render children()}
      </div>
    {/if}
  </div>
</div>

<style>
  .error-banner {
    display: flex;
    align-items: start;
    gap: var(--space-4);
    padding: var(--space-4);
    background-color: var(--color-error-50, #fef2f2);
    border: var(--border-width) var(--border-style) var(--color-error-200, #fecaca);
    border-radius: var(--radius-md);
    color: var(--color-error-900, #7f1d1d);
  }

  .error-icon {
    color: var(--color-error, #ef4444);
    flex-shrink: 0;
  }

  .error-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .error-title {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    margin: 0;
  }

  .error-description {
    font-size: var(--text-sm);
    opacity: var(--opacity-90);
    margin: 0;
    max-width: none;
  }

  .error-actions {
    margin-top: var(--space-2);
  }
</style>

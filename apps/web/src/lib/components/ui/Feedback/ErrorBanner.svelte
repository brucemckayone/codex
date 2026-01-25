<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    description?: string;
    children?: Snippet;
  }

  const { title, description, children }: Props = $props();
</script>

<div class="error-banner" role="alert">
  <div class="error-icon">
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
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
    background-color: var(--color-primary-50);
    border: var(--border-width) var(--border-style) var(--color-primary-200);
    border-radius: var(--radius-md);
    color: var(--color-primary-900);
  }

  .error-icon {
    color: var(--color-primary-500);
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
    opacity: 0.9;
    margin: 0;
    max-width: none;
  }

  .error-actions {
    margin-top: var(--space-2);
  }
</style>

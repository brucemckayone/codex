<script lang="ts">
  import type { Snippet } from 'svelte';
  import { logger } from '$lib/observability';
  import Button from '../../Button/Button.svelte';
  import { AlertCircleIcon } from '$lib/components/ui/Icon';

  interface Props {
    children: Snippet;
    fallback?: Snippet<[Error, () => void]>;
    onerror?: (error: Error, reset: () => void) => void;
    onreset?: () => void;
  }

  const { children, fallback, onerror, onreset }: Props = $props();

  function handleError(e: Error, reset: () => void) {
    logger.error('[ErrorBoundary]', { error: e.message, stack: e.stack });
    onerror?.(e, reset);
  }

</script>

<svelte:boundary onerror={handleError}>
  {@render children()}

  {#snippet failed(error, reset)}
    {#if fallback}
      {@render fallback(error, reset)}
    {:else}
      <div class="error-boundary" role="alert">
        <div class="error-icon">
          <AlertCircleIcon size={24} />
        </div>

        <div class="error-content">
          <h2 class="error-title">Something went wrong</h2>
          <p class="error-message">An unexpected error occurred. Please try again.</p>

          <div class="error-actions">
            <Button variant="destructive" size="sm" onclick={() => {
              onreset?.();
              reset();
            }}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    {/if}
  {/snippet}
</svelte:boundary>

<style>
  .error-boundary {
    display: flex;
    align-items: start;
    gap: var(--space-4);
    padding: var(--space-6);
    background-color: var(--color-error-50, #fef2f2);
    border: var(--border-width, 1px) var(--border-style, solid) var(--color-error-200, #fecaca);
    border-radius: var(--radius-lg);
    color: var(--color-error-900, #7f1d1d);
    margin: var(--space-4) 0;
  }

  .error-icon {
    color: var(--color-error);
    flex-shrink: 0;
  }

  .error-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 1;
  }

  .error-title {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    margin: 0;
    color: var(--color-error-900, #7f1d1d);
  }

  .error-message {
    font-size: var(--text-sm);
    margin: 0;
    opacity: 0.9;
  }

  .error-actions {
    margin-top: var(--space-2);
  }
</style>

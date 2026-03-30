<script lang="ts">
  import type { Snippet } from 'svelte';
  import { logger } from '$lib/observability';

  interface Props {
    children: Snippet;
    fallback?: Snippet<[Error]>;
  }

  const { children, fallback }: Props = $props();
  let error = $state<Error | null>(null);

  function handleError(e: Error) {
    error = e;
    logger.error('[ErrorBoundary]', { error: e.message, stack: e.stack });
  }
</script>

{#if error}
  {#if fallback}
    {@render fallback(error)}
  {:else}
    <div role="alert">
      <h2>Something went wrong</h2>
      <button onclick={() => error = null}>
        Try again
      </button>
    </div>
  {/if}
{:else}
  <svelte:boundary onerror={handleError}>
    {@render children()}
  </svelte:boundary>
{/if}

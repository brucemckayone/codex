<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
    fallback?: Snippet<[Error]>;
  }

  const { children, fallback }: Props = $props();
  let error = $state<Error | null>(null);

  function handleError(e: Error) {
    error = e;
    console.error('[ErrorBoundary]', e);
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

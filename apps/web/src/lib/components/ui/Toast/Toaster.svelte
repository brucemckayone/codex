<script lang="ts">
  import ToastComponent from './Toast.svelte';
  import { toast } from './toast-store.js';

  // Subscribe to store
  // In Svelte 5, $store works in runes too
</script>

<div class="toaster">
  {#each $toast as t (t.id)}
    <ToastComponent toast={t} />
  {/each}
</div>

<style>
  .toaster {
    position: fixed;
    bottom: var(--space-4);
    right: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    z-index: var(--z-toast, 50); /* Verify z-index token */
    pointer-events: none; /* Let clicks pass through empty space */
  }
</style>

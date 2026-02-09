<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  const { data } = $props();

  onMount(() => {
    if (data.success) {
      // Auto-redirect after short delay
      setTimeout(() => {
        goto('/library');
      }, 3000);
    }
  });
</script>

<svelte:head>
  <title>Email Verification | Codex</title>
</svelte:head>

<div>
  {#if data.success}
    <div>success</div>
  {:else}
    <div>failure</div>
  {/if}
</div>

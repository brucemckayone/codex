<script lang="ts">
  import type { Component } from 'svelte';

  const { component, props }: { component: Component; props: Record<string, unknown> } = $props();
</script>

<svelte:component this={component} {...props}>
  {#snippet children()}
    {#if props.childrenText}
      {props.childrenText}
    {/if}
  {/snippet}
</svelte:component>

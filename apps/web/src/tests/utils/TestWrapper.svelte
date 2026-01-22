<script lang="ts">
  const { component, props }: { component: any; props: any } = $props();
</script>

<svelte:component this={component} {...props}>
  {#snippet children()}
    {#if props.childrenText}
      {props.childrenText}
    {/if}
  {/snippet}
</svelte:component>

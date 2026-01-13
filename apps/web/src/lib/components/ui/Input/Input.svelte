<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends HTMLInputAttributes {
    error?: string;
  }

  const { class: className, error, value, ...rest }: Props = $props();
</script>

<div class="input-wrapper">
  <input
    class={className}
    {value}
    {...rest}
  />
  {#if error}
    <span>{error}</span>
  {/if}
</div>

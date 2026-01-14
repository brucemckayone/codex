<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLLabelAttributes } from 'svelte/elements';

  interface Props extends HTMLLabelAttributes {
    children: Snippet;
  }

  const { children, ...restProps }: Props = $props();
</script>

<label {...restProps}>
  {@render children()}
</label>

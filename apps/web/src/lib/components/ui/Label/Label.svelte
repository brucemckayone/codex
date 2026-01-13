<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLLabelAttributes } from 'svelte/elements';

  interface Props extends HTMLLabelAttributes {
    children: Snippet;
  }

  const { children, ...restProps }: Props = $props();
</script>

<label class="label" {...restProps}>
  {@render children()}
</label>

<style>
  .label {
    display: block;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    line-height: var(--leading-none);
    color: var(--color-text);
    user-select: none;
  }
</style>

<script lang="ts">
  import { createLabel, melt } from '@melt-ui/svelte';
  import type { Snippet } from 'svelte';
  import type { HTMLLabelAttributes } from 'svelte/elements';

  interface Props extends HTMLLabelAttributes {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
  const { elements: { root } } = createLabel();
</script>

<label use:melt={$root} class="label {className ?? ''}" {...restProps}>
  {@render children()}
</label>

<style>
  .label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    line-height: var(--leading-none);
    user-select: none;
    cursor: default;
  }

  :global(.label:has(+ :disabled)) {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>

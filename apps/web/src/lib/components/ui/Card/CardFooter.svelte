<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<div class="card-footer {className}" {...restProps}>
  {@render children()}
</div>

<style>
  .card-footer {
    display: flex;
    align-items: center;
    padding: var(--space-6);
    padding-top: 0;
  }
</style>

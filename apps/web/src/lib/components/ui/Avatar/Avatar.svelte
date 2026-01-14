<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<div class="avatar {className}" {...restProps}>
  {@render children()}
</div>

<style>
  .avatar {
    position: relative;
    display: flex;
    height: var(--space-10); /* Default 40px */
    width: var(--space-10);
    overflow: hidden;
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }
</style>

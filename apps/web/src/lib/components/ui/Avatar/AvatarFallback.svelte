<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<div class="avatar-fallback {className}" {...restProps}>
  {@render children()}
</div>

<style>
  .avatar-fallback {
    display: flex;
    height: 100%;
    width: 100%;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    background-color: var(--color-neutral-100);
    color: var(--color-neutral-600);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  :global([data-theme="dark"]) .avatar-fallback {
     background-color: var(--color-neutral-800);
     color: var(--color-neutral-400);
  }
</style>

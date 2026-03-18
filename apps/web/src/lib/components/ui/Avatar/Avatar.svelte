<script lang="ts">
  import { type Snippet, setContext } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    src?: string;
    children: Snippet;
  }

  const { src, children, class: className, ...restProps }: Props = $props();

  let imageLoaded = $state(false);

  // Reset loaded state whenever src changes
  $effect(() => {
    src; // reactive dependency — re-runs when src changes
    imageLoaded = false;
  });

  setContext('AVATAR', {
    getLoaded: () => imageLoaded,
    onLoad: () => { imageLoaded = true; },
    onError: () => { imageLoaded = false; },
  });
</script>

<div class="avatar {className ?? ''}" {...restProps}>
  {@render children()}
</div>

<style>
  .avatar {
    position: relative;
    display: flex;
    height: var(--space-10);
    width: var(--space-10);
    overflow: hidden;
    border-radius: var(--radius-full);
    flex-shrink: 0;
    background-color: var(--color-surface-secondary);
  }
</style>

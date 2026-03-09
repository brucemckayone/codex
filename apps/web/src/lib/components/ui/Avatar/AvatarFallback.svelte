<script lang="ts">
  import { getContext, type Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
  const { getLoaded } = getContext<{ getLoaded: () => boolean }>('AVATAR');
</script>

<div
  class="avatar-fallback {className ?? ''}"
  style:display={getLoaded() ? 'none' : 'flex'}
  {...restProps}
>
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
    background-color: var(--color-surface-secondary);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }
</style>

<script lang="ts">
  import { createAvatar } from '@melt-ui/svelte';
  import { type Snippet, setContext } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    src?: string; // Optional for fallback-only
    delayMs?: number;
    children: Snippet;
  }

  const { src = '', delayMs = 0, children, class: className, ...restProps }: Props = $props();

  const avatar = createAvatar({
    src,
    delayMs
  });

  const { options } = avatar;

  $effect(() => {
    options.src.set(src);
    options.delayMs.set(delayMs);
  });

  setContext('AVATAR', avatar);
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

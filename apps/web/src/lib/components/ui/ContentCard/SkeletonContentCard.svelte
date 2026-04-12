<!--
  @component SkeletonContentCard

  Skeleton placeholder matching ContentCard dimensions.
  Renders a shimmer animation for loading states.
-->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { Skeleton } from '../Skeleton';

  interface Props extends HTMLAttributes<HTMLDivElement> {}

  const { class: className, ...restProps }: Props = $props();
</script>

<article class="cc cc--skeleton {className ?? ''}" aria-hidden="true" {...restProps}>
  <div class="cc__thumb">
    <Skeleton width="100%" height="100%" />
  </div>
  <div class="cc__body">
    <Skeleton width="75%" height="1.25rem" />
    <Skeleton width="45%" height="0.75rem" />
    <Skeleton width="60%" height="1rem" />
  </div>
</article>

<style>
  .cc {
    display: flex;
    flex-direction: column;
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .cc__thumb {
    aspect-ratio: 16 / 9;
  }

  .cc__body {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
  }
</style>

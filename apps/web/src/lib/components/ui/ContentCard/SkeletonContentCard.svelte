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

<article class="skeleton-card {className ?? ''}" aria-hidden="true" {...restProps}>
  <div class="skeleton-card__thumbnail">
    <Skeleton width="100%" height="100%" />
  </div>
  <div class="skeleton-card__body">
    <Skeleton width="75%" height="1.25rem" />
    <Skeleton width="50%" height="1rem" />
    <Skeleton width="60%" height="1rem" />
  </div>
</article>

<style>
  .skeleton-card {
    display: flex;
    flex-direction: column;
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .skeleton-card__thumbnail {
    aspect-ratio: 16 / 9;
  }

  .skeleton-card__body {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
</style>

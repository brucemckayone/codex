<!--
  @component SkeletonCreatorCard

  Skeleton placeholder matching CreatorCard dimensions.
  Renders a shimmer animation for loading states.
-->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { Skeleton } from '../Skeleton';

  interface Props extends HTMLAttributes<HTMLDivElement> {}

  const { class: className, ...restProps }: Props = $props();
</script>

<div class="skeleton-creator {className ?? ''}" aria-hidden="true" {...restProps}>
  <Skeleton width="3rem" height="3rem" class="skeleton-circle" />
  <div class="skeleton-creator__text">
    <Skeleton width="60%" height="1rem" />
    <Skeleton width="40%" height="0.75rem" />
  </div>
</div>

<style>
  .skeleton-creator {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
  }

  .skeleton-creator__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
</style>

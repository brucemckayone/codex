<!--
  @component Skeleton

  A skeleton loading placeholder for content that is still loading.
  Provides a pulsing animation to indicate loading state.

  @prop {string} [width='100%'] - Width of the skeleton (CSS value)
  @prop {string} [height='1rem'] - Height of the skeleton (CSS value)

  @example
  <Skeleton width="200px" height="2rem" />
  <Skeleton width="100%" height="100px" />
-->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    width?: string;
    height?: string;
  }

  const { class: className, width = '100%', height = '1rem', ...restProps }: Props = $props();
</script>

<div
  class="skeleton {className ?? ''}"
  style="width: {width}; height: {height};"
  {...restProps}
></div>

<style>
  .skeleton {
    display: block;
    position: relative;
    overflow: hidden;
    background: var(--color-surface-tertiary);
    border-radius: var(--radius-sm, 4px);
  }

  .skeleton:global(.skeleton-circle) {
    border-radius: var(--radius-full, 9999px);
  }

  .skeleton::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      var(--color-skeleton-shimmer) 50%,
      transparent 100%
    );
    /* Shimmer sweep — token-driven so motion.css can collapse it under
       prefers-reduced-motion: reduce. --duration-slowest × 3 ≈ 2.4s. */
    animation: skeleton-shimmer calc(var(--duration-slowest) * 3) ease-in-out infinite;
  }

  @keyframes skeleton-shimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }

  /* Explicit reduced-motion guard — belt-and-braces with motion.css global
     !important collapse. Removing the sweep pseudo entirely is more
     predictable than a 0.01ms infinite animation. */
  @media (prefers-reduced-motion: reduce) {
    .skeleton::after {
      animation: none;
      display: none;
    }
  }
</style>

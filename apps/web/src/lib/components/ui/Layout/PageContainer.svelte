<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    maxWidth?: string;
    padding?: string;
    children: Snippet;
  }

  const {
    maxWidth,
    padding,
    children,
    class: className,
    ...restProps
  }: Props = $props();
</script>

<div
  class="page-container {className ?? ''}"
  style:--pc-max-width={maxWidth}
  style:--pc-padding={padding}
  {...restProps}
>
  {@render children()}
</div>

<style>
  .page-container {
    width: 100%;
    margin-left: auto;
    margin-right: auto;
    padding-left: var(--pc-padding, var(--space-4));
    padding-right: var(--pc-padding, var(--space-4));
    max-width: var(--pc-max-width, 1280px);
  }

  @media (min-width: 640px) {
    .page-container {
      padding-left: var(--pc-padding, var(--space-6));
      padding-right: var(--pc-padding, var(--space-6));
    }
  }

  @media (min-width: 1024px) {
    .page-container {
      padding-left: var(--pc-padding, var(--space-8));
      padding-right: var(--pc-padding, var(--space-8));
    }
  }
</style>

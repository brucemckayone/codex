<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
    class?: string;
  }

  const { children, class: className }: Props = $props();
</script>

<div class="page-container {className ?? ''}">
  {@render children()}
</div>

<style>
  .page-container {
    width: 100%;
    margin-left: auto;
    margin-right: auto;
    padding-left: var(--space-4);
    padding-right: var(--space-4);
    max-width: 1280px;
  }

  @media (min-width: 640px) {
    .page-container {
      padding-left: var(--space-6);
      padding-right: var(--space-6);
    }
  }

  @media (min-width: 1024px) {
    .page-container {
      padding-left: var(--space-8);
      padding-right: var(--space-8);
    }
  }
</style>

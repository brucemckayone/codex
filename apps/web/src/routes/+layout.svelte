<script lang="ts">
  /**
   * Root layout - provides user context to all pages
   */
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';
  import '../lib/styles/global.css';

  const { data, children }: { data: LayoutData; children: Snippet } = $props();

  // User is available to all child components via data
  const _ = data;
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<a href="#main-content" class="skip-link">Skip to content</a>

<main id="main-content">
  {@render children()}
</main>

<style>
  .skip-link {
    position: absolute;
    top: -100%;
    left: 0;
    padding: var(--space-2) var(--space-4);
    background: var(--color-surface);
    z-index: var(--z-toast);
    color: var(--color-text);
  }

  .skip-link:focus {
    top: 0;
  }
</style>

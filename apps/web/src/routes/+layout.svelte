<script lang="ts">
  /**
   * Root layout - provides user context to all pages
   */
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';
  import '../app.css';

  const { data, children }: { data: LayoutData; children: Snippet } = $props();

  // User is available to all child components via data
  const _ = data;
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

{@render children()}

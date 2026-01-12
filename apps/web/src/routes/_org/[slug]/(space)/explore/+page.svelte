<script lang="ts">
  /**
   * Organization explore page
   */
  import type { PageData } from './$types';

  const { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Explore | {data.org?.name ?? 'Organization'}</title>
</svelte:head>

<div class="explore">
  <h1>Explore Content</h1>
  <p class="subtitle">Browse all content from {data.org?.name ?? 'this organization'}</p>

  <div class="content-grid">
    <div class="placeholder-card">Content coming soon...</div>
    <div class="placeholder-card">Content coming soon...</div>
    <div class="placeholder-card">Content coming soon...</div>
  </div>
</div>



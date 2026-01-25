<script lang="ts">
  /**
   * Organization landing page (space)
   */
  import type { PageData } from './$types';

  const { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>{data.org?.name ?? 'Organization'} | Revelations</title>
</svelte:head>

<div class="org-landing">
  <section class="org-hero">
    <h1>{data.org?.name ?? 'Organization'}</h1>
    <p class="org-description">{data.org?.description ?? 'Welcome to our content space'}</p>
    <a href="/explore" class="cta">Explore Content</a>
  </section>

  <section class="featured">
    <h2>Featured Content</h2>
    <p class="placeholder">Content grid will be displayed here</p>
  </section>
</div>



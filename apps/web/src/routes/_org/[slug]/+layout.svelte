<script lang="ts">
  /**
   * Organization layout - for {slug}.revelations.studio routes
   */
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';

  const { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<div class="org-layout">
  <header class="org-header">
    <a href="/" class="org-name">{data.org?.name ?? 'Organization'}</a>
    <nav class="nav">
      <a href="/explore">Explore</a>
      {#if data.user}
        <a href="https://revelations.studio/library">Library</a>
        <a href="/studio">Studio</a>
      {:else}
        <a href="/login">Sign In</a>
      {/if}
    </nav>
  </header>

  <main class="org-main">
    {@render children()}
  </main>

  <footer class="org-footer">
    <p>Powered by <a href="https://revelations.studio">Revelations</a></p>
  </footer>
</div>



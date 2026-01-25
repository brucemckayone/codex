<script lang="ts">
  /**
   * Creators layout - for creators.revelations.studio routes
   */
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';

  const { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<div class="creators-layout">
  <header class="creators-header">
    <a href="https://revelations.studio" class="logo">Revelations</a>
    <nav class="nav">
      <a href="/">Creators</a>
      {#if data.user}
        <a href="https://revelations.studio/library">Library</a>
        <a href="/studio">My Studio</a>
      {:else}
        <a href="/login">Sign In</a>
      {/if}
    </nav>
  </header>

  <main class="creators-main">
    {@render children()}
  </main>

  <footer class="creators-footer">
    <p>&copy; 2026 Revelations Studio. All rights reserved.</p>
  </footer>
</div>



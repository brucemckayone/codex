<script lang="ts">
  /**
   * Platform layout - for revelations.studio routes
   */
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';

  const { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<div class="platform-layout">
  <header class="platform-header">
    <a href="/" class="logo">Revelations</a>
    <nav class="nav">
      <a href="/discover">Discover</a>
      {#if data.user}
        <a href="/library">Library</a>
        <a href="/account">Account</a>
      {:else}
        <a href="/login">Sign In</a>
      {/if}
    </nav>
  </header>

  <main class="platform-main">
    {@render children()}
  </main>

  <footer class="platform-footer">
    <p>&copy; 2026 Revelations Studio. All rights reserved.</p>
  </footer>
</div>



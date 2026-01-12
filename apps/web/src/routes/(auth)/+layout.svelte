<script lang="ts">
  /**
   * Auth layout - for login, register, forgot-password routes
   */
  import type { Snippet } from 'svelte';

  const { children }: { children: Snippet } = $props();
</script>

<div class="auth-layout">
  <header class="auth-header">
    <a href="/" class="logo">Revelations</a>
  </header>

  <main class="auth-main">
    {@render children()}
  </main>
</div>



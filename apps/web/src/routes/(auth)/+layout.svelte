<script lang="ts">
  import type { Snippet } from 'svelte';

  const { children }: { children: Snippet } = $props();
</script>

<div class="auth-layout">
  <div class="card-container">
    {@render children()}
  </div>
</div>

<style>
  .auth-layout {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background: var(--color-background);
  }

  .card-container {
    width: 100%;
    max-width: 400px;
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    padding: var(--space-8);
    box-shadow: var(--shadow-lg);
    border: 1px solid var(--color-border);
  }
</style>

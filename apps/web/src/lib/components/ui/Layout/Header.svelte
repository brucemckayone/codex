<script lang="ts">
  import type { Snippet } from 'svelte';
  import { PageContainer } from '../index';

  interface Props {
    children?: Snippet;
  }

  const { children }: Props = $props();
</script>

<header class="header">
  <PageContainer class="header-inner">
    <div class="logo">
      <a href="/" class="logo-link">Codex</a>
    </div>

    <nav class="nav">
      {@render children?.()}
    </nav>
  </PageContainer>
</header>

<style>
  .header {
    height: var(--space-16);
    background-color: var(--color-surface);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    display: flex;
    align-items: center;
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
  }

  :global(.header-inner) {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .logo-link {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-primary-500);
    text-transform: lowercase;
    letter-spacing: var(--tracking-tight);
  }

  .nav {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }
</style>

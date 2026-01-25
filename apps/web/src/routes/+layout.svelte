<script lang="ts">
  /**
   * Root layout - provides user context to all pages
   */
  import type { Snippet } from 'svelte';
  import { onNavigate } from '$app/navigation';
  import { Footer, Header, PageContainer, Toaster } from '$lib/components/ui';
  import type { LayoutData } from './$types';
  import '../lib/styles/global.css';

  const { data, children }: { data: LayoutData; children: Snippet } = $props();

  onNavigate((navigation) => {
    if (!navigation.to) return; // Ignore hash navigation
    if (!document.startViewTransition) return;

    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
    });
  });

  // User is available to all child components via data
  const _ = data;
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<a href="#main-content" class="skip-link">Skip to content</a>

<Header>
  <a href="/showcase" class="nav-link">Showcase</a>
</Header>

<main id="main-content">
  <PageContainer>
    {@render children()}
  </PageContainer>
</main>

<Footer />

<Toaster />

<style>
  .nav-link {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .nav-link:hover {
    color: var(--color-primary-500);
  }

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

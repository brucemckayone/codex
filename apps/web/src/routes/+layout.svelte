<script lang="ts">
  /**
   * Root layout - thin shell providing global styles, view transitions, and user context.
   * Each route group (platform, org, creators) owns its own header/footer chrome.
   */
  import type { Snippet } from 'svelte';
  import { onNavigate } from '$app/navigation';
  import { Toaster } from '$lib/components/ui';
  import type { LayoutData } from './$types';
  import '../lib/styles/global.css';

  const { data, children }: { data: LayoutData; children: Snippet } = $props();

  onNavigate((navigation) => {
    if (!navigation.to) return;
    if (!document.startViewTransition) return;

    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
    });
  });

  const _ = data;
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<a href="#main-content" class="skip-link">Skip to content</a>

{@render children()}

<Toaster />

<style>
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

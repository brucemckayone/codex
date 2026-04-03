<script lang="ts">
  /**
   * Root layout - thin shell providing global styles, view transitions, and user context.
   * Each route group (platform, org, creators) owns its own header/footer chrome.
   */
  import type { Snippet } from 'svelte';
  import { onNavigate } from '$app/navigation';
  import { NavigationProgress, SkipLink, Toaster } from '$lib/components/ui';
  import type { LayoutData } from './$types';
  import '../lib/styles/global.css';

  const { data, children }: { data: LayoutData; children: Snippet } = $props();

  onNavigate((navigation) => {
    if (!navigation.to) return;
    if (!document.startViewTransition) return;

    // Skip view transition for same-path navigations (query/hash changes)
    if (navigation.from?.url.pathname === navigation.to.url.pathname) return;

    return new Promise((resolve) => {
      const transition = document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });

      // Safety valve: skip the visual transition if DOM update takes too long.
      // With experimental.async, Svelte's tick() races rAF against setTimeout,
      // but slow server loads (cold workers in dev) can still hit edge cases.
      // skipTransition() completes the transition instantly (no animation),
      // ensuring the DOM always updates without waiting for Chrome's 4s timeout.
      const safety = setTimeout(() => transition.skipTransition(), 500);
      transition.finished
        .finally(() => clearTimeout(safety))
        .catch(() => {});
    });
  });

</script>

<svelte:head>
  <meta name="description" content="Discover transformative content from independent creators" />
  <meta property="og:site_name" content="Revelations" />
  <meta property="og:type" content="website" />
  <link rel="manifest" href="/manifest.json" />
</svelte:head>

<SkipLink />

<NavigationProgress />

{@render children()}

<Toaster />


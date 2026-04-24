<script lang="ts">
  /**
   * Platform layout - provides PlatformHeader, PageContainer, and Footer
   * for all routes under the (platform) group.
   */
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { beforeNavigate, invalidate } from '$app/navigation';
  import { SidebarRail } from '$lib/components/layout/SidebarRail';
  import { MobileBottomNav, MobileBottomSheet } from '$lib/components/layout/MobileNav';
  import CommandPaletteSearch from '$lib/components/search/CommandPaletteSearch.svelte';
  import HealthBanner from '$lib/components/subscription/HealthBanner.svelte';
  import { Footer, PageContainer } from '$lib/components/ui';
  import type { LayoutUser } from '$lib/types';
  import type { LayoutData } from './$types';
  import { getStaleKeys, updateStoredVersions } from '$lib/client/version-manifest';
  import { invalidateCollection } from '$lib/collections';
  import { initProgressSync, cleanupProgressSync, forceSync } from '$lib/collections/progress-sync';

  const { data, children }: { data: LayoutData; children: Snippet } = $props();

  let searchOpen = $state(false);
  let moreOpen = $state(false);

  const user = $derived<LayoutUser | null>(
    data.user
      ? { name: data.user.name ?? '', email: data.user.email ?? '', image: data.user.image ?? undefined, role: data.user.role }
      : null
  );

  // Reactive staleness check — runs on mount AND whenever data.versions changes.
  // data.versions changes after invalidate('cache:versions') re-runs the server load,
  // which is triggered by the visibilitychange handler below.
  $effect(() => {
    const staleKeys = getStaleKeys(data.versions ?? {});
    if (staleKeys.some((k) => k.includes(':library'))) {
      void invalidateCollection('library');
    }
    updateStoredVersions(data.versions ?? {});
  });

  // Flush unsynced playback progress before navigation so server loads see it
  beforeNavigate(() => {
    void forceSync();
  });

  onMount(() => {
    // Re-check KV versions on tab return by re-running the server load.
    // This detects purchases made on another device while this tab was hidden.
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        void invalidate('cache:versions');
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);

    // Activate progress sync: 30s periodic flush, visibility sync, beforeunload beacon.
    if (data.user?.id) {
      initProgressSync(data.user.id);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      cleanupProgressSync();
    };
  });
</script>

<SidebarRail variant="platform" {user} onSearchClick={() => { searchOpen = true; }} />

<div class="platform-layout">
  <main id="main-content">
    <HealthBanner />
    <PageContainer>
      {@render children()}
    </PageContainer>
  </main>

  <Footer />
</div>

<MobileBottomNav
  variant="platform"
  {user}
  onSearchClick={() => { searchOpen = true; }}
  onMoreClick={() => { moreOpen = true; }}
/>
<MobileBottomSheet bind:open={moreOpen} variant="platform" {user} />
<CommandPaletteSearch scope="platform" bind:open={searchOpen} />

<style>
  .platform-layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    margin-left: var(--space-16);
  }

  @media (--below-md) {
    .platform-layout {
      margin-left: 0;
    }
  }

  main {
    flex: 1;
  }

  @media (--below-md) {
    main {
      padding-bottom: var(--space-20);
    }
  }
</style>

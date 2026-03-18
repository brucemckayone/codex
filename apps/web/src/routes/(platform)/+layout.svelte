<script lang="ts">
  /**
   * Platform layout - provides PlatformHeader, PageContainer, and Footer
   * for all routes under the (platform) group.
   */
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import { PlatformHeader } from '$lib/components/layout';
  import { Footer, PageContainer } from '$lib/components/ui';
  import type { LayoutUser } from '$lib/types';
  import type { LayoutData } from './$types';
  import { getStaleKeys, updateStoredVersions } from '$lib/client/version-manifest';
  import { invalidateCollection } from '$lib/collections';
  import { initProgressSync, cleanupProgressSync } from '$lib/collections/progress-sync';

  const { data, children }: { data: LayoutData; children: Snippet } = $props();

  const user: LayoutUser | null = data.user
    ? { name: data.user.name ?? '', email: data.user.email ?? '', image: data.user.image ?? undefined }
    : null;

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

<div class="platform-layout">
  <PlatformHeader {user} />

  <main id="main-content">
    <PageContainer>
      {@render children()}
    </PageContainer>
  </main>

  <Footer />
</div>

<style>
  .platform-layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  main {
    flex: 1;
  }
</style>

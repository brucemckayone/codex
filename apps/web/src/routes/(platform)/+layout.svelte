<script lang="ts">
  /**
   * Platform layout - provides PlatformHeader, PageContainer, and Footer
   * for all routes under the (platform) group.
   */
  import type { Snippet } from 'svelte';
  import { PlatformHeader } from '$lib/components/layout';
  import { Footer, PageContainer } from '$lib/components/ui';
  import type { LayoutUser } from '$lib/types';
  import type { LayoutData } from './$types';

  const { data, children }: { data: LayoutData; children: Snippet } = $props();

  const user: LayoutUser | null = data.user
    ? { name: data.user.name ?? '', email: data.user.email ?? '', image: data.user.image ?? undefined }
    : null;
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

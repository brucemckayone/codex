<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';
  import OrgHeader from '$lib/components/layout/Header/OrgHeader.svelte';
  import Footer from '$lib/components/ui/Layout/Footer.svelte';

  const { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<div class="org-layout" data-org-brand={data.org?.slug ?? ''}>
  <OrgHeader org={data.org} user={data.user} />

  <main class="org-main">
    {@render children()}
  </main>

  <Footer />
</div>

<style>
  .org-layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .org-main {
    flex: 1;
  }
</style>



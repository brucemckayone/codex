<script lang="ts">
  import { page } from '$app/state';
  import ContentGone from '$lib/components/content/ContentGone.svelte';
  import OrgErrorBoundary from '$lib/components/org/OrgErrorBoundary.svelte';
  import type { OrganizationData } from '$lib/types';

  const org: OrganizationData = {
    id: '',
    slug: page.params.slug,
    name: page.params.slug,
    description: '',
    logoUrl: null,
    brandColors: {
      primary: '#e94560',
      secondary: '#1a1a2e',
      accent: '#ff6b6b',
    },
  };
</script>

<!-- A removed piece's old link (Codex-a6ofh.6.7): its own page, not an error. -->
{#if page.status === 410}
  <ContentGone />
{:else}
  <OrgErrorBoundary {org} />
{/if}

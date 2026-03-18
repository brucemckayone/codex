<script lang="ts">
  import { page } from '$app/stores';
  import OrgErrorBoundary from '$lib/components/org/OrgErrorBoundary.svelte';
  import type { OrganizationData } from '$lib/types';

  const org: OrganizationData = {
    id: '',
    slug: $page.params.slug,
    name: $page.params.slug,
    description: '',
    logoUrl: null,
    brandColors: {
      primary: '#e94560',
      secondary: '#1a1a2e',
      accent: '#ff6b6b',
    },
  };
</script>

<OrgErrorBoundary {org} />

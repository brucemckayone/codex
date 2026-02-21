<script lang="ts">
  import OrgErrorBoundary from '$lib/components/org/OrgErrorBoundary.svelte';
  import type { OrganizationData } from '$lib/types';

  const org: OrganizationData = {
    id: '',
    slug: $page.params.slug,
    name: $page.params.slug,
    description: '',
    logoUrl: null,
  };
</script>

<OrgErrorBoundary {org} />

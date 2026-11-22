<script lang="ts">
  import { readsCategoryRoutes } from '@codex/constants';
  import StudioContentList from '$lib/components/studio/content-list/StudioContentList.svelte';

  let { data } = $props();
</script>

<!-- One list for both studios (Codex-a6ofh.3.1): it owns its read. -->
<StudioContentList
  organizationId={data.org.id}
  studioName={data.org.name}
  canReadCategories={readsCategoryRoutes(data.user?.role)}
/>

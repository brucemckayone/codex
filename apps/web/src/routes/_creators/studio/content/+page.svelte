<script lang="ts">
  import StudioContentList from '$lib/components/studio/content-list/StudioContentList.svelte';

  const { data } = $props();
</script>

<!-- One list for both studios (Codex-a6ofh.3.1): it owns its read. The
     layout's orgs name the Where's org options (Codex-a6ofh.3.2). -->
<StudioContentList
  organizationId={null}
  studioName="My Studio"
  orgs={data.orgs}
  canReadCategories={false}
/>
